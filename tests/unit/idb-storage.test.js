import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';

// The boot script ships as src/packages/base/IndexedDBStorage/BootScript.js;
// the compiler wraps it in a fenced `javascript` code block which the
// runtime section parser strips before getTiddlerTextRaw returns the inner
// source. The test reads the raw file directly — that's the exact text the
// platform stores in /twikki.boot.js and evals.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BOOT_PATH = join(ROOT, 'src/packages/base/IndexedDBStoragePlugin/BootScript.js');
const BOOT_SRC = readFileSync(BOOT_PATH, 'utf8');

function makeLocalStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    get length() { return data.size; },
    key(i) { return [...data.keys()][i] ?? null; },
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { data.set(k, String(v)); },
    removeItem(k) { data.delete(k); },
    clear() { data.clear(); },
    _data: data,
  };
}

// Each test installs a fresh fake IDB factory + a fresh localStorage so
// state never leaks between tests.
function freshEnv(seed) {
  globalThis.indexedDB = new FDBFactory();
  const ls = makeLocalStorage(seed);
  globalThis.window = {indexedDB: globalThis.indexedDB, localStorage: ls};
  return ls;
}

async function runBoot(tw) {
  // eslint-disable-next-line no-eval
  const fn = (1, eval)(BOOT_SRC);
  if (typeof fn !== 'function') throw new Error('BootScript did not evaluate to a function');
  await fn(tw);
  return tw;
}

// Inspect the underlying IDB the boot script just opened — used for
// schema-shape assertions (per-workspace stores).
async function listStoreNames() {
  // The boot script's db is internal; reach it via a second open() on the
  // shared factory. fake-indexeddb honours the standard IDB contract here.
  return new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open('twikki');
    req.onsuccess = () => {
      const names = [...req.result.objectStoreNames].sort();
      req.result.close();
      resolve(names);
    };
    req.onerror = () => reject(req.error);
  });
}

async function readStore(storeName) {
  return new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open('twikki');
    req.onsuccess = () => {
      const tx = req.result.transaction(storeName, 'readonly');
      const cursor = tx.objectStore(storeName).openCursor();
      const out = {};
      cursor.onsuccess = e => {
        const c = e.target.result;
        if (c) {
          out[c.key] = c.value;
          c.continue();
        } else {
          req.result.close();
          resolve(out);
        }
      };
      cursor.onerror = () => reject(cursor.error);
    };
    req.onerror = () => reject(req.error);
  });
}

test('boot script evaluates to a function (platform contract)', () => {
  // The platform's runBootScript does `const fn = (1, eval)(src); fn(tw)`.
  // The source MUST evaluate to a function or the hook silently no-ops.
  // eslint-disable-next-line no-eval
  const fn = (1, eval)(BOOT_SRC);
  assert.equal(typeof fn, 'function');
});

test('interface parity: get / set / remove / keys / getRaw / setRaw', async () => {
  freshEnv();
  const tw = {};
  await runBoot(tw);

  // set + get round-trip a primitive
  tw.storage.set('/a', 'hello');
  assert.equal(tw.storage.get('/a'), 'hello');

  // set + get round-trip an object (JSON coercion in both directions)
  tw.storage.set('/b', {x: 1, y: 'z'});
  assert.deepEqual(tw.storage.get('/b'), {x: 1, y: 'z'});

  // setRaw + getRaw bypass JSON coercion
  tw.storage.setRaw('/c', 'literal');
  assert.equal(tw.storage.getRaw('/c'), 'literal');
  tw.storage.setRaw('/d', '{"x":1}');
  assert.equal(tw.storage.getRaw('/d'), '{"x":1}');
  assert.deepEqual(tw.storage.get('/d'), {x: 1});

  // remove
  tw.storage.remove('/a');
  assert.equal(tw.storage.get('/a'), undefined);

  // keys(prefix)
  tw.storage.set('/ws/foo/x', '1');
  tw.storage.set('/ws/foo/y', '2');
  tw.storage.set('/ws/bar/x', '3');
  const fooKeys = tw.storage.keys('/ws/foo/').sort();
  assert.deepEqual(fooKeys, ['/ws/foo/x', '/ws/foo/y']);
});

