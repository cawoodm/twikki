// E2E coverage for every event wired in wireUpEvents() (src/platform/twikki.platform.js).
// Drives the real app through the UI where a control exists (this is what catches
// regressions like the close-button $currentTiddler bug), and via tw.events.send /
// tw.run for internal or programmatic-only events.

import {test, expect} from '@playwright/test';
import {
  bootApp, acceptDialogs, createTiddler, send,
  card, persistedStore, persistedTrash, visibleTitles,
} from './helpers.js';

test.beforeEach(async ({page}) => {
  await bootApp(page);
});

test.describe('show / close / open-all / close-all', () => {
  test('tiddler.show opens a card and tracks it in visible', async ({page}) => {
    await createTiddler(page, {title: 'ShowMe', text: 'hello'});
    await send(page, 'tiddler.show', 'ShowMe');
    await expect(card(page, 'ShowMe')).toBeVisible();
    expect(await visibleTitles(page)).toContain('ShowMe');
  });

  test('tiddler.close (✕ button) closes the card — the regression', async ({page}) => {
    await createTiddler(page, {title: 'CloseMe', text: 'bye', show: true});
    await expect(card(page, 'CloseMe')).toBeVisible();
    await card(page, 'CloseMe').locator('[data-msg="tiddler.close"]').click();
    await expect(card(page, 'CloseMe')).toHaveCount(0);
    expect(await visibleTitles(page)).not.toContain('CloseMe');
  });

  test('tiddler.close works for a title containing spaces (guards bare-string array split)', async ({page}) => {
    await createTiddler(page, {title: 'Spaced Title Note', text: 'x', show: true});
    await expect(card(page, 'Spaced Title Note')).toBeVisible();
    await card(page, 'Spaced Title Note').locator('[data-msg="tiddler.close"]').click();
    await expect(card(page, 'Spaced Title Note')).toHaveCount(0);
    expect(await visibleTitles(page)).not.toContain('Spaced Title Note');
  });

  test('ui.open.all opens cards, ui.close.all clears them', async ({page}) => {
    await createTiddler(page, {title: 'OpenA', text: 'a'});
    await createTiddler(page, {title: 'OpenB', text: 'b'});
    await send(page, 'ui.open.all', {tag: '', title: ''});
    await expect(page.locator('#visible-tiddlers .tiddler')).not.toHaveCount(0);
    await send(page, 'ui.close.all', {tag: '*', title: '*'});
    await expect(page.locator('#visible-tiddlers .tiddler')).toHaveCount(0);
    expect(await visibleTitles(page)).toHaveLength(0);
  });
});

test.describe('new / edit / form.done / form.cancel / section.edit', () => {
  test('tiddler.new + form.done creates and shows a tiddler', async ({page}) => {
    await send(page, 'tiddler.new');
    await expect(page.locator('#new-dialog')).toBeVisible();
    await page.fill('#new-title', 'BrandNew');
    await page.fill('#new-body', 'fresh body');
    await page.fill('#new-type', 'markdown');
    await page.locator('[data-msg="form.done"]').click();
    await expect(page.locator('#new-dialog')).toBeHidden();
    await expect(card(page, 'BrandNew')).toBeVisible();
    expect((await persistedStore(page)).some(t => t.title === 'BrandNew')).toBe(true);
  });

  test('tiddler.edit (edit button) + form.done updates the tiddler', async ({page}) => {
    await createTiddler(page, {title: 'EditMe', text: 'original', show: true});
    await card(page, 'EditMe').locator('[data-msg="tiddler.edit"]').click();
    await expect(page.locator('#new-dialog')).toBeVisible();
    await expect(page.locator('#new-title')).toHaveValue('EditMe');
    await page.fill('#new-body', 'edited text');
    await page.locator('[data-msg="form.done"]').click();
    await expect(page.locator('#new-dialog')).toBeHidden();
    await expect(card(page, 'EditMe').locator('.text')).toContainText('edited text');
    const stored = (await persistedStore(page)).find(t => t.title === 'EditMe');
    expect(stored?.text).toContain('edited text');
  });

  test('form.cancel closes the dialog without saving', async ({page}) => {
    await createTiddler(page, {title: 'KeepMe', text: 'untouched', show: true});
    await card(page, 'KeepMe').locator('[data-msg="tiddler.edit"]').click();
    await expect(page.locator('#new-dialog')).toBeVisible();
    await page.fill('#new-body', 'should not persist');
    await page.locator('[data-msg="form.cancel"]').click();
    await expect(page.locator('#new-dialog')).toBeHidden();
    const stored = (await persistedStore(page)).find(t => t.title === 'KeepMe');
    // Either unchanged in store, or never persisted the edit.
    expect(stored?.text ?? 'untouched').not.toContain('should not persist');
  });

  test('section.edit opens the parent tiddler in the edit form', async ({page}) => {
    await createTiddler(page, {title: 'SecParent', text: '::Intro\nhello'});
    await send(page, 'section.edit', 'SecParent::Intro');
    await expect(page.locator('#new-dialog')).toBeVisible();
    await expect(page.locator('#new-title')).toHaveValue('SecParent');
  });
});

