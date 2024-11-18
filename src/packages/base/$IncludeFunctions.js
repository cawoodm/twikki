
// Include the contents of another tiddler
// <<include $TWikkiVersion>>
tw.macros.include = (title, params) => {
  return tw.call('renderTiddler', title, params);
};
tw.macros.eval = (code) => {
  return eval(code);
};