test('auto-prefix: keys without leading "/" get one prepended', async () => {
  freshEnv();
  const tw = {};
  await runBoot(tw);

  tw.storage.set('foo', 'bar');
  assert.equal(tw.storage.get('foo'), 'bar');
  assert.equal(tw.storage.get('/foo'), 'bar');
  assert.equal(tw.storage.getRaw('foo'), 'bar');
  tw.storage.remove('foo');
  assert.equal(tw.storage.get('/foo'), undefined);
});

test('schema: one IDB store per workspace + _global', async () => {
  // Discover-from-LS path: keys for two workspaces + the /workspaces JSON.
  freshEnv({
    '/ws/foo/tiddlers': 'F',
    '/ws/bar/tiddlers': 'B',
    '/workspaces': '["foo","bar","unused"]',
  });
  await runBoot({});
  // _global + ws_foo + ws_bar + ws_unused (declared in /workspaces) +
  // ws_default (always present). Sorted.
  const names = await listStoreNames();
  assert.deepEqual(names, ['_global', 'ws_bar', 'ws_default', 'ws_foo', 'ws_unused']);
});

test('routing: workspace-prefixed keys land in their store under the unprefixed key', async () => {
  freshEnv();
  const tw = {};
  await runBoot(tw);
  tw.storage.set('/ws/foo/tiddlers', '[1,2,3]');
  tw.storage.set('/workspaces', '["foo"]');
  await new Promise(r => setTimeout(r, 30));

  const fooStore = await readStore('ws_foo');
  assert.deepEqual(fooStore, {tiddlers: '[1,2,3]'});
  const globalStore = await readStore('_global');
  // Sentinel + /workspaces (full key, since global keys aren't re-keyed)
  assert.equal(globalStore['/workspaces'], '["foo"]');
});

test('dynamic store: writing to an unknown workspace lazily creates ws_<name>', async () => {
  freshEnv();
  const tw = {};
  await runBoot(tw);

  // Workspace 'brand-new' wasn't in localStorage and wasn't in /workspaces;
  // the boot script's discovery never saw it. A live write should still
  // succeed, lazily upgrading the DB to add ws_brand-new.
  tw.storage.set('/ws/brand-new/tiddlers', 'hello');
  await new Promise(r => setTimeout(r, 50));

  const names = await listStoreNames();
  assert.ok(names.includes('ws_brand-new'), `expected ws_brand-new in ${names}`);
  const store = await readStore('ws_brand-new');
  assert.deepEqual(store, {tiddlers: 'hello'});
});

test('migration: routes localStorage keys to the right store, sets sentinel in _global', async () => {
  freshEnv({
    '/ws/default/tiddlers': '[{"title":"X"}]',
    '/ws/foo/tiddlers': '[{"title":"Y"}]',
    '/workspaces': '["default","foo"]',
    '/modules/core.common.js': 'CACHED',
    '/twikki.boot.js': '(function(tw){})',
  });
  const tw = {};
  await runBoot(tw);
  await new Promise(r => setTimeout(r, 30));

  // Workspace data routed by store.
  const defStore = await readStore('ws_default');
  assert.equal(defStore.tiddlers, '[{"title":"X"}]');
  const fooStore = await readStore('ws_foo');
  assert.equal(fooStore.tiddlers, '[{"title":"Y"}]');
  // Globals + sentinel routed to _global.
  const globalStore = await readStore('_global');
  assert.equal(globalStore['/workspaces'], '["default","foo"]');
  assert.ok(globalStore['/_meta/migrated']);
  // Skippables did NOT migrate (no store named for /modules, no entry for /twikki.boot.js).
  assert.equal(globalStore['/modules/core.common.js'], undefined);
  assert.equal(globalStore['/twikki.boot.js'], undefined);
  // tw.storage exposes the full prefixed form on read.
  assert.equal(tw.storage.getRaw('/ws/default/tiddlers'), '[{"title":"X"}]');
  assert.equal(tw.storage.getRaw('/ws/foo/tiddlers'), '[{"title":"Y"}]');
});

