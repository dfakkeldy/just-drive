import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * The published build copies no public folder. The models (web/public/models/*.glb, see src/glb-model.ts)
 * are site files beside the land, so the build writes them itself: models/<name>.glb next to app.js.
 * tools/build_site.sh copies that folder to the site, and tools/build-pwa.mjs lists it for offline play.
 */
export function modelsBuild(): Plugin {
  const folder = fileURLToPath(new URL('./public/models/', import.meta.url));
  return {
    name: 'models-in-published-build', apply: 'build',
    buildStart() {
      if (!existsSync(folder)) return;
      for (const name of readdirSync(folder).filter((file) => /^[\w-]+\.glb$/.test(file)).sort()) {
        this.emitFile({ type: 'asset', fileName: `models/${name}`, source: readFileSync(folder + name) });
      }
    },
  };
}
