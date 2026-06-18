// tags: $Plugin

/**
 * ## Description
 * Dump your entire current workspace — everything under `/ws/<workspace>/` in
 * localStorage — to a single downloadable `<workspace>.workspace.json` file.
 * Keys are stored prefix-stripped so the dump restores into whatever workspace
 * is current, regardless of the source workspace name.
 *
 * To restore, drag a `*.workspace.json` file onto the window. This DELETES and
 * completely overwrites the current workspace (a confirm() guards the wipe),
 * then hard-reboots so everything reloads from the restored localStorage.
 */
(function () {
  const meta = {
    name: 'DumpWorkspace',
    version: '1.0.0',
    platform: '0.27.0',
    description: 'Dump/restore the current workspace as a single JSON file.',
  };

  const FORMAT = 'twikki-workspace-v1';

  function dumpWorkspace() {
    const keys = {};
    // tw.store.keys() returns the current workspace's keys prefix-stripped => portable
    tw.store.keys().forEach(k => (keys[k] = tw.store.exportRaw(k)));
    const data = {format: FORMAT, workspace: tw.workspace, keys};
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = tw.workspace + '.workspace.json';
    a.click();
    URL.revokeObjectURL(url);
    tw.ui.notify(`Workspace '${tw.workspace}' dumped (${Object.keys(keys).length} keys)`, 'S');
  }

  function restoreWorkspace(text, file) {
    if (!confirm(`This will DELETE and completely overwrite your entire workspace ('${tw.workspace}') with the contents of ${file.name}. Continue?`)) return;
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return tw.ui.notify('Invalid JSON', 'E');
    }
    if (data.format !== FORMAT || typeof data.keys !== 'object' || !data.keys) return tw.ui.notify('Not a twikki workspace file', 'E');
    tw.store.keys().forEach(k => tw.store.delete(k)); // wipe
    Object.entries(data.keys).forEach(([rel, val]) => tw.store.importRaw(rel, val)); // overwrite
    tw.events.send('reboot.hard'); // reloads everything from the restored store
  }

  return {
    meta,
    init() {
      tw.extensions.registerMacro('dump', 'dumpButton', () => tw.ui.button('{{$IconPush}}', 'workspace.dump', null, 'dump', 'title="Dump entire workspace to a file"'), {
        description: 'Button to dump the entire workspace to a downloadable file.',
        example: '<<dump.dumpButton>>',
      });

      tw.events.subscribe('workspace.dump', dumpWorkspace, 'dumpworkspaceplugin');
      tw.run.registerDropHandler('*.workspace.json', restoreWorkspace);
    },
  };
})();
