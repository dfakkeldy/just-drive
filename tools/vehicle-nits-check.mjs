// Node only. Normal checks need neither Git history nor an old solver copy.
// A deliberate change to driving: run --record on the new code, paste the goldens
// with the commit SHA and one line that says what changed and why; a reviewer
// must see that line. --record prints only and refuses dirty bundle inputs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';
import { build } from '../web/node_modules/esbuild/lib/main.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const GOLDEN_COMMIT = '61b6083456dfb2ab5dc39585cd618e66208e91c7';
// Review note: expand G20c coverage without driving changes; retain the approved removal of unread bike leans.
const RECORD_PROCEDURE = 'A deliberate change to driving: run node tools/vehicle-nits-check.mjs --record on the new code, paste the goldens with the commit SHA and one line that says what changed and why; a reviewer must see that line.';
const N = 5000, MIXED_N = 4500, dt = 1 / 120;
// Paste the --record output here. SHA-256 consumes little-endian Float64 values,
// including -0; a separate Float64 stream hashes each update's random draw count.
// Recorded from the clean base: 5000 washboard + 4500 mixed updates per garage entry; seed=0x6e697473.
const GOLDEN = {
  "car": {
    "spec": "718a49190e4b6e1d595bbc90dc1efdfe5115f4070d5b48c2041a92696ab14f28",
    "washboard": {
      "state": "b3ad93dd4158c590ecd4e49097492b21fc8231e5d7b6e60fe8b2454c60a20456",
      "draws": "df80ec233e159477bf8ebdf89a5a9531a2c07c98e3609fa455d1f2a25339f84a",
      "histogram": {
        "5": 5000
      }
    },
    "mixed": {
      "state": "0e9f7c67909aaa98d9ad8cea8979235cd4e8893f93bb8d6461e70cfb3ff0ee43",
      "draws": "b138e29aa37fd94507e72145adf21882169e22ca27edf9c85b23c518da8e7218",
      "histogram": {
        "3": 3150,
        "5": 654,
        "7": 396,
        "11": 300
      }
    }
  },
  "sxs": {
    "spec": "48b612d025d22a8408f3683af4bb9e8b57fe7422949301a101e3b7afd589bc6b",
    "washboard": {
      "state": "eb54ddd4efc2b89950fcad2071665f200b6899a1ff23873a09da4de43f5ec6d5",
      "draws": "ff0d8c3724de8c0ddf213c14a32c25110399b42aa075435199752a2f8bf3b995",
      "histogram": {
        "3": 64,
        "5": 4936
      }
    },
    "mixed": {
      "state": "67cb8c6858bc4f2d04a9d6bb59e0cb3ae64f57324a5d929c296da40b86718634",
      "draws": "0bade109cdec9c66c82ebc7fd3e6fc0e8b802986b04a63e6f2a03c04449b2609",
      "histogram": {
        "3": 3403,
        "5": 532,
        "7": 322,
        "9": 1,
        "11": 242
      }
    }
  },
  "truck": {
    "spec": "c417bb66a79252ddcf173d390b7aabeae692bdf33033b5292018e4541f097919",
    "washboard": {
      "state": "4cd4910e387cb9d8aa0677c5e19b677a8c558a44af5323afc714323541396776",
      "draws": "df80ec233e159477bf8ebdf89a5a9531a2c07c98e3609fa455d1f2a25339f84a",
      "histogram": {
        "5": 5000
      }
    },
    "mixed": {
      "state": "651d8fdd13e26b1e988982be722b2d8d6abb34e9f873aeebd818245556a6478a",
      "draws": "d78fa522917157ed4854a9e9a3b4ff515103f6d9acac53a81b6976c68ba5deb2",
      "histogram": {
        "3": 3188,
        "5": 636,
        "7": 385,
        "11": 291
      }
    }
  },
  "bike": {
    "spec": "3a5e13ec93ebff65c15f64c75b6770872a6b00da2fed53d2aab06c47d60de7f5",
    "specAfterLeansRemoval": "d4e0097be484a22253d008ad08fdafe7b24afe48618fc499342698923b319ff7",
    "washboard": {
      "state": "31110cd3631cea0e42631acebec314e4471ebcc555c5b45a2c68f71de93b48a7",
      "draws": "e7e2dcff542de95352682dc186432e98f0188084896773f1973276b0577d5305",
      "histogram": {
        "0": 5000
      }
    },
    "mixed": {
      "state": "1a148fe79ea14f0b15deb61e770340fba9fe95ed0a78301e4ced8701a8d2898e",
      "draws": "d7967a6f7d2dd3204ed70cc72c705e33a573aef8431b69c5bbd39e5b5cd67384",
      "histogram": {
        "0": 4500
      }
    }
  }
};

