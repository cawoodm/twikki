/**
 * Packaging
 * Fetches tiddler packages — JSON `{tiddlers: [...]}` — over HTTP and merges
 * them into the store: validates each tiddler, prunes tiddlers that were
 * removed from the package, honours `$NoImport` and the `noOverWrite`/
 * `overWrite`/`filter` options, and confirm()s before overwriting a tiddler
 * the user has changed. `reloadPackageFromUrl` additionally reloads the UI.
 */
(function (tw) {
  const name = 'core.packaging';
  const version = '0.28.0';
  const platform = '0.28.0'; // built for platform ^0.28.0

  // Tags that represent local user state rather than package content. When a
  // forced package load overwrites an existing tiddler, these are carried over
  // from the existing copy so an import can't silently undo them. $CodeDisabled
  // is the key case: it lets a user disable a (base) plugin and have it stay
  // disabled across reloads, even though the plugin ships in a force-loaded
  // package. Add tags here as more local-only state is introduced.
  const PRESERVED_TAGS = ['$CodeDisabled'];

  const exports = {
    fetchPackage,
    loadPackageFromURL,
    reloadPackageFromUrl,
    loadList,
  };

  /* BEGIN offlineFallback helper
   * Pure decision used when a package fetch fails. Given whether the browser is
   * online and whether a cached copy of this package already lives in the store
   * (its tiddlers were loaded on a previous, online boot), decide how to react:
   *   - 'use-cache'  : offline AND we have a cached copy → keep the cached
   *                    tiddlers, notify informationally, do NOT re-throw. This is
   *                    what makes a force-loaded package offline-tolerant.
   *   - 'fail'       : online (a genuine network/HTTP error) OR offline with no
   *                    cached copy to fall back on → surface the error as before.
   * Kept free of closure refs (only its args) so it can be unit-tested by
   * sentinel extraction, mirroring the buildUrl helper in the platform.
   */
  function offlineFallback({online, hadCachedCopy}) {
    if (!online && hadCachedCopy) return 'use-cache';
    return 'fail';
  }
  /* END offlineFallback helper */

  // The import button macro and command palette entry (moved here from the old
  // $PackageWidgets.js). Both dispatch `package.reload.url`, which this plugin
  // now owns, so they open the dialog. Idempotent — safe to re-run on reload.
  tw.extensions.registerMacro(
    'packages',
    'import',
    ({name, url, filter, overWrite, doNotSave}) => {
      if (!name) throw new Error('ERROR: No name supplied to packages.import macro!');
      if (!url) throw new Error('ERROR: No url supplied to packages.import macro!');
      return tw.ui.button(`Import: ${name} ${filter ? ' (' + filter + ')' : ''}`, 'package.reload.url', {url, name, filter, overWrite, doNotSave});
    },
    {
      description: 'Button importing a package from a URL (opens the import dialog).',
      example: '<<packages.import name:website url:packages/website.json>>',
    },
  );

  tw.extensions.registerCommand({
    label: 'Import package from URL…',
    run: () => {
      const url = prompt('Package URL to import:');
      if (!url) return;
      const name = (url.split('/').pop() || '').replace(/\.json$/i, '');
      tw.events.send('package.reload.url', {url, name});
    },
  });

  return {name, version, platform, exports};

  // Fetch a package's tiddler list without merging anything into the store.
  // Used by the import dialog (PackageImportPlugin) so it can present the
  // tiddlers for selection before calling loadList(). Returns
  // `{name, url, tiddlers}` or null (after notifying) on failure.
  async function fetchPackage({url, name = ''}) {
    // Resolve relative URLs (e.g. `packages/website.json`) against the platform's
    // baseUrl rather than the document URL — the latter drops a no-trailing-slash
    // last segment (`/twikki?reload` → base `/`) and would 404 the fetch.
    url = tw.core.buildUrl(url);
    dp('Fetching tiddler package', name, url);
    try {
      let obj = await httpGetJSON(url, name, {});
      return {name, url, tiddlers: Array.isArray(obj.tiddlers) ? obj.tiddlers : []};
    } catch (e) {
      // Offline tolerance: if the network is down (or the fetch threw) and a
      // copy of this package was already merged into the store on a previous
      // online boot, keep using that cached copy rather than surfacing a scary
      // error. Returns a {cached:true} marker so loadPackageFromURL leaves the
      // existing tiddlers untouched. See the offlineFallback helper above.
      const online = typeof navigator === 'undefined' || navigator.onLine !== false;
      const hadCachedCopy = !!(name && tw.tiddlers?.all?.some(t => t.package === name));
      if (offlineFallback({online, hadCachedCopy}) === 'use-cache') {
        tw.ui.notify(`Offline: using cached copy of package '${name}'`, 'I');
        return {name, url, cached: true, tiddlers: null};
      }
      // TODO: Replace notify with throw new Error()
      tw.ui.notify(`Failed to load tiddler package '${name}' from ${url} (see console log)`, 'E', e.stack);
      return null;
    }
  }

  // Import package (no reload, stuff isn't run)
  async function loadPackageFromURL({url, name = '', filter = '', overWrite = false, doNotSave = false, noOverWrite = false}) {
    let pck = await fetchPackage({url, name});
    if (!pck) return 0; // fetchPackage already notified
    // Offline fallback: the fetch failed but a cached copy is already in the
    // store. Leave those tiddlers in place (no merge, no prune) and report 0.
    if (pck.cached) return 0;
    return loadList(pck.tiddlers, {name, overWrite, filter, doNotSave, noOverWrite}); // tw.events.send('package.loaded');
  }

  // Import package and reload (plugins, scripts run). Degraded, no-plugin
  // fallback — PackageImportPlugin overrides `package.reload.url` with a
  // selective dialog. Here we still save and report so a fix survives a reload.
  async function reloadPackageFromUrl(pck) {
    let count = await loadPackageFromURL(pck);
    tw.events.send('ui.reload');
    tw.events.send('save');
    tw.ui.notify(`${count} tiddlers imported from package ${pck.name || pck.url}`, 'S');
  }

  // `selectedTitles` (optional Set): when provided, only tiddlers whose title is
  // in the set are imported — used by the import dialog to honour per-tiddler
  // checkboxes. Pruning still uses the full `list` so unchecked existing package
  // tiddlers are never deleted.
  function loadList(list, {name, filter, overWrite = false, doNotSave = false, noOverWrite = false, selectedTitles = null} = {}) {
    let count = 0;
    if (!Array.isArray(list)) return tw.ui.notify(`packages.loadList(${name}): No tiddlers array returned!`, 'E');
    filter = filter && filter !== '*' ? new RegExp(filter, 'i') : null;
    // Delete all tiddlers of this package but not in this new list
    tw.tiddlers.all
      .filter(t => t.package === name)
      .map(t => t.title)
      .filter(title => !list.find(t => t.title === title))
      .forEach(title => tw.run.deleteTiddler(title, true));

    list.forEach(t => {
      if (selectedTitles && !selectedTitles.has(t.title)) return; // deselected in the import dialog
      // created falls back to the stable `updated` (not the wall clock) so a
      // default tiddler that ships no `created` resolves to the same value on
      // every client — otherwise each boot/import invents a fresh `created` and
      // the sync churns it. Computed before `updated` is reparsed so it reads the
      // original value. See core.tiddlers.js (addTiddler) for the same pattern.
      t.created = new Date(t.created || t.updated || new Date());
      t.updated = new Date(t.updated || new Date());
      let issues = tw.util.tiddlerValidation(t);
      if (issues.length) return tw.ui.notify(`Tiddler '${t.title}' is invalid: ` + issues.join('<br>'));
      if (filter && !filter.test(t.title)) return dp('Skipping import of tiddler', t.title);
      const existingTiddler = tw.run.getTiddler(t.title, false);
      if (noOverWrite && existingTiddler) return; // Don't overwrite, skip silently
      if (overWrite !== true && existingTiddler) {
        if (!existingTiddler.isRawShadow && tiddlerDiff(existingTiddler, t)) {
          if (existingTiddler.tags.includes('$NoImport')) return;
          if (!confirm(`Package '${name}' will overwrite tiddler '${t.title}'! OK to proceed?`)) return;
          // dp(`packages.loadList(${name}): Tiddler '${t.title}' exists and is being be overwritten...`);
        }
      }
      if (doNotSave) t.doNotSave = true;
      if (existingTiddler?.tags.includes('$NoImport')) return tw.ui.notify(`Not importing $NoImport tiddler '${t.title}'!`, 'E');
      t.package = name;
      if (existingTiddler) {
        // Carry over local-only tags (see PRESERVED_TAGS) so a forced overwrite
        // doesn't undo user state such as a disabled plugin.
        PRESERVED_TAGS.forEach(tag => {
          if (existingTiddler.tags?.includes(tag) && !t.tags.includes(tag)) t.tags.push(tag);
        });
        // TODO: Not good as it generates events during boot
        tw.run.updateTiddlerHard(t.title, t);
      } else tw.run.addTiddlerHard(t);
      count++;
    });
    return count;
  }

  function tiddlerDiff(t1, t2) {
    if (t1.title !== t2.title) return 'title';
    if (t1.text !== t2.text) return 'text';
    if (t1.tags.join(' ') !== t2.tags.join(' ')) return 'tags';
    return false;
  }

  async function httpGetJSON(url, name, headers = {}) {
    let res;
    try {
      res = await fetch(url, {headers});
    } catch (e) {
      throw new Error(`Failed to load package '${name}' with network error from ${url}: ${e.message}`);
    }
    if (!res.ok) throw new Error(`Failed to load package '${name}' with HTTP Status '${res.status}' from ${url}`);
    let obj;
    try {
      obj = await res.json();
      return obj;
    } catch (e) {
      throw new Error(`Failed to load package '${name}' with invalid JSON (see console log) from ${url}: ${e.message}`);
    }
  }
});
