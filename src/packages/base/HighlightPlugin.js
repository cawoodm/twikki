// https://www.jsdelivr.com/package/npm/highlight.js
// https://cdnjs.com/libraries/highlight.js

(function(){

  tw.events.subscribe('ui.loaded', () => {
    tw.core.dom.addStyleSheet('highlight-light', 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/styles/atom-one-light.min.css');
    tw.core.dom.addStyleSheet('highlight-dark', 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/styles/atom-one-dark.min.css');
    tw.core.dom.addScript('highlight-core', 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/highlight.min.js');
    tw.events.subscribe('script.loaded', (name) => {
      if (name === 'highlight-core') {
        tw.core.dom.addScript('highlight-lang-javascript', 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/languages/javascript.min.js');
        tw.core.dom.addScript('highlight-lang-css', 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/languages/css.min.js');
        tw.core.dom.addScript('highlight-lang-xml', 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/languages/xml.min.js');
        tw.core.dom.addScript('highlight-lang-json', 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/languages/json.min.js');
        return;
      }
      if (name !== 'highlight-lang-json') return;
      tw.lib.highlight = window.hljs;
      tw.events.send('highlight.loaded');
    }, 'HighlightPlugin');
  }, 'HighlightPlugin');
  tw.events.subscribe('tiddler.rendered', ({tiddler, newElement}) => {
    newElement.querySelectorAll('pre code').forEach(el => (tw.lib.highlight?.highlightElement(el, {language: languageFromTiddlerType(tiddler.type)})));
  }, 'HighlightPlugin');

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
})();