test('write-through: data survives close + reopen via a second boot', async () => {
  const ls = freshEnv();
  const tw1 = {};
  await runBoot(tw1);
  tw1.storage.set('/persist-test', {hello: 'world'});
  tw1.storage.set('/ws/foo/tiddlers', 'foo-data');
  await new Promise(r => setTimeout(r, 30));

  globalThis.window = {indexedDB: globalThis.indexedDB, localStorage: ls};
  const tw2 = {};
  await runBoot(tw2);
  assert.deepEqual(tw2.storage.get('/persist-test'), {hello: 'world'});
  assert.equal(tw2.storage.getRaw('/ws/foo/tiddlers'), 'foo-data');
});

test('migration runs once: sentinel blocks a second LS-copy on the next boot', async () => {
  const ls = freshEnv({'/ws/default/tiddlers': 'first'});
  const tw1 = {};
  await runBoot(tw1);
  assert.equal(tw1.storage.getRaw('/ws/default/tiddlers'), 'first');
  await new Promise(r => setTimeout(r, 30));

  ls.setItem('/ws/default/tiddlers', 'second');
  globalThis.window = {indexedDB: globalThis.indexedDB, localStorage: ls};
  const tw2 = {};
  await runBoot(tw2);
  assert.equal(tw2.storage.getRaw('/ws/default/tiddlers'), 'first');
});

test('clearWorkspace drops the ws_<name> object store + memory entries', async () => {
  freshEnv();
  const tw = {};
  await runBoot(tw);
  tw.storage.set('/ws/foo/tiddlers', 'F');
  tw.storage.set('/ws/bar/tiddlers', 'B');
  await new Promise(r => setTimeout(r, 30));

  tw.storage.clearWorkspace('foo');
  await new Promise(r => setTimeout(r, 60));   // let the version-bump upgrade settle

  const names = await listStoreNames();
  assert.ok(!names.includes('ws_foo'), `ws_foo should be gone (got ${names.join(',')})`);
  assert.ok(names.includes('ws_bar'), 'ws_bar untouched');
  assert.equal(tw.storage.get('/ws/foo/tiddlers'), undefined, 'memory entry wiped sync');
  assert.equal(tw.storage.getRaw('/ws/bar/tiddlers'), 'B', 'other workspace intact');
});

test('clearWorkspace on a never-created workspace is a no-op', async () => {
  freshEnv();
  const tw = {};
  await runBoot(tw);
  tw.storage.clearWorkspace('never-existed');   // must not throw
  await new Promise(r => setTimeout(r, 30));
  const names = await listStoreNames();
  assert.ok(names.includes('_global'), '_global survives');
  assert.ok(names.includes('ws_default'), 'ws_default survives');
});

test('IDB unavailable: boot script throws (visible failure, platform alerts)', async () => {
  // The boot script throws an explicit Error in this case so the platform's
  // runBootScript shows the alert + falls back to initLocalStorage().
  globalThis.window = {indexedDB: undefined, localStorage: makeLocalStorage()};
  const tw = {};
  // eslint-disable-next-line no-eval
  const fn = (1, eval)(BOOT_SRC);
  await assert.rejects(() => fn(tw), /No IndexedDB available/);
  assert.equal(tw.storage, undefined);
});

test('IDB open throws: boot promise rejects so platform can catch + fall back', async () => {
  const factory = new FDBFactory();
  factory.open = () => {
    throw new Error('simulated open failure');
  };
  globalThis.window = {indexedDB: factory, localStorage: makeLocalStorage()};
  const tw = {};
  // eslint-disable-next-line no-eval
  const fn = (1, eval)(BOOT_SRC);
  await assert.rejects(() => fn(tw), /simulated open failure/);
  assert.equal(tw.storage, undefined);
});
