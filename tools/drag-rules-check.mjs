import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AIRPORT } from '../web/src/airport-source.ts';
import { AirportSite } from '../web/src/airport-site.ts';
import { airportDragPlace, DRAG_HALF_LANE, DRAG_LANE, DRAG_PAINT, DragStrip } from '../web/src/drag-strip.ts';
import * as rules from '../web/src/drag-rules.ts';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const cases = {
  tree({ DragRun }) {
    const run = new DragRun(-1);
    assert.equal(run.phase, 'staged');
    for (const [dt, stage] of [[0.79, 'staged'], [0.02, 'amber-1'], [0.49, 'amber-2'], [0.5, 'amber-3'], [0.49, 'amber-3'], [0.02, 'green']]) {
      run.step(dt, -1, true);
      assert.equal(run.phase, stage);
    }
  },
  jump({ DragRun }) {
    const run = new DragRun(-0.3);
    run.step(2.29, -0.3, true);
    run.step(0.02, 0.9, true); // crosses at 2.295, even though this step ends after green
    assert.equal(run.phase, 'red');
    assert.equal(run.active, false);
    run.step(30, 403, true);
    assert.equal(run.result, null);
  },
  runUp({ DragRun }) {
    const run = new DragRun(-1);
    run.step(2.4, -16, true);
    assert.equal(run.phase, 'aborted');
    run.step(0.2, 1, true);
    run.step(14, 403, true);
    assert.equal(run.result, null, 'a rolling start cannot produce a best');
  },
  creep({ DragRun }) {
    const run = new DragRun(-2);
    run.step(1.7, -1.8, true);
    assert.equal(run.phase, 'amber-2', 'allow a small settling movement');
    run.step(0.1, -1.6, true);
    assert.equal(run.phase, 'red', 'a run-up before green fouls even behind the beam');
  },
  shallowStage({ DragRun }) {
    const run = new DragRun(-3);
    run.step(2.4, -3, true);
    run.step(0.4, -2.6, true);
    assert.equal(run.phase, 'running', 'clock has started before the painted stripe');
    close(run.launch, 2.75);
    run.step(0.4, 1, true);
    run.step(13, 400, true);
    run.step(0.2, 404, true);
    close(run.result.elapsed, 13.55);
  },
  timing({ DragRun }) {
    const run = new DragRun(-1);
    run.step(2.4, -1, true);
    run.step(0.2, 1, true); // staging beam at 2.435
    assert.equal(run.phase, 'running');
    run.step(10, 380, true);
    run.step(0.2, 384, true); // enters trap at 12.6 + (1.8832 / 20)
    run.step(1, 404, true); // finish beam at 13.7
    assert.equal(run.phase, 'finished');
    close(run.result.reaction, 0.135);
    close(run.result.elapsed, 11.265);
    close(run.result.trapKmh, 72);
  },
  recross({ DragRun }) {
    const run = new DragRun(-1);
    run.step(2.4, -1, true);
    run.step(0.2, 1, true);
    run.step(15, 390, true);
    run.step(1, 375, true); // backs out, then drives the whole trap again
    run.step(2, 415, true);
    close(run.result.trapKmh, 72);
  },
  lane({ DragRun }) {
    const run = new DragRun(-1);
    run.step(3, -1, true);
    run.step(0.5, 2, true);
    run.step(16, 403, false);
    assert.equal(run.phase, 'aborted');
    assert.equal(run.result, null);
  },
  pace({ paceDistance }) {
    close(paceDistance(2.55), 0);
    close(paceDistance(2.55 + 16.4), 402);
    const stop = paceDistance(30);
    assert.ok(stop > 510 && stop < 540);
    const finishTime = 2.55 + 16.4;
    const trapKmh = (paceDistance(finishTime) - paceDistance(finishTime - 0.1)) * 36;
    assert.ok(trapKmh > 125 && trapKmh < 140, 'pace car has a plausible finish speed');
    close(paceDistance(60), stop);
  },
  best({ recordDragBest }) {
    const saved = new Map();
    const storage = { getItem: k => saved.get(k), setItem: (k, v) => saved.set(k, v) };
    assert.equal(recordDragBest(storage, 'car'), null);
    assert.equal(recordDragBest(storage, 'car', 12), 12);
    assert.equal(recordDragBest(storage, 'car', 14), 12);
    assert.equal(recordDragBest(storage, 'car', 11), 11);
    assert.equal(recordDragBest(storage, 'car'), 11);
    assert.equal(recordDragBest(storage, 'bike', 17), 17);
    assert.equal(recordDragBest(storage, 'car'), 11);
    const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
    assert.equal(recordDragBest(blocked, 'car', 14), 14);
    assert.equal(recordDragBest(storage, 'car', NaN), 11);
  },
};
for (const check of Object.values(cases)) check(rules);

