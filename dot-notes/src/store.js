'use strict';
const DotStore = (() => {
  const marker = 'dotNotesNotebook.v1';
  class Store {
    constructor(joplin) { this.api = joplin; }
    async localOnly() {
      const [target] = await this.api.settings.globalValues(['sync.target']);
      if (target !== 0 && target !== '0') {
        throw new Error('请在未启用同步的 Joplin 配置中使用。当前配置无法确认仅本地保存，已停止写入。');
      }
    }
    async folder(create = false) {
      const walk = async items => {
        for (const item of items) {
          if (await this.api.data.userDataGet(2, item.id, marker) === true) return item.id;
          const child = await walk(item.children || []);
          if (child) return child;
        }
        return null;
      };
      for (let page = 1; ; page++) {
        const result = await this.api.data.get(['folders'], { fields: ['id'], limit: 100, page });
        const found = await walk(result.items || result);
        if (found) return found;
        if (!result.has_more) break;
      }
      if (!create) return null;
      await this.localOnly();
      const folder = await this.api.data.post(['folders'], null, { title: 'Dot Notes · 本地记事' });
      await this.api.data.userDataSet(2, folder.id, marker, true);
      return folder.id;
    }
    async list() {
      const folderId = await this.folder();
      if (!folderId) return [];
      const all = [];
      for (let page = 1; ; page++) {
        const result = await this.api.data.get(['folders', folderId, 'notes'], {
          fields: ['id', 'title', 'updated_time', 'deleted_time'], limit: 100, page,
          order_by: 'updated_time', order_dir: 'DESC'
        });
        all.push(...result.items.filter(n => !n.deleted_time));
        if (!result.has_more) return all;
      }
    }
    async create() {
      await this.localOnly();
      const parent_id = await this.folder(true);
      const note = await this.api.data.post(['notes'], null, { parent_id, title: '', body: '', markup_language: 1 });
      return this.read(note.id);
    }
    async read(noteId) {
      DotCore.id(noteId);
      const note = await this.api.data.get(['notes', noteId], {
        fields: ['id', 'title', 'body', 'parent_id', 'deleted_time', 'is_conflict', 'markup_language']
      });
      if (note.parent_id !== await this.folder() || note.deleted_time || note.is_conflict || note.markup_language !== 1) {
        throw new Error('此笔记不在本地记事本中，或已删除/存在冲突；不会修改。');
      }
      return note;
    }
    async write(noteId, draft) {
      await this.localOnly();
      await this.read(noteId);
      return this.api.data.put(['notes', noteId], null, { title: draft.title, body: draft.body });
    }
    async readJournal(noteId) {
      return this.api.data.userDataGet(1, noteId, DotCore.JOURNAL_KEY);
    }
    async writeJournal(noteId, state) {
      await this.localOnly();
      await this.read(noteId);
      return this.api.data.userDataSet(1, noteId, DotCore.JOURNAL_KEY, state);
    }
  }
  return { Store };
})();
if (typeof module !== 'undefined') module.exports = DotStore;
