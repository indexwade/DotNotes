'use strict';
// Runs our panel in an installed headless browser with a temporary SQLite contract harness.
// This is not Joplin, Android, or macOS runtime verification. Test data only; loopback only.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { harness } = require('../test/harness.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'verification'); fs.mkdirSync(output, { recursive: true });
const h = harness();
const src = name => fs.readFileSync(path.join(root, 'src', name));
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/rpc' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 1000000) throw Error('too large'); }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await h.controller(JSON.parse(body)))); return;
    }
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/panel.css"><body><div style="padding:6px;background:#fff2dc;color:#743f00;font:12px sans-serif">界面验证 · 临时测试数据库 · 非 Joplin 实机</div>' + src('panel.html') + '<script>window.webviewApi={postMessage:async message=>(await fetch("/rpc",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(message)})).json()}</script><script src="/panel.js"></script></body></html>'); return;
    }
    if (['/panel.js', '/panel.css'].includes(req.url)) {
      res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
      res.end(src(req.url.slice(1))); return;
    }
    res.writeHead(404).end();
  } catch (_) { res.writeHead(500).end('test harness failure'); }
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, label) {
  for (let i = 0; i < 400; i++) { if (await fn()) return; await sleep(50); }
  throw new Error('Timed out: ' + label);
}
let browser, socket;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const executable = process.env.DOT_NOTES_TEST_BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dot-notes-browser-'));
  browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--disable-sync', '--disable-component-update', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let browserLog = '';
  browser.stderr.on('data', data => { browserLog += data; fs.writeFileSync(path.join(output, 'browser.log'), browserLog); });
  browser.on('error', e => { console.error(e.message); });
  const portFile = path.join(profile, 'DevToolsActivePort');
  await waitFor(() => fs.existsSync(portFile), 'browser startup');
  const [port, endpoint] = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
  socket = new WebSocket('ws://127.0.0.1:' + port + endpoint);
  await new Promise((r, reject) => { socket.onopen = r; socket.onerror = reject; });
  let nextId = 0; const pending = new Map();
  socket.onmessage = message => {
    const data = JSON.parse(message.data); const p = pending.get(data.id);
    if (p) { pending.delete(data.id); data.error ? p.reject(new Error(JSON.stringify(data.error))) : p.resolve(data.result); }
  };
  function cdp(method, params = {}, sessionId) {
    const id = ++nextId;
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId })); });
  }
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const command = (method, params) => cdp(method, params, sessionId);
  const evaluate = async expression => {
    const r = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const loaded = () => evaluate('document.getElementById("new") !== null');
  await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1080, height: 850, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port });
  await waitFor(loaded, 'page');
  await evaluate('document.getElementById("new").click()');
  await waitFor(() => evaluate('!document.getElementById("editor").hidden && !document.getElementById("title").disabled'), 'new note');
  await evaluate('document.getElementById("title").value="一个可以慢慢完成的想法";document.getElementById("title").dispatchEvent(new Event("input"));document.getElementById("body").value="今天想记下的事：\\n\\n让记录保持简单。离线时安心写，写完后再决定交给 dot。\\n\\n<script>window.injected=true</script>";document.getElementById("body").dispatchEvent(new Event("input"))');
  await waitFor(async () => (await h.store.list()).length === 1 && (await h.store.read((await h.store.list())[0].id)).body.includes('window.injected'), 'autosave');
  assert.equal(await evaluate('window.injected === true'), false);
  await evaluate('document.getElementById("send").click()');
  await waitFor(() => evaluate('document.getElementById("records").textContent.includes("未连接")'), 'honest send state');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  let shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(path.join(output, 'desktop.png'), Buffer.from(shot.data, 'base64'));
  h.options.failWrite = true;
  await evaluate('document.getElementById("body").value="保存失败也要保留这段文字";document.getElementById("body").dispatchEvent(new Event("input"))');
  await waitFor(() => evaluate('!document.getElementById("error").hidden'), 'save failure');
  await evaluate('document.getElementById("new").click()');
  await sleep(200);
  assert.equal(await evaluate('document.getElementById("body").value'), '保存失败也要保留这段文字');
  assert.equal((await h.store.list()).length, 1);
  h.options.failWrite = false;
  await evaluate('document.getElementById("save").click()');
  await waitFor(async () => (await h.store.read((await h.store.list())[0].id)).body === '保存失败也要保留这段文字', 'save retry');
  await command('Page.reload', {}); await waitFor(loaded, 'reload');
  await waitFor(() => evaluate('document.querySelector("#list button") !== null'), 'restored list');
  await evaluate('document.querySelector("#list button").click()');
  await waitFor(() => evaluate('document.getElementById("body").value === "保存失败也要保留这段文字"'), 'restored note');
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await waitFor(() => evaluate('innerWidth === 390'), 'mobile viewport');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(path.join(output, 'mobile.png'), Buffer.from(shot.data, 'base64'));
  const report = { result: 'passed', environment: 'Chrome headless on Windows; temporary SQLite API-contract harness, not Joplin', checks: ['new note', 'Chinese multiline autosave', 'HTML kept as text', 'disconnected send state', 'save failure preserves draft and blocks switch', 'manual save retry', 'reload recovery', '1080px and 390px no horizontal overflow'], screenshots: ['desktop.png', 'mobile.png'] };
  fs.writeFileSync(path.join(output, 'ui-results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  await cdp('Browser.close');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => {
  if (socket) socket.close();
  if (browser && browser.exitCode === null) browser.kill();
  server.close(); h.db.close();
});
