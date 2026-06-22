import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

// The plugin is a self-invoking IIFE returning {meta, init, start, mergePull}.
// It touches no globals at eval time (tw/dp/fetch are only referenced inside
// function bodies), so we can eval it bare and read the pure merge helper.
function loadPlugin() {
  const code = readFileSync(join(root, 'src/packages/demo/GitHubSyncPlugin/GitHubSyncPlugin.js'), 'utf8');
  return (0, eval)(code);
}

test('mergePull keeps a local tiddler that the remote does not have', () => {
  const {mergePull} = loadPlugin();
  const remote = {all: [{title: 'A'}], visible: ['A'], trashed: []};
  const local = {all: [{title: 'A', text: 'stale'}, {title: 'BibleTest', text: 'new'}], trashed: []};

  const merged = mergePull(remote, local);

  assert.deepEqual(
    merged.all.map(t => t.title).sort(),
    ['A', 'BibleTest'],
    'a freshly-created local tiddler is preserved, not dropped',
  );
});

test('mergePull lets the remote win on a title collision', () => {
  const {mergePull} = loadPlugin();
  const remote = {all: [{title: 'A', text: 'remote'}], visible: [], trashed: []};
  const local = {all: [{title: 'A', text: 'local'}], trashed: []};

  const merged = mergePull(remote, local);

  assert.equal(merged.all.length, 1);
  assert.equal(merged.all[0].text, 'remote', 'pull brings the remote version of a shared tiddler');
});

test('mergePull preserves local trashed tiddlers absent from the remote', () => {
  const {mergePull} = loadPlugin();
  const remote = {all: [], visible: [], trashed: [{title: 'X'}]};
  const local = {all: [], trashed: [{title: 'X'}, {title: 'LocalDeleted'}]};

  const merged = mergePull(remote, local);

  assert.deepEqual(merged.trashed.map(t => t.title).sort(), ['LocalDeleted', 'X']);
});

test('mergePull passes the remote visible list through unchanged', () => {
  const {mergePull} = loadPlugin();
  const remote = {all: [{title: 'A'}], visible: ['A'], trashed: []};
  const local = {all: [], trashed: []};

  const merged = mergePull(remote, local);

  assert.deepEqual(merged.visible, ['A']);
});

// --- isLocalOnly: what the sync must never push / must preserve locally ---
test('isLocalOnly excludes doNotSave, $GeneralSettings, $NoSynch/$NoBackup; keeps normal tiddlers', () => {
  const {isLocalOnly} = loadPlugin();
  assert.equal(isLocalOnly({title: 'My Note', tags: []}), false, 'a normal tiddler syncs');
  assert.equal(isLocalOnly({title: '$BaseReset', tags: ['$StyleSheet'], doNotSave: true}), true, 'doNotSave defaults are not synced');
  assert.equal(isLocalOnly({title: '$GeneralSettings', tags: []}), true, 'the PAT-holding settings stay local');
  assert.equal(isLocalOnly({title: 'X', tags: ['$NoSynch']}), true);
  assert.equal(isLocalOnly({title: 'Y', tags: ['$NoBackup']}), true);
  assert.equal(isLocalOnly({title: 'Z', tags: ['$StyleSheet'], doNotSave: false}), false, 'doNotSave:false still syncs');
});

// --- reconcileLWW: bidirectional last-write-wins (the doSynch core) ---
const OLD = '2026-01-01T00:00:00.000Z';
const NEW = '2026-06-01T00:00:00.000Z';
const live = (title, updated, text) => ({title, updated, text});

test('reconcileLWW: a newer LOCAL edit beats the remote (the reported bug)', () => {
  const {reconcileLWW} = loadPlugin();
  const r = reconcileLWW([live('A', NEW, 'local')], [], [live('A', OLD, 'remote')], []);
  assert.deepEqual(r.tombstones, []);
  assert.equal(r.live.length, 1);
  assert.equal(r.live[0].text, 'local', 'the newer local edit must survive, not be clobbered');
});

