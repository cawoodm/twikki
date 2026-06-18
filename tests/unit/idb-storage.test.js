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
const BOOT_PATH = join(ROOT, 'src/packages/base/IndexedDBStorage/BootScript.js');
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
  // setRaw of an object-looking string is returned raw via getRaw, parsed via get
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
  // Stored under '/foo' regardless of how the caller wrote the key
  assert.equal(tw.storage.get('foo'), 'bar');
  assert.equal(tw.storage.get('/foo'), 'bar');
  assert.equal(tw.storage.getRaw('foo'), 'bar');
  // remove also auto-prefixes
  tw.storage.remove('foo');
  assert.equal(tw.storage.get('/foo'), undefined);
});

test('write-through: data survives DB close + reopen via a second boot', async () => {
  const ls = freshEnv();
  const tw1 = {};
  await runBoot(tw1);
  tw1.storage.set('/persist-test', {hello: 'world'});

  // Wait a tick for the fire-and-forget IDB write to land.
  await new Promise(r => setTimeout(r, 20));

  // Reuse same IDB factory + same localStorage — simulate the next page
  // load. A fresh tw object goes through the boot script again.
  globalThis.window = {indexedDB: globalThis.indexedDB, localStorage: ls};
  const tw2 = {};
  await runBoot(tw2);
  assert.deepEqual(tw2.storage.get('/persist-test'), {hello: 'world'});
});

test('migration: copies all LS keys EXCEPT /twikki.boot.js and /modules/*; writes sentinel', async () => {
  freshEnv({
    '/ws/default/tiddlers': '[{"title":"X"}]',
    '/workspaces': '["default"]',
    '/modules/core.common.js': 'CACHED',
    '/twikki.boot.js': '(function(tw){})',
  });
  const tw = {};
  await runBoot(tw);

  // The two keepers landed in tw.storage (hence in IDB).
  assert.equal(tw.storage.getRaw('/ws/default/tiddlers'), '[{"title":"X"}]');
  assert.equal(tw.storage.getRaw('/workspaces'), '["default"]');
  // The two skippables did NOT migrate.
  assert.equal(tw.storage.getRaw('/modules/core.common.js'), null);
  assert.equal(tw.storage.getRaw('/twikki.boot.js'), null);
  // Sentinel is set.
  assert.ok(tw.storage.getRaw('/_meta/migrated'));
});

test('migration runs once: sentinel prevents re-copying when LS changes later', async () => {
  const ls = freshEnv({'/ws/default/tiddlers': 'first'});
  const tw1 = {};
  await runBoot(tw1);
  assert.equal(tw1.storage.getRaw('/ws/default/tiddlers'), 'first');

  await new Promise(r => setTimeout(r, 20));

  // User edits localStorage AFTER migration (unlikely in practice but
  // proves the sentinel guard): on next boot we must NOT clobber IDB with
  // the new LS value. IDB stays canonical.
  ls.setItem('/ws/default/tiddlers', 'second');
  globalThis.window = {indexedDB: globalThis.indexedDB, localStorage: ls};
  const tw2 = {};
  await runBoot(tw2);
  assert.equal(tw2.storage.getRaw('/ws/default/tiddlers'), 'first');
});

test('IDB unavailable: boot script returns without assigning tw.storage', async () => {
  // Simulate no IndexedDB in the environment.
  globalThis.window = {indexedDB: undefined, localStorage: makeLocalStorage()};
  const tw = {};
  await runBoot(tw);
  // tw.storage MUST remain unset so the platform's
  // `if (!tw.storage) tw.storage = initLocalStorage()` fallback can take over.
  assert.equal(tw.storage, undefined);
});

test('IDB open throws: boot promise rejects so platform can catch + fall back', async () => {
  // Force indexedDB.open to throw to simulate a corrupted store / blocked
  // origin. The platform's runBootScript wraps the call in try/catch +
  // alert; what matters here is that the returned promise rejects.
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
