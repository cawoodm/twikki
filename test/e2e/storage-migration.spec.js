// Storage-backend round-trip: localStorage → IndexedDB → FileSystem → IndexedDB.
// Asserts that data created at EACH stage survives every later migration — in
// particular the return leg (FileSystem → IndexedDB), which used to drop the whole
// FileSystem session because install() didn't migrate the live store across.
//
// The File System Access API isn't available to Playwright, so we inject a fake:
//   - window.showDirectoryPicker() returns an in-memory FileSystemDirectoryHandle
//     whose files are stored under `__fakefs:` keys in localStorage, so the folder
//     SURVIVES the reboot.hard reload (the whole point of the round-trip).
//   - the `twikki-fs-handle` IndexedDB (which the methoded handle can't be cloned
//     into) is stubbed so connect()'s idbPut and the boot script's idbGet work; a
//     `__fakefs_connected` flag tracks whether a folder is "connected".
// Everything else (the real `twikki` IndexedDB, all app logic) runs for real.

import {test, expect} from '@playwright/test';
import {bootApp, acceptDialogs} from './helpers.js';

// Runs in page context on every navigation (incl. reboot.hard reloads).
function installFakeFs() {
  const FILE = '__fakefs:'; // file-content keys
  const CONN = '__fakefs_connected'; // "a folder is connected" flag
  const LS = window.localStorage;
  const norm = p => String(p).replace(/^\/+|\/+$/g, '');
  const fileKey = p => FILE + norm(p);

  function fileHandle(path) {
    const key = fileKey(path);
    return {
      kind: 'file',
      name: norm(path).split('/').pop(),
      async createWritable() {
        let buf = '';
        return {async write(c) { buf += typeof c === 'string' ? c : ''; }, async close() { LS.setItem(key, buf); }};
      },
      async getFile() { const content = LS.getItem(key) || ''; return {async text() { return content; }}; },
    };
  }
  function dirHandle(path) {
    path = norm(path);
    const prefix = path ? path + '/' : '';
    return {
      kind: 'directory',
      name: path.split('/').pop() || '',
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
      async getDirectoryHandle(name) { return dirHandle(prefix + name); },
      async getFileHandle(name, opts) {
        const key = fileKey(prefix + name);
        if (!(opts && opts.create) && LS.getItem(key) === null) throw new Error('NotFoundError: ' + name);
        if (opts && opts.create && LS.getItem(key) === null) LS.setItem(key, '');
        return fileHandle(prefix + name);
      },
      async removeEntry(name) {
        const base = norm(prefix + name);
        if (LS.getItem(fileKey(base)) !== null) LS.removeItem(fileKey(base));
        const dp = FILE + base + '/';
        for (let i = LS.length - 1; i >= 0; i--) { const k = LS.key(i); if (k && k.startsWith(dp)) LS.removeItem(k); }
      },
      async *entries() {
        const seen = new Set();
        const out = [];
        for (let i = 0; i < LS.length; i++) {
          const k = LS.key(i);
          if (!k || !k.startsWith(FILE)) continue;
          const rel = k.slice(FILE.length);
          if (prefix && !rel.startsWith(prefix)) continue;
          const tail = prefix ? rel.slice(prefix.length) : rel;
          if (!tail) continue;
          const slash = tail.indexOf('/');
          if (slash === -1) {
            if (seen.has('f:' + tail)) continue;
            seen.add('f:' + tail);
            out.push([tail, fileHandle(prefix + tail)]);
          } else {
            const child = tail.slice(0, slash);
            if (seen.has('d:' + child)) continue;
            seen.add('d:' + child);
            out.push([child, dirHandle(prefix + child)]);
          }
        }
        for (const e of out) yield e;
      },
    };
  }

  window.__twikkiFakeFsRoot = dirHandle('');
  window.showDirectoryPicker = async () => window.__twikkiFakeFsRoot;

  // Stub ONLY the twikki-fs-handle DB; delegate every other DB to the real engine.
  const proto = window.IDBFactory.prototype;
  const realOpen = proto.open;
  proto.open = function (name, version) {
    if (name !== 'twikki-fs-handle') return realOpen.call(this, name, version);
    const store = {
      get(key) {
        const r = {};
        setTimeout(() => { r.result = key === 'root' && LS.getItem(CONN) ? window.__twikkiFakeFsRoot : undefined; r.onsuccess && r.onsuccess(); }, 0);
        return r;
      },
      put(val, key) { if (key === 'root') LS.setItem(CONN, '1'); const r = {}; setTimeout(() => r.onsuccess && r.onsuccess(), 0); return r; },
      delete(key) { if (key === 'root') LS.removeItem(CONN); const r = {}; setTimeout(() => r.onsuccess && r.onsuccess(), 0); return r; },
    };
    const db = {
      objectStoreNames: {contains: () => true},
      createObjectStore: () => store,
      transaction: () => { const tx = {objectStore: () => store, oncomplete: null, onerror: null}; setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); return tx; },
      close() {},
    };
    const req = {};
    setTimeout(() => { req.result = db; req.onupgradeneeded && req.onupgradeneeded(); req.onsuccess && req.onsuccess(); }, 0);
    return req;
  };
}

