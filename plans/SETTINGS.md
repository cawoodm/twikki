# Settings: user vs workspace, platform/plugin defaults, secret references

## Context

Today **all** settings live in a single JSON tiddler `$GeneralSettings`
(`src/modules/core.defaults/$GeneralSettings.jsonc`, a `$Shadow` tiddler with the
defaults baked in). User edits persist through the **workspace-scoped** store
(`/ws/<name>/tiddlers`), so every setting — Gist tokens, backup/sync intervals,
`baseUrl`, layout mode, search filters — is effectively **per-workspace**.

Reads go through `tw.core.common.getSetting(path, def)`: it
`getJSONObject('$GeneralSettings')`, walks the dotted `path`, returns an inline
`def`. There is **no cross-workspace layer**, **no way for the platform/plugins to
introduce their own settings**, **no merge**, and **secrets are stored in plaintext**
in the per-workspace tiddler (which then syncs/backs up).

**Goal:** two layers — **user (cross-workspace) → workspace** — where the platform
and plugins **declare** their settings in the object they already return (defaults
deep-merged into the workspace settings on every run), the user can toggle **per
setting** whether it's saved at user or workspace level, and secrets are **referenced**
(not embedded) from a global never-synced `secrets.txt`.

## Decisions (confirmed)

- **Two layers, named "user" and "workspace".** No "global".
  - **User** settings: cross-workspace, stored at `/settings.json` via `tw.store.global`.
  - **Workspace** settings: per-workspace, in the **`$Settings`** tiddler.
- **Declaration = in the returned object** (core modules + plugins add a `settings`
  block; the loader collects it). **Processed on every run** and **deep-merged into
  the workspace `$Settings`** so new settings appear with their defaults.
- **Per-setting placement is the user's choice**, via a **toggle in the settings
  dialog** (User ↔ Workspace) — not fixed by the registrant.
- **Secrets** live in a global, **never-synced** `secrets.txt`; settings hold a
  `${secret:KEY}` reference resolved at read time. Only the `secret:` kind for now.

## Design

### 1. Layers (read precedence, highest wins)

1. **User** — `/settings.json` (a `tw.store.global` JSON object; cross-workspace). A
   key present here means the user chose to save it at user level (the toggle).
2. **Workspace** — the `$Settings` tiddler. Defaults are deep-merged in on every run
   (§2), so this layer always carries the full set with defaults.

Then a **secret-expansion** pass (§3) replaces any `${secret:KEY}` in the resolved
value. (`getSetting`'s inline `def` remains the last-resort fallback for an
unregistered/unmerged key.)

`getSetting(path)` = `userValue ?? workspaceValue`, then expand `${secret:…}`.

### 2. Declaring settings — in the returned object (Option A), merged every run

Plugins already return `{meta, init, start}`; core modules return
`{name, version, platform, exports, run}`. Add a `settings` schema there; the platform
collects it at load (no new author-facing call). The schema has **no `scope`** — the
user decides placement via the dialog toggle (§5):

```js
// a plugin
return {
  meta: {name: 'GistSync', version: '1.0.0'},
  settings: {
    'synch.gitPAT':         {default: '${secret:gitPAT1}', type: 'secret', description: 'GitHub PAT'},
    'synch.synchInSeconds': {default: 60, type: 'number'},
  },
  init() {...},
};

// a core module (same shape on its factory return)
return {name: 'core.ui', version, platform, exports, run, settings: {
  'layout.mode': {default: 'river', type: 'enum', options: ['river', 'tabs']},
}};
```

- `loadModules()`/`loadPlugins()` collect each owner's `settings` into a flat,
  **namespaced** registry (`synch.gitPAT`, `layout.mode`). Duplicate path → **warn**
  (first wins). The registry is the source of truth for **defaults, type, and UI
  metadata** (replacing the `~`-suffixed description strings in the old JSONC).
- **On every run**, after the registry is built, **deep-merge** registry defaults into
  the workspace `$Settings` tiddler: missing keys get their default, **existing values
  are preserved**. So `$Settings` is the materialized workspace doc and new plugin
  settings show up automatically. (Plugins load during `reload()`, so the merge runs
  there; core-module settings are merged as soon as they load.)

### 3. Secrets — `secrets.txt` + `${secret:KEY}`

- **`secrets.txt`**: a global tiddler stored via `tw.store.global`, tagged
  `$NoSynch $NoBackup` so it never leaves the device. Body is one `key: value` per line
  (`#` comments allowed):
  ```
  gitPAT1: ghp_xxxxxxxxxxxxxxxx
  ```
- **Reference**: any setting value may be `"${secret:gitPAT1}"`. After layer resolution,
  `getSetting` runs one expansion pass: each `${secret:KEY}` → the matching value.
- **Missing key** → empty string **+ a `console.warn`/`dp`**.
- Tokens live in exactly one place; settings (user or workspace) hold only references,
  so they sync/back up safely.

### 4. Resolution & write API (one chokepoint)

In `core.common` (where `getSetting` lives) — or a small `tw.settings` facade with
`get`/`set`/`register`/`placement`, keeping `getSetting` as an alias:

```js
getSetting(path, def)              // user ?? workspace ?? def, then expand ${secret:}
setSetting(path, value, level?)    // level: 'user' | 'workspace' (default 'workspace')
```

