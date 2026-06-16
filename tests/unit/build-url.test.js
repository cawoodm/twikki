import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// `tw.core.buildUrl` is the single helper the platform and plugins use to build
// URLs (modules, packages, GitHub API endpoints). It lives inline in
// twikki.platform.js between sentinel comments and is written to be pure (no
// closure refs beyond `tw`/`window`) so this test extracts it and exercises it
// directly with stubbed globals.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLATFORM_FILE = join(root, 'src', 'platform', 'twikki.platform.js');

function loadBuildUrl({moduleUrlInStorage = null, moduleUrlOnWindow = null, locationHref}) {
  const src = readFileSync(PLATFORM_FILE, 'utf8');
  const m = src.match(/\/\* BEGIN buildUrl helper[\s\S]*?\/\* END buildUrl helper \*\//);
  assert.ok(m, 'buildUrl helper block not found — did the sentinel comments move?');
  // Inject stubs for the two globals the helper reads. Returning the function
  // gives the test a self-contained binding without polluting Node's global.
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'tw',
    'window',
    m[0] + '\nreturn buildUrl;',
  );
  const tw = {storage: {get: k => (k === '/moduleUrl' ? moduleUrlInStorage : null)}};
  const win = {MODULE_URL: moduleUrlOnWindow, location: {href: locationHref}};
  return factory(tw, win);
}

const buildUrl = loadBuildUrl({locationHref: 'http://localhost:3004/twikki/'});

test('fully qualified URL is returned verbatim', () => {
  assert.equal(
    buildUrl('https://cawoodm.github.io/twikki/packages/base.json'),
    'https://cawoodm.github.io/twikki/packages/base.json',
  );
  assert.equal(buildUrl('http://x.example/a.json', 'irrelevant'), 'http://x.example/a.json');
});

test('relative path resolves against an explicit /-terminated base', () => {
  assert.equal(
    buildUrl('packages/base.json', 'http://localhost:3004/'),
    'http://localhost:3004/packages/base.json',
  );
  assert.equal(
    buildUrl('modules/core.tiddlers.js', 'http://localhost:3004/twikki/'),
    'http://localhost:3004/twikki/modules/core.tiddlers.js',
  );
});

test('base lacking trailing slash gets normalized', () => {
  // Without the trailing-slash fix, `new URL` would treat `/twikki` as a file
  // and the relative path would resolve at the parent, not under /twikki/.
  assert.equal(
    buildUrl('packages/base.json', 'http://localhost:3004/twikki'),
    'http://localhost:3004/twikki/packages/base.json',
  );
});

test('platform-style module name (leading slash on the segment) resolves cleanly', () => {
  // Platform passes 'modules' + moduleName where moduleName already starts with '/'.
  const moduleName = '/core.tiddlers.js';
  assert.equal(
    buildUrl('modules' + moduleName, 'http://localhost:3004/twikki/'),
    'http://localhost:3004/twikki/modules/core.tiddlers.js',
  );
});

test('fallback prefers tw.storage.get("/moduleUrl") over MODULE_URL and location', () => {
  const fn = loadBuildUrl({
    moduleUrlInStorage: 'https://from-storage.example/twikki',
    moduleUrlOnWindow: 'https://from-window.example/twikki',
    locationHref: 'http://localhost:3004/twikki/',
  });
  assert.equal(
    fn('packages/base.json'),
    'https://from-storage.example/twikki/packages/base.json',
  );
});

test('fallback uses window.MODULE_URL when storage is empty', () => {
  const fn = loadBuildUrl({
    moduleUrlOnWindow: 'https://from-window.example/twikki/',
    locationHref: 'http://localhost:3004/twikki/',
  });
  assert.equal(
    fn('packages/base.json'),
    'https://from-window.example/twikki/packages/base.json',
  );
});

test('fallback uses current document directory when nothing else is set', () => {
  // Pathname has a filename — `new URL('./', href)` extracts the directory,
  // avoiding the old `origin + pathname` bug that fused 'index.html' + 'packages/…'.
  const fn = loadBuildUrl({locationHref: 'http://localhost:3004/twikki/index.html?reload'});
  assert.equal(
    fn('packages/base.json'),
    'http://localhost:3004/twikki/packages/base.json',
  );
});

test('fallback treats extension-less last segment without trailing slash as a directory', () => {
  // Server serves the app at /twikki (no trailing slash, e.g. via /twikki →
  // /twikki/index.html rewriting). new URL('./', 'http://host/twikki')
  // would otherwise treat 'twikki' as a file and resolve './' to the parent,
  // making modules load from /modules instead of /twikki/modules.
  const fn = loadBuildUrl({locationHref: 'http://localhost:3005/twikki'});
  assert.equal(
    fn('modules/core.tiddlers.js'),
    'http://localhost:3005/twikki/modules/core.tiddlers.js',
  );
});
