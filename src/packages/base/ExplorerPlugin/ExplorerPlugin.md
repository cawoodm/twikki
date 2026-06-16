tags: $Plugin

# Description

Fills the left sidebar with an Obsidian-style explorer: a list of notes
(non-system tiddlers, sorted) and a list of tags. Rows are clickable —
notes open + activate their tab; tags open all matching notes.

Renders into `#explorer-notes` / `#explorer-tags` (provided by the layout)
and rebuilds live on note create/update/delete and on story changes (to keep
the "open" highlight current). Reuses `tw.run.allTags()` and
`tw.util.titleMatch`.

# Meta

<<pluginMeta Explorer>>

# Code

[include](./Explorer.js)

# StyleSheet

[include](./Explorer.css)
