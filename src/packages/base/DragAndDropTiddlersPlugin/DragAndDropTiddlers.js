(function () {
  const meta = {
    name: 'DragAndDropTiddlers',
    version: '1.0.0',
    platform: '0.27.0',
    description: 'Drag tiddlers between TWikki windows; also imports packages (*.json files with a tiddlers array).',
    dependencies: ['DropZone'],
  };

  const MIME = 'application/x-twikki-tiddlers+json';
  const DIALOG_ID = 'dnd-import-dialog';
  const HANDLER_KEY = 'DragAndDropTiddlers';

  let originatedHere = false;

  // -- Source side -----------------------------------------------------------

  // Resolve the dragged tiddler's title from either a main-tiddler .title bar
  // (sits inside .tiddler[data-tiddler-title]) or a TabsPlugin tab (.tab[data-tab]).
  function resolveDragTitle(target) {
    const tab = target.closest('#tab-strip .tab[data-tab]');
    if (tab) return tab.dataset.tab;
    const titleBar = target.closest('.tiddler > .title');
    if (!titleBar) return null;
    return titleBar.parentElement?.dataset.tiddlerTitle || null;
  }

  function onDragStart(ev) {
    const title = resolveDragTitle(ev.target);
    if (!title) return;
    const t = tw.run.getTiddler(title, true);
    if (!t) return;
    const payload = {version: 1, tiddlers: [stripVolatile(t)]};
    try {
      ev.dataTransfer.setData(MIME, JSON.stringify(payload));
      ev.dataTransfer.setData('text/plain', title);
      ev.dataTransfer.effectAllowed = 'copy';
      originatedHere = true;
    } catch (e) {
      dp('DragAndDropTiddlers.onDragStart failed', e);
    }
  }

  function onDragEnd() {
    originatedHere = false;
  }

  // Decorate the title bar of a freshly rendered main tiddler so the browser
  // will initiate a drag from it. Idempotent.
  function decorateTiddlerTitle({newElement}) {
    newElement?.querySelector(':scope > .title')?.setAttribute('draggable', 'true');
  }

  // TabsPlugin rewrites #tab-strip.innerHTML wholesale on every flush, so we
  // can't just decorate once: re-apply on every mutation.
  function decorateTabs() {
    document.querySelectorAll('#tab-strip .tab[data-tab]').forEach(el => el.setAttribute('draggable', 'true'));
  }
  let tabObserver = null;
  function startTabStripObserver() {
    if (tabObserver) return;
    const strip = document.getElementById('tab-strip');
    if (!strip) return;
    tabObserver = new MutationObserver(decorateTabs);
    tabObserver.observe(strip, {childList: true});
    decorateTabs();
  }
  function stopTabStripObserver() {
    tabObserver?.disconnect();
    tabObserver = null;
  }

  // -- Target side -----------------------------------------------------------

  function onDragOver(ev) {
    if (ev.dataTransfer?.types?.includes(MIME)) ev.preventDefault();
  }
  function onDrop(ev) {
    const raw = ev.dataTransfer?.getData(MIME);
    if (!raw) return; // file drops fall through to $DropZonePlugin
    ev.preventDefault();
    if (originatedHere) return;
    let bundle;
    try {
      bundle = JSON.parse(raw);
    } catch (e) {
      return tw.ui.notify('Invalid drag payload (not JSON)', 'E', e.stack);
    }
    importBundle(bundle);
  }

  // -- Import core (shared by cross-window drag AND DropZone file handlers) --

  function importBundle(bundle) {
    const incoming = Array.isArray(bundle?.tiddlers) ? bundle.tiddlers : null;
    if (!incoming?.length) return tw.ui.notify('No tiddlers in payload', 'W');
    const rows = incoming.map(raw => {
      const tiddler = coerceDates(raw);
      return {tiddler, exists: !!tw.run.getTiddler(tiddler.title, false)};
    });
    showImportDialog(rows);
  }

  function showImportDialog(rows) {
    const list = rows.map(rowHtml).join('');
    const html = `<ul class="tw-import-list">${list}</ul>`;
    const noun = rows.length === 1 ? 'tiddler' : 'tiddlers';
    tw.ui.dialog({
      id: DIALOG_ID,
      title: `Import ${rows.length} ${noun}?`,
      html,
      buttons: [
        {text: 'Cancel', close: true},
        {
          text: 'Import',
          onClick: (_e, api) => {
            performImport(rows);
            api.close();
          },
          close: true,
        },
      ],
    });
  }

  function performImport(rows) {
    let ok = 0;
    const failed = [];
    rows.forEach(({tiddler}) => {
      // $NoImport on the target side blocks the write, matching the package
      // importer's behaviour (see core.packaging.js:60). Skip silently here
      // and report in the post-import notify rather than per-row, since the
      // dialog already showed the user the OVERWRITE rows.
      const existing = tw.run.getTiddler(tiddler.title, false);
      if (existing?.tags?.includes('$NoImport')) {
        failed.push(`${tiddler.title}: target is tagged $NoImport`);
        return;
      }
      const issues = tw.util.tiddlerValidation(tiddler);
      if (issues.length) {
        failed.push(`${tiddler.title}: ${issues.join('; ')}`);
        return;
      }
      try {
        tw.run.updateTiddlerHard(tiddler.title, {...tiddler});
        tw.events.send('tiddler.modified', tiddler.title);
        ok++;
      } catch (e) {
        failed.push(`${tiddler.title}: ${e.message}`);
      }
    });
    tw.core.store.autoSave();
    const baseMsg = `Imported ${ok} tiddler${ok === 1 ? '' : 's'}`;
    if (failed.length) {
      tw.ui.notify(`${baseMsg} (${failed.length} failed)`, 'W');
      failed.forEach(line => dp('DragAndDropTiddlers import failed:', line));
    } else {
      tw.ui.notify(baseMsg, 'S');
    }
  }

  // -- Helpers ---------------------------------------------------------------

  function stripVolatile(t) {
    // Strip runtime-only flags that shouldn't travel between instances.
    const {doesNotExist, isRawShadow, ...rest} = t;
    return rest;
  }
  function coerceDates(t) {
    return {
      ...t,
      created: t.created ? new Date(t.created) : new Date(),
      updated: t.updated ? new Date(t.updated) : new Date(),
    };
  }
  function rowHtml({tiddler, exists}) {
    const title = tw.core.common.escapeHtml(tiddler.title);
    const status = exists ? 'OVERWRITE' : 'NEW';
    const cls = exists ? 'overwrite' : 'new';
    return `<li><span class="tw-import-status ${cls}">${status}</span><span class="tw-import-title">${title}</span></li>`;
  }

  return {
    meta,
    init() {
      if (tw.tmp.dndTiddlers) return;
      tw.tmp.dndTiddlers = 1;
      // File-drop bridge — DropZonePlugin exposes registerDropHandler at LOAD
      // time (its IIFE body), so this is safe to call from init().
      if (typeof tw.run.registerDropHandler === 'function') {
        tw.run.registerDropHandler('*.json', text => {
          let data;
          try {
            data = JSON.parse(text);
          } catch (e) {
            return tw.ui.notify('Invalid JSON file', 'E', e.stack);
          }
          if (!Array.isArray(data?.tiddlers)) return tw.ui.notify('Not a tiddler bundle', 'W');
          importBundle(data);
        });
      }
      // Decoration: main tiddler titles are re-emitted on every render; tabs
      // need a MutationObserver because TabsPlugin replaces innerHTML wholesale.
      tw.events.subscribe('tiddler.element.created', decorateTiddlerTitle, HANDLER_KEY);
      tw.events.subscribe('ui.loaded', startTabStripObserver, HANDLER_KEY);
      tw.events.subscribe('ui.reloaded', startTabStripObserver, HANDLER_KEY);
    },
    start() {
      tw.core.dom.on(document, 'dragstart', onDragStart, HANDLER_KEY);
      tw.core.dom.on(document, 'dragend', onDragEnd, HANDLER_KEY);
      tw.core.dom.on(document, 'dragover', onDragOver, HANDLER_KEY);
      tw.core.dom.on(document, 'drop', onDrop, HANDLER_KEY);
    },
    unload() {
      stopTabStripObserver();
    },
  };
})();
