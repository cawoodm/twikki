# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Command                                | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run dev`                          | Vite dev server on port 3002 (root is `src/`, opens browser, host-exposed). The [vite-plugin-tiddler-compile.js](vite-plugin-tiddler-compile.js) plugin runs on `buildStart` and watches sources, so package JSON regenerates automatically on source change; the secondary `reload` plugin in [vite.config.js](vite.config.js) then triggers a full browser reload on any `.json` write.                                                                                                                                                                          |
| `npm run compile`                      | Runs `node vite-plugin-tiddler-compile.js` standalone — regenerates `public/packages/*.json` and `public/modules/*.json` from sources in `src/packages/<pkg>/` and `src/modules/<pkg>/`. Cross-platform (pure Node). Only needed outside the dev server, e.g. to seed `public/` before a `vite build` in a one-shot environment.                                                                                                                                                                                                                                   |
| `npm run build` / `npm run build-test` | Vite production build into `dist/`, then runs `vite` from inside `dist/` (the trailing `vite` previews the built output). `build-test` adds `--open --host`.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run publish`                      | Declared as `pwsh ci/publish.ps1`: assemble `dist/`, then commit & push to a sibling checkout at `../cawoodm.github.io/twikki/` (the GitHub Pages target).                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npm test`                             | `node --test --watch ./test/unit/*.test.js`. Coverage: the compile plugin ([test/unit/compile-plugin.test.js](test/unit/compile-plugin.test.js)), the section parser ([test/unit/sections.test.js](test/unit/sections.test.js)), parameter parsing ([test/unit/params.test.js](test/unit/params.test.js)), the design-token contract ([test/unit/tokens.test.js](test/unit/tokens.test.js)), the semver/compat helpers ([test/unit/semver.test.js](test/unit/semver.test.js)) and the workspace-scoped store ([test/unit/store.test.js](test/unit/store.test.js)). |
| `npm run test:e2e`                     | Playwright suite ([test/e2e/](test/e2e/)) booting the real app via the Vite dev server (pinned port 5180): every wired platform event, plugin health and dependency ordering, and `?safemode` (extension packages skipped, base plugins still load).                                                                                                                                                                                                                                                                                                               |

Lint is configured ([eslint.config.mjs](eslint.config.mjs)) but is not wired into an `npm` script. Notable rule overrides: `no-eval` off (the runtime evaluates module strings), single quotes, `object-curly-spacing: never`, `complexity` warns at 40, `require-await` error. Globals `tw` and `dp` are declared. `localStorage` is banned (`no-restricted-globals`) in `src/modules/` and `src/packages/` except `core.store` — everything goes through `tw.store`.

## Architecture

todo...

### Boot chain

[src/index.html](src/index.html) loads [src/platform/twikki.platform.js](src/platform/twikki.platform.js) via a plain `<script>` tag and then calls `window.twikki.init()` followed by `window.twikki.start()` on `load`. There is no external bootloader or OS layer anymore.

- **`init()`** — all core modules are **bundled by Vite**: the code modules via static `import`s and the shadow-tiddler data via `import coreDefaults from '../generated/core.defaults.json'` (see the `CORE_MODULES` list at the top of the platform). `collectModules()` assembles `tw.modules` from those imports — **nothing is fetched for core**. `baseUrl` is still resolved (from `BASE_URL`, default `https://cawoodm.github.io/twikki`, overridable in index.html; a `localhost`/`IP:port` host uses `location.origin`) for **package** loading. There is no `localStorage` module cache; a one-time boot sweep drops legacy `/modules/*` keys.
- **`start()`** — `eval`s each `script/js` module (each merges its `tw.run`/`tw.store`/`tw.util` contributions at eval), merges JSON modules into the in-memory tiddler store, then loads extension packages from the URL lists in the `$CorePackages` and `$ExtensionPackages` shadow tiddlers.

