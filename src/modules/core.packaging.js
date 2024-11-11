(function(tw) {

  const name = 'core.packaging';
  const version = '0.0.1';

  const exports = {
    loadPackageFromURL,
    reloadPackageFromUrl,
    loadPackageFromJSONBin,
    reloadPackageFromJSONBin,
  };

  return {name, version, exports};

  async function loadPackageFromURL({url, name = '', filter = '', overWrite = false, doNotSave = false, noOverWrite = false}) {
    console.debug('Loading tiddler package', name, url);
    try {
      let obj = await httpGetJSON(url, name, {});
      return loadList(obj.tiddlers, {name, overWrite, filter, doNotSave, noOverWrite}); // tw.events.send('package.loaded');
    } catch (e) {
      // TODO: Replace notify with throw new Error()
      tw.ui.notify(`Failed to load tiddler package '${name}' from ${url} (see log)`, 'E', e.stack);
      return 0;
    }
  }

  async function loadPackageFromJSONBin({url, name = '', filter = '', overWrite = false, doNotSave = false, noOverWrite = false}) {
    console.debug('Loading tiddler package from JSONBin', name, url, overWrite);
    let settings = tw.call('getJSONObject', '$GeneralSettings');
    if (!settings?.JSONBin?.accessKey) return tw.ui.notify('No JSONBin accessKey found in $GeneralSettings!', 'W');
    try {
      let obj = await httpGetJSON(url, name, {'X-Access-Key': settings.JSONBin.accessKey});
      if (obj.record.all) throw new Error('You are trying to load a backup! This is for packages!');
      return loadList(obj.record.tiddlers, {name, filter, overWrite, doNotSave, noOverWrite});
    } catch (e) {
      tw.ui.notify(`Failed to load tiddler package '${name}' from JSONBin ${url} (see log)`, 'E', e.stack);
      return 0;
    }
  }
  function loadList(list, {name, filter, overWrite = false, doNotSave = false, noOverWrite = false} = {}) {
    let count = 0;
    if (!Array.isArray(list)) return tw.ui.notify(`packages.loadList(${name}): No tiddlers array returned!`, 'E');
    filter = filter && filter !== '*' ? new RegExp(filter, 'i') : null;
    // Delete all tiddlers of this package but not in this new list
    tw.tiddlers.all.filter(t => t.package === name)
      .map(t => t.title)
      .filter(title => !list.find(t => t.title === title))
      .forEach((title) => (tw.run.deleteTiddler(title, true)));

    list.forEach(t => {
      t.updated = new Date(t.updated);
      t.created = new Date(t.created);
      let issues = tw.util.tiddlerValidation(t);
      if (issues.length) return tw.ui.notify(`Tiddler '${t.title}' is invalid: ` + issues.join('<br>'));
      if (filter && !filter.test(t.title)) return console.debug('Skipping import of tiddler', t.title);
      const existingTiddler = tw.run.getTiddler(t.title, false);
      if (noOverWrite && existingTiddler) return; // Don't overwrite, skip silently
      if (overWrite !== true && existingTiddler) {
        if (!existingTiddler.isRawShadow && tiddlerDiff(existingTiddler, t)) {
          if (existingTiddler.tags.includes('$NoImport')) return;
          if (!confirm(`Package '${name}' will overwrite tiddler '${t.title}'! OK to proceed?`)) return;
          // console.debug(`packages.loadList(${name}): Tiddler '${t.title}' exists and is being be overwritten...`);
        }
      }
      if (doNotSave) t.doNotSave = true;
      if (existingTiddler?.tags.includes('$NoImport')) return tw.ui.notify(`Not importing $NoImport tiddler '${t.title}'!`, 'E');
      t.package = name;
      if (existingTiddler)
        // TODO: Not good as it generates events during boot
        tw.run.updateTiddlerHard(t.title, t);
      else
        tw.run.addTiddlerHard(t);
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

  async function reloadPackageFromUrl(pck) {
    let count = await loadPackageFromURL(pck);
    tw.events.send('ui.reload');
    tw.ui.notify(`${count} tiddlers imported from package ${pck.name || pck.url}`, 'D');
  }
  async function reloadPackageFromJSONBin(pck) {
    let count = await loadPackageFromJSONBin(pck);
    tw.events.send('ui.reload');
    tw.ui.notify(`${count} tiddlers imported from package ${pck.name || pck.url}`, 'D');
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
      throw new Error(`Failed to load package '${name}' with invalid JSON (see log) from ${url}: ${e.message}`);
    }
  }
});
