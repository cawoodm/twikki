# Modules & Packages

How TWikki's code and content units are authored, compiled, fetched, cached, executed, updated, and refreshed.

> For the source-to-JSON compile step itself (file format, auto-tags, type mapping, Vite hooks) see [COMPILER.md](./COMPILER.md). This document covers what happens **after** compilation — the runtime side — and only references the compiler where the two meet.

The runtime lives in [src/platform/twikki.latest.js](../src/platform/twikki.latest.js). There is no bootloader or ESM: [src/index.html](../src/index.html) loads that one file with a plain `<script>` tag and then calls `window.twikki.init()` followed by `window.twikki.start()` on `load`.

## Two things called "modules"

The word "module" is overloaded in this codebase. Keep the two senses distinct:

| | **Core modules** | **Packages** |
| --- | --- | --- |
| What | The platform's own subsystems (`tw.core.*`) and built-in shadow tiddlers | Bundles of content/feature tiddlers (themes, demos, the website, icons) |
| Listed in | The hard-coded `modulesToLoad` array (`twikki.latest.js` ~line 86) | The `$CorePackages` / `$ExtensionPackages` shadow-tiddler lists |
| Loaded by | `init()` → `loadCoreModule` | `onPageLoad()` → `loadCoreModules` / `loadExtensionPackages` → `tw.core.packaging.loadPackageFromURL` |
| Served from | `<baseUrl>/modules/<name>` | a full URL per line (e.g. `…/packages/themes.json`) |
| Cached in localStorage | Yes, under `/modules<name>` (code modules only — see below) | No — only the imported tiddlers persist, in the workspace store |
| Source | loose `src/modules/*.js` + `src/modules/core.defaults/` | `src/packages/<pkg>/` |

The rest of this document follows the lifecycle of each.

---

## Core modules

### What gets loaded

`init()` loads a fixed list (`twikki.latest.js` ~line 86):

```js
let modulesToLoad = [
  '/core.js', '/core.common.js', '/core.workspaces.js',
  '/core.defaults.json',                 // ← JSON, not JS
  '/core.packaging.js', '/core.params.js', '/core.dom.js', '/core.ui.js',
  '/core.notifications.js', '/core.templater.js', '/core.search.js', '/core.markdown.js',
];
```

Each entry is fetched from `<baseUrl>/modules<name>`. Note one entry — `/core.defaults.json` — is a JSON list, not JavaScript; this distinction drives everything below.

### baseUrl resolution

`init()` resolves where modules are fetched from from a single source — the module URL — with one dev exception:

```
baseUrl = MODULE_URL                       // platform constant, mirrors $GeneralSettings.urls.moduleUrl
if (host is localhost | IP:port)
  baseUrl = location.origin                // dev: load from the dev server, not the published copy
```

There is **no** query-string override (`?pUrl`/`?url`) and **no** `/base.url` localStorage key any more — both were removed. The canonical home of the value is the `urls.moduleUrl` field of the `$GeneralSettings` shadow tiddler (default `https://cawoodm.github.io/twikki`), where it is visible and editable in the Settings dialog.

> **Why a constant and not the setting directly?** `baseUrl` is needed to fetch the core modules, and `$GeneralSettings` is *inside* `core.defaults.json` — one of those modules. The platform therefore can't read the setting before the first fetch (a bootstrap chicken-and-egg), so the published default is carried as the `MODULE_URL` constant in `twikki.latest.js`, kept in sync with the shadow default. The related `urls.themeUrl` has no such constraint: the Theme Importer reads it from the live `$GeneralSettings` after load, so that one is fully driven by the setting.

### Fetch, classify, cache

`loadCoreModule(moduleName)` is the cache gate:

```js
async function loadCoreModule(moduleName) {
  let res = readObject('/modules' + moduleName);          // localStorage
  if (!res?.code || qs.reload || qs.update) res = await fetchModule(moduleName);
  writeObject('/modules' + moduleName, res);              // re-cache
  return res;
}
```

`fetchModule` does an HTTP `fetch` and classifies by `Content-Type`:

| Content-Type contains | Result | `type` |
| --- | --- | --- |
| `/javascript` | `{code: <source text>}` | `'code'` |
| `application/json` | the parsed object (`{tiddlers: […]}`) | `'list'` |
| anything else | throws `MODULE_FORMAT_UNKNOWN` | — |

> **Cache subtlety worth internalizing.** The cache-hit condition is `!res?.code`. A cached **code** module has a `.code` property, so it is served from localStorage and *not* re-fetched. A cached **list** module (`core.defaults.json`) has `.tiddlers` but no `.code`, so `!res?.code` is always true and it is **re-downloaded on every boot**. The write-back still happens, but the read guard ignores it. In short: JS core modules are cached; JSON list modules effectively are not.
>
> **Dev gotcha that follows from this:** editing a loose `src/modules/core.*.js` file and reloading the browser will *not* pick up your change — the old copy is still in localStorage. Append `?reload` (or `?update`) to force a re-fetch, or clear localStorage. Editing `core.defaults` content does take effect on a plain reload, because list modules bypass the cache.

