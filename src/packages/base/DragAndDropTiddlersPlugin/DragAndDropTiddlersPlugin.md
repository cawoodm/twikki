tags: $Plugin

# Description

Drag a tiddler's title from one TWikki window and drop it into another to copy it across.
The drag payload is `application/x-twikki-tiddlers+json` carrying `{version, tiddlers: [...]}` —
an array, so multi-select drag can be added later without changing the payload shape. On drop the
target opens a single import dialog listing every incoming tiddler as **NEW** or **OVERWRITE**, and
only writes after the user confirms.

Drag sources:

- the `.title` bar of any open tiddler in `#visible-tiddlers`.

Tabs in `#tab-strip` are intentionally **not** draggable: tab dragging competed with
tapping a tab's close (✕) button on touch devices.

The same import handler is also registered with `$DropZonePlugin` for two file globs:

- `*.tiddler.json` — always treated as a tiddler bundle,
- `*.json` — soft fallback; only imports if the parsed content has shape `{tiddlers: [...]}`.

Longest-match-wins inside DropZone keeps `*.workspace.json` ahead of `*.tiddler.json` ahead of
`*.json`, so this plugin never poaches workspace dumps. The file-drop overlay is owned by
`$DropZonePlugin`; cross-window drags carry no files so the overlay never appears for them.

# Meta

<<pluginMeta DragAndDropTiddlers>>

# Code

[include](./DragAndDropTiddlers.js)

# StyleSheet

[include](./DragAndDropTiddlers.css)
