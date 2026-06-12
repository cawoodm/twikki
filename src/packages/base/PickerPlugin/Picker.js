(function () {
  const meta = {
    name: 'Picker',
    version: '1.0.0',
    platform: '0.24.0',
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
      e.preventDefault();
      let picker = item.closest('.picker');
      let event = item.dataset.event || picker?.dataset.event;
      let value = item.dataset.value || '';
      closeAll();
      if (event) tw.events.send(event, value);
      return;
    }
    closeAll(); // click outside any picker
  }

  // Lazy menu sources: a `.picker[data-source]` builds its items on open (so the
  // list is fresh and not baked into markup). Each returns [{value, label}].
  const SOURCES = {
    tag: (arg) =>
      (tw.run.getTiddlersByTag(arg) || [])
        .map((t) => t.title)
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
        .map((title) => ({value: title, label: title})),
    package: (arg) =>
      (tw.run.getTiddlersByPackage(arg) || [])
        .map((t) => t.title)
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
        .map((title) => ({value: title, label: title})),
    // Open notes that overflow the tab strip (the split is owned by TabsPlugin).
    taboverflow: () => (tw.tabs?.overflow || []).map((t) => ({value: t, label: t.replace(/^\$/, '')})),
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
    document.querySelectorAll('.picker-menu:not([hidden])').forEach((m) => (m.hidden = true));
  }

  return {
    meta,
    init() {
      tw.tmp = tw.tmp || {};
      if (tw.tmp.pickerBound) return;
      tw.tmp.pickerBound = true;

      document.addEventListener('click', onClick);
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAll();
      });
      window.addEventListener('scroll', closeAll, true);
      window.addEventListener('resize', closeAll);
    },
  };
})();
