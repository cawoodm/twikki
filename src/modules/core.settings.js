/**
 * Settings
 * Layered settings: resolve a dotted path as user → workspace → registered
 * default, then expand `${secret:KEY}` references against the global secrets
 * store. The platform and plugins DECLARE their settings (a `settings` block on
 * the object they return); the loader calls `register()` and, after everything
 * has loaded, `materialize()` deep-merges the registered defaults into the
 * per-workspace `$Settings` tiddler.
 *
 * Layers:
 *   - user      — cross-workspace, `/settings.json` via tw.store.global (sparse)
 *   - workspace — the per-workspace `$Settings` tiddler (defaults merged in)
 *   - default   — the in-memory registry (rebuilt each boot, never persisted)
 *
 * Secrets live ONLY in the global `secrets.txt` store (one `key: value` per
 * line) and never leave the device; settings hold `${secret:KEY}` references.
 */
export default function (tw) {
  const name = 'core.settings';
  const version = '0.1.0';
  const platform = '0.28.0'; // built for platform ^0.28.0

  const WS_TIDDLER = '$Settings'; // per-workspace settings tiddler
  const USER_KEY = '/settings.json'; // cross-workspace user overrides (tw.store.global)
  // TODO: We have a "list" type and would need a unique extension for this
  const SECRETS_KEY = 'secrets'; // global secrets at /ws/secrets (tw.store.global); the FS backend stores it as the file secrets.txt

  // path -> {default, type?, description?, options?, secret?, owner}
  const registry = {};

  const exports = {register, get, getRaw, set, materialize, registry, expandSecrets, readSecrets, writeSecret, placement, SECRETS_KEY};

  const run = () => {};
  return {name, version, platform, exports, run};

  // --- Registration (called by the platform loader per module/plugin) ---
  function register(owner, schema) {
    if (!schema) return;
    for (const [path, spec] of Object.entries(schema)) {
      // Same owner re-registering (e.g. a soft reload re-evals plugins) is a
      // silent overwrite; a DIFFERENT owner claiming the same path is a clash.
      if (registry[path] && registry[path].owner !== owner) {
        console.warn(`core.settings: '${path}' already registered by '${registry[path].owner}'; ignoring '${owner}'`);
        continue;
      }
      registry[path] = {...spec, owner};
    }
  }

  // --- Resolution: user → workspace → registered default → def, then secrets ---
  function get(path, def) {
    let val = byPath(readUser(), path);
    if (val === undefined) val = byPath(readWorkspace(), path);
    if (val === undefined && path in registry) val = registry[path].default;
    if (val === undefined) val = def;
    return expandSecrets(val);
  }

  // Resolved value WITHOUT secret expansion — the raw stored value (may be a
  // `${secret:…}` reference). Used by the settings UI to show what is stored.
  function getRaw(path) {
    let val = byPath(readUser(), path);
    if (val === undefined) val = byPath(readWorkspace(), path);
    if (val === undefined && path in registry) val = registry[path].default;
    return val;
  }

  // Which layer currently holds an explicit value for `path` ('user' | 'workspace' | null).
  function placement(path) {
    if (byPath(readUser(), path) !== undefined) return 'user';
    if (byPath(readWorkspace(), path) !== undefined) return 'workspace';
    return null;
  }

  // --- Write to a chosen layer; de-dupe the other so there's one source ---
  function set(path, value, level = 'workspace') {
    if (level === 'user') {
      const user = readUser();
      setByPath(user, path, value);
      tw.store.global.set(USER_KEY, user);
      deleteFromWorkspace(path);
    } else {
      const ws = readWorkspace();
      setByPath(ws, path, value);
      writeWorkspace(ws);
      const user = readUser();
      if (deleteByPath(user, path)) tw.store.global.set(USER_KEY, user);
    }
    tw.events.send('save.auto');
  }

  // --- Deep-merge registered defaults into the workspace tiddler (existing wins) ---
  function materialize() {
    const ws = readWorkspace();
    let changed = false;
    for (const [path, spec] of Object.entries(registry)) {
      if (byPath(ws, path) === undefined) {
        setByPath(ws, path, spec.default);
        changed = true;
      }
    }
    if (changed) writeWorkspace(ws);
  }

  // --- Secrets: ${secret:KEY} → value from the global secrets store ---
  // Resolves references in a string, or in EVERY string property when given an
  // object/array (so a setting whose value is a sub-tree, e.g. {token:
  // '${secret:gist}'}, gets expanded too). Returns COPIES of objects/arrays — never
  // mutates the stored value, so resolved secrets can't leak back into $Settings.
  // The secrets store is read at most once per call (lazily, only if a reference is
  // present); references inside a resolved secret value are not re-expanded.
  function expandSecrets(val) {
    let secrets;
    const lookup = () => secrets || (secrets = readSecrets());
    const walk = v => {
      if (typeof v === 'string') {
        if (!v.includes('${secret:')) return v;
        const s = lookup();
        return v.replace(/\$\{secret:([^}]+)\}/g, (_, key) => {
          const k = key.trim();
          if (k in s) return s[k];
          console.warn(`core.settings: secret '${k}' not found in ${SECRETS_KEY}`);
          return '';
        });
      }
      if (Array.isArray(v)) return v.map(walk);
      if (v !== null && typeof v === 'object') {
        const out = {};
        for (const k of Object.keys(v)) out[k] = walk(v[k]);
        return out;
      }
      return v;
    };
    return walk(val);
  }

  function readSecrets() {
    const raw = tw.store.global.get(SECRETS_KEY);
    const out = {};
    if (typeof raw !== 'string') return out;
    for (const line of raw.split('\n')) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const i = s.indexOf(':');
      if (i < 0) continue;
      out[s.slice(0, i).trim()] = s.slice(i + 1).trim();
    }
    return out;
  }

  function writeSecret(key, value) {
    const secrets = readSecrets();
    // One entry per line, so strip newlines — otherwise a value could inject
    // additional (fake) secret lines.
    secrets[String(key).replace(/[\r\n]+/g, '')] = String(value).replace(/[\r\n]+/g, ' ');
    const text = Object.entries(secrets)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    tw.store.global.set(SECRETS_KEY, text);
  }

  // --- Layer readers/writers ---
  function readUser() {
    const u = tw.store.global.get(USER_KEY);
    return u && typeof u === 'object' ? u : {};
  }
  function readWorkspace() {
    try {
      return tw.run.getJSONObject(WS_TIDDLER) || {};
    } catch {
      return {};
    }
  }
  function writeWorkspace(obj) {
    let t = tw.run.getTiddler(WS_TIDDLER);
    if (!t) t = {title: WS_TIDDLER, type: 'json', tags: ['$Shadow', '$NoSynch', '$NoBackup']};
    else t = {...t};
    t.text = JSON.stringify(obj, null, 2);
    delete t.doNotSave;
    // Local mutation via the raw upsert (which doesn't stamp `updated`). Stamp it
    // so the File System backend's fingerprint detects the change — a same-length
    // value edit (e.g. true→false) would otherwise leave it stale. See
    // fingerprint() in BootScript.js / docs/FileSystem.md.
    t.updated = new Date();
    tw.run.updateTiddlerHard(WS_TIDDLER, t);
  }
  function deleteFromWorkspace(path) {
    const ws = readWorkspace();
    if (deleteByPath(ws, path)) writeWorkspace(ws);
  }

  // --- Dotted-path helpers ---
  function byPath(obj, path) {
    return String(path)
      .split('.')
      .reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function setByPath(obj, path, value) {
    const parts = String(path).split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }
  function deleteByPath(obj, path) {
    const parts = String(path).split('.');
    const chain = [obj]; // objects visited, for pruning empty parents after delete
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') return false;
      cur = cur[parts[i]];
      chain.push(cur);
    }
    const leaf = parts[parts.length - 1];
    if (!(leaf in cur)) return false;
    delete cur[leaf];
    // Prune now-empty parent objects up the chain (e.g. don't leave
    // {backup: {Gist: {}}} after promoting the last backup setting to user).
    for (let i = chain.length - 1; i >= 1; i--) {
      if (Object.keys(chain[i]).length === 0) delete chain[i - 1][parts[i - 1]];
      else break;
    }
    return true;
  }
}
