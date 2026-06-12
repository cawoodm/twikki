tags: $Plugin

# Description

Renders an editable FORM in place of the raw JSON whenever the
`$GeneralSettings` tiddler is displayed. The object maps to the UI:
  - each top-level key whose value is an object  → a TAB
  - each child object inside a tab               → a SECTION
  - each leaf value                              → a FORM FIELD
Top-level scalar values (and a tab's own scalar children) are gathered into
an implicit "General" tab/section. The normal raw-JSON editor (the title-bar
Edit button) is untouched — saving from it re-renders the form.

Field controls and help text are driven by an OPTIONAL descriptor stored in a
companion key suffixed with `~`. e.g. alongside `"accessToken": "..."` add
  "accessToken~": "GitHub PAT (secret, max:100)"
Grammar:  Human description (type, max:N, options:A|B|C)
  type ∈ string | text | number | boolean | date | secret | option | selection
  max     → maxlength (string/text/secret) or max attribute (number)
  options → choices for `option` (radios, single value) / `selection`
            (checkboxes, array value)
With no descriptor the control is inferred from the value type; objects/arrays
fall back to a JSON textarea. `~` keys are hidden from the form and preserved
on save, so existing readers (GistBackup, Synch, …) keep reading raw scalars.

Interception is via `tiddler.element.created` (fires for show / re-render /
preview, BEFORE DOM insertion → no flash of raw JSON). The handler is a named
function so re-evaluating this code tiddler does not register duplicates.

# Meta

- version: 1.0.0

# Code

[include](./SettingsDialog.js)

# StyleSheet

[include](./SettingsDialog.css)
