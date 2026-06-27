// Layered settings (plans/SETTINGS.md): user (/settings.json) → workspace
// ($Settings) → registered default, plus ${secret:} expansion. Exercises the
// real engine in a booted app; each test gets a fresh context (empty storage).

import {expect, test} from '@playwright/test';
import {bootApp} from './helpers.js';

test('user layer overrides workspace overrides registered default', async ({page}) => {
  await bootApp(page);
  const r = await page.evaluate(() => {
    const s = tw.core.settings;
    const out = {def: s.get('layout.mode')}; // registry default (TabsPlugin)
    s.set('layout.mode', 'tabs', 'workspace');
    out.ws = s.get('layout.mode');
    s.set('layout.mode', 'river', 'user');
    out.user = s.get('layout.mode');
    out.placement = s.placement('layout.mode');
    out.userStore = tw.store.global.get('/settings.json');
    return out;
  });
  expect(r.def).toBe('river');
  expect(r.ws).toBe('tabs');
  expect(r.user).toBe('river'); // user layer wins
  expect(r.placement).toBe('user');
  expect(r.userStore?.layout?.mode).toBe('river');
});

test('owners populate the registry; ${secret:} references resolve', async ({page}) => {
  await bootApp(page);
  const r = await page.evaluate(() => {
    const s = tw.core.settings;
    s.writeSecret('e2eTok', 'sek');
    s.set('synch.Gist.accessToken', '${secret:e2eTok}', 'workspace');
    return {
      resolved: s.get('synch.Gist.accessToken'),
      registryKeys: Object.keys(s.registry),
    };
  });
  expect(r.resolved).toBe('sek');
  // defaults declared by core modules / base plugins
  expect(r.registryKeys).toEqual(
    expect.arrayContaining(['data.autoSave', 'layout.mode', 'search.excludeTags', 'backup.backupInSeconds', 'urls.baseUrl']),
  );
});

test('Settings dialog renders fields from the registry with user/workspace toggles', async ({page}) => {
  await bootApp(page);
  const r = await page.evaluate(() => {
    tw.run.showTiddler('$Settings');
    const el = tw.run.getTiddlerElement('$Settings');
    return {
      fieldCount: el.querySelectorAll('.settings-field').length,
      toggleCount: el.querySelectorAll('.settings-scope-toggle').length,
      hasAutoSaveHelp: !![...el.querySelectorAll('.settings-field-help')].find(h => /Automatically save/.test(h.textContent)),
    };
  });
  expect(r.fieldCount).toBeGreaterThan(5);
  expect(r.toggleCount).toBe(r.fieldCount); // every field has a layer toggle
  expect(r.hasAutoSaveHelp).toBe(true); // description sourced from the registry
});
