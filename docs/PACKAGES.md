# Packages

How TWikki bundles, ships, loads, and merges units of content and features.

> Two sibling docs go deeper on the two ends of a package's life:
> - [COMPILER.md](./COMPILER.md) — the **build step** that turns source files into a package's JSON (file format, type mapping, auto-tags).
> - [MODULES.md](./MODULES.md) — the **runtime lifecycle** (boot order, caching, core-modules-vs-packages, refresh levels).
>
> This document is the package-centric view: what a package *is*, how to author one, how it's listed and imported, and the merge semantics — referencing the other two where they meet.

## What a package is

A **package** is a bundle of tiddlers shipped as a single JSON file of the shape `{ "tiddlers": [ … ] }`. Everything in TWikki that isn't the platform itself — themes, icons, the demo content, the website/docs, the plugins in `base` — arrives as a package. Themes and plugins are not a separate mechanism: they're ordinary tiddlers that happen to live in a package (see [[Plugins]] in the `website` package).

A package has three lives:

```
src/packages/<name>/        compile           public/packages/<name>.json        fetch + merge
  loose source files   ───────────────▶   { "tiddlers": [ … ] }   ───────────────▶   tiddler store
  (one file = 1 tiddler)   (COMPILER)        (gitignored artifact)     (runtime)        (your workspace)
```

1. **Authored** as a directory of files under `src/packages/<name>/`.
2. **Compiled** into `public/packages/<name>.json` (a gitignored build artifact).
3. **Loaded** at runtime — fetched over HTTP and merged into the tiddler store.

## Authoring a package

Each immediate subdirectory of `src/packages/` is one package; its directory name is the package name. Every file in it becomes one tiddler:

```
src/packages/
  base/        → base.json      (the standard plugins & widgets: explorer, tabs, command palette, pickers, theme manager, default theme)
  icons/       → icons.json      (SVG icon tiddlers: $IconNew, $IconSave, …)
  themes/      → themes.json     (one multi-section tiddler per theme)
  demo/        → demo.json       (sample notes)
  website/     → website.json    (the in-app docs/marketing tiddlers)
```

The filename (minus extension) is the tiddler `title`; the extension picks the `type` (`.tid`→`x-twikki`, `.md`→`markdown`, `.js`→`script/js`, `.css`→`css`, `.json`→`json`, `.html`→`html`); leading `field: value` lines (or `// field: value` in `.js`/`.json`) are metadata; the rest is the body. Some tags are added automatically by package: `base`→`$NoEdit`, `core.defaults`→`$Shadow`, any `.css`→`$StyleSheet`. **See [COMPILER.md](./COMPILER.md) for the full file format, type table, and auto-tag rules** — they are not repeated here.

> Note: `core.defaults` lives under `src/modules/` (not `src/packages/`) and compiles to `public/modules/core.defaults.json`. It's a package in shape but is loaded as a **core module** (the built-in shadow tiddlers), not via the package lists. Why it's different: see [MODULES.md](./MODULES.md).

To regenerate the JSON: `npm run compile` (standalone), or just run `npm run dev` — the Vite compile plugin recompiles the affected package on every source change.

## How packages are loaded

The runtime does not scan `src/packages/`. It loads exactly the URLs listed in two shadow tiddlers (themselves part of `core.defaults`):

- [`$CorePackages`](../src/modules/core.defaults/$CorePackages.tid) — loaded first (`base`).
- [`$ExtensionPackages`](../src/modules/core.defaults/$ExtensionPackages.tid) — loaded next; **skipped entirely under `?safemode`**.

Both are `type: list` tiddlers; each bullet is `<url> [options]`:

```
* https://cawoodm.github.io/twikki/packages/base.json force
* https://cawoodm.github.io/twikki/packages/website.json nooverwrite
```

`loadPackages` (`twikki.latest.js`) splits each line: the first token is the URL, the rest are comma/space-separated options.

