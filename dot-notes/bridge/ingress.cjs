'use strict';
// Local service-domain component only. No HTTP listener, OAuth, subscription or delivery.
// The caller must supply the principal verified by its future authentication layer.
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
class Ingress {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS submissions (principal TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL, receipt TEXT NOT NULL, event TEXT NOT NULL, PRIMARY KEY(principal,key))');
  }
  accept(principal, snapshot, onPersist = () => {}) {
    if (typeof principal !== 'string' || !principal || principal.length > 256) throw Error('Verified principal required');
    const { noteId, version, title, body } = snapshot || {};
    if (!/^[a-f0-9]{32}$/.test(noteId) || !Number.isSafeInteger(version) || version < 1 || typeof title !== 'string' || typeof body !== 'string') throw Error('Invalid snapshot');
    if (title.length > 500 || body.length > 180000) throw Error('Snapshot too large');
    const key = noteId + ':' + version;
    const payload = JSON.stringify({ noteId, version, title, body });
    const receiptId = createHash('sha256').update(JSON.stringify([principal, key])).digest('hex');
    const event = JSON.stringify({ eventId: receiptId, name: 'note.completed', timestamp: new Date().toISOString(), data: JSON.parse(payload), cursor: null });
    // Leave headroom below the documented total webhook body limit of 256 KiB.
    if (Buffer.byteLength(event) > 250000) throw Error('UTF-8 event exceeds delivery limit');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.db.prepare('SELECT payload,receipt FROM submissions WHERE principal=? AND key=?').get(principal,key);
      if (previous && previous.payload !== payload) throw Error('Version conflict: key already has different content');
      if (!previous) this.db.prepare('INSERT INTO submissions VALUES (?,?,?,?,?)').run(principal,key,payload,receiptId,event);
      onPersist(this.db, previous ? previous.receipt : receiptId);
      this.db.exec('COMMIT');
      return { status: 'accepted', key, receiptId: previous ? previous.receipt : receiptId };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  event(principal, key) {
    const row = this.db.prepare('SELECT event FROM submissions WHERE principal=? AND key=?').get(principal,key);
    return row ? JSON.parse(row.event) : null;
  }
  close() { this.db.close(); }
}
module.exports = { Ingress };
