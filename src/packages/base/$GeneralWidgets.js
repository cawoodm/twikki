// Send any message <<command ui.open.all pck:website>>
tw.macros.core.command = (msg, payload = '') => {
  return tw.ui.button(`Send: ${msg}:${payload}`, msg, payload, '', 'title="Send Command"');
};
// Reload UI
tw.macros.core.Reload = () => {
  return tw.ui.button('🔄️', 'ui.reload', null, '', 'title="Reload"');
};
tw.macros.core.Save = () => {
  return tw.ui.button('{{$IconSave}}', 'save.all', null, '', 'title="Save"');
};
tw.macros.core.Settings = (size = '22') => {
  return tw.ui.button(`{{$IconSettings|size:${size}px}}`, 'tiddler.show', '$Settings', '', 'title="Settings"');
};
tw.macros.core.Tag = (size = '22') => {
  return tw.ui.button(`{{$IconTag|${size}}}`, 'tiddler.show', 'Tags', '', 'title="Settings"');
};
tw.macros.core.New = () => {
  return tw.ui.button('{{$IconNew}}', 'tiddler.new', null);
};
tw.macros.core.TagInput = ({id}) => {
  const tags = tw.macros.core.allTags();
  return `<input id="${id}" placeholder="Tags" list="${id}-tags"/><datalist id="${id}-tags">${tags.map(t => `<option value="${t}">${t}</option>`).join('\n')}</datalist>`;
};
// Lists types used in all tiddlers
tw.macros.core.AllTypesMacro = () => {
  return tw.lib.markdown([...new Set(tw.tiddlers.all.map(t => `* [${t.type}](#msg:tiddlers.show:type:${t.type})\n`))].join(''));
};
