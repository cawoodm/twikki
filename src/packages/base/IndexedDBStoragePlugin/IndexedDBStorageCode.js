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

  // Install runs only when the user clicks the button in the plugin tiddler
  // (or fires the event via the command bus). The plugin never mutates
  // localStorage on boot — installing a pre-boot script is a deliberate,
  // user-driven action.
  function install() {
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
    window.localStorage.setItem(BOOT_KEY, src);
    tw.ui.notify('IndexedDB storage installed. Reload to activate.', 'I');
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  /* BEGIN shouldPrompt — extracted verbatim by test/unit/idb-storage.test.js.
     Keep PURE (no closure refs, no I/O); the test eval's it in isolation. */
  function shouldPrompt({installed, bundled, dismissedToday, sessionFlag}) {
    if (sessionFlag) return false; // already prompted in this page load
    if (!installed || !bundled) return false; // not installed / build broken
    if (installed === bundled) return false; // up to date
    if (dismissedToday) return false; // snoozed today
    return true;
  }
  /* END shouldPrompt */

  function promptIfStale() {
    const installed = window.localStorage.getItem(BOOT_KEY);
    const bundled = tw.run.getTiddlerTextRaw('IndexedDBStoragePlugin::BootScript');
    const dismissedToday = window.localStorage.getItem(DISMISS_KEY) === todayKey();
    if (!shouldPrompt({installed, bundled, dismissedToday, sessionFlag: tw.tmp.idbBootPrompted})) return;
    tw.tmp.idbBootPrompted = true;

    const ok = window.confirm('IndexedDB boot script has changed. Re-install and reload now?\n\n' + 'Click Cancel to skip — you will be asked again tomorrow.');
    if (ok) {
      install();
      // Go through reboot.hard so the storage flush runs before the reload.
      tw.events.send('reboot.hard');
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
