tags: $Plugin

# Description

Obsidian-style tabs for open notes. The platform keeps rendering every
visible note as a `.tiddler` element inside `#visible-tiddlers`; this plugin
adds a tab strip (`#tab-strip`) and shows only the *active* note by toggling
a `.tab-active` class (the show/hide CSS lives in `$CoreThemeLayout`, gated
behind the `.tabbed` class this plugin adds — so without the plugin notes
just stack as before).

Exposes `tw.tabs = {active, rebuild(), activate(title)}`. Explorer / search /
command-palette call `tw.tabs.activate(title)` after `tiddler.show` because
re-opening an already-open note does not re-render it.

Sync: render events are coalesced in a microtask. A single-note open
activates that note; a bulk re-render (open-all / close) keeps the prior
active tab, or — when the active note was closed — activates its neighbour.

# Meta

- version: 1.0.0

# Code

[include](./Tabs.js)

# StyleSheet

[include](./Tabs.css)
