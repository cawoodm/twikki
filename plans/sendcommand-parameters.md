# Merge `param`/`params` into a single `params` in sendCommand

## Context

`sendCommand(cmd, param, params, currentTiddlerTitle)` ([src/platform/twikki.platform.js:1329](../../../projects/Marc/twikki/src/platform/twikki.platform.js)) carries two confusingly-named payload parameters with different semantics:

- **`param`** (2nd arg, from `data-param`): raw-string passthrough — decode `---enc:`, substitute `$currentTiddler`, pass as-is. Exists so tiddler titles with spaces survive (search results, tabs, trash list, templates).
- **`params`** (3rd arg, from `data-params`): parsed — decode → substitute → `{{{js}}}` eval → JSON.parse (`[`/`{`) → `parseParams()` space-split fallback.

Goal (user-confirmed design): one parameter `params`, one attribute `data-params`, with a single decode/deserialize chain where **bare strings stay raw strings** and structured payloads are explicit JSON (or `{{{js}}}`). Legacy `data-param` attributes are no longer read; a `console.warn` flags stale content.

## New semantics (single chain)

```
data-params="My Note"                → handler('My Note')               (raw string, spaces safe)
data-params='["a", "b"]'             → handler('a', 'b')                (JSON array → spread)
data-params='{"tag":"x"}'            → handler({tag:'x'})               (JSON object)
data-params='"quoted"'               → handler('quoted')                (JSON string — `"` added to detect regex)
data-params="pck:icons title:add"    → handler({pck:'icons', title:'add'})  (named params → object)
data-params="$currentTiddler"        → handler('<current title>')
data-params="---enc:BASE64"          → decoded first, then same rules
data-params="{{{js expr}}}"          → eval (unchanged)
programmatic non-string value        → passed through untouched
no payload                           → inline `cmd:params` part used if present, else undefined
```

The same chain applies to inline commands (`#msg:cmd:params` hash links and `data-msg="cmd:---enc:…"` from `expose()`), so the documented examples keep working:

| Example (found in code/docs) | Result | Same as today? |
|---|---|---|
| `#msg:search:welcome` (Help.tid:26, Features.tid:13) | `searchQuery('welcome')` | yes |
| `#msg:search:$pck:website` (Welcome.tid:24) — leading `$` doesn't match named pattern | `searchQuery('$pck:website')` | yes |
| `#msg:search:$tag:$Theme` (Themes.tid, FAQ.tid, TestLinks.tid:10) | raw query string | yes |
| `#msg:search:"tag:$Theme"` (Help.tid:26, Features.tid:14) | JSON-string → `searchQuery('tag:$Theme')` | yes (was paramsToArray-unquoted) |
| `#msg:search.advanced:pck:icons title:add` (core.search.js:32) | `searchQueryAdvanced({pck:'icons', title:'add'})` | **yes — named branch kept** |
| `#msg:ui.open.all:title:^A`, `#msg:ui.open.all:tag:Favorite` (Features.tid:19–20, TestLinks.tid:12) | `{title:'^A'}` / `{tag:'Favorite'}` | yes |
| `#msg:tiddlers.show:type:…` ($GeneralWidgets.js:24) | `{type:…}` | yes |
| `#msg:ui.open.all:{"tag":"x","title":"*"}` ($ListTiddlersWidgets.js:54) | JSON object | yes |

Named-param detection (`/^[a-z0-9_]+:/i`) can never collide with a raw tiddler title because **`:` is not a valid title character** (see comment at twikki.platform.js:12–15 and ContentSections.tid:54) — so search results, tabs, trash links, and `$currentTiddler` template buttons are safe with bare titles.

`parseParams()` ([src/modules/core.params.js](../../../projects/Marc/twikki/src/modules/core.params.js)) is still called by sendCommand, but **only when the named-param pattern matches** (the `strToObject` route). It remains fully in use by the macro/inclusion machinery (twikki.platform.js:667, 698, 1132), which is untouched.

Accepted behavior changes (no in-repo usages rely on these):
- Inline positional syntax `#msg:cmd:a b` now delivers one string `'a b'` instead of `['a','b']`; positional lists must be JSON arrays.
- Bare `'true'`/`'1'` are no longer type-coerced — use JSON for typed values. (Values *inside* named params, e.g. `foo:1 bar:true`, are still coerced by `parseParams`.)

## Changes

### 1. `src/platform/twikki.platform.js`

**`sendCommand` (lines 1329–1350)** — new signature `sendCommand(cmd, params, currentTiddlerTitle)`:

```js
function sendCommand(cmd, params, currentTiddlerTitle) {
  // "foo.bar:{json}"            => events.send('foo.bar', {…})
  // "foo.bar:pck:icons title:x" => events.send('foo.bar', {pck:'icons', title:'x'})
  // "foo.bar:My Note"           => events.send('foo.bar', 'My Note')   (bare strings stay raw)
  let cmds = cmd.match(reCommand);
  if (!cmds) throw new Error(`Invalid command '${cmd}' does not match ${reCommand}/!`);
  let msg = cmds[1];
  if (!params) params = cmds.length > 2 ? cmds[2] : null;
  tw.logging.break('command');
  if (typeof params === 'string') {
    params = tw.events.decode(params);
    params = params.replaceAll('$currentTiddler', currentTiddlerTitle);
    if (params.match(/^\{\{\{/)) try {params = eval(params);} catch {dp('events.send received invalid JS payload: ' + params);}
    else if (params.match(/^[\[\{"]/)) try {params = JSON.parse(params);} catch {dp('events.send received invalid JSON payload: ' + params);}
    else if (params.match(/^[a-z0-9_]+:/i)) params = tw.core.params.parseParams(params); // named params → object
    // else: bare string stays a raw string (':' is not a valid title char, so titles never hit the named branch)
  }
  dp('sendCommand', msg, 'params=', params);
  let result = tw.events.send(msg, params);
  location.hash = '';
  return result;
}
```

Note `"` added to the JSON-detect regex so JSON-stringified strings deserialize. JSON.parse failure keeps the raw string (current behavior, e.g. a title like `[Draft] Note` degrades gracefully). Update the stale comment above the function — the old `"foo.bar:etc etc" => ['etc', 'etc']` example no longer holds.

**Click handler (lines 1398–1405)** — read only `data-params`, warn on stale `data-param`:

```js
if (src.hasAttribute('data-param')) console.warn('data-param is no longer supported, use data-params', src);
let params = src.getAttribute('data-params');
...
let result = sendCommand(msg, params, currentTiddlerTitle);
```

`handleHashLink` call site (line 1361, `sendCommand(msg)`) needs no change. `tw.run.sendCommand` export (line 262) unchanged; no other in-repo callers exist.

### 2. `src/modules/core.ui.js` — `button()` (lines 79–84)

Always emit `data-params`; objects as JSON, strings raw (mirrors `encodeMessage`):

```js
if (payload) {
  if (typeof payload === 'object') payload = JSON.stringify(payload);
  else if (typeof payload !== 'string') payload = String(payload);
  paramAttribute = ` data-params="---enc:${tw.core.common.encoder(payload)}"`;
}
```

(The `String(payload)` branch also fixes the currently-broken `tw.ui.button('Click Me!', 'welcome.step2', 1)` in `$OnboardingMacros.js:18`, which today renders an ERROR span; the handler now receives `'1'` as a string.)

`expose()`/`encodeMessage()` (lines 146–155) stay as-is — they transport via the inline `msg:---enc:…` form which flows through the same new chain.

### 3. Producers: rename `data-param` → `data-params` (value unchanged)

- `src/modules/core.search.js:84, 95` — `setAttribute('data-params', title)`
- `src/packages/base/$TabsPlugin.js:189` — `data-params="${attr(title)}"`
- `src/packages/base/$TrashedTiddlersFunctions.js:22–23` (2 attributes)
- `src/packages/base/$UnsavedChangesPlugin.js:141` — `data-params="---enc:…"`
- Templates (`data-param="$currentTiddler"` → `data-params="$currentTiddler"`):
  - `src/modules/core.defaults/$TiddlerDisplay.html` (lines 9, 12, 13, 16)
  - `src/modules/core.defaults/$TiddlerTrashed.html` (lines 9, 10, 11)
  - `src/modules/core.defaults/$TiddlerPreview.html` (line 9)
  - `src/packages/demo/$TiddlerDisplay.html` (lines 9, 12, 13, 16)
- Test selector: `src/packages/tests/TestSearch.tid:3` — `[data-param=Welcome]` → `[data-params=Welcome]`

Do **not** touch `.claude/worktrees/theme-layering/` (separate worktree).

### 4. Content/doc fixes (drive-by, found during analysis)

- `src/packages/tests/TestLinks.tid:11` — `#msg:ui.open.all:{tag:'Favorite'}` is **already broken today** (single quotes → JSON.parse fails → handler gets a raw string). Fix to valid JSON: `#msg:ui.open.all:{"tag":"Favorite"}` (Features.tid:14 shows double quotes in hash links render fine).
- Sweep comments/docs for `data-param` / parsing examples: sendCommand's header comment (see §1), `core.search.js:31–32` comments (already accurate, keep), website docs (`Help.tid`, `Features.tid`, `ContentSections.tid`) describe the inline syntax and remain accurate under the new chain.

