# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server on port 3002 (root is `src/`, opens browser, host-exposed). The [vite-plugin-tiddler-compile.js](vite-plugin-tiddler-compile.js) plugin runs on `buildStart` and watches sources, so package JSON regenerates automatically on source change; the secondary `reload` plugin in [vite.config.js](vite.config.js) then triggers a full browser reload on any `.json` write. |
| `npm run compile` | Runs `node vite-plugin-tiddler-compile.js` standalone — regenerates `public/packages/*.json` and `public/modules/*.json` from sources in `src/packages/<pkg>/` and `src/modules/<pkg>/`. Cross-platform (pure Node). Only needed outside the dev server, e.g. to seed `public/` before a `vite build` in a one-shot environment. |
| `npm run build` / `npm run build-test` | Vite production build into `dist/`, then runs `vite` from inside `dist/` (the trailing `vite` previews the built output). `build-test` adds `--open --host`. |
| `npm run publish` | Declared as `pwsh ci/publish.ps1`: assemble `dist/`, then commit & push to a sibling checkout at `../cawoodm.github.io/twikki/` (the GitHub Pages target). |
| `npm test` | `node --test --watch ./tests/unit/*.test.js`. Coverage is currently limited to the compile plugin ([tests/unit/compile-plugin.test.js](tests/unit/compile-plugin.test.js)); the runtime platform itself has no unit tests. |

Lint is configured ([eslint.config.mjs](eslint.config.mjs)) but is not wired into an `npm` script. Notable rule overrides: `no-eval` off (the runtime evaluates module strings), single quotes, `object-curly-spacing: never`, `complexity` warns at 40, `require-await` error. Globals `tw` and `dp` are declared.

## Architecture

todo...

### Boot chain

[src/index.html](src/index.html) loads [src/platform/twikki.platform.js](src/platform/twikki.platform.js) via a plain `<script>` tag and then calls `window.twikki.init()` followed by `window.twikki.start()` on `load`. There is no external bootloader or OS layer anymore.

- **`init()`** — resolves `baseUrl` from the `MODULE_URL` constant (can be overriden in index.html, default `https://cawoodm.github.io/twikki`); on a `localhost`/`IP:port` host it instead uses `location.origin` so the dev server serves local sources (around line 72 of `twikki.platform.js`). There is no `?pUrl`/`?url` query override and no `/base.url` localStorage key. It then fetches the hard-coded core modules listed in the `modulesToLoad` array (around line 86), each from `<baseUrl>/modules/<name>` (or returns cached copies from `localStorage`).
- **`start()`** — `eval`s each `script/js` module, merges JSON modules into the in-memory tiddler store, then loads extension packages from the URL lists in the `$CorePackages` and `$ExtensionPackages` shadow tiddlers.

The runtime never imports anything via ESM — modules are strings of JS loaded over HTTP and `eval`'d (the `(1, eval)(...)` indirect-eval pattern is intentional, to evaluate at global scope). **Do not add `import`/`export` statements to files under `src/modules/` or `src/packages/<pkg>/`** — they must remain plain IIFEs/scripts.

### Module contract

A core module under [src/modules/](src/modules/) is an IIFE that takes `tw` and returns `{name, version, [exports], [run]}`:

```js
(function(tw) {
  const name = 'core.foo';
  const exports = { ... };           // merged into tw[name] by the platform
  const run = () => { ... };          // optional, invoked after all modules load
  return {name, version: '0.0.1', exports, run};
})(tw);
```

`tw` is the global namespace. Subsystems hang off it: `tw.events` (pub/sub), `tw.tiddlers` (`.all`/`.visible`/`.trashed`), `tw.storage` (localStorage wrapper), `tw.run` (action API), `tw.ui`, `tw.core.*` (subsystem exports), `tw.macros`, `tw.plugins`.

### Source → runtime: the compile step

Tiddler sources live as **individual files** under `src/packages/<pkg>/` and `src/modules/<pkg>/`. The compile step packs each subdirectory into a single JSON file in `public/packages/` or `public/modules/` matching the directory name. The runtime fetches those JSON files; the loose source files are never served directly. Note: `src/modules/` also contains loose `core.*.js` files at its top level — those are the runtime modules listed in `modulesToLoad` and are served as-is (no compile step), distinct from `src/modules/core.defaults/` which gets compiled into `public/modules/core.defaults.json`.

**Both `public/packages/` and `public/modules/` are gitignored** — they're build artifacts. Under `npm run dev` they're regenerated automatically by the Vite plugin on every source change; outside the dev server, run `npm run compile`.

Tiddler file format (parsed by [vite-plugin-tiddler-compile.js](vite-plugin-tiddler-compile.js)):
- Filename (without extension) becomes the tiddler `title`.
- Leading lines matching `^[a-z]+: value` are parsed as metadata fields (`tags:` is comma-split, `true`/`false` are coerced to booleans). The first non-matching line begins the `text` body.
- Type is derived from the extension: `.tid → x-twikki`, `.js → script/js`, `.md → markdown`, `.json → json`, `.css → css`, `.html → html`.
- Auto-tags are keyed on the **package directory name**: files in `src/packages/base/` get `$NoEdit`; files in `src/modules/core.defaults/` get `$Shadow`; any `.css` file gets `$StyleSheet` (and tags stack — a `.css` file in `base/` gets both).

A leading `$` in a tiddler title is a convention for shadow/system tiddlers (e.g. `$MainLayout`, `$CorePackages`, `$Theme`).

### Localhost rewriting

When running on `localhost` or a `*.*.*.*:port` host, the platform rewrites `https://cawoodm.github.io/twikki` URLs in `$CorePackages`/`$ExtensionPackages` to the local origin (see `src/platform/twikki.platform.js` around lines 156–157) so local source serves instead of the published copy. This is how `npm run dev` loads the in-repo packages.

### Debugging query params

Useful when something goes wrong (the platform try/catches modules by default, which can swallow errors):
- `?trace` — disable try/catch wrapping so real stack traces surface.
- `?debug` — enable `console.debug` (suppressed by default).
- `?reload` / `?update` — force re-download of OS/modules instead of using `localStorage` cache.
- `?clear` — clear `localStorage`.
- `?safemode` — skip extension package loading.
- `?logfilter=regex` / `?breakpoint=regex` — filter `dp()` logs / break on matching event names.
