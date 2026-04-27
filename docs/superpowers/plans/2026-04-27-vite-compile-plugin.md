# Vite Tiddler Compile Plugin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `ci/compile-packages.ps1` with `vite-plugin-tiddler-compile.js`, a self-contained Node.js Vite plugin that compiles tiddler source directories into JSON packages on all platforms.

**Architecture:** A single ESM file exports named functions (`getType`, `getAutoTags`, `parseFile`, `compilePackage`) for unit-testability, plus a default `tiddlerCompile(sourceSets)` factory that returns a Vite plugin with `buildStart` (full compile on start) and `configureServer` (per-package incremental compile on file change). A standalone CLI mode at the bottom of the file lets `npm run compile` call the same logic outside Vite.

**Tech Stack:** Node.js built-in `node:fs`, `node:path`, `node:url`; Vite 5 plugin API; `node:test` for unit tests.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `vite-plugin-tiddler-compile.js` | Create | All compile logic + Vite plugin + standalone CLI |
| `tests/unit/compile-plugin.test.js` | Create | Unit tests for the core compile functions |
| `vite.config.js` | Modify | Import and register the plugin, pass source sets |
| `package.json` | Modify | Update `compile` script from `pwsh` to `node` |
| `ci/compile-packages.ps1` | Delete | Replaced by the above |

---

### Task 1: Write failing unit tests

**Files:**
- Create: `tests/unit/compile-plugin.test.js`

- [ ] **Step 1: Create the test file**

```js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync, rmSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
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
  const dir = join(tmpdir(), 'twikki-test-' + Date.now());
  mkdirSync(dir);
  const filePath = join(dir, 'MyPlugin.js');
  writeFileSync(filePath, '(function() { return 1; })();\n');
  const t = parseFile(filePath, 'demo');
  assert.equal(t.title, 'MyPlugin');
  assert.equal(t.type, 'script/js');
  assert.equal(t.text, '(function() { return 1; })();');
  assert.deepEqual(t.tags, []);
  rmSync(dir, {recursive: true});
});

test('parseFile: metadata header followed by blank line then text', () => {
  const dir = join(tmpdir(), 'twikki-test-' + Date.now());
  mkdirSync(dir);
  const filePath = join(dir, 'MassDeleteDemo.tid');
  writeFileSync(filePath, 'tags: Demo\n\n<<manager.form>>\n');
  const t = parseFile(filePath, 'demo');
  assert.equal(t.title, 'MassDeleteDemo');
  assert.equal(t.type, 'x-twikki');
  assert.deepEqual(t.tags, ['Demo']);
  assert.equal(t.text, '<<manager.form>>');
  rmSync(dir, {recursive: true});
});

test('parseFile: auto-tags merged with metadata tags', () => {
  const dir = join(tmpdir(), 'twikki-test-' + Date.now());
  mkdirSync(dir);
  const filePath = join(dir, 'Display.tid');
  writeFileSync(filePath, 'tags: $Template\n\n<div>{{=title}}</div>\n');
  const t = parseFile(filePath, 'base');
  assert.deepEqual(t.tags, ['$NoEdit', '$Template']);
  rmSync(dir, {recursive: true});
});

test('compilePackage: writes JSON with correct tiddlers array', () => {
  const srcDir = join(tmpdir(), 'twikki-src-' + Date.now());
  const outDir = join(tmpdir(), 'twikki-out-' + Date.now());
  mkdirSync(srcDir);
  mkdirSync(outDir);
  writeFileSync(join(srcDir, 'Hello.js'), '(function(){})();\n');
  writeFileSync(join(srcDir, 'World.tid'), 'Hello world\n');
  compilePackage('mypkg', srcDir, outDir);
  const result = JSON.parse(readFileSync(join(outDir, 'mypkg.json'), 'utf8'));
  assert.ok(Array.isArray(result.tiddlers));
  assert.equal(result.tiddlers.length, 2);
  const titles = result.tiddlers.map(t => t.title).sort();
  assert.deepEqual(titles, ['Hello', 'World']);
  rmSync(srcDir, {recursive: true});
  rmSync(outDir, {recursive: true});
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
node --test tests/unit/compile-plugin.test.js
```

