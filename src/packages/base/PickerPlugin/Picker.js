(function () {
  const meta = {
    name: 'Picker',
    version: '1.0.0',
    platform: '0.27.0',
    description: 'Generic clickable picker bound via document-level delegation.',
  };

  function onClick(e) {
    let trigger = e.target.closest('.picker-trigger');
    if (trigger) {
      e.preventDefault();
      let menu = trigger.closest('.picker')?.querySelector('.picker-menu');
      if (menu && menu.hidden) openMenu(trigger, menu);
      else closeAll();
      return;
    }
    let item = e.target.closest('.picker-item');
    if (item) {
      // Anchor item + Ctrl/Cmd-click: let the browser open it in a new tab.
      // (Middle-click fires `auxclick`, which this handler doesn't listen to.)
      if ((e.ctrlKey || e.metaKey) && item.tagName === 'A') {
        closeAll();
        return;
      }
      e.preventDefault();
      let picker = item.closest('.picker');
      let event = item.dataset.event || picker?.dataset.event;
      let value = item.dataset.value || '';
      closeAll();
      if (event) tw.events.send(event, value);
      return;
    }
    // A click on the menu chrome itself (scrollbar, padding) is not "outside".
    if (e.target.closest('.picker-menu')) return;
    closeAll(); // click outside any picker
  }

  // Lazy menu sources: a `.picker[data-source]` builds its items on open (so the
  // list is fresh and not baked into markup). Each returns [{value, label}].
  const SOURCES = {
    tag: arg =>
      (tw.run.getTiddlersByTag(arg) || [])
        .map(t => t.title)
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
        .map(title => ({value: title, label: title})),
    package: arg =>
      (tw.run.getTiddlersByPackage(arg) || [])
        .map(t => t.title)
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
        .map(title => ({value: title, label: title})),
    // Open notes that overflow the tab strip (the split is owned by TabsPlugin).
    taboverflow: () => (tw.tabs?.overflow || []).map(t => ({value: t, label: t.replace(/^\$/, '')})),
    // Every tag in the store, dispatched as a `search` for `tag:<name>`.
    alltags: () =>
      (tw.run?.allTags?.() || [])
        .filter(Boolean)
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
        .map(tag => ({value: 'tag:' + tag, label: tag})),
  };

  function populate(picker, menu) {
    let src = SOURCES[picker.dataset.source];
    if (!src) return;
    let items = src(picker.dataset.sourceArg) || [];
    menu.textContent = '';
    if (!items.length) {
      let empty = document.createElement('div');
      empty.className = 'picker-empty';
      empty.textContent = 'Nothing here';
      menu.appendChild(empty);
      return;
    }
    for (let it of items) {
      let b = document.createElement('div');
      b.className = 'picker-item';
      b.dataset.value = it.value;
      b.textContent = it.label;
      menu.appendChild(b);
    }
  }

  function openMenu(trigger, menu) {
    closeAll();
    let picker = trigger.closest('.picker');
    if (picker?.dataset.source) populate(picker, menu);
    menu.hidden = false;
    let r = trigger.getBoundingClientRect();
    let mh = menu.offsetHeight;
    let mw = menu.offsetWidth;
    let spaceBelow = window.innerHeight - r.bottom;
    let openUp = spaceBelow < mh + 8 && r.top > spaceBelow;
    let top = openUp ? Math.max(8, r.top - mh - 4) : r.bottom + 4;
    let left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8));
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
  }

  function closeAll() {
    document.querySelectorAll('.picker-menu:not([hidden])').forEach(m => (m.hidden = true));
  }

  function onEscape(e) {
    if (e.key === 'Escape') closeAll();
  }

  // Close on page scroll (the fixed menu is pinned to its trigger and would
  // detach) — but not when the scroll happens inside the menu's own list.
  function onScroll(e) {
    if (e.target?.closest?.('.picker-menu')) return;
    closeAll();
  }

  return {
    meta,
    init() {
      tw.core.dom.on(document, 'click', onClick, 'Picker');
      tw.core.dom.on(document, 'keydown', onEscape, 'Picker');
      tw.core.dom.on(window, 'scroll', onScroll, 'Picker', true);
      tw.core.dom.on(window, 'resize', closeAll, 'Picker');
    },
    unload() {
      closeAll();
    },
  };
})();
