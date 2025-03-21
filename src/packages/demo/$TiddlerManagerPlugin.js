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
 *   "version": 1.1.0
 * }
 * ```
 */
(function(){
  let tiddlersToManage = [];
  tw.tmp.manager = {
    show(e, frm) {
      e.preventDefault();
      tiddlersToManage = tw.events.send('search.advanced', {
        id: 'manager-search-list',
        all: true,
        title: frm.elements.title.value,
        tag: frm.elements.tag.value,
        pck: frm.elements.package.value,
        type: frm.elements.type.value,
      })[0];
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
  tw.macros.manager = {
    form() {
      const titles = tw.macros.core.allProperty('title');
      const types = tw.macros.core.allProperty('type');
      const tags = tw.macros.core.allTags();
      const packages = tw.macros.core.allProperty('package');
      return `<form>
      <input name=title placeholder=title list="manager-all-titles">
        <datalist id="manager-all-titles">${titles.map(t => `<option value="${t}">${t}</option>`).join('\n')}</datalist>
      <input name=type placeholder=type list="manager-all-types">
        <datalist id="manager-all-types">${types.map(t => `<option value="${t}">${t}</option>`).join('\n')}</datalist>
      <input name=tag placeholder=tag list="manager-all-tags">
        <datalist id="manager-all-tags">${tags.map(t => `<option value="${t}">${t}</option>`).join('\n')}</datalist>
      <input name=package placeholder=package list="manager-all-packages">
        <datalist id="manager-all-packages">${packages.map(t => `<option value="${t}">${t}</option>`).join('\n')}</datalist>
      ${tw.ui.button('Show', null, null, 'btnmanagerShow', 'onclick="tw.tmp.manager.show(event, this.form)"')}
      ${tw.ui.button('Delete', null, null, 'btnmanagerDelete', 'onclick="tw.tmp.manager.delete(event, this.form)"')}
      </form><div id="manager-search-list">No tiddlers to show</div>`;
    },
  };
  tw.events.subscribe('tiddlers.delete.manager', managerDelete);
  function managerDelete({title, tag, pck}) {
    let list = tw.call('tiddlerSearch')({title, tag, pck})
      .map(t => t.title);
    if (!confirm(`Sure you want to delet these ${list.length} tiddlers?`)) return;
    list.forEach(title => (tw.run.deleteTiddler(title, true)));
  }
})();