Expected: fails with `Cannot find module '../../vite-plugin-tiddler-compile.js'`

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/unit/compile-plugin.test.js
git commit -m "test: add failing tests for tiddler compile plugin"
```

---

### Task 2: Implement `vite-plugin-tiddler-compile.js`

**Files:**
- Create: `vite-plugin-tiddler-compile.js`

- [ ] **Step 1: Create the file**

```js
import {readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync} from 'node:fs';
import {join, extname, basename, normalize, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function getType(ext) {
  switch (ext) {
    case '.tid': return 'x-twikki';
    case '.md': return 'markdown';
    case '.js': return 'script/js';
    case '.json': return 'json';
    case '.css': return 'css';
    case '.html': return 'html';
    default: return '';
  }
}

export function getAutoTags(packageName, ext) {
  const tags = [];
  if (packageName === 'core.defaults') tags.push('$Shadow');
  if (packageName === 'base') tags.push('$NoEdit');
  if (ext === '.css') tags.push('$StyleSheet');
  return tags;
}

export function parseFile(filePath, packageName) {
  const ext = extname(filePath);
  const title = basename(filePath, ext);
  const stats = statSync(filePath);
  const tiddler = {
    title,
    text: '',
    tags: getAutoTags(packageName, ext),
    type: getType(ext),
    created: stats.birthtime.toISOString(),
    updated: stats.mtime.toISOString(),
  };

  const raw = readFileSync(filePath, 'utf8').replace(/\r/g, '');
  const lines = raw.split('\n');
  const textLines = [];
  let mode = 'meta';

  for (const line of lines) {
    if (mode === 'text') {
      textLines.push(line);
      continue;
    }
    if (/^[a-z]+: /.test(line)) {
      const colon = line.indexOf(':');
      const field = line.slice(0, colon).trim();
      let value = line.slice(colon + 1).trim();
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      if (field === 'tags') {
        const vals = String(value).split(',').map(v => v.trim()).filter(Boolean);
        tiddler.tags = [...tiddler.tags, ...vals];
      } else {
        tiddler[field] = value;
      }
    } else {
      mode = 'text';
      if (line) textLines.push(line);
    }
  }

  tiddler.text = textLines.join('\n');
  return tiddler;
}

export function compilePackage(packageName, sourceDir, outputDir) {
  if (!existsSync(outputDir)) mkdirSync(outputDir, {recursive: true});
  const files = readdirSync(sourceDir, {withFileTypes: true})
    .filter(e => e.isFile())
    .map(e => e.name);
  const tiddlers = files.map(name => parseFile(join(sourceDir, name), packageName));
  const outPath = join(outputDir, `${packageName}.json`);
  writeFileSync(outPath, JSON.stringify({tiddlers}, null, 2));
  console.log(`[tiddler-compile] Compiled ${packageName} → ${outPath} (${tiddlers.length} tiddlers)`);
  return tiddlers.length;
}

function compileAll(sourceSets) {
  for (const {sourceRoot, outputDir} of sourceSets) {
    if (!existsSync(sourceRoot)) continue;
    const entries = readdirSync(sourceRoot, {withFileTypes: true}).filter(e => e.isDirectory());
    for (const entry of entries) {
      compilePackage(entry.name, join(sourceRoot, entry.name), outputDir);
    }
  }
}

function findPackageForFile(filePath, sourceSets) {
  const norm = normalize(filePath);
  for (const {sourceRoot, outputDir} of sourceSets) {
    const root = normalize(sourceRoot);
    if (norm.startsWith(root + '\\') || norm.startsWith(root + '/')) {
      const rel = norm.slice(root.length + 1);
      const packageName = rel.split(/[\\/]/)[0];
      return {packageName, sourceDir: join(sourceRoot, packageName), outputDir};
    }
  }
  return null;
}

export default function tiddlerCompile(sourceSets) {
  return {
    name: 'tiddler-compile',
    buildStart() {
      compileAll(sourceSets);
    },
    configureServer(server) {
      const handler = (filePath) => {
        const info = findPackageForFile(filePath, sourceSets);
        if (!info) return;
        compilePackage(info.packageName, info.sourceDir, info.outputDir);
      };
      server.watcher.on('change', handler);
      server.watcher.on('add', handler);
      server.watcher.on('unlink', handler);
    },
  };
}

// Standalone CLI: node vite-plugin-tiddler-compile.js
if (resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const root = fileURLToPath(new URL('.', import.meta.url));
  compileAll([
    {sourceRoot: join(root, 'src/packages'), outputDir: join(root, 'public/packages')},
    {sourceRoot: join(root, 'src/modules'), outputDir: join(root, 'public/modules')},
  ]);
}
```

- [ ] **Step 2: Run the unit tests**

```
node --test tests/unit/compile-plugin.test.js
```

Expected: all 8 tests pass with output like:
```
▶ getType maps extensions to tiddler types
  ✔ getType maps extensions to tiddler types (Xms)
...
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

- [ ] **Step 3: Run the standalone compile and verify output**

```
node vite-plugin-tiddler-compile.js
```

Expected: one `[tiddler-compile] Compiled ...` line per package (base, demo, icons, etc.), no errors.

Check `public/packages/base.json` — confirm:
- Top-level key is `"tiddlers"` with an array value
- `$BackupPlugin` entry has `"type": "script/js"` and `"tags": ["$NoEdit"]`
- `Backup` entry has `"type": "x-twikki"`

- [ ] **Step 4: Commit**

```bash
git add vite-plugin-tiddler-compile.js tests/unit/compile-plugin.test.js
git commit -m "feat: add vite-plugin-tiddler-compile replacing PowerShell compile script"
```

---

### Task 3: Register the plugin in `vite.config.js`

**Files:**
- Modify: `vite.config.js`

- [ ] **Step 1: Replace the contents of `vite.config.js`**

```js
import {defineConfig} from 'vite';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import tiddlerCompile from './vite-plugin-tiddler-compile.js';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  base: '/',
  build: {
    outDir: '../dist',
    minify: false,
  },
  server: {
    port: 3002,
    open: true,
    host: true,
  },
  plugins: [
    tiddlerCompile([
      {sourceRoot: join(root, 'src/packages'), outputDir: join(root, 'public/packages')},
      {sourceRoot: join(root, 'src/modules'), outputDir: join(root, 'public/modules')},
    ]),
    {
      name: 'reload',
      configureServer(server) {
        const {ws, watcher} = server;
        watcher.on('change', file => {
          if (file.endsWith('.json')) {
            ws.send({type: 'full-reload'});
          }
        });
      },
    },
  ],
});
```

- [ ] **Step 2: Start the dev server and verify auto-compile fires on startup**

```
npm run dev
```

Expected: `[tiddler-compile] Compiled base → ...` lines appear before the Vite ready message. Open the browser — tiddlers load without errors in the console.

- [ ] **Step 3: Verify incremental recompile on file save**

Edit `src/packages/demo/$FavoritesPlugin.js` — add a comment on line 1 (`// test`), save. Expected: the terminal shows `[tiddler-compile] Compiled demo → ...` and the browser reloads.

Revert the test change.

- [ ] **Step 4: Commit**

```bash
git add vite.config.js
git commit -m "feat: register tiddler-compile plugin in vite.config"
```

---

### Task 4: Update `package.json` and remove the PowerShell script

**Files:**
- Modify: `package.json`
- Delete: `ci/compile-packages.ps1`

- [ ] **Step 1: Update the `compile` script in `package.json`**

Change line 8 from:
```json
"compile": "pwsh ci/Compile-Packages.ps1",
```
to:
```json
"compile": "node vite-plugin-tiddler-compile.js",
```

- [ ] **Step 2: Verify `npm run compile` works**

```
npm run compile
```

Expected: `[tiddler-compile] Compiled ...` lines for all packages, process exits cleanly with code 0.

- [ ] **Step 3: Delete the PowerShell script**

```bash
git rm ci/compile-packages.ps1
```

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: update compile script to node, remove PowerShell compile script"
```
