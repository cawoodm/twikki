# Platform Decomposition

Plan to shrink `src/platform/twikki.platform.js` (~2195 lines) into a minimal
kernel by moving functionality out into **core modules** (always loaded; TWikki
must be usable with zero plugins) and **plugins** (optional; their failure must
never block viewing, editing, or saving a tiddler).

Baseline: `e72f4b4` (2026-06-12).

## Tiers

- **Platform** — runs *before* any module loads. Fetches, validates, evals and
  caches modules; holds bootstrap state; orchestrates the boot lifecycle; emits
  boot-progress events; owns raw localStorage (`tw.storage`) for its own
  pre-module bootstrap. Nothing here may depend on a module existing.
- **Core modules** — always in `modulesToLoad`. Together they make TWikki
  minimally usable (view, create, edit, section-edit, validate, save, navigate,
  search) with **no plugins** and under `?safemode`.
- **Plugins** — optional. A plugin crash may cost shortcuts, a preview pane, a
  dirty indicator, the rich boot dialog, or drag-and-drop — never the ability to
  open a tiddler and save a fix.

## Classification rules

1. **Must work before modules load → platform.** (loader, cache, compat
   computation, bootstrap state, progress emit, raw `tw.storage`.)
2. **Listing, getting, or changing tiddlers → `core.tiddlers`.** Anything taking
   a tiddler or title and reading/filtering/mutating tiddlers — even if it also
   understands section references.
3. **Section-reference grammar + text slicing only → `core.sections`.** It only
   ever sees `(text, sectionName)`. Anything taking a *title* is tiddler access,
   not section logic.
4. **Persisting the store to localStorage → `core.store`.** Distinct from
   `core.packaging` (HTTP import/merge of bundles). Persistence is not packaging.
5. **Basic editing is core, not a plugin.** Users must be able to fix a broken
   tiddler when plugins fail. Only *enhancements* (hotkeys, live preview, dirty
   indicator) are plugins.
6. **Rendering is core but event-driven.** A bare TWikki renderer ships in
   `core.render`; richer renderers override via events (as `markdown.render`
   already does).
7. **Pure libraries stay pure.** `core.templater`, `core.params`, `core.common`
   take data in and return data out; no tiddler/render/store coupling leaks in.

## Storage layering

Three layers, lowest to highest:

```
localStorage  ←  tw.storage (platform, raw)  ←  tw.store (core.store, scoped)  ←  consumers
```

- **`tw.storage`** — raw localStorage wrapper (`read`/`write`, `/`-prefixing),
  defined in the **platform**. Irreducible: `init()` reads `/settings.json` and
  the module cache from localStorage *before any module exists* — that is how it
  decides what to fetch. Platform-internal; **modules and plugins should not call
  it directly.**
- **`tw.store`** — the public, workspace-scoped API, now owned by **`core.store`**
  (today it is built ad hoc inside `core.workspaces`). `get`/`set`/`delete`/
  `keys`, key-prefixing by current workspace (`/ws/<name>/`), backup logic, and
  raw `exportRaw`/`importRaw`/`keys(prefix)` helpers so even whole-workspace
  dump/restore goes through the API. Calls `tw.storage` underneath.
- **Consumers** — all modules and plugins use `tw.store` only.

**Dependency inversion:** `core.workspaces` stops *defining* `tw.store`; it just
manages which workspace is active and hands `core.store` the prefix (or
`core.store` reads `tw.workspace`). New direction: `core.workspaces → core.store`.

**Enforcement is convention + lint, not a sandbox.** Modules are `eval`'d strings
sharing one global, so nothing can structurally prevent a direct `localStorage`
call. Add an ESLint `no-restricted-properties`/`no-restricted-globals` rule
banning `localStorage` outside the platform and `core.store`, with an allowlist
for plugins that genuinely need raw enumeration.

Reach-arounds to retire:
- `$DumpWorkspacePlugin` — needs raw key enumeration to export/import portably;
  route through new `core.store` `keys`/`exportRaw`/`importRaw` methods (stays
  allowlisted if any raw access remains).
- `$SettingsDialogPlugin` — writes `/settings.json` via `localStorage.setItem`;
  change to `tw.store.set('/settings.json', …)`.

## `modulesToLoad` (proposed order)

Ordered by logical dependency. (Most cross-module references are *runtime*
`tw.run.*`/`tw.events` calls resolved after every `run()` executes, so eval order
is looser than the call graph — but ordering by dependency stays robust.)

