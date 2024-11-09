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
    let tiddler = tw.run.getTiddler('$Theme');
    tiddler.text = `[[${theme}]]`;
    delete tiddler.doNotSave;
    tw.run.updateTiddlerHard('$Theme', tiddler);
    if (theme.match(/Dark/)) tw.core.dom.disableStyleSheet('highlight-light');
    else tw.core.dom.disableStyleSheet('highlight-dark');
    tw.events.send('tiddler.refresh', '$Theme');
    themeUpdate(theme);
    tw.events.send('save.silent');
  }

  wireUp('ui.reloaded', themeUpdate);
  function themeUpdate() {
    let css = getThemeStyleSheets().map(tw.run.getTiddlerTextRaw).join('\n');
    tw.theme.stylesheets.custom.replaceSync(css);
  }

  function tiddlerIsATheme(title) {
    return tw.run.getTiddler(title)?.tags.includes('$Theme');
  }

  function themesUpdate() {
    tw.events.send('tiddler.refresh', '$Themes');
  }

  function tiddlerIsThemeRelevant(title) {
    let themeName = getCurrentThemeName();
    return title === '$Theme' || title === themeName || getThemeStyleSheets().includes(title);
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
      tw.ui.notify('Unable to determine theme name from $Theme tiddler! Falling back on $CoreTheme', 'W');
      theme = '$CoreTheme';
    }
    return tw.run.getTiddlerList(theme);
  }

  tw.macros.core.ThemeSelector = () => {
    let theme = getCurrentThemeName();
    return `<select id="theme-select" onchange="tw.events.send('theme.switch', this.value);">
    ${getThemeNames().map(n => `<option value="${n}"${n === theme ? ' selected' : ''}>${n.replace(/(^\$)|(Theme$)/g, '')}</option>`).join('\n')}
  </select>`;
  };

  function wireUp(event, handler) {
    tw.events.subscribe(event, handler, 'CoreThemeManager');
  }
})();
