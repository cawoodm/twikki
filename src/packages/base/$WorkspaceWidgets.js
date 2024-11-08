tw.macros.core.WorkspaceSelect = () => {
  let workspace = tw.storage.get('workspace');
  return `<select id="workspace-select" onchange="tw.events.send('workspace.load.prompt', this.value);">
    <option value=""> - new workspace -</option>
    ${tw.storage.get('workspaces').map(n => `<option value="${n}"${n === workspace ? ' selected' : ''}>${n}</option>`).join('\n')}
  </select>`;
};
tw.macros.core.WorkspaceCreate = () => {
  return tw.ui.button('Create Workspace', 'workspace.create.prompt');
};
if (!tw.tmp.workspaceEvents) {
  tw.tmp.workspaceEvents = 1;
  tw.events.subscribe('workspace.load.prompt', (workspace) => {
    if (!workspace) workspace = tw.events.send('workspace.create.prompt')[0];
    if (!workspace) return;
    tw.events.send('workspace.load', workspace);
  }, 'WorkspaceWidgets');
  tw.events.subscribe('workspace.create.prompt', () => {
    let workspace = prompt('Enter name for new workspace:');
    if (!workspace) return;
    if (confirm('Would you like to clone this workspace?'))
      tw.events.send('workspace.clone', workspace);
    else
      tw.events.send('workspace.create', workspace);
    tw.core.dom.$('workspace-select').innerHTML = tw.macros.core.WorkspaceSelect();
    // tw.events.subscribe('tiddler.refresh', '$Workspaces'); // TODO: Dynamically get currentTiddler above?
    return workspace;
  }, 'WorkspaceWidgets');
}
