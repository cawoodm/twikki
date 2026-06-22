import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const SRC = join(import.meta.dirname, '..', '..', 'src');
const read = rel => readFileSync(join(SRC, rel), 'utf8');

test('app shell uses dvh so it does not clip under mobile browser chrome', () => {
  const css = read('modules/core.defaults/$CoreThemeLayout.css');
  // Scope to the #app rule (between `#app {` and its closing `}`) so an
  // unrelated `100dvh` elsewhere can't satisfy this test by accident.
  const start = css.indexOf('#app {');
  const appRule = css.slice(start, css.indexOf('}', start));
  assert.match(appRule, /height:\s*100dvh/, '#app should use 100dvh');
  // A 100vh fallback must come BEFORE the 100dvh line (browsers without dvh).
  const vhIdx = appRule.indexOf('height: 100vh');
  const dvhIdx = appRule.indexOf('height: 100dvh');
  assert.ok(vhIdx !== -1 && vhIdx < dvhIdx, '100vh fallback must appear before 100dvh');
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

test('index.html carries PWA status-bar metas for standalone mode', () => {
  const html = read('index.html');
  assert.match(html, /name="theme-color"/, 'needs a theme-color meta');
  assert.match(html, /name="apple-mobile-web-app-capable"/, 'needs apple-mobile-web-app-capable');
  assert.match(html, /name="apple-mobile-web-app-status-bar-style"/, 'needs apple status-bar-style');
});

test('plugin command/picker modals stay viewport-bounded (vw), never a fixed wide px', () => {
  const cmd = read('packages/base/CommandPalettePlugin/CommandPalette.css');
  const pick = read('packages/base/PickerPlugin/Picker.css');
  assert.match(cmd, /\d+vw/, 'CommandPalette width must be vw-bounded');
  // Picker is a small dropdown (min-width:180px) — assert it never sets a wide fixed width.
  assert.doesNotMatch(pick, /width:\s*[5-9]\d{2}px/, 'Picker must not use a 500px+ fixed width');
});
