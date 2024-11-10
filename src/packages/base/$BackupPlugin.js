/**
 * ## Description
 * Backup your data to [JSONBIN.io](https://jsonbin.io)
 */
/**
 * ## Data
 * ```json
 * {
 *   "version": 1.1.0
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
    let settings = tw.call('getJSONObject', '$GeneralSettings');
    if (!settings || !settings.backup?.JSONBin?.accessKey || !settings.backup?.JSONBin?.binId) return tw.ui.notify('No JSONBin accessKey/binId found in $GeneralSettings!', 'W');
    let res = await fetch('https://api.jsonbin.io/v3/b/' + settings.backup.JSONBin.binId, {
      headers: {
        'X-Access-Key': settings.backup.JSONBin.accessKey,
      },
    });
    if (!res.ok) return tw.ui.notify(`Restore failed '${res.status}' (see log)`, 'E');
    let result = await res.json();
    Object.assign(tw.tiddlers, result.record);
    tw.run.save();
    if (confirm('Restore complete. Would you like to reload?')) tw.events.send('reboot.hard');
    tw.ui.notify('Restore complete!', 'S'); // Should we save/remind to save?
  },
  async save() {
    let settings = tw.call('getJSONObject', '$GeneralSettings');
    if (!settings || !settings.backup?.JSONBin?.accessKey || !settings.backup?.JSONBin?.binId) return tw.ui.notify('No JSONBin accessKey/binId found in $GeneralSettings!', 'W');
    let body = JSON.stringify({
      all: tw.tiddlers.all,
      visible: tw.tiddlers.visible,
      // trashed: tw.tiddlers.trashed,
    });
    let res = await fetch('https://api.jsonbin.io/v3/b/' + settings.backup.JSONBin.binId, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Access-Key': settings.backup.JSONBin.accessKey,
      // 'X-Bin-Versioning': true, // Not available in Free JSONBin :-(
      },
      body,
    });
    // doesn't get caught by notify!! throw new Error('Backup failed: ' + res.statusText);
    if (!res.status === 403) return tw.ui.notify(`Backup failed '${res.status}': 100KB limit reached on JSONBin!`, 'E');
    if (!res.ok) return tw.ui.notify(`Backup failed '${res.status}' (see log)`, 'E');
    // let result = await res.json();
    tw.ui.notify(`Backup complete! (${body.length / 1000} KB)`, 'S');
  },
};
tw.events.override('backup.save', tw.macros.backup.save);
tw.events.override('backup.restore', tw.macros.backup.restore);
