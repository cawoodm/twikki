# Plugins and Scripts

TWikki has no special "plugin" format — extensions are just tiddlers. Two tags distinguish how their code runs:

- **`$Plugin`** — a structured plugin with a lifecycle (`init` / `start`). Its IIFE returns `{meta, init?, start?}` and the platform calls the lifecycle hooks.
- **`$Script`** — a code tiddler that just runs at boot. No return value expected, no lifecycle. Use this for macros, commands, event subscriptions, one-shot setup.

Tiddlers without either tag never auto-execute. The in-app overview is at [`src/packages/website/Plugins.tid`](../src/packages/website/Plugins.tid); this document is the developer reference.

## Boot flow

```
loadPlugins()     // eval every $Plugin tiddler's IIFE; capture the returned {meta, init?, start?} into tw.plugins[]
initPlugins()     // call init() on every plugin (after all plugins are loaded)
startPlugins()    // call start() on every plugin (after all inits complete)
runScripts()      // eval every $Script tiddler's code (after all plugins are started)
```

Why the order matters:

- Every plugin **loads** before any `init` runs, so a plugin's `init()` can safely check that another plugin is loaded (`tw.plugin('SomeDep')`).
- Every plugin **inits** before any `start` runs, so wiring is complete before boot-time effects fire.
- `runScripts` runs **last**, so script-tagged code can rely on plugin services already being live.

`$CodeDisabled` excludes a tiddler from any of these phases (it never runs).

## Plugin contract — what your IIFE must return

```js
(function () {
  return {
    meta: {
      name: 'MyPlugin',          // required, must be unique across loaded plugins
      version: '1.0.0',          // required
      platform: '0.24.0',        // optional — caret-checked against running platform
      description: '…',          // optional
      author: '…',               // optional
      url: 'https://…',          // optional homepage / install source
      // any other field is kept verbatim on the registry entry
    },
    init() {
      // Runs after every $Plugin has been loaded. Right place for:
      //   - tw.events.subscribe / document.addEventListener (one-time wiring)
      //   - tw.extensions.registerMacro / registerCommand
      //   - dependency checks: if (!tw.plugin('SomeDep')) throw new Error('…');
      // Throwing here marks this plugin as errored — its start() will be skipped,
      // and the row in <<plugins>> shows the message. Other plugins are unaffected.
    },
    start() {
      // Optional. Runs after all inits complete. Right place for boot-time effects
      // that need the wiring already in place (kick off initial render, fetch data, …).
    },
  };
})();
```

The shape mirrors how core modules return `{name, version, platform, exports?, run?}` from `src/modules/*.js`. The `name`/`version` live one level deeper (under `meta`) for plugins because plugins also carry richer metadata.

## Multi-section `.tid` plugins

A plugin can ship code, CSS, and prose in a single `.tid` file tagged `$Plugin`:

```
tags: $Plugin

# Description
What this plugin does.

# Code
~~~javascript
(function () {
  return {
    meta: { name: 'MyPlugin', version: '1.0.0', platform: '0.24.0' },
    init() { … },
    start() { … },
  };
})();
~~~

# StyleSheet
~~~css
.my-plugin-thing { color: var(--col6); }
~~~
```

The section parser ([`src/modules/core.sections.js`](../src/modules/core.sections.js)) detects each `# Heading` and routes the fenced ` ```lang ` body to a tiddler of the matching type. The `# Code` section is what `loadPlugins()` evals; its return value becomes the plugin. The `# StyleSheet` section is collected into the theme's `plugin` cascade layer (see [THEMES.md](./THEMES.md)).

## `.js` plugins

For single-file `.js` plugins, the `// tags: $Plugin` header is consumed by the [compiler](./COMPILER.md) and adds the tag at compile time:

```js
// tags: $Plugin
(function () {
  return {
    meta: { name: 'MyPlugin', version: '1.0.0', platform: '0.24.0' },
    init() { … },
    start() { … },
  };
})();
```

Without the tag, the runtime ignores the file completely.

## `$Script` — code with no lifecycle

For tiddlers that just need to run at boot — register a macro, subscribe to an event, set up some `tw.macros.*` — `$Script` is the right tag. No return value, no lifecycle:

```js
// tags: $Script
tw.extensions.registerMacro('greet', 'hello', (name) => `Hello ${name}!`);
tw.events.subscribe('ui.loaded', () => console.log('UI ready'));
```

Scripts run **after** `startPlugins()`, so by the time your script's body executes, every plugin's `init()` and `start()` have already run. That makes it safe to reference plugin-exposed services (`tw.tabs`, `tw.core.markdown.md`, `tw.macros.backup`, …).

If you need to depend on a `$Script`'s side effect from inside a plugin's `init()`, you have a phase-order problem — turn the script into a `$Plugin` and put its setup in `init()`.

## Compatibility: the soft gate

`meta.platform` is caret-checked against the running platform version. The `<<plugins>>` widget surfaces the status; status is **informational only**:

- **✓ OK** — platform field present and `caretSatisfies(meta.platform, VERSION)` holds.
- **⚠ warn** — same major version but built for a newer minor/patch.
- **✗ block** — different major version — a breaking platform gap.
- **– exempt** — no `platform` field declared.

Unlike modules, even a `block`/`warn` plugin still runs (`init`/`start` are still called). The surrounding try/catch isolates failures from boot — a broken plugin is marked errored and the boot continues. The widget surfaces status so the user can decide to remove or update.

