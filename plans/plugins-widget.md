# Plan: `<<plugins>>` widget + formal plugin metadata + registry

## Context

Today, "a plugin is just a tiddler" (see `src/packages/website/Plugins.tid`): any `script/js` tiddler that calls `tw.extensions.registerPlugin(namespace, name, factory, options?)` is a plugin. The factory returns an instance like `{name, version, init?, start?}`, but the surrounding tiddler carries no formal metadata — no built-for platform, no author, no source URL, no `package` link. The platform stores live instances under `tw.plugins[ns][name]` and forgets the rest.

The user wants three things, layered:

1. **A `<<plugins>>` widget** modelled on `<<modules>>` — a markdown table showing plugin name, version, source package, built-for platform, compatibility status.
2. **A formal `# Meta` section convention** inside the plugin source tiddler that the runtime parses (today the convention is documented in `ExamplePlugin.tid` but not enforced).
3. **A runtime plugin registry** (parallel to `tw.modules[]`) that the widget — and future Remove / Update / `repositories.json` discovery features — can drive off.

This iteration delivers all three, read-only. Remove/update/install actions and the `repositories.json` discovery layer are out of scope; they will land on top of this registry in follow-up specs.

The sibling branch `plugin-css-layer` (now merged with current `main`) is the natural home for this work: six base plugins have already been converted from `.js` to multi-section `.tid` files (`# Code`, `# StyleSheet`, …) and a `# Meta` section slots in beside them.

## Design

### 1. Plugin metadata: `# Meta` section

Each plugin source tiddler declares a `# Meta` section. The existing `src/modules/core.sections.js` parser already extracts leading `key: value` lines from a section — no parser changes needed.

- In a `.tid` source file (post-`plugin-css-layer` conversion) `# Meta` is just another section alongside `# Code`, `# StyleSheet`, etc.
- In a `.js` source file the section lives inside a `/* … */` block comment, with `# Meta` and the `key: value` lines starting at column 0. The section parser scans line-prefixes; it does not interpret JS comment syntax, so `// # Meta` would NOT be recognised — block comments only.

Each plugin source tiddler must also carry the `$Plugin` tag (already documented; `ExamplePlugin.tid` is the reference). This is what the boot-time pre-scan uses to discover plugins; without it the metadata is invisible to the registry.

Formalized fields (all string-typed unless noted):

| Field | Required | Purpose |
|---|---|---|
| `name` | yes | Plugin name (must match the `name` arg of `registerPlugin`) |
| `namespace` | yes | Namespace arg of `registerPlugin` (e.g. `base`) |
| `version` | yes | Semver of *this plugin's* API |
| `platform` | optional | Platform version the plugin was built for; caret-matched against running `VERSION` |
| `author` | optional | Free text |
| `description` | optional | One-line description |
| `homepage` | optional | URL for further info |
| `source` | optional | URL the plugin was installed from (set by future install flow; not authored manually) |

Unknown fields are kept verbatim on the registry entry, so a future `repositories.json` flow can add fields (`id`, `repo`, `license`, `dependencies`, …) without a parser change.

**Format reconciliation.** `src/packages/website/ExamplePlugin.tid` currently shows `# Meta` as a bullet list (`* Author: Marc`, `* Version: 1.0.1`). The runtime section parser only reads non-bulleted `key: value` lines. **Update the docs example** to drop the bullets — cheaper than extending the parser, and consistent with how `tags:` works at file level.

### 2. Plugin registry: `tw.pluginRegistry[]`

A new top-level array on `tw.pluginRegistry`, populated during boot, mirroring the shape of `tw.modules[]`. (Not nested under `tw.plugins.registry`: the existing `initPlugins`/`runPlugins` iterate `Object.keys(tw.plugins)` as namespaces, so adding a sibling key would have collided with that loop.) Each entry:

```js
{
  name: 'GithubSaver',
  namespace: 'base',
  source: '$GithubSaverExtension',       // source tiddler title
  meta: { version, platform, author, description, homepage, ...unknownFields },
  compat: { status: 'ok'|'warn'|'block'|'exempt', reason: string },
  instance: <ref to tw.plugins[ns][name]> | null,   // null if not (yet) registered
  error: null | { phase: 'init'|'start', message }
}
```

`tw.plugins[ns][name]` keeps its current shape (live plugin instance) so existing call-sites don't break. The registry is the new informational layer; the widget reads from it.

### 3. Boot flow changes

In `src/platform/twikki.platform.js`:

