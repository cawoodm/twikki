import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

// Eval core.common the way the platform does: invoke its IIFE with `tw`. The
// platform merges meta.exports onto tw.core.common; here we read them off meta
// directly. getSetting's closure captures this `tw`, so mutating tw.run later
// changes what it reads.
function freshCommon() {
  const tw = {run: {}};
  const code = readFileSync(join(root, 'src/modules/core.common.js'), 'utf8');
  const meta = (0, eval)(code)(tw);
  return {tw, meta};
}

test('module returns name/version/platform and the pure utilities', () => {
  const {meta} = freshCommon();
  assert.equal(meta.name, 'core.common');
  assert.equal(typeof meta.exports.escapeHtml, 'function');
  assert.equal(typeof meta.exports.encoder, 'function');
  assert.equal(typeof meta.exports.getSetting, 'function');
});

test('getSetting resolves a dotted path, defaults, and never throws', () => {
  const {tw, meta} = freshCommon();
  const {getSetting} = meta.exports;

  // No getJSONObject wired yet (calling undefined throws) → falls back, no throw.
  assert.equal(getSetting('data.autoSave', true), true);

  tw.run.getJSONObject = () => ({data: {autoSave: false, count: 0}, backup: {secs: 1800}});
  assert.equal(getSetting('data.autoSave', true), false, 'explicit false is returned, not the default');
  assert.equal(getSetting('data.count', 99), 0, 'falsy-but-present value wins over default');
  assert.equal(getSetting('backup.secs', 0), 1800);

  // Missing leaf or missing branch → default (no throw on null traversal).
  assert.equal(getSetting('data.missing', 'd'), 'd');
  assert.equal(getSetting('a.b.c.d', 42), 42);

  // A throwing getJSONObject (e.g. invalid JSON) → default.
  tw.run.getJSONObject = () => {
    throw new Error('bad json');
  };
  assert.equal(getSetting('data.autoSave', true), true);
});
