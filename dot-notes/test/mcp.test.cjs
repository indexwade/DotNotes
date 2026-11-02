const {test} = require('node:test');
const assert = require('node:assert/strict');
const {Readable} = require('node:stream');
const {createHmac} = require('node:crypto');
const {McpService,createHandler} = require('../bridge/mcp.cjs');
const {headers,publicV4,createSender,decodeSecret} = require('../bridge/webhook.cjs');
const secret = 'whsec_'+Buffer.alloc(32,7).toString('base64'); // Synthetic fixture only.
const params = {name:'note.completed',arguments:{},delivery:{mode:'webhook',url:'https://callback.example.test/events',secret}};
const note = {noteId:'b'.repeat(32),version:1,title:'Synthetic',body:'No real notes'};
const rpc = (s,m,p=params,u='test-user') => s.rpc(u,{jsonrpc:'2.0',id:1,method:m,params:p});
function setup(overrides={}) {
  const sent=[]; let now = 1800000000000, access = true;
  const service = new McpService({allowedHosts:['callback.example.test'],authorize:async()=>access,now:()=>now,send:async(url,body,h)=>{
    sent.push({url,body,h}); const b=JSON.parse(body); return {status:200,body:JSON.stringify({challenge:b.challenge})};
  },...overrides});
  return {service,sent,tick:n=>now+=n,revoke:()=>access=false};
}
test('MCP discovery and advertised payload schema match submitted event',async()=>{
  const {service:s}=setup(); try { assert.deepEqual((await rpc(s,'server/discover',{})).result.supportedVersions,['2026-07-28']);
    assert.equal((await rpc(s,'events/list',{})).result.events[0].name,'note.completed');
    assert.equal((await rpc(s,'nonexistent',{})).error.code,-32601);
    assert.equal((await s.rpc('u',{})).error.code,-32600);
  }finally{s.close();}
});
test('verify before subscribe; stable identity, refresh and secret rotation',async()=>{
  const {service:s,sent,tick}=setup(); try {
    const first=(await rpc(s,'events/subscribe')).result; assert.ok(first.id); assert.equal(JSON.parse(sent[0].body).type,'verification');
    tick(1000); const second=(await rpc(s,'events/subscribe',{...params,delivery:{...params.delivery,secret:'whsec_'+Buffer.alloc(32,8).toString('base64')}})).result;
    assert.equal(second.id,first.id); assert.notEqual(second.refreshBefore,first.refreshBefore);
    await s.submit('test-user',note); await s.dispatch(); assert.equal(sent.at(-1).h['webhook-signature'].split(' ').length,2);
  }finally{s.close();}
});
test('callback mismatch and private/unapproved host never activate subscription',async()=>{
  const {service:s}=setup({send:async()=>({status:200,body:'{"challenge":"wrong"}'})});
  try { assert.equal((await rpc(s,'events/subscribe')).error.code,-32015);
    assert.equal((await rpc(s,'events/subscribe',{...params,delivery:{...params.delivery,url:'https://127.0.0.1/events'}})).error.code,-32602);
    assert.equal(s.db.prepare('SELECT count(*) n FROM subscriptions').get().n,0);
  }finally{s.close();}
});
test('submit and outbox atomic; retry does not duplicate; webhook receipt is not processed',async()=>{
  const {service:s,sent}=setup(); try {
    await rpc(s,'events/subscribe'); const a=await s.submit('test-user',note); assert.deepEqual(await s.submit('test-user',note),a);
    assert.equal(s.db.prepare('SELECT count(*) n FROM deliveries').get().n,1);
    await s.dispatch(); await s.dispatch(); assert.equal(sent.length,2);
    assert.equal(s.db.prepare('SELECT state FROM deliveries').get().state,'webhook_received');
    s.db.exec('DROP TABLE deliveries'); await assert.rejects(s.submit('test-user',{...note,version:2}));
    assert.equal(s.ingress.event('test-user',note.noteId+':2'),null);
  }finally{s.close();}
});
test('transient delivery retries same event; terminal 410 stops retries',async()=>{
  let status=503; const sent=[];
  const {service:s,tick}=setup({send:async(u,b,h)=>{sent.push({b,h}); const o=JSON.parse(b); return o.type?{status:200,body:JSON.stringify({challenge:o.challenge})}:{status,body:''};}});
  try {await rpc(s,'events/subscribe');await s.submit('test-user',note);await s.dispatch();tick(3000);status=410;await s.dispatch();tick(999999);await s.dispatch();
    assert.equal(sent.length,3);assert.equal(sent[1].b,sent[2].b);assert.equal(sent[1].h['webhook-id'],sent[2].h['webhook-id']);assert.notEqual(sent[1].h['webhook-timestamp'],sent[2].h['webhook-timestamp']);assert.equal(s.db.prepare('SELECT state FROM deliveries').get().state,'stopped');
  }finally{s.close();}
});
test('expiry, revocation, and owner-scoped unsubscribe prevent further delivery',async()=>{
  for(const mode of ['expiry','revoke','unsubscribe']) {
    const {service:s,sent,tick,revoke}=setup();try{
      await rpc(s,'events/subscribe',{...params,ttlMs:1000});await s.submit('test-user',note);
      await rpc(s,'events/unsubscribe',params,'other-user');assert.equal(s.db.prepare('SELECT count(*) n FROM subscriptions').get().n,1);
      if(mode==='expiry')tick(1001);if(mode==='revoke')revoke();if(mode==='unsubscribe'){await rpc(s,'events/unsubscribe');await rpc(s,'events/unsubscribe');}
      await s.dispatch();assert.equal(sent.length,1);
    }finally{s.close();}
  }
});
test('webhook signature covers exact bytes and ID; invalid secret rejected',()=>{
  const body='{"body":"合成"}',h=headers('evt',body,{id:'sub',secret},1800000000000);
  const expected=createHmac('sha256',Buffer.alloc(32,7)).update('evt.1800000000.'+body).digest('base64');
  assert.equal(h['webhook-signature'],'v1,'+expected);assert.throws(()=>decodeSecret('whsec_YQ=='));
});
test('outbound rejects local/reserved/IP literals before connecting',async()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','192.168.1.1','192.0.0.1','198.18.1.1','203.0.113.1','224.0.0.1','::1','::ffff:127.0.0.1'])assert.equal(publicV4(ip),false,ip);
  assert.equal(publicV4('8.8.8.8'),true);
  const send=createSender(['callback.example.test'],async()=>[{address:'127.0.0.1'}],()=>assert.fail('must not connect'));
  await assert.rejects(send(params.delivery.url,'{}',{}),/Non-public/);
});
async function invoke(handler,url,body,auth=true){
  const req=Readable.from([Buffer.from(typeof body==='string'?body:JSON.stringify(body))]);Object.assign(req,{url,method:'POST',headers:{'content-type':'application/json',authorization:auth?'fixture':undefined}});
  let status,payload;await handler(req,{writeHead:s=>status=s,end:s=>payload=JSON.parse(s)});return{status,payload};
}
test('HTTP endpoints fail closed without auth and handle JSON-RPC, submissions, invalid JSON',async()=>{
  const {service:s}=setup();try{
    assert.equal((await invoke(createHandler(s),'/mcp',{})).status,401);
    const handler=createHandler(s,{authenticate:async r=>r.headers.authorization?'test-user':null});
    assert.equal((await invoke(handler,'/mcp',{jsonrpc:'2.0',id:1,method:'events/list'})).payload.result.events.length,1);
    assert.equal((await invoke(handler,'/submissions',note)).payload.status,'accepted');
    assert.equal((await invoke(handler,'/submissions','{')).status,400);
    assert.equal((await invoke(handler,'/submissions','x'.repeat(262145))).status,413);
  }finally{s.close();}
});
test('subscription and pending delivery survive SQLite restart',async()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dot-mcp-fixture-')),filename=path.join(dir,'synthetic.sqlite');
  let a=setup({filename}),s=a.service;
  try{
    const id=(await rpc(s,'events/subscribe')).result.id;await s.submit('test-user',note);s.close();
    a=setup({filename});s=a.service;await s.dispatch();
    assert.equal(a.sent.length,1);assert.equal(a.sent[0].h['X-MCP-Subscription-Id'],id);
    assert.equal(s.db.prepare('SELECT state FROM deliveries').get().state,'webhook_received');
  }finally{s.close();fs.rmSync(dir,{recursive:true});}
});
test('callback verification cache is bounded in time; retries stop at eight attempts',async()=>{
  const sent=[];const {service:s,tick}=setup({send:async(u,b)=>{sent.push(b);const p=JSON.parse(b);return p.type?{status:200,body:JSON.stringify({challenge:p.challenge})}:{status:503,body:''};}});
  try{
    await rpc(s,'events/subscribe');await rpc(s,'events/subscribe');assert.equal(sent.length,1);
    tick(60001);await rpc(s,'events/subscribe');assert.equal(sent.length,2);
    await s.submit('test-user',note);for(let i=0;i<10;i++){await s.dispatch();tick(300000);}
    assert.equal(s.db.prepare('SELECT attempts FROM deliveries').get().attempts,8);
    assert.equal(s.db.prepare('SELECT state FROM deliveries').get().state,'stopped');
  }finally{s.close();}
});
test('real loopback HTTP requests exercise authenticated routes without external connections',async()=>{
  const http=require('node:http');const {service:s}=setup();
  const server=http.createServer(createHandler(s,{authenticate:async r=>r.headers.authorization==='Synthetic test only'?'test-user':null}));
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const endpoint='http://127.0.0.1:'+server.address().port;
    const unauthorized=await fetch(endpoint+'/mcp',{method:'POST'});assert.equal(unauthorized.status,401);
    const response=await fetch(endpoint+'/mcp',{method:'POST',headers:{authorization:'Synthetic test only','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:5,method:'events/list'})});
    assert.equal((await response.json()).result.events[0].name,'note.completed');
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));s.close();}
});
