# Vite Compile Plugin — Design Spec
**Date:** 2026-04-27

## Goal

Replace the PowerShell compile script (`ci/compile-packages.ps1`) with a self-contained Vite plugin (`vite-plugin-tiddler-compile.js`) that compiles tiddler source files into JSON packages. Eliminates the Windows-only tooling dependency while keeping the existing fetch-based runtime loading unchanged.

## Architecture

A single file `vite-plugin-tiddler-compile.js` at the project root exports a factory function `tiddlerCompile(sourceDirs)`. It is imported in `vite.config.js` with two source sets:

```
src/packages/ → public/packages/
src/modules/  → public/modules/
```

### Vite Plugin Hooks

| Hook | Behaviour |
|---|---|
| `buildStart` | Full compile of all packages in all source sets |
| `configureServer` | Registers watchers via `server.watcher`; on any source file change, recompiles only the affected package |
| `watchChange` | Same incremental recompile for `vite build --watch` mode |

The existing `reload` plugin in `vite.config.js` (full-reload on `.json` change) is kept as-is — it handles browser notification.

## Compile Logic

Each source subdirectory (e.g. `src/packages/demo/`) maps to one output file (`public/packages/demo.json`).

Steps per package:
1. `fs.readdirSync(dir)` — list files, no subdirectory recursion
2. For each file: read raw text, parse leading `key: value` lines as metadata, remainder as `text`
3. Auto-tags: `$NoEdit` for `base`, `$Shadow` for `core.defaults`, `$StyleSheet` for `.css` files
4. Type from extension: `.js→script/js`, `.css→css`, `.tid→x-twikki`, `.md→markdown`, `.json→json`, `.html→html`
5. Timestamps: `fs.statSync().birthtime` → `created`, `.mtime` → `updated`
6. Write `JSON.stringify({tiddlers: [...]})` to output file

Output JSON format is identical to what the PowerShell script produces.

## Standalone CLI

The plugin detects when run directly (`process.argv[1] === fileURLToPath(import.meta.url)`) and runs a full compile then exits. This replaces `pwsh ci/compile-packages.ps1` in CI and for manual use.

`package.json` change:
```json
"compile": "node vite-plugin-tiddler-compile.js"
```

## Error Handling

- Parse/compile errors log to console and skip the offending file (matching current PowerShell behaviour)
- Each compile logs: `[tiddler-compile] Compiled demo → public/packages/demo.json (12 tiddlers)`

## Files Changed

| File | Change |
|---|---|
| `vite-plugin-tiddler-compile.js` | New — plugin + standalone CLI |
| `vite.config.js` | Import and register the plugin |
| `package.json` | Update `compile` script |
| `ci/compile-packages.ps1` | Delete |

## Out of Scope

- Virtual modules / bundled packages (runtime fetch approach preserved)
- Changes to `core.packaging.js` or any runtime loading code
- New tests (JSON output format unchanged; app loading verifies correctness)
