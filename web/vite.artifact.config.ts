import {quarryEvalProbe} from './quarry-probe-build';
import {eraShaderBuild} from './era-shader-build';
import {modelsBuild} from './models-build';
import {areaChunksBuild,CHUNK_FOLDER,sharedCore} from './area-chunks-build';
import { defineConfig, type Plugin } from 'vite';

// The public/Artifact pack copies app.js, not Vite's separate worker assets.
// Keep the normal URL worker for the dev server and Node source fixtures.
function inlineRoadCutWorker(): Plugin {
  const constructor = "new Worker(new URL('./road-cut-worker.ts',import.meta.url),{type:'module'})";
  return {
    name: 'inline-road-cut-worker', enforce: 'pre',
    transform(source, id) {
      if (!id.split('?')[0].endsWith('/src/road-cuts.ts')) return;
      if (source.split(constructor).length !== 2) this.error('Bridge worker constructor changed; update flat-build packaging.');
      return { code: "import FlatRoadCutWorker from './road-cut-worker?worker&inline';\n" + source.replace(constructor, 'new FlatRoadCutWorker()'), map: null };
    },
  };
}

// Build for a host that takes a page plus a set of plain files, no copied tiles.
// Output: ../data/pack/app.js   (the page is artifact/page.html, the tiles come from tools/pack_terrain.py)
//         ../data/pack/chunks/*.js   (the shared core and the code each import() loads: area-chunks-build.ts)
//         ../data/pack/models/*.glb   (the models of web/public/models, which this build does not copy)
export default defineConfig({
  plugins:[eraShaderBuild(),quarryEvalProbe(),modelsBuild(),inlineRoadCutWorker(),areaChunksBuild('app.js')],
  base: './',
  publicDir: false,
  // "Drive with others" is part of the published build: its code is a chunk of its own, downloaded only when a
  // player turns it on. Nothing connects before that, and it shows itself only on the addresses that have a room
  // server (web/src/mp/switch.ts). VITE_MP=0 builds without it.
  define: { __PUBLIC_APP__: JSON.stringify(process.env.MMM_PUBLIC === '1'), 'import.meta.env.VITE_MP': JSON.stringify(process.env.VITE_MP ?? '1') },
  build: {
    target: 'es2022',
    outDir: process.env.ARTIFACT_OUT ?? '../data/pack',
    emptyOutDir: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: 'src/main.ts',
      output: { entryFileNames: 'app.js', chunkFileNames: CHUNK_FOLDER + '/[name]-[hash].js', manualChunks: sharedCore(), format: 'es' },
    },
  },
});
