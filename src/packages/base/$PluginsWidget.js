// Lists installed plugins (tw.pluginRegistry) as a markdown table — sibling to
// the <<modules>> macro for core modules. The registry is populated at boot by
// prescanPluginRegistry() in the platform: every $Plugin-tagged tiddler gets a
// row, with its `# Meta` section parsed for version/platform/etc.
tw.macros.core.plugins = () => {
  const platform = window.twikki?.version || '–';
  const rows = (tw.pluginRegistry || []).slice()
    .sort((a, b) => (a.namespace + a.name).localeCompare(b.namespace + b.name))
    .map(p => {
      const status = pluginStatus(p);
      const builtFor = p.meta?.platform || p.compat?.required || '–';
      return `| ${p.name} | ${p.namespace} | ${p.meta?.version || '–'} | ${p.package || '–'} | ${builtFor} | ${status} |`;
    });
  return [
    `Running platform: **v${platform}**`,
    '',
    '| Plugin | Namespace | Version | Package | Built for | Status |',
    '|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
};

function pluginStatus(p) {
  if (p.error) return `⚠ err: ${p.error.phase} — ${p.error.message}`;
  const sev = p.compat?.severity;
  if (sev === 'ok') return '✓ OK';
  if (sev === 'exempt') return '–';
  if (sev === 'warn') return `⚠ ${p.compat.reason || 'minor mismatch'}`;
  if (sev === 'block') return `✗ ${p.compat.reason || 'incompatible'}`;
  return '?';
}
