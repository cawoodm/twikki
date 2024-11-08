// Friendly reminder to backup!
let secs = parseInt(tw.call('getJSONObject', '$GeneralSettings')?.backup?.backupInSeconds || 1800, 10);
setInterval(() => {
  // tw.ui.notify('Remember to backup', 'I');
  clearTimeout(tw.tmp.notifyId); // User must click it away
}, secs * 1000);

// // Display immediately conflicts with startup notifications so we display in 10s
// setTimeout(() => {
//   tw.ui.notify('Remember to backup', 'I');
//   clearTimeout(tw.tmp.notifyId); // User must click it away
// }, 10 * 1000);
