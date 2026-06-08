import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, extname} from 'node:path';

const SRC = join(import.meta.dirname, '..', '..', 'src');
const BASE_VARS = join(SRC, 'modules', 'core.defaults', '$BaseVariables.css');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function declaredTokens(cssText) {
  const decls = new Set();
  for (const m of cssText.matchAll(/(--[a-z0-9_-]+)\s*:/g)) decls.add(m[1]);
  return decls;
}

function referencedTokens(cssText) {
  const refs = new Set();
  for (const m of cssText.matchAll(/var\((--[a-z0-9_-]+)/g)) refs.add(m[1]);
  return refs;
}

test('every var(--x) reference in src/ resolves to a declaration in $BaseVariables', () => {
  const baseDecls = declaredTokens(readFileSync(BASE_VARS, 'utf8'));
  const offenders = new Map(); // token → [files]

  const files = walk(SRC).filter(f => ['.css', '.tid'].includes(extname(f)));
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const token of referencedTokens(text)) {
      if (!baseDecls.has(token)) {
        if (!offenders.has(token)) offenders.set(token, []);
        offenders.get(token).push(f);
      }
    }
  }

  if (offenders.size) {
    const report = [...offenders].map(([t, fs]) => `  ${t}\n    ${fs.join('\n    ')}`).join('\n');
    assert.fail(`Unresolved var() references (not declared in $BaseVariables):\n${report}`);
  }
});
