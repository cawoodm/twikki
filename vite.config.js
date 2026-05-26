import {defineConfig} from 'vite';
import {resolve} from 'node:path';
import tiddlerCompile from './vite-plugin-tiddler-compile.js';

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  base: '/',
  build: {
    outDir: '../dist',
    minify: false,
  },
  server: {
    port: 3002,
    open: true,
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
