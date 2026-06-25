# Boot order

What runs when, from the moment the page loads to the moment tiddlers appear on screen. For deeper coverage of any one phase see [MODULES.md](./MODULES.md), [PACKAGES.md](./PACKAGES.md), [PLUGINS.md](./PLUGINS.md).

The whole sequence lives in [src/platform/twikki.platform.js](../src/platform/twikki.platform.js) and is triggered by two lines in [src/index.html](../src/index.html):

```html
<script>
  window.addEventListener('load', async () => {
    await window.twikki.init();
    await window.twikki.start();
  });
</script>
```

## Timeline

```
window.load
  │
  ├─ twikki.init()                                       twikki.platform.js:47
  │    parse URL params (?safemode, ?clear, ?trace, ?debug, ?logfilter, ?breakpoint)
  │    set up tw.core / tw.modules / tw.tmp / tw.tiddlers / tw.run / tw.logging
  │
  │    await runBootScript()                             twikki.platform.js:370
  │       eval the /twikki.boot.js localStorage key (if present) BEFORE tw.storage exists
  │       its source evaluates to a function(tw); may assign a custom tw.storage (e.g. IndexedDB)
  │       on parse/throw/reject → alert once + fall back  ── see BootScript.md
  │    if (!tw.storage) tw.storage = initLocalStorage()  ── default backing when no boot script set one
  │
  │    await fetchModules()                              twikki.platform.js:119
  │       sweep legacy /modules/* localStorage keys (no longer used)
  │       fetch each core module's source from <baseUrl>/modules/<name>
  │         (online: network/HTTP cache; offline: service-worker precache)
  │       no localStorage module cache, no version gate — modules ship with the build
  │       on a network error with no precache yet → haltNoModules(), set tw.tmp.bootAborted
  │
  └─ twikki.start()                                      twikki.platform.js:74
       │    bail early if tw.tmp.bootAborted
       │
       ├─ loadModules()                                  twikki.platform.js:236
       │    for each module:
       │      type='code' → eval IIFE; returned {name, version, platform, exports?, run?}
       │                    exports merged into tw.core.<sub>
       │      type='list' → push res.tiddlers onto tw.tiddlers.all ◄── shadow tiddlers loaded
       │                    ($MainLayout, $TiddlerDisplay, $CorePackages,
       │                     $ExtensionPackages, $CoreThemeLight/Dark,
       │                     $BaseVariables, icons, …)
       │    tw.shadowTiddlers = frozen snapshot of tw.tiddlers.all
       │
       ├─ legacyAliases()                                twikki.platform.js:109
       │    tw.ui = {notify, …}  ·  tw.plugins = []  ·  tw.plugin(name)
       │
       ├─ tw.core.store.loadStore()                      core.store.js:109
       │    reads /ws/<workspace>/ keys from localStorage
       │    merges saved tiddlers onto tw.tiddlers.all   ◄── workspace tiddlers loaded
       │
       ├─ tw.events.init()                               core.js
       ├─ tw.core.ui.wireUpEvents()                      core.ui.js:121
       │    bus subscriptions (event → handler):
       │    save / save.auto / ui.open.all / ui.close.all,
       │    tiddler.new / edit / show / close / delete / refresh / edited / created / updated,
       │    section.edit, store.load, form.done / form.cancel,
       │    package.load.url / package.reload.url
       ├─ subscribe `reboot.hard` → rebootHard ; `ui.reload` → reload
       │
       ├─ runModules()                                   twikki.platform.js:208
       │    call module.run() on every module that exposes one
       │
       ├─ document.title = render($SiteTitle)
       ├─ fire `ui.loading`
       ├─ tw.core.ui.wireEvents()                        core.ui.js:159
       │    DOM addEventListener bindings on form elements (#new-form, #new-save, …)
       │
       ├─ await loadCorePackages()                       twikki.platform.js:429
       │    URLs from $CorePackages, fetched via core.packaging,
       │    {tiddlers:[]} merged onto tw.tiddlers.all
       ├─ await loadExtensionPackages()                  twikki.platform.js:434
       │    (skipped under ?safemode)                    ◄── extension tiddlers loaded
       │                                                  ── tw.tiddlers.all is now complete
       │
       └─ reload()                                       twikki.platform.js:400
            │
            ├─ filter tw.tiddlers.visible to titles that still exist
            ├─ tw.core.tiddlers.runCoreTiddlers()        core.tiddlers.js:507
            │
            │ ─── plugin lifecycle (runs even under ?safemode — for whatever ───
            │ ─── $Plugin tiddlers are present; safemode just skips extension packages) ───
            ├─ loadPlugins()                             twikki.platform.js:478
            │    eval every $Plugin tiddler; capture returned {meta, init?, start?}
            │    into tw.plugins[]
            ├─ checkPluginDependencies()                 twikki.platform.js:556
            │    soft check: warn if any plugin's meta.dependencies are missing
            ├─ initPlugins()                             twikki.platform.js:569
            │    plugin.init() on each, in tw.tiddlers.all order
            ├─ startPlugins()                            twikki.platform.js:586
            ├─ runScripts()                              twikki.platform.js:602
            │    eval every $Script tiddler (one-shot, no return, no lifecycle)
            │
            ├─ tw.core.render.loadTemplates()            core.render.js:244
            ├─ process DOM nodes carrying [tiddler-include] / [macro] attributes
            ├─ fire `ui.loaded` (first boot) or `ui.reloaded` (hot restart, payload = boot count)
            │
            └─ tw.core.render.renderAllTiddlers()        core.render.js:200
                 clears #visible-tiddlers
                 for each title in tw.tiddlers.visible:
                   showTiddler(title) → fires `tiddler.rendered` per tiddler  ◄── tiddlers rendered
                 fires `ui.ready` at the end (payload = tw.tiddlers.visible)
```

