(function () {
  const meta = {
    name: 'IndexedDBStorage',
    version: '0.1.0',
    platform: '0.27.0',
    description: 'Routes tw.storage to IndexedDB via a pre-boot script at /twikki.boot.js.',
  };

  const BOOT_KEY = '/twikki.boot.js';
  const EVENT = 'idbstorage.install';

  // Install runs only when the user clicks the button in the plugin tiddler
  // (or fires the event via the command bus). The plugin never mutates
  // localStorage on boot — installing a pre-boot script is a deliberate,
  // user-driven action.
  function install() {
    const src = tw.run.getTiddlerTextRaw('IndexedDBStorage::BootScript');
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

  return {
    meta,
    init() {
      tw.events.subscribe(EVENT, install, 'IndexedDBStorage');
    },
  };
})();
