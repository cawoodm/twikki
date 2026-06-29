/**
 * Notifications
 * The `notify(msg, type, stack)` toast shown in the `#notify` div: type icons
 * (S/E/W/D/I), 4s auto-hide with hover-to-pin and click-to-dismiss. Falls back
 * to alert() while a modal dialog is open (the toast would be hidden) and to
 * plain console logging before the UI exists. Debug ('D') messages respect
 * `?debug`, and all messages respect the `?logfilter` regex.
 */
export default function (tw) {
  const name = 'core.notifications';
  const version = '0.25.0';
  const platform = '0.27.0'; // built for platform ^0.27.0

  // Exports
  const exports = {notify, notifyProgress};

  // Run — the #notify div only exists after core.ui's renderLayout has painted
  // the chrome (this module now loads before core.ui), so wire it on 'ui.loading'.
  const run = () => {
    tw.events.subscribe('ui.loading', wireNotifyDiv, 'core.notifications');
  };
  function wireNotifyDiv() {
    notifyDiv = tw.core.dom.$('notify');
    if (!notifyDiv) return;
    notifyDiv.addEventListener('mouseover', notifyMouseOver);
    notifyDiv.addEventListener('mouseout', notifyMouseOut);
    notifyDiv.addEventListener('click', notifyClick);
  }

  let notifyDiv;

  return {name, version, platform, exports, run};

  function notify(msg, type = 'I', stack) {
    if (type === 'D' && !tw.logging.debugMode) return;
    if (type === 'D' && !tw.logging.logFilter.test(msg)) return;
    if (!tw.core.dom.$('notify')) return silentNotify(msg, type, stack);
    if (window.getComputedStyle(tw.core.dom.$('new-dialog'), null).getPropertyValue('display') === 'block') {
      // If modal is displayed, notify div is hidden => use alert()
      delete tw.tmp.notifyId; // Prevent stacking in the alert
      return alert(msg.replaceAll('<br>', '\n'));
    }
    let preserveMsg = '';
    if (tw.tmp.notifyId) {
      clearTimeout(tw.tmp.notifyId);
      preserveMsg = notifyDiv.innerHTML ? notifyDiv.innerHTML + '\n' : '';
    }
    const types = {
      S: '📗 Success',
      E: '<b title="Error">📕</b>',
      W: '<b title="Warning">📙</b>',
      D: '<b title="Debug">📓</b>',
      I: '<b title="Info">📘</b>',
    };
    if (type === 'E') console.error(preserveMsg + types[type] + ': ' + msg, stack || '');
    notifyDiv.innerHTML = (preserveMsg + types[type] + ' ' + escapeHtml(msg)).replace(/\n/g, '<br>');
    // TODO: Keep array of tw.tmp.notifyMsgs = [{msg, expires}]
    notifyShow();
  }
  // A persistent progress toast for long jobs (e.g. migrating to file storage).
  // Returns {update(fraction 0..1, text?), done(msg?, type?)}. While active the
  // 4s auto-hide is suppressed; done() hands back to a normal auto-hiding toast.
  // Degrades to a console no-op updater when the #notify div doesn't exist yet.
  function notifyProgress(label = '') {
    const div = tw.core.dom.$('notify');
    if (!div) return {update() {}, done: (msg, type) => silentNotify(msg || label, type || 'I')};
    if (tw.tmp.notifyId) {
      clearTimeout(tw.tmp.notifyId);
      delete tw.tmp.notifyId;
    }
    div.innerHTML =
      '<span class="notify-progress-label"></span> ' +
      '<progress class="notify-progress" max="100" value="0" style="vertical-align:middle;width:8rem"></progress> ' +
      '<span class="notify-progress-pct">0%</span>';
    notifyDiv = div;
    div.querySelector('.notify-progress-label').textContent = label;
    div.className = div.className.replace('notifyHidden', 'notifyShow');
    const bar = div.querySelector('.notify-progress');
    const pct = div.querySelector('.notify-progress-pct');
    const lbl = div.querySelector('.notify-progress-label');
    return {
      update(fraction, text) {
        const v = Math.max(0, Math.min(100, Math.round((Number(fraction) || 0) * 100)));
        bar.value = v;
        pct.textContent = v + '%';
        if (text != null) lbl.textContent = text;
        // Stay visible for the whole job — never auto-hide mid-progress.
        if (tw.tmp.notifyId) {
          clearTimeout(tw.tmp.notifyId);
          delete tw.tmp.notifyId;
        }
        div.className = div.className.replace('notifyHidden', 'notifyShow');
      },
      done(msg, type = 'S') {
        notify(msg || label + ' complete', type); // normal toast + auto-hide resumes
      },
    };
  }
  function notifyShow() {
    notifyDiv.className = notifyDiv.className.replace('notifyHidden', 'notifyShow');
    tw.tmp.notifyId = setTimeout(notifyHide, 4000);
  }
  function notifyHide() {
    notifyDiv.className = notifyDiv.className.replace('notifyShow', 'notifyHidden');
    delete tw.tmp.notifyId;
  }
  function notifyMouseOver() {
    if (tw.tmp.notifyMouseOverPause) return;
    clearTimeout(tw.tmp.notifyId);
  }
  function notifyMouseOut() {
    if (tw.tmp.notifyMouseOverPause) return;
    notifyShow();
  }
  function notifyClick() {
    notifyHide();
    tw.tmp.notifyMouseOverPause = true;
    window.setTimeout(() => delete tw.tmp.notifyMouseOverPause, 500);
  }
  function silentNotify(msg, type, stack) {
    if (type === 'E') console.error(msg);
    else if (type === 'W') console.warn(msg);
    else if (type === 'D') console.debug(msg);
    else console.log(msg);
    if (stack) console.error(stack);
  }
  function escapeHtml(unsafe) {
    return unsafe.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
}
