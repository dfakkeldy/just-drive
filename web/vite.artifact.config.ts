import {quarryLazyBuild} from './quarry-lazy-build';
import {eraShaderBuild} from './era-shader-build';
import {modelsBuild} from './models-build';
import {areaChunksBuild,CHUNK_FOLDER,sharedCore} from './area-chunks-build';
import { defineConfig } from 'vite';

// Build for a host that takes a page plus a set of plain files, no copied tiles.
// Output: ../data/pack/app.js   (the page is artifact/page.html, the tiles come from tools/pack_terrain.py)
//         ../data/pack/chunks/*.js   (the shared core and the code each import() loads: area-chunks-build.ts)
//         ../data/pack/models/*.glb   (the models of web/public/models, which this build does not copy)
export default defineConfig({
  plugins:[eraShaderBuild(),quarryLazyBuild(),modelsBuild(),areaChunksBuild('app.js')],
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
