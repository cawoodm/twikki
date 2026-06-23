// Service-worker generation for the PWA / offline support.
//
// Run AFTER dist/ is fully assembled (see ci/publish.ps1), because Workbox
// precaches whatever exists in `globDirectory` at generation time. The
// assembled dist/ contains the complete shell — platform/twikki.platform.js,
// the loose modules/core.*.js runtime, the compiled modules/*.json and
// packages/*.json data layer, index.html, the manifest and icons — so the
// precache covers everything needed to boot with no network.
//
//   npx workbox-cli generateSW workbox-config.js
//
module.exports = {
  globDirectory: 'dist',
  globPatterns: ['**/*.{html,js,css,json,ico,png,svg,webmanifest}'],
  swDest: 'dist/sw.js',
  // Single self-contained sw.js (no separate workbox-*.js to copy/serve).
  inlineWorkboxRuntime: true,
  // The bundled markdown-it package JSON is ~167 KB; give headroom.
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
  // Offline reload of any in-app route serves the cached shell.
  // (No denylist: the platform's ?reload/?update refresh the localStorage
  // module cache, which is orthogonal to this SW shell cache.)
  navigateFallback: '/twikki/index.html',
  // Behave like vite-plugin-pwa's autoUpdate: a new SW takes over promptly.
  cleanupOutdatedCaches: true,
  skipWaiting: true,
  clientsClaim: true,
};
