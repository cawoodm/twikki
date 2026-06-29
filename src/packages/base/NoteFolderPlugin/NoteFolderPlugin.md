tags: $Plugin

# Description

Adds a caret toggle to every tiddler's title bar. Click the down caret to **fold**
(minimise) the note so only its title bar is visible — the body, tags and metadata are
hidden — and the caret flips to an up caret. Click again to **unfold**.

The fold state is per-view: it resets when the note is closed and reopened, or on reload,
and is never written to your data.

# Meta

<<pluginMeta NoteFolder>>

# Code

[include](./NoteFolder.js)

# StyleSheet

[include](./NoteFolder.css)

# CaretDown

[include](./CaretDown.svg)

# CaretUp

[include](./CaretUp.svg)
