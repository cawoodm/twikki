tags: $Plugin

Backup your data to a private GitHub Gist (https://gist.github.com).
Each tiddler is stored as a separate file so changes appear as diffs in
the gist's history. A sidecar `_twikki.meta.json` holds the visible/trashed
lists. On first save (when no gistId is configured) a new private gist is
created and its id is written back to [[$Settings]].

Loading this plugin overrides any previously installed backup provider.

The PAT must have the `gist` scope. GitHub enforces a 10 MB per-file limit;
oversized tiddlers will be rejected by the API.

- Backup to Gist: <<backup.backupButton>>
- Restore from Gist: <<backup.restoreButton>>

# Code

[include](./$GistBackupPlugin.js)
