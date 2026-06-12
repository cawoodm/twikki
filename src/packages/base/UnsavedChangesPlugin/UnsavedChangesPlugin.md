tags: $Plugin

# Description

Tracks unsaved changes and shows them in a dialog (built with the core
`tw.ui.dialog` API). The changed set is computed live by diffing the
in-memory tiddlers (`tw.tiddlers.all`, minus `doNotSave`) against the
last-saved set in storage (`tw.store.get('tiddlers')`), so it is accurate
even if the dirty flag under-reports. Each changed tiddler is listed as
new/modified/deleted with a short summary (≤100 words) as a native tooltip.

Surfaced three ways:
  - a `●` dirty indicator in the header (toggled by the `dirty.changed`
    event from the platform) which opens the dialog on click,
  - the `unsaved.show` event (what the indicator's `data-msg` sends),
  - automatically ~1s after the user cancels leaving the page: browsers
    forbid custom UI inside `beforeunload`, so we schedule a timeout there;
    if the page is still alive and visible afterwards, the user stayed.

# Meta

<<pluginMeta UnsavedChanges>>

# Code

[include](./UnsavedChanges.js)

# StyleSheet

[include](./UnsavedChanges.css)
