// tags: $Plugin
(function () {
  // This makes pure .js plugins and scripts more readable in twikki
  // by extracting the description (/** ... */ block) off the source
  function splitJsDoc(text) {
    const m = /^\s*\/\*\*([\s\S]*?)\*\//.exec(text);
    if (!m) return {comment: '', code: text};
    const comment = m[1]
      .split('\n')
      .map(l => l.replace(/^\s*\*\s?/, ''))
      .join('\n')
      .trim();
    return {comment, code: text.slice(m[0].length).replace(/^\n+/, '')};
  }
  return {
    meta: {
      name: 'CodeRenderer',
      version: '0.0.1',
      platform: '0.26.0',
      author: 'TWikki',
      description:
        'Renders type=script/js tiddlers by lifting the leading /** ... */ JSDoc block as markdown and wrapping the rest in a ```javascript fence, then routing both halves back through markdown.render. See [[ExampleScript]] for a live demo.',
    },
    start() {
      const esc = tw.core.common.escapeHtml;
      tw.events.subscribe('renderer.override', function codeRenderer({tiddler, text}) {
        if (tiddler.type !== 'script/js') return null;
        const {comment, code} = splitJsDoc(text);
        const md = (comment ? comment + '\n\n' : '') + '```javascript\n' + code + '\n```';
        // Route back through markdown.render so any plugin-supplied engine
        // wins. Same fallback shape as renderMarkdown() in core.render: if
        // no handler is subscribed (e.g. ?safemode), drop to an escaped
        // <pre> of the composed markdown.
        const results = tw.events.send('markdown.render', md);
        const html = results?.[0] ?? `<pre><code>${esc(md)}</code></pre>`;
        return `<div class="code-rendered">${html}</div>`;
      });
    },
  };
})();
