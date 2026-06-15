// tags: $Plugin

(function () {
  const meta = {
    name: 'BackupReminder',
    version: '1.0.0',
    platform: '0.26.0',
    description: 'Periodic notification reminding the user to back up.',
  };

  return {
    meta,
    init() {
      // Friendly reminder to backup!
      let secs = parseInt(tw.call('getJSONObject', '$GeneralSettings')?.backup?.backupInSeconds || 1800, 10);
      setInterval(() => {
        tw.ui.notify('Remember to backup', 'I');
      }, secs * 1000);
    },
  };
})();
