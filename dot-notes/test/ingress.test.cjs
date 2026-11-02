const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Ingress } = require('../bridge/ingress.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const note = { noteId: 'a'.repeat(32), version: 1, title: '测试', body: '合成测试内容' };
test('service accepts durably; retry after restart preserves receipt and event identity', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dot-ingress-')); const file = path.join(dir,'test.sqlite');
  let service = new Ingress(file);
  try {
    const receipt = service.accept('test-user',note), event = service.event('test-user',receipt.key);
    service.close(); service = new Ingress(file);
    assert.deepEqual(service.accept('test-user',note),receipt);
    assert.deepEqual(service.event('test-user',receipt.key),event);
    assert.equal(receipt.status,'accepted'); assert.equal(event.name,'note.completed');
  } finally { service.close(); fs.rmSync(dir,{recursive:true}); }
});
test('same version different content rejected without replacing original', () => {
  const service = new Ingress(':memory:');
  try { const r = service.accept('u',note); assert.throws(() => service.accept('u',{...note,body:'changed'}),/Version conflict/); assert.equal(service.event('u',r.key).data.body,note.body); } finally { service.close(); }
});
test('principal isolation prevents cross-account receipt or note access', () => {
  const service = new Ingress(':memory:');
  try { const a = service.accept('a',note); assert.equal(service.event('b',a.key),null); assert.notEqual(service.accept('b',note).receiptId,a.receiptId); assert.throws(() => service.accept('',note)); } finally { service.close(); }
});
test('UTF-8 byte limit rejects oversized event before persistence', () => {
  const service = new Ingress(':memory:');
  try { assert.throws(() => service.accept('u',{...note,body:'中'.repeat(90000)}),/UTF-8/); assert.equal(service.event('u',note.noteId+':1'),null); } finally { service.close(); }
});