```js
let modulesToLoad = [
  '/core.common.js',     // pure utilities (hash, base64 encoder/decoder, notEmpty) — FIRST, no deps
  '/core.js',            // tw.events bus; uses tw.core.common.decoder (inline copy removed)
  '/core.sections.js',   // section-reference grammar + text slicing, no deps
  '/core.params.js',     // macro/widget arg parsing, no deps
  '/core.templater.js',  // pure mustache engine, no deps
  '/core.dom.js',        // DOM helpers (needs tw.events)
  '/core.store.js',      // NEW — owns tw.store (scoped) + tiddler persistence
  '/core.tiddlers.js',   // NEW — store + CRUD; exposes tw.run.{add,update,delete,get}
  '/core.render.js',     // NEW — TWikki render pipeline + loadTemplates (needs params, sections, dom, templater)
  '/core.defaults.json', // shadow tiddlers: $MainLayout, $TiddlerDisplay, $CorePackages, themes
  '/core.notifications.js', // tw.ui.notify (needs dom)
  '/core.ui.js',         // event wiring, nav, basic edit round-trip (needs tiddlers, render, notifications)
  '/core.workspaces.js', // active-workspace management (now → core.store for scoping)
  '/core.packaging.js',  // HTTP import/merge of {tiddlers:[]} bundles ONLY
  '/core.search.js'      // search (needs common, dom, tw.run.get)
];
```

Changes vs. today: `core.common` moved to first; three new modules
(`core.store`, `core.tiddlers`, `core.render`); `core.notifications` ahead of
`core.ui`; `core.templater` early (it has no deps).

## Boot progress events

The platform emits progress so a future splashscreen can render a progress bar.
The earliest ticks fire **before `tw.events` exists** (defined in `core.js`).

- **Pre-module:** a platform primitive `bootProgress(evt)` (near `read`/`write`)
  pushes onto `tw.tmp.bootProgress = []` *and* dispatches a native DOM event:
  `window.dispatchEvent(new CustomEvent('twikki.boot.progress', {detail: evt}))`.
  A DOM listener needs zero TWikki infrastructure and can be wired from
  `index.html` before the platform script — sidestepping the deferred
  "splashscreen plugin before modules" problem.
- **Bridge:** once `core.js` brings up `tw.events`, replay the buffered array onto
  the bus; thereafter `bootProgress` also `tw.events.send('boot.progress', evt)`.

| Point | Payload |
|---|---|
| boot start | `{phase:'init', total: modulesToLoad.length}` |
| per module fetched (in `fetchCoreModule` map) | `{phase:'fetch', name, index, total}` |
| compat gate done | `{phase:'compat', blocking, warnings}` |
| per module eval'd | `{phase:'eval', name, index, total}` |
| modules done / `tw.events` live | `{phase:'modules-ready'}` ← replay/bridge |
| packages loading | `{phase:'package', name, count}` |
| plugin phases | `{phase:'plugins', step:'load'\|'init'\|'start'}` |
| ready | `{phase:'ready'}` |

Fetch ticks matter most (network is the slow part); `index/total` across
fetch+eval covers the bulk of perceived boot time.

## Module summary: today → after

