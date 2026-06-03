tw.macros.core.WorkspaceSelect = () => {
  let workspace = tw.storage.get('workspace');
  let items = (tw.storage.get('workspaces') || []).map(n =>
    `<button class="picker-item${n === workspace ? ' active' : ''}" data-value="${n}">${n}</button>`,
  ).join('');
  return `<span class="picker" data-event="workspace.load.prompt">
    <button class="icon picker-trigger" title="Workspace" aria-haspopup="true">▦</button>
    <span class="picker-menu" hidden>
      <button class="picker-item picker-action" data-value="">– new workspace –</button>
      ${items}
    </span>
  </span>`;
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
    tw.events.send('tiddler.refresh', '$Workspaces');
    return workspace;
  }, 'WorkspaceWidgets');
}