## The plugin registry: `tw.plugins`

A flat array. Each entry:

```js
{
  meta: { name, version, platform?, description?, author?, url?, dependencies?: string[], ... },
  init: fn | undefined,
  start: fn | undefined,
  source: '$MyPlugin.tid',        // source tiddler title
  package: 'base',                // set by core.packaging when the package is loaded
  compat: { compatible, severity, reason?, required? },
  missingDependencies: undefined | string[],  // set when meta.dependencies aren't all present
  error: null | { phase: 'load'|'init'|'start', message },
}
```

`tw.plugin(name)` looks up an entry by `meta.name` — use this for dependency checks inside `init()`. The array order is loading order (whatever order `tw.tiddlers.all` exposes the `$Plugin`-tagged tiddlers in).

### Dependencies (soft)

A plugin may declare `meta.dependencies: ['Picker', 'Tabs']` — names of other plugins (matched against `meta.name`) it relies on. Between `loadPlugins()` and `initPlugins()` the platform checks each declared dep is present; missing ones land on the entry as `missingDependencies` and produce a console warning. **The plugin still runs** — this is a soft signal for the `<<plugins>>` widget and for users who removed a dependency without removing its dependent. For runtime checks inside `init()` (e.g. branching behaviour), keep using `tw.plugin(name)`.

## Macros and commands

A macro is a `<<...>>` block in markdown that runs and produces dynamic content. Register one with a namespace to avoid collisions (call from inside `init()` for plugins, top-level for `$Script`):

```js
tw.extensions.registerMacro('greet', 'hello', (name) => `Hello ${name}!`, {version: '1.0.0'});
```

Use as `<<greet.hello "Marc">>`.

Commands appear in the command palette (Ctrl/Cmd+K). A command is `{label, event?, payload?, run?}`:

```js
tw.extensions.registerCommand({label: 'Save all', event: 'save.all'});
tw.extensions.registerCommand({label: 'Say hi', run: () => tw.ui.notify('Hi!', 'D')});
```

For lists that change at runtime (themes, workspaces, …), register a keyed provider that re-evaluates each time the palette opens:

```js
tw.extensions.registerCommandProvider('myThings', () =>
  myThings().map((t) => ({label: `Open: ${t}`, event: 'thing.open', payload: t})));
```

Commands dedupe by `label` (last-wins, so a plugin can override a built-in).

## Editing a plugin at runtime

Plugin code is bound at boot — event subscriptions and DOM listeners live on the original factory's instance. Re-evaluating a plugin's code mid-session would leak duplicates while the old instance keeps running, so the platform takes a different route:

- Editing and saving a **`$Plugin`** tiddler **skips re-execution** and prompts: *"Plugin <name> was edited. Reload now to apply changes?"* — choose Yes to reboot with the new code, No to defer.
- Editing and saving a **`$Script`** tiddler re-runs the code immediately (same behaviour as before this change). Macros and event handlers are re-registered live.

## Reacting to events

Subscribe to lifecycle events from your plugin's `init()`:

- `ui.loaded` — first render done.
- `tiddler.rendered` — a tiddler was (re)rendered; the handler receives `{tiddler, newElement}`.
- `tiddler.updated` / `tiddler.deleted` — store changed.
- `script.loaded` — an external script you added has finished loading.
- `theme.switch` — active theme changed.

```js
init() {
  tw.events.subscribe('tiddler.rendered', ({tiddler, newElement}) => {
    // decorate freshly-rendered tiddlers here
  }, 'MyPlugin.HandleRenderedTiddler');
}
```

Always pass a unique handler **name** as the third argument so the platform can identify and dedupe it.

## Replacing the markdown renderer

Markdown rendering is itself a plugin. The platform renders tiddlers by sending the `markdown.render` event and using the first handler's result; `$BaseMarkdownPlugin` subscribes the bundled markdown-it implementation. Override from any plugin's `init`:

```js
init() {
  tw.events.override('markdown.render', function myMarkdown(text) {
    return MyRenderer.toHtml(text); // must return an HTML string
  });
}
```

Under `?safemode`, no handler is subscribed and TWikki falls back to escaped plain text.

The default markdown-it instance is exposed as `tw.core.markdown.md`, so you can also *extend* it (e.g. `tw.core.markdown.md.use(...)` — see `$OpenLinksInNewWindow`).

## Loading external libraries

Load a third-party library from a CDN and react when it is ready:

```js
init() {
  tw.events.subscribe('ui.loaded', () => {
    tw.core.dom.addScript('my-lib', 'https://cdn.example.com/lib.min.js');
    tw.events.subscribe('script.loaded', (name) => {
      if (name === 'my-lib') tw.lib.myLib = window.MyLib;
    }, 'MyPlugin');
  }, 'MyPlugin');
}
```

This is exactly how the built-in syntax-highlighting plugin pulls in Highlight.js.

## Distributing plugins

A plugin (or script) is shared like any other tiddler — inside a package (a JSON list of tiddlers). Packages are loaded from the URLs listed in `$CorePackages` and `$ExtensionPackages`, or imported on demand with the `<<packages.import>>` widget. A whole plugin can live in a single multi-section tiddler — see `ExamplePlugin`.

See [PACKAGES.md](./PACKAGES.md) for the packaging model, [COMPILER.md](./COMPILER.md) for the source-file format, and [MODULES.md](./MODULES.md) for the core-module system (which uses a comparable but stricter compatibility model).
