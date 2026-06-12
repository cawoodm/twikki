# Recent Sidebar View — Plan

Add a “Recent” section to the left sidebar listing the most recently modified non-system tiddlers. Clicking a row opens + activates the tiddler, identical to `#explorer-notes` behaviour.

Goal: a complete, useful feature with minimum new surface area. The data (`modified` timestamp) is already on every tiddler, the refresh events already exist, the click-delegation pattern is already established by `$ExplorerPlugin`. This is the smallest piece of the `## Tabs:` line in `TODO.tid` that produces something testable and ships on its own.

This plan deliberately defers the sidebar-tab UI (switching between Notes / Tags / Recent / Favorites / History). Designing that for one view is premature; add Recent as a third section below `#explorer-tags` for now, revisit tabs when at least one of Favorites or History also lands.

-----

## Files

|File                                                  |Action                                                                   |
|------------------------------------------------------|-------------------------------------------------------------------------|
|`src/packages/base/$RecentPlugin.js`                  |**new** — ~60 lines, mirrors `$ExplorerPlugin.js` structure              |
|`src/modules/core.defaults/$MainLayout.html`          |add `<div id="explorer-recent"></div>` after the `#explorer-tags` section|
|`docs/PACKAGES.md` (or wherever the plugin list lives)|one-line mention                                                         |

No new CSS required for v1 — reuse the existing `.explorer-list` styling for row consistency. If a section header rule is wanted, add a `#explorer-recent h2` (or equivalent) selector to `$CoreThemeAppearance.css`.

-----

## Plugin shape

Direct call to `tw.core.markdown.render(...)` for the section heading (gives themes a styling hook through normal markdown CSS), HTML for the rows (preserves the `data-msg` / `data-params` click contract that `$ExplorerPlugin` and `$TabsPlugin` already use).

```js
// tags: $Plugin

/**
 * ## Description
 * Fills #explorer-recent with the N most recently modified non-system tiddlers,
 * sorted by `modified` descending. Rows open + activate on click via the same
 * data-msg / data-params delegation used by $ExplorerPlugin.
 *
 * Rebuilds live on note create/update/delete (subscribes to the same event set
 * as $ExplorerPlugin) so editing a note moves it to the top of the list.
 */
(function() {

  const LIMIT = 20;
  let el;

  wireUp('ui.loaded', init);
  wireUp('ui.reloaded', init);

  ['tiddler.created', 'tiddler.updated', 'tiddler.deleted',
   'tiddler.removed', 'tiddler.modified'].forEach(ev => wireUp(ev, render));

  function init() {
    el = document.getElementById('explorer-recent');
    if (el) render();
  }

  function render() {
    if (!el) return;
    const recent = tw.tiddlers.all
      .filter(t => !t.title.startsWith('$') && t.modified)
      .sort((a, b) => b.modified - a.modified)
      .slice(0, LIMIT);
    if (!recent.length) { el.innerHTML = ''; return; }
    const heading = tw.core.markdown.render('## Recent');
    const rows = recent.map(t =>
      `<li data-msg="tiddler.show" data-params="${attr(t.title)}">${esc(t.title)}</li>`
    ).join('');
    el.innerHTML = `<div class="explorer-recent">${heading}<ul class="explorer-list">${rows}</ul></div>`;
  }

  function esc(s) { return s.replace(/[&<>"]/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function attr(s) { return esc(s); }

})(tw);
```

-----

## Design decisions made

- **Filter:** non-system only (`!t.title.startsWith('$')`), matching `$ExplorerPlugin`’s convention. System tiddlers churn constantly and would drown the list.
- **Sort key:** `modified`, not `created`. “Recent” means “recently edited.”
- **Count:** hard-coded `LIMIT = 20`. Configurable via `$GeneralSettings` is a follow-up — premature to design that for one view.
- **Grouping:** flat list. “Today / Yesterday / Earlier” headers are a follow-up. The list is short enough that flat reads fine.
- **Display:** title only. Modification time as a tooltip (`title` attribute) is a follow-up if it turns out to be wanted.
- **Empty state:** render nothing (`el.innerHTML = ''`). No “Nothing here yet” noise.
- **Refresh trigger:** same event set as `$ExplorerPlugin` — guarantees the two lists stay in sync.
- **Rendering split:** markdown for the heading (theme picks up `h2` styling for free), HTML for the rows (preserves the click contract). One `<div class="explorer-recent">` wrapper provides the styling hook.
- **Location:** new section below `#explorer-tags`. Layout file owns the container; plugin only fills it.

-----

## Out of scope (deliberately)

- Sidebar tabs / view switcher. Defer until at least one of Favorites or History also lands.
- Time grouping, configurable limit, modification-time display. Small follow-ups that don’t change the architecture.
- “History” tab (recently *viewed*). Needs view tracking that doesn’t exist yet; separate feature.
- Coalescing repeat-fire events into a single render. Patterned in `$TabsPlugin.js` if it’s ever needed — for 20 rows and a handful of fires per save, an extra render is invisible. Worth doing only if performance bites.

-----

## Acceptance

- New `#explorer-recent` section appears in the sidebar below tags.
- Lists up to 20 most recently modified non-system tiddlers, newest first.
- Editing a note moves it to the top of the list within the same render cycle.
- Clicking a row opens the note and activates its tab (matches `#explorer-notes` behaviour).
- Creating a new note adds it to the top.
- Deleting a note removes it from the list.
- Empty state: section is invisible (no header, no empty list).