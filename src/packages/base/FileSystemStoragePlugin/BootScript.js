// twikki-storage-backend: filesystem
// ^ Ownership marker. `/twikki.boot.js` is a single global slot that other storage
// backends (e.g. IndexedDBStoragePlugin) also use; the plugin's code checks for
// this exact line to know the installed script is ours before offering to
// re-install or reconnect — preventing a re-install ping-pong between backends.
//
// Pre-boot script: replaces tw.storage with a File System Access API backend that
// exposes the same interface as initLocalStorage() (get/set/remove/keys/getRaw/
// setRaw/flush/clearWorkspace, plus auto-prefix on a missing leading '/').
//
// On-disk layout (the user's chosen folder is the root). The per-workspace
// `tiddlers` array EXPLODES into one human-readable file per tiddler, grouped
// into a folder per package; every other key is a small JSON sidecar so the
// folder is a complete, self-contained backend:
//
//   <root>/
//     settings.json           one file per GLOBAL key (the `/ws/` root: a single
//     workspaces.txt          segment with no workspace name). `.txt` is appended
//     secrets.txt             to segments with no extension; others keep theirs.
//     <workspace>/            e.g. "default"
//       <package>/            "base", "demo", … or "_user" when a tiddler has no package
//         <SafeTitle>.<ext>   one content tiddler per file (.tid/.md/.js/.css/.json/.html)
//       _meta.json            {"tiddlers-visible": "...", "tiddlers-trashed": "...", …}
//
// The in-memory Map keeps the SAME full prefixed keys callers already use
// (`/ws/default/tiddlers`, `/ws/workspaces`) so reads stay synchronous, exactly
// like the IndexedDBStoragePlugin. The key↔file split is only at the FS boundary.
//
// This script ONLY initialises the store — it does NOT migrate. Getting an
// existing wiki onto a freshly-connected folder is the plugin's job: connect()
// stands this backend up against the folder and replays the old store through
// it before installing the boot script, so by the time we run the folder is
// already populated. Lifecycle:
//   1. Retrieve the directory handle the plugin saved in IndexedDB (gesture-
//      granted at Connect time). No handle, or permission not 'granted' (a non-
//      installed tab where the grant didn't persist) → set tw.tmp.fsNeedsReconnect
//      and return WITHOUT installing tw.storage, so the platform falls back to
//      localStorage and the plugin can offer a one-click reconnect. Nothing is
//      ever written to the wrong backend.
//   2. Hydrate the in-memory Map by reading every file in the folder.
//   3. Install tw.storage. Reads hit the Map; writes update the Map AND fire-and-
//      forget the file write(s), serialised through one promise chain; flush()
//      awaits them so a save()-then-reboot.hard can't race the reload.
// `opts` is supplied only when the plugin's connect() invokes this directly: it
// passes the freshly-picker-granted directory handle so the store initialises
// against THAT handle (skipping the IndexedDB round-trip + permission re-query),
// which is what lets connect() migrate and then reliably swap the boot script.
(async function (tw, opts) {
  if (!('showDirectoryPicker' in window)) throw new Error('No File System Access API available in your browser!');

  const HANDLE_DB = 'twikki-fs-handle';
  const HANDLE_STORE = 'handles';
  const HANDLE_KEY = 'root';
  const BOOT_KEY = '/twikki.boot.js'; // the pre-boot slot this script lives in (for the reconnect gate's Disconnect)
  const META_FILE = '_meta.json';

  /* BEGIN pure-helpers — extracted verbatim by test/unit/fs-storage.test.js.
     Keep PURE (no closure refs, no I/O); the test eval's the block in isolation. */
  function extForType(type) {
    switch (type) {
      case 'markdown':
        return '.md';
      case 'script/js':
        return '.js';
      case 'json':
        return '.json';
      case 'css':
        return '.css';
      case 'html':
        return '.html';
      case 'csv':
        return '.csv';
      case 'x-twikki':
      default:
        return '.tid';
    }
  }
  function typeForExt(ext) {
    switch (ext) {
      case '.md':
        return 'markdown';
      case '.js':
        return 'script/js';
      case '.json':
        return 'json';
      case '.css':
        return 'css';
      case '.html':
        return 'html';
      case '.csv':
        return 'csv';
      case '.tid':
      default:
        return 'x-twikki';
    }
  }
  // Small, stable, non-cryptographic hash → short base36 string. Used both to
  // detect unchanged files (skip the write) and to disambiguate filenames.
  function hashStr(s) {
    let h = 5381;
    s = String(s);
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  // Title → a filesystem-safe base name (no extension). Spaces and most
  // punctuation are kept (they are valid filenames); only characters reserved on
  // Windows/macOS and control chars are replaced. Trailing dots/spaces are
  // trimmed, length is capped, and `~<hash>` is appended whenever the result is
  // lossy — so distinct titles that sanitise to the same string never collide.
  // Clean titles round-trip exactly.
  function safeBaseName(title) {
    title = String(title);
    let s = title.replace(/[<>:"/\\|?*]/g, '-').replace(/[. ]+$/, '');
    if (!s) s = '_';
    let capped = s.length > 100 ? s.slice(0, 100) : s;
    const reservedDevice = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(capped);
    if (s !== title || capped !== s || reservedDevice) capped += '~' + hashStr(title);
    return capped;
  }
  function packageFolder(t) {
    return (t && t.package) || '_user';
  }
  // Tiddler → file text: a `field: value` header block, a blank line, then the
  // body (`text`). Header values never contain newlines (collapsed to spaces);
  // arrays join on commas (matching the runtime/compiler tag parsing). `title`
  // is always emitted and is authoritative on read (filenames are sanitised).
  function serializeTiddler(t) {
    const lines = ['title: ' + t.title];
    const emit = (k, v) => {
      if (v === undefined || v === null) return;
      if (Array.isArray(v)) v = v.join(',');
      else if (v instanceof Date) v = v.toISOString();
      else if (typeof v === 'object') v = JSON.stringify(v);
      lines.push(k + ': ' + String(v).replace(/\r?\n/g, ' '));
    };
    const order = ['tags', 'type', 'package', 'created', 'updated'];
    for (const k of order) if (k in t) emit(k, t[k]);
    for (const k of Object.keys(t)) {
      if (k === 'text' || k === 'title' || order.indexOf(k) !== -1) continue;
      emit(k, t[k]);
    }
    return lines.join('\n') + '\n\n' + (t.text || '');
  }
  // Inverse of serializeTiddler. Header = leading `key: value` lines up to the
  // first blank line OR the first non-matching line (so a markdown body that
  // starts with `foo: bar` is never misread). `title`/`type` fall back to the
  // filename/extension when absent. created/updated stay strings (core.store
  // coerces them to Date on load).
  function parseTiddlerFile(text, fallbackTitle, fallbackType) {
    text = String(text).replace(/\r/g, '');
    const lines = text.split('\n');
    const meta = {};
    let i = 0;
    for (; i < lines.length; i++) {
      if (lines[i].trim() === '') {
        i++;
        break;
      }
      const m = /^([A-Za-z][\w.-]*):\s?(.*)$/.exec(lines[i]);
      if (!m) break;
      let v = m[2];
      if (v === 'true') v = true;
      else if (v === 'false') v = false;
      meta[m[1]] = v;
    }
    const t = {
      title: meta.title !== undefined ? meta.title : fallbackTitle,
      text: lines.slice(i).join('\n'),
      tags: meta.tags !== undefined ? String(meta.tags).split(/,\s*/).filter(Boolean) : [],
      type: meta.type !== undefined ? meta.type : fallbackType || 'x-twikki',
    };
    for (const k of Object.keys(meta)) {
      if (k === 'title' || k === 'type' || k === 'tags') continue;
      t[k] = meta[k];
    }
    return t;
  }
  // Map a full storage key to its file role. The `tiddlers` array is special
  // (it explodes into per-package files); everything else is a sidecar.
  function routeKey(fullKey) {
    const m = /^\/ws\/([^/]+)\/(.+)$/.exec(fullKey);
    if (m) return m[2] === 'tiddlers' ? {kind: 'tiddlers', ws: m[1]} : {kind: 'wsmeta', ws: m[1]};
    return {kind: 'global'};
  }
  // Globals live at the `/ws/` ROOT — one segment, no workspace name
  // (`/ws/settings.json`, `/ws/workspaces`, `/ws/secrets`). Each is its own file
  // at the folder root. globalSeg() pulls the segment (null if not a root
  // global); the segment IS the filename, with `.txt` appended only when it has
  // no extension (so plain strings read as text and `.json` etc. stay readable).
  // A segment must never itself end in `.txt` or the round-trip is ambiguous —
  // none do (the secrets key is `secrets`, the file is `secrets.txt`).
  function globalSeg(fullKey) {
    const m = /^\/ws\/([^/]+)$/.exec(fullKey);
    return m ? m[1] : null;
  }
  function globalFileName(seg) {
    return /\.[^./]+$/.test(seg) ? seg : seg + '.txt';
  }
  function globalKeyFromFile(name) {
    return '/ws/' + (name.endsWith('.txt') ? name.slice(0, -4) : name);
  }
  // Cheap per-tiddler change signal that does NOT build the (possibly large)
  // serialized body. `updated` is the primary marker — core bumps it on every
  // local edit (see updateTiddler in core.tiddlers); type/package/tags/text-length
  // guard the rare paths that bypass it (e.g. a whole-tiddler import carries new
  // content). When this matches the previous sync, planFiles reuses the cached
  // hash and skips serialize+hash. The trade: an in-place edit that changes the
  // body to the SAME length without bumping `updated` would go undetected — so
  // every persisted mutation must keep `updated` truthful. See docs/FileSystem.md.
  function fingerprint(t) {
    // Normalise `updated` to an ISO string so a Date and its serialized form
    // fingerprint identically (stored tiddlers carry strings; a stray Date must
    // not force a spurious re-serialize).
    const u = t.updated instanceof Date ? t.updated.toISOString() : t.updated || '';
    return u + '|' + (t.type || '') + '|' + (t.package || '') + '|' + (t.tags ? [].concat(t.tags).join(',') : '') + '|' + (t.text ? t.text.length : 0);
  }
  // Plan the per-tiddler files for one workspace's tiddler array. Returns
  // [{title, dir, name, path, content, hash, fp}], resolving case-insensitive
  // filename collisions within a package folder with a `~<hash>` suffix. When
  // `prev` (the previous title→{path,hash,fp} index) is given, a tiddler whose
  // fingerprint AND path are unchanged reuses its cached hash and is NOT
  // re-serialized — `content` is null for those (they never reach a write, since
  // their hash equals the previous one and diffPlan skips equal hashes).
  function planFiles(tiddlers, prev) {
    const out = [];
    const usedPerDir = new Map();
    for (const t of tiddlers) {
      if (!t || !t.title) continue;
      const dir = packageFolder(t);
      const ext = extForType(t.type);
      let base = safeBaseName(t.title);
      let name = base + ext;
      let used = usedPerDir.get(dir);
      if (!used) usedPerDir.set(dir, (used = new Set()));
      if (used.has(name.toLowerCase())) name = base + '~' + hashStr(t.title) + ext;
      used.add(name.toLowerCase());
      const path = dir + '/' + name;
      const fp = fingerprint(t);
      const old = prev && prev.get(t.title);
      if (old && old.fp === fp && old.path === path) {
        out.push({title: t.title, dir, name, path, content: null, hash: old.hash, fp});
      } else {
        const content = serializeTiddler(t);
        out.push({title: t.title, dir, name, path, content, hash: hashStr(content), fp});
      }
    }
    return out;
  }
  // Diff a plan against the previous title→{path,hash} index. Returns the files
  // to write (new/changed/moved), the paths to delete (removed/moved-away), and
  // the next index. Pure — the I/O shell applies the result.
  function diffPlan(prev, plan) {
    const writes = [];
    const index = new Map();
    const planTitles = new Set();
    for (const p of plan) {
      planTitles.add(p.title);
      index.set(p.title, {path: p.path, hash: p.hash, fp: p.fp});
      const old = prev.get(p.title);
      if (!old || old.hash !== p.hash || old.path !== p.path) writes.push(p);
    }
    const deletes = [];
    for (const [title, info] of prev) {
      if (!planTitles.has(title)) deletes.push(info.path);
      else if (index.get(title).path !== info.path) deletes.push(info.path);
    }
    return {writes, deletes, index};
  }
  /* END pure-helpers */

  /* ---- IndexedDB: the directory handle + migration dump the plugin stashed ---- */
  function openHandleDb() {
    return new Promise((resolve, reject) => {
      const req = window.indexedDB.open(HANDLE_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(HANDLE_STORE)) req.result.createObjectStore(HANDLE_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('handle DB open failed'));
    });
  }
  function idbGet(key) {
    return openHandleDb().then(
      db =>
        new Promise((resolve, reject) => {
          const r = db.transaction(HANDLE_STORE, 'readonly').objectStore(HANDLE_STORE).get(key);
          r.onsuccess = () => {
            db.close();
            resolve(r.result === undefined ? null : r.result);
          };
          r.onerror = () => {
            db.close();
            reject(r.error);
          };
        }),
    );
  }
  /* ---- File System Access I/O ---- */
  // Resolve (and cache) a directory handle by path segments. The cache avoids
  // re-walking root → ws → pkg for every one of a workspace's files — the single
  // biggest migration cost. clearWorkspace() purges affected entries.
  async function getDir(root, segs, create) {
    if (!segs.length) return root;
    const key = segs.join('/');
    const cached = dirCache.get(key);
    if (cached) return cached;
    let dir = root;
    for (const s of segs) dir = await dir.getDirectoryHandle(s, {create});
    dirCache.set(key, dir);
    return dir;
  }
  async function writeFileAtPath(root, relPath, content) {
    const parts = relPath.split('/');
    const fname = parts.pop();
    const dir = await getDir(root, parts, true);
    const fh = await dir.getFileHandle(fname, {create: true});
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
  }
  async function removeFileAtPath(root, relPath) {
    const parts = relPath.split('/');
    const fname = parts.pop();
    try {
      const dir = await getDir(root, parts, false);
      await dir.removeEntry(fname);
    } catch {
      /* already gone */
    }
  }
  async function readJsonFile(root, relPath) {
    const parts = relPath.split('/');
    const fname = parts.pop();
    try {
      const dir = await getDir(root, parts, false);
      const fh = await dir.getFileHandle(fname);
      const text = await (await fh.getFile()).text();
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  /* ---- in-memory state ---- */
  const map = new Map(); // full key → raw string (same shape as localStorage/IDB plugin)
  const indexByWs = new Map(); // ws → Map(title → {path, hash})
  const dirCache = new Map(); // rel-path → FileSystemDirectoryHandle (avoids re-walking from root per file)
  const WRITE_CONCURRENCY = 16; // overlap the File System Access createWritable/close latency
  let root = null;

  // Run fn over items with at most `limit` in flight at once.
  async function runPool(items, limit, fn) {
    let i = 0;
    const worker = async () => {
      while (i < items.length) await fn(items[i++]);
    };
    await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
  }

  function ensureSlash(k) {
    return k[0] === '/' ? k : '/' + k;
  }

  /* ---- folder writers (operate off the in-memory Map) ---- */
  async function syncTiddlers(ws) {
    let arr;
    try {
      arr = JSON.parse(map.get('/ws/' + ws + '/tiddlers') || '[]');
    } catch {
      arr = [];
    }
    const prev = indexByWs.get(ws) || new Map();
    const plan = planFiles(arr, prev);
    const {writes, deletes, index} = diffPlan(prev, plan);
    for (const del of deletes) await removeFileAtPath(root, ws + '/' + del);
    // Pre-create each distinct package folder ONCE (sequentially, so concurrent
    // writes below can't race on creating the same dir; getDir caches them).
    const dirs = new Set(
      writes.map(w => {
        const p = (ws + '/' + w.path).split('/');
        p.pop();
        return p.join('/');
      }),
    );
    for (const d of dirs) await getDir(root, d.split('/'), true);
    // Write the files with bounded concurrency to overlap the per-file I/O latency.
    await runPool(writes, WRITE_CONCURRENCY, async w => {
      await writeFileAtPath(root, ws + '/' + w.path, w.content);
      // One tick per tiddler file — lets connect()'s migration drive a progress bar.
      if (opts && opts.onProgress) opts.onProgress();
    });
    indexByWs.set(ws, index);
  }
  function writeMetaFile(ws) {
    const prefix = '/ws/' + ws + '/';
    const obj = {};
    for (const [k, v] of map) if (k.startsWith(prefix) && k !== prefix + 'tiddlers') obj[k.slice(prefix.length)] = v;
    if (Object.keys(obj).length === 0) return removeFileAtPath(root, ws + '/' + META_FILE);
    return writeFileAtPath(root, ws + '/' + META_FILE, JSON.stringify(obj, null, 2));
  }
  // One file per global key at the folder root. Write on set, delete on remove.
  function writeGlobalKey(key) {
    const seg = globalSeg(key);
    if (seg == null) return Promise.resolve();
    if (map.has(key)) return writeFileAtPath(root, globalFileName(seg), map.get(key));
    return removeFileAtPath(root, globalFileName(seg));
  }

  /* ---- hydrate the Map from the folder ---- */
  async function hydrateFromFolder() {
    for await (const [name, handle] of root.entries()) {
      if (handle.kind === 'file') {
        // A non-hidden root file is a global key (one file per `/ws/<seg>` root
        // key). Skip dot/underscore files (`.git`, `.DS_Store`, a legacy
        // `_global.json`) so tool/VCS noise is never read as data.
        if (!name.startsWith('.') && !name.startsWith('_')) {
          map.set(globalKeyFromFile(name), await (await handle.getFile()).text());
        }
        continue;
      }
      // Skip metadata directories so a folder the user has `git init`-ed (`.git`)
      // or that holds tool caches (`__pycache__`, …) is never mistaken for a
      // workspace. Workspaces are user-named; `_…` is reserved (`_user`, `_meta`
      // only ever appear INSIDE a workspace, never at the root).
      if (name.startsWith('.') || name.startsWith('_')) continue;
      const ws = name; // a directory at the root is a workspace
      const tiddlers = [];
      const index = new Map();
      for await (const [sub, subHandle] of handle.entries()) {
        if (subHandle.kind === 'file') {
          if (sub === META_FILE) {
            const obj = (await readJsonFile(root, ws + '/' + META_FILE)) || {};
            for (const k of Object.keys(obj)) map.set('/ws/' + ws + '/' + k, obj[k]);
          }
          continue;
        }
        const pkg = sub; // a directory inside a workspace is a package folder
        for await (const [fname, fhandle] of subHandle.entries()) {
          if (fhandle.kind !== 'file') continue;
          const text = await (await fhandle.getFile()).text();
          const dot = fname.lastIndexOf('.');
          const ext = dot === -1 ? '' : fname.slice(dot);
          const t = parseTiddlerFile(text, dot === -1 ? fname : fname.slice(0, dot), typeForExt(ext));
          if (t.package === undefined && pkg !== '_user') t.package = pkg;
          tiddlers.push(t);
          index.set(t.title, {path: pkg + '/' + fname, hash: hashStr(text), fp: fingerprint(t)});
        }
      }
      map.set('/ws/' + ws + '/tiddlers', JSON.stringify(tiddlers));
      indexByWs.set(ws, index);
    }
  }

  // Pre-boot reconnect gate: shown when the folder is connected but the browser
  // hasn't granted access for this load. We render it ourselves (no tw.ui yet)
  // and the platform halts on tw.tmp.bootAborted, so core never runs and nothing
  // is written to localStorage. "Grant" supplies the user gesture requestPermission
  // requires; "Disconnect" drops the boot script and reloads onto localStorage.
  function showReconnectGate() {
    if (typeof document === 'undefined' || !document.body) return;
    const esc = s => String(s).replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'})[c]);
    document.body.innerHTML =
      '<div style="max-width:34rem;margin:14vh auto;padding:2rem;font-family:system-ui,sans-serif;line-height:1.5">' +
      '<h1 style="font-size:1.3rem;margin:0 0 .5rem">Folder access needed</h1>' +
      '<p id="fs-gate-msg">Your wiki is stored in a local folder. The browser needs your permission to open it again.</p>' +
      '<button id="fs-gate-grant" style="margin:.5rem .5rem 0 0;padding:.5rem 1rem;cursor:pointer">Grant folder access</button>' +
      '<button id="fs-gate-disconnect" style="margin:.5rem 0 0;padding:.5rem 1rem;cursor:pointer">Disconnect file storage</button>' +
      '</div>';
    const msg = document.getElementById('fs-gate-msg');
    document.getElementById('fs-gate-grant').onclick = async () => {
      try {
        if ((await root.requestPermission({mode: 'readwrite'})) === 'granted') location.reload();
        else msg.textContent = 'Access was not granted. Click “Grant folder access” again and choose Allow.';
      } catch (e) {
        msg.textContent = 'Could not reopen the folder (' + esc(e.message) + '). You can disconnect to use local storage instead.';
      }
    };
    document.getElementById('fs-gate-disconnect').onclick = () => {
      window.localStorage.removeItem(BOOT_KEY);
      location.reload();
    };
  }

  /* ---- boot: load the saved handle, hydrate the Map from the folder, install
     tw.storage ----
     This script ONLY initialises the File System store. Migrating existing data
     into a freshly-connected folder is the plugin's job (connect() replays the
     old store through this backend before installing the boot script), so the
     folder is always already populated by the time we get here — we just read
     it. */
  // connect() passes the just-granted handle directly; otherwise load the saved one.
  root = (opts && opts.handle) || (await idbGet(HANDLE_KEY));
  if (!root) {
    tw.tmp = tw.tmp || {};
    tw.tmp.fsNeedsReconnect = true;
    return; // no folder connected yet → platform falls back to localStorage
  }
  // A caller-supplied handle already carries an in-session grant, so skip the
  // re-query. On a normal load the grant often drops to 'prompt' (non-installed
  // tab); rather than fall back to localStorage (which would write default
  // /ws/* keys there and hide the on-disk wiki), HALT and ask to re-grant — the
  // data is on disk and we just need permission to read it.
  if (!(opts && opts.handle)) {
    const perm = await root.queryPermission({mode: 'readwrite'});
    if (perm !== 'granted') {
      tw.tmp = tw.tmp || {};
      tw.tmp.bootAborted = true; // platform: do NOT fall back to localStorage
      showReconnectGate();
      return;
    }
  }

  await hydrateFromFolder();

  /* ---- write queue: fire-and-forget, serialised, awaited by flush() ---- */
  const pending = new Set();
  let chain = Promise.resolve();
  let writeWarned = false; // surface the first write failure once, then stay quiet
  function onWriteError(e) {
    console.warn('FS write failed', e);
    if (writeWarned) return;
    writeWarned = true;
    // A persistent failure (folder moved, drive unmounted, access revoked) means
    // saves are silently not reaching disk — make it visible once so edits aren't
    // lost on reload without warning.
    try {
      tw.ui?.notify?.('File storage write failed — your folder may be disconnected. Reconnect to keep saving.', 'E');
    } catch {
      /* tw.ui not ready */
    }
  }
  function schedule(fn) {
    const p = (chain = chain.then(fn).catch(onWriteError));
    pending.add(p);
    p.then(() => pending.delete(p));
    return p;
  }
  function queueWrite(key) {
    const r = routeKey(key);
    if (r.kind === 'tiddlers') schedule(() => syncTiddlers(r.ws));
    else if (r.kind === 'wsmeta') schedule(() => writeMetaFile(r.ws));
    else schedule(() => writeGlobalKey(key));
  }

  tw.storage = {
    get(key) {
      key = ensureSlash(key);
      const raw = map.get(key);
      if (raw === undefined || raw === null) return raw;
      if (typeof raw === 'string' && /^[\[\{]/.test(raw)) {
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      }
      return raw;
    },
    set(key, value) {
      key = ensureSlash(key);
      const raw = typeof value === 'object' ? JSON.stringify(value) : String(value);
      map.set(key, raw);
      queueWrite(key);
    },
    remove(key) {
      key = ensureSlash(key);
      map.delete(key);
      queueWrite(key);
    },
    keys(prefix) {
      return [...map.keys()].filter(k => k.startsWith(prefix));
    },
    getRaw(key) {
      key = ensureSlash(key);
      return map.has(key) ? map.get(key) : null;
    },
    setRaw(key, raw) {
      key = ensureSlash(key);
      map.set(key, raw);
      queueWrite(key);
    },
    flush() {
      return Promise.all([...pending]);
    },
    clearWorkspace(name) {
      const prefix = '/ws/' + name + '/';
      for (const k of [...map.keys()]) if (k.startsWith(prefix)) map.delete(k);
      indexByWs.delete(name);
      // Drop cached dir handles under this workspace — the folder is about to go.
      for (const k of [...dirCache.keys()]) if (k === name || k.startsWith(name + '/')) dirCache.delete(k);
      schedule(async () => {
        try {
          await root.removeEntry(name, {recursive: true});
        } catch {
          /* never written */
        }
      });
    },
  };
});
