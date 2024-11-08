(function() {

  const NAME = 'twikki';
  const VERSION = '0.0.0';

  overrides();

  // Constants
  // TODO: Warn about problematic characters in tiddler titles:
  //         '/' - Used to point to blocks within multipart tiddlers
  // TODO: Inadvisable but should work characters:
  //         ':' - Used in search queries and parameters
  //         '!' - Used to negate logic (e.g. msg:search:!tag:$Shadow)
  const reTiddlerTitle = /[a-z0-9_\-\.:\s\$\ud83c\ud000-\udfff\ud83d\ud000-\udfff\ud83e\ud000-\udfff]+/gi;
  const reTiddlerTitleComplete = RegExp.compose(/^reTiddlerTitle$/gi, {reTiddlerTitle});
  const reInclusion = RegExp.compose(/\{\{(reTiddlerTitle)\|?([^\}]+)?}}/gi, {reTiddlerTitle});
  const reLinks = RegExp.compose(/\[\[(reTiddlerTitle)]]/gi, {reTiddlerTitle});
  // Events are alphanumeric with "." e.g. 'foo.bar' (lowercase only)
  const reEventName = /[a-z0-9\.]+/g;
  const reCommand = RegExp.compose(/(reEventName):?(.+)?/, {reEventName});
  const autoSave = true;

  let qs;
  let os;
  let defaults;
  let baseUrl;
  let tw = {};
  window.tw = tw; // Export tw so plugins can use it

  return {
    name: NAME,
    version: VERSION,
    async init(p) {
      qs = p.qs;
      os = p.os;
      defaults = p.platform;
      window.dp = console.log;
      tw.core = {};
      tw.packages = [];
      tw.tmp = {};
      tw.templates = {};
      tw.tiddlers = {all: [], visible: [], trashed: []};
      tw.storage = {
        get(key) {
          if (key[0] !== '/') key = '/' + key;
          let res = os.read(key);
          if (res?.match(/^[\[\{]/)) return JSON.parse(res);
          return res;
        },
        set(key, value) {
          if (key[0] !== '/') key = '/' + key;
          if (typeof value === 'object') return os.write(key, JSON.stringify(value));
          return os.write(key, value);
        },
      };

      console.debug(`TWikki (v${VERSION}) starting...`);
      document.title = `TWikki v${VERSION}`;

      baseUrl = qs.pUrl || qs.url || os.read('base.url') || p.base;

      tw.logging = {
        logFilter: new RegExp(qs.logfilter || '.'),
        debugMode: qs.debug,
      };

      console.debug('Looking for local TWIKKI.Core...');

      let packagesToLoad = [
        '/core.js',
        '/core.common.js',
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
      let packagesLoaded = await Promise.all(packagesToLoad.map(loadCorePackage));
      packagesToLoad.forEach((p, i) => {
        writeObject(packagesToLoad[i], packagesLoaded[i]);
        tw.packages[i] = {name: packagesToLoad[i], res: packagesLoaded[i]};
      });

      os.write('/base.url', baseUrl);

    },
    // eslint-disable-next-line require-await
    async start() {
      const errMsgs = [];

      // TODO: Cleanup calls to ui.notify - legacy support:
      tw.ui = {
        notify: function (a, b, c) {
          tw.core.notifications.notify(a, b, c);
        },
      };

      tw.packages
        .forEach(pck => {
          if (pck.res.type === 'code') {
            console.debug('Installing code package', pck.name);
            if (!qs.trace) {
              // Normally we try/catch packages to provide user-friendly feedback...
              try {
                pck.meta = (1, eval)(pck.res.code)(tw);
              } catch (e) {
                let errMsg = `Package '${pck.name}' failed: ${e.message}`;
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
            console.debug('Loading packaged list ', pck.name);
            pck.res.tiddlers.forEach(t => {
              t.doNotSave = true; // Don't save unless edited
              t.isRawShadow = true;
            });
            tw.tiddlers.all = tw.tiddlers.all.concat(pck.res.tiddlers);
            console.debug(`Loaded ${pck.res.tiddlers.length} core/shadow tiddlers from ${pck.name})`);
          } else {
            console.warn(`Skipping unknown package type '${pck.res.type}' in package '${pck.name}'!`);
          }
        });
      tw.shadowTiddlers = Array.from(tw.tiddlers.all);
      tw.shadowTiddlers.forEach(t => {
        // HACK: Load packages locally for development
        if (t.title === '$CorePackages' && document.location.host.match(/^(localhost)|(\d+\.\d+\.\d+\.\d+):\d+$/)) t.text = t.text.replaceAll('https://cawoodm.github.io/twikki', 'http://' + document.location.host);
        if (t.title === '$ExtensionPackages' && document.location.host.match(/^(localhost)|(\d+\.\d+\.\d+\.\d+):\d+$/)) t.text = t.text.replaceAll('https://cawoodm.github.io/twikki', 'http://' + document.location.host);
      });
      Object.freeze(tw.shadowTiddlers);
      console.debug(`${tw.packages.length} packages loaded. Running packages...`);

      // TODO: wireUpEvents or delegate to core packages
      tw.packages
        .filter(pck => pck.meta?.run)
        .forEach(pck => {
          if (!qs.trace) {
            // Normally we try/catch packages to provide user-friendly feedback...
            try {
              pck.meta.run();
            } catch (e) {
              let errMsg = `Package '${pck.name}' failed: ${e.message}`;
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
      console.debug('Packages run');

      wireUpEvents();
      loadStore();
      tw.extend = {tiddlerDetails: {
        metaInfo(t) {
          return tw.core.markdown.render([
            `${t.package ? '[pck:' + t.package + '](#msg:search:pck:' + t.package + ')' : ''}`,
            `${t.doNotSave ? 'doNotSave ✅' : ''}`,
            `${t.isRawShadow ? 'isRawShadow ✅' : ''}`,
          ].join(' '));
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
        getTiddlerList,
        getTiddlersByTag,
        getTiddlerTextList,
        getTiddlerTextRaw,
        getJSONObject,
        getKeyValuesArray,
        getKeyValuesObject,
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
      };
      window.markdown = tw.lib.markdown;
      // ----------
      tw.macros = {
        core: {
          showTiddlerList,
          disabled: (...rest) => ('This macro is disabled!' + JSON.stringify(rest)),
        },
      };
      tw.plugins = {};

      // tw.core.notifications.notify('OK');
      console.debug(`*** TWikki v${VERSION}`);
      console.debug('ShadowTiddlers: ' + tw.shadowTiddlers.length);
      if (errMsgs.length){
        console.warn('*** Errors Occurred');
        console.warn('<p class="error">Developers can reload with ?trace to debug exact issue in DevTools');
      }
      console.debug('Extensions: ' + defaults.extensions?.join(', '));

      // TODO: Load External Scripts and Stylesheets
      // TODO: Load Extensions
      onPageLoad();
      return;
      /* TODO: Move to console.log

      errMsgs.forEach(e => {
        console.debug(`<p class="error">${e}`);
      });
      console.debug('<h2>Details:</h2>');
      console.debug(`<p>Loaded TWIKKI.Core v${tw.packages[0].meta.version}`);
      console.debug('<p>Events: ' + tw.events.handlers().length);
      */
    },
  };

  async function onPageLoad() {
    tw.events.send('ui.loading');
    // tw.core.dom.addStyleSheet('highlight-light', 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-light.min.css');
    // tw.core.dom.addStyleSheet('highlight-dark', 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css');
    // if (location.host.match(/localhost/)) console.clear();
    wireEvents();
    await rebootSoft(1); // Event: tw.events.send('reboot.soft');
    if (location.hash) handleHashLink(location.hash);
  }
  /* BEGIN TWikki */
  /* Functions */
  // rebootSofter is called when lots of local tiddlers - i.e. after synching
  //   unlike rebootSoft it does not CorePackages packages
  function rebootSofter() {
    reload();
  }
  // rebootSoft is called when the local store changes - i.e. after restoring a backup
  //   it reloads CorePackages packages, runs tiddlers, does span includes, themes and renders all tiddlers
  async function rebootSoft() {
  // TODO: Clear events.clearAll()
    await loadCorePackages();
    if (!qs.safemode) await loadExtensionPackages();
    // TODO: Load registered scripts/css here like our highlighter core, css and languages
    reload(1);
  }
  function rebootHard() {
    window.location.reload();
  }
  function reload(time) {
    tw.tiddlers.visible = tw.tiddlers.visible.filter(title => tiddlerExists(title));
    runCoreTiddlers();
    if (!qs.safemode) runExtensionTiddlers();
    loadTemplates(); // Must load templates here or we can use no macros in the templates
    tw.core.dom.$$('*[tiddler-include]')?.forEach(tiddlerSpanInclude);
    if (time === 1) tw.events.send('ui.loaded');
    else tw.events.send('ui.reloaded', time);
    renderAllTiddlers();
  }
  function loadTemplates() {
    tw.templates.TiddlerDisplay = renderTiddler('$TiddlerDisplay');
    tw.templates.TiddlerPreview = renderTiddler('$TiddlerPreview');
    tw.templates.TiddlerTrashed = renderTiddler('$TiddlerTrashed');
    tw.templates.TiddlerSearchResult = renderTiddler('$TiddlerSearchResult');
  }
  async function loadCorePackages() {
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
      let doNotSave = true; // This is weird and makes TW not work offline
      if (p.length > 1) {
      // TODO: * <<packages.import url:... force:true save:true>>
        params.splice(0, 1);
        let opt = params.join('');
        // "force, save" => ["force", "save"]
        let options = opt.split(',').map(o => o.trim().toLowerCase());
        overWrite = options.includes('force'); // Overwrite silently
        noOverWrite = options.includes('nooverwrite'); // Never overwrite, skip silently
        doNotSave = !options.includes('save');
      }
      // TODO: Split URL and check update,force(overWrite),save(doNotSave) options
      let count = await tw.core.packaging.loadPackageFromURL({url, name, overWrite, noOverWrite, doNotSave});
      // If name === 'core' AND tw.tiddlers.all.find(t => t.package === 'core') panic or open $CorePackages for edit as it's screwed!
      tw.ui.notify(`${count} tiddlers imported from package ${name}`, 'D');
    }
    // tw.ui.notify('Don\'t forget to save!', 'I');
    saveSilent();
  }

  function wireUp(event, handler) {
    tw.events.subscribe(event, handler, 'core');
  }
  function wireUpEvents() {
    wireUp('ui.open.all', showAllTiddlers);
    wireUp('ui.close.all', closeAllTiddlers);
    wireUp('save', save);
    wireUp('save.silent', saveSilent);
    wireUp('save.all', saveAll);
    wireUp('reboot.softer', rebootSofter);
    wireUp('reboot.soft', rebootSoft);
    wireUp('reboot.hard', rebootHard);
    wireUp('search', searchQuery);
    wireUp('ui.reload', reload); // E.g. if styles are deleted

    wireUp('tiddler.new', formNewTiddler);
    wireUp('tiddler.edit', formEditTiddler);
    wireUp('tiddler.show', showTiddler);
    wireUp('tiddler.close', closeTiddler);
    wireUp('tiddler.preview', previewTiddler);
    wireUp('tiddler.preview.close', closePreview);
    wireUp('tiddler.delete', deleteTiddler);
    wireUp('tiddler.deleted', reload); // E.g. if styles are deleted
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
    wireUp('package.reload.bin', tw.core.packaging.reloadPackageFromJSONBin);
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
    if (isCodeTiddler(t)) executeText(t.text);
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
      .filter(isActiveCodeTiddler)
      .filter(isCoreTiddler)
      .forEach(t => (executeCodeTiddler(t.text, t.title)));
  }
  function runExtensionTiddlers() {
    tw.tiddlers.all
      .filter(isActiveCodeTiddler)
      .filter(t => !isCoreTiddler(t))
      .forEach(t => {
        if (qs.trace) return executeCodeTiddler(t.text, t.title);
        try {
          executeCodeTiddler(t.text, t.title);
        } catch (e) {
          tw.ui.notify(`Extension Tiddler '${t.title} failed (see log)`, 'E', e.stack);
          console.error(`Extension Tiddler '${t.title} failed: ${e.message}`, e.stack);
          if (confirm(`Extension Tiddler '${t.title} failed. Would you like to disable it?`)) {
            t.tags.push('$CodeDisabled');
          }
        }
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
    renderTiddlerList();
  }
  function searchQuery(q) {
    tw.core.dom.$('search').value = q;
    searchNow();
  }
  function searchNow() {
    renderTiddlerList(tw.core.search.search(tw.core.dom.$('search').value, tw.tiddlers.all));
  }
  function renderTiddlerList(list) {
    if (!list) return searchNow();
    tw.core.dom.divAllTiddlers.innerHTML = '';
    list.forEach(displayTiddlerLink);
  }
  function displayTiddlerLink({title, type}) {
  // TODO: Apply tw.templates.TiddlerSearchResult
    let newElement = document.createElement('li');
    newElement.className = 'tiddler-list'; // + (type ? ' line-clamp' : '');
    // BUG: If tiddlers have no type we don't display a link!
    if (type) newElement.appendChild(newTiddlerLink({title, type}));
    else newElement.innerHTML = title;
    tw.core.dom.divAllTiddlers.insertAdjacentElement('beforeend', newElement);
  }
  function newTiddlerLink({title}) {
    let newElement = document.createElement('a');
    newElement.setAttribute('data-msg', 'tiddler.show');
    newElement.setAttribute('data-param', title);
    newElement.setAttribute('data-tiddler-backref', tw.core.common.hash(title));
    newElement.setAttribute('href', 'javascript:false;');
    newElement.innerText = title;
    return newElement;
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
    return tw.core.markdown.render(tags.map(t => {
      return `[${t}](#msg:ui.open.all:{tag:'${t}',title:'*'})`;
    /* let link = `msg:ui.open.all:{tag:'${t}'}`;
    return `<a href="#${escapeHtml(link)}">${escapeHtml(t)}</a>`;*/
    }).join(', '));
  }
  function renderTiddler(title) {
    return renderTWikki({text: getTiddlerTextRaw(title), title});
  }
  function renderTWikki({text, title, validation}) {
    let result = text;
    try {
    // TODO: Label this tiddler to update when one of these macros change!

      getMacros(text).forEach(m => {
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
          result = replaceFrom(result, indexOfMacro, m[0], newText);
        } catch (e) {
          let errmsg = `Macro '${macroName}' failed in tiddler '${title}'!`;
          console.warn(errmsg, e.message, e.stack);
          result = result.replace(macroCommand, `<span class="error">${errmsg}: ${e.message.substr(0, 200)} (see log)</span>`);
          if (validation) throw e;
          return;
        }
      });
      // TODO: Support raw/wikified {{=}} inclusions
      getInclusions(result).forEach(m => {
        let title = m[1];
        // let vars = m[2];
        let text = getTiddlerTextRaw(title);
        if (!text) text = `No tiddler '${title}' found - let's [create it](#${title})!`;
        result = result.replace(m[0], text);
      });
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
    return result;
  }
  function replaceFrom(text, index, search, replace) {
    return text.substring(0, index) + text.substring(index).replace(search, replace);
  }
  function getMacros(text) {
    const macros = /(?<!`)<<([a-z_][a-z_0-9\.]+)\s?([^>]+)?>>/gi;
    return Array.from(text.matchAll(macros));
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
  // TODO: Update UI/CSS
    if (dirty) {
      tw.ui.isDirty = true;
      window.addEventListener('beforeunload', preventBrowserClose);
    } else {
      tw.ui.isDirty = false;
      window.removeEventListener('beforeunload', preventBrowserClose);
    }
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
    if (getTiddlerElement(title)) return scrollToTiddler(title);
    // if (getTiddlerElement(title)) hideTiddler(title);
    let tiddler = getTiddler(title);
    if (!tiddler) tiddler = nonExistentTiddler(title); // throw new Error(`showTiddler '${title}' failed!`, 'E');
    let newElement = createTiddlerElement(tiddler);
    // TODO: If it's a code tiddler run it (if !Disabkled) and show error message in red
    tw.core.dom.divVisibleTiddlers.insertAdjacentElement('afterbegin', newElement);
    if (tw.tiddlers.visible.indexOf(tiddler.title) === -1) tw.tiddlers.visible.push(tiddler.title);
    tw.events.send('tiddler.rendered', {tiddler, newElement});
    saveVisible();
  }
  function emptyTiddler() {
    return {title: '', text: '', type: 'x-twikki', tags: []};
  }
  function nonExistentTiddler(title) {
    let t = emptyTiddler();
    Object.assign(t, {title, text: `The tiddler '${title}' does not exist`, doesNotExist: true});
    return t;
  }
  function tiddlerUpdated(title) {
    let t = getTiddler(title);
    if (isCodeTiddler(t))
    // TODO: Try, catch, return error <span class="error">
      return executeCodeTiddler(t.text, title);
    if (['$SiteTitle', '$SiteSubTitle', '$TitleBar'].includes(title))
      tw.core.dom.$$('*[tiddler-include]')?.forEach(tiddlerSpanInclude);
    else if (tiddlerIsATemplate(t))
      loadTemplates();
    else if (isPackageList(t))
      if (confirm('Would you like to refresh?')) tw.events.send('reboot.soft');
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
  function showAllTiddlers({tag, title, pck}) {
    if (!title) title = '!^\\$';
    tiddlerSearch({title, tag, pck})
      .map(t => t.title)
      .forEach(showTiddler);
    renderAllTiddlers();
  }
  function closeAllTiddlers({tag = '', title = '', pck}) {
    if (!title) title = '!^\\$';
    tiddlerSearch({title, tag, pck})
      .map(t => t.title)
      .forEach(hideTiddler);
  }
  function tiddlerSearch({title, tag, pck}) {
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
    /* if (shadowTiddler)
    rerenderTiddler(title);
  else */
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
    renderTiddlerList();
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
  function saveAll({silent}) {
    const oldTiddlers = tw.store.get('tiddlers');
    if (oldTiddlers?.length) tw.store.set('tiddlers-backup1', oldTiddlers);
    tw.store.set('tiddlers', tw.tiddlers.all.filter(tiddlersToSave));
    tw.store.set('tiddlers-trashed', tw.tiddlers.trashed);
    saveVisible();
    if (!silent) tw.ui.notify('Saved!');
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

  // Functions to extract data from structured tiddlers
  function getTiddlerTextRaw(title) {
    return getTiddler(title)?.text || '';
  }
  function getTiddlerTextLines(title) {
    return getTiddlerTextRaw(title).split('\n');
  }
  function getTiddlerList(title) {
    return getTiddlerTextLines(title)
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
    let re = new RegExp(title.match(/^!/) ? title.substr(1) : title);
    return t => (title.match(/^!/) ? !t.title.match(re) : t.title.match(re));
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
    tw.tiddlers.all = tw.shadowTiddlers.concat(storeLoadTiddlers('tiddlers'));
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
  function sendCommand(cmd, param, currentTiddlerTitle) {
  // "foo.bar:etc etc" => events.send('foo.bar', ['etc', 'etc'])
    let cmds = cmd.match(reCommand);
    if (!cmds) throw new Error(`Invalid command '${cmd}' does not match ${reCommand}/!`);
    let msg = cmds[1];
    let params = cmds.length > 2 ? cmds[2] : null;
    if (typeof param === 'undefined' || param === null) {
      params = tw.events.decode(params);
      if (params) params = params.replaceAll('$currentTiddler', currentTiddlerTitle);
      if (params?.match(/^\{\{\{/)) try {params = eval(params);} catch {dp('events.send received invalid JS payload: ' + params);}
      else if (params?.match(/^[\[\{]/)) try {params = JSON.parse(params);} catch {dp('events.send received invalid JSON payload: ' + params);}
      else params = tw.core.params.parseParams(params);
    } else
      params = tw.events.decode(param).replaceAll('$currentTiddler', currentTiddlerTitle);
    let result = tw.events.send(msg, params);
    if (msg === 'tiddler.show') scrollToTiddler(params);
    location.hash = '';
    return result;
  }
  function scrollToTiddler(title) {
  // getTiddlerElement(title)?.scrollIntoView({behavior: 'smooth', block: 'start'});
    let top = getTiddlerElement(title).offsetTop;
    if (!top)
      if (tw.logging.debugMode) return console.warn('Cannot scroll to tiddler', title);
      else return;
    let topOfElement = top - tw.core.dom.$('header').offsetHeight;
    window.scroll({top: topOfElement, behavior: 'smooth'});
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
    tw.core.dom.$('search')?.addEventListener('keyup', searchNow);

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
      if (!msg && isCommand(link)) msg = isCommand(link);
      if (!msg) return;
      if (src.getAttribute('data-default') !== 'true') event.preventDefault();
      let currentTiddlerTitle = tw.core.dom.nearestAttribute(el, 'data-tiddler-title', '.tiddler');
      if (msg) {
        let result = sendCommand(msg, param, currentTiddlerTitle);
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
  async function loadCorePackage(packageName) {
    let res = readObject('/packages' + packageName);
    if (!res?.code || qs.reload) res = await fetchPackage(packageName);
    return res;
  }
  async function fetchPackage(packageName) {
    if (!baseUrl) throw new Error('NO_PACKAGE_URL: Unable to determine URL to load package from!');
    let packageUrl = baseUrl + '/packages' + packageName;
    let res = {};
    console.debug(`Downloading package from '${packageUrl}'...`);
    let result = {name: packageName}; try {result = await fetch(packageUrl);} catch {}
    if (!result.ok) throw new Error(`Unable to download package from '${packageUrl}' HTTP status: ${result.statusCode}`);
    if (result.headers.get('Content-Type')?.match(/\/javascript/)) {
      res.code = await result.text();
      res.type = 'code';
    } else if (result.headers.get('Content-Type')?.match(/application\/json/)) {
      try {
        console.debug(`Reading packaged list '${packageName}'...`);
        res = JSON.parse(await result.text());
        res.type = 'list';
      } catch (e){
        console.error(e.stack);
        res.error = e;
      }
      if (res.error)
        throw new Error(`INVALID_PACKAGE_JSON '${packageName}' ${res.error.message}`);
    } else throw new Error(`PACKAGE_FORMAT_UNKNOWN: ${packageUrl} is not served as JS/JSON`);
    return res;
  }
  function readObject(item) {
    let json = os.read(item);
    if (!json?.match(/^\{\[/)) return {};
    return JSON.parse(json);
  }
  function writeObject(item, value) {
    return os.write(item, JSON.stringify(value));
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
