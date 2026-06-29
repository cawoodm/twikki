(function () {
  const meta = {
    name: 'MigrateStorageKeys',
    version: '1.0.0',
    platform: '0.28.0',
    description: 'Migrate legacy bare global storage keys (/workspaces, …) into the /ws/ root. Run on demand from the button.',
  };

  // Single-segment, device-LOCAL control keys that look like globals but must NOT
  // move (the boot-script slot, its dismiss dates, the legacy module cache).
  const isControlKey = k => k.startsWith('/twikki.') || k.startsWith('/modules/');

  // A legacy global is one top-level segment (`/workspaces`) — as opposed to a
  // current global (`/ws/workspaces`) or workspace-scoped data (`/ws/<name>/<key>`),
  // both of which start with `/ws/` and so never match.
  const isLegacyGlobal = k => /^\/[^/]+$/.test(k) && !isControlKey(k);

  // Relocate every legacy global to its `/ws/`-prefixed counterpart, letting the
  // legacy value win over any default-init the core wrote this boot, then drop the
  // source. Returns the number of keys moved.
  function migrate() {
    let moved = 0;
    for (const k of tw.storage.keys('/')) {
      if (!isLegacyGlobal(k)) continue;
      const raw = tw.storage.getRaw(k);
      if (raw === null) continue;
      const target = '/ws' + k; // `/workspaces` → `/ws/workspaces`
      tw.storage.setRaw(target, raw);
      tw.storage.remove(k);
      moved++;
      dp(`MigrateStorageKeys: ${k} → ${target}`);
    }
    return moved;
  }

  function run() {
    const moved = migrate();
    if (!moved) return tw.ui.notify('No legacy storage keys found — nothing to migrate.', 'I');
    // reboot.hard flushes pending writes before reloading (see rebootHard), so the
    // relocations commit and there is no migrate→reboot loop. The reload preserves
    // any `?ws=<name>` query, which now resolves against the restored list.
    tw.ui.notify(`Migrated ${moved} legacy storage key(s) to the /ws/ root. Reloading…`, 'S');
    tw.events.send('reboot.hard');
  }

  return {
    meta,
    init() {
      tw.events.subscribe('migratekeys.run', run, 'MigrateStorageKeys');
    },
  };
})();
