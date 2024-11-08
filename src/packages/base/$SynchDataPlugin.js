/**
 * ## Description
 * $SynchDataFunctions
 * Synch your data with [JSONBIN.io](https://jsonbin.io)
 * ### Release Notes
 * * v1.0.8
 *   * Don't synch trashed tiddlers
 */
/**
 * ## Data
 * ```json
 * {
 *   "version": 1.0.7
 * }
 * ```
 */
// ## Code
// ```javascript
// TODO: Push force, clearing remote
// TODO: Pull force, clearing local
// TODO: Selective Synch: Include/Exclude Tags/Packages
tw.macros.synch = (function(){
  // TODO: Make events handler support asynch
  // tw.events.subscribe('synch.full')
  // onclick=tw.events.send(\'synch.full\')
  return {
    // <<synch.full>>: Push/pull to/from remote
    full() {
      return tw.ui.button('{{$IconSynch}}', 'synch.full', null, 'btn-synch', 'title="Synch Data"');
    },
    async doFull() {
      return await synch({pull: true, push: true});
    },
    // <<synch.test>>: Simulate push/pull to/from remote
    test() {
      return '<button onclick="tw.macros.synch.doTest()">Synch Test</button>';
    },
    async doTest() {
      return await synch({pull: true, push: true, dryRun: true});
    },
    // <<synch.pull>>: Only import from remote
    pull() {
      return tw.ui.button('{{$IconPull}}', 'synch.pull', null, 'btn-synch-pull', 'title="Pull Synched Data"');
    },
    async doPull() {
      return await synch({pull: true, push: false});
    },
    // <<synch.push>>: Only write to remote
    push() {
      return tw.ui.button('{{$IconPush}}', 'synch.push', null, 'btn-synch-push', 'title="Push Synched Data"');
    },
    async doPush() {
      return await synch({pull: false, push: true});
    },
    // TODO: Delete all remote and push (backup)
    // TODO: Delete all local and pull (restore)
  };

  // eslint-disable-next-line complexity
  async function synch({push = true, pull = true, dryRun = false}) {

    if (!push && !pull) throw new Error('SynchDataFunctions: Please supply push or pull parameters!');

    let settings = tw.call('getJSONObject', '$GeneralSettings');
    if (!settings || !settings.synch?.JSONBin?.accessKey || !settings.synch?.JSONBin?.binId) return tw.ui.notify('No JSONBin accessKey/binId found in $GeneralSettings!', 'W');
    let headers = {'X-Access-Key': settings.synch.JSONBin.accessKey};

    // Fetch remote
    let res = await fetch('https://api.jsonbin.io/v3/b/' + settings.synch.JSONBin.binId, {headers});
    if (!res.ok) return tw.ui.notify(`Restore failed '${res.status}' (see log)`, 'E');
    let result = await res.json();
    let remoteTiddlers = result.record.tiddlers || [];
    let remoteTrashedTiddlers = result.record.trashed || [];

    let log = [];
    let remote = {create: [], update: [], delete: []};
    let local = {create: [], update: [], delete: []};

    let localTiddlers = tw.tiddlers.all
      .filter(t => !t.isRawShadow); // Don't synch raw shadows - See BUG below

    // eslint-disable-next-line complexity
    remoteTiddlers.forEach(remoteTiddler => {
      remoteTiddler.created = new Date(remoteTiddler.created);
      remoteTiddler.updated = new Date(remoteTiddler.updated);
      let localTiddler = localTiddlers.find(t => t.title === remoteTiddler.title);
      if (remoteTiddler.tags.includes('$NoSynch') || localTiddler?.tags.includes('$NoSynch')) log.push(`Skipping $NoSynch tiddler [[${localTiddler.title}]]`);
      // if (remoteTiddler.title.match(/SynchLog/)) debugger;
      // TODO: BUG: Deleted local shadow tiddler is pulled in from remote
      let deletedLocalTiddler = tw.tiddlers.trashed.find(t => t.title === remoteTiddler.title);
      let deletedLocally = !localTiddler && deletedLocalTiddler?.updated > remoteTiddler.updated;
      let createdRemotely = !localTiddler && !deletedLocally;
      let updatedLocally = localTiddler?.updated > remoteTiddler.updated;
      let updatedRemotely = remoteTiddler.updated > localTiddler?.updated;
      if (deletedLocally) {
        // Delete Remote
        if (push) remote.delete.push(deletedLocalTiddler.title);
      } else if (createdRemotely) {
        // Restore Local: Updated remotely after local delete
        if (pull) {
          if (!dryRun) tw.run.addTiddler(remoteTiddler);
          local.create.push(remoteTiddler.title);
          log.push(`Created local tiddler [[${remoteTiddler.title}]]`);
        }
      } else if (updatedLocally) {
        // Local update is newer
        if (push) remote.update.push(localTiddler.title); // 👈
      } else if (updatedRemotely) {
        // Remote update is newer
        if (push) {
          if (!dryRun) tw.run.updateTiddlerHard(remoteTiddler.title, remoteTiddler);
          local.update.push(remoteTiddler.title);
          log.push(`Updated local tiddler [[${localTiddler.title}]]`); // 👈
        }
      }
    });

    localTiddlers.forEach(localTiddler => {
      if (localTiddler.tags.includes('$NoSynch')) log.push(`Skipping $NoSynch tiddler [[${localTiddler.title}]]`);
      let remoteTiddler = remoteTiddlers.find(t => t.title === localTiddler.title);
      if (remoteTiddler) {
        remoteTiddler.created = new Date(remoteTiddler.created);
        remoteTiddler.updated = new Date(remoteTiddler.updated);
      }
      let deletedRemoteTiddler = remoteTrashedTiddlers.find(t => t.title === localTiddler.title);
      let deletedRemotely = !remoteTiddler && deletedRemoteTiddler?.updated > localTiddler.updated;
      let createdLocally = !remoteTiddler && !deletedRemotely;
      if (deletedRemotely) {
        // Delete Locally
        if (pull) {
          if (!dryRun) tw.run.deleteTiddler(localTiddler.title, true);
          local.delete.push(remoteTiddler.title);
          log.push(`Deleted local tiddler [[${localTiddler.title}]]`);
        }
      } else if (createdLocally) {
        if (push) remote.create.push(localTiddler.title);
      }
      // Updated locally/remotely handled above ☝️
    });

    if (remote.create.length + remote.update.length + remote.delete.length +
      local.create.length + local.update.length + local.delete.length === 0
    ) return tw.ui.notify('No changes to synch', 'S');

    if (push) {
      // Perform remote updates
      remote.create.forEach(title => {
        log.push(`Created remote tiddler [[${title}]]`);
      });
      remote.update.forEach(title => {
        log.push(`Updated remote tiddler [[${title}]]`);
      });
      remote.delete.forEach(title => {
        log.push(`Deleted remote tiddler [[${title}]]`);
      });
    }

    let logTiddler = {
      title: `$SynchLog ${new Date().toISOString()}`,
      text: logSummary(local, remote) + '\n\n## Log\n' + log.join('  \n') + '',
      tags: ['$SynchLog'],
      type: 'x-twikki',
    };

    if (push && !dryRun) {
      let body = JSON.stringify({
        tiddlers: localTiddlers,
        visible: tw.tiddlers.visible,
      });
      // We never push/pull trashed as this is local information (we read but never write it)
      res = await fetch('https://api.jsonbin.io/v3/b/' + settings.synch.JSONBin.binId, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Access-Key': settings.synch.JSONBin.accessKey,
        },
        body,
      });
      // doesn't get caught by notify!! throw new Error('Backup failed: ' + res.statusText);
      if (!res.ok) return tw.ui.notify(`Synch (push) to remote failed '${res.status}' (see log)`, 'E');
    }

    if (!dryRun) tw.events.send('reboot.softer');

    if (push && pull) {
      tw.ui.notify('Synch (full) complete!', 'S');
    } else if (pull) {
      tw.ui.notify('Synch (pull) complete!', 'S');
    } else if (push) {
      tw.ui.notify('Synch (push) complete!', 'S');
    }

    tw.run.previewTiddler(logTiddler);

    function logSummary(local, remote) {
      return `
## Local
* Created (${local.create.length}) ${local.create.length ? ':\n  * [[' + local.create.join(']]\n  * [[') + ']]\n' : ''}
* Updated (${local.update.length}) ${local.update.length ? ':\n  * [[' + local.update.join(']]\n  * [[') + ']]\n' : ''}
* Deleted (${local.delete.length}) ${local.delete.length ? ':\n  * [[' + local.delete.join(']]\n  * [[') + ']]\n' : ''}
## Remote
* Created (${remote.create.length}) ${remote.create.length ? ':\n  * [[' + remote.create.join(']]\n  * [[') + ']]\n' : ''}
* Updated (${remote.update.length}) ${remote.update.length ? ':\n  * [[' + remote.update.join(']]\n  * [[') + ']]\n' : ''}
* Deleted (${remote.delete.length}) ${remote.delete.length ? ':\n  * [[' + remote.delete.join(']]\n  * [[') + ']]\n' : ''}
`.trim();
    }
  }

})();
tw.events.subscribe('synch.full', 'tw.macros.synch.doFull');
tw.events.subscribe('synch.push', 'tw.macros.synch.doPush');
tw.events.subscribe('synch.pull', 'tw.macros.synch.doPull');
