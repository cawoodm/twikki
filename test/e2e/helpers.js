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
  // Capture browser-side diagnostics so a CI timeout dumps why boot stalled.
  // Passing runs are unaffected: the dump only fires inside the catch.
  const lines = [];
  page.on('console', m => lines.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => lines.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
  page.on('requestfailed', r =>
    lines.push(`[requestfailed] ${r.method()} ${r.url()} — ${r.failure()?.errorText}`));
  await page.goto('/?trace');
  // Wait for the *full* boot: templates are loaded near the end of reload()
  // (after the store/plugins), and rendering any card needs them — so gate on
  // tw.templates, not just tw.tiddlers, to avoid racing ahead of loadTemplates().
  try {
    await page.waitForFunction(
      () => !!(window.tw && tw.tiddlers?.all?.length && tw.run &&
               tw.templates?.TiddlerDisplay && tw.templates?.TiddlerPreview &&
               document.querySelector('#visible-tiddlers')),
      null,
      {timeout: 30000},
    );
  } catch (e) {
    const snapshot = await page.evaluate(() => ({
      twExists: !!window.tw,
      bootAborted: tw?.tmp?.bootAborted,
      moduleCount: tw?.modules?.length,
      moduleCompat: tw?.modules?.map(m => `${m.name}:${m.compat?.severity || 'ok'}`),
      tiddlerCount: tw?.tiddlers?.all?.length,
      visibleCount: tw?.tiddlers?.visible?.length,
      rebootCount: tw?.tmp?.rebootCount,
      templates: Object.keys(tw?.templates || {}),
      coreUiKeys: Object.keys(tw?.core?.ui || {}),
      coreRenderKeys: Object.keys(tw?.core?.render || {}),
      plugins: (tw?.plugins || []).map(
        p => `${p.meta?.name || p.source}${p.error ? '!' + p.error.phase + ':' + p.error.message : ''}`,
      ),
      bodyChildren: document.body?.childElementCount,
      hasVisibleContainer: !!document.querySelector('#visible-tiddlers'),
    })).catch(err => ({snapshotError: err.message}));
    // eslint-disable-next-line no-console
    console.error(
      'bootApp timed out — captured browser output:\n' +
      lines.join('\n') +
      '\n--- state snapshot ---\n' +
      JSON.stringify(snapshot, null, 2),
    );
    throw e;
  }
}

/**
 * Pre-seed tiddlers into the persisted workspace store BEFORE the app boots, so
 * loadStore() loads them into tw.tiddlers.all and (for $Plugin-tagged ones)
 * loadPlugins() picks them up. Store tiddlers land ahead of base-package
 * plugins in load order, which is what the ordering tests rely on. Call before
 * bootApp(page). `created`/`updated` default to now. Replaces the old
 * boot-progress 'modules-run' injection hook.
 */
export async function seedTiddlers(page, tiddlers) {
  await page.addInitScript(seed => {
    const k = '/ws/default/tiddlers';
    const now = new Date().toISOString();
    const store = JSON.parse(localStorage.getItem(k) || '[]');
    store.push(...seed.map(t => ({created: now, updated: now, ...t})));
    localStorage.setItem(k, JSON.stringify(store));
  }, tiddlers);
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
