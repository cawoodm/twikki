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
      {sourceRoot: resolve('src/modules'), outputDir: resolve('public/modules')},
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
