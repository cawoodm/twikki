# Modules & Packages

The Twikki Platform loads code via HTTP:
* It's core behaviour via modules (fixed)
* Base functionality via a `base` package (defined in $CorePackages)
* Custom/user functionality listed in $ExtensionPackages

**Note:** An important distinction between modules and packages is that modules apply across all workspaces whereas packages are defined per-workspace. For a given host (domain/localStorage) you have one version of standard modules installed but each workspace may have different versions of packages/plugins.

> For developers, both modules and packages are bundled from source files by the custom [COMPILER.md](./COMPILER.md) into `.json`.
> This document covers what happens **after** compilation — the runtime side.

The platform lives in [src/platform/twikki.platform.js](../src/platform/twikki.platform.js) which is the only script referenced in index.html. It will load modules from `window.MODULE_URL/modules` which you can override.

## Modules
* `core.js`: Basic API
  * `events`: Basic event bus (pub/sub)
  * `run`:
    * `getTiddler` helper function for accessing tiddlers.
  * `extensions`: Interface for extensions/plugins
    * `registerMacro`: Register a new macro/widget
* `core.common`: Common functionality shared in the codebase (hashing, sorting, html escaping)
* `core.sections`: Functionality for ContentSections
* `core.workspaces`: Functionality for Workspaces
* `core.default.json`: Essential tiddlers/content we need to run. These "shadow" tiddlers can be overridden by users. Some examples are:
  * Icons: Some basic (ugly) icons. Users will typically load their own "icons" package.
  * Themes: 2 basic themes (CoreThemeLight & CoreThemeDark)
  * Layout: Templates for the main site's HTML ($MainLayout) or parts thereof ($TiddlerDisplay)
* `core.packaging`: Functionality for loading and handling packages
* `core.parameters`: Functionality for handling Parameters in widgets and macros
* `core.dom`: Functionality for dealing with the DOM
* `core.ui`: Functionality for generating the UI (buttons, dialogs, sections)
* `core.notifications`: Functionality for showing alerts and messages
* `core.templater`: Tiny mustache-style template engine
* `core.search`: Search functions


### Updates
Update logic is managed in `loadCoreModule(moduleName)`.
Modules are cached in localStorage and re-downloaded when:
* the platform version changes (a `/modules.version` stamp is compared against `VERSION` on boot — platform and modules ship together, so a new platform never runs against stale incompatible modules), or
* `?update` / `?reload` is passed in the URL (needed during development when module sources change without a version bump).

> TODO: Make a sensible update policy and dialog

**Known Issue** TODO: The cache-hit condition is `!res?.code`. A cached **code** module has a `.code` property, so it is served from localStorage and *not* re-fetched. A cached **list** module (`core.defaults.json`) has `.tiddlers` but no `.code`, so `!res?.code` is always true and it is **re-downloaded on every boot**.
