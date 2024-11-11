/**
 * ## Description
 * Backup your data to [JSONSilo.com](https://jsonsilo.com)
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
tw.macros.backup = {
  restoreButton() {
    return tw.ui.button('{{$IconRestore}}', 'backup.restore', null, 'restore', 'title="Restore Backup Data"');
  },
  backupButton() {
    return tw.ui.button('{{$IconBackup}}', 'backup.save', null, 'backup', 'title="Backup Data"');
  },
  async restore() {
    alert('JSONSilo');
    let settings = tw.call('getJSONObject', '$GeneralSettings');
    if (!settings || !settings.backup?.JSONSilo?.accessKey || !settings.backup?.JSONSilo?.siloId) return tw.ui.notify('No JSONSilo accessKey/siloId found in $GeneralSettings!', 'W');
    let res = await fetch('https://api.jsonsilo.com/' + settings.backup.JSONSilo.siloId, {
      headers: {
        'X-SILO-KEY': settings.backup.JSONSilo.accessKey,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) return tw.ui.notify(`Restore failed '${res.status}' (see log)`, 'E');
    let result = await res.json();
    Object.assign(tw.tiddlers, result.record);
    tw.run.save();
    if (confirm('Restore complete. Would you like to reload?')) tw.events.send('reboot.hard');
    tw.ui.notify('Restore complete!', 'S');
  },
  async save() {
    alert('JSONSilo');
    let settings = tw.call('getJSONObject', '$GeneralSettings');
    if (!settings || !settings.backup?.JSONSilo?.accessKey || !settings.backup?.JSONSilo?.siloId) return tw.ui.notify('No JSONSilo accessKey/siloId found in $GeneralSettings!', 'W');
    let body = JSON.stringify({
      all: tw.tiddlers.all,
      visible: tw.tiddlers.visible,
      trashed: tw.tiddlers.trashed,
    });
    let res = await fetch('https://api.jsonsilo.com/' + settings.backup.JSONSilo.siloId, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-SILO-KEY': settings.backup.JSONSilo.accessKey,
      },
      body,
    });
    if (!res.status === 403) return tw.ui.notify(`Backup failed '${res.status}': Unauthorized (see log)!`, 'E');
    if (!res.ok) return tw.ui.notify(`Backup failed '${res.status}' (see log)`, 'E');
    tw.ui.notify(`Backup complete! (${body.length / 1000} KB)`, 'S');
  },
};
tw.events.override('backup.save', tw.macros.backup.save);
tw.events.override('backup.restore', tw.macros.backup.restore);
