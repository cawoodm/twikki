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
export default function (tw) {
  const name = 'core.store';
  const version = '0.2.0';
  const platform = '0.28.0'; // built for platform ^0.28.0

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
    // Wipe a whole workspace's keys (delegated to the backend, which may drop a
    // whole object store / folder rather than iterate). Stays inside `/ws/`.
    clearWorkspace(workspace) {
      return tw.storage.clearWorkspace(workspace);
    },
    // Cross-workspace ("global") keys — the workspace list, current workspace,
    // user settings, secrets, baseUrl. They live under the `/ws/` ROOT (a single
    // segment, e.g. `/ws/settings.json`) so EVERY persisted key is `/ws/`-prefixed
    // and a backend that migrates `/ws/*` (FileSystemStoragePlugin) carries them
    // too. `/ws/<name>/<key>` (two+ segments) is workspace-scoped data.
    global: {
      get(key) {
        return tw.storage.get(globalKey(key));
      },
      set(key, value) {
        return tw.storage.set(globalKey(key), value);
      },
    },
  };

  // Exports
  const exports = {
    save,
    autoSave,
    saveAll,
    saveVisible,
    loadStore,
    tiddlersToSave,
  };

  Object.assign(tw.run, {
    save,
    autoSave,
    saveAll,
    saveVisible,
  });

  // Settings this module owns. The platform registers these into the settings
  // registry and deep-merges the defaults into $Settings on every run, so the
  // default + metadata live with the code that uses them. See docs/SETTINGS.md.
  const settings = {
    'data.autoSave': {
      default: true,
      type: 'boolean',
      description: 'Automatically save changes to local storage',
    },
  };

  return {name, version, platform, exports, settings};

  function prefix() {
    return '/ws/' + (tw.workspace || 'default') + '/';
  }
  function fullKey(key) {
    if (key[0] !== '/') key = '/' + key;
    return '/ws/' + (tw.workspace || 'default') + key;
  }
  // A global key sits directly under `/ws/` (one segment, no workspace name):
  // `workspaces` → `/ws/workspaces`, `/settings.json` → `/ws/settings.json`.
  function globalKey(key) {
    return '/ws/' + String(key).replace(/^\//, '');
  }

  /* Persisting tw.tiddlers */
  function isAutoSave() {
    return tw.core.common.getSetting('data.autoSave', true) !== false;
  }
  // autoSave() — persist ONLY if the user has Auto Save on. For automatic,
  // opt-out-able saves (a normal edit, delete, trash op, import).
  function autoSave() {
    if (!isAutoSave()) return;
    saveAll();
  }
  // save() — ALWAYS persist, ignoring the Auto Save setting. For
  // "we really need this on disk": before a reboot, a restore, a settings
  // change.
  function save() {
    saveAll();
  }
  function saveAll() {
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
    // Shed the legacy single-slot backup. saveAll() used to write a full copy of
    // the tiddler array to `tiddlers-backup1` on every save; nothing ever read it
    // and on the File System backend it bloated `_meta.json` with a whole-wiki
    // duplicate rewritten on each save. Drop any lingering key once on load.
    if (store.get('tiddlers-backup1') != null) store.delete?.('tiddlers-backup1');
    tw.tiddlers.all = storeLoadTiddlers('tiddlers');
    tw.shadowTiddlers.filter(t => !tw.util.tiddlerExists(t.title)).forEach(t => tw.run.addTiddlerHard(t));
    if (!tw.tiddlers.all.length) {
      tw.tiddlers.all = [];
      store.set('tiddlers', []);
    }
    tw.tiddlers.visible = store.get('tiddlers-visible')?.length ? store.get('tiddlers-visible') : [];

    tw.tiddlers.trashed = storeLoadTiddlers('tiddlers-trashed', false);

    function storeLoadTiddlers(key, validate = true) {
      let result = store.get(key) || [];
      result.forEach(t => {
        if (validate && !tiddlerIsValid(t)) return;
        // created falls back to the stable `updated` (not the wall clock) so a
        // tiddler that was stored without a `created` resolves to the same value
        // on every client — preventing per-boot `created` churn in synced repos.
        t.created = new Date(t.created || t.updated || new Date());
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
}
