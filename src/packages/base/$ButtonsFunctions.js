/**
  * Buttons to Show/Hide Tiddlers:
  * Examples:
  *  - Show all tiddlers
  *    <<button Click Me!;ui.open.all>>
  */
tw.macros.button = (title, msg, payload = '', id = '') => {
  return tw.ui.button(title, msg, payload, id);
};
