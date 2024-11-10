(function(tw) {

  const name = 'core.workspaces';
  const version = '0.0.1';

  // Init
  if (!tw.storage.get('workspaces')) tw.storage.set('workspaces', ['default']);
  if (!tw.storage.get('workspace')) tw.storage.set('workspace', 'default');
  // Load Workspace
  if (!tw.storage.get('workspace')) workspaceSwitch();
  tw.workspace = tw.storage.get('workspace');
  try {
    workspaceSwitch(tw.workspace);
  } catch {
    console.warn(`Unknown 'workspace ${tw.workspace}', switching to default`);
    workspaceSwitch();
  }

  // Run
  const run = () => {
    tw.events.subscribe('workspace.switch', workspaceSwitch);
    tw.events.subscribe('workspace.load', workspaceLoad);
    tw.events.subscribe('workspace.create', workspaceCreate);
    tw.events.subscribe('workspace.delete', workspaceDelete);
    tw.events.subscribe('workspace.delete.ui', workspaceDeleteUI);
    tw.events.subscribe('workspace.clone', workspaceCloneUI);
  };

  // Exports
  const exports = {
    workspaceCreate,
    workspaceDelete,
    workspaceSwitch,
    workspaceLoad,
  };

  return {name, version, exports, run};

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
    let currentWorkspace = tw.storage.get('workspace');
    // Check it doesn't already exist
    let workspaces = tw.storage.get('workspaces');
    let index = workspaces.indexOf(name);
    if (index >= 0) throw new Error(`workspaceCreate Failed: Workspace '${name}' already exists!`);
    // Create new workspace
    workspaces.push(name);
    tw.storage.set('workspaces', workspaces);
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
    let workspaces = tw.storage.get('workspaces');
    let index = name ? workspaces.indexOf(name) : 0;
    if (index < 0) throw new Error(`workspaceDelete Failed: Workspace '${name}' not found!`);
    name = workspaces[index];
    // Switch to new storage workspace
    tw.store = {
      get(key) {
        if (key[0] !== '/') key = '/' + key;
        return tw.storage.get('/ws/' + name + key);
      },
      set(key, value) {
        if (key[0] !== '/') key = '/' + key;
        return tw.storage.set('/ws/' + name + key, value);
      },
    };
    // Remember this switch
    tw.storage.set('workspace', name);
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
    let workspaces = tw.storage.get('workspaces');
    let currentWorkspace = tw.storage.get('workspace');
    let index = workspaces.indexOf(name);
    if (index < 0) throw new Error(`workspaceDelete Failed: Workspace '${name}' not found!`);
    if (name === currentWorkspace) throw new Error(`workspaceDelete Failed: Cannot delete current workspace '${name}'! Please switch first.`);
    workspaces.splice(index, 1);
    // let oldStore = tw.storage.workspace(name);
    // oldStore.clear();
    alert('WORKSPACE CLEANUP NOT IMPLEMENTED!');
    // Object.keys(localStorage).forEach(function(key){
    tw.storage.set('workspaces', workspaces);
  }
  function workspaceMigrate(current, name, source) {
    workspaceSwitch(name);
    Object.keys(source).forEach(k => {
      tw.store.set(k, source[k]);
    });
    if (current) workspaceSwitch(current);
  }
});
