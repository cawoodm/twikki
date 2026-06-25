(function () {
  const meta = {
    name: 'NotificationBell',
    version: '1.0.0',
    platform: '0.28.0',
    description: 'A <<NotificationBell>> widget with a red count bubble that collects ui.notify messages into a popup.',
    author: 'Marc Cawood',
  };

  // Type glyphs mirror core.notifications (S/E/W/D/I).
  const GLYPHS = {S: '📗', E: '📕', W: '📙', D: '📓', I: '📘'};

  // Keep the most recent notifications; older ones drop off the end.
  const MAX = 30;

  // In-memory message log — survives toast auto-hide but resets on soft reload
  // (the IIFE is re-evaluated). Each entry: {id, msg, type, time}. Newest first.
  const messages = [];
  let seq = 0; // monotonic id, so a row's ✕ removes the right entry

  let origNotify; // the wrapped-around core notify, restored on unload
  let popup; // the body-level popup, created lazily on first open

  // --- Hook: wrap tw.ui.notify so every toast is also recorded here. There is
  // no notify event to subscribe to, so we intercept the function directly and
  // then delegate to the original to keep the toast behaviour unchanged. ---
  function installHook() {
    if (origNotify) return; // already wrapped
    origNotify = tw.ui.notify;
    tw.ui.notify = function (msg, type = 'I', stack) {
      record(msg, type);
      return origNotify.call(tw.ui, msg, type, stack);
    };
  }

  function record(msg, type) {
    messages.unshift({id: ++seq, msg: String(msg), type: GLYPHS[type] ? type : 'I', time: Date.now()});
    if (messages.length > MAX) messages.length = MAX; // keep the last 30
    updateBadge();
    if (popup && !popup.hidden) render(); // live-update an open popup
  }

  // --- The widget markup, returned by the <<NotificationBell>> macro so the
  // user can place the bell wherever they like (e.g. in their $TitleBar).
  // Single-line phrasing content only (button/span/svg) — markdown-it wraps the
  // macro output in a <p>, which would hoist block elements out. ---
  function bellHtml() {
    return (
      '<button class="icon notify-bell" title="Notifications" aria-label="Notifications" aria-haspopup="true">' +
      '<svg width="22px" height="22px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>' +
      `<span class="notify-badge"${messages.length ? '' : ' hidden'}>${messages.length}</span>` +
      '</button>'
    );
  }

  // Badge shows how many notifications are held (max 30). Update every rendered
  // badge (the macro may appear more than once).
  function updateBadge() {
    document.querySelectorAll('.notify-badge').forEach(b => {
      b.toggleAttribute('hidden', messages.length === 0);
      b.textContent = String(messages.length);
    });
  }

  function ensurePopup() {
    popup = document.getElementById('notify-popup');
    if (!popup) {
      popup = document.createElement('div');
      popup.id = 'notify-popup';
      popup.className = 'notify-popup';
      popup.hidden = true;
      document.body.appendChild(popup);
    }
    return popup;
  }

  // --- Popup open/close (positioning mirrors PickerPlugin) ---
  function openPopup(anchor) {
    ensurePopup();
    render();
    popup.hidden = false;
    let r = anchor.getBoundingClientRect();
    let ph = popup.offsetHeight;
    let pw = popup.offsetWidth;
    let spaceBelow = window.innerHeight - r.bottom;
    let openUp = spaceBelow < ph + 8 && r.top > spaceBelow;
    let top = openUp ? Math.max(8, r.top - ph - 4) : r.bottom + 4;
    let left = Math.max(8, Math.min(r.right - pw, window.innerWidth - pw - 8));
    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
  }

  function closePopup() {
    if (popup) popup.hidden = true;
  }

  function render() {
    let body = messages.length ? messages.map(rowHtml).join('') : '<div class="notify-empty">No notifications</div>';
    let footer = messages.length ? '<button class="notify-clear">Clear all</button>' : '';
    popup.innerHTML = '<div class="notify-list">' + body + '</div>' + footer;
  }

  function rowHtml(m) {
    let msg = tw.core.common.escapeHtml(m.msg);
    return (
      `<div class="notify-item" data-id="${m.id}">` +
      '<span class="notify-glyph">' +
      GLYPHS[m.type] +
      '</span>' +
      '<span class="notify-msg">' +
      msg +
      '</span>' +
      '<span class="notify-time">' +
      ago(m.time) +
      '</span>' +
      `<span class="notify-remove" data-id="${m.id}" title="Remove" role="button" aria-label="Remove">✕</span>` +
      '</div>'
    );
  }

  function remove(id) {
    let i = messages.findIndex(m => m.id === id);
    if (i >= 0) messages.splice(i, 1);
    updateBadge();
    render();
  }

  function ago(time) {
    let s = Math.floor((Date.now() - time) / 1000);
    if (s < 60) return 'just now';
    let m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    let h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  function clearAll() {
    messages.length = 0;
    updateBadge();
    render();
  }

  // --- Document-level delegation (one set of listeners, owner-tracked) ---
  function onClick(e) {
    let bell = e.target.closest('.notify-bell');
    if (bell) {
      e.preventDefault();
      if (!popup || popup.hidden) openPopup(bell);
      else closePopup();
      return;
    }
    let remBtn = e.target.closest('.notify-remove');
    if (remBtn) {
      e.preventDefault();
      remove(Number(remBtn.dataset.id));
      return;
    }
    if (e.target.closest('.notify-clear')) {
      e.preventDefault();
      clearAll();
      return;
    }
    if (e.target.closest('.notify-popup')) return; // click inside the popup
    closePopup(); // click anywhere else
  }

  function onEscape(e) {
    if (e.key === 'Escape') closePopup();
  }

  function onScroll(e) {
    if (e.target?.closest?.('.notify-popup')) return;
    closePopup();
  }

  return {
    meta,
    init() {
      installHook();
      tw.extensions.registerMacro('core', 'NotificationBell', bellHtml, {
        description: 'Bell widget showing collected ui.notify messages with an unread count. Add it to your $TitleBar.',
        example: '<<NotificationBell>>',
      });
      tw.core.dom.on(document, 'click', onClick, 'NotificationBell');
      tw.core.dom.on(document, 'keydown', onEscape, 'NotificationBell');
      tw.core.dom.on(window, 'scroll', onScroll, 'NotificationBell', true);
      tw.core.dom.on(window, 'resize', closePopup, 'NotificationBell');
    },
    unload() {
      closePopup();
      if (origNotify) tw.ui.notify = origNotify;
      document.getElementById('notify-popup')?.remove();
    },
  };
})();
