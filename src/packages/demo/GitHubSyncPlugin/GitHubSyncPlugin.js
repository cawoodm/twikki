(function () {
  const META_FILENAME = '_twikki.meta.json';
  const FORMAT = 'twikki-ghrepo-v1';
  const DEFAULT_BRANCH = 'main';
  const DEFAULT_DIR = 'twikki';
  const DEFAULT_ENDPOINT = 'https://api.github.com';
  const DEFAULT_COMMIT_PREFIX = 'TWikki sync';
  const MAX_PUSH_ATTEMPTS = 3; // retries when the branch tip moves under us (422)
  const PULL_CONCURRENCY = 12; // parallel blob fetches on pull (bounded to stay polite to the API)
  const DEFAULT_CONFLICT_WINDOW_MS = 3_000; // timestamps within 3s are possibly due to clock skew

  // Never pushed, and preserved locally across a pull (the repo has no authoritative
  // copy):
  //   - $GeneralSettings — holds the PAT; committing a token trips GitHub secret
  //     scanning (the token gets revoked).
  //   - $NoSynch / $NoBackup tagged tiddlers — explicit opt-out.
  //   - doNotSave tiddlers — app-provided shadow/package defaults the local store
  //     itself doesn't persist (core.store tiddlersToSave); they're regenerated
  //     from the app on every client, so syncing them only churns the repo.
  const isLocalOnly = t => t.title === '$GeneralSettings' || t.doNotSave === true || t.tags?.includes('$NoSynch') || t.tags?.includes('$NoBackup');

  const sync = {
    synch() {
      return tw.ui.button('{{$IconSynch}}', 'ghsync.synch', null, 'ghsync-synch', 'title="Pull then push changed tiddlers to GitHub repo"');
    },
    push() {
      return tw.ui.button('{{$IconPush}}', 'ghsync.push', null, 'ghsync-push', 'title="Push changed tiddlers to GitHub repo"');
    },
    pull() {
      return tw.ui.button('{{$IconPull}}', 'ghsync.pull', null, 'ghsync-pull', 'title="Pull workspace from GitHub repo"');
    },

    // Bidirectional last-write-wins sync (NOT pull-then-push — that made the
    // remote authoritative and silently clobbered local edits). Each attempt
    // reads the current remote, reconciles local⇄remote by newest `updated` per
    // title, commits the converged set, then applies it locally. A 422 (the
    // branch advanced under us) re-runs the whole reconcile against the new tip
    // rather than re-pushing a now-stale winner set.
    async doSynch() {
      dp('ghrepo', 'doSynch');
      const cfg = readConfig();
      if (!cfg) return;
      try {
        let lastConflict;
        for (let attempt = 0; attempt < MAX_PUSH_ATTEMPTS; attempt++) {
          try {
            return await attemptSynch(cfg);
          } catch (e) {
            if (e.status !== 422) throw e;
            lastConflict = e;
            console.warn(`GitHubSync synch: branch advanced, retrying (attempt ${attempt + 1}/${MAX_PUSH_ATTEMPTS})`);
          }
        }
        throw lastConflict;
      } catch (e) {
        if (e.cancelled) return tw.ui.notify('Synch cancelled — no changes made', 'I');
        console.error('GitHubSync synch', e);
        tw.ui.notify(`Synch failed: ${e.message} (see console log)`, 'E');
      }
    },
    // Commit only the tiddlers whose content differs from the repo (plus deletions).
    async doPush() {
      const cfg = readConfig();
      if (!cfg) return;

      // Desired file set: one JSON file per tiddler plus a meta sidecar.
      const desired = {};
      tw.tiddlers.all
        .filter(t => !isLocalOnly(t))
        .forEach(t => {
          desired[filePath(cfg, t.title)] = JSON.stringify(t, null, 2);
        });
      desired[metaPath(cfg)] = JSON.stringify(
        {
          format: FORMAT,
          visible: tw.tiddlers.visible,
          trashed: tw.tiddlers.trashed.filter(t => !isLocalOnly(t)),
        },
        null,
        2,
      );

      try {
        // The ref update is a fast-forward only while the branch tip stays at the
        // HEAD we read. GitHub serves ref reads from replicas (they can lag), and the
        // branch may also advance concurrently — either makes the PATCH fail with
        // 422 "not a fast forward". Re-read HEAD and rebuild on the fresh tip rather
        // than force-pushing (which would discard the remote commit we collided with).
        let lastConflict;
        for (let attempt = 0; attempt < MAX_PUSH_ATTEMPTS; attempt++) {
          try {
            return await attemptPush(cfg, desired);
          } catch (e) {
            if (e.status !== 422) throw e;
            lastConflict = e;
            console.warn(`GitHubSync push: branch advanced, retrying (attempt ${attempt + 1}/${MAX_PUSH_ATTEMPTS})`);
          }
        }
        throw lastConflict;
      } catch (e) {
        console.error('GitHubSync push', e);
        tw.ui.notify(`Push failed: ${e.message} (see console log)`, 'E');
      }
    },

    // Replace the local workspace from the repo (local-only tiddlers are preserved).
    async doPull() {
      const cfg = readConfig();
      if (!cfg) return;
      try {
        const head = await getHead(cfg);
        if (!head) return tw.ui.notify(`Repo ${cfg.repo}@${cfg.branch} has no commits to pull`, 'W');

        const managed = await listManagedBlobs(cfg, head.treeSha); // [{path, sha}]
        const rebuilt = {all: [], visible: [], trashed: []};
        let sawMeta = false;

        // Hash each local tiddler the same way the push side does (git blob SHA of
        // its serialized JSON) so an unchanged tiddler can be matched to the remote
        // tree's blob SHA and skipped — no fetch. A pull with no remote changes then
        // costs just the tree listing + the meta sidecar.
        const localByPath = new Map();
        const localShaByPath = new Map();
        for (const t of tw.tiddlers.all.filter(t => !isLocalOnly(t))) {
          const path = filePath(cfg, t.title);
          localByPath.set(path, t);
          localShaByPath.set(path, await gitBlobSha(JSON.stringify(t, null, 2)));
        }
        const {fetch: toFetch, reuse} = partitionPull(managed, localShaByPath, metaPath(cfg));

        // Unchanged tiddlers: keep the local object (identical bytes, no download).
        for (const path of reuse) rebuilt.all.push(localByPath.get(path));

        // Fetch only the changed/new blobs (plus meta) in parallel (bounded) — one
        // sequential GET per tiddler made a large workspace pull crawl. Parsing
        // stays sequential (it's cheap).
        const blobs = await mapLimit(toFetch, PULL_CONCURRENCY, async ({path, sha}) => ({path, text: await getBlobText(cfg, sha)}));
        for (const {path, text} of blobs) {
          if (path === metaPath(cfg)) {
            try {
              const meta = JSON.parse(text);
              rebuilt.visible = Array.isArray(meta.visible) ? meta.visible : [];
              rebuilt.trashed = Array.isArray(meta.trashed) ? meta.trashed : [];
              sawMeta = true;
            } catch (e) {
              console.warn('GitHubSync: failed to parse', META_FILENAME, e.message);
            }
            continue;
          }
          try {
            rebuilt.all.push(JSON.parse(text));
          } catch (e) {
            console.warn(`GitHubSync: skipping malformed file '${path}':`, e.message);
          }
        }
        if (!sawMeta) console.warn(`GitHubSync: no ${META_FILENAME} in repo — visible/trashed will be empty`);

        const merged = mergePull(rebuilt, {all: tw.tiddlers.all, trashed: tw.tiddlers.trashed});
        const keptLocal = merged.all.length - rebuilt.all.length;
        const updated = rebuilt.all.length - reuse.length; // new/changed tiddlers actually pulled
        Object.assign(tw.tiddlers, merged);
        tw.run.save();
        if (!updated) {
          tw.ui.notify('Pull complete — no changes', 'S');
        } else {
          const extra = keptLocal ? `, ${keptLocal} kept local` : '';
          tw.ui.notify(`Pull complete! (${updated} updated${extra})`, 'S');
        }
        // if (confirm('Pull complete. Would you like to reload?')) tw.events.send('reboot.hard');
      } catch (e) {
        console.error('GitHubSync pull', e);
        tw.ui.notify(`Pull failed: ${e.message} (see console log)`, 'E');
      }
    },
  };

  // Merge a freshly-pulled remote snapshot over the local store without losing
  // local data. The remote wins on a title collision (a pull brings the repo's
  // version of a shared tiddler), but any local tiddler the remote does not have
  // is preserved. That covers both never-pushed local-only tiddlers
  // ($GeneralSettings, $NoSynch/$NoBackup) and freshly-created tiddlers not yet
  // pushed — without this, a pull silently dropped new tiddlers (e.g. BibleTest).
  // Trade-off: a tiddler deleted on another client is not removed here on pull;
  // remote deletions are reconciled via the trashed list, not by mere absence.
  function mergePull(remote, local) {
    const titles = new Set(remote.all.map(t => t.title));
    const trashedTitles = new Set(remote.trashed.map(t => t.title));
    return {
      all: [...remote.all, ...local.all.filter(t => !titles.has(t.title))],
      visible: remote.visible,
      trashed: [...remote.trashed, ...local.trashed.filter(t => !trashedTitles.has(t.title))],
    };
  }

  // Split the remote tree into blobs that must be fetched vs. ones whose local
  // copy is already byte-identical (same Git blob SHA → same bytes, so there is
  // nothing to download — keep the local object). The meta sidecar is always
  // fetched: it is not a tiddler and its visible/trashed lists change often.
  function partitionPull(managed, localShaByPath, metaPath) {
    const fetch = [];
    const reuse = [];
    for (const blob of managed) {
      if (blob.path !== metaPath && localShaByPath.get(blob.path) === blob.sha) reuse.push(blob.path);
      else fetch.push(blob);
    }
    return {fetch, reuse};
  }

  // Parse a tiddler's `updated` field to epoch ms for comparison; a missing or
  // unparseable date sorts oldest (0) so any timestamped record beats it.
  function updatedMs(t) {
    const ms = t && t.updated ? new Date(t.updated).getTime() : NaN;
    return Number.isNaN(ms) ? 0 : ms;
  }

  // Content fingerprint that ignores the volatile timestamps — two records are
  // the "same outcome" when their content matches even if `updated` differs.
  function contentKey(t) {
    return JSON.stringify({...t, updated: undefined, created: undefined});
  }
  function sameOutcome(l, r) {
    if (l.dead && r.dead) return true; // both deleted → identical result
    if (l.dead !== r.dead) return false; // one deleted, one live → differ
    return contentKey(l.rec) === contentKey(r.rec); // both live → compare content
  }

  // Bidirectional last-write-wins reconcile with a clock-skew guard. Given the
  // local and remote live tiddlers plus tombstones (deleted-tiddler records, each
  // carrying the deletion `updated` time), decide per title:
  //   - present on one side only            → keep it
  //   - same outcome on both                → no change (prefer the remote copy)
  //   - differ, timestamps > windowMs apart → newest `updated` wins (confident):
  //       a live edit beats a stale delete (un-delete); a fresh delete beats a
  //       stale copy (no resurrection)
  //   - differ, timestamps <= windowMs apart → UNCERTAIN (clock skew / near-
  //       simultaneous): not auto-resolved — emitted in `conflicts` for the caller
  //       to resolve with the user.
  // windowMs = 0 disables the guard (pure LWW); on an exact-ms tie a live record
  // beats a tombstone, else the local record wins. Returns {live, tombstones,
  // conflicts}. Pure — no tw refs.
  function reconcileLWW(localLive, localTomb, remoteLive, remoteTomb, windowMs = 0) {
    const index = (liveArr, tombArr) => {
      const m = new Map();
      liveArr.forEach(r => m.set(r.title, {rec: r, dead: false}));
      tombArr.forEach(r => m.set(r.title, {rec: r, dead: true}));
      return m;
    };
    const localBy = index(localLive, localTomb);
    const remoteBy = index(remoteLive, remoteTomb);

    const live = [];
    const tombstones = [];
    const conflicts = [];
    const place = e => (e.dead ? tombstones : live).push(e.rec);
    const pickNewer = (l, r) => {
      const dt = updatedMs(l.rec) - updatedMs(r.rec);
      if (dt > 0) return l;
      if (dt < 0) return r;
      return l.dead && !r.dead ? r : l; // exact tie: a live record beats a tombstone, else local
    };

    for (const title of new Set([...localBy.keys(), ...remoteBy.keys()])) {
      const l = localBy.get(title);
      const r = remoteBy.get(title);
      if (!l) place(r);
      else if (!r) place(l);
      else if (sameOutcome(l, r))
        place(r); // identical result — prefer remote so nothing is re-pushed
      else if (windowMs > 0 && Math.abs(updatedMs(l.rec) - updatedMs(r.rec)) <= windowMs) {
        conflicts.push({title, local: l.rec, remote: r.rec, localDead: l.dead, remoteDead: r.dead});
      } else place(pickNewer(l, r));
    }
    return {live, tombstones, conflicts};
  }

  // Count how many winners are a change to the LOCAL store (for the synch
  // report): a live winner the local store lacked or held at a different version,
  // or a tombstone the local store hadn't recorded yet.
  function countPulled(localLive, localTomb, winners) {
    const liveByTitle = new Map(localLive.map(t => [t.title, t]));
    const tombTitles = new Set(localTomb.map(t => t.title));
    let n = 0;
    for (const w of winners.live) {
      const l = liveByTitle.get(w.title);
      if (!l || updatedMs(l) !== updatedMs(w)) n++;
    }
    for (const w of winners.tombstones) if (!tombTitles.has(w.title)) n++;
    return n;
  }

  // Map items through an async fn with at most `limit` calls in flight at once,
  // returning results in input order. Bounds the parallel blob fetches on pull.
  async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    }
    await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
    return results;
  }

  // One push attempt: mirror the local store up (local authoritative — the
  // standalone Push button). Reads HEAD fresh so a 422 retry diffs on the latest
  // remote state.
  async function attemptPush(cfg, desired) {
    const head = await getHead(cfg); // {commitSha, treeSha} | null on an empty repo
    const existing = head ? await listManagedBlobs(cfg, head.treeSha) : []; // [{path, sha}]
    const result = await commitDesired(cfg, head, existing, desired);
    if (!result) return tw.ui.notify('Already up to date — nothing to push', 'S');
    console.log('GitHubSync push', result);
    tw.ui.notify(`Push complete! (Created ${result.added.length}, updated ${result.updated.length}, deleted ${result.deleted.length}, commit ${result.commitSha.slice(0, 7)})`, 'S');
  }

  // One synch attempt: read the current remote, reconcile local⇄remote by
  // last-write-wins, commit the converged set as a single atomic commit, then
  // apply it to the local store. The local store is mutated only AFTER the remote
  // commit succeeds, so a 422 retry never leaves local ahead of remote. Throws
  // .status===422 if the branch tip moved (the caller retries against the new tip).
  async function attemptSynch(cfg) {
    const remote = await readRemoteState(cfg);
    const localLive = tw.tiddlers.all.filter(t => !isLocalOnly(t));
    const localTomb = tw.tiddlers.trashed.filter(t => !isLocalOnly(t));
    const winners = reconcileLWW(localLive, localTomb, remote.remoteLive, remote.remoteTomb, cfg.conflictWindowMs);

    // Clock-skew guard: when the two sides' timestamps are within conflictWindowMs
    // the ordering isn't trustworthy, so reconcile defers rather than guessing.
    // Let the user resolve them all in one dialog, then fold the choices in.
    if (winners.conflicts.length) {
      const decisions = await resolveConflicts(cfg, winners.conflicts); // throws {cancelled:true} if dismissed
      winners.conflicts.forEach((c, i) => {
        const e = decisions[i] ? {rec: c.local, dead: c.localDead} : {rec: c.remote, dead: c.remoteDead};
        (e.dead ? winners.tombstones : winners.live).push(e.rec);
      });
    }
    const pulled = countPulled(localLive, localTomb, winners);

    // Push the converged set in one commit. Tombstone winners simply aren't in
    // `desired`, so commitDesired removes their remote blob (delete-by-absence).
    const desired = desiredFromWinners(cfg, winners, tw.tiddlers.visible);
    const result = await commitDesired(cfg, remote.head, remote.existing, desired);

    if (pulled > 0) applyReconciled(winners); // only touch local when something actually changed here
    if (!result && pulled === 0) return tw.ui.notify('Synch complete — already in sync', 'S');

    const conflictNote = winners.conflicts.length ? `, ${winners.conflicts.length} conflict(s) resolved` : '';
    const pushed = result ? `pushed +${result.added.length} ~${result.updated.length} −${result.deleted.length}` : 'no push needed';
    if (result) console.log('GitHubSync synch', {...result, pulled, conflicts: winners.conflicts.length});
    tw.ui.notify(`Synch complete! (${pushed}; pulled ${pulled}${conflictNote})`, 'S');
  }

  // Resolve all too-close-to-auto-resolve conflicts in one modal. Resolves to an
  // array of booleans (keepLocal, in conflict order); rejects with a
  // {cancelled:true} error if the user dismisses the dialog (which aborts the
  // synch — nothing is committed). Falls back to per-conflict confirm() where a
  // native <dialog> isn't available. Self-contained (no theme CSS), matching the
  // platform's compat-dialog approach.
  function resolveConflicts(cfg, conflicts) {
    if (typeof document === 'undefined' || typeof window.HTMLDialogElement === 'undefined') {
      const decisions = conflicts.map(c => confirmConflict(cfg, c));
      return Promise.resolve(decisions);
    }
    injectConflictStyles();
    return new Promise((resolve, reject) => {
      const dlg = el('dialog', 'ghsync-conflicts');

      const head = el('div', 'ghsync-c-head');
      const h = el('h2');
      h.textContent = `Resolve sync conflicts (${conflicts.length})`;
      const sub = el('p');
      sub.textContent = `These tiddlers changed on both sides within ${Math.round(cfg.conflictWindowMs / 1000)}s — too close to order reliably. Pick which version to keep.`;
      head.append(h, sub);

      const bulk = el('div', 'ghsync-c-bulk');
      const allLocal = btn('Keep all local');
      const allRemote = btn('Keep all remote');
      bulk.append(allLocal, allRemote);

      const list = el('div', 'ghsync-c-list');
      conflicts.forEach((c, i) => list.appendChild(conflictRow(c, i)));

      const foot = el('div', 'ghsync-c-foot');
      const cancel = btn('Cancel');
      const apply = btn('Apply', 'primary');
      foot.append(cancel, apply);

      dlg.append(head, bulk, list, foot);
      document.body.appendChild(dlg);

      const setAll = value => dlg.querySelectorAll(`input[type=radio][value="${value}"]`).forEach(r => (r.checked = true));
      allLocal.onclick = () => setAll('local');
      allRemote.onclick = () => setAll('remote');
      cancel.onclick = () => dlg.close('cancel');
      apply.onclick = () => dlg.close('apply');

      dlg.addEventListener('close', () => {
        const applied = dlg.returnValue === 'apply';
        const decisions = conflicts.map((c, i) => {
          const sel = dlg.querySelector(`input[name="conflict-${i}"]:checked`);
          return sel ? sel.value === 'local' : updatedMs(c.local) >= updatedMs(c.remote);
        });
        dlg.remove();
        if (applied) return resolve(decisions);
        const e = new Error('Synch cancelled — conflicts not resolved');
        e.cancelled = true;
        reject(e);
      });
      dlg.showModal();
    });
  }

  // One conflict row: title + two mutually-exclusive options (local/remote), each
  // showing what happened (edited/deleted), when, and a short content preview.
  // The newer side is pre-selected (the best-guess LWW pick the user can override).
  function conflictRow(c, i) {
    const localNewer = updatedMs(c.local) >= updatedMs(c.remote);
    const row = el('div', 'ghsync-c-row');
    const title = el('div', 'ghsync-c-title');
    title.textContent = c.title;
    row.append(title, conflictOption(i, 'local', c.localDead, c.local, localNewer), conflictOption(i, 'remote', c.remoteDead, c.remote, !localNewer));
    return row;
  }
  function conflictOption(i, side, dead, rec, checked) {
    const label = el('label', 'ghsync-c-opt');
    const input = el('input');
    input.type = 'radio';
    input.name = `conflict-${i}`;
    input.value = side;
    input.checked = checked;
    const meta = el('span', 'ghsync-c-meta');
    const when = rec.updated ? new Date(rec.updated).toLocaleString() : '—';
    meta.textContent = `Keep ${side} — ${dead ? 'deleted' : 'edited'} ${when}`;
    const preview = el('div', 'ghsync-c-preview');
    preview.textContent = dead ? '(this version deletes the tiddler)' : truncate(rec.text || '', 200);
    label.append(input, meta, preview);
    return label;
  }

  // Per-conflict confirm() fallback (no <dialog> support). Returns keepLocal.
  function confirmConflict(cfg, c) {
    const when = d => (d ? new Date(d).toLocaleString() : '—');
    return window.confirm(
      `Sync conflict on "${c.title}" — within ${Math.round(cfg.conflictWindowMs / 1000)}s, too close to auto-resolve.\n\n` +
        `Local:  ${c.localDead ? 'deleted' : 'edited'} ${when(c.local.updated)}\n` +
        `Remote: ${c.remoteDead ? 'deleted' : 'edited'} ${when(c.remote.updated)}\n\n` +
        'OK = keep LOCAL, Cancel = keep REMOTE.',
    );
  }

  function el(tag, cls) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  }
  function btn(text, cls) {
    const b = el('button', cls);
    b.type = 'button';
    b.textContent = text;
    return b;
  }
  function truncate(s, n) {
    s = String(s).replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) + '…' : s;
  }
  function injectConflictStyles() {
    if (document.getElementById('ghsync-conflicts-style')) return;
    const style = el('style');
    style.id = 'ghsync-conflicts-style';
    style.textContent = `
dialog.ghsync-conflicts{width:min(92vw,640px);max-height:85vh;padding:0;border:none;border-radius:10px;box-shadow:0 12px 48px rgba(0,0,0,.35);color:#1d1f23;background:#fff;font:14px/1.5 system-ui,-apple-system,sans-serif}
dialog.ghsync-conflicts::backdrop{background:rgba(0,0,0,.45)}
.ghsync-c-head{padding:1rem 1.25rem .5rem}
.ghsync-c-head h2{margin:0 0 .25rem;font-size:1.05rem}
.ghsync-c-head p{margin:0;color:#5b6068;font-size:.85rem}
.ghsync-c-bulk{display:flex;gap:.5rem;padding:0 1.25rem .75rem}
.ghsync-c-list{overflow:auto;max-height:55vh;padding:0 1.25rem;border-top:1px solid #e6e8eb}
.ghsync-c-row{padding:.75rem 0;border-bottom:1px solid #eef0f2}
.ghsync-c-title{font-weight:600;margin-bottom:.4rem;word-break:break-word}
.ghsync-c-opt{display:block;padding:.4rem .55rem;border:1px solid #e6e8eb;border-radius:6px;margin-bottom:.35rem;cursor:pointer}
.ghsync-c-opt:has(input:checked){border-color:#2f6bff;background:#f0f6ff}
.ghsync-c-meta{font-weight:500;margin-left:.35rem}
.ghsync-c-preview{margin:.3rem 0 0 1.6rem;color:#5b6068;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
.ghsync-c-foot{display:flex;justify-content:flex-end;gap:.5rem;padding:.75rem 1.25rem 1rem;border-top:1px solid #e6e8eb}
.ghsync-conflicts button{padding:.4rem .85rem;border-radius:6px;border:1px solid #c9ccd1;background:#f4f5f7;cursor:pointer;font:inherit}
.ghsync-conflicts button.primary{background:#2f6bff;border-color:#2f6bff;color:#fff}
@media(prefers-color-scheme:dark){
dialog.ghsync-conflicts{background:#1c1f24;color:#e6e8eb}
.ghsync-c-head p,.ghsync-c-preview{color:#9aa0a8}
.ghsync-c-list,.ghsync-c-foot{border-color:#2c313a}
.ghsync-c-row{border-color:#262b33}
.ghsync-c-opt{border-color:#2c313a}
.ghsync-c-opt:has(input:checked){border-color:#4f8cff;background:#16243a}
.ghsync-conflicts button{background:#2a2f37;border-color:#3a4049;color:#e6e8eb}
.ghsync-conflicts button.primary{background:#2f6bff;border-color:#2f6bff;color:#fff}
}`;
    document.head.appendChild(style);
  }

  // Read the remote into the shape reconcile needs: the full live tiddler set and
  // the tombstone list. Byte-identical blobs (same Git SHA as the local copy)
  // reuse the local object instead of being downloaded; only changed/new blobs
  // are fetched (bounded parallelism). Tombstones come from the meta sidecar.
  async function readRemoteState(cfg) {
    const head = await getHead(cfg);
    if (!head) return {head: null, existing: [], remoteLive: [], remoteTomb: []};
    const existing = await listManagedBlobs(cfg, head.treeSha); // [{path, sha}] incl. meta
    const metaP = metaPath(cfg);

    const localByPath = new Map();
    const localShaByPath = new Map();
    for (const t of tw.tiddlers.all.filter(t => !isLocalOnly(t))) {
      const path = filePath(cfg, t.title);
      localByPath.set(path, t);
      localShaByPath.set(path, await gitBlobSha(JSON.stringify(t, null, 2)));
    }

    const tiddlerBlobs = existing.filter(e => e.path !== metaP);
    const toFetch = tiddlerBlobs.filter(b => localShaByPath.get(b.path) !== b.sha);
    const reuse = tiddlerBlobs.filter(b => localShaByPath.get(b.path) === b.sha);
    const fetched = await mapLimit(toFetch, PULL_CONCURRENCY, async b => {
      try {
        return JSON.parse(await getBlobText(cfg, b.sha));
      } catch (e) {
        console.warn(`GitHubSync: skipping malformed file '${b.path}':`, e.message);
        return null;
      }
    });
    const remoteLive = [...reuse.map(b => localByPath.get(b.path)), ...fetched.filter(Boolean)];

    let remoteTomb = [];
    const metaBlob = existing.find(e => e.path === metaP);
    if (metaBlob) {
      try {
        const meta = JSON.parse(await getBlobText(cfg, metaBlob.sha));
        if (Array.isArray(meta.trashed)) remoteTomb = meta.trashed;
      } catch (e) {
        console.warn('GitHubSync: failed to parse', META_FILENAME, e.message);
      }
    }
    return {head, existing, remoteLive, remoteTomb};
  }

  // Replace the local store with the reconciled winners, preserving local-only
  // tiddlers (never synced) and dropping any open-tab entry whose tiddler no
  // longer exists. Re-renders so pulled changes show without a reload.
  function applyReconciled(winners) {
    const localOnlyLive = tw.tiddlers.all.filter(isLocalOnly);
    const localOnlyTomb = tw.tiddlers.trashed.filter(isLocalOnly);
    const all = [...winners.live, ...localOnlyLive];
    const titles = new Set(all.map(t => t.title));
    Object.assign(tw.tiddlers, {
      all,
      trashed: [...winners.tombstones, ...localOnlyTomb],
      visible: tw.tiddlers.visible.filter(title => titles.has(title)),
    });
    tw.run.save();
    tw.core.render.renderAllTiddlers?.();
  }

  // Build the desired remote file set from the winning live tiddlers + the meta
  // sidecar (visible list + tombstones). Fed to commitDesired.
  function desiredFromWinners(cfg, winners, visible) {
    const desired = {};
    for (const t of winners.live) desired[filePath(cfg, t.title)] = JSON.stringify(t, null, 2);
    desired[metaPath(cfg)] = JSON.stringify({format: FORMAT, visible, trashed: winners.tombstones}, null, 2);
    return desired;
  }

  // Diff `desired` against the remote tree by Git blob SHA-1 (identical content →
  // identical SHA, so unchanged files are skipped and inherited from base_tree),
  // commit the change set atomically, and fast-forward the branch ref. Returns
  // {added, updated, deleted, commitSha} or null when nothing differs. Shared by
  // push and synch. Throws .status===422 if the ref update is not a fast forward.
  async function commitDesired(cfg, head, existing, desired) {
    const remoteSha = new Map(existing.map(e => [e.path, e.sha]));
    const tree = [];
    const added = [];
    const updated = [];
    const deleted = [];
    for (const [path, content] of Object.entries(desired)) {
      const localSha = await gitBlobSha(content);
      const known = remoteSha.get(path);
      if (known === localSha) continue; // unchanged → inherited from base_tree
      tree.push({path, mode: '100644', type: 'blob', content});
      (known ? updated : added).push(path);
    }
    for (const {path} of existing) {
      if (!(path in desired)) {
        tree.push({path, mode: '100644', type: 'blob', sha: null});
        deleted.push(path);
      }
    }
    if (tree.length === 0) return null;

    const newTree = await gh(cfg, 'POST', `repos/${cfg.repo}/git/trees`, {
      base_tree: head ? head.treeSha : undefined,
      tree,
    });
    // On a small change set, name the changed tiddlers in the commit message; on
    // a larger one keep the terse prefix + timestamp. The meta sidecar isn't a
    // tiddler, so it's excluded from both the title list and the <5 threshold.
    const changedTitles = [...added, ...updated, ...deleted].filter(p => p !== metaPath(cfg)).map(titleFromPath);
    let message = `${cfg.commitMessage} ${new Date().toISOString()}`;
    if (changedTitles.length && changedTitles.length < 5) message += ': ' + changedTitles.join(', ');
    const commit = await gh(cfg, 'POST', `repos/${cfg.repo}/git/commits`, {
      message,
      tree: newTree.sha,
      parents: head ? [head.commitSha] : [],
    });
    if (head) {
      await gh(cfg, 'PATCH', `repos/${cfg.repo}/git/refs/heads/${cfg.branch}`, {sha: commit.sha});
    } else {
      await gh(cfg, 'POST', `repos/${cfg.repo}/git/refs`, {ref: `refs/heads/${cfg.branch}`, sha: commit.sha});
    }
    return {added, updated, deleted, commitSha: commit.sha};
  }

  function readConfig() {
    const config = tw.core.common.getSetting('synch.GithubRepo');
    if (!config || !config.accessToken) {
      tw.ui.notify('No accessToken found in $GeneralSettings.synch.GithubRepo!', 'W');
      return null;
    }
    if (!config.repo || !/^[^/]+\/[^/]+$/.test(config.repo)) {
      tw.ui.notify("Set $GeneralSettings.synch.GithubRepo.repo to 'owner/name'!", 'W');
      return null;
    }
    return {
      accessToken: config.accessToken,
      repo: config.repo,
      branch: config.branch || DEFAULT_BRANCH,
      dir: String(config.dir ?? DEFAULT_DIR).replace(/^\/+|\/+$/g, '') + '/' + tw.workspace,
      endpoint: config.endpoint || DEFAULT_ENDPOINT,
      commitMessage: config.commitMessage || DEFAULT_COMMIT_PREFIX,
      // Timestamps within this many ms are "too close to call" → prompt instead of
      // auto-resolving (clock-skew guard). Set 0 to disable and force pure LWW.
      conflictWindowMs: Number.isFinite(+config.conflictWindowMs) ? +config.conflictWindowMs : DEFAULT_CONFLICT_WINDOW_MS,
    };
  }

  // --- Change detection: Git's own blob hash ---

  // git stores a blob as sha1("blob <byteLength>\0" + content). Reproduce it so a
  // local tiddler's SHA can be compared to the repo tree's blob SHA with no fetch.
  async function gitBlobSha(text) {
    const enc = new TextEncoder();
    const body = enc.encode(text);
    const header = enc.encode(`blob ${body.length}\0`);
    const bytes = new Uint8Array(header.length + body.length);
    bytes.set(header, 0);
    bytes.set(body, header.length);
    const digest = await crypto.subtle.digest('SHA-1', bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // --- GitHub Git Data API helpers ---

  async function getHead(cfg) {
    const res = await fetch(api(cfg, `repos/${cfg.repo}/git/ref/heads/${cfg.branch}`), {headers: authHeaders(cfg)});
    if (res.status === 404 || res.status === 409) return null; // empty repo / branch not created yet
    if (!res.ok) throw await httpError(res);
    const ref = await res.json();
    const commit = await gh(cfg, 'GET', `repos/${cfg.repo}/git/commits/${ref.object.sha}`);
    return {commitSha: ref.object.sha, treeSha: commit.tree.sha};
  }

  async function listManagedBlobs(cfg, treeSha) {
    const tree = await gh(cfg, 'GET', `repos/${cfg.repo}/git/trees/${treeSha}?recursive=1`);
    const prefix = cfg.dir ? cfg.dir + '/' : '';
    return (tree.tree || []).filter(e => e.type === 'blob' && e.path.startsWith(prefix) && e.path.endsWith('.json')).map(e => ({path: e.path, sha: e.sha}));
  }
  async function getBlobText(cfg, sha) {
    const blob = await gh(cfg, 'GET', `repos/${cfg.repo}/git/blobs/${sha}`);
    return blob.encoding === 'base64' ? fromBase64Utf8(blob.content) : blob.content;
  }

  async function gh(cfg, method, path, body) {
    const res = await fetch(api(cfg, path), {
      method,
      headers: body == null ? authHeaders(cfg) : mutationHeaders(cfg),
      body: body == null ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw await httpError(res);
    return await res.json();
  }

  function api(cfg, path) {
    return tw.core.buildUrl(path, cfg.endpoint.replace(/\/?$/, '/'));
  }
  function filePath(cfg, title) {
    return (cfg.dir ? cfg.dir + '/' : '') + encodePathSegment(title) + '.json';
  }
  // Encode a title into a safe file path segment. Full URL-encoding
  // (encodeURIComponent) was overkill — it turned every space into %20, so
  // "1 Kings 22" became "1%20Kings%2022.json". Escape ONLY the characters that
  // are unsafe in a Git / cross-platform (Windows) path: the separators, the
  // reserved set <>:"|?*, control chars, and '%' itself (so percent-decoding on
  // read stays unambiguous). Spaces, parentheses and unicode stay readable.
  // Inverse: titleFromPath() via decodeURIComponent.
  function encodePathSegment(title) {
    return title.replace(/[%<>:"\/\\|?*\x00-\x1f]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
  }
  function metaPath(cfg) {
    return (cfg.dir ? cfg.dir + '/' : '') + META_FILENAME;
  }
  // Recover a tiddler title from its repo file path — inverse of filePath():
  // take the basename, drop '.json', percent-decode. Used to name the changed
  // tiddlers in the commit message on a small push.
  function titleFromPath(path) {
    return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, ''));
  }

  function authHeaders(cfg) {
    return {
      Authorization: 'Bearer ' + cfg.accessToken,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }
  function mutationHeaders(cfg) {
    return Object.assign(authHeaders(cfg), {'Content-Type': 'application/json'});
  }
  function fromBase64Utf8(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  }
  async function httpError(res) {
    let body = '';
    try {
      body = await res.text();
    } catch {}
    const err = new Error(`${res.status} ${res.statusText}${body ? ': ' + body.slice(0, 200) : ''}`);
    err.status = res.status;
    return err;
  }

  return {
    isLocalOnly, // exposed for unit testing
    mergePull, // exposed for unit testing; the platform reads only meta/init/start
    mapLimit, // exposed for unit testing
    partitionPull, // exposed for unit testing
    reconcileLWW, // exposed for unit testing
    countPulled, // exposed for unit testing
    meta: {
      name: 'GitHubSyncPlugin',
      version: '1.1.0',
      platform: '0.27.0',
      description: 'Incremental sync of tiddlers with a GitHub repository — commits only changed tiddlers (Git blob SHA diff, atomic commit via the Git Data API).',
    },
    init() {
      tw.extensions.registerMacro('ghsync', 'synch', sync.synch, {
        description: 'Button: push changed tiddlers to the configured GitHub repository.',
        example: '<<ghsync.synch>>',
      });
      tw.extensions.registerMacro('ghsync', 'push', sync.push, {
        description: 'Button: push changed tiddlers to the configured GitHub repository.',
        example: '<<ghsync.push>>',
      });
      tw.extensions.registerMacro('ghsync', 'pull', sync.pull, {
        description: 'Button: pull the workspace from the configured GitHub repository.',
        example: '<<ghsync.pull>>',
      });
      tw.extensions.registerCommand([
        {label: 'GitHub: Synch', event: 'ghsync.synch'},
        {label: 'GitHub: Push', event: 'ghsync.push'},
        {label: 'GitHub: Pull', event: 'ghsync.pull'},
      ]);
    },
    start() {
      // push()/pull() return promises (not HTML), so they're wired as events.
      // override() keeps a single handler across soft reloads.
      tw.events.override('ghsync.synch', sync.doSynch);
      tw.events.override('ghsync.push', sync.doPush);
      tw.events.override('ghsync.pull', sync.doPull);
    },
  };
})();
