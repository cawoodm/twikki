// tags: $Script
// Lists every $Plugin-tagged tiddler as a markdown table — sibling to the <<modules>>
// macro for core modules. Loaded plugins come from tw.plugins (populated at boot by
// loadPlugins() in the platform); disabled plugins are excluded from tw.plugins, so the
// table is built from the $Plugin tiddlers themselves and cross-referenced with tw.plugins
// for live meta/status. The leading checkbox enables/disables each plugin.
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

  function enabledCheckbox(source, enabled) {
    const params = `---enc:${tw.core.common.encoder(source)}`;
    return `<input type="checkbox" class="plugin-enabled" data-msg="plugin.toggle" data-params="${params}"${enabled ? ' checked' : ''} title="Enable/disable this plugin"/>`;
  }

  // Flip a plugin's enabled state via the $CodeDisabled tag, then reload so
  // loadPlugins() honours the change (unloadPlugins() tears down the old
  // generation first, so disabling fully removes the plugin's effects). The tag
  // is written directly (plugins are usually $NoEdit) and persisted; core.packaging
  // PRESERVED_TAGS keeps it across the next forced package load.
  function togglePlugin(source) {
    if (!source) return;
    const t = tw.run.getTiddler(source);
    if (!t) return tw.ui.notify(`Plugin '${source}' not found`, 'E');
    const willDisable = !t.tags.includes('$CodeDisabled');
    if (willDisable) t.tags.push('$CodeDisabled');
    else t.tags = t.tags.filter(tg => tg !== '$CodeDisabled');
    tw.run.updateTiddlerHard(source, t);
    tw.events.send('save');
    tw.ui.notify(`Plugin '${source}' ${willDisable ? 'disabled' : 'enabled'}, a full reload is recommended!`, 'S');
    if (confirm('Do you want to reload? (recommended)')) tw.events.send('reboot.hard');
  }
  tw.events.override('plugin.toggle', togglePlugin);

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
      description: "Live meta of one plugin as a bullet list (drift-proof inside the plugin's own # Meta section).",
      example: '<<pluginMeta ExamplePlugin>>',
    },
  );
  tw.extensions.registerMacro(
    'core',
    'plugins',
    () => {
      const platform = window.twikki?.version || '–';
      const loaded = tw.plugins || [];
      const rows = (tw.tiddlers.all || [])
        .filter(t => t.tags?.includes('$Plugin'))
        .slice()
        .sort((a, b) => a.title.localeCompare(b.title))
        .map(t => {
          const p = loaded.find(x => x.source === t.title);
          const enabled = !t.tags?.includes('$CodeDisabled');
          const name = p?.meta?.name || `(${t.title})`;
          const version = p?.meta?.version || '–';
          const pkg = p?.package || t.package || '–';
          const builtFor = p?.meta?.platform || p?.compat?.required || '–';
          const status = enabled ? (p ? pluginStatus(p) : '?') : '⏸ disabled';
          return `| ${enabledCheckbox(t.title, enabled)} | [${name}](#${t.title}) | ${t.title} | ${version} | ${pkg} | ${builtFor} | ${status} |`;
        });
      return [`Running platform: **v${platform}**`, '', '| On | Plugin | Source | Version | Package | Built for | Status |', '|---|---|---|---|---|---|---|', ...rows].join('\n');
    },
    {
      description: 'Markdown table of installed plugins with an enable/disable checkbox, versions, source package, and compatibility status.',
      example: '<<plugins>>',
    },
  );
})();
