(function () {
  const meta = {
    name: 'CommandPalette',
    version: '1.0.0',
    platform: '0.26.0',
    description: 'Ctrl/Cmd+K palette for actions and tiddler navigation.',
  };

  let dialog;
  let input;
  let results;
  let items = [];
  let selected = 0;

  function wireUp(event, handler) {
    tw.events.subscribe(event, handler, 'CommandPalette');
  }

  function init() {
    document.getElementById('command-palette')?.remove();
    dialog = document.createElement('dialog');
    dialog.id = 'command-palette';
    dialog.innerHTML =
      '<input id="palette-input" type="text" autofocus autocomplete="off" spellcheck="false" ' +
      'placeholder="Search commands and notes…  (&gt; for commands only)" />' +
      '<div id="palette-results"></div>';
    document.body.appendChild(dialog);
    input = dialog.querySelector('#palette-input');
    results = dialog.querySelector('#palette-results');

    input.addEventListener('input', () => {
      selected = 0;
      render();
    });
    input.addEventListener('keydown', onInputKeydown);
    results.addEventListener('click', onResultsClick);
    dialog.addEventListener('close', () => {
      input.value = '';
    });

    if (!tw.tmp.commandPaletteBound) {
      tw.tmp.commandPaletteBound = true;
      document.addEventListener('keydown', onDocKeydown);
    }
  }

  function onDocKeydown(e) {
    if (e.key !== 'k' || !(e.ctrlKey || e.metaKey)) return;
    if (document.getElementById('new-dialog')?.open) return; // editing owns the keyboard
    e.preventDefault();
    open();
  }

  function open() {
    if (!dialog) return;
    input.value = '';
    selected = 0;
    render();
    if (!dialog.open) dialog.showModal();
    // showModal() runs the dialog focusing steps, which in some engines fire
    // after a synchronous focus() and steal it back to the dialog. Defer to the
    // next frame so the input reliably ends up focused.
    requestAnimationFrame(() => input.focus());
  }

  function buildItems() {
    let q = input.value;
    // `>` forces commands-only (Obsidian convention).
    if (q[0] === '>') return commandItems(q.slice(1).trim().toLowerCase());
    // Empty input → the full command list.
    if (!q.trim()) return commandItems('');
    // Plain text → matching commands first, then matching notes.
    return [...commandItems(q.trim().toLowerCase()), ...noteItems(q)];
  }

  function commandItems(needle) {
    return tw.commands
      .all()
      .filter(c => !needle || c.label.toLowerCase().includes(needle))
      .map(c => ({label: c.label, hint: 'command', run: () => runCommand(c)}));
  }

  function noteItems(q) {
    return tw.core.search
      .search(q, tw.tiddlers.all, {all: false})
      .filter(t => t && t.type) // drop the "No results!" placeholder (no type)
      .slice(0, 50)
      .map(t => ({label: t.title, hint: t.type, run: () => openNote(t.title)}));
  }

  function render() {
    items = buildItems();
    if (selected >= items.length) selected = Math.max(0, items.length - 1);
    if (!items.length) {
      results.innerHTML = '<div class="palette-empty">No matches</div>';
      return;
    }
    results.innerHTML = items
      .map(
        (it, i) =>
          `<div class="palette-row${i === selected ? ' selected' : ''}" data-index="${i}">` +
          `<span class="palette-label">${esc(it.label)}</span>` +
          `<span class="palette-hint">${esc(it.hint || '')}</span></div>`,
      )
      .join('');
    // Keep the keyboard-selected row visible as the selection moves past the
    // edge of the scroll viewport. `nearest` only scrolls when needed (no jump).
    results.querySelector('.palette-row.selected')?.scrollIntoView({block: 'nearest'});
  }

  function onInputKeydown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selected = Math.min(selected + 1, items.length - 1);
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selected = Math.max(selected - 1, 0);
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runSelected();
    }
    // Escape is handled natively by <dialog>
  }

  function onResultsClick(e) {
    let row = e.target.closest('.palette-row');
    if (!row) return;
    selected = Number(row.getAttribute('data-index'));
    runSelected();
  }

  function runSelected() {
    let it = items[selected];
    if (!it) return;
    dialog.close();
    it.run();
  }

  function runCommand(c) {
    if (c.run) return c.run();
    tw.events.send(c.event, c.payload);
  }

  function openNote(title) {
    tw.events.send('tiddler.show', title);
    if (tw.tabs) tw.tabs.activate(title);
  }

  function esc(s) {
    return tw.core.common.escapeHtml(String(s));
  }

  return {
    meta,
    init() {
      tw.tmp = tw.tmp || {};
      wireUp('ui.loaded', init);
      wireUp('ui.reloaded', init);
    },
  };
})();
