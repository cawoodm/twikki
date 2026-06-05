(function() {

  const NAME = 'twikki';
  const VERSION = '0.22.0';

  overrides();

  // Constants
  // TODO: Warn about problematic characters in tiddler titles:
  //         '/' - Reserved for the (future) directories concept
  //         '!' - Used to negate logic (e.g. msg:search:!tag:$Shadow)
  // The section delimiter: a reference may address into a tiddler's sections as
  // `Title::Section`. ':' is therefore NOT a valid title character (so the '::'
  // in a reference is unambiguous against the single-colon command/search syntax
  // like msg:search:foo and tag:$Theme, which is parsed separately by reCommand).
  const SECTION_DELIM = '::';
  const reTiddlerTitle = /[a-z0-9_\-\.\(\)\s\$\ud83c\ud000-\udfff\ud83d\ud000-\udfff\ud83e\ud000-\udfff]+/gi;
  // A reference is a title, optionally followed by ::Section, so links/inclusions
  // can address into a tiddler: [[Title::Section]] / {{Title::Section}}. The
  // delimiter only ever SEPARATES two title segments \u2014 it can never lead \u2014 and
  // since ':' is not a valid title char it can never be confused with a title.
  const reTiddlerRef = new RegExp(`${reTiddlerTitle.source}(?:${SECTION_DELIM}${reTiddlerTitle.source})?`, 'gi');
  const reTiddlerTitleComplete = RegExp.compose(/^reTiddlerTitle$/gi, {reTiddlerTitle});
  const reMacros = /(?<!`)<<([a-z_][a-z_0-9\.]+)\s?([^>]+)?>>/gi;
  const reInclusion = RegExp.compose(/(?<!`)\{\{(reTiddlerRef)\|?([^\}]+)?}}/gi, {reTiddlerRef});
  const reInclusionParams = /\##([\$0-9a-z]+)\#([^\#]+)?#/gi;
  const reLinks = RegExp.compose(/\[\[(reTiddlerRef)]]/gi, {reTiddlerRef});
  // Events are alphanumeric with "." e.g. 'foo.bar' (lowercase only)
  const reEventName = /[a-z0-9\.]+/g;
  const reCommand = RegExp.compose(/(reEventName):?(.+)?/, {reEventName});
  const autoSave = true;

  let qs;
  let baseUrl;
  let tw = {};
  window.tw = tw; // Export tw so plugins can use it

  function read(key, def) {
    if (key[0] !== '/') key = '/' + key;
    let res = localStorage.getItem(key);
    return res === null ? def : res;
  }
  function write(key, value) {
    if (key[0] !== '/') key = '/' + key;
    return localStorage.setItem(key, value);
  }

  // Generic file drag/drop: plugins claim dropped files by filename glob via
  // tw.run.registerDropHandler('*.workspace.json', (text, file) => {...}).
  // The most specific (longest) matching pattern wins.
  const dropHandlers = [];
  let dragDepth = 0; // counter avoids overlay flicker when dragging over child elements
  function globToRegex(pattern) {
    return new RegExp('^' + pattern.replace(/[.]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
  }
  function registerDropHandler(pattern, handler) {
    dropHandlers.push({pattern, rx: globToRegex(pattern), handler});
  }

  window.twikki = {
    name: NAME,
    version: VERSION,
    async init() {
      qs = Object.fromEntries(new URLSearchParams(location.search));
      Object.keys(qs).filter(q => qs[q] === '').forEach(q => (qs[q] = true)); // Empty params are switches => convert to true
      window.dp = () => {};
      if (qs.logfilter)
        // Output filtered loggsOverwridden console.log has advantage of filtering logs
        window.dp = function() {
          if (!tw.logging.logFilter.test(JSON.stringify(Array.from(arguments)))) return; console.log.apply(console, arguments);
        };
      tw.core = {};
      tw.modules = [];
      tw.tmp = {};
      tw.templates = {};
      tw.tiddlers = {all: [], visible: [], trashed: []};
      tw.storage = {
        get(key) {
          let res = read(key);
          if (res?.match(/^[\[\{]/)) return JSON.parse(res);
          return res;
        },
        set(key, value) {
          if (typeof value === 'object') return write(key, JSON.stringify(value));
          return write(key, value);
        },
      };

      console.debug(`TWikki (v${VERSION}) starting...`);
      document.title = `TWikki v${VERSION}`;

      baseUrl = window.MODULE_URL || 'https://cawoodm.github.io/twikki';
      // Local dev: serve modules/packages from the dev server, not the published copy
      if (document.location.host.match(/^(localhost)|(\d+\.\d+\.\d+\.\d+):\d+$/)) baseUrl = document.location.origin;

      tw.logging = {
        logFilter: new RegExp(qs.logfilter || '.', 'i'),
        debugMode: qs.debug,
        breakPoint: qs.breakpoint,
        break(name) {
          // eslint-disable-next-line no-debugger
          if (tw.logging.breakPoint && name.match(new RegExp(tw.logging.breakPoint))) debugger;
        },
      };

      console.debug('Looking for local TWikki.Core modules...');

      let modulesToLoad = [
        '/core.js',
        '/core.common.js',
        '/core.sections.js',
        '/core.workspaces.js',
        '/core.defaults.json', 
        '/core.packaging.js',
        '/core.params.js',
        '/core.dom.js',
        '/core.ui.js',
        '/core.notifications.js', 
        '/core.templater.js',
        '/core.search.js',
        '/core.markdown.js',
      ];
      let modulesLoaded = await Promise.all(modulesToLoad.map(loadCoreModule));
      tw.modules = modulesToLoad.map((p, i) => ({name: p, res: modulesLoaded[i]}));

    },
    // eslint-disable-next-line require-await
    async start() {
      const errMsgs = [];

      tw.modules
        .forEach(pck => {
          if (pck.res.type === 'code') {
            console.debug('Installing code module', pck.name);
            if (!qs.trace) {
              // Normally we try/catch modules to provide user-friendly feedback...
              try {
                pck.meta = (1, eval)(pck.res.code)(tw);
              } catch (e) {
                let errMsg = `Module '${pck.name}' failed: ${e.message}`;
                errMsgs.push(errMsg);
                console.error(errMsg, e.stack);
                return;
              }
            } else {
              // ...however, developers want to know where exactly the error occurred
              //   and this is only possible when we let the original event bubble up unhandled!!
              pck.meta = (1, eval)(pck.res.code)(tw);
            }
            if (pck.meta.exports) {
              let p = pck.meta.name.split('.');
              eval('tw.core.' + p[1] + '={};');
              Object.assign(eval('tw.' + pck.meta.name), pck.meta.exports);
            }
            console.debug(`Loaded ${pck.meta.name} (v${pck.meta.version})`);
          } else if (pck.res.type === 'list') {
            console.debug('Loading moduled list ', pck.name); // What is a moduled list? Example?
            pck.res.tiddlers.forEach(t => {
              t.doNotSave = true; // Don't save unless edited
              t.isRawShadow = true; // TODO: What does this mean exactly?
            });
            /* pck.res.tiddlers.forEach(t => {
              if (tiddlerExists)
              })*/
            tw.tiddlers.all = tw.tiddlers.all.concat(pck.res.tiddlers);
            console.debug(`Loaded ${pck.res.tiddlers.length} core/shadow tiddlers from ${pck.name})`);
          } else {
            console.warn(`Skipping unknown module type '${pck.res.type}' in module '${pck.name}'!`);
          }
        });
      if (handleModuleErrors(errMsgs)) return;

      tw.ui = {notify: tw.core.notifications.notify}; // Legacy API
      tw.shadowTiddlers = Array.from(tw.tiddlers.all);
      tw.shadowTiddlers.forEach(t => {
        // HACK: Load packages locally for development
        if (t.title === '$CorePackages' && document.location.host.match(/^(localhost)|(\d+\.\d+\.\d+\.\d+):\d+$/)) t.text = t.text.replaceAll('https://cawoodm.github.io/twikki', 'http://' + document.location.host);
        if (t.title === '$ExtensionPackages' && document.location.host.match(/^(localhost)|(\d+\.\d+\.\d+\.\d+):\d+$/)) t.text = t.text.replaceAll('https://cawoodm.github.io/twikki', 'http://' + document.location.host);
      });
      Object.freeze(tw.shadowTiddlers);

      loadStore();

      wireUpEvents();

      console.debug(`${tw.modules.length} modules loaded. Running modules...`);
      tw.modules
        .filter(pck => pck.meta?.run)
        .forEach(pck => {
          console.debug(`Running module '${pck.name}'...`);
          if (!qs.trace) {
            // Normally we try/catch modules to provide user-friendly feedback...
            try {
              pck.meta.run();
            } catch (e) {
              let errMsg = `Module '${pck.name}' failed: ${e.message}`;
              errMsgs.push(errMsg);
              console.error(errMsg, e.stack);
              return;
            }
          } else {
            // ...however, developers want to know where exactly the error occurred
            //   and this is only possible when we let the original event bubble up unhandled!!
            pck.meta.run();
          }
        });
      console.debug('Modules run');
      if (handleModuleErrors(errMsgs)) return;

      document.title = renderTiddler('$SiteTitle');
      tw.extend = {tiddlerDetails: {
        metaInfo(t) {
          // The package is a picker (see $PickerPlugin): clicking it lists every
          // tiddler in that package (built lazily from data-source="package");
          // picking one opens it. Raw HTML — the picker needs real markup.
          const parts = [];
          if (t.package) {
            const arg = String(t.package).replace(/"/g, '&quot;');
            const label = tw.core.common.escapeHtml(t.package);
            parts.push(
              `<span class="picker pck-picker" data-event="tiddler.show" data-source="package" data-source-arg="${arg}">` +
                `<button class="picker-trigger pck-pill">pck:${label}</button>` +
                `<div class="picker-menu" hidden></div>` +
              `</span>`,
            );
          }
          if (t.doNotSave) parts.push('doNotSave ✅');
          if (t.isRawShadow) parts.push('isRawShadow ✅');
          return parts.join(' ');
        },
      }};

      tw.run = {
        save,
        saveAll,
        saveVisible,
        updateTiddler,
        updateTiddlerHard,
        addTiddler,
        addTiddlerHard,
        deleteTiddler,
        getTiddler,
        getSection,
        getTiddlerList,
        getTiddlersByTag,
        getTiddlersByPackage,
        getTiddlerTextList,
        getTiddlerTextRaw,
        getJSONObject,
        getKeyValuesArray,
        getKeyValuesObject,
        getTiddlerElement,
        tiddlerToggleTag,
        showTiddlerList,
        showTiddler,
        previewTiddler,
        rerenderTiddler,
        showAllTiddlers,
        closeAllTiddlers,
        closeTiddler,
        hideTiddler,
        renderAllTiddlers,
        sendCommand,
        reload,
        registerDropHandler,
        tiddler: {
          getJSONObject,
          updateText: updateTiddlerText,
        },
      };
      // ----------
      // Legacy Aliases
      tw.util = {tagMatch, titleMatch, titleIs, tiddlerValidation, tiddlerExists};
      tw.lib = {markdown: tw.core.markdown.render};
      Object.assign(tw.ui, tw.core.ui);
      tw.ui.notify = tw.core.notifications.notify;
      tw.call = call;
      tw.extensions = {
        registerMacro(namespace, name, fcn, options) {
          if (!tw.macros[namespace]) tw.macros[namespace] = {};
          tw.macros[namespace][name] = fcn;
          if (options) Object.assign(tw.macros[namespace][name], options);
        },
        registerPlugin(namespace, name, fcn, options) {
          if (!tw.plugins[namespace]) tw.plugins[namespace] = {};
          tw.plugins[namespace][name] = fcn();
          if (options) Object.assign(tw.plugins[namespace][name], options);
        },
      };
      window.markdown = tw.lib.markdown;
      // ----------
      tw.macros = {
        core: {
          showTiddlerList,
          // <<Tag Foo>> — render tag "Foo" as a picker listing all tiddlers tagged Foo.
          Tag: tag => tagPickerHtml(String(tag ?? '')),
          disabled: (...rest) => ('This macro is disabled!' + JSON.stringify(rest)),
        },
      };
      tw.plugins = {};

      console.debug(`*** TWikki v${VERSION}`);
      if (handleModuleErrors(errMsgs)) return;

      // TODO: Load External Scripts and Stylesheets
      // TODO: Load Extensions
      onPageLoad();
    },
  };
  function handleModuleErrors(errMsgs) {
    if (errMsgs.length === 0) return;
    document.write('<h1>Module Errors Occurred</h1>');
    errMsgs.forEach(e => {
      document.write(`<p class="error">${e}`);
    });
    let traceUrl = document.location.href;
    traceUrl = traceUrl.match(/\?/) ? traceUrl + '&trace' : traceUrl + '?trace';
    document.write('<p class="error">Tips:');
    document.write('<ul>');
    document.write(`<li>Tip: Launch with <a href="${traceUrl}&debug">?trace&debug</a> to see source of error`);
    document.write('<li>Tip: Try <a href="?update">?update</a> to try a reload of modules');
    document.write('<li>Tip: Try <a href="?reload">?reload</a> to force a reload of modules');
    document.write('</ul>');
  }

  async function onPageLoad() {
    tw.events.send('ui.loading');
    wireEvents();
    await loadCoreModules();
    if (!qs.safemode) await loadExtensionPackages();
    // TODO: Load registered scripts/css here like our highlighter core, css and languages
    reload();
    if (location.hash) handleHashLink(location.hash);
  }
  /* BEGIN TWikki */
  /* Functions */

  function rebootHard() {
    window.location.reload();
  }
  function reload() {
    // TODO: Clear events.clearAll()
    tw.tiddlers.visible = tw.tiddlers.visible.filter(title => tiddlerExists(title));
    runCoreTiddlers();
    if (!qs.safemode) {
      runExtensionTiddlers();
      initPlugins();
      runPlugins();
    }
    loadTemplates(); // Must load templates here or we can use no macros in the templates
    tw.core.dom.$$('*[tiddler-include]')?.forEach(tiddlerSpanInclude);
    tw.core.dom.$$('*[macro]')?.forEach(macroInclude);
    if (!tw.tmp.rebootCount) tw.tmp.rebootCount = 0;
    tw.tmp.rebootCount++;
    if (tw.tmp.rebootCount === 1) tw.events.send('ui.loaded');
    else tw.events.send('ui.reloaded', tw.tmp.rebootCount);
    renderAllTiddlers();
  }
  function loadTemplates() {
    tw.templates.MainLayout = renderTiddler('$MainLayout');
    tw.templates.TiddlerDisplay = renderTiddler('$TiddlerDisplay');
    tw.templates.TiddlerPreview = renderTiddler('$TiddlerPreview');
    tw.templates.TiddlerTrashed = renderTiddler('$TiddlerTrashed');
    tw.templates.TiddlerSearchResult = renderTiddler('$TiddlerSearchResult');
  }
  async function loadCoreModules() {
    let packages = tw.run.getTiddlerList('$CorePackages');
    await loadPackages(packages);
  }
  async function loadExtensionPackages() {
    let packages = tw.run.getTiddlerList('$ExtensionPackages');
    await loadPackages(packages);
  }
  async function loadPackages(packages) {
    for (let p of packages) {
      let params = p.split(' ');
      let url = params[0];
      let name = url.match(/([^.\/]+)\.json$/)?.[1];
      let overWrite = false; // Overwrite after prompt
      let noOverWrite = false;
      let doNotSave = false;
      if (p.length > 1) {
      // TODO: * <<packages.import url:... force:true save:true>>
        params.splice(0, 1);
        let opt = params.join('');
        // "force, save" => ["force", "save"]
        let options = opt.split(',').map(o => o.trim().toLowerCase());
        overWrite = options.includes('force'); // Overwrite silently
        noOverWrite = options.includes('nooverwrite'); // Never overwrite, skip silently
        doNotSave = options.includes('nosave');
      }
      // TODO: Split URL and check update,force(overWrite),save(doNotSave) options
      let count = await tw.core.packaging.loadPackageFromURL({url, name, overWrite, noOverWrite, doNotSave});
      // If name === 'core' AND tw.tiddlers.all.find(t => t.package === 'core') panic or open $CorePackages for edit as it's screwed!
      tw.ui.notify(`${count} tiddlers imported from package ${name}`, 'D');
    }
    // tw.ui.notify('Don\'t forget to save!', 'I');
    saveSilent();
  }

  function wireUpEvents() {
    // tw.events.clear();
    tw.events.init();
    wireUp('ui.open.all', showAllTiddlers);
    wireUp('ui.close.all', closeAllTiddlers);
    wireUp('save', save);
    wireUp('save.silent', saveSilent);
    wireUp('save.all', saveAll);
    wireUp('reboot.hard', rebootHard);
    wireUp('ui.reload', reload);

    wireUp('tiddler.new', formNewTiddler);
    wireUp('tiddler.edit', formEditTiddler);
    wireUp('tiddler.show', title => {showTiddler(title); scrollToTiddler(title);});
    wireUp('section.edit', editTiddlerSection);
    wireUp('tiddler.close', closeTiddler);
    wireUp('tiddler.preview', previewTiddler);
    wireUp('tiddler.preview.close', closePreview);
    wireUp('tiddler.delete', deleteTiddler);
    wireUp('tiddler.deleted', tiddlerDeleted);
    wireUp('tiddler.refresh', rerenderTiddler);
    wireUp('tiddler.text', getTiddlerTextRaw);
    wireUp('tiddler.content', renderTiddler);

    wireUp('tiddler.edited', rerenderTiddler);
    wireUp('tiddler.created', renderNewTiddler);
    wireUp('tiddler.updated', tiddlerUpdated);

    wireUp('store.load', loadStore);

    wireUp('form.done', formDone);
    wireUp('form.cancel', formCancel);

    wireUp('package.load.url', tw.core.packaging.loadPackageFromURL);
    wireUp('package.reload.url', tw.core.packaging.reloadPackageFromUrl);
  }
  function wireUp(event, handler) {
    tw.events.subscribe(event, handler, 'core');
  }

  function tiddlerIsValid(t) {
    let msg = tiddlerValidation(t);
    if (msg.length)
      console.warn('tiddlerValidation', t.title, msg.join('; '));
    return msg.length === 0;
  }

  function tiddlerToggleTag(title, tag) {
    let t = getTiddler(title);
    if (!t.tags.includes(tag)) upsertInArray(t.tags, tg => tg === tag, tag);
    else removeFromArray(t.tags, tg => tg === tag);
    updateTiddler(title, t, true);
    tw.events.send('tiddler.refresh', t.title);
  }

  function validateTiddlerText(t) {
    if (t.type === 'json') return jsonValidator(t.text);
    tiddlerCodeBlocks(t).forEach(b => executeText(b.text, b.title)); // validate by executing (as code tiddlers do)
    if (isCodeTiddler(t) && t.tags.includes('$CodeDisabled')) alert('This code tiddler is disabled and will not run. Remove the $CodeDisabled tag to activate.');
  }
  function tiddlerValidation(t) {
    const msg = [];
    if (!t.title) msg.push('No title!');
    if (!t.title.match(reTiddlerTitleComplete)) msg.push('Invalid title!');
    if (!t.type) msg.push('No type!');
    // if (typeof t.text !== 'string') t.text = ''; // msg.push('No/invalid text!');
    // Convert old string tags to array
    if (!Array.isArray(t.tags)) msg.push('Invalid tags!');
    t.tags = typeof t.tags === 'string' ? (t.tags.length ? t.tags.split(' ') : []) : t.tags;
    if (!Array.isArray(t.tags)) msg.push('No tags array!');
    if (!t.created) msg.push('No created date!');
    if (!t.updated) msg.push('No updated date!');
    return msg;
  }
  function runCoreTiddlers() {
    tw.tiddlers.all
      .filter(isCoreTiddler)
      .forEach(runTiddlerCode);
  }
  function runExtensionTiddlers() {
    tw.tiddlers.all
      .filter(t => !isCoreTiddler(t))
      .forEach(t => {
        let blocks = tiddlerCodeBlocks(t);
        if (!blocks.length) return;
        if (qs.trace) return blocks.forEach(b => executeCodeTiddler(b.text, b.title));
        try {
          blocks.forEach(b => executeCodeTiddler(b.text, b.title));
        } catch (e) {
          tw.ui.notify(`Extension Tiddler '${t.title} failed (see console log)`, 'E', e.stack);
          console.error(`Extension Tiddler '${t.title} failed: ${e.message}`, e.stack);
          if (confirm(`Extension Tiddler '${t.title} failed. Would you like to disable it?`)) {
            t.tags.push('$CodeDisabled');
          }
        }
      });
  }
  function initPlugins() {
    Object.keys(tw.plugins)
      .forEach(n => {
        let namespace = tw.plugins[n];
        Object.keys(namespace).forEach(p => {
          let plugin = namespace[p];
          dp('Initializing plugin', plugin.name, plugin.version);
          plugin.init();
        });
      });
  }
  function runPlugins() {
    Object.keys(tw.plugins)
      .forEach(n => {
        let namespace = tw.plugins[n];
        Object.keys(namespace).forEach(p => {
          let plugin = namespace[p];
          dp('Running plugin', plugin.name, plugin.version);
          plugin.start();
        });
      });
  }
  function executeCodeTiddler(text, title) {
    if (qs.trace) return executeText(text, title);
    try {
      return executeText(text, title);
    } catch (e) {
      tw.ui.notify(e.message, 'E', e.stack);
      throw e;
    }
  }
  function executeText(text, title, context) {
    if (qs.trace) return (1, eval)(text);
    try {
      return (1, eval)(text);
    } catch (e){
      let msg = `executeText "${title}" ${context ? ' in tiddler \'' + context + '\'' : ''}`;
      // tw.ui.notify(msg, 'E');
      console.error(`${msg}: ${e.message}`, e.stack);
      throw e; // new Error(`${msg}: ${e.message}`);
    }

  }
  function renderAllTiddlers() {
    tw.core.dom.divVisibleTiddlers.innerHTML = '';
    tw.tiddlers.visible.forEach(showTiddler);
    // searchShowResults();
    tw.events.send('story.rendered', tw.tiddlers.visible);
  }
  function createTiddlerElement(t, template) {
  // TODO: If $TiddlerDisplay breaks TW is unusable!
    template = template || tw.templates.TiddlerDisplay;
    let modified = t.updated ? new Date(t.updated).toDateString() + ' ' + new Date(t.updated).toLocaleTimeString() : '';
    let id = tw.core.common.hash(t.title);
    let html = new tw.core.templater.Templater(template).render({
      id,
      fullText: makeTiddlerText(t),
      editDisabled: t.tags.includes('$NoEdit') ? 'disabled' : '',
      notSection: !t.isSection, // template uses {{!isSection}} / {{!notSection}} (negation blocks only)
      tagLinks: makeTiddlerTagLinks(t.tags),
      modified,
      ...tiddlerDetails(t),
      ...t,
    });
    let newElement = tw.core.dom.htmlToNode(html);
    newElement.setAttribute('data-tiddler-id', id);
    newElement.setAttribute('data-tiddler-title', t.title);
    tw.events.send('tiddler.element.created', {title: t.title, newElement});
    return newElement;
  }

  function tiddlerDetails(t) {
    let res = {};
    Object.keys(tw.extend.tiddlerDetails).forEach(k => {
      res[k] = tw.extend.tiddlerDetails[k](t);
    });
    return res;
  }

  function makeTiddlerText({title, text, type}) {
    const markdownTypes = ['markdown', 'keyval', 'list', 'table'];
    const codeTypes = ['macro', 'script/js', 'css', 'json', 'html/template'];
    if (type === 'x-twikki') {
      return tw.core.markdown.render(renderTWikki({text, title}));
    } else if (markdownTypes.includes(type)) {
      return tw.core.markdown.render(text);
    } else if (codeTypes.includes(type)) {
      return `<pre><code>${tw.core.common.escapeHtml(text)}</code></pre>`;
    } else if (type === 'html') {
      return text;
    } else {
      return `<pre>${tw.core.common.escapeHtml(text)}</pre>`;
    }
  }
  function makeTiddlerTagLinks(tags) {
    return tags.map(tagPickerHtml).join('');
  }
  // A single tag rendered as a picker (see $PickerPlugin): clicking it lists every
  // tiddler carrying that tag (built lazily from data-source="tag"); picking one
  // opens it. Used by the tag row at the bottom of notes and the <<Tag>> macro.
  function tagPickerHtml(tag) {
    if (!tag) return '';
    let label = tw.core.common.escapeHtml(tag);
    let arg = label.replace(/"/g, '&quot;');
    return `<span class="picker tag-picker" data-event="tiddler.show" data-source="tag" data-source-arg="${arg}">` +
      `  <button class="picker-trigger pck-pill">${label}</button>` +
      '  <span class="picker-menu" hidden></span>' +
      '</span>';
  }
  function renderTiddler(title) {
    return renderTWikki({text: getTiddlerTextRaw(title), title});
  }
  function renderTWikki({text, title, validation}) {
    // Hide fenced/inline code from the wikitext transforms below so their
    // contents render verbatim; restored before markdown parsing.
    const {masked, restore} = maskCodeRegions(text);
    let result = masked;
    try {
    // TODO: Label this tiddler to update when one of these macros change!

      getMacros(result).forEach(m => {
        let macroNameOrig = m[1];
        let macroName = macroNameOrig;
        const macroCommand = new RegExp(`(?<!\`)<<${macroNameOrig}`);
        const indexOfMacro = result.search(macroCommand);
        /* ******************* DBG ***************
      dbg = title.match(/TestLinks/i) && m[1].match(/tests/);
      */
        let dbg = 0;
        // eslint-disable-next-line no-debugger
        if (dbg) debugger;

        // Resolve Macro Function
        let err;
        let macroFunction;
        try {macroFunction = eval(`tw.macros.${macroName}`);} catch (e) {err = e;}
        if (!macroFunction) try {macroName = `core.${macroName}`; macroFunction = eval(`tw.macros.${macroName}`);} catch (e) {err = e;}
        if (!macroFunction) {
          let errmsg = `Unknown macro <<${m[1]}>> in tiddler '${title}'!`;
          console.warn(errmsg, err?.message || '', err?.stack);
          result = replaceFrom(result, indexOfMacro, m[0], `<span class="error">ERROR: Unknown macro &lt;&lt;${m[1]}>></span>`);
          if (validation) throw new Error(errmsg);
          return;
        }
        if (m[2]?.match(/;/)) console.warn('Deprecated ";" in macroParams', macroName, title);
        let macroParams = m[2] || '';
        // TODO: Inclusions (pass {{DataTiddler}} as string/array/object) would be cool
        macroParams = tw.core.params.parseParams(macroParams);
        if (dbg) {dp({macroName, macroParams}); }
        if (qs.trace) {
          let newText = Array.isArray(macroParams) ? macroFunction(...macroParams) : macroFunction(macroParams);
          result = replaceFrom(result, indexOfMacro, m[0], newText);
          return;
        }
        try {
        /* *** Run Macro *** */
        // TODO: Support async macros
          let newText = Array.isArray(macroParams) ? macroFunction(...macroParams) : macroFunction(macroParams);
          if (typeof newText === 'undefined') console.warn('Macro returned undefined!', macroName, 'in', title);
          result = replaceFrom(result, indexOfMacro, m[0], newText);
        } catch (e) {
          let errmsg = `Macro '${macroName}' failed in tiddler '${title}'!`;
          if (e.message === 'macroFunction is not a function') errmsg += ` The macro is unknown or not registered!`; 
          else errmsg += e.message;
          console.warn(errmsg, e.stack);
          result = result.replace(macroCommand, `<span class="error">${errmsg} (see console log)</span>`);
          if (validation) throw e;
          return;
        }
      });
      // TODO: Support raw/wikified {{=}} inclusions
      getInclusions(result).forEach(m => {
        let title = m[1];
        const inclusionSearch = new RegExp(`(?<!\`)${escapeRegExp('{{' + title)}`);
        const indexOfInclusion = result.search(inclusionSearch);
        if (indexOfInclusion < 0) throw new Error(`Unable to locate inclusion of '${title}'!`);
        // if (title === '$TWikkiVersion') {dp(inclusionSearch); debugger;}
        let params = m[2];
        params = tw.core.params.parseParams(params);
        // dp('inclusion: title=', title, 'params=', params);
        let text = getTiddlerTextReplaced(title, params);
        if (!text) text = `No tiddler '${title}' found - let's [create it](#${title})!`;
        // result = result.replace(m[0], text);
        result = replaceFrom(result, indexOfInclusion, m[0], text);
      });
      function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
      }
      getTiddlerLinks(result).forEach(m => {
        let linkName = m[1];
        let linkURL = m[1];
        let wikiLink = `[${linkName}](#${linkURL.replace(/ /g, '%20')})`;
        result = result.replace(m[0], wikiLink);
      });
    // TODO: Auto-link CamelCase words? except ~CamelCasedTilde?
    } catch (e) {
      console.warn(`renderTWikki "${title}" Failed: ${e.message}`, e.stack);
      if (validation) throw e;
      return `<span class="error">ERROR: renderTWikki '${title}' Failed: ${e.message}</span>`;
    }
    return restore(result);
  }
  function replaceFrom(text, index, search, replace) {
    return text.substring(0, index) + text.substring(index).replace(search, replace);
  }
  // Mask fenced code blocks (```...```) and inline code spans (`...`) so the
  // macro/inclusion/wikilink transforms in renderTWikki leave their contents
  // verbatim; markdown-it renders the restored code literally. Sentinels use
  // the Unicode Private-Use Area so they contain no `[[`/`{{`/`<<` delimiters
  // and can never collide with real content (or stray digits) on restore.
  function maskCodeRegions(text) {
    const store = []; // holds masked code regions
    const stash = m => {
      const token = `${store.length}`;
      store.push(m);
      return token;
    };
    // Fenced blocks first (they may contain inline backticks), then inline spans.
    let masked = text.replace(/```[\s\S]*?```/g, stash);
    masked = masked.replace(/`[^`\n]*`/g, stash);
    const restore = s => s.replace(/(\d+)/g, (_, i) => store[Number(i)]);
    return {masked, restore};
  }
  function getMacros(text) {
    return Array.from(text.matchAll(reMacros));
  }
  function getTiddlerLinks(text) {
    return Array.from(text.matchAll(reLinks));
  }
  function getInclusions(text) {
  // {{SomeTiddlerTitle}} or {{SomeTiddlerTitle:Params}}
    return Array.from(text.matchAll(reInclusion)); // /\{\{([\-\$a-z_0-9\.]+)\:?([^\}]+)?}}/gi);
  }
  function previewTiddler(t, template) {
  // A way of showing a tiddler which may or may not exist
    if (typeof t === 'string') t = getTiddler(t);
    let newElement = createTiddlerElement(t, template || tw.templates.TiddlerPreview);
    tw.core.dom.preview.innerHTML = '';
    tw.core.dom.preview.insertAdjacentElement('afterbegin', newElement);
    tw.core.dom.preview.showModal();
  }
  function closePreview() {
    tw.core.dom.preview.close();
  }

  function formEditTiddler(title) {
    let tiddler = getTiddler(title);
    if (!tiddler) {
      tiddler = nonExistentTiddler(title);
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
    tw.core.dom.frm.elements[tiddler.title ? 'new-body' : 'new-title'].focus();
    setDirty(true);
    tw.core.dom.$('new-types').innerHTML = getKeyValuesArray('$TiddlerTypes').map(t => {
      return `<option value="${t.key}">${t.value}</option>`;
    }).filter(notEmpty).join('\n');
  }
  function formNewTiddler() {
    formEditShow(emptyTiddler());
  }
  function formCancel() {
    let title = tw.core.dom.frm.elements['old-title'].value;
    if (!getTiddler(title)) hideTiddler(title);
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
    let issues = tiddlerValidation(t);
    if (issues.length) return tw.ui.notify('Tiddler is invalid: ' + issues.join('<br>'), 'W');
    if (!t.title) {
      tw.ui.notify('Empty tiddler not saved!', 'W');
      return tw.core.dom.$('new-dialog').close();
    }
    let existingTiddler = getTiddler(oldTitle, true);
    let forceSave = false;
    try {
    // Validate t.text with renderTWikki
      renderTWikki({text: t.text, title: t.title, validation: true});
    } catch (e) {
      if (e.message.match(/existent/)) return tw.ui.notify(e.message, 'W');
      if (confirm(e.message + '\nDo you want to force save?')) {
      // Ignore error and proceed
        forceSave = true;
      // TODO: BUG: Doesn't display tiddler after creation
      } else {
        return;
      // Message already displayed in renderTWikki/executeText
      // tw.ui.notify(e.message, 'E', e.stack);
      }
    }
    if (oldTitle && existingTiddler) {
      updateTiddler(oldTitle, t, true, forceSave);
      tw.events.send('tiddler.edited', t.title); // rerenderTiddler()
    } else {
      addTiddler(t, true);
      tw.events.send('tiddler.created', t.title); // renderNewTiddler()
    }
    tw.core.dom.$('new-dialog').close();

    tw.events.send('tiddler.updated', t.title); // tiddlerUpdated()
    renderAllTiddlers();
    setDirty(true);
    save();
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

  function addTiddler(newTiddler, userEdit, forceSave) {
    if (userEdit) {
      const existingTiddler = getTiddler(newTiddler.title, false);
      if (existingTiddler) throw new Error(`Unable to add (overwrite) existent tiddler '${newTiddler.title}'!`);
      if (!newTiddler.created) newTiddler.created = newTiddler.updated || new Date(); // $Shadow tiddlers need this when saved
      delete newTiddler.doesNotExist;
      delete newTiddler.isRawShadow;
      if (!forceSave) validateTiddlerText(newTiddler);
    }
    addTiddlerHard(newTiddler);
  }
  function addTiddlerHard(newTiddler) {
    upsertInArray(tw.tiddlers.all, titleIs(newTiddler.title), newTiddler);
  // No need to add to top of story, handled by event => renderNewTiddler
  }

  function updateTiddler(currentTitle, newTiddler, userEdit, forceSave) {
    const existingTiddler = getTiddler(currentTitle, true);
    if (!existingTiddler) throw new Error(`Unable to update non-existent tiddler '${currentTitle}'!`);
    if (newTiddler.title !== currentTitle && getTiddler(newTiddler.title)) throw new Error(`Cannot overwrite existing tiddler '${newTiddler.title}!`);
    if (!forceSave && userEdit && existingTiddler.tags.includes('$NoEdit')) throw new Error(`Readonly tiddler '${currentTitle}' cannot be updated!`);
    if (userEdit) delete existingTiddler.doNotSave;
    if (!forceSave && userEdit) validateTiddlerText(newTiddler);
    delete newTiddler.isRawShadow;
    updateTiddlerHard(currentTitle, newTiddler);
    // Move to top of story
    if (userEdit) replaceInArray(tw.tiddlers.visible, title => title === currentTitle, newTiddler.title);
    tw.events.send('tiddler.modified', newTiddler.title);
  }
  function updateTiddlerHard(currentTitle, newTiddler) {
    upsertInArray(tw.tiddlers.all, titleIs(currentTitle), newTiddler);
  }
  // TODO: BUG: VITE: Vite is tree-shaking this away!!!
  function updateTiddlerText(title, text) {
    let t = getTiddler(title);
    updateTiddler(title, {...t, text});
  }
  function rerenderTiddler(title) {
    let el = getTiddlerElement(title);
    if (!el) return;
    let tiddler = getTiddler(title);
    if (!tiddler) throw new Error(`rerenderTiddler '${title}' failed!`, 'E');
    let newElement = createTiddlerElement(tiddler);
    el.replaceWith(newElement);
    tw.events.send('tiddler.rendered', {tiddler, newElement});
  }
  function jsonValidator(text) {
    try {
      JSON.parse(text);
      return true;
    } catch (e) {
      throw e;
    }
  }
  function renderNewTiddler(title) {
    showTiddler(title);
  }
  function showTiddler(title) {
    if (getTiddlerElement(title)) {
      tw.events.send('tiddler.refocus', title); // already open: let the tabs layer focus it
      return scrollToTiddler(title);
    }
    // if (getTiddlerElement(title)) hideTiddler(title);
    let tiddler = getTiddler(title) || sectionTiddler(title);
    if (!tiddler) tiddler = nonExistentTiddler(title); // throw new Error(`showTiddler '${title}' failed!`, 'E');
    let newElement = createTiddlerElement(tiddler);
    // TODO: If it's a code tiddler run it (if !Disabkled) and show error message in red
    tw.core.dom.divVisibleTiddlers.insertAdjacentElement('afterbegin', newElement);
    if (tw.tiddlers.visible.indexOf(tiddler.title) === -1) tw.tiddlers.visible.push(tiddler.title);
    tw.events.send('tiddler.rendered', {tiddler, newElement});
    saveVisible();
  }
  // Split a `Title::Section` reference into {base, section}, or null when the ref
  // holds no section delimiter. The single place that knows the delimiter width.
  function splitSectionRef(ref) {
    if (typeof ref !== 'string') return null;
    let i = ref.indexOf(SECTION_DELIM);
    if (i < 0) return null;
    return {base: ref.slice(0, i), section: ref.slice(i + SECTION_DELIM.length)};
  }
  // For a `Title::Section` reference, synthesize a display-only tiddler holding
  // just that section (rendered by its own type via makeTiddlerText). Never added
  // to tw.tiddlers.all — the parent stays the single store entry.
  function sectionTiddler(title) {
    let ref = splitSectionRef(title);
    if (!ref) return null;
    let base = getTiddler(ref.base);
    if (!base) return null;
    let sec = tw.core.sections.getSection(base.text, ref.section);
    if (!sec) return null;
    // isSection drives the read-only UI: no delete, and edit redirects to the parent.
    return {title, text: sec.text, type: sec.type || base.type, tags: [], doNotSave: true, isSection: true};
  }
  // Edit button on a section card: close the section view and open its parent
  // tiddler in the edit form (a section is not independently editable).
  function editTiddlerSection(sectionTitle) {
    let ref = splitSectionRef(sectionTitle);
    if (!ref) return;
    closeTiddler(sectionTitle);
    formEditTiddler(ref.base);
  }
  function emptyTiddler() {
    return {title: '', text: '', type: 'x-twikki', tags: []};
  }
  function nonExistentTiddler(title) {
    let t = emptyTiddler();
    Object.assign(t, {title, text: `The tiddler '${title}' does not exist`, doesNotExist: true});
    return t;
  }
  function tiddlerDeleted(t) {
    if (isRunnableTiddler(t))
      if (confirm('Code tiddler deleted - would you like to reload?')) rebootHard();
  }
  function tiddlerUpdated(title) {
    let t = getTiddler(title);
    let codeBlocks = tiddlerCodeBlocks(t);
    if (codeBlocks.length)
    // TODO: Try, catch, return error <span class="error">
      return codeBlocks.forEach(b => executeCodeTiddler(b.text, b.title));
    if (['$SiteTitle', '$SiteSubTitle', '$TitleBar'].includes(title))
      tw.core.dom.$$('*[tiddler-include]')?.forEach(tiddlerSpanInclude);
    else if (tiddlerIsATemplate(t))
      loadTemplates();
    else if (isPackageList(t))
      if (confirm('Would you like to reload?')) {
        save();
        tw.events.send('reboot.hard');
      }
    if (title === '$MainLayout')
      if (confirm('Would you like to reload?')) {
        save();
        tw.events.send('reboot.hard');
      }
  }
  function tiddlerIsATemplate(t) {
    return t.tags.includes('$Template');
  }

  /* ARRAY Functions */
  function replaceInArray(array, test, newItem) {
    let index = array.findIndex(test);
    if (index >= 0) array[index] = newItem;
  }
  function upsertInArray(array, test, newItem) {
  // if (!test) test = i => i === newItem;
    let index = array.findIndex(test);
    if (index >= 0) array[index] = newItem;
    else array.push(newItem);
  }
  function removeFromArray(array, test) {
    let index = array.findIndex(test);
    if (index >= 0) return array.splice(index, 1);
  }

  /* TODO: Move to $GeneralCoreMacros.js */
  function showAllTiddlers({tag, title, pck}={}) {
    if (!title) title = '!^\\$';
    tiddlerList({title, tag, pck})
      .map(t => t.title)
      .forEach(showTiddler);
    renderAllTiddlers();
  }
  function closeAllTiddlers({tag = '', title = '', pck}={}) {
    if (!title) title = '!^\\$';
    tiddlerList({title, tag, pck})
      .map(t => t.title)
      .forEach(hideTiddler);
  }
  function tiddlerList({title, tag, pck}={}) {
    return tw.tiddlers.all
      .filter(titleMatch(title))
      .filter(tagMatch(tag))
      .filter(t => !pck || t.package === pck);
  }
  function getTiddlerElement(title) {
    let id = tw.core.common.hash(title);
    return tw.core.dom.divVisibleTiddlers.querySelector(`*[data-tiddler-id="${id}"]`);
  }
  function getTiddler(title, includeRawShadow = true) {
  // TODO: This is case-senstive and allows duplicates like AAA + aaa
    let result = tw.tiddlers.all.find(titleIs(title));
    if (includeRawShadow === false && result?.isRawShadow === true) return undefined;
    return result;
  }
  function tiddlerExists(title, includeRawShadow) {
    return !!getTiddler(title, includeRawShadow);
  }
  function hideTiddler(title) {
    let visibleTiddlerElement = getTiddlerElement(title);
    if (visibleTiddlerElement) visibleTiddlerElement.outerHTML = ''; // else console.warn('hideTiddler', title, 'failed!');
    tw.tiddlers.visible = tw.tiddlers.visible.filter(t => t !== title);
    saveVisible();
    tw.events.send('story.changed', title);
  }

  function deleteTiddler(title, automation) {
    let t = getTiddler(title);
    if (!automation && !confirm('Sure you want to delete me?')) return;
    const shadowTiddler = tw.shadowTiddlers.find(titleIs(title));
    if (shadowTiddler && !automation && !confirm('Deleting a shadow tiddler will simply restore the default content OK?')) return;
    if (!t) return hideTiddler(title);
    if (t.tags.includes('$NoEdit') && !automation && !confirm('This tiddler is marked as read-only. Deleting it may cause issues. Really delete?')) return;
    let tiddler = removeFromArray(tw.tiddlers.all, titleIs(title))?.[0];
    if (shadowTiddler) addTiddler({...shadowTiddler});
    if (shadowTiddler && !automation)
      rerenderTiddler(title);
    else
      hideTiddler(title);
    tiddler.updated = new Date();
    // If we trash it without the doNotSave flag then a synch may delete it remotely
    // delete tiddler.doNotSave;
    tw.tiddlers.trashed.push(tiddler);
    if (automation) {
      tw.events.send('tiddler.removed', title);
      return;
    } else
      tw.events.send('tiddler.deleted', title);
    save();
    // searchShowResults();
  }
  function closeTiddler(title) {
    hideTiddler(title);
    renderAllTiddlers();
  }

  function save() {
    if (!autoSave) return;
    saveAll({});
  }
  function saveSilent() {
    if (!autoSave) return;
    saveAll({silent: true});
  }
  function saveAll() {
    const oldTiddlers = tw.store.get('tiddlers');
    // TODO: Better local backups/versioning
    if (oldTiddlers?.length) tw.store.set('tiddlers-backup1', oldTiddlers);
    tw.store.set('tiddlers', tw.tiddlers.all.filter(tiddlersToSave));
    tw.store.set('tiddlers-trashed', tw.tiddlers.trashed);
    saveVisible();
    // if (!silent) tw.ui.notify('Saved!');
    setDirty(false);
  }

  function saveVisible() {
    tw.store.set('tiddlers-visible', tw.tiddlers.visible);
  }

  // DOM Manipulation
  function tiddlerSpanInclude(el) {
    let title = el.getAttribute('tiddler-include');
    try {
      let tiddler = getTiddler(title);
      if (!tiddler) throw new Error(`Unknown tiddler '${title}' to include!`);
      // Render and convert paragraphs to divs for easier layouting
      el.innerHTML = makeTiddlerText(tiddler).replace(/<(\/)?p>/g, '<$1div>');
      if (el.firstElementChild.tagName === 'P')
        el.innerHTML = el.firstElementChild.innerHTML;
    } catch (e) {
      el.innerHTML = `<span class="error">ERROR: Include "${title}" Failed: ${e.message}</span>`;
      console.error(`tiddlerSpanInclude "${title}" Failed: ${e.message}`, e.stack);
    }
    tw.events.subscribe('tiddler.refresh', (t) => {
      if (t === title) {
        tiddlerSpanInclude(el);
      }
    }, 'handle.tiddler.refresh.' + title);
  }
  function macroInclude(el) {
    let macroName = el.getAttribute('macro');
    let macroParams = el.getAttribute('params');
    try {
      let params = tw.core.params.parseParams(macroParams);
      let macroFunction;
      let err;
      try {macroFunction = eval(`tw.macros.${macroName}`);} catch (e) {err = e;}
      if (!macroFunction) try {macroName = `core.${macroName}`; macroFunction = eval(`tw.macros.${macroName}`);} catch (e) {err = e;}
      if (!macroFunction) throw new Error(err);
      let result = Array.isArray(macroParams) ? macroFunction(...params) : macroFunction(params);
      el.innerHTML = result;
    } catch (e) {
      el.innerHTML = `<span class="error">ERROR: Include "${macroName}" Failed: ${e.message}</span>`;
      console.error(`tiddlerSpanInclude "${macroName}" Failed: ${e.message}`, e.stack);
    }
  }

  // Functions to extract data from structured tiddlers

  // Resolve a tiddler reference to {text, type}, honouring `Title::Section`
  // addressing into a tiddler's sections. Falls back to whole-tiddler text when
  // the `::`-form does not resolve, so it is a strict superset of getTiddler().
  function resolveRef(ref) {
    let parts = splitSectionRef(ref);
    if (parts) {
      let base = getTiddler(parts.base);
      if (base) {
        let sec = tw.core.sections.getSection(base.text, parts.section);
        if (sec) return {text: sec.text, type: sec.type || base.type};
      }
    }
    let t = getTiddler(ref);
    return {text: t?.text || '', type: t?.type};
  }
  // {name,type,text} | null — a section of a tiddler, with type filled from the
  // parent when the section is not a fenced (typed) block.
  function getSection(title, sectionName) {
    let base = getTiddler(title);
    if (!base) return null;
    let sec = tw.core.sections.getSection(base.text, sectionName);
    return sec ? {...sec, type: sec.type || base.type} : null;
  }
  function getTiddlerTextRaw(title) {
    return resolveRef(title).text;
  }
  // 'this #$1# and that #$2#'[foo, bar] => 'this foo and that bar'
  function getTiddlerTextReplaced(title, params) {
    let res = resolveRef(title).text;
    Array.from(res.matchAll(reInclusionParams) || []).forEach(m => {
      let all = m[0];
      let key = m[1];
      let def = m[2] || '';
      res = res.replace(all, params[key] || def);
    });
    return res;
  }
  function getTiddlerTextLines(title) {
    return getTiddlerTextRaw(title).split('\n');
  }
  function getTiddlerList(title) {
    let inFence = false;
    return getTiddlerTextLines(title)
      .filter(l => { // Skip lines inside ``` fences (e.g. a `* { }` CSS selector is not a list item)
        if (/^```/.test(l)) {inFence = !inFence; return false;}
        return !inFence;
      })
      .filter(l => (l.match(/^[-*] /))) // Only bullet-points
      .map(l => (l.replace(/^[-*] /, ''))) // Remove bullet-point prefix
      .map(l => (l.replace(/[\[\]]/g, ''))) // Remove possible [[links]]
      .filter(notEmpty);
  }
  function getTiddlerTextList(title) {
    return getTiddlerTextLines(title).map(l => (l.replace(/^[-*] /, ''))).filter(notEmpty);
  }
  function getKeyValuesArray(title) {
    return getTiddlerTextList(title).map(t => {
      let s = t.indexOf(':');
      if (s < 0) return;
      let key = t.substring(0, s).trim();
      let value = t.substring(s + 1).trim();
      return {key, value};
    }).filter(notEmpty);
  };
  function getKeyValuesObject(title) {
    let result = {};
    getKeyValuesArray(title).forEach(i => {
      result[i.key] = i.value;
    });
    return result;
  }
  function getJSONObject(title) {
    return JSON.parse(getTiddlerTextRaw(title));
  }
  function getTiddlersByPackage(pck) {
    return tw.tiddlers.all.filter(t => t.package === pck);
  }
  function getTiddlersByTag(tag) {
    return tw.tiddlers.all.filter(t => t.tags.includes(tag));
  }

  // Filter Functions
  function tiddlersToSave(t) {
    return t.doNotSave !== true;
  }
  function titleIs(title) {
    return t => t.title === title;
  }
  function isCodeTiddler(t) {
    return ['script/js'].includes(t.type);
  }
  function isPackageList(t) {
    return ['$CorePackages', '$ExtensionPackages'].includes(t.title);
  }
  function isActiveCodeTiddler(t) {
    return ['script/js'].includes(t.type) && !t.tags.includes('$CodeDisabled');
  }
  // The JS to execute for a tiddler: the whole text when it is a script/js
  // tiddler (as today), otherwise each of its `script/js` sections (a ```js /
  // ```javascript fenced section). Sections run exactly like code tiddlers; a
  // `$CodeDisabled` tag (on the tiddler or the section) opts out.
  function tiddlerCodeBlocks(t) {
    if (!t || t.tags?.includes('$CodeDisabled')) return [];
    if (t.type === 'script/js') return [{text: t.text || '', title: t.title}];
    if (!t.tags?.includes('$Plugin')) return []; // Disable execution of inline code blocks for non-Plugins
    if (!t.text || !t.text.includes('# ')) return []; // fast path: no h1 sections
    const parsed = tw.core.sections.parseSections(t.text);
    return parsed.order
      .map(n => parsed.sections[n.toLowerCase()])
      .filter(s => s && s.type === 'script/js' && !(s.tags || []).includes('$CodeDisabled'))
      .map(s => ({text: s.text, title: `${t.title}${SECTION_DELIM}${s.name}`}));
  }
  function runTiddlerCode(t) {
    tiddlerCodeBlocks(t).forEach(b => executeCodeTiddler(b.text, b.title));
  }
  function isRunnableTiddler(t) {
    return tiddlerCodeBlocks(t).length > 0;
  }
  function isCoreTiddler(t) {
    return t.package === 'core';
  }
  function tagMatch(tag) {
    if (!tag || tag === '*') return () => true;
    let re = new RegExp(tag.match(/^!/) ? tag.substr(1) : tag);
    return t => tag.match(/^!/) ? !t.tags.find(tag => tag.match(re)) : t.tags.find(tag => tag.match(re));
  }
  function titleMatch(title) {
    if (!title || title === '*') return () => true;
    const negate = title.match(/^!/);
    let re = new RegExp(negate ? title.substr(1) : title);
    return t => (negate ? !t.title.match(re) : t.title.match(re));
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

  // TODO: Move $to ListTiddlersCoreFunctions
  function showTiddlerList(list, title = 'unknown') {
    return tw.lib.markdown(renderTWikki({text: list.map(t => `* [[${t.title}]]`).join('\n'), title}));
  }

  /* Store */
  function loadStore(store) {
    if (!store) store = tw.store;
    tw.tiddlers.all = storeLoadTiddlers('tiddlers');
    tw.shadowTiddlers
      .filter(t => !tiddlerExists(t.title))
      .forEach(addTiddlerHard);
    if (!tw.tiddlers.all.length) {
      tw.tiddlers.all = [];
      store.set('tiddlers', []);
    }
    tw.tiddlers.visible = store.get('tiddlers-visible')?.length ? store.get('tiddlers-visible') : [];

    tw.tiddlers.trashed = storeLoadTiddlers('tiddlers-trashed', false);

    function storeLoadTiddlers(key, validate = true) {
      let result = store.get(key) || [];
      result.forEach(t => {
        if (validate && !tiddlerIsValid(t)) return;
        t.created = new Date(t.created || new Date());
        t.updated = new Date(t.updated || new Date());
      });
      return result.filter(t => !!t.title);
    }

  }

  /* Navigation */
  function navigateTo(link) {
    if (!link) return;
    showTiddler(link);
    scrollToTiddler(link);
    location.hash = '';
  }
  function sendCommand(cmd, param, params, currentTiddlerTitle) {
  // "foo.bar:etc etc" => events.send('foo.bar', ['etc', 'etc'])
    let cmds = cmd.match(reCommand);
    if (!cmds) throw new Error(`Invalid command '${cmd}' does not match ${reCommand}/!`);
    let msg = cmds[1];
    if (!params) params = cmds.length > 2 ? cmds[2] : null;
    tw.logging.break('command');
    if (typeof param === 'undefined' || param === null) {
      params = tw.events.decode(params);
      if (params) params = params.replaceAll('$currentTiddler', currentTiddlerTitle);
      if (params?.match(/^\{\{\{/)) try {params = eval(params);} catch {dp('events.send received invalid JS payload: ' + params);}
      else if (params?.match(/^[\[\{]/)) try {params = JSON.parse(params);} catch {dp('events.send received invalid JSON payload: ' + params);}
      else params = tw.core.params.parseParams(params);
    } else if (typeof param === 'string')
      params = tw.events.decode(param).replaceAll('$currentTiddler', currentTiddlerTitle);
    else
      params = param;
    dp('sendCommand', msg, 'params=', params);
    let result = tw.events.send(msg, params); // scroll-on-show is handled by the tiddler.show subscriber
    location.hash = '';
    return result;
  }
  function scrollToTiddler(title) {
    // Scroll within the actual scroll container (#visible-tiddlers). window.scroll
    // is a no-op in the 3-pane layout, so use scrollIntoView on the element.
    getTiddlerElement(title)?.scrollIntoView({behavior: 'smooth', block: 'start'});
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

  function wireEvents() {

    tw.core.dom.frm = tw.core.dom.$('new-form');
    tw.core.dom.frm.addEventListener('submit', (evt) => (evt.preventDefault()));
    tw.core.dom.frm.addEventListener('keypress', formHotkeys({formDone}));

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
      let param = src.getAttribute('data-param');
      let params = src.getAttribute('data-params');
      if (!msg && isCommand(link)) msg = isCommand(link);
      if (!msg) return;
      if (src.getAttribute('data-default') !== 'true') event.preventDefault();
      let currentTiddlerTitle = tw.core.dom.nearestAttribute(el, 'data-tiddler-title', '.tiddler');
      if (msg) {
        let result = sendCommand(msg, param, params, currentTiddlerTitle);
        let targetId = src.getAttribute('data-target');
        if (!targetId) return result;
        // Display results
        let target = tw.core.dom.$(targetId);
        if (!target) {
          console.warn(`No target '${targetId}' found`);
          tw.events.send('tiddler.preview', {title: 'Results', text: result[0], type: 'x-twikki', tags: []});
          return result;
        }
        target.innerHTML = result[0];
      }
    });
    document.addEventListener('dblclick', event => {
      let el = event.target;
      let t = tw.core.dom.nearestAttribute(el, 'data-tiddler-title', '.tiddler')
        || tw.core.dom.nearestAttribute(el, 'tiddler-include', '[tiddler-include]');
      if (!t) return;
      formEditTiddler(t);
    });
    window.addEventListener('hashchange', function() {
      return handleHashLink(document.location.hash);
    });

    window.addEventListener('error', (event) => {
      tw.ui.notify('Unhandled: ' + event.message, 'E', event.error.stack);
      console.error('Unhandled:', event.message, event);
    });

    // Generic file drag/drop → registered drop handlers (tw.run.registerDropHandler)
    const hasFiles = e => Array.from(e.dataTransfer?.types || []).includes('Files');
    document.addEventListener('dragenter', e => {
      if (!hasFiles(e)) return;
      dragDepth++;
      showDropOverlay();
    });
    document.addEventListener('dragover', e => {
      if (hasFiles(e)) e.preventDefault(); // required to enable drop
    });
    document.addEventListener('dragleave', e => {
      if (hasFiles(e) && --dragDepth <= 0) hideDropOverlay();
    });
    document.addEventListener('drop', handleDrop);
  }

  function handleDrop(event) {
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    event.preventDefault();
    dragDepth = 0;
    hideDropOverlay();
    // Most specific pattern wins: '*.workspace.json' (longer) beats '*.json'
    const sorted = [...dropHandlers].sort((a, b) => b.pattern.length - a.pattern.length);
    files.forEach(file => {
      const match = sorted.find(h => h.rx.test(file.name));
      if (!match) return tw.ui.notify(`No handler for '${file.name}'`, 'W');
      const reader = new FileReader();
      reader.onload = () => match.handler(reader.result, file);
      reader.readAsText(file);
    });
  }
  function showDropOverlay() {
    let el = document.getElementById('drop-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'drop-overlay';
      el.textContent = '⤓ Drop a file to import';
      // Inline styles keep the overlay self-contained (no CSS-tiddler dependency);
      // pointer-events:none so it never intercepts the drop or fires dragleave itself.
      el.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;'
        + 'justify-content:center;background:rgba(0,0,0,0.5);color:#fff;font-size:2em;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.style.display = 'flex';
  }
  function hideDropOverlay() {
    const el = document.getElementById('drop-overlay');
    if (el) el.style.display = 'none';
  }

  function formHotkeys(methods) {
    return function(e) {
      if (e.ctrlKey && (e.code === 'Enter' || e.code === 'NumpadEnter')) return methods.formDone();
      // console.log(e);
    };
  }

  function notEmpty(v){return !!v;}

  function call(functionName, ...args) {
    return eval(functionName)(...args);
  }

  /* END TWikki */
  async function loadCoreModule(moduleName) {
    let res = readObject('/modules' + moduleName);
    if (!res?.code || qs.reload || qs.update) res = await fetchModule(moduleName);
    writeObject('/modules' + moduleName, res);
    return res;
  }
  async function fetchModule(moduleName) {
    if (!baseUrl) throw new Error('NO_MODULE_URL: Unable to determine URL to load module from!');
    let moduleUrl = baseUrl + '/modules' + moduleName;
    let res = {};
    console.debug(`Downloading module from '${moduleUrl}'...`);
    let result = {name: moduleName}; try {result = await fetch(moduleUrl);} catch {}
    if (!result.ok) throw new Error(`Unable to download module from '${moduleUrl}' HTTP status: ${result.statusCode}`);
    if (result.headers.get('Content-Type')?.match(/\/javascript/)) {
      res.code = await result.text();
      res.type = 'code';
    } else if (result.headers.get('Content-Type')?.match(/application\/json/)) {
      try {
        console.debug(`Reading moduled list '${moduleName}'...`);
        res = JSON.parse(await result.text());
        res.type = 'list';
      } catch (e){
        console.error(e.stack);
        res.error = e;
      }
      if (res.error)
        throw new Error(`INVALID_MODULE_JSON '${moduleName}' ${res.error.message}`);
    } else throw new Error(`MODULE_FORMAT_UNKNOWN: ${moduleUrl} is not served as JS/JSON`);
    return res;
  }
  function readObject(item) {
    let json = read(item);
    if (!json?.match(/^[\{\[]/)) return {};
    return JSON.parse(json);
  }
  function writeObject(item, value) {
    return write(item, JSON.stringify(value));
  }
  function overrides() {
    // Overrides
    RegExp.any = function() {
      var components = [];
      var arg;
      for (var i = 0; i < arguments.length; i++) {
        arg = arguments[i];
        if (arg instanceof RegExp) {
          components = components.concat(arg._components || arg.source);
        }
      }
      var combined = new RegExp('(?:' + components.join(')|(?:') + ')');
      combined._components = components; // For chained calls to "or" method
      return combined;
    };

    RegExp.compose = function(re, params) {
      let str = re.source;
      Object.keys(params).forEach(k => (str = str.replace(k, params[k].source)));
      return new RegExp(str, re.flags);
    };
    // eslint-disable-next-line no-extend-native
    RegExp.prototype.or = function() {
      var args = Array.prototype.slice.call(arguments);
      return RegExp.any.apply(null, [this].concat(args));
    };
  }
})();
