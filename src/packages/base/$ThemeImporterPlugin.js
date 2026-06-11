// tags: $Script

/**
 * ## Description
 * Import themes from a fixed, public [GitHub Gist](https://gist.github.com).
 * The gist ships a packaged `themes.json` (`{tiddlers: [...]}`) containing,
 * for each theme, an `XStyleSheet` (type `css`, tagged `$StyleSheet`) and an
 * `XTheme` wrapper (tagged `$Theme`). The importer fetches that package and
 * opens a dialog where the user can:
 *   - tick which themes to import (checkbox), and
 *   - optionally pick a single theme to apply (radio).
 * Importing overwrites any local tiddler of the same name. Applying a theme
 * also imports it (apply implies import). After import the selected theme,
 * if any, is applied via the `theme.switch` event.
 *
 * The gist URL is read from `$GeneralSettings.urls.themeUrl`; if absent a
 * built-in default is used. The dialog shows this URL in an editable field and
 * reloads the theme list whenever it is changed. The URL may point either at
 * the raw `themes.json` (returns `{tiddlers}` directly) or at the gist API
 * endpoint (returns a `{files}` wrapper) — both shapes are handled.
 *
 * Surfaced via the `<<themeImport.button>>` macro (rendered next to the theme
 * selector in `$Themes`) and the `theme.import` event.
 */
/**
 * ## Data
 * ```json
 * {
 *   "version": 1.0.0
 * }
 * ```
 */
