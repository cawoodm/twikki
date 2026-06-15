/**
 * Store
 * The public, workspace-scoped persistence API. Three layers, lowest to highest:
 *
 *   localStorage  ←  tw.storage (platform, raw)  ←  tw.store (this module, scoped)  ←  consumers
 *
 * `tw.store` prefixes every key with the current workspace (`/ws/<name>/`,
 * reading `tw.workspace`, which core.workspaces manages) and adds raw helpers —
 * `keys`/`exportRaw`/`importRaw`/`delete` — so even whole-workspace dump/restore
 * goes through this API. `tw.store.global` reaches the few unscoped keys.
 * Also owns persisting the tiddler store itself: save/saveAll/
 * saveVisible/loadStore and the `doNotSave` policy.
 * Modules and plugins use `tw.store` only — never `tw.storage`/`localStorage`.
 */
(function (tw) {
  const name = 'core.store';
  const version = '0.1.0';
  const platform = '0.26.0'; // built for platform ^0.26.0

  const autoSave = true;

  tw.store = {
    get(key) {
      return tw.storage.get(fullKey(key));
    },
    set(key, value) {
      return tw.storage.set(fullKey(key), value);
    },
    delete(key) {
      return tw.storage.remove(fullKey(key));
    },
    // All keys of the current workspace, prefix-stripped (=> portable).
    keys() {
      const p = prefix();
      return tw.storage.keys(p).map(k => k.slice(p.length));
    },
    // Raw string in/out (no JSON coercion) — for portable dump/restore.
    exportRaw(key) {
      return tw.storage.getRaw(fullKey(key));
    },
    importRaw(key, raw) {
      return tw.storage.setRaw(fullKey(key), raw);
    },
    global: {
      get(key) {
        return tw.storage.get(key);
      },
      set(key, value) {
        return tw.storage.set(key, value);
      },
    },
  };

  // Exports
  const exports = {
    save,
    saveSilent,
    saveAll,
    saveVisible,
    loadStore,
    tiddlersToSave,
  };

  Object.assign(tw.run, {
    save,
    saveAll,
    saveVisible,
  });

  return {name, version, platform, exports};

  function prefix() {
    return '/ws/' + (tw.workspace || 'default') + '/';
  }
  function fullKey(key) {
    if (key[0] !== '/') key = '/' + key;
    return '/ws/' + (tw.workspace || 'default') + key;
  }

  /* Persisting tw.tiddlers */
  function save() {
    if (!autoSave) return;
    saveAll({});
  }
  function saveSilent() {
    if (!autoSave) return;
    saveAll({silent: true});
  }
  function saveAll() {
    const oldTiddlers = tw.store.get('tiddlers');
    // TODO: Better local backups/versioning
    if (oldTiddlers?.length) tw.store.set('tiddlers-backup1', oldTiddlers);
    tw.store.set('tiddlers', tw.tiddlers.all.filter(tiddlersToSave));
    tw.store.set('tiddlers-trashed', tw.tiddlers.trashed);
    saveVisible();
    tw.run.setDirty(false);
  }
  function saveVisible() {
    tw.store.set('tiddlers-visible', tw.tiddlers.visible);
  }
  // The doNotSave policy: shadow/package tiddlers are not persisted until edited.
  function tiddlersToSave(t) {
    return t.doNotSave !== true;
  }

  /* Hydrating tw.tiddlers from the store */
  function loadStore(store) {
    if (!store) store = tw.store;
    tw.tiddlers.all = storeLoadTiddlers('tiddlers');
    tw.shadowTiddlers
      .filter(t => !tw.util.tiddlerExists(t.title))
      .forEach(t => tw.run.addTiddlerHard(t));
    if (!tw.tiddlers.all.length) {
      tw.tiddlers.all = [];
      store.set('tiddlers', []);
    }
    tw.tiddlers.visible = store.get('tiddlers-visible')?.length
      ? store.get('tiddlers-visible')
      : [];

    tw.tiddlers.trashed = storeLoadTiddlers('tiddlers-trashed', false);

    function storeLoadTiddlers(key, validate = true) {
      let result = store.get(key) || [];
      result.forEach(t => {
        if (validate && !tiddlerIsValid(t)) return;
        t.created = new Date(t.created || new Date());
        t.updated = new Date(t.updated || new Date());
      });
      return result.filter(t => !!t.title);
    }
  }
  function tiddlerIsValid(t) {
    let msg = tw.util.tiddlerValidation(t);
    if (msg.length) console.warn('tiddlerValidation', t.title, msg.join('; '));
    return msg.length === 0;
  }
});
