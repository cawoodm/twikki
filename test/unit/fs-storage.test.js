import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// The File System Access backend's pure helpers are extracted from the boot
// script by sentinel-comment regex and eval'd in isolation — the I/O shell
// around them needs a real browser FS, but these are deterministic and tested
// here without one (mirrors how idb-storage.test.js extracts `shouldPrompt`).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BOOT_PATH = join(ROOT, 'src/packages/base/FileSystemStoragePlugin/BootScript.js');
const BOOT_SRC = readFileSync(BOOT_PATH, 'utf8');

const H = (() => {
  const m = BOOT_SRC.match(/\/\* BEGIN pure-helpers[\s\S]*?\/\* END pure-helpers \*\//);
  if (!m) throw new Error('pure-helpers block not found — sentinel comments moved?');
  // eslint-disable-next-line no-new-func
  return new Function(m[0] + '\nreturn {extForType, typeForExt, hashStr, safeBaseName, packageFolder, serializeTiddler, parseTiddlerFile, routeKey, planFiles, diffPlan, globalSeg, globalFileName, globalKeyFromFile};')();
})();

test('extForType / typeForExt: known types map both ways', () => {
  const pairs = [
    ['x-twikki', '.tid'],
    ['markdown', '.md'],
    ['script/js', '.js'],
    ['json', '.json'],
    ['css', '.css'],
    ['html', '.html'],
  ];
  for (const [type, ext] of pairs) {
    assert.equal(H.extForType(type), ext);
    assert.equal(H.typeForExt(ext), type);
  }
  // Unknown type falls back to .tid / x-twikki.
  assert.equal(H.extForType('weird/thing'), '.tid');
  assert.equal(H.typeForExt('.bogus'), 'x-twikki');
});

test('safeBaseName: clean titles (incl. $ and spaces) round-trip unchanged', () => {
  assert.equal(H.safeBaseName('$MainLayout'), '$MainLayout');
  assert.equal(H.safeBaseName('My Daily Note'), 'My Daily Note');
  assert.equal(H.safeBaseName('readme-2.md notes'), 'readme-2.md notes');
});

test('safeBaseName: reserved chars are stripped and a hash suffix added', () => {
  const out = H.safeBaseName('Title::Section');
  assert.ok(!out.includes(':'), 'colon removed');
  assert.ok(out.includes('~'), 'lossy → hash suffix');
});

test('safeBaseName: deterministic, and distinct lossy titles do not collide', () => {
  assert.equal(H.safeBaseName('a/b'), H.safeBaseName('a/b'), 'deterministic');
  assert.notEqual(H.safeBaseName('a/b'), H.safeBaseName('a:b'), 'distinct titles → distinct names');
});

test('safeBaseName: Windows reserved device names get a hash suffix', () => {
  for (const name of ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT9', 'con', 'nul']) {
    const out = H.safeBaseName(name);
    assert.ok(out.includes('~'), `${name} → hash suffix added (got: ${out})`);
  }
  // A title that merely contains a reserved word but isn't one should be unaffected.
  assert.ok(!H.safeBaseName('console').includes('~'), 'console is not reserved');
});

test('packageFolder: falls back to _user when no package', () => {
  assert.equal(H.packageFolder({package: 'base'}), 'base');
  assert.equal(H.packageFolder({}), '_user');
  assert.equal(H.packageFolder(null), '_user');
});

test('serializeTiddler / parseTiddlerFile: round-trip incl. custom field + internal blank line', () => {
  const t = {
    title: 'My Note',
    text: '# Hi\n\nsecond paragraph',
    tags: ['a', 'b'],
    type: 'markdown',
    package: 'demo',
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-02T00:00:00.000Z',
    color: 'red',
  };
  const parsed = H.parseTiddlerFile(H.serializeTiddler(t), 'fallback', 'x-twikki');
  assert.equal(parsed.title, 'My Note');
  assert.equal(parsed.text, '# Hi\n\nsecond paragraph');
  assert.deepEqual(parsed.tags, ['a', 'b']);
  assert.equal(parsed.type, 'markdown');
  assert.equal(parsed.package, 'demo');
  assert.equal(parsed.created, '2026-01-01T00:00:00.000Z');
  assert.equal(parsed.color, 'red');
});

test('parseTiddlerFile: a body that starts with "key: value" is not misread as header', () => {
  const t = {title: 'X', type: 'markdown', text: 'foo: bar\nstill body'};
  const parsed = H.parseTiddlerFile(H.serializeTiddler(t), 'X', 'markdown');
  assert.equal(parsed.text, 'foo: bar\nstill body');
});

test('parseTiddlerFile: empty body round-trips to empty string', () => {
  const t = {title: 'Empty', type: 'markdown', text: ''};
  assert.equal(H.parseTiddlerFile(H.serializeTiddler(t), 'Empty', 'markdown').text, '');
});

test('serializeTiddler / parseTiddlerFile: multi-word tags survive the round-trip', () => {
  const t = {title: 'X', type: 'markdown', tags: ['My Project', 'todo'], text: 'body'};
  const parsed = H.parseTiddlerFile(H.serializeTiddler(t), 'X', 'markdown');
  assert.deepEqual(parsed.tags, ['My Project', 'todo']);
});

test('parseTiddlerFile: missing title/type fall back to filename/ext', () => {
  const parsed = H.parseTiddlerFile('just body, no header', 'FromFilename', 'markdown');
  assert.equal(parsed.title, 'FromFilename');
  assert.equal(parsed.type, 'markdown');
  assert.equal(parsed.text, 'just body, no header');
});

test('routeKey: tiddlers vs workspace-meta vs global', () => {
  assert.deepEqual(H.routeKey('/ws/default/tiddlers'), {kind: 'tiddlers', ws: 'default'});
  assert.deepEqual(H.routeKey('/ws/default/tiddlers-visible'), {kind: 'wsmeta', ws: 'default'});
  assert.deepEqual(H.routeKey('/workspaces'), {kind: 'global'});
  assert.deepEqual(H.routeKey('/settings.json'), {kind: 'global'});
});

test('planFiles: groups by package, picks extension by type, suffixes case-collisions', () => {
  const plan = H.planFiles([
    {title: 'Note A', type: 'markdown', package: 'demo'},
    {title: 'Note A', type: 'markdown'}, // no package → _user (different folder, no collision)
    {title: 'Foo', type: 'markdown'},
    {title: 'foo', type: 'markdown'}, // case-collision with Foo.md in _user
  ]);
  const byTitle = Object.fromEntries(plan.map(p => [p.title === 'Note A' ? p.path : p.title, p.path]));
  assert.equal(byTitle['demo/Note A.md'], 'demo/Note A.md');
  assert.equal(byTitle['_user/Note A.md'], '_user/Note A.md');
  assert.equal(byTitle.Foo, '_user/Foo.md');
  assert.ok(byTitle.foo.startsWith('_user/foo~') && byTitle.foo.endsWith('.md'), `collision suffixed: ${byTitle.foo}`);
});

test('diffPlan: writes new/changed/moved, deletes removed + moved-away', () => {
  const prev = new Map([
    ['A', {path: '_user/A.md', hash: 'h1'}],
    ['B', {path: '_user/B.md', hash: 'h2'}],
    ['C', {path: 'demo/C.md', hash: 'h3'}],
    ['E', {path: '_user/E.md', hash: 'h5'}],
  ]);
  const plan = [
    {title: 'A', path: '_user/A.md', hash: 'h1'}, // unchanged
    {title: 'B', path: '_user/B.md', hash: 'h2new'}, // changed
    {title: 'C', path: '_user/C.md', hash: 'h3'}, // moved demo → _user
    {title: 'D', path: '_user/D.md', hash: 'h4'}, // new
  ];
  const {writes, deletes} = H.diffPlan(prev, plan);
  assert.deepEqual(
    writes.map(w => w.title).sort(),
    ['B', 'C', 'D'],
  );
  assert.deepEqual(deletes.sort(), ['_user/E.md', 'demo/C.md']);
});

// ---------------------------------------------------------------------------
// shouldPrompt — pure predicate extracted from FileSystemStorageCode.js.
// ---------------------------------------------------------------------------
const CODE_PATH = join(ROOT, 'src/packages/base/FileSystemStoragePlugin/FileSystemStorageCode.js');
const CODE_SRC = readFileSync(CODE_PATH, 'utf8');
const SHOULD_PROMPT = (() => {
  const m = CODE_SRC.match(/\/\* BEGIN shouldPrompt[\s\S]*?\/\* END shouldPrompt \*\//);
  if (!m) throw new Error('shouldPrompt helper block not found — sentinel comments moved?');
  // eslint-disable-next-line no-new-func
  return new Function(m[0] + '\nreturn shouldPrompt;')();
})();

test('shouldPrompt: only prompts when installed, bundled differs, not snoozed, first this load', () => {
  assert.equal(SHOULD_PROMPT({installed: 'A', bundled: 'B', dismissedToday: false, sessionFlag: false, owned: true}), true);
  assert.equal(SHOULD_PROMPT({installed: 'X', bundled: 'X', dismissedToday: false, sessionFlag: false, owned: true}), false);
  assert.equal(SHOULD_PROMPT({installed: null, bundled: 'B', dismissedToday: false, sessionFlag: false, owned: false}), false);
  assert.equal(SHOULD_PROMPT({installed: 'A', bundled: 'B', dismissedToday: true, sessionFlag: false, owned: true}), false);
  assert.equal(SHOULD_PROMPT({installed: 'A', bundled: 'B', dismissedToday: false, sessionFlag: true, owned: true}), false);
});

test('shouldPrompt: another backend owns the boot slot returns false (no ping-pong)', () => {
  // The /twikki.boot.js slot holds the OTHER storage backend's script. This
  // plugin must NOT offer to re-install — doing so reboots and hands the slot
  // to us, then the other plugin re-claims it on the next load → infinite loop.
  assert.equal(SHOULD_PROMPT({installed: 'OTHER-BACKEND', bundled: 'MINE', dismissedToday: false, sessionFlag: false, owned: false}), false);
});

// ---------------------------------------------------------------------------
// Boot-then-replay migration. The boot script ONLY initialises the store; the
// plugin's connect() migrates by standing the backend up against the folder and
// replaying every key through it (setRaw → file-per-tiddler writer), then
// flush(). This test drives that exact path. The regression it guards: every
// workspace must end up on disk, not just the alphabetically-first one.
// ---------------------------------------------------------------------------

// Minimal in-memory FileSystemDirectoryHandle good enough for the writer path
// (getDirectoryHandle/getFileHandle/createWritable/removeEntry).
function makeDir() {
  const dirs = new Map();
  const files = new Map();
  const handle = {
    kind: 'directory',
    async getDirectoryHandle(name, o) {
      if (!dirs.has(name)) {
        if (!o || !o.create) throw new Error('NotFoundError: ' + name);
        dirs.set(name, makeDir());
      }
      return dirs.get(name);
    },
    async getFileHandle(name, o) {
      if (!files.has(name)) {
        if (!o || !o.create) throw new Error('NotFoundError: ' + name);
        files.set(name, {content: ''});
      }
      const slot = files.get(name);
      return {
        kind: 'file',
        async createWritable() {
          return {async write(c) { slot.content = String(c); }, async close() {}};
        },
        async getFile() { return {async text() { return slot.content; }}; },
      };
    },
    async removeEntry(name) { files.delete(name); dirs.delete(name); },
    async *entries() {
      for (const [n, d] of dirs) yield [n, d];
      for (const [n] of files) yield [n, await handle.getFileHandle(n)];
    },
    _dirs: dirs,
    _files: files,
  };
  return handle;
}

// Minimal in-memory IndexedDB stub for the boot script's handle DB — stores the
// directory handle BY REFERENCE (no structuredClone, which can't clone methods).
// Pre-seed with `seed = {dbName: {storeName: Map}}`.
function makeFakeIDB(seed) {
  const dbs = seed || {};
  return {
    open(name) {
      const req = {};
      const stores = (dbs[name] = dbs[name] || {});
      const db = {
        objectStoreNames: {contains: n => n in stores},
        createObjectStore(n) {
          stores[n] = stores[n] || new Map();
          return {};
        },
        transaction(sname) {
          const m = (stores[sname] = stores[sname] || new Map());
          return {
            objectStore: () => ({
              get(key) {
                const r = {};
                setTimeout(() => {
                  r.result = m.get(key);
                  r.onsuccess && r.onsuccess();
                }, 0);
                return r;
              },
              put(val, key) {
                m.set(key, val);
                const r = {};
                setTimeout(() => r.onsuccess && r.onsuccess(), 0);
                return r;
              },
              delete(key) {
                m.delete(key);
                const r = {};
                setTimeout(() => r.onsuccess && r.onsuccess(), 0);
                return r;
              },
            }),
          };
        },
        close() {},
      };
      req.result = db;
      setTimeout(() => {
        req.onupgradeneeded && req.onupgradeneeded();
        req.onsuccess && req.onsuccess();
      }, 0);
      return req;
    },
  };
}

test('boot installs the store from a folder; replaying a snapshot writes every workspace', async () => {
  const root = makeDir();
  root.queryPermission = async () => 'granted';
  const seed = {'twikki-fs-handle': {handles: new Map([['root', root]])}};
  globalThis.window = {showDirectoryPicker() {}, indexedDB: makeFakeIDB(seed)};

  // eslint-disable-next-line no-eval
  const fn = (1, eval)(BOOT_SRC);
  assert.equal(typeof fn, 'function');

  // Boot installs tw.storage on the (empty) folder — its only job.
  const fsTw = {tmp: {}, ui: {notify() {}}};
  await fn(fsTw);
  assert.ok(fsTw.storage, 'boot installed tw.storage');

  // connect() replays the captured snapshot through that store. Everything is
  // `/ws/`-prefixed: workspace data under /ws/<name>/, globals at the /ws/ root.
  const snapshot = {
    '/ws/workspaces': '["a","b","c"]', // global → its own root file
    '/ws/secrets': 'token: abc', // global → secrets.txt
    '/ws/a/tiddlers': JSON.stringify([{title: 'A1', type: 'markdown', package: 'pkg'}]),
    '/ws/b/tiddlers': JSON.stringify([{title: 'B1', type: 'markdown', package: 'pkg'}]),
    '/ws/c/tiddlers': JSON.stringify([{title: 'C1', type: 'markdown'}]),
    '/ws/c/tiddlers-visible': '["C1"]',
  };
  for (const k of Object.keys(snapshot)) fsTw.storage.setRaw(k, snapshot[k]);
  await fsTw.storage.flush();

  // Every workspace folder was created — the core regression.
  assert.ok(root._dirs.has('a'), 'workspace a folder created');
  assert.ok(root._dirs.has('b'), 'workspace b folder created');
  assert.ok(root._dirs.has('c'), 'workspace c folder created');
  // Globals are individual root files now (no _global.json blob); secrets migrate too.
  assert.ok(root._files.has('workspaces.txt'), 'global workspaces.txt written');
  assert.ok(root._files.has('secrets.txt'), 'global secrets.txt written');
  assert.ok(!root._files.has('_global.json'), 'no _global.json blob');
  assert.ok(root._dirs.get('a')._dirs.get('pkg')._files.has('A1.md'), 'A1.md in a/pkg');
  assert.ok(root._dirs.get('c')._files.has('_meta.json'), 'workspace c meta written');
  // _user fallback folder for the package-less tiddler in c.
  assert.ok(root._dirs.get('c')._dirs.get('_user')._files.has('C1.md'), 'C1.md in c/_user');
});

test('global key ↔ filename round-trips (.txt only for extensionless segments)', () => {
  for (const key of ['/ws/workspaces', '/ws/workspace', '/ws/settings.json', '/ws/secrets', '/ws/baseUrl', '/ws/settings.secretsMigrated']) {
    const file = H.globalFileName(H.globalSeg(key));
    assert.equal(H.globalKeyFromFile(file), key, `${key} round-trips via ${file}`);
  }
  assert.equal(H.globalFileName(H.globalSeg('/ws/workspaces')), 'workspaces.txt');
  assert.equal(H.globalFileName(H.globalSeg('/ws/settings.json')), 'settings.json');
  assert.equal(H.globalFileName(H.globalSeg('/ws/secrets')), 'secrets.txt');
  // Workspace-scoped keys (two+ segments) are NOT globals.
  assert.equal(H.globalSeg('/ws/default/tiddlers'), null);
});

// ---------------------------------------------------------------------------
// connect() force-saves before snapshotting. The regression: an edit sitting in
// tw.tiddlers but not yet persisted to tw.storage (e.g. Auto Save off, where the
// editor's formDone → autoSave is a no-op) must still reach the folder. connect()
// calls tw.run.save() (the ALWAYS-persist path) before dumpLiveStore(); drop that
// call and the migration captures the stale stored copy → old content on disk.
// This drives the REAL connect() (captured via the init() subscription) end-to-end
// against the in-memory dir + IDB stubs above, with tw.tiddlers ahead of the store.
// ---------------------------------------------------------------------------
test('connect() persists in-memory edits that lag the store (force-saves before snapshot)', async () => {
  const root = makeDir();
  root.queryPermission = async () => 'granted';

  // The live backend, seeded with the OLD persisted copy. tw.tiddlers holds the
  // NEW edit; save() is what copies tw.tiddlers → the store, mirroring saveAll().
  const store = new Map([['/ws/default/tiddlers', JSON.stringify([{title: 'Note', type: 'markdown', package: 'pkg', text: 'OLD'}])]]);
  const liveStorage = {
    getRaw: k => (store.has(k) ? store.get(k) : null),
    keys: prefix => [...store.keys()].filter(k => k.startsWith(prefix)),
    setRaw: (k, v) => store.set(k, v),
    flush: () => Promise.resolve(),
  };

  const notes = [];
  const handlers = {};
  const tw = {
    tmp: {},
    ui: {notify: (msg, sev) => notes.push({msg, sev})},
    events: {subscribe: (event, fn) => (handlers[event] = fn), send() {}},
    storage: liveStorage,
    tiddlers: {all: [{title: 'Note', type: 'markdown', package: 'pkg', text: 'NEW'}]},
    run: {
      save() { store.set('/ws/default/tiddlers', JSON.stringify(tw.tiddlers.all)); },
      getTiddlerTextRaw: () => BOOT_SRC,
    },
  };
  const ls = new Map();
  globalThis.tw = tw;
  globalThis.window = {
    showDirectoryPicker: async () => root,
    confirm: () => true, // connect() confirms before migrating
    indexedDB: makeFakeIDB({}),
    localStorage: {getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k)},
  };

  // eslint-disable-next-line no-eval
  const plugin = (1, eval)(CODE_SRC);
  plugin.init();
  assert.equal(typeof handlers['fsstorage.connect'], 'function', 'connect wired via init()');
  await handlers['fsstorage.connect']();

  assert.ok(!notes.some(n => n.sev === 'E'), `connect() should not error: ${JSON.stringify(notes)}`);
  const file = root._dirs.get('default')?._dirs.get('pkg')?._files.get('Note.md');
  assert.ok(file, 'Note.md written under default/pkg');
  assert.match(file.content, /\bNEW\b/, 'migration captured the in-memory edit');
  assert.doesNotMatch(file.content, /\bOLD\b/, 'stale stored copy was not migrated');
});

// Regression for "switching IDB→FS leaves the IndexedDB boot script": connect()
// must install the FS boot script even if a queryPermission re-check would say
// 'prompt' — it owns a freshly-granted handle and passes it to the boot script
// directly (opts.handle), so the install no longer hinges on re-querying.
test('connect() installs the FS boot script even when queryPermission is not granted', async () => {
  const root = makeDir();
  root.queryPermission = async () => 'prompt'; // would block the NORMAL boot path…
  root.requestPermission = async () => 'prompt';
  const store = new Map([['/ws/default/tiddlers', JSON.stringify([{title: 'N', type: 'markdown', package: 'pkg', text: 'x'}])]]);
  const liveStorage = {
    getRaw: k => (store.has(k) ? store.get(k) : null),
    keys: prefix => [...store.keys()].filter(k => k.startsWith(prefix)),
    setRaw: (k, v) => store.set(k, v),
    flush: () => Promise.resolve(),
  };
  const handlers = {};
  const notes = [];
  const tw = {
    tmp: {},
    ui: {notify: (m, s) => notes.push({m, s})},
    events: {subscribe: (e, fn) => (handlers[e] = fn), send() {}},
    storage: liveStorage,
    tiddlers: {all: []},
    run: {save() {}, getTiddlerTextRaw: () => BOOT_SRC},
  };
  const ls = new Map();
  globalThis.tw = tw;
  globalThis.window = {
    showDirectoryPicker: async () => root,
    confirm: () => true, // connect() confirms before migrating
    indexedDB: makeFakeIDB({}),
    localStorage: {getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k)},
  };

  // eslint-disable-next-line no-eval
  const plugin = (1, eval)(CODE_SRC);
  plugin.init();
  await handlers['fsstorage.connect']();

  assert.ok(!notes.some(n => n.s === 'E'), `connect() should not error: ${JSON.stringify(notes)}`);
  const boot = ls.get('/twikki.boot.js');
  assert.ok(boot && boot.includes('twikki-storage-backend: filesystem'), 'FS boot script installed despite queryPermission!=granted');
});

