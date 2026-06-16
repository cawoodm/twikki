// tags: $Script
// Lists the installed core modules (tw.modules) with their metadata as a markdown table,
// including each module's built-for platform and its compatibility with the running
// platform. The `compat` report is attached to each module by the boot-time gate; if the
// platform booted at all, every code module is compatible (else the gate would have
// aborted), so this mostly confirms status and surfaces the built-for version.
tw.extensions.registerMacro(
  'core',
  'modules',
  () => {
    const platform = window.twikki?.version || '–';
    const rows = tw.modules.map(m => {
      const name = m.meta?.name || m.name.replace(/^\//, '').replace(/\.(js|json)$/, '');
      const version = m.meta?.version || '–';
      const c = m.compat;
      const builtFor = c?.exempt ? '–' : m.meta?.platform || c?.required || '–';
      let status;
      if (c?.exempt) status = 'n/a';
      else if (!c) status = '?';
      else if (c.severity === 'ok') status = '✓ OK';
      else if (c.severity === 'warn') status = `⚠ ${c.reason || 'minor mismatch'}`;
      else status = `✗ ${c.reason || 'incompatible'}`;
      return `| ${name} | ${version} | ${m.res.type} | ${builtFor} | ${status} |`;
    });
    return [`Running platform: **v${platform}**`, '', '| Module | Version | Type | Built for | Status |', '|---|---|---|---|---|', ...rows].join('\n');
  },
  {
    description: 'Markdown table of installed core modules with versions and platform-compatibility status.',
    example: '<<modules>>',
  },
);
