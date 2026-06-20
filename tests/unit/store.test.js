import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

// Eval the module the way the platform does, against a stubbed localStorage and
// a stubbed tw.storage (mirroring the platform's read/write + JSON coercion).
function freshStore(workspace = 'default') {
  // A plain object stands in for localStorage: stored keys are own enumerable
  // props (so Object.keys(localStorage) enumerates them like the browser), the
  // accessor methods are non-enumerable.
  const backing = {};
  for (const [m, fn] of Object.entries({
    getItem: k => (Object.hasOwn(backing, k) ? backing[k] : null),
    setItem: (k, v) => (backing[k] = String(v)),
    removeItem: k => delete backing[k],
  })) Object.defineProperty(backing, m, {value: fn, enumerable: false});
  global.localStorage = backing;

  // Mirror initLocalStorage() in src/platform/twikki.platform.js: tw.store now
  // delegates remove/keys/exportRaw/importRaw through these methods (the
  // previous version reached straight into localStorage).
  const tw = {
    workspace,
    storage: {
      get(key) {
        if (key[0] !== '/') key = '/' + key;
        let res = localStorage.getItem(key);
        if (res?.match(/^[\[\{]/)) return JSON.parse(res);
        return res;
      },
      set(key, value) {
        if (key[0] !== '/') key = '/' + key;
        if (typeof value === 'object') return localStorage.setItem(key, JSON.stringify(value));
        return localStorage.setItem(key, value);
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
      clearWorkspace(name) {
        const prefix = `/ws/${name}/`;
        Object.keys(localStorage)
          .filter(k => k.startsWith(prefix))
          .forEach(k => localStorage.removeItem(k));
      },
    },
    tiddlers: {all: [], visible: [], trashed: []},
    run: {},
  };
  const code = readFileSync(join(root, 'src/modules/core.store.js'), 'utf8');
  const meta = (0, eval)(code)(tw);
  return {tw, meta, backing};
}

test('module returns name/version/platform and installs tw.store', () => {
  const {tw, meta} = freshStore();
  assert.equal(meta.name, 'core.store');
  assert.ok(tw.store);
  assert.ok(meta.exports.save && meta.exports.loadStore && meta.exports.tiddlersToSave);
});

test('get/set are scoped to the current workspace prefix', () => {
  const {tw, backing} = freshStore('default');
  tw.store.set('tiddlers', [{title: 'A'}]);
  assert.ok(Object.hasOwn(backing, '/ws/default/tiddlers'), 'writes under /ws/default/');
  assert.deepEqual(tw.store.get('tiddlers'), [{title: 'A'}]);
  // Switching workspace repoints all access without rebuilding the store object
  tw.workspace = 'other';
  assert.equal(tw.store.get('tiddlers'), null);
  tw.store.set('tiddlers', []);
  assert.ok(Object.hasOwn(backing, '/ws/other/tiddlers'));
});

test('tw.storage.clearWorkspace removes only the named workspace prefix', () => {
  const {tw, backing} = freshStore('default');
  tw.store.set('keep', '1');
  tw.workspace = 'gone';
  tw.store.set('drop', '2');
  tw.workspace = 'default';
  tw.storage.clearWorkspace('gone');
  assert.ok(Object.hasOwn(backing, '/ws/default/keep'), 'unrelated workspace untouched');
  assert.ok(!Object.hasOwn(backing, '/ws/gone/drop'), 'target workspace wiped');
});

test('keys() lists workspace keys prefix-stripped; delete removes', () => {
  const {tw} = freshStore();
  tw.store.set('tiddlers', []);
  tw.store.set('tiddlers-visible', []);
  tw.workspace = 'other';
  tw.store.set('foreign', 'x');
  tw.workspace = 'default';
  assert.deepEqual(tw.store.keys().sort(), ['tiddlers', 'tiddlers-visible']);
  tw.store.delete('tiddlers-visible');
  assert.deepEqual(tw.store.keys(), ['tiddlers']);
});

test('exportRaw/importRaw round-trip raw strings without JSON coercion', () => {
  const {tw} = freshStore();
  tw.store.importRaw('blob', '{"not":"parsed"}');
  assert.equal(tw.store.exportRaw('blob'), '{"not":"parsed"}');
  assert.deepEqual(tw.store.get('blob'), {not: 'parsed'}, 'get still coerces');
});

test('global reaches unscoped keys', () => {
  const {tw, backing} = freshStore();
  tw.store.global.set('/settings.json', {urls: {}});
  assert.ok(Object.hasOwn(backing, '/settings.json'), 'no workspace prefix');
  assert.deepEqual(tw.store.global.get('/settings.json'), {urls: {}});
});

test('tiddlersToSave filters doNotSave', () => {
  const {meta} = freshStore();
  assert.equal(meta.exports.tiddlersToSave({title: 'a'}), true);
  assert.equal(meta.exports.tiddlersToSave({title: 'a', doNotSave: true}), false);
});
