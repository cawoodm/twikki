// Lists the installed core modules (tw.modules) with their metadata as a markdown table
tw.macros.core.modules = () => {
  const rows = tw.modules.map(m => {
    const name = m.meta?.name || m.name.replace(/^\//, '').replace(/\.(js|json)$/, '');
    const version = m.meta?.version || '–';
    return `| ${name} | ${version} | ${m.res.type} |`;
  });
  return ['| Module | Version | Type |', '|---|---|---|', ...rows].join('\n');
};
