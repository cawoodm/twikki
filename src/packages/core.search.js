(function(tw) {

  const name = 'core.search';
  const version = '0.0.1';

  // Exports
  const exports = {
    search,
  };

  const EXACT_TITLE_MATCH = 4;
  const TITLE_MATCH = 3;
  const TAG_MATCH = 2;
  const TEXT_MATCH = 1;
  const reTag = /tag:(\S+)\s?/;
  const rePck = /pck:(\S+)\s?/;

  tw.events.subscribe('ui.loading', wireUIEvents);
  tw.events.subscribe('search', searchQuery); // From #msg:search:foo events

  return {name, version, exports};

  function searchQuery(q) {
    tw.core.dom.$('search').value = q;
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
  function searchShowResults(list) {
    tw.core.dom.$('search-results').style.display = '';
    if (!list) return searchNow();
    tw.core.dom.divSearchResults.innerHTML = '';
    list.forEach(displayTiddlerLink);
  }
  function displayTiddlerLink({title, type}) {
  // TODO: Apply tw.templates.TiddlerSearchResult
    let newElement = document.createElement('li');
    newElement.className = 'tiddler-list'; // + (type ? ' line-clamp' : '');
    // BUG: If tiddlers have no type we don't display a link!
    if (type) newElement.appendChild(newTiddlerLink({title, type}));
    else newElement.innerHTML = title;
    tw.core.dom.divSearchResults.insertAdjacentElement('beforeend', newElement);
  }
  function newTiddlerLink({title}) {
    let newElement = document.createElement('a');
    newElement.setAttribute('data-msg', 'tiddler.show');
    newElement.setAttribute('data-param', title);
    newElement.setAttribute('data-tiddler-backref', tw.core.common.hash(title));
    newElement.setAttribute('href', 'javascript:false;');
    newElement.innerText = title;
    return newElement;
  }

  /**
   * Sort alphabetically, search and return best matches first
   */
  function search(q, list) {
    let results = list
      .sort(alphabetically)
      .map(simpleSearch(q))
      .filter(notEmpty)
      .sort(ranking);
    let title = 'No results!';
    if (!q.match(/^\$/)) title += ` Type '\$${q}' to search hidden tiddlers!`;
    return results.length ? results.map(t => t.tiddler) : [{title}];
  }

  /**
   * Ranked substring search preferring title/tags match to fulltext
   */
  function simpleSearch(q) {
    q = q.trim().toLowerCase();
    const Q = q;
    let searchAll = q[0] === '$';
    if (searchAll) q = q.substring(1);
    let searchTag = q.match(reTag)?.[1];
    if (searchTag) q = q.replace(reTag, '');
    let searchPackage = q.match(rePck)?.[1];
    if (searchPackage) q = q.replace(rePck, '');

    return (t) => {
      let rank = 0;
      if (!searchAll && t.title[0] === '$') return;
      let titleText = t.title.toLowerCase();
      let fullText = titleText + t.text.toLowerCase();
      if (searchAll) fullText += t.type;
      // If tag: or pck: it must match so no match means rank is zero
      if (searchTag) rank = t.tags.find(t => t.toLowerCase() === searchTag) ? rank + TAG_MATCH : 0;
      if (searchPackage) rank = searchPackage === t.package ? rank + TAG_MATCH : 0;
      if (q) {
        rank = titleText.indexOf(q) >= 0 ? rank + TITLE_MATCH : (fullText.indexOf(q) >= 0 ? rank + TEXT_MATCH : 0);
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
    if (A < B) return -1; else return 1;
  }

  function ranking(a, b) {
    return a.rank > b.rank ? -1 : 1;
  }

  function notEmpty(v){return !!v;}

  function wireUIEvents() {
    tw.core.dom.$('search')?.addEventListener('keyup', searchNow);
    tw.core.dom.$('search')?.addEventListener('focus', searchFocus);
    tw.core.dom.$('search')?.addEventListener('blur', searchLoseFocus);
    searchLoseFocus();
  }

});
