# Events

TWikki's event bus (`tw.events`) is the main integration seam between core modules and plugins. It is a synchronous pub/sub system with four dispatch modes and a duplicate-handler guard. The bus is initialised by `core.js` and available on `tw.events` from that module forward.

## API

### `tw.events.subscribe(event, handler, owner?)`

Register `handler` to be called whenever `event` is sent. `owner` defaults to `handler.name` and is used to prevent registering the same logical handler twice for the same event (soft dedup — a warning is printed and the second registration is silently dropped).

```js
tw.events.subscribe('tiddler.show', title => console.log('Showing:', title), 'MyPlugin.show');
```

### `tw.events.send(event, params)`

Broadcast to **all** subscribers. All handlers run; returns an array of their return values. `params` is spread as positional arguments if it is an array, otherwise passed as a single argument.

```js
tw.events.send('tiddler.show', 'Welcome');
```

### `tw.events.request(event, params)`

Like `send`, but stops at the **first handler that returns a non-null/undefined value** and returns that value. Handlers that throw are caught and skipped. Use this for optional overrides where only one provider should win.

```js
const html = tw.events.request('renderer.override', {tiddler, text});
// html is undefined if no handler claimed it
```

### `tw.events.filter(event, value, ctx?)`

Chain `value` through every subscriber in registration order. Each handler receives `(currentValue, ctx)` and returns the next value. A handler that returns `undefined` is a no-op (value passes through unchanged); returning `''` explicitly sets value to empty. Handlers that throw are caught and skipped.

```js
const processed = tw.events.filter('renderer.pre', rawText, {tiddler});
```

### `tw.events.override(event, handler)`

Remove **all** existing handlers for `event` and register `handler` as the sole handler. Use this when your plugin is a complete replacement, not an addition (e.g. swapping the markdown renderer).

```js
tw.events.override('markdown.render', text => myRenderer.render(text));
```

---

## Dispatch modes at a glance

| Mode       | Method     | When to use                                   |
| ---------- | ---------- | --------------------------------------------- |
| Broadcast  | `send`     | Notify all subscribers; results collected     |
| First-wins | `request`  | Optional override; first non-null result wins |
| Chain      | `filter`   | Transform a value through a pipeline          |
| Replace    | `override` | Swap out all existing handlers entirely       |

---

## Hooking into events from a plugin

Subscribe in your plugin's `init()` phase so the handler is registered before boot-time events fire:

```js
(function () {
  return {
    meta: {name: 'MyPlugin', version: '1.0.0'},
    init() {
      tw.events.subscribe(
        'tiddler.created',
        title => {
          console.log('New tiddler:', title);
        },
        'MyPlugin.tiddlerCreated',
      );
    },
  };
})();
```

Use `override` to replace an existing behaviour entirely:

```js
init() {
  // Replace the default markdown renderer with a custom one
  tw.events.override('markdown.render', text => myMarkdownLib.render(text));
}
```

Use `filter` subscribers to transform content in the render pipeline without replacing it:

```js
init() {
  // Strip all TODO comments before text reaches the renderer
  tw.events.subscribe('renderer.pre', (text, {tiddler}) => {
    return text.replace(/^TODO:.*/gm, '');
  }, 'MyPlugin.stripTodos');
}
```

---

## Triggering events from HTML — the `msg:` command grammar

Any URL hash or `data-msg` attribute can trigger an event. The format is:

```
msg:<event>:<params>
```

Params can be a bare string, a JSON object, or key:value pairs:

| Link                         | Equivalent call                                |
| ---------------------------- | ---------------------------------------------- |
| `#msg:tiddler.show:Welcome`  | `tw.events.send('tiddler.show', 'Welcome')`    |
| `#msg:tiddler.new`           | `tw.events.send('tiddler.new')`                |
| `#msg:ui.open.all:tag:Help`  | `tw.events.send('ui.open.all', {tag: 'Help'})` |
| `#msg:workspace.create:MyWS` | `tw.events.send('workspace.create', 'MyWS')`   |

---

## Event reference

### Render pipeline

These three events form the render pipeline called for every tiddler. Use `renderer.pre`/`renderer.post` to transform content without replacing the renderer; use `renderer.override` to provide an entirely custom renderer.

