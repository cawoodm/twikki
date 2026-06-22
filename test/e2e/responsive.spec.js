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
});
