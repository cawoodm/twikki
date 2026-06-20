import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync, rmSync, readFileSync, utimesSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {getType, getAutoTags, parseFile, compilePackage, fenceLang, expandIncludes, parseComposite} from '../../vite-plugin-tiddler-compile.js';

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

test('compilePackage: ignores hidden subdirs (.git, .DS_Store, etc.)', () => {
  const srcDir = join(tmpdir(), 'twikki-src-' + randomUUID());
  const outDir = join(tmpdir(), 'twikki-out-' + randomUUID());
  mkdirSync(srcDir);
  mkdirSync(outDir);
  try {
    // A hidden dir without the required <DirName>.md anchor would normally make
    // parseComposite throw — compilePackage must skip it instead.
    const ghost = join(srcDir, '.git');
    mkdirSync(ghost);
    writeFileSync(join(ghost, 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(srcDir, 'Real.tid'), 'hello\n');
    compilePackage('mypkg', srcDir, outDir);
    const result = JSON.parse(readFileSync(join(outDir, 'mypkg.json'), 'utf8'));
    assert.equal(result.tiddlers.length, 1);
    assert.equal(result.tiddlers[0].title, 'Real');
  } finally {
    rmSync(srcDir, {recursive: true});
    rmSync(outDir, {recursive: true});
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

test('fenceLang: maps fenceable extensions, returns empty for raw-inline extensions', () => {
  assert.equal(fenceLang('.js'), 'javascript');
  assert.equal(fenceLang('.css'), 'css');
  assert.equal(fenceLang('.json'), 'json');
  assert.equal(fenceLang('.html'), 'html');
  assert.equal(fenceLang('.md'), '');
  assert.equal(fenceLang('.tid'), '');
  assert.equal(fenceLang('.xyz'), '');
});

test('expandIncludes: substitutes [include](./X) with fenced block at the same position', () => {
  const dir = join(tmpdir(), 'twikki-test-' + randomUUID());
  mkdirSync(dir);
  try {
    writeFileSync(join(dir, 'Code.js'), '(function(){ return 1; })();\n');
    const text = '# Description\n\nProse.\n\n# Code\n[include](./Code.js)\n';
    const {text: out, includedPaths} = expandIncludes(text, dir);
    assert.ok(out.includes('# Code\n```javascript\n(function(){ return 1; })();\n```'));
    assert.ok(out.includes('# Description\n\nProse.'));
    assert.equal(includedPaths.length, 1);
  } finally {
    rmSync(dir, {recursive: true});
  }
});

test('expandIncludes: bare relative path (no ./) works too', () => {
  const dir = join(tmpdir(), 'twikki-test-' + randomUUID());
  mkdirSync(dir);
  try {
    writeFileSync(join(dir, 'a.css'), '.x { color: red; }\n');
    const {text: out} = expandIncludes('# StyleSheet\n[include](a.css)\n', dir);
    assert.ok(out.includes('```css\n.x { color: red; }\n```'));
  } finally {
    rmSync(dir, {recursive: true});
  }
});

test('expandIncludes: missing target throws', () => {
  const dir = join(tmpdir(), 'twikki-test-' + randomUUID());
  mkdirSync(dir);
  try {
    assert.throws(() => expandIncludes('[include](./nope.js)', dir), /not found/);
  } finally {
    rmSync(dir, {recursive: true});
  }
});

test('expandIncludes: path escape (../) throws', () => {
  const dir = join(tmpdir(), 'twikki-test-' + randomUUID());
  mkdirSync(dir);
  try {
    assert.throws(() => expandIncludes('[include](../escape.js)', dir), /must stay inside/);
  } finally {
    rmSync(dir, {recursive: true});
  }
});

test('expandIncludes: .md target is inlined raw (no fence)', () => {
  const dir = join(tmpdir(), 'twikki-test-' + randomUUID());
  mkdirSync(dir);
  try {
    writeFileSync(join(dir, 'notes.md'), '# Sub\n\nNested prose.\n');
    const {text: out} = expandIncludes('Before\n[include](./notes.md)\nAfter\n', dir);
    assert.ok(out.includes('Before\n# Sub\n\nNested prose.\nAfter'));
    assert.ok(!out.includes('```'));
  } finally {
    rmSync(dir, {recursive: true});
  }
});

test('parseComposite: builds one tiddler from md+js+css+json with title = dir name and type x-twikki', () => {
  const srcDir = join(tmpdir(), 'twikki-src-' + randomUUID());
  mkdirSync(srcDir);
  const pluginDir = join(srcDir, 'FooPlugin');
  mkdirSync(pluginDir);
  try {
    writeFileSync(join(pluginDir, 'FooPlugin.md'),
      'tags: $Plugin\n\n# Description\n\nProse.\n\n# Meta\n- version: 0.1.0\n\n# Data\n[include](./data.json)\n\n# Code\n[include](./Foo.js)\n\n# StyleSheet\n[include](./Foo.css)\n');
    writeFileSync(join(pluginDir, 'Foo.js'), '(function(){})();\n');
    writeFileSync(join(pluginDir, 'Foo.css'), '.foo { color: red; }\n');
    writeFileSync(join(pluginDir, 'data.json'), '{"version": "0.1.0"}\n');
    const t = parseComposite(pluginDir, 'demo');
    assert.equal(t.title, 'FooPlugin');
    assert.equal(t.type, 'x-twikki');
    assert.deepEqual(t.tags, ['$Plugin']);
    assert.ok(t.text.includes('# Code\n```javascript\n(function(){})();\n```'));
    assert.ok(t.text.includes('# StyleSheet\n```css\n.foo { color: red; }\n```'));
    assert.ok(t.text.includes('# Data\n```json\n{"version": "0.1.0"}\n```'));
    assert.ok(t.text.includes('# Meta\n- version: 0.1.0'));
    assert.ok(t.text.includes('# Description\n\nProse.'));
  } finally {
    rmSync(srcDir, {recursive: true});
  }
});

test('parseComposite: missing <DirName>.md throws', () => {
  const srcDir = join(tmpdir(), 'twikki-src-' + randomUUID());
  mkdirSync(srcDir);
  const pluginDir = join(srcDir, 'BarPlugin');
  mkdirSync(pluginDir);
  try {
    writeFileSync(join(pluginDir, 'Bar.js'), '');
    assert.throws(() => parseComposite(pluginDir, 'demo'), /requires BarPlugin\.md/);
  } finally {
    rmSync(srcDir, {recursive: true});
  }
});

test('parseComposite: base package gets $NoEdit auto-tag', () => {
  const srcDir = join(tmpdir(), 'twikki-src-' + randomUUID());
  mkdirSync(srcDir);
  const pluginDir = join(srcDir, 'BazPlugin');
  mkdirSync(pluginDir);
  try {
    writeFileSync(join(pluginDir, 'BazPlugin.md'), 'tags: $Plugin\n\n# Description\n\nx\n');
    const t = parseComposite(pluginDir, 'base');
    assert.deepEqual(t.tags.sort(), ['$NoEdit', '$Plugin']);
  } finally {
    rmSync(srcDir, {recursive: true});
  }
});

test('parseComposite: updated reflects newest mtime over md + included files', () => {
  const srcDir = join(tmpdir(), 'twikki-src-' + randomUUID());
  mkdirSync(srcDir);
  const pluginDir = join(srcDir, 'QuxPlugin');
  mkdirSync(pluginDir);
  try {
    writeFileSync(join(pluginDir, 'QuxPlugin.md'), 'tags: $Plugin\n\n# Code\n[include](./Qux.js)\n');
    writeFileSync(join(pluginDir, 'Qux.js'), '//\n');
    // Backdate the .md so the .js becomes the newest source.
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(pluginDir, 'QuxPlugin.md'), past, past);
    const t = parseComposite(pluginDir, 'demo');
    const jsMtime = statSync(join(pluginDir, 'Qux.js')).mtime.toISOString();
    assert.equal(t.updated, jsMtime);
  } finally {
    rmSync(srcDir, {recursive: true});
  }
});

test('compilePackage: mixed package (top-level file + composite subdir) emits both tiddlers', () => {
  const srcDir = join(tmpdir(), 'twikki-src-' + randomUUID());
  const outDir = join(tmpdir(), 'twikki-out-' + randomUUID());
  mkdirSync(srcDir);
  mkdirSync(outDir);
  const pluginDir = join(srcDir, 'MyPlugin');
  mkdirSync(pluginDir);
  try {
    writeFileSync(join(srcDir, 'Loose.tid'), 'Hello\n');
    writeFileSync(join(pluginDir, 'MyPlugin.md'), 'tags: $Plugin\n\n# Code\n[include](./My.js)\n');
    writeFileSync(join(pluginDir, 'My.js'), '/* hi */\n');
    compilePackage('mypkg', srcDir, outDir);
    const result = JSON.parse(readFileSync(join(outDir, 'mypkg.json'), 'utf8'));
    assert.equal(result.tiddlers.length, 2);
    const titles = result.tiddlers.map(t => t.title).sort();
    assert.deepEqual(titles, ['Loose', 'MyPlugin']);
    const composite = result.tiddlers.find(t => t.title === 'MyPlugin');
    assert.equal(composite.type, 'x-twikki');
    assert.ok(composite.text.includes('```javascript\n/* hi */\n```'));
  } finally {
    rmSync(srcDir, {recursive: true});
    rmSync(outDir, {recursive: true});
  }
});
