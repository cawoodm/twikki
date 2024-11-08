(function(tw) {

  const name = 'core.notifications';
  const version = '0.0.1';

  // Exports
  const exports = {notify};

  // Run
  const run = () => {
    notifyDiv = tw.core.dom.$('notify');
    if (!notifyDiv) return;
    notifyDiv.addEventListener('mouseover', notifyMouseOver);
    notifyDiv.addEventListener('mouseout', notifyMouseOut);
    notifyDiv.addEventListener('click', notifyClick);
  };

  let notifyDiv;

  return {name, version, exports, run};

  function notify(msg, type = 'I', stack) {
    if (type === 'D' && !tw.logging.debugMode) return;
    if (!tw.logging.logFilter.test(msg)) return;
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
    const types = {S: '📗 Success', E: '<b title="Error">📕</b>', W: '<b title="Warning">📙</b>', D: '<b title="Debug">📓</b>', I: '<b title="Info">📘</b>'};
    if (type === 'E')
      console.error(preserveMsg + types[type] + ': ' + msg, stack || '');
    notifyDiv.innerHTML = (preserveMsg + types[type] + ' ' + escapeHtml(msg)).replace(/\n/g, '<br>');
    // TODO: Keep array of tw.tmp.notifyMsgs = [{msg, expires}]
    notifyShow();
  };
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
    window.setTimeout(() => (delete tw.tmp.notifyMouseOverPause), 500);
  }
  function silentNotify(msg, type, stack) {
    if (type === 'E') console.error(msg);
    else if (type === 'W') console.warn(msg);
    else if (type === 'D') console.debug(msg);
    else console.log(msg);
    if (stack) console.error(stack);
  }
  function escapeHtml(unsafe) {
    return unsafe.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\'', '&#039;');
  }
});
