#!/usr/bin/env node
// Production mode adapter + Vehicle on a deterministic, flat road. No browser or source writes.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build, transformSync } from '../web/node_modules/esbuild/lib/main.js';
import { mutationSources } from './mutation-source.mjs';
const root = resolve(new URL('..', import.meta.url).pathname);
const scratch = mkdtempSync(tmpdir() + '/mmm-phone-speed-cap-');
let bundle = 0;
const mutations = [
  ['explore cap left on', 'main.ts', 'if (!mailMode) vehicle.touchSpeedLimit = false;', ''],
  ['mail cap removed', 'main.ts', 'if (!mailMode) vehicle.touchSpeedLimit = false;', 'vehicle.touchSpeedLimit = false;'],
  ['old paved limit', 'vehicle.ts', 'kind === 2 ? 90 / 3.6', 'kind === 2 ? 70 / 3.6'],
  ['bridge deck limits as concrete', 'vehicle.ts', 'const kind = siteDeck && s.deckRoadKind !== undefined ? s.deckRoadKind : s.kind;', 'const kind = s.kind;'],
  ['limiter removed', 'vehicle.ts', 'if (limit > 0) a -=', 'if (false) a -='],
  ['hard limiter brake', 'vehicle.ts', 'export const LIMIT_BRAKE = 1.2;', 'export const LIMIT_BRAKE = 8;'],
  ['washboard too slow', 'vehicle.ts', 's.washboard ? 50 / 3.6 :', 's.washboard ? 10 :'],
  ['active limit always zero', 'vehicle.ts', 'return this.#heldTouchSpeedLimit;', 'return 0;'],
  ['active limit always on', 'vehicle.ts', 'return this.#heldTouchSpeedLimit;', 'return 90 / 3.6;'],
  ['early clear removed', 'vehicle.ts', '    if (!input.touch || !this.strongHelp || !this.touchSpeedLimit || input.throttle <= 0 || this.airborne || this.stuck) this.#heldTouchSpeedLimit = 0;\n', ''],
  ['active limit not cleared', 'vehicle.ts', '    this.#heldTouchSpeedLimit = 0;\n    this.helpYaw', '    this.helpYaw'],
];
async function load(mutation) {
  const sources = mutation ? mutationSources(root, { name: mutation[0], edits: [{ file: 'web/src/' + mutation[1], from: mutation[2], to: mutation[3] }] }) : new Map();
  const main = sources.get(resolve(root, 'web/src/main.ts')) ?? readFileSync(new URL('../web/src/main.ts', import.meta.url), 'utf8');
  const start = main.search(/(?:const|let) vehicle = garageEntry\.ride/), end = main.indexOf('const ride = rideFeatures', start);
  assert.ok(start > 0 && end > start, 'production vehicle and mode adapter found');
  // The live selection accessor in this region is exported TypeScript. Evaluate the
  // same mode adapter as a local function body, with either const or mutable bindings.
  const code = transformSync(main.slice(start, end), { loader: 'ts' }).code.replace(/^export /gm, '') + 'return vehicle;';
  const { outputFiles } = await build({
    stdin: { contents: `export {Vehicle} from './web/src/vehicle.ts'; export {GARAGE} from './web/src/garage.ts'; export {legacyVehicle} from './web/src/ride.ts'; export {TRAILER_SPEC} from './web/src/trailer.ts'; export {Object3D} from 'three';`, resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    nodePaths: [root + '/web/node_modules'],
    plugins: [{ name: 'fault', setup(b) { b.onLoad({ filter: /\.ts$/ }, args => sources.has(args.path) ? { contents: sources.get(args.path), loader: 'ts' } : undefined); } }],
  });
  const file = `${scratch}/${bundle++}.mjs`; writeFileSync(file, outputFiles[0].text);
  const module = await import(pathToFileURL(file).href);
  const construct = new Function('garageEntry', 'car', 'terrain', 'roads', 'SEA_LEVEL', 'vehicleSpec', 'mailMode', 'Vehicle', 'legacyVehicle', code);
  return { ...module, construct };
}
function verify(m, report = false) {
  const { Vehicle, GARAGE, Object3D, TRAILER_SPEC } = m;
  const node = () => new Object3D();
  const rig = () => ({ pose() {}, root: node(), body: node(), steer: { fl: node(), fr: node() }, wheels: { fl: node(), fr: node(), rl: node(), rr: node() } });
  const roads = { roads: [], nearest: () => null, deckHeight: () => null };
  const surface = { ground: 100, canopy: 0, kind: 2, washboard: false, roadDist: 0, halfWidth: 3, level: 8 };
  const terrain = { heightAt: () => 100, meshContactAt: (_x, _z, out) => { out.height = 100; out.source = 8; out.drawn = true; return true; },
    withContactHeight: (_, read) => read(), surfaceAt: () => surface };
  const input = { throttle: 1, steer: 0, handbrake: false, touch: true }, dt = 1 / 60;
  const fresh = (id = 'car', mailMode = true, trailer = false) => {
    const entry = GARAGE.find(e => e.id === id);
    const v = m.construct(entry, rig(), terrain, roads, 0, entry.spec, mailMode, Vehicle, m.legacyVehicle);
    if (trailer) v.towLoad = { ...TRAILER_SPEC, mass: trailer === 'empty' ? TRAILER_SPEC.mass : TRAILER_SPEC.loadedMass };
    v.strongHelp = true; v.place(0, 0, 0);
    return v;
  };
  const speed = (v, n) => { v.speed = n; v.vx = 0; v.vz = -n; };
  for (const entry of GARAGE) for (const mailMode of [false, true]) {
    const v = fresh(entry.id, mailMode);
    assert.equal(v.touchSpeedLimit, mailMode && entry.id !== 'bike', entry.id + ': production mode cap policy');
    assert.equal(v.strongHelp, true, 'mode must retain steering help');
    if (entry.id === 'bike') assert.equal(v.activeTouchSpeedLimit, 0, 'bike never reports a cap');
  }
  for (const [id, trailer] of [['car', false], ['truck', false], ['truck', 'empty'], ['truck', 'loaded'], ['sxs', false]]) {
    const peaks = [];
    for (const mailMode of [false, true]) {
      let seed = 0x53504545;
      const oldRandom = Math.random;
      Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
      try {
        const v = fresh(id, mailMode, trailer); let peak = 0, activeFrames = 0;
        for (let frame = 0; frame < 60 * 120; frame++) {
          v.update(dt, input); peak = Math.max(peak, v.speed * 3.6);
          if (v.activeTouchSpeedLimit > 0) activeFrames++;
          if (!mailMode) assert.equal(v.activeTouchSpeedLimit, 0, 'explore cap never acts');
        }
        if (mailMode) {
          assert.ok(peak <= 92 && peak >= 86, `${id}: mail holds near 90, peak ${peak}`);
          assert.ok(activeFrames > 60, 'mail limiter actually holds');
          assert.equal(v.activeTouchSpeedLimit, 90 / 3.6);
        } else assert.ok(peak > 110, `${id}: explore held GO goes well past the 90 km/h mail cap, peak ${peak}`);
        peaks.push(+peak.toFixed(2));
      } finally { Math.random = oldRandom; }
    }
    if (report) console.log(`${id}${trailer ? '+' + trailer + ' trailer' : ''} paved peak km/h: explore=${peaks[0]} mail=${peaks[1]}`);
  }
  for (const [kind, washboard, roadDist, kmh] of [
    [1,false,0,100], [2,false,0,90], [3,false,0,75], [5,false,0,55],
    [0,false,99,50], [1,false,99,50], [3,true,0,50],
    ...[4,6,7,11,12].map(kind => [kind,false,0,50]),
  ]) {
    Object.assign(surface, {kind,washboard,roadDist});
    const p = fresh(); speed(p, kmh / 3.6); p.update(dt,input);
    assert.equal(p.activeTouchSpeedLimit, kmh / 3.6, `kind ${kind}, washboard ${washboard}, distance ${roadDist}: actual cap`);
  }
  // A road bridge deck (concrete kind 9) limits as the road it carries; a wharf's concrete deck has no cap.
  for (const [deckRoadKind, kmh] of [[1,100],[3,75],[undefined,0]]) {
    Object.assign(surface, {kind:9,washboard:false,roadDist:0,deck:true,roadDeck:deckRoadKind!==undefined,deckRoadKind});
    const p = fresh(); speed(p, (kmh || 90) / 3.6); p.update(dt,input);
    assert.equal(p.activeTouchSpeedLimit, kmh / 3.6, `bridge deck carrying kind ${deckRoadKind}: actual cap`);
  }
  for (const key of ['deck','roadDeck','deckRoadKind']) delete surface[key];
  Object.assign(surface, {kind:2,washboard:false,roadDist:0});
  // The read-only number follows the actual limiter, including release without any physics step.
  const v = fresh(); speed(v, 90 / 3.6); v.update(dt, input);
  assert.equal(v.activeTouchSpeedLimit, 90 / 3.6);
  assert.equal(Reflect.set(v, 'activeTouchSpeedLimit', 123), false, 'public limit is read-only');
  let releaseSteps = 0;
  v.update(0, { ...input, throttle: 0 }, () => { releaseSteps++; });
  assert.equal(releaseSteps, 0, 'zero-dt release runs no physics step');
  assert.equal(v.activeTouchSpeedLimit, 0, 'release clears before next step');
  speed(v, 90 / 3.6); v.update(dt, input);
  let heldSteps = 0; v.update(1 / 144, input, () => { heldSteps++; });
  assert.equal(heldSteps, 0, 'short held frame runs no physics step');
  assert.equal(v.activeTouchSpeedLimit, 90 / 3.6, 'no-step render retains held cap');
  for (const test of [
    { name: 'below band', speed: 10 }, { name: 'reverse', speed: -10 },
    { name: 'keyboard', input: { touch: false } }, { name: 'pedal released', input: { throttle: 0 } },
    { name: 'braking', input: { throttle: -1 } }, { name: 'Light', strong: false },
    { name: 'cap disabled', cap: false }, { name: 'airborne', airborne: true },
    { name: 'yard', kind: 8 }, { name: 'concrete', kind: 9 }, { name: 'sand', kind: 10 },
  ]) {
    const p = fresh(); speed(p, test.speed ?? 90 / 3.6);
    p.strongHelp = test.strong ?? true; p.touchSpeedLimit = test.cap ?? true;
    if (test.airborne) { p.y += 20; p.airborne = true; }
    surface.kind = test.kind ?? 2; p.update(dt, { ...input, ...test.input }); surface.kind = 2;
    assert.equal(p.activeTouchSpeedLimit, 0, test.name + ': no active cap');
  }
  // Surface switches clear the marker and retain the original soft braking bound.
  speed(v, 100 / 3.6); v.update(dt, input); assert.equal(v.activeTouchSpeedLimit, 90 / 3.6);
  speed(v, 10); v.update(dt, input); assert.equal(v.activeTouchSpeedLimit, 0, 'falling below the band clears');
  speed(v, 90 / 3.6); v.update(dt, input); v.place(0, 0, 0); assert.equal(v.activeTouchSpeedLimit, 0, 'reset clears');
  const held = fresh(), lifted = fresh(); speed(held, 40); speed(lifted, 40);
  held.update(dt, input); lifted.update(dt, { ...input, throttle: 0 });
  assert.ok((lifted.speed - held.speed) / dt <= 1.25, 'limiter adds at most 1.2 m/s2 beyond a lift');
  surface.kind = 3; surface.washboard = true;
  // Washboard skips and wanders through Math.random: seed it, or the mean drifts by several km/h between runs.
  const unseeded = Math.random; let washSeed = 0x57a5b0a2;
  Math.random = () => ((washSeed = (Math.imul(washSeed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  try {
    const wash = fresh(); let total = 0;
    for (let i = 0; i < 60 * 60; i++) { wash.update(dt, input); if (i >= 60 * 30) total += wash.speed * 3.6 / (60 * 30); }
    assert.ok(total >= 40 && total <= 51, `washboard retains roughness under its 50 cap, mean ${total}`);
  } finally { surface.kind = 2; surface.washboard = false; Math.random = unseeded; }
}
try {
  verify(await load(), true);
  console.log('PASS production mode adapter, all garage entries, truck loads, active cap lifecycle and soft brake');
  if (process.argv.includes('--mutations')) for (const mutation of mutations) {
    const m = await load(mutation);
    assert.throws(() => verify(m), { name: 'AssertionError', ...(mutation[0] === 'early clear removed' ? { message: /release clears before next step/ } : {}) }, mutation[0] + ' must fail an assertion');
    console.log('KILLED ' + mutation[0]);
  }
} finally { rmSync(scratch, { recursive: true, force: true }); }
