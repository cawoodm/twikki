// One-shot importer: downloads the World English Bible (WEB) per chapter from
// bolls.life and generates per-chapter / per-book / overview .tid files under
// src/packages/bible/. Re-runnable: caches raw JSON under scripts/bible-cache/
// so reruns don't re-download. Idempotent — overwrites generated files
// deterministically. Not wired into npm scripts; run manually:
//   node scripts/import-bible.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, 'scripts', 'tmp'); // Cache of bible files
const OUT_DIR = path.join(ROOT, 'src', 'packages', 'bible');
const SOURCE_BASE = 'https://bolls.life/get-chapter/WEB';
const CONCURRENCY = 5;
const MAX_RETRIES = 4;

// Protestant 66-book canon in canonical order with chapter counts. bolls.life
// book IDs are 1..66 matching this order.
const BOOKS = [
  ['Genesis', 50],
  ['Exodus', 40],
  ['Leviticus', 27],
  ['Numbers', 36],
  ['Deuteronomy', 34],
  ['Joshua', 24],
  ['Judges', 21],
  ['Ruth', 4],
  ['1 Samuel', 31],
  ['2 Samuel', 24],
  ['1 Kings', 22],
  ['2 Kings', 25],
  ['1 Chronicles', 29],
  ['2 Chronicles', 36],
  ['Ezra', 10],
  ['Nehemiah', 13],
  ['Esther', 10],
  ['Job', 42],
  ['Psalms', 150],
  ['Proverbs', 31],
  ['Ecclesiastes', 12],
  ['Song of Solomon', 8],
  ['Isaiah', 66],
  ['Jeremiah', 52],
  ['Lamentations', 5],
  ['Ezekiel', 48],
  ['Daniel', 12],
  ['Hosea', 14],
  ['Joel', 3],
  ['Amos', 9],
  ['Obadiah', 1],
  ['Jonah', 4],
  ['Micah', 7],
  ['Nahum', 3],
  ['Habakkuk', 3],
  ['Zephaniah', 3],
  ['Haggai', 2],
  ['Zechariah', 14],
  ['Malachi', 4],
  ['Matthew', 28],
  ['Mark', 16],
  ['Luke', 24],
  ['John', 21],
  ['Acts', 28],
  ['Romans', 16],
  ['1 Corinthians', 16],
  ['2 Corinthians', 13],
  ['Galatians', 6],
  ['Ephesians', 6],
  ['Philippians', 4],
  ['Colossians', 4],
  ['1 Thessalonians', 5],
  ['2 Thessalonians', 3],
  ['1 Timothy', 6],
  ['2 Timothy', 4],
  ['Titus', 3],
  ['Philemon', 1],
  ['Hebrews', 13],
  ['James', 5],
  ['1 Peter', 5],
  ['2 Peter', 3],
  ['1 John', 5],
  ['2 John', 1],
  ['3 John', 1],
  ['Jude', 1],
  ['Revelation', 22],
];

const OT_COUNT = 39;
const TOTAL_CHAPTERS = BOOKS.reduce((s, [, c]) => s + c, 0);

function cachePath(bookId, chapter) {
  return path.join(CACHE_DIR, `${bookId}-${chapter}.json`);
}

async function fetchChapter(bookId, chapter) {
  const cp = cachePath(bookId, chapter);
  try {
    const raw = await fs.readFile(cp, 'utf8');
    return JSON.parse(raw);
  } catch {}
  const url = `${SOURCE_BASE}/${bookId}/${chapter}/`;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      const data = JSON.parse(body);
      if (!Array.isArray(data) || data.length === 0) throw new Error('empty / non-array payload');
      await fs.writeFile(cp, body);
      return data;
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 250 * 2 ** (attempt - 1)));
    }
  }
  throw new Error(`Failed ${url} after ${MAX_RETRIES} attempts: ${lastErr.message}`);
}

async function withConcurrency(tasks, limit) {
  const out = new Array(tasks.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= tasks.length) return;
      out[idx] = await tasks[idx]();
    }
  }
  await Promise.all(Array.from({length: limit}, worker));
  return out;
}

