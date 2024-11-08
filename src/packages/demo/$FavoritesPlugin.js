/**
 * ## Description
 * Provide <<favorites.toggle>> widget
 *   Toggles tag 'Favorite' on current tiddler
 *   for use on $TiddlerDisplay template
 */
/**
 * ## Data
 * ```json
 * {
 *   "version": 1.0.0
 * }
 * ```
 */
(function(){
  tw.macros.favorites = {
    toggle() {
      // TODO: How to find the current tiddler/element?
      // let el = tw.core.dom.nearestAttribute
      return tw.ui.button('{{$IconFavorite}}', 'favorites.toggle', '$currentTiddler', 'favoriteAdd');
    },
  };
  tw.events.subscribe('favorites.toggle', favoriteToggle);
  function favoriteToggle(title) {
    const t = tw.call('getTiddler', title);
    if (!t) throw new Error(`Unknown tiddler '${title}'!`);
    // if (t.tags.includes('$NoEdit')) return tw.ui.notify('Tiddler is readonly!', 'E');
    if (t.doNotSave) tw.ui.notify('Tiddler will not be saved!', 'W');
    tw.call('tiddlerToggleTag', t.title, 'Favorite');
    let btn = tw.call('getTiddlerElement', title)?.querySelector('button[title=favorite]');
    // dp(t.tags.includes('Favorite'), btn);
    if (btn) {
      if (!t.tags.includes('Favorite'))
        btn.className += ' yellow';
    }
    // dp(btn.className);
    tw.events.send('save.silent');
  }
  // Add {{=favoriteClass}} to your $TiddlerDisplay
  tw.extend.tiddlerDetails.favoriteClass = function(t) {
    return t.tags.includes('Favorite') ? 'favorite' : '';
  };
})();
// TODO: How to add button:yellow svg {fill: yellow;} to theme?
