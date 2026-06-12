tags: $Plugin

# Description

Generic icon-triggered popup picker. Drives the theme and workspace selectors
(and any future ones) without per-picker JS: a `.picker` container holds a
`.picker-trigger` icon button and a hidden `.picker-menu` of `.picker-item`
buttons. Clicking the trigger toggles the menu. Clicking an item sends the
container's `data-event` (item may override) with the item's `data-value`,
then closes. Outside click / Escape / scroll / resize close any open menu.

Behaviour is document-level delegation bound once (guarded via `tw.tmp`), so it
survives UI re-renders without re-binding.

# Meta

- version: 1.0.0

# Code

[include](./Picker.js)

# StyleSheet

[include](./Picker.css)
