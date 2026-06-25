# Modules & Packages

The Twikki Platform loads code via HTTP:
* It's core behaviour via modules (fixed)
* Base functionality via a `base` package (defined in $CorePackages)
* Custom/user functionality listed in $ExtensionPackages

**Note:** An important distinction between modules and packages is that modules apply across all workspaces whereas packages are defined per-workspace. For a given host (domain/localStorage) you have one version of standard modules installed but each workspace may have different versions of packages/plugins.

> For developers, both modules and packages are bundled from source files by the custom [COMPILER.md](./COMPILER.md) into `.json`.
> This document covers what happens **after** compilation — the runtime side.

The platform lives in [src/platform/twikki.platform.js](../src/platform/twikki.platform.js) which is the only script referenced in index.html. It will load modules from `window.MODULE_URL/modules` which you can override.

## Modules

In load order (`modulesToLoad`, ordered by logical dependency — most cross-module
references are runtime `tw.run.*`/`tw.events` calls, resolved after every module
has been eval'd):

* `core.common`: Pure, DOM-free utilities (hashing, sorting, html escaping, `notEmpty`, base64 encoder/decoder) — loads **first**, no dependencies
* `core.js`: `tw.events` — the pub/sub event bus
* `core.sections`: Section-reference grammar + text slicing — strictly `(text, sectionName)`; anything taking a *title* lives in `core.tiddlers`
* `core.params`: Parameter parsing for widgets and macros
* `core.templater`: Tiny mustache-style template engine (pure library)
* `core.dom`: Functionality for dealing with the DOM
* `core.store`: Owns `tw.store` — the public, **workspace-scoped** persistence API (`get`/`set`/`delete`/`keys`, raw `exportRaw`/`importRaw` for dump/restore, `global` for unscoped keys like `/settings.json`) — plus persisting the tiddler store itself (`save`/`saveAll`/`saveVisible`/`loadStore`, the `doNotSave` policy). Layering: `localStorage ← tw.storage (platform, raw) ← tw.store (core.store, scoped) ← consumers`. **Only the platform and core.store touch localStorage** (lint-enforced).
* `core.tiddlers`: Listing, getting, changing tiddlers — CRUD, show/hide, `Title::Section` reference resolution, text/data accessors, predicates, validation, code-block selection. Merges the tiddler action API into `tw.run` and the legacy predicates into `tw.util`.
* `core.render`: The TWikki render pipeline — `renderTWikki` (macros/inclusions/links), element creation from templates, markdown dispatch via the overridable `markdown.render` event (escaped-plain-text fallback when no handler is subscribed, e.g. zero plugins; note `?safemode` still loads `$BaseMarkdownPlugin`), DOM inclusion attributes
* `core.defaults.json`: Essential tiddlers/content we need to run. These "shadow" tiddlers can be overridden by users. Some examples are:
  * Icons: Some basic (ugly) icons. Users will typically load their own "icons" package.
  * Themes: 2 basic themes (CoreThemeLight & CoreThemeDark)
  * Layout: Templates for the main site's HTML ($MainLayout) or parts thereof ($TiddlerDisplay)
* `core.notifications`: Functionality for showing alerts and messages
* `core.ui`: UI builders (buttons, dialogs, sections), layout rendering, event wiring (bus + DOM), navigation/`sendCommand`, and the **basic edit round-trip** (create/edit/validate/save works with zero plugins — the no-plugin invariant). Also installs `tw.commands` and `tw.extensions` (`registerMacro`, `registerCommand`/`registerCommandProvider`).
* `core.workspaces`: Manages the **active** workspace (`tw.workspace`); `core.store` reads it to scope `tw.store`
* `core.packaging`: HTTP import/merge of `{tiddlers: []}` package bundles
* `core.search`: Search functions


### Loading & updating modules

Core modules are **bundled into the platform by Vite**, not fetched at runtime. The platform statically `import`s each code module (`src/modules/core.*.js`, now `export default function (tw) {…}` factories) and the shadow-tiddler data (`src/generated/core.defaults.json`, compiled from `src/modules/core.defaults/`). `collectModules()` just assembles `tw.modules` from those imports — **nothing is downloaded at boot** and there is no `localStorage` module cache, no `?reload`/`?update`, and no compatibility gate. The only same-origin fetches left are the **packages** (`$CorePackages`/`$ExtensionPackages`), which are the per-workspace, user-extensible layer.

Updates are owned by the **service worker** (see [OFFLINE.md](../plans/OFFLINE.md)): a new `vite build` produces a new hashed bundle, the Workbox precache is revisioned, and the SW updates on the standard PWA lifecycle (silently on next load, or behind an "update available" prompt). To wipe local *data* use `?clear`.

### Versioning

Each core module still declares a `const version` (its own API version, semver) and may declare a `const platform`, and returns them in its meta — but these are now **documentation only**. Because a module is bundled with the platform that imports it, it can never be out of step, so there is **no boot-time compatibility gate for core modules** (the old `checkModuleCompat` + on-demand compat dialog are gone). Plugins are different: they arrive as editable tiddlers/packages and keep their own **soft** compat gate — see `checkPluginCompat` and [PLUGINS.md](./PLUGINS.md).

The `semver`/`semverCompare`/`caretSatisfies` helpers in `twikki.platform.js` (between the `/* BEGIN semver helper */` sentinels, unit-tested by [test/unit/semver.test.js](../test/unit/semver.test.js)) remain — they back the plugin compat gate.
