import Setting from '../../models/Setting';
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
