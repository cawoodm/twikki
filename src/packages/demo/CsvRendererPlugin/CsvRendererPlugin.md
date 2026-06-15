tags: $Plugin

# Description

Renders tiddlers of `type: csv` as HTML tables. The parser is a hand-rolled
RFC 4180 state machine — it handles quoted fields, embedded commas, embedded
newlines, and escaped quotes (`""` → `"`). Empty bodies render an empty
`<table class="csv"></table>` instead of falling through to the core
`<pre>` fallback.

This plugin doubles as a demonstration of the render pipeline introduced by
the platform: `renderer.pre` / `renderer.override` / `renderer.post`. The
`csv` type is also registered on the new-tiddler picker via
`tw.extensions.registerType`, so it shows up in the type datalist as soon
as the plugin loads.

See [[ExampleCsv]] for a live demo.

# Meta

<<pluginMeta CsvRenderer>>

# Code

[include](./CsvRenderer.js)

# StyleSheet

[include](./CsvRenderer.css)
