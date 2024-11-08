(function(tw) {

  const name = 'core.ui';
  const version = '0.0.1';
  const exports = {
    button,
    section,
    expand,
    expose,
  };

  // Exports
  // exports.notify = notify;

  // Run
  const run = () => {
    initUI();
  };

  return {name, version, exports, run};

  function initUI() {
    let html = tw.run.getTiddler('$MainLayout').text;
    document.body.innerHTML = html;
    tw.core.dom.divVisibleTiddlers = tw.core.dom.$('visible-tiddlers');
    tw.core.dom.divAllTiddlers = tw.core.dom.$('all-tiddlers');
    tw.core.dom.preview = tw.core.dom.$('preview-dialog');
  }

  function button(text, message, payload, id = '', attr = '') {
  // TODO: Would be nice to return an element here to which we could bind a real event and payload
    if (text.match(/[<\{]/))
    // WikiText
      text = tw.call('renderTWikki', {text});
    else
      text = tw.core.common.escapeHtml(text);
    let className = '';
    if (text.match(/<svg/)) className = 'icon';
    return `<button${id ? ' id="' + id + '"' : ''} class="${className}" data-msg="${message}" data-param="---enc:${tw.core.common.encoder(payload || '')}" ${attr}>${text}</button>`;
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
