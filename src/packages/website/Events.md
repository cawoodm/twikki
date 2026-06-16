tags: Help

TWikki's event bus lets you trigger any action from a link. The URL format is `#msg:<event>:<params>`.

## Examples

| What you want | Link | Raw syntax |
|---------------|------|------------|
| Open a specific tiddler | [Show Welcome](#msg:tiddler.show:Welcome) | `#msg:tiddler.show:Welcome` |
| Create a new tiddler | [New tiddler](#msg:tiddler.new) | `#msg:tiddler.new` |
| Search for a term | [Search "events"](#msg:search:events) | `#msg:search:events` |
| Open all tiddlers tagged Help | [Open all Help](#msg:ui.open.all:tag:Help) | `#msg:ui.open.all:tag:Help` |
| Close all open tiddlers | [Close all](#msg:ui.close.all) | `#msg:ui.close.all` |
| Save to localStorage | [Save now](#msg:save) | `#msg:save` |
| Switch workspace | [Go to default](#msg:workspace.load:default) | `#msg:workspace.load:default` |

## Using events in tiddler content

Anywhere you write markdown you can embed a `msg:` link:

```
[Open my note](#msg:tiddler.show:My%20Note)
[New tiddler](#msg:tiddler.new)
[Search events](#msg:search:events)
```

Spaces in params must be percent-encoded (`My%20Note`) or wrapped in quotes (`"My Note"`).

## Calling events from plugins

```js
// Subscribe (listen)
tw.events.subscribe('tiddler.created', title => {
  console.log('Created:', title);
}, 'MyPlugin.onCreate');

// Send (broadcast)
tw.events.send('tiddler.show', 'Welcome');

// Override (replace existing handler)
tw.events.override('markdown.render', text => myRenderer.render(text));

// Filter (transform a value through a chain)
tw.events.subscribe('renderer.pre', (text, {tiddler}) => {
  return text.replace(/TODO:.*/g, '');
}, 'MyPlugin.stripTodos');
```

See the [full events reference](https://github.com/cawoodm/twikki/blob/main/docs/EVENTS.md) for all available events.
