// tags: $Script
// Lists loaded plugins (tw.plugins) as a markdown table — sibling to the <<modules>>
// macro for core modules. tw.plugins is populated at boot by loadPlugins() in the
// platform: each $Plugin-tagged tiddler's IIFE returns {meta, init?, start?}, which
// becomes a row here.
(() => {
  function pluginStatus(p) {
    if (p.error) return `⚠ err: ${p.error.phase} — ${p.error.message}`;
    const sev = p.compat?.severity;
    if (sev === 'ok') return '✓ OK';
    if (sev === 'exempt') return '–';
    if (sev === 'warn') return `⚠ ${p.compat.reason || 'minor mismatch'}`;
    if (sev === 'block') return `✗ ${p.compat.reason || 'incompatible'}`;
    return '?';
  }
  // Live meta of one plugin as a bullet list — used in plugin tiddlers' # Meta
  // sections so displayed metadata can never drift from the code's meta object.
  tw.extensions.registerMacro(
    'core',
    'pluginMeta',
    name => {
      const p = (tw.plugins || []).find(p => p.meta?.name === name || p.source === name);
      if (!p) return `<span class="error">Plugin '${name}' not found in registry</span>`;
      const lines = Object.entries(p.meta).map(([k, v]) => `- **${k}**: ${v}`);
      lines.push(`- **package**: ${p.package || '–'}`);
      lines.push(`- **status**: ${pluginStatus(p)}`);
      return lines.join('\n');
    },
    {
      description: 'Live meta of one plugin as a bullet list (drift-proof inside the plugin\'s own # Meta section).',
      example: '<<pluginMeta ExamplePlugin>>',
    },
  );
  tw.extensions.registerMacro(
    'core',
    'plugins',
    () => {
      const platform = window.twikki?.version || '–';
      const rows = (tw.plugins || [])
        .slice()
        .sort((a, b) => (a.meta?.name || a.source).localeCompare(b.meta?.name || b.source))
        .map(p => {
          const status = pluginStatus(p);
          const name = p.meta?.name || `(${p.source})`;
          const builtFor = p.meta?.platform || p.compat?.required || '–';
          return `| [${name}](#${p.source}) | ${p.source} | ${p.meta?.version || '–'} | ${p.package || '–'} | ${builtFor} | ${status} |`;
        });
      return [`Running platform: **v${platform}**`, '', '| Plugin | Source | Version | Package | Built for | Status |', '|---|---|---|---|---|---|', ...rows].join('\n');
    },
    {
      description: 'Markdown table of installed plugins with versions, source package, and compatibility status.',
      example: '<<plugins>>',
    },
  );
})();

