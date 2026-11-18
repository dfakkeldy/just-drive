// Bundle the permanent check with one in-memory rule edit. Never write web/src.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { mutationSources } from './mutation-source.mjs';

const suites = {
  'yard-dog': {
    check: 'yard-dog-rules-check.mjs',
    mutants: [
      ['pause gate', 'if(dt<=0)return;', 'if(dt<0)return;'],
      ['trigger range', 'Math.hypot(carAlong,carAcross)<42', 'Math.hypot(carAlong,carAcross)<20'],
      ['follow limit', 'carAlong-this.direction*4,-18,18', 'carAlong-this.direction*4,-10,10'],
      ['bark event', 'this.bark=true;', 'this.bark=false;'],
    ],
  },
  damage: {
    check: 'damage-check.mjs',
    mutants: [
      ['landing threshold', "cause === 'landing' ? 4.5 : 5", "cause === 'landing' ? 6 : 5"],
      ['impact alignment threshold', 'if (speed >= 10)', 'if (speed >= 20)'],
      ['washboard speed threshold', "surface === 'washboard' ? speed > 8", "surface === 'washboard' ? speed > 4"],
      ['ditch depth threshold', 'ditchDepth > .65', 'ditchDepth > 1'],
    ],
  },
  jump: {
    check: 'jump-rules-check.mjs',
    mutants: [
      ['launch speed', 's.speed < 4', 's.speed < 1'],
      ['placement continuity', 's.placement === p.placement', 'true'],
      ['landing roll', 'Math.abs(s.roll) < 0.35', 'Math.abs(s.roll) < 1'],
      ['settling slide', 'Math.abs(s.sideways) >= 3', 'Math.abs(s.sideways) >= 30'],
    ],
  },
  mine: {
    check: 'mine-check.mjs',
    mutants: [
      ['bend speed', 'this.speed > 4.2', 'this.speed > 9'],
      ['tip recovery', 'this.timer = 8;', 'this.timer = 4;'],
      ['fork direction', 'input.lean * this.layout[this.stage].direction < .25', 'input.lean * this.layout[this.stage].direction > .25'],
      ['signature branch', 'this.signed = true;', 'this.signed = false;'],
    ],
  },
  shift: {
    check: 'shift-check.mjs',
    mutants: [
      ['suspension threshold', 'avoidable.length >= 3', 'avoidable.length >= 4'],
      ['suspension day', '(suspended ? 2 : 1)', '(suspended ? 1 : 1)'],
      ['vehicle allowance', 'VEHICLE_ALLOWANCE = 135', 'VEHICLE_ALLOWANCE = 134'],
      ['double delivery', '2 * Math.max(a, b)', '2 * Math.min(a, b)'],
    ],
  },
};
const name = process.argv[2], suite = suites[name];
assert.ok(suite, 'usage: node tools/rule-mutants.mjs damage|jump|mine|shift|yard-dog [--base]');
assert.ok(process.argv.slice(3).every(arg => arg === '--base'), 'unknown argument');
const root = resolve(import.meta.dirname, '..');
const cases = suite.mutants.map(([name, from, to]) => ({ name, edits: [{ file: `web/src/${process.argv[2]}-rules.ts`, from, to }] }));
// Validate all anchors before running anything, including in --base mode.
for (const test of cases) mutationSources(root, test);
const scratch = mkdtempSync(join(tmpdir(), 'mmm-rule-mutants-'));
try {
  for (const test of [null, ...(process.argv.includes('--base') ? [] : cases)]) {
    const sources = test ? mutationSources(root, test) : new Map();
    const file = join(scratch, 'check.mjs');
    await build({ entryPoints: [resolve(root, 'tools', suite.check)], bundle: true,
      platform: 'node', format: 'esm', outfile: file, logLevel: 'silent',
      plugins: [{ name: 'one-rule', setup(builder) {
        builder.onLoad({ filter: /\.ts$/ }, args => sources.has(args.path)
          ? { contents: sources.get(args.path), loader: 'ts' } : undefined);
      } }],
    });
    const result = spawnSync(process.execPath, [file], { cwd: resolve(root, 'web'), encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    assert.ifError(result.error);
    assert.equal(result.signal, null, 'check must exit normally');
    const output = result.stdout + result.stderr;
    if (!test) {
      assert.equal(result.status, 0, `unmodified ${name} check must pass\n${output}`);
      console.log(`PASS ${name}: unmodified ${suite.check}`);
    } else {
      assert.equal(result.status, 1, `${test.name}: mutant must fail\n${output}`);
      assert.match(result.stderr, /AssertionError \[ERR_ASSERTION\]/, `${test.name}: must fail an assertion, not setup\n${output}`);
      console.log(`KILLED ${name}: ${test.name}`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
