import {rmSync} from 'node:fs';
import {basename, dirname, isAbsolute, join, resolve} from 'node:path';
import type {Plugin, Rollup} from 'vite';

/**
 * The published build splits the area code out of app.js. Each `import()` in the game becomes its own file in
 * chunks/, and the browser downloads it only when the game takes that branch (an area, a quality, a switch).
 *
 * main.ts awaits those imports at its top level. A chunk that imported app.js back would wait for main.ts to
 * finish, and main.ts waits for the chunk: the page would never start. So every module that main.ts imports and
 * a chunk also needs goes into one shared chunk, chunks/core-<hash>.js. app.js keeps main.ts and the modules only
 * it uses. The page fetches app.js and the core chunk at the same time (tools/build-pwa.mjs adds the preload).
 */
export const CHUNK_FOLDER = 'chunks';

/** The modules both the entry and some dynamic import reach by static imports. */
export function sharedCore(): Rollup.GetManualChunk {
  let core: Set<string> | undefined;
  return (id, {getModuleIds, getModuleInfo}) => {
    if (!core) {
      const ids = [...getModuleIds()], entry = ids.find((m) => getModuleInfo(m)?.isEntry);
      if (!entry) throw Error('area-chunks: no entry module');
      const closure = (roots: Iterable<string>) => {
        const seen = new Set<string>(), stack = [...roots];
        while (stack.length) {
          const m = stack.pop()!;
          if (seen.has(m)) continue;
          seen.add(m); stack.push(...(getModuleInfo(m)?.importedIds ?? []));
        }
        return seen;
      };
      const fromEntry = closure(getModuleInfo(entry)!.importedIds);
      const lazy = closure(ids.flatMap((m) => getModuleInfo(m)?.dynamicallyImportedIds ?? []));
      core = new Set([...fromEntry].filter((m) => lazy.has(m)));
    }
    return core.has(id) ? 'core' : undefined;
  };
}

/**
 * Fail the build if any chunk imports the entry back (the start would hang), or a chunk leaves its folder.
 * The build keeps its output folder (the private pack holds terrain there), so it first removes the chunks of the
 * last build, and the park file the old quarry plugin wrote. It removes nothing outside <outDir>/chunks.
 */
export function areaChunksBuild(entryFileName: string): Plugin {
  let outDir: string | undefined;
  return {
    name: 'area-chunks-in-published-build', apply: 'build',
    configResolved(config) { if (config.build.write !== false) outDir = resolve(config.root, config.build.outDir); },
    buildStart() {
      if (!outDir) return;
      const chunks = join(outDir, CHUNK_FOLDER);
      if (!isAbsolute(outDir) || dirname(outDir) === outDir || dirname(chunks) !== outDir || basename(chunks) !== CHUNK_FOLDER) {
        throw Error(`area-chunks: will not clear ${chunks}`);
      }
      rmSync(chunks, {recursive: true, force: true});
      rmSync(join(outDir, 'quarry-feature.json'), {force: true});
    },
    generateBundle(_options, bundle: Rollup.OutputBundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk') continue;
        if (file.isEntry) { if (file.fileName !== entryFileName) throw Error(`area-chunks: unexpected entry ${file.fileName}`); continue; }
        if (!file.fileName.startsWith(CHUNK_FOLDER + '/')) throw Error(`area-chunks: ${file.fileName} is outside ${CHUNK_FOLDER}/`);
        if (file.imports.includes(entryFileName) || file.dynamicImports.includes(entryFileName)) {
          throw Error(`area-chunks: ${file.fileName} imports ${entryFileName}; the top-level await in main.ts would never finish`);
        }
      }
    },
  };
}
