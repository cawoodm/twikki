/* eslint-disable no-eval */
// Include the contents of another tiddler
// <<include $TWikkiVersion>>
tw.macros.include = (title) => {
  // dp('include', title);
  return tw.call('renderTiddler', title);
};
tw.macros.eval = (code) => {
  return eval(code);
};
