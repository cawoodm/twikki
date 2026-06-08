// tags: $Plugin

/**
 * ## Description
 * Registers a command palette command (Ctrl/Cmd+K) that closes every open
 * note except the *active* one — the note you last opened / navigated to.
 *
 * Finding the active note:
 *   - We subscribe to `tiddler.show` (the event fired whenever a note is opened
 *     or re-shown) and remember its title on `tw.tmp.activeNote`. This beats the
 *     "last in tw.tiddlers.visible" heuristic, which misses re-showing a note
 *     that is already open (showTiddler doesn't reorder the visible list).
 *   - Tabs layout: `tw.tabs.active` (the selected tab) takes precedence.
 *   - Fallback: the most recently opened note (last in `tw.tiddlers.visible`).
 */
(function() {

  tw.tmp = tw.tmp || {};

  // Remember the most recently shown note. Deduped across soft reloads by the
  // handler name; the title lives on tw.tmp (not this closure) so a re-eval keeps
  // reading the value the live handler writes.
  tw.events.subscribe('tiddler.show', recordActiveNote);
  function recordActiveNote(title) {
    if (typeof title === 'string') tw.tmp.activeNote = title;
  }

  tw.extensions.registerCommand({
    label: 'Close all but active note',
    run: closeAllButActive,
  });

  function activeNote() {
    let open = tw.tiddlers.visible;
    let active = (tw.tabs && tw.tabs.active) || tw.tmp.activeNote;
    if (active && open.includes(active)) return active;
    return open[open.length - 1] || null; // fallback: most recently opened
  }

  function closeAllButActive() {
    let open = tw.tiddlers.visible;
    if (open.length <= 1) return tw.ui.notify('Nothing to close', 'I');
    let keep = activeNote();
    // filter() snapshots before we close — tw.tiddlers.visible mutates as each closes.
    open.filter(title => title !== keep).forEach(title => tw.events.send('tiddler.close', title));
    // Re-show the kept note: it's already open, so showTiddler early-returns into
    // scrollToTiddler() (and refocuses its tab in tabs mode).
    if (keep) tw.events.send('tiddler.show', keep);
    tw.ui.notify(`Closed ${open.length - 1} note(s), kept '${keep}'`, 'D');
  }

})();
