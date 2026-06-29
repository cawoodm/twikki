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
  // Ownership marker carried in our BootScript. `/twikki.boot.js` is a single
  // global slot shared with other storage backends (e.g. IndexedDBStoragePlugin).
  // We only manage the slot when the installed script is *ours* — otherwise two
  // plugins would ping-pong, each re-installing its own script and rebooting on
  // every load. Must stay byte-identical to the marker in BootScript.js.
  const BOOT_MARKER = 'twikki-storage-backend: filesystem';
  const ownsBoot = () => {
    const s = window.localStorage.getItem(BOOT_KEY);
    return !!s && s.includes(BOOT_MARKER);
  };
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
  function idbDelete(key) {
    return openHandleDb().then(
      db =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(HANDLE_STORE, 'readwrite');
          tx.objectStore(HANDLE_STORE).delete(key);
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

  // Snapshot the live store (whatever backend is active right now) as a flat
  // {key: rawValue} object the boot script will write into the folder on its
  // first run. Capturing from tw.storage — not raw localStorage — means a
  // switch from the IndexedDB backend carries that data across too.
  function dumpLiveStore() {
    // Everything persistent now lives under `/ws/` (workspace data AND the
    // globals at the `/ws/` root), so enumerating that prefix captures the whole
    // wiki — including secrets — and nothing else. Device-local control keys
    // (`/twikki.boot.js`, the dismiss dates, `/modules/*`) aren't `/ws/`-prefixed
    // and are therefore excluded automatically.
    const dump = {};
    for (const k of tw.storage.keys('/ws/')) dump[k] = tw.storage.getRaw(k);
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

  // Connect (user gesture): pick a folder, migrate the ENTIRE current store into
  // it while the existing backend is still live, save the handle, then install
  // the boot script and reboot. Migrating up-front (rather than in the pre-boot
  // script after the reload) means boot never blocks on thousands of file
  // writes and the folder is never left half-migrated by the reload.
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
      // Flush the workspace we're viewing into the store so the snapshot is
      // current (its tiddlers live in tw.tiddlers until a save persists them).
      tw.run.save?.();
      await tw.storage.flush?.();
      const snapshot = dumpLiveStore(); // capture the current backend up-front

      // Stand up the File System backend against the chosen folder WITHOUT
      // disturbing the live tw.storage: eval the boot script against a throwaway
      // object so it assigns its store there. Passing the just-granted handle
      // (opts.handle) skips the IDB round-trip / permission re-query. This only
      // READS the folder (hydrates) — no writes yet — so we can inspect it and
      // confirm before migrating.
      const src = tw.run.getTiddlerTextRaw(SECTION);
      const bootFn = (1, eval)(src);
      if (typeof bootFn !== 'function') throw new Error('BootScript section did not evaluate to a function');
      const fsTw = {tmp: {}, ui: tw.ui};
      // The backend calls onProgress once per tiddler file it writes. We hand it a
      // stable delegate now and point it at the live progress bar after the user
      // confirms (so hydrate's own reads, and a declined connect, report nothing).
      let progressTick = null;
      await bootFn(fsTw, {handle, onProgress: () => progressTick && progressTick()});
      if (!fsTw.storage) throw new Error('Could not initialise file storage for the chosen folder (permission denied?)');

      // Confirm before writing any data into the folder (the migration). If the
      // folder already holds a wiki, make clear it will be overwritten.
      const folderHasWiki = fsTw.storage.keys('/ws/').length > 0;
      const ok = window.confirm(
        folderHasWiki
          ? 'This folder already contains a wiki. Connecting will OVERWRITE its contents with your current wiki. Continue?'
          : 'Copy your current wiki into this folder and switch to file storage?',
      );
      if (!ok) {
        tw.ui.notify('File storage connection cancelled — nothing was written.', 'I');
        return;
      }

      // Commit: replay every key through the FS backend (its writer explodes each
      // tiddler into a file) and drive a progress bar by tiddler count — the unit
      // the writer reports via onProgress. The bar stays put (no auto-hide) until
      // the reboot reload clears it.
      let total = 0;
      for (const k of Object.keys(snapshot)) {
        if (/^\/ws\/[^/]+\/tiddlers$/.test(k)) {
          try {
            total += JSON.parse(snapshot[k]).length;
          } catch {
            /* not an array */
          }
        }
      }
      total = total || 1;
      const startProgress = tw.ui.notifyProgress || (() => ({update() {}}));
      const prog = startProgress('Migrating your wiki to the folder…');
      let written = 0;
      progressTick = () => prog.update(++written / total, `Migrating your wiki to the folder… (${written}/${total})`);

      for (const k of Object.keys(snapshot)) fsTw.storage.setRaw(k, snapshot[k]);
      await fsTw.storage.flush();
      progressTick = null;
      await idbPut(HANDLE_KEY, handle); // persist the handle for future boots
      if (!writeBootScript()) return;
      prog.update(1, 'Migration complete — reloading…'); // leave the bar at 100%; reboot clears it
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
  // The folder and its files are left untouched on disk; the saved handle and any
  // leftover migration dump are dropped so no stale state lingers in IndexedDB.
  function disconnect() {
    window.localStorage.removeItem(BOOT_KEY);
    idbDelete(HANDLE_KEY).catch(() => {});
    idbDelete(DUMP_KEY).catch(() => {});
    tw.ui.notify('File storage disconnected. Your folder files are kept on disk. Reloading…', 'I');
    tw.events.send('reboot.hard');
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  /* BEGIN shouldPrompt — extracted verbatim by test/unit/fs-storage.test.js.
     Keep PURE (no closure refs, no I/O); the test eval's it in isolation. */
  function shouldPrompt({installed, bundled, dismissedToday, sessionFlag, owned}) {
    if (sessionFlag) return false; // already prompted in this page load
    if (!installed || !bundled) return false; // not installed / build broken
    if (!owned) return false; // the boot slot holds another backend's script — leave it alone
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
    if (!ownsBoot()) return; // our boot script isn't the one installed
    tw.tmp.fsReconnectOffered = true;
    // Non-blocking: re-granting folder access needs a user gesture, so point the
    // user at the Reconnect button instead of firing a modal on every load.
    tw.ui.notify('File storage: folder access needs re-granting — open FileSystemStoragePlugin and click “Reconnect”. (Install TWikki as an app to skip this.)', 'W');
  }

  function promptIfStale() {
    const installed = window.localStorage.getItem(BOOT_KEY);
    const bundled = tw.run.getTiddlerTextRaw(SECTION);
    const dismissedToday = window.localStorage.getItem(DISMISS_KEY) === todayKey();
    if (!shouldPrompt({installed, bundled, dismissedToday, sessionFlag: tw.tmp.fsBootPrompted, owned: ownsBoot()})) return;
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
