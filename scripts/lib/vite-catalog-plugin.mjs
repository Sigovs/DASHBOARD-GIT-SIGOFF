import { buildCatalog } from './catalog.mjs';
import { REPOS_FILE, OVERRIDES_FILE, LOCAL_PATHS_FILE, MANIFEST_FILE } from './paths.mjs';

/**
 * Serves `/catalog.json` — the merge of data/repos.json, your overrides, the
 * local-path map and the thumbnail manifest.
 *
 * In dev it is computed per request, so editing catalog-overrides.json and
 * pressing Refresh in the UI shows the change immediately, with no restart.
 * In a build the same function emits a static file, so the shipped site is
 * byte-identical to what you saw at localhost.
 */
export function catalogPlugin() {
  const watched = [REPOS_FILE, OVERRIDES_FILE, LOCAL_PATHS_FILE, MANIFEST_FILE];

  return {
    name: 'sigovs-catalog',

    configureServer(server) {
      watched.forEach((file) => server.watcher.add(file));

      server.watcher.on('change', (file) => {
        if (!watched.includes(file)) return;
        server.ws.send({ type: 'custom', event: 'catalog:changed' });
      });

      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.split('?')[0].endsWith('/catalog.json')) return next();
        try {
          const body = JSON.stringify(buildCatalog());
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(body);
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err.message || err) }));
        }
      });
    },

    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'catalog.json',
        source: JSON.stringify(buildCatalog()),
      });
    },
  };
}
