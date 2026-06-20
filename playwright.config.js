import {defineConfig, devices} from '@playwright/test';

// E2E tests boot the real app via the Vite dev server on a pinned port.
// VITE_TEST suppresses the dev server's auto-open (see vite.config.js).
const PORT = 5180;

export default defineConfig({
  testDir: './test/e2e',
  // The app shares localStorage semantics; run serially to avoid cross-test flakiness.
  // (Each test still gets a fresh browser context, so storage starts empty.)
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', {open: 'never'}]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {name: 'chromium', use: {...devices['Desktop Chrome']}},
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    env: {VITE_TEST: '1'},
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
