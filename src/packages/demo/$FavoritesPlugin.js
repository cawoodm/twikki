// tags: $Plugin

/**
 * ## Description
 * Provide <<favorites.toggle>> widget
 *   Toggles tag 'Favorite' on current tiddler
 *   for use on $TiddlerDisplay template
 */
(function () {
  const meta = {
    name: 'Favorites',
    version: '1.0.0',
    platform: '0.27.0',
    description: 'Toggle a Favorite tag on tiddlers and surface a star widget.',
  };

  function favoriteToggle(title) {
    const t = tw.call('getTiddler', title);
    if (!t) throw new Error(`Unknown tiddler '${title}'!`);
    // if (t.tags.includes('$NoEdit')) return tw.ui.notify('Tiddler is readonly!', 'E');
    if (t.doNotSave) tw.ui.notify('Tiddler will not be saved!', 'W');
    tw.call('tiddlerToggleTag', t.title, 'Favorite');
    let btn = tw.call('getTiddlerElement', title)?.querySelector('button[title=favorite]');
    // dp(t.tags.includes('Favorite'), btn);
    if (btn) {
      if (!t.tags.includes('Favorite')) btn.className += ' yellow';
    }
    // dp(btn.className);
    tw.events.send('save.auto');
  }

  return {
    meta,
    init() {
      tw.extensions.registerMacro(
        'favorites',
        'toggle',
        () => {
          // TODO: How to find the current tiddler/element?
          // let el = tw.core.dom.nearestAttribute
          return tw.ui.button('{{$IconFavorite}}', 'favorites.toggle', '$currentTiddler', 'favoriteAdd');
        },
        {
          description: 'Toggle the current tiddler\'s "Favorite" tag.',
          example: '<<favorites.toggle>>',
        },
      );
      tw.events.subscribe('favorites.toggle', favoriteToggle);

      // Add {{=favoriteClass}} to your $TiddlerDisplay
      tw.extend.tiddlerDetails.favoriteClass = function (t) {
        return t.tags.includes('Favorite') ? 'favorite' : '';
      };

      // Command palette commands (only available when the demo package is installed).
      tw.extensions.registerCommand([
        {label: 'Show favorites', event: 'ui.open.all', payload: {tag: 'Favorite', title: '*'}},
        {
          label: 'Toggle favorite (active note)',
          run: () => {
            const title = tw.tabs?.active;
            if (!title) return tw.ui.notify('No active note to favorite.', 'W');
            tw.events.send('favorites.toggle', title);
          },
        },
      ]);
    },
  };
})();
// TODO: How to add button:yellow svg {fill: yellow;} to theme?
