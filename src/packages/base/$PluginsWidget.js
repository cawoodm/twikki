// tags: $Script
// Lists loaded plugins (tw.plugins) as a markdown table — sibling to the <<modules>>
// macro for core modules. tw.plugins is populated at boot by loadPlugins() in the
// platform: each $Plugin-tagged tiddler's IIFE returns {meta, init?, start?}, which
// becomes a row here.
tw.macros.core.plugins = (() => {
  function pluginStatus(p) {
    if (p.error) return `⚠ err: ${p.error.phase} — ${p.error.message}`;
    const sev = p.compat?.severity;
    if (sev === 'ok') return '✓ OK';
    if (sev === 'exempt') return '–';
    if (sev === 'warn') return `⚠ ${p.compat.reason || 'minor mismatch'}`;
    if (sev === 'block') return `✗ ${p.compat.reason || 'incompatible'}`;
    return '?';
  }
  return () => {
    const platform = window.twikki?.version || '–';
    const rows = (tw.plugins || [])
      .slice()
      .sort((a, b) => (a.meta?.name || a.source).localeCompare(b.meta?.name || b.source))
      .map((p) => {
        const status = pluginStatus(p);
        const name = p.meta?.name || `(${p.source})`;
        const builtFor = p.meta?.platform || p.compat?.required || '–';
        return `| [${name}](#${p.source}) | ${p.source} | ${p.meta?.version || '–'} | ${p.package || '–'} | ${builtFor} | ${status} |`;
      });
    return [
      `Running platform: **v${platform}**`,
      '',
      '| Plugin | Source | Version | Package | Built for | Status |',
      '|---|---|---|---|---|---|',
      ...rows
    ].join('\n');
  };
})();
