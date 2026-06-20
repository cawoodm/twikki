# CHANGELOG

## 20 Jun 2026 (v0.27.0)

### Features

- **IndexedDB** — Break out of the 5MB limit by using IndexedDB storage. With the IndexedDBStoragePlugin your existing notes are migrated automatically.
- **Docker** — Run Twikki in a container with `npm run docker`.
- **Multi-Tab Workspaces** — Open a different workspace in each browser tab, work in them side by side and drag data between them.
- **Browse all macros** — a new `<<macros>>` reference lists every macro available in your wiki with its description and an example.
- **Package Import** - new dialog to view tiddlers before importing, options to save and reload
- **Auto Save** option to disable automatic local saves
- **Disable Plugins** plugins macro offers checkbox to disable

### Bugs/Technical

- **More resilient** — Twikki now recovers gracefully when an extension fails to load and stays fully usable in safe mode.
- **No accidental self-drops** — dragging a note onto itself no longer triggers an import.
- **"Close others" keeps the right note** — closing other notes now reliably keeps the one you're currently viewing.
- **Your place is remembered** — the active note (selected tab) is restored when you reload.
- **New notes open in tabs view** — creating a note while the tabs layout is active now switches to and shows the new note, instead of leaving the previous tab on screen.
- **Workspace switch** — switching or creating a workspace with unsaved changes now prompts to save first instead of silently discarding them
- **Saving** — persistence now splits into `autoSave()` (respects the Auto Save setting) and `save()` (always persists). With Auto Save off, toggling a plugin, editing a code/template tiddler, or restoring a Gist backup and choosing "reload" now persists the change before reload instead of discarding it; settings changes always persist.

## 15 Jun 2026 (v0.26.0)

