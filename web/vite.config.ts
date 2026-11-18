import { defineConfig, type Plugin } from 'vite';
import { eraShaderBuild } from './era-shader-build';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mutationSources } from '../tools/mutation-source.mjs';

// Created only for `vite serve` with an explicit mutation document. No build hook.
function servedMutation(file: string): Plugin {
  const root = fileURLToPath(new URL('..', import.meta.url));
  let hash = '', sources = new Map<string, string>();
  const load = () => {
    const bytes = readFileSync(file, 'utf8');
    const next = createHash('sha256').update(bytes).digest('hex');
    if (next === hash) return false;
    const validated = mutationSources(root, JSON.parse(bytes));
    sources = validated; hash = next;
    return true;
  };
  load(); // Reject invalid paths and anchors before the dev server starts.
  let refresh = () => { load(); };
  return {
    name: 'mmm-served-mutation', apply: 'serve', enforce: 'pre',
    configureServer(server) {
      refresh = () => {
        if (load()) {
          server.moduleGraph.invalidateAll();
          server.ws.send({ type: 'full-reload' });
        }
      };
      server.watcher.add(file);
      const changed = (path: string) => {
        if (resolve(path) !== file) return;
        try { refresh(); } catch (error) { server.config.logger.error(String(error)); }
      };
      server.watcher.on('change', changed);
      server.httpServer?.once('close', () => server.watcher.off('change', changed));
      // The runner waits for this receipt instead of racing a fixed watcher delay.
      server.middlewares.use('/__mmm_mutation', (_req, res) => {
        try { refresh(); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ hash })); }
        catch (error) { res.statusCode = 500; res.end(String(error)); }
      });
    },
    transform(_code, id) {
      refresh(); // Reject invalid updates and invalidate stale modules even before the watcher fires.
      const source = sources.get(id.split('?')[0]);
      return source === undefined ? null : { code: source, map: null };
    },
  };
}

export default defineConfig(({ command }) => {
  if (command === 'build' && process.env.MMM_MUTATION !== undefined) throw Error('MMM_MUTATION is dev-only: unset it before vite build');
  return ({
  plugins: [eraShaderBuild(), ...(command === 'serve' && process.env.MMM_MUTATION
    ? [servedMutation(resolve(process.env.MMM_MUTATION))] : [])],
  base: './',
  define: { __PUBLIC_APP__: 'false' },
  // Worktrees share node_modules; dependency optimisation must not replace another server's cache.
  cacheDir: '.vite',
  build: { target: 'es2022', chunkSizeWarningLimit: 900, rollupOptions: { input: { main: 'index.html', car: 'car.html', ghosts: 'mp-ghosts.html', truck: 'truck.html', sxs: 'sxs.html' } } },
  // The terrain tiles are a symlink into data/baked; the dev server may follow it.
  server: { fs: { strict: false } },
});
});