function prevRef(bookIndex, chapter) {
  if (chapter > 1) return `${BOOKS[bookIndex][0]} ${chapter - 1}`;
  if (bookIndex === 0) return null;
  const [prevBook, prevTotal] = BOOKS[bookIndex - 1];
  return `${prevBook} ${prevTotal}`;
}

function nextRef(bookIndex, chapter) {
  const [book, total] = BOOKS[bookIndex];
  if (chapter < total) return `${book} ${chapter + 1}`;
  if (bookIndex === BOOKS.length - 1) return null;
  return `${BOOKS[bookIndex + 1][0]} 1`;
}

function link(target, display = target) {
  return `[${display}](#${encodeURIComponent(target)})`;
}

function navLine(bookIndex, chapter) {
  const book = BOOKS[bookIndex][0];
  const prev = prevRef(bookIndex, chapter);
  const next = nextRef(bookIndex, chapter);
  const parts = [];
  if (prev) parts.push(link(prev, `← ${prev}`));
  parts.push(link(book));
  if (next) parts.push(link(next, `${next} →`));
  return parts.join(' · ');
}

function renderChapter(bookIndex, chapter, verses) {
  const nav = navLine(bookIndex, chapter);
  const text = verses
    .slice()
    .sort((a, b) => a.verse - b.verse)
    .map(v => `<sup>${v.verse}</sup> ${v.text.trim()}`)
    .join(' ');
  return ['type: markdown', 'tags: $Chapter', '', nav, '', text, '', nav, ''].join('\n');
}

function renderBook(book, chapters) {
  const lines = ['type: markdown', 'tags: $Book', ''];
  for (let c = 1; c <= chapters; c++) lines.push(`* ${link(`${book} ${c}`)}`);
  lines.push('');
  return lines.join('\n');
}

function renderBibleIndex() {
  const ot = BOOKS.slice(0, OT_COUNT)
    .map(([n]) => link(n))
    .join(' · ');
  const nt = BOOKS.slice(OT_COUNT)
    .map(([n]) => link(n))
    .join(' · ');
  return ['type: markdown', '', '# The Bible', '', 'World English Bible (WEB) — public domain.', '', '## Old Testament', '', ot, '', '## New Testament', '', nt, ''].join('\n');
}

async function main() {
  await fs.mkdir(CACHE_DIR, {recursive: true});
  await fs.mkdir(OUT_DIR, {recursive: true});

  console.log('WEB Bible importer');
  console.log(`  source : ${SOURCE_BASE}`);
  console.log(`  cache  : ${CACHE_DIR}`);
  console.log(`  output : ${OUT_DIR}`);
  console.log(`  scope  : ${BOOKS.length} books, ${TOTAL_CHAPTERS} chapters`);
  console.log('');

  const tasks = [];
  for (let bi = 0; bi < BOOKS.length; bi++) {
    const [book, total] = BOOKS[bi];
    for (let c = 1; c <= total; c++) {
      tasks.push({bookIndex: bi, book, chapter: c, bookId: bi + 1});
    }
  }

  let done = 0;
  const thunks = tasks.map(t => async () => {
    const verses = await fetchChapter(t.bookId, t.chapter);
    done++;
    if (done % 50 === 0 || done === tasks.length) {
      console.log(`  fetched ${done}/${tasks.length}`);
    }
    return {...t, verses};
  });

  const chapters = await withConcurrency(thunks, CONCURRENCY);
  console.log('');
  console.log(`Fetched all ${chapters.length} chapters.`);

  for (const ch of chapters) {
    const file = path.join(OUT_DIR, `${ch.book} ${ch.chapter}.tid`);
    await fs.writeFile(file, renderChapter(ch.bookIndex, ch.chapter, ch.verses));
  }
  console.log(`Wrote ${chapters.length} chapter tiddlers.`);

  for (const [book, count] of BOOKS) {
    await fs.writeFile(path.join(OUT_DIR, `${book}.tid`), renderBook(book, count));
  }
  console.log(`Wrote ${BOOKS.length} book tiddlers.`);

  await fs.writeFile(path.join(OUT_DIR, 'Bible.tid'), renderBibleIndex());
  console.log('Wrote Bible.tid index.');

  console.log('');
  console.log('Done. To wire it up, append `bible` to:');
  console.log('  src/modules/core.defaults/$ExtensionPackages.tid');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
