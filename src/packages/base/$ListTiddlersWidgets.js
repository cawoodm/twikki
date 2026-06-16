// tags: $Script

// JS helpers — not macros, exposed on tw.run for use by other widgets/plugins.
tw.run.allTags = () => {
  const tags = [];
  tw.tiddlers.all.forEach(t => {
    t.tags.filter(t => !!t).forEach(tag => tags.push(tag));
  });
  return [...new Set(tags)];
};
tw.run.allProperty = property => {
  const list = tw.tiddlers.all.filter(t => !!t[property]).map(t => t[property]);
  return [...new Set(list)];
};

tw.extensions.registerMacro(
  'core',
  'list',
  ({tag, title, pck, type} = {}) => {
    if (!title) title = '!^\\$'; // Hide system tiddlers by default
    return tw.run.showTiddlerList(
      tw.tiddlers.all
        .filter(tw.util.titleMatch(title))
        .filter(t => !pck || t.package === pck)
        .filter(t => !type || t.type === type)
        .filter(tw.util.tagMatch(tag)),
    );
  },
  {
    description: 'Bulleted list of tiddler links filtered by tag/title/pck/type (system tiddlers hidden by default).',
    example: '<<list tag:Help>>',
  },
);
tw.extensions.registerMacro('core', 'text', title => tw.run.getTiddlerTextRaw(title), {
  description: 'Raw text of a tiddler.',
  example: '<<text $Theme>>',
});
tw.extensions.registerMacro(
  'core',
  'Section',
  ({name, content, message, payload, attr}) => {
    if (message) content = tw.events.send(message, payload)?.[0];
    return tw.ui.section({name, content, attr});
  },
  {
    description: 'Block expander (<details>); shows static `content` or the result of sending `message`/`payload`.',
    example: '<<Section name:"More" content:"Details here">>',
  },
);
tw.extensions.registerMacro(
  'core',
  'Expand',
  ({name, content, message, payload, attr}) => {
    if (message) content = tw.events.send(message, payload)?.[0];
    return tw.ui.expand({name, content, attr});
  },
  {
    description: 'Inline expander — like Section but flows with text.',
    example: '<<Expand name:"More" content:"Details here">>',
  },
);
tw.extensions.registerMacro('core', 'Expose', ({name, content, message, payload, attr}) => tw.ui.expose({name, content, message, payload, attr}), {
  description: 'Expander that renders the result of `message` only when opened.',
  example: '<<Expose name:"Theme" message:tiddler.text payload:$Theme>>',
});
tw.extensions.registerMacro('core', 'AllTiddlersSimple', sep => tw.lib.markdown(tw.tiddlers.all.map(t => t.title).join(sep || ', ')), {
  description: 'All tiddler titles on one line, custom separator.',
  example: '<<AllTiddlersSimple " - ">>',
});
tw.extensions.registerMacro('core', 'AllTagsSimple', (sep = ', ') => tw.run.allTags().join(sep), {
  description: 'All tags on one line, custom separator.',
  example: '<<AllTagsSimple>>',
});
tw.extensions.registerMacro(
  'core',
  'AllTagsLinked',
  (sep = ', ') =>
    tw.lib.markdown(
      tw.run
        .allTags()
        .map(t => `[${t}](#msg:ui.open.all:{"tag":"${t}","title":"*"})`)
        .join(sep),
    ),
  {
    description: 'All tags as links which open the tagged tiddlers.',
    example: '<<AllTagsLinked>>',
  },
);

tw.events.subscribe('tiddlers.list', tw.macros.core.list, 'ListTiddlersWidgets');
tw.events.subscribe('tiddler.text', tw.macros.core.text, 'ListTiddlersWidgets');
