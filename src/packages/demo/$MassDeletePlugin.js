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
  let tiddlersToManage = [];
  tw.tmp.mass = {
    show(e, frm) {
      let o = {
        id: 'mass-search-list',
        all: true,
        title: frm.elements[0].value,
        tag: frm.elements[1].value,
        pck: frm.elements[2].value,
      };
      e.preventDefault();
      tiddlersToManage = tw.events.send('search.advanced', o)[0];
    },
    delete(e, frm) {
      e.preventDefault();
      this.show(e, frm); // tiddlersToManage = tw.events.send('search.advanced', o)[0];
      if (!tiddlersToManage.length) return alert('No tiddlers selected!');
      setTimeout(() => {
        if (!confirm(`Sure you want to delete these ${tiddlersToManage.length} tiddlers?`)) return;
        tiddlersToManage.forEach(t => (tw.run.deleteTiddler(t.title, true)));
      }, 300);
    },
  };
  tw.macros.mass = {
    delete() {
      return `<form>
      <input name=title placeholder=title>
      <input name=tag placeholder=tag>
      <input name=package placeholder=package>
      ${tw.ui.button('Show', null, null, 'btnMassShow', 'onclick="tw.tmp.mass.show(event, this.form)"')}
      ${tw.ui.button('Delete', null, null, 'btnMassDelete', 'onclick="tw.tmp.mass.delete(event, this.form)"')}
      </form><div id="mass-search-list">No tiddlers to show</div>`;
    },
  };
  tw.events.subscribe('tiddlers.delete.mass', massDelete);
  function massDelete({title, tag, pck}) {
    let list = tw.call('tiddlerSearch')({title, tag, pck})
      .map(t => t.title);
    if (!confirm(`Sure you want to delet these ${list.length} tiddlers?`)) return;
    list.forEach(title => (tw.run.deleteTiddler(title, true)));
  }
})();
