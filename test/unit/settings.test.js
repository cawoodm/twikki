import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Load core.settings.js (an ESM `export default function (tw) {…}` factory) with
// a stub tw: an in-memory tw.store.global, a fake $Settings tiddler reachable via
// tw.run, and a no-op event bus. Returns the module's exports plus the stores so
// tests can assert what landed where.
function load() {
  const code = readFileSync(join(root, 'src/modules/core.settings.js'), 'utf8');
  const factory = (0, eval)('(' + code.replace('export default ', '') + ')');
  const globalStore = {}; // tw.store.global backing
  const wsTiddlers = {}; // workspace tiddlers by title
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' ')); // captured for this test's lifetime
  const tw = {
    store: {global: {get: k => globalStore[k], set: (k, v) => (globalStore[k] = v)}},
    run: {
      getJSONObject: title => (wsTiddlers[title] ? JSON.parse(wsTiddlers[title].text) : undefined),
      getTiddler: title => wsTiddlers[title],
      updateTiddlerHard: (title, t) => (wsTiddlers[title] = t),
    },
    events: {send() {}},
  };
  const s = factory(tw).exports;
  return {s, globalStore, wsTiddlers, warnings};
}

test('registered default is returned when no user/workspace value', () => {
  const {s} = load();
  s.register('core.x', {'a.b': {default: 42}});
  assert.equal(s.get('a.b'), 42);
  assert.equal(s.get('missing', 'fallback'), 'fallback');
});

test('workspace overrides default; user overrides workspace', () => {
  const {s} = load();
  s.register('core.x', {'a.b': {default: 1}});
  s.set('a.b', 2, 'workspace');
  assert.equal(s.get('a.b'), 2);
  s.set('a.b', 3, 'user');
  assert.equal(s.get('a.b'), 3, 'user layer wins');
  assert.equal(s.placement('a.b'), 'user');
});

test('set(user) de-dupes workspace and vice-versa', () => {
  const {s, globalStore, wsTiddlers} = load();
  s.set('k', 'w', 'workspace');
  assert.equal(JSON.parse(wsTiddlers['$Settings'].text).k, 'w');
  s.set('k', 'u', 'user');
  assert.equal(globalStore['/settings.json'].k, 'u');
  assert.equal(JSON.parse(wsTiddlers['$Settings'].text).k, undefined, 'removed from workspace');
  s.set('k', 'w2', 'workspace');
  assert.equal(globalStore['/settings.json'].k, undefined, 'removed from user');
});

test('materialize deep-merges registered defaults into $Settings, existing wins', () => {
  const {s, wsTiddlers} = load();
  s.set('a.keep', 'mine', 'workspace');
  s.register('core.x', {'a.keep': {default: 'def'}, 'a.new': {default: 'n'}, top: {default: true}});
  s.materialize();
  const ws = JSON.parse(wsTiddlers['$Settings'].text);
  assert.equal(ws.a.keep, 'mine', 'existing value preserved');
  assert.equal(ws.a.new, 'n', 'missing default added');
  assert.equal(ws.top, true);
});

test('${secret:KEY} expands from the global secrets store; missing → empty', () => {
  const {s} = load();
  s.writeSecret('gitPAT1', 'ghp_abc');
  s.register('core.x', {'synch.gitPAT': {default: '${secret:gitPAT1}'}, 'synch.bad': {default: '${secret:nope}'}});
  assert.equal(s.get('synch.gitPAT'), 'ghp_abc');
  assert.equal(s.get('synch.bad'), '');
});

test('duplicate path from a different owner warns and keeps the first', () => {
  const {s, warnings} = load();
  s.register('core.a', {'x.y': {default: 1}});
  s.register('plugin.b', {'x.y': {default: 2}});
  assert.equal(s.get('x.y'), 1, 'first registration wins');
  assert.ok(warnings.some(w => w.includes('x.y') && w.includes('plugin.b')));
});

test('same owner re-registering overwrites silently (soft reload)', () => {
  const {s} = load();
  s.register('plugin.b', {'x.y': {default: 1}});
  s.register('plugin.b', {'x.y': {default: 9}});
  assert.equal(s.get('x.y'), 9);
});

test('migrateSecrets moves a plaintext token to secrets.txt and references it (once)', () => {
  const {s, globalStore} = load();
  s.set('backup.Gist.accessToken', 'ghp_plain', 'workspace');
  s.migrateSecrets();
  assert.equal(s.getRaw('backup.Gist.accessToken'), '${secret:backup_Gist_accessToken}', 'setting now holds a reference');
  assert.equal(s.get('backup.Gist.accessToken'), 'ghp_plain', 'reference resolves to the moved token');
  assert.match(globalStore['secrets.txt'], /backup_Gist_accessToken: ghp_plain/);
  // idempotent: a second run does not touch an already-referenced value
  s.migrateSecrets();
  assert.equal(s.getRaw('backup.Gist.accessToken'), '${secret:backup_Gist_accessToken}');
});

test('promoting a nested setting to user prunes the now-empty parents in $Settings', () => {
  const {s, wsTiddlers} = load();
  s.set('backup.Gist.gistId', 'abc', 'workspace');
  s.set('backup.Gist.gistId', 'abc', 'user'); // de-dupes workspace, leaving backup.Gist empty
  const ws = JSON.parse(wsTiddlers['$Settings'].text);
  assert.equal(ws.backup, undefined, 'empty backup/Gist parents pruned, not left as {backup:{Gist:{}}}');
});

test('writeSecret strips newlines so a value cannot inject extra entries', () => {
  const {s, globalStore} = load();
  s.writeSecret('tok', 'ghp_x\nmalicious: hijacked');
  assert.equal(globalStore['secrets.txt'], 'tok: ghp_x malicious: hijacked', 'newline neutralised to a space');
  assert.equal(s.readSecrets().malicious, undefined, 'no injected entry');
});

test('migrateSecrets skips empty and already-referenced values', () => {
  const {s, globalStore} = load();
  s.set('synch.Gist.accessToken', '${secret:mine}', 'workspace'); // already a reference
  s.migrateSecrets();
  assert.equal(s.getRaw('synch.Gist.accessToken'), '${secret:mine}', 'reference left untouched');
  assert.equal(globalStore['secrets.txt'], undefined, 'nothing written for empty/reference values');
});
