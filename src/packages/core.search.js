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

  const run = () => {};

  return {name, version, exports, run};

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

});
