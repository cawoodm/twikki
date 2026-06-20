// Pre-boot script: replaces tw.storage with an IndexedDB-backed wrapper that
// exposes the same interface as initLocalStorage() (get/set/remove/keys/
// getRaw/setRaw, plus auto-prefix on missing leading '/').
//
// Layout: ONE object store per workspace, named `ws_<workspace>`, plus a
// single `_global` store for unscoped keys (`/workspaces`, `/workspace`,
// `/settings.json`, …). Each store's IDB keys are the part AFTER the
// workspace prefix — so `/ws/default/tiddlers` lives in the `ws_default`
// store under IDB key `tiddlers`. The in-memory Map keeps the full prefixed
// keys (`/ws/default/tiddlers`, `/workspaces`) so the sync API stays
// consistent with the localStorage shape callers already know.
//
// Lifecycle:
//   1. Discover existing workspaces by scanning localStorage `/ws/<n>/`
//      prefixes plus the `/workspaces` JSON list. Open IDB with version 1
//      and create `_global` + one store per discovered workspace in
//      `onupgradeneeded`. First-time installs always get a `ws_default`.
//   2. Hydrate the in-memory Map from every store.
//   3. First-install migration: if the `/_meta/migrated` sentinel is absent
//      from `_global`, copy every localStorage key (except `/twikki.boot.js`
//      and `/modules/*`) into the right store, then write the sentinel.
//   4. Install tw.storage. Reads hit the Map; writes update the Map AND
//      fire-and-forget an IDB put, lazily upgrading the DB if the target
//      store doesn't exist yet (a workspace created at runtime).
(async function (tw) {
  if (!window.indexedDB) throw new Error('No IndexedDB available in your browser!');

  const DB = 'twikki';
  const GLOBAL_STORE = '_global';
  const WS_PREFIX = 'ws_';
  const SENTINEL = '/_meta/migrated';
  const map = new Map();
  const existingStores = new Set();
  let db = null;
  let dbVersion = 1;
  // Serialise all upgrade dances through a single promise chain — concurrent
  // ensureStore() calls (e.g. a burst of writes after workspace.create) must
  // not race on db.close() / reopen.
  let pendingDb = Promise.resolve();

  function ensureSlash(k) {
    return k[0] === '/' ? k : '/' + k;
  }
  function routeKey(fullKey) {
    const m = fullKey.match(/^\/ws\/([^/]+)\/(.+)$/);
    if (m) return {store: WS_PREFIX + m[1], key: m[2]};
    return {store: GLOBAL_STORE, key: fullKey};
  }
  function workspaceStoreName(name) {
    return WS_PREFIX + name;
  }

  function openWithStores(version, neededStores) {
    return new Promise((resolve, reject) => {
      const req = window.indexedDB.open(DB, version);
      req.onupgradeneeded = e => {
        const upgrading = e.target.result;
        for (const s of neededStores) {
          if (!upgrading.objectStoreNames.contains(s)) upgrading.createObjectStore(s);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IDB open failed'));
    });
  }

  // First open uses NO version arg: opens the current version if the DB
  // exists (without firing an upgrade), or creates a fresh v1 if it
  // doesn't. The onupgradeneeded handler here only runs on the very first
  // install — that's when we create the initial set of stores.
  function openCurrentOrCreate(initialStores) {
    return new Promise((resolve, reject) => {
      const req = window.indexedDB.open(DB);
      req.onupgradeneeded = e => {
        const upgrading = e.target.result;
        for (const s of initialStores) {
          if (!upgrading.objectStoreNames.contains(s)) upgrading.createObjectStore(s);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IDB open failed'));
    });
  }

  function discoverWorkspaces() {
    const set = new Set(['default']); // every install has at least a default workspace
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      const m = k.match(/^\/ws\/([^/]+)\//);
      if (m) set.add(m[1]);
    }
    try {
      const list = JSON.parse(window.localStorage.getItem('/workspaces') || '[]');
      if (Array.isArray(list)) list.forEach(n => typeof n === 'string' && set.add(n));
    } catch {}
    return [...set];
  }

  // Open at the existing version (or create v1 if the DB is brand new).
  // After this we may still need to add stores for workspaces that have
  // appeared since the DB was last opened — handled by the upgrade below.
  const initialStores = [GLOBAL_STORE, ...discoverWorkspaces().map(workspaceStoreName)];
  db = await openCurrentOrCreate(initialStores);
  dbVersion = db.version;
  for (const s of db.objectStoreNames) existingStores.add(s);
  const missing = initialStores.filter(s => !existingStores.has(s));
  if (missing.length) {
    db.close();
    dbVersion++;
    const wanted = [...existingStores, ...missing];
    db = await openWithStores(dbVersion, wanted);
    dbVersion = db.version;
    for (const s of missing) existingStores.add(s);
  }

  // Hydrate the in-memory Map from every store. Workspace stores reconstruct
  // the full `/ws/<name>/<key>` form; `_global` keys are stored verbatim.
  for (const storeName of existingStores) {
    await new Promise((resolve, reject) => {
      const cursor = db.transaction(storeName, 'readonly').objectStore(storeName).openCursor();
      cursor.onsuccess = e => {
        const c = e.target.result;
        if (!c) return resolve();
        const fullKey =
          storeName === GLOBAL_STORE
            ? c.key
            : `/ws/${storeName.slice(WS_PREFIX.length)}/${c.key}`;
        map.set(fullKey, c.value);
        c.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
  }

  // First-install migration (only when the sentinel is missing).
  if (!map.has(SENTINEL)) {
    // Group writes by destination store; ensure each store exists before its
    // transaction (workspace data found in LS for a workspace we somehow
    // didn't discover above shouldn't crash the boot).
    const byStore = new Map();
    for (let i = 0; i < window.localStorage.length; i++) {
      const fullKey = window.localStorage.key(i);
      if (fullKey === '/twikki.boot.js' || fullKey.startsWith('/modules/')) continue;
      const value = window.localStorage.getItem(fullKey);
      map.set(fullKey, value);
      const {store, key} = routeKey(fullKey);
      if (!byStore.has(store)) byStore.set(store, []);
      byStore.get(store).push({key, value});
    }
    const now = new Date().toISOString();
    map.set(SENTINEL, now);
    if (!byStore.has(GLOBAL_STORE)) byStore.set(GLOBAL_STORE, []);
    byStore.get(GLOBAL_STORE).push({key: SENTINEL, value: now});

    for (const [storeName, entries] of byStore) {
      await ensureStore(storeName);
      await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const objStore = tx.objectStore(storeName);
        for (const {key, value} of entries) objStore.put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  }

  // Ensure a store exists, bumping the DB version if necessary. All callers
  // share the pendingDb chain so concurrent ensureStore() calls serialize.
  function ensureStore(storeName) {
    pendingDb = pendingDb.then(async () => {
      if (existingStores.has(storeName)) return;
      db.close();
      dbVersion++;
      const wanted = [...existingStores, storeName];
      db = await openWithStores(dbVersion, wanted);
      dbVersion = db.version;
      existingStores.add(storeName);
    });
    return pendingDb;
  }

  function idbPut(fullKey, value) {
    const {store, key} = routeKey(fullKey);
    ensureStore(store)
      .then(() => {
        try {
          db.transaction(store, 'readwrite').objectStore(store).put(value, key);
        } catch (e) {
          console.warn('IDB put failed', fullKey, e);
        }
      })
      .catch(e => console.warn('IDB ensureStore failed', store, e));
  }
  function idbDelete(fullKey) {
    const {store, key} = routeKey(fullKey);
    if (!existingStores.has(store)) return; // nothing persisted there yet
    try {
      db.transaction(store, 'readwrite').objectStore(store).delete(key);
    } catch (e) {
      console.warn('IDB delete failed', fullKey, e);
    }
  }

  tw.storage = {
    get(key) {
      key = ensureSlash(key);
      const raw = map.get(key);
      if (raw === undefined || raw === null) return raw;
      if (typeof raw === 'string' && /^[\[\{]/.test(raw)) return JSON.parse(raw);
      return raw;
    },
    set(key, value) {
      key = ensureSlash(key);
      const raw = typeof value === 'object' ? JSON.stringify(value) : String(value);
      map.set(key, raw);
      idbPut(key, raw);
    },
    remove(key) {
      key = ensureSlash(key);
      map.delete(key);
      idbDelete(key);
    },
    keys(prefix) {
      return [...map.keys()].filter(k => k.startsWith(prefix));
    },
    getRaw(key) {
      key = ensureSlash(key);
      return map.has(key) ? map.get(key) : null;
    },
    setRaw(key, raw) {
      key = ensureSlash(key);
      map.set(key, raw);
      idbPut(key, raw);
    },
  };
});
