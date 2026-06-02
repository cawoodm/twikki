# Multi-Part Plugin Tiddlers (one tiddler → a runnable plugin)

> **Superseded (2026-06-02): the reference delimiter is now `::`, not `/`.**
> This document describes the original `/` addressing (`[[Title/Section]]`,
> `{{Title/Section}}`, `#Title/Section`). The section delimiter was later changed
> to `::` (`[[Title::Section]]`) to free `/` for a future directories concept, and
> `:` was removed from the legal title charset so `::` parses unambiguously. The
> design below is otherwise current; mentally read `/` as `::`. See the CHANGELOG.

> **Revision (2026-06-01): sections are foundational, not `$Plugin`-gated.**
> Sections are a general, tiddler-wide feature; `$Theme` and `$Plugin` are just
> *consumers* of one shared parser (`core.sections.js`). Grammar settled with the
> user: the delimiter is **`#` (h1)** (`/^# (.+)$/m`); a section is *content under
> a heading* and is a **mini-tiddler** — optional leading `key: value` meta lines
> (`tags:` comma-split, like the compile plugin) then a body. A body that is a
> single fenced ```lang block is typed from the fence (stripped); otherwise type
> falls back to an explicit `type:` meta or the parent's type.
>
> **Phase 1 shipped** (see `~/.claude/plans/look-at-auroratheme-tid-which-lexical-newt.md`):
> the `core.sections.js` parser, `resolveRef`/`getSection` + section-aware text
> helpers, `[[Title/Section]]` links / `{{Title/Section}}` inclusions / `#Title/Section`
> navigation (render-by-type via `makeTiddlerText` on a synthesized section
> tiddler — no separate `renderSectionHtml`), and the `$Theme` consumer
> (`AuroraTheme.tid` packs its CSS as an `AuroraStyleSheet` section, referenced
> from its theme list as `[[AuroraTheme/AuroraStyleSheet]]`; the theme manager
> needed no change). **Phase 2 (below) — the `$Plugin` loader — is still pending.**

## Context
`src/packages/website/ExamplePlugin.tid` describes an unimplemented concept: a **single** tiddler holding multiple named sections of different types (Code, StyleSheet, Data, Config, Settings, Theme, …) that behaves like a self-contained plugin — its script runs, its styles apply, and its data is readable. Today this is purely aspirational: there is no section parser, `/` is disallowed in titles (`twikki.latest.js:14`, with a `// TODO` at `:9` reserving `/` for "blocks within multipart tiddlers"), and the runtime only ever treats one tiddler as one unit of a single `type`.

We will implement it with the **no-split / on-demand** model: the parent stays the *single* object in `tw.tiddlers.all` (single source of truth — delete one tiddler = remove the whole plugin). `/` becomes pure **addressing into** a tiddler, never a way to mint new store entries. Nothing synthetic leaks into search, save, Gist sync, or package GC.

## Decisions (locked with user)
- **Approach:** C — no-split / on-demand sections (no materialized child tiddlers).
- **Scope:** Full — Code runs, StyleSheet applies, Data/Config/Settings readable, **and** `[[Title/Section]]` links, `{{Title/Section}}` inclusions, and per-section rendering-by-type.
- **Section typing:** every section is a **fenced code block**; the fence info-string *is* the type (via a small alias map). No name-convention or per-section `type:` line.

## Section grammar
A **plugin tiddler** is `type: x-twikki` tagged **`$Plugin`**. Its `.text` is:
- An optional **preamble** (everything before the first `# ` heading) — the human description, rendered as the parent's prose body.
- One or more **sections**, each exactly:
  ```
  # SectionName
  ```<lang>
  …content…
  ```
  ```
Fence info-string → tiddler type (`fenceToType`): `js`/`javascript`→`script/js`, `css`→`css`, `json`→`json`, `html`→`html/template`, `keyval`→`keyval`, `list`→`list`, `table`→`table`, `md`/`markdown`→`markdown`, `x-twikki`→`x-twikki`; unknown info-string is used verbatim as the type. Section-name match is case-insensitive. Duplicate section names → `console.warn`, last wins.

