// tags: $Plugin

/**
 * ## Description
 * Editor niceties on top of the core edit round-trip: the Ctrl+Enter
 * save-hotkey in the edit form, and the preview pane (`tw.run.previewTiddler`
 * / the tiddler.preview events — also used by the trash manager and sync log).
 * Without this plugin the plain edit path (click-to-edit, click-save) still
 * works — these are enhancements, per the no-plugin invariant.
 */
(function () {
  const meta = {
    name: 'EditorTools',
    version: '1.0.0',
    platform: '0.27.0',
    description: 'Editor enhancements: Ctrl+Enter save hotkey and the preview pane.',
  };

  // A way of showing a tiddler which may or may not exist
  function previewTiddler(t, template) {
    if (typeof t === 'string') t = tw.run.getTiddler(t);
    let newElement = tw.core.render.createTiddlerElement(t, template || tw.templates.TiddlerPreview);
    tw.core.dom.preview.innerHTML = '';
    tw.core.dom.preview.insertAdjacentElement('afterbegin', newElement);
    tw.core.dom.preview.showModal();
  }
  function closePreview() {
    tw.core.dom.preview.close();
  }

  function onEditorKeydown(e) {
    if (e.ctrlKey && (e.code === 'Enter' || e.code === 'NumpadEnter')) {
      e.preventDefault();
      tw.events.send('form.done');
    }
  }

  return {
    meta,
    init() {
      Object.assign(tw.run, {previewTiddler, closePreview});
      tw.events.subscribe('tiddler.preview', previewTiddler, 'EditorTools');
      tw.events.subscribe('tiddler.preview.close', closePreview, 'EditorTools');
      // `keydown` (not the deprecated `keypress`): keypress is no longer
      // dispatched by automation tools (Playwright, chrome-devtools MCP) so
      // the hotkey is undriveable from tests. `preventDefault()` suppresses
      // the textarea's default Enter→newline insertion.
      if (tw.core.dom.frm) {
        tw.core.dom.on(tw.core.dom.frm, 'keydown', onEditorKeydown, 'EditorTools');
      }
    },
  };
})();
