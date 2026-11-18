// Runs tools/drift-rules-check.mjs on the real sources, and with --mutations once per mutant below: each mutant breaks one
// drift rule on purpose and must make the check fail. Sources are changed only inside the bundle, never on disk.
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..'), dir = mkdtempSync(`${tmpdir()}/mmm-drift-`);
const R = 'drift-rules', survived = [];
// [name, anchor, replacement, file under web/src]
const mutants = [
  ['gravel is firm', "['gravel', 'dirt track', 'washboard', 'grass']", "['dirt track', 'washboard', 'grass']", R],
  ['pavement as easy as gravel', '(loose ? spec.looseSpeed : spec.firmSpeed)', 'spec.looseSpeed', R],
  ['lift-off on pavement', 'if (!loose || c.handbrake || g.speed < spec.liftSpeed', 'if (c.handbrake || g.speed < spec.liftSpeed', R],
  ['the catch before the power', 'if (this.powerFor < LIFT_POWER) this.spoiled = true;', '', R],
  ['a touch is a catch', '-c.steer * this.armed >= CATCH', '-c.steer * this.armed > 0', R],
  ['the armed flick never expires', 'if (this.armedFor <= 0 || c.handbrake) this.armed = 0;', 'if (c.handbrake) this.armed = 0;', R],
  ['the flick moves the car', 'this.armed = this.flick; this.armedFor = LIFT_WINDOW; this.powerFor = 0; this.spoiled = false; return 0;', 'return this.flick;', R],
  ['no handbrake swing', "this.swing = how === 'handbrake' ? SWING_SECONDS : 0;", 'this.swing = 0;', R],
  ['one hard turn flicks', 'if (hard !== this.hardSide && this.sinceHard <= LIFT_WINDOW) this.flick = hard;', 'this.flick = hard;', R],
  ['a turn long ago still flicks', ' && this.sinceHard <= LIFT_WINDOW', '', R],
  ['the flick on the first side', 'const side = this.armed; this.armed = 0; return side;', 'const side = -this.armed; this.armed = 0; return side;', R],
  ['a narrow drift never counts', 'COUNT_ANGLE = .1,', 'COUNT_ANGLE = .17,', R],
  ['a held handbrake starts another', 'c.handbrake && !this.spent && ', 'c.handbrake && ', R],
  ['the held handbrake keeps it open', '      this.swing -= dt;\n    }\n', '      this.swing -= dt;\n    } else if (c.handbrake) target = Math.max(target, spec.angle);\n', R],
  ['an end in the air is clean', "how === 'straightened' || how === 'slowed',", "how === 'straightened' || how === 'slowed' || how === 'airborne',", R],
  ['the chord at once', 'CHORD_SECONDS = .15', 'CHORD_SECONDS = 0', R],
  ['the chord at rest', 'speed >= spec.looseSpeed', 'speed >= 0', R],
  ['braking is a lift', ' && c.throttle >= LIFT_BRAKE', '', R],
  ['a lift never expires', ' && this.sinceThrottle <= LIFT_SECONDS', '', R],
  ['a gentle turn flicks', 'LIFT_WINDOW = .45, LIFT_STEER = .85;', 'LIFT_WINDOW = .45, LIFT_STEER = .3;', R],
  ['any steer pulls the handbrake slide', 'export const HANDBRAKE_STEER = .35;', 'export const HANDBRAKE_STEER = .05;', R],
  ['a trailer helps', 'slower = g.towed ? 1 / TOWED_SPEED : 1', 'slower = 1', R],
  ['wheel straight holds', 'const counter = clamp(-steer * side, 0, 1);', 'const counter = HOLD_STEER;', R],
  ['steering into the slide holds', 'const counter = clamp(-steer * side, 0, 1);', 'const counter = Math.min(1, Math.abs(steer));', R],
  ['holds without power', ': c.throttle > 0 ? POWER_BASE + (1 - POWER_BASE) * Math.min(1, c.throttle) : 0;\n  const counter', ': 1;\n  const counter', R],
  ['no widest angle', 'return Math.min(hold, spec.maxAngle * (towed ? spec.towed : 1));', 'return hold;', R],
  ['pavement holds as gravel', '* (looseSurface(surface) ? 1 : FIRM_HOLD) * (towed ? spec.towed : 1);', '* (towed ? spec.towed : 1);', R],
  ['raw keys', 'this.hands + (counter - this.hands) * (1 - Math.exp(-dt / HANDS))', 'counter', R],
  ['instant rotation', '(1 - Math.exp(-rate * dt))', '1', R],
  ['the path runs wide of the wheel', 'Math.max(carve, g.turn * this.side)', 'carve', R],
  ['never straightens', "if (this.swing <= 0 && size < EXIT_ANGLE && this.motion.target <= size) return this.finish('straightened', x, z);", '', R],
  ['never slows out', "if (speed <= END_SPEED) return this.finish('slowed', x, z);", '', R],
  ['a hit is clean', "clean: how === 'straightened' || how === 'slowed',", "clean: how !== 'lost',", R],
  ['a reset reports', 'this.spent = false; this.pending = null; }', 'this.spent = false; }', R],
  ['a twitch counts', 'this.peak >= COUNT_ANGLE && ', '', R],
  ['a drift reports twice', 'const p = this.pending; this.pending = null; return p;', 'return this.pending;', R],
  ['no drift step', 'else if (this.driftStep(', 'else if (false && this.driftStep(', 'vehicle'],
  ['a hit leaves the slide', 'onSolidImpact(speed: number): void { this.drift.hit(this.x, this.z); ', 'onSolidImpact(speed: number): void { ', 'vehicle'],
  ['a placement keeps the slide', '    this.drift.reset();\n', '', 'vehicle'],
  ['a computer driver drifts', 'if (!spec || !this.canDrift || ', 'if (!spec || ', 'vehicle'],
  ['the slide scrubs nothing', ' + m.scrub;', ';', 'vehicle'],
  ['the water is clean', 'this.drift.hit(this.x, this.z);   // into the water', '// into the water', 'vehicle'],
  ['the slide steers at once', 'this.steerAngle = THREE.MathUtils.clamp(this.steerAngle + THREE.MathUtils.clamp(wheel - this.steerAngle, -steerRate * dt, steerRate * dt), -lock, lock);', 'this.steerAngle = wheel;', 'vehicle'],
  ['the edge is clean', 'this.drift.hit(this.x, this.z); this.vx *= 0.2;', 'this.vx *= 0.2;', 'vehicle'],
  ['no speed limit in a slide', 'if (touchLimit > 0 && t > 0) {', 'if (false) {', 'vehicle'],
  ['the air keeps the slide', 'if (this.airborne) { this.drift.airborne(this.x, this.z);', 'if (this.airborne) {', 'vehicle'],
  ['the flick clocks stop in the air', 'this.drift.airborne(this.x, this.z); this.drift.watch(input, dt); }', 'this.drift.airborne(this.x, this.z); }', 'vehicle'],
  ['drift unsized', 'POINTS[e.kind] * eventSize(e) *', 'POINTS[e.kind] *', 'score-rules'],
  ['drift points uncapped', 'Math.min(m.most, ', '(', 'score-rules'],
  ['no clean bonus', '(d.clean ? m.clean : 1)', '1', 'score-rules'],
  ['pavement worth no more', '(looseSurface(d.surface) ? 1 : m.firm)', '1', 'score-rules'],
  ['drifts not reported', '    if (drift) this.reportDrift(drift);\n', '', 'shift'],
  ['protected ground unsampled', "if (here !== 'route') this.driftPlace = here;", '', 'shift'],
  ['animals ignored', "if (c.kind === 'sceneAnimal') this.animalAt = c.at / CLOCK_FACTOR; ", '', 'shift'],
  ['drifts after the end', '  reportDrift(d: DriftFacts): void {\n    if (this.ended) return;\n', '  reportDrift(d: DriftFacts): void {\n', 'shift'],
  ['no squeal', 'if (firm) t = {', 'if (false) t = {', 'engine-sound-rules'],
  ['rolling tyres change', 'if (slide > 0 && t.gain > 0)', 'if (t.gain > 0)', 'engine-sound-rules'],
  ['LOW keeps the big pool', 'this.size = low ? 24 : 56;', 'this.size = 56;', 'drift-feedback'],
  ['dust shown at rest', 'this.shown = alive > 0; this.mesh.visible = this.shown;', 'this.shown = alive > 0; this.mesh.visible = true;', 'drift-feedback'],
  ['the phone row hides the handbrake', ' Both at once: handbrake.', '', 'controls'],
];
try {
  for (const mutant of [null, ...(process.argv.includes('--mutations') ? mutants : [])]) {
    const file = mutant?.[3], source = file && resolve(root, `web/src/${file}.ts`), original = file && readFileSync(source, 'utf8');
    if (mutant) assert.ok(original.split(mutant[1]).length === 2, mutant[0] + ': anchor must match once');
    await build({ entryPoints: [resolve(root, 'tools/drift-rules-check.mjs')], bundle: true, platform: 'node', format: 'esm', outfile: `${dir}/check.mjs`, logLevel: 'silent',
      plugins: mutant ? [{ name: 'mutate', setup(b) { b.onLoad({ filter: new RegExp(`/${file}\\.ts$`) }, () => ({ contents: original.replace(mutant[1], () => mutant[2]), loader: 'ts', resolveDir: dirname(source) })); } }] : [] });
    const r = spawnSync(process.execPath, [`${dir}/check.mjs`], { cwd: resolve(root, 'web'), encoding: 'utf8', timeout: 180000 });
    if (!mutant) { assert.equal(r.status, 0, r.stdout + r.stderr); console.log(r.stdout.trim()); }
    else if (r.status === 0 || !/AssertionError/.test(r.stderr)) { survived.push(mutant[0]); console.log('SURVIVED', mutant[0], r.stderr.slice(0, 300)); }
    else console.log('REJECTED', mutant[0]);
  }
  assert.deepEqual(survived, [], 'every mutant must fail the check');
  if (process.argv.includes('--mutations')) console.log(`drift rules: ${mutants.length} mutants rejected`);
} finally { rmSync(dir, { recursive: true, force: true }); }
