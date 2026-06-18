(function () {
  const meta = {
    name: 'Explorer',
    version: '1.0.1',
    platform: '0.27.0',
    description: 'Sidebar tree showing all tiddlers grouped by tag.',
  };

  let notesEl;
  let tagsEl;

  function wireUp(event, handler) {
    tw.events.subscribe(event, handler, 'ExplorerPlugin');
  }

  function bindHandlers() {
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
    // Hide $-titled tiddlers (convention) AND tiddlers excluded by the search tag
    // settings, so the Notes list matches what search shows (e.g. $Theme/$StyleSheet).
    let visibleByTag = tw.core.search?.tagFilter ? tw.core.search.tagFilter() : () => true;
    let titles = tw.tiddlers.all
      .filter(tw.util.titleMatch('!^\\$'))
      .filter(visibleByTag)
      .map(t => t.title)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    let rows = titles.map(title => `<a class="explorer-note${open.has(title) ? ' open' : ''}" data-note="${attr(title)}" title="${attr(title)}">${esc(title)}</a>`).join('');
    return `<div class="explorer-section-title">Notes</div>${rows || '<div class="explorer-empty">No notes yet</div>'}`;
  }

  function tagsHtml() {
    let tags = tw.run
      .allTags()
      .filter(t => !/^\$/.test(t)) // hide system tags
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    if (!tags.length) return '';
    let pills = tags.map(t => `<a class="explorer-tag" data-tag="${attr(t)}">${esc(t)}</a>`).join('');
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
    tw.events.send('ui.open.all', {
      tag: row.getAttribute('data-tag'),
      title: '*',
    });
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

  return {
    meta,
    init() {
      // The explorer owns the sidebar, so the toggle command lives here.
      tw.extensions.registerCommand({
        label: 'Toggle sidebar',
        run: () => document.getElementById('sidebar')?.classList.toggle('open'),
      });

      wireUp('ui.loaded', bindHandlers);
      wireUp('ui.reloaded', bindHandlers);

      // Keep the note list current as the store changes.
      ['tiddler.created', 'tiddler.updated', 'tiddler.deleted', 'tiddler.removed', 'tiddler.modified'].forEach(ev => wireUp(ev, render));
      // Keep the "open" highlight current as tabs open/close.
      ['ui.ready', 'story.changed'].forEach(ev => wireUp(ev, render));
    },
  };
})();
