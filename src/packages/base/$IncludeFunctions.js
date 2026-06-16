// tags: $Script
// `core.include` — render the named tiddler in-place. Short-name fallback means
// <<include Foo>> resolves here without any `core.` prefix.
tw.extensions.registerMacro('core', 'include', (title, params) => tw.call('renderTiddler', title, params), {
  description: 'Render the named tiddler inline at the call site.',
  example: '<<include $TWikkiVersion>>',
});
