'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { harness } = require('./harness.cjs');
test('built plugin registers against Joplin API contract and handles local note commands', async () => {
  const root = path.resolve(__dirname, '..');
  execFileSync(process.execPath, [path.join(root, 'scripts/build.cjs')]);
  const h = harness(); let start, handler, html, scripts = [];
  const api = { ...h.api,
    plugins: { register: obj => { start = obj.onStart; } },
    commands: { register: async c => assert.equal(c.name, 'dotNotesOpen') },
    views: { panels: {
      create: async () => 'panel', onMessage: async (_, callback) => { handler = callback; },
      setHtml: async (_, value) => { html = value; }, addScript: async (_, file) => scripts.push(file), show: async () => {}
    }, toolbarButtons: { create: async (...args) => assert.equal(args[2], 'editorToolbar') } }
  };
  const source = fs.readFileSync(path.join(root, 'dist/index.js'), 'utf8');
  vm.runInNewContext(source, { joplin: api, setTimeout, clearTimeout });
  await start(); assert.ok(html.includes('完成并发送')); assert.deepEqual(scripts, ['./panel.css', './panel.js']);
  const created = await handler({ type: 'create' }); assert.equal(created.ok, true);
  const note = created.value.note;
  const sent = await handler({ type: 'complete', id: note.id, draft: { title: 'Local test', body: 'never uploaded' }, base: note });
  assert.equal(sent.value.journal.records[0].state, 'disconnected');
  assert.equal(/fetch\s*\(|XMLHttpRequest|https?:\/\//.test(source), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist/manifest.json')));
  assert.deepEqual(manifest.platforms, ['desktop', 'mobile']); h.db.close();
});