### 5. `CHANGELOG.md`

Add an entry (file already has uncommitted edits — append, don't overwrite) noting the merged parameter, the removal of `data-param`, and the bare-string-stays-raw semantics.

## Verification

1. `npm run dev` (port 3002, regenerates package JSON; use `?reload&trace` to bypass cache and surface real errors).
2. Via browser (chrome-devtools MCP available):
   - Search for a multi-word tiddler (e.g. "Welcome to TWikki" if present) and click the result → opens correct tiddler (raw-string path, `core.search.js`).
   - Tiddler toolbar close/edit/delete buttons → `$currentTiddler` substitution path (`$TiddlerDisplay.html`).
   - Tab close button (`$TabsPlugin`), trash restore links (`$TrashManager`), unsaved-changes dialog link.
   - A `tw.ui.button` with object payload (e.g. Import button from `$PackageWidgets`) → JSON path.
   - An `AllTagsLinked` tag link → inline `#msg:cmd:{json}` path.
   - Named-param inline commands: the Features.tid links `#msg:ui.open.all:title:^A` and `#msg:ui.open.all:tag:Favorite` open the right tiddler sets, and `tw.run.sendCommand('search.advanced:pck:icons title:add')` (or the equivalent hash) returns results filtered by package+title → object `{pck, title}` reaches `searchQueryAdvanced`.
   - Settings gear button (string payload `$GeneralSettings` via `---enc:`).
   - Console shows no errors; manually add a `data-param` attribute in devtools and click → warning logged, no payload.
3. `node --test ./tests/unit/*.test.js` (compile-plugin tests; non-watch one-shot) — unaffected, should still pass.
4. Run the in-app test suite if practical (`tests` package, `TestSearch.tid` selector now `[data-params=Welcome]`).

## Weaknesses of the parameters concept & suggested improvements (analysis deliverable)

1. **Prefix-sniffing is heuristic.** Payload type is inferred from the first characters (`{{{`, `[`, `{`, `"`, `word:`). A literal title starting with `{` is mis-detected (mitigated by JSON.parse falling back to the raw string, but eval of `{{{` has no such safety), and a non-title string payload like `note:hello` gets objectified by the named-param branch (titles are safe only because `:` is banned in them — that ban is documented in a comment, not enforced anywhere). *Improvement:* an explicit discriminator, e.g. `data-params-type="json|raw|js"`, or always-JSON transport; enforce the no-`:`-in-titles rule at save time.
2. **`eval` of click payloads is XSS-by-design.** Any tiddler content can embed `data-params="{{{…}}}"` and execute arbitrary JS on click — broader than the deliberate module-eval. *Improvement:* drop the `{{{` branch from the click path or gate it behind `$NoEdit`/shadow tiddlers.
3. **`$currentTiddler` substitution is textual `replaceAll`.** Titles containing `"` corrupt embedded JSON (`{"title":"$currentTiddler"}`); a `null` current title becomes the string `'null'`; a title literally containing `$currentTiddler` recurses oddly. *Improvement:* substitute only on exact match, or JSON-encode the title when substituting inside JSON payloads.
4. **No type fidelity for scalars.** Bare `1`/`true` payloads arrive as strings; only JSON preserves types (and `button()` silently stringifies non-object payloads). *Improvement:* document "use JSON for anything but plain strings" as the contract — this refactor makes that the rule.
5. **Array payloads can't be a single argument.** `events.send` spreads arrays (`handler(...params)`), so a handler wanting an actual array must receive `[[…]]`. Implicit and surprising. *Improvement:* always pass one payload object and let handlers destructure.
6. **Two transports for the same thing.** `expose()` packs the payload into `data-msg="msg:---enc:…"` while everything else uses `data-params`. *Improvement:* make `expose()` emit `data-msg` + `data-params` like `button()`.
7. **`---enc:` base64 is obfuscation, not safety.** It bloats the DOM and hides payloads from devtools inspection; it exists only to dodge HTML-attribute escaping. *Improvement:* proper attribute escaping (the `attr()` helper in `$TabsPlugin` already exists — promote it to `tw.core.common`) and reserve encoding for genuinely binary/awkward payloads.
8. **Errors are swallowed.** Invalid JSON/JS payloads only `dp()`-log (invisible without `?debug`), and the handler then receives the wrong shape silently. *Improvement:* `console.warn` for malformed payloads regardless of debug mode.
9. **Long-term:** the TODO at `core.ui.js:72` points the right way — bind real event listeners with closure-held JS payloads (as `dialog()` buttons already do with `onClick`), eliminating string round-trips entirely for programmatic UI.