## Key invariants

1. **Every tiddler is in `tw.tiddlers.all` before any `$Plugin` code runs.**
   Shadows arrive during `start() → loadModules()` (list-type modules) and `tw.core.store.loadStore()` (workspace). Packaged tiddlers arrive immediately after, in `loadCorePackages()` / `loadExtensionPackages()`. By the time `reload() → loadPlugins()` fires, the store is complete — `init()` can freely call `tw.tiddlers.all`, `tw.run.getTiddler(…)`, `tw.run.getTiddlersByTag(…)`.

2. **Tiddlers are rendered _after_ every plugin has started.**
   `renderAllTiddlers()` is the final step of `reload()`. Plugins that need to wire DOM behaviour at exactly the right moment subscribe to `ui.loaded` (fired one line before render) and react per-tiddler via `tiddler.rendered`.

3. **The plugin phases are barriers, not interleaved:**
   - All plugins **load** (IIFE eval'd, return value captured) before any `init()` runs → `init()` can check deps via `tw.plugin('OtherPlugin')`.
   - `checkPluginDependencies()` runs once between load and init — it only **warns** on missing `meta.dependencies`; plugins still init regardless (soft check).
   - All plugins **init** before any `start()` runs → services registered in `init()` are live when `start()` fires.
   - All plugins **start** before `runScripts()` runs → `$Script` tiddlers (e.g. `MarcHacks.js`, `$ButtonsFunctions.js`) can rely on `tw.tabs`, `tw.commands`, registered macros, etc. See [PLUGINS.md § Boot flow](./PLUGINS.md).

4. **Within a phase, execution is synchronous and sequential** in `tw.tiddlers.all` order — roughly: shadows first, then `loadStore()` order (workspace), then `$CorePackages` URL order, then `$ExtensionPackages` URL order. No `await` between iterations.

5. **Hot reload re-runs `reload()` entirely.**
   `reload()` is bound to the `ui.reload` event (`tw.events.send('ui.reload')`), so the full plugin lifecycle (load → init → start → scripts → render) can fire multiple times per page lifetime. Plugins that subscribe to global events or call `document.addEventListener` must guard against re-wiring:

   ```js
   init() {
     if (tw.tmp.fooBound) return;
     tw.tmp.fooBound = true;
     document.addEventListener('click', onFooClick);
     // …
   }
   ```

   This is the standard idiom — see `PickerPlugin/Picker.js` and `CommandPalettePlugin/CommandPalette.js`. The first boot fires `ui.loaded`; every subsequent `reload()` fires `ui.reloaded` (with the boot count) so plugins can also distinguish first vs. subsequent runs that way.

## Lifecycle events the platform fires

| Event              | When                                                                                   | Payload                     |
| ------------------ | -------------------------------------------------------------------------------------- | --------------------------- |
| `ui.loading`       | early in `start()`, before any package is fetched                                      | —                           |
| `ui.loaded`        | end of `reload()`, **first** boot only, before `renderAllTiddlers()`                   | —                           |
| `ui.reloaded`      | end of `reload()`, every subsequent run                                                | boot count                  |
| `tiddler.rendered` | once per tiddler, inside `renderAllTiddlers()` / `showTiddler()` / `rerenderTiddler()` | `{tiddler, newElement}`     |
| `ui.ready`         | end of `renderAllTiddlers()`                                                           | `tw.tiddlers.visible` array |
| `story.changed`    | a tiddler was hidden / closed (visible set shrank)                                     | title                       |
| `reboot.hard`      | request a full `window.location.reload()`                                              | —                           |
| `ui.reload`        | request a soft re-run of `reload()`                                                    | —                           |

## What the URL query params do at boot

| Param                 | Effect                                                                                                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `?safemode`           | Skip `loadExtensionPackages()`. The core modules and the **base** package (its plugins, listed in `$CorePackages`) still load; only the **extension** packages (`$ExtensionPackages`) are skipped. Useful when an extension package breaks the boot. |
| `?trace`              | Strip the `try/catch` around module eval, plugin lifecycle, and `$Script` exec so original stack traces bubble up unhandled.                                                                                                                         |
| `?debug`              | Activates debug toast notifications                                                                                                                                                                                                                  |
| `?logfilter=<regex>`  | Restrict `dp()` output to messages matching the regex. "." shows everything                                                                                                                                                                          |
| `?breakpoint=<regex>` | Break in the debugger on any logging name matching the regex.                                                                                                                                                                                        |
| `?clear`              | Clear `localStorage` before boot (effectively a factory reset for the current workspace).                                                                                                                                                            |

## Failure modes

- **Core modules can't be fetched** (network error with no service-worker precache yet, e.g. first-ever visit offline) → `haltNoModules()` shows a plain "cannot load" message and boot aborts. Once loaded, the precache lets TWikki boot offline. There is no module version gate: core modules ship with the build, so they can't be out of step with the platform.
- **Module eval throws** (`loadModules` / `runModules`) → error collected in `errMsgs`; boot aborts via `handleModuleErrors` which writes a tip page (`document.write`) suggesting `?trace`. `handleModuleErrors` returns `true` when it has aborted, so the calling function bails early.
- **Plugin load / init / start throws** → caught per-plugin and recorded on the plugin's `entry.error`; the user is notified (`tw.ui.notify`) and asked whether to disable the plugin via `$CodeDisabled`. The rest of the boot continues — **plugin failures are isolated, module failures are fatal**.
- **`$Script` tiddler throws** → same treatment as plugin errors (notify + offer `$CodeDisabled`).
- **Missing `meta.dependencies`** → warns to console + sets `plugin.missingDependencies`; the plugin still initialises. The `<<plugins>>` widget surfaces the warning so the user can act.

## Related

- [BootScript.md](./BootScript.md) — the pre-boot `/twikki.boot.js` hook that runs inside `init()` before `tw.storage` exists; the contract and a worked IndexedDB-backed storage example.
- [MODULES.md](./MODULES.md) — what each core module is and how they ship with the build (service-worker-cached, no version gate).
- [PACKAGES.md](./PACKAGES.md) — `$CorePackages` / `$ExtensionPackages` lists, package JSON shape, how URLs resolve.
- [PLUGINS.md](./PLUGINS.md) — the `{meta, init?, start?}` contract, `$Plugin` vs `$Script`, the plugin registry (`tw.plugins[]`), `<<pluginMeta>>` macro.
