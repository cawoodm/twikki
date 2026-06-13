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
  │    parse URL params (?safemode, ?reload, ?update, ?trace, ?debug, ?logfilter, ?breakpoint)
  │    set up tw.core / tw.modules / tw.tmp / tw.tiddlers / tw.run / tw.storage
  │    fetch each core module (or use the localStorage cache)
  │    statically parse `const platform` from each module's source
  │    checkModuleCompat → ok / warn / block
  │    [if any block or fresh warn] → showCompatDialog, abort boot
  │    [else] persist fresh modules to localStorage
  │
  └─ twikki.start()                                      twikki.platform.js:185
       │
       ├─ eval each code module's IIFE
       │    → returned {name, version, platform, exports?, run?} merged into tw.core.<sub>
       ├─ list modules (core.defaults.json) push their tiddlers
       │    onto tw.tiddlers.all                         ◄── shadow tiddlers loaded
       │    ($MainLayout, $TiddlerDisplay, $CorePackages, $ExtensionPackages,
       │     $CoreThemeLight/Dark, $BaseVariables, icons, …)
       │
       ├─ tw.core.store.loadStore()                      ◄── workspace tiddlers merged
       │    reads /ws/<workspace>/ keys from localStorage onto tw.tiddlers.all
       │
       ├─ tw.core.ui.wireUpEvents()  — DOM-level handlers
       ├─ each module's optional run() callback fires
       ├─ tw.plugins = []  ;  tw.plugin(name) lookup defined
       │
       └─ onPageLoad()                                   twikki.platform.js:399
            │
            ├─ fire `ui.loading`
            ├─ loadCorePackages()      → loadPackages($CorePackages)
            │    each URL fetched, {tiddlers:[]} merged onto tw.tiddlers.all
            ├─ loadExtensionPackages()                   ◄── extension tiddlers loaded
            │    (skipped under ?safemode)               ── tw.tiddlers.all is now complete
            │
            └─ reload()                                  twikki.platform.js:414
                 │
                 ├─ filter tw.tiddlers.visible to titles that still exist
                 ├─ runCoreTiddlers()                    run code on built-in code-tiddlers
                 │
                 │ ─── plugin lifecycle (skipped under ?safemode) ───
                 ├─ loadPlugins()                        eval every $Plugin tiddler
                 │                                       capture returned {meta, init?, start?}
                 │                                       into tw.plugins[]
                 ├─ initPlugins()                        plugin.init() on each, in store order
                 ├─ startPlugins()                       plugin.start() on each, in store order
                 ├─ runScripts()                         eval every $Script tiddler (one-shot)
                 │
                 ├─ loadTemplates()                      cache HTML templates for macros
                 ├─ process DOM nodes with [tiddler-include] / [macro] attributes
                 ├─ fire `ui.loaded` (first boot) or `ui.reloaded` (hot restart)
                 │
                 └─ renderAllTiddlers()                  ◄── tiddlers rendered
                      clears #visible-tiddlers
                      for each title in tw.tiddlers.visible:
                        showTiddler(title)  → fires `tiddler.rendered` per tiddler
                      fires `story.rendered` at the end