**The platform is a minimal kernel** (~900 lines): it statically imports the core modules (so Vite bundles them), runs the boot lifecycle (`init`/`start`/`onPageLoad`/`reload`), hosts the plugin lifecycle, owns the controlled eval boundary for plugins (`executeText`) and the raw localStorage primitive (`tw.storage`). Everything else lives in core modules — see the load-ordered list in [docs/MODULES.md](docs/MODULES.md): `core.common`, `core.js` (events), `core.sections`, `core.params`, `core.templater`, `core.dom`, **`core.store`** (the workspace-scoped `tw.store` + persistence), **`core.tiddlers`** (CRUD/accessors/predicates → `tw.run`), **`core.render`** (the renderTWikki pipeline), **`core.settings`** (layered settings — see below), `core.defaults.json`, `core.notifications`, **`core.ui`** (event wiring, nav, the basic edit round-trip, `tw.commands`/`tw.extensions`), `core.workspaces`, `core.packaging`, `core.search`. Storage layering: `localStorage ← tw.storage (platform, raw) ← tw.store (core.store, scoped /ws/<name>/) ← consumers` — modules and plugins use `tw.store` only (lint-enforced).

**Settings** are layered: `tw.core.common.getSetting(path, def)` (alias of `tw.core.settings.get`) resolves **user (`/settings.json`, cross-workspace) → workspace (`$Settings` tiddler) → registered default**, then expands `${secret:KEY}` references from the device-local, never-synced `secrets.txt` store. Core modules and plugins **declare** their settings via an optional `settings` block on the object they return (`{default, type?, description?, options?}` per dotted path); the platform collects them and deep-merges the defaults into `$Settings` after every load. The Settings dialog offers a per-field user/workspace toggle. See [docs/SETTINGS.md](docs/SETTINGS.md).

**The no-plugin invariant.** The core modules must stand alone: with **zero plugins** TWikki still loads the shadow tiddlers, renders (escaped-plain-text markdown fallback), creates/edits/section-edits/validates/saves, navigates and searches. **`?safemode` is _not_ zero-plugins** — it skips only the **extension** packages (`$ExtensionPackages`); the **base** package (`$CorePackages`) still loads, so its plugins (including `$BaseMarkdownPlugin`) run and markdown still renders. A plugin failure may cost shortcuts, the preview pane, the dirty dot, the rich boot dialog or drag-and-drop — never the ability to open a tiddler and save a fix. The `?safemode` boot is exercised by [test/e2e/decomposition.spec.js](test/e2e/decomposition.spec.js).

