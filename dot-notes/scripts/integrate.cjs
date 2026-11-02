'use strict';
// Applies only to our dedicated pinned checkout. No dependency scripts run.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..', 'upstream-joplin');
const expected = 'e41516e669efb693b009bedb21f3eb1fcbea4fc9';
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !== expected) throw Error('Unexpected upstream commit');
function edit(file, before, after) {
  const target = path.join(root, file), source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  if (source.includes(after)) return;
  if (source.split(before).length !== 2) throw Error('Anchor mismatch: ' + file);
  fs.writeFileSync(target, source.replace(before, after));
}
const helper = `import Setting from '../../models/Setting';
import shim from '../../shim';
import PluginService, { PluginSettings } from './PluginService';
const assets: Record<string, string> = require('./dotNotesAssets.json');

// Embedded application feature: no plugin download or network access.
export default async function loadDotNotes(service: PluginService, settings: PluginSettings) {
  if (Setting.value('isSafeMode') || service.isPluginLoaded('local.dotnotes.notebook')) return;
  const dir = Setting.value('cacheDir') + '/dot-notes-builtin-v1';
  const driver = shim.fsDriver();
  await driver.mkdir(dir);
  // Finish every write before exposing the bundle to the runner.
  for (const [name, contents] of Object.entries(assets)) {
    await driver.writeFile(dir + '/' + name, contents, 'utf8');
  }
  await service.loadAndRunPlugins([dir], settings, { builtIn: true, devMode: false });
  if (!service.isPluginLoaded('local.dotnotes.notebook')) throw new Error('Dot Notes failed to load');
}
`;
const base = 'packages/lib/services/plugins/';
fs.writeFileSync(path.join(root, base, 'loadDotNotes.ts'), helper);
const assets = {};
for (const name of ['index.js', 'manifest.json', 'panel.js', 'panel.css', 'LICENSE']) assets[name] = fs.readFileSync(path.join(__dirname, '../dist', name), 'utf8');
fs.writeFileSync(path.join(root, base, 'dotNotesAssets.json'), JSON.stringify(assets, null, 2) + '\n');
edit(base + 'loadPlugins.ts', "const logger = Logger.create('loadPlugins');", "import loadDotNotes from './loadDotNotes';\n\nconst logger = Logger.create('loadPlugins');");
if (!fs.readFileSync(path.join(root, base, 'loadPlugins.ts'), 'utf8').includes('await loadDotNotes(pluginService, pluginSettings)')) edit(base + 'loadPlugins.ts', '\t\tawait pluginService.loadAndRunDevPlugins(pluginSettings);', '\t\tawait loadDotNotes(pluginService, pluginSettings);\n\t\tawait pluginService.loadAndRunDevPlugins(pluginSettings);');
edit(base + 'loadPlugins.ts', '\t\tawait loadDotNotes(pluginService, pluginSettings);', '\t\tawait loadDotNotes(pluginService, pluginSettings);\n\t\tif (!Setting.value("isSafeMode") && pluginService.isPluginLoaded("local.dotnotes.notebook")) {\n\t\t\tstore.dispatch({ type: "SET_PLUGIN_PANELS_DIALOG_VISIBLE", visible: true });\n\t\t}');
edit('packages/app-desktop/app.ts', "import { afterDefaultPluginsLoaded, loadAndRunDefaultPlugins }", "import loadDotNotes from '@joplin/lib/services/plugins/loadDotNotes';\nimport { afterDefaultPluginsLoaded, loadAndRunDefaultPlugins }");
edit('packages/app-desktop/app.ts', '\t\t// As of Joplin 3.5.7', '\t\tawait loadDotNotes(service, pluginSettings);\n\n\t\t// As of Joplin 3.5.7');
edit('packages/lib/getAppName.ts', "isDev ? 'joplindev' : 'joplin'", "isDev ? 'dotnotesdev' : 'dotnotes'");
edit('packages/lib/models/settings/builtInMetadata.ts', "'plugins.pluginSupportEnabled': {\n\t\t\tvalue: false,", "'plugins.pluginSupportEnabled': {\n\t\t\tvalue: true,");
edit('packages/app-mobile/android/app/build.gradle', 'applicationId "net.cozic.joplin"', 'applicationId "local.dotnotes.app"');
edit('packages/app-mobile/android/app/build.gradle', 'abiFilters "armeabi-v7a", "x86", "arm64-v8a", "x86_64"', 'abiFilters = (findProperty("reactNativeArchitectures") ?: "armeabi-v7a,arm64-v8a,x86,x86_64").split(",") as Set');
edit('packages/app-mobile/android/app/build.gradle', '    defaultConfig {', '    defaultConfig {\n        manifestPlaceholders = [usesCleartextTraffic: "false"]');
if (!fs.readFileSync(path.join(root, 'packages/app-mobile/android/app/build.gradle'), 'utf8').includes('tasks.withType(com.facebook.react.tasks.BundleHermesCTask)')) edit('packages/app-mobile/android/app/build.gradle', 'def enableMinifyInReleaseBuilds =', 'tasks.withType(com.facebook.react.tasks.BundleHermesCTask).configureEach {\n    // Embedded resources live outside the mobile project; include them in the bundle cache key.\n    inputs.files(new File(projectRoot, "../lib/services/plugins/dotNotesAssets.json"), new File(projectRoot, "../lib/services/plugins/loadDotNotes.js"))\n}\n\ndef enableMinifyInReleaseBuilds =');
edit('packages/app-mobile/android/app/build.gradle', 'new File(projectRoot, "../lib/services/plugins/loadDotNotes.js"))', 'new File(projectRoot, "../lib/services/plugins/loadDotNotes.js"), new File(projectRoot, "../lib/services/plugins/loadPlugins.js"))');
edit('packages/app-mobile/android/app/build.gradle', '\tautolinkLibrariesWithApp()', '\t// Windows RN Gradle uses a relative entry, but Expo resolves it from the workspace root.\n\textraPackagerArgs = ["--entry-file", new File(projectRoot, "index.js").getAbsolutePath(), "--max-workers", "2"]\n\tautolinkLibrariesWithApp()');
edit('packages/app-mobile/android/app/src/main/res/values/strings.xml', '>Joplin</string>', '>Dot Notes</string>');
edit('packages/app-mobile/android/app/src/main/AndroidManifest.xml', 'android:scheme="joplin"', 'android:scheme="dotnotes"');
const pkgPath = path.join(root, 'packages/app-desktop/package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.build.appId = 'local.dotnotes.desktop'; pkg.build.productName = 'Dot Notes';
pkg.build.mac.icon = 'dot-notes.icns';
delete pkg.build.afterSign; // No inherited notarization credentials or Joplin identity.
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
edit('packages/app-mobile/android/app/src/main/AndroidManifest.xml', 'android:icon="@mipmap/ic_launcher"', 'android:icon="@drawable/dot_notes_icon"');
edit('packages/app-mobile/android/app/src/main/AndroidManifest.xml', 'android:roundIcon="@mipmap/ic_launcher_round"', 'android:roundIcon="@drawable/dot_notes_icon"');
const drawable = path.join(root, 'packages/app-mobile/android/app/src/main/res/drawable');
fs.mkdirSync(drawable, { recursive: true });
fs.writeFileSync(path.join(drawable, 'dot_notes_icon.xml'), '<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108"><path android:fillColor="#315E56" android:pathData="M0,0h108v108h-108z"/><path android:fillColor="#FFFFFF" android:pathData="M30,24h48v60h-48z"/><path android:strokeColor="#315E56" android:strokeWidth="4" android:pathData="M39,40h30M39,52h30M39,64h21"/></vector>\n');
// Original simple notebook icon. ICNS embeds a standard 256px PNG, no external tool.
const zlib = require('node:zlib');
const crc = b => { let c = 0xffffffff; for (const x of b) { c ^= x; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const t = Buffer.from(type), n = Buffer.alloc(4), sum = Buffer.alloc(4); n.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([n, t, data, sum]); }
const raw = Buffer.alloc(256 * (1 + 256 * 4));
for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
  const paper = x >= 71 && x < 185 && y >= 57 && y < 199;
  const line = x >= 92 && x < (y > 145 ? 142 : 164) && [95,123,151].some(v => y >= v && y < v + 9);
  const color = paper && !line ? [255,255,255,255] : [49,94,86,255];
  Buffer.from(color).copy(raw, y * 1025 + 1 + x * 4);
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(256); ihdr.writeUInt32BE(256,4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'), chunk('IHDR',ihdr), chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
const header = Buffer.alloc(16); header.write('icns'); header.writeUInt32BE(png.length+16,4); header.write('ic08',8); header.writeUInt32BE(png.length+8,12);
fs.writeFileSync(path.join(root,'packages/app-desktop/dot-notes.icns'),Buffer.concat([header,png]));
// Replace packaged Android launcher bitmaps too: unused resources can still enter APKs.
const res = path.join(root, 'packages/app-mobile/android/app/src/main/res');
for (const folder of fs.readdirSync(res)) {
  const dir = path.join(res, folder);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const file of fs.readdirSync(dir)) if (/^ic_launcher.*\.png$/.test(file)) fs.writeFileSync(path.join(dir,file),png);
}
// Keep the optional sync provider label, but do not redistribute its reserved logo.
fs.writeFileSync(path.join(root, 'packages/app-mobile/components/SyncWizard/JoplinCloudIcon.tsx'), `import * as React from 'react';
import Svg, { SvgProps, Path } from 'react-native-svg';

// Original generic cloud illustration for the derivative app.
const JoplinCloudIcon: React.FC<SvgProps> = props => <Svg viewBox='0 0 84 84' {...props}>
  <Path fill='#315E56' d='M20 62C1 62 1 35 20 34C24 9 59 9 64 34C85 35 84 62 64 62Z'/>
</Svg>;
export default JoplinCloudIcon;
`);
console.log('Standalone source integration applied to pinned checkout. Native build and branding audit still required.');