### Installing & running (in `start()`)

`start()` walks `tw.modules` and dispatches on `type`:

- **`type === 'code'`** — the source string is evaluated with the indirect-eval pattern `(1, eval)(pck.res.code)(tw)`, which runs it at global scope and passes the `tw` namespace in. The module's IIFE returns `{name, version, exports, run}`. If `exports` is present, it is merged onto `tw.<name>` (e.g. `tw.core.markdown`). See the [module contract in CLAUDE.md](../CLAUDE.md).
- **`type === 'list'`** — each tiddler is flagged `doNotSave = true` and `isRawShadow = true`, then concatenated into `tw.tiddlers.all`. These become the built-in shadow tiddlers (`$MainLayout`, `$CorePackages`, etc.).

By default each module is wrapped in `try/catch` so one failure surfaces a friendly "Module Errors Occurred" page (with `?trace`/`?update`/`?reload` tips) rather than a blank screen. Launch with `?trace` to disable the wrapping and get a real stack trace.

After all modules are installed, the shadow tiddlers are snapshotted into `tw.shadowTiddlers` and `Object.freeze`d, the store is loaded, events are wired, and every module exposing a `run()` hook is invoked.

---

## Packages

Packages are loaded **later**, during `onPageLoad()` (called at the end of `start()`), and only after the core modules exist — because the package URLs themselves live in shadow tiddlers that the core modules provided.

```
onPageLoad()
  ├─ loadCoreModules()        → reads $CorePackages list
  └─ loadExtensionPackages()  → reads $ExtensionPackages list   (skipped under ?safemode)
```

### The package lists

`$CorePackages` and `$ExtensionPackages` are shadow tiddlers of `type: list`. Each line is a bullet of the form `<url> [options]`:

```
* https://cawoodm.github.io/twikki/packages/base.json force
* https://cawoodm.github.io/twikki/packages/website.json nooverwrite
```

`loadPackages` parses each line: the first token is the URL, the remaining comma/space-separated tokens are options.

| Option | Effect |
| --- | --- |
| `force` | overwrite existing tiddlers silently |
| `nooverwrite` | never overwrite an existing tiddler; skip silently |
| `nosave` | mark imported tiddlers `doNotSave` (live for this session, not persisted) |

### Localhost rewriting

During `start()` (~lines 156–157), if the host is `localhost` or a bare `IP:port`, every `https://cawoodm.github.io/twikki` occurrence inside `$CorePackages`/`$ExtensionPackages` is rewritten to `http://<current-host>`. This is what makes `npm run dev` load the in-repo packages from the Vite dev server instead of the published copies.

### Fetch & merge

`tw.core.packaging.loadPackageFromURL` (in [src/modules/core.packaging.js](../src/modules/core.packaging.js)) `fetch`es the JSON, then `loadList` merges its tiddlers into the store:

- Tiddlers belonging to the package but absent from the new list are deleted (keeps the package in sync with its source).
- For each incoming tiddler: validate → respect `nooverwrite` → if it would overwrite a *user-modified* (non-`$NoImport`, non-shadow) tiddler and `force` is not set, **prompt** the user via `confirm()`.
- Surviving tiddlers are stamped with `t.package = name` and added/updated in the store.

