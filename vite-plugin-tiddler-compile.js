import {existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {basename, extname, isAbsolute, join, relative, resolve} from 'node:path';
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

// The four core stylesheet layers are assigned by filename: a .css file with one
// of these titles is tagged for its cascade layer ($CoreThemeManager collects the
// layers by tag). Any other .css file is a plain $StyleSheet (theme-layer content).
const LAYER_TAGS = {
  $Reset: '$LayerReset',
  $Structure: '$LayerStructure',
  $Tokens: '$LayerTokens',
  $Components: '$LayerComponents',
};

export function getAutoTags(packageName, ext, title) {
  const tags = [];
  if (packageName === 'core.defaults') tags.push('$Shadow');
  if (packageName === 'base') tags.push('$NoEdit');
  if (ext === '.css') {
    tags.push('$StyleSheet');
    if (LAYER_TAGS[title]) tags.push(LAYER_TAGS[title]);
  }
  return tags;
}

export function parseFile(filePath, packageName) {
  const ext = extname(filePath);
  const title = basename(filePath, ext);
  const stats = statSync(filePath);
  const tiddler = {
    title,
    text: '',
    tags: getAutoTags(packageName, ext, title),
    type: getType(ext),
    created: stats.birthtime.toISOString(),
    updated: stats.mtime.toISOString(),
  };

  const raw = readFileSync(filePath, 'utf8').replace(/\r/g, '');
  const lines = raw.split('\n');
  const textLines = [];
  let mode = 'meta';
  let inHtmlComment = false;

  // Apply one `field: value` metadata line to the tiddler. `tags:` is split on
  // commas and/or whitespace (matching the runtime's own tag parsing); `true`/
  // `false` are coerced to booleans; any other field becomes a top-level field.
  const applyMeta = metaLine => {
    const colon = metaLine.indexOf(':');
    const field = metaLine.slice(0, colon).trim();
    let value = metaLine.slice(colon + 1).trim();
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    if (field === 'tags') {
      const vals = String(value).split(/[,\s]+/).map(v => v.trim()).filter(Boolean);
      tiddler.tags = [...tiddler.tags, ...vals];
    } else {
      tiddler[field] = value;
    }
  };

  for (const line of lines) {
    if (mode === 'text') {
      textLines.push(line);
      continue;
    }
    // Inside a leading `<!-- … -->` HTML-comment frontmatter block: parse `field: value`
    // lines (trimmed, so a formatter that indents the comment body is fine) until `-->`.
    // The whole block is consumed (not emitted into text). Used by .html sources whose
    // bare leading lines a formatter would otherwise reflow/squash together.
    if (inHtmlComment) {
      const trimmed = line.trim();
      if (trimmed === '-->') inHtmlComment = false;
      else if (/^[a-z]+: /.test(trimmed)) applyMeta(trimmed);
      continue;
    }
    if (line.trim() === '<!--') {
      inHtmlComment = true;
      continue;
    }
    // A leading metadata line is `field: value`, optionally behind a `//` comment (so
    // .js/.json sources can declare tags, e.g. `// tags: $Shadow`) or a single-line HTML
    // comment (`<!-- tags: $Template -->`). The comment markers are consumed, keeping
    // .json bodies valid.
    const metaLine = line.replace(/^\s*<!--\s*/, '').replace(/\s*-->\s*$/, '').replace(/^\/\/\s*/, '');
    if (/^[a-z]+: /.test(metaLine)) {
      applyMeta(metaLine);
    } else {
      mode = 'text';
      if (line) textLines.push(line);
    }
  }

  // Remove trailing empty lines
  while (textLines.length && textLines[textLines.length - 1] === '') textLines.pop();
  tiddler.text = textLines.join('\n');
  tiddler.tags = [...new Set(tiddler.tags)]; // dedupe (auto-tag may repeat a header tag)
  return tiddler;
}

export function compilePackage(packageName, sourceDir, outputDir) {
  if (!existsSync(outputDir)) mkdirSync(outputDir, {recursive: true});
  const files = readdirSync(sourceDir, {withFileTypes: true})
    .filter(e => e.isFile())
    .map(e => e.name)
    .filter(name => getType(extname(name)) !== ''); // skip temp/non-tiddler files (e.g. atomic-save *.tmp.*)
  const tiddlers = files
    .map(name => {
      try {
        return parseFile(join(sourceDir, name), packageName);
      } catch (err) {
        if (err.code === 'ENOENT') return null; // file vanished mid-compile (atomic-save race)
        throw err;
      }
    })
    .filter(Boolean);
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
        if (getType(extname(filePath)) === '') return; // ignore temp/non-tiddler files
        const info = findPackageForFile(filePath, sourceSets);
        if (!info) return;
        try {
          compilePackage(info.packageName, info.sourceDir, info.outputDir);
        } catch (err) {
          console.warn(`[tiddler-compile] Recompile of ${info.packageName} skipped: ${err.message}`);
        }
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
