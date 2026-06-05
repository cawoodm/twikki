# CHANGELOG

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
* **Code highlighting** — `$HighlightPlugin` for syntax highlighting in code tiddlers.
* Focus the editor automatically when editing a tiddler.

### Misc
* Refactored the Favorites plugin and the test framework plugin.
* Removed the legacy `x-twiki` type alias (use `x-twikki`).
* Expanded docs: `MODULES.md`, `THEMES.md`, multipart-plugin design notes, and tag documentation.
