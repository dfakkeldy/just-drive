// Runs tools/engine-sound-check.mjs on the real sources, and with --mutations once per mutant below: each mutant breaks one
// engine sound rule on purpose and must make the check fail. Sources are changed only inside the bundle (for the rules
// the check imports) and in a temporary copy of the files the check reads as text, never on disk.
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..'), dir = mkdtempSync(`${tmpdir()}/mmm-engine-sound-`);
// The files the check reads as text (its wiring pins); the copy under `dir` is its root.
const READS = ['engine-sound.ts', 'main.ts', 'radio.ts', 'vehicle.ts'];
const R = 'engine-sound-rules', G = 'engine-sound', survived = [];
// [name, anchor, replacement, file under web/src]
const mutants = [
  ['the truck changes up late again', 'upshift: .74,', 'upshift: .9,', R],
  ['the change-up point is ignored', '((p.upshift ?? .9) - .5)', '(.9 - .5)', R],
  ['the truck flares to the redline in the air', 'flare: .62,', 'flare: .95,', R],
  ['the flare is ignored', '(p.flare ?? .95)', '.95', R],
  ['no ceiling', 'p.ceiling ?? 6000', '6000', R],
  ['a bright ceiling', 'ceiling: 750,', 'ceiling: 1600,', R],
  ['the truck bright again', "level: 1, bright: 2,", "level: 1, bright: 5,", R],
  ['the octave-up voice is back', 'upper: 0,', 'upper: .35,', R],
  ['the rasp high again', 'rasp: 2.5,', 'rasp: 6,', R],
  ['the rasp centre is ignored', 'frequency * (p.rasp ?? RASP)', 'frequency * RASP', R],
  ['even pulses', 'lump: [1, .6, .52, .94, .58, 1, .9, .55]', 'lump: [1, 1, 1, 1, 1, 1, 1, 1]', R],
  ['sharp pulses', 'decay: .8 }', 'decay: 0 }', R],
  ['the voice plays the firing rate', 'voice: frequency / voicePulses(p),', 'voice: frequency,', R],
  ['a cycle of one bank', "p.wave === 'custom' && p.train ? p.train.lump.length : 1", "p.wave === 'custom' && p.train ? p.train.lump.length / 2 : 1", R],
  ['the old four gears', 'gears: [11, 20.6, 30.8, 41.3, 53.6, 65.5]', 'gears: [10, 18, 28, 40]', R],
  ['evenly spaced gears', 'gears: [11, 20.6, 30.8, 41.3, 53.6, 65.5]', 'gears: [13.5, 18.4, 25.4, 34.9, 47.7, 65.5]', R],
  ['a short top gear', 'gears: [11, 20.6, 30.8, 41.3, 53.6, 65.5]', 'gears: [11, 20.6, 30.8, 41.3, 53.6]', R],
  ['first gear lugs', 'gears: [11, 20.6, 30.8, 41.3, 53.6, 65.5]', 'gears: [8, 20.6, 30.8, 41.3, 53.6, 65.5]', R],
  ['the truck revs to 5800', 'truck: { idle: 600, redline: 4800,', 'truck: { idle: 600, redline: 5800,', R],
  ['a louder truck', "wave: 'custom', level: 1,", "wave: 'custom', level: 1.3,", R],
  ['the bike keeps its old gears', 'gears: [10.6, 18.1, 25.7, 34.8, 45.3]', 'gears: [7, 12, 17, 23, 30]', R],
  ['the car changes up earlier', '((p.upshift ?? .9) - .5)', '((p.upshift ?? .85) - .5)', R],
  ['the car flares less', '(p.flare ?? .95)', '(p.flare ?? .9)', R],
  ['a quieter octave-up voice', 'export const UPPER = .35;', 'export const UPPER = .3;', R],
  ['the type custom is set', "      } else g.voice.type = p.wave;", "      }\n      g.voice.type = p.wave;", G],
  ['the voice at the firing rate', 'glide(g.voice.frequency, e.voice);', 'glide(g.voice.frequency, e.frequency);', G],
  ['the octave-up gain stays', '      g.upperGain?.gain.setValueAtTime(p.upper ?? UPPER, t);\n', '', G],
  ['the rasp at six times', 'g.raspFilter.frequency.setTargetAtTime(e.rasp, t, GLIDE);', 'g.raspFilter.frequency.setTargetAtTime(Math.min(5000, e.frequency * 6), t, GLIDE);', G],
  ['the snapshot reports the cycle rate', ' * (this.kind ? voicePulses(ENGINES[this.kind]) : 1)', '', G],
  ['always glide, even on a new vehicle', 'fresh ? param.setValueAtTime(value, t) : param.setTargetAtTime(value, t, GLIDE)', 'param.setTargetAtTime(value, t, GLIDE)', G],
  ['jump only on the first drive', 'fresh = kind !== this.kind;', 'fresh = !this.kind;', G],
  ['only the truck sets its octave-up gain', '      g.upperGain?.gain.setValueAtTime(p.upper ?? UPPER, t);\n', "      if (p.wave === 'custom') g.upperGain?.gain.setValueAtTime(p.upper ?? UPPER, t);\n", G],
  ['a sub oscillator', "upper = a.createOscillator(); upper.type = 'triangle';", "upper = a.createOscillator(); upper.type = 'triangle'; a.createOscillator();", G],
];
const source = file => resolve(root, `web/src/${file}.ts`);
try {
  mkdirSync(`${dir}/root/web/src`, { recursive: true });
  for (const mutant of [null, ...(process.argv.includes('--mutations') ? mutants : [])]) {
    const file = mutant?.[3], original = file && readFileSync(source(file), 'utf8');
    if (mutant) assert.ok(original.split(mutant[1]).length === 2, mutant[0] + ': anchor must match once');
    const mutated = mutant && original.replace(mutant[1], () => mutant[2]);
    for (const name of READS) writeFileSync(`${dir}/root/web/src/${name}`, mutant && `${file}.ts` === name ? mutated : readFileSync(resolve(root, 'web/src', name), 'utf8'));
    await build({ entryPoints: [resolve(root, 'tools/engine-sound-check.mjs')], bundle: true, platform: 'node', format: 'esm', outfile: `${dir}/check.mjs`, logLevel: 'silent',
      plugins: mutant ? [{ name: 'mutate', setup(b) { b.onLoad({ filter: new RegExp(`/${file}\\.ts$`) }, () => ({ contents: mutated, loader: 'ts', resolveDir: dirname(source(file)) })); } }] : [] });
    const r = spawnSync(process.execPath, [`${dir}/check.mjs`], { cwd: resolve(root, 'web'), encoding: 'utf8', timeout: 180000, env: { ...process.env, MMM_ROOT: `${dir}/root` } });
    if (!mutant) { assert.equal(r.status, 0, r.stdout + r.stderr); console.log(r.stdout.trim()); }
    else if (r.status === 0 || !/AssertionError/.test(r.stderr)) { survived.push(mutant[0]); console.log('SURVIVED', mutant[0], r.stderr.slice(0, 300)); }
    else console.log('REJECTED', mutant[0], '-', (r.stderr.match(/AssertionError[^:]*: (.*)/)?.[1] ?? '').slice(0, 110));
  }
  assert.deepEqual(survived, [], 'every mutant must fail the check');
  if (process.argv.includes('--mutations')) console.log(`engine sound: ${mutants.length} mutants rejected`);
} finally { rmSync(dir, { recursive: true, force: true }); }
