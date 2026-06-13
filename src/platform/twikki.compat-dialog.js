// Boot-time core-module compatibility dialog — loaded ON DEMAND by the platform
// (showCompatDialog) only when a boot halts on an incompatible or missing core
// module. It runs before any module is eval'd, so it cannot rely on tw.ui/
// tw.core or theme stylesheets — everything is plain DOM + inline styles on a
// native <dialog>. If THIS file fails to load, the platform falls back to a
// plain halt message — the dialog is an enhancement, never load-bearing.
//
// Crucially it persists NOTHING until the user chooses:
//   • Update — store the shown modules and reload (allowed unless a ✗ major-version block).
//   • Keep current versions — discard the update and reload using the installed (cached)
//     modules (offered only when a usable, non-blocking cached set exists).
// The user can also repoint the source URL and re-check before deciding.
//
// ctx (from the platform): {tw, VERSION, baseUrl, checkModuleCompat, readObject,
//   isCachedModuleUsable, storeCoreModule, tryFetchModule, reloadWithoutForce}
window.twikkiCompatDialog = function (ctx) {
  const {
    tw,
    VERSION,
    baseUrl,
    checkModuleCompat,
    readObject,
    isCachedModuleUsable,
    storeCoreModule,
    tryFetchModule,
    reloadWithoutForce,
  } = ctx;

  const escAttr = s =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;');
  const esc = s =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const dlg = document.createElement('dialog');
  dlg.id = 'tw-compat-dialog';
  dlg.style.cssText =
    'max-width:700px;width:90%;font:14px/1.45 system-ui,sans-serif;color:#1a1a1a;' +
    'border:1px solid #999;border-radius:10px;padding:1.5rem;box-shadow:0 8px 32px rgba(0,0,0,.25)';

  // The set of modules under consideration: starts as what init() loaded, and is replaced
  // wholesale when the user re-checks a different source URL. Each entry is {name, res}.
  let candidates = tw.modules.map(m => ({name: m.name, res: m.res}));

  const reportsFor = set => set.map(c => checkModuleCompat({name: c.name, res: c.res}));
  const hasBlock = reps => reps.some(r => r.severity === 'block');

  // The currently-installed (cached) set — used to decide whether "Keep current versions"
  // can boot. Available only if every module has a usable cache and none of them block.
  function cachedSet() {
    return tw.modules.map(m => ({name: m.name, res: readObject('/modules' + m.name)}));
  }
  function canKeepCurrent() {
    const cs = cachedSet();
    if (!cs.every(c => isCachedModuleUsable(c.res))) return false;
    return !hasBlock(reportsFor(cs));
  }

  function statusText(r) {
    if (r.exempt) return 'list (exempt)';
    if (r.severity === 'ok') return '✓ OK';
    if (r.severity === 'warn') return '⚠ ' + (r.reason || 'minor mismatch');
    return '✗ ' + (r.reason || 'incompatible');
  }
  function rowBg(r) {
    if (r.severity === 'block') return 'background:#fde8e8'; // red — hard block
    if (r.severity === 'warn') return 'background:#fff4d6'; // amber — overridable
    return '';
  }

  // Which rows the user has ticked to install. The checkbox is pre-ticked for compatible
  // (✓) modules, un-ticked but tickable for ⚠ minor mismatches, and disabled for ✗ major
  // mismatches (which can never be installed).
  function selectedIndexes() {
    return [...dlg.querySelectorAll('.tw-compat-pick:checked')].map(cb => +cb.dataset.idx);
  }
  function refreshInstallBtn() {
    const btn = dlg.querySelector('#tw-compat-install');
    if (btn) btn.disabled = selectedIndexes().length === 0;
  }

  function render() {
    const reps = reportsFor(candidates);
    const keepable = canKeepCurrent();
    const rows = reps
      .map((r, i) => {
        const cell = 'padding:4px 8px;border:1px solid #ddd';
        const selectable = r.severity !== 'block';
        const checkbox =
          `<input type="checkbox" class="tw-compat-pick" data-idx="${i}"` +
          `${r.severity === 'ok' ? ' checked' : ''}${selectable ? '' : ' disabled'}>`;
        return (
          `<tr style="${rowBg(r)}">` +
          `<td style="${cell};text-align:center">${checkbox}</td>` +
          `<td style="${cell}">${esc(r.name)}</td>` +
          `<td style="${cell}">${esc(r.version ?? '—')}</td>` +
          `<td style="${cell}">${esc(r.required ?? '—')}</td>` +
          `<td style="${cell}">${esc(statusText(r))}</td></tr>`
        );
      })
      .join('');
    dlg.innerHTML = `
      <h2 style="margin:0 0 .5rem">Module compatibility</h2>
      <p style="margin:.25rem 0">Running platform <b>v${esc(VERSION)}</b>. Tick the modules to install
      then <b>Update selected</b>, or <b>Keep current versions</b> to change nothing. Compatible (✓)
      modules are pre-selected; an <b>⚠</b> minor mismatch can be ticked to install it anyway; a
      <b>✗</b> major mismatch can't be installed.</p>
      <label style="display:block;margin:.75rem 0 .25rem">Source base URL:</label>
      <div style="display:flex;gap:.5rem">
        <input id="tw-compat-url" style="flex:1;padding:.4rem;border:1px solid #aaa;border-radius:6px"
          value="${escAttr(baseUrl)}">
        <button id="tw-compat-load" style="padding:.4rem .8rem">Re-check</button>
      </div>
      <table style="width:100%;border-collapse:collapse;margin:1rem 0;font-size:13px">
        <thead><tr>
          <th style="padding:4px 8px;border:1px solid #ddd;text-align:center">Install</th>
          <th style="padding:4px 8px;border:1px solid #ddd;text-align:left">Module</th>
          <th style="padding:4px 8px;border:1px solid #ddd;text-align:left">Version</th>
          <th style="padding:4px 8px;border:1px solid #ddd;text-align:left">Built for</th>
          <th style="padding:4px 8px;border:1px solid #ddd;text-align:left">Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="display:flex;gap:.5rem;justify-content:flex-end">
        <button id="tw-compat-keep" style="padding:.5rem 1rem"${keepable ? '' : ' disabled'}>Keep current versions</button>
        <button id="tw-compat-install" style="padding:.5rem 1rem;font-weight:600">Update selected &amp; reload</button>
      </div>`;
    dlg.querySelector('#tw-compat-load').onclick = onRecheck;
    dlg.querySelector('#tw-compat-keep').onclick = onKeepCurrent;
    dlg.querySelector('#tw-compat-install').onclick = onUpdate;
    dlg.querySelectorAll('.tw-compat-pick').forEach(cb => (cb.onchange = refreshInstallBtn));
    refreshInstallBtn();
  }

  async function onRecheck() {
    const url = dlg.querySelector('#tw-compat-url').value.trim();
    if (!url) return;
    const btn = dlg.querySelector('#tw-compat-load');
    btn.disabled = true;
    candidates = await Promise.all(
      tw.modules.map(async m => {
        const r = await tryFetchModule(m.name, url);
        // A failed fetch becomes an un-storable placeholder so its row shows the error and
        // is non-selectable (block) without throwing.
        return {name: m.name, res: r.ok ? r.res : {type: 'error', error: r.error}};
      }),
    );
    tw.storage.set('/moduleUrl', url);
    render();
  }

  function onUpdate() {
    // TODO: Possible bug: does it read the URL the user entered?
    // Persist only the ticked modules; the rest keep their installed (cached) copies.
    // Then reload (without ?reload) so the next boot reads the cache.
    const idxs = selectedIndexes();
    if (!idxs.length) return;
    idxs.forEach(i => storeCoreModule(candidates[i].name, candidates[i].res));
    const url = dlg.querySelector('#tw-compat-url').value.trim();
    if (url) tw.storage.set('/moduleUrl', url);
    reloadWithoutForce();
  }

  function onKeepCurrent() {
    // Discard the update entirely. Nothing was written, so a plain reload boots the
    // installed (cached) modules.
    reloadWithoutForce();
  }

  document.body.appendChild(dlg);
  render();
  dlg.showModal();
};
