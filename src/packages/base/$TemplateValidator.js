// tags: $Script
// Validates $Template-tagged HTML templates by parsing the body through
// htmlToNode() on save — catches multi-root / non-element-root edits before
// they brick $TiddlerDisplay et al. The throw is re-wrapped by the validator
// host as `template-html: <message>` and surfaced by formDone with the same
// force-save UX as renderTWikki errors.
tw.extensions.registerValidator({
  name: 'template-html',
  match: t => t.tags?.includes('$Template'),
  validate: t => {
    tw.core.dom.htmlToNode(t.text);
  },
});
