// E2E for the <<plugins>> widget's enable/disable checkbox. Toggling adds/removes
// the $CodeDisabled tag via updateTiddlerSilent, which marks the store dirty (no
// auto-save) so the unsaved-changes indicator reflects it. After an explicit save
// it survives a full reload even though plugin tiddlers ship in force-loaded
// packages — core.packaging PRESERVED_TAGS carries $CodeDisabled over when
// loadList overwrites the existing tiddler.

import {expect, test} from '@playwright/test';
import {bootApp, card, createTiddler} from './helpers.js';

const hasTag = (page, title, tag) =>
  page.evaluate(([t, g]) => !!tw.run.getTiddler(t)?.tags?.includes(g), [title, tag]);
const isLoaded = (page, source) =>
  page.evaluate(s => tw.plugins.some(p => p.source === s), source);
const targetSource = page =>
  page.evaluate(() => (tw.plugins.find(p => p.source === 'CommandPalettePlugin') || tw.plugins[0]).source);

test.beforeEach(async ({page}) => {
  await bootApp(page);
});

test.describe('plugins widget enable/disable', () => {
  test('unchecking a plugin disables it and survives a forced reload', async ({page}) => {
    const target = await targetSource(page);
    expect(target).toBeTruthy();

    await createTiddler(page, {title: 'PluginsProbe', text: '<<plugins>>', type: 'x-twikki', show: true});

    const row = card(page, 'PluginsProbe').locator('tr', {hasText: target});
    const checkbox = row.locator('input.plugin-enabled');
    await expect(checkbox).toBeChecked();

    await checkbox.click();

    // ui.reload drops it from the registry; the tag is set and the store is dirty
    // (marked, not auto-saved).
    await page.waitForFunction(s => !tw.plugins.some(p => p.source === s), target, {timeout: 30000});
    expect(await hasTag(page, target, '$CodeDisabled')).toBe(true);
    expect(await page.evaluate(() => tw.ui.isDirty)).toBe(true);

    // Persist explicitly, then a full reload re-fetches base.json with force — the
    // tag is preserved (PRESERVED_TAGS), so the plugin stays disabled.
    await page.evaluate(() => tw.run.save());
    await bootApp(page);
    expect(await isLoaded(page, target)).toBe(false);
    expect(await hasTag(page, target, '$CodeDisabled')).toBe(true);
  });

  test('re-checking a disabled plugin enables it again', async ({page}) => {
    const target = await targetSource(page);
    // Start disabled: set the tag, save, reload.
    await page.evaluate(s => {
      const t = tw.run.getTiddler(s);
      t.tags.push('$CodeDisabled');
      tw.run.updateTiddlerHard(s, t);
      tw.run.save();
    }, target);
    await bootApp(page);
    expect(await isLoaded(page, target)).toBe(false);

    await createTiddler(page, {title: 'PluginsProbe', text: '<<plugins>>', type: 'x-twikki', show: true});
    const row = card(page, 'PluginsProbe').locator('tr', {hasText: target});
    const checkbox = row.locator('input.plugin-enabled');
    await expect(checkbox).not.toBeChecked();

    await checkbox.click();

    await page.waitForFunction(s => tw.plugins.some(p => p.source === s), target, {timeout: 30000});
    expect(await hasTag(page, target, '$CodeDisabled')).toBe(false);
    expect(await page.evaluate(() => tw.ui.isDirty)).toBe(true);
  });
});
