(function(tw) {

  const name = 'core.ui';
  const version = '0.0.1';
  const exports = {
    button,
    section,
    expand,
    expose,
    renderLayout,
    layoutTitleForTheme,
  };

  // Exports
  // exports.notify = notify;

  // Run
  const run = () => {
    renderLayout();
  };

  return {name, version, exports, run};

  // Render the page chrome. The active layout is the tiddler named by the `$Layout`
  // pointer (persisted like `$Theme`, so it is available at this first paint before
  // any package has loaded). Falls back to `$MainLayout` if the pointer or its
  // target is missing/empty — never renders an empty body.
  function renderLayout() {
    document.body.innerHTML = activeLayoutText();
    tw.core.dom.divVisibleTiddlers = tw.core.dom.$('visible-tiddlers');
    tw.core.dom.preview = tw.core.dom.$('preview-dialog');
  }

  function activeLayoutText() {
    let title = currentLayoutTitle();
    let t = title !== '$MainLayout' && tw.run.getTiddler(title);
    if (t && t.text) return t.text;
    return tw.run.getTiddler('$MainLayout').text;
  }

  // `$Layout` holds `[[LayoutTiddler]]`; strip the link brackets to get the title.
  // Use getTiddler (not getTiddlerTextRaw): this runs at the first paint, when
  // tw.run is still core.js's minimal version that only exposes getTiddler — the
  // platform's fuller tw.run (with getTiddlerTextRaw/getSection) is installed later.
  function currentLayoutTitle() {
    return (tw.run.getTiddler('$Layout')?.text || '').replace(/[\[\]]/g, '').trim() || '$MainLayout';
  }

  // Which layout a theme wants: its `# MainLayout` section names a shared layout
  // tiddler as a lone `[[ref]]` (the only form that can render at first paint, when
  // the theme itself isn't loaded yet). No section → the default `$MainLayout`.
  // Exposed so the theme manager can set the `$Layout` pointer on a theme switch.
  function layoutTitleForTheme(theme) {
    let sec = theme && tw.run.getSection(theme, 'MainLayout');
    let m = sec && sec.text && sec.text.trim().match(/^\[\[(.+)\]\]$/);
    return m ? m[1] : '$MainLayout';
  }

  function button(text, message, payload, id = '', attr = '', className = '') {
  // TODO: Would be nice to return an element here to which we could bind a real event and payload
    if (text.match(/[<\{]/))
    // WikiText
      text = tw.call('renderTWikki', {text});
    else
      text = tw.core.common.escapeHtml(text);
    if (text.match(/<svg/)) className += ' icon';
    let paramAttribute = '';
    if (payload) {
      if (typeof payload === 'object') paramAttribute = ` data-params="---enc:${tw.core.common.encoder(JSON.stringify(payload))}"`;
      else if (typeof payload === 'string') paramAttribute = ` data-param="---enc:${tw.core.common.encoder(payload)}"`;
      else return '<span class="error">ERROR: Button Payload is not a string!</span>';
    }
    return `<button${id ? ' id="' + id + '"' : ''} class="${className}" data-msg="${message}" ${paramAttribute} ${attr}>${text}</button>`;
  }
  // Block-style expander
  function section({name, content, id, attr = ''}) {
    if (!id) id = randstr();
    return `<details ${attr}><summary>${name}</summary><div id="${id}">${content}</div></details>`;
  }
  // Inline-style expander
  function expand({name, content, id, attr = ''}) {
    if (!id) id = randstr();
    return `<details ${attr}><summary style="display:inline">${name}</summary><div id="${id}">${content}</div></details>`;
  }
  // Render on click expander
  function expose({name, content, message, payload, id, attr = ''}) {
    if (!id) id = randstr();
    return `<details ${attr}><summary data-msg="${encodeMessage(message, payload)}" data-target="${id}" data-default="true">${name}</summary><div id="${id}">${content}</div></details>`;
  }

  function encodeMessage(message, payload) {
    let params = typeof payload === 'undefined' ? '' : payload;
    params = typeof params === 'object' ? JSON.stringify(params) : params;
    return `${message}:---enc:${tw.core.common.encoder(params)}`;
  }

  function randstr() {
    return Math.random().toString(36).replace('0.', '');
  }


});
