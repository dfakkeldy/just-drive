import {quarryLazyBuild} from './quarry-lazy-build';
import {eraShaderBuild} from './era-shader-build';
import {modelsBuild} from './models-build';
import { defineConfig } from 'vite';

// Build for a host that takes a page plus a flat set of files: one script, no copied tiles.
// Output: ../data/pack/app.js   (the page is artifact/page.html, the tiles come from tools/pack_terrain.py)
//         ../data/pack/models/*.glb   (the models of web/public/models, which this build does not copy)
export default defineConfig({
  plugins:[eraShaderBuild(),quarryLazyBuild(),modelsBuild()],
  base: './',
  publicDir: false,
  // "Drive with others" is part of the published script: this build is one file, so its code (about 20 kB) is
  // downloaded with the rest. It is not started, and nothing connects, until a player turns it on, and it shows
  // itself only on the addresses that have a room server (web/src/mp/switch.ts). VITE_MP=0 builds a script without it.
  define: { __PUBLIC_APP__: JSON.stringify(process.env.MMM_PUBLIC === '1'), 'import.meta.env.VITE_MP': JSON.stringify(process.env.VITE_MP ?? '1') },
  build: {
    target: 'es2022',
    outDir: process.env.ARTIFACT_OUT ?? '../data/pack',
    emptyOutDir: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: 'src/main.ts',
      output: { entryFileNames: 'app.js', inlineDynamicImports: true, format: 'es' },
    },
  },
});
