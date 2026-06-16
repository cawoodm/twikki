// tags: $Script
/**
  * Buttons to Show/Hide Tiddlers:
  * Examples:
  *  - Show all tiddlers tagged with Foo
  *    <<ShowAllTiddlersButton tag:Foo>>
  * -  Show all tiddlers not tagged with $Shadow
  *    <<ShowAllTiddlersButton tag:!$Shadow>>
  * - Show all tiddlers not tagged with $Shadow with title containing 'oo'
  *    <<ShowAllTiddlersButton !$Shadow title:oo>>
  * -  Show all tiddlers with title beginning with A
  *   <<ShowAllTiddlersButton tag:*, title:^A>>
  */
tw.extensions.registerMacro(
  'core',
  'ShowAllTiddlersButton',
  ({tag = '', title = ''} = {}) => tw.ui.button('{{$IconOpenAll}}', 'ui.open.all', {tag, title}, 'open-all', 'title="Open All Tiddlers"'),
  {
    description: 'Open all tiddlers matching `tag`/`title` (regex; `!` negates, `*` = all).',
    example: '<<ShowAllTiddlersButton tag:Help>>',
  },
);
tw.extensions.registerMacro(
  'core',
  'CloseAllTiddlersButton',
  ({tag = '*', title = '*'} = {}) => tw.ui.button('{{$IconCloseAll}}', 'ui.close.all', {tag, title}, 'close-all', 'title="Close All Tiddlers"'),
  {
    description: 'Close all tiddlers matching `tag`/`title`.',
    example: '<<CloseAllTiddlersButton>>',
  },
);

tw.extensions.registerCommand([
  {label: 'Open all notes', event: 'ui.open.all', payload: {tag: '', title: ''}},
  {label: 'Close all notes', event: 'ui.close.all', payload: {tag: '*', title: '*'}},
]);
