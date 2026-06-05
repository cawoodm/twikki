import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// Every var(--x) referenced anywhere in src/ must be declared (with a default)
// in the token contract, src/modules/core.defaults/$Tokens.css. An undeclared
// token fails invisibly at runtime — the property just doesn't apply.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOKENS_FILE = join(root, 'src', 'modules', 'core.defaults', '$Tokens.css');

// Tokens a theme may declare for itself without core providing a default.
const ALLOWLIST = [];

function declaredTokens() {
  const css = readFileSync(TOKENS_FILE, 'utf8');
  return new Set([...css.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)].map(m => m[1]));
}

function referencedTokens() {
  const refs = new Map(); // token -> first referencing file
  const exts = ['.css', '.tid', '.js', '.html', '.md'];
  for (const entry of readdirSync(join(root, 'src'), {recursive: true, withFileTypes: true})) {
    if (!entry.isFile() || !exts.some(e => entry.name.endsWith(e))) continue;
    const filePath = join(entry.parentPath, entry.name);
    const text = readFileSync(filePath, 'utf8');
    for (const m of text.matchAll(/var\((--[a-zA-Z0-9_-]+)/g)) {
      if (!refs.has(m[1])) refs.set(m[1], filePath);
    }
  }
  return refs;
}

test('every var(--x) reference in src/ resolves to a declaration in $Tokens.css', () => {
  const declared = declaredTokens();
  assert.ok(declared.size > 0, '$Tokens.css declares no tokens — did it move?');
  const unresolved = [...referencedTokens()]
    .filter(([token]) => !declared.has(token) && !ALLOWLIST.includes(token));
  assert.deepEqual(
    unresolved.map(([token, file]) => `${token} (first seen in ${file})`),
    [],
    'Tokens referenced but not declared in $Tokens.css',
  );
});