const read = path => readFileSync(new URL(path, `file://${root}`), 'utf8');
const seeded = () => { let s = 0x6e697473; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; };
const hash = () => createHash('sha256');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const specHash = spec => hash().update(JSON.stringify(stable(spec))).digest('hex');
let bundleInputs = [];
function cleanBundleInputs() {
  // Metafile includes every transitive production dependency, not a hand-written list.
  // Installed node_modules are ignored dependencies, not files in the current Git tree.
  const inputs = bundleInputs.map(path => relative(root, resolve(root, path)))
    .filter(path => !path.startsWith('../') && path !== '<stdin>' && !path.includes('node_modules/'));
  assert.ok(inputs.includes('web/src/defects.ts') && inputs.includes('web/src/damage-rules.ts')
    && inputs.includes('web/src/driving-help.ts'), 'recorder must cover transitive driving inputs');
  for (const path of inputs) {
    try { execFileSync('git', ['ls-files', '--error-unmatch', '--', path], { cwd: root, stdio: 'ignore' }); }
    catch { throw Error(`--record refuses untracked bundle input: ${path}`); }
  }
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...inputs], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(dirty, '', `--record refuses dirty bundle inputs (commit the intended driving change first):\n${dirty}`);
  return inputs;
}
const doubles = values => { const b = Buffer.allocUnsafe(values.length * 8); values.forEach((n, i) => b.writeDoubleLE(n, i * 8)); return b; };
async function bundle(replacements = {}) {
  const result = await build({ stdin: { contents: `export {Vehicle} from './web/src/vehicle.ts'; export {GARAGE} from './web/src/garage.ts'; export * as THREE from 'three';`, resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', write: false, metafile: true, logLevel: 'silent',
    alias: { 'three/addons': `${root}web/node_modules/three/examples/jsm`, three: `${root}web/node_modules/three/build/three.module.js` }, plugins: [{ name: 'in-memory', setup(b) {
      b.onLoad({ filter: /[/\\]web[/\\]src[/\\].*\.ts$/ }, a => {
        const path = a.path.slice(root.length);
        return path in replacements ? { contents: replacements[path], loader: 'ts' } : undefined;
      });
    } }] });
  if (!Object.keys(replacements).length) bundleInputs = Object.keys(result.metafile.inputs);
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
function fixture(mod, entry, mixed = false) {
  // No model construction randomness enters the physics stream. Small rigs retain
  // the actual sync paths: truck duals, SXS suspension, and BikeRide.pose.
  const { THREE } = mod, root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const rig = { root, body, wheels: Object.fromEntries(['fl', 'fr', 'rl', 'rr'].map(k => [k, new THREE.Group()])),
    steer: { fl: new THREE.Group(), fr: new THREE.Group() }, driverEye: new THREE.Object3D(), brakeLights: [] };
  if (entry.id === 'truck') rig.extraWheels = [new THREE.Group(), new THREE.Group()];
  if (entry.id === 'sxs') rig.setTravel = (...values) => { rig.travel = values; };
  if (entry.ride) rig.pose = values => { rig.poseValues = values; };
  const world = { phase: 0 };
  // A physical 12 m ramp rises 2.4 m, then ends: no artificial vertical impulse.
  const heightAt = (_x, z) => {
    const along = ((-z % 100) + 100) % 100;
    return 40 + (mixed && world.phase === 1 && along > 20 && along < 32 ? (along - 20) * .2 : 0);
  };
  const terrain = { heightAt, withContactHeight: (_, f) => f(), surfaceAt: (x, z) => ({
    kind: mixed && world.phase === 2 ? 0 : mixed && (world.phase === 1 || world.phase === 3) ? 1 : 3,
    ground: heightAt(x, z), roadDist: 0, halfWidth: 10000, canopy: 0, level: 8,
    washboard: !mixed || world.phase === 0 || world.phase === 4,
  }) };
  const road = { id: 1, kind: 3, halfWidth: 10000, pts: [[0, 0], [0, -10000]] };
  const roads = { deckHeight: () => null, nearest: (x, z) => ({ x, z, dist: 0, heading: 0, seg: 0, t: 0, road }) };
  const v = entry.ride ? entry.ride(rig, terrain, roads, -1000, entry.spec) : new mod.Vehicle(rig, terrain, roads, -1000, entry.spec);
  v.assist = 0;
  return { v, rig, terrain, roads, world };
}
function numericState({ v, rig, terrain, roads }) {
  const fields = [], values = [], seen = new Set([rig, terrain, roads, v.spec]);
  // The horse adds a contact buffer to Vehicle; motors must leave it untouched.
  // Pin it separately so the existing motor state/draw goldens remain exact.
  if (v.spec.locomotion !== 'horse' && v.meshProbe) {
    assert.deepEqual(v.meshProbe, { height: 0, source: 0, drawn: false }, 'inactive horse mesh probe stays zero for motors');
    seen.add(v.meshProbe);
  }
  function walk(o, path) {
    // Saved pose height is new bridge ownership metadata. Its behaviour is pinned by
    // bridges-underdeck; omit only that extra field to preserve every pre-existing
    // washboard/mixed physical value and all random-draw digests exactly.
    if (/^vehicle\.(?:lastSafe|lastGood)\.y$|^vehicle\.(?:trail|roadTrail)\.\d+\.y$/.test(path)) { assert.ok(Number.isFinite(o), 'saved bridge pose height is finite'); return; }
    // The retry reference height (bridge ownership for a stuck re-place) is the same kind of metadata.
    if (path === 'vehicle.placeReference') { assert.ok(o === undefined || Number.isFinite(o), 'retry reference height is finite'); return; }
    if (typeof o === 'number') { assert.ok(Number.isFinite(o), `non-finite ${path}`); fields.push(path); values.push(o); }
    else if (o && typeof o === 'object' && !seen.has(o)) {
      seen.add(o);
      for (const key of Object.keys(o).sort()) walk(o[key], `${path}.${key}`);
    }
  }
  // All owned numeric state, including private vectors, contacts, trails and help.
  // Exclude referenced services/spec/scene graphs (their ids are process counters).
  walk(v, 'vehicle');
  for (const [name, node] of Object.entries({ root: rig.root, body: rig.body, ...rig.wheels, steerFl: rig.steer.fl, steerFr: rig.steer.fr,
    ...Object.fromEntries((rig.extraWheels ?? []).map((w, i) => [`dual${i}`, w])) })) {
    for (const prop of ['position', 'rotation', 'quaternion', 'scale']) walk(node[prop], `rig.${name}.${prop}`);
  }
  walk(rig.travel, 'rig.travel'); walk(rig.poseValues, 'rig.pose');
  return { fields, values };
}
function replay(mod, entry, section, mode = 'global', expectedStates, keepStates = false) {
  const mixed = section === 'mixed', f = fixture(mod, entry, mixed), rng = seeded(), script = seeded(), old = Math.random;
  const stateHash = hash(), countHash = hash(), states = [], histogram = {};
  const coverage = { washboard: 0, pavement: 0, grass: 0, airborne: 0, kickerAir: 0, stopped: 0, reverse: 0, slowWash: 0, zeroStep: 0, multiStep: 0, tow: 0 };
  let draws = 0, globalCalls = 0, steps = 0;
  const source = () => { draws++; return mode === 'constant' ? .5 : rng(); };
  const step = f.v.step;
  f.v.step = function (...args) {
    steps++; step.apply(this, args);
    if (this.surfaceName in coverage) coverage[this.surfaceName]++;
    if (this.airborne) { coverage.airborne++; if (f.world.phase === 1) coverage.kickerAir++; }
    if (this.speed === 0 && Math.hypot(this.vx, this.vz) < 1e-6) coverage.stopped++;
    if (this.speed < -.1) coverage.reverse++;
    if (this.surfaceName === 'washboard' && !this.airborne && Math.abs(this.speed) < 5) coverage.slowWash++;
    if (this.towLoad) coverage.tow++;
  };
  const speed = n => { f.v.vx = Math.sin(f.v.heading) * n; f.v.vz = -Math.cos(f.v.heading) * n; f.v.speed = n; };
  try {
    if (mode === 'global') Math.random = source;
    else { f.v.random = source; Math.random = () => { globalCalls++; throw Error('injected Vehicle random seam called global Math.random'); }; }
    f.v.place(0, 0, .17); speed(mixed ? 0 : 12);
    for (let i = 0; i < (mixed ? MIXED_N : N); i++) {
      const phase = Math.floor(i / 900), local = i % 900;
      let elapsed = dt, input = { throttle: i % 1000 < 850 ? .85 : -.25, steer: Math.sin(i * .013) * .3, handbrake: i % 1200 > 1170 };
      if (mixed) {
        if (local === 0) {
          f.world.phase = phase;
          if (entry.id === 'truck') f.v.towLoad = phase === 4 ? { mass: 2300, brakeShare: .25, dragShare: .25, driveMassShare: .7 } : null;
          f.v.place(0, 0, 0); speed(phase === 1 || phase === 2 || phase === 3 ? 14 : 0);
        }
        const heading = Math.atan2(Math.sin(f.v.heading), Math.cos(f.v.heading));
        const steer = Math.max(-.3, Math.min(.3, -f.v.x * .08 - heading * 1.4 + (script() - .5) * .04));
        input = phase === 3 ? { throttle: local < 500 ? 0 : -.8, steer: 0, handbrake: local < 500 }
          : { throttle: .8 + script() * .2, steer, handbrake: false };
        elapsed = [0, 1 / 240, 1 / 60, 1 / 30, 1 / 120, .011][i % 6];
      }
      draws = steps = 0;
      f.v.update(elapsed, input);
      if (steps === 0) coverage.zeroStep++;
      if (steps > 1) coverage.multiStep++;
      const state = numericState(f);
      stateHash.update(doubles(state.values)); countHash.update(doubles([draws])); histogram[draws] = (histogram[draws] ?? 0) + 1;
      if (keepStates) states.push(state);
      if (expectedStates) {
        const expected = expectedStates[i];
        assert.deepEqual(state.fields, expected.fields, `${entry.id}/${section} update ${i} numeric field inventory`);
        state.values.forEach((n, j) => assert.ok(Object.is(n, expected.values[j]), `${entry.id}/${section} update ${i} ${state.fields[j]} is not Object.is equal`));
      }
    }
  } finally { Math.random = old; }
  if (mixed) {
    for (const key of Object.keys(coverage).filter(k => k !== 'tow' || entry.id === 'truck'))
      assert.ok(coverage[key] > 0, `${entry.id} mixed scenario must exercise ${key}: ${JSON.stringify(coverage)}`);
  }
  return { golden: { state: stateHash.digest('hex'), draws: countHash.digest('hex'), histogram }, states, globalCalls, coverage };
}
function frozenSpecs(mod) {
  function walk(o, path, seen = new Set()) {
    if (!o || typeof o !== 'object' || seen.has(o)) return;
    seen.add(o); assert.ok(Object.isFrozen(o), `${path} must be frozen`);
    // Strict ESM: try a write on every nested object and array.
    const key = Object.keys(o)[0] ?? '__probe';
    assert.throws(() => { o[key] = o[key]; }, TypeError, `${path} write must throw`);
    for (const [key, value] of Object.entries(o)) walk(value, `${path}.${key}`, seen);
  }
  for (const entry of mod.GARAGE) walk(entry.spec, `${entry.id}.spec`);
}
function verifySpec(entry) {
  assert.equal(specHash(entry.spec), GOLDEN[entry.id].specAfterLeansRemoval ?? GOLDEN[entry.id].spec, `${entry.id} full spec JSON digest`);
}
function verify(mod, seams = false, report = false) {
  // Grounded mounts have their own gait/footing/repair suite (check-horse.sh); this frozen motor
  // oracle deliberately includes airborne kickers and preserves all four existing goldens.
  const motors = mod.GARAGE.filter(e => e.spec.locomotion !== 'horse');
  assert.deepEqual(motors.map(e => e.id).sort(), Object.keys(GOLDEN).sort(), 'golden covers every motor vehicle');
  for (const entry of motors) {
    verifySpec(entry);
    for (const section of ['washboard', 'mixed']) {
      const result = replay(mod, entry, section, 'global', undefined, seams && !entry.ride);
      const expected = GOLDEN[entry.id][section];
      assert.deepEqual(result.golden.histogram, expected.histogram, `${entry.id}/${section} draw-count totals`);
      assert.equal(result.golden.draws, expected.draws, `${entry.id}/${section} per-update draw-count digest`);
      assert.equal(result.golden.state, expected.state, `${entry.id}/${section} numeric state digest from ${GOLDEN_COMMIT}`);
      if (seams && !entry.ride) {
        const injected = replay(mod, entry, section, 'seeded', result.states);
        assert.deepEqual(injected.golden, result.golden, `${entry.id}/${section} injected/default stream parity`);
        assert.equal(injected.globalCalls, 0);
        const constant = replay(mod, entry, section, 'constant');
        assert.equal(constant.globalCalls, 0);
        assert.ok(Object.keys(constant.golden.histogram).some(n => Number(n) > 3), `${entry.id} constant source exercises washboard and sync`);
      }
      if (report) console.log(`PASS ${entry.id}/${section}: state + per-update draw digest; ${JSON.stringify(result.coverage)}`);
    }
  }
  frozenSpecs(mod);
  if (report) console.log('PASS full spec JSON digests; deep freeze/strict writes; Object.is seam parity and zero injected global calls');
}

try {
  const mod = await bundle();
  if (process.argv.includes('--record')) {
    const inputs = cleanBundleInputs(), commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const golden = {};
    for (const entry of mod.GARAGE.filter(e => e.spec.locomotion !== 'horse')) {
      const row = { spec: specHash(entry.spec) };
      // Base 61b6083 contains the approved, unread bike flag removed by G20c L31.
      // Record both full base JSON and the exact approved deletion, from base data.
      if (entry.id === 'bike' && Object.hasOwn(entry.spec, 'leans')) {
        const { leans: _unused, ...copy } = entry.spec;
        row.specAfterLeansRemoval = specHash(copy);
      }
      for (const section of ['washboard', 'mixed']) row[section] = replay(mod, entry, section).golden;
      golden[entry.id] = row;
    }
    cleanBundleInputs();
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), commit, 'HEAD changed during recording');
    console.log(`// Recorded clean current tree (${inputs.length} bundle source inputs).\nconst GOLDEN_COMMIT = '${commit}';\n// Review note: REQUIRED: say what changed and why; a reviewer must see this line.\nconst GOLDEN = ${JSON.stringify(golden, null, 2)};`);
  } else {
    verify(mod, true, true);
    if (process.argv.includes('--mutations')) {
      const source = read('web/src/vehicle.ts');
      const pair = source.match(/^( *this.heading \+= \(this.random\(\)[^\n]*\n)( *vl \+= \(this.random\(\)[^\n]*\n)/m);
      assert.ok(pair, 'mutation anchor: adjacent washboard draws');
      const replace = (text, anchor, replacement) => { assert.ok(text.includes(anchor), `mutation anchor: ${anchor}`); return text.replace(anchor, replacement); };
      const variants = [
        ['extra draw', source.replace(pair[0], `        this.random();\n${pair[0]}`), /draw-count/],
        ['draw order swapped', source.replace(pair[0], pair[2] + pair[1]), /numeric state digest/],
        ['pavement-only extra draw', replace(source, 'const mu = surf.mu * skip, t = input.throttle;', 'if (surf === SURFACES.paved) this.random();\n      const mu = surf.mu * skip, t = input.throttle;'), /mixed.*draw-count/],
        ['grass-only extra draw', replace(source, 'const mu = surf.mu * skip, t = input.throttle;', 'if (surf === SURFACES.grass) this.random();\n      const mu = surf.mu * skip, t = input.throttle;'), /mixed.*draw-count/],
        ['reverse sync extra draw', replace(source, 'private sync(dt: number) {', 'private sync(dt: number) {\n    if (this.speed < 0) this.random();'), /mixed.*draw-count/],
        ['tow-load step extra draw', replace(source, 'private step(dt: number, input: Input) {', 'private step(dt: number, input: Input) {\n    if (this.towLoad) this.random();'), /truck\/mixed.*draw-count/],
        ['no washboard draws below 5 m/s', source.replace(pair[0], `        if (Math.abs(vf) >= 5) {\n${pair[0]}        }\n`), /mixed.*draw-count/],
      ];
      for (const [name, replacement, message] of variants) {
        const mutant = await bundle({ 'web/src/vehicle.ts': replacement });
        assert.throws(() => verify(mutant), message, `${name} must fail its intended assertion`);
        console.log(`MUTATION rejected: ${name}`);
      }
      // Check each reviewer's 1% spec mutation independently, including values
      // unused by either scenario. Full JSON parity must reject all of them.
      for (const [path, anchor, replacement, vehicle] of [
        ['truck', 'back: 10.8', 'back: 10.8 * 1.01', 'truck'],
        ['truck', 'mass: 3650', 'mass: 3650 * 1.01', 'truck'],
        ['truck', 'hitch: { back: 3.4', 'hitch: { back: 3.4 * 1.01', 'truck'],
        ['bike', 'engineAcceleration: 6.4', 'engineAcceleration: 6.4 * 1.01', 'bike'],
        ['vehicle-spec', 'radius: 0.95', 'radius: 0.95 * 1.01', 'car'],
      ]) {
        const file = `web/src/${path}.ts`, mutant = await bundle({ [file]: replace(read(file), anchor, replacement) });
        const entry = mutant.GARAGE.find(e => e.id === vehicle);
        assert.throws(() => verifySpec(entry), /full spec JSON digest/, `${anchor} spec mutant must fail the production assertion`);
        console.log(`MUTATION rejected: ${path} ${anchor} +1% (full spec JSON digest)`);
      }
      const spec = read('web/src/vehicle-spec.ts'), anchor = 'Object.freeze(value);';
      const mutant = await bundle({ 'web/src/vehicle-spec.ts': replace(spec, anchor, 'if (!(Array.isArray(value) && value.length === 3 && value[0] === -1.35)) Object.freeze(value);') });
      assert.throws(() => frozenSpecs(mutant), /car\.spec\.envelope\.circles must be frozen/, 'nested freeze mutant must fail the deep walk');
      console.log('MUTATION rejected: nested part left unfrozen');
    }
  }
} catch (error) {
  console.error(`${error.stack}\n${RECORD_PROCEDURE}`);
  process.exitCode = 1;
}
