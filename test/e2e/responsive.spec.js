import {devices, expect, test} from '@playwright/test';
import {bootApp, createTiddler} from './helpers.js';

const PHONE = {width: 390, height: 844}; // iPhone 12/13/14 logical size

test.describe('Phone (≤600px)', () => {
  test.use({viewport: PHONE});

  test('search results render as a full-width fixed overlay, not capped at the drawer width', async ({page}) => {
    await bootApp(page);
    await createTiddler(page, {title: 'OverlayProbe', text: 'find me overlay'});
    // Open the drawer so the search input is on-screen, then query.
    await page.evaluate(() => document.getElementById('sidebar').classList.add('open'));
    await page.fill('#search', 'OverlayProbe');
    await expect(page.locator('#search-results .tiddler-list').first()).toBeVisible();
    const r = await page.evaluate(() => {
      const el = document.getElementById('search-results');
      const cs = getComputedStyle(el);
      return {position: cs.position, width: el.getBoundingClientRect().width, vw: window.innerWidth};
    });
    expect(r.position).toBe('fixed');
    expect(r.width).toBeGreaterThan(r.vw - 2); // spans (essentially) the full viewport, > 280px
  });

  test('tab strip scrolls horizontally instead of hiding overflowing tabs', async ({page}) => {
    await bootApp(page);
    const overflowX = await page.evaluate(() => getComputedStyle(document.getElementById('tab-strip')).overflowX);
    expect(['auto', 'scroll']).toContain(overflowX);
  });

  test('drawer scrim appears when open and closes the drawer on tap', async ({page}) => {
    await bootApp(page);
    await page.evaluate(() => document.getElementById('sidebar').classList.add('open'));
    const scrim = page.locator('#sidebar-scrim');
    await expect(scrim).toBeVisible();
    await scrim.click({position: {x: 350, y: 5}}); // tap the exposed strip (right of the ~280px drawer)
    await expect.poll(() =>
      page.evaluate(() => document.getElementById('sidebar').classList.contains('open')),
    ).toBe(false);
  });
});

test.describe('Tablet (601–1024px)', () => {
  test.use({viewport: {width: 800, height: 1024}});

  test('sidebar width scales between 220 and 300px (clamp), not a fixed 280', async ({page}) => {
    await bootApp(page);
    const w = await page.evaluate(() => document.getElementById('sidebar').getBoundingClientRect().width);
    // 24vw of 800 = 192 → clamped up to 220; must be < the old fixed 280.
    expect(w).toBeGreaterThanOrEqual(219);
    expect(w).toBeLessThan(280);
  });
});

test.describe('Touch device', () => {
  // spread Pixel 5 but omit defaultBrowserType (not allowed in describe scope)
  const {defaultBrowserType: _, ...pixel5} = devices['Pixel 5'];
  test.use({...pixel5}); // sets viewport, isMobile, hasTouch → (pointer:coarse)/(hover:none)

  test('inputs are ≥16px so iOS does not zoom on focus, and buttons meet ~44px', async ({page}) => {
    await bootApp(page);
    const m = await page.evaluate(() => {
      const fs = parseFloat(getComputedStyle(document.getElementById('search')).fontSize);
      const btn = document.querySelector('#main-topbar button, button.icon');
      const h = btn ? btn.getBoundingClientRect().height : 0;
      return {fs, h};
    });
    expect(m.fs).toBeGreaterThanOrEqual(16);
    expect(m.h).toBeGreaterThanOrEqual(44);
  });

  test('tab-close button is visible without hover on touch', async ({page}) => {
    await bootApp(page);
    // Switch to tabs mode (default layout is river; tabs mode is required for the strip).
    await page.evaluate(() => {
      const s = tw.run.getTiddler('$GeneralSettings');
      tw.run.updateTiddlerHard('$GeneralSettings', {...s, text: JSON.stringify({...JSON.parse(s.text), layout: {mode: 'tabs'}})});
      tw.events.send('tiddler.modified', '$GeneralSettings');
    });
    // Open two tiddlers so the tab strip renders closable tabs.
    await page.evaluate(() => {
      tw.run.addTiddlerHard({title: 'TabA', text: 'a', type: 'markdown', tags: [], created: new Date(), updated: new Date()});
      tw.run.addTiddlerHard({title: 'TabB', text: 'b', type: 'markdown', tags: [], created: new Date(), updated: new Date()});
      tw.run.showTiddler('TabA');
      tw.run.showTiddler('TabB');
    });
    // Target a non-active tab: the active tab's close is always shown via .tab.active rule;
    // the bug is that inactive tabs' close buttons are invisible without hover on touch.
    const close = page.locator('.tab:not(.active) .tab-close').first();
    await expect(close).toBeVisible();
    const opacity = await close.evaluate(el => parseFloat(getComputedStyle(el).opacity));
    expect(opacity).toBeGreaterThan(0);
  });
});
