#!/usr/bin/env node
// Triangles in each far tree shape, today's and the ?crowns=1 test. Run: node tools/tree-triangles.mjs
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const web = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const { build } = createRequire(join(web, 'package.json'))('esbuild');
const dir = mkdtempSync(join(tmpdir(), 'mmm-tree-triangles-'));
try {
  const outfile = join(dir, 'trees.mjs');
  await build({ entryPoints: [join(web, 'src/trees.ts')], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'error' });
  const { treeGeometry, crownTest } = await import(pathToFileURL(outfile));
  const kinds = ['spruce', 'hardwood', 'birch', 'larch', 'shrub'], names = ['crown a', 'crown b', 'crown c / bare', 'sapling'];
  const count = (lobed, near) => Array.from({ length: 20 }, (_, i) => {
    crownTest.lobed = lobed;
    return treeGeometry(Math.floor(i / 4), i % 4, i % 4 === 3, near).getAttribute('position').count / 3;
  });
  const before = count(false, false), after = count(true, false), near = count(false, true);
  console.log('shape'.padEnd(26), 'far now', 'far crowns=1', 'near');
  before.forEach((n, i) => console.log(`${kinds[Math.floor(i / 4)]} ${names[i % 4]}`.padEnd(26),
    String(n).padStart(7), String(after[i]).padStart(12), String(near[i]).padStart(4)));
} finally { rmSync(dir, { recursive: true, force: true }); }
