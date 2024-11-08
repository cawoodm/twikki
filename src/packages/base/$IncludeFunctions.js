/* eslint-disable no-eval */
// Include the contents of another tiddler
// <<include $TWIKIVersion>>
tw.macros.include = (title) => {
  // dp('include', title);
  return tw.call('renderTiddler', title);
};
tw.macros.eval = (code) => {
  return eval(code);
};
