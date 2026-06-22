// tags: $Plugin

// https://www.jsdelivr.com/package/npm/highlight.js
// https://cdnjs.com/libraries/highlight.js

(function () {
  const meta = {
    name: 'Highlight',
    version: '1.0.0',
    platform: '0.27.0',
    description: 'Lazy-loads highlight.js and syntax-highlights code blocks on render.',
  };

  function currentTheme() {
    return tw.run.getTiddlerTextRaw('$Theme').replace(/[\[\]]/g, ''); // strip [[ ]]
  }

  // Enable exactly one hljs sheet for the active theme, disabling the other. Doing
  // both (not just enabling one) guarantees a single active sheet regardless of DOM
  // order or load timing. Themes carrying the $ThemeDark tag use the dark sheet.
  function applyHighlightTheme() {
    // The sheets are added on ui.loaded; on a soft ui.reloaded before that they may
    // be absent — skip rather than let enableStyleSheet throw (would fault the plugin).
    if (!document.querySelector('link[data-stylesheet="highlight-light"]')) return;
    let dark = tw.run.getTiddler(currentTheme())?.tags?.includes('$ThemeDark') ?? false;
    tw.core.dom.enableStyleSheet(dark ? 'highlight-dark' : 'highlight-light');
    tw.core.dom.disableStyleSheet(dark ? 'highlight-light' : 'highlight-dark');
  }

  function languageFromTiddlerType(type) {
    switch (type) {
      case 'script/js':
        return 'javascript';
      case 'css':
        return 'css';
      case 'html/template':
        return 'xml';
      case 'json':
        return 'json';
      default:
        return '';
    }
  }

  const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0';

  // Load highlight.js core (once, shared via tw.lib.require) then its language
  // packs. Resolves to the live hljs instance. Idempotent end-to-end: loadScript
  // dedups by title and tw.lib.require memoises, so soft reloads add no tags.
  async function loadHighlight() {
    const hljs = await tw.lib.require('hljs', () => tw.core.dom.loadScript('highlight-core', `${CDN}/highlight.min.js`, {global: 'hljs'}));
    await Promise.all([
      tw.core.dom.loadScript('highlight-lang-javascript', `${CDN}/languages/javascript.min.js`),
      tw.core.dom.loadScript('highlight-lang-css', `${CDN}/languages/css.min.js`),
      tw.core.dom.loadScript('highlight-lang-xml', `${CDN}/languages/xml.min.js`),
      tw.core.dom.loadScript('highlight-lang-json', `${CDN}/languages/json.min.js`),
    ]);
    tw.lib.highlight = hljs;
    return hljs;
  }

  function highlightAll() {
    // Scripts/CSS load after the core has rendered all visible tiddlers, so
    // highlight whatever is already on screen once the lib is ready.
    tw.tiddlers.visible.forEach(title => {
      let tiddler = tw.run.getTiddler(title);
      let el = tw.run.getTiddlerElement(tiddler.title);
      el?.querySelectorAll('pre code:not([data-highlighted])').forEach(node => tw.lib.highlight?.highlightElement(node, {language: languageFromTiddlerType(tiddler.type)}));
    });
  }

  return {
    meta,
    init() {
      tw.events.subscribe(
        'ui.loaded',
        () => {
          tw.core.dom.addStyleSheet('highlight-light', `${CDN}/styles/atom-one-light.min.css`);
          tw.core.dom.addStyleSheet('highlight-dark', `${CDN}/styles/atom-one-dark.min.css`);
          loadHighlight().then(highlightAll, err => console.error('[Highlight]', err));
          // Apply the correct light/dark highlight for the current theme on load.
          // Set the sheet state DIRECTLY (don't fire theme.switch): firing relied on
          // $CoreThemeManager.themeSwitch running and not early-returning, and left a window
          // where both sheets were enabled (dark, added last, wins) — which is why a light
          // theme could come back with dark code blocks after a reload.
          applyHighlightTheme();
        },
        'Highlight',
      );

      // Re-apply on soft reload too (the highlight <link>s persist in <head>).
      tw.events.subscribe('ui.reloaded', applyHighlightTheme, 'Highlight');

      tw.events.subscribe(
        'tiddler.rendered',
        ({tiddler, newElement}) => {
          newElement.querySelectorAll('pre code:not([data-highlighted])').forEach(el => tw.lib.highlight?.highlightElement(el, {language: languageFromTiddlerType(tiddler.type)}));
        },
        'Highlight',
      );
    },
  };
})();
