import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';

/**
 * DEV ONLY: serves the local game install (XA_GAME_DIR, default F:/Games/Xa) under /__game/ so the
 * engine can be tested without the folder picker. `astro build` never includes these files.
 */
function devGameFiles() {
  const root = resolve(process.env.XA_GAME_DIR ?? 'F:/Games/Xa');
  const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.ogg': 'audio/ogg', '.tmx': 'application/xml' };
  return {
    name: 'dev-game-files',
    apply: 'serve',
    /** @param {import('vite').ViteDevServer} server */
    configureServer(server) {
      server.middlewares.use('/__game', (req, res) => {
        if (!existsSync(join(root, 'assets'))) {
          res.statusCode = 404;
          return res.end();
        }
        const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
        if (url === '/__list') {
          const out = [];
          const walk = (d, p) => {
            for (const f of readdirSync(d)) {
              const full = join(d, f);
              if (statSync(full).isDirectory()) walk(full, p + f + '/');
              else out.push(p + f);
            }
          };
          walk(join(root, 'assets'), 'assets/');
          res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify(out));
        }
        const file = resolve(root, '.' + url);
        if (!file.startsWith(root) || !existsSync(file)) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader('content-type', types[extname(file).toLowerCase()] ?? 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
  };
}

// https://astro.build/config
export default defineConfig({
  integrations: [react()],
  vite: { plugins: [devGameFiles()] },
});
