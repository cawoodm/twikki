// tags: $Plugin
(function () {
  return {
    meta: {
      name: 'CsvRenderer',
      version: '0.0.1',
      platform: '0.24.0',
      author: 'TWikki',
      description: 'Renders type=csv tiddlers as HTML tables.',
    },
    start() {
      const esc = s =>
        String(s).replace(
          /[&<>"]/g,
          c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c],
        );
      tw.events.subscribe('renderer.override', function csvRenderer({tiddler, text}) {
        if (tiddler.type !== 'csv') return null;
        const lines = text.split(/\r?\n/).filter(l => l.length);
        if (!lines.length) return '<table class="csv"></table>';
        const cells = lines.map(line => line.split(',').map(c => esc(c.trim())));
        const [header, ...rows] = cells;
        const ths = header.map(c => `<th>${c}</th>`).join('');
        const trs = rows
          .map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`)
          .join('');
        return `<table class="csv"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
      });
    },
  };
})();
