'use strict';
const https = require('node:https');
const dns = require('node:dns/promises');
const net = require('node:net');
const { createHmac } = require('node:crypto');
function decodeSecret(secret) {
  if (typeof secret !== 'string' || !/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)) throw Error('Invalid signing secret');
  const key = Buffer.from(secret.slice(6), 'base64');
  if (key.length < 24 || key.length > 64 || key.toString('base64') !== secret.slice(6)) throw Error('Invalid signing secret');
  return key;
}
function headers(id, body, sub, now) {
  const timestamp = String(Math.floor(now / 1000));
  const sign = secret => 'v1,' + createHmac('sha256', decodeSecret(secret)).update(id + '.' + timestamp + '.' + body).digest('base64');
  return { 'Content-Type': 'application/json', 'webhook-id': id, 'webhook-timestamp': timestamp,
    'webhook-signature': [sign(sub.secret), ...(sub.oldSecret && sub.rotateUntil > now ? [sign(sub.oldSecret)] : [])].join(' '),
    'X-MCP-Subscription-Id': sub.id };
}
function publicV4(ip) {
  if (net.isIP(ip) !== 4) return false; // IPv6 deliberately unsupported until equivalent address classification is verified.
  const [a,b,c] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
function callbackURL(value, allowedHosts) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.hash || (u.port && u.port !== '443') ||
      net.isIP(u.hostname) || !allowedHosts.includes(u.hostname)) throw Error('Callback host is not approved');
  return u;
}
function createSender(allowedHosts = [], resolve = dns.lookup, request = https.request) {
  return async (url, body, hdrs) => {
    const u = callbackURL(url, allowedHosts);
    if (Buffer.byteLength(body) > 262144) throw Error('Event too large');
    let dnsTimer;
    const addresses = await Promise.race([
      resolve(u.hostname, { all: true, family: 4 }),
      new Promise((_, reject) => { dnsTimer = setTimeout(() => reject(Error('timeout')), 5000); }),
    ]).finally(() => clearTimeout(dnsTimer));
    if (!addresses.length || addresses.some(x => !publicV4(x.address))) throw Error('Non-public callback address');
    const address = addresses[0].address;
    return new Promise((resolveResult, reject) => {
      const req = request(u, { method: 'POST', agent: false, servername: u.hostname, headers: hdrs,
        // Pin this connection to the address just checked; retain URL hostname for TLS verification.
        lookup: (_host, options, cb) => options.all ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4),
      }, res => {
        let text = ''; res.setEncoding('utf8');
        res.on('data', chunk => { text += chunk; if (Buffer.byteLength(text) > 16384) req.destroy(Error('Callback response too large')); });
        res.on('error', reject);
        res.on('end', () => resolveResult({ status: res.statusCode, body: text }));
      });
      const timer = setTimeout(() => req.destroy(Error('timeout')), 10000);
      req.on('close', () => clearTimeout(timer)); req.on('error', reject); req.end(body);
      // Redirects are returned as 3xx, never followed.
    });
  };
}
module.exports = { decodeSecret, headers, publicV4, callbackURL, createSender };
