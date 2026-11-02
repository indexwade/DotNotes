'use strict';
(() => {
  const $ = id => document.getElementById(id);
  let selected = null, base = null, saving = null, switching = false;
  const draft = () => ({ title: $('title').value, body: $('body').value });
  const same = (a, b) => a && b && a.title === b.title && a.body === b.body;
  function error(message) { $('error').textContent = message || ''; $('error').hidden = !message; }
  async function request(message) {
    const result = await webviewApi.postMessage(message);
    if (!result || !result.ok) throw new Error(result?.error || '本地请求未完成；请保留编辑内容。');
    return result.value;
  }
  async function refreshList() {
    const notes = await request({ type: 'list' });
    $('count').textContent = notes.length;
    $('list').replaceChildren();
    for (const note of notes) {
      const button = document.createElement('button');
      button.className = note.id === selected ? 'active' : '';
      button.setAttribute('aria-pressed', note.id === selected ? 'true' : 'false');
      const label = document.createElement('span'); label.textContent = note.title || '无标题笔记';
      const date = document.createElement('small'); date.textContent = new Date(note.updated_time).toLocaleDateString();
      button.append(label, date); button.addEventListener('click', () => openNote(note.id));
      $('list').append(button);
    }
  }
  const labels = { pending: '等待提交', disconnected: '未连接 · 未上传', sending: '接收结果未知 · 可安全重试', unknown: '接收结果未知 · 可安全重试', failed: '发送失败', accepted: '服务已接收 · dot 处理未确认' };
  function history(state) {
    $('history-count').textContent = state.records.length;
    $('records').replaceChildren();
    for (const record of [...state.records].reverse()) {
      const row = document.createElement('div'); row.className = 'record';
      const description = document.createElement('div');
      description.textContent = '版本 ' + record.version + ' · ' + labels[record.state];
      const title = document.createElement('small'); title.textContent = record.snapshot.title || '无标题笔记';
      description.append(title);
      const detail = document.createElement('details');
      const summary = document.createElement('summary'); summary.textContent = '查看当时的正文';
      const snapshot = document.createElement('pre'); snapshot.style.whiteSpace = 'pre-wrap'; snapshot.textContent = record.snapshot.body;
      detail.append(summary, snapshot); description.append(detail); row.append(description);
      if (record.state !== 'accepted') {
        const retry = document.createElement('button'); retry.textContent = '重试此版本';
        retry.addEventListener('click', async () => {
          retry.disabled = true;
          const noteId = selected;
          try { const value = await request({ type: 'retry', id: noteId, version: record.version }); if (selected === noteId) history(value.journal); }
          catch (e) { error(e.message); } finally { retry.disabled = false; }
        }); row.append(retry);
      }
      $('records').append(row);
    }
  }
  function flush() {
    if (saving) return saving;
    if (!selected || same(draft(), base)) return Promise.resolve();
    $('save-status').textContent = '正在保存…';
    let succeeded = false;
    saving = (async () => {
      while (selected && !same(draft(), base)) {
        const snapshot = draft();
        const note = await request({ type: 'save', id: selected, draft: snapshot, base });
        base = { title: note.title, body: note.body };
      }
      $('save-status').textContent = '本地已保存';
      error('');
      await refreshList();
      succeeded = true;
    })().catch(e => { $('save-status').textContent = '保存未确认 · 请保留文字'; error(e.message); throw e; })
      .finally(() => {
        saving = null;
        if (succeeded && selected && !same(draft(), base)) queueMicrotask(() => flush().catch(() => {}));
      });
    return saving;
  }
  function lock(value) {
    switching = value;
    $('title').disabled = value; $('body').disabled = value; $('new').disabled = value;
  }
  async function openNote(noteId, create = false) {
    if (switching) return;
    lock(true);
    try {
      await flush();
      const value = await request(create ? { type: 'create' } : { type: 'open', id: noteId });
      selected = value.note.id; base = { title: value.note.title, body: value.note.body };
      $('title').value = base.title; $('body').value = base.body;
      $('empty').hidden = true; $('editor').hidden = false; $('save-status').textContent = '本地已保存';
      history(value.journal); error(''); await refreshList();
    } catch (e) { error(e.message); }
    finally { lock(false); if (create && selected) $('title').focus(); }
  }
  for (const name of ['title', 'body']) $(name).addEventListener('input', () => { flush().catch(() => {}); });
  $('new').addEventListener('click', () => openNote(null, true));
  $('save').addEventListener('click', () => flush().catch(() => {}));
  $('send').addEventListener('click', async () => {
    $('send').disabled = true;
    try {
      await flush();
      const noteId = selected;
      const value = await request({ type: 'complete', id: noteId, draft: draft(), base });
      if (selected === noteId) { history(value.journal); $('history').open = true; }
    } catch (e) { error(e.message); } finally { $('send').disabled = false; }
  });
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); flush().catch(() => {}); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); openNote(null, true); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush().catch(() => {}); });
  window.addEventListener('beforeunload', event => {
    if (selected && !same(draft(), base)) { event.preventDefault(); event.returnValue = ''; }
  });
  refreshList().catch(e => error(e.message));
})();
