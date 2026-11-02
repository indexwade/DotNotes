'use strict';
// No network or filesystem dependency. Joplin owns note persistence.
const DotCore = (() => {
  const MAX_BODY = 180000;
  const JOURNAL_KEY = 'submissions.v1';
  const states = ['pending', 'disconnected', 'sending', 'unknown', 'failed', 'accepted'];
  const copy = value => JSON.parse(JSON.stringify(value));
  const same = (a, b) => a.title === b.title && a.body === b.body;
  function content(value) {
    if (!value || typeof value.title !== 'string' || typeof value.body !== 'string' ||
        value.title.length > 500 || value.body.length > MAX_BODY) {
      throw new Error('标题最多 500 字符，正文最多 180000 字符。内容未发送，请保留编辑区文字。');
    }
    return { title: value.title, body: value.body };
  }
  function id(value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) throw new Error('笔记标识无效。');
    return value;
  }
  function journal(raw, noteId) {
    if (raw === undefined || raw === null) return { schema: 1, records: [] };
    if (!raw || raw.schema !== 1 || !Array.isArray(raw.records) || raw.records.length > 100) {
      throw new Error('发送记录格式异常；已停止操作，原记录未覆盖。');
    }
    raw.records.forEach((r, i) => {
      if (r.version !== i + 1 || r.key !== noteId + ':' + r.version || !states.includes(r.state) ||
          !Number.isSafeInteger(r.attempts) || r.attempts < 0) throw new Error('发送记录损坏；已停止操作。');
      content(r.snapshot);
    });
    return copy(raw);
  }
  const disconnected = Object.freeze({
    connected: false,
    async send() { throw new Error('未连接：尚未验证现有 dot 的接收通道。'); }
  });
  class Service {
    constructor(store, adapter = disconnected, timeoutMs = 10000) {
      this.store = store;
      this.adapter = adapter;
      this.timeoutMs = timeoutMs;
      this.tail = Promise.resolve();
    }
    // Serialize mutations so autosave, switching, and double-clicks cannot race.
    run(fn) {
      const result = this.tail.then(fn);
      this.tail = result.catch(() => {});
      return result;
    }
    async read(noteId) {
      const note = await this.store.read(id(noteId));
      content(note);
      const state = journal(await this.store.readJournal(noteId), noteId);
      return { note, journal: state, connected: this.adapter.connected === true };
    }
    async writeJournal(noteId, state) {
      await this.store.writeJournal(noteId, copy(state));
      const saved = journal(await this.store.readJournal(noteId), noteId);
      if (JSON.stringify(saved) !== JSON.stringify(state)) throw new Error('发送记录未确认保存，已停止发送。');
    }
    async saveImpl(noteId, draft, base) {
      id(noteId); content(draft); content(base);
      const current = await this.store.read(noteId);
      if (!same(current, base) && !same(current, draft)) {
        throw new Error('笔记已在其他编辑器变更。当前文字仍在此处，请复制后重新打开；不会覆盖已有修改。');
      }
      if (!same(current, draft)) await this.store.write(noteId, content(draft));
      const saved = await this.store.read(noteId);
      if (!same(saved, draft)) throw new Error('本地保存未确认。请保留编辑内容并重试。');
      return saved;
    }
    save(noteId, draft, base) { return this.run(() => this.saveImpl(noteId, draft, base)); }
    complete(noteId, draft, base) {
      return this.run(async () => {
        const saved = await this.saveImpl(noteId, draft, base);
        const state = journal(await this.store.readJournal(noteId), noteId);
        let record = state.records[state.records.length - 1];
        if (!record || !same(record.snapshot, saved)) {
          if (state.records.length >= 100) throw new Error('此笔记已有 100 个提交版本；请新建笔记，原记录会保留。');
          const version = state.records.length + 1;
          record = { version, key: noteId + ':' + version, snapshot: content(saved), state: 'pending', attempts: 0 };
          state.records.push(record);
          await this.writeJournal(noteId, state);
        }
        await this.deliver(noteId, state, record);
        return this.read(noteId);
      });
    }
    retry(noteId, version) {
      return this.run(async () => {
        await this.store.read(id(noteId));
        const state = journal(await this.store.readJournal(noteId), noteId);
        const record = state.records.find(r => r.version === version);
        if (!record) throw new Error('没有找到待重试版本。');
        await this.deliver(noteId, state, record);
        return this.read(noteId);
      });
    }
    async deliver(noteId, state, record) {
      if (record.state === 'accepted') return;
      if (this.adapter.connected !== true) {
        record.state = 'disconnected';
        record.error = '未连接：笔记和提交快照已保留，尚未上传。';
        await this.writeJournal(noteId, state);
        return;
      }
      record.state = 'sending';
      record.attempts++;
      delete record.error;
      await this.writeJournal(noteId, state);
      let timer;
      let receipt;
      try {
        receipt = await Promise.race([
          this.adapter.send(copy({ noteId, version: record.version, key: record.key, snapshot: record.snapshot })),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), this.timeoutMs); })
        ]);
        if (!receipt || receipt.key !== record.key || receipt.status !== 'accepted' ||
            typeof receipt.receiptId !== 'string' || !receipt.receiptId || receipt.receiptId.length > 200) {
          throw new Error('invalid receipt');
        }
      } catch (_) {
        record.state = 'unknown';
        record.error = '服务接收结果未知；快照保留。重试会使用同一提交标识。';
      } finally { clearTimeout(timer); }
      if (receipt && receipt.key === record.key && receipt.status === 'accepted' &&
          typeof receipt.receiptId === 'string' && receipt.receiptId.length > 0 && receipt.receiptId.length <= 200) {
        record.state = 'accepted';
        record.receiptId = receipt.receiptId;
      }
      // A failure here leaves durable 'sending': read as uncertain, never as success.
      await this.writeJournal(noteId, state);
    }
  }
  return { Service, disconnected, content, id, journal, same, JOURNAL_KEY, MAX_BODY };
})();
if (typeof module !== 'undefined') module.exports = DotCore;
