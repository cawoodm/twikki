// tags: $Plugin

/**
 * ## Description
 * Provide a <<github.link>> button for the $TiddlerDisplay title bar.
 *
 * Clicking it opens the current tiddler's file in the configured GitHub repo on
 * github.com. It reads the SAME settings as GitHubSyncPlugin
 * ($Settings.synch.GithubRepo: repo, branch, dir) and reconstructs the
 * web URL the way GitHubSyncPlugin builds the file path — so the link points at
 * exactly the blob that sync pushes.
 *
 * Add `<<github.link>>` to your [[$TiddlerDisplay]] template (see the demo override).
 */
(function () {
  const meta = {
    name: 'GithubSynchLinkPlugin',
    version: '1.0.0',
    platform: '0.27.0',
    description: "Adds a <<github.link>> button that opens the current tiddler on GitHub, using GitHubSyncPlugin's repo settings.",
  };

  // Defaults mirror GitHubSyncPlugin's readConfig().
  const DEFAULT_BRANCH = 'main';
  const DEFAULT_DIR = 'twikki';

  // Mirror GitHubSyncPlugin.isLocalOnly: these tiddlers are never synched, so
  // there is no GitHub file to open.
  const isLocalOnly = t => t.title === '$Settings' || t.doNotSave === true || t.tags?.includes('$NoSynch') || t.tags?.includes('$NoBackup');

  // Mirror GitHubSyncPlugin.encodePathSegment: escape ONLY the characters unsafe
  // in a Git / Windows path; spaces, parentheses and unicode stay readable so the
  // path matches what sync wrote.
  function encodePathSegment(title) {
    return title.replace(/[%<>:"\/\\|?*\x00-\x1f]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
  }

  // Derive the web host from the API endpoint: api.github.com -> github.com;
  // GitHub Enterprise (https://host/api/v3) -> https://host.
  function webHost(endpoint) {
    if (!endpoint) return 'https://github.com';
    try {
      const u = new URL(endpoint);
      return u.hostname === 'api.github.com' ? 'https://github.com' : u.origin;
    } catch {
      return 'https://github.com';
    }
  }

  // Build the github.com web URL for a synched tiddler from the saved repo config.
  // Returns null (with a notify) when the repo isn't configured.
  function repoUrl(title) {
    const config = tw.core.common.getSetting('synch.GithubRepo');
    if (!config || !config.repo || !/^[^/]+\/[^/]+$/.test(config.repo)) {
      tw.ui.notify("Set $Settings.synch.GithubRepo.repo to 'owner/name' first.", 'W');
      return null;
    }
    const branch = config.branch || DEFAULT_BRANCH;
    const dir = String(config.dir ?? DEFAULT_DIR).replace(/^\/+|\/+$/g, '') + '/' + tw.workspace;
    const path = dir + '/' + encodePathSegment(title) + '.json';
    return `${webHost(config.endpoint)}/${config.repo}/blob/${branch}/${path}`;
  }

  function openOnGitHub(title) {
    const t = tw.run.getTiddler(title);
    if (!t) return tw.ui.notify(`Unknown tiddler '${title}'!`, 'E');
    if (isLocalOnly(t)) return tw.ui.notify(`'${title}' is local-only — not synched to GitHub.`, 'I');
    const url = repoUrl(title);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  return {
    meta,
    init() {
      // The macro can't know the current tiddler at render time, so it emits a
      // button carrying the $currentTiddler token (resolved by the templater);
      // the click handler receives the title. Same pattern as <<favorites.toggle>>.
      tw.extensions.registerMacro('github', 'link', () => tw.ui.button('{{$IconGitHub}}', 'github.open', '$currentTiddler', 'github-link', 'title="Open this note on GitHub"'), {
        description: "Button: open the current tiddler's file in the configured GitHub repo.",
        example: '<<github.link>>',
      });
      tw.extensions.registerCommand([
        {
          label: 'GitHub: Open note',
          run: () => {
            const title = tw.tabs?.active;
            if (!title) return tw.ui.notify('No active note to open on GitHub.', 'W');
            tw.events.send('github.open', title);
          },
        },
      ]);
    },
    start() {
      // override() keeps a single handler across soft reloads (no double-open).
      tw.events.override('github.open', openOnGitHub);
    },
  };
})();
