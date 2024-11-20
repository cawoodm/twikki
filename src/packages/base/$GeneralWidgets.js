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
  return tw.ui.button(`{{$IconTag|${size}}}`, 'tiddler.show', '$Settings', '', 'title="Settings"');
};
tw.macros.core.New = () => {
  return tw.ui.button('{{$IconNew}}', 'tiddler.new', null);
};
// Lists types used in all tiddlers
tw.macros.core.AllTypesMacro = () => {
  return tw.lib.markdown([...new Set(tw.tiddlers.all.map(t => `* [${t.type}](#msg:tiddlers.show:type:${t.type})\n`))].join(''));
};
