Twikki automatically saves everything you do to the browser (localStorage).

# Cloud Saves

In order to secure your data or share it between devices you can push/pull or synch your data to the cloud:

- Synch: The [[$SynchDataPlugin]] saves all your data to a [GitHub Gist](https://gist.github.com/) which is free storage up to 100MB.
  - With a synch across multiple devices, the last update wins.
  - For more info see [[Synchronization]].
- Backup: The [[$GistBackupPlugin]] works in a similar fashion but it has no synch: you backup and restore everything regardless of what was changed when.
  - For more info see [[Backup]]

To get started, create a [Personal Access Token](https://github.com/settings/tokens) and copy it into your Settings -> Backup/Synch -> Gist. It is fine to use the same PAT for both but you should use a different gistId for safety.

# Full Dump

You can also [[Dump]] your data to a local '.workspace.json' file as a backup or share it with others.

This does not respect any of the backup/synch rules (i.e. not synching certain notes) - it is a mirror of your workspace's local storage.
