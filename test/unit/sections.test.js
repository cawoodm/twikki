import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {parseFile} from '../../vite-plugin-tiddler-compile.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

// Load the runtime module the way the platform does: eval the file (a
// parenthesised factory function) and read its exports. This keeps the module
// free of ESM import/export (per the eval-based runtime module contract) while
// still being unit-testable.
const code = readFileSync(join(root, 'src/modules/core.sections.js'), 'utf8');
const {parseSections, getSection, fenceToType} = (0, eval)('(' + code.replace('export default ', '') + ')')().exports;

test('fenceToType maps info-strings to tiddler types', () => {
  assert.equal(fenceToType('css'), 'css');
  assert.equal(fenceToType('js'), 'script/js');
  assert.equal(fenceToType('javascript'), 'script/js');
  assert.equal(fenceToType('json'), 'json');
  assert.equal(fenceToType('html'), 'html/template');
  assert.equal(fenceToType('md'), 'markdown');
  assert.equal(fenceToType('markdown'), 'markdown');
  assert.equal(fenceToType('x-twikki'), 'x-twikki');
  assert.equal(fenceToType('keyval'), 'keyval');
  assert.equal(fenceToType('CSS'), 'css', 'case-insensitive');
  assert.equal(fenceToType('weirdlang'), 'weirdlang', 'unknown used verbatim');
  assert.equal(fenceToType(''), null, 'bare fence → inherit (null)');
  assert.equal(fenceToType(undefined), null);
});

test('parseSections splits preamble + sections and types fenced bodies', () => {
  const text = [
    'A nice intro',
    '',
    '# Code',
    '```js',
    'const x = 1;',
    '```',
    '',
    '# Notes',
    'just prose here',
  ].join('\n');
  const {preamble, order, sections} = parseSections(text);
  assert.equal(preamble, 'A nice intro');
  assert.deepEqual(order, ['Code', 'Notes']);
  assert.equal(sections.code.type, 'script/js');
  assert.equal(sections.code.text, 'const x = 1;');
  assert.equal(sections.notes.type, null, 'unfenced prose → null (inherit parent)');
  assert.equal(sections.notes.text, 'just prose here');
});

test('parseSections parses leading per-section metadata (tags, type)', () => {
  const text = [
    '# AuroraStyleSheet',
    'tags: $StyleSheet',
    '```css',
    ':root { --x: 1px; }',
    '```',
  ].join('\n');
  const sec = getSection(text, 'AuroraStyleSheet');
  assert.deepEqual(sec.tags, ['$StyleSheet']);
  assert.equal(sec.type, 'css');
  assert.equal(sec.text, ':root { --x: 1px; }', 'fence + meta stripped');
});

test('explicit type: meta is used when there is no fence', () => {
  const sec = getSection('# Data\ntype: json\n{"a":1}', 'Data');
  assert.equal(sec.type, 'json');
  assert.equal(sec.text, '{"a":1}');
  assert.equal('type' in sec, true);
});

test('# inside a fenced block is not a section boundary', () => {
  const text = [
    '# A',
    '```md',
    '# inside the fence',
    '```',
    '# B',
    'text',
  ].join('\n');
  const {order, sections} = parseSections(text);
  assert.deepEqual(order, ['A', 'B'], 'fenced # is not a heading');
  assert.equal(sections.a.type, 'markdown');
  assert.equal(sections.a.text, '# inside the fence');
  assert.equal(sections.b.text, 'text');
});

test('getSection is case-insensitive and returns null for misses', () => {
  const text = '# StyleSheet\n```css\na{}\n```';
  assert.equal(getSection(text, 'stylesheet').type, 'css');
  assert.equal(getSection(text, 'STYLESHEET').type, 'css');
  assert.equal(getSection(text, 'nope'), null);
  assert.equal(getSection(text, ''), null);
  assert.equal(getSection('', 'x'), null);
});

test('duplicate section names: last wins, order keeps one entry', () => {
  const text = '# S\nfirst\n# S\n```css\nsecond{}\n```';
  const {order, sections} = parseSections(text);
  assert.deepEqual(order, ['S']);
  assert.equal(sections.s.type, 'css');
  assert.equal(sections.s.text, 'second{}');
});

test('integration: real Aurora theme tiddler compiles + parses into a usable theme', () => {
  const tid = parseFile(join(root, 'src/packages/themes/AuroraTheme.tid'), 'themes');
  assert.equal(tid.type, 'x-twikki');
  assert.ok(tid.tags.includes('$Theme'), 'parent carries a real $Theme tag (so it lists in the selector)');

  const css = getSection(tid.text, 'AuroraPalette');
  assert.ok(css, 'AuroraPalette section exists');
  assert.equal(css.type, 'css');
  assert.ok(css.text.startsWith(':root'), 'CSS extracted without fence/meta');
  assert.ok(!css.text.includes('```'), 'no fence markers leak into the CSS');
  assert.ok(css.text.includes('* {'), 'the universal selector survives inside the section');
});
