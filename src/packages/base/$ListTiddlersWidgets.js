Object.assign(tw.macros.core, {
  // List all tiddlers as a bulleted list
  list({tag, title, pck, type} = {}) {
    if (!title) title = '!^\\$'; // Hide system tiddlers by default
    return tw.run.showTiddlerList(
      tw.tiddlers.all
        .filter(tw.util.titleMatch(title))
        .filter(t => !pck || t.package === pck)
        .filter(t => !type || t.type === type)
        .filter(tw.util.tagMatch(tag)),
    );
  },
  text (title) {
    return tw.run.getTiddlerTextRaw(title);
  },
  Section ({name, content, message, payload, attr}) {
    if (message) content = tw.events.send(message, payload)?.[0];
    return tw.ui.section({name, content, attr});
  },
  Expand ({name, content, message, payload, attr}) {
    if (message) content = tw.events.send(message, payload)?.[0];
    return tw.ui.expand({name, content, attr});
  },
  Expose ({name, content, message, payload, attr}) {
    return tw.ui.expose({name, content, message, payload, attr});
  },
  // List all tiddlers on a single line with comma separation
  AllTiddlersSimple (sep) {
    return tw.lib.markdown(tw.tiddlers.all.map(t => t.title).join(sep || ', '));
  },
  // List all tags
  AllTagsSimple (sep) {
    if (!sep) sep = ', ';
    let allTags = tw.macros.core.allTags();
    return allTags.join(sep);
  },
  allTags () {
    let tags = [];
    tw.tiddlers.all.forEach(t => {
      t.tags.filter(t => !!t).forEach(tag => {
        tags.push(tag);
      });
    });
    return [...new Set(tags)];
  },
  allProperty (property) {
    let list = tw.tiddlers.all.filter(t => !!t[property]).map(t => t[property]);
    return [...new Set(list)];
  },
  AllTagsLinked (sep) {
    if (!sep) sep = ', ';
    let allTags = tw.macros.core.allTags();
    return tw.lib.markdown(
      allTags.map(t => (`[${t}](#msg:ui.open.all:{"tag":"${t}","title":"*"})`)).join(sep),
    );
  },
});

tw.events.subscribe('tiddlers.list', tw.macros.core.list);
tw.events.subscribe('tiddler.text', tw.macros.core.text);
