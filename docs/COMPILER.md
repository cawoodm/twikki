# The Tiddler Compiler

Documentation for [vite-plugin-tiddler-compile.js](../vite-plugin-tiddler-compile.js).

## What it is

`vite-plugin-tiddler-compile.js` (at the repo root) is the build tool that packs TWikki's tiddler source files into the JSON blobs the runtime actually fetches. It serves three roles in one file:

1. **A Vite plugin** (default export `tiddlerCompile`), used by [vite.config.js](../vite.config.js) during `npm run dev` and `npm run build`.
2. **A standalone Node CLI** when executed directly: `node vite-plugin-tiddler-compile.js`. This is what `npm run compile` invokes.
3. **A library of pure helpers** (`getType`, `getAutoTags`, `parseFile`, `compilePackage`) that the unit tests in [tests/unit/compile-plugin.test.js](../tests/unit/compile-plugin.test.js) import and exercise directly.

It replaced the earlier PowerShell script `ci/compile-packages.ps1`, making the compile step cross-platform pure Node.

## The source layout it expects

The plugin is configured with one or more "source sets", each a pair of `sourceRoot` and `outputDir`:

```js
{ sourceRoot: 'src/packages', outputDir: 'public/packages' }
{ sourceRoot: 'src/modules',  outputDir: 'public/modules'  }
```

Within each `sourceRoot`, every immediate **subdirectory** is treated as one package. Files at the top level of the `sourceRoot` are ignored — that is deliberate: `src/modules/core.js`, `src/modules/core.common.js`, etc. are loose runtime modules served as-is by Vite. Only `src/modules/core.defaults/` (a subdirectory) gets compiled.

```
src/packages/
  base/        → public/packages/base.json
  demo/        → public/packages/demo.json
  themes/      → public/packages/themes.json
  ...
src/modules/
  core.defaults/   → public/modules/core.defaults.json
```

Each output JSON has the shape `{ "tiddlers": [ ... ] }`.

## The tiddler file format

Every file inside a package directory becomes one tiddler. `parseFile` does the conversion. The resulting tiddler object has these fields:

| Field     | Source                                                                  |
| --------- | ----------------------------------------------------------------------- |
| `title`   | filename without extension                                              |
| `type`    | derived from extension via `getType` (see table below)                  |
| `created` | file birthtime (ISO 8601)                                               |
| `updated` | file mtime (ISO 8601)                                                   |
| `tags`    | auto-tags (see below) merged with any from a `tags:` metadata line      |
| `text`    | everything after the metadata header                                    |
| _other_   | any `^[a-z]+: value` line becomes a top-level field on the tiddler      |

### Type mapping (`getType`)

| Extension | Tiddler type |
| --------- | ------------ |
| `.tid`    | `x-twikki`   |
| `.md`     | `markdown`   |
| `.js`     | `script/js`  |
| `.json`   | `json`       |
| `.css`    | `css`        |
| `.html`   | `html`       |
| other     | `''`         |

### Metadata header

The parser starts in "meta" mode. Each leading line matching `/^[a-z]+: /` is parsed as `field: value`. The first line that does **not** match flips the parser into "text" mode for the remainder of the file (line breaks preserved, trailing blank lines stripped). Special cases:

- `tags: foo, bar` is comma-split and merged with auto-tags.
- String values `true` / `false` are coerced to booleans.

### Auto-tags

`getAutoTags(packageName, ext)` adds tags based on package and extension. **Tags stack:**

| Trigger                  | Tag added       |
| ------------------------ | --------------- |
| package `base`           | `$NoEdit`       |
| package `core.defaults`  | `$Shadow`       |
| extension `.css`         | `$StyleSheet`   |

So a `.css` file under `src/packages/base/` ends up with both `$NoEdit` and `$StyleSheet`.

Line endings are normalized: `\r` is stripped before splitting on `\n`, so Windows-authored files behave the same as Unix-authored ones.

## Vite integration

`tiddlerCompile(sourceSets)` returns a Vite plugin with two hooks:

- **`buildStart`** — runs `compileAll(sourceSets)`: a full sweep that recompiles every package in every source set. This ensures `public/packages/` and `public/modules/` are fresh before the dev server serves them or before `vite build` copies them into `dist/`.

- **`configureServer`** — registers each `sourceRoot` with `server.watcher`, then attaches `change` / `add` / `unlink` handlers. When a file inside any source set is touched, `findPackageForFile` identifies which package owns it and `compilePackage` recompiles **only that one package**, not the whole tree.

The browser is reloaded separately, by the small `reload` plugin in [vite.config.js](../vite.config.js) that listens for `.json` file changes and sends a `{type: 'full-reload'}` WebSocket message. The two plugins are deliberately decoupled: tiddler-compile produces JSON; reload notices the JSON landed and refreshes.

## Standalone CLI mode

At the bottom of the file:

```js
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const root = process.cwd();
  compileAll([
    {sourceRoot: join(root, 'src/packages'), outputDir: join(root, 'public/packages')},
    {sourceRoot: join(root, 'src/modules'),  outputDir: join(root, 'public/modules')},
  ]);
}
```

This block runs only when the file is invoked directly (`node vite-plugin-tiddler-compile.js`). It calls `compileAll` against the two hard-coded source sets, rooted at `process.cwd()`. This is what `npm run compile` triggers. When the file is imported by `vite.config.js` as a module, the block is skipped.

## Invariants worth remembering

- `public/packages/` and `public/modules/` are gitignored. They are pure build artifacts; never commit them.
- **Adding a new package** = creating a new subdirectory under `src/packages/<name>/`. No registration step is needed; the plugin discovers directories at compile time.
- **Adding a tiddler** = dropping a file into an existing package directory. Re-saving any file triggers the watcher in dev mode.
- Files at the **top level** of `src/modules/` are not compiled. They are loose runtime modules served by Vite directly.
- The runtime fetches `public/modules/<name>` and `public/packages/<name>` and `eval`s the contents; the loose source files are never served.
