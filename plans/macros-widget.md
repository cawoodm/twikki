# Plan: `<<macros>>` widget + macro metadata cleanup

## Context

Today `tw.macros` is a grab-bag. It holds three different kinds of thing:

1. **Real macros** — functions that return HTML/text and are called from tiddler content as `<<name args>>`. Resolved by `core.render.js`, which tries `tw.macros.<name>` first, then `tw.macros.core.<name>`.
2. **JS helpers** — `tw.macros.core.allTags`, `tw.macros.core.allProperty`, `tw.macros.core.showTiddlerList` — functions that return *data* (arrays/lists). Never called as `<<…>>` from any tiddler — only invoked from JS in other widgets/plugins. They're filed under `tw.macros` because that's where they were put, not because they belong there.
3. **Dead code** — `tw.macros.core.disabled`, `tw.macros.eval`. Zero callers anywhere.

Macro registrations are also done two different ways: half via `tw.extensions.registerMacro(ns, name, fn, options?)`, half via direct assignment (`tw.macros.X = …` or `Object.assign(tw.macros.core, {…})`). Neither path attaches a description, so `src/packages/website/StandardMacros.tid` hand-maintains a markdown table of every macro with description and example — guaranteed to drift.

The user wants a `<<macros>>` widget (sibling of `<<modules>>` and `<<plugins>>`) that auto-generates the reference table. To make that meaningful, every macro needs a `description` attached at registration time.

## Design

### 1. `tw.macros` holds only macros

A "macro" is something that returns HTML or text intended to be inserted at the call site. Anything that returns raw data, or is dead, gets moved out.

| Current | Returns | Disposition |
|---|---|---|
| `tw.macros.core.allTags` | `string[]` | → `tw.run.allTags` (5 JS callers updated) |
| `tw.macros.core.allProperty` | `string[]` | → `tw.run.allProperty` (1 JS caller updated) |
| `tw.macros.core.showTiddlerList` | thin alias to `tw.core.tiddlers.showTiddlerList` | **delete** — unused; `tw.run.showTiddlerList` is the canonical path |
| `tw.macros.core.disabled` | dead | **delete** |
| `tw.macros.eval` | `(code) => eval(code)` | **delete** |

`src/packages/website/StandardMacros.tid`'s "Helpers" section (which lists `<<allTags>>` and `<<allProperty>>`) is removed. `src/packages/base/ExplorerPlugin/ExplorerPlugin.md`'s prose reference to `tw.macros.core.allTags()` becomes `tw.run.allTags()`.

### 2. `registerMacro` 4th param: `meta`

`src/modules/core.ui.js`:

```js
// Before
registerMacro(namespace, name, fcn, options) {
  if (!tw.macros[namespace]) tw.macros[namespace] = {};
  tw.macros[namespace][name] = fcn;
  if (options) Object.assign(tw.macros[namespace][name], options);
},
// After (only the parameter name changes)
registerMacro(namespace, name, fcn, meta) {
  if (!tw.macros[namespace]) tw.macros[namespace] = {};
  tw.macros[namespace][name] = fcn;
  if (meta) Object.assign(tw.macros[namespace][name], meta);
},
```

`meta` shape (all optional):

- `description` — one-liner, what the macro does. Strongly recommended; the `<<macros>>` widget shows `–` if absent.
- `example` — string with the literal invocation, e.g. `'<<list tag:Help>>'`. Defaults to `<<ns.name>>` (or `<<name>>` for `core`).
- `version` — kept for backward compatibility (only `ExamplePlugin.tid` uses it today).

No `hidden` flag — after the cleanup in §1 everything in `tw.macros.*` is a real macro and gets listed.

### 3. Migrate every direct assignment to `registerMacro`

Files that today do `tw.macros.X = …` / `tw.macros.core.X = …` / `Object.assign(tw.macros.core, {…})` get rewritten to one `registerMacro` call per macro, with a description.