| Event               | Mode    | Params              | Description                                                                                                                                                |
| ------------------- | ------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderer.pre`      | filter  | `(text, {tiddler})` | Transform raw stored text before rendering. Return `undefined` to pass through unchanged.                                                                  |
| `renderer.override` | request | `({tiddler, text})` | Provide a complete renderer. Return HTML to claim the event; return `undefined`/`null` to defer to core. The `text` here is the post-`renderer.pre` value. |
| `renderer.post`     | filter  | `(html, {tiddler})` | Transform rendered HTML before it is inserted into the DOM.                                                                                                |
| `markdown.render`   | send    | `(text)`            | Convert markdown text to HTML. The first subscriber's return value is used. Use `override` to replace the default `$BaseMarkdownPlugin`.                   |

### Tiddler lifecycle

| Event                     | Params                      | Description                                                                                                                |
| ------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `tiddler.new`             | —                           | Open the new-tiddler form.                                                                                                 |
| `tiddler.edit`            | `title`                     | Open the edit form for `title`.                                                                                            |
| `tiddler.created`         | `title`                     | A new tiddler was saved. Triggers render.                                                                                  |
| `tiddler.edited`          | `title`                     | An existing tiddler was saved. Triggers rerender.                                                                          |
| `tiddler.updated`         | `title`                     | Tiddler metadata or content changed (fires after `created`/`edited`). May prompt a hard reload for code/template tiddlers. |
| `tiddler.delete`          | `title`                     | Request deletion of `title`.                                                                                               |
| `tiddler.deleted`         | `title`                     | `title` was deleted. If it was a runnable tiddler a reload prompt is shown.                                                |
| `tiddler.refresh`         | `title`                     | Re-render `title` in place without touching the store.                                                                     |
| `tiddler.show`            | `title`                     | Show `title` in the visible-tiddlers area and scroll to it.                                                                |
| `tiddler.close`           | `title`                     | Remove `title` from the visible-tiddlers area.                                                                             |
| `tiddler.preview`         | `{title, text, type, tags}` | Open the preview dialog with the given tiddler-like object.                                                                |
| `tiddler.rendered`        | `{tiddler, newElement}`     | A tiddler's DOM element was replaced (after `rerenderTiddler`).                                                            |
| `tiddler.element.created` | `{title, newElement}`       | A new DOM element was created for `title` (called from `createTiddlerElement`).                                            |
| `tiddler.text`            | `title`                     | Returns the raw stored text of `title`.                                                                                    |
| `tiddler.content`         | `title`                     | Returns the fully rendered HTML of `title`.                                                                                |
| `section.edit`            | `sectionTitle`              | Open the parent tiddler of a section in the edit form.                                                                     |
| `form.done`               | —                           | Commit the current edit form (validate → save → rerender).                                                                 |
| `form.cancel`             | —                           | Discard the current edit form.                                                                                             |
| `story.changed`           | `title`                     | The set of visible tiddlers changed.                                                                                       |

### Trash

| Event                      | Params  | Description                                  |
| -------------------------- | ------- | -------------------------------------------- |
| `tiddlers.trashed.empty`   | —       | Permanently delete all trashed tiddlers.     |
| `tiddlers.trashed.preview` | —       | Open the trash manager view.                 |
| `tiddler.trashed.destroy`  | `title` | Permanently delete a single trashed tiddler. |
| `tiddler.trashed.restore`  | `title` | Restore a trashed tiddler.                   |
| `trash.refresh`            | —       | Re-render the trash list.                    |

### Workspaces

| Event                 | Params | Description                                                                          |
| --------------------- | ------ | ------------------------------------------------------------------------------------ |
| `workspace.switch`    | `name` | Switch the active workspace in memory without a hard reload.                         |
| `workspace.load`      | `name` | Switch the active workspace and perform a hard reload so the new store takes effect. |
| `workspace.create`    | `name` | Create a new empty workspace named `name`.                                           |
| `workspace.delete`    | `name` | Delete workspace `name` (must not be the active one).                                |
| `workspace.delete.ui` | `name` | Delete workspace `name` with a confirmation dialog.                                  |
| `workspace.clone`     | `name` | Clone the current workspace into `name`.                                             |

### Store and persistence

| Event         | Params | Description                                 |
| ------------- | ------ | ------------------------------------------- |
| `save`        | —      | Persist all tiddlers to localStorage.       |
| `save.auto  ` | —      | Persist if autoSave is on.                  |
| `store.load`  | —      | Reload the tiddler store from localStorage. |

### Packages

| Event                | Params                  | Description                                 |
| -------------------- | ----------------------- | ------------------------------------------- |
| `package.load.url`   | `{url, name, …options}` | Fetch and install a package from `url`.     |
| `package.reload.url` | `{url, name, …options}` | Refetch and reinstall a package from `url`. |

### Search

| Event                   | Params                             | Description                                      |
| ----------------------- | ---------------------------------- | ------------------------------------------------ |
| `search`                | `query`                            | Run a full-text search for `query`.              |
| `search.advanced`       | `{title?, tag?, pck?, type?, id?}` | Run a filtered search with one or more criteria. |
| `search.result.clicked` | `{title, term}`                    | A search result row was clicked.                 |

### UI

| Event           | Params                 | Description                                                                             |
| --------------- | ---------------------- | --------------------------------------------------------------------------------------- |
| `ui.ready`      | `visibleTiddlers[]`    | All tiddlers have been rendered; the UI is fully interactive.                           |
| `ui.open.all`   | `{tag?, title?, pck?}` | Open all tiddlers matching the given filter. Omit params to open every visible tiddler. |
| `ui.close.all`  | —                      | Remove all tiddlers from the visible area.                                              |
| `dirty.changed` | `dirty` (boolean)      | The unsaved-changes state changed.                                                      |
| `reboot.hard`   | —                      | Trigger a full page reload.                                                             |
| `script.loaded` | `title`                | An external script tiddler finished loading.                                            |

---

## Rendering pipeline flow

```
makeTiddlerText(tiddler)
  └─ tw.events.filter('renderer.pre', rawText, {tiddler})
      └─ tw.events.request('renderer.override', {tiddler, text: preText})
          ├─ if claimed: use returned HTML
          └─ if not claimed: core fallback (type-based renderer)
                └─ markdown types: tw.events.send('markdown.render', text)
  └─ tw.events.filter('renderer.post', html, {tiddler})
```

The `markdown.render` event uses `send` (not `request`) for historical reasons. If more than one handler subscribes, the first result wins and a console warning is emitted. Use `tw.events.override('markdown.render', fn)` to replace the renderer cleanly.
