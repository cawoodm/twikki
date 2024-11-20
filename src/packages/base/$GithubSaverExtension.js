tw.extensions.registerPlugin('base', 'GithubSaver', () => {
  return {
    name: 'GithubSaver',
    version: '0.0.2',
    init() {
    },
    start() {
    },
    async save({text, token, repo, path, filename, commitMessage, branch, endpoint}) {
    //
      branch = branch || 'main';
      endpoint = endpoint || 'https://api.github.com';
      commitMessage = 'TWikki Save ' + new Date().toISOString();

      validate({text, token, repo, path, filename, commitMessage});

      const headers = {
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json;charset=UTF-8',
        'Authorization': 'Bearer ' + token,
        'If-None-Match': '',
      };

      // Normalize path with trailing slash
      if (path.substring(0, 1) !== '/') path = '/' + path;
      if (path.substring(path.length - 1) !== '/') path = path + '/';

      // List Files
      const listUrl = endpoint + '/repos/' + repo + '/contents' + path;
      let res = await fetch(listUrl, {
        method: 'GET',
        headers: headers,
        data: {
          ref: branch,
        },
      });

      if (res.ok) throw new Error(`GitHubSaver.save() GET files failed ${res.status} for ${listUrl}`);

      // Find the sha of the file if it exists
      const files = await res.json();
      const sha = files.find(file => file.name === filename);

      const data = {
        message: commitMessage,
        content: btoa(text),
        branch: branch,
        sha: sha,
      };

      // Perform a PUT request to save the file
      let putUrl = listUrl + filename;
      res = await fetch(putUrl, {
        method: 'PUT',
        headers: headers,
        data: JSON.stringify(data),
      });
      if (res.ok) throw new Error(`GitHubSaver.save() PUT file failed ${res.status} for ${putUrl}`);

      function validate(obj) {
        Object.keys.forEach(k => {
          if (!obj[k]) throw new Error(`GitHubSaver.save() missing parameter '${k}'!`);
        });
      }

    },
  };
});
