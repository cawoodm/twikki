# Packages

Packages are managed per-workspace and allow for specific tiddlers (e.g. plugins, icons or even data) to be bundled and shared via HTTP.

## What a package is

A **package** is a bundle of tiddlers shipped as a single JSON file of the shape `{ "tiddlers": [ … ] }`. Everything in TWikki that isn't the platform (and it's core modules) arrives as a package.

## Base Packages

Base packages are loaded first and provide a useful bunch of features which you could (in theory) do without.

* $ButtonsFunctions
* $CommandPalette
* $CoreThemeManager
* $DumpWorkspacePlugin
* $ExplorerPlugin
* $GeneralWidgets
* $GistBackupPlugin
* $GithubSaverExtension
* $CodeSyntaxHighlightPlugin
* $IncludeFunctions
* $ListTiddlersWidgets
* $ModulesWidget
* $OpenLinksInNewWindow
* $PackageWidgets
* $PickerPlugin
* $SelectorWidget
* $SettingsDialogPlugin
* $ShowTiddlersWidgets
* $SynchDataPlugin
* $TabsPlugin
* $ThemeImporterPlugin
* $TiddlerSearchResult
* $TrashedTiddlersFunctions
* $TrashManager
* $UnsavedChangesPlugin
* $WorkspaceWidgets
* Backup
* ObsidianThemeDark

## Authoring a package

To create a package you create a directory in `src/packages`. Each subdirectory is one package; its directory name is the package name. Every file in it becomes one tiddler.

```
src/packages/
  base/        → base.json      (the standard plugins & widgets: explorer, tabs, command palette, pickers, theme manager, default theme)
  icons/       → icons.json      (SVG icon tiddlers: $IconNew, $IconSave, …)
  themes/      → themes.json     (one multi-section tiddler per theme)
  demo/        → demo.json       (sample notes)
  website/     → website.json    (the in-app docs/marketing tiddlers)
```

The filename (minus extension) is the tiddler `title`; the extension picks the `type` (`.tid`→`x-twikki`, `.md`→`markdown`, `.js`→`script/js`, `.css`→`css`, `.json`→`json`, `.html`→`html`); leading `field: value` lines (or `// field: value` in `.js`/`.json`) are metadata; the rest is the body. Some tags are added automatically by package: `base`→`$NoEdit`, `core.defaults`→`$Shadow`, any `.css`→`$StyleSheet`. **See [COMPILER.md](./COMPILER.md) for the full file format, type table, and auto-tag rules** — they are not repeated here.

To regenerate the JSON: `npm run compile` (standalone), or just run `npm run dev` — the Vite compile plugin recompiles the affected package on every source change.

## Package Lists

The runtime does not scan `src/packages/`. It loads exactly the URLs listed in two shadow tiddlers (themselves part of `core.defaults`):

- [`$CorePackages`](../src/modules/core.defaults/$CorePackages.tid) — loaded first (`base`).
- [`$ExtensionPackages`](../src/modules/core.defaults/$ExtensionPackages.tid) — loaded next; **skipped entirely under `?safemode`**.

Both are `type: list` tiddlers; each bullet is `<url> [options]`:

```
* https://cawoodm.github.io/twikki/packages/base.json force
* https://cawoodm.github.io/twikki/packages/website.json nooverwrite
```

### Package Options

The following options control how a package is loaded and whether it may overwrite existing tiddlers:

| Option | Effect |
| --- | --- |
| `force` | overwrite existing tiddlers silently (no prompt) |
| `nooverwrite` | never overwrite an existing tiddler; skip it silently |
| `nosave` | mark imported tiddlers `doNotSave` — live for this session only, not persisted to the workspace |
| _(none)_ | overwrite only after a `confirm()` prompt, and only for user-modified tiddlers |

### Dev Mode Local Packages

TODO: We have a hack that, during boot, on a `localhost` or bare `IP:port` host, every `https://cawoodm.github.io/twikki` in the two package lists is rewritten to the current origin, so `npm run dev` serves the in-repo packages from the Vite dev server instead of the published copies.

## Merge semantics (what "load" actually does)

