tags: $Plugin

# Description

Registers a `<<NotificationBell>>` macro: a bell icon with a red count bubble
that you add to your `$TitleBar` (alongside `<<New>>`, `<<Settings>>`, etc.).
Because there is no notify event to subscribe to, the plugin wraps `tw.ui.notify`
— recording every message (with its S/E/W/D/I type and a timestamp) before
delegating to the original, so toasts still appear unchanged. The bubble counts
the stored notifications. Clicking the bell opens a scrollable popup listing the
last 30 messages (newest first) with their type glyph and a relative time. A
notification is only removed when its **✕** is clicked (or all at once via
**Clear all**) — opening the popup does not clear anything.

Usage: add `<<NotificationBell>>` to your `$TitleBar` tiddler.

Notifications fired during boot — before plugins load — are not captured, since
the wrapper is installed in `init()`. The message log is in-memory and resets on
a soft reload.

# Meta

<<pluginMeta NotificationBell>>

# Code

[include](./NotificationBell.js)

# StyleSheet

[include](./NotificationBell.css)
