tags: $Plugin

Synchronise your workspace with a **GitHub repository** (not a Gist), committing **only the tiddlers that actually changed**. Before each push it computes every tiddler's Git blob SHA-1 locally and compares it with the blob SHA already in the repo tree — unchanged tiddlers are skipped, new/edited ones are committed, and tiddlers deleted locally are removed remotely. When nothing differs, no commit is made at all.

Each tiddler is one JSON file (per-tiddler diffs in history) and every push is a single **atomic commit** built with the GitHub [Git Data API](https://docs.github.com/en/rest/git). This is the incremental sibling of [[$GithubRepoBackupPlugin]] (which rewrites the whole snapshot) and the repo-backed counterpart of [[$SynchDataPlugin]].

Direction is explicit and non-merging: **push** sends local changes up, **pull** replaces the local workspace from the repo. There is no automatic conflict merge — pick the direction you mean.

## Installation

Add a `synch.GithubRepo` block to [[$GeneralSettings]]:

```json
{
  "synch": {
    "GithubRepo": {
      "accessToken": "github_pat_...",
      "repo": "owner/my-twikki-data",
      "branch": "main",
      "dir": "twikki",
      "commitMessage": "TWikki sync"
    }
  }
}
```

- **accessToken** — a fine-grained PAT with **Contents: read & write** on the target repo (classic tokens: the `repo` scope). The repository must already exist.
- **repo** — `owner/name`.
- **branch** — defaults to `main`. Created on first push if the repo is empty.
- **dir** — subfolder for tiddler files (defaults to `twikki`); use `""` for the repo root.
- **commitMessage** — commit-message prefix; an ISO timestamp is appended.

Optionally, add the following buttons to your [[$TitleBar]]:

- `<<ghsync.synch>>`: <<ghsync.synch>>
- `<<ghsync.pull>>`: <<ghsync.pull>>
- `<<ghsync.push>>`: <<ghsync.push>>

Tiddlers tagged `$NoSynch` or `$NoBackup` are never pushed. `$GeneralSettings` is local-only (it holds your PAT — committing a token trips GitHub secret scanning and revokes it) and is preserved across a pull.

# Meta

<<pluginMeta GitHubSync>>

# Code

[include](./GitHubSyncPlugin.js)
