/**
 * UI
 * HTML-string UI builders, the page chrome, and the core interaction layer:
 *   - builders: `button` (dispatches via the document-level data-msg handler,
 *     with base64-encoded payloads), `dialog` (consistent <dialog> chrome),
 *     `section`/`expand`/`expose` <details> expanders.
 *   - layout: `renderLayout` paints the tiddler named by the `$Layout` pointer
 *     (falling back to `$MainLayout`) at first paint; `layoutTitleForTheme`
 *     resolves which layout a theme names so the theme manager can update the
 *     pointer on a theme switch.
 *   - event wiring: `wireUpEvents` (bus events → actions) and `wireEvents`
 *     (document-level DOM events: clicks, dblclick-to-edit, hashchange).
 *   - navigation: `navigateTo`, `handleHashLink`, the link/command grammar
 *     (`isLocalLink`, `isCommand`) and `sendCommand` (msg:params dispatch).
 *   - the basic edit round-trip: formNew/formEdit/formDone/formCancel,
 *     section editing, dirty tracking (`setDirty` + beforeunload guard) —
 *     so a tiddler can always be created, edited, validated and saved with
 *     ZERO plugins loaded (the no-plugin invariant).
 */
(function (tw) {
  const name = 'core.ui';
  const version = '0.25.0';
  const platform = '0.26.0'; // built for platform ^0.26.0

  // Events are alphanumeric with "." e.g. 'foo.bar' (lowercase only)
  const reEventName = /[a-z0-9\.]+/g;
  const reCommand = RegExp.compose(/(reEventName):?(.+)?/, {reEventName});

  const exports = {
    button,
    dialog,
    section,
    expand,
    expose,
    renderLayout,
    layoutTitleForTheme,
    wireUpEvents,
    wireEvents,
    navigateTo,
    handleHashLink,
    sendCommand,
    isCommand,
    isLocalLink,
    setDirty,
    formEditTiddler,
    formNewTiddler,
  };

  Object.assign(tw.run, {
    sendCommand,
    setDirty,
  });

  // Command registry for the command palette. Created once and preserved
  // across soft reloads (which re-eval extension tiddlers), so re-registration
  // replaces rather than accumulates. Lives in core (not the palette plugin):
  // plugins register commands at load/init time, and a missing registry would
  // cascade their failures.
  tw.commands = tw.commands || {
    byLabel: {}, // static commands, keyed by label (last-wins)
    providers: [], // {key, fn} — fn() returns commands, evaluated at palette render
    all() {
      const dynamic = this.providers.flatMap(p => {
        try {
          return p.fn() || [];
        } catch (e) {
          console.warn('Command provider failed:', p.key, e);
          return [];
        }
      });
      return [...Object.values(this.byLabel), ...dynamic];
    },
  };
  Object.assign(tw.extensions, {
    registerMacro(namespace, name, fcn, options) {
      if (!tw.macros[namespace]) tw.macros[namespace] = {};
      tw.macros[namespace][name] = fcn;
      if (options) Object.assign(tw.macros[namespace][name], options);
    },
    // Register a command (or array of commands) for the command palette.
    // Shape: {label, event?, payload?, run?}. Deduped by label (last-wins) so
    // soft reloads don't duplicate and plugins can override a built-in.
    registerCommand(command) {
      if (Array.isArray(command)) return command.forEach(c => this.registerCommand(c));
      if (!command?.label) return console.warn('registerCommand: command needs a label', command);
      tw.commands.byLabel[command.label] = command;
    },
    // Register a keyed function producing commands, evaluated each time the
    // palette renders — for runtime-varying lists (themes, workspaces).
    // Re-registration replaces by key.
    registerCommandProvider(key, fn) {
      const i = tw.commands.providers.findIndex(p => p.key === key);
      const entry = {key, fn};
      if (i >= 0) tw.commands.providers[i] = entry;
      else tw.commands.providers.push(entry);
    },
    // Register a tiddler type so the new/edit dialog's type picker offers it.
    // `key` is the type string stored on tiddlers (e.g. 'csv'); `label` is the
    // human-readable name shown in the picker. Last-write-wins on duplicate
    // keys. In-memory only — the type vanishes if the registering plugin is
    // uninstalled/disabled, and it does not persist to localStorage (unlike
    // an edit to the $TiddlerTypes shadow tiddler).
    registerType(key, label) {
      if (!key) return console.warn('registerType: key required');
      tw.types[key] = label || key;
    },
  });
  // `||` guard makes it idempotent across soft reloads (which re-eval modules
  // and would otherwise wipe plugin registrations that already happened).
  tw.types = tw.types || {};
  tw.macros = {
    core: {
      showTiddlerList: (...args) => tw.core.tiddlers.showTiddlerList(...args),
      // <<Tag Foo>> — render tag "Foo" as a picker listing all tiddlers tagged Foo.
      Tag: tag => tw.core.render.tagPickerHtml(String(tag ?? '')),
      // Plain tags input for the edit form. The base package's TagInput
      // ($GeneralWidgets) overrides this with an autocomplete version; this
      // fallback keeps the edit form usable with ZERO plugins/scripts loaded
      // (?safemode — the no-plugin invariant requires tags to stay editable,
      // e.g. to add $CodeDisabled to a broken plugin).
      TagInput: ({id}) => `<input id="${id}" placeholder="Tags"/>`,
      disabled: (...rest) => 'This macro is disabled!' + JSON.stringify(rest),
    },
  };

  // Run
  const run = () => {
    renderLayout();
  };

  return {name, version, platform, exports, run};

  /* ---------- Event wiring (bus) ---------- */
  function wireUpEvents() {
    wireUp('ui.open.all', tw.core.tiddlers.showAllTiddlers);
    wireUp('ui.close.all', tw.core.tiddlers.closeAllTiddlers);
    wireUp('save', tw.core.store.save);
    wireUp('save.silent', tw.core.store.saveSilent);
    wireUp('save.all', tw.core.store.saveAll);

    wireUp('tiddler.new', formNewTiddler);
    wireUp('tiddler.edit', formEditTiddler);
    wireUp('tiddler.show', title => {
      tw.core.tiddlers.showTiddler(title);
      tw.core.tiddlers.scrollToTiddler(title);
    });
    wireUp('section.edit', editTiddlerSection);
    wireUp('tiddler.close', tw.core.tiddlers.closeTiddler);
    wireUp('tiddler.delete', tw.core.tiddlers.deleteTiddler);
    wireUp('tiddler.deleted', tiddlerDeleted);
    wireUp('tiddler.refresh', tw.core.render.rerenderTiddler);
    wireUp('tiddler.text', tw.core.tiddlers.getTiddlerTextRaw);
    wireUp('tiddler.content', tw.core.render.renderTiddler);

    wireUp('tiddler.edited', tw.core.render.rerenderTiddler);
    wireUp('tiddler.created', renderNewTiddler);
    wireUp('tiddler.updated', tiddlerUpdated);

    wireUp('store.load', tw.core.store.loadStore);

    wireUp('form.done', formDone);
    wireUp('form.cancel', formCancel);

    wireUp('package.load.url', tw.core.packaging.loadPackageFromURL);
    wireUp('package.reload.url', tw.core.packaging.reloadPackageFromUrl);
  }
  function wireUp(event, handler) {
    tw.events.subscribe(event, handler, 'core');
  }

  /* ---------- Event wiring (DOM) ---------- */
  function wireEvents() {
    tw.core.dom.frm = tw.core.dom.$('new-form');
    tw.core.dom.frm.addEventListener('submit', evt => evt.preventDefault());
    // (Edit-form hotkeys are an enhancement — see $EditorToolsPlugin.)

    // Edit Mode
    tw.core.dom.$('new-save')?.addEventListener('click', formDone);
    tw.core.dom.$('new-cancel')?.addEventListener('click', formCancel);
    // Escape behaves like Cancel ('cancel' only fires for user-agent dismissal, not .close())
    tw.core.dom.$('new-dialog').addEventListener('cancel', formCancel);

    document.addEventListener('click', event => {
      let el = event.target;

      // Only want events from links...
      //  however, svg icons have a>svg>path and path triggers the click!
      let href = tw.core.dom.nearestAttribute(el, 'href', 'a[href]');
      let link = decodeURI(href?.replace(/^#/, ''));
      if (isLocalLink(href)) {
        event.preventDefault();
        return navigateTo(link);
      }

      // ...and explicit commands (msg:params)
      //    but this could intercept clicks we don't want...
      let src = tw.core.dom.nearestElementWithAttribute(el, 'data-msg');
      if (!src) return;
      let msg = src.getAttribute('data-msg');
      if (src.hasAttribute('data-param'))
        console.warn('data-param is no longer supported, use data-params', src);
      let params = src.getAttribute('data-params');
      if (!msg && isCommand(link)) msg = isCommand(link);
      if (!msg) return;
      if (src.getAttribute('data-default') !== 'true') event.preventDefault();
      let currentTiddlerTitle = tw.core.dom.nearestAttribute(el, 'data-tiddler-title', '.tiddler');
      if (msg) {
        let result = sendCommand(msg, params, currentTiddlerTitle);
        let targetId = src.getAttribute('data-target');
        if (!targetId) return result;
        // Display results
        let target = tw.core.dom.$(targetId);
        if (!target) {
          console.warn(`No target '${targetId}' found`);
          tw.events.send('tiddler.preview', {
            title: 'Results',
            text: result[0],
            type: 'x-twikki',
            tags: [],
          });
          return result;
        }
        target.innerHTML = result[0];
      }
    });
    document.addEventListener('dblclick', event => {
      let el = event.target;
      let t =
        tw.core.dom.nearestAttribute(el, 'data-tiddler-title', '.tiddler') ||
        tw.core.dom.nearestAttribute(el, 'tiddler-include', '[tiddler-include]');
      if (!t) return;
      formEditTiddler(t);
    });
    window.addEventListener('hashchange', function () {
      return handleHashLink(document.location.hash);
    });

    window.addEventListener('error', event => {
      tw.ui.notify('Unhandled: ' + event.message, 'E', event.error.stack);
      console.error('Unhandled:', event.message, event);
    });
  }

  /* ---------- Navigation ---------- */
  function navigateTo(link) {
    if (!link) return;
    tw.core.tiddlers.showTiddler(link);
    tw.core.tiddlers.scrollToTiddler(link);
    location.hash = '';
  }
  function sendCommand(cmd, params, currentTiddlerTitle) {
    // "foo.bar:${expression()}"          => events.send('foo.bar', expression())
    // "foo.bar:{json}"            => events.send('foo.bar', {…})
    // "foo.bar:pck:icons title:x" => events.send('foo.bar', {pck: 'icons', title: 'x'})
    // "foo.bar:My Note"           => events.send('foo.bar', 'My Note') (bare strings stay raw)
    let cmds = cmd.match(reCommand);
    if (!cmds) throw new Error(`Invalid command '${cmd}' does not match ${reCommand}/!`);
    let msg = cmds[1];
    if (!params) params = cmds.length > 2 ? cmds[2] : null;
    tw.logging.break('command');
    if (typeof params === 'string') {
      params = tw.events.decode(params);
      if (params === '$currentTiddler') params = `"${currentTiddlerTitle}"`;
      params = tw.core.params.parseParams(params);
    }
    dp('sendCommand', msg, 'params=', params);
    let result = tw.events.send(msg, params); // scroll-on-show is handled by the tiddler.show subscriber
    location.hash = '';
    return result;
  }
  function handleHashLink(hash) {
    if (!hash) return;
    let link = decodeURI(hash?.replace(/^#/, ''));
    let msg = isCommand(link);
    if (msg) {
      sendCommand(msg);
      return msg;
    } else {
      navigateTo(link);
      return link;
    }
  }
  function isCommand(str) {
    return str?.match(/^#?msg:(.+)/)?.[1];
  }
  function isLocalLink(str) {
    if (!str) return false;
    if (!str.match(/^#/)) return false;
    if (isCommand(str)) return false;
    return true;
  }

  /* ---------- The basic edit round-trip ---------- */
  function formEditTiddler(title) {
    let tiddler = tw.core.tiddlers.getTiddler(title);
    if (!tiddler) {
      tiddler = tw.core.tiddlers.nonExistentTiddler(title);
      tiddler.text = '';
    }
    formEditShow(tiddler);
  }

  function formEditShow(tiddler = {}, saveButton = true) {
    tw.core.dom.frm.elements['old-title'].value = tiddler.title || '';
    tw.core.dom.frm.elements['new-title'].value = tiddler.title || '';
    tw.core.dom.frm.elements['new-body'].value = tiddler.text || '';
    tw.core.dom.frm.elements['new-tags'].value = tiddler.tags || '';
    tw.core.dom.frm.elements['new-type'].value = tiddler.type || 'x-twikki';
    if (!saveButton) tw.core.dom.$('new-save').disabled = true;
    tw.core.dom.$('new-dialog').showModal();
    // Land the cursor where the user will type: the title input for a brand-new
    // (untitled) tiddler, the body textarea when editing one that already has a title.
    let focusElement = tw.core.dom.frm.elements[tiddler.title ? 'new-body' : 'new-title'];
    focusElement.focus();
    // The browser puts the cursor at the END of a prefilled textarea — start at the top instead
    focusElement.setSelectionRange(0, 0);
    focusElement.scrollTop = 0;
    setDirty(true);
    // Merge $TiddlerTypes shadow (built-in types) with tw.types
    // (plugin-registered types via tw.extensions.registerType). Plugin entries
    // override shadow entries on key collision (last-wins).
    const shadow = tw.core.tiddlers.getKeyValuesArray('$TiddlerTypes').reduce((acc, t) => {
      acc[t.key] = t.value;
      return acc;
    }, {});
    const merged = {...shadow, ...tw.types};
    tw.core.dom.$('new-types').innerHTML = Object.entries(merged)
      .map(([key, label]) => `<option value="${key}">${label}</option>`)
      .join('\n');
  }

  function formNewTiddler() {
    formEditShow(tw.core.tiddlers.emptyTiddler());
  }

  function formCancel() {
    let title = tw.core.dom.frm.elements['old-title'].value;
    if (!tw.core.tiddlers.getTiddler(title)) tw.core.tiddlers.hideTiddler(title);
    tw.core.dom.$('new-dialog').close();
    setDirty(false);
  }

  function formDone() {
    const t = {
      title: tw.core.dom.frm.elements['new-title'].value.trim(),
      text: tw.core.dom.frm.elements['new-body'].value,
      type: tw.core.dom.frm.elements['new-type'].value,
      tags: tw.core.dom.frm.elements['new-tags'].value.split(/[,\s]/).map(tg => tg.trim(tg)),
      updated: new Date(),
    };
    let oldTitle = tw.core.dom.frm.elements['old-title'].value;
    if (!t.created) t.created = t.updated; // Editing shadow tiddlers
    let issues = tw.util.tiddlerValidation(t);
    if (issues.length) return tw.ui.notify('Tiddler is invalid: ' + issues.join('<br>'), 'W');
    if (!t.title) {
      tw.ui.notify('Empty tiddler not saved!', 'W');
      return tw.core.dom.$('new-dialog').close();
    }
    let existingTiddler = tw.core.tiddlers.getTiddler(oldTitle, true);
    let forceSave = false;
    try {
      // Validate t.text with renderTWikki
      tw.core.render.renderTWikki({text: t.text, title: t.title, validation: true});
    } catch (e) {
      if (e.message.match(/existent/)) return tw.ui.notify(e.message, 'W');
      if (confirm(e.message + '\nDo you want to force save?')) {
        // Ignore error and proceed
        forceSave = true;
        // TODO: BUG: Doesn't display tiddler after creation
      } else {
        return;
        // Message already displayed in renderTWikki/executeText
      }
    }
    try {
      if (oldTitle && existingTiddler) {
        tw.core.tiddlers.updateTiddler(oldTitle, t, true, forceSave);
        tw.events.send('tiddler.edited', t.title); // rerenderTiddler()
      } else {
        tw.core.tiddlers.addTiddler(t, true);
        tw.events.send('tiddler.created', t.title); // renderNewTiddler()
      }
    } catch (e) {
      // validateTiddlerText (and the registered validator stack) throw here.
      // Identity errors from add/updateTiddler ('existent'/'non-existent'/
      // 'existing') aren't force-saveable — just notify. Validator throws
      // (and Readonly, which forceSave bypasses) get the same force-save
      // prompt as renderTWikki errors above.
      if (/existent|existing/.test(e.message)) return tw.ui.notify(e.message, 'W');
      if (confirm(e.message + '\nDo you want to force save?')) {
        if (oldTitle && existingTiddler) {
          tw.core.tiddlers.updateTiddler(oldTitle, t, true, true);
          tw.events.send('tiddler.edited', t.title);
        } else {
          tw.core.tiddlers.addTiddler(t, true, true);
          tw.events.send('tiddler.created', t.title);
        }
      } else {
        return tw.ui.notify(e.message, 'W');
      }
    }
    tw.core.dom.$('new-dialog').close();

    tw.events.send('tiddler.updated', t.title); // tiddlerUpdated()
    tw.core.render.renderAllTiddlers();
    setDirty(true);
    tw.core.store.save();
  }

  // Edit button on a section card: close the section view and open its parent
  // tiddler in the edit form (a section is not independently editable).
  function editTiddlerSection(sectionTitle) {
    let ref = tw.core.tiddlers.splitSectionRef(sectionTitle);
    if (!ref) return;
    tw.core.tiddlers.closeTiddler(sectionTitle);
    formEditTiddler(ref.base);
  }

  function setDirty(dirty) {
    if (dirty) {
      tw.ui.isDirty = true;
      window.addEventListener('beforeunload', preventBrowserClose);
    } else {
      tw.ui.isDirty = false;
      window.removeEventListener('beforeunload', preventBrowserClose);
    }
    tw.events.send('dirty.changed', dirty);
  }

  function preventBrowserClose(event) {
    event.preventDefault();
    event.returnValue = 'Tiddlers were not yet saved!';
  }

  /* ---------- Tiddler lifecycle reactions ---------- */
  function renderNewTiddler(title) {
    tw.core.tiddlers.showTiddler(title);
  }

  function tiddlerDeleted(t) {
    if (tw.core.tiddlers.isRunnableTiddler(t))
      if (confirm('Code tiddler deleted - would you like to reload?'))
        tw.events.send('reboot.hard');
  }

  function tiddlerUpdated(title) {
    let t = tw.core.tiddlers.getTiddler(title);
    if (['$SiteTitle', '$SiteSubTitle', '$TitleBar'].includes(title))
      tw.core.dom.$$('*[tiddler-include]')?.forEach(tw.core.render.tiddlerSpanInclude);
    else if (tw.core.tiddlers.isPackageList(t)) {
      if (confirm('Would you like to reload?')) {
        tw.core.store.save();
        tw.events.send('reboot.hard');
      }
    } else if (tw.core.tiddlers.isRunnableTiddler(t)) {
      tw.core.store.save();
      if (confirm(`Code '${t.title}' was edited. Reload now to apply changes?`))
        tw.events.send('reboot.hard');
    } else if (tw.core.tiddlers.tiddlerIsATemplate(t)) {
      tw.core.store.save();
      if (confirm(`Template '${t.title}' was edited. Reload now to apply changes?`))
        tw.events.send('reboot.hard');
    }
  }

  /* ---------- Layout ---------- */
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
  function currentLayoutTitle() {
    return (
      (tw.run.getTiddler('$Layout')?.text || '').replace(/[\[\]]/g, '').trim() || '$MainLayout'
    );
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

  /* ---------- HTML builders ---------- */
  function button(text, message, payload, id = '', attr = '', className = '') {
    // TODO: Would be nice to return an element here to which we could bind a real event and payload
    if (text.match(/[<\{]/))
      // WikiText
      text = tw.core.render.renderTWikki({text});
    else text = tw.core.common.escapeHtml(text);
    if (text.match(/<svg/)) className += ' icon';
    let paramAttribute = '';
    if (payload) {
      if (typeof payload === 'object') payload = JSON.stringify(payload);
      else if (typeof payload !== 'string') payload = String(payload);
      paramAttribute = ` data-params="---enc:${tw.core.common.encoder(payload)}"`;
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
      toolbar.insertAdjacentHTML(
        'beforeend',
        button(b.text, b.msg || '', b.payload, b.id || '', b.attr || '', b.className || ''),
      );
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
