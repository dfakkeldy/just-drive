// Production rules, geometry and score. The stop-rule mutant must fail the same assertions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from '../web/node_modules/esbuild/lib/main.js';
const path = 'web/src/school-bus-rules.ts';
async function load(source) {
  const { outputFiles } = await build({ stdin: { contents: source, resolveDir: `${process.cwd()}/web/src`, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}
function verify({ BusRules, BusPass, BUS }) {
  const b = new BusRules(391);
  assert.equal(b.active(9 * 3600), false);
  assert.equal(b.active(10 * 3600), true);
  assert.equal(b.active(12 * 3600), false);
  b.step(1, 10 * 3600, false); assert.equal(b.along, 0, 'blocked bus waits');
  for (let i = 0; i < 120 * (BUS.stop / BUS.speed) + 2; i++) b.step(1 / 120, 10 * 3600, true);
  assert.ok(b.flashing, 'bus stops after its approach');
  const stop = b.along;
  b.step(19.9, 10 * 3600, true); assert.equal(b.along, stop); assert.equal(b.flashing, true, '20 real seconds, not game-clock seconds');
  b.step(.11, 10 * 3600, true); assert.equal(b.flashing, false);
  for (let i = 0; i < 120 * 100; i++) b.step(1 / 120, 10 * 3600, true);
  assert.ok(b.stops >= 2, 'closed road repeats the stop');
  const p = new BusPass(), bus = { x: 0, z: 0, heading: 0 };
  const sample = (along, across = 3, flash = true, placement = 0) => p.sample({ x: across, z: -along }, bus, flash, placement);
  assert.equal(sample(-12), false);
  assert.equal(sample(-8), false, 'waiting behind');
  assert.equal(sample(0), false, 'beside is not yet a complete pass');
  assert.equal(sample(12), true, 'passing flashing bus costs score');
  assert.equal(sample(-12), false, 'one penalty per stop');
  p.reset(); sample(-12); sample(0, 9); assert.equal(sample(12), true, 'wide pass retains its approach');
  p.reset(); sample(-12); sample(0, 9); assert.equal(sample(12, 9), true, 'wide pass cannot escape by staying on the shoulder');
  p.reset(); sample(12); assert.equal(sample(-12), true, 'oncoming pass');
  p.reset(); sample(-12, 3, false); assert.equal(sample(12, 3, false), false, 'lights off');
  p.reset(); sample(-12, 20); assert.equal(sample(12, 20), false, 'distant parallel route');
  p.reset(); sample(-12); assert.equal(sample(12, 3, true, 1), false, 'road reset is not a pass');
  p.reset(); sample(-14); assert.equal(sample(14), false, '25 m jump guard');
  p.reset(); for (const [along, across] of [[-12,3],[-24,3],[-34,3],[-24,20],[-12,20],[12,20],[12,3]]) assert.equal(sample(along, across), false, 'leaving the stop clears the approach');
  p.reset(); sample(-50); assert.equal(sample(50), false, 'teleport is not driving');
  p.reset(); sample(-12); sample(-10, 3, false); assert.equal(sample(12), false, 'new lights need a fresh approach');
  assert.equal(BUS.penalty, 100);
}
function verifyPauseWiring(main) {
  const body = main.match(/const resolveYardSolids = \(\) => \{([\s\S]*?)\n\};/)[1];
  for (const [paused, aiOn] of [[false, false], [true, false], [false, true]]) {
    let received, aiResolved = 0;
    const context = { aiDriver: { resolve() { aiResolved++; } }, aiDriverOn: () => aiOn, boss: null, multiplayer: null, endings: { busy: false }, yard: null, history: null, home: null, porch: null, lotProps: null,
      ambientTraffic: null, roadAnimals: null, canal: null, canalBeforeX: 0, canalBeforeZ: 0, church: null, village: null, hawkesbury: null, mabouMain: null, quarry: null, tall: null, fleet: null, stuntPark: null, cemeteries: null, fishing: null, yardJob: null, roadScene: null, towing: null,
      vehicle: { damageActive: true }, horse: false, roadsidePlaying: false, jumpPlacement: 0,
      syncRoadScenePause() {}, scenePaused: () => paused,
      schoolBus: { setPaused: value => { received = value; }, step() {} } };
    new Function('context', `with(context) { ${body} }`)(context);
    assert.equal(received, paused, 'fixed-step adapter forwards the real pause predicate');
    assert.equal(aiResolved, aiOn ? 1 : 0, 'the AI driver resolves the player only while its live rule holds');
  }
}
const main = readFileSync('web/src/main.ts', 'utf8');
verifyPauseWiring(main);
if (process.argv.includes('--mutations')) {
  const site = 'schoolBus?.setPaused(scenePaused())'; assert.ok(main.includes(site));
  assert.throws(() => verifyPauseWiring(main.replace(site, 'schoolBus?.setPaused(false)')), /real pause predicate/);
  console.log('KILLED bus-pause-wiring');
}
const source = readFileSync(path, 'utf8');
verify(await load(source)); console.log('PASS school bus: clock, loop, blocked motion, 20 s dwell and stop rule');
if (process.argv.includes('--mutations')) {
  for (const [name, from, to] of [
    ['wide-pass-forgotten', 'if (!this.side) {', 'if (Math.abs(across) > 8) this.side = 0; if (!this.side) {'],
    ['jump-is-pass', '> 25;', '> Infinity;'],
    ['far-approach-kept', 'Math.hypot(dx, dz) > 30', 'false'],
    ['ignore-flashing', 'if (!flashing)', 'if (false)'],
    ['no-stop-rule', 'return true; // completed pass', 'return false; // completed pass'],
    ['game-clock-dwell', 'this.wait - dt', 'this.wait - dt * 20'],
    ['reset-is-pass', 'placement !== this.placement', 'false'],
  ]) {
    assert.ok(source.includes(from), name + ' site');
    let killed = false; try { verify(await load(source.replace(from, to))); } catch { killed = true; }
    assert.equal(killed, true, name + ' must fail'); console.log('KILLED', name);
  }
}
if (process.argv.includes('--mutations')) {
  const { outputFiles } = await build({ entryPoints: ['tools/school-bus-world-check.mjs'], bundle: true,
    platform: 'node', format: 'esm', write: false, logLevel: 'silent', plugins: [{
      name: 'bus-snapshot-mutant', setup(b) {
        b.onLoad({ filter: /[/\\]towing\.ts$/ }, ({ path }) => {
          const source = readFileSync(path, 'utf8');
          const site = 'if (this.world.bus) saved.world.push(this.world.bus.captureTowMotion(saved.bodies));';
          assert.ok(source.includes(site));
          return { contents: source.replace(site, ''), loader: 'ts' };
        });
      }
    }] });
  await assert.rejects(import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`), /real tow.step restores the bus/);
  console.log('KILLED bus-snapshot-omitted: real towing step rejects missing actor rollback');
}
