import {expect, test} from '@playwright/test';
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
