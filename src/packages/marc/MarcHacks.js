tw.macros.marc = {
  loadThemeButton(filter, force = true) {
    if (!filter) filter = 'default';
    return tw.ui.button(`Load Theme: ${filter}`, 'package.reload.url', {url: './packages/themes.json', name: 'test', filter, force});
  },
  loadThemeFromBinButton(filter, force = true) {
    if (!filter) filter = 'default';
    return tw.ui.button(`Load Theme JSONBin: ${filter}`, 'package.reload.bin', {url: 'https://api.jsonbin.io/v3/b/66eb26c8ad19ca34f8a87ae9', name: 'test', filter, force});
  },
};
tw.events.subscribe('script.loaded', (name) => {
  if (name !== 'highlight-core') return;
  tw.core.dom.addScript('highlight-lang-powershell', '//cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/powershell.min.js');
}, 'marc.addLanguages');

tw.tiddlers.all.filter(t => t.type === 'x-twiki').forEach(t => (t.type = 'x-twikki'));
