// tags: $Script
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
(function () {
  wireUp('ui.loaded', () => {
    tw.theme = {
      stylesheets: {
        custom: new CSSStyleSheet(),
      },
      getThemeNames,
    };
    document.adoptedStyleSheets.push(tw.theme.stylesheets.custom);
    rebuildRelevanceList();
    themeUpdate();
  });

  wireUp('tiddler.updated', tiddlerChanged);
  // tiddler.deleted: the tiddler is already gone from the store when the event fires,
  // so tag checks return nothing. Check relevance against the registry first, then
  // drop the entry — only rebuild CSS if the deleted tiddler was actually CSS-relevant.
  wireUp('tiddler.deleted', title => {
    const wasRelevant = tiddlerIsThemeRelevant(title);
    addToRelevance(title, false);
    if (wasRelevant) themeUpdate();
  });
  function tiddlerChanged(title) {
    // Capture pre-sync relevance so that a plugin which *loses* its # StyleSheet
    // still triggers a rebuild (it's no longer relevant, but its CSS must be removed).
    const wasRelevant = tiddlerIsThemeRelevant(title);
    if (tw.run.getTiddler(title)?.tags?.includes('$Plugin')) addToRelevance(title, !!tw.run.getTiddlerTextRaw(`${title}::StyleSheet`));
    if (wasRelevant || tiddlerIsThemeRelevant(title)) return themeUpdate();
    if (tiddlerIsATheme(title)) return themesUpdate();
  }
  function addToRelevance(title, present) {
    const list = tw.tmp.themeRelevantTiddlers || (tw.tmp.themeRelevantTiddlers = []);
    const idx = list.indexOf(title);
    if (present && idx === -1) list.push(title);
    else if (!present && idx !== -1) list.splice(idx, 1);
  }

  // Boot population: every tiddler whose text contributes to the @layer cascade.
  // Single source of truth — kept current by themeSwitch (theme + its sheets) and
  // tiddlerChanged (plugins gaining/losing a # StyleSheet section).
  function rebuildRelevanceList() {
    const list = [];
    list.push(...BASE_SHEETS, USER_SHEET, '$Theme');
    // Mirror getThemeStyleSheets()'s fallback so the registry agrees with what
    // buildCss() actually concatenates when $Theme points to a missing tiddler.
    let theme = getCurrentThemeName();
    if (!tw.core.tiddlers.tiddlerExists(theme)) theme = '$CoreThemeLight';
    if (tw.core.tiddlers.tiddlerExists(theme)) {
      list.push(theme);
      list.push(...tw.run.getTiddlerList(theme));
    }
    tw.tiddlers.all.filter(t => t.tags?.includes('$Plugin') && tw.run.getTiddlerTextRaw(`${t.title}::StyleSheet`)).forEach(t => list.push(t.title));
    tw.tmp.themeRelevantTiddlers = [...new Set(list)];
  }

  wireUp('theme.switch', themeSwitch);
  function themeSwitch(theme) {
    if (!theme) return;
    if (!tw.core.tiddlers.tiddlerExists(theme)) return tw.ui.notify(`Unknown theme tiddler '${theme}'!`, 'E');
    // Swap relevance entries before $Theme is rewritten: drop the old theme tiddler
    // and its sheets, add the new ones. Base / user / $Theme / plugin entries stay.
    swapThemeRelevance(getCurrentThemeName(), theme);
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
    tw.events.send('save.auto');
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
    document.querySelectorAll('.picker[data-event="theme.switch"] .picker-item').forEach(b => b.classList.toggle('active', b.dataset.value === theme));
  }

  const BASE_SHEETS = ['$BaseReset', '$BaseVariables'];
  const USER_SHEET = '$StyleSheetUser';

  wireUp('ui.reloaded', themeUpdate);
  function themeUpdate() {
    tw.theme.stylesheets.custom.replaceSync(buildCss());
  }

  function buildCss() {
    const layers = {
      base: BASE_SHEETS.map(tw.run.getTiddlerTextRaw),
      plugin: pluginStyles(),
      theme: getThemeStyleSheets().map(tw.run.getTiddlerTextRaw),
      user: [tw.run.getTiddlerTextRaw(USER_SHEET)],
    };
    const header = `@layer ${Object.keys(layers).join(', ')};`;
    const body = Object.entries(layers)
      .map(([name, bodies]) => `@layer ${name} {\n${bodies.filter(Boolean).join('\n')}\n}`)
      .join('\n\n');
    return header + '\n\n' + body;
  }

  // Concatenate CSS from every plugin in the relevance registry that exposes a
  // # StyleSheet section. Disabled plugins ($CodeDisabled) are skipped — their JS
  // doesn't run, so their CSS doesn't apply either. Sorted for stable cascade order.
  function pluginStyles() {
    return [...(tw.tmp.themeRelevantTiddlers || [])]
      .filter(title => !tw.run.getTiddler(title)?.tags?.includes('$CodeDisabled'))
      .sort((a, b) => a.localeCompare(b))
      .map(title => tw.run.getTiddlerTextRaw(`${title}::StyleSheet`))
      .filter(Boolean);
  }

  function tiddlerIsATheme(title) {
    return tw.run.getTiddler(title)?.tags?.includes('$Theme');
  }

  function themesUpdate() {
    tw.events.send('tiddler.refresh', '$Themes');
  }

  // Pure array lookup — the registry is the single source of truth, maintained by
  // rebuildRelevanceList (boot), swapThemeRelevance (theme switch), and addToRelevance
  // (plugin gains/loses # StyleSheet on edit/delete).
  function tiddlerIsThemeRelevant(title) {
    return (tw.tmp.themeRelevantTiddlers || []).includes(title);
  }
  function swapThemeRelevance(oldTheme, newTheme) {
    if (oldTheme && tw.core.tiddlers.tiddlerExists(oldTheme)) {
      addToRelevance(oldTheme, false);
      tw.run.getTiddlerList(oldTheme).forEach(s => addToRelevance(s, false));
    }
    addToRelevance(newTheme, true);
    tw.run.getTiddlerList(newTheme).forEach(s => addToRelevance(s, true));
  }
  function getCurrentThemeName() {
    return tw.run.getTiddlerTextRaw('$Theme').replace(/[\[\]]/g, ''); // Remove possible [[links]]
  }
  function getThemeNames() {
    return tw.run.getTiddlersByTag('$Theme').map(t => t.title);
  }
  function getThemeStyleSheets() {
    let theme = getCurrentThemeName();
    if (!tw.core.tiddlers.tiddlerExists(theme)) {
      tw.ui.notify('Unable to determine theme name from $Theme tiddler! Falling back on $CoreThemeLight', 'W');
      theme = '$CoreThemeLight';
    }
    return tw.run.getTiddlerList(theme);
  }

  tw.extensions.registerMacro(
    'core',
    'ThemeSelector',
    () => {
      let theme = getCurrentThemeName();
      // Items as spans (phrasing content) so the parser doesn't hoist them out
      // of the picker-menu when the macro is embedded in a markdown `<p>`. CSS
      // (`.picker-item { display: block }`) handles the visual layout.
      let items = getThemeNames()
        .sort()
        .map(n => `<span class="picker-item${n === theme ? ' active' : ''}" data-value="${n}">${n.replace(/(^\$)|(Theme)/g, '')}</span>`)
        .join('');
      // Single-line output so the widget can live inside markdown table cells
      return `<span class="picker" data-event="theme.switch">
      <button class="icon picker-trigger" title="Theme" aria-haspopup="true">{{$IconTheme}}</button>
      <span class="picker-menu" hidden>${items}</span>
      </span>`.replace(/\n/g, '');
    },
    {
      description: 'Dropdown to switch the active theme instantly.',
      example: '<<ThemeSelector>>',
    },
  );

  // Dynamic command palette entries — one "Switch theme: X" per installed theme.
  // A provider (re-evaluated at palette render) so newly added themes appear live.
  tw.extensions.registerCommandProvider('themes', () =>
    getThemeNames()
      .sort()
      .map(name => ({
        label: `Switch theme: ${name.replace(/(^\$)|(Theme)/g, '')}`,
        event: 'theme.switch',
        payload: name,
      })),
  );

  function wireUp(event, handler) {
    tw.events.subscribe(event, handler, 'CoreThemeManager');
  }
})();
