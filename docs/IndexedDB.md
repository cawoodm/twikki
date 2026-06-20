# IndexedDB Storage

The base [`IndexedDBStoragePlugin`](../src/packages/base/IndexedDBStoragePlugin/) routes `tw.storage` through IndexedDB by installing a pre-boot script (see [BootScript.md](./BootScript.md) for the platform-level hook). Once installed, every workspace on this origin reads and writes through IDB instead of localStorage. This document is about the data lifecycle: how it migrates **in** from localStorage, how the schema evolves as workspaces come and go, and how to migrate **out** if you ever need to.

## Schema at a glance

One IndexedDB database, **`twikki`**, holding one object store per workspace plus one for unscoped data:

| Object store      | Holds                                                              | IDB keys                  |
| ----------------- | ------------------------------------------------------------------ | ------------------------- |
| `_global`         | Everything not under `/ws/…/`: the workspace list, `$Theme`, `$Layout`, settings, the migration sentinel | Full key (e.g. `/workspaces`, `/_meta/migrated`) |
| `ws_<workspace>`  | One store per workspace, holding that workspace's tiddlers, visibility, trash | Key with the `/ws/<name>/` prefix stripped (e.g. `tiddlers`, `tiddlers-visible`) |

Two things stay in `localStorage` **on purpose** and are never copied to IDB:

- **`/twikki.boot.js`** — the boot script itself. The platform reads it from localStorage on every boot, before `tw.storage` exists; routing it through `tw.storage` would create a chicken-and-egg.
- **`/modules/*`** — the platform's core-module cache. Modules need to load before any plugin, including this one, runs.

The in-memory layer (`Map<string,string>`) the boot script keeps alive holds the **full prefixed form** (`/ws/foo/tiddlers`, `/workspaces`). The store/key split is only at the IDB boundary, so callers of `tw.storage.get/set` never see it.

## localStorage → IndexedDB (one-shot, on first install)

On every boot, the boot script checks for a sentinel record at `_global` key `/_meta/migrated`. If it's missing — only true on the very first boot after install — it does a one-shot copy:

1. Iterate every key in `localStorage`.
2. Skip `/twikki.boot.js` and any `/modules/…` key (see above).
3. Route the rest:
   - `/ws/<name>/<rest>` → `ws_<name>` store, IDB key `<rest>`
   - everything else → `_global` store, IDB key = the full localStorage key
4. After all writes, drop the sentinel at `_global` / `/_meta/migrated` with the current timestamp.

Subsequent boots see the sentinel and **never copy from localStorage again**. This is deliberate — the user might keep editing in another tab (or another app) and we don't want stale localStorage values overwriting what IndexedDB now owns.

A consequence: data the user writes via the localStorage path **after the migration boot** never reaches IDB. There's no two-way sync. If you suspect divergence, the only recovery is the rollback path below.

## Schema evolution between IndexedDB versions

IndexedDB object stores can only be created (or dropped) inside an `onupgradeneeded` callback, which fires when you open the DB with a higher `version` than the one on disk. The boot script handles this in two places:

### At boot: open at the existing version, upgrade if stores are missing

```js
// First open: no version arg → returns whatever version is on disk.
// On a fresh install the DB doesn't exist, so the browser creates it at v1
// and fires onupgradeneeded — that's when we create the initial stores
// (_global + ws_<name> for every workspace discovered in localStorage).
db = await openCurrentOrCreate(initialStores);

// If we discovered workspaces that don't have stores yet (the DB was opened
// by a previous boot and a new workspace appeared since), bump the version
// once and add all the missing stores in a single upgrade.
if (missing.length) {
  db.close();
  dbVersion++;
  db = await openWithStores(dbVersion, [...existingStores, ...missing]);
}
```

This means **every boot leaves the DB at a version that reflects exactly the set of stores currently needed**. There's no separate "schema migration" file — the schema is whatever stores exist.

### At runtime: lazy `ensureStore` when an unknown workspace is written

