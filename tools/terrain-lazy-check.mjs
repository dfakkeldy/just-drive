// Phone lazy land (terrain.ts lazyRange, holdBackground): the start view is unchanged, near land is all there,
// nothing streams before the first pedal, background reads never count as pending, never take more than two slots,
// end with the same land as before, and a turn gets foreground reads at once. Real Mabou tiles (data/baked).
// Usage: node tools/terrain-lazy-check.mjs [--mutations]
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname), terrainPath = resolve(root, 'web/src/terrain.ts');
const MUTANTS = [
  { name: 'manifest max ignored: a new higher bake uses the legacy table', edits: [['m.height.max ?? BAKED_HEIGHT_MAX', 'BAKED_HEIGHT_MAX']] },
  { name: 'manifest min ignored: a new lower bound uses encoding offset', edits: [['m.height.min ?? m.height.offset', 'm.height.offset']] },
  { name: 'fixed top: unread highlands above 400 m x exag are put off', edits: [['this.lazyBox.max.y = high + 255 * m.canopy.scale;', 'this.lazyBox.max.y = 400 * this.exag;']] },
  { name: 'fixed bottom: coarse skirts below -200 m are put off', edits: [['this.lazyBox.min.y = low - Math.max(t.size * 0.04, 6) - (m.height.min === undefined ? 0 : 1);', 'this.lazyBox.min.y = -200;']] },
  { name: 'no build margin: a recorded minimum is used without the 1 m kept for build() cuts', edits: [[' - (m.height.min === undefined ? 0 : 1);', ';']] },
  { name: 'frustum ignored: every far tile is put off, also in view', edits: [['return !this.frustum.intersectsBox(this.lazyBox);', 'return true;']] },
  { name: 'range ignored: near tiles outside the view are put off too', edits: [['|| dist <= this.lazyRange) return false;', ') return false;']] },
  { name: 'hold ignored: the background streams before the first pedal', edits: [['if (this.holdBackground || t.loading) return;', 'if (t.loading) return;'], ['if (!this.holdBackground && t.backgroundFrame', 'if (t.backgroundFrame']] },
  { name: 'background counted as pending', edits: [['this.builds.length - background +', 'this.builds.length +']] },
  { name: 'no slot limit: background reads fill all six slots', edits: [['this.backgroundLoading.size < BACKGROUND_LOADS &&', '']] },
  { name: 'no promotion: a background read the view wants stays out of pending', edits: [['    t.background = false;\n    if (t.ready || t.loading) return;', '    if (t.ready || t.loading) return;']] },
  { name: 'whole-tile fallback: a far child turning into view drops the near land to the coarse parent', edits: [['if (!c.ready && this.lazyRange && !mirror && cd > this.lazyRange) {', 'if (false) {']] },
  { name: 'lazy-only parent drawn whole: land quarters all lazy fall through to the coarse parent', edits: [['if (ok && (kids.length || lazy)) {', 'if (ok && kids.length) {']] },
];

async function run(mutant) {
  const dir = mkdtempSync(join(tmpdir(), 'mmm-terrain-lazy-'));
  try {
    const source = readFileSync(terrainPath, 'utf8');
    let mutated = source;
    for (const [from, to] of mutant?.edits ?? []) {
      if (mutated.split(from).length !== 2) throw Error(`mutation anchor not found exactly once (${mutant.name}): ${from}`);
      mutated = mutated.replace(from, () => to);
    }
    await build({ entryPoints: [resolve(root, 'tools/terrain-lazy-harness.mjs')], bundle: true, platform: 'node', format: 'esm',
      outfile: dir + '/check.mjs', logLevel: 'warning', plugins: [{ name: 'mutant', setup(b) {
        b.onLoad({ filter: /web\/src\/terrain\.ts$/ }, () => ({ contents: mutated, loader: 'ts' }));
      } }] });
    return spawnSync(process.execPath, [dir + '/check.mjs'], { cwd: root, env: { ...process.env, MMM_ROOT: root }, encoding: 'utf8', maxBuffer: 64 << 20 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const base = await run(null);
process.stdout.write(base.stdout); process.stderr.write(base.stderr);
if (base.status !== 0) { console.error('FAIL terrain-lazy: the unmutated check failed'); process.exit(1); }
console.log('PASS terrain-lazy');
if (process.argv.includes('--mutations')) {
  let survived = 0;
  for (const m of MUTANTS) {
    const r = await run(m);
    const line = (r.stderr.match(/AssertionError[^\n]*\n?[^\n]*/)?.[0] ?? r.stderr.trim().split('\n').at(-1) ?? '').replace(/\s+/g, ' ').slice(0, 200);
    if (r.status === 0) { survived++; console.log(`SURVIVED ${m.name}`); }
    else console.log(`KILLED ${m.name}: ${line}`);
  }
  if (survived) { console.error(`FAIL terrain-lazy mutations: ${survived} survived`); process.exit(1); }
  console.log(`PASS terrain-lazy mutations: ${MUTANTS.length} killed`);
}