test.describe('delete / trash', () => {
  test('tiddler.delete (delete button) removes from store and moves to trash', async ({page}) => {
    acceptDialogs(page); // delete() asks confirm()
    await createTiddler(page, {title: 'DeleteMe', text: 'goodbye', show: true});
    await card(page, 'DeleteMe').locator('[data-msg="tiddler.delete"]').click();
    await expect(card(page, 'DeleteMe')).toHaveCount(0);
    const all = await page.evaluate(() => tw.tiddlers.all.map(t => t.title));
    expect(all).not.toContain('DeleteMe');
    expect((await persistedTrash(page)).some(t => t.title === 'DeleteMe')).toBe(true);
  });
});

test.describe('preview', () => {
  test('tiddler.preview opens the modal, tiddler.preview.close closes it', async ({page}) => {
    await createTiddler(page, {title: 'PreviewMe', text: 'peek'});
    await page.evaluate(() => tw.run.previewTiddler('PreviewMe'));
    await expect(page.locator('#preview-dialog')).toBeVisible();
    await send(page, 'tiddler.preview.close');
    await expect(page.locator('#preview-dialog')).toBeHidden();
  });
});

test.describe('save', () => {
  test('save.all persists store changes to localStorage', async ({page}) => {
    await createTiddler(page, {title: 'SaveMe', text: 'persist me'});
    await send(page, 'save.all');
    expect((await persistedStore(page)).some(t => t.title === 'SaveMe')).toBe(true);
  });

  test('save persists', async ({page}) => {
    await createTiddler(page, {title: 'SaveMe2', text: 'persist me too'});
    await send(page, 'save');
    expect((await persistedStore(page)).some(t => t.title === 'SaveMe2')).toBe(true);
  });

  test('save.silent persists without showing a toast', async ({page}) => {
    await createTiddler(page, {title: 'SilentSave', text: 'quiet'});
    await send(page, 'save.silent');
    expect((await persistedStore(page)).some(t => t.title === 'SilentSave')).toBe(true);
    await expect(page.locator('#notify')).toHaveClass(/notifyHidden/);
  });
});

test.describe('reload / reboot', () => {
  test('ui.reload is a soft reload (no page navigation)', async ({page}) => {
    await page.evaluate(() => {window.__sentinel = 'soft';});
    await send(page, 'ui.reload');
    expect(await page.evaluate(() => window.__sentinel)).toBe('soft');
    expect(await page.evaluate(() => !!(window.tw && tw.tiddlers))).toBe(true);
  });

  test('reboot.hard triggers a full page reload', async ({page}) => {
    await page.evaluate(() => {window.__sentinel = 'hard';});
    await page.evaluate(() => tw.events.send('reboot.hard')).catch(() => {});
    await page.waitForFunction(
      () => !!(window.tw && tw.tiddlers && tw.tiddlers.all.length) && window.__sentinel === undefined,
      null, {timeout: 30000},
    );
    expect(await page.evaluate(() => window.__sentinel)).toBeUndefined();
  });
});

