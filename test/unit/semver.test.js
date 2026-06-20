import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// The platform's semver helper (semver/semverCompare/caretSatisfies) gates which core
// modules may load. It lives inline in twikki.platform.js between sentinel comments and
// is written to be pure (no closure refs) so this test can extract and exercise it
// directly — if the markers or purity break, this fails loudly.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLATFORM_FILE = join(root, 'src', 'platform', 'twikki.platform.js');

function loadSemver() {
  const src = readFileSync(PLATFORM_FILE, 'utf8');
  const m = src.match(/\/\* BEGIN semver helper[\s\S]*?\/\* END semver helper \*\//);
  assert.ok(m, 'semver helper block not found — did the sentinel comments move?');
  // The block is function declarations; hoisting makes them available to the return.
  // eslint-disable-next-line no-new-func
  return new Function(m[0] + '\nreturn {semver, semverCompare, caretSatisfies};')();
}

const {semver, semverCompare, caretSatisfies} = loadSemver();

test('semver parses valid versions and rejects junk', () => {
  assert.deepEqual(semver('1.2.3'), {major: 1, minor: 2, patch: 3});
  assert.deepEqual(semver(' 0.24.0 '), {major: 0, minor: 24, patch: 0});
  assert.equal(semver('1.2'), null);
  assert.equal(semver('1.2.3.4'), null);
  assert.equal(semver('x.y.z'), null);
  assert.equal(semver(''), null);
});

test('semverCompare orders versions and returns NaN on junk', () => {
  assert.ok(semverCompare('1.0.0', '0.99.0') > 0);
  assert.ok(semverCompare('0.24.0', '0.24.1') < 0);
  assert.equal(semverCompare('0.24.0', '0.24.0'), 0);
  assert.ok(semverCompare('0.25.0', '0.24.9') > 0);
  assert.ok(Number.isNaN(semverCompare('0.24.0', 'bad')));
});

test('caretSatisfies: same major AND running >= built-for', () => {
  assert.equal(caretSatisfies('0.24.0', '0.24.0'), true); // exact
  assert.equal(caretSatisfies('0.24.0', '0.24.5'), true); // newer patch
  assert.equal(caretSatisfies('0.24.0', '0.99.0'), true); // newer minor, same major
  assert.equal(caretSatisfies('0.25.0', '0.24.0'), false); // running older than built-for
  assert.equal(caretSatisfies('1.0.0', '0.24.0'), false); // different major (running lower)
  assert.equal(caretSatisfies('0.24.0', '1.0.0'), false); // different major (running higher)
  assert.equal(caretSatisfies('0.24.0', 'bad'), false); // junk
  assert.equal(caretSatisfies(null, '0.24.0'), false); // missing built-for
});