> Packages are **not** cached in localStorage the way code modules are. `loadPackageFromURL` does a plain `fetch` each boot (subject to the browser's own HTTP cache). What persists across reloads is the *result*: the imported tiddlers saved into the workspace store (unless `nosave`/`doNotSave`).

---

## Where state is cached (localStorage map)

| Key | Written by | Holds |
| --- | --- | --- |
| `/modules<name>` | `loadCoreModule` | cached core module (`{code,type}` or `{tiddlers,type}`) — see cache subtlety above |
| `/ws/<workspace>/tiddlers` | workspace store | the saved tiddler set for a workspace |
| `/ws/<workspace>/tiddlers-visible` | workspace store | which tiddlers are open |
| `/ws/<workspace>/tiddlers-trashed` | workspace store | the trash |
| `workspace`, `workspaces` | [core.workspaces.js](../src/modules/core.workspaces.js) | active workspace name + list |

Tiddler content is namespaced **per workspace** under `/ws/<name>/…` (see `workspaceSwitch` in `core.workspaces.js`), so switching workspaces swaps the whole store. `loadStore()` reads the active workspace's tiddlers and back-fills any missing shadow tiddlers from the frozen `tw.shadowTiddlers` snapshot.

---

## Updating & refreshing

There are three distinct "refresh" levels — know which one you need.

### 1. Force re-download of core modules — `?reload` / `?update`

Both flags do the same thing in `loadCoreModule`: they bypass the localStorage cache and re-`fetch` every core module from `baseUrl`. Use this after editing a loose `src/modules/core.*.js` file, or when a cached module is stale/corrupt. (`?update` is also the link suggested on the error page.)

### 2. Soft reload — `reload()` / the `ui.reload` event

`reload()` (a platform function, also exposed as `tw.run.reload` and the `ui.reload` event) re-runs core + extension tiddlers, re-initialises plugins, reloads templates, and re-renders the DOM. It does **not** hit the network or re-fetch modules — it re-evaluates what's already in memory. This is the everyday "apply changes" path (e.g. after importing a package, `reloadPackageFromUrl` sends `ui.reload`).

### 3. Hard reboot — `rebootHard()` / the `reboot.hard` event

`rebootHard()` is simply `window.location.reload()` — a full browser reload that re-runs `init()` + `start()` from scratch. Used, for example, after a workspace switch (because the shadow-tiddler snapshot is frozen and can't be mutated in place).

### Disabling extensions — `?safemode`

`?safemode` skips `loadExtensionPackages()` and the extension/plugin steps inside `reload()`. Use it when an extension package is breaking the boot, to get to a working core.

### Dev-server auto-refresh

Under `npm run dev` the two Vite plugins in [vite.config.js](../vite.config.js) cooperate: the tiddler-compile plugin recompiles the affected `public/.../<pkg>.json` on any source change, and the small `reload` plugin watches for `.json` writes and pushes a `{type:'full-reload'}` over the dev WebSocket. The browser reloads — but remember that reload is a plain reload, so **cached JS core modules are not refreshed** by it (see the dev gotcha above); package JSON and `core.defaults` content are.

### Clearing the cache

> ⚠️ CLAUDE.md lists a `?clear` query param "clear localStorage", but **that handler is not implemented** in the current `twikki.latest.js`. To clear cached modules/state today, clear the site's localStorage manually (DevTools → Application → Local Storage) or remove the specific `/modules…` keys. (`?reload`/`?update` is enough to refresh modules without wiping user data.)

---

## Debugging query params

Useful when the platform's `try/catch` swallows an error:

| Param | Effect |
| --- | --- |
| `?trace` | disable module `try/catch` so real stack traces surface |
| `?debug` | enable `console.debug` (suppressed by default) |
| `?reload` / `?update` | force re-download of core modules instead of using the localStorage cache |
| `?safemode` | skip extension-package loading |
| `?logfilter=regex` / `?breakpoint=regex` | filter `dp()` logs / break on matching event names |

---

## Lifecycle at a glance

```
index.html  ──<script>──▶  twikki.latest.js
   │
   ├─ init()
   │    ├─ resolve baseUrl  (MODULE_URL constant; localhost → location.origin)
   │    └─ loadCoreModule() ×N
   │          readObject('/modules<name>')
   │          └─ !code || ?reload || ?update → fetchModule()  (JS→code, JSON→list)
   │
   └─ start()
        ├─ install modules:  code → (1,eval)(code)(tw) → tw.core.*
        │                    list → merge shadow tiddlers
        ├─ freeze shadow snapshot, loadStore(), wireUpEvents()
        ├─ run() hooks
        └─ onPageLoad()
             ├─ loadCoreModules()        ← $CorePackages   ─┐
             ├─ loadExtensionPackages()  ← $ExtensionPackages├─ fetch JSON, loadList → store
             │     (skipped under ?safemode)                 ┘
             └─ reload()  → render

   refresh:  reload()  (soft, in-memory)
             rebootHard() = location.reload()  (re-runs init+start)
             ?reload / ?update  (re-fetch core modules)
```

## Invariants worth remembering

- **Core modules ≠ packages.** Core modules are the hard-coded `modulesToLoad`; packages come from the `$CorePackages`/`$ExtensionPackages` lists. Different loaders, different caching.
- **JS core modules are cached in localStorage; JSON list modules are not** (the `!res?.code` guard). Editing a loose JS module needs `?reload` to take effect.
- **No ESM in modules.** Code modules are strings `eval`'d at global scope — never add `import`/`export` to files under `src/modules/` or `src/packages/<pkg>/`.
- **Adding a package** = create `src/packages/<name>/` (compiler discovers it) **and** add its URL line to `$ExtensionPackages`. The directory alone isn't enough; the runtime only loads what's listed.
- **`public/modules/` and `public/packages/` are gitignored build artifacts** — the runtime fetches those, never the loose source files. See [COMPILER.md](./COMPILER.md).
