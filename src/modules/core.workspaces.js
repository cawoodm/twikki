/**
 * Workspaces
 * Named workspaces — isolated tiddler stores living under the
 * `/ws/<name>/` localStorage prefix. Manages which workspace is ACTIVE
 * (`tw.workspace`, which core.store reads to scope `tw.store`) and handles
 * the workspace.switch/load/create/clone/delete events. Switching just
 * repoints `tw.workspace`; `workspace.load` hard-reboots so the UI reloads
 * from the new store. Falls back to 'default' if the saved name is unknown.
 */
(function (tw) {
  const name = 'core.workspaces';
  const version = '0.25.0';
  const platform = '0.26.0'; // built for platform ^0.26.0

  // Init
  if (!tw.store.global.get('workspaces')) tw.store.global.set('workspaces', ['default']);
  if (!tw.store.global.get('workspace')) tw.store.global.set('workspace', 'default');
  bootstrapFromQuery();
  tw.workspace = sessionStorage.getItem('workspace') || tw.store.global.get('workspace') || 'default';
  try {
    workspaceSwitch(tw.workspace);
  } catch {
    console.warn(`Unknown 'workspace ${tw.workspace}', switching to default`);
    sessionStorage.removeItem('workspace');
    workspaceSwitch();
  }

  // Run
  const run = () => {
    tw.events.subscribe('workspace.switch', workspaceSwitch, name);
    tw.events.subscribe('workspace.load', workspaceLoad, name);
    tw.events.subscribe('workspace.create', workspaceCreate, name);
    tw.events.subscribe('workspace.delete', workspaceDelete, name);
    tw.events.subscribe('workspace.delete.ui', workspaceDeleteUI, name);
    tw.events.subscribe('workspace.clone', workspaceCloneUI, name);
  };

  // Exports
  const exports = {
    workspaceCreate,
    workspaceDelete,
    workspaceSwitch,
    workspaceLoad,
  };

  return {name, version, platform, exports, run};

  function workspaceDeleteUI(workspace) {
    if (!confirm(`Sure you want to delete the workspace '${workspace}'? This is irrevocable unless you have backups!`)) return;
    workspaceDelete(workspace);
    tw.ui.notify(`Workspace '${workspace} was deleted`, 'S');
  }

  function workspaceCloneUI(workspace) {
    workspaceCreate(workspace, true);
    tw.ui.notify(`Workspace '${workspace} was cloned`, 'S');
  }

  function workspaceCreate(name, clone) {
    // Remember current workspace (if any)
    let currentWorkspace = tw.store.global.get('workspace');
    // Check it doesn't already exist
    let workspaces = tw.store.global.get('workspaces');
    let index = workspaces.indexOf(name);
    if (index >= 0) throw new Error(`workspaceCreate Failed: Workspace '${name}' already exists!`);
    // Create new workspace
    workspaces.push(name);
    tw.store.global.set('workspaces', workspaces);
    if (clone) {
      // Copy all data across
      workspaceMigrate(currentWorkspace, name, {
        tiddlers: tw.store.get('tiddlers'),
        'tiddlers-visible': tw.store.get('tiddlers-visible'),
        'tiddlers-trashed': tw.store.get('tiddlers-trashed'),
      });
    }
  }
  /**
   * Switch Workspace without reloading UI
   */
  function workspaceSwitch(name) {
    // TODO: Save if dirty prompt
    let workspaces = tw.store.global.get('workspaces');
    let index = name ? workspaces.indexOf(name) : 0;
    if (index < 0) throw new Error(`workspaceSwitch Failed: Workspace '${name}' not found!`);
    name = workspaces[index];
    // Repoint the active workspace — tw.store (core.store) scopes by tw.workspace
    tw.store.global.set('workspace', name);
    // Per-tab anchor — survives `?ws=` strip and in-app hash mutation
    sessionStorage.setItem('workspace', name);
    tw.workspace = name;
  }
  /**
   * Switch Workspace without reloading UI
   */
  function workspaceLoad(name) {
    workspaceSwitch(name);
    // Need a hard reboot due to freeze() on shadow tiddlers
    tw.events.send('reboot.hard');
  }
  function workspaceDelete(name) {
    let workspaces = tw.store.global.get('workspaces');
    let currentWorkspace = tw.store.global.get('workspace');
    let index = workspaces.indexOf(name);
    if (index < 0) throw new Error(`workspaceDelete Failed: Workspace '${name}' not found!`);
    if (name === currentWorkspace) throw new Error(`workspaceDelete Failed: Cannot delete current workspace '${name}'! Please switch first.`);
    workspaces.splice(index, 1);
    // let oldStore = tw.storage.workspace(name);
    // oldStore.clear();
    alert('WORKSPACE CLEANUP NOT IMPLEMENTED!');
    // Object.keys(localStorage).forEach(function(key){
    tw.store.global.set('workspaces', workspaces);
  }
  function workspaceMigrate(current, name, source) {
    workspaceSwitch(name);
    Object.keys(source).forEach(k => {
      tw.store.set(k, source[k]);
    });
    if (current) workspaceSwitch(current);
  }

  // `?ws=<name>` is a one-shot bootstrap: when present and known, the name is
  // written into sessionStorage and the URL is reloaded without the query.
  // From then on the session anchors this tab's workspace — immune to in-app
  // hash mutation. Unknown names are left in the URL with a warning so the
  // user can see what they typed; the fallback chain picks the default.
  function bootstrapFromQuery() {
    const params = new URLSearchParams(location.search);
    const wsFromQuery = params.get('ws');
    if (!wsFromQuery) return;
    const known = (tw.store.global.get('workspaces') || []).indexOf(wsFromQuery) >= 0;
    if (!known) {
      console.warn(`Unknown 'workspace ${wsFromQuery}' from ?ws=, ignoring`);
      return;
    }
    sessionStorage.setItem('workspace', wsFromQuery);
    params.delete('ws');
    const cleanSearch = params.toString();
    const cleanUrl = location.pathname + (cleanSearch ? '?' + cleanSearch : '') + location.hash;
    try {
      location.replace(cleanUrl);
    } catch {
      // file:// or strict sandbox — fall through; the session anchor still works
    }
  }
});
