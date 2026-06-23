# TWikki Event Bus — Review Findings

**Scope:** `src/modules/core.js` (`tw.events`) on `main` @ `d79ab3b`.
**Method:** static read of the bus plus a runtime probe — the module was loaded with stubs, `init()`'d, and exercised directly. Every "Verified" item below was reproduced at runtime, not inferred.

---

## Summary

The bus has gained the right *capabilities* — `request` (first-wins) and `filter` (transform-chain) are well-designed and close the cancellable/transform gap. The remaining problems are in the *bookkeeping*: the duplicate guard still doesn't work, `override` leaks dead entries and registers the wrong owner, and `handlers()` exposes internal state. Three of the four verified issues are small, low-risk fixes that close real leaks.

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | Duplicate-handler guard compares the wrong field; never dedups | High | Verified |
| 2 | `override` leaves tombstone entries and forwards no `owner` | High | Verified |
| 3 | `override`-registered handlers can't be torn down by owner (double-fire after reload) | High | Verified |
| 4 | `handlers()` returns the live internal array | Medium | Verified |
| 5 | `eval` backdoor in `subscribe`/`override` | Medium | By inspection |
| 6 | `init` enforced only on `subscribe`, not `send`/`request`/`filter` | Low | By inspection |
| 7 | No per-subscription unsubscribe handle; no `once` | Low | By inspection |
| 8 | `request`/`filter` catch-warnings omit the owner | Low | By inspection |
| 9 | No ordering/priority control for pipelines | Low | By inspection |

---

## Verified bugs

### 1. The duplicate-handler guard does not work — `core.js:92`

```js
if (handlers.find(h => h.event === event && h.handler.name === owner)) return ...
```

It compares the *function's* `.name` against `owner`. The stored `owner` field is never used for dedup.

**Probe:** three identical `subscribe('tiddler.updated', render, 'ExplorerPlugin')` calls →

```
A) handlers for tiddler.updated after 3 identical subscribes: 3 (expected 1 if dedup worked)
```

`'render' === 'ExplorerPlugin'` is never true, so nothing is deduped. Today this is *masked* by `unsubscribeByOwner` running in `unloadPlugins` (teardown before re-eval), but the guard itself is dead code.

**Fix:** compare identity, not name:
`h.event === event && h.owner === owner && h.handler === handler`
(catches true double-subscribes; still allows distinct handlers under one owner).

### 2. `override` leaks tombstones and ignores `owner` — `core.js:96-102`

```js
handlers.filter(h => h.event === event).forEach(h => delete h.event); // tombstone
this.subscribe(event, handler);                                       // no owner
```

`delete h.event` leaves a dead `{handler, owner}` entry in the array forever; it should `splice`.

**Probe:** two overrides of `markdown.render` →

```
B) total handler entries after 2 overrides: 2 (expected 1)
   entries: [{"owner":"md1"},{"event":"markdown.render","owner":"md2"}]
   live markdown.render handlers: 1
```

The first entry is a tombstone (`event` deleted). Functionally harmless (it never matches an event again) but it accumulates on every repeated override — e.g. `markdown.render` overridden on each soft reload — and pollutes `handlers()`.

**Fix:** remove matching entries in place (`splice`), and give `override` an `owner` parameter it forwards to `subscribe`.

### 3. Overrides can't be torn down by owner — `core.js:101`

Because `override` calls `subscribe` with no owner, the entry's owner falls back to the function's `.name`.

**Probe:** `override('ghsync.push', plugin.save)` (a method, `.name === 'save'`) →

```
B2) override-registered owner: ["save"] → unsubscribeByOwner("GithubRepoSync") removes: 0
```

So `unloadPlugins`' `unsubscribeByOwner(meta.name)` removes **nothing** for any `override`-based plugin (GistBackup, and the GithubRepoBackup/GithubRepoSync plugins from this work). On soft reload the stale override survives → **double-firing**. This is the practical fallout of #2.

**Fix:** ships with #2 (owner-aware `override`); then update the `override`-based plugins to pass `meta.name` as the owner.

### 4. `handlers()` returns the live internal array — `core.js:119`

**Probe:**

```
D) external push into handlers() persisted? true
```

Any caller can mutate bus internals.

**Fix:** return a copy — `return [...handlers];`.

---

## Design observations (not bugs)

- **5. `eval` backdoor** in `subscribe` (`core.js:84`) and `override` (`core.js:97`) for string handlers — the architecture review's "major #1". Highest concern in an app that runs fetched packages.
- **6. `init` is enforced only on `subscribe`.** `send`/`request`/`filter` run pre-init, so ordering mistakes fail silently instead of loudly.
- **7. No per-subscription unsubscribe handle** — only `unsubscribeByOwner`. Awkward for one-off / `once` semantics.
- **8. `request`/`filter` catch-warnings omit the `owner`** (`core.js:46,70`) — a throwing handler is hard to trace to a plugin.
- **9. No ordering/priority control** — `filter`/`request` run in subscription order; for pipelines (`renderer.pre`/`renderer.post`) ordering is implicit and load-order-dependent.

## What's already good

- `request(event, params)` — first non-null result wins; throws caught and skipped. Clean generalisation of the old `markdown.render` single-handler convention.
- `filter(event, value, ctx)` — chains `value` through subscribers; `undefined` = pass-through; throws are caught and the previous value flows on; empty list returns the input unchanged.
- `unsubscribeByOwner(owner)` correctly `splice`s (the right pattern `override` should also use).

---

## Recommended fixes (ordered)

1. **Fix dedup** — compare `h.event === event && h.owner === owner && h.handler === handler`.
2. **Fix `override`** — `splice` matching entries (no tombstones) and add an `owner` param forwarded to `subscribe`.
3. **`handlers()` returns a copy** (`[...handlers]`).
4. **`subscribe` returns an unsubscribe fn**; add `once(event, handler, owner)`.
5. **Include `owner`** in the `request`/`filter` catch warnings.
6. **Enforce `initialized`** consistently across `send`/`request`/`filter` (or deliberately relax it everywhere).
7. *Stretch:* retire the `eval` string-handler path; add optional **priority** to `subscribe` for pipeline ordering.

Items **1–3** are high-value / low-risk (a few lines each) and close real leaks. **4–7** are a sensible follow-up. The existing `test/unit/events.test.js` can be extended to lock in dedup / override / cleanup behaviour — the runtime probes above are essentially those test cases.

---

## Appendix — probe harness

The module was loaded with minimal stubs (`dp`, `tw.logging.break`, `tw.core.common.decoder`, `window.devMode = false`), `tw.events.init()` called, then:

- **A.** `subscribe('tiddler.updated', render, 'ExplorerPlugin')` ×3 → counted live handlers.
- **B.** `override('markdown.render', md1)` then `override(..., md2)` → inspected `handlers()`.
- **B2.** `override('ghsync.push', plugin.save)` → checked the registered owner and `unsubscribeByOwner('GithubRepoSync')` return.
- **D.** pushed a fabricated entry into `handlers()` and re-read the count.
