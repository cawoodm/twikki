# Restore the last-viewed tab on reload

## Context

In **tabs mode** (the Obsidian-style tab strip in `$TabsPlugin.js`), several notes
are open at once but only the *active* one is shown. When you switch tabs and then
reload the page, the previously-active note is **not** restored — the app shows the
first/last open note instead. The user wants the last-viewed tiddler to be
displayed again after a reload.

### Root cause (confirmed)

The set of open notes IS persisted: `showTiddler`/`hideTiddler` keep
`tw.tiddlers.visible` and call `saveVisible()` → `tw.store.set('tiddlers-visible', …)`
(`src/platform/twikki.platform.js`), and `loadStore()` restores it on boot. But
**which tab was active is only in memory**: `$TabsPlugin.init()` (line 54) sets
`tw.tabs = {active: null, …}` on every load, and nothing writes `tw.tabs.active`
to storage. On reload `flush()` (lines 114-138) sees `active == null`, the
"single note just opened" branch doesn't apply (a bulk re-render of N notes), and
the neighbour-fallback picks first/last in `visible` — not the last-viewed note.

### Intended outcome

After switching tabs and reloading, the note that was active before the reload is
the one shown/focused — per workspace, and degrading gracefully if that note is no
longer open.

## Fix — all in `src/packages/base/$TabsPlugin.js`

Persist the active tab to the workspace-aware store and seed from it on boot.
`tw.store` is the right key space (same one `tiddlers-visible` uses), so each
workspace remembers its own active tab automatically.

1. **Add a tiny persistence helper** (single source for setting active):
   ```js
   const ACTIVE_KEY = 'tab-active';
   function setActive(title) {
     if (!tw.tabs) return;
     if (tw.tabs.active === title) return;          // avoid redundant writes
     tw.tabs.active = title;
     try { tw.store.set(ACTIVE_KEY, title); } catch {}   // workspace-namespaced
   }
   ```

2. **Seed `active` from storage in `init()`** (line 54): replace
   `tw.tabs = {active: null, …}` with a read of `tw.store.get(ACTIVE_KEY)`
   (guarded with try/catch, falling back to `null`).

3. **Route the two existing `tw.tabs.active = …` assignments through `setActive`:**
   - `flush()` line 131 (`if (tw.tabs) tw.tabs.active = active;`) → `setActive(active);`
   - `activate()` line 143 (`if (tw.tabs) tw.tabs.active = title;`) → `setActive(title);`

### Why this restores correctly (no ordering change needed)

`reload()` fires `ui.loaded` (→ `init()` seeds `active` from storage) and then
`renderAllTiddlers()` re-shows every visible note, each emitting `tiddler.rendered`
→ a coalesced `flush()`. In that flush `rendered.length > 1`, so the first branch is
skipped; and because the seeded `active` IS in `visible`, the neighbour-fallback
branch (`!visible.includes(active)`) is also skipped — `active` stays the restored
note, and `applyActive()` makes it the shown tab. If the stored note is no longer
open, `!visible.includes(active)` is true and the existing fallback runs (graceful).

### Scope / non-goals

- **River mode** is untouched (no tabs; `active` unused).
- **Per-tab scroll position** (`scrollPos`, line 42) remains in-memory only — out of
  scope unless requested; could be persisted the same way later.

## Verification

End-to-end via chrome-devtools MCP against the dev server (port 3002), in tabs mode
(`$GeneralSettings.layout.mode === 'tabs'`):

1. Open 3 notes (e.g. `Welcome`, `Concepts`, `Help`) so there are 3 tabs.
2. Click the 2nd or 3rd tab to make it active; confirm `tw.tabs.active` and that
   `tw.store.get('tab-active')` now equals that title.
3. Reload the page (`?reload`). **Expect:** the same note is the active/shown tab
   (`tw.tabs.active` === that title, and its `.tiddler` has `.tab-active`), not the
   first one.
4. Switch active note, close it, reload → falls back to a neighbour without error.
5. (If workspaces are in use) switch workspace and confirm each restores its own
   last active tab independently.
6. `npm test` still passes (no unit coverage for the plugin; confirm nothing breaks).
