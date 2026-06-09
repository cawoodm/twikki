import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// Every loose core module (src/modules/*.js — NOT the compiled subdirectories like
// core.defaults/) must declare both a `const version` and a `const platform`, each a
// valid x.y.z semver. The platform decides compatibility by statically grepping these
// exact declarations before eval, so this test uses the SAME regexes the platform does:
// a module that doesn't match them would be treated as incompatible at boot.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULES_DIR = join(root, 'src', 'modules');

// Kept identical to parseModuleMeta() in twikki.platform.js.
const RE_VERSION = /const\s+version\s*=\s*'([^']+)'/;
const RE_PLATFORM = /const\s+platform\s*=\s*'([^']+)'/;
const RE_SEMVER = /^\d+\.\d+\.\d+$/;

function coreModuleFiles() {
  return readdirSync(MODULES_DIR, {withFileTypes: true})
    .filter(e => e.isFile() && e.name.endsWith('.js'))
    .map(e => e.name);
}

test('there are loose core modules to check', () => {
  assert.ok(coreModuleFiles().length >= 12, 'expected at least 12 core.*.js modules');
});

for (const file of coreModuleFiles()) {
  test(`${file} declares a parseable version and platform`, () => {
    const src = readFileSync(join(MODULES_DIR, file), 'utf8');
    const version = src.match(RE_VERSION)?.[1];
    const platform = src.match(RE_PLATFORM)?.[1];
    assert.ok(version, `${file}: no parseable \`const version = '...'\``);
    assert.ok(platform, `${file}: no parseable \`const platform = '...'\``);
    assert.match(version, RE_SEMVER, `${file}: version '${version}' is not x.y.z`);
    assert.match(platform, RE_SEMVER, `${file}: platform '${platform}' is not x.y.z`);
  });
}