// Wait for a fully-booted app and that we are NOT mid-migration. After a
// reboot.hard the window is replaced, so the __migrating flag clears itself.
async function waitBooted(page) {
  await page.waitForFunction(
    () => !window.__migrating && !!(window.tw && tw.tiddlers?.all?.length && tw.run &&
          tw.templates?.TiddlerDisplay && document.querySelector('#visible-tiddlers')),
    null,
    {timeout: 30000},
  );
}

// Fire a backend-switch event; it migrates then reboot.hard-reloads. The flag is
// set on the soon-to-be-replaced window so waitBooted blocks until the reload.
async function switchBackend(page, event) {
  await page.evaluate(ev => { window.__migrating = true; tw.events.send(ev); }, event);
  await waitBooted(page);
}

async function setText(page, title, text) {
  await page.evaluate(({title, text}) => {
    tw.run.addTiddlerHard({title, text, type: 'markdown', tags: [], created: new Date(), updated: new Date()});
    tw.run.save();
  }, {title, text});
}
const getText = (page, title) => page.evaluate(t => tw.run.getTiddlerTextRaw(t), title);
const activeBackend = page => page.evaluate(() => {
  const b = window.localStorage.getItem('/twikki.boot.js');
  return !b ? 'localStorage' : b.includes('filesystem') ? 'fs' : b.includes('indexeddb') ? 'idb' : 'other';
});

test('localStorage → IndexedDB → FileSystem → IndexedDB preserves all data', async ({page}) => {
  acceptDialogs(page);
  await page.addInitScript(installFakeFs);
  await bootApp(page);
  expect(await activeBackend(page)).toBe('localStorage');

  // Stage 1 — localStorage: create NoteA.
  await setText(page, 'NoteA', 'a-localstorage');

  // Stage 2 — → IndexedDB. NoteA must survive; then add NoteB and pick a theme.
  await switchBackend(page, 'idbstorage.install');
  expect(await activeBackend(page)).toBe('idb');
  expect(await getText(page, 'NoteA')).toBe('a-localstorage');
  await setText(page, 'NoteB', 'b-idb');
  await page.evaluate(() => {
    const th = tw.run.getTiddler('$Theme');
    th.text = '[[$CoreThemeDark]]';
    delete th.doNotSave;
    tw.run.updateTiddlerHard('$Theme', th);
    tw.run.save();
  });

  // Stage 3 — → FileSystem. A/B and the theme must survive; then add NoteC.
  await switchBackend(page, 'fsstorage.connect');
  expect(await activeBackend(page)).toBe('fs');
  expect(await getText(page, 'NoteA')).toBe('a-localstorage');
  expect(await getText(page, 'NoteB')).toBe('b-idb');
  expect(await getText(page, '$Theme')).toContain('$CoreThemeDark');
  await setText(page, 'NoteC', 'c-filesystem');

  // Stage 4 — → back to IndexedDB. EVERY stage's data must be present — this is the
  // return leg that previously lost the whole FileSystem session.
  await switchBackend(page, 'idbstorage.install');
  expect(await activeBackend(page)).toBe('idb');
  expect(await getText(page, 'NoteA')).toBe('a-localstorage');
  expect(await getText(page, 'NoteB')).toBe('b-idb');
  expect(await getText(page, 'NoteC')).toBe('c-filesystem');
  expect(await getText(page, '$Theme')).toContain('$CoreThemeDark');
});