1. **Pre-scan** (new step, after packages load, before `initPlugins()`): iterate tiddlers tagged `$Plugin` (the existing convention — `src/packages/website/ExamplePlugin.tid` already uses it). For each, parse the `# Meta` section via `core.sections.getSection(text, 'Meta')`. Compute compat with the existing `caretSatisfies(required, VERSION)` helper. Append a registry entry with `instance: null`. (A plugin missing the `$Plugin` tag still works at runtime — it just won't pre-register and will arrive in step 2 as an exempt orphan entry.)
2. **Eval + register** (existing flow): unchanged. When `registerPlugin(ns, name, factory, options?)` is called, look up the registry entry by `(ns, name)` and link `entry.instance`. If no pre-scan entry exists, create one with `compat.status = 'exempt'` and `meta = {}` so orphaned plugins still surface in the widget.
3. **Error capture** (small adjustment to existing try/catch around init/start): on throw, set `entry.error = {phase, message}` in addition to the existing console logging.

**Compat behaviour (default: soft gate).** Even when `compat.status === 'block'`, init/start still run — plugins are extensions, not core, and the existing try/catch already isolates failures from boot. The widget surfaces the status so the user can decide to remove/update. (Earlier discussion left this open; soft gate is the sensible default and mirrors how the platform already treats plugin errors. If a hard gate is desired later, the registry already has the data to enforce it.)

### 4. The widget: `<<plugins>>`

New tiddler: `src/packages/base/$PluginsWidget.js` — kept as `.js` to mirror the existing `src/packages/base/$ModulesWidget.js` (single-section macros don't benefit from `.tid` packaging). If a `# StyleSheet` is ever needed, convert at that point.

The macro returns a markdown table:

```
| Plugin | Namespace | Version | Package | Built for | Status |
| ------ | --------- | ------- | ------- | --------- | ------ |
| GithubSaver | base | 0.0.2 | base | 0.24.0 | ✓ |
```

Status icons: `✓` ok, `⚠` warn, `✗` block, `⚠ err` runtime error, `–` exempt. Hover text (`title=`) carries the `reason`.

The `Package` column is derived from `tiddler.package` — already set by `src/modules/core.packaging.js` when a package is loaded (each tiddler gets `.package = packageName`).

### 5. Existing plugins to annotate

Once the registry/widget land, add `# Meta` sections to the six base plugins already converted on `plugin-css-layer`:

- `$UnsavedChangesPlugin.tid`
- `$CommandPalette.tid`
- `$ExplorerPlugin.tid`
- `$TabsPlugin.tid`
- `$PickerPlugin.tid`
- `$SettingsDialogPlugin.tid`

Plus `$GithubSaverExtension.js` (still `.js` — annotate via comment block).

This is the validation set: after annotation, the `<<plugins>>` widget should show seven rows with `✓` for all.

### 6. Out of scope (explicit non-goals)

- **No Remove button.** Deleting a plugin tiddler already works via the normal tiddler delete flow; no special API.
- **No Check-for-updates button.** Requires a `source` URL convention and a fetch/diff flow — separate spec.
- **No `repositories.json`.** Requires UI for browsing/installing — separate spec.
- **No hard compat gate.** See "soft gate" rationale above.
- **No bullet-list parsing.** `# Meta` uses plain `key: value` lines.

## Critical files

| File | Change |
|---|---|
| `src/platform/twikki.platform.js` | Add pre-scan step; populate `tw.pluginRegistry[]`; correlate `registerPlugin` to entries; capture init/start errors on entries. |
| `src/packages/base/$PluginsWidget.js` | **New.** Defines `tw.macros.core.plugins`. |
| `src/packages/website/Plugins.tid` | Document the `# Meta` section, the `<<plugins>>` macro, and the field list. |
| `src/packages/website/ExamplePlugin.tid` | Convert the `# Meta` bullet list to `key: value` so it parses. |
| `src/packages/base/$UnsavedChangesPlugin.tid`, `$CommandPalette.tid`, `$ExplorerPlugin.tid`, `$TabsPlugin.tid`, `$PickerPlugin.tid`, `$SettingsDialogPlugin.tid` | Add `# Meta` sections. |
| `src/packages/base/$GithubSaverExtension.js` | Add `# Meta` comment block. |
| (none — verification is browser-based for now) | The pre-scan + compat helpers live inside `twikki.platform.js`'s IIFE and aren't node-importable; extracting them to a separately-testable core module is a follow-up. |

Reused infrastructure:

- `src/modules/core.sections.js` — `getSection(text, 'Meta')` already returns parsed metadata.
- `src/platform/twikki.platform.js` — `caretSatisfies(required, running)` for compat checks.
- `src/modules/core.packaging.js` — already stamps `tiddler.package` for the widget's Package column.

## Verification

1. `npm run dev` (or `npm run compile && npm run build-test`), open the dev page.
2. Create a tiddler with body `<<plugins>>` — verify it renders a table with one row per registered plugin.
3. Verify the `Package` column matches what the tiddler editor shows for each plugin source.
4. Temporarily set `platform: 0.99.0` on one plugin's `# Meta` — verify it appears with `⚠`.
5. Temporarily set `platform: 1.0.0` (major mismatch) — verify `✗`; verify the plugin still runs (soft gate).
6. Temporarily make a plugin's `start()` throw — verify `⚠ err` with the error message in the hover text.
7. Delete a plugin tiddler — verify the row disappears on reload.
8. `npm test` — new `tests/unit/plugin-registry.test.js` passes; existing tests still pass.

## Branch / sequencing

Work on top of the now-merged `plugin-css-layer`. After this lands, it merges back to `main` together with the CSS-layer work as one cohesive plugin-system upgrade. Pre-existing test failures on `main` (`module-compat.test.js`, `tokens.test.js` re: `--search-hit-bg`) are unrelated and tracked separately.
