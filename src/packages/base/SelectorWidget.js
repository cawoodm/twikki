/**
  * .SYNOPSIS
  * Show a selection of values
  *
  * .DESCRIPTION
  * Provide a dynamic data-driven HTML <select> box with handler
  *
  * .EXAMPLE
  * Show a selection of 3 fixed colors:
  * <<selector red,green, blue>>
  *
  * .EXAMPLE
  * Show a selection of colors from a datalist tiddler:
  * <<selector {tw.run.getTiddlerTextList('ColorSelection')}>>
  *
  * .EXAMPLE
  * Show a selection of 3 keyval pairs:
  * <<selector #f00:red #0f0:green #00f:blue>>
  *
  * TODO: Create a widget which updates the text/field of a tiddler
  *         This would be great in the $Theme tiddler to directly select a theme
  *         <<selector {tw.theme.getThemeNames()}>>
  */
tw.macros.core.selector = (values) => {
  if (typeof values === 'string') values = values.split(/,\s?/);
  if (typeof values === 'object' && !Array.isArray(values)) values = Object.keys(values).map(key => ({key, value: values[key]}));
  if (!Array.isArray(values)) throw new Error('No array passed!');
  return `<select>
  ${values.map(v => '<option value="' + (v?.key || v) + '">' + (v?.value || v) + '</option>').join('')}
  </select>`;
};
