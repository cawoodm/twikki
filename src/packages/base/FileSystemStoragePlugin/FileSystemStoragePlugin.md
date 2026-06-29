tags: $Plugin

# Description

Stores your wiki as **real files in a folder on your disk** using the
[File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API).
Each tiddler becomes its own file in its **native format** (`.tid`/`.md`/`.js`/`.css`/…), grouped
into a **folder per package** — so you can open, edit, `git`-track and sync your notes with ordinary
tools.

**Note:** file system is slower than both localStorage and the indexedDB stores.

**Scope:** the boot script is global per origin — connecting reroutes ALL workspaces on this device.
`/twikki.boot.js` and the module cache (`/modules/*`) stay in `localStorage` on purpose.

# Connect

Pick a folder to store your wiki in. Your current data is copied into it on the next reload.

<<button "Connect folder" fsstorage.connect>>

If a tab asks you to grant access again:

<<button "Reconnect" fsstorage.reconnect>>

After editing files in an external editor, reload them:

<<button "Reload from folder" fsstorage.reload>>

Stop using file storage (your folder files are kept on disk):

<<button "Disconnect" fsstorage.disconnect>>

# Meta

<<pluginMeta FileSystemStorage>>

# BootScript

[include](./BootScript.js)

# Code

[include](./FileSystemStorageCode.js)

# StyleSheet

[include](./FileSystemStorage.css)
