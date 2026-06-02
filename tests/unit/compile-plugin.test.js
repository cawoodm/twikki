import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync, rmSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {getType, getAutoTags, parseFile, compilePackage} from '../../vite-plugin-tiddler-compile.js';

test('getType maps extensions to tiddler types', () => {
  assert.equal(getType('.js'), 'script/js');
  assert.equal(getType('.css'), 'css');
  assert.equal(getType('.tid'), 'x-twikki');
  assert.equal(getType('.md'), 'markdown');
  assert.equal(getType('.json'), 'json');
  assert.equal(getType('.html'), 'html');
  assert.equal(getType('.xyz'), '');
});

test('getAutoTags: base package gets $NoEdit', () => {
  assert.deepEqual(getAutoTags('base', '.js'), ['$NoEdit']);
});

test('getAutoTags: core.defaults package gets $Shadow', () => {
  assert.deepEqual(getAutoTags('core.defaults', '.js'), ['$Shadow']);
});

test('getAutoTags: .css files get $StyleSheet', () => {
  assert.deepEqual(getAutoTags('demo', '.css'), ['$StyleSheet']);
});

test('getAutoTags: base + css combines both tags', () => {
  assert.deepEqual(getAutoTags('base', '.css'), ['$NoEdit', '$StyleSheet']);
});

test('parseFile: no metadata header — full file is text', () => {
  const dir = join(tmpdir(), 'twikki-test-' + randomUUID());
  mkdirSync(dir);
  try {
    const filePath = join(dir, 'MyPlugin.js');
    writeFileSync(filePath, '(function() { return 1; })();\n');
    const t = parseFile(filePath, 'demo');
    assert.equal(t.title, 'MyPlugin');
    assert.equal(t.type, 'script/js');
    assert.equal(t.text, '(function() { return 1; })();');
    assert.deepEqual(t.tags, []);
  } finally {
    rmSync(dir, {recursive: true});
  }
});

test('parseFile: metadata header followed by blank line then text', () => {
  const dir = join(tmpdir(), 'twikki-test-' + randomUUID());
  mkdirSync(dir);
  try {
    const filePath = join(dir, 'MassDeleteDemo.tid');
    writeFileSync(filePath, 'tags: Demo\n\n<<manager.form>>\n');
    const t = parseFile(filePath, 'demo');
    assert.equal(t.title, 'MassDeleteDemo');
    assert.equal(t.type, 'x-twikki');
    assert.deepEqual(t.tags, ['Demo']);
    assert.equal(t.text, '<<manager.form>>');
  } finally {
    rmSync(dir, {recursive: true});
  }
});

test('parseFile: auto-tags merged with metadata tags', () => {
  const dir = join(tmpdir(), 'twikki-test-' + randomUUID());
  mkdirSync(dir);
  try {
    const filePath = join(dir, 'Display.tid');
    writeFileSync(filePath, 'tags: $Template\n\n<div>{{=title}}</div>\n');
    const t = parseFile(filePath, 'base');
    assert.deepEqual(t.tags, ['$NoEdit', '$Template']);
  } finally {
    rmSync(dir, {recursive: true});
  }
});

test('parseFile: .json with // tags header is tagged and the comment line is stripped (valid JSON)', () => {
  const dir = join(tmpdir(), 'twikki-test-' + randomUUID());
  mkdirSync(dir);
  try {
    const filePath = join(dir, '$GeneralSettings.json');
    writeFileSync(filePath, '// tags: $NoSynch $NoBackup\n{\n  "a": 1\n}\n');
    const t = parseFile(filePath, 'demo');
    assert.equal(t.type, 'json');
    assert.deepEqual(t.tags, ['$NoSynch', '$NoBackup']);
    assert.equal(t.text, '{\n  "a": 1\n}');
    assert.doesNotThrow(() => JSON.parse(t.text)); // body must remain valid JSON
  } finally {
    rmSync(dir, {recursive: true});
  }
});

test('parseFile: .js with // tags header is tagged and the comment line is stripped', () => {
  const dir = join(tmpdir(), 'twikki-test-' + randomUUID());
  mkdirSync(dir);
  try {
    const filePath = join(dir, 'MyPlugin.js');
    writeFileSync(filePath, '// tags: $Shadow\n(function(tw){})(tw);\n');
    const t = parseFile(filePath, 'demo');
    assert.equal(t.type, 'script/js');
    assert.deepEqual(t.tags, ['$Shadow']);
    assert.equal(t.text, '(function(tw){})(tw);');
  } finally {
    rmSync(dir, {recursive: true});
  }
});

