# Plugins

In TWikki there is no special "plugin" format — **a plugin is just a tiddler**. Because *code is data*, any tiddler of type `script/js` is executable, so **installing a plugin means adding a tiddler** and uninstalling means deleting it.

This document is the developer reference. The in-app overview, with the live `<<plugins>>` table, is at [`src/packages/website/Plugins.tid`](../src/packages/website/Plugins.tid).

## How code tiddlers run

A `script/js` tiddler is executed with `eval()` in the **global context** in two cases:

- Once when TWikki starts.
- Again whenever the tiddler is edited and saved — changes take effect immediately.

Code tiddlers are run as part of validation on save: if the code throws, the save reports the error. Tag a code tiddler with `$CodeDisabled` to stop it from executing.

## The basic shape

A simple plugin is an IIFE that hooks into the global `tw` namespace:

```js
(function() {
  tw.events.subscribe('ui.loaded', () => {
    tw.ui.notify('Hello from my plugin!', 'D');
  }, 'MyPlugin');
})();
```

For richer plugins, register through `tw.extensions.registerPlugin(namespace, name, factory)` — the factory returns `{name, init?, start?, …}` and the platform calls `init()` (then `start()`) at boot, with each phase wrapped in try/catch (an error captures on the registry entry; the plugin is disabled but the boot continues).

```js
tw.extensions.registerPlugin('mine', 'Greeter', () => ({
  name: 'Greeter',
  init() { /* one-time wiring */ },
  start() { /* boot-time effects */ },
}));
```

## Multi-section `.tid` plugins

A plugin can ship code, CSS, and metadata in a single multi-section `.tid` file tagged `$Plugin`:

```
tags: $Plugin

# Description
What this plugin does.

# Meta
name: MyPlugin
namespace: base
version: 1.0.0
platform: 0.24.0

# Code
\`\`\`javascript
(function() {
  // … your plugin code …
})();
\`\`\`

# StyleSheet
\`\`\`css
.my-plugin-thing { color: var(--col6); }
\`\`\`
```

The section parser ([`src/modules/core.sections.js`](../src/modules/core.sections.js)) is what makes this work: each `# Heading` opens a section, and leading `key: value` lines inside a section parse as fields (same rules as file-level metadata — `tags:` comma-splits, `true`/`false` coerce). Fenced ` ```lang ` bodies become typed automatically.

## Plugin metadata: the `# Meta` section

The `# Meta` section is the runtime's source of truth for a plugin's identity and platform compatibility. Boot-time `prescanPluginRegistry()` walks every `$Plugin`-tagged tiddler, parses `# Meta` via `core.sections.getSection`, and populates `tw.pluginRegistry[]` (which the `<<plugins>>` macro renders).

### Fields

| Field | Required | Purpose |
|---|---|---|
| `name` | yes | Plugin name. Must match the `name` argument of `registerPlugin` if you use it. |
| `namespace` | yes | Namespace argument of `registerPlugin` (e.g. `base`). |
| `version` | yes | Semver of *this plugin's* API. |
| `platform` | optional | TWikki platform version the plugin was built for; caret-matched against the running `VERSION`. Omit it and the row shows as exempt. |
| `author` | optional | Free text. |
| `description` | optional | One-line summary. |
| `homepage` | optional | URL for further info. |

Unknown fields are kept verbatim on the registry entry, so a future `repositories.json` flow can add `id`, `repo`, `license`, `dependencies`, … without a parser change.

### Where the `# Meta` section lives

- **In a `.tid` source file** — `# Meta` is just another section alongside `# Code`, `# StyleSheet`, `# Description`, etc.
- **In a `.js` source file** — `# Meta` sits inside a `/* … */` block comment, with `# Meta` and the `key: value` lines at column 0. The section parser scans line prefixes; it does NOT interpret JS comment syntax, so `// # Meta` does NOT work:

```js
// tags: $Plugin
/*
# Meta
name: MyPlugin
namespace: base
version: 1.0.0
platform: 0.24.0
*/
tw.extensions.registerPlugin('base', 'MyPlugin', () => ({ ... }));
```

The `// tags: $Plugin` header is consumed by the compiler ([COMPILER.md](./COMPILER.md)) and adds the tag at compile time — without it, the runtime pre-scan skips the file.

## Compatibility: the soft gate

Plugin compat mirrors the module compat tiers (see [MODULES.md](./MODULES.md)) but is **informational only**:

