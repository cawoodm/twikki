// tags: $Script
tw.extensions.registerMacro(
  'packages',
  'import',
  ({name, url, filter, overWrite, doNotSave}) => {
    if (!name) throw new Error('ERROR: No name supplied to packages.import macro!');
    if (!url) throw new Error('ERROR: No url supplied to packages.import macro!');
    return tw.ui.button(`Import: ${name} ${filter ? ' (' + filter + ')' : ''}`, 'package.reload.url', {url, name, overWrite, doNotSave});
  },
  {
    description: 'Button importing a package from a URL.',
    example: '<<packages.import name:website url:packages/website.json>>',
  },
);

// Command palette: prompt for a package URL, then import it (reloads the UI on success).
tw.extensions.registerCommand({
  label: 'Import package from URL…',
  run: () => {
    const url = prompt('Package URL to import:');
    if (!url) return;
    const name = (url.split('/').pop() || '').replace(/\.json$/i, '');
    tw.events.send('package.reload.url', {url, name});
  },
});