test.describe('refresh / content / text / created / updated', () => {
  test('tiddler.refresh re-renders the card from the store', async ({page}) => {
    await createTiddler(page, {title: 'RefreshMe', text: 'old body', show: true});
    await expect(card(page, 'RefreshMe').locator('.text')).toContainText('old body');
    await page.evaluate(() => tw.run.updateTiddlerHard('RefreshMe', {title: 'RefreshMe', text: 'new body', type: 'markdown', tags: []}));
    await send(page, 'tiddler.refresh', 'RefreshMe');
    await expect(card(page, 'RefreshMe').locator('.text')).toContainText('new body');
  });

  test('tiddler.content returns rendered HTML', async ({page}) => {
    await createTiddler(page, {title: 'ContentMe', text: 'hello content'});
    const [html] = await send(page, 'tiddler.content', 'ContentMe');
    expect(typeof html).toBe('string');
    expect(html).toContain('hello content');
  });

  test('tiddler.text returns raw text', async ({page}) => {
    await createTiddler(page, {title: 'TextMe', text: 'raw markdown *here*'});
    const [text] = await send(page, 'tiddler.text', 'TextMe');
    expect(text).toBe('raw markdown *here*');
  });

  test('tiddler.created shows the new tiddler', async ({page}) => {
    await createTiddler(page, {title: 'CreatedMe', text: 'born'});
    await send(page, 'tiddler.created', 'CreatedMe');
    await expect(card(page, 'CreatedMe')).toBeVisible();
  });

  test('tiddler.updated refreshes a site-title inclusion', async ({page}) => {
    await page.evaluate(() => tw.run.updateTiddlerHard('$SiteTitle', {title: '$SiteTitle', text: 'E2E_SITE_MARKER', type: 'markdown', tags: ['$Shadow']}));
    await send(page, 'tiddler.updated', '$SiteTitle');
    await expect(page.locator('#site-title')).toContainText('E2E_SITE_MARKER');
  });
});

test.describe('store.load', () => {
  test('store.load repopulates tw.tiddlers.all from persisted store', async ({page}) => {
    await send(page, 'save.all'); // ensure store reflects current tiddlers
    await page.evaluate(() => {
      const cur = tw.store.get('tiddlers') || [];
      tw.store.set('tiddlers', [...cur, {title: 'StoreLoadProbe', text: 'seeded', type: 'markdown', tags: [], created: new Date(), updated: new Date()}]);
      tw.tiddlers.all = []; // prove the load repopulates
    });
    await send(page, 'store.load');
    const titles = await page.evaluate(() => tw.tiddlers.all.map(t => t.title));
    expect(titles).toContain('StoreLoadProbe');
  });
});

test.describe('package load', () => {
  const PKG = {tiddlers: [{title: 'PkgProbe', text: 'from package', type: 'markdown', tags: []}]};

  test('package.load.url imports tiddlers from a URL', async ({page}) => {
    await page.route('**/fake-package.json', route =>
      route.fulfill({contentType: 'application/json', body: JSON.stringify(PKG)}));
    await page.evaluate(async () => {
      await Promise.all(tw.events.send('package.load.url', {url: '/fake-package.json', name: 'fakepkg'}));
    });
    const t = await page.evaluate(() => {
      const x = tw.run.getTiddler('PkgProbe');
      return x ? {title: x.title, pkg: x.package} : null;
    });
    expect(t?.title).toBe('PkgProbe');
    expect(t?.pkg).toBe('fakepkg');
  });

  test('package.reload.url imports then reloads the UI', async ({page}) => {
    acceptDialogs(page); // overwrite confirms, if any
    const pkg2 = {tiddlers: [{title: 'PkgProbe2', text: 'reloaded', type: 'markdown', tags: []}]};
    await page.route('**/fake-package2.json', route =>
      route.fulfill({contentType: 'application/json', body: JSON.stringify(pkg2)}));
    await page.evaluate(async () => {
      await Promise.all(tw.events.send('package.reload.url', {url: '/fake-package2.json', name: 'fakepkg2'}));
    });
    await page.waitForFunction(() => !!tw.run.getTiddler('PkgProbe2'), null, {timeout: 30000});
    expect(await page.evaluate(() => tw.run.getTiddler('PkgProbe2')?.package)).toBe('fakepkg2');
  });
});
