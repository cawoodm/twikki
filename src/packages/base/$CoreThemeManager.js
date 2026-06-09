/**
 * ## Description
 * Provides all theme logic
 * Provides <<ThemeSelector>> widget
 *   listing all tiddlers tagged with $Theme
 */
/**
 * ## Data
 * ```json
 * {
 *   "version": 1.0.1
 * }
 * ```
 */
(function(){

  wireUp('ui.loaded', () => {
    tw.theme = {
      stylesheets: {
        custom: new CSSStyleSheet(),
      },
      getThemeNames,
    };
    document.adoptedStyleSheets.push(tw.theme.stylesheets.custom);
    themeUpdate();
  });

  wireUp('tiddler.updated', tiddlerChanged);
  wireUp('tiddler.deleted', tiddlerChanged);
  function tiddlerChanged(title) {
    if (tiddlerIsThemeRelevant(title))
      return themeUpdate();
    if (tiddlerIsATheme(title))
      return themesUpdate();
  }

  wireUp('theme.switch', themeSwitch);
  function themeSwitch(theme) {
    if (!theme) return;
    if (!tw.call('tiddlerExists', theme)) return tw.ui.notify(`Unknown theme tiddler '${theme}'!`, 'E');
    // A theme owns its layout via an optional `# MainLayout` section naming a shared
    // layout tiddler. We persist the choice in the `$Layout` pointer (read at the
    // first paint, before packages load). If it changes, a full reload re-renders the
    // chrome from the pointer; a colour-only switch stays instant.
    let newLayout = tw.core.ui.layoutTitleForTheme(theme);
    let curLayout = (tw.run.getTiddlerTextRaw('$Layout') || '').replace(/[\[\]]/g, '').trim() || '$MainLayout';
    let layoutChanges = newLayout !== curLayout;
    let tiddler = tw.run.getTiddler('$Theme');
    tiddler.text = `[[${theme}]]`;
    delete tiddler.doNotSave;
    tw.run.updateTiddlerHard('$Theme', tiddler);
    if (layoutChanges) {
      let lt = tw.run.getTiddler('$Layout');
      if (lt) {
        lt.text = `[[${newLayout}]]`;
        delete lt.doNotSave;
        tw.run.updateTiddlerHard('$Layout', lt);
      }
    }
    if (tw.run.getTiddler(theme)?.tags?.includes('$ThemeDark')) {
      tw.core.dom.enableStyleSheet('highlight-dark');
      tw.core.dom.disableStyleSheet('highlight-light');
    } else {
      tw.core.dom.enableStyleSheet('highlight-light');
      tw.core.dom.disableStyleSheet('highlight-dark');
    }
    tw.events.send('save.silent');
    // A layout change needs a full reload: on the fresh boot initUI renders the
    // chrome from the (now-persisted) $Layout pointer. (A soft reload would re-eval
    // extension tiddlers and stack duplicate handlers — see core.js subscribe dedup.)
    if (layoutChanges) return tw.events.send('reboot.hard');
    tw.events.send('tiddler.refresh', '$Theme');
    themeUpdate(theme);
    syncThemeSelector(theme);
  }

  // The <<ThemeSelector>> macro bakes the `active` class at render time, and a
  // colour-only switch never re-renders it (only a layout change reboots). Move the
  // highlight directly so every theme picker reflects the new theme — covers picker
  // clicks and command-palette switches alike.
  function syncThemeSelector(theme) {
    document.querySelectorAll('.picker[data-event="theme.switch"] .picker-item')
      .forEach(b => b.classList.toggle('active', b.dataset.value === theme));
  }

  const BASE_SHEETS = ['$BaseReset', '$BaseVariables'];

  wireUp('ui.reloaded', themeUpdate);
  function themeUpdate() {
    tw.theme.stylesheets.custom.replaceSync(buildCss());
  }

  function buildCss() {
    const layers = {
      base: BASE_SHEETS.map(tw.run.getTiddlerTextRaw),
      plugin: pluginStyles(),
      theme: getThemeStyleSheets().map(tw.run.getTiddlerTextRaw),
      user: [tw.run.getTiddlerTextRaw('$StyleSheetUser')],
    };
    const header = `@layer ${Object.keys(layers).join(', ')};`;
    const body = Object.entries(layers)
      .map(([name, bodies]) => `@layer ${name} {\n${bodies.filter(Boolean).join('\n')}\n}`)
      .join('\n\n');
    return header + '\n\n' + body;
  }

  // Auto-collected from every $Plugin-tagged tiddler that ships a `# StyleSheet`
  // section. Plugin CSS lives next to plugin JS — the manager doesn't maintain a
  // list, it just walks the existing $Plugin tag.
  function pluginStyles() {
    return tw.run.getTiddlersByTag('$Plugin')
      .sort((a, b) => a.title.localeCompare(b.title))
      .map(t => tw.run.getTiddlerTextRaw(`${t.title}::StyleSheet`))
      .filter(Boolean);
  }

  function tiddlerIsATheme(title) {
    return tw.run.getTiddler(title)?.tags?.includes('$Theme');
  }

  function themesUpdate() {
    tw.events.send('tiddler.refresh', '$Themes');
  }

  function tiddlerIsThemeRelevant(title) {
    let themeName = getCurrentThemeName();
    if (title === '$Theme' || title === themeName) return true;
    if (getThemeStyleSheets().includes(title)) return true;
    // Edits to any $Plugin tiddler may have touched its `# StyleSheet` section
    // (the plugin layer); rebuild rather than try to parse out which section changed.
    return tw.run.getTiddler(title)?.tags?.includes('$Plugin') === true;
  }
  function getCurrentThemeName() {
    return tw.run.getTiddlerTextRaw('$Theme').replace(/[\[\]]/g, ''); // Remove possible [[links]]
  }
  function getThemeNames() {
    return tw.run.getTiddlersByTag('$Theme').map(t => t.title);
  }
  function getThemeStyleSheets() {
    let theme = getCurrentThemeName();
    if (!tw.call('tiddlerExists', theme)) {
      tw.ui.notify('Unable to determine theme name from $Theme tiddler! Falling back on $CoreThemeLight', 'W');
      theme = '$CoreThemeLight';
    }
    return tw.run.getTiddlerList(theme);
  }

  tw.macros.core.ThemeSelector = () => {
    let theme = getCurrentThemeName();
    let items = getThemeNames().sort().map(n =>
      `<button class="picker-item${n === theme ? ' active' : ''}" data-value="${n}">${n.replace(/(^\$)|(Theme)/g, '')}</button>`,
    ).join('');
    // Single-line output so the widget can live inside markdown table cells
    return `<span class="picker" data-event="theme.switch">
      <button class="icon picker-trigger" title="Theme" aria-haspopup="true">{{$IconTheme}}</button>
      <span class="picker-menu" hidden>${items}</span>
      </span>`.replace(/\n/g, '');
  };

  // Dynamic command palette entries — one "Switch theme: X" per installed theme.
  // A provider (re-evaluated at palette render) so newly added themes appear live.
  tw.extensions.registerCommandProvider('themes', () =>
    getThemeNames().sort().map(name => ({
      label: `Switch theme: ${name.replace(/(^\$)|(Theme)/g, '')}`,
      event: 'theme.switch', payload: name,
    })),
  );

  function wireUp(event, handler) {
    tw.events.subscribe(event, handler, 'CoreThemeManager');
  }
})();
