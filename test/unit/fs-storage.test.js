import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// The File System Access backend's pure helpers are extracted from the boot
// script by sentinel-comment regex and eval'd in isolation — the I/O shell
// around them needs a real browser FS, but these are deterministic and tested
// here without one (mirrors how idb-storage.test.js extracts `shouldPrompt`).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BOOT_PATH = join(ROOT, 'src/packages/base/FileSystemStoragePlugin/BootScript.js');
const BOOT_SRC = readFileSync(BOOT_PATH, 'utf8');

const H = (() => {
  const m = BOOT_SRC.match(/\/\* BEGIN pure-helpers[\s\S]*?\/\* END pure-helpers \*\//);
  if (!m) throw new Error('pure-helpers block not found — sentinel comments moved?');
  // eslint-disable-next-line no-new-func
  return new Function(m[0] + '\nreturn {extForType, typeForExt, hashStr, safeBaseName, packageFolder, serializeTiddler, parseTiddlerFile, routeKey, planFiles, diffPlan};')();
})();

test('extForType / typeForExt: known types map both ways', () => {
  const pairs = [
    ['x-twikki', '.tid'],
    ['markdown', '.md'],
    ['script/js', '.js'],
    ['json', '.json'],
    ['css', '.css'],
    ['html', '.html'],
  ];
  for (const [type, ext] of pairs) {
    assert.equal(H.extForType(type), ext);
    assert.equal(H.typeForExt(ext), type);
  }
  // Unknown type falls back to .tid / x-twikki.
  assert.equal(H.extForType('weird/thing'), '.tid');
  assert.equal(H.typeForExt('.bogus'), 'x-twikki');
});

test('safeBaseName: clean titles (incl. $ and spaces) round-trip unchanged', () => {
  assert.equal(H.safeBaseName('$MainLayout'), '$MainLayout');
  assert.equal(H.safeBaseName('My Daily Note'), 'My Daily Note');
  assert.equal(H.safeBaseName('readme-2.md notes'), 'readme-2.md notes');
});

test('safeBaseName: reserved chars are stripped and a hash suffix added', () => {
  const out = H.safeBaseName('Title::Section');
  assert.ok(!out.includes(':'), 'colon removed');
  assert.ok(out.includes('~'), 'lossy → hash suffix');
});

test('safeBaseName: deterministic, and distinct lossy titles do not collide', () => {
  assert.equal(H.safeBaseName('a/b'), H.safeBaseName('a/b'), 'deterministic');
  assert.notEqual(H.safeBaseName('a/b'), H.safeBaseName('a:b'), 'distinct titles → distinct names');
});

test('safeBaseName: Windows reserved device names get a hash suffix', () => {
  for (const name of ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT9', 'con', 'nul']) {
    const out = H.safeBaseName(name);
    assert.ok(out.includes('~'), `${name} → hash suffix added (got: ${out})`);
  }
  // A title that merely contains a reserved word but isn't one should be unaffected.
  assert.ok(!H.safeBaseName('console').includes('~'), 'console is not reserved');
});

test('packageFolder: falls back to _user when no package', () => {
  assert.equal(H.packageFolder({package: 'base'}), 'base');
  assert.equal(H.packageFolder({}), '_user');
  assert.equal(H.packageFolder(null), '_user');
});

test('serializeTiddler / parseTiddlerFile: round-trip incl. custom field + internal blank line', () => {
  const t = {
    title: 'My Note',
    text: '# Hi\n\nsecond paragraph',
    tags: ['a', 'b'],
    type: 'markdown',
    package: 'demo',
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-02T00:00:00.000Z',
    color: 'red',
  };
  const parsed = H.parseTiddlerFile(H.serializeTiddler(t), 'fallback', 'x-twikki');
  assert.equal(parsed.title, 'My Note');
  assert.equal(parsed.text, '# Hi\n\nsecond paragraph');
  assert.deepEqual(parsed.tags, ['a', 'b']);
  assert.equal(parsed.type, 'markdown');
  assert.equal(parsed.package, 'demo');
  assert.equal(parsed.created, '2026-01-01T00:00:00.000Z');
  assert.equal(parsed.color, 'red');
});

test('parseTiddlerFile: a body that starts with "key: value" is not misread as header', () => {
  const t = {title: 'X', type: 'markdown', text: 'foo: bar\nstill body'};
  const parsed = H.parseTiddlerFile(H.serializeTiddler(t), 'X', 'markdown');
  assert.equal(parsed.text, 'foo: bar\nstill body');
});

test('parseTiddlerFile: empty body round-trips to empty string', () => {
  const t = {title: 'Empty', type: 'markdown', text: ''};
  assert.equal(H.parseTiddlerFile(H.serializeTiddler(t), 'Empty', 'markdown').text, '');
});

test('serializeTiddler / parseTiddlerFile: multi-word tags survive the round-trip', () => {
  const t = {title: 'X', type: 'markdown', tags: ['My Project', 'todo'], text: 'body'};
  const parsed = H.parseTiddlerFile(H.serializeTiddler(t), 'X', 'markdown');
  assert.deepEqual(parsed.tags, ['My Project', 'todo']);
});

test('parseTiddlerFile: missing title/type fall back to filename/ext', () => {
  const parsed = H.parseTiddlerFile('just body, no header', 'FromFilename', 'markdown');
  assert.equal(parsed.title, 'FromFilename');
  assert.equal(parsed.type, 'markdown');
  assert.equal(parsed.text, 'just body, no header');
});

test('routeKey: tiddlers vs workspace-meta vs global', () => {
  assert.deepEqual(H.routeKey('/ws/default/tiddlers'), {kind: 'tiddlers', ws: 'default'});
  assert.deepEqual(H.routeKey('/ws/default/tiddlers-visible'), {kind: 'wsmeta', ws: 'default'});
  assert.deepEqual(H.routeKey('/workspaces'), {kind: 'global'});
  assert.deepEqual(H.routeKey('/settings.json'), {kind: 'global'});
});

test('planFiles: groups by package, picks extension by type, suffixes case-collisions', () => {
  const plan = H.planFiles([
    {title: 'Note A', type: 'markdown', package: 'demo'},
    {title: 'Note A', type: 'markdown'}, // no package → _user (different folder, no collision)
    {title: 'Foo', type: 'markdown'},
    {title: 'foo', type: 'markdown'}, // case-collision with Foo.md in _user
  ]);
  const byTitle = Object.fromEntries(plan.map(p => [p.title === 'Note A' ? p.path : p.title, p.path]));
  assert.equal(byTitle['demo/Note A.md'], 'demo/Note A.md');
  assert.equal(byTitle['_user/Note A.md'], '_user/Note A.md');
  assert.equal(byTitle.Foo, '_user/Foo.md');
  assert.ok(byTitle.foo.startsWith('_user/foo~') && byTitle.foo.endsWith('.md'), `collision suffixed: ${byTitle.foo}`);
});

test('diffPlan: writes new/changed/moved, deletes removed + moved-away', () => {
  const prev = new Map([
    ['A', {path: '_user/A.md', hash: 'h1'}],
    ['B', {path: '_user/B.md', hash: 'h2'}],
    ['C', {path: 'demo/C.md', hash: 'h3'}],
    ['E', {path: '_user/E.md', hash: 'h5'}],
  ]);
  const plan = [
    {title: 'A', path: '_user/A.md', hash: 'h1'}, // unchanged
    {title: 'B', path: '_user/B.md', hash: 'h2new'}, // changed
    {title: 'C', path: '_user/C.md', hash: 'h3'}, // moved demo → _user
    {title: 'D', path: '_user/D.md', hash: 'h4'}, // new
  ];
  const {writes, deletes} = H.diffPlan(prev, plan);
  assert.deepEqual(
    writes.map(w => w.title).sort(),
    ['B', 'C', 'D'],
  );
  assert.deepEqual(deletes.sort(), ['_user/E.md', 'demo/C.md']);
});

// ---------------------------------------------------------------------------
// shouldPrompt — pure predicate extracted from FileSystemStorageCode.js.
// ---------------------------------------------------------------------------
const CODE_PATH = join(ROOT, 'src/packages/base/FileSystemStoragePlugin/FileSystemStorageCode.js');
const CODE_SRC = readFileSync(CODE_PATH, 'utf8');
const SHOULD_PROMPT = (() => {
  const m = CODE_SRC.match(/\/\* BEGIN shouldPrompt[\s\S]*?\/\* END shouldPrompt \*\//);
  if (!m) throw new Error('shouldPrompt helper block not found — sentinel comments moved?');
  // eslint-disable-next-line no-new-func
  return new Function(m[0] + '\nreturn shouldPrompt;')();
})();

test('shouldPrompt: only prompts when installed, bundled differs, not snoozed, first this load', () => {
  assert.equal(SHOULD_PROMPT({installed: 'A', bundled: 'B', dismissedToday: false, sessionFlag: false}), true);
  assert.equal(SHOULD_PROMPT({installed: 'X', bundled: 'X', dismissedToday: false, sessionFlag: false}), false);
  assert.equal(SHOULD_PROMPT({installed: null, bundled: 'B', dismissedToday: false, sessionFlag: false}), false);
  assert.equal(SHOULD_PROMPT({installed: 'A', bundled: 'B', dismissedToday: true, sessionFlag: false}), false);
  assert.equal(SHOULD_PROMPT({installed: 'A', bundled: 'B', dismissedToday: false, sessionFlag: true}), false);
});