test('parseFile: // tags header in core.defaults dedupes the auto-added $Shadow', () => {
  const dir = join(tmpdir(), 'twikki-test-' + randomUUID());
  mkdirSync(dir);
  try {
    const filePath = join(dir, '$GeneralSettings.json');
    writeFileSync(filePath, '// tags: $Shadow $NoSynch $NoBackup\n{}\n');
    const t = parseFile(filePath, 'core.defaults');
    assert.deepEqual(t.tags, ['$Shadow', '$NoSynch', '$NoBackup']);
    assert.equal(t.text, '{}');
  } finally {
    rmSync(dir, {recursive: true});
  }
});

test('parseFile: .tid comma-separated tags still parse (regression)', () => {
  const dir = join(tmpdir(), 'twikki-test-' + randomUUID());
  mkdirSync(dir);
  try {
    const filePath = join(dir, 'ObsidianThemeDark.tid');
    writeFileSync(filePath, 'tags: $Theme, $ThemeDark\n\n* [[$StyleSheetCore]]\n');
    const t = parseFile(filePath, 'demo');
    assert.deepEqual(t.tags, ['$Theme', '$ThemeDark']);
    assert.equal(t.text, '* [[$StyleSheetCore]]');
  } finally {
    rmSync(dir, {recursive: true});
  }
});

test('parseFile: .html block HTML-comment frontmatter is parsed and consumed', () => {
  const dir = join(tmpdir(), 'twikki-test-' + randomUUID());
  mkdirSync(dir);
  try {
    const filePath = join(dir, '$MainLayout.html');
    writeFileSync(filePath, '<!--\ntype: html/template\ntags: $Template\n-->\n\n<div>{{=title}}</div>\n');
    const t = parseFile(filePath, 'core.defaults');
    assert.equal(t.type, 'html/template');
    assert.deepEqual(t.tags, ['$Shadow', '$Template']);
    assert.equal(t.text, '<div>{{=title}}</div>');
  } finally {
    rmSync(dir, {recursive: true});
  }
});

test('parseFile: indented HTML-comment frontmatter (formatter-style) still parses', () => {
  const dir = join(tmpdir(), 'twikki-test-' + randomUUID());
  mkdirSync(dir);
  try {
    const filePath = join(dir, 'Layout.html');
    writeFileSync(filePath, '<!--\n  type: html/template\n  tags: $Template\n-->\n\n<div></div>\n');
    const t = parseFile(filePath, 'demo');
    assert.equal(t.type, 'html/template');
    assert.deepEqual(t.tags, ['$Template']);
    assert.equal(t.text, '<div></div>');
  } finally {
    rmSync(dir, {recursive: true});
  }
});

test('parseFile: single-line HTML-comment frontmatter is parsed and consumed', () => {
  const dir = join(tmpdir(), 'twikki-test-' + randomUUID());
  mkdirSync(dir);
  try {
    const filePath = join(dir, 'Widget.html');
    writeFileSync(filePath, '<!-- tags: $Template -->\n\n<div></div>\n');
    const t = parseFile(filePath, 'demo');
    assert.deepEqual(t.tags, ['$Template']);
    assert.equal(t.text, '<div></div>');
  } finally {
    rmSync(dir, {recursive: true});
  }
});

test('compilePackage: ignores files with unknown extensions (e.g. atomic-save temp files)', () => {
  const srcDir = join(tmpdir(), 'twikki-src-' + randomUUID());
  const outDir = join(tmpdir(), 'twikki-out-' + randomUUID());
  mkdirSync(srcDir);
  mkdirSync(outDir);
  try {
    writeFileSync(join(srcDir, 'Real.tid'), 'hello\n');
    writeFileSync(join(srcDir, 'Real.tid.tmp.34512.deadbeef'), 'transient garbage\n');
    compilePackage('mypkg', srcDir, outDir);
    const result = JSON.parse(readFileSync(join(outDir, 'mypkg.json'), 'utf8'));
    assert.equal(result.tiddlers.length, 1);
    assert.equal(result.tiddlers[0].title, 'Real');
  } finally {
    rmSync(srcDir, {recursive: true});
    rmSync(outDir, {recursive: true});
  }
});

test('compilePackage: writes JSON with correct tiddlers array', () => {
  const srcDir = join(tmpdir(), 'twikki-src-' + randomUUID());
  const outDir = join(tmpdir(), 'twikki-out-' + randomUUID());
  mkdirSync(srcDir);
  mkdirSync(outDir);
  try {
    writeFileSync(join(srcDir, 'Hello.js'), '(function(){})();\n');
    writeFileSync(join(srcDir, 'World.tid'), 'Hello world\n');
    compilePackage('mypkg', srcDir, outDir);
    const result = JSON.parse(readFileSync(join(outDir, 'mypkg.json'), 'utf8'));
    assert.ok(Array.isArray(result.tiddlers));
    assert.equal(result.tiddlers.length, 2);
    const titles = result.tiddlers.map(t => t.title).sort();
    assert.deepEqual(titles, ['Hello', 'World']);
  } finally {
    rmSync(srcDir, {recursive: true});
    rmSync(outDir, {recursive: true});
  }
});
