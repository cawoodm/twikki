# Pluggable Markdown: move core.markdown.js into a $BaseMarkdownPlugin

## Context

`core.markdown.js` (markdown-it v14 bundle, ~125KB minified) is currently a hard-coded core module in `modulesToLoad`, loaded during `init()` and localStorage-cached. Marc wants users to be able to replace the markdown implementation/flavor from their own packages, and wants defined behavior when no markdown plugin is installed.

Exploration established that markdown is **not** required early in boot:
- `document.title = renderTiddler('$SiteTitle')` (twikki.platform.js:215) only does macro/inclusion expansion (`renderTWikki`) — no `markdown.render`.
- The first real `markdown.render` happens in `reload()` → `renderAllTiddlers()`/`makeTiddlerText()` (:586/:588) — **after** `runExtensionTiddlers()` (:351) where base-package scripts execute.
- 10 of 12 markdown consumers only need `render(text) → html`; only `$OpenLinksInNewWindow.js` touches markdown-it internals (`md.use()`, `md.core.ruler.push()`).
- Syntax highlighting is already decoupled (`$HighlightPlugin` post-processes `<pre><code>` after render).

**Chosen mechanism** (agreed with Marc): the `tw.events` bus.
- Platform renders via `tw.events.send('markdown.render', text)?.[0]`, falling back to plain text when no handler is subscribed.
- `$BaseMarkdownPlugin` (base package) `subscribe()`s the markdown-it handler at script top level.
- A user package replaces it with `tw.events.override('markdown.render', namedFn)` — `override` (core.js:51) removes existing handlers and installs the new one.
- Ordering converges on every boot/reload: base executes before user packages in `runExtensionTiddlers`, so subscribe-then-override always ends with the user's renderer. `subscribe`'s dedup-by-handler-name prevents pileup across `reload()`s. Handlers must be **named** functions (core.js:40-47 warns on anonymous).

## Changes

### 1. Platform — `src/platform/twikki.platform.js`

- **Remove** `'/core.markdown.js'` from the `modulesToLoad` array (~:108-115).
- **Add** a `renderMarkdown(text)` helper near `makeTiddlerText`:
  ```js
  function renderMarkdown(text) {
    const html = tw.events.send('markdown.render', text)?.[0];
    return html ?? renderPlainText(text);
  }
  function renderPlainText(text) {
    // Fallback when no markdown plugin is installed (e.g. ?safemode)
    return text.split(/\n{2,}/)
      .map(p => `<p>${tw.core.common.escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
      .join('');
  }
  ```
  Note: `send(event, params)` spreads Array params (core.js:30-31) — `text` is a string, so pass it directly.
- **Replace call sites**:
  - `makeTiddlerText` :586 `tw.core.markdown.render(renderTWikki({text, title}))` → `renderMarkdown(renderTWikki({text, title}))`
  - `makeTiddlerText` :588 `tw.core.markdown.render(text)` → `renderMarkdown(text)`
  - Legacy alias :279 `tw.lib = {markdown: tw.core.markdown.render}` → `tw.lib = {markdown: renderMarkdown}` (un-breaks the execute-time hard reference; covers the 8 `tw.lib.markdown` call-time consumers in base widgets and `showTiddlerList` ~:1270)
  - :295 `window.markdown = tw.lib.markdown` — unchanged (now safe).
- Optional one-line guard in `renderMarkdown`: if `send` returned >1 results, `console.warn` once (two renderers subscribed — someone used `subscribe` instead of `override`).

### 2. New — `src/packages/base/$BaseMarkdownPlugin.js`

Move the minified markdown-it bundle out of the module IIFE wrapper into a base-package script tiddler (auto-tagged `$NoEdit`, executes in `runExtensionTiddlers`):

```js
// <minified markdown-it bundle line, as-is>
const md = markdownit({html: true, linkify: true, typographer: true});
tw.core.markdown = {md, render: md.render.bind(md)}; // impl-specific surface: $OpenLinksInNewWindow needs md.use()
tw.events.subscribe('markdown.render', function markdownItRender(text) {
  return tw.core.markdown.render(text);
});
```

- The handler delegates through `tw.core.markdown.render` so md-level enhancements (`md.use`) keep working.
- Keep `tw.core.markdown` as the documented *implementation-specific* surface; the *portable* contract is the `markdown.render` event.
- Persistence: default base.json behavior (saved per workspace store). Accept ~125KB/workspace; revisit with `nosave` if quota becomes a concern.

### 3. Delete — `src/modules/core.markdown.js`

`git rm`. The stale localStorage cache entry `/modules/core.markdown.js` in existing browsers is ignored (only `modulesToLoad` entries load) — harmless.

### 4. `$OpenLinksInNewWindow.js` — no functional change

Its `init()` already throws when `!tw.core.markdown?.md`; `initPlugins` catches and disables the plugin with a notification. When a user replaces the renderer, this plugin degrades gracefully. Optionally clarify the error message: `'markdown-it not active — OpenLinksInNewWindow disabled'`.

### 5. Documentation

- `docs/MODULES.md` + `CLAUDE.md`: remove `core.markdown.js` from the `modulesToLoad` listing; note the `markdown.render` event contract and plain-text fallback.
- `src/packages/website/Plugins.tid`: add a "Replace the markdown renderer" section showing the override one-liner:
  ```js
  tw.events.override('markdown.render', function myMarkdown(text) { return myHtml; });
  ```
  (top level of any user-package script tiddler; or at runtime followed by `tw.events.send('ui.reload')`).

## Files touched

| File | Change |
|---|---|
| `src/platform/twikki.platform.js` | drop module from `modulesToLoad`; `renderMarkdown` + `renderPlainText`; rewire :586/:588/:279 |
| `src/packages/base/$BaseMarkdownPlugin.js` | **new** — bundle + `tw.core.markdown` + subscribe |
| `src/modules/core.markdown.js` | **deleted** |
| `src/packages/base/$OpenLinksInNewWindow.js` | optional message tweak |
| `docs/MODULES.md`, `CLAUDE.md`, `src/packages/website/Plugins.tid` | docs |

## Verification

1. `npm run compile` — `base.json` contains `$BaseMarkdownPlugin` (`script/js`, `$NoEdit`).
2. `npm run dev` + chrome-devtools MCP against the dev server (fresh profile / `localStorage.clear()` because base.json tiddlers persist per workspace):
   - **Default path**: tiddlers render as HTML (e.g. open `Modules` — headings + `<<modules>>` table render). External links get `target="_blank"` (proves `md.use` path still works).
   - **Override path**: in console `tw.events.override('markdown.render', function fake(t){return '<p>OVERRIDE</p>'}); tw.events.send('ui.reload')` → all tiddlers show OVERRIDE; `tw.events.handlers().filter(h => h.event === 'markdown.render').length === 1`.
   - **No-plugin path**: load `/?safemode` → app boots, tiddlers show escaped plain text (fallback), no exceptions; `$OpenLinksInNewWindow` reports disabled, rest of UI alive.
   - **Reload convergence**: `tw.events.send('ui.reload')` twice → still exactly one `markdown.render` handler.
3. `npm test` — compile-plugin unit tests still pass.
