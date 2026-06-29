tags: $Plugin

# Description

One-shot migration of **legacy bare global storage keys** into the `/ws/` root.

core.store used to store globals under bare keys (`/workspaces`, `/workspace`,
`/settings.json`, `/secrets`, `/baseUrl`, …). The current scheme prefixes every global
with `/ws/` so a `/ws/*` backend (e.g. FileSystemStorage) carries them along with the
workspace data. After that change an existing **localStorage / IndexedDB** install can't
find its globals: the workspace list reads empty and resets to `['default']`, the wiki
boots into an empty `default` workspace, and `?ws=<name>` is rejected as "unknown" (your
`ws_<name>` data is still on disk — it's just unreachable, because workspace resolution is
list-driven).

Run this once to relocate those keys. It is **idempotent** (once moved the legacy source
is gone) and leaves control keys (`/twikki.*`, `/modules/*`) and already-migrated `/ws/*`
keys untouched. The wiki **reloads** afterwards so the restored globals take effect — any
`?ws=<name>` in the URL is honoured on the reload.

<<button "Migrate legacy storage keys" migratekeys.run>>

# Meta

<<pluginMeta MigrateStorageKeys>>

# Code

[include](./Code.js)
