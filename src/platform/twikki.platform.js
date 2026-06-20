(function () {
  const NAME = 'twikki';
  const VERSION = '0.27.0';

  overrides();

  // The platform is the minimal kernel that runs BEFORE any module loads: it
  // fetches, validates (compat gate), evals and caches the core modules, holds
  // bootstrap state, orchestrates the boot lifecycle (init → start → onPageLoad
  // → reload), hosts the plugin lifecycle, owns the controlled eval boundary
  // (executeText) and the raw localStorage primitive (tw.storage). Everything
  // tiddler-, render-, store- or UI-shaped lives in the core modules
  // (src/modules/core.*.js) — see plans/platform-rework.md.

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

  // Boot-progress emit. Dispatched as a native window CustomEvent so a
  // listener wired before this script (in index.html) sees every tick LIVE —
  // what a splashscreen needs. This is the sole channel; there is no buffer
  // and no bus event, since neither would deliver in real time anyway (early
  // ticks fire before any module exists).
  //
  //   <script>
  //     window.addEventListener('twikki.boot.progress', e => render(e.detail));
  //   </script>
  //   <script src="platform/twikki.platform.js"></script>
  function bootProgress(evt) {
    window.dispatchEvent(new CustomEvent('twikki.boot.progress', {detail: evt}));
  }

  // Resolve `path` against `base` using the browser's URL parser (same algorithm
  // as <a href>/<script src>), so we never homegrow path-joining edge cases —
  // missing/extra slashes, deep pathnames, percent-encoding, `..` segments.
  // `path` may already be fully qualified (`http(s)://…`) → returned verbatim.
  // `base` may be omitted; in that case we fall through the same chain
  // fetchModules uses to determine the platform's own baseUrl. Exposed on
  // `tw.core` from init() so plugins can call it as `tw.core.buildUrl(...)`.
  /* BEGIN buildUrl helper — extracted by test/unit/build-url.test.js. Keep pure
     (no closure refs beyond `tw`, `window`); tests stub those globally. */
  function buildUrl(path, base) {
    if (/^https?:\/\//.test(path)) return path;
    if (!base) {
      base = tw.storage.get('/moduleUrl') || window.MODULE_URL;
      if (!base) {
        // Derive the base from window.location.href. The URL spec treats the
        // last path segment as a FILE unless the URL ends with '/', so when
        // the app is served at e.g. http://host/twikki (server rewrites to
        // /twikki/index.html, no trailing slash in the bar), new URL('./',…)
        // would resolve to the parent and modules would load from /modules
        // instead of /twikki/modules. Normalize: if the last segment has no
        // extension AND no trailing slash, treat it as a directory.
        let href = window.location.href.split(/[?#]/)[0];
        const lastSeg = href.substring(href.lastIndexOf('/') + 1);
        if (lastSeg && !lastSeg.includes('.')) href += '/';
        base = new URL('./', href).toString();
      }
    }
    if (!base.endsWith('/')) base += '/';
    return new URL(path, base).toString();
  }
  /* END buildUrl helper */

  window.twikki = {
    name: NAME,
    version: VERSION,
    async init() {
      qs = Object.fromEntries(new URLSearchParams(location.search));
      Object.keys(qs)
        .filter(q => qs[q] === '')
        .forEach(q => (qs[q] = true)); // Empty params are switches => convert to true

      tw.core = {};
      tw.core.buildUrl = buildUrl;
      tw.extensions = {};
      tw.modules = [];
      tw.tmp = {};
      tw.templates = {};
      tw.tiddlers = {all: [], visible: [], trashed: []};

      tw.logging = initLogging(qs);

      await runBootScript(tw);

      if (!tw.storage) tw.storage = initLocalStorage();

      tw.run = {
        reload,
        executeText,
        executeCodeTiddler,
      };

      dp(`TWikki (v${VERSION}) starting...`);
      document.title = `TWikki v${VERSION}`;

      await fetchModules();
      dp(`*** TWikki v${VERSION} platform intialized`);
    },

    async start() {
      if (tw.tmp?.bootAborted) return; // init() found incompatible modules and showed the dialog

      if (!loadModules()) return;

      legacyAliases();

      // Load workspace data
      tw.core.store.loadStore();

      // Start the event bus
      tw.events.init();
      tw.core.ui.wireUpEvents();
      // Lifecycle events the platform owns
      tw.events.subscribe('reboot.hard', rebootHard, 'core');
      tw.events.subscribe('ui.reload', reload, 'core');

      if (!runModules()) return;

      dp(`*** TWikki v${VERSION} platform started`);
      document.title = tw.core.render.renderTiddler('$SiteTitle');

      tw.events.send('ui.loading');
      tw.core.ui.wireEvents();
      await loadCorePackages();
      if (!qs.safemode) await loadExtensionPackages();
      // TODO: Load registered scripts/css here like our highlighter core, css and languages
      reload();
      if (location.hash) tw.core.ui.handleHashLink(location.hash);
      bootProgress({phase: 'ready'});

      dp(`*** TWikki v${VERSION} ui ready`);
    },
  };

  function legacyAliases() {
    // Mainly for backward compatability and shorthand
    tw.ui = {notify: tw.core.notifications.notify}; // Legacy API
    Object.assign(tw.ui, tw.core.ui);
    tw.call = call;
    // (tw.commands, tw.extensions and the core macros are installed by core.ui at eval.)
    tw.plugins = [];
    tw.plugin = name => tw.plugins.find(p => p.meta?.name === name);
  }

  async function fetchModules() {
    // Single source of truth for resolving the platform's base — same chain
    // tw.core.buildUrl uses when called without an explicit base.
    baseUrl = tw.core.buildUrl('./');

    dp('Looking for local TWikki.Core modules...');

    // Ordered by logical dependency. (Most cross-module references are runtime
    // tw.run.*/tw.events calls resolved after every module eval'd, so eval order
    // is looser than the call graph — but ordering by dependency stays robust.)
    let modulesToLoad = [
      '/core.common.js', // pure utilities (hash, base64 encoder/decoder, notEmpty) — FIRST, no deps
      '/core.js', // tw.events bus; uses tw.core.common.decoder
      '/core.sections.js', // section-reference grammar + text slicing, no deps
      '/core.params.js', // macro/widget arg parsing, no deps
      '/core.templater.js', // pure mustache engine, no deps
      '/core.dom.js', // DOM helpers
      '/core.store.js', // owns tw.store (workspace-scoped) + tiddler persistence
      '/core.tiddlers.js', // tiddler store + CRUD; merges the tiddler API into tw.run
      '/core.render.js', // TWikki render pipeline + loadTemplates
      '/core.defaults.json', // shadow tiddlers: $MainLayout, $TiddlerDisplay, $CorePackages, themes
      '/core.notifications.js', // tw.ui.notify
      '/core.ui.js', // event wiring, nav, basic edit round-trip
      '/core.workspaces.js', // active-workspace management (→ core.store for scoping)
      '/core.packaging.js', // HTTP import/merge of {tiddlers:[]} bundles
      '/core.search.js', // search
    ];
    bootProgress({phase: 'init', total: modulesToLoad.length});
    let compatReports;
    try {
      // Fetch each module (cache-or-network) WITHOUT persisting it — storing is deferred
      // to storeCoreModule below, so an incompatible fetch never clobbers the installed
      // (cached) copies the user may want to keep.
      let fetchResults = await Promise.all(
        modulesToLoad.map(async (name, index) => {
          const r = await fetchCoreModule(name);
          bootProgress({phase: 'fetch', name, index, total: modulesToLoad.length});
          return r;
        }),
      );
      tw.modules = modulesToLoad.map((p, i) => ({
        name: p,
        res: fetchResults[i].res,
        fetched: fetchResults[i].fetched,
      }));
      compatReports = tw.modules.map(checkModuleCompat);
      // Stash each report on its module so runtime UI (e.g. the <<modules>> widget) can
      // show built-for platform + compatibility status without re-deriving it.
      tw.modules.forEach((m, i) => {
        m.compat = compatReports[i];
      });
    } catch (e) {
      // A download failed outright — a hard stop (block), surfaced in the same dialog.
      // Give each module an `error` res so the dialog (which re-derives reports from the
      // loaded set) classifies them as block too, and the user can re-check a new URL.
      console.error('Core module download failed', e);
      tw.modules = modulesToLoad.map(n => ({
        name: n,
        res: {type: 'error', error: e.message},
        fetched: true,
      }));
      compatReports = tw.modules.map(checkModuleCompat);
      tw.modules.forEach((m, i) => {
        m.compat = compatReports[i];
      });
    }

    // A 'block' (major-version gap or failed download) always halts the boot. A 'warn'
    // (newer minor/patch of the same major, or no platform field) halts only for a
    // FRESHLY-FETCHED module — a warning the user hasn't seen yet. A warn module already
    // in the cache booted before (the user installed it), so it boots again silently.
    const blocking = compatReports.filter(r => r.severity === 'block');
    const freshWarn = tw.modules.filter((m, i) => m.fetched && compatReports[i].severity === 'warn');
    bootProgress({phase: 'compat', blocking: blocking.length, warnings: freshWarn.length});
    if (blocking.length || freshWarn.length) {
      console.error('Core module compatibility — boot halted:', {blocking, freshWarn});
      tw.tmp.bootAborted = true;
      showCompatDialog();
      return;
    }
    // Compatible (or only previously-installed warnings) — NOW persist anything freshly
    // fetched, so the validated set becomes the installed set.
    tw.modules.forEach(m => {
      if (m.fetched) storeCoreModule(m.name, m.res);
    });
  }

  function runModules() {
    const errMsgs = [];
    dp(`${tw.modules.length} modules loaded. Running modules...`);
    tw.modules
      .filter(pck => pck.meta?.run)
      .forEach(pck => {
        dp(`Running module '${pck.name}'...`);
        if (!qs.trace) {
          // Normally we try/catch modules to provide user-friendly feedback...
          try {
            pck.meta.run();
          } catch (e) {
            errMsgs.push({name: pck.name, message: e.message});
            console.error(`Module '${pck.name}' failed: ${e.message}`, e.stack);
            return;
          }
        } else {
          // ...however, developers want to know where exactly the error occurred
          //   and this is only possible when we let the original event bubble up unhandled!!
          pck.meta.run();
        }
      });
    dp('Modules run');
    if (handleModuleErrors(errMsgs)) return;
    bootProgress({phase: 'modules-run'});
    return true;
  }

  function loadModules() {
    const errMsgs = [];
    tw.modules.forEach((pck, index) => {
      bootProgress({phase: 'eval', name: pck.name, index, total: tw.modules.length});
      if (pck.res.type === 'code') {
        dp('Loading code module', pck.name);
        if (!qs.trace) {
          // Normally we try/catch modules to provide user-friendly feedback...
          try {
            pck.meta = (1, eval)(pck.res.code)(tw);
          } catch (e) {
            errMsgs.push({name: pck.name, message: e.message});
            console.error(`Module '${pck.name}' failed: ${e.message}`, e.stack);
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
        dp(`Loaded ${pck.meta.name} (v${pck.meta.version})`);
      } else if (pck.res.type === 'list') {
        dp('Loading moduled list ', pck.name); // What is a moduled list? Example?
        pck.res.tiddlers.forEach(t => {
          t.doNotSave = true; // Don't save unless edited
          t.isRawShadow = true; // TODO: What does this mean exactly?
        });
        tw.tiddlers.all = tw.tiddlers.all.concat(pck.res.tiddlers);
        dp(`Loaded ${pck.res.tiddlers.length} core/shadow tiddlers from ${pck.name})`);
      } else {
        console.warn(`Skipping unknown module type '${pck.res.type}' in module '${pck.name}'!`);
      }
    });
    tw.shadowTiddlers = Array.from(tw.tiddlers.all);
    Object.freeze(tw.shadowTiddlers);
    if (handleModuleErrors(errMsgs)) return;
    bootProgress({phase: 'modules-loaded'});
    return true;
  }

  function initLogging(qs) {
    window.dp = () => {};
    if (qs.logfilter)
      // Output filtered loggsOverwridden console.log has advantage of filtering logs
      window.dp = function () {
        if (!tw.logging.logFilter.test(JSON.stringify(Array.from(arguments)))) return;
        console.log.apply(console, arguments);
      };

    return {
      logFilter: new RegExp(qs.logfilter || '.', 'i'),
      debugMode: qs.debug,
      trace: qs.trace,
      breakPoint: qs.breakpoint,
      break(name) {
        // eslint-disable-next-line no-debugger
        if (tw.logging.breakPoint && name.match(new RegExp(tw.logging.breakPoint))) debugger;
      },
    };
  }
  function initLocalStorage() {
    return {
      get(key) {
        let res = read(key);
        if (res?.match(/^[\[\{]/)) return JSON.parse(res);
        return res;
      },
      set(key, value) {
        if (typeof value === 'object') return write(key, JSON.stringify(value));
        return write(key, value);
      },
      // localStorage writes are durable synchronously, so a flush is a no-op.
      // The IndexedDBStoragePlugin overrides tw.storage with an async-backed
      // flush() that awaits in-flight writes (see rebootHard()).
      flush() {
        return Promise.resolve();
      },
      remove(key) {
        if (key[0] !== '/') key = '/' + key;
        return localStorage.removeItem(key);
      },
      keys(prefix) {
        return Object.keys(localStorage).filter(k => k.startsWith(prefix));
      },
      getRaw(key) {
        if (key[0] !== '/') key = '/' + key;
        return localStorage.getItem(key);
      },
      setRaw(key, raw) {
        if (key[0] !== '/') key = '/' + key;
        return localStorage.setItem(key, raw);
      },
      // Drop every key under `/ws/<name>/`. Used by core.workspaces.workspaceDelete
      // to wipe a workspace's data; the IndexedDBStoragePlugin overrides this on
      // its own `tw.storage` to also drop the per-workspace object store.
      clearWorkspace(name) {
        const prefix = `/ws/${name}/`;
        Object.keys(localStorage)
          .filter(k => k.startsWith(prefix))
          .forEach(k => localStorage.removeItem(k));
      },
    };
  }

  // Pre-boot hook. A single localStorage-stored script at `/twikki.boot.js` is
  // eval'd before tw.storage is initialised. Its source must evaluate to a
  // function (sync or async) that receives `tw` and may mutate it — most
  // commonly to assign a custom `tw.storage` implementation (e.g. an
  // IndexedDB adaptor). If the script fails (parse, throw, rejected promise)
  // we alert the user and continue with the default localStorage backing, so
  // a broken boot script can never brick the app.
  async function runBootScript(tw) {
    const src = window.localStorage.getItem('/twikki.boot.js');
    if (!src) return;
    try {
      const fn = (1, eval)(src);
      if (typeof fn !== 'function') return;
      const result = fn(tw);
      if (result && typeof result.then === 'function') await result;
    } catch (e) {
      console.error('twikki.boot.js failed:', e);
      alert(`Pre-boot script failed:\n\n${e.message}\n\nProceeding without it.`);
    }
  }

  // Renders the boot-halt page when one or more modules failed to eval or run.
  // Returns `true` when it took the error path so the caller's `if (handleModuleErrors(errMsgs)) return;`
  // actually halts further work in start() — otherwise downstream code would try to use
  // the missing module exports, push more errors onto the same array, and re-enter this
  // function, each document.write appending another <h1> (the bug this guards against).
  // Idempotent via a sticky flag in case a caller forgets the early return.
  function handleModuleErrors(errMsgs) {
    if (errMsgs.length === 0) return false;
    if (handleModuleErrors.handled) return true;
    handleModuleErrors.handled = true;
    const names = errMsgs.map(e => e.name.replace(/^\//, '').replace(/\.js$/, ''));
    const heading = names.length === 1 ? `Module '${names[0]}' failed to load` : `${names.length} modules failed to load: ${names.join(', ')}`;
    document.write(`<h1>${heading}</h1>`);
    errMsgs.forEach(e => {
      const name = e.name.replace(/^\//, '');
      document.write(`<p class="error"><b>${name}</b>: ${e.message}</p>`);
    });
    let traceUrl = document.location.href;
    traceUrl = traceUrl.match(/\?/) ? traceUrl + '&trace' : traceUrl + '?trace';
    document.write('<p class="error">Tips:');
    document.write('<ul>');
    document.write(`<li>Tip: Launch with <a href="${traceUrl}&debug">?trace&debug</a> to see source of error`);
    document.write('<li>Tip: Try <a href="?update">?update</a> to try a reload of modules');
    document.write('<li>Tip: Try <a href="?reload">?reload</a> to force a reload of modules');
    document.write('</ul>');
    return true;
  }

  // Reload the page with ?reload/?update stripped, so the next boot reads the (just-stored
  // or already-cached) modules instead of force-fetching again and re-opening this dialog.
  function reloadWithoutForce() {
    const url = new URL(location.href);
    url.searchParams.delete('reload');
    url.searchParams.delete('update');
    location.href = url.toString();
  }

  // Boot halted on an incompatible/missing core module: load the rich compat
  // dialog (platform/twikki.compat-dialog.js) ON DEMAND and hand it the boot
  // context. The dialog is an enhancement — if its script cannot load (e.g. the
  // same network failure that broke the modules), fall back to a plain halt
  // message with the recovery query-param links. Nothing here depends on any
  // core module or theme CSS.
  function showCompatDialog() {
    const ctx = {
      tw,
      VERSION,
      baseUrl,
      checkModuleCompat,
      readObject,
      isCachedModuleUsable,
      storeCoreModule,
      tryFetchModule,
      reloadWithoutForce,
    };
    const fallback = () => {
      const broken = tw.modules
        .filter(m => m.compat?.severity === 'block' || m.compat?.severity === 'warn')
        .map(m => `<li><code>${m.name}</code> — ${m.compat.reason || 'incompatible'}</li>`)
        .join('');
      document.body.innerHTML =
        '<div style="max-width:640px;margin:3rem auto;font:14px/1.5 system-ui,sans-serif">' +
        `<h1>TWikki v${VERSION} cannot boot</h1>` +
        '<p>One or more core modules are incompatible or failed to download:</p>' +
        `<ul>${broken}</ul>` +
        '<p>Try <a href="?reload">?reload</a> to re-download the modules, or ' +
        '<a href="?update">?update</a> to fetch updates.</p></div>';
    };
    const s = document.createElement('script');
    s.src = 'platform/twikki.compat-dialog.js';
    s.onload = () => (window.twikkiCompatDialog ? window.twikkiCompatDialog(ctx) : fallback());
    s.onerror = fallback;
    document.head.appendChild(s);
  }

  /* Boot lifecycle */
  async function rebootHard() {
    location.hash = ''; // Prevent infinite loop of msg:... commands
    // Wait for any in-flight storage writes to commit before reloading. With the
    // default (localStorage) backend flush() resolves immediately; with the
    // IndexedDBStoragePlugin writes are async and fire-and-forget, so without this
    // a save()-then-reboot.hard race reloads before the edit reaches disk. This is
    // the single chokepoint every reboot.hard reload funnels through; tw.events.send
    // ignores the returned promise, so all callers stay synchronous.
    try {
      await tw.storage.flush?.();
    } catch (e) {
      console.warn('flush before reboot failed', e);
    }
    window.location.reload();
  }

  function reload() {
    tw.tiddlers.visible = tw.tiddlers.visible.filter(title => tw.util.tiddlerExists(title));
    tw.core.tiddlers.runCoreTiddlers();
    // Four-phase plugin lifecycle, parallel to core modules:
    //   unload — call each existing plugin's unload() (if any), then clear its
    //            owner-scoped event subscriptions and tracked DOM listeners.
    //            No-op on the first reload (tw.plugins is empty).
    //   load   — eval each $Plugin tiddler's code; the returned {meta, init?, start?, unload?} is the plugin.
    //   init   — every plugin is loaded before any init() runs, so init() can check deps via tw.plugin().
    //   start  — every plugin is initialised before any start() runs.
    // Then runScripts() evals $Script tiddlers (no return expected) — code that doesn't need a lifecycle.
    bootProgress({phase: 'plugins', step: 'unload'});
    unloadPlugins();
    bootProgress({phase: 'plugins', step: 'load'});
    loadPlugins();
    checkPluginDependencies();
    sortPluginsByDependencies();
    bootProgress({phase: 'plugins', step: 'init'});
    initPlugins();
    bootProgress({phase: 'plugins', step: 'start'});
    startPlugins();
    runScripts();
    tw.core.render.loadTemplates(); // Must load templates here or we can use no macros in the templates
    tw.core.dom.$$('*[tiddler-include]')?.forEach(tw.core.render.tiddlerSpanInclude);
    tw.core.dom.$$('*[macro]')?.forEach(tw.core.render.macroInclude);
    if (!tw.tmp.rebootCount) tw.tmp.rebootCount = 0;
    tw.tmp.rebootCount++;
    if (tw.tmp.rebootCount === 1) tw.events.send('ui.loaded');
    else tw.events.send('ui.reloaded', tw.tmp.rebootCount);
    tw.core.render.renderAllTiddlers();
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
      let url = tw.core.buildUrl(params[0], baseUrl);
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
      let count = await tw.core.packaging.loadPackageFromURL({
        url,
        name,
        overWrite,
        noOverWrite,
        doNotSave,
      });
      bootProgress({phase: 'package', name, count});
      // If name === 'core' AND tw.tiddlers.all.find(t => t.package === 'core') panic or open $CorePackages for edit as it's screwed!
      tw.ui.notify(`${count} tiddlers imported from package ${name}`, 'D');
    }
    tw.core.store.autoSave();
  }

  /* Plugin lifecycle host */
  // Scan $Plugin-tagged tiddlers, eval each one's code block(s), capture the returned
  // {meta, init?, start?} into tw.plugins. The plugin's IIFE must return that shape; anything
  // else is an authoring error and the entry carries an error field that the <<plugins>> widget
  // surfaces. This mirrors how core modules return {name, version, exports?, run?} from src/modules/.
  function loadPlugins() {
    const seenNames = new Set();
    tw.plugins = tw.tiddlers.all.filter(t => t.tags?.includes('$Plugin') && !t.tags?.includes('$CodeDisabled')).map(t => loadOnePlugin(t, seenNames));
  }

  // Tear down the previous generation of plugins before re-evaluating their
  // code. For each loaded plugin we invoke its optional unload() (catching
  // throws so one bad plugin can't block the rest), then drop every event
  // subscription and tracked DOM listener tagged with its meta.name. Plugins
  // that subscribe / bind via the tracked APIs (tw.events.subscribe(..., name)
  // and tw.core.dom.on(..., name)) need NO explicit cleanup — the platform
  // does it for them here. unload() exists for the things the helpers don't
  // own: setIntervals, MutationObservers, cached DOM elements that should be
  // removed on reload.
  function unloadPlugins() {
    if (!tw.plugins?.length) return;
    tw.plugins.forEach(p => {
      const owner = p.meta?.name;
      if (!owner) return;
      if (typeof p.unload === 'function') {
        try {
          p.unload();
        } catch (e) {
          console.warn(`Plugin '${owner}' unload() threw: ${e.message}`, e.stack);
        }
      }
      tw.events.unsubscribeByOwner?.(owner);
      tw.core.dom.offOwner?.(owner);
    });
  }

  function loadOnePlugin(t, seenNames) {
    const entry = {
      meta: {},
      init: undefined,
      start: undefined,
      unload: undefined,
      source: t.title,
      package: t.package || null,
      compat: {compatible: true, severity: 'exempt', reason: 'no platform field'},
      error: null,
    };
    const blocks = tw.core.tiddlers.tiddlerCodeBlocks(t);
    if (!blocks.length) {
      entry.error = {phase: 'load', message: 'plugin tiddler has no code block'};
      return entry;
    }
    let returned;
    try {
      // The plugin's value is the LAST code block's return value. (Most plugins have one
      // block; a multi-section .tid file with only a # Code section is still one block.)
      if (qs.trace) blocks.forEach(b => (returned = executeText(b.text, b.title)));
      else
        try {
          blocks.forEach(b => (returned = executeText(b.text, b.title)));
        } catch (e) {
          entry.error = {phase: 'load', message: e.message};
          tw.ui.notify(`Plugin '${t.title}' failed to load (see console log)`, 'E', e.stack);
          console.error(`Plugin '${t.title}' failed to load: ${e.message}`, e.stack);
          if (confirm(`Plugin '${t.title}' failed to load. Would you like to disable it?`)) t.tags.push('$CodeDisabled');
          return entry;
        }
    } catch (e) {
      entry.error = {phase: 'load', message: e.message};
      return entry;
    }
    if (!returned || typeof returned !== 'object') {
      entry.error = {
        phase: 'load',
        message: 'plugin must return { meta: { name, version }, init?, start? }',
      };
      return entry;
    }
    entry.meta = returned.meta || {};
    entry.init = typeof returned.init === 'function' ? returned.init : undefined;
    entry.start = typeof returned.start === 'function' ? returned.start : undefined;
    entry.unload = typeof returned.unload === 'function' ? returned.unload : undefined;
    if (!entry.meta.name) {
      entry.error = {phase: 'load', message: 'plugin meta.name is required'};
      return entry;
    }
    if (!entry.meta.version) {
      entry.error = {phase: 'load', message: 'plugin meta.version is required'};
      return entry;
    }
    if (seenNames.has(entry.meta.name)) {
      entry.error = {
        phase: 'load',
        message: `duplicate plugin name '${entry.meta.name}' (first one wins)`,
      };
      return entry;
    }
    seenNames.add(entry.meta.name);
    entry.compat = checkPluginCompat(entry.meta);
    dp('Loaded plugin', entry.meta.name, entry.meta.version);
    return entry;
  }
  // Soft dependency check, between load and init: a plugin may declare
  // `meta.dependencies: ['OtherName']` (matched against meta.name). Missing
  // ones land on the entry as `missingDependencies` (surfaced by the
  // <<plugins>> widget) and produce a console warning. The plugin still runs —
  // soft, matching the existing plugin compat stance. For runtime checks
  // inside init() (branching behaviour), keep using tw.plugin(name).
  function checkPluginDependencies() {
    tw.plugins.forEach(p => {
      const deps = p.meta?.dependencies;
      if (!Array.isArray(deps) || !deps.length) return;
      const missing = deps.filter(d => !tw.plugin(d));
      if (missing.length) {
        p.missingDependencies = missing;
        console.warn(`Plugin '${p.meta.name}' declares missing dependencies: ${missing.join(', ')}`);
      }
    });
  }
  // Stable topological sort of tw.plugins[] by meta.dependencies, plus the
  // implicit "base-package plugins run before any non-base plugin" invariant.
  // Plugins without constraints keep their original relative order. On a cycle
  // (or a declared dep crossing the base/non-base boundary the wrong way),
  // warn and emit the remaining nodes in original order — soft, matching the
  // rest of the plugin compat stance.
  function sortPluginsByDependencies() {
    const plugins = tw.plugins;
    const byName = new Map();
    plugins.forEach((p, i) => {
      if (p.meta?.name) byName.set(p.meta.name, i);
    });
    const isBase = i => plugins[i].package === 'base';
    const indegree = plugins.map(() => 0);
    const edges = plugins.map(() => []);
    plugins.forEach((p, i) => {
      const deps = Array.isArray(p.meta?.dependencies) ? p.meta.dependencies : [];
      deps.forEach(name => {
        const j = byName.get(name);
        if (j === undefined) return;
        edges[j].push(i);
        indegree[i]++;
      });
    });
    plugins.forEach((_, i) => {
      if (!isBase(i)) return;
      plugins.forEach((_, j) => {
        if (isBase(j)) return;
        edges[i].push(j);
        indegree[j]++;
      });
    });
    const ready = [];
    indegree.forEach((d, i) => {
      if (d === 0) ready.push(i);
    });
    ready.sort((a, b) => a - b);
    const sorted = [];
    while (ready.length) {
      const i = ready.shift();
      sorted.push(plugins[i]);
      edges[i].forEach(j => {
        indegree[j]--;
        if (indegree[j] === 0) {
          const k = ready.findIndex(x => x > j);
          if (k === -1) ready.push(j);
          else ready.splice(k, 0, j);
        }
      });
    }
    if (sorted.length < plugins.length) {
      const stuck = plugins
        .map((p, i) => ({p, i}))
        .filter(({i}) => indegree[i] > 0)
        .sort((a, b) => a.i - b.i);
      console.warn(`Plugin dependency cycle detected; emitting in original order: ${stuck.map(({p}) => p.meta?.name || p.source).join(', ')}`);
      stuck.forEach(({p}) => sorted.push(p));
    }
    tw.plugins = sorted;
  }
  function initPlugins() {
    tw.plugins.forEach(plugin => {
      if (plugin.error || typeof plugin.init !== 'function') return;
      dp('Initializing plugin', plugin.meta.name, plugin.meta.version);
      try {
        plugin.init();
      } catch (e) {
        plugin.error = {phase: 'init', message: e.message};
        tw.ui.notify(`Plugin '${plugin.meta.name}' failed to initialize: ${e.message}`, 'E', e.stack);
        console.error(`Plugin '${plugin.meta.name}' init failed: ${e.message}`, e.stack);
      }
    });
  }
  function startPlugins() {
    tw.plugins.forEach(plugin => {
      if (plugin.error || typeof plugin.start !== 'function') return;
      dp('Starting plugin', plugin.meta.name, plugin.meta.version);
      try {
        plugin.start();
      } catch (e) {
        plugin.error = {phase: 'start', message: e.message};
        tw.ui.notify(`Plugin '${plugin.meta.name}' failed to start: ${e.message}`, 'E', e.stack);
        console.error(`Plugin '${plugin.meta.name}' start failed: ${e.message}`, e.stack);
      }
    });
  }
  // $Script tiddlers run their code at boot — no return expected, no lifecycle. Use for
  // macro/command registrations, one-shot setup, ad-hoc snippets. Runs AFTER all plugins are
  // started so scripts can rely on plugin services (tw.plugin(...), tw.tabs, etc.) being live.
  function runScripts() {
    tw.tiddlers.all
      .filter(t => t.tags?.includes('$Script') && !t.tags?.includes('$CodeDisabled'))
      .forEach(t => {
        const blocks = tw.core.tiddlers.tiddlerCodeBlocks(t);
        if (!blocks.length) return;
        if (qs.trace) return blocks.forEach(b => executeCodeTiddler(b.text, b.title));
        try {
          blocks.forEach(b => executeCodeTiddler(b.text, b.title));
        } catch (e) {
          tw.ui.notify(`Script '${t.title}' failed (see console log)`, 'E', e.stack);
          console.error(`Script '${t.title}' failed: ${e.message}`, e.stack);
          if (confirm(`Script '${t.title}' failed. Would you like to disable it?`)) t.tags.push('$CodeDisabled');
        }
      });
  }

  /* Controlled eval boundary */
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
    } catch (e) {
      let msg = `executeText "${title}" ${context ? ` in tiddler '${context}'` : ''}`;
      console.error(`${msg}: ${e.message}`, e.stack);
      throw e; // new Error(`${msg}: ${e.message}`);
    }
  }

  // tw.call('fn', ...args) — resolve a platform/core function by name. The
  // functions used to live in this closure; they now live on the module
  // registries, so the lookup walks them (eval stays as a last resort for the
  // few true platform-closure functions).
  function call(functionName, ...args) {
    const fn =
      tw.run[functionName] ||
      tw.core.tiddlers?.[functionName] ||
      tw.core.render?.[functionName] ||
      tw.core.store?.[functionName] ||
      tw.core.ui?.[functionName] ||
      tw.util?.[functionName] ||
      eval(functionName);
    return fn(...args);
  }

  /* END TWikki */

  /* BEGIN semver helper (extracted verbatim by test/unit/semver.test.js — keep pure, no closure refs) */
  function semver(v) {
    const m = String(v)
      .trim()
      .match(/^(\d+)\.(\d+)\.(\d+)$/);
    return m ? {major: +m[1], minor: +m[2], patch: +m[3]} : null;
  }
  function semverCompare(a, b) {
    const x = semver(a);
    const y = semver(b);
    if (!x || !y) return NaN;
    if (x.major !== y.major) return x.major - y.major;
    if (x.minor !== y.minor) return x.minor - y.minor;
    return x.patch - y.patch;
  }
  // Does platform `running` satisfy a module built for `required`? Caret semantics:
  // same major AND running >= required (e.g. built for 0.24.0 runs on 0.24.x/0.99.x
  // but not 0.23.x or 1.0.0).
  function caretSatisfies(required, running) {
    const r = semver(required);
    const p = semver(running);
    if (!r || !p) return false;
    if (r.major !== p.major) return false;
    return semverCompare(running, required) >= 0;
  }
  /* END semver helper */

  // Statically read a code module's `const name/version/platform = '...'` declarations
  // WITHOUT eval'ing it — eval runs the module's IIFE side effects, so compatibility
  // must be decided from the source text before any module code runs.
  function parseModuleMeta(code) {
    const grab = re => code.match(re)?.[1] ?? null;
    return {
      name: grab(/const\s+name\s*=\s*'([^']+)'/),
      version: grab(/const\s+version\s*=\s*'([^']+)'/),
      platform: grab(/const\s+platform\s*=\s*'([^']+)'/),
    };
  }
  // {name, version, required, compatible, severity, reason?, exempt?} for one loaded
  // module. severity is one of:
  //   'ok'    — compatible with the running platform.
  //   'warn'  — incompatible but SAME major (built for a newer minor/patch) or no
  //             platform field: the user may override and install anyway.
  //   'block' — different major: a breaking platform gap that cannot be overridden.
  // List modules (e.g. core.defaults.json) carry no code/version and are exempt ('ok').
  function checkModuleCompat(pck) {
    // A failed re-check fetch (see showCompatDialog) — a hard block, can't be installed.
    if (pck.res?.type === 'error')
      return {
        name: pck.name,
        compatible: false,
        severity: 'block',
        reason: 'fetch failed: ' + (pck.res.error || 'error'),
      };
    if (pck.res?.type !== 'code') return {name: pck.name, compatible: true, exempt: true, severity: 'ok'};
    const meta = parseModuleMeta(pck.res.code);
    const required = meta.platform;
    const compatible = !!required && caretSatisfies(required, VERSION);
    let severity = 'ok';
    let reason;
    if (compatible) {
      severity = 'ok';
    } else if (!required) {
      severity = 'warn';
      reason = 'no platform field declared';
    } else {
      const r = semver(required);
      const p = semver(VERSION);
      if (r && p && r.major !== p.major) {
        severity = 'block';
        reason = `needs platform ${r.major}.x, running ${VERSION}`;
      } else {
        severity = 'warn';
        reason = `built for ${required}, running ${VERSION}`;
      }
    }
    return {name: pck.name, version: meta.version, required, compatible, severity, reason};
  }

  // Classify a plugin's compat with the running platform from its returned meta object.
  //   'ok'     — platform field present and caretSatisfies(required, VERSION).
  //   'warn'   — same major, running older than built-for.
  //   'block'  — different major.
  //   'exempt' — no platform field declared (compatibility unknown, plugin still runs).
  function checkPluginCompat(meta) {
    const required = meta?.platform;
    if (!required) return {compatible: true, severity: 'exempt', reason: 'no platform field'};
    if (caretSatisfies(required, VERSION)) return {compatible: true, severity: 'ok', required};
    const r = semver(required);
    const p = semver(VERSION);
    if (r && p && r.major !== p.major) {
      return {
        compatible: false,
        severity: 'block',
        reason: `needs platform ${r.major}.x, running ${VERSION}`,
        required,
      };
    }
    return {
      compatible: false,
      severity: 'warn',
      reason: `built for ${required}, running ${VERSION}`,
      required,
    };
  }

  // A cached module is usable if it carries a payload: code modules have `.code`,
  // list modules have `.tiddlers`. (The old `!res?.code` test wrongly re-fetched list
  // modules every boot because they never have `.code`.)
  function isCachedModuleUsable(res) {
    return !!(res && (res.code || res.tiddlers));
  }
  // Obtain a core module's payload, WITHOUT persisting it. Returns {res, fetched}: a usable
  // cached copy is used as-is (fetched:false) unless ?reload/?update forces the network;
  // otherwise it is downloaded (fetched:true). Persisting is a separate, deferred step
  // (storeCoreModule) so an incompatible download never overwrites the installed copy.
  async function fetchCoreModule(moduleName) {
    const cached = readObject('/modules' + moduleName);
    if (isCachedModuleUsable(cached) && !qs.reload && !qs.update) return {res: cached, fetched: false};
    return {res: await fetchModule(baseUrl, moduleName), fetched: true};
  }
  // Persist a fetched module into the localStorage cache. Called only after the compat
  // gate passes, or when the user explicitly installs ("forces") from the compat dialog.
  function storeCoreModule(moduleName, res) {
    writeObject('/modules' + moduleName, res);
  }
  // Non-throwing fetch from an arbitrary base URL, used by the compat dialog's re-check
  // so one bad URL/module renders an error row instead of aborting the whole re-check.
  async function tryFetchModule(moduleName, fromBaseUrl) {
    try {
      return {ok: true, res: await fetchModule(fromBaseUrl, moduleName)};
    } catch (e) {
      return {ok: false, error: e.message};
    }
  }
  async function fetchModule(baseUrl, moduleName) {
    if (!baseUrl) throw new Error('NO_MODULE_URL: Unable to determine URL to load module from!');
    // moduleName already starts with '/', so 'modules' + moduleName → 'modules/core.tiddlers.js'
    let moduleUrl = tw.core.buildUrl('modules' + moduleName, baseUrl);
    let res = {};
    dp(`Downloading module from '${moduleUrl}'...`);
    let result = {name: moduleName};
    try {
      result = await fetch(moduleUrl);
    } catch {}
    if (!result.ok) throw new Error(`Unable to download module from '${moduleUrl}' HTTP status: ${result.status}`);
    if (result.headers.get('Content-Type')?.match(/\/javascript/)) {
      res.code = await result.text();
      res.type = 'code';
    } else if (result.headers.get('Content-Type')?.match(/application\/json/)) {
      try {
        dp(`Reading moduled list '${moduleName}'...`);
        res = JSON.parse(await result.text());
        res.type = 'list';
      } catch (e) {
        console.error(e.stack);
        res.error = e;
      }
      if (res.error) throw new Error(`INVALID_MODULE_JSON '${moduleName}' ${res.error.message}`);
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
    RegExp.any = function () {
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

    RegExp.compose = function (re, params) {
      let str = re.source;
      Object.keys(params).forEach(k => (str = str.replace(k, params[k].source)));
      return new RegExp(str, re.flags);
    };
    // eslint-disable-next-line no-extend-native
    RegExp.prototype.or = function () {
      var args = Array.prototype.slice.call(arguments);
      return RegExp.any.apply(null, [this].concat(args));
    };
  }
})();