// ## Code
// ```javascript
(function() {

  const DIALOG_ID = 'theme-import-dialog';
  const DEFAULT_URL = 'https://gist.githubusercontent.com/cawoodm/c43037e0370393ef2928848fee64e95d/raw/themes.json';

  tw.macros.themeImport = {
    button() {
      return tw.ui.button('{{$IconPull}}', 'theme.import', null, 'theme-import-btn', 'title="Import Themes"');
    },
  };

  tw.events.subscribe('theme.import', open, 'ThemeImporter');

  function open() {
    showDialog(importUrl());
  }

  async function fetchPackage(url) {
    let res;
    try {
      res = await fetch(url, {cache: 'no-store'});
    } catch (e) {
      console.error('ThemeImporter fetch', e);
      return null;
    }
    if (!res.ok) {
      console.error('ThemeImporter fetch', res.status, res.statusText);
      return null;
    }
    let parsed;
    try {
      parsed = await res.json();
    } catch (e) {
      console.error('ThemeImporter parse', e);
      return null;
    }
    let pkg = unwrap(parsed);
    if (!pkg || !Array.isArray(pkg.tiddlers)) {
      console.error('ThemeImporter: no tiddlers found in package');
      return null;
    }
    return pkg.tiddlers;
  }

  // Accept either the raw package ({tiddlers}) or the gist API shape ({files}).
  function unwrap(parsed) {
    if (parsed && Array.isArray(parsed.tiddlers)) return parsed;
    if (parsed && parsed.files) {
      let file = parsed.files['themes.json']
        || Object.values(parsed.files).find(f => f.filename?.endsWith('.json'));
      if (!file) return null;
      try {return JSON.parse(file.content);} catch {return null;}
    }
    return null;
  }

  function importUrl() {
    let settings = tw.call('getJSONObject', '$GeneralSettings');
    return settings?.urls?.themeUrl || DEFAULT_URL;
  }

  function showDialog(url) {
    let state = {byTitle: new Map()}; // re-populated by refreshList on every load
    let dlg = tw.ui.dialog({
      id: DIALOG_ID,
      title: 'Import Themes',
      html: dialogBodyHtml(url),
      buttons: [
        {text: 'Import', onClick: (e, api) => importSelected(api, state)},
        {text: 'Cancel', close: true},
      ],
    });
    let root = dlg.content;
    let urlInput = root.querySelector('#theme-import-url');
    let refresh = () => refreshList(root, urlInput.value.trim(), state);

    // Reload the theme list whenever the URL changes.
    urlInput.addEventListener('change', refresh);
    urlInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {e.preventDefault(); refresh();}
    });
    root.querySelector('#theme-import-load').addEventListener('click', e => {
      e.preventDefault();
      refresh();
    });

    refresh(); // initial load
  }

  function importSelected(api, state) {
    let root = api.content;
    let toImport = [...root.querySelectorAll('input[name="import"]:checked')].map(i => i.value);
    let applyTitle = root.querySelector('input[name="apply"]:checked')?.value || '';
    if (applyTitle && !toImport.includes(applyTitle)) toImport.push(applyTitle);
    api.close();
    if (!toImport.length) return tw.ui.notify('No themes selected', 'W');
    doImport(toImport, applyTitle, state.byTitle);
  }

  // Fetch the package at `url` and (re)render the theme list inside the dialog.
  async function refreshList(root, url, state) {
    let box = root.querySelector('#theme-import-listbox');
    state.byTitle = new Map();
    if (!url) return status(box, 'Enter a themes.json URL.');
    status(box, 'Loading…');
    let tiddlers = await fetchPackage(url);
    if (!tiddlers) return status(box, 'Failed to load themes (see console log).', true);
    state.byTitle = new Map(tiddlers.map(t => [t.title, t]));
    let themes = tiddlers.filter(t => t.tags?.includes('$Theme'));
    if (!themes.length) return status(box, 'No themes found in this package.');
    box.innerHTML = listHtml(themes);
    // Applying a theme implies importing it.
    root.querySelectorAll('input[name="apply"]').forEach(radio => {
      radio.addEventListener('change', () => {
        if (!radio.value) return;
        let cb = root.querySelector(`input[name="import"][value="${cssEscape(radio.value)}"]`);
        if (cb) cb.checked = true;
      });
    });
  }

  function status(box, msg, isError) {
    box.innerHTML = `<p class="theme-import-status${isError ? ' error' : ''}">${escapeHtml(msg)}</p>`;
  }

  // Body only: the dialog title and Import/Cancel toolbar come from tw.ui.dialog.
  function dialogBodyHtml(url) {
    return `
      <form id="theme-import-form">
        <div class="theme-import-url">
          <input type="url" id="theme-import-url" value="${attr(url)}" placeholder="themes.json URL" size="60">
          <button id="theme-import-load" formnovalidate>Load</button>
        </div>
        <div id="theme-import-listbox"></div>
      </form>`;
  }

  function listHtml(themes) {
    let rows = themes.map((t, i) => `
      <tr>
        <td><input type="checkbox" name="import" value="${attr(t.title)}" id="ti-imp-${i}"></td>
        <td><input type="radio" name="apply" value="${attr(t.title)}" id="ti-app-${i}"></td>
        <td><label for="ti-imp-${i}">${escapeHtml(displayName(t.title))}</label></td>
      </tr>`).join('');
    return `
      <table class="theme-import-list">
        <thead><tr><th>Import</th><th>Apply</th><th>Theme</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <label class="theme-import-none">
        <input type="radio" name="apply" value="" checked> Apply: none
      </label>`;
  }

  function doImport(titles, applyTitle, byTitle) {
    let imported = new Set();
    titles.forEach(themeTitle => {
      let theme = byTitle.get(themeTitle);
      if (!theme) return;
      let sheets = referencedTitles(theme).filter(s => byTitle.has(s));
      [theme, ...sheets.map(s => byTitle.get(s))].forEach(t => {
        if (imported.has(t.title)) return;
        upsert(t);
        imported.add(t.title);
      });
    });
    tw.events.send('save.silent');
    if (applyTitle) tw.events.send('theme.switch', applyTitle);
    let suffix = applyTitle ? `, applied '${displayName(applyTitle)}'` : '';
    tw.ui.notify(`Imported ${titles.length} theme(s), ${imported.size} tiddler(s)${suffix}`, 'S');
  }

  function upsert(tiddler) {
    let copy = {...tiddler};
    tw.run.updateTiddlerHard(copy.title, copy); // upsert: adds if new, overwrites if present
    tw.events.send('tiddler.updated', copy.title); // let CoreThemeManager refresh the selector
  }

  function referencedTitles(themeTiddler) {
    let out = [];
    let re = /\[\[([^\]]+)\]\]/g;
    let m;
    while ((m = re.exec(themeTiddler.text || ''))) out.push(m[1]);
    return out;
  }

  function displayName(title) {
    return title.replace(/(^\$)|(Theme$)/g, '');
  }

  function attr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function escapeHtml(s) {
    return tw.core.common.escapeHtml(String(s));
  }

  // Escape a value for use inside a CSS attribute selector.
  function cssEscape(s) {
    return String(s).replace(/(["\\])/g, '\\$1');
  }

})();
