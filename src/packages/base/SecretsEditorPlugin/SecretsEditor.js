(function () {
  const meta = {
    name: 'SecretsEditor',
    version: '1.0.0',
    platform: '0.28.0',
    description: 'Edit device-local secrets in the $Secrets tiddler; saves to the global store, never the workspace.',
  };

  const TIDDLER = '$Secrets';

  // The raw secrets blob lives in the GLOBAL store (one `KEY: value` per line),
  // never in the per-workspace tiddler store — so it is never synced or backed up.
  const secretsKey = () => tw.core.settings.SECRETS_KEY;
  const readSecrets = () => tw.store.global.get(secretsKey()) || '';
  const writeSecrets = text => tw.store.global.set(secretsKey(), text);

  // Replace the rendered $Secrets body with a plain textarea of the global secrets
  // (mirrors how SettingsDialog swaps the $Settings body). Fires on the DETACHED
  // element before insertion — no flash of the placeholder text — and the guard
  // keeps it idempotent across show / re-render / preview.
  function onElementCreated({title, newElement}) {
    if (title !== TIDDLER) return;
    const textDiv = newElement.querySelector('.text');
    if (!textDiv || textDiv.querySelector('.secrets-editor')) return;

    const esc = v => tw.core.common.escapeHtml(String(v ?? ''));
    textDiv.innerHTML =
      '<div class="secrets-editor">' +
      '<p class="secrets-help">One <code>KEY: value</code> per line. Stored on THIS device only — written to the global store, never to the workspace, synced or backed up. Reference from a setting with <code>${secret:KEY}</code>.</p>' +
      `<textarea class="secrets-text" spellcheck="false" autocomplete="off" rows="10">${esc(readSecrets())}</textarea>` +
      '<div class="secrets-actions"><button type="button" class="secrets-save">Save</button><span class="secrets-status" aria-live="polite"></span></div>' +
      '</div>';

    const ta = textDiv.querySelector('.secrets-text');
    const status = textDiv.querySelector('.secrets-status');
    const save = () => {
      writeSecrets(ta.value); // → global store only; the $Secrets tiddler stays unsaved
      if (status) status.textContent = 'Saved (this device only)';
      tw.ui.notify('Secrets saved (this device only)', 'S');
    };
    // Save explicitly via the button, and on blur so edits aren't lost on navigate.
    textDiv.querySelector('.secrets-save').addEventListener('click', save);
    ta.addEventListener('change', save);
    // A double-click inside the editor must not bubble to the card's raw-edit open.
    ta.addEventListener('dblclick', e => e.stopPropagation());
  }

  return {
    meta,
    init() {
      tw.events.subscribe('tiddler.element.created', onElementCreated, meta.name);
      tw.events.subscribe('secrets.editor.open', () => tw.run.showTiddler(TIDDLER), meta.name);
      tw.extensions.registerCommand?.({label: 'Open secrets editor ($Secrets)', event: 'secrets.editor.open'});
    },
  };
})();
