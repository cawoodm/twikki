tags: $Plugin

# Description

Obsidian-style command palette. Ctrl/Cmd+K opens an overlay to run commands
and quick-open notes by name:

- empty input or a `>`-prefixed query → the command list (filtered);
- any other text → ranked note search (reusing `tw.core.search.search`).
  Arrow keys move, Enter runs, Escape closes.

Commands are not defined here — any plugin or macro registers its own via
`tw.extensions.registerCommand({label, event?, payload?, run?})` (or
`registerCommandProvider(key, fn)` for runtime-varying lists). The palette
just reads `tw.commands.all()` on every render.

The `<dialog>` is built in JS (so it can't collide with layout ids). The
document-level keydown is bound once (guarded via `tw.tmp`) and is ignored
while the edit dialog is open, so editing keeps its own keyboard.

# Meta

- version: 1.0.0

# Code

[include](./CommandPalette.js)

# StyleSheet

[include](./CommandPalette.css)