- **Drag-and-drop of tiddlers** — Drag and drop tiddlers between windows with the `$DragAndDropTiddlersPlugin` or drag in a package (.json file with `{tiddlers: [...]}`)
- **Plugin-contributed types** — `tw.extensions.registerType(key, label)` adds entries to the new/edit dialog's type picker; built-in `$TiddlerTypes` shadow merges with `tw.types` (plugin entries win on collision).
- **CsvRenderer** — Support `.csv` type tiddlers rendered as tables
- **CodeRendererPlugin** — Renders `code` tiddlers as syntax-highlighted blocks
- **Plugin Dependencies** — `initPlugins`/`startPlugins` order entries by `meta.dependencies`, so a plugin's deps run before it's dependencies (e.g. $OpenLinksInNewWindow requires BaseMarkdown plugin
- **Tiddler validation** — Write custom validators which check content for validity before saving (e.g. $PluginValidator checks Plugins)
- **Template validator** — Checks tiddlers tagged `$Template` before save so the UI is not destroyed
- **`<<tags>>` macro** — picker pill listing every tag in the store; clicking an item runs `search` with `tag:<name>`.
- **Better render-error surfacing in UI** — tiddler render failures now bubble up as inline `<span class="error">` markers in the affected card instead of silently breaking the page.
- **Search highlight fixes** — also fires for already-open tiddlers (the `tiddler.refocus` path, not just `tiddler.rendered`); darker default `--search-hit-bg` for better contrast.

## 13 Jun 2026 (v0.25.0)

- **Platform decomposition** — `core.store` / `core.tiddlers` / `core.render` extracted out of the platform; `core.ui` grew to own wiring, nav, command registry and the basic edit round-trip. Platform shrinks to a kernel.
- **New plugins** extracted from the platform: `$DropZonePlugin`, `$EditorToolsPlugin`, `$TiddlerMetaInfoPlugin`.
- **Boot order refactor** — Documented in new [BOOT.md](docs/BOOT.md).
- **Plugin `meta.dependencies`** — soft check warns on missing deps but the plugin still initialises.
- **`<<pluginMeta NAME>>`** macro — renders a plugin's live `meta` from `tw.plugins[]` so `# Meta` sections can never drift from code.
- **Composite plugin directories** — `<DirName>/<DirName>.md` + sibling `.js`/`.css`/`.json` stitched at compile time via `[include](./file)` so VS Code lints embedded code natively; all 6 base plugins migrated.
- **Compiler hardening** — skip hidden subdirs (`.git`, `.DS_Store`); per-composite ENOENT isolation.
- **Boot progress** — `window.twikki.boot.progress` CustomEvent is the sole live channel; `tw.tmp` buffer + bus replay dropped.
- **Ctrl+Enter save hotkey** — moved from deprecated `keypress` to `keydown`; now driveable from automation. New e2e suite covers it.
- **Storage layering** — lint bans `localStorage` outside `platform` and `core.store`; `DumpWorkspace` and `SettingsDialog` go through `tw.store`.
- **Fixes** — `$ExtensionPackages` URLs (`./packages/…` → `/packages/…`); `--search-hit-bg` default declared in `$BaseVariables`; `handleModuleErrors` returns `true` so callers bail.

## 9 Jun 2026 (v0.24.0)

- **Module Versioning** — Modules report version and platform compatability; Dialog so user can update or keep current versions.
- **Three-layer CSS cascade** — `$CoreThemeManager` composes `@layer base, theme, user`; user layer always wins regardless of specificity.
- **ThemeSelector fix** — active theme now correctly highlighted in the selector.
- **E2E tests** added
- **sendCommand fix** — follow-up correction to unified command parameter decode chain.
- **GitHub Actions** — Claude Code Review and PR Assistant workflows added.

## 6 Jun 2026 (v0.23.0)

- BaseMarkdownPlugin: Moved markdown rendering out of core to a plugin which can be overridden
- **Named-parameter values may contain colons** — `getKeyVal` now splits on the first `:` only, so URLs and other colon-bearing values work as named parameters (`<<fetch url:https://example.com>>`); previously truncated at the first colon. A colon-less token no longer throws.
- **Editor cursor starts at the top** — editing a tiddler used to land the cursor at the end of the body; it now starts at the top with the textarea scrolled up.
- **Macro parameter errors no longer kill the page** — a throwing parameter parse (e.g. a bad `{expr}` eval token) used to escape the per-macro guard and abort rendering of the entire tiddler; it now renders an inline error span for just that macro.
- **Standard widgets emit single-line HTML** — `selector`, `ThemeSelector`, `WorkspaceSelect` and `TagInput` no longer contain newlines, so they can be used inside markdown table cells; fixed unclosed `<span>` in `TrashCanStatus`.
- **New help tiddlers** — `StandardMacros` (all standard widgets with live examples) and `ParametersTests` (live demonstrations of parameter gotchas).
- **JSON macro parameters** — `parseParams` now parses payloads starting with `{`/`[` as strict JSON, so macros accept objects/arrays like commands do: `<<greet {"name":"John Smith", "age":22}>>`. Invalid JSON falls through to the legacy tokenizer.
- **Unified command parameters** — `sendCommand(cmd, params, currentTiddlerTitle)` replaces the old `param`/`params` pair, and `data-params` is the only payload attribute (`data-param` is no longer read; a `console.warn` flags stale content). One decode chain for all payloads: `---enc:` decode → `$currentTiddler` substitution → `{{{js}}}` eval → JSON (`{`/`[`/`"`) → named `key:value` params → bare strings pass through raw (titles with spaces are safe; `:` is not a valid title character). Positional `cmd:a b` splitting and bare-scalar coercion are gone — use JSON arrays / typed JSON instead. `tw.ui.button()` now accepts any payload type (objects as JSON, others stringified). Documented in the `Parameters` help tiddler.

## 5 Jun 2026 (v0.22.0)

### Core dialog API

- **`tw.ui.dialog()`** — new core dialog API so any plugin gets consistent dialog chrome: title, content region, toolbar buttons (event-dispatching or JS handlers), and automatic DOM cleanup on close (including Escape). Shared `dialog.tw-dialog` styling driven by theme CSS variables.
- **Theme importer migrated** to the core dialog API as the first consumer (behavior unchanged).

### Unsaved changes

- **`$UnsavedChangesPlugin`** — shows which tiddlers have unsaved changes: diffs the in-memory store against the last-saved state, listing new/modified/deleted tiddlers with a short change summary (text/tags/type deltas) as a tooltip. Save and Close actions; rows open the tiddler.
- **Dirty indicator** — a `●` button in the header (both layouts) appears when there are unsaved changes and opens the dialog; tooltip shows the change count.
- **Cancelled-leave detection** — if the user tries to leave the page and cancels the browser warning, the unsaved-changes dialog opens automatically (custom UI is not allowed inside `beforeunload` itself).
- `setDirty()` now publishes a `dirty.changed` event (resolves an old TODO).
- **Escape now cancels the editor properly** — same as the Cancel button, so the dirty flag is cleared and a never-saved tiddler is hidden again.

## 3 Jun 2026 (v0.21.0)

- Header based themes
- Pills for tags and packages
- Icons for workspace and theme selection

## 2 Jun 2026 (v0.20.1)

### Sections

- **Sections support** — a tiddler can now be split into named sections, addressed as `Parent::Section` (the `::` delimiter keeps `/` free for a future directories concept). This enables:
  - **Single-file plugins** — a whole plugin can live in one multipart tiddler.
  - **Single-file themes** — a theme and its stylesheet(s) packaged in one tiddler.
- New `core.sections` module (with unit tests) to parse and resolve sections from a parent tiddler's text.
- Section views are **read-only**: section cards have no delete button, and the edit button redirects to editing the parent note (`section.edit` / `editTiddlerSection`).

### Themes

- **Tagged (single-file) themes** — themes converted from separate `.css` + `.tid` files into a single multipart `.tid` tiddler. Aurora, Broadsheet, Bubblegum, Kontrast, Manuscript, Nocturne, Terminal, Obsidian, and Skeleton all migrated.
- Theme names now carry an explicit `Dark` suffix where appropriate (e.g. `AuroraThemeDark`).
- Compiler support for tagging themes via metadata.

### Settings & Search

- **Settings dialog** — new `$SettingsDialogPlugin` providing an in-app settings UI.
- **Search filtering** — include/exclude tags for search, configurable from the settings dialog (`excludeTags`). Major rewrite of `core.search`.

### Editing

- **Code highlighting** — `$CodeSyntaxHighlightPlugin` for syntax highlighting in code tiddlers.
- Focus the editor automatically when editing a tiddler.

### Misc

- Refactored the Favorites plugin and the test framework plugin.
- Removed the legacy `x-twiki` type alias (use `x-twikki`).
- Expanded docs: `MODULES.md`, `THEMES.md`, multipart-plugin design notes, and tag documentation.
