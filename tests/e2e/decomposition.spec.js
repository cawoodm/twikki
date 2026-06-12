// Guards for the platform decomposition (plans/platform-rework.md):
//  - every shipped plugin still loads/inits/starts cleanly against the new
//    module layout (a broken tw.call or missing tw.run entry shows up here),
//  - tw.call still resolves names that used to live in the platform closure,
//  - the no-plugin invariant: under ?safemode TWikki can still create, edit,
//    validate, save and navigate with ZERO plugins loaded.

import {expect, test} from '@playwright/test';
import {bootApp, card} from './helpers.js';

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
