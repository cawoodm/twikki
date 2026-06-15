import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

// Load core.render.js with a minimal stub harness so we can exercise the
// exported helpers in isolation. We only touch maskCodeRegions and
// getTiddlerLinks here — both are pure string/regex utilities that don't
// reach into tw at call time.
function loadRender() {
  if (!RegExp.compose) RegExp.compose = (re, vars) => {
    let src = re.source;
    for (const [k, v] of Object.entries(vars)) src = src.replaceAll(k, v.source);
    return new RegExp(src, re.flags);
  };
  const tw = {
    run: {},
    events: {subscribe() {}, send() {}, filter: (_e, v) => v},
    core: {common: {escapeHtml: s => s, hash: s => s}, templater: {Templater: class {}}},
    extensions: {},
    templates: {},
    extend: {tiddlerDetails: {}},
    logging: {trace: false, break() {}},
    tiddlers: {visible: []},
  };
  global.window = global.window || {};
  const code = readFileSync(join(root, 'src/modules/core.render.js'), 'utf8');
  const meta = (0, eval)(code)(tw);
  return meta.exports;
}

test('maskCodeRegions: line-anchored fenced block is masked', () => {
  const {maskCodeRegions} = loadRender();
  const text = 'before\n```js\nfoo()\n```\nafter';
  const {masked, restore} = maskCodeRegions(text);
  assert.ok(!masked.includes('foo()'), 'fenced block should be hidden in masked text');
  assert.equal(restore(masked), text, 'restore should round-trip exactly');
});

test('maskCodeRegions: inline ``` inside backticks does NOT start a fence (the wikilink bug)', () => {
  const {maskCodeRegions, getTiddlerLinks} = loadRender();
  // This is the exact CodeRendererPlugin.md scenario: description prose has
  // an inline code span with triple backticks, then a wikilink, then later
  // a real fenced code block. The link MUST be visible to the wikilink
  // transform — otherwise it gets swallowed into a spurious mask.
  const text = [
    'wrapped in a ` ```javascript ` fenced code block.',
    '',
    'See [[ExampleScript]] for a live demo.',
    '',
    '# Code',
    '',
    '```javascript',
    'const x = 1;',
    '```',
  ].join('\n');
  const {masked} = maskCodeRegions(text);
  assert.ok(
    masked.includes('[[ExampleScript]]'),
    'wikilink must remain visible in the masked text',
  );
  const links = getTiddlerLinks(masked);
  assert.equal(links.length, 1);
  assert.equal(links[0][1], 'ExampleScript');
});

test('maskCodeRegions: restore does NOT corrupt digit runs in non-stashed content', () => {
  const {maskCodeRegions} = loadRender();
  // Macro output containing version-like digit runs used to be mangled by
  // the bare /(\d+)/g restore — each digit run was replaced with a stored
  // code block. PUA sentinels prevent that collision.
  const text = '- **version**: 0.0.1\n\n```\nx\n```\n';
  const {masked, restore} = maskCodeRegions(text);
  const restored = restore(masked);
  assert.ok(restored.includes('0.0.1'), 'version digits must survive restore intact');
  assert.equal(restored, text, 'full round-trip');
});
