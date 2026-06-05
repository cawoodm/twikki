/**
 * UI
 * HTML-string UI builders and the page chrome: `button` (dispatches via the
 * document-level data-msg handler, with base64-encoded payloads), `dialog`
 * (consistent <dialog> chrome with title/content/toolbar and msg/onClick
 * buttons), `section`/`expand`/`expose` <details> expanders, and layout
 * rendering — `renderLayout` paints the tiddler named by the `$Layout`
 * pointer (falling back to `$MainLayout`) at first paint, and
 * `layoutTitleForTheme` resolves which layout a theme's MainLayout section
 * names so the theme manager can update the pointer on a theme switch.
 */
(function(tw) {

  const name = 'core.ui';
  const version = '0.0.1';
  const exports = {
    button,
    dialog,
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
  // Core dialog: consistent chrome (title, content, toolbar) for any plugin.
  //   tw.ui.dialog({id, title, html, className, buttons, onClose, modal}) -> {el, content, toolbar, close, setContent}
  //   - title: plain text (escaped), rendered as <h3>
  //   - html:  caller-escaped body HTML for the content region
  //   - buttons: [{text, msg?, payload?, onClick?(ev, api), close?, id?, className?, attr?}]
  //       msg buttons dispatch via the document-level data-msg handler (like tw.ui.button);
  //       onClick buttons get a direct JS handler; close:true closes & removes the dialog after.
  //   The dialog is removed from the DOM whenever it closes (incl. Escape).
  function dialog(opts = {}) {
    let {id, title = '', html = '', className = '', buttons = [], onClose, modal = true} = opts;
    if (id) document.getElementById(id)?.remove();

    let el = document.createElement('dialog');
    if (id) el.id = id;
    el.className = ('tw-dialog ' + className).trim();
    let head = title ? `<h3 class="tw-dialog-title">${tw.core.common.escapeHtml(title)}</h3>` : '';
    el.innerHTML = `${head}<div class="tw-dialog-content">${html}</div><div class="tw-dialog-toolbar toolbar"></div>`;
    let content = el.querySelector('.tw-dialog-content');
    let toolbar = el.querySelector('.tw-dialog-toolbar');

    // Native 'close' fires for el.close() and Escape alike: clean up once, there.
    let close = () => el.close();
    el.addEventListener('close', () => {
      el.remove();
      if (onClose) onClose();
    });

    let api = {el, content, toolbar, close, setContent: h => (content.innerHTML = h)};

    buttons.forEach(b => {
      toolbar.insertAdjacentHTML('beforeend', button(b.text, b.msg || '', b.payload, b.id || '', b.attr || '', b.className || ''));
      let btnEl = toolbar.lastElementChild;
      btnEl.addEventListener('click', ev => {
        // msg dispatch (if any) is handled by the document-level data-msg listener
        if (b.onClick) {
          ev.preventDefault();
          b.onClick(ev, api);
        }
        if (b.close) close();
      });
    });

    document.body.appendChild(el);
    if (modal) el.showModal();
    else el.show();
    return api;
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
