// Guards for the platform decomposition (plans/platform-rework.md):
//  - every shipped plugin still loads/inits/starts cleanly against the new
//    module layout (a broken tw.call or missing tw.run entry shows up here),
//  - tw.call still resolves names that used to live in the platform closure,
//  - the no-plugin invariant: under ?safemode TWikki can still create, edit,
//    validate, save and navigate with ZERO plugins loaded.

import {expect, test} from '@playwright/test';
import {bootApp, card} from './helpers.js';

test('metaInfo lives in TiddlerMetaInfo plugin: normal boot shows pck: pill', async ({page}) => {
  await bootApp(page);
  const plugin = await page.evaluate(() => tw.plugin('TiddlerMetaInfo'));
  expect(plugin).toBeTruthy();
  expect(plugin.meta.dependencies).toEqual(['Picker']);
  expect(plugin.missingDependencies).toBeUndefined(); // Picker is loaded in normal boot
  // Show any tiddler that has a .package field (set by core.packaging on import).
  const title = await page.evaluate(() => {
    const t = tw.tiddlers.all.find(x => x.package);
    if (!t) return null;
    tw.run.showTiddler(t.title);
    return t.title;
  });
  expect(title).toBeTruthy();
  // The metaInfo plugin renders a pck: pill button into the .meta region of the card.
  await expect(page.locator(`.tiddler[data-tiddler-title="${title}"] .meta .pck-pill`))
    .toContainText('pck:');
});

test('meta.dependencies: missing dep yields missingDependencies + console warn; plugin still runs', async ({page}) => {
  const warnings = [];
  page.on('console', msg => { if (msg.type() === 'warning') warnings.push(msg.text()); });
  await page.addInitScript(() => {
    // Inject a $Plugin tiddler that declares an impossible dep.
    window.addEventListener('twikki.boot.progress', e => {
      if (e.detail.phase === 'modules-ready') {
        tw.tiddlers.all.push({
          title: '$DepProbe', type: 'script/js', tags: ['$Plugin'],
          created: new Date(), updated: new Date(),
          package: 'test',
          text: `(function () {
            window.__depProbeInitRan = true;
            return {meta: {name: 'DepProbe', version: '1.0.0', dependencies: ['DoesNotExist']}, init() {}};
          })()`,
        });
      }
    });
  });
  await bootApp(page);
  const entry = await page.evaluate(() => {
    const p = tw.plugin('DepProbe');
    return p ? {missing: p.missingDependencies, ran: !!window.__depProbeInitRan, error: p.error} : null;
  });
  expect(entry).toBeTruthy();
  expect(entry.error).toBeNull();
  expect(entry.missing).toEqual(['DoesNotExist']);
  expect(entry.ran).toBe(true); // soft check: plugin still runs
  expect(warnings.some(w => w.includes('DepProbe') && w.includes('DoesNotExist'))).toBe(true);
});

test('all shipped plugins load, init and start without errors', async ({page}) => {
  await bootApp(page);
  const plugins = await page.evaluate(() =>
    tw.plugins.map(p => ({name: p.meta?.name || p.source, error: p.error})));
  expect(plugins.length).toBeGreaterThan(5);
  const broken = plugins.filter(p => p.error);
  expect(broken, JSON.stringify(broken)).toHaveLength(0);
});

test('tw.call resolves functions that moved out of the platform closure', async ({page}) => {
  await bootApp(page);
  const results = await page.evaluate(() => ({
    tiddlerExists: tw.call('tiddlerExists', '$MainLayout'),
    getTiddler: tw.call('getTiddler', '$MainLayout')?.title,
    renderTWikki: typeof tw.call('renderTWikki', {text: 'plain', title: 'x'}),
    getJSONObject: typeof tw.call('getJSONObject', '$GeneralSettings'),
  }));
  expect(results.tiddlerExists).toBe(true);
  expect(results.getTiddler).toBe('$MainLayout');
  expect(results.renderTWikki).toBe('string');
  expect(results.getJSONObject).toBe('object');
});

test('module eval failure: one error page, names the failing module(s)', async ({page}) => {
  // Serve core.dom.js with a syntax error → its eval throws, every downstream
  // module that touches tw.core.dom errors too. This is the exact path that
  // used to produce <h1>Module Errors Occurred</h1> twice (handleModuleErrors
  // returned undefined → caller's early return never fired → start() pushed
  // more errors and re-invoked it).
  await page.route('**/modules/core.dom.js', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/\(function\s*\(\s*tw\s*\)/, '(function(tw-)');
    await route.fulfill({response, body});
  });
  await page.goto('/?reload');
  await expect(page.locator('h1')).toHaveCount(1);
  const heading = await page.locator('h1').textContent();
  expect(heading).toMatch(/core\.dom/);
  // The per-module error paragraphs bold each name and include the JS message.
  await expect(page.locator('p.error').first()).toContainText('core.dom.js');
});

test('boot halts on an incompatible module and shows the (lazily-loaded) compat dialog', async ({page}) => {
  // Serve core.common.js claiming a different MAJOR platform → a hard 'block'.
  await page.route('**/modules/core.common.js', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/const platform = '[^']+'/, "const platform = '9.9.9'");
    await route.fulfill({response, body});
  });
  await page.goto('/?reload'); // force network so the tampered module is fetched
  await expect(page.locator('#tw-compat-dialog')).toBeVisible({timeout: 15000});
  await expect(page.locator('#tw-compat-dialog tbody tr').first()).toContainText('✗');
  expect(await page.evaluate(() => tw.tmp.bootAborted)).toBe(true);
  // The blocked row's checkbox can never be selected for install
  await expect(page.locator('#tw-compat-dialog .tw-compat-pick').first()).toBeDisabled();
});

test.describe('?safemode (the no-plugin invariant)', () => {
  test('boots with zero plugins and the full edit round-trip works', async ({page}) => {
    await page.goto('/?safemode&trace');
    await page.waitForFunction(
      () => !!(window.tw && tw.tiddlers?.all?.length && tw.run &&
               tw.templates?.TiddlerDisplay && document.querySelector('#visible-tiddlers')),
      null, {timeout: 30000},
    );
    expect(await page.evaluate(() => tw.plugins.length)).toBe(0);

    // create / edit / save via the form (core.ui + core.tiddlers + core.store only)
    await page.evaluate(() => tw.events.send('tiddler.new'));
    await expect(page.locator('#new-dialog')).toBeVisible();
    await page.fill('#new-title', 'SafemodeNote');
    await page.fill('#new-body', 'created with no plugins');
    await page.fill('#new-type', 'markdown');
    await page.locator('[data-msg="form.done"]').click();
    await expect(page.locator('#new-dialog')).toBeHidden();
    await expect(card(page, 'SafemodeNote')).toBeVisible();
    // markdown falls back to escaped plain text (no $BaseMarkdownPlugin) but MUST render
    await expect(card(page, 'SafemodeNote').locator('.text')).toContainText('created with no plugins');
    const stored = await page.evaluate(() =>
      (tw.store.get('tiddlers') || []).some(t => t.title === 'SafemodeNote'));
    expect(stored).toBe(true);

    // navigate (hash link) still works
    await page.evaluate(() => tw.core.ui.navigateTo('SafemodeNote'));
    await expect(card(page, 'SafemodeNote')).toBeVisible();

    // search still works
    const found = await page.evaluate(() =>
      tw.core.search.search('SafemodeNote', tw.tiddlers.all).map(t => t.title));
    expect(found).toContain('SafemodeNote');
  });
});
