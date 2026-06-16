// tags: $Plugin
/**
 * Backup your data to a private GitHub Gist (https://gist.github.com).
 * Each tiddler is stored as a separate file so changes appear as diffs in
 * the gist's history. A sidecar `_twikki.meta.json` holds the visible/trashed
 * lists. On first save (when no gistId is configured) a new private gist is
 * created and its id is written back to [[$GeneralSettings]].
 *
 * Loading this plugin overrides any previously installed backup provider.
 *
 * The PAT must have the `gist` scope. GitHub enforces a 10 MB per-file limit;
 * oversized tiddlers will be rejected by the API.
 */
(function () {
  const META_FILENAME = '_twikki.meta.json';
  const FORMAT = 'twikki-gist-v1';
  const DEFAULT_DESCRIPTION = 'TWikki backup';

  // Tiddlers tagged $NoBackup are never pushed and are preserved across restore.
  const isNoBackup = t => t.tags?.includes('$NoBackup');

  const backup = {
    restoreButton() {
      return tw.ui.button('{{$IconRestore}}', 'backup.restore', null, 'restore', 'title="Restore Backup Data"');
    },
    backupButton() {
      return tw.ui.button('{{$IconBackup}}', 'backup.save', null, 'backup', 'title="Backup Data"');
    },
    async restore() {
      let cfg = readConfig();
      if (!cfg) return;
      if (!cfg.gistId) return tw.ui.notify('No Gist gistId found in $GeneralSettings.backup.Gist!', 'W');
      let res = await fetch(tw.core.buildUrl('gists/' + cfg.gistId, 'https://api.github.com/'), {headers: authHeaders(cfg.accessToken)});
      if (!res.ok) {
        console.error('GistBackup restore', await readError(res));
        return tw.ui.notify(`Restore failed '${res.status}' (see console log)`, 'E');
      }
      let gist = await res.json();
      let rebuilt = rebuildTiddlersFromGist(gist);

      // Preserve local $NoBackup tiddlers across restore — they were never pushed,
      // so the gist has no authoritative copy. Local wins on title collision.
      const localKeep = tw.tiddlers.all.filter(isNoBackup);
      const localKeepTrashed = tw.tiddlers.trashed.filter(isNoBackup);
      const rebuiltTitles = new Set(rebuilt.all.map(t => t.title));
      const rebuiltTrashedTitles = new Set(rebuilt.trashed.map(t => t.title));
      rebuilt.all.push(...localKeep.filter(t => !rebuiltTitles.has(t.title)));
      rebuilt.trashed.push(...localKeepTrashed.filter(t => !rebuiltTrashedTitles.has(t.title)));

      Object.assign(tw.tiddlers, rebuilt);
      tw.run.save();
      if (confirm('Restore complete. Would you like to reload?')) tw.events.send('reboot.hard');
      tw.ui.notify(`Restore complete! (${rebuilt.all.length} tiddlers, ${localKeep.length} kept local)`, 'S');
    },
    async save() {
      let cfg = readConfig();
      if (!cfg) return;
      let files = {};
      tw.tiddlers.all
        .filter(t => !isNoBackup(t))
        .forEach(t => {
          files[tiddlerFilename(t.title)] = {content: JSON.stringify(t, null, 2)};
        });
      files[META_FILENAME] = {
        content: JSON.stringify(
          {
            format: FORMAT,
            visible: tw.tiddlers.visible,
            trashed: tw.tiddlers.trashed.filter(t => !isNoBackup(t)),
          },
          null,
          2,
        ),
      };
      let body, res;
      if (cfg.gistId) {
        let remote = await fetchRemoteFiles(cfg);
        if (!remote) return;
        Object.keys(remote).forEach(name => {
          if (!files[name]) files[name] = null; // Delete files no longer present locally
        });
        body = JSON.stringify({files, description: cfg.description});
        res = await fetch(tw.core.buildUrl('gists/' + cfg.gistId, 'https://api.github.com/'), {
          method: 'PATCH',
          headers: mutationHeaders(cfg.accessToken),
          body,
        });
      } else {
        if (!confirm('No Gist Id found, do you want to create a new one?')) return;
        body = JSON.stringify({public: false, description: cfg.description, files});
        res = await fetch(tw.core.buildUrl('gists', 'https://api.github.com/'), {
          method: 'POST',
          headers: mutationHeaders(cfg.accessToken),
          body,
        });
      }
      if (!res.ok) {
        console.error('GistBackup save', await readError(res));
        return tw.ui.notify(`Backup failed '${res.status}' (see console log)`, 'E');
      }
      if (!cfg.gistId) {
        let created = await res.json();
        persistGistId(created.id);
        tw.ui.notify(`New gist created (${created.id}) and saved to $GeneralSettings`, 'I');
      }
      let fileCount = Object.values(files).filter(f => f !== null).length;
      tw.ui.notify(`Backup complete! (${fileCount} files, ${(body.length / 1000).toFixed(1)} KB)`, 'S');
    },
  };

  function readConfig() {
    let settings = tw.call('getJSONObject', '$GeneralSettings');
    if (!settings || !settings.backup?.Gist?.accessToken) {
      tw.ui.notify('No Gist accessToken found in $GeneralSettings.backup.Gist!', 'W');
      return null;
    }
    return {
      accessToken: settings.backup.Gist.accessToken,
      gistId: settings.backup.Gist.gistId || '',
      description: settings.backup.Gist.description || DEFAULT_DESCRIPTION,
    };
  }

  async function fetchRemoteFiles(cfg) {
    let res = await fetch(tw.core.buildUrl('gists/' + cfg.gistId, 'https://api.github.com/'), {headers: authHeaders(cfg.accessToken)});
    if (!res.ok) {
      console.error('GistBackup fetch-before-patch', await readError(res));
      tw.ui.notify(`Backup failed '${res.status}' (see console log)`, 'E');
      return null;
    }
    let gist = await res.json();
    return gist.files || {};
  }

  function persistGistId(newId) {
    let tiddler = tw.run.getTiddler('$GeneralSettings');
    let parsed = {};
    try {
      parsed = JSON.parse(tiddler.text || '{}');
    } catch {}
    if (!parsed.backup) parsed.backup = {};
    if (!parsed.backup.Gist) parsed.backup.Gist = {};
    parsed.backup.Gist.gistId = newId;
    tiddler.text = JSON.stringify(parsed, null, 2);
    delete tiddler.doNotSave;
    tw.run.updateTiddlerHard('$GeneralSettings', tiddler);
    tw.events.send('save.silent');
  }

  function rebuildTiddlersFromGist(gist) {
    let all = [];
    let visible = [];
    let trashed = [];
    let sawMeta = false;
    Object.entries(gist.files || {}).forEach(([name, file]) => {
      if (name === META_FILENAME) {
        try {
          let meta = JSON.parse(file.content);
          visible = Array.isArray(meta.visible) ? meta.visible : [];
          trashed = Array.isArray(meta.trashed) ? meta.trashed : [];
          sawMeta = true;
        } catch (e) {
          console.warn('GistBackup: failed to parse', META_FILENAME, e.message);
        }
        return;
      }
      if (name.startsWith('_')) return;
      if (!name.endsWith('.json')) return;
      try {
        all.push(JSON.parse(file.content));
      } catch (e) {
        console.warn(`GistBackup: skipping malformed file '${name}':`, e.message);
      }
    });
    if (!sawMeta) console.warn(`GistBackup: no ${META_FILENAME} in gist — visible/trashed will be empty`);
    return {all, visible, trashed};
  }

  function tiddlerFilename(title) {
    // encodeURIComponent gives a stable, reversible mapping that is safe as a
    // Gist filename (no '/', no empty result for non-empty input).
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

  return {
    meta: {
      name: 'GistBackup',
      version: '1.0.0',
      platform: '0.26.0',
      description: 'Back up tiddlers to a private GitHub Gist.',
    },
    init() {
      // Expose the two button macros. `backup.save` / `backup.restore` are not
      // macros (they return promises, not HTML) — they are wired via
      // tw.events.override below.
      tw.extensions.registerMacro('backup', 'restoreButton', backup.restoreButton, {
        description: 'Button: restore the workspace from the configured GitHub Gist.',
        example: '<<backup.restoreButton>>',
      });
      tw.extensions.registerMacro('backup', 'backupButton', backup.backupButton, {
        description: 'Button: back up the workspace to the configured GitHub Gist.',
        example: '<<backup.backupButton>>',
      });
    },
    start() {
      // Override any previously installed backup provider — this plugin wins.
      tw.events.override('backup.save', backup.save);
      tw.events.override('backup.restore', backup.restore);
    },
  };
})();
