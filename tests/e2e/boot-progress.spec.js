// Boot-progress events (src/platform/twikki.platform.js bootProgress()).
// The DOM CustomEvent channel must work with ZERO TWikki infrastructure —
// a listener wired before the platform script (here: an init script) sees
// every tick from {phase:'init'} through {phase:'ready'}, and the same
// sequence is buffered on tw.tmp.bootProgress for late consumers.

import {expect, test} from '@playwright/test';

test('boot progress: DOM events fire in order and match the tw.tmp buffer', async ({page}) => {
  await page.addInitScript(() => {
    window.__bootEvents = [];
    window.addEventListener('twikki.boot.progress', e => window.__bootEvents.push(e.detail));
  });
  await page.goto('/?trace');
  await page.waitForFunction(
    () => (window.__bootEvents || []).some(e => e.phase === 'ready'),
    null, {timeout: 30000},
  );
  const events = await page.evaluate(() => window.__bootEvents);
  const phases = events.map(e => e.phase);

  expect(phases[0]).toBe('init');
  const total = events[0].total;
  expect(total).toBeGreaterThan(0);
  // One fetch and one eval tick per core module (fetch ticks fire for cached copies too).
  expect(phases.filter(p => p === 'fetch')).toHaveLength(total);
  expect(phases.filter(p => p === 'eval')).toHaveLength(total);
  expect(phases).toContain('compat');
  expect(phases).toContain('modules-ready');
  expect(phases).toContain('package');
  expect(events.filter(e => e.phase === 'plugins').map(e => e.step)).toEqual(['load', 'init', 'start']);
  expect(phases[phases.length - 1]).toBe('ready');

  // Ordering: all fetches before compat, compat before any eval, evals before modules-ready.
  expect(Math.max(...phases.flatMap((p, i) => p === 'fetch' ? [i] : []))).toBeLessThan(phases.indexOf('compat'));
  expect(phases.indexOf('compat')).toBeLessThan(phases.indexOf('eval'));
  expect(Math.max(...phases.flatMap((p, i) => p === 'eval' ? [i] : []))).toBeLessThan(phases.indexOf('modules-ready'));

  // The buffer is the same sequence (for consumers that arrive after the fact).
  const buffered = await page.evaluate(() => tw.tmp.bootProgress.map(e => e.phase));
  expect(buffered).toEqual(phases);
});