- **✓ OK** — `platform` field present and `caretSatisfies(required, VERSION)` holds.
- **⚠ warn** — same major version but built for a newer minor/patch.
- **✗ block** — different major version — a breaking platform gap.
- **– exempt** — no `platform` field declared.

Unlike modules, a `block`/`warn` plugin still runs. The `<<plugins>>` widget surfaces status so the user can decide to remove or update the plugin. The surrounding try/catch on `init()`/`start()` already isolates failures from boot — a broken plugin is disabled and the boot continues.

## The plugin registry: `tw.pluginRegistry`

A top-level array mirroring `tw.modules[]`. Each entry:

```js
{
  name: 'GithubSaver',                // from # Meta or registerPlugin arg
  namespace: 'base',                  // ditto
  source: '$GithubSaverExtension',    // source tiddler title
  package: 'base',                    // set by core.packaging when the package is loaded
  meta: { version, platform, author, ... },
  compat: { compatible, severity, reason?, required? },
  instance: <ref to tw.plugins[ns][name]> | null,
  error: null | { phase: 'init'|'start', message },
}
```

`tw.plugins[ns][name]` still holds the live plugin instance — existing call-sites don't break. The registry is the new informational layer.

Plugins that ship `# Meta` but never call `registerPlugin` (IIFE-style) keep `instance: null`. Plugins that call `registerPlugin` without the `$Plugin` tag (or without `# Meta`) get an orphan `exempt` entry created on the fly during register.

## Macros and commands

A macro is a `<<...>>` block in markdown that runs and produces dynamic content. Register one with a namespace to avoid collisions:

```js
tw.extensions.registerMacro('greet', 'hello', (name) => {
  return `Hello ${name}!`;
}, {version: '1.0.0'});
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
  myThings().map(t => ({label: `Open: ${t}`, event: 'thing.open', payload: t})));
```

Commands dedupe by `label` (last-wins, so a plugin can override a built-in), and registration is reload-safe.

## Reacting to events

Subscribe to lifecycle events to extend behaviour:

- `ui.loaded` — the UI has finished its first render.
- `tiddler.rendered` — a tiddler was (re)rendered; the handler receives its element.
- `tiddler.updated` / `tiddler.deleted` — the store changed.
- `script.loaded` — an external script you added has finished loading.
- `theme.switch` — the active theme changed.

```js
tw.events.subscribe('tiddler.rendered', ({tiddler, newElement}) => {
  // decorate freshly-rendered tiddlers here
}, 'MyPlugin.HandleRenderedTiddler');
```

Always pass a unique **name** as the third argument so the handler is identifiable and not registered twice when the tiddler re-runs.

## Replacing the markdown renderer

Markdown rendering is itself a plugin. The platform renders tiddlers by sending the `markdown.render` event and using the first handler's result; `$BaseMarkdownPlugin` subscribes the bundled markdown-it implementation. Override from any code tiddler:

```js
tw.events.override('markdown.render', function myMarkdown(text) {
  return MyRenderer.toHtml(text); // must return an HTML string
});
```

Your package's code runs after the base package, so the override wins on every boot and reload. Follow with `tw.events.send('ui.reload')` to re-render. Under `?safemode`, no handler is subscribed and TWikki falls back to escaped plain text.

The default markdown-it instance is exposed as `tw.core.markdown.md`, so you can also *extend* it (e.g. `tw.core.markdown.md.use(...)` — see `$OpenLinksInNewWindow`).

## Loading external libraries

Load a third-party library from a CDN and react when it is ready:

```js
tw.events.subscribe('ui.loaded', () => {
  tw.core.dom.addScript('my-lib', 'https://cdn.example.com/lib.min.js');
  tw.events.subscribe('script.loaded', (name) => {
    if (name === 'my-lib') tw.lib.myLib = window.MyLib;
  }, 'MyPlugin');
}, 'MyPlugin');
```

This is exactly how the built-in syntax-highlighting plugin pulls in Highlight.js.

## Distributing plugins

A plugin is shared like any other tiddler — inside a package (a JSON list of tiddlers). Packages are loaded from the URLs listed in `$CorePackages` and `$ExtensionPackages`, or imported on demand with the `<<packages.import>>` widget. A whole plugin can live in a single multi-section tiddler — see `ExamplePlugin`.

See [PACKAGES.md](./PACKAGES.md) for the packaging model, [COMPILER.md](./COMPILER.md) for the source-file format, and [MODULES.md](./MODULES.md) for the core-module system (which uses a comparable but stricter compatibility model).
