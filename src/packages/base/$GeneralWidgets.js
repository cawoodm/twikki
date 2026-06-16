// tags: $Script

tw.extensions.registerMacro('core', 'command', (msg, payload = '') => tw.ui.button(`Send: ${msg}:${payload}`, msg, payload, '', 'title="Send Command"'), {
  description: 'Debug button labelled with the msg:payload it sends.',
  example: '<<command ui.reload>>',
});
tw.extensions.registerMacro('core', 'Reload', () => tw.ui.button('🔄️', 'ui.reload', null, '', 'title="Reload"'), {
  description: 'Reload the UI.',
  example: '<<Reload>>',
});
tw.extensions.registerMacro('core', 'Save', () => tw.ui.button('{{$IconSave}}', 'save.all', null, '', 'title="Save"'), {
  description: 'Save all tiddlers (icon button).',
  example: '<<Save>>',
});
tw.extensions.registerMacro('core', 'Settings', (size = '22') => tw.ui.button(`{{$IconSettings|size:${size}px}}`, 'tiddler.show', '$GeneralSettings', '', 'title="Settings"'), {
  description: 'Open the $GeneralSettings tiddler. Optional icon size in px.',
  example: '<<Settings 16>>',
});
tw.extensions.registerMacro('core', 'New', () => tw.ui.button('{{$IconNew}}', 'tiddler.new', null), {
  description: 'Create a new tiddler.',
  example: '<<New>>',
});
tw.extensions.registerMacro(
  'core',
  'TagInput',
  ({id}) => {
    const tags = tw.run.allTags();
    return `<input id="${id}" placeholder="Tags" list="${id}-tags"/><datalist id="${id}-tags">${tags.map(t => `<option value="${t}">${t}</option>`).join('')}</datalist>`;
  },
  {
    description: 'Text input with autocomplete over every existing tag.',
    example: '<<TagInput id:my-tags>>',
  },
);
tw.extensions.registerMacro(
  'core',
  'AllTypesMacro',
  () => tw.lib.markdown([...new Set(tw.tiddlers.all.map(t => `* [${t.type}](#msg:tiddlers.show:type:${t.type})\n`))].join('')),
  {
    description: 'All tiddler types in use, as links opening tiddlers of that type.',
    example: '<<AllTypesMacro>>',
  },
);

// Command palette commands for the general widgets defined above.
tw.extensions.registerCommand([
  {label: 'New note', event: 'tiddler.new'},
  {label: 'Save all', event: 'save.all'},
  {label: 'Reload UI', event: 'ui.reload'},
  {label: 'Open Settings', event: 'tiddler.show', payload: '$GeneralSettings'},
]);
