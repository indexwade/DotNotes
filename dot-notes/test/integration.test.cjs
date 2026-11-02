const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '../../upstream-joplin');
const base = path.join(root, 'packages/lib/services/plugins');
function setup(failWrite = false, safeMode = false, loaded = false) {
  const calls = [], files = {};
  const driver = { mkdir: async p => calls.push(['mkdir', p]), writeFile: async (p, s) => {
    if (failWrite) throw Error('disk full'); files[p] = s;
  } };
  const service = { isPluginLoaded: () => loaded, loadAndRunPlugins: async (...args) => { calls.push(['load', ...args]); loaded = true; } };
  let source = fs.readFileSync(path.join(base, 'loadDotNotes.ts'), 'utf8');
  source = source.replace(/^import .*;\r?\n/gm, '').replace('export default ', '');
  source = stripTypeScriptTypes(source) + '\nglobalThis.run = loadDotNotes;';
  const context = { Setting: { value: k => k === 'isSafeMode' ? safeMode : '/isolated/cache' }, shim: { fsDriver: () => driver }, require: () => JSON.parse(fs.readFileSync(path.join(base, 'dotNotesAssets.json'), 'utf8')) };
  vm.runInNewContext(source, context);
  return { run: () => context.run(service, {}), calls, files };
}
test('embedded feature writes complete assets before loading built-in on both entry paths', async () => {
  const s = setup(); await s.run();
  assert.equal(Object.keys(s.files).length, 5);
  assert.equal(s.calls.at(-1)[0], 'load');
  assert.equal(s.calls.at(-1)[3].builtIn, true);
  for (const [file, anchor] of [['packages/app-desktop/app.ts', 'await loadDotNotes(service, pluginSettings)'], ['packages/lib/services/plugins/loadPlugins.ts', 'await loadDotNotes(pluginService, pluginSettings)']]) {
    assert.ok(fs.readFileSync(path.join(root, file), 'utf8').includes(anchor));
  }
});
test('partial asset write fails closed without loading', async () => {
  const s = setup(true); await assert.rejects(s.run(), /disk full/);
  assert.equal(s.calls.filter(c => c[0] === 'load').length, 0);
});
test('safe mode and already loaded feature do not rewrite assets', async () => {
  for (const s of [setup(false, true), setup(false, false, true)]) { await s.run(); assert.equal(s.calls.length, 0); }
});
test('fork uses separate Android ID, desktop ID and profile basename', () => {
  assert.match(fs.readFileSync(path.join(root, 'packages/lib/models/settings/builtInMetadata.ts'), 'utf8'), /'plugins.pluginSupportEnabled':\s*\{\s*value: true/);
  assert.match(fs.readFileSync(path.join(root, 'packages/app-mobile/android/app/build.gradle'), 'utf8'), /applicationId "local.dotnotes.app"/);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'packages/app-desktop/package.json'), 'utf8'));
  assert.equal(pkg.build.appId, 'local.dotnotes.desktop'); assert.equal(pkg.build.afterSign, undefined);
  assert.match(fs.readFileSync(path.join(root, 'packages/lib/getAppName.ts'), 'utf8'), /'dotnotesdev' : 'dotnotes'/);
});
test('embedded feature accepts the actual Android application version', () => {
  const gradle = fs.readFileSync(path.join(root, 'packages/app-mobile/android/app/build.gradle'), 'utf8');
  const actual = gradle.match(/versionName "([\d.]+)"/)[1].split('.').map(Number);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../dist/manifest.json'), 'utf8'));
  // The pinned upstream manifest loader also uses app_min_version on mobile.
  for (const key of ['app_min_version', 'app_min_version_mobile']) {
    const minimum = manifest[key].split('.').map(Number);
    let comparison = 0;
    for (let i = 0; i < 3 && !comparison; i++) comparison = (actual[i] || 0) - (minimum[i] || 0);
    assert.ok(comparison >= 0, `${key} must accept Android ${actual.join('.')}`);
  }
});
