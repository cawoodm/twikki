# Boot Script

A **boot script** is a single piece of JavaScript the platform evaluates **before `tw.storage` is initialised** — the earliest customization hook in the boot process. It exists so you can change how TWikki stores data (or otherwise prepare `tw`) before any module, package, or plugin reads or writes a single key.

The whole mechanism is `runBootScript()` in [src/platform/twikki.platform.js](../src/platform/twikki.platform.js) (~line 370), called from `init()` right before the default storage backing is set up:

```js
await runBootScript(tw);
if (!tw.storage) tw.storage = initLocalStorage(); // fallback if the script didn't set one
```

## The contract

- The source is stored in `localStorage` under the key **`/twikki.boot.js`**.
- It **must evaluate to a function** — keep the whole file as a single parenthesised function expression. The platform does `const fn = (1, eval)(src)` (indirect eval, global scope) and then `fn(tw)`.
- The function receives `tw` and may mutate it. It can be **sync or async**: if it returns a promise, the platform `await`s it before continuing.
- Its most common job is to **assign `tw.storage`** — a custom backend exposing the same interface as the built-in `initLocalStorage()`:

  | Method                             | Contract                                                         |
  | ---------------------------------- | ---------------------------------------------------------------- |
  | `get(key)`                         | Return the value; JSON-parse strings that start with `[` or `{`. |
  | `set(key, value)`                  | Stringify objects; store the raw string.                         |
  | `remove(key)`                      | Delete the key.                                                  |
  | `keys(prefix)`                     | Return all keys starting with `prefix`.                          |
  | `getRaw(key)` / `setRaw(key, raw)` | Read/write the raw string without JSON coercion.                 |

  Keys missing a leading `/` are auto-prefixed with one (`ensureSlash`).

## Failure handling

If the script fails to parse, throws, or rejects, `runBootScript` catches it, logs it, `alert()`s the user once, and continues with the default `localStorage` backing:

```js
try {
  const fn = (1, eval)(src);
  const result = fn(tw);
  if (result && typeof result.then === 'function') await result;
} catch (e) {
  console.error('twikki.boot.js failed:', e);
  alert(`Pre-boot script failed:\n\n${e.message}\n\nProceeding without it.`);
}
```

**A broken boot script can never brick the app** — worst case you fall back to `localStorage`.

## Scope, install, uninstall

- **Scope is global per origin.** The boot script lives in `localStorage`, which is shared across workspaces, so installing one reroutes storage for **every** workspace on the device.
- **Install:** write the source string to `localStorage['/twikki.boot.js']` and reload. The platform picks it up on the next boot.
- **Uninstall:** delete `/twikki.boot.js` from `localStorage` and reload. Note that any data written to the custom backend since install lives **only** there — export it first or it will appear lost when you fall back to `localStorage`.

## Worked example: IndexedDB-backed storage

The base **IndexedDBStorage** plugin (`src/packages/base/IndexedDBStorage/`) ships exactly this pattern. Its boot script opens IndexedDB, hydrates an in-memory `Map` so reads stay synchronous, one-shot-migrates existing keys out of `localStorage`, and assigns an IDB-backed `tw.storage`:

```js
// /twikki.boot.js — evaluates to a function; the platform awaits its promise
(async function (tw) {
  if (!window.indexedDB) throw new Error('No IndexedDB available in your browser!'); // platform falls back to initLocalStorage()

  const DB = 'twikki',
    STORE = 'kv',
    SENTINEL = '/_meta/migrated';
  const map = new Map();

  // Open the database (create the object store on first run).
  const db = await new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE, {keyPath: 'k'});
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IDB open failed'));
  });

  // Hydrate the in-memory snapshot so get()/keys() can stay synchronous.
  await new Promise((resolve, reject) => {
    const cursor = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
    cursor.onsuccess = e => {
      const c = e.target.result;
      if (c) {
        map.set(c.value.k, c.value.v);
        c.continue();
      } else resolve();
    };
    cursor.onerror = () => reject(cursor.error);
  });

  // First install: copy existing localStorage keys into IDB (skip the boot
  // script itself and the platform's /modules/* cache), then drop a sentinel.
  if (!map.has(SENTINEL)) {
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k === '/twikki.boot.js' || k.startsWith('/modules/')) continue;
      const v = window.localStorage.getItem(k);
      map.set(k, v);
      store.put({k, v});
    }
    const now = new Date().toISOString();
    map.set(SENTINEL, now);
    store.put({k: SENTINEL, v: now});
  }

  const ensureSlash = k => (k[0] === '/' ? k : '/' + k);
  const idbPut = (k, v) => {
    try {
      db.transaction(STORE, 'readwrite').objectStore(STORE).put({k, v});
    } catch (e) {
      console.warn('IDB put failed', k, e);
    }
  };
  const idbDelete = k => {
    try {
      db.transaction(STORE, 'readwrite').objectStore(STORE).delete(k);
    } catch (e) {
      console.warn('IDB delete failed', k, e);
    }
  };

  // Reads hit the Map (sync); writes update the Map and fire-and-forget to IDB.
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
```

Notes on this implementation:

- **The platform's module cache (`/modules/*`) stays in `localStorage` by design** — only the workspace data layer (`/ws/*` and `tw.store` globals) routes through IDB.
- **Reads are synchronous** because everything is mirrored in `map`; only writes touch IDB, asynchronously and fire-and-forget. Transient IDB errors funnel into `console.warn` and never break the session.
- The `SENTINEL` (`/_meta/migrated`) makes migration a one-shot — subsequent boots skip it.

## Related

- [BOOT.md](./BOOT.md) — the full boot timeline; the boot script runs inside `init()`, before everything in that document.
- [MODULES.md](./MODULES.md) — the module cache (`/modules/*`) the boot script deliberately leaves in `localStorage`.
- `src/packages/base/IndexedDBStorage/` — the installable plugin that wraps this boot script with an install button and tests.
