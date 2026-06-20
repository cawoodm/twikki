tags: $Plugin

# Description

Adds a dialog to the package import flow. Clicking an import button (the
`<<packages.import>>` macro) or running the **Import package from URL…** command
fetches the package and opens a dialog listing every tiddler with a checkbox
(all checked by default, plus a select-all toggle). Each row shows whether the
tiddler is **new** or **overwrites** an existing one; protected (`$NoImport`)
tiddlers are locked. Two options control the outcome: **Save** (checked — persists
the import) and **Reload** (unchecked — re-runs plugins/scripts so imported
themes and plugins take effect). **Import** brings in only the checked tiddlers;
**Cancel** does nothing.

The plugin overrides the `package.reload.url` event. Without it (e.g. `?safemode`)
the core fallback still imports, saves and notifies — just without the picker.

# Meta

<<pluginMeta PackageImport>>

# Code

[include](./PackageImporter.js)

# StyleSheet

[include](./PackageImporter.css)
