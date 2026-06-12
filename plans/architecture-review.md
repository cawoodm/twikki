# TWikki Architecture Review

Analysis of the codebase against the goal: clean layering (platform, core, base, extensions), an understandable API, and full extensibility via event hooks. Two major and five minor changes proposed.

## Current layer picture

| Layer | Location | Loaded by |
|---|---|---|
| **Platform** | `src/platform/twikki.platform.js` (1626 lines) | `index.html` script tag |
| **Core modules** | `src/modules/core.*.js` | Hardcoded list in platform, eval'd, attach `tw.core.*` / `tw.events` |
| **Base package** | `src/packages/base/` | `$CorePackages` tiddler |
| **Extensions** | `src/packages/*` (demo, themes, icons, …) | `$ExtensionPackages` tiddler |

The layering *intent* is sound. The problem: boundaries aren't enforced anywhere, so in practice it's one namespace with politeness conventions.

---

## Major change 1: Make the API boundary real — eliminate eval as an access path

The sanctioned API (`tw.run`, `tw.events`, `tw.core.*`) coexists with a backdoor that makes it meaningless:

```js
function call(functionName, ...args) {
  return eval(functionName)(...args);   // twikki.platform.js:1556
}
```

`tw.call('anything', …)` reaches **any** closure-scoped platform function by string name. Plugins use it inconsistently with the front door:

- `$CoreThemeManager` calls `tw.call('tiddlerExists', theme)` — a function not exported anywhere
- Three plugins call `tw.call('getJSONObject', …)` even though `getJSONObject` **is** in `tw.run`
- `events.subscribe` accepts a string handler and `eval`s it — same pattern

**Consequences:**

- The platform can never be refactored safely; any internal rename is a potential plugin break, undetectable by grepping the API surface
- The documented surface can't be trusted (`docs/API.md` is honest about this — it's a 7-line TODO)
- Every eval is a CSP/security liability in an app whose model is "run code from fetched packages"

**The change:**

1. `tw.call` becomes a lookup into an explicit action registry — essentially `tw.run` plus whatever genuinely needs exposing (`tiddlerExists` evidently does)
2. Migrate the ~6 `tw.call` sites and the string-handler path in `subscribe`
3. `eval` remains in exactly one place: the module/plugin loader, where it's the point
4. Write `API.md` for real: `tw.run` = action surface, `tw.events` = hook surface, `tw.core.*` = subsystem surface. Anything not on those three is private and may change.

This is the single change that makes "developers should understand the API" achievable — today the true API is "every function name in a 1626-line closure."

---

## Major change 2: Event bus v2 — ownership, lifecycle, and a published vocabulary

The bus is the architectural centerpiece (it's how all four layers talk), but it's the weakest component. Concrete problems in `core.js`:

### The dedup logic is broken in both directions

Handlers are stored as `{event, handler}` — the `handlerName` parameter is **never stored**. The duplicate check compares the stored function's `.name` against the incoming `handlerName`:

```js
if (handlers.find(h => h.event === event && h.handler.name === handlerName))
```

- `$ExplorerPlugin` subscribes `render` with handlerName `'ExplorerPlugin'` → check compares `'render' === 'ExplorerPlugin'` → never true → **soft reloads re-subscribe and handlers accumulate**. After N reloads, every `tiddler.updated` triggers N renders.
- The false-positive direction also exists: two plugins subscribing functions that share a name (`init`, `render`) with no explicit handlerName → second one silently dropped.

Plugin comments show the authors believe the dedup works; it works only in the no-explicit-name case. (Static read — verify at runtime with `tw.events.handlers().length` across two soft reloads.)

### Other bus problems

- **No unsubscribe** — which is *why* four plugins plus the platform each carry a copy-pasted `wireUp()`
- **`override()` leaks** — deletes `h.event` but leaves dead entries in the array forever
- **Ad hoc return semantics** — `send` returns an array of all handler returns; `markdown.render` takes `results[0]` and console-warns if there's more than one, encoding "this is really a request, not a broadcast" as a log message
- **No event catalog** — ~36 distinct events sent in JS plus ~30 more triggered only via DOM `data-msg` attributes, invisible to anyone grepping `events.send`. Two lifecycle events (`tiddler.modified`, `tiddler.removed`) fire with zero in-tree subscribers — fine as extension points, but undocumented ones.

### The redesign

- Store `{event, handler, owner}`; key identity on `event + owner + handler.name`. Fixes both dedup bugs.
- `subscribe` returns an unsubscribe function; add `tw.events.clearOwner(owner)` so soft reload wipes a plugin's handlers before re-eval — kills both the accumulation problem and the need for per-plugin `wireUp`
- Split semantics: `send` (broadcast, no meaningful return) vs `request` (exactly one handler, returns its value — `markdown.render`, future renderers). The warning becomes a contract.
- Document the naming grammar already half-present: imperative = command (`tiddler.show`, `theme.switch`), past tense = notification (`tiddler.rendered`, `story.changed`). Today they're mixed with no signal of which you may fire vs only listen to.
- Publish the catalog (see minor 5 — generate it, don't hand-write it)

This is the change that delivers "developers interact with all aspects via event hooks."

---

## Minor changes

### 1. Delete the dead code

- `src/platform/twikki.latest.js` — 1334 lines, zero references since the rename to `twikki.platform.js`
- `src/modules/core.markdown.js` — superseded by `$BaseMarkdownPlugin`, no longer in the platform's module list
- `src/packages/old/`

Dead near-duplicates of the platform are actively dangerous — they're the file someone greps into and edits.

### 2. Patch the bus bugs now, ahead of the redesign

The override leak and the dedup-field mismatch are each one-line fixes (`splice` instead of `delete h.event`; store and compare `handlerName`). The accumulating-handlers behaviour on soft reload is live today; don't wait for v2.

### 3. Decouple local dev from production package URLs

`$CorePackages.tid` and `$ExtensionPackages.tid` point at `https://cawoodm.github.io/twikki/packages/*.json` — with `force` — so a local checkout fetches its **own base package from the published site**. Local edits to base plugins can be silently overwritten by prod copies. Make the URLs relative (`/packages/base.json`) or origin-derived, with the absolute form only in the published default workspace.

### 4. One `wireUp`, owned by the platform

Even before bus v2: lift the helper into `tw.events` (or `core.common`) as `tw.events.on(event, handler, owner)` and delete the four plugin copies plus the platform's own variant. Copy-pasted infrastructure in every plugin is the clearest symptom that the plugin API is missing a primitive.

### 5. Generate the event catalog; make docs CI-checked

A small script (vitest + CI already exist) that scrapes `events.send(…)`, `subscribe(…)`, and `data-msg="…"` attributes from `src/` and emits `docs/EVENTS.md` — event name, where fired, where handled, command vs notification. Run it in CI; fail if the committed file is stale. That turns `API.md`'s biggest section from a TODO into something that can't rot — which matters more than hand-written prose for a system whose extension model *is* the event list.

---

## Deliberately not proposed

**Splitting the 1626-line platform file into modules.** It's big but coherent, it's the bootstrap (so it can't use the module system it creates without ceremony), and the real boundary problem is the eval backdoor, not file size. Fixing the boundary makes the monolith fine; splitting the monolith without fixing the boundary changes nothing.
