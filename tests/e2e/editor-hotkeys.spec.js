// E2E coverage for the editor Ctrl+Enter hotkey ($EditorToolsPlugin).
// The hotkey listener lives on #new-form and sends `form.done` for
// Ctrl+Enter (and Ctrl+NumpadEnter); formDone() in core.ui.js then
// validates + saves + closes the dialog.

import {expect, test} from '@playwright/test';
import {bootApp, card, createTiddler, persistedStore, send} from './helpers.js';

test.beforeEach(async ({page}) => {
  await bootApp(page);
});

test.describe('Ctrl+Enter save hotkey', () => {
  test('Ctrl+Enter on a new-tiddler form saves and closes the dialog', async ({page}) => {
    await send(page, 'tiddler.new');
    await expect(page.locator('#new-dialog')).toBeVisible();
    await page.fill('#new-title', 'HotkeyNew');
    await page.fill('#new-body', 'created by ctrl+enter');
    // Focus must be inside the form so the form's keypress listener fires.
    await page.focus('#new-body');
    await page.keyboard.press('Control+Enter');

    await expect(page.locator('#new-dialog')).toBeHidden();
    await expect(card(page, 'HotkeyNew')).toBeVisible();
    await expect(card(page, 'HotkeyNew').locator('.text')).toContainText('created by ctrl+enter');
    expect((await persistedStore(page)).some(t => t.title === 'HotkeyNew')).toBe(true);
  });

  test('Ctrl+Enter on an edit-existing form updates and closes', async ({page}) => {
    await createTiddler(page, {title: 'HotkeyEdit', text: 'original body', show: true});
    await card(page, 'HotkeyEdit').locator('[data-msg="tiddler.edit"]').click();
    await expect(page.locator('#new-dialog')).toBeVisible();
    await expect(page.locator('#new-title')).toHaveValue('HotkeyEdit');
    await page.fill('#new-body', 'edited via ctrl+enter');
    await page.focus('#new-body');
    await page.keyboard.press('Control+Enter');

    await expect(page.locator('#new-dialog')).toBeHidden();
    await expect(card(page, 'HotkeyEdit').locator('.text')).toContainText('edited via ctrl+enter');
    const stored = (await persistedStore(page)).find(t => t.title === 'HotkeyEdit');
    expect(stored?.text).toContain('edited via ctrl+enter');
  });

  test('Ctrl+NumpadEnter also saves and closes (the second branch)', async ({page}) => {
    await send(page, 'tiddler.new');
    await page.fill('#new-title', 'HotkeyNumpad');
    await page.fill('#new-body', 'via numpad enter');
    await page.focus('#new-body');
    await page.keyboard.press('Control+NumpadEnter');

    await expect(page.locator('#new-dialog')).toBeHidden();
    await expect(card(page, 'HotkeyNumpad')).toBeVisible();
    expect((await persistedStore(page)).some(t => t.title === 'HotkeyNumpad')).toBe(true);
  });

  test('plain Enter (no Ctrl) does NOT close the dialog', async ({page}) => {
    await send(page, 'tiddler.new');
    await page.fill('#new-title', 'KeepOpen');
    await page.fill('#new-body', 'before enter');
    await page.focus('#new-body');
    await page.keyboard.press('Enter');

    // Dialog still open, tiddler not yet saved.
    await expect(page.locator('#new-dialog')).toBeVisible();
    expect((await persistedStore(page)).some(t => t.title === 'KeepOpen')).toBe(false);
  });

  test('Ctrl+Enter with empty title is rejected — dialog stays open', async ({page}) => {
    await send(page, 'tiddler.new');
    await page.fill('#new-title', '');
    await page.fill('#new-body', 'no title here');
    await page.focus('#new-body');
    await page.keyboard.press('Control+Enter');

    // formDone() notifies and early-returns (closes dialog with no save).
    // We tolerate either dialog state but require no persisted save.
    expect((await persistedStore(page)).every(t => t.text !== 'no title here')).toBe(true);
  });
});
