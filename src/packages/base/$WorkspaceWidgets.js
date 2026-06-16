// tags: $Script
tw.extensions.registerMacro(
  'core',
  'WorkspaceSelect',
  () => {
    let workspace = tw.workspace || tw.storage.get('workspace');
    let items = (tw.storage.get('workspaces') || [])
      .map(n => `<a class="picker-item${n === workspace ? ' active' : ''}" href="?ws=${encodeURIComponent(n)}" rel="noopener" data-value="${n}">${n}</a>`)
      .join('');
    // Single-line output so the widget can live inside markdown table cells.
    // Every child of `.picker-menu` MUST be phrasing content (span/a/button) so
    // the HTML parser doesn't hoist block items out of the surrounding `<p>`
    // wrap that markdown-it adds when the macro lives in a tiddler body — see
    // TagsMacro.js for the same gotcha. CSS makes spans render as blocks.
    return `<span class="picker" data-event="workspace.load.prompt">
    <button class="icon picker-trigger" title="Workspace" aria-haspopup="true">{{$IconWorkspace}}</button>
    <span class="picker-menu" hidden>
      <span class="picker-item picker-action" data-value="">– new workspace –</span>
      ${items}</span>
    </span>`.replace(/\n/g, '');
  },
  {
    description: 'Dropdown to switch or create workspaces.',
    example: '<<WorkspaceSelect>>',
  },
);
tw.extensions.registerMacro('core', 'WorkspaceCreate', () => tw.ui.button('Create Workspace', 'workspace.create.prompt'), {
  description: 'Prompt for and create/clone a workspace.',
  example: '<<WorkspaceCreate>>',
});
if (!tw.tmp.workspaceEvents) {
  tw.tmp.workspaceEvents = 1;
  tw.events.subscribe(
    'workspace.load.prompt',
    workspace => {
      if (!workspace) workspace = tw.events.send('workspace.create.prompt')[0];
      if (!workspace) return;
      tw.events.send('workspace.load', workspace);
    },
    'WorkspaceWidgets',
  );
  tw.events.subscribe(
    'workspace.create.prompt',
    () => {
      let workspace = prompt('Enter name for new workspace:');
      if (!workspace) return;
      if (confirm('Would you like to clone this workspace?')) tw.events.send('workspace.clone', workspace);
      else tw.events.send('workspace.create', workspace);
      tw.events.send('tiddler.refresh', '$Workspaces');
      return workspace;
    },
    'WorkspaceWidgets',
  );
}

// Command palette: "Create workspace" plus a dynamic "Switch workspace: X" per
// stored workspace (a provider so the list stays current).
tw.extensions.registerCommand({label: 'Create workspace', event: 'workspace.create.prompt'});
tw.extensions.registerCommandProvider('workspaces', () =>
  (tw.storage.get('workspaces') || []).map(name => ({
    label: `Switch workspace: ${name}`,
    event: 'workspace.load.prompt',
    payload: name,
  })),
);
