/* global joplin, PANEL_HTML, createController */
joplin.plugins.register({
  onStart: async function () {
    const panels = joplin.views.panels;
    const panel = await panels.create('dotNotes');
    await panels.onMessage(panel, createController(joplin));
    await panels.setHtml(panel, PANEL_HTML);
    await panels.addScript(panel, './panel.css');
    await panels.addScript(panel, './panel.js');
    await joplin.commands.register({ name: 'dotNotesOpen', label: '打开本地记事', iconName: 'fas fa-pen', execute: async () => panels.show(panel) });
    await joplin.views.toolbarButtons.create('dotNotesOpenButton', 'dotNotesOpen', 'editorToolbar');
    await panels.show(panel);
  }
});
