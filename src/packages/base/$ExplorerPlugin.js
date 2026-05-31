/**
 * ## Description
 * Fills the left sidebar with an Obsidian-style explorer: a list of notes
 * (non-system tiddlers, sorted) and a list of tags. Rows are clickable —
 * notes open + activate their tab; tags open all matching notes.
 *
 * Renders into `#explorer-notes` / `#explorer-tags` (provided by the layout)
 * and rebuilds live on note create/update/delete and on story changes (to keep
 * the "open" highlight current). Reuses `tw.macros.core.allTags()` and
 * `tw.util.titleMatch`.
 */
/**
 * ## Data
 * ```json
 * {
 *   "version": 1.0.0
 * }
 * ```
 */
// ## Code
// ```javascript
(function() {

  let notesEl;
  let tagsEl;

  wireUp('ui.loaded', init);
  wireUp('ui.reloaded', init);

  // Keep the note list current as the store changes.
  ['tiddler.created', 'tiddler.updated', 'tiddler.deleted', 'tiddler.removed', 'tiddler.modified']
    .forEach(ev => wireUp(ev, render));
  // Keep the "open" highlight current as tabs open/close.
  ['story.rendered', 'story.changed'].forEach(ev => wireUp(ev, render));

  function init() {
    notesEl = document.getElementById('explorer-notes');
    tagsEl = document.getElementById('explorer-tags');
    if (notesEl && !notesEl._explorerBound) {
      notesEl._explorerBound = true;
      notesEl.addEventListener('click', onNoteClick);
    }
    if (tagsEl && !tagsEl._explorerBound) {
      tagsEl._explorerBound = true;
      tagsEl.addEventListener('click', onTagClick);
    }
    render();
  }

  function render() {
    if (notesEl) notesEl.innerHTML = notesHtml();
    if (tagsEl) tagsEl.innerHTML = tagsHtml();
  }

  function notesHtml() {
    let open = new Set(tw.tiddlers.visible);
    let titles = tw.tiddlers.all
      .filter(tw.util.titleMatch('!^\\$'))
      .map(t => t.title)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    let rows = titles.map(title =>
      `<a class="explorer-note${open.has(title) ? ' open' : ''}" data-note="${attr(title)}" title="${attr(title)}">${esc(title)}</a>`,
    ).join('');
    return `<div class="explorer-section-title">Notes</div>${rows || '<div class="explorer-empty">No notes yet</div>'}`;
  }

  function tagsHtml() {
    let tags = tw.macros.core.allTags()
      .filter(t => !/^\$/.test(t)) // hide system tags
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    if (!tags.length) return '';
    let pills = tags.map(t =>
      `<a class="explorer-tag" data-tag="${attr(t)}">${esc(t)}</a>`,
    ).join('');
    return `<div class="explorer-section-title">Tags</div><div class="explorer-tags-list">${pills}</div>`;
  }

  function onNoteClick(e) {
    let row = e.target.closest('[data-note]');
    if (!row) return;
    let title = row.getAttribute('data-note');
    tw.events.send('tiddler.show', title);
    if (tw.tabs) tw.tabs.activate(title);
    closeDrawer();
  }

  function onTagClick(e) {
    let row = e.target.closest('[data-tag]');
    if (!row) return;
    tw.events.send('ui.open.all', {tag: row.getAttribute('data-tag'), title: '*'});
    closeDrawer();
  }

  function closeDrawer() {
    document.getElementById('sidebar')?.classList.remove('open');
  }

  function attr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function esc(s) {
    return tw.core.common.escapeHtml(String(s));
  }

  function wireUp(event, handler) {
    tw.events.subscribe(event, handler, 'ExplorerPlugin');
  }

})();
