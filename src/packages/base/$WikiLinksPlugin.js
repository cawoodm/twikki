// tags: $Plugin
(function () {
  // [[Title]] / [[Title with spaces]]. Loose by design — anything between
  // `[[` and `]]` on one line. The post-hook only ever sees text nodes
  // outside <pre>/<code>/<a>, so over-matching real prose is the only
  // concern, and the bracket pair is already a strong signal.
  const reLink = /\[\[([^\]\n]+)\]\]/g;

  function transformHtml(html) {
    if (!html || !html.includes('[[')) return html;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
    const targets = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (!n.nodeValue.includes('[[')) continue;
      // Skip text inside rendered code, or inside an existing anchor — keeps
      // wikilink syntax literal in code blocks and avoids re-wrapping the
      // label of a link that's already an <a>.
      if (n.parentElement?.closest('pre, code, a')) continue;
      targets.push(n);
    }
    if (!targets.length) return html;
    for (const node of targets) {
      const frag = document.createDocumentFragment();
      const text = node.nodeValue;
      let last = 0;
      reLink.lastIndex = 0;
      let m;
      while ((m = reLink.exec(text)) !== null) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const ref = m[1];
        const a = document.createElement('a');
        a.href = '#' + ref.replace(/ /g, '%20');
        a.textContent = ref;
        frag.appendChild(a);
        last = m.index + m[0].length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.replaceWith(frag);
    }
    return tpl.innerHTML;
  }

  return {
    meta: {
      name: 'WikiLinks',
      version: '0.1.0',
      platform: '0.27.0',
      description:
        'Late `renderer.post` pass that turns any surviving `[[Title]]` token in rendered text into an `<a href="#Title">` link. Skips text inside <pre>/<code>/<a> so wikilink syntax inside code blocks (and existing links) stays literal. Catches the cases where a renderer.override produces HTML without going through renderTWikki — e.g. the JSDoc of single-file script/js plugins.',
    },
    init() {
      tw.events.subscribe('renderer.post', transformHtml, 'WikiLinks');
    },
  };
})();
