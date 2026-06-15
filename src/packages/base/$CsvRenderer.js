// tags: $Plugin
(function () {
  // RFC 4180 CSV parser: state machine over the character stream. Handles
  // quoted fields with embedded commas, newlines, and escaped quotes (""→").
  // Returns [] for null/undefined/empty input — caller renders an empty table.
  function parseCsv(text) {
    if (!text) return [];
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else inQuotes = false;
        } else field += c;
      } else if (c === '"' && field === '') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else field += c;
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }
  return {
    meta: {
      name: 'CsvRenderer',
      version: '0.0.2',
      platform: '0.26.0',
      author: 'TWikki',
      description:
        'Renders type=csv tiddlers as HTML tables. RFC 4180 parser handles quoted fields, embedded commas, embedded newlines, and escaped quotes. See [[ExampleCsv]] for a live demo.',
    },
    start() {
      tw.extensions.registerType('csv', 'CSV Data');
      const esc = s =>
        String(s).replace(
          /[&<>"]/g,
          c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c],
        );
      tw.events.subscribe('renderer.override', function csvRenderer({tiddler, text}) {
        if (tiddler.type !== 'csv') return null;
        const rows = parseCsv(text);
        if (!rows.length) return '<table class="csv"></table>';
        const [header, ...body] = rows;
        const ths = header.map(c => `<th>${esc(c)}</th>`).join('');
        const trs = body
          .map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`)
          .join('');
        return `<table class="csv"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
      });
    },
  };
})();
