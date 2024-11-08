

/**
 * BOOTLOADER (v0.0)
 * Boot loader which will run an OS
 *  from localStorage or a URL
 * A OS is just some code to run, it can be .js or wrapped in a basic object:
 * {
 *   "name": "os.v0",
 *   "version": "0.0.1",
 *   "url": "https://cawoodm.github.io/weboose/os.v0.js",
 *   "code": "console.log('hello from weboose!');"
 * }
 */
window.boot = async function(p = {}) {

  const RE_OS_NAME = /^[a-z0-9\.]{3,30}$/;
  const BOOTLOADER_VERSION = '0.0.1';
  const OS_FILENAME = '/os.name';
  const OS_URL = '/base.url';

  window.addEventListener('error', (e) => {
    console.error(e.message, e.error.stack);
  });

  const qs = Object.fromEntries(new URLSearchParams(location.search));
  Object.keys(qs).filter(q => qs[q] === '').forEach(q => (qs[q] = true)); // Empty params are switches => convert to true

  if (qs.clear) localStorage.clear();
  if (!qs.debug) console.debug = () => undefined;

  console.debug(`BOOT: Bootloader (v${BOOTLOADER_VERSION}) starting...`);
  document.title = 'WebOOSe';

  let osName = qs.os || read(OS_FILENAME) || p.os.name;
  if (!osName.match(RE_OS_NAME)) throw new Error(`INVALID_OS_NAME: '${osName}' is not a valid OS name!`);

  let baseUrl = qs.oUrl || qs.url || read(OS_URL) || p?.os?.url || p.base;
  if (!baseUrl.match(/^https?:\/\//)) throw new Error(`INVALID_OS_URL: '${baseUrl}' is not a valid URL!`);
  baseUrl = baseUrl.replace(/\/$/, '');

  if (!osName && !baseUrl && p.os.demo) {
    if (!confirm('No OS settings found. Would you like to load a demo?')) throw new Error('OS_SETTINGS_MISSING');
    osName = 'weboose.latest';
    baseUrl = 'https://cawoodm.github.io/weboose';
  }

  console.debug(`BOOT: Looking for local OS '${osName}'...`);
  let os = readObject('/os/' + osName, {});

  if (!os.code || qs.reload) {
    // Load from URL
    console.debug('BOOT: No local OS found');
    if (!OS_URL) throw new Error('NO_OS_URL: Unable to determine URL to load OS from!');
    // Assume .js
    let osUrl = baseUrl + '/os/' + osName + '.js';
    let res = {};
    console.debug(`BOOT: Installing OS from '${osUrl}'...`);
    try {res = await fetch(osUrl);} catch {}
    // Fallback to .json
    if (!res) try {let osUrl = baseUrl + osName + '.json'; res = await fetch(osUrl);} catch {}
    if (!res.ok) throw new Error(`OS_DOWNLOAD_ERROR: Unable to download OS from '${osUrl}' HTTP status: ${res.statusCode}`);
    if (res.headers.get('Content-Type')?.match(/\/javascript/)) os.code = await res.text();
    else if (res.headers.get('Content-Type')?.match(/application\/json/)) {
      try {
        console.debug(`BOOT: Loading OS '${osName}'...`);
        os = JSON.parse(await res.text());
      } catch (e){
        console.error(e.stack);
        os.error = e;
      }
      if (os.error)
        throw new Error(`INVALID_OS_JSON '${osName}' ${os.error.message}`);
    } else throw new Error(`OS_FORMAT_UNKNOWN: ${osUrl} is not served as JS/JSON`);
  }

  if (!os.code)
    throw new Error(`OS_CODE_MISSING '${osName}' has no code to run!`);

  write(OS_FILENAME, osName);
  write(OS_URL, baseUrl);
  writeObject('/os/' + osName, os);

  // The MAGIC happens here:
  console.debug(`BOOT: Executing OS '${osName}'...`);
  let osObject;
  try {
    // TODO: Run differently so we get line numbers?
    osObject = (1, eval)(os.code);
  } catch (e) {
    console.error('OS_FAILED', e);
    throw (e);
  }

  if (!osObject) throw new Error('OS_NOT_RETURNED: The os');
  if (!osObject.init) throw new Error('OS_INVALID: No init() function found!');
  if (!osObject.start) throw new Error('OS_INVALID: No start() function found!');

  console.debug(`BOOT: Initialising OS ${osObject.name} (v${osObject.version}) ...`);
  const FS = '/os/' + osName;
  try {
    await osObject.init({
      qs,
      base: p.base,
      os: p.os,
      platform: p.platform,
      kernel: {
        read(key, def) {
          return read(FS + key, def);
        },
        write(key, value) {
          return write(FS + key, value);
        },
      },
    });
    console.debug('BOOT: OS initialised.');
  } catch (e) {
    console.error('OS_INIT_FAILED', e.message);
    throw (e);
  }

  console.debug('BOOT: Starting OS...');
  try {
    osObject.start();
    // Note: we do not (a)wait for the OS to start, our job is done!
  } catch (e) {
    console.error('OS_START_FAILED', e.message);
    throw (e);
  }

  console.debug('BOOT: Boot complete.');

  function readObject(item) {
    let json = read(item);
    if (!json?.match(/^\{/)) return {};
    return JSON.parse(json);
  }
  function read(item, defaultValue) {
    return localStorage.getItem(item) || defaultValue;
  }
  function writeObject(item, value) {
    return write(item, JSON.stringify(value));
  }
  function write(item, value) {
    return localStorage.setItem(item, value);
  }
};
