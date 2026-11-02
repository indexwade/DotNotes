'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./harness.cjs');
const content = { title: '今天的想法', body: '第一行\n第二行 🌿\n<script>not executable</script>' };
test('SQLite harness: create, persist Chinese plaintext, reopen process connection; no send on save', async () => {
  let sends = 0; const h = harness(undefined, { connected: true, send: async () => sends++ });
  const n = await h.store.create();
  await h.service.save(n.id, content, n);
  assert.equal(sends, 0); h.db.close();
  const reopened = harness(h.filename);
  const read = await reopened.service.read(n.id);
  assert.equal(read.note.body, content.body); assert.equal(read.journal.records.length, 0);
  reopened.db.close();
});
test('disconnected completion creates durable snapshot; double-click and restart reuse version', async () => {
  const h = harness(); const n = await h.store.create();
  const results = await Promise.all([h.service.complete(n.id, content, n), h.service.complete(n.id, content, n)]);
  assert.equal(results[1].journal.records.length, 1);
  assert.equal(results[1].journal.records[0].attempts, 0);
  assert.equal(results[1].journal.records[0].state, 'disconnected');
  h.db.close(); const h2 = harness(h.filename);
  const retried = await h2.service.retry(n.id, 1);
  assert.equal(retried.journal.records[0].key, n.id + ':1');
  assert.deepEqual(retried.journal.records[0].snapshot, content); h2.db.close();
});
test('storage failure preserves last saved note and prevents delivery', async () => {
  let calls = 0; const h = harness(undefined, { connected: true, send: async () => calls++ });
  const n = await h.store.create(); h.options.failWrite = true;
  await assert.rejects(h.service.complete(n.id, content, n), /disk full/);
  assert.equal(h.raw(n.id).data.body, ''); assert.equal(calls, 0); h.db.close();
});
test('snapshot journal failure prevents delivery even when note was saved', async () => {
  let calls = 0; const h = harness(undefined, { connected: true, send: async () => calls++ });
  const n = await h.store.create(); h.options.failJournal = true;
  await assert.rejects(h.service.complete(n.id, content, n));
  assert.equal(h.raw(n.id).data.body, content.body); assert.equal(calls, 0); h.db.close();
});
test('network loss persists unknown result; retry uses same key and valid acknowledgement', async () => {
  const keys = []; let fail = true;
  const h = harness(undefined, { connected: true, send: async s => {
    keys.push(s.key); if (fail) throw new Error('network');
    return { key: s.key, status: 'accepted', receiptId: 'test-only-receipt' };
  } });
  const n = await h.store.create();
  assert.equal((await h.service.complete(n.id, content, n)).journal.records[0].state, 'unknown');
  fail = false;
  const r = await h.service.retry(n.id, 1);
  assert.equal(r.journal.records[0].state, 'accepted');
  await h.service.retry(n.id, 1);
  assert.deepEqual(keys, [n.id + ':1', n.id + ':1']); h.db.close();
});
test('rejected or mismatched receipts never claim acceptance', async () => {
  const h = harness(undefined, { connected: true, send: async () => ({ key: 'other', status: 'accepted', receiptId: 'bad' }) });
  const n = await h.store.create();
  assert.equal((await h.service.complete(n.id, content, n)).journal.records[0].state, 'unknown'); h.db.close();
});
test('timeout remains unknown; a late receipt cannot silently upgrade it', async () => {
  let resolve; const h = harness(undefined, { connected: true, send: () => new Promise(r => { resolve = r; }) });
  h.service.timeoutMs = 10; const n = await h.store.create();
  const r = await h.service.complete(n.id, content, n);
  assert.equal(r.journal.records[0].state, 'unknown');
  resolve({ key: n.id + ':1', status: 'accepted', receiptId: 'late' });
  await Promise.resolve(); assert.equal((await h.service.read(n.id)).journal.records[0].state, 'unknown'); h.db.close();
});
test('editing and reverting create distinct submission versions; old retry cannot alter current content', async () => {
  const h = harness(); const n = await h.store.create();
  await h.service.complete(n.id, content, n);
  const newer = { title: '新版', body: 'new' };
  await h.service.complete(n.id, newer, content);
  await h.service.retry(n.id, 1);
  assert.equal((await h.service.read(n.id)).note.body, 'new');
  const r = await h.service.complete(n.id, content, newer);
  assert.deepEqual(r.journal.records.map(r => r.version), [1, 2, 3]); h.db.close();
});
test('crash after service accepted but before receipt save leaves recoverable same-key uncertainty', async () => {
  let key; const h = harness(undefined, { connected: true, send: async s => {
    key = s.key; h.options.failJournal = true; return { key, status: 'accepted', receiptId: 'test' };
  } });
  const n = await h.store.create(); await assert.rejects(h.service.complete(n.id, content, n));
  h.db.close(); const h2 = harness(h.filename);
  const r = await h2.service.read(n.id);
  assert.equal(r.journal.records[0].state, 'sending'); assert.equal(r.journal.records[0].key, key); h2.db.close();
});
test('corrupt metadata fails closed without overwriting saved notes or journal', async () => {
  const h = harness(); const n = await h.store.create();
  await h.api.data.userDataSet(1, n.id, DotCore.JOURNAL_KEY, { schema: 900 });
  await assert.rejects(h.service.read(n.id), /格式异常/);
  assert.deepEqual(await h.store.readJournal(n.id), { schema: 900 }); h.db.close();
});
test('external changes conflict instead of overwriting', async () => {
  const h = harness(); const n = await h.store.create(); h.mutate(n.id, { body: 'external edit' });
  await assert.rejects(h.service.save(n.id, content, n), /其他编辑器/);
  assert.equal(h.raw(n.id).data.body, 'external edit'); h.db.close();
});
test('enabled or unknown sync target blocks all writes without changing host settings', async () => {
  const h = harness(); const n = await h.store.create();
  for (const sync of [2, undefined, null, false]) {
    h.options.sync = sync; await assert.rejects(h.service.save(n.id, content, n), /同步/);
    assert.equal(h.options.sync, sync);
  }
  h.db.close();
});
test('notes in other notebooks cannot be edited; folder renaming preserves ownership', async () => {
  const h = harness(); const n = await h.store.create();
  h.mutate(n.parent_id, { title: 'Renamed' }); assert.equal((await h.store.list())[0].id, n.id);
  h.mutate(n.id, { parent_id: 'f'.repeat(32) }); await assert.rejects(h.service.save(n.id, content, n), /不在/); h.db.close();
});
test('empty text, malformed requests and oversized content handled without note loss', async () => {
  const h = harness(); const n = await h.store.create();
  await h.service.save(n.id, content, n); await h.service.save(n.id, { title: '', body: '' }, content);
  assert.equal((await h.store.read(n.id)).body, '');
  assert.equal((await h.controller({ type: 'open', id: '../../' })).ok, false);
  assert.equal((await h.controller(null)).ok, false);
  await assert.rejects(h.service.save(n.id, { title: '', body: 'a'.repeat(180001) }, { title: '', body: '' })); h.db.close();
});
test('note listing paginates beyond 100', async () => {
  const h = harness(); const n = await h.store.create();
  for (let i = 0; i < 101; i++) await h.api.data.post(['notes'], null, { parent_id: n.parent_id, title: String(i) });
  assert.equal((await h.store.list()).length, 102); h.db.close();
});
