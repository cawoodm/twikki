(function(){

  tw.macros.core.TrashCanIcon = () => {
    let count = tw.tiddlers.trashed.length;
    return tw.ui.button('{{$IconDelete}}', 'tiddler.show', '$TrashManager', 'trashCanIcon', `title="${count} trashed tiddlers"`);
  // return `<a id="trashCanIcon" href="#$TrashManager">🗑️ (${count})</a>`;
  };
  tw.macros.core.TrashEmptyButton = () => {
    return tw.ui.button('Empty Trash', 'tiddlers.trashed.empty', null, 'trashButton');
  };
  tw.macros.core.TrashCanStatus = () => {
    return `<span id="trashStatus">${tw.tiddlers.trashed.length} tiddlers in the [trash can](#$TrashedTiddlers)!`;
  };
  tw.events.subscribe('tiddlers.trashed.empty', emptyTrash);
  function emptyTrash() {
    if (!confirm('Are you sure you want to permanently deleted your trashed tiddlers?')) return;
    tw.tiddlers.trashed = [];
    trashCanRefresh();
    tw.run.save();
  };
  tw.macros.core.TrashCanContents = () => {
    const list = tw.tiddlers.trashed.map(t => (`<li><a data-msg="tiddlers.trashed.preview" data-param="${t.title}">${t.title}</a> 
      <a title="Restore Tiddler" data-msg="tiddler.trashed.restore" data-param="${t.title}">🚮</a></li>`)).join('\n');
    return `<ul id="trashContents">${list}</ul>`;
  };
  tw.events.subscribe('tiddlers.trashed.preview', trashPreview);
  function trashPreview(title) {
    let tiddler = tw.tiddlers.trashed.find(t => t.title === title);
    tw.run.previewTiddler(tiddler, tw.templates.TiddlerTrashed);
  };

  tw.events.subscribe('tiddler.trashed.destroy', removeTiddlerFromTrash);
  function removeTiddlerFromTrash(title) {
    if (!confirm('Are you sure you want to permanently delete your trashed tiddler?')) return;
    let tiddlerIndex = tw.tiddlers.trashed.findIndex(t => t.title === title);
    tw.tiddlers.trashed.splice(tiddlerIndex, 1);
    trashCanRefresh();
    tw.core.dom.preview.close();
    tw.run.save();
  };

  tw.events.subscribe('tiddler.deleted', trashCanRefresh);
  tw.events.subscribe('trash.refresh', trashCanRefresh);
  function trashCanRefresh() {
    if (tw.core.dom.$('trashContents')) tw.core.dom.$('trashContents').outerHTML = tw.lib.markdown(tw.macros.core.TrashCanContents());
    if (tw.core.dom.$('trashCanIcon')) tw.core.dom.$('trashCanIcon').innerHTML = tw.macros.core.TrashCanIcon();
    if (tw.core.dom.$('trashStatus')) tw.core.dom.$('trashStatus').outerHTML = tw.lib.markdown(tw.macros.core.TrashCanStatus());
    tw.run.rerenderTiddler('$TrashedTiddlers');
  };

  tw.events.subscribe('tiddler.trashed.restore', restoreTiddlerFromTrash);
  function restoreTiddlerFromTrash(title) {
    if (!confirm('Are you sure you want to restore your trashed tiddler? This may overwrite an existing tiddler!')) return;
    let tiddler = tw.tiddlers.trashed.find(t => t.title === title);
    tw.run.addTiddler(tiddler);
    tw.run.reload();
    // So styles, search list etc update
    let tiddlerIndex = tw.tiddlers.trashed.findIndex(t => t.title === title);
    tw.tiddlers.trashed.splice(tiddlerIndex, 1);
    trashCanRefresh();
    tw.run.save();
  };
})();
