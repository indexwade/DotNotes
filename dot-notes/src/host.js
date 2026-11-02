'use strict';
function createController(api, adapter) {
  const store = new DotStore.Store(api);
  const service = new DotCore.Service(store, adapter);
  return async message => {
    try {
      if (!message || typeof message !== 'object') throw new Error('请求格式无效。');
      let value;
      switch (message.type) {
        case 'list': value = await store.list(); break;
        case 'create': value = await service.run(async () => service.read((await store.create()).id)); break;
        case 'open': value = await service.run(() => service.read(message.id)); break;
        case 'save': value = await service.save(message.id, message.draft, message.base); break;
        case 'complete': value = await service.complete(message.id, message.draft, message.base); break;
        case 'retry': value = await service.retry(message.id, message.version); break;
        default: throw new Error('未知操作。');
      }
      return { ok: true, value };
    } catch (e) {
      // Never log note contents or raw backend errors.
      return { ok: false, error: /[\u4e00-\u9fff]/.test(e.message || '') ? e.message : '本地操作失败；请保留编辑内容后重试。' };
    }
  };
}
if (typeof module !== 'undefined') module.exports = { createController };