`tw.core.packaging.loadPackageFromURL` ([src/modules/core.packaging.js](../src/modules/core.packaging.js)) fetches the JSON and hands its tiddlers to `loadList`, which:

1. **Syncs deletions** — any tiddler currently stamped with this package (`t.package === name`) that is *absent* from the new list is deleted. So removing a file from a package and re-importing removes it from the store.
2. **Validates** each incoming tiddler (`tiddlerValidation`); invalid ones are reported and skipped.
3. **Respects guards** before overwriting an existing tiddler:
   - `nooverwrite` option → skip silently.
   - tiddler tagged **`$NoImport`** → never overwritten (skipped; see [[Tags]]).
   - otherwise, if it would change a *user-modified* tiddler (not a raw shadow) and `force` is **not** set → ask via `confirm()`.
4. **Stamps & stores** — survivors get `t.package = name` (used by search's `pck:` filter and package listings) and are added/updated in the store. With `nosave`/`doNotSave` they live only for the session.

> **Packages aren't cached like core modules.** Each boot will re-fetch the package JSON (subject only to the browser's HTTP cache); what persists across reloads is the *result* — the imported tiddlers in your workspace store (unless `nosave`).

## Live Package Imports

User's can import packages by clicking a button:

- The `<<packages.import>>` widget renders a button:
  ```
  <<packages.import name:website url:./packages/website.json filter:* force:false>>
  ```
  Clicking it loads a package and then fires `ui.reload` to re-render. The optional `filter` is a regex of titles to import.

## Adding a new package — checklist

1. Create `src/packages/<name>/` and drop in your tiddler files (see [COMPILER.md](./COMPILER.md) for the file format).
2. `npm run compile` (or `npm run dev`) → `public/packages/<name>.json` appears.
3. Add a line to [`$ExtensionPackages`](../src/modules/core.defaults/$ExtensionPackages.tid): `* https://cawoodm.github.io/twikki/packages/<name>.json force` (or `nooverwrite` if it carries user-editable content you don't want clobbered on reload).
4. `npm run dev` and reload (the line is rewritten to your dev origin automatically). If you edited a cached core module too, reload with `?update`.
5. When ready, `npm run publish` to push the package to GitHub Pages.

## Invariants worth remembering

- **A package is just a JSON list of tiddlers.** Themes, plugins, icons, and docs are all packages — nothing special.
- **The compiler discovers directories; the runtime loads lists.** Creating `src/packages/<name>/` is necessary but not sufficient — it must also appear in `$CorePackages`/`$ExtensionPackages` (or be imported on demand).
- **`public/packages/` is a gitignored build artifact** — never commit it; the runtime fetches it, never the loose source.
- **Use `nooverwrite` for content the user edits** (e.g. the `website` docs) so a reload doesn't discard their changes; use `force` for content you own outright (icons, themes, code).
- **`$NoImport` protects a single tiddler** from being overwritten by any non-`force` import; **`$NoEdit`** (auto-added to `base`) marks code/system tiddlers read-only in the UI.

## Plugin metadata

A plugin is just a `$Plugin`-tagged tiddler shipped inside a package. To make it appear in `<<plugins>>` with version + built-for platform + compat status, add a `# Meta` section to the source:

```
# Meta
name: MyPlugin
namespace: base
version: 1.0.0
platform: 0.24.0
```

Boot-time `prescanPluginRegistry()` walks `$Plugin` tiddlers, parses `# Meta` via `core.sections`, and populates `tw.pluginRegistry[]`. Unlike modules, the plugin compat gate is **soft** — an incompatible plugin still runs, the widget just surfaces a `⚠`/`✗` for the user. Full field reference and `.js`/`.tid` placement rules are in [PLUGINS.md](./PLUGINS.md).

## See also

- [COMPILER.md](./COMPILER.md) — source-file → package-JSON build step.
- [MODULES.md](./MODULES.md) — boot order, core-modules-vs-packages, caching, and the `?reload`/`?update`/`?safemode` refresh model.
- [PLUGINS.md](./PLUGINS.md) — plugin authoring, the `# Meta` section, the registry, and the `<<plugins>>` widget.
