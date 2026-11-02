'use strict';
// No downloaded build tool or install script: concatenate our JS, package with system tar.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const release = path.join(root, 'release');
fs.mkdirSync(dist, { recursive: true }); fs.mkdirSync(release, { recursive: true });
const read = name => fs.readFileSync(path.join(root, 'src', name), 'utf8');
const source = '(function(){\n' + ['core.js', 'store.js', 'host.js'].map(read).join('\n') +
  '\nconst PANEL_HTML = ' + JSON.stringify(read('panel.html')) + ';\n' + read('register.js') + '\n})();\n';
new (require('node:vm').Script)(source);
fs.writeFileSync(path.join(dist, 'index.js'), source);
for (const name of ['manifest.json', 'panel.css', 'panel.js']) fs.copyFileSync(path.join(root, 'src', name), path.join(dist, name));
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(dist, 'LICENSE'));
const files = ['index.js', 'manifest.json', 'panel.css', 'panel.js', 'LICENSE'];
const target = path.join(release, 'dot-notes-0.1.0.jpl');
execFileSync('tar', ['-cf', target, '-C', dist, ...files]);
const listing = execFileSync('tar', ['-tf', target], { encoding: 'utf8' }).trim().split(/\r?\n/);
if (JSON.stringify(listing) !== JSON.stringify(files)) throw new Error('Archive contents mismatch');
const hash = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
fs.writeFileSync(path.join(release, 'SHA256SUMS.txt'), hash + '  dot-notes-0.1.0.jpl\n');
console.log(JSON.stringify({ archive: target, bytes: fs.statSync(target).size, sha256: hash, files }));
