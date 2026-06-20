tags: $Plugin

# Description

Replaces localStorage (limited to 5M) with IndexedDB.

**Scope:** the boot script is global per origin — installing in one workspace
reroutes ALL workspaces on this device. The platform's module cache
(`/modules/*`) stays in localStorage; only the workspace data layer routes
through IDB.

**Failure:** if `window.indexedDB` is missing, the script returns silently
and the platform falls back to `initLocalStorage()`. If IDB open / hydrate
throws, the platform's `runBootScript` catches it, alerts once, and falls
back. The app cannot be bricked by a broken boot script.

**Uninstall (manual, v1):** delete `/twikki.boot.js` from `localStorage` and
reload. Any data written since migration lives in IDB only — export it first
or it is lost.

# Install

Installing the plugin does **not** route storage automatically. Click the
button below to write the boot script into `localStorage`; on the next page
reload the platform picks it up and `tw.storage` becomes IDB-backed.

<<button "Install IndexedDB Storage" idbstorage.install>>

# Meta

<<pluginMeta IndexedDBStorage>>

# BootScript

[include](./BootScript.js)

# Code

[include](./IndexedDBStorageCode.js)
