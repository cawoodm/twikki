import {devices, expect, test} from '@playwright/test';
import {bootApp, createTiddler, visibleTitles} from './helpers.js';

const PHONE = {width: 390, height: 844}; // iPhone 12/13/14 logical size

test.describe('Phone (≤600px)', () => {
  test.use({viewport: PHONE});

  test('top-bar search results drop directly below the input (not pinned to the viewport bottom)', async ({page}) => {
    await bootApp(page);
    await createTiddler(page, {title: 'OverlayProbe', text: 'find me overlay'});
    // Tap 🔍 to reveal the relocated single search box, then query.
    await page.locator('#topbar-search-toggle').click();
    await page.locator('#search').pressSequentially('OverlayProbe'); // keyup fires the search
    await expect(page.locator('#search-results .tiddler-list').first()).toBeVisible();
    const r = await page.evaluate(() => {
      const input = document.getElementById('search').getBoundingClientRect();
      const res = document.getElementById('search-results').getBoundingClientRect();
      return {gap: res.top - input.bottom, width: res.width, vw: window.innerWidth};
    });
    // Just under the input (not flung to the bottom) AND full-width (not capped
    // at the ~220px drawer, which was unreadable).
    expect(r.gap).toBeGreaterThanOrEqual(0);
    expect(r.gap).toBeLessThan(20);
    expect(r.width).toBeGreaterThan(r.vw - 2);
  });

  test('tab strip scrolls horizontally instead of hiding overflowing tabs', async ({page}) => {
    await bootApp(page);
    const overflowX = await page.evaluate(() => getComputedStyle(document.getElementById('tab-strip')).overflowX);
    expect(['auto', 'scroll']).toContain(overflowX);
  });

  test('long URLs wrap instead of forcing horizontal page scroll', async ({page}) => {
    await bootApp(page);
    await page.evaluate(() => {
      const url = 'https://example.com/' + 'x'.repeat(400);
      tw.run.addTiddlerHard({title: 'LongUrl', text: url, type: 'markdown', tags: [], created: new Date(), updated: new Date()});
      tw.run.showTiddler('LongUrl');
    });
    const wrap = await page.evaluate(() => {
      const el = document.querySelector('.tiddler[data-tiddler-title="LongUrl"] .text');
      return getComputedStyle(el).overflowWrap;
    });
    expect(['anywhere', 'break-word']).toContain(wrap);
    // The document must not scroll horizontally.
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflows).toBe(false);
  });

  test('settings field rows collapse to a single column on phones', async ({page}) => {
    await bootApp(page);
    await page.evaluate(() => tw.events.send('tiddler.show', '$GeneralSettings'));
    const field = page.locator('.settings-field').first();
    await expect(field).toBeVisible();
    const cols = await field.evaluate(el => getComputedStyle(el).gridTemplateColumns);
    // Single column → one track value (no space-separated second track).
    expect(cols.trim().split(/\s+/).length).toBe(1);
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

  test('top-bar search icon morphs the bar into a full-width search with results', async ({page}) => {
    await bootApp(page);
    await page.evaluate(() => {
      ['Markdown Guide', 'About'].forEach(t =>
        tw.run.addTiddlerHard({title: t, text: '# ' + t, type: 'markdown', tags: [], created: new Date(), updated: new Date()}));
    });
    const toggle = page.locator('#topbar-search-toggle');
    const input = page.locator('#search'); // the single search box, relocated into the bar
    await expect(toggle).toBeVisible();
    await expect(input).toBeHidden(); // hidden in the bar until 🔍

    // Tap 🔍 → the bar morphs: the search field shows, tabs/icon hide.
    await toggle.click();
    await expect(input).toBeVisible();
    await expect(page.locator('#topbar-search-close')).toBeVisible();

    // Focus alone shows the FULL list (same as the sidebar search) before typing.
    await expect(page.locator('#search-results .tiddler-list[data-msg]').first()).toBeVisible();

    // Type → the list filters; results render full-width.
    await input.pressSequentially('Guide');
    await expect(page.locator('#search-results .tiddler-list[data-msg]').first()).toBeVisible();
    const r = await page.evaluate(() => {
      const el = document.getElementById('search-results');
      return {disp: getComputedStyle(el).display, width: el.getBoundingClientRect().width, vw: window.innerWidth};
    });
    expect(r.disp).toBe('block');
    expect(r.width).toBeGreaterThan(r.vw - 2);

    // ✕ collapses the bar and clears the query/results.
    await page.locator('#topbar-search-close').click();
    await expect(input).toBeHidden();
    await expect(page.locator('#search-results')).toBeHidden();
    expect(await page.evaluate(() => document.getElementById('search').value)).toBe('');
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

  test('tapping a tab-close closes a tab whose title contains spaces', async ({page}) => {
    await bootApp(page);
    // Switch to tabs mode (default layout is river; tabs mode is required for the strip).
    await page.evaluate(() => {
      const s = tw.run.getTiddler('$GeneralSettings');
      tw.run.updateTiddlerHard('$GeneralSettings', {...s, text: JSON.stringify({...JSON.parse(s.text), layout: {mode: 'tabs'}})});
      tw.events.send('tiddler.modified', '$GeneralSettings');
    });
    await page.evaluate(() => {
      tw.run.addTiddlerHard({title: 'Spaced Tab Note', text: 'a', type: 'markdown', tags: [], created: new Date(), updated: new Date()});
      tw.run.showTiddler('Spaced Tab Note');
    });
    const close = page.locator('.tab[data-tab="Spaced Tab Note"] .tab-close');
    await expect(close).toBeVisible();
    await close.click();
    await expect(page.locator('.tab[data-tab="Spaced Tab Note"]')).toHaveCount(0);
    expect(await visibleTitles(page)).not.toContain('Spaced Tab Note');
  });
});
