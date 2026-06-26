// Rendering every shipped tiddler exercises all macros and inclusions in the
// real content (e.g. <<modules>>, <<pluginMeta>>, {{Tiddler}}), which is where
// render-time bugs hide — like a macro reading a field that no longer exists on
// tw.modules. The renderer does NOT throw on these: a failing macro yields
//   <span class="error">Macro '<ns>.<name>' failed in tiddler '<title>'!…</span>
// and a failing tiddler yields
//   <span class="error">ERROR: renderTWikki '<title>' Failed: …</span>
// (each also logged to the console). This test renders every tiddler and flags
// both soft failure spans and any hard throw.

import {expect, test} from '@playwright/test';
import {bootApp} from './helpers.js';

// Matches the renderer's two error-span shapes (macro failure / tiddler failure).
const ERROR_SPAN = /class="error">(ERROR: renderTWikki|Macro [^<]*failed)/;

test('every tiddler renders without errors (catches macro/render bugs)', async ({page}) => {
  const consoleErrors = [];
  page.on('console', m => {
    if ((m.type() === 'warning' || m.type() === 'error') && /(renderTWikki .*Failed|Macro .*failed in tiddler)/.test(m.text())) {
      consoleErrors.push(m.text());
    }
  });

  await bootApp(page); // full boot (?trace) — all packages, so <<modules>> etc. are present

  const failures = await page.evaluate(re => {
    const rx = new RegExp(re);
    const out = [];
    for (const t of tw.tiddlers.all) {
      let html;
      try {
        html = tw.core.render.makeTiddlerText(t); // same render path opening a tiddler uses
      } catch (e) {
        out.push(`${t.title}: THREW ${e.message}`);
        continue;
      }
      if (typeof html === 'string' && rx.test(html)) out.push(`${t.title}: rendered an error span`);
    }
    return out;
  }, ERROR_SPAN.source);

  expect(failures, 'tiddlers that failed to render:\n' + failures.join('\n')).toEqual([]);
  expect(consoleErrors, 'render error logs:\n' + consoleErrors.join('\n')).toEqual([]);
});