test('reconcileLWW: a newer REMOTE edit beats the local copy', () => {
  const {reconcileLWW} = loadPlugin();
  const r = reconcileLWW([live('A', OLD, 'local')], [], [live('A', NEW, 'remote')], []);
  assert.equal(r.live.length, 1);
  assert.equal(r.live[0].text, 'remote');
});

test('reconcileLWW: a newer LOCAL delete is not resurrected by a stale remote copy', () => {
  const {reconcileLWW} = loadPlugin();
  const r = reconcileLWW([], [live('A', NEW)], [live('A', OLD, 'remote')], []);
  assert.deepEqual(r.live, [], 'the deleted tiddler must stay gone');
  assert.deepEqual(r.tombstones.map(t => t.title), ['A']);
});

test('reconcileLWW: a newer REMOTE delete removes a stale local copy', () => {
  const {reconcileLWW} = loadPlugin();
  const r = reconcileLWW([live('A', OLD, 'local')], [], [], [live('A', NEW)]);
  assert.deepEqual(r.live, []);
  assert.deepEqual(r.tombstones.map(t => t.title), ['A']);
});

test('reconcileLWW: a newer edit un-deletes (beats a stale tombstone)', () => {
  const {reconcileLWW} = loadPlugin();
  const r = reconcileLWW([live('A', NEW, 'revived')], [], [], [live('A', OLD)]);
  assert.deepEqual(r.tombstones, []);
  assert.equal(r.live[0].text, 'revived');
});

test('reconcileLWW: tiddlers unique to one side are kept', () => {
  const {reconcileLWW} = loadPlugin();
  const r = reconcileLWW([live('LocalOnly', NEW)], [], [live('RemoteOnly', NEW)], []);
  assert.deepEqual(r.live.map(t => t.title).sort(), ['LocalOnly', 'RemoteOnly']);
});

test('reconcileLWW: on an exact timestamp tie a live record beats a tombstone', () => {
  const {reconcileLWW} = loadPlugin();
  const r = reconcileLWW([live('A', NEW, 'kept')], [], [], [live('A', NEW)]);
  assert.deepEqual(r.tombstones, [], 'a tie must not silently delete');
  assert.equal(r.live[0].text, 'kept');
});

// --- reconcileLWW clock-skew guard (conflict window) ---
const T0 = '2026-06-01T00:00:00.000Z';
const T30s = '2026-06-01T00:00:30.000Z';
const T5m = '2026-06-01T00:05:00.000Z';

test('reconcileLWW: diverging edits within the window are reported, not auto-resolved', () => {
  const {reconcileLWW} = loadPlugin();
  const r = reconcileLWW([live('A', T30s, 'local')], [], [live('A', T0, 'remote')], [], 60_000);
  assert.deepEqual(r.live, [], 'no auto-winner is placed for an uncertain call');
  assert.deepEqual(r.tombstones, []);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].title, 'A');
  assert.equal(r.conflicts[0].local.text, 'local');
  assert.equal(r.conflicts[0].remote.text, 'remote');
});

test('reconcileLWW: outside the window the newer side wins confidently (no conflict)', () => {
  const {reconcileLWW} = loadPlugin();
  const r = reconcileLWW([live('A', T5m, 'local')], [], [live('A', T0, 'remote')], [], 60_000);
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.live[0].text, 'local');
});

test('reconcileLWW: identical content within the window is NOT a conflict', () => {
  const {reconcileLWW} = loadPlugin();
  const r = reconcileLWW([live('A', T30s, 'same')], [], [live('A', T0, 'same')], [], 60_000);
  assert.equal(r.conflicts.length, 0, 'same content → nothing to decide');
  assert.equal(r.live.length, 1);
});

test('reconcileLWW: an edit-vs-delete straddle within the window is a conflict', () => {
  const {reconcileLWW} = loadPlugin();
  const r = reconcileLWW([live('A', T30s, 'edited')], [], [], [live('A', T0)], 60_000);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].localDead, false);
  assert.equal(r.conflicts[0].remoteDead, true);
});

test('reconcileLWW: window 0 (disabled) keeps pure LWW with the live-beats-tombstone tie-break', () => {
  const {reconcileLWW} = loadPlugin();
  const r = reconcileLWW([live('A', NEW, 'kept')], [], [], [live('A', NEW)]); // no window arg → 0
  assert.equal(r.conflicts.length, 0);
  assert.deepEqual(r.tombstones, []);
  assert.equal(r.live[0].text, 'kept');
});

