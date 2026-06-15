// tags: $Plugin

/**
 * ## Description
 * Generic file drag-and-drop: plugins claim dropped files by filename glob via
 * `tw.run.registerDropHandler('*.workspace.json', (text, file) => {...})`.
 * The most specific (longest) matching pattern wins. Shows a full-screen
 * overlay while a file is dragged over the window.
 *
 * The registration API is installed at plugin LOAD time (this IIFE body), so
 * every other plugin can call `tw.run.registerDropHandler` from its `init()`
 * regardless of plugin order (all plugins load before any init runs).
 */
(function () {
  const meta = {
    name: 'DropZone',
    version: '1.0.0',
    platform: '0.26.0',
    description: 'File drag-and-drop with glob-registered handlers and a drop overlay.',
  };

  // The handler list lives on tw.tmp (not in this closure) so the document
  // listeners — bound once per page — always see the CURRENT registrations,
  // even after a soft reload re-evals this plugin and plugins re-register.
  tw.tmp.dropHandlers = [];
  let dragDepth = 0; // counter avoids overlay flicker when dragging over child elements

  function globToRegex(pattern) {
    return new RegExp('^' + pattern.replace(/[.]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
  }
  tw.run.registerDropHandler = function registerDropHandler(pattern, handler) {
    tw.tmp.dropHandlers.push({pattern, rx: globToRegex(pattern), handler});
  };

  function handleDrop(event) {
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    event.preventDefault();
    dragDepth = 0;
    hideDropOverlay();
    // Most specific pattern wins: '*.workspace.json' (longer) beats '*.json'
    const sorted = [...tw.tmp.dropHandlers].sort((a, b) => b.pattern.length - a.pattern.length);
    files.forEach(file => {
      const match = sorted.find(h => h.rx.test(file.name));
      if (!match) return tw.ui.notify(`No handler for '${file.name}'`, 'W');
      const reader = new FileReader();
      reader.onload = () => match.handler(reader.result, file);
      reader.readAsText(file);
    });
  }
  function showDropOverlay() {
    let el = document.getElementById('drop-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'drop-overlay';
      el.textContent = '⤓ Drop a file to import';
      // Inline styles keep the overlay self-contained (no CSS-tiddler dependency);
      // pointer-events:none so it never intercepts the drop or fires dragleave itself.
      el.style.cssText =
        'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;' +
        'justify-content:center;background:rgba(0,0,0,0.5);color:#fff;font-size:2em;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.style.display = 'flex';
  }
  function hideDropOverlay() {
    const el = document.getElementById('drop-overlay');
    if (el) el.style.display = 'none';
  }

  return {
    meta,
    start() {
      if (tw.tmp.dropZoneBound) return; // soft reload re-runs start(); bind the document listeners once
      tw.tmp.dropZoneBound = true;
      const hasFiles = e => Array.from(e.dataTransfer?.types || []).includes('Files');
      document.addEventListener('dragenter', e => {
        if (!hasFiles(e)) return;
        dragDepth++;
        showDropOverlay();
      });
      document.addEventListener('dragover', e => {
        if (hasFiles(e)) e.preventDefault(); // required to enable drop
      });
      document.addEventListener('dragleave', e => {
        if (hasFiles(e) && --dragDepth <= 0) hideDropOverlay();
      });
      document.addEventListener('drop', handleDrop);
    },
  };
})();
