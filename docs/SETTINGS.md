# Settings

TWikki settings resolve through layers and can be saved per-workspace or shared
across all workspaces. Secrets live separately and are referenced, never embedded.

## Layers (read precedence, highest wins)

1. **User** — `/settings.json` in `tw.store.global` (cross-workspace, sparse).
2. **Workspace** — the per-workspace **`$Settings`** tiddler (registered defaults
   are deep-merged in on every run, so it always carries the full set).
3. **Registered default** — declared by a core module or plugin (see below).

`tw.core.common.getSetting(path, def)` (alias of `tw.core.settings.get`) returns
`user ?? workspace ?? default ?? def`, then expands any `${secret:KEY}` reference.

```js
tw.core.common.getSetting('layout.mode', 'river');
tw.core.settings.set('synch.synchInSeconds', 120, 'user'); // or 'workspace'
```

## Declaring settings (platform & plugins)

A core module (its factory return) or a plugin (its returned object) declares a
`settings` block. The platform collects these into a registry and deep-merges the
defaults into `$Settings` after everything loads — new settings appear automatically.

```js
return {
  meta: {name: 'GistSync', version: '1.0.0'},
  settings: {
    'synch.gitPAT':         {default: '${secret:gitPAT1}', type: 'secret', description: 'GitHub PAT'},
    'synch.synchInSeconds': {default: 60, type: 'number'},
  },
  init() {},
};
```

`{default, type?, description?, options?}` per dotted path. A duplicate path from a
different owner warns (first wins); the same owner re-registering (a soft reload)
overwrites silently. Today most defaults still live in the `$Settings` shadow
(`src/modules/core.defaults/$Settings.jsonc`) with `~`-suffixed descriptors; new
settings should prefer the `settings` block.

## User vs workspace (the dialog toggle)

Open `$Settings` (the Settings command) to get a tabbed form. Each field has a
**user** checkbox:

- **unchecked** → saved in this workspace's `$Settings`.
- **checked** → promoted to `/settings.json` and shared across all workspaces.

Toggling moves the value between layers (the other layer is cleared so there is a
single source). Editing a field writes to its current layer. A setting's layer is
simply *which store holds it* — there is no separate scope flag.

## Secrets

Secrets live ONLY in the global **`secrets.txt`** store (`tw.store.global`), one
`key: value` per line, and never sync or back up. Settings hold a reference:

```
// $Settings or /settings.json (syncable):
"synch": { "gitPAT": "${secret:gitPAT1}" }

// secrets.txt (device-local, never leaves):
gitPAT1: ghp_xxxxxxxxxxxx
```

`getSetting` expands `${secret:KEY}` at read time; a missing key resolves to `''`
and logs a warning. `tw.core.settings.writeSecret(key, value)` / `readSecrets()`
manage the store.

## Storage map

| What | Where | Scope |
|---|---|---|
| Workspace settings | `$Settings` tiddler | per-workspace |
| User settings | `/settings.json` (`tw.store.global`) | cross-workspace |
| Secrets | `secrets.txt` (`tw.store.global`) | device-local, never synced |
| Registered defaults | in-memory registry | rebuilt each boot |

## Implementation

- `src/modules/core.settings.js` — the engine (`register`, `get`/`getRaw`, `set`,
  `materialize`, `expandSecrets`, `placement`).
- `src/platform/twikki.platform.js` — collects each module/plugin `settings` block
  and calls `materialize()` after plugins load.
- `src/packages/base/SettingsDialogPlugin/` — the registry/JSON-driven form + toggle.
- `test/unit/settings.test.js` — resolver/layering/secrets/merge tests.
