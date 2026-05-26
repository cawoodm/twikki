import {readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync} from 'node:fs';
import {join, extname, basename, resolve, relative, isAbsolute} from 'node:path';
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

  // Remove trailing empty lines
  while (textLines.length && textLines[textLines.length - 1] === '') textLines.pop();
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
  for (const {sourceRoot, outputDir} of sourceSets) {
    const rel = relative(sourceRoot, filePath);
    if (!rel.startsWith('..') && !isAbsolute(rel)) {
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
      for (const {sourceRoot} of sourceSets) {
        server.watcher.add(sourceRoot);
      }
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
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const root = process.cwd();
  compileAll([
    {sourceRoot: join(root, 'src/packages'), outputDir: join(root, 'public/packages')},
    {sourceRoot: join(root, 'src/modules'), outputDir: join(root, 'public/modules')},
  ]);
}
