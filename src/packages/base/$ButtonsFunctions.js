// tags: $Script
// `core.button` — generic button. Short-name fallback in core.render.js means
// <<button>> resolves here without any `core.` prefix at the call site.
tw.extensions.registerMacro('core', 'button', (title, msg, payload = '', id = '') => tw.ui.button(title, msg, payload, id), {
  description: 'Generic button: label, event to send, optional payload and id.',
  example: '<<button "Open All Help" ui.open.all tag:Help>>',
});