If something writes to `/ws/brand-new/foo` between boots — for instance, `core.workspaces.workspaceMigrate` cloning data into a new workspace before the user reloads — the `brand-new` workspace doesn't have a store yet. The boot script's `tw.storage.set` flow handles this by:

1. Updating the in-memory `Map` immediately (the sync API never blocks).
2. Routing the write to `ws_brand-new`.
3. Calling `ensureStore('ws_brand-new')` — if the store doesn't exist, this closes the DB, opens it at `version+1` with the new store added via `onupgradeneeded`, and replaces the cached `db` reference.
4. Once the upgrade settles, posts the IDB write.

`ensureStore` is **serialised through a single promise chain** (`pendingDb`). Concurrent writes to several new workspaces all queue behind it, so we never race two `db.close()` calls. If one upgrade fails (e.g. quota), subsequent writes log a `console.warn` and keep working from the in-memory `Map` — reads stay consistent for the session, but a failed write may not survive a reload.

Workspace **deletion** isn't wired up yet (the platform's `core.workspaces.js` has an unimplemented cleanup at line ~110). When it is, the natural fit is to `db.deleteObjectStore('ws_<name>')` inside a similar version-bump dance, mirroring `ensureStore`.

## Rolling back to localStorage

The plugin has no built-in uninstall command yet (flagged as a follow-up in the plugin's [README](../src/packages/base/IndexedDBStoragePlugin/IndexedDBStoragePlugin.md)). Manual rollback in three steps:

### 1. Export anything you'd lose

Every key written **since the install migration** lives **only** in IndexedDB. Before disabling the boot script, decide what to keep. Easiest path: use the [Dump](../src/packages/base/$DumpWorkspacePlugin.js) plugin from the command palette, or paste this into the browser console:

```js
JSON.stringify(Object.fromEntries(tw.store.keys('').map(k => [k, tw.store.exportRaw(k)])));
```

Save the result somewhere safe. (It uses the live `tw.storage`, which is the IDB-backed one while installed.)

### 2. Remove the boot script

The platform reads `/twikki.boot.js` from real `localStorage` (not via `tw.storage`), so this one key has to be removed at the localStorage level. Either:

- **DevTools** → Application → Local Storage → delete `/twikki.boot.js`, OR
- Console: `localStorage.removeItem('/twikki.boot.js')`

Reload the page. With the key gone, `runBootScript` in the platform finds no source, returns immediately, and the next line installs the default `localStorage` backing:

```js
await runBootScript(tw);
if (!tw.storage) tw.storage = initLocalStorage(); // fallback
```

The app boots reading from **the old `localStorage` data**, untouched since the install migration. Anything written to IDB since then is invisible.

### 3. (Optional) Drop the IndexedDB database

Removing the boot script disables IDB-backed storage but leaves the database on disk. To reclaim the space, run from the console:

```js
indexedDB.deleteDatabase('twikki');
```

This is **destructive** — only do it after you're certain you've exported everything you want from step 1.

### Re-installing later

Click the **Install IndexedDB Storage** button in the `IndexedDBStoragePlugin` tiddler again. The boot script gets rewritten to `localStorage`; on the next reload it opens (or re-creates) the `twikki` IDB database. If the database still exists from a previous install, the boot script will reuse it and the `/_meta/migrated` sentinel will block a second localStorage copy — so any edits you made to `localStorage` while IDB was disabled won't propagate back to IDB. If you want a clean re-migration, delete the database first (step 3 above) before reinstalling.

## Related

- [BootScript.md](./BootScript.md) — the platform-level pre-boot hook that this plugin uses; covers the `runBootScript` contract, failure handling, and how the boot script source lives in `localStorage`.
- [BOOT.md](./BOOT.md) — the broader boot timeline.
- [`src/packages/base/IndexedDBStoragePlugin/BootScript.js`](../src/packages/base/IndexedDBStoragePlugin/BootScript.js) — the implementation. The migration block, `ensureStore`, and the `tw.storage` shim are all in this one file.
