import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const SRC = join(import.meta.dirname, '..', '..', 'src');
const read = rel => readFileSync(join(SRC, rel), 'utf8');

test('app shell uses dvh so it does not clip under mobile browser chrome', () => {
  const css = read('modules/core.defaults/$CoreThemeLayout.css');
  assert.match(css, /height:\s*100dvh/, '#app should use 100dvh');
});

test('viewport meta opts into the safe-area with viewport-fit=cover', () => {
  const html = read('index.html');
  assert.match(html, /viewport-fit=cover/, 'index.html viewport meta needs viewport-fit=cover');
});

test('safe-area insets are honoured on header/sidebar/footer chrome', () => {
  const layout = read('modules/core.defaults/$CoreThemeLayout.css');
  const appearance = read('modules/core.defaults/$CoreThemeAppearance.css');
  assert.match(
    layout + appearance,
    /env\(safe-area-inset-/,
    'at least one chrome element must pad with env(safe-area-inset-*)',
  );
});