```

## Key invariants

1. **Every tiddler is in `tw.tiddlers.all` before any `$Plugin` code runs.**
   Shadows arrive during `start()` (via list-type modules and `loadStore()`); packaged tiddlers arrive during `onPageLoad → loadCorePackages / loadExtensionPackages`. By the time `reload() → loadPlugins()` fires, the store is complete. A plugin's `init()` can therefore inspect the store freely (e.g. `tw.tiddlers.all`, `tw.run.getTiddler(…)`, `tw.run.getTiddlersByTag(…)`).

2. **Tiddlers are rendered _after_ every plugin has started.**
   `renderAllTiddlers()` is the final step of `reload()` — after `loadPlugins → initPlugins → startPlugins → runScripts → loadTemplates`. Plugins that need to wire DOM behaviour at exactly the right moment subscribe to `ui.loaded` (fired one line before render) and react per-tiddler via `tiddler.rendered`.

3. **The three plugin phases are barriers, not interleaved:**
   - All plugins **load** (IIFE eval'd, return value captured) before any `init()` runs → so `init()` can check deps with `tw.plugin('OtherPlugin')`.
   - All plugins **init** before any `start()` runs → so services registered in `init()` are live when `start()` fires.
   - All plugins **start** before `runScripts()` runs → so `$Script` tiddlers (e.g. `MarcHacks.js`, `$ButtonsFunctions.js`) can rely on `tw.tabs`, `tw.commands`, registered macros, etc. See [PLUGINS.md § Boot flow](./PLUGINS.md).

4. **Within a phase, execution is synchronous and sequential** in `tw.tiddlers.all` order — which is roughly: core shadows first, then `loadStore()` order (workspace), then `$CorePackages` URL order, then `$ExtensionPackages` URL order. No `await` between iterations.

5. **Hot reload re-runs `reload()` entirely.**
   `reload()` is bound to the `ui.reload` event (`tw.events.send('ui.reload')`), so the full plugin lifecycle (load → init → start → scripts → render) can fire multiple times per page lifetime. Plugins that subscribe to global events or add `document.addEventListener` must guard against re-wiring:

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

| Event              | When                                                                   | Payload                     |
| ------------------ | ---------------------------------------------------------------------- | --------------------------- |
| `ui.loading`       | start of `onPageLoad`, before packages are fetched                     | —                           |
| `ui.loaded`        | end of `reload()`, **first** boot only, before `renderAllTiddlers()`   | —                           |
| `ui.reloaded`      | end of `reload()`, every subsequent run                                | boot count                  |
| `tiddler.rendered` | once per tiddler, inside `renderAllTiddlers()` and `rerenderTiddler()` | `{tiddler, newElement}`     |
| `story.rendered`   | end of `renderAllTiddlers()`                                           | `tw.tiddlers.visible` array |
| `reboot.hard`      | request a full `window.location.reload()`                              | —                           |
| `ui.reload`        | request a soft re-run of `reload()`                                    | —                           |

## What the URL query params do at boot

| Param                 | Effect                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `?safemode`           | Skip both `loadExtensionPackages()` and the plugin lifecycle. Only the core modules + `$CorePackages` load. Useful when a plugin/extension package breaks the boot. |
| `?reload` / `?update` | Force-refetch the core modules from the network instead of using the localStorage cache.                                                                            |
| `?trace`              | Strip the `try/catch` around module eval and plugin lifecycle so original stack traces bubble up unhandled. Use when chasing a real bug.                            |
| `?debug`              | Activates verbose `dp()` logging.                                                                                                                                   |
| `?logfilter=<regex>`  | Restrict `dp()` output to messages matching the regex.                                                                                                              |
| `?breakpoint=<regex>` | Break in the debugger on any logging name matching the regex.                                                                                                       |
| `?clear`              | Clear `localStorage` before boot (effectively a factory reset for the current workspace).                                                                           |

## Failure modes

- **Compat block during `init()`** → `showCompatDialog`, boot aborts. The cached set still works; the user can downgrade the source URL or click _Keep current versions_.
- **Module eval throws** (during `start()`) → error collected in `errMsgs`; boot aborts via `handleModuleErrors` which writes a tip page (`document.write`) suggesting `?trace`.
- **Plugin load/init/start throws** → caught per-plugin and recorded on the plugin's `entry.error`; the user is notified (`tw.ui.notify`) and asked whether to disable the plugin via `$CodeDisabled`. The rest of the boot continues — **plugin failures are isolated, module failures are fatal**.
- **`$Script` tiddler throws** → same treatment as plugin errors (notify + offer `$CodeDisabled`).

## Related

- [MODULES.md](./MODULES.md) — what each core module is, the compatibility gate, the cache.
- [PACKAGES.md](./PACKAGES.md) — `$CorePackages` / `$ExtensionPackages` lists, package JSON shape.
- [PLUGINS.md](./PLUGINS.md) — the `{meta, init?, start?}` contract, `$Plugin` vs `$Script`, the plugin registry (`tw.plugins[]`).
