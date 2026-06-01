(function(tw) {

  const name = 'core.dom';
  const version = '0.0.1';
  const exports = {};

  // Exports
  exports.addStyleSheet = addStyleSheet;
  exports.addScript = addScript;
  exports.disableStyleSheet = disableStyleSheet;
  exports.enableStyleSheet = enableStyleSheet;
  exports.$ = $;
  exports.$$ = $$;
  exports.htmlToNode = htmlToNode;
  exports.nearestAttribute = nearestAttribute;
  exports.nearestElementWithAttribute = nearestElementWithAttribute;
  exports.nearestElement = nearestElement;

  return {name, version, exports};

  function addStyleSheet(title, url) {
    var link = document.createElement('link');
    link.type = 'text/css';
    // NB: identify via data-stylesheet, NOT title. A <link rel="stylesheet"> with a
    // title joins an HTML "alternate style-sheet set" — the browser keeps the first
    // titled sheet as the preferred set and ignores per-link .disabled toggling, which
    // left atom-one-light applied on dark themes. A data attribute keeps each sheet a
    // plain persistent stylesheet whose .disabled works independently.
    link.setAttribute('data-stylesheet', title);
    link.rel = 'stylesheet';
    link.href = url;
    document.head.appendChild(link);
  }
  function addScript(title, url) {
    var script = document.createElement('script');
    script.setAttribute('title', title);
    script.onload = () => tw.events.send('script.loaded', title);
    script.src = url;
    document.head.appendChild(script);
  }
  function disableStyleSheet(title) {
    let el = document.querySelector(`link[data-stylesheet="${title}"]`);
    if (!el) throw new Error(`Stylesheet with title '${title}' not found!`);
    el.disabled = true;
  }
  function enableStyleSheet(title) {
    let el = document.querySelector(`link[data-stylesheet="${title}"]`);
    if (!el) throw new Error(`Stylesheet with title '${title}' not found!`);
    el.disabled = false;
  }
  function $() {
    return document.getElementById(...arguments);
  }
  function $$() {
    return document.querySelectorAll(...arguments);
  }
  function htmlToNode(html) {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    const nNodes = template.content.childNodes.length;
    if (nNodes !== 1) return console.error(`html parameter must represent a single node; got ${nNodes}. `);
    return template.content.firstElementChild;
  }
  function nearestAttribute(el, attribute, selector) {
    return el.getAttribute(attribute)
   || el.parentElement?.closest(selector)?.getAttribute(attribute);
  }
  function nearestElementWithAttribute(el, attribute) {
    let selector = `[${attribute}]`;
    return el.getAttribute(attribute) ? el : el.parentElement?.closest(selector);
  }
  function nearestElement(el, selector) {
    return el.parentElement?.closest(selector);
  }
});
