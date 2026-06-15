tags: $Plugin

# Description

Renders tiddlers of `type: script/js` as a small literate page: the leading
`/** ... */` JSDoc-style block is extracted, its leading `*` markers
stripped, and the body rendered as markdown; the rest of the script is
wrapped in a ` ```javascript ` fenced code block. Both halves are routed
back through the `markdown.render` event, so whichever markdown engine the
user has installed renders both prose and code.

This plugin doubles as a demo of two ideas at once: hooking
`renderer.override` to claim a built-in tiddler type, and composing
pipelines (renderer → markdown). With no JSDoc header the whole script
renders as a single fenced code block.

See [[ExampleScript]] for a live demo.

# Meta

<<pluginMeta CodeRenderer>>

# Code

[include](./CodeRenderer.js)

# StyleSheet

[include](./CodeRenderer.css)
