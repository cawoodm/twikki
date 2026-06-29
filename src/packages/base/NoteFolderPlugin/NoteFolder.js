(function () {
  const meta = {
    name: 'NoteFolder',
    version: '1.0.0',
    platform: '0.28.0',
    description: 'Fold (minimise) a tiddler to its title bar via a caret toggle; click again to unfold. Per-view state, not persisted.',
  };

  // SVG carets live as `[include]`d sections of this plugin tiddler (see the
  // CaretDown/CaretUp sections) — the shared `button.icon svg { fill: var(--col1) }`
  // rule colours them like the other title-bar icons. Down = "click to fold"; up =
  // "click to unfold". Fall back to a glyph only if a section is somehow absent.
  const caretDown = () => (tw.run.getTiddlerTextRaw('NoteFolderPlugin::CaretDown') || '').trim() || '▾';
  const caretUp = () => (tw.run.getTiddlerTextRaw('NoteFolderPlugin::CaretUp') || '').trim() || '▴';

  // Inject the fold toggle into each freshly-rendered card's title bar. The event
  // fires on the DETACHED element before insertion (see createTiddlerElement), so a
  // re-render re-injects automatically; the guard keeps it idempotent regardless.
  function addFoldToggle({newElement}) {
    const title = newElement.querySelector('.title');
    if (!title || title.querySelector('.foldnote-toggle')) return;
    const btn = tw.core.dom.htmlToNode(`<button class="icon foldnote-toggle" title="fold">${caretDown()}</button>`);
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      const card = btn.closest('.tiddler');
      if (!card) return;
      const folded = card.classList.toggle('folded');
      btn.innerHTML = folded ? caretUp() : caretDown();
      btn.title = folded ? 'unfold' : 'fold';
    });
    title.appendChild(btn);
  }

  return {
    meta,
    init() {
      tw.events.subscribe('tiddler.element.created', addFoldToggle, 'NoteFolder');
    },
  };
})();
