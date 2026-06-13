// Boot-progress events (src/platform/twikki.platform.js bootProgress()).
// The window 'twikki.boot.progress' CustomEvent is the sole, live channel —
// a listener wired BEFORE the platform script (here: via addInitScript) sees
// every tick from {phase:'init'} through {phase:'ready'} the instant it
// fires. No buffer, no bus event: the goal is real-time progress.

import {expect, test} from '@playwright/test';

test('boot progress: DOM events fire live, in order, from init through ready', async ({page}) => {
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
});
