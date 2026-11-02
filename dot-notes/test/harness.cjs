'use strict';
const { DatabaseSync } = require('node:sqlite');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
global.DotCore = require('../src/core.js');
global.DotStore = require('../src/store.js');
const { createController } = require('../src/host.js');
function harness(filename = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dot-notes-test-')), 'notes.db'), adapter) {
  const db = new DatabaseSync(filename);
  db.exec('CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, kind TEXT, data TEXT NOT NULL, metadata TEXT NOT NULL)');
  const options = { sync: 0, failWrite: false, failJournal: false, journalWrites: 0, onJournal: null };
  const raw = id => {
    const r = db.prepare('SELECT * FROM items WHERE id=?').get(id);
    if (!r) throw new Error('missing');
    return { ...r, data: JSON.parse(r.data), metadata: JSON.parse(r.metadata) };
  };
  const mutate = (id, changes) => {
    const row = raw(id); row.data = { ...row.data, ...changes };
    db.prepare('UPDATE items SET data=? WHERE id=?').run(JSON.stringify(row.data), id);
  };
  const api = {
    settings: { globalValues: async () => [options.sync] },
    data: {
      async get(p, q = {}) {
        if (p[0] === 'notes' && p.length === 2) return raw(p[1]).data;
        const rows = db.prepare('SELECT * FROM items WHERE kind=?').all(p[0] === 'folders' && p.length === 1 ? 'folder' : 'note');
        const filtered = rows.map(r => JSON.parse(r.data)).filter(r => p.length !== 3 || r.parent_id === p[1]);
        const page = q?.page || 1, limit = q?.limit || 100;
        return { items: filtered.slice((page - 1) * limit, page * limit), has_more: filtered.length > page * limit };
      },
      async post(p, _, body) {
        const id = randomBytes(16).toString('hex');
        const data = { id, title: '', body: '', parent_id: '', markup_language: 1, deleted_time: 0, is_conflict: 0, updated_time: Date.now(), ...body };
        db.prepare('INSERT INTO items VALUES(?,?,?,?)').run(id, p[0] === 'folders' ? 'folder' : 'note', JSON.stringify(data), '{}');
        return data;
      },
      async put(p, _, body) {
        if (options.failWrite) throw new Error('disk full');
        mutate(p[1], { ...body, updated_time: Date.now() }); return raw(p[1]).data;
      },
      async userDataGet(_type, id, key) { return raw(id).metadata[key]; },
      async userDataSet(_type, id, key, value) {
        options.journalWrites++;
        if (options.failJournal) throw new Error('disk full');
        if (options.onJournal) options.onJournal(value);
        const row = raw(id); row.metadata[key] = value;
        db.prepare('UPDATE items SET metadata=? WHERE id=?').run(JSON.stringify(row.metadata), id);
      }
    }
  };
  const store = new DotStore.Store(api);
  return { db, filename, api, store, service: new DotCore.Service(store, adapter), controller: createController(api, adapter), options, raw, mutate };
}
module.exports = { harness };