// connect() must confirm before migrating; declining writes nothing and does not switch backend.
test('connect() aborts without writing when the migration confirm is declined', async () => {
  const root = makeDir();
  root.queryPermission = async () => 'granted';
  const store = new Map([['/ws/default/tiddlers', JSON.stringify([{title: 'N', type: 'markdown', package: 'pkg', text: 'x'}])]]);
  const liveStorage = {
    getRaw: k => (store.has(k) ? store.get(k) : null),
    keys: prefix => [...store.keys()].filter(k => k.startsWith(prefix)),
    setRaw: (k, v) => store.set(k, v),
    flush: () => Promise.resolve(),
  };
  const handlers = {};
  const tw = {
    tmp: {},
    ui: {notify() {}},
    events: {subscribe: (e, fn) => (handlers[e] = fn), send() {}},
    storage: liveStorage,
    tiddlers: {all: []},
    run: {save() {}, getTiddlerTextRaw: () => BOOT_SRC},
  };
  const ls = new Map();
  globalThis.tw = tw;
  globalThis.window = {
    showDirectoryPicker: async () => root,
    confirm: () => false, // decline the migration
    indexedDB: makeFakeIDB({}),
    localStorage: {getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k)},
  };

  // eslint-disable-next-line no-eval
  const plugin = (1, eval)(CODE_SRC);
  plugin.init();
  await handlers['fsstorage.connect']();

  assert.equal(ls.get('/twikki.boot.js'), undefined, 'no boot script installed when declined');
  assert.ok(!root._dirs.has('default'), 'no files written to the folder when declined');
});

test('BootScript carries the ownership marker the code checks for', () => {
  // promptIfStale decides ownership by looking for this marker in the installed
  // boot script. If the marker drifts out of either file, ownership detection
  // silently breaks and the ping-pong loop returns.
  const marker = 'twikki-storage-backend: filesystem';
  assert.ok(BOOT_SRC.includes(marker), 'FileSystem BootScript must contain the ownership marker');
  assert.ok(CODE_SRC.includes(marker), 'FileSystemStorageCode must reference the same ownership marker');
});
