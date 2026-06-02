// tags: $Plugin

/**
 * ## Description
 * Generic icon-triggered popup picker. Drives the theme and workspace selectors
 * (and any future ones) without per-picker JS: a `.picker` container holds a
 * `.picker-trigger` icon button and a hidden `.picker-menu` of `.picker-item`
 * buttons. Clicking the trigger toggles the menu (positioned `fixed` from the
 * trigger's rect, flipped up/down by available space, so it escapes the
 * sidebar's `overflow:hidden`). Clicking an item sends the container's
 * `data-event` (item may override) with the item's `data-value`, then closes.
 * Outside click / Escape / scroll / resize close any open menu.
 *
 * Behaviour is document-level delegation bound once (guarded via tw.tmp), so it
 * survives UI re-renders without re-binding.
 */
/**
 * ## Data
 * ```json
 * {
 *   "version": 1.0.0
 * }
 * ```
 */
// ## Code
// ```javascript
(function() {

  tw.tmp = tw.tmp || {};
  if (tw.tmp.pickerBound) return;
  tw.tmp.pickerBound = true;

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', e => {if (e.key === 'Escape') closeAll();});
  window.addEventListener('scroll', closeAll, true);
  window.addEventListener('resize', closeAll);

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

  function openMenu(trigger, menu) {
    closeAll();
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

})();
