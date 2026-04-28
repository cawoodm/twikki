import {defineConfig} from 'vite';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import tiddlerCompile from './vite-plugin-tiddler-compile.js';

const root = fileURLToPath(new URL('.', import.meta.url));

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
      {sourceRoot: join(root, 'src/packages'), outputDir: join(root, 'public/packages')},
      {sourceRoot: join(root, 'src/modules'), outputDir: join(root, 'public/modules')},
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
