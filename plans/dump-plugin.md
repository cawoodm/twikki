# DumpWorkspace plugin + generic platform drag/drop file handling

## Summary

One-click export of the entire workspace to a downloadable `.json` file, and drag-and-drop
restore that wipes and overwrites the workspace — built on new, generic platform-level
drag/drop infrastructure other plugins can reuse.

Two layers:

1. **Generic drop infrastructure** (`src/platform/twikki.platform.js`): a `dropHandlers` registry
   with glob-pattern matching, exposed as `tw.run.registerDropHandler(pattern, handler)`. Drag
   listeners (depth counter avoids flicker) show a full-window "drop to import" overlay during
   dragover. On drop, each file routes to the **most specific** matching handler (longer pattern
   wins, so `*.workspace.json` beats `*.json`); unmatched files get a warning notify.
2. **DumpWorkspace plugin** (`base` package): a `<<dump.dumpButton>>` macro (reusing `$IconPush`)
   snapshots **raw localStorage** — every key under `/ws/<workspace>/`, prefix-stripped for
   portability — and downloads `<workspace>.workspace.json` (format `twikki-workspace-v1`).
   A `*.workspace.json` drop handler confirms, validates the JSON **before** touching storage,
   wipes all `/ws/<ws>/*` keys, writes the dumped keys back, and fires `reboot.hard`.

Docs: new `website/Dump.tid` demo page plus a `[[Dump]]` link in `base/Backup.tid`.

### Files to be changed

| File | Change |
|---|---|
| `src/platform/twikki.platform.js` | **Modified** — drop-handler registry, `globToRegex`, `registerDropHandler` on `tw.run`, drag listeners + `handleDrop` + overlay in `wireEvents()` |
| `src/packages/base/$DumpWorkspacePlugin.js` | **New** — dump button macro, localStorage snapshot → download, `*.workspace.json` restore handler |
| `src/packages/website/Dump.tid` | **New** — demo/help page using `<<dump.dumpButton>>` |
| `src/packages/base/Backup.tid` | **Modified** — one line added linking to `[[Dump]]` |

## Context

The user wants a one-click full-workspace export/import:

- A **button/widget** that dumps the entire current workspace to a downloadable `.json` file.
- Dragging that file back into the window **deletes and completely overwrites** the workspace.
- The **drag/drop handling must be generic in the platform** so other plugins can hook in by
  filename pattern. DumpWorkspace claims `*.workspace.json`; future plugins will claim plain `*.json`
  (package import).
- **On dragover, the window must visually show that dropping will import something.**
- A demo page `website/Dump.tid` showing the widget, linked from the existing `base/Backup.tid`.

Today there is **no** drag/drop or file-import mechanism anywhere in the codebase, so the generic
drop dispatcher + visual indicator are new platform infrastructure.

### Key storage fact (drives the design)

A workspace's entire state lives in `localStorage` under the prefix `/ws/<workspace>/`. The current
workspace name is `tw.workspace`, and `tw.store.set(key,val)` writes `localStorage['/ws/'+name+key]`
(core.workspaces.js:79-88). Keys include `/ws/<ws>/tiddlers`, `/ws/<ws>/tiddlers-visible`,
`/ws/<ws>/tiddlers-trashed`, `/ws/<ws>/tiddlers-backup1`, and anything else plugins store there.

### Decisions (confirmed with user)
- **Dump source:** read raw `localStorage` — *everything* under `/ws/<tw.workspace>/*` — not the
  in-memory `tw.tiddlers`. Exact, lossless snapshot of the persisted workspace.
- **Restore:** wipe every `/ws/<current-workspace>/*` key, write the dumped keys back, reboot.
- **Plugin placement:** in the `base` package (always loaded, alongside the Backup buttons).
- **Restore guard:** a `confirm()` dialog before wiping.
- **Visual feedback:** a full-window overlay shown while a file is dragged over the window.

## Architecture

Two layers, cleanly separated:

1. **Generic drop infrastructure** — platform-level (`src/platform/twikki.platform.js`). Knows nothing
   about workspaces; matches dropped files to registered handlers by filename glob, and shows a
   generic "drop to import" overlay during drag.
2. **DumpWorkspace plugin** — `base` package. Dump button + a `*.workspace.json` drop handler. Uses the
   generic API + raw localStorage.

