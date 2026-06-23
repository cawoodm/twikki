# Including External Libraries Dynamically — Review & Recommendations

**Scope:** how TWikki ships third-party JS, prompted by `$BaseMarkdownPlugin.js` embedding a 3116-line minified markdown-it.
**Code refs:** `main` @ `d79ab3b` — `src/packages/base/$BaseMarkdownPlugin.js`, `src/packages/base/$CodeSyntaxHighlightPlugin.js`, `src/modules/core.dom.js`, `src/platform/twikki.platform.js`.

---

## The constraint that shapes everything

`startPlugins()` calls `plugin.start()` **without `await`** (`twikki.platform.js:749`), and `reload()` runs `renderAllTiddlers()` synchronously right after (`:497`, `:506`). So an async `start()` that awaits a library load does **not** block the first render. That is *why* markdown-it is pasted inline — the core renderer must exist synchronously by first render. Any "load it dynamically" answer has to respect this for the renderer specifically.

---

## Two patterns today, both flawed

### A. Bundle inline — `$BaseMarkdownPlugin.js`
3116 lines of minified markdown-it inside the `# Code` section.

- ✅ Offline-safe, synchronously available at `init()`.
- ❌ Enormous tiddler; unreadable diffs; version buried in source; `markdownit` leaks as a global into the eval scope.

### B. CDN via `addScript` — `$CodeSyntaxHighlightPlugin.js`
`tw.core.dom.addScript(url)` then nested `subscribe('script.loaded', …)`, reads `window.hljs`.

- ✅ Small plugin, easy to update, lazy.
- ❌ Callback-nested; **no `onerror`** (`core.dom.js:71` wires only `onload`); no integrity; `addScript` adds a **duplicate `<script>` on every soft reload**; pollutes `window`.

---

## Recommendation 1 — a Promise-returning loader + one-load cache

Wrap the existing event-based `addScript` in a promise so callers `await` instead of nesting subscribes, and fix `onerror` / idempotency / SRI at the same time.

```js
// core.dom.js
function loadScript(title, url, {integrity, global} = {}) {
  let el = document.querySelector(`script[data-lib="${title}"]`);
  if (el?._p) return el._p;                       // idempotent: one load per title
  el = document.createElement('script');
  el.dataset.lib = title;
  el.src = url;
  if (integrity) { el.integrity = integrity; el.crossOrigin = 'anonymous'; }
  el._p = new Promise((resolve, reject) => {
    el.onload  = () => { tw.events.send('script.loaded', title); resolve(global ? window[global] : undefined); };
    el.onerror = () => reject(new Error(`Failed to load '${title}' from ${url}`));
  });
  document.head.appendChild(el);
  return el._p;
}
```

Memoised registry so multiple plugins share one load:

```js
const _libs = new Map();
tw.lib.require = (name, loader) => {
  if (!_libs.has(name)) _libs.set(name, Promise.resolve().then(loader));
  return _libs.get(name);
};
```

The syntax-highlight plugin then flattens to:

```js
async start() {
  const hljs = await tw.lib.require('hljs', () =>
    tw.core.dom.loadScript('hljs', '.../highlight.min.js', {global: 'hljs', integrity: 'sha384-…'}));
  await Promise.all(['javascript','css','json'].map(l =>
    tw.core.dom.loadScript('hljs-'+l, `.../languages/${l}.min.js`)));
  tw.lib.highlight = hljs;
}
```

No nesting, real error handling, no duplicate tags on reload, SRI-pinned.

## Recommendation 2 — native dynamic `import()` for ESM libraries

markdown-it and most modern libs publish ESM (jsDelivr `/+esm`, esm.sh). Skip `<script>` tags and globals entirely:

```js
const { default: markdownit } = await tw.lib.require('markdown-it',
  () => import('https://esm.sh/markdown-it@14.2.0'));
```

Browser handles caching, dedup, and a scoped binding — no `window` pollution. Pin versions/integrity centrally with an **import map** in `index.html`, so plugins can use bare specifiers (`import('markdown-it')`).

## Recommendation 3 — markdown-it specifically: separate the library, don't async-load it

Because `start()` isn't awaited, async-loading the **core renderer** races the first render. Two honest options:

1. **Keep it local but stop pasting it into the plugin.** Vendor markdown-it as its own cached asset — a `$Vendor/markdown-it` tiddler, or a `/vendor/markdown-it.js` fetched once and cached in `tw.storage` (exactly how the platform already caches `/modules/*`). The plugin's `# Code` drops to ~15 lines that load that asset before first render. Keeps offline + synchronous availability, but library and plugin logic are no longer tangled and a version bump is a one-line swap. **Preferred for markdown.**
2. **Make `start()` awaited** (one-line platform change: `for (const p of tw.plugins) await p.start?.()`), then the renderer can `await import(...)` like everything else — but you lose offline rendering and add a CDN dependency on the boot path.

**Verdict:** option 1 for the core renderer; the Recommendation 1/2 loaders for enhancement libs (hljs, mermaid, KaTeX, …).

---

## Cross-cutting improvements (any approach)

- **`onerror` + Subresource Integrity (`integrity`) + `crossorigin`** — important under the "run fetched packages" model; today CDN loads have neither.
- **Idempotency** — dedup by title so soft reloads don't stack `<script>`/`<link>` tags (the loader above does this).
- **Offline / CSP** — `import()` and CDN need network and a CSP allowlist; vendored-and-cached assets don't.

---

## Decision guide

| Library kind | Needed at first render? | Recommended approach |
|---|---|---|
| Core renderer (markdown-it) | Yes, synchronously | **Vendor as a cached asset** (Rec 3, option 1) — offline-safe, plugin stays small |
| Enhancement, ESM (mermaid, KaTeX) | No, lazy | **`tw.lib.require` + dynamic `import()`** (Rec 1 + 2) |
| Enhancement, UMD/global only (hljs) | No, lazy | **`loadScript` Promise loader** with `global` + SRI (Rec 1) |

---

## Suggested implementation order

1. Add `loadScript()` and `tw.lib.require()` to `core.dom` (with `onerror`, idempotency, SRI).
2. Refactor `$CodeSyntaxHighlightPlugin` to use them (removes the nested-subscribe + duplicate-tag issues).
3. Split markdown-it out of `$BaseMarkdownPlugin` into a cached vendor asset; shrink the plugin to loader + config.
4. *Optional:* add an import map to `index.html` and migrate ESM libs to bare-specifier `import()`.