const place = airportDragPlace();
const origin = [place.e, place.n];
const strip = new DragStrip(origin);
const site = new AirportSite(origin);
assert.equal(place.name, 'Port Hawkesbury Airport');
close(strip.along(strip.start.x, strip.start.z), -4);
close(strip.across(strip.start.x, strip.start.z), -DRAG_LANE);
assert.equal(DRAG_PAINT[1] - DRAG_PAINT[0], 402);
assert.ok(DRAG_PAINT[0] > 185 && DRAG_PAINT[1] + 200 < site.frame.length);
assert.ok(DRAG_LANE + DRAG_HALF_LANE < AIRPORT.runway.width / 2);
for (const [along, across, stays] of [[0, -5, true], [602, -5, true], [1200, -5, true], [1300, -5, false], [200, 25, false]]) {
  const p = strip.point(along, across);
  assert.equal(strip.onRunway(p.x, p.z), stays, 'runway footprint controls result lifetime');
}
for (let along = -15; along <= 602; along += 1) for (const across of [-9, -1, 1, 9]) {
  const p = strip.point(along, across);
  close(strip.along(p.x, p.z), along);
  close(strip.across(p.x, p.z), across);
  assert.equal(site.surface(p.x, p.z)?.kind, 13);
}
console.log('PASS drag rules: tree, beams, trap, lane, pace car, best times and runway fit');

if (process.argv.includes('--mutations')) {
  const source = readFileSync(`${process.env.MMM_ROOT ?? '.'}/web/src/drag-rules.ts`, 'utf8');
  for (const [name, before, after] of [
    ['tree', 'DRAG_STAGE + 2 * DRAG_AMBER', 'DRAG_STAGE + DRAG_AMBER'],
    ['jump', 'launch < DRAG_GREEN', 'this.time < DRAG_GREEN'],
    ['runUp', 'along < this.staged - 0.5', 'false'],
    ['creep', 'Math.min(0, this.staged + 0.35)', '0'],
    ['shallowStage', 'this.launch = launch;', 'this.launch = crossed(0);'],
    ['timing', 'reaction: this.launch - DRAG_GREEN', 'reaction: this.launch'],
    ['timing', 'elapsed: finish - this.launch', 'elapsed: finish - DRAG_GREEN'],
    ['timing', '3.6 * DRAG_TRAP / (finish - this.trap)', '3.6 * DRAG_DISTANCE / (finish - this.trap)'],
    ['recross', 'along < entry ? null : this.trap ?? crossed(entry)', 'this.trap ?? crossed(entry)'],
    ['lane', '!inLane || along < -20', 'along < -20'],
    ['pace', 'const PACE_RAMP = 7;', 'const PACE_RAMP = 35;'],
    ['best', 'elapsed < best', 'elapsed > best'],
  ]) {
    const { transformSync } = await import('../web/node_modules/esbuild/lib/main.js');
    assert.equal(source.split(before).length, 2, before);
    const { code } = transformSync(source.replace(before, after), { loader: 'ts', format: 'esm' });
    const mutant = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
    assert.throws(() => cases[name](mutant), { code: 'ERR_ASSERTION' }, `mutant survived: ${before}`);
    console.log(`PASS rejected ${name}: ${before}`);
  }
}
