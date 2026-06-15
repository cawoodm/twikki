import {existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {basename, extname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function getType(ext) {
  switch (ext) {
    case '.tid':
      return 'x-twikki';
    case '.md':
      return 'markdown';
    case '.js':
      return 'script/js';
    case '.json':
      return 'json';
    case '.css':
      return 'css';
    case '.html':
      return 'html';
    case '.csv':
      return 'csv';
    default:
      return '';
  }
}

// Fence language for `[include]` substitution. Falls back to '' for extensions
// that should be inlined raw (e.g. .md — including markdown into markdown).
export function fenceLang(ext) {
  switch (ext) {
    case '.js':
      return 'javascript';
    case '.css':
      return 'css';
    case '.json':
      return 'json';
    case '.html':
      return 'html';
    default:
      return '';
  }
}

export function getAutoTags(packageName, ext) {
  const tags = [];
  if (packageName === 'core.defaults') tags.push('$Shadow');
  // TODO: Why are we blocking edits here?
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
      const vals = String(value)
        .split(/[,\s]+/)
        .map(v => v.trim())
        .filter(Boolean);
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
    const metaLine = line
      .replace(/^\s*<!--\s*/, '')
      .replace(/\s*-->\s*$/, '')
      .replace(/^\/\/\s*/, '');
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

// Substitute every `[include](./X)` (or `[include](X)`) line in the markdown
// anchor with the file's contents, wrapped in a fenced code block whose
// language comes from the file extension (.js→javascript, .css→css, .json→json,
// .html→html). Extensions with no fence language (.md, etc.) are inlined raw.
// Returns the rewritten text + the list of absolute paths that were included
// (so callers can fold their mtime into the tiddler's `updated` field).
export function expandIncludes(text, dirPath) {
  const includedPaths = [];
  const out = text.replace(/\[include\]\((?:\.\/)?([^)]+)\)/g, (_, relPath) => {
    if (relPath.includes('..')) {
      throw new Error(`include path "${relPath}" must stay inside the plugin dir`);
    }
    const absPath = join(dirPath, relPath);
    if (!existsSync(absPath)) {
      throw new Error(`include "${relPath}" not found in ${dirPath}`);
    }
    includedPaths.push(absPath);
    const content = readFileSync(absPath, 'utf8').replace(/\r/g, '').trimEnd();
    const lang = fenceLang(extname(relPath));
    return lang ? '```' + lang + '\n' + content + '\n```' : content;
  });
  return {text: out, includedPaths};
}

// Parse a composite plugin directory: <dirName>/<dirName>.md is the anchor
// (carries metadata header + section skeleton + [include] lines); siblings
// like Code.js / StyleSheet.css / data.json are inlined where their [include]
// references appear. The compiled tiddler's title is the directory name, and
// its `.text` is multi-section markdown that core.sections.js parses normally.
export function parseComposite(dirPath, packageName) {
  const dirName = basename(dirPath);
  const mdPath = join(dirPath, `${dirName}.md`);
  if (!existsSync(mdPath)) {
    throw new Error(`composite plugin "${dirName}" requires ${dirName}.md`);
  }
  const tiddler = parseFile(mdPath, packageName);
  tiddler.title = dirName;
  tiddler.type = 'x-twikki';
  const {text, includedPaths} = expandIncludes(tiddler.text, dirPath);
  tiddler.text = text;
  // `updated` should reflect the newest source file, not just the .md anchor —
  // editing Code.js must bump the tiddler's mtime so downstream caches refresh.
  let newest = statSync(mdPath).mtime;
  for (const p of includedPaths) {
    const m = statSync(p).mtime;
    if (m > newest) newest = m;
  }
  tiddler.updated = newest.toISOString();
  return tiddler;
}

export function compilePackage(packageName, sourceDir, outputDir) {
  if (!existsSync(outputDir)) mkdirSync(outputDir, {recursive: true});
  const entries = readdirSync(sourceDir, {withFileTypes: true});
  const files = entries
    .filter(e => e.isFile())
    .map(e => e.name)
    .filter(name => getType(extname(name)) !== ''); // skip temp/non-tiddler files (e.g. atomic-save *.tmp.*)
  // Skip hidden / system directories (.git, .DS_Store, .idea, .vscode, …). They are
  // never composite plugin sources; without this filter parseComposite would throw
  // "missing <DirName>.md" the moment such a dir lands inside a package.
  const subdirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);
  const fromFiles = files.map(name => {
    try {
      return parseFile(join(sourceDir, name), packageName);
    } catch (err) {
      if (err.code === 'ENOENT') return null; // file vanished mid-compile (atomic-save race)
      throw err;
    }
  });
  const fromDirs = subdirs.map(name => {
    try {
      return parseComposite(join(sourceDir, name), packageName);
    } catch (err) {
      if (err.code === 'ENOENT') return null; // file vanished mid-compile (watcher race)
      throw err;
    }
  });
  const tiddlers = [...fromFiles, ...fromDirs].filter(Boolean);
  const outPath = join(outputDir, `${packageName}.json`);
  writeFileSync(outPath, JSON.stringify({tiddlers}, null, 2));
  console.log(
    `[tiddler-compile] Compiled ${packageName} → ${outPath} (${tiddlers.length} tiddlers)`,
  );
  return tiddlers.length;
}

function compileAll(sourceSets) {
  for (const {sourceRoot, outputDir} of sourceSets) {
    if (!existsSync(sourceRoot)) throw new Error(`sourceRoot "${sourceRoot}" does not exist!`);
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
      const parts = rel.split(/[\\/]/);
      if (parts.length < 2) continue; // top-level file (e.g. core.search.js) — served as-is, no compile step
      const packageName = parts[0];
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
      const handler = filePath => {
        if (getType(extname(filePath)) === '') return; // ignore temp/non-tiddler files
        const info = findPackageForFile(filePath, sourceSets);
        if (!info) return;
        try {
          compilePackage(info.packageName, info.sourceDir, info.outputDir);
        } catch (err) {
          console.warn(
            `[tiddler-compile] Recompile of ${info.packageName} skipped: ${err.message}`,
          );
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
