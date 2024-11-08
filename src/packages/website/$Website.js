tw.events.subscribe('ui.loaded', () => {
  // Show 'Welcome' if no tiddlers are defined
  let t = tw.run.getTiddler('Welcome');
  if (!t) return;
  if (!tw.tiddlers.visible.length)
    tw.run.showTiddler('Welcome');
}, 'website');
