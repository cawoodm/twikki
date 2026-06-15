// tags: $Script
/**
 `<<tags>>` renders a picker of every tag in the store. Picking a tag fires
`tw.events.send('search', 'tag:<name>')`, which the `search` subscriber in
core.search puts into the search box and re-runs — same effect as typing
`tag:Foo` directly. Items are populated lazily by PickerPlugin via the
`alltags` data source: rendering them eagerly puts `<div>` block elements
inside an inline `<span class="picker-menu">` inside a `<p>`, and the HTML
parser hoists the divs out as siblings of the paragraph (the items then
show unconditionally and the popup opens empty).
 */
tw.extensions.registerMacro('core', 'tags', () => {
  return (
    '<span class="picker tags-picker" data-event="search" data-source="alltags">' +
    '<button class="picker-trigger pck-pill">Tags</button>' +
    '<span class="picker-menu" hidden></span>' +
    '</span>'
  );
});
