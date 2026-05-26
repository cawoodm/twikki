# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server on port 3002 (root is `src/`, opens browser, host-exposed). Hot-reload triggers on `.json` change via a custom plugin in [vite.config.js](vite.config.js). |
| `npm run compile` | Runs [ci/compile-packages.ps1](ci/compile-packages.ps1) — regenerates `public/packages/*.json` and `public/modules/*.json` from sources in `src/packages/<pkg>/` and `src/modules/`. **PowerShell-only** (Windows/pwsh). Must be re-run whenever you change a tiddler source file under `src/packages/`. A replacement Vite plugin is planned — see [docs/superpowers/specs/2026-04-27-vite-compile-plugin-design.md](docs/superpowers/specs/2026-04-27-vite-compile-plugin-design.md). |
| `npm run build` | Vite production build into `dist/`, then runs `vite` from inside `dist/`. |
| `npm run publish` | Runs [ci/publish.ps1](ci/publish.ps1) — assembles `dist/`, then commits & pushes to a sibling checkout at `../cawoodm.github.io/twikki/` (the GitHub Pages target). |
| `npm test` | Declared as `node --test --watch ./tests/unit/*.test.js`, but **there is no `tests/` directory** in the repo — the test target is currently empty/aspirational. |

Lint is configured ([eslint.config.mjs](eslint.config.mjs)) but is not wired into an `npm` script. Notable rule overrides: `no-eval` off (the runtime evaluates module strings), single quotes, `object-curly-spacing: never`, `complexity` warns at 40, `require-await` error. Globals `tw` and `dp` are declared.

## Architecture

This is **not a typical Vite SPA.** It's a TiddlyWiki-inspired wiki/app platform that boots itself dynamically from network-fetched JavaScript and JSON, caching everything in `localStorage` for offline use. Understanding the three-stage boot is essential before editing anything.

### Boot chain

1. **[public/boot.js](public/boot.js) (bootloader)** — loaded by [src/index.html](src/index.html). Reads an OS name + base URL (from query string, localStorage, or `window.boot({...})` parameters), downloads an OS JS/JSON blob, caches it under `/os/<name>` in `localStorage`, then `eval`s it. The OS object must export `init()` and `start()`. Index.html points at `weboose.latest` hosted at `https://cawoodm.github.io/weboose` — that loads back into TWikki via the `platform` parameter.
2. **OS layer** (weboose, external) — calls `platform.init()` and `platform.start()`.
3. **[src/platform/twikki.latest.js](src/platform/twikki.latest.js) (the TWikki platform)** — the real app. On `init()` it fetches the core modules listed in the `modulesToLoad` array (around line 81), each from `<baseUrl>/modules/<name>` (or returns cached copies from `localStorage`). On `start()` it `eval`s each `script/js` module and merges JSON modules into the in-memory tiddler store, then loads extension packages from URLs listed in the `$CorePackages` and `$ExtensionPackages` shadow tiddlers.

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

Tiddler sources live as **individual files** under `src/packages/<pkg>/` and `src/modules/`. The compile step packs each subdirectory into a single JSON file in `public/packages/` or `public/modules/` matching the directory name. The runtime fetches those JSON files; the loose source files are never served directly.

**Both `public/packages/` and `public/modules/` are gitignored** — they're build artifacts produced by `npm run compile`. If you edit a file in `src/packages/<pkg>/` and don't see the change, you need to re-run compile.

Tiddler file format (parsed by [ci/compile-packages.ps1](ci/compile-packages.ps1)):
- Filename (without extension) becomes the tiddler `title`.
- Leading lines matching `^[a-z]+: value` are parsed as metadata fields (`tags:` is comma-split). The first non-matching line begins the `text` body.
- Type is derived from the extension: `.tid → x-twikki`, `.js → script/js`, `.md → markdown`, `.json → json`, `.css → css`, `.html → html`.
- Auto-tags: `base/` files get `$NoEdit`; `core.defaults/` files get `$Shadow`; any `.css` gets `$StyleSheet`.

A leading `$` in a tiddler title is a convention for shadow/system tiddlers (e.g. `$MainLayout`, `$CorePackages`, `$Theme`).

### Localhost rewriting

When running on `localhost` or a `*.*.*.*:port` host, the platform rewrites `https://cawoodm.github.io/twikki` URLs in `$CorePackages`/`$ExtensionPackages` to the local origin (see `src/platform/twikki.latest.js` around line 151) so local source serves instead of the published copy. This is how `npm run dev` loads the in-repo packages.

### Debugging query params

Useful when something goes wrong (the platform try/catches modules by default, which can swallow errors):
- `?trace` — disable try/catch wrapping so real stack traces surface.
- `?debug` — enable `console.debug` (suppressed by default).
- `?reload` / `?update` — force re-download of OS/modules instead of using `localStorage` cache.
- `?clear` — clear `localStorage`.
- `?safemode` — skip extension package loading.
- `?logfilter=regex` / `?breakpoint=regex` — filter `dp()` logs / break on matching event names.