| File | Macros it currently defines (kept ones) | Refactor |
|---|---|---|
| `src/modules/core.ui.js` | `core.Tag`, `core.TagInput` (bootstrap defaults) | Use `registerMacro` after seeding `tw.macros = tw.macros || {}` |
| `src/packages/base/$GeneralWidgets.js` | `core.command`, `core.Reload`, `core.Save`, `core.Settings`, `core.New`, `core.TagInput` (overrides bootstrap), `core.AllTypesMacro` | Per-key `registerMacro` |
| `src/packages/base/$ListTiddlersWidgets.js` | `core.list`, `core.text`, `core.Section`, `core.Expand`, `core.Expose`, `core.AllTiddlersSimple`, `core.AllTagsSimple`, `core.AllTagsLinked` | Per-key `registerMacro`; `allTags`/`allProperty` extracted to `tw.run` |
| `src/packages/base/$ShowTiddlersWidgets.js` | `core.ShowAllTiddlersButton`, `core.CloseAllTiddlersButton` | Per-key `registerMacro` |
| `src/packages/base/$SelectorWidget.js` | `core.selector` | `registerMacro` |
| `src/packages/base/$WorkspaceWidgets.js` | `core.WorkspaceSelect`, `core.WorkspaceCreate` | Per-key `registerMacro` |
| `src/packages/base/$TrashedTiddlersFunctions.js` | `core.TrashCanIcon`, `core.TrashEmptyButton`, `core.TrashCanStatus`, `core.TrashCanContents` | Per-key `registerMacro` |
| `src/packages/base/$ButtonsFunctions.js` | `button` (top-level) | `registerMacro('core', 'button', …)` — short-name fallback keeps `<<button>>` working |
| `src/packages/base/$IncludeFunctions.js` | `include` (top-level), `eval` (delete) | `registerMacro('core', 'include', …)` |
| `src/packages/base/$PackageWidgets.js` | `packages.import`, `packages.importBin` | Per-key `registerMacro('packages', …)` |
| `src/packages/base/$ModulesWidget.js` | `core.modules` | `registerMacro` |
| `src/packages/base/$PluginsWidget.js` | `core.plugins`, `core.pluginMeta` | Per-key `registerMacro` |
| `src/packages/marc/MarcHacks.js` | `marc.loadThemeButton` | `registerMacro('marc', …)` |
| `src/packages/onboarding/$OnboardingMacros.js` | `welcome.Start`, `welcome.Step1`, `welcome.Step2`, `welcome.Step2Button` | Per-key `registerMacro('welcome', …)` |
| `src/packages/demo/$TiddlerManagerPlugin.js` | `manager.form` | `registerMacro('manager', …)` |
| `src/packages/demo/$FavoritesPlugin.js` | `favorites.toggle` | `registerMacro('favorites', …)` |
| `src/packages/base/$DumpWorkspacePlugin.js` | `dump.dumpButton` | `registerMacro('dump', …)` |
| `src/packages/base/$SynchDataPlugin.js` | `synch.full`, `synch.test`, `synch.pull`, `synch.push`, … | Per-key `registerMacro('synch', …)` |
| `src/packages/base/$ThemeImporterPlugin.js` | `themeImport.button` | `registerMacro('themeImport', …)` |
| `src/packages/base/$GistBackupPlugin.js` | `backup` (object assigned to `tw.macros.backup`) | Per-key `registerMacro('backup', …)` for each method |
| `src/packages/tests/$TestFrameworkPlugin.js` | `tests.queue`, `tests.clear`, `tests.run`, `tests.results` | Already `registerMacro`; add `description` |
| `src/packages/tests/TestParametersPlugin.tid` | `foo.hello`, `foo.test`, `foo.object` | Already `registerMacro`; add minimal `description` |
| `src/packages/base/$CoreThemeManager.js` | `core.ThemeSelector` | Already `registerMacro`; add `description` |
| `src/packages/base/TagsMacro.js` | `core.tags` | Already `registerMacro`; add `description` |
| `src/packages/website/ExamplePlugin.tid` | `example.hello` | Already `registerMacro`; rename `options` → `meta` in example, add `description` |

