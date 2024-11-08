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
  tw.macros.mass = {
    delete() {
      return `<form>
      <input name=title placeholder=title>
      <input name=tag placeholder=tag>
      <input name=package placeholder=package>
      ${tw.ui.button('Show', null, null, 'btnMassDelete', 'onclick="pck=this.form.elements[2].value; tw.run.sendCommand(\'ui.open.all:pck:\' + pck)"')}
      ${tw.ui.button('Delete', 'tiddlers.delete.mass', 'this', 'btnMassDelete')}
      </form>`;
    },
  };
  tw.events.subscribe('tiddlers.delete.mass', massDelete);
  function massDelete({title, tag, pck}) {
    let list = tw.call('tiddlerSearch')({title, tag, pck})
      .map(t => t.title);
    if (!confirm(`Sure you want to deleted these ${list.length} tiddlers?`)) return;
    list.forEach(title => (tw.run.deleteTiddler(title, true)));
  }
})();
