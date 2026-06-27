(function () {
  const meta = {
    name: 'FileSystemStorage',
    version: '0.1.0',
    platform: '0.28.0',
    description: 'Routes tw.storage to a real on-disk folder (File System Access API), one file per tiddler grouped by package, via a pre-boot script at /twikki.boot.js.',
  };

  const BOOT_KEY = '/twikki.boot.js';
  const DISMISS_KEY = '/twikki.fs.update-dismissed-on'; // value: 'YYYY-MM-DD'
  const SECTION = 'FileSystemStoragePlugin::BootScript';
  const HANDLE_DB = 'twikki-fs-handle';
  const HANDLE_STORE = 'handles';
  const HANDLE_KEY = 'root';
  const DUMP_KEY = 'migration';

  /* ---- the tiny IndexedDB the boot script reads its handle + dump from ---- */
  function openHandleDb() {
    return new Promise((resolve, reject) => {
      const req = window.indexedDB.open(HANDLE_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(HANDLE_STORE)) req.result.createObjectStore(HANDLE_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('handle DB open failed'));
    });
  }
  function idbPut(key, value) {
    return openHandleDb().then(
      db =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(HANDLE_STORE, 'readwrite');
          tx.objectStore(HANDLE_STORE).put(value, key);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        }),
    );
  }
  function idbGet(key) {
    return openHandleDb().then(
      db =>
        new Promise((resolve, reject) => {
          const r = db.transaction(HANDLE_STORE, 'readonly').objectStore(HANDLE_STORE).get(key);
          r.onsuccess = () => {
            db.close();
            resolve(r.result === undefined ? null : r.result);
          };
          r.onerror = () => {
            db.close();
            reject(r.error);
          };
        }),
    );
  }

  // Snapshot the live store (whatever backend is active right now) as a flat
  // {key: rawValue} object the boot script will write into the folder on its
  // first run. Capturing from tw.storage — not raw localStorage — means a
  // switch from the IndexedDB backend carries that data across too.
  function dumpLiveStore() {
    const dump = {};
    for (const k of tw.storage.keys('/')) {
      if (k === BOOT_KEY || k.startsWith('/modules/')) continue;
      dump[k] = tw.storage.getRaw(k);
    }
    return dump;
  }

  function writeBootScript() {
    const src = tw.run.getTiddlerTextRaw(SECTION);
    if (!src) {
      tw.ui.notify('FileSystemStorage: BootScript section not found.', 'E');
      return false;
    }
    window.localStorage.setItem(BOOT_KEY, src);
    return true;
  }

  // Connect (user gesture): pick a folder, persist its handle + a one-shot dump
  // of the current store, install the boot script, reboot to activate.
  async function connect() {
    if (!('showDirectoryPicker' in window)) {
      tw.ui.notify('Your browser does not support the File System Access API.', 'E');
      return;
    }
    let handle;
    try {
      handle = await window.showDirectoryPicker({mode: 'readwrite', id: 'twikki-fs'});
    } catch {
      return; // user cancelled the picker
    }
    try {
      await idbPut(HANDLE_KEY, handle);
      await idbPut(DUMP_KEY, dumpLiveStore());
      if (!writeBootScript()) return;
      tw.ui.notify('Folder connected. Reloading to activate file storage…', 'I');
      tw.events.send('reboot.hard');
    } catch (e) {
      tw.ui.notify('Could not connect folder: ' + e.message, 'E');
    }
  }

  // Reconnect (user gesture): re-grant permission on the already-saved handle.
  // Needed on non-installed tabs where the grant didn't persist across sessions.
  async function reconnect() {
    let handle;
    try {
      handle = await idbGet(HANDLE_KEY);
    } catch {
      handle = null;
    }
    if (!handle) {
      tw.ui.notify('No folder saved yet — use "Connect folder" first.', 'W');
      return;
    }
    const perm = await handle.requestPermission({mode: 'readwrite'});
    if (perm === 'granted') {
      tw.ui.notify('Folder access granted. Reloading…', 'I');
      tw.events.send('reboot.hard');
    } else {
      tw.ui.notify('Folder access was not granted.', 'W');
    }
  }

  // Reload from folder: re-hydrate after editing files in an external editor
  // (browsers cannot watch a picked folder for changes).
  function reloadFromFolder() {
    tw.events.send('reboot.hard');
  }

  // Disconnect: remove the boot script and reboot back to the default backend.
  // The folder and its files are left untouched on disk.
  function disconnect() {
    window.localStorage.removeItem(BOOT_KEY);
    tw.ui.notify('File storage disconnected. Your folder files are kept on disk. Reloading…', 'I');
    tw.events.send('reboot.hard');
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  /* BEGIN shouldPrompt — extracted verbatim by test/unit/fs-storage.test.js.
     Keep PURE (no closure refs, no I/O); the test eval's it in isolation. */
  function shouldPrompt({installed, bundled, dismissedToday, sessionFlag}) {
    if (sessionFlag) return false; // already prompted in this page load
    if (!installed || !bundled) return false; // not installed / build broken
    if (installed === bundled) return false; // up to date
    if (dismissedToday) return false; // snoozed today
    return true;
  }
  /* END shouldPrompt */

  // If a folder is connected but the page booted on the fallback backend (no
  // persisted permission — typically a non-installed tab), offer a one-click
  // reconnect. Runs after first paint so a blocking dialog can't freeze boot.
  function offerReconnect() {
    if (!tw.tmp || !tw.tmp.fsNeedsReconnect || tw.tmp.fsReconnectOffered) return;
    if (!window.localStorage.getItem(BOOT_KEY)) return; // not actually using FS storage
    tw.tmp.fsReconnectOffered = true;
    if (window.confirm('Reconnect your storage folder to load and save your wiki?\n\nTip: install TWikki as an app to skip this prompt in future.')) reconnect();
  }

  function promptIfStale() {
    if (!window.localStorage.getItem(BOOT_KEY)) return; // only when FS storage is installed
    const installed = window.localStorage.getItem(BOOT_KEY);
    const bundled = tw.run.getTiddlerTextRaw(SECTION);
    const dismissedToday = window.localStorage.getItem(DISMISS_KEY) === todayKey();
    if (!shouldPrompt({installed, bundled, dismissedToday, sessionFlag: tw.tmp.fsBootPrompted})) return;
    tw.tmp.fsBootPrompted = true;
    if (window.confirm('File storage boot script has changed. Re-install and reload now?\n\nClick Cancel to skip — you will be asked again tomorrow.')) {
      if (writeBootScript()) tw.events.send('reboot.hard');
    } else {
      window.localStorage.setItem(DISMISS_KEY, todayKey());
    }
  }

  return {
    meta,
    init() {
      tw.events.subscribe('fsstorage.connect', connect, 'FileSystemStorage');
      tw.events.subscribe('fsstorage.reconnect', reconnect, 'FileSystemStorage');
      tw.events.subscribe('fsstorage.reload', reloadFromFolder, 'FileSystemStorage');
      tw.events.subscribe('fsstorage.disconnect', disconnect, 'FileSystemStorage');
      // Wait for first paint before any blocking confirm() (see IndexedDBStorage).
      tw.events.subscribe('ui.loaded', offerReconnect, 'FileSystemStorage');
      tw.events.subscribe('ui.loaded', promptIfStale, 'FileSystemStorage');
    },
  };
})();
