/**
 * ## Description
 * Provides all theme logic
 * Provides <<ThemeSelector>> widget
 *   listing all tiddlers tagged with $Theme
 *
 * Stylesheets are composed as CSS cascade layers:
 *   @layer reset, structure, tokens, components, theme, user;
 * Layers 1-4 are collected from tiddlers tagged $LayerReset/$LayerStructure/
 * $LayerTokens/$LayerComponents (auto-prepended — themes never list them).
 * The `theme` layer is the active theme's own list; the `user` layer is
 * $StyleSheetUser, always applied last. Cross-layer, a later layer wins
 * regardless of selector specificity, so theme/user rules always beat core.
 */
/**
 * ## Data
 * ```json
 * {
 *   "version": 1.1.0
 * }
 * ```
 */
(function(){

  const LAYER_TAGS = {
    reset: '$LayerReset',
    structure: '$LayerStructure',
    tokens: '$LayerTokens',
    components: '$LayerComponents',
  };
  // Pre-layer themes listed the core sheets explicitly; those titles no longer
  // exist (their contents are the auto-prepended layers above), so they're
  // dropped from theme lists. Keeps old gist imports / saved themes working.
  const LEGACY_SHEETS = ['$StyleSheetCore', '$StyleSheetCoreDark', '$ThemeBase', '$StyleSheetUser'];
  // Dark themes were renamed to drop the "Dark" suffix (darkness is now the
  // $ThemeDark tag); map stale $Theme pointers and theme.switch payloads.
  const LEGACY_THEME_NAMES = {
    AuroraThemeDark: 'AuroraTheme',
    TerminalThemeDark: 'TerminalTheme',
    NocturneThemeDark: 'NocturneTheme',
  };

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
    theme = resolveThemeName(theme);
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
    if (themeIsDark(theme)) {
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
  }

  wireUp('ui.reloaded', themeUpdate);
  function themeUpdate() {
    tw.theme.stylesheets.custom.replaceSync(buildLayeredCss());
  }

  function buildLayeredCss() {
    const layers = {
      reset: collectByTag(LAYER_TAGS.reset),
      structure: collectByTag(LAYER_TAGS.structure),
      tokens: collectByTag(LAYER_TAGS.tokens),
      components: collectByTag(LAYER_TAGS.components),
      theme: getThemeStyleSheets().map(tw.run.getTiddlerTextRaw),
      user: [tw.run.getTiddlerTextRaw('$StyleSheetUser')],
    };
    const header = `@layer ${Object.keys(layers).join(', ')};`;
    const body = Object.entries(layers)
      .map(([name, bodies]) => `@layer ${name} {\n${bodies.filter(Boolean).join('\n')}\n}`)
      .join('\n\n');
    return header + '\n\n' + body;
  }

  // Raw text of every tiddler carrying `tag`, alphabetical by title (intra-layer
  // order barely matters — the normal cascade still applies within a layer).
  function collectByTag(tag) {
    return tw.run.getTiddlersByTag(tag)
      .sort((a, b) => a.title.localeCompare(b.title))
      .map(t => tw.run.getTiddlerTextRaw(t.title));
  }

  function tiddlerIsATheme(title) {
    return tw.run.getTiddler(title)?.tags.includes('$Theme');
  }

  function themeIsDark(theme) {
    return !!tw.run.getTiddler(theme)?.tags.includes('$ThemeDark');
  }

  function themesUpdate() {
    tw.events.send('tiddler.refresh', '$Themes');
  }

  function tiddlerIsThemeRelevant(title) {
    if (title === '$Theme' || title === '$StyleSheetUser') return true;
    let tags = tw.run.getTiddler(title)?.tags || [];
    if (Object.values(LAYER_TAGS).some(tag => tags.includes(tag))) return true;
    let themeName = getCurrentThemeName();
    // List entries may be `Title::Section` refs — the edited tiddler is the base title.
    return title === themeName || getThemeStyleSheets().some(ref => ref === title || ref.split('::')[0] === title);
  }
  function getCurrentThemeName() {
    return resolveThemeName(tw.run.getTiddlerTextRaw('$Theme').replace(/[\[\]]/g, '')); // Remove possible [[links]]
  }
  // Map a renamed (formerly "Dark"-suffixed) theme to its new title when the old
  // one is gone — stale localStorage pointers and old imports keep resolving.
  function resolveThemeName(name) {
    if (tw.call('tiddlerExists', name)) return name;
    let renamed = LEGACY_THEME_NAMES[name];
    return renamed && tw.call('tiddlerExists', renamed) ? renamed : name;
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
    return tw.run.getTiddlerList(theme).filter(t => !LEGACY_SHEETS.includes(t));
  }

  tw.macros.core.ThemeSelector = () => {
    let theme = getCurrentThemeName();
    let items = getThemeNames().sort().map(n =>
      `<button class="picker-item${n === theme ? ' active' : ''}" data-value="${n}">${n.replace(/(^\$)|(Theme)/g, '')}</button>`,
    ).join('');
    return `<span class="picker" data-event="theme.switch">
    <button class="icon picker-trigger" title="Theme" aria-haspopup="true">{{$IconTheme}}</button>
    <span class="picker-menu" hidden>${items}</span>
  </span>`;
  };

  function wireUp(event, handler) {
    tw.events.subscribe(event, handler, 'CoreThemeManager');
  }
})();