`ExamplePlugin.tid` will be rewritten to this canonical form (e.g. `# Settings` → ```` ```keyval ````, `# Theme` → ```` ```list ````, `# Examples` → ```` ```x-twikki ````).

## Architecture

### 1. Section parser — NEW `src/modules/core.sections.js` (core module)
Register in `modulesToLoad` (`twikki.latest.js:86-99`) so it loads before everything as `tw.core.sections`. Pure, DOM-free, with exported functions for `node --test` (mirrors how `vite-plugin-tiddler-compile.js` exports `parseFile`/`getType`).
- `parseSections(text) → {preamble, order:[names], sections:{name:{type,text}}}` — split on `/^# (.+)$/m` while tracking ```` ``` ```` fence state; extract each section's single fenced block (strip fences); `type = fenceToType(info)`.
- `getSection(text, name) → {name,type,text} | null`.
- `fenceToType(info)` — the alias map above.
- **Cache:** memoize `parseSections` keyed by `title`+`updated` timestamp; invalidated on `tiddler.updated`. Avoids re-parsing on every read.

### 2. Plugin loader & execution — NEW `src/modules/core.plugins.js` + reload hook
- `runPluginTiddlers()`: for each `$Plugin` tiddler, set `tw.plugin = {title, data:(s)=>tw.run.getJSONObject(title+'/'+s), section:(s)=>tw.run.getSection(title,s)}`, then `executeText(getSection(text,'Code').text, title+'/Code')` (reuses the existing executor + error/notify path, `twikki.latest.js:490-499`), then reset `tw.plugin`. Eval `Tests` only when `qs.test`.
- **Hook point:** in `reload()` (`twikki.latest.js:303-320`) call `runPluginTiddlers()` **after** `runExtensionTiddlers()` and **before** `initPlugins()`/`runPlugins()` (`:459-480`) so `tw.extensions.registerMacro/registerPlugin` results are present for the init/start phases. Expose `tw.run.runPluginTiddlers`.
- **Self-title for plugin code:** `tw.plugin.title` is valid synchronously during eval; async handlers must capture it at top. Document this.
- **Re-run on edit:** in `tiddlerUpdated` (`:844-863`) add a `$Plugin` branch mirroring the `isActiveCodeTiddler` re-eval (`:846-848`): invalidate cache, re-eval Code, fire the plugin-style update.

### 3. Stylesheet application — MODIFY `src/packages/base/$CoreThemeManager.js`
The theme whitelist (`getThemeStyleSheets`, `:76-83`) won't apply plugin styles, so add a second always-adopted sheet (smallest mechanism, leaves the theme model untouched):
- On `ui.loaded`: `tw.theme.stylesheets.plugins = new CSSStyleSheet()`; push to `document.adoptedStyleSheets` beside `.custom` (`:22-26`).
- `pluginStyleUpdate()`: concatenate `getSection(t.text,'StyleSheet').text` over all `$Plugin` tiddlers; `replaceSync`.
- Wire to `ui.loaded`/`ui.reloaded` (`:52`) and to `tiddlerChanged` (`:30-35`) when `tags.includes('$Plugin')`.

### 4. Data & section API — MODIFY `tw.run` (`twikki.latest.js:200-234`, `:1016-1061`)
- Add `getSection(title, section)` → `tw.core.sections.getSection(getTiddler(title)?.text, section)`.
- Add one central `resolveRef(ref) → {text, type}`: if `ref` contains `/`, `Title` exists, and that section exists → return the section's text+type; **else fall back to whole-tiddler text** (fully backward compatible).
- Route `getTiddlerTextRaw` (`:1016`) and `getTiddlerTextLines` (`:1030`) through `resolveRef`. The six list/json/keyval helpers (`getTiddlerList`, `getKeyValuesObject`, `getJSONObject`, …) inherit section-awareness for free, so `tw.run.getJSONObject('ExamplePlugin/Config')` works.

### 5. Links, inclusions, rendering, navigation (`twikki.latest.js`)
- **Title regex (`:14`):** add `/` to `reTiddlerTitle`'s class so `reLinks`/`reInclusion` (`:17-19`) capture `Title/Section`. `/` is only meaningful when the LHS resolves to an existing tiddler+section; otherwise treated as a normal title (existing titles unaffected).
- **Render-by-type reuse:** factor the type→HTML dispatch in `makeTiddlerText` (`:536-550`) into `renderSectionHtml({type,text,title})` (markdown/x-twikki → recurse `renderTWikki`; css/json/script-js/macro → `<pre><code>`; html → raw).
- **Parent rendering:** `$Plugin` tiddlers render as preamble prose + each section under its `# Name` heading via `renderSectionHtml`, each wrapped in an anchor element (id from section name) so `#Title/Section` can scroll to it. Gives a readable "plugin card" and makes Code/StyleSheet show as highlighted code.
- **Inclusions (`:615-628`, `getTiddlerTextReplaced :1020-1028`):** `{{Title/Section}}` → inline that one section via `renderSectionHtml`. Add a depth guard to stop self-inclusion recursion.
- **Links (`:632-637`):** `[[Title/Section]]` → `[Title/Section](#Title/Section)`.
- **Navigation (`:1139-1188`, `showTiddler`/`scrollToTiddler` `:904-907`):** for `#Title/Section`, open parent `Title` and scroll to the section's anchor (fallback: parent top).

### 6. Save-validation (`twikki.latest.js:417-421`, `formDone :719-733`)
Add a `$Plugin` branch to validation: parse sections, `jsonValidator` the Config/Data sections, and eval the Code section inside the existing try/catch "force save?" UX — never silently. (The parent is `x-twikki`, so its fenced JS is **not** auto-eval'd today — no surprise execution.)

## Edge cases
- **Double execution:** none — the `x-twikki` parent is not `isActiveCodeTiddler` (`:1079-1080`); only `runPluginTiddlers` evals Code. Code must stay idempotent (already required of all code tiddlers; `registerMacro` overwrites).
- **Ordering:** `runPluginTiddlers` runs in store order; the existing two-phase model (Code registers → `init`/`start` consume) handles cross-plugin deps. Future: `dependsOn:` in a Meta section + topo sort.
- **Cross-section refs / recursion:** reads re-parse the same `.text` (cached); inclusion depth guard prevents loops.
- **Regex widening risk:** broadening `reTiddlerTitle` affects link/inclusion tokenization globally; `/` is only gated inside `[[ ]]`/`{{ }}`, so risk is low — covered by full test run + link smoke test.

## Files to create / modify
**Create**
- `src/modules/core.sections.js` — parser + `tw.core.sections` + cache (pure exports).
- `src/modules/core.plugins.js` — `runPluginTiddlers()` + `tw.plugin` context.
- `tests/unit/sections.test.js` — parser unit tests.

**Modify**
- `src/platform/twikki.latest.js` — register the two modules (`:86-99`); `/` in `reTiddlerTitle` (`:14`); `runPluginTiddlers()` in `reload()` (`:306-312`); `tw.run.getSection` + `resolveRef` + route text helpers (`:200-234`, `:1016-1032`); `renderSectionHtml` from `makeTiddlerText` (`:536-550`); section-aware inclusions (`:615-628`,`:1020-1028`); `$Plugin` parent rendering; `/Section` navigation (`:1139-1188`); `$Plugin` re-eval in `tiddlerUpdated` (`:844-863`); `$Plugin` save-validation (`:417-421`).
- `src/packages/base/$CoreThemeManager.js` — `tw.theme.stylesheets.plugins` + `pluginStyleUpdate()`.
- `src/packages/website/ExamplePlugin.tid` — rewrite to the canonical fenced-section format; add `tags: $Plugin`.
- `src/packages/website/Plugins.tid` — add a short "Multi-part plugins" section documenting the grammar (follow-up doc).

## Verification
1. **Unit (`node --test`):** `tests/unit/sections.test.js` imports the parser exports and asserts against the real `ExamplePlugin.tid`: correct section order; `Config`/`Data`→json, `Code`/`Tests`→script/js, `StyleSheet`→css, `Settings`/`Meta`→keyval, `Theme`→list; preamble = intro prose; `fenceToType` aliases. Keep the existing 10 compile-plugin tests green.
2. **Build:** `npm run dev` (port 3002); confirm `website.json` has one `ExamplePlugin` tiddler tagged `$Plugin` (no children).
3. **Browser (chrome-devtools MCP, http://localhost:3002, reload with `?clear` due to `website.json` `nooverwrite`):**
   - `tw.tiddlers.all.filter(t=>t.title.includes('ExamplePlugin')).length === 1` (no synthetic children).
   - `tw.macros.example.hello('Marc') === 'Hello Marc'` (Code ran).
   - `tw.run.getJSONObject('ExamplePlugin/Config').maxResults === 100` (section data read).
   - Add a tiddler containing `<div class="example">x</div>`; computed color is red (StyleSheet applied); `document.adoptedStyleSheets` includes the plugins sheet.
   - Render `{{ExamplePlugin/Settings}}` (list) and `[[ExamplePlugin/Code]]` (navigates to the Code section); both resolve.
   - Edit the parent's StyleSheet section → live re-apply, no reboot prompt, no duplicate macro registration.

## Risks (ranked)
1. **`reTiddlerTitle` widening** — global tokenization impact; mitigate with full `node --test` + existing-link smoke test.
2. **`resolveRef` backward-compat** — `getTiddlerTextRaw` is called heavily; the `/`-branch must be a strict superset (only diverge when base tiddler + section both exist).
3. **Hook ordering** — `runPluginTiddlers()` must run on *every* `reload()` (incl. post-import) after extension code and before plugin init/start, or plugin code silently won't run.
