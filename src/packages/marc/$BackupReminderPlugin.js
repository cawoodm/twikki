// tags: $Script

(function(){
  // Friendly reminder to backup!
  let secs = parseInt(tw.call('getJSONObject', '$GeneralSettings')?.backup?.backupInSeconds || 1800, 10);
  setInterval(() => {
    tw.ui.notify('Remember to backup', 'I');
  }, secs * 1000);
})();
