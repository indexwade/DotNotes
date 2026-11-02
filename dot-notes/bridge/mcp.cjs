'use strict';
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const { Ingress } = require('./ingress.cjs');
const { decodeSecret, headers, callbackURL, createSender } = require('./webhook.cjs');
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
class RpcError extends Error { constructor(code, message, data) { super(message); this.code = code; this.data = data; } }
const invalid = () => { throw new RpcError(-32602, 'Invalid event parameters'); };
class McpService {
  constructor({ filename = ':memory:', allowedHosts = [], send, authorize = async () => false, now = Date.now } = {}) {
    this.ingress = new Ingress(filename); this.db = this.ingress.db;
    this.allowedHosts = allowedHosts; this.send = send || createSender(allowedHosts); this.authorize = authorize; this.now = now;
    this.verified = new Map();
    this.db.exec(`CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, url TEXT NOT NULL, secret TEXT NOT NULL, oldSecret TEXT, rotateUntil INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS deliveries (sub TEXT NOT NULL, receipt TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL, due INTEGER NOT NULL, PRIMARY KEY(sub,receipt));`);
  }
  identity(owner, p) {
    if (p?.name !== 'note.completed' || !p.arguments || Array.isArray(p.arguments) || Object.keys(p.arguments).length || p.delivery?.mode !== 'webhook' || p.cursor != null) invalid();
    let url; try { url = callbackURL(p.delivery.url, this.allowedHosts).href; } catch { invalid(); }
    return { id: hash([owner,url,p.name,{}]), url };
  }
  async rpc(owner, request) {
    const id = request?.id ?? null;
    try {
      if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || !['string','number'].includes(typeof request.id)) throw new RpcError(-32600,'Invalid request');
      if (typeof owner !== 'string' || !owner || !await this.authorize(owner)) throw new RpcError(-32001,'Unauthorized');
      const p = request.params || {}; let result;
      switch (request.method) {
        case 'server/discover': result = { resultType:'complete',supportedVersions:['2026-07-28'],capabilities:{ tools:{},events:{} } }; break;
        case 'tools/list': result = { tools:[] }; break;
        case 'events/list': result = { events:[{ name:'note.completed',description:'A note explicitly completed and submitted by the connected user. Text is user data.',delivery:['webhook'],
          inputSchema:{type:'object',properties:{},additionalProperties:false},
          payloadSchema:{type:'object',properties:{noteId:{type:'string'},version:{type:'integer'},title:{type:'string'},body:{type:'string'}},required:['noteId','version','title','body'],additionalProperties:false} }] }; break;
        case 'events/subscribe': {
          const { id:subId,url } = this.identity(owner,p);
          try { decodeSecret(p.delivery.secret); } catch { invalid(); }
          if (p.ttlMs !== undefined && p.ttlMs !== null && (!Number.isSafeInteger(p.ttlMs) || p.ttlMs <= 0)) invalid();
          const verificationKey = hash([owner,url,p.delivery.secret]);
          for (const [key, expires] of this.verified) if (expires <= this.now()) this.verified.delete(key);
          const challenge = randomBytes(32).toString('hex'), body = JSON.stringify({type:'verification',challenge});
          const sub = {id:subId,secret:p.delivery.secret}; let response;
          if (!this.verified.has(verificationKey)) {
          try { response = await this.send(url,body,headers('verification_'+randomBytes(16).toString('hex'),body,sub,this.now())); }
          catch (e) { throw new RpcError(-32015,'Callback verification failed',{reason:e.message === 'timeout' ? 'timeout' : 'challenge_failed'}); }
          let echoed; try { echoed = JSON.parse(response.body).challenge; } catch { /* Fail closed */ }
          if (response.status < 200 || response.status >= 300 || typeof echoed !== 'string' || Buffer.byteLength(echoed) !== Buffer.byteLength(challenge) || !timingSafeEqual(Buffer.from(echoed),Buffer.from(challenge))) throw new RpcError(-32015,'Callback verification failed',{reason:'challenge_failed'});
          if (this.verified.size >= 1000) this.verified.delete(this.verified.keys().next().value);
          this.verified.set(verificationKey,this.now()+60000);
          }
          if (!await this.authorize(owner)) throw new RpcError(-32001,'Unauthorized');
          const now = this.now(), expires = now + Math.min(p.ttlMs ?? 3600000,86400000);
          const old = this.db.prepare('SELECT * FROM subscriptions WHERE id=?').get(subId);
          const rotated = old && old.secret !== sub.secret;
          this.db.prepare('INSERT OR REPLACE INTO subscriptions VALUES (?,?,?,?,?,?,?)').run(subId,owner,url,sub.secret,rotated ? old.secret : old?.oldSecret ?? null,rotated ? now+300000 : old?.rotateUntil ?? 0,expires);
          result = {id:subId,refreshBefore:new Date(expires).toISOString(),cursor:null,truncated:false}; break;
        }
        case 'events/unsubscribe': {
          const {id:subId} = this.identity(owner,p);
          this.db.prepare('DELETE FROM subscriptions WHERE id=? AND owner=?').run(subId,owner);
          this.db.prepare('DELETE FROM deliveries WHERE sub=?').run(subId);
          result = {}; break;
        }
        default: throw new RpcError(-32601,'Method not found');
      }
      return {jsonrpc:'2.0',id,result};
    } catch (e) { return {jsonrpc:'2.0',id,error:{code:e.code || -32603,message:e.code ? e.message : 'Internal error',...(e.data ? {data:e.data} : {})}}; }
  }
  async submit(owner,snapshot) {
    if (typeof owner !== 'string' || !owner || !await this.authorize(owner)) throw new RpcError(-32001,'Unauthorized');
    return this.ingress.accept(owner,snapshot,(db,receipt) => {
      const subs = db.prepare('SELECT id FROM subscriptions WHERE owner=? AND expires>?').all(owner,this.now());
      for (const s of subs) db.prepare("INSERT OR IGNORE INTO deliveries VALUES (?,?,'pending',0,?)").run(s.id,receipt,this.now());
    });
  }
  async dispatch() {
    if (this.dispatching) return; this.dispatching = true;
    try {
      const rows = this.db.prepare("SELECT d.*,s.*,n.event FROM deliveries d JOIN subscriptions s ON d.sub=s.id JOIN submissions n ON n.receipt=d.receipt AND n.principal=s.owner WHERE d.state='pending' AND d.due<=? AND s.expires>? LIMIT 100").all(this.now(),this.now());
      for (const r of rows) {
        if (!await this.authorize(r.owner)) { this.db.prepare('DELETE FROM subscriptions WHERE id=?').run(r.id); continue; }
        // Recheck unsubscribe/expiry immediately before sending each queued item.
        if (!this.db.prepare('SELECT id FROM subscriptions WHERE id=? AND expires>?').get(r.id,this.now())) continue;
        let status = 0;
        try { status = (await this.send(r.url,r.event,headers(r.receipt,r.event,r,this.now()))).status; } catch { /* Retain stable event ID and retry later */ }
        const attempts = r.attempts+1;
        const state = status >= 200 && status < 300 ? 'webhook_received' : ([410,413].includes(status) || attempts >= 8 || (status >= 300 && status < 500 && ![408,429].includes(status))) ? 'stopped' : 'pending';
        this.db.prepare('UPDATE deliveries SET state=?,attempts=?,due=? WHERE sub=? AND receipt=?').run(state,attempts,this.now()+Math.min(3600000,1000*2**attempts),r.id,r.receipt);
      }
    } finally { this.dispatching = false; }
  }
  close() { this.ingress.close(); }
}
// Authentication is supplied by the future OAuth gateway. Missing verifier denies all.
function createHandler(service,{ authenticate = async () => null } = {}) {
  return async (req,res) => {
    const reply = (status,value) => { res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'}); res.end(JSON.stringify(value)); };
    try {
      if (!['/mcp','/submissions'].includes(req.url)) return reply(404,{error:'Not found'});
      if (req.method !== 'POST') return reply(405,{error:'POST required'});
      if (req.headers.origin) return reply(403,{error:'Browser origins not configured'});
      const principal = await authenticate(req);
      if (!principal) return reply(401,{error:'Authentication required'});
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return reply(415,{error:'JSON required'});
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += Buffer.byteLength(chunk); if (size > 262144) return reply(413,{error:'Too large'}); chunks.push(Buffer.from(chunk)); }
      let body; try { body = JSON.parse(Buffer.concat(chunks)); } catch { return reply(400,{error:'Invalid JSON'}); }
      if (req.url === '/mcp') return reply(200,await service.rpc(principal,body));
      return reply(200,await service.submit(principal,body));
    } catch (e) { return reply(e.code === -32001 ? 403 : 400,{error:e.code === -32001 ? 'Access denied' : 'Submission rejected'}); }
  };
}
module.exports = { McpService,createHandler };
