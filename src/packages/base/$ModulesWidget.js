// tags: $Script
// Lists the installed core modules (tw.modules) with their metadata as a markdown table.
// Core modules ship with the platform build (no separate fetch/cache/version gate), so a
// running module is always the one this platform was built with — the table just surfaces
// each module's declared version and type.
tw.extensions.registerMacro(
  'core',
  'modules',
  () => {
    const platform = window.twikki?.version || '–';
    const rows = tw.modules.map(m => {
      const name = m.meta?.name || m.name.replace(/^\//, '').replace(/\.(js|json)$/, '');
      const version = m.meta?.version || '–';
      return `| ${name} | ${version} | ${m.res.type} |`;
    });
    return [`Running platform: **v${platform}**`, '', '| Module | Version | Type |', '|---|---|---|', ...rows].join('\n');
  },
  {
    description: 'Markdown table of installed core modules with their versions and type.',
    example: '<<modules>>',
  },
);
