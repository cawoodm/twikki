// tags: $Script
// Flags $Plugin saves so formDone() can prompt for a hard reload — plugins
// bind live state (event subscriptions, DOM hooks) at boot, so an in-place
// edit needs a re-eval to actually take effect. This is a "validator" in the
// stack-of-validators sense (it runs on save and can throw); it does no
// validation of its own, only side-effects the runtime flag.
tw.extensions.registerValidator({
  name: 'plugin-reload-flag',
  match: t => t.tags?.includes('$Plugin'),
  validate: () => {
    let codeBlocks = tw.core.tiddlers.tiddlerCodeBlocks(t);
    if (codeBlocks.length)
      // TODO: Try, catch, return error <span class="error">
      return codeBlocks.forEach(b => tw.run.executeCodeTiddler(b.text, b.title));
  },
});
