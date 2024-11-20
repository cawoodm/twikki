import {defineConfig} from 'vite';
// https://vitejs.dev/config/
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
    {
      name: 'reload',
      configureServer(server) {
        const {ws, watcher} = server;
        watcher.on('change', file => {
          if (file.endsWith('.json')) {
            ws.send({
              type: 'full-reload',
            });
          }
        });
      },
    },
  ],
});
