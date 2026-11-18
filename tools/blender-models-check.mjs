#!/usr/bin/env node
// The committed model files are what the Blender scripts make: no hand edit, and no script change without a rebuild.
// This rebuilds all six (mail car, porch dog and Highland bull, desktop and phone) into a temporary folder and compares them,
// byte for byte, with web/public/models.
//
//   node tools/blender-models-check.mjs               rebuild and compare
//   node tools/blender-models-check.mjs --mutations   then: a known change to the quantizer must change the car's files
//
// It needs Blender, and the same Blender release that built the files (BUILT_WITH): another release may write other
// bytes for the same model. Without it nothing can be judged. Then this prints SKIP and exits with 2 (the runner
// shows SKIP or CANNOT RUN). It never passes without a rebuild. BLENDER=<path> names another Blender.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILT_WITH = '5.2';      // Blender release (major.minor) of the committed files
const root = fileURLToPath(new URL('../', import.meta.url));
const MODELS = ['mail-car.glb', 'mail-car-low.glb', 'porch-dog.glb', 'porch-dog-low.glb', 'highland-bull.glb', 'highland-bull-low.glb'];

function findBlender() {
  // BLENDER=<path> is the only one tried when it is given.
  for (const path of process.env.BLENDER ? [process.env.BLENDER] : ['/Applications/Blender.app/Contents/MacOS/Blender', 'blender']) {
    const run = spawnSync(path, ['--version'], { encoding: 'utf8' });
    const version = /^Blender (\d+\.\d+)/m.exec(run.stdout ?? '')?.[1];
    if (run.status === 0 && version) return { path, version, full: /^Blender .*/m.exec(run.stdout)[0] };
  }
  return null;
}
const blender = findBlender();
if (!blender) { console.log('SKIP blender-models: Blender is not installed here, so the model files cannot be rebuilt and compared'); process.exit(2); }
if (blender.version !== BUILT_WITH) {
  console.log(`SKIP blender-models: this is ${blender.full}; the committed files were built with Blender ${BUILT_WITH}, and another release may write other bytes`);
  process.exit(2);
}

/** Runs the three scripts from `scripts` (a tools/blender folder) and returns the folder that holds the six files. */
function rebuild(scripts, out) {
  for (const [script, target] of [['mail-car.py', join(out, 'mail-car.glb')], ['porch_dog.py', out], ['highland.py', out]]) {
    const run = spawnSync(blender.path, ['-b', '--factory-startup', '-P', join(scripts, script), '--', target], { encoding: 'utf8', maxBuffer: 1 << 28 });
    assert.equal(run.status, 0, `${script} failed:\n${(run.stdout + run.stderr).split('\n').filter(line => /Error|Traceback|assert|File "/.test(line)).slice(-12).join('\n')}`);
  }
  return out;
}
/** The files in `out` that differ from the committed ones, each with a short reason. */
function differences(out, names = MODELS) {
  const found = [];
  for (const name of names) {
    const made = readFileSync(join(out, name)), kept = readFileSync(join(root, 'web/public/models', name));
    if (made.equals(kept)) continue;
    let at = 0; while (at < Math.min(made.length, kept.length) && made[at] === kept[at]) at++;
    found.push(`${name}: rebuilt ${made.length} bytes, committed ${kept.length} bytes, first difference at byte ${at}`);
  }
  return found;
}

const work = mkdtempSync(join(tmpdir(), 'mmm-models-'));
try {
  const started = Date.now();
  const changed = differences(rebuild(join(root, 'tools/blender'), work));
  for (const line of changed) console.log('FAIL', line);
  assert.deepEqual(changed, [], 'a rebuild gives other bytes than the committed model files: rebuild them (tools/blender/README.md) and commit, or undo the change');
  console.log(`PASS blender-models: ${MODELS.length} model files rebuilt with ${blender.full} are the committed files, byte for byte (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  if (process.argv.includes('--mutations')) {
    // Review r2, M3: the quantizer drops a triangle that its position grid collapses. A looser limit drops more.
    const MUTANTS = [['the quantizer drops slivers up to 1e-5 (the limit is 1e-9)', 'glb_quantize.py', 'if face.length <= 1e-9:', 'if face.length <= 1e-5:', ['mail-car.glb', 'mail-car-low.glb']]];
    for (const [name, file, from, to, affected] of MUTANTS) {
      const scripts = join(work, 'scripts'), out = join(work, 'mutant');
      cpSync(join(root, 'tools/blender'), scripts, { recursive: true, filter: source => !source.includes('__pycache__') });
      const source = readFileSync(join(scripts, file), 'utf8');
      assert.ok(source.includes(from), `mutation anchor not found in ${file}: ${from}`);
      writeFileSync(join(scripts, file), source.replace(from, to));
      spawnSync('mkdir', ['-p', out]);
      const run = spawnSync(blender.path, ['-b', '--factory-startup', '-P', join(scripts, 'mail-car.py'), '--', join(out, 'mail-car.glb')], { encoding: 'utf8', maxBuffer: 1 << 28 });
      assert.equal(run.status, 0, `the mutant build failed to run`);
      const caught = differences(out, affected);
      assert.ok(caught.length > 0, `mutant survived: ${name}`);
      console.log(`CAUGHT ${name}: ${caught[0]}${caught.length > 1 ? ` (+${caught.length - 1} more)` : ''}`);
    }
    console.log(`PASS blender-models mutations: all ${MUTANTS.length} caught`);
  }
} finally {
  if (existsSync(work)) rmSync(work, { recursive: true, force: true });
}
