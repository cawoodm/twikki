(function() {

  const NAME = 'twikki';
  const VERSION = '0.0.0';

  let qs;
  let os;
  let defaults;
  let baseUrl;
  let tw = {};

  return {
    name: NAME,
    version: VERSION,
    async init(p) {
      qs = p.qs;
      os = p.os;
      defaults = p.platform;
      window.tw = tw;
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
          if (res?.match(/^\[\{/)) return JSON.parse(res);
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
        '/core.workspaces.js',
        '/core.defaults.json',
        '/core.packaging.js',
        '/core.dom.js',
        '/core.ui.js',
        '/core.notifications.js',
      ];
      let packagesLoaded = await Promise.all(packagesToLoad.map(loadPackage));
      packagesToLoad.forEach((p, i) => {
        // TODO: Should be writing to workspace here!
        //         or we make workspaces DATA only?
        //       In which case we need a tenant concept!
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
            // TODO: Properly load each tiddler with addTiddler() or tw.shadowTiddlers
            tw.tiddlers.all = tw.tiddlers.all.concat(pck.res.tiddlers);
            if (pck.name === '/core.defaults.json') tw.shadowTiddlers = pck.res.tiddlers;
            console.debug(`Loaded ${pck.res.tiddlers.length} tiddlers from ${pck.name})`);
          } else {
            console.warn(`Skipping unknown package type '${pck.res.type}' in package '${pck.name}'!`);
          }
        });
      console.debug(`${tw.packages.length} packages loaded. Running packages...`);
      tw.packages
        .filter(pck => pck.meta?.run)
        .forEach(pck => {
          dp('running', pck.name);
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
      tw.core.notifications.notify('OK');
      console.debug(`*** TWikki v${VERSION}`);
      if (errMsgs.length){
        console.warn('*** Errors Occurred');
        console.warn('<p class="error">Developers can reload with ?trace to debug exact issue in DevTools');
      }
      console.debug('Extensions: ' + defaults.extensions?.join(', '));
      return;
      /* TODO: Move to console.log

      errMsgs.forEach(e => {
        console.debug(`<p class="error">${e}`);
      });
      console.debug('<h2>Details:</h2>');
      console.debug(`<p>Loaded TWIKKI.Core v${tw.packages[0].meta.version}`);
      console.debug('<p>ShadowTiddlers: ' + tw.shadowTiddlers.length);
      console.debug('<p>Events: ' + tw.events.handlers().length);
      */
    },
  };
  async function loadPackage(packageName) {
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
    if (result.headers.get('Content-Type')?.match(/text\/javascript/)) {
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
})();