- `setSetting(path, value, 'user')` writes to `/settings.json` (and removes the key from
  `$Settings` so it doesn't shadow/diverge).
- `setSetting(path, value, 'workspace')` writes to `$Settings` (and removes the key from
  `/settings.json`).
- `/settings.json` stays **sparse** (only user-level keys); `$Settings` is the
  materialized workspace doc (defaults + workspace edits).

### 5. Settings dialog (`SettingsDialogPlugin`)

Render from the **registry** (grouped by namespace), not by parsing one JSON blob:

- Each row shows the setting's **effective value** plus a **User ⇄ Workspace toggle**
  choosing where it's saved. The toggle state = "is this key in `/settings.json`"; flipping
  it calls `setSetting(path, value, level)` which moves the value between layers.
- `type: 'secret'` rows show the `${secret:…}` reference (masked) and link to edit
  `secrets.txt`. `type: 'enum'` uses `options`.
- A user-level setting visibly applies across workspaces; a workspace one is scoped.

### 6. Storage summary

- **User**: `/settings.json` JSON via `tw.store.global` (sparse, cross-workspace).
- **Workspace**: `$Settings` tiddler (materialized: defaults merged each run + edits).
- **Secrets**: `secrets.txt` tiddler via `tw.store.global`, `$NoSynch $NoBackup`.
- **Defaults**: in-memory registry, rebuilt each boot; merged into `$Settings`.
- Retire the `urls.baseUrl` → `/baseUrl` special case: `baseUrl` is a normal registered
  setting (user-level by default via the toggle).

### 7. Migration (one-time, on boot)

If a legacy `$GeneralSettings` with user values exists: move plaintext `*.accessToken`
values into `secrets.txt` (replace with `${secret:…}` references), copy the remaining
user-set values into `$Settings`, then drop `$GeneralSettings`. Rename the existing
`$Settings` **nav-list** tiddler to `$SettingsLinks` (see Naming below). Guard with a
stored migration stamp so it runs once.

## Naming note

`src/modules/core.defaults/$Settings.tid` currently exists as a **navigation list**
(links to `$GeneralSettings`, `$TitleBar`, `$Theme`, `$Packages`). Since `$Settings`
becomes the workspace settings **data** tiddler, rename the nav list to `$SettingsLinks`
(update any references to it) so the name is free.

## Critical files

- `src/modules/core.common.js` — `getSetting` (user→workspace + secret expansion), new
  `setSetting(path, value, level)`, the registry + an internal `registerSettings` the
  loader calls, and the deep-merge-into-`$Settings` step. (Or extract `tw.settings`.)
- `src/platform/twikki.platform.js` — `loadModules`/`loadPlugins`/`reload` collect each
  owner's `settings` and run the per-run merge into `$Settings`; load/persist
  `/settings.json` and `secrets.txt` via `tw.store.global`.
- `src/modules/core.store.js` — confirm `/settings.json` + `secrets.txt` global
  persistence; ensure `$NoSynch`/`$NoBackup` are honored.
- `src/modules/core.defaults/$GeneralSettings.jsonc` — removed; defaults move into the
  owners' `settings` returns. `$Settings.tid` (nav list) → `$SettingsLinks`.
- Owners that gain a `settings` block: `core.store` (`data.autoSave`), `core.search`
  (`search.*`), `core.ui`/`TabsPlugin` (`layout.mode`), `$GistBackupPlugin`/
  `$GistSynchPlugin` (`backup.*`/`synch.*` → `${secret:…}`), `$BackupReminderPlugin`,
  `$ThemeImporterPlugin` (`urls.themeUrl`), platform (`baseUrl`).
- `src/packages/base/SettingsDialogPlugin/SettingsDialog.js` — render from registry,
  per-setting User⇄Workspace toggle, secret-aware fields, write via `setSetting`.
- Docs: new `docs/SETTINGS.md`; update `CLAUDE.md` (storage layering + the module/plugin
  contract's new `settings` field).

## Open (not blocking)

- Confirm `$NoSynch`/`$NoBackup` are already honored by `$GistSynchPlugin`/
  `$GistBackupPlugin`, or wire it so `secrets.txt` (and user choice) are excluded.
- Default placement level when a user first edits a setting — proposed **workspace**
  (toggle to user to share). Override if you'd rather default to user.

## Verification

- **Unit** (resolver extracted pure-ish like the semver/buildUrl helpers): workspace-only;
  user overrides workspace; `setSetting('user')`/`('workspace')` move the value and
  de-dupe the other layer; deep-merge adds new default keys but preserves existing values;
  `${secret:K}` expands from a stub map; missing secret → `''` + warn; duplicate
  registration warns.
- **e2e**: boot, set a setting at **user** level, switch workspace, assert it persists;
  set one at **workspace** level, assert it's scoped and the other workspace is unaffected;
  assert a plugin's declared default appears in `$Settings` after merge; put a token in
  `secrets.txt`, assert a `${secret:…}` setting resolves and that `secrets.txt` is excluded
  from a sync/backup run; toggle a setting User⇄Workspace in the dialog and assert the value
  moves between `/settings.json` and `$Settings`. Reuse `seedTiddlers`.
- **Migration**: seed a legacy `$GeneralSettings` with a plaintext token, boot, assert the
  token moved to `secrets.txt` (as `${secret:…}`), values landed in `$Settings`, the nav
  list became `$SettingsLinks`; second boot is a no-op.
- **Manual**: dialog shows the per-setting toggle and effective values; toggling writes the
  right store (verify via `tw.store.global.get('/settings.json')` vs
  `tw.store.get` for `$Settings`); `secrets.txt` never appears in exported/synced data.
