import {resolve} from 'node:path';
import {defineConfig} from 'vite';
import tiddlerCompile from './vite-plugin-tiddler-compile.js';

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  base: '/twikki',
  build: {
    outDir: '../dist',
    minify: false,
  },
  server: {
    port: 3002,
    open: !process.env.VITE_TEST, // e2e harness sets VITE_TEST to avoid popping a browser
    host: true,
  },
  plugins: [
    tiddlerCompile([
      {sourceRoot: resolve('src/packages'), outputDir: resolve('public/packages')},
      // core.defaults is the only module subdir; emit it where the platform can
      // `import` it (so Vite bundles the shadow tiddlers instead of fetching them).
      {sourceRoot: resolve('src/modules'), outputDir: resolve('src/generated')},
    ]),
    {
      name: 'reload',
      configureServer(server) {
        const {ws, watcher} = server;
        watcher.on('change', file => {
          if (file.endsWith('.json')) {
            ws.send({type: 'full-reload'});
          }
        });
      },
    },
  ],
});
