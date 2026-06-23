import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// `offlineFallback` decides what core.packaging does when a package fetch
// fails: keep the already-cached copy (offline + a previous online boot loaded
// it) or surface the error (online failure, or offline with nothing cached).
// It lives inline in core.packaging.js between sentinel comments and is pure
// (args only, no closure refs), so this test extracts and exercises it
// directly — mirroring the buildUrl helper extraction in build-url.test.js.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKAGING_FILE = join(root, 'src', 'modules', 'core.packaging.js');

function loadOfflineFallback() {
  const src = readFileSync(PACKAGING_FILE, 'utf8');
  const m = src.match(/\/\* BEGIN offlineFallback helper[\s\S]*?\/\* END offlineFallback helper \*\//);
  assert.ok(m, 'offlineFallback helper block not found — did the sentinel comments move?');
  // eslint-disable-next-line no-new-func
  return new Function(m[0] + '\nreturn offlineFallback;')();
}

const offlineFallback = loadOfflineFallback();

test('offline with a cached copy → use-cache (silent, keep cached tiddlers)', () => {
  assert.equal(offlineFallback({online: false, hadCachedCopy: true}), 'use-cache');
});

test('offline with no cached copy → fail (nothing to fall back on)', () => {
  assert.equal(offlineFallback({online: false, hadCachedCopy: false}), 'fail');
});

test('online failure with a cached copy → fail (genuine error, surface it)', () => {
  assert.equal(offlineFallback({online: true, hadCachedCopy: true}), 'fail');
});

test('online failure with no cached copy → fail', () => {
  assert.equal(offlineFallback({online: true, hadCachedCopy: false}), 'fail');
});
