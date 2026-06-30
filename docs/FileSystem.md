# File System Storage

The base [`FileSystemStoragePlugin`](../src/packages/base/FileSystemStoragePlugin/) routes `tw.storage`
through a **real folder on your disk** using the
[File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API), installing
the same kind of pre-boot script the [IndexedDB plugin](./IndexedDB.md) uses (see
[BootScript.md](./BootScript.md) for the platform hook). Unlike IndexedDB, the data lands as **ordinary
files you can open, edit, `git`-track and sync**: one file per tiddler, in its native format, grouped
into a folder per package.

This document covers the on-disk layout, the gesture/permission model that makes a pre-boot swap
possible, and how to roll back.

## On-disk layout

The chosen folder is a complete, self-contained backend. The headline case is the per-workspace
`tiddlers` array, which **explodes into one human-readable file per tiddler, grouped by package**.
Everything else is a small JSON sidecar:

```
<chosen folder>/
  _global.json            unscoped keys: {"/workspaces": "…", "/settings.json": "…"}
  .twikki-migrated        migration sentinel (presence = already migrated)
  <workspace>/            e.g. "default"
    <package>/            "base", "demo", … or "_user" when a tiddler has no package
      <SafeTitle>.<ext>   one content tiddler per file
    _meta.json            {"tiddlers-visible": "…", "tiddlers-trashed": "…"}
```

Each tiddler file is a `field: value` header block, a blank line, then the body (`text`):

```
title: $Theme
tags: $Shadow
type: x-twikki
created: 2026-06-27T10:00:00.000Z
updated: 2026-06-27T10:05:00.000Z

* [[$CoreThemeLight]]
```

- The **extension is chosen from the tiddler's `type`** (`x-twikki→.tid`, `markdown→.md`,
  `script/js→.js`, `css→.css`, `json→.json`, `html→.html`, else `.tid`).
- The **package folder** is the tiddler's runtime `package` field, or `_user` for your own notes (which
  have none). Only saveable tiddlers are written (shadow/`doNotSave` tiddlers never are).
- `title:` is always emitted and is **authoritative on read** — filenames are sanitised (characters
  reserved on Windows/macOS are replaced, and a `~<hash>` suffix is added when that is lossy or two
  titles would collide), so the filename is never relied on for the real title.
- The parser treats only the lines **before the first blank line** as the header, so a markdown body
  that starts with `foo: bar` is never misread.

The in-memory `Map` the boot script keeps holds the **same full prefixed keys** callers already use
(`/ws/default/tiddlers`, `/workspaces`), so `tw.storage.get/set` stay synchronous and identical in
shape to the localStorage / IndexedDB backends. The key↔file split lives only at the FS boundary.

`/twikki.boot.js` and the module cache (`/modules/*`) stay in `localStorage` on purpose — the platform
reads the boot script before `tw.storage` exists, and modules must load before any plugin runs.

## The gesture & permission model

`showDirectoryPicker()` needs a **user gesture** and the File System Access API normally scopes
permission to a session — which looks incompatible with a gesture-less pre-boot swap. The plugin
bridges this with **persistent permissions for installed PWAs**
([Chrome 122+](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api)):

1. **Connect** (one gesture, the button): `showDirectoryPicker({mode:'readwrite'})` picks the folder,
   its `FileSystemDirectoryHandle` is saved in a tiny IndexedDB (`twikki-fs-handle`), a one-shot dump of
   the current store is stashed alongside, and the boot script is written to `/twikki.boot.js`. Reload.
2. **Every later boot** (no gesture): the boot script retrieves the handle and calls
   `queryPermission({mode:'readwrite'})`. If TWikki is **installed as an app**, Chrome returns
   `'granted'` automatically and the folder is opened transparently — a true pre-boot replacement.
3. **First boot after Connect** (no `.twikki-migrated` sentinel): the migration dump is written into the
   folder and the sentinel dropped. Subsequent boots hydrate straight from the files.
4. **Not granted** (a normal browser tab where the grant didn't persist, or access was revoked): the
   boot script returns **without** installing `tw.storage`, so the platform falls back to localStorage,
   and the plugin offers a one-click **Reconnect** (a gesture → `requestPermission` → reload). Until you
   reconnect, nothing is persisted to the wrong backend.

> **Tip:** install TWikki as an app (PWA) so the folder opens silently on every load. In a plain tab
> you'll get the one-click reconnect prompt once per session.

**Scope:** the boot script is global per origin — connecting reroutes ALL workspaces on this device.

## Writes, flushing and diffing

Reads hit the in-memory `Map`. Writes update the `Map` and **fire-and-forget** the file write(s),
serialised through a single promise chain; `tw.storage.flush()` awaits them, so the platform's
`rebootHard` (`await tw.storage.flush()`) can't reload before a save reaches disk. On each save of a
workspace's tiddlers the backend **diffs against the current file set** (by content hash), so only
changed files are written and removed/renamed tiddlers' files are deleted.

To avoid re-serialising and re-hashing every tiddler on every save, the diff first computes a cheap
**fingerprint** per tiddler — `updated` plus `type`/`package`/`tags`/text-length — and skips the
serialise+hash entirely for any tiddler whose fingerprint and target path are unchanged since the last
sync (its cached hash is reused). `updated` is the load-bearing field here: core bumps it on every
local edit (`updateTiddler`/`updateTiddlerSilent` in `core.tiddlers`), and sync/import preserve the
incoming value. The trade-off: an in-place edit that changes the body to the **same length** without
bumping `updated` would not be detected — so any code that mutates a persisted tiddler must keep
`updated` truthful (go through the core update functions, or set `updated` yourself).

## Editing files externally

Browsers can't watch a picked folder for outside changes, so after editing files in another editor use
**Reload from folder** (it reboots and re-hydrates). Moving to a new device is just: install the plugin,
**Connect** the existing folder — the sentinel is already present, so it hydrates from your files.

## Rolling back

Click **Disconnect** (removes `/twikki.boot.js` and reboots to the default localStorage backend; your
folder files are left on disk), or manually:

1. **DevTools → Application → Local Storage** → delete `/twikki.boot.js`, or run
   `localStorage.removeItem('/twikki.boot.js')`, then reload. With the key gone, `runBootScript` finds
   no source and the platform installs the default localStorage backing.
2. (Optional) drop the handle store with `indexedDB.deleteDatabase('twikki-fs-handle')`.

Anything written to the **folder** after you switched away from localStorage lives only in the files —
reconnect (or copy the files back) to recover it.

## Related

- [IndexedDB.md](./IndexedDB.md) — the sibling backend; same pre-boot mechanism, no folder/gesture.
- [BootScript.md](./BootScript.md) — the platform-level pre-boot hook and its failure handling.
- [`src/packages/base/FileSystemStoragePlugin/BootScript.js`](../src/packages/base/FileSystemStoragePlugin/BootScript.js)
  — the implementation; the pure helpers (serialise/parse, filename safety, planning, diffing) are
  covered by [`test/unit/fs-storage.test.js`](../test/unit/fs-storage.test.js).
