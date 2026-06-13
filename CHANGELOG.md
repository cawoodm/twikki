# CHANGELOG

## 13 Jun 2026 (v0.25.0)

### Platform decomposition
* **`core.store`** — new module owning `tw.store`, the workspace-scoped persistence API (`get`/`set`/`delete`/`keys`, raw `exportRaw`/`importRaw`, `global` for unscoped keys like `/settings.json`). Lint bans `localStorage` outside `platform` and `core.store`.
* **`core.tiddlers`** — extracted from the platform: CRUD, show/hide, `Title::Section` references, validation, code-block selection.
* **`core.render`** — extracted from the platform: render pipeline, template loading, markdown dispatch.
* **`core.ui`** — grew to own event wiring (bus + DOM), navigation, command registry, and the basic edit round-trip; the no-plugin invariant means a tiddler can be created/edited/saved with ZERO plugins.
* **Platform shrinks to a kernel** — module load + plugin lifecycle orchestration.

### New plugins (extracted from the platform)
* **`$DropZonePlugin`** — file drag-and-drop handlers.
* **`$EditorToolsPlugin`** — Ctrl+Enter save hotkey, preview pane.
* **`$TiddlerMetaInfoPlugin`** — the package / `doNotSave` / `isRawShadow` meta-line.

### Boot order refactor
* `init()` runs `fetchModules` (the compat gate); `start()` runs `loadModules` → `legacyAliases` → store load → `runModules` → packages → `reload()`. The previous `onPageLoad` wrapper is gone — the sequence reads top-to-bottom in one function.
* `loadCoreModules` → **`loadCorePackages`** (it loads packages, not core modules).
* Post-render event renamed `story.rendered` → **`ui.ready`**; visible-set shrinks fire **`story.changed`**.
* New **[BOOT.md](docs/BOOT.md)** documents the full sequence: timeline, invariants, lifecycle events, query params, failure modes.

### Plugin contract
* **`meta.dependencies`** — soft check. `checkPluginDependencies` warns when a declared dep is missing but the plugin still initialises.
* **`<<pluginMeta NAME>>`** macro — reads live `meta` from `tw.plugins[]` so a plugin's `# Meta` section can never drift from the code.
* **`{meta, init?, start?}`** is the only plugin contract — `tw.extensions.registerPlugin` is gone.

### Compiler
* **Composite plugin directories** — a `$Plugin` source can live in `<DirName>/<DirName>.md` + sibling `.js`/`.css`/`.json` files, stitched at compile time via `[include](./file)` so VS Code lints the embedded code natively. All 6 base interaction plugins migrated.
* Compiler skips hidden subdirs (`.git`, `.DS_Store`, …) and isolates per-composite errors so a single bad dir no longer takes down the whole package compile.

### Boot progress
* Drop the `tw.tmp` buffer + `core.js` bus replay; the `window` `twikki.boot.progress` CustomEvent is now the sole live channel into a splash UI.
* `handleModuleErrors` returns `true` so callers correctly bail; the failure H1 names the failing module(s).

### Editor
* **Ctrl+Enter** save hotkey moved from the deprecated `keypress` event to **`keydown`** + `preventDefault()`. Real keyboards are unchanged; automation tools (Playwright, chrome-devtools MCP) can now drive the hotkey.
* New `tests/e2e/editor-hotkeys.spec.js` (5 cases) covers the hotkey.

### Fixes
* **`$ExtensionPackages` URLs** — `./packages/…` → `/packages/…` (the `./` resolved to `localhost:3003./packages/…` and broke boot package loads).
* **`--search-hit-bg`** default declared in `$BaseVariables`.

## 9 Jun 2026 (v0.24.0)

* **Module Versioning** — Modules report version and platform compatability; Dialog so user can update or keep current versions.
* **Three-layer CSS cascade** — `$CoreThemeManager` composes `@layer base, theme, user`; user layer always wins regardless of specificity.
* **ThemeSelector fix** — active theme now correctly highlighted in the selector.
* **E2E tests** added
* **sendCommand fix** — follow-up correction to unified command parameter decode chain.
* **GitHub Actions** — Claude Code Review and PR Assistant workflows added.

