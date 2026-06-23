(function () {
  const meta = {
    name: 'PackageImport',
    version: '1.0.0',
    platform: '0.27.0',
    description: 'Import dialog for packages: pick which tiddlers to import, see what is new vs. overwritten, and choose whether to save and/or reload.',
  };

  const DIALOG_ID = 'package-import-dialog';

  function esc(s) {
    return tw.core.common.escapeHtml(String(s ?? ''));
  }

  // Classify how importing one package tiddler would affect the store. Mirrors
  // the decisions loadList() makes so the dialog can preview them up front.
  function statusFor(t) {
    const ex = tw.run.getTiddler(t.title, false);
    if (!ex) return {kind: 'new', label: 'new', locked: false};
    if (ex.tags?.includes('$NoImport')) return {kind: 'locked', label: 'protected ($NoImport)', locked: true};
    if (ex.isRawShadow) return {kind: 'shadow', label: 'replaces default', locked: false};
    const changed = ex.text !== t.text || (ex.tags || []).join(' ') !== (t.tags || []).join(' ');
    if (changed) return {kind: 'overwrite', label: 'overwrites your version', locked: false};
    return {kind: 'same', label: 'identical', locked: false};
  }

  // Handler for `package.reload.url` (overrides the core handler). Fetches the
  // package, then opens the selection dialog instead of importing blindly.
  // `pkg` keeps the FULL tiddler list (loadList prunes against it); `display`
  // is the filtered subset the dialog actually shows.
  async function onImportRequested(payload = {}) {
    const {url, name = '', filter} = payload;
    if (!url) return tw.ui.notify('No package URL supplied to import.', 'E');
    const pkg = await tw.core.packaging.fetchPackage({url, name});
    if (!pkg) return; // fetchPackage already notified on failure
    let display = pkg.tiddlers;
    if (filter && filter !== '*') {
      const re = new RegExp(filter, 'i');
      display = display.filter(t => re.test(t.title));
    }
    if (!display.length) return tw.ui.notify(`Package '${name || url}' contains no matching tiddlers.`, 'W');
    openDialog(pkg, display);
  }

  function openDialog(pkg, display) {
    const rows = display
      .map((t, i) => {
        const s = statusFor(t);
        const checked = s.locked ? '' : ' checked';
        const disabled = s.locked ? ' disabled' : '';
        return (
          '<li class="pkg-import-row">' +
          '<label>' +
          `<input type="checkbox" class="pkg-import-item" data-index="${i}"${checked}${disabled}/>` +
          `<span class="pkg-import-title">${esc(t.title)}</span>` +
          `<span class="pkg-import-status status-${s.kind}">${esc(s.label)}</span>` +
          '</label></li>'
        );
      })
      .join('');

    const html =
      '<div class="pkg-import-head">' +
      '<label><input type="checkbox" class="pkg-import-all" checked/> Select all</label>' +
      '<span class="pkg-import-count"></span>' +
      '</div>' +
      `<ul class="pkg-import-list">${rows}</ul>` +
      '<div class="pkg-import-opts">' +
      '<label><input type="checkbox" class="pkg-import-save" checked/> Save</label>' +
      '<label><input type="checkbox" class="pkg-import-reload"/> Reload</label>' +
      '</div>';

    const api = tw.ui.dialog({
      id: DIALOG_ID,
      title: `Import: ${pkg.name || pkg.url}`,
      className: 'pkg-import',
      html,
      buttons: [
        {text: 'Cancel', close: true},
        {text: 'Import', className: 'primary', onClick: (ev, dlg) => doImport(pkg, display, dlg)},
      ],
    });

    wireDialog(api);
  }

  // Wire the select-all <-> per-item checkboxes and keep the live count in sync.
  function wireDialog(api) {
    const root = api.content;
    const all = root.querySelector('.pkg-import-all');
    const items = [...root.querySelectorAll('.pkg-import-item')];
    const selectable = items.filter(i => !i.disabled);
    const count = root.querySelector('.pkg-import-count');

    const refresh = () => {
      const n = selectable.filter(i => i.checked).length;
      count.textContent = `${n} of ${selectable.length} selected`;
      all.checked = n > 0 && n === selectable.length;
      all.indeterminate = n > 0 && n < selectable.length;
    };

    all.addEventListener('change', () => {
      selectable.forEach(i => (i.checked = all.checked));
      refresh();
    });
    selectable.forEach(i => i.addEventListener('change', refresh));
    refresh();
  }

  function doImport(pkg, display, dlg) {
    const root = dlg.content;
    const selectedTitles = new Set([...root.querySelectorAll('.pkg-import-item')].filter(i => i.checked && !i.disabled).map(i => display[Number(i.dataset.index)].title));
    const save = root.querySelector('.pkg-import-save').checked;
    const reload = root.querySelector('.pkg-import-reload').checked;

    if (!selectedTitles.size) return tw.ui.notify('No tiddlers selected to import.', 'W');

    const count = tw.core.packaging.loadList(pkg.tiddlers, {name: pkg.name, overWrite: true, selectedTitles});
    if (save) tw.events.send('save');
    if (reload) tw.events.send('ui.reload');
    tw.ui.notify(`${count} tiddler${count === 1 ? '' : 's'} imported from '${pkg.name || pkg.url}'${save ? ' and saved' : ''}.`, 'S');
    dlg.close();
  }

  return {
    meta,
    init() {
      tw.events.override('package.reload.url', onImportRequested, meta.name);
    },
    unload() {
      document.getElementById(DIALOG_ID)?.remove();
    },
  };
})();