### 4. The `<<macros>>` widget

New file `src/packages/base/$MacrosWidget.js`:

```js
// tags: $Script
tw.extensions.registerMacro(
  'core',
  'macros',
  () => {
    const sections = [];
    const namespaces = Object.keys(tw.macros).sort();
    for (const ns of namespaces) {
      const bucket = tw.macros[ns];
      if (!bucket || typeof bucket !== 'object') continue;
      const names = Object.keys(bucket)
        .filter(n => typeof bucket[n] === 'function')
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      if (!names.length) continue;
      const rows = names.map(n => {
        const fn = bucket[n];
        const call = ns === 'core' ? n : `${ns}.${n}`;
        const desc = fn.description || '–';
        // Emit the example UNESCAPED so the renderer's next pass actually
        // invokes the widget in the cell. <<macros>> itself would recurse —
        // suppress it.
        const isSelf = ns === 'core' && n === 'macros';
        const ex = isSelf ? '(this widget)' : fn.example || `<<${call}>>`;
        return `| \`${call}\` | ${desc} | ${ex} |`;
      });
      sections.push(`### ${ns}`, '', '| Macro | Description | Example |', '|---|---|---|', ...rows, '');
    }
    return sections.join('\n');
  },
  {
    description: 'Lists every registered macro with description and example, grouped by namespace.',
    example: '<<macros>>',
  },
);
```

### 5. `Macros.tid`

New file `src/packages/website/Macros.tid` — Help-tagged. Briefly explains the mechanism then renders `<<macros>>`. `StandardMacros.tid` stays as the curated, live-rendered showcase (different focus: the inline-safe widgets actually rendered, not just listed).

### 6. Doc updates

- `docs/PARAMETERS.md` — rename `options` → `meta` in the `registerMacro` examples; add `description`.
- `docs/PLUGINS.md` — same.
- `docs/USP.md` — `registerMacro(ns, name, fn)` mention is fine as-is (no 4th-arg example to change).
- `src/packages/website/ExamplePlugin.tid` — the inline code example uses `{version: '1.0.0'}` as the 4th arg; switch to `{description: '…', version: '1.0.0'}`.
- `src/packages/base/ExplorerPlugin/ExplorerPlugin.md` — `tw.macros.core.allTags()` → `tw.run.allTags()`.

## Implementation order

1. Rename param + extract helpers (§1 + §2 — both in `core.ui.js` / `$ListTiddlersWidgets.js`). Update the 5 + 1 callsites for `allTags`/`allProperty`. Verify the unit and e2e suites still pass.
2. Migrate all direct assignments to `registerMacro` with descriptions (§3). One commit per file is overkill — one commit for the whole sweep, since each file is one mechanical conversion.
3. Add `$MacrosWidget.js` (§4). Verify `<<macros>>` renders.
4. Add `Macros.tid` (§5), update docs (§6).

## Out of scope

- Marking macros as deprecated, lifecycle hooks for unregistering, namespace listing per package.
- Cleaning up `MarcHacks.js` (the `if (0) { … }` snippet block at the bottom). It's not a macro issue.
- The `tests` namespace getting listed in `<<macros>>` outside of test packages — acceptable; the namespace appears in tw.macros only when the tests package is loaded.

## Risk

- Boot order: the bootstrap defaults in `core.ui.js` use `registerMacro` once `tw.macros` is seeded. `tw.extensions` is assigned earlier in the same module, so the call site is safe.
- `$GistBackupPlugin.js` currently assigns `tw.macros.backup = backup` where `backup` is an object with `.save`/`.restore` etc. Splitting into per-method `registerMacro` calls changes the shape only if external callers iterate `tw.macros.backup`'s own keys — they don't (`save`/`restore` are called via `tw.events.override` against `backup.save`/`backup.restore` references, which still exist on the function-with-meta).
- The widget walks `tw.macros` at call time, so any plugin that adds a macro after boot still shows up on the next render — no caching to invalidate.
