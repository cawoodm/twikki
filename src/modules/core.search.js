/**
 * Search
 * Ranked substring search over the tiddler store: exact-title > title >
 * fulltext, with `tag:`/`pck:`/`type:` field filters and a `$` prefix to
 * include hidden/system tiddlers. Tag-based visibility comes from
 * `$GeneralSettings.search` includeTags/excludeTags via `tagFilter` (also
 * exported, so the sidebar Notes list hides the same tiddlers). Also wires
 * the search box UI and renders the clickable results dropdown.
 */
(function (tw) {
  const name = 'core.search';
  const version = '0.26.0';
  const platform = '0.28.0'; // built for platform ^0.28.0

  // Exports
  const exports = {
    search,
    tagFilter,
  };

  const EXACT_TITLE_MATCH = 4;
  const TITLE_MATCH = 3;
  const TEXT_MATCH = 1;
  const reTag = /tag:\s*(\S+)\s?/;
  const rePck = /pck:\s*(\S+)\s?/;
  const reType = /type:\s*(\S+)\s?/;

  // Run
  const run = () => {
    tw.events.subscribe('ui.loading', wireUIEvents, name);
    tw.events.subscribe('search', searchQuery, name); // From #msg:search:foo events
    tw.events.subscribe('search.advanced', searchQueryAdvanced, name); // From #msg:search.advanced:pck:icons title:add
  };

  return {name, version, platform, exports, run};

  function searchQueryAdvanced({all = false, title, tag, pck, type, id}) {
    let q = '';
    if (title) q += ' ' + title;
    if (tag) q += ' tag:' + tag;
    if (pck) q += ' pck:' + pck;
    if (type) q += ' type:' + type;
    // tw.core.dom.$('search').value = q.trim();
    let results = search(q, tw.tiddlers.all, {all});
    if (id) searchShowResults(results, id);
    return results;
  }
  function searchQuery(q) {
    tw.core.dom.$('search').value = q.trim();
    searchNow();
  }
  function searchNow() {
    searchShowResults(search(tw.core.dom.$('search').value, tw.tiddlers.all));
  }
  function searchFocus() {
    // Re-search as data may have changed since last render
    searchShowResults();
    tw.core.dom.$('search-results').style.display = '';
  }
  function searchLoseFocus() {
    // Must delay or results disappear before they can be clicked
    window.setTimeout(() => {
      tw.core.dom.$('search-results').style.display = 'none';
    }, 150);
  }
  function searchShowResults(list, targetId = 'search-results') {
    let target = tw.core.dom.$(targetId);
    target.style.display = '';
    if (!list) return searchNow();
    target.innerHTML = '';
    list.forEach(t => {
      displayTiddlerLink(t, target);
    });
    if (targetId === 'search-results') positionDrawerResults();
  }

  // On phones the drawer is only ~220px wide, so the in-drawer dropdown would be
  // unreadably narrow. CSS makes #search-results a full-width (100vw) fixed
  // overlay on ≤600px; here we anchor its top just below the search input (the
  // input's Y depends on the drawer header height, so it can't be a CSS const).
  function positionDrawerResults() {
    const results = tw.core.dom.$('search-results');
    const input = tw.core.dom.$('search');
    if (!results || !input) return;
    if (window.matchMedia('(max-width: 600px)').matches) {
      results.style.top = Math.round(input.getBoundingClientRect().bottom) + 'px';
    } else if (results.style.top) {
      results.style.top = ''; // desktop: revert to the CSS dropdown (top:100%)
    }
  }
  function displayTiddlerLink({title, type}, target) {
    // TODO: Apply tw.templates.TiddlerSearchResult
    let newElement = document.createElement('div');
    newElement.className = 'tiddler-list'; // + (type ? ' line-clamp' : '');
    if (type) {
      // Make the whole highlighted row clickable, not just the text: the global
      // click handler resolves data-msg from the nearest ancestor, so the data
      // attributes live on the row itself. The inner link is kept for styling.
      newElement.setAttribute('data-msg', 'tiddler.show');
      newElement.setAttribute('data-params', JSON.stringify(title));
      newElement.appendChild(newTiddlerLink({title, type}));
    } else {
      newElement.innerHTML = title; // placeholder (e.g. "No results!") — not clickable
    }
    target = target || tw.core.dom.divSearchResults;
    target.insertAdjacentElement('beforeend', newElement);
  }
  function newTiddlerLink({title}) {
    let newElement = document.createElement('a');
    newElement.setAttribute('data-msg', 'tiddler.show');
    newElement.setAttribute('data-params', JSON.stringify(title));
    newElement.setAttribute('data-tiddler-backref', tw.core.common.hash(title));
    newElement.setAttribute('href', 'javascript:false;');
    newElement.innerText = title;
    return newElement;
  }

  /**
   * Sort alphabetically, search and return best matches first
   */
  function search(q, list, options = {}) {
    tw.logging.break('search');
    let results = list.sort(alphabetically).map(simpleSearch(q, options)).filter(notEmpty).sort(ranking);
    let title = 'No results!';
    if (!q.match(/^\$/) && !options.all) title += ` Type '\$${q}' to search hidden tiddlers!`;
    return results.length ? results.map(t => t.tiddler) : [{title}];
  }

  /**
   * Ranked substring search preferring title/tags match to fulltext
   */
  function simpleSearch(q, options = {}) {
    q = q.trim().toLowerCase();
    const Q = q;
    let searchAll = q[0] === '$';
    if (searchAll) q = q.substring(1);
    searchAll = searchAll || options.all;
    let searchTag = q.match(reTag)?.[1];
    if (searchTag) q = q.replace(reTag, '');
    let searchPackage = q.match(rePck)?.[1];
    if (searchPackage) q = q.replace(rePck, '');
    let searchType = q.match(reType)?.[1];
    if (searchType) q = q.replace(reType, '');
    q = q.trim();

    // Tag-based visibility (from $GeneralSettings.search). Computed once per search.
    // Skipped for `$…` ("search all") queries and explicit tag: queries so neither
    // ever traps a tiddler the user is asking for by name/tag.
    const tagVisible = tagFilter();
    const applyTagFilter = !searchAll && !searchTag;

    return t => {
      if (!searchAll && t.title[0] === '$') return;
      if (applyTagFilter && !tagVisible(t)) return;
      let titleText = t.title.toLowerCase();
      let fullText = titleText + t.text.toLowerCase();
      if (searchAll) fullText += t.type;

      // If field specified, it must match or exit
      let rank = 1;
      if (searchTag && !t.tags.find(t => t.toLowerCase() === searchTag)) rank = 0;
      if (searchPackage && searchPackage !== t.package) rank = 0;
      if (searchType && searchType !== t.type) rank = 0;
      if (rank === 0) return;
      if (q) {
        rank = titleText.indexOf(q) >= 0 ? rank + TITLE_MATCH : fullText.indexOf(q) >= 0 ? rank + TEXT_MATCH : 0;
        if (titleText === q || titleText === Q) rank += EXACT_TITLE_MATCH;
      } else if (Q === '') {
        rank = 1; // Return everything when no search is specified
      }
      if (rank === 0) return;
      return {
        rank,
        tiddler: t,
      };
    };
  }

  function alphabetically(a, b) {
    let A = a.title.toLowerCase();
    let B = b.title.toLowerCase();
    if (A < B) return -1;
    else return 1;
  }

  function ranking(a, b) {
    return a.rank > b.rank ? -1 : 1;
  }

  function notEmpty(v) {
    return !!v;
  }

  function parseTagList(v) {
    return String(v || '')
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean);
  }

  /**
   * Visibility predicate built from $GeneralSettings.search (whitelist first, then
   * blacklist). Returns a function (tiddler) → true if it should be VISIBLE.
   * Shared by search and the sidebar Notes list (ExplorerPlugin) so tag-based
   * hiding is consistent across the UI. Reads settings once; call per render/search.
   */
  function tagFilter() {
    const cfg = tw.run.getJSONObject('$GeneralSettings')?.search || {};
    const includeTags = parseTagList(cfg.includeTags);
    const excludeTags = parseTagList(cfg.excludeTags);
    if (!includeTags.length && !excludeTags.length) return () => true;
    return t => {
      const tags = (t.tags || []).map(x => x.toLowerCase());
      if (includeTags.length && !includeTags.some(tag => tags.includes(tag))) return false;
      if (excludeTags.some(tag => tags.includes(tag))) return false;
      return true;
    };
  }

  function wireUIEvents() {
    tw.core.dom.$('search')?.addEventListener('keyup', searchNow);
    tw.core.dom.$('search')?.addEventListener('focus', searchFocus);
    tw.core.dom.$('search')?.addEventListener('blur', searchLoseFocus);
    tw.core.dom.$('search-results').style.display = 'none';
    tw.core.dom.$('search-results').addEventListener('click', publishSearchClick);
    document.addEventListener('click', onDocumentClick);
    wireTopbarSearch();
    relocateSearch();
  }

  // Mobile top-bar search: the 🔍 icon morphs #main-topbar into a search field.
  // There is only ONE search box (#explorer-search, containing #search +
  // #search-results); relocateSearch() moves it into the top bar on phones and
  // back into the sidebar on wider screens. Tapping 🔍 drives the `.searching`
  // class and shows the full list. We call searchFocus() directly rather than
  // relying on .focus() to fire it: mobile browsers (notably iOS Safari) often
  // ignore programmatic focus on a just-revealed element, so the list would
  // never appear. .focus() is still attempted to raise the keyboard where allowed.
  function wireTopbarSearch() {
    const toggle = tw.core.dom.$('topbar-search-toggle');
    const close = tw.core.dom.$('topbar-search-close');
    if (!toggle) return;
    toggle.addEventListener('click', () => {
      document.getElementById('main-topbar')?.classList.add('searching');
      tw.core.dom.$('search')?.focus();
      searchFocus(); // show the full list even if the browser dropped the focus
    });
    close?.addEventListener('click', closeTopbarSearch);
    // A result click navigates via the global data-msg handler; also collapse the bar.
    tw.core.dom.$('search-results')?.addEventListener('click', e => {
      if (e.target.closest('[data-msg="tiddler.show"]')) closeTopbarSearch();
    });
  }
  function closeTopbarSearch() {
    document.getElementById('main-topbar')?.classList.remove('searching');
    const input = tw.core.dom.$('search');
    if (input) input.value = '';
    const results = tw.core.dom.$('search-results');
    if (results) {
      results.innerHTML = '';
      results.style.display = 'none';
    }
  }

  // Move the single #explorer-search box between the sidebar (its desktop/tablet
  // home, before #explorer) and the top bar (on phones, before the ✕ button) so
  // it escapes the drawer, which is translated off-screen. Listeners bound to
  // #search survive the reparent. Driven by the ≤600px media query.
  function relocateSearch() {
    const box = tw.core.dom.$('explorer-search');
    const sidebar = tw.core.dom.$('sidebar');
    const explorerNav = tw.core.dom.$('explorer');
    const topbar = tw.core.dom.$('main-topbar');
    const close = tw.core.dom.$('topbar-search-close');
    if (!box || !sidebar || !topbar) return;
    const mq = window.matchMedia('(max-width: 600px)');
    const place = () => {
      if (mq.matches) {
        topbar.insertBefore(box, close || null);
      } else {
        closeTopbarSearch(); // leaving phone width: drop the .searching state
        sidebar.insertBefore(box, explorerNav || null);
      }
    };
    place();
    mq.addEventListener('change', place);
  }

  // Event-triggered search (e.g. #msg:search:$tag:$Shadow) renders results without
  // focusing the input, so the blur handler never fires. This catches outside
  // clicks regardless of focus state.
  function onDocumentClick(event) {
    let results = tw.core.dom.$('search-results');
    if (!results || results.style.display === 'none') return;
    if (event.target.closest('#search-results')) return;
    if (event.target.closest('#search')) return;
    // The 🔍 toggle opens the search (focusing #search shows the list); without
    // this its click would bubble here and immediately hide what it just opened.
    if (event.target.closest('#topbar-search-toggle')) return;
    results.style.display = 'none';
  }

  function publishSearchClick(e) {
    const row = e.target.closest('[data-msg="tiddler.show"][data-params]');
    if (!row) return;
    let title;
    try {
      title = JSON.parse(row.getAttribute('data-params'));
    } catch {
      return;
    }
    const term = tw.core.dom.$('search').value || '';
    tw.events.send('search.result.clicked', {title, term});
  }
});
