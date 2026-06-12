# TODO: Complete this doc

* `tw.events` — pub/sub lifecycle (`ui.loaded`, `tiddler.rendered`, `theme.switch`, …)
* `tw.tiddlers` — the in-memory store (`.all`, `.visible`, `.trashed`)
* `tw.run` — read/update actions on tiddlers
* `tw.core.*` — subsystems (`dom`, `markdown`, `search`, `sections`, …)
* `tw.macros` / `tw.extensions` — register macros and widgets
* `tw.store` — the workspace-scoped storage API (`get`/`set`/`delete`/`keys`, raw `exportRaw`/`importRaw`, `global` for unscoped keys) — what modules and plugins use
* `tw.storage` — the platform's raw localStorage primitive (platform-internal; use `tw.store`)