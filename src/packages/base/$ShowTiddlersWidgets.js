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
tw.macros.core.ShowAllTiddlersButton = ({tag = '', title = ''} = {}) => {
  return tw.ui.button('{{$IconOpenAll}}', 'ui.open.all', {tag, title}, 'open-all', 'title="Open All Tiddlers"');
};
// Show all tiddlers with text (but really all)
tw.macros.core.CloseAllTiddlersButton = ({tag = '*', title = '*'} = {}) => {
  return tw.ui.button('{{$IconCloseAll}}', 'ui.close.all', {tag, title}, 'close-all', 'title="Close All Tiddlers"');
};