| Option | Effect |
| --- | --- |
| `force` | overwrite existing tiddlers silently (no prompt) |
| `nooverwrite` | never overwrite an existing tiddler; skip it silently |
| `nosave` | mark imported tiddlers `doNotSave` — live for this session only, not persisted to the workspace |
| _(none)_ | overwrite only after a `confirm()` prompt, and only for user-modified tiddlers |

**A directory is not enough.** Adding `src/packages/foo/` makes the compiler emit `foo.json`, but the runtime will not load it until you add a line for it to `$ExtensionPackages`. (This is why `marc`, `old`, `onboarding`, and `tests` exist in the repo but don't load by default — they aren't listed.)

### Dev rewriting

During boot, on a `localhost` or bare `IP:port` host, every `https://cawoodm.github.io/twikki` in the two package lists is rewritten to the current origin, so `npm run dev` serves the in-repo packages from the Vite dev server instead of the published copies.

## Merge semantics (what "load" actually does)

`tw.core.packaging.loadPackageFromURL` ([src/modules/core.packaging.js](../src/modules/core.packaging.js)) fetches the JSON and hands its tiddlers to `loadList`, which:

1. **Syncs deletions** — any tiddler currently stamped with this package (`t.package === name`) that is *absent* from the new list is deleted. So removing a file from a package and re-importing removes it from the store.
2. **Validates** each incoming tiddler (`tiddlerValidation`); invalid ones are reported and skipped.
3. **Respects guards** before overwriting an existing tiddler:
   - `nooverwrite` option → skip silently.
   - tiddler tagged **`$NoImport`** → never overwritten (skipped; see [[Tags]]).
   - otherwise, if it would change a *user-modified* tiddler (not a raw shadow) and `force` is **not** set → ask via `confirm()`.
4. **Stamps & stores** — survivors get `t.package = name` (used by search's `pck:` filter and package listings) and are added/updated in the store. With `nosave`/`doNotSave` they live only for the session.

> **Packages aren't cached like core modules.** Each boot re-`fetch`es the package JSON (subject only to the browser's HTTP cache); what persists across reloads is the *result* — the imported tiddlers in your workspace store (unless `nosave`). Contrast with JS core modules, which are cached in localStorage. Full caching/refresh model: [MODULES.md](./MODULES.md).

## Importing on demand

Beyond the boot-time lists, a package can be pulled in at runtime:

- **`<<packages.import>>` widget** ([$PackageWidgets.js](../src/packages/base/$PackageWidgets.js)) renders a button:
  ```
  <<packages.import name:website url:./packages/website.json filter:* force:false>>
  ```
  Clicking it sends `package.reload.url` → `reloadPackageFromUrl`, which runs the same fetch+merge and then fires `ui.reload` to re-render. The optional `filter` is a regex of titles to import.
- **Theme Importer** ([$ThemeImporterPlugin.js](../src/packages/base/$ThemeImporterPlugin.js)) is a specialized importer that pulls a themes package from a URL (default: a GitHub Gist) — the `<<themeImport.button>>` next to the theme picker.

## Publishing a package

Published packages are served from the GitHub Pages site `https://cawoodm.github.io/twikki/packages/<name>.json` — the URLs the default lists point at. `npm run publish` (`pwsh ci/publish.ps1`):

1. Rebuilds `dist/` from `public/*` (the compiled `packages/` + `modules/`), `index.html`, and the loose platform/module JS.
2. Copies `dist/*` into the sibling checkout `../cawoodm.github.io/twikki/` and commits + pushes it.

So the publish flow is: edit sources → `npm run compile` (or it's implicit in the build) → `npm run publish` → the new `packages/<name>.json` is live for every reader.

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

## See also

- [COMPILER.md](./COMPILER.md) — source-file → package-JSON build step.
- [MODULES.md](./MODULES.md) — boot order, core-modules-vs-packages, caching, and the `?reload`/`?update`/`?safemode` refresh model.
- [CLAUDE.md](../CLAUDE.md) — the module contract and repo-level commands.
