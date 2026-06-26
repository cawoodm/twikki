# Offline Capability

How TWikki loads and runs with no internet, and installs as a PWA. This documents the **service-worker + manifest scaffold added in this branch** (Steps 1–2), the **offline-tolerant package fetch** already merged (Step 4), and the **remaining work** with the file-level code changes each step needs.

---

## Current state

**Already offline-friendly (pre-existing)**
- Storage is local — `localStorage` plus the IndexedDB plugin. No server round-trips for data.
- Core modules (code + shadow tiddlers) are **bundled into the app by Vite** — not fetched. Only packages (`$CorePackages`/`$ExtensionPackages`) are fetched same-origin; the **service worker precache** serves them offline.
- Package URLs in `$CorePackages`/`$ExtensionPackages` are relative, resolving same-origin via `buildUrl`.

**What broke offline before this branch**
1. **No service worker / manifest** — a no-network reload couldn't fetch `index.html` or `platform/twikki.platform.js`; the app shell never loaded. *(fixed — Steps 1–2 below)*
2. Packages are fetched with `force` every boot. *(now served from the SW precache offline; plus Step 4's cached fallback)*
3. One CDN runtime dep fails offline: **highlight.js** (cdnjs). *(still open — Step 5)*
4. Network features (GitHub/Gist sync & backup, theme/package import) throw instead of degrading. *(still open — Step 6)*
5. First-ever visit still needs network (packages are fetched at boot; core code + shadow tiddlers are now bundled into the JS). *(still open — optional Step 7)*

---

## What this branch adds (Steps 1 & 2)

The production deploy now runs **`vite build`** (`ci/publish.ps1`): the platform statically imports the core modules, so Vite bundles the whole shell into `dist/index.html` + a hashed `dist/assets/*.js`. (This replaced the old manual copy-assembly, which existed only because the platform used to `eval` fetched module strings that Vite couldn't see.) The shadow tiddlers (`core.defaults.json`) are compiled to `src/generated/` and **bundled into the JS**; only the **package data layer** (`public/packages/*.json`) is emitted for same-origin fetch and copied into `dist/`. The service worker is generated **last** by **`workbox-cli` over the built `dist/`**, so the precache covers the hashed bundle and the package data.

**`workbox-config.cjs`** (new, repo root) — `generateSW` config (`.cjs` because `package.json` is `"type": "module"`):
- `globDirectory: 'dist'`, `globPatterns: ['**/*.{html,js,css,json,ico,png,svg,webmanifest}']` — precaches the **hashed shell bundle** (`assets/*.js`, `index.html`) **and the package data** (`packages/*.json`, icons), so `$CorePackages`' `force` fetches resolve from cache offline.
- `navigateFallback: '/twikki/index.html'` — offline reload of any in-app route serves the cached shell.
- `inlineWorkboxRuntime: true` (one self-contained `sw.js`), `maximumFileSizeToCacheInBytes: 5 MB`, `cleanupOutdatedCaches`/`skipWaiting`/`clientsClaim: true` (autoUpdate-style takeover).

**`ci/publish.ps1`** — runs `npx vite build` then `npx workbox-cli generateSW workbox-config.cjs` (both guarded by `$LASTEXITCODE`) **before** the copy to the Pages checkout, so `sw.js` ships in the deploy.

**`public/manifest.webmanifest`** (new) — name/short_name/description, `id`/`start_url`/`scope` = `/twikki/`, `display: standalone`, theme `#6db193` / bg `#ffffff`, three icons (192 any, 512 any, 512 maskable). Copied into `dist/` by `vite build` (publicDir).

**`src/index.html`** — adds `<meta name="theme-color">`, `<link rel="manifest" href="./manifest.webmanifest">`, and a guarded SW registration (`if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{})`) after boot. Under `npm run dev` there is no `sw.js`, so the fetch 404s and registration is a harmless no-op (nothing installs — no dev caching surprises).

**`package.json`** — adds `workbox-cli` to devDependencies (replaces the vite-plugin-pwa approach).

**`scripts/make-favicon.mjs`** — after the existing `favicon.ico` write, emits `public/pwa-192x192.png` and `public/pwa-512x512.png`, reusing the existing pure-Node `renderRGBA`/`encodePNG` helpers. Run `node scripts/make-favicon.mjs` to (re)generate all icons.

### Build, verify

Build exactly as `publish.ps1` does, then serve `dist/`:

```bash
npm install
node scripts/make-favicon.mjs                   # favicon.ico + pwa-192/pwa-512 PNGs
npx vite build --base=/twikki --emptyOutDir      # bundles the shell (+ shadow tiddlers) and copies packages into dist/
npx workbox-cli generateSW workbox-config.cjs    # → dist/sw.js (precaches the hashed bundle + data)
```

Then serve `dist/` over http(s) at `/twikki/` (e.g. `npx http-server . -p 8088` from dist's parent, or `vite preview`), open DevTools → Application → Service Workers (confirm activated), tick **Offline**, reload — the app boots fully. Lighthouse → PWA should report installable.

---

## Remaining work

### 3. SW update lifecycle vs the module cache — **RESOLVED (by elimination)**

This was the dual-cache hazard: the Workbox precache (Cache API, revisioned per build) plus a second `localStorage` `/modules/<name>` cache read cache-first. They could drift — a freshly-activated SW coexisting with stale localStorage modules (observed in practice: a cached `core.ui` `0.24.0` halting a `0.28.0` boot).

Rather than reconcile two caches, the `localStorage` module cache was **removed** (`src/platform/twikki.platform.js`): `fetchModules` now always `fetch()`es each core module same-origin, so the **service worker is the single cache** and a new build's precache is the single update. The bespoke version-compat gate (`checkModuleCompat`) and the on-demand compat dialog (`twikki.compat-dialog.js`) went with it — core modules ship with the platform build and can't be out of step. A one-time boot sweep drops legacy `/modules/*` keys, and `?reload`/`?update` are gone (a plain reload re-fetches). Plugins keep their own soft compat gate.

- **Prompt-style update (still optional)**: the current `sw.js` uses `skipWaiting`/`clientsClaim` (silent takeover). For an "update available — reload" banner instead, drop those two flags (so the new SW waits), listen for `registration.waiting` / `updatefound` in `index.html`, and have the banner action `postMessage({type:'SKIP_WAITING'})` to the waiting worker (with a matching `skipWaiting()` handler in a custom `sw.js` template).

### 4. Offline-tolerant package reload — **DONE (merged in this branch)**

`src/modules/core.packaging.js` has `offlineFallback({online, hadCachedCopy})` → returns `'use-cache'` (offline + a cached copy already in the store) or `'fail'`. On an offline fetch failure with a cached copy, `fetchPackage` notifies (`'I'`) and returns a `{cached:true}` marker; `loadPackageFromURL` leaves existing tiddlers untouched (no merge, no prune). Covered by `test/unit/offline-fallback.test.js` (4 branches). The Step-1/2 precache makes this path rarely needed, but it is the correct safety net.

### 5. Vendor highlight.js (the only real CDN dep)

Verified: `markdown-it` is **bundled** (`$BaseMarkdownPlugin.js`); `markdown-it-for-inline` is **embedded inline** (`$OpenLinksInNewWindow.js`); there are **no external webfont CDN deps**. The only external runtime fetch is **highlight.js** — 7 cdnjs URLs (core JS + 4 language packs + 2 theme CSS, v11.10.0) in `src/packages/base/$CodeSyntaxHighlightPlugin.js`.

Required changes:
- Vendor the 7 assets same-origin under `public/vendor/highlight/...`.
- Point `$CodeSyntaxHighlightPlugin.js` at `<base>/vendor/highlight/...`, ideally via the `loadScript()` / `tw.lib.require()` helper from the **`feature/dynamic-library-loading`** branch (PR #16) — coordinate ordering with that PR.
- `vendor/**` is already covered by the `globPatterns` above, so the assets precache → offline syntax highlighting with **no** runtime-caching crutch.

### 6. Graceful offline UX for network features

None of the network plugins check `navigator.onLine` today; all just `tw.ui.notify(..., 'E')` on fetch failure.

Required changes:
- **Shared online/offline signal** (e.g. in `src/modules/core.common.js` or a `tw.net` util): wrap `navigator.onLine`, subscribe to window `online`/`offline`, re-emit as `tw.events` (`net.online`/`net.offline`).
- **Guard fetches** in `GitHubSyncPlugin.js`, `$GistSynchPlugin.js`, `$GistBackupPlugin.js`, `$ThemeImporterPlugin.js`, and `core.packaging.js`: when offline, `tw.ui.notify("You're offline — <feature> unavailable", 'I')` and disable/queue instead of a raw network error. Optional: a deferred-sync queue that flushes on `net.online`.
- **UI**: disable sync/import buttons while offline (subscribe to the new event).

### 7. *(Optional)* First-run / air-gapped offline

Boot still needs one online load to fetch modules/packages. For true first-run offline (`file://` / air-gapped), add a single-file build target that inlines modules + packages into the HTML alongside the SW build. Lowest priority.

---

## Notes & caveats

- **HTTPS required** for service workers (or `localhost`). github.io qualifies; note it for self-hosting.
- **`devOptions.enabled: false`** — the SW is exercised only in the built app, not `npm run dev`.
- **Base path** is pinned to the shared `BASE` const; `manifest.start_url`/`scope` and `navigateFallback` read from it. If `base` changes, they follow automatically.
- **Maskable icon**: the 512 icon is reused for `maskable` with no extra safe-area padding, so on aggressively-masking launchers the "T" may sit close to the edge. A dedicated padded maskable icon is a nice-to-have (render the tile at ~80% inside a transparent 512 canvas in `make-favicon.mjs`).
- Icons are algorithmically generated (teal→blue tile + white "T"); swap in branded art by editing the renderer in `scripts/make-favicon.mjs`.
