(function () {
  const meta = {
    name: 'Tabs',
    version: '1.1.0',
    platform: '0.28.0',
    description: 'Tabbed open-tiddlers view with keyboard navigation.',
  };

  const MAX_TABS = 30; // hard upper bound; the rest go in the overflow dropdown
  const MIN_TAB = 96; // px — keeps ≥3 chars + ellipsis legible (matches .tab min-width in CSS)
  const TRAILING = 40; // px reserved for the new-note button / overflow trigger
  const ACTIVE_KEY = 'tab-active'; // workspace-scoped store key for the last active tab
  let strip; // #tab-strip
  let vis; // #visible-tiddlers
  let app; // #app (carries the mode-tabs / mode-river class)
  let mode = 'tabs'; // 'tabs' | 'river' — from $Settings.layout.mode
  let lastVisible = [];
  let batch = [];
  let scheduled = false;
  let scrollPos = {}; // remembered scrollTop per note title

  // Single sink for the active tab — keep tw.tabs.active and the persisted
  // workspace key in sync so a reload restores the last-viewed note.
  function setActive(title) {
    if (!tw.tabs) return;
    if (tw.tabs.active === title) return;
    tw.tabs.active = title;
    try {
      tw.store.set(ACTIVE_KEY, title);
    } catch {}
  }

  function wireUp(event, handler) {
    tw.events.subscribe(event, handler, 'TabsPlugin');
  }

  function onWindowResize() {
    if (mode === 'tabs') schedule();
  }

  function init() {
    strip = document.getElementById('tab-strip');
    vis = document.getElementById('visible-tiddlers');
    app = document.getElementById('app');
    if (!strip || !vis) return;
    mode = layoutMode();
    scrollPos = {};
    let restored = null;
    try {
      restored = tw.store.get(ACTIVE_KEY) || null;
    } catch {}
    tw.tabs = {active: restored, rebuild: () => schedule(), activate};

    if (app) {
      app.classList.toggle('mode-river', mode !== 'tabs');
      app.classList.toggle('mode-tabs', mode === 'tabs');
    }

    if (mode === 'river') {
      // No tabs: let every open note stack (the .tabbed show/hide rule is off).
      vis.classList.remove('tabbed');
      strip.innerHTML = '';
      vis.querySelectorAll(':scope > .tiddler.tab-active').forEach(el => el.classList.remove('tab-active'));
      return;
    }

    vis.classList.add('tabbed');
    if (!strip._tabsBound) {
      strip._tabsBound = true;
      strip.addEventListener('click', onStripClick);
    }
    // Re-split tabs vs. overflow when the available width changes. Tracked
    // so the platform's unloadPlugins() phase removes it before re-evaluating
    // this plugin's code — otherwise old IIFE's closure (with stale `mode` /
    // `schedule`) keeps firing alongside the new one.
    tw.core.dom.on(window, 'resize', onWindowResize, 'TabsPlugin');
    lastVisible = tw.tiddlers.visible.slice();
    flush();
  }

  function layoutMode() {
    try {
      return tw.run.getJSONObject('$Settings')?.layout?.mode === 'tabs' ? 'tabs' : 'river';
    } catch {
      return 'tabs';
    }
  }

  function refreshMode() {
    if (layoutMode() !== mode) init();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    Promise.resolve().then(flush);
  }

  function flush() {
    scheduled = false;
    if (mode !== 'tabs' || !strip || !vis) {
      batch = [];
      return;
    }
    let rendered = batch;
    batch = [];
    let visible = tw.tiddlers.visible;
    let active = tw.tabs ? tw.tabs.active : null;

    if (rendered.length === 1 && visible.includes(rendered[0])) {
      // Single note just opened → make it active.
      active = rendered[0];
    } else if (!visible.includes(active)) {
      // Active note is gone (closed) → activate its neighbour.
      let idx = lastVisible.indexOf(active);
      if (idx < 0) idx = visible.length - 1;
      active = visible[Math.min(idx, visible.length - 1)] || visible[visible.length - 1] || null;
    }

    setActive(active);
    rebuildStrip(visible, active);
    applyActive(active);
    restoreScroll(active);
    // Forget scroll for notes that are no longer open.
    Object.keys(scrollPos).forEach(t => {
      if (!visible.includes(t)) delete scrollPos[t];
    });
    lastVisible = visible.slice();
  }

  function activate(title) {
    if (mode !== 'tabs' || !title) return;
    saveScroll(); // capture the outgoing note's position before it hides
    setActive(title);
    applyActive(title);
    rebuildStrip(tw.tiddlers.visible, title);
    restoreScroll(title);
  }

  function saveScroll() {
    if (vis && tw.tabs && tw.tabs.active != null) scrollPos[tw.tabs.active] = vis.scrollTop;
  }

  function restoreScroll(title) {
    if (vis) vis.scrollTop = scrollPos[title] || 0;
  }

  function capacity(count) {
    let width = strip ? strip.clientWidth : 0;
    if (!width) return MAX_TABS;
    let fitsAll = Math.floor((width - TRAILING) / MIN_TAB);
    if (count <= fitsAll) return count;
    return Math.max(1, Math.floor((width - TRAILING * 2) / MIN_TAB));
  }

  function rebuildStrip(visible, active) {
    if (!strip) return;
    let shownCount = Math.min(visible.length, capacity(visible.length), MAX_TABS);
    let shown = visible.slice(0, shownCount);
    if (active && shownCount && !shown.includes(active)) shown[shownCount - 1] = active;
    let overflow = visible.filter(t => !shown.includes(t));
    if (tw.tabs) tw.tabs.overflow = overflow; // read by the `taboverflow` picker source

    let more = overflow.length
      ? `
      <span class="picker tab-overflow" data-source="taboverflow" data-event="tiddler.show">
        <button class="icon picker-trigger" title="${overflow.length} more notes" aria-haspopup="true">⋯</button>
        <span class="picker-menu" hidden></span>
      </span>`
      : '';

    strip.innerHTML =
      shown
        .map(
          title => `
      <div class="tab${title === active ? ' active' : ''}" data-tab="${attr(title)}" title="${attr(title)}">
        <span class="tab-label">${esc(label(title))}</span>
        <button class="tab-close icon" data-msg="tiddler.close" data-params="${tw.core.params.enc(title)}" title="Close">✕</button>
      </div>`,
        )
        .join('') +
      more +
      '<button class="tab-new icon" data-msg="tiddler.new" title="New note">+</button>';
  }

  function applyActive(active) {
    if (!vis) return;
    vis.querySelectorAll(':scope > .tiddler').forEach(el => {
      el.classList.toggle('tab-active', el.getAttribute('data-tiddler-title') === active);
    });
    if (strip)
      strip.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.getAttribute('data-tab') === active);
      });
  }

  function onStripClick(e) {
    if (e.target.closest('.tab-close')) return; // close handled by platform data-msg
    let tab = e.target.closest('.tab');
    if (tab) activate(tab.getAttribute('data-tab'));
  }

  function label(title) {
    return title.replace(/^\$/, '');
  }

  function attr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function esc(s) {
    return tw.core.common.escapeHtml(String(s));
  }

  return {
    meta,
    settings: {
      'layout.mode': {default: 'river', type: 'option', options: ['river', 'tabs'], description: 'How open notes are displayed: tabs (one at a time) or river (all stacked)'},
    },
    init() {
      wireUp('ui.loaded', init);
      wireUp('ui.reloaded', init);

      // Re-apply when the layout mode changes (raw edit emits tiddler.modified; the
      // settings form saves via updateTiddlerHard + save.silent). Cheap; only re-inits
      // when the mode actually flips.
      ['save.auto', 'tiddler.modified', 'tiddler.updated'].forEach(ev => wireUp(ev, refreshMode));

      wireUp('tiddler.rendered', ({tiddler}) => {
        batch.push(tiddler.title);
        schedule();
      });
      wireUp('ui.ready', schedule);
      wireUp('story.changed', schedule);
      // Focus a note's tab when it's requested while already open (link/hash/search):
      // showTiddler early-returns in that case and emits `tiddler.refocus` instead of
      // re-rendering. (Newly-opened notes are handled via `tiddler.rendered` above.)
      wireUp('tiddler.refocus', activate);
    },
  };
})();
