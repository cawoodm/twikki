tags: $Plugin

# Description

Turns the **$Secrets** shadow tiddler into an editable box for your device-local
secrets — the same store the Settings layer reads via `${secret:KEY}`.

Like the Settings dialog swaps the `$Settings` body for a form, this swaps the
`$Secrets` body (intercepting `tiddler.element.created`) for a textarea of the raw
secrets — one `KEY: value` per line. **Saving writes to the global store, never the
per-workspace tiddler store**, so secrets stay on this device and are never synced or
backed up. Open it from the command palette ("Open secrets editor") or any `[[$Secrets]]`
link.

# Meta

<<pluginMeta SecretsEditor>>

# Code

[include](./SecretsEditor.js)

# StyleSheet

[include](./SecretsEditor.css)
