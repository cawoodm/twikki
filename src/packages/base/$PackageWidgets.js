tw.macros.packages = {
  // Example: Import package website without overwriting
  // <<packages.import name:website url:./packages/website.json filter:* force:false>>
  import({name, url, filter, overWrite, doNotSave}) {
    if (!name) throw new Error('ERROR: No name supplied to packages.import macro!');
    if (!url) throw new Error('ERROR: No url supplied to packages.import macro!');
    return tw.ui.button(`Import: ${name} ${filter ? ' (' + filter + ')' : ''}`, 'package.reload.url', {url, name, overWrite, doNotSave});
  },
  importBin({name, url, filter, overWrite, doNotSave}) {
    if (!name) throw new Error('ERROR: No name supplied to packages.importBin macro!');
    if (!url) throw new Error('ERROR: No url supplied to packages.importBin macro!');
    return tw.ui.button(`Import: ${name} ${filter ? ' (' + filter + ')' : ''}`, 'package.reload.bin', {url, name, overWrite, doNotSave});
  },
};
