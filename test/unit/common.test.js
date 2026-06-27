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
  // ES module now (`export default function (tw) {…}`): strip the export and
  // eval the factory expression.
  const meta = (0, eval)('(' + code.replace('export default ', '') + ')')(tw);
  return {tw, meta};
}

test('module returns name/version/platform and the pure utilities', () => {
  const {meta} = freshCommon();
  assert.equal(meta.name, 'core.common');
  assert.equal(typeof meta.exports.escapeHtml, 'function');
  assert.equal(typeof meta.exports.encoder, 'function');
  assert.equal(typeof meta.exports.getSetting, 'function');
});

test('getSetting delegates to tw.core.settings.get and falls back to def', () => {
  const {tw, meta} = freshCommon();
  const {getSetting} = meta.exports;

  // No tw.core.settings wired yet → returns def, never throws.
  assert.equal(getSetting('data.autoSave', true), true);

  // Delegates to the settings engine when present.
  tw.core = {settings: {get: (path, def) => (path === 'data.autoSave' ? false : def)}};
  assert.equal(getSetting('data.autoSave', true), false, 'engine value is returned, not the default');
  assert.equal(getSetting('x.y', 7), 7, 'unknown path falls back to def');

  // A throwing engine → def.
  tw.core.settings.get = () => {
    throw new Error('boom');
  };
  assert.equal(getSetting('data.autoSave', true), true);
});
