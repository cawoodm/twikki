(function () {
  const meta = {
    name: 'IndexedDBStorage',
    version: '0.3.0',
    platform: '0.27.0',
    description: 'Routes tw.storage to IndexedDB via a pre-boot script at /twikki.boot.js.',
  };

  const BOOT_KEY = '/twikki.boot.js';
  const DISMISS_KEY = '/twikki.boot.update-dismissed-on'; // value: 'YYYY-MM-DD'
  const EVENT = 'idbstorage.install';
  // Ownership marker carried in our BootScript. `/twikki.boot.js` is a single
  // global slot shared with other storage backends (e.g. FileSystemStoragePlugin).
  // We only manage the slot when the installed script is *ours* — otherwise two
  // plugins would ping-pong, each re-installing its own script and rebooting on
  // every load. Must stay byte-identical to the marker in BootScript.js.
  const BOOT_MARKER = 'twikki-storage-backend: indexeddb';
  const ownsBoot = () => {
    const s = window.localStorage.getItem(BOOT_KEY);
    return !!s && s.includes(BOOT_MARKER);
  };

  // Snapshot the live store (whatever backend is active right now) as a flat
  // {key: rawValue} object. Everything persistent lives under `/ws/` (workspace
  // data AND the globals at the `/ws/` root), so that prefix captures the whole
  // wiki and nothing device-local (`/twikki.boot.js`, `/modules/*`).
  function dumpLiveStore() {
    const dump = {};
    for (const k of tw.storage.keys('/ws/')) dump[k] = tw.storage.getRaw(k);
    return dump;
  }

  // Install runs only when the user clicks the button in the plugin tiddler (or
  // fires the event via the command bus). It MIGRATES the current store into
  // IndexedDB before activating — standing the IndexedDB backend up against the
  // real DB and replaying every live key through it (mirrors FileSystem connect()).
  // This makes switching from ANY backend faithful: from the localStorage default
  // it copies the current data across; from FileSystem it carries the folder's data
  // back, instead of rebooting onto IndexedDB's stale pre-switch snapshot. The boot
  // script's own first-install copy is gated by a sentinel, so it can't re-clobber
  // the seeded data on the next load. Idempotent: a no-op when already current.
  async function install() {
    const src = tw.run.getTiddlerTextRaw('IndexedDBStoragePlugin::BootScript');
    if (!src) {
      tw.ui.notify('IndexedDBStorage: BootScript section not found.', 'E');
      return;
    }
    const installed = window.localStorage.getItem(BOOT_KEY);
    if (installed === src) {
      tw.ui.notify('IndexedDB storage already installed and up to date.', 'I');
      return;
    }
    try {
      // Flush the workspace we're viewing into the live store so the snapshot is
      // current (tiddler edits live in tw.tiddlers until a save persists them).
      tw.run.save?.();
      await tw.storage.flush?.();
      const snapshot = dumpLiveStore();

      tw.ui.notify('Migrating your wiki to IndexedDB…', 'I');
      // Stand up the IndexedDB backend WITHOUT disturbing the live tw.storage: eval
      // the boot script against a throwaway object so it assigns its store there,
      // then replay every key through it (writing into the real DB) and await the
      // writes. Reusing the backend means the on-disk format can't drift from what
      // the boot script reads back on the reload.
      const bootFn = (1, eval)(src);
      if (typeof bootFn !== 'function') throw new Error('BootScript section did not evaluate to a function');
      const idbTw = {tmp: {}, ui: tw.ui};
      await bootFn(idbTw);
      if (!idbTw.storage) throw new Error('Could not initialise IndexedDB storage');
      for (const k of Object.keys(snapshot)) idbTw.storage.setRaw(k, snapshot[k]);
      await idbTw.storage.flush();

      window.localStorage.setItem(BOOT_KEY, src);
      tw.ui.notify('Migration complete. Reloading to activate IndexedDB storage…', 'I');
      tw.events.send('reboot.hard');
    } catch (e) {
      tw.ui.notify('Could not install IndexedDB storage: ' + e.message, 'E');
    }
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  /* BEGIN shouldPrompt — extracted verbatim by test/unit/idb-storage.test.js.
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

  function promptIfStale() {
    const installed = window.localStorage.getItem(BOOT_KEY);
    const bundled = tw.run.getTiddlerTextRaw('IndexedDBStoragePlugin::BootScript');
    const dismissedToday = window.localStorage.getItem(DISMISS_KEY) === todayKey();
    if (!shouldPrompt({installed, bundled, dismissedToday, sessionFlag: tw.tmp.idbBootPrompted, owned: ownsBoot()})) return;
    tw.tmp.idbBootPrompted = true;

    const ok = window.confirm('IndexedDB boot script has changed. Re-install and reload now?\n\n' + 'Click Cancel to skip — you will be asked again tomorrow.');
    if (ok) {
      // install() migrates then reboots itself (via reboot.hard, which flushes
      // first) — don't send a second reboot here or it races the async migration.
      install();
    } else {
      window.localStorage.setItem(DISMISS_KEY, todayKey());
    }
  }

  return {
    meta,
    init() {
      tw.events.subscribe(EVENT, install, 'IndexedDBStorage');
      // Wait for first paint before prompting (a blocking confirm() during
      // plugin init would freeze boot mid-render). One prompt per page load.
      tw.events.subscribe('ui.loaded', promptIfStale, 'IndexedDBStorage');
    },
  };
})();