**Module delivery & updates.** Core modules ship **with the platform build** — they are part of the app shell, not independently-versioned downloads. Caching and updates are owned by the **service worker** (Workbox precache, revisioned per build; see [plans/OFFLINE.md](plans/OFFLINE.md)): a new deploy delivers new modules and the SW updates on the standard PWA lifecycle (silent on next load, or behind an "update available" prompt). `fetchModules` simply `fetch()`es each module same-origin (SW-served offline) — **no `localStorage` module cache, no `?reload`/`?update`, and no core compatibility gate** (a module bundled with the platform can't be out of step with it). The old `checkModuleCompat` + lazy compat dialog are gone. A core module still declares `version`/`platform` consts, but they are **documentation only** now. The first online load with no precache yet (e.g. first-ever visit offline) shows a plain `haltNoModules()` message. Plugins keep their own **soft** compat gate (`checkPluginCompat`) since they arrive as editable tiddlers/packages. See [docs/MODULES.md](docs/MODULES.md).

**Plugin metadata & the registry.** A `$Plugin`-tagged tiddler's IIFE returns `{meta: {name, version, platform?, description?, author?, url?}, init?, start?}` — the `meta` object is the single source of truth for plugin metadata. `loadPlugins()` evals each plugin, validates `meta.name`/`meta.version`, computes caret compat against `VERSION`, and populates `tw.plugins[]` — a flat array of `{meta, init, start, source, package, compat, error}`. `initPlugins`/`startPlugins` capture init/start throws onto `entry.error`. **The plugin compat gate is soft**: a `block` or `warn` entry does NOT prevent the plugin from running — the surrounding try/catch already isolates failures from boot, and the `<<plugins>>` widget surfaces status so the user can decide. `<<pluginMeta Name>>` renders one plugin's live meta (used in the `# Meta` section of the base plugin tiddlers so docs never drift from code). See [docs/PLUGINS.md](docs/PLUGINS.md) for the full developer reference; [`Plugins.tid`](src/packages/website/Plugins.tid) is the in-app overview.

Core modules under `src/modules/` are **ES modules** (the platform `import`s them; Vite bundles them — see the Module contract below). **Plugins and `$Script` tiddlers are different**: they arrive as editable tiddlers/package JSON and are still `eval`'d at runtime (the `(1, eval)(...)` indirect-eval boundary is intentional, to evaluate at global scope). **Do not add `import`/`export` statements to files under `src/packages/<pkg>/`** — plugins must remain plain IIFEs/scripts.

Markdown rendering is event-driven: `core.render` dispatches via the `markdown.render` event and falls back to escaped plain text when no handler is subscribed (i.e. with zero plugins, or if `$BaseMarkdownPlugin` is disabled — note `?safemode` still loads it). `$BaseMarkdownPlugin` (base package) provides the default markdown-it implementation and exposes it as `tw.core.markdown = {md, render}`; replace it from any package with `tw.events.override('markdown.render', function myMarkdown(text) {...})`.

### Module contract

A core module under [src/modules/](src/modules/) is an **ES module** that default-exports a factory taking `tw` and returning `{name, version, platform, [exports], [run]}`. The platform statically imports each factory (so Vite bundles it) and calls it once with `tw`:

```js
export default function(tw) {
  const name = 'core.foo';
  const version = '0.0.1';            // this module's own version (semver)
  const platform = '0.24.0';          // platform release this module was built for (documentation only)
  const exports = { ... };           // merged into tw.core.foo by the platform
  const run = () => { ... };          // optional, invoked after all modules load
  return {name, version, platform, exports, run};
}
```

`version` and `platform` are plain `const '...'` literals that the module returns in its meta. They are **documentation only** — core modules ship with the platform build, so there is no boot-time compatibility gate reading them (see the "Module delivery & updates" notes in the Boot chain section above and [docs/MODULES.md](docs/MODULES.md)).

`tw` is the global namespace. Subsystems hang off it: `tw.events` (pub/sub), `tw.tiddlers` (`.all`/`.visible`/`.trashed`), `tw.storage` (localStorage wrapper), `tw.run` (action API), `tw.ui`, `tw.core.*` (subsystem exports), `tw.macros`, `tw.plugins` (flat plugin registry — see "Plugin metadata & the registry" above; `tw.plugin(name)` looks up an entry by `meta.name`).

### Source → runtime: the compile step

Tiddler sources live as **individual files** under `src/packages/<pkg>/` and `src/modules/<pkg>/`. The compile step packs each subdirectory into a single JSON file in `public/packages/` or `public/modules/` matching the directory name. The runtime fetches those JSON files; the loose source files are never served directly. Note: `src/modules/` also contains loose `core.*.js` files at its top level — those are the runtime **code modules**, now imported by the platform and **bundled by Vite** (not served as loose files), distinct from `src/modules/core.defaults/`, which gets compiled into `src/generated/core.defaults.json` (gitignored) and **imported by the platform** — bundled by Vite, not fetched.

**Both `public/packages/` and `public/modules/` are gitignored** — they're build artifacts. Under `npm run dev` they're regenerated automatically by the Vite plugin on every source change; outside the dev server, run `npm run compile`.

Tiddler file format (parsed by [vite-plugin-tiddler-compile.js](vite-plugin-tiddler-compile.js)):

- Filename (without extension) becomes the tiddler `title`.
- Leading lines matching `^[a-z]+: value` are parsed as metadata fields (`tags:` is comma-split, `true`/`false` are coerced to booleans). The first non-matching line begins the `text` body.
- Type is derived from the extension: `.tid → x-twikki`, `.js → script/js`, `.md → markdown`, `.json → json`, `.css → css`, `.html → html`.
- Auto-tags are keyed on the **package directory name**: files in `src/packages/base/` get `$NoEdit`; files in `src/modules/core.defaults/` get `$Shadow`; any `.css` file gets `$StyleSheet` (and tags stack — a `.css` file in `base/` gets both).

A leading `$` in a tiddler title is a convention for shadow/system tiddlers (e.g. `$MainLayout`, `$CorePackages`, `$Theme`).

### Theming: CSS cascade layers

`$CoreThemeManager` ([src/packages/base/$CoreThemeManager.js](src/packages/base/$CoreThemeManager.js)) composes one constructable stylesheet as `@layer base, plugin, theme, user`. The `base` layer is hardcoded — always `$BaseReset` + `$BaseVariables` — and a theme cannot opt out. The `plugin` layer is auto-collected: the manager walks every `$Plugin`-tagged tiddler and pulls its `# StyleSheet` section (sorted alphabetical-by-title), so plugins ship CSS inside their own `.tid` file without registering anywhere. The `theme` layer is the active `$Theme` tiddler's bullet list, in concatenation order. The `user` layer is `$StyleSheetUser`, applied last; cross-layer, later layers win regardless of selector specificity, so the user always wins.

Core stylesheets in [src/modules/core.defaults/](src/modules/core.defaults/): `$BaseReset` and `$BaseVariables` (base layer) plus `$CoreThemeLayout`, `$CoreThemeAppearance`, `$CoreThemePalette`, `$CoreThemeDarkPalette` (theme layer). The default `$Theme` shadow tiddler points to `$CoreThemeLight`; `$CoreThemeDark` swaps the palette tiddler. Every CSS variable must have a default in `$BaseVariables` — [test/unit/tokens.test.js](test/unit/tokens.test.js) enforces this. Dark themes carry the `$ThemeDark` tag (drives the highlight.js sheet swap — no name-sniffing).

Built-in interaction plugins in [src/packages/base/](src/packages/base/) (`$SettingsDialogPlugin`, `$PickerPlugin`, `$TabsPlugin`, `$ExplorerPlugin`, `$CommandPalette`, `$UnsavedChangesPlugin`) are composite plugin directories compiled into multi-section tiddlers with `# Code` (JS), `# StyleSheet` (CSS), and `# Meta` (a `<<pluginMeta Name>>` macro displaying the live meta from the code's `meta` object) sections. See [docs/THEMES.md](docs/THEMES.md) and [website/Plugins.tid](src/packages/website/Plugins.tid).

### Localhost rewriting

When running on `localhost` or a `*.*.*.*:port` host, the platform rewrites `https://cawoodm.github.io/twikki` URLs in `$CorePackages`/`$ExtensionPackages` to the local origin (see the shadow-tiddler loop in `start()` in `src/platform/twikki.platform.js`) so local source serves instead of the published copy. This is how `npm run dev` loads the in-repo packages.

### Debugging query params

Useful when something goes wrong (the platform try/catches modules by default, which can swallow errors):

- `?trace` — disable try/catch wrapping so real stack traces surface.
- `?debug` — enable `console.debug` (suppressed by default).
- `?clear` — clear `localStorage`. (Core modules are no longer cached in `localStorage`, so there is no `?reload`/`?update`; a plain reload re-fetches them, served by the service worker offline.)
- `?safemode` — skip extension package loading.
- `?logfilter=regex` / `?breakpoint=regex` — filter `dp()` logs / break on matching event names.
