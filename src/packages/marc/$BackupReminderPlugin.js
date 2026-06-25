// tags: $Plugin

(function () {
  const meta = {
    name: 'BackupReminder',
    version: '1.0.1',
    platform: '0.27.0',
    description: 'Periodic notification reminding the user to back up.',
  };

  let timerId = null;

  return {
    meta,
    init() {
      const secs = parseInt(tw.run.getJSONObject('$GeneralSettings')?.backup?.backupInSeconds || 1800, 10);
      timerId = setInterval(() => {
        tw.ui.notify('Remember to backup', 'I');
      }, secs * 1000);
    },
    unload() {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
    },
  };
})();
