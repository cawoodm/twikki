// tags: $Plugin

/**
 * ## Description
 * $SynchDataFunctions
 * Synchronise your data with a private [GitHub Gist](https://gist.github.com).
 * Each tiddler is stored as a separate file so changes appear as per-tiddler
 * diffs in the gist's history. A sidecar `_twikki.meta.json` holds the visible
 * list. On first push (when no gistId is configured) a new private gist is
 * created and its id is written back to [[$GeneralSettings]].
 *
 * Tiddlers tagged `$NoSynch` are never pushed.
 *
 * The PAT must have the `gist` scope.
 *
 */
// TODO: Pull force, clearing local
// TODO: Selective Synch: Include/Exclude Tags/Packages
(function () {
  const meta = {
    name: 'SynchData',
    version: '2.0.0',
    platform: '0.27.0',
    description: 'Two-way sync of tiddlers with a private GitHub Gist (per-tiddler files).',
  };

  const META_FILENAME = '_twikki.meta.json';
  const FORMAT = 'twikki-sync-v1';
  const DEFAULT_DESCRIPTION = 'TWikki sync';

  const isNoPush = t => t.tags?.includes('$NoSynch') || t.tags?.includes('$NoBackup');

  async function doFull() {
    return await synch({pull: true, push: true});
  }
  async function doPull() {
    return await synch({pull: true, push: false});
  }
  async function doPush() {
    return await synch({pull: false, push: true});
  }
  async function doUpload() {
    return await synch({pull: false, push: true, fetchRemote: false});
  }
  async function synch({fetchRemote = true, push = true, pull = true, dryRun = false}) {
    if (!push && !pull) throw new Error('SynchDataFunctions: Please supply push or pull parameters!');

    let settings = tw.call('getJSONObject', '$GeneralSettings');
    if (!settings || !settings.synch?.Gist?.accessToken) return tw.ui.notify('No Gist accessToken found in $GeneralSettings.synch.Gist!', 'W');
    const cfg = {
      accessToken: settings.synch.Gist.accessToken,
      gistId: settings.synch.Gist.gistId || '',
      description: settings.synch.Gist.description || `${DEFAULT_DESCRIPTION} ${tw.workspace}`,
    };

    // Fetch remote
    let remoteTiddlers = [];
    let remoteTrashedTiddlers = [];
    if (fetchRemote && cfg.gistId) {
      let res = await fetch(tw.core.buildUrl('gists/' + cfg.gistId, 'https://api.github.com/'), {headers: authHeaders(cfg.accessToken)});
      if (!res.ok) {
        console.error('SynchData fetch', await readError(res));
        return tw.ui.notify(`Fetch remote failed '${res.status}' (see console log)`, 'E');
      }
      let gist = await res.json();
      let rebuilt = rebuildTiddlersFromGist(gist);
      remoteTiddlers = rebuilt.all;
      // We never push/pull trashed — it's local-only information.
    }
    // If cfg.gistId is empty we treat remote as empty — first push will POST a new gist.

    let log = [];
    let remote = {create: [], update: [], delete: []};
    let local = {create: [], update: [], delete: []};

    let localTiddlers = tw.tiddlers.all.filter(t => !t.isRawShadow); // Don't synch raw shadows - See BUG below

    remoteTiddlers.forEach(remoteTiddler => {
      remoteTiddler.created = new Date(remoteTiddler.created);
      remoteTiddler.updated = new Date(remoteTiddler.updated);
      let localTiddler = localTiddlers.find(t => t.title === remoteTiddler.title);
      if (isNoPush(remoteTiddler) || (localTiddler && isNoPush(localTiddler))) return log.push(`Skipping no-push tiddler [[${localTiddler?.title || remoteTiddler.title}]]`);
      if (localTiddler?.doNotSave) return log.push(`Skipping doNotSave tiddler [[${localTiddler.title}]]`);
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
      if (isNoPush(localTiddler)) return log.push(`Skipping no-push tiddler [[${localTiddler.title}]]`);
      if (localTiddler?.doNotSave) return log.push(`Skipping doNotSave tiddler [[${localTiddler.title}]]`);
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

    if (remote.create.length + remote.update.length + remote.delete.length + local.create.length + local.update.length + local.delete.length === 0) return tw.ui.notify('No changes to synch', 'S');

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
      // Build a Gist files patch: create/update → {content}, delete → null.
      const byTitle = Object.fromEntries(localTiddlers.filter(t => !isNoPush(t)).map(t => [t.title, t]));
      const files = {};
      [...remote.create, ...remote.update].forEach(title => {
        const t = byTitle[title];
        if (t) files[tiddlerFilename(title)] = {content: JSON.stringify(t, null, 2)};
      });
      remote.delete.forEach(title => {
        files[tiddlerFilename(title)] = null;
      });
      files[META_FILENAME] = {
        content: JSON.stringify(
          {
            format: FORMAT,
            visible: tw.tiddlers.visible,
          },
          null,
          2,
        ),
      };

      let res;
      if (cfg.gistId) {
        res = await fetch(tw.core.buildUrl('gists/' + cfg.gistId, 'https://api.github.com/'), {
          method: 'PATCH',
          headers: mutationHeaders(cfg.accessToken),
          body: JSON.stringify({files, description: cfg.description}),
        });
      } else {
        if (!confirm('No Gist Id found, do you want to create a new one?')) return;
        res = await fetch(tw.core.buildUrl('gists', 'https://api.github.com/'), {
          method: 'POST',
          headers: mutationHeaders(cfg.accessToken),
          body: JSON.stringify({public: false, description: cfg.description, files}),
        });
      }

      if (!res.ok) {
        logTiddler.title = 'Failed: ' + logTiddler.title;
        tw.run.previewTiddler(logTiddler);
        console.error('SynchData push', await readError(res));
        return tw.ui.notify(`Synch (push) to remote failed '${res.status}' (see console log)`, 'E');
      }
      if (!cfg.gistId) {
        let created = await res.json();
        persistGistId(created.id);
        tw.ui.notify(`New sync gist created (${created.id}) and saved to $GeneralSettings`, 'I');
      }
    }

    // Rebooting here is left up to the user
    //  we cannot know what has changed

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

  // --- Gist helpers (duplicated from $GistBackupPlugin to keep this plugin self-contained) ---

  function rebuildTiddlersFromGist(gist) {
    let all = [];
    let visible = [];
    let sawMeta = false;
    Object.entries(gist.files || {}).forEach(([name, file]) => {
      if (name === META_FILENAME) {
        try {
          let meta = JSON.parse(file.content);
          visible = Array.isArray(meta.visible) ? meta.visible : [];
          sawMeta = true;
        } catch (e) {
          console.warn('SynchData: failed to parse', META_FILENAME, e.message);
        }
        return;
      }
      if (name.startsWith('_')) return;
      if (!name.endsWith('.json')) return;
      try {
        all.push(JSON.parse(file.content));
      } catch (e) {
        console.warn(`SynchData: skipping malformed file '${name}':`, e.message);
      }
    });
    if (!sawMeta) dp(`SynchData: no ${META_FILENAME} in gist — visible will be empty`);
    return {all, visible, trashed: []};
  }

  function tiddlerFilename(title) {
    return encodeURIComponent(title) + '.json';
  }

  function authHeaders(token) {
    return {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  function mutationHeaders(token) {
    return Object.assign(authHeaders(token), {'Content-Type': 'application/json'});
  }

  async function readError(res) {
    let body = '';
    try {
      body = await res.text();
    } catch {}
    return `${res.status} ${res.statusText}${body ? ': ' + body.slice(0, 200) : ''}`;
  }

  function persistGistId(newId) {
    let tiddler = tw.run.getTiddler('$GeneralSettings');
    let parsed = {};
    try {
      parsed = JSON.parse(tiddler.text || '{}');
    } catch {}
    if (!parsed.synch) parsed.synch = {};
    if (!parsed.synch.Gist) parsed.synch.Gist = {};
    parsed.synch.Gist.gistId = newId;
    tiddler.text = JSON.stringify(parsed, null, 2);
    delete tiddler.doNotSave;
    tw.run.updateTiddlerHard('$GeneralSettings', tiddler);
    tw.events.send('save.refresh');
    tw.events.send('save.auto');
  }

  return {
    meta,
    init() {
      tw.events.override('synch.full', doFull, meta.name);
      tw.events.override('synch.push', doPush, meta.name);
      tw.events.override('synch.pull', doPull, meta.name);
      tw.events.override('synch.upload', doUpload, meta.name);

      // Command palette entries (synch.upload is intentionally omitted — it overwrites
      // the remote and is too destructive for a one-keystroke command).
      tw.extensions.registerCommand([
        {label: 'Synch: full (pull + push)', event: 'synch.full'},
        {label: 'Synch: push', event: 'synch.push'},
        {label: 'Synch: pull', event: 'synch.pull'},
      ]);

      tw.extensions.registerMacro('synch', 'full', () => tw.ui.button('{{$IconSynch}}', 'synch.full', null, 'btn-synch', 'title="Synch Data"'), {
        description: 'Button: full synch (pull + push) with the remote.',
        example: '<<synch.full>>',
      });
      tw.extensions.registerMacro('synch', 'test', () => '<button onclick="tw.macros.synch.doTest()">Synch Test</button>', {
        description: 'Button: simulate push/pull to/from remote (dry-run).',
        example: '<<synch.test>>',
      });
      tw.extensions.registerMacro('synch', 'pull', () => tw.ui.button('{{$IconPull}}', 'synch.pull', null, 'btn-synch-pull', 'title="Pull Synched Data"'), {
        description: 'Button: pull data from remote into the local workspace.',
        example: '<<synch.pull>>',
      });
      tw.extensions.registerMacro('synch', 'push', () => tw.ui.button('{{$IconPush}}', 'synch.push', null, 'btn-synch-push', 'title="Push Synched Data"'), {
        description: 'Button: push local changes to the remote.',
        example: '<<synch.push>>',
      });
      tw.extensions.registerMacro('synch', 'upload', () => tw.ui.button('{{$IconPush}}', 'synch.upload', null, 'btn-synch-upload', 'title="Upload Data"', 'purple'), {
        description: 'Button: overwrite the remote with the local workspace (destructive).',
        example: '<<synch.upload>>',
      });
    },
  };
})();