### 1. Generic drop infrastructure (`src/platform/twikki.platform.js`)

**Registry + registration** (near the other helpers):
```js
const dropHandlers = [];
function globToRegex(p){ return new RegExp('^' + p.replace(/[.]/g,'\\$&').replace(/\*/g,'.*') + '$', 'i'); }
function registerDropHandler(pattern, handler){ dropHandlers.push({pattern, rx: globToRegex(pattern), handler}); }
```
Expose `registerDropHandler` on the action API by adding it to the `tw.run = {...}` object
(twikki.platform.js:226-262), so `base` plugins can call `tw.run.registerDropHandler(...)`.

**Listeners in `wireEvents()`** (twikki.platform.js:1339), matching the existing `addEventListener`
style:
```js
let dragDepth = 0;                                   // counter avoids child-element flicker
document.addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; showDropOverlay(); } });
document.addEventListener('dragover',  e => { if (hasFiles(e)) e.preventDefault(); });  // enable drop
document.addEventListener('dragleave', e => { if (hasFiles(e) && --dragDepth <= 0) hideDropOverlay(); });
document.addEventListener('drop', handleDrop);
```
- `hasFiles(e)` = `Array.from(e.dataTransfer?.types||[]).includes('Files')`.
- `handleDrop(event)`: `preventDefault()`, `dragDepth = 0; hideDropOverlay()`, then for each
  `event.dataTransfer.files`: pick the **most specific** matching handler — sort `dropHandlers` by
  descending `pattern.length` so `*.workspace.json` beats `*.json` — read via
  `FileReader.readAsText`, call `handler(text, file)`. No match → `tw.ui.notify('No handler for '+file.name,'W')`.

**Visual overlay** (generic — fires for *any* dragged file; filenames aren't reliably exposed by
browsers during dragover, so the message is generic):
```js
function showDropOverlay(){ /* create #drop-overlay div once (inline styles: fixed, full-window,
  semi-transparent, centered text "⤓ Drop a file to import"), then display it */ }
function hideDropOverlay(){ /* hide #drop-overlay */ }
```
Inline styles keep this self-contained (no CSS-tiddler dependency); can be themed later.

### 2. DumpWorkspace plugin (`src/packages/base/$DumpWorkspacePlugin.js`)

Plain IIFE, header `// tags: $Plugin` (no import/export — runtime evals it). Mirrors
`$GistBackupPlugin.js` / `tw.macros.backup`.

```js
// tags: $Plugin
(function(){
  tw.macros.dump = {
    dumpButton: () => tw.ui.button('{{$IconPush}}', 'workspace.dump', null, 'dump',
                                   'title="Dump entire workspace to a file"'),
  };
  tw.events.subscribe('workspace.dump', dumpWorkspace, 'DumpWorkspace');
  tw.run.registerDropHandler('*.workspace.json', restoreWorkspace);
  ...
})();
```
(`$IconPush` already exists in the icons package — reused, no new icon.) Used in tiddlers as
`<<dump.dumpButton>>`.

**`dumpWorkspace()`** — snapshot raw localStorage for the current workspace and download it:
```js
const prefix = '/ws/' + tw.workspace + '/';
const keys = {};                                   // relative key -> raw string value
Object.keys(localStorage)
  .filter(k => k.startsWith(prefix))
  .forEach(k => keys[k.slice(prefix.length)] = localStorage.getItem(k));   // strip prefix => portable
const data = {format: 'twikki-workspace-v1', workspace: tw.workspace, keys};
// Blob([JSON.stringify(data,null,2)],{type:'application/json'}) -> object URL ->
// temporary <a download=`${tw.workspace}.workspace.json`> click -> revokeObjectURL
```
Relative (prefix-stripped) keys make the dump portable: it restores into whatever workspace is
current, regardless of the source workspace name.