| Module | Today | After |
|---|---|---|
| **`core.js`** (`twikki.core`) | First module; bootstraps `tw.events` bus + a minimal `tw.run.getTiddler`. Has its **own inline `decoder`** (dup of core.common's). | Same role + boot-progress **bridge** (replay buffer onto bus). Inline `decoder` deleted → uses `tw.core.common.decoder`. `tw.core = {}` line removed (platform sets it; otherwise clobbers `core.common`). |
| **`core.common`** | Pure DOM-free utils: `hash` (MD5), `simpleSort`, `escapeHtml`, UTF-16-safe base64 `encoder`/`decoder` for `---enc:` payloads. | Loads **first**. Gains `notEmpty`. Base64 stays here (it is event-payload *transport* encoding, not param parsing — does **not** move to `core.params`). |
| **`core.sections`** | Parses a `.text` into addressable `# Name` sections; powers `[[Title::Section]]`. | **Shrinks to pure section logic** — keeps grammar + `getSection(text, name)`. All title-taking accessors move to `core.tiddlers`. Contract becomes strictly `(text, sectionName)`. |
| **`core.params`** | Macro/widget arg deserializer (`<<W foo:"x" bar:2>>` → object/array; JSON, typing, `${...}` eval). | **Unchanged.** Render-pipeline sibling. Open: gate `${...}` eval under `?safemode`. |
| **`core.dom`** | DOM helpers (`$`/`$$`, `htmlToNode`, `nearest*`, stylesheet/script injection). | **Unchanged.** |
| **`core.notifications`** | `notify(msg,type,stack)` toast with fallbacks. | **Unchanged**; moves **earlier** (ahead of `core.ui`, which calls it on validation failure). |
| **`core.ui`** | HTML-string UI builders + chrome: `button`, `dialog`, expanders, `renderLayout`/`layoutTitleForTheme`. | **Grows most.** Gains event wiring (`wireEvents`/`wireUp`), nav (`navigateTo`, `scrollToTiddler`, `handleHashLink`), link/command grammar (`isLocalLink`, `isCommand`), and the **basic edit round-trip** (`formEdit*`/`formNew*`/`formDone`/`formCancel`, `editTiddlerSection`, `setDirty`+`preventBrowserClose`, validation). |
| **`core.packaging`** | Fetches JSON `{tiddlers:[]}` over HTTP; validates/merges/prunes; honours `$NoImport`/overwrite options. | **Loses store persistence** (to `core.store`). Stays purely HTTP import/merge — its header already describes exactly this. |
| **`core.workspaces`** | Named workspaces under `/ws/<name>/`; **defines `tw.store`** + `tw.workspace`; switch/load/create/clone/delete. | **Stops defining `tw.store`** (→ `core.store`); manages active workspace + hands prefix to `core.store`. Dependency inverts: `core.workspaces → core.store`. |
| **`core.search`** | Ranked substring search + field filters; wires search box + results dropdown. | **Unchanged.** Stays after `core.tiddlers` (needs `tw.run.get`). |
| **`core.templater`** | Pure mustache engine (t.js fork): `new Templater(str).render(vars)`. | **Unchanged — stays a pure library.** Gains nothing. (`loadTemplates` is *not* this; it is app wiring → `core.render`.) Loads early. |

## New core modules

**`core.store`** (NEW) — owns the scoped `tw.store` API and tiddler persistence.

| Group | Functions |
|---|---|
| scoped API | `tw.store.{get,set,delete,keys}`, workspace prefixing, backup logic, `exportRaw`/`importRaw` |
| persist | `save`, `saveSilent`, `saveAll`, `saveVisible` |
| hydrate | `loadStore`, `storeLoadTiddlers` |
| policy | `tiddlersToSave` (`doNotSave` filter), `autoSave` flag |

Depends on `tw.storage` (platform) and `tw.tiddlers`/`addTiddlerHard`/
`tiddlerIsValid` (core.tiddlers).

**`core.tiddlers`** (NEW) — listing, getting, changing; anything taking a title.

| Group | Functions |
|---|---|
| CRUD | `addTiddler`, `addTiddlerHard`, `updateTiddler`, `updateTiddlerHard`, `updateTiddlerText`, `deleteTiddler` |
| get / exists | `getTiddler`, `tiddlerExists`, `getTiddlerElement`, `tiddlerList`, `getTiddlersByPackage`, `getTiddlersByTag` |
| show / hide | `showTiddler`, `hideTiddler`, `closeTiddler`, `showAllTiddlers`, `closeAllTiddlers`, `showTiddlerList` |
| array helpers | `replaceInArray`, `upsertInArray`, `removeFromArray` |
| reference resolution (title → tiddler; delegates slicing to `core.sections`) | `resolveRef`, `getSection(title,…)` wrapper, `sectionTiddler` |
| text accessors (take a title) | `getTiddlerTextRaw`, `getTiddlerTextReplaced`, `getTiddlerTextLines`, `getTiddlerList`, `getTiddlerTextList` |
| text → data (take a title) | `getKeyValuesArray`, `getKeyValuesObject`, `getJSONObject` |
| predicates | `titleIs`, `titleMatch`, `tagMatch`, `isPackageList`, `isCoreTiddler`, `tiddlerIsATemplate`, `tiddlerIsValid`, `emptyTiddler`, `nonExistentTiddler` |
| code-block selection | `tiddlerCodeBlocks`, `isActiveCodeTiddler`, `isRunnableTiddler`, `runTiddlerCode` |
| exposes | `tw.run.{add,update,delete,get}` |

**`core.render`** (NEW) — TWikki render pipeline.

| Group | Functions |
|---|---|
| render | `renderTWikki`, `renderTiddler`, `renderAllTiddlers`, `createTiddlerElement`, `tiddlerDetails`, `loadTemplates` |
| text munging | `maskCodeRegions`, `escapeRegExp`, `replaceFrom`, `getMacros`, `getTiddlerLinks`, `getInclusions` |
| markup | `makeTiddlerText`, `makeTiddlerTagLinks`, `tagPickerHtml` |
| inclusion | `tiddlerSpanInclude`, `macroInclude` |
| glue / fallback | `renderMarkdown` (→ `markdown.render`), `renderPlainText` (safemode fallback) |
| exposes | `tiddler.render` overridable event |

Consumes `core.templater` and `core.params`.

## Platform (what stays)

| Function / object | Role |
|---|---|
| `tw.core={}`, `tw.modules`, `tw.tmp`, `tw.tiddlers`, `tw.templates`, `tw.logging`/`dp` | bootstrap state |
| `tw.storage` (`read`/`write`/`readObject`/`writeObject`) | raw localStorage — pre-module primitive |
| `bootProgress` (NEW) | progress emit (buffer + DOM event) |
| inline `qs` parse | `?safemode`/`?reload`/`?update` before modules exist |
| `fetchCoreModule`, `fetchModule`, `tryFetchModule`, `storeCoreModule`, `isCachedModuleUsable`, `modulesToLoad` | module loader + cache |
| `parseModuleMeta`, `checkModuleCompat`, `checkPluginCompat`, `semver`, `semverCompare`, `caretSatisfies`, `VERSION` | compat **computation** |
| `handleModuleErrors`, `reloadWithoutForce`, `rebootHard` | boot-failure primitives |
| `init`, `onPageLoad`, `reload` (skeleton) | lifecycle orchestration |
| `loadPlugins`, `loadOnePlugin`, `initPlugins`, `startPlugins`, `runScripts` | plugin lifecycle host |
| `executeText`, `executeCodeTiddler` | controlled `eval` boundary |

## Plugins

| Plugin | Absorbs |
|---|---|
| `$BootCompatDialog` (NEW) | `showCompatDialog` + helpers (`cachedSet`, `canKeepCurrent`, `statusText`, `rowBg`, `selectedIndexes`, `refreshInstallBtn`, `render`, `onRecheck`, `onUpdate`, `onKeepCurrent`). Platform keeps only `tw.tmp.bootAborted` + reports; without it a failed module halts with a plain message. (Runs before theme CSS → self-styles.) |
| `$DropZone` (NEW) | `handleDrop`, `showDropOverlay`, `hideDropOverlay`, `globToRegex`, `dropHandlers`, `registerDropHandler` |
| `$CommandPalette` (existing) | `tw.commands`, `registerCommand`, `registerCommandProvider` |
| `$UnsavedChangesPlugin` (existing) | dirty `●` indicator + changed list (subscribes `dirty.changed`) |
| editor niceties | `formHotkeys`, `previewTiddler`, `closePreview`, `renderNewTiddler` |
| `$DevConsole` (NEW, optional) | quarantine `tw.call`; gate `core.params` `${...}` eval under `?safemode` |

## The no-plugin invariant

With zero plugins, or under `?safemode`, TWikki must still: load the
`core.defaults` shadow tiddlers; render tiddlers (`core.render` + markdown via
`$BaseMarkdownPlugin` OR the escaped-plain-text fallback); create / edit /
section-edit / validate / save (`core.ui` + `core.tiddlers` + `core.store`);
navigate and search. A plugin failure may cost shortcuts, preview, the dirty
dot, the rich boot dialog, or drag-and-drop — never the ability to open a tiddler
and save a fix.

## Open edges

- **`formHotkeys`** is wired in the core `wireEvents` block today. When it moves
  to a plugin, ensure the plain edit path (click-to-edit, click-save) is fully
  wired in `core.ui` without it.
- **`core.defaults.json` ordering** — listed after `core.render`, safe because
  render isn't *invoked* until `reload()`. Move it just after `core.dom` if you
  prefer ordering strictly by "could theoretically be called" (pure data, no
  code deps).
- **Two eval surfaces remain:** `executeText` (lifecycle) and `core.params`
  `${...}`. Both load-bearing; decide separately whether to gate under
  `?safemode`. `tw.call` is the disposable one.
- **`core.js` header comment** claims the bus has `---enc:` decoding built into
  `send`; in fact only `tw.events.decode` (called by `sendCommand`) decodes —
  `send` passes params through. Fix the comment while touching the module.
- **Three "store" names** — `tw.storage` (raw) / `tw.store` (scoped) /
  `core.store` (module). Layered correctly but close; keep the layering comment
  above in the module header.