test('countPulled counts only winners that change the local store', () => {
  const {countPulled} = loadPlugin();
  const localLive = [live('Same', OLD, 'x'), live('LocalNewer', NEW, 'x')];
  const localTomb = [];
  const winners = {
    live: [live('Same', OLD, 'x'), live('LocalNewer', NEW, 'x'), live('FromRemote', NEW, 'y')],
    tombstones: [live('RemoteDeleted', NEW)],
  };
  // Same+LocalNewer already match local → not counted; FromRemote + RemoteDeleted are new → 2.
  assert.equal(countPulled(localLive, localTomb, winners), 2);
});

test('mapLimit returns results in input order regardless of completion order', async () => {
  const {mapLimit} = loadPlugin();
  const delays = [20, 1, 15, 2, 8];

  const out = await mapLimit(delays, 2, async (d, i) => {
    await new Promise(r => setTimeout(r, d));
    return i;
  });

  assert.deepEqual(out, [0, 1, 2, 3, 4], 'output index matches input index');
});

test('mapLimit never runs more than `limit` tasks concurrently', async () => {
  const {mapLimit} = loadPlugin();
  let inFlight = 0;
  let maxInFlight = 0;

  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async x => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(r => setTimeout(r, 5));
    inFlight--;
    return x * 2;
  });

  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14]);
  assert.ok(maxInFlight <= 3, `peak concurrency ${maxInFlight} must not exceed the limit of 3`);
  assert.ok(maxInFlight >= 2, `peak concurrency ${maxInFlight} shows tasks actually overlapped`);
});

test('mapLimit handles an empty list without invoking the mapper', async () => {
  const {mapLimit} = loadPlugin();
  let called = false;

  const out = await mapLimit([], 4, async () => (called = true));

  assert.deepEqual(out, []);
  assert.equal(called, false);
});

const META = 'd/_twikki.meta.json';

test('partitionPull reuses a blob whose remote SHA matches the local copy', () => {
  const {partitionPull} = loadPlugin();
  const managed = [
    {path: 'd/A.json', sha: 'aaa'},
    {path: 'd/B.json', sha: 'bbb'},
  ];
  const localSha = new Map([
    ['d/A.json', 'aaa'], // unchanged
    ['d/B.json', 'zzz'], // remote differs
  ]);

  const {fetch, reuse} = partitionPull(managed, localSha, META);

  assert.deepEqual(reuse, ['d/A.json']);
  assert.deepEqual(fetch.map(b => b.path), ['d/B.json']);
});

test('partitionPull fetches a blob the local store does not have', () => {
  const {partitionPull} = loadPlugin();
  const managed = [{path: 'd/New.json', sha: 'n'}];

  const {fetch, reuse} = partitionPull(managed, new Map(), META);

  assert.deepEqual(reuse, []);
  assert.deepEqual(fetch.map(b => b.path), ['d/New.json']);
});

test('partitionPull always fetches the meta sidecar even if a local SHA matches', () => {
  const {partitionPull} = loadPlugin();
  const managed = [{path: META, sha: 'm'}];
  const localSha = new Map([[META, 'm']]);

  const {fetch, reuse} = partitionPull(managed, localSha, META);

  assert.deepEqual(reuse, []);
  assert.deepEqual(fetch.map(b => b.path), [META]);
});

test('partitionPull fetches nothing but meta when every tiddler is unchanged', () => {
  const {partitionPull} = loadPlugin();
  const managed = [
    {path: 'd/A.json', sha: 'a'},
    {path: 'd/B.json', sha: 'b'},
    {path: META, sha: 'm'},
  ];
  const localSha = new Map([
    ['d/A.json', 'a'],
    ['d/B.json', 'b'],
  ]);

  const {fetch, reuse} = partitionPull(managed, localSha, META);

  assert.deepEqual(reuse.sort(), ['d/A.json', 'd/B.json']);
  assert.deepEqual(fetch.map(b => b.path), [META], 'only the meta sidecar is fetched');
});