## 6 Jun 2026 (v0.23.0)
* BaseMarkdownPlugin: Moved markdown rendering out of core to a plugin which can be overridden
* **Named-parameter values may contain colons** — `getKeyVal` now splits on the first `:` only, so URLs and other colon-bearing values work as named parameters (`<<fetch url:https://example.com>>`); previously truncated at the first colon. A colon-less token no longer throws.
* **Editor cursor starts at the top** — editing a tiddler used to land the cursor at the end of the body; it now starts at the top with the textarea scrolled up.
* **Macro parameter errors no longer kill the page** — a throwing parameter parse (e.g. a bad `{expr}` eval token) used to escape the per-macro guard and abort rendering of the entire tiddler; it now renders an inline error span for just that macro.
* **Standard widgets emit single-line HTML** — `selector`, `ThemeSelector`, `WorkspaceSelect` and `TagInput` no longer contain newlines, so they can be used inside markdown table cells; fixed unclosed `<span>` in `TrashCanStatus`.
* **New help tiddlers** — `StandardMacros` (all standard widgets with live examples) and `ParametersTests` (live demonstrations of parameter gotchas).
* **JSON macro parameters** — `parseParams` now parses payloads starting with `{`/`[` as strict JSON, so macros accept objects/arrays like commands do: `<<greet {"name":"John Smith", "age":22}>>`. Invalid JSON falls through to the legacy tokenizer.
* **Unified command parameters** — `sendCommand(cmd, params, currentTiddlerTitle)` replaces the old `param`/`params` pair, and `data-params` is the only payload attribute (`data-param` is no longer read; a `console.warn` flags stale content). One decode chain for all payloads: `---enc:` decode → `$currentTiddler` substitution → `{{{js}}}` eval → JSON (`{`/`[`/`"`) → named `key:value` params → bare strings pass through raw (titles with spaces are safe; `:` is not a valid title character). Positional `cmd:a b` splitting and bare-scalar coercion are gone — use JSON arrays / typed JSON instead. `tw.ui.button()` now accepts any payload type (objects as JSON, others stringified). Documented in the `Parameters` help tiddler.

## 5 Jun 2026 (v0.22.0)

### Core dialog API
* **`tw.ui.dialog()`** — new core dialog API so any plugin gets consistent dialog chrome: title, content region, toolbar buttons (event-dispatching or JS handlers), and automatic DOM cleanup on close (including Escape). Shared `dialog.tw-dialog` styling driven by theme CSS variables.
* **Theme importer migrated** to the core dialog API as the first consumer (behavior unchanged).

### Unsaved changes
* **`$UnsavedChangesPlugin`** — shows which tiddlers have unsaved changes: diffs the in-memory store against the last-saved state, listing new/modified/deleted tiddlers with a short change summary (text/tags/type deltas) as a tooltip. Save and Close actions; rows open the tiddler.
* **Dirty indicator** — a `●` button in the header (both layouts) appears when there are unsaved changes and opens the dialog; tooltip shows the change count.
* **Cancelled-leave detection** — if the user tries to leave the page and cancels the browser warning, the unsaved-changes dialog opens automatically (custom UI is not allowed inside `beforeunload` itself).
* `setDirty()` now publishes a `dirty.changed` event (resolves an old TODO).
* **Escape now cancels the editor properly** — same as the Cancel button, so the dirty flag is cleared and a never-saved tiddler is hidden again.

## 3 Jun 2026 (v0.21.0)
* Header based themes
* Pills for tags and packages
* Icons for workspace and theme selection

## 2 Jun 2026 (v0.20.1)

### Sections
* **Sections support** — a tiddler can now be split into named sections, addressed as `Parent::Section` (the `::` delimiter keeps `/` free for a future directories concept). This enables:
  * **Single-file plugins** — a whole plugin can live in one multipart tiddler.
  * **Single-file themes** — a theme and its stylesheet(s) packaged in one tiddler.
* New `core.sections` module (with unit tests) to parse and resolve sections from a parent tiddler's text.
* Section views are **read-only**: section cards have no delete button, and the edit button redirects to editing the parent note (`section.edit` / `editTiddlerSection`).

### Themes
* **Tagged (single-file) themes** — themes converted from separate `.css` + `.tid` files into a single multipart `.tid` tiddler. Aurora, Broadsheet, Bubblegum, Kontrast, Manuscript, Nocturne, Terminal, Obsidian, and Skeleton all migrated.
* Theme names now carry an explicit `Dark` suffix where appropriate (e.g. `AuroraThemeDark`).
* Compiler support for tagging themes via metadata.

### Settings & Search
* **Settings dialog** — new `$SettingsDialogPlugin` providing an in-app settings UI.
* **Search filtering** — include/exclude tags for search, configurable from the settings dialog (`excludeTags`). Major rewrite of `core.search`.

### Editing
* **Code highlighting** — `$CodeSyntaxHighlightPlugin` for syntax highlighting in code tiddlers.
* Focus the editor automatically when editing a tiddler.

### Misc
* Refactored the Favorites plugin and the test framework plugin.
* Removed the legacy `x-twiki` type alias (use `x-twikki`).
* Expanded docs: `MODULES.md`, `THEMES.md`, multipart-plugin design notes, and tag documentation.
