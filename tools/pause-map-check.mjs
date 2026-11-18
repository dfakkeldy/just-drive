// Turning the room Off inside Settings pauses the game. The real frame must still take the other drivers off the
// mini map at once, once, without running the simulation. node tools/pause-map-check.mjs
import assert from 'node:assert/strict';
import { current, spy } from './world-update-fixture.mjs';

// The fake map keeps the real throttle: update() draws only after an eighth of a second, unless redrawNext() came first.
function paused(source, cars) {
  const drawn = [];
  const result = spy(source, false, true, false, (c, trace) => {
    c.mapCars = cars.map(car => ({ ...car }));
    // The room is Off: the switch has dropped its connection, so it has no cars left to mark.
    c.multiplayer = { update: trace('multiplayer'), choice: { on: false }, marks: out => { out.length = 0; } };
    c.refreshMap = () => { trace('refreshMap')(); c.multiplayer.marks(c.mapCars); };
    c.miniMap = { since: 0, show: trace('miniMap.show'), redrawNext() { this.since = 1; },
      update(dt, x, z, heading, stops, marks, list) {
        this.since += dt; if (this.since < .12) return; this.since = 0;
        trace('miniMap.draw')(); drawn.push({ x, z, heading, cars: list.length });
      } };
    c.pause = { blocked: true, time: 500, frame: () => ({ paused: true, dt: 0 }) };
  }, frame => { frame(1050); frame(1066); frame(1083); });
  return { ...result, drawn };
}

function verify(source) {
  const off = paused(source, [{ x: 40, z: -12 }, { x: -8, z: 30 }]);
  assert.deepEqual(off.drawn, [{ x: 3, z: 5, heading: .7, cars: 0 }], 'room Off while paused redraws the mini map once, without other cars, at the frozen pose');
  assert.equal(off.context.mapCars.length, 0, 'the map list is empty after Off');
  assert.equal(off.calls.filter(n => n === 'render').length, 3, 'every paused frame still draws the world (the ghosts are gone from it)');
  for (const name of ['driveVehicle', 'mail', 'shift', 'miniMap.show']) assert.ok(!off.calls.includes(name), `the simulation stays paused: no ${name}`);
  const quiet = paused(source, []);
  assert.deepEqual(quiet.drawn, [], 'a paused frame with no other cars does not redraw the map');
  assert.ok(!quiet.calls.includes('refreshMap'), 'nor rebuild its marks');
}

const source = current();
verify(source);
// Mutants: each must make the check fail.
const block = source.slice(source.indexOf('    if (miniMap && mapCars.length) {'), source.indexOf('    if (interiors.busy) interiors.render(renderer);'));
assert.ok(block.includes('redrawNext'), 'the paused map redraw is where this check expects it');
const mutants = {
  'no paused map redraw': source.replace(block, ''),
  'no forced redraw (throttled)': source.replace('refreshMap(); miniMap.redrawNext();', 'refreshMap();'),
  'no marks refresh': source.replace('refreshMap(); miniMap.redrawNext();', 'miniMap.redrawNext();'),
};
for (const [name, code] of Object.entries(mutants)) {
  assert.notEqual(code, source, `mutant applies: ${name}`);
  assert.throws(() => verify(code), assert.AssertionError, `mutant must fail: ${name}`);
  console.log(`ok   mutant caught: ${name}`);
}
console.log('PASS paused room Off: mini map drops the other cars once, world still drawn, simulation still paused');
