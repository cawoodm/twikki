tw.extensions.registerPlugin('base', 'OpenLinksInNewWindow', () => {
  return {
    name: 'OpenLinksInNewWindow',
    author: 'Marc Cawood',
    // url: or package:
    description: 'Open http(s):// links in markdown in new window',
    version: '0.0.1',
    init() {
      if (!tw.core.markdown?.md) throw new Error('Markdown library missing!');
    },
    start() {
      // Source: https://www.jsdelivr.com/package/npm/markdown-it-for-inline
      //           https://cdn.jsdelivr.net/npm/markdown-it-for-inline@2.0.1/dist/markdown-it-for-inline.js
      function for_inline_plugin(md, ruleName, tokenType, iterator) {
        function scan(state) {
          for (let blkIdx = state.tokens.length - 1; blkIdx >= 0; blkIdx--) {
            if (state.tokens[blkIdx].type !== 'inline') continue;
            const inlineTokens = state.tokens[blkIdx].children;
            for (let i = inlineTokens.length - 1; i >= 0; i--) {
              if (inlineTokens[i].type !== tokenType) continue;
              iterator(inlineTokens, i);
            }
          }
        }
        md.core.ruler.push(ruleName, scan);
      }
      tw.core.markdown.md.use(for_inline_plugin, 'url_new_win', 'link_open', function (tokens, idx) {
      // Open external links in new window
        if (tokens[idx].attrs[0][1].match(/^https?:/)) tokens[idx].attrSet('target', '_blank');
      });
    },
  };
});
