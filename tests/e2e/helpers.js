// Shared helpers for the platform e2e suite.
//
// Each Playwright test gets a fresh browser context, so localStorage starts
// empty and the app boots clean from the dev server (no ?clear needed).

const STORE_KEY = '/ws/default/tiddlers';
const TRASH_KEY = '/ws/default/tiddlers-trashed';

/**
 * Navigate to the app and wait until the platform has booted: `tw` is wired,
 * tiddlers are loaded, and the story container exists. `?trace` surfaces real
 * stack traces instead of the platform swallowing them.
 */
export async function bootApp(page) {
  await page.goto('/?trace');
  // Wait for the *full* boot: templates are loaded near the end of reload()
  // (after the store/plugins), and rendering any card needs them — so gate on
  // tw.templates, not just tw.tiddlers, to avoid racing ahead of loadTemplates().
  await page.waitForFunction(
    () => !!(window.tw && tw.tiddlers?.all?.length && tw.run &&
             tw.templates?.TiddlerDisplay && tw.templates?.TiddlerPreview &&
             document.querySelector('#visible-tiddlers')),
    null,
    {timeout: 30000},
  );
}

/** Auto-accept any confirm()/prompt() dialogs (Playwright otherwise dismisses them). */
export function acceptDialogs(page) {
  page.on('dialog', d => d.accept());
}

/**
 * Add a tiddler to the store (and optionally open it). Uses the same `tw.run`
 * API the platform exposes, so it exercises the real store.
 */
export async function createTiddler(page, {title, text = '', type = 'markdown', tags = [], show = false}) {
  await page.evaluate(({title, text, type, tags, show}) => {
    tw.run.addTiddlerHard({title, text, type, tags, created: new Date(), updated: new Date()});
    if (show) tw.run.showTiddler(title);
  }, {title, text, type, tags, show});
}

/** Send a platform event from the page and return the (JSON-serialisable) result array. */
export function send(page, event, payload) {
  return page.evaluate(({event, payload}) => {
    const r = tw.events.send(event, payload);
    // Results may be non-serialisable (DOM nodes); only return primitives/strings.
    return r.map(x => (typeof x === 'string' || typeof x === 'number' || x == null) ? x : true);
  }, {event, payload});
}

/** Locator for an open tiddler card by title. */
export function card(page, title) {
  return page.locator(`#visible-tiddlers .tiddler[data-tiddler-title="${title}"]`);
}

/** The persisted tiddler store (array) from localStorage. */
export function persistedStore(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), STORE_KEY);
}

/** The persisted trash (array) from localStorage. */
export function persistedTrash(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), TRASH_KEY);
}

/** In-memory visible titles. */
export function visibleTitles(page) {
  return page.evaluate(() => tw.tiddlers.visible.slice());
}