**`restoreWorkspace(text, file)`** — destructive overwrite via raw localStorage, then reboot:
```js
if (!confirm(`This will DELETE and completely overwrite your entire workspace `
           + `('${tw.workspace}') with the contents of ${file.name}. Continue?`)) return;
let data; try { data = JSON.parse(text); } catch { return tw.ui.notify('Invalid JSON','E'); }
if (data.format !== 'twikki-workspace-v1' || typeof data.keys !== 'object')
  return tw.ui.notify('Not a twikki workspace file','E');
const prefix = '/ws/' + tw.workspace + '/';
Object.keys(localStorage).filter(k => k.startsWith(prefix)).forEach(k => localStorage.removeItem(k)); // wipe
Object.entries(data.keys).forEach(([rel,val]) => localStorage.setItem(prefix + rel, val));            // overwrite
tw.events.send('reboot.hard');   // window.location.reload(); on boot everything loads from new localStorage
```
No in-memory mutation needed — the hard reboot (twikki.platform.js:330,401) reloads the workspace
entirely from the restored localStorage, and core shadows regenerate from modules as usual.

### 3. Demo page (`src/packages/website/Dump.tid`)

Markdown matching the website style (cf. `Features.tid`, `Backup.tid`), tag `Help`:
```
tags: Help

Dump your **entire** current workspace (everything under `/ws/<workspace>/` in local storage) to a
single file.
* <<dump.dumpButton>>: Download `<workspace>.workspace.json`

To restore, **drag a `*.workspace.json` file onto the window** (you'll see a drop overlay). This
will *delete and completely overwrite* your current workspace — you'll be asked to confirm first.

See also [[Backup]], [[Help]], [[Features]].
```

### 4. Link from Backup (`src/packages/base/Backup.tid`)

Append one line to the existing file:
```
* See [[Dump]] to export/import your whole workspace as a file
```

## Files

| File | Change |
|---|---|
| `src/platform/twikki.platform.js` | Add `dropHandlers` registry + `globToRegex` + `registerDropHandler`; add `registerDropHandler` to `tw.run` (line 226); add drag listeners, `handleDrop`, and `showDropOverlay`/`hideDropOverlay` in `wireEvents()` (line 1339). |
| `src/packages/base/$DumpWorkspacePlugin.js` | **New.** Dump button macro, `workspace.dump` handler (localStorage snapshot → download), `*.workspace.json` drop handler (confirm → wipe → overwrite → `reboot.hard`). |
| `src/packages/website/Dump.tid` | **New.** Demo page using `<<dump.dumpButton>>`. |
| `src/packages/base/Backup.tid` | Add a `[[Dump]]` link. |

`base`/`website` recompile via the Vite plugin on save (browser auto-reloads). `twikki.platform.js` is
served as-is and reloads on browser refresh.

## Reuse (don't reinvent)
- `tw.workspace` + the `/ws/<workspace>/` localStorage prefix (core.workspaces.js:79-91).
- `rebootHard()` via `tw.events.send('reboot.hard')` (twikki.platform.js:330,401).
- `tw.ui.button(text, message, payload, id, attr)` (core.ui.js) — same shape as `tw.macros.backup.*`.
- Existing `$IconPush` icon; `tw.ui.notify(msg, level)` for feedback.

## Verification (end-to-end)

1. `npm run dev`; open the app. Open the **Dump** page (linked from Backup); confirm
   `<<dump.dumpButton>>` renders a button.
2. Click it → `<workspace>.workspace.json` downloads. Open it: confirm `format`, `workspace`, and a
   `keys` map whose entries are the `/ws/<ws>/...` localStorage values with the prefix stripped
   (`tiddlers`, `tiddlers-visible`, `tiddlers-trashed`, etc.). Cross-check against DevTools →
   Application → Local Storage.
3. Drag *any* file over the window → the **drop overlay** appears ("Drop a file to import") and
   disappears on dragleave/drop without flicker.
4. Create a throwaway tiddler, then **drag the downloaded file onto the window** → `confirm()`
   dialog appears; accept → page reboots, throwaway tiddler is gone, workspace matches the dump.
   Verify in DevTools that no stale `/ws/<ws>/*` keys remain beyond those in the file.
5. Negative: drop a `*.txt` → "No handler" notify; drop a malformed `*.workspace.json` → error
   notify and **localStorage untouched** (validation happens before the wipe).
6. Generic-hook check: in console run
   `tw.run.registerDropHandler('*.json', (t,f)=>tw.ui.notify('json: '+f.name))`, then drop a plain
   `.json` → that handler fires, while `*.workspace.json` still routes to DumpWorkspace (specificity).
7. `npm test` still passes (compile-plugin tests).
