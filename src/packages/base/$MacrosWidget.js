// tags: $Script
// `<<macros>>` — sibling to `<<modules>>`/`<<plugins>>`. Walks tw.macros and
// emits one markdown table per namespace. Description + example come from the
// 4th-arg `meta` object passed to registerMacro.
//
// `<<macroExamples>>`
// The example column is live: each example string is rendered through
// renderTWikki so the widget actually executes in the cell (renderTWikki's
// own pass over the outer tiddler does NOT recurse into macro output).
tw.extensions.registerMacro(
  'core',
  'macros',
  () => {
    const sections = [];
    const namespaces = Object.keys(tw.macros).sort();
    for (const ns of namespaces) {
      const bucket = tw.macros[ns];
      if (!bucket || typeof bucket !== 'object') continue;
      const names = Object.keys(bucket)
        .filter(n => typeof bucket[n] === 'function')
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      if (!names.length) continue;
      const rows = names.map(n => {
        const fn = bucket[n];
        const call = ns === 'core' ? n : `${ns}.${n}`;
        const desc = fn.description || '–';
        return `| \`${call}\` | ${desc} |`;
      });
      sections.push(`### ${ns}`, '', '| Macro | Description |', '|---|---|', ...rows, '');
    }
    return sections.join('\n');
  },
  {
    description: 'Lists every registered macro with description, grouped by namespace.',
    example: '<<macros>>',
  },
);
tw.extensions.registerMacro(
  'core',
  'macroExamples',
  () => {
    const excludeMacros = ['modules', 'plugins', 'macros', 'macroExamples'];
    const sections = [];
    const namespaces = Object.keys(tw.macros).sort();
    for (const ns of namespaces) {
      const bucket = tw.macros[ns];
      if (!bucket || typeof bucket !== 'object') continue;
      const names = Object.keys(bucket)
        .filter(n => typeof bucket[n] === 'function')
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      if (!names.length) continue;
      const rows = names
        .map(n => {
          const fn = bucket[n];
          const call = ns === 'core' ? n : `${ns}.${n}`;
          if (excludeMacros.includes(n)) return;
          const exampleSrc = fn.example || `<<${call}>>`;
          let live;
          try {
            live = tw.core.render.renderTWikki({text: exampleSrc, title: 'macros'});
          } catch (e) {
            live = `<span class="error">${e.message}</span>`;
          }
          if (live.length > 1000) return ''; // live = 'Output too long';
          // Block-widget output (newlines and markdown-table pipes) would break
          // the outer table row — collapse newlines and escape inline pipes.
          live = live.replace(/\n+/g, ' ').replace(/\|/g, '\\|');
          return `| \`${exampleSrc}\` | ${live} |`;
        })
        .filter(r => !!r);
      sections.push(`### ${ns}`, '', '| Macro | Example |', '|---|---|', ...rows, '');
    }
    return sections.join('\n');
  },
  {
    description: 'Lists every registered macro with an example, grouped by namespace.',
    example: '<<macroExamples>>',
  },
);
