// Real SchoolBus and Towing on flat analytic ground; no browser or data writes.
import assert from 'node:assert/strict';
import { SchoolBus } from '../web/src/school-bus.ts';
import { schoolBusArt } from '../web/src/school-bus-art.ts';
import { BUS } from '../web/src/school-bus-rules.ts';
import { fixture } from './trailer-regressions.mjs';
const f = fixture();
f.roads.roads.push({ name: BUS.road, pts: [[-100,0],[-100,-100],[0,-100],[0,0],[-100,0]] });
let complaints = 0;
const shift = { elapsed: 0, ended: false, roadside: [], complaints: { add() { complaints++; } } };
const bus = new SchoolBus(f.roads, f.terrain, shift);
const tow = f.make({ bus });
assert.equal(tow.attached, true);
assert.equal(bus.coupledBody, tow.probe, 'attach registers the actual trailer');
assert.equal(tow.pairClear(), true);
const trailer = tow.bodies()[1];
Object.assign(bus.solid, { x: trailer.x, z: trailer.z, heading: trailer.heading });
assert.equal(tow.pairClear(), false, 'the trailer alone can block the pair');
bus.reset();
const { along, wait, stops } = bus.rules;
const undo = bus.captureTowMotion([trailer]);
bus.step(.1, f.v, true, 0);
Object.assign(trailer, { x: bus.solid.x, z: bus.solid.z, heading: bus.solid.heading });
undo();
assert.deepEqual([bus.rules.along, bus.rules.wait, bus.rules.stops], [along, wait, stops], 'coupled rollback restores stop bookkeeping');
Object.assign(tow.probe, bus.solid);
bus.step(.1, f.v, true, 0);
assert.equal(bus.rules.along, 0, 'bus waits for the actual coupled body');
tow.detach(); assert.equal(bus.coupledBody, null, 'detach releases the trailer');
bus.step(.1, f.v, true, 0); assert.ok(bus.rules.along > 0, 'bus resumes after trailer leaves');
bus.reset(); bus.step(BUS.stop / BUS.speed, f.v, true, 0);
assert.equal(bus.rules.flashing, true);
const pose = { x: 0, z: 0, heading: 0 };
for (const distance of [-12, 0, 12]) {
  bus.road.at(BUS.stop + distance, -1.8, pose); Object.assign(f.v, pose);
  bus.step(1 / 120, f.v, true, 1);
}
assert.equal(bus.score, -100); assert.equal(complaints, 0, 'score cost adds no warning or suspension');
assert.match(bus.reportLine(), /1 unsafe pass,/);
assert.match(bus.hint, /-100 points/);
shift.elapsed = 7200; assert.equal(bus.hint, '', 'noon clears the penalty hint without resetting the score');
assert.equal(bus.score, -100); assert.equal(bus.placementSolids.length, 0);
bus.reset(); assert.equal(Object.is(bus.score, 0), true);

// A proposed actor move meets the last valid rig during the real towing step.
const g = fixture();
g.roads.roads.push({ name: BUS.road, pts: [[-100,0],[-100,-100],[0,-100],[0,0],[-100,0]] });
const otherBus = new SchoolBus(g.roads, g.terrain, { elapsed: 0, ended: false, roadside: [] });
const otherTow = g.make({ bus: otherBus });
const oldTruck = [g.v.x, g.v.z];
otherBus.rules.along = 10;
const occupied = otherTow.bodies()[1];
Object.assign(otherBus.solid, { x: occupied.x, z: occupied.z, heading: occupied.heading });
otherTow.step();
assert.equal(otherBus.rules.along, 0, 'real tow.step restores the bus through its saved snapshot');
assert.equal(otherTow.pairClear(), true);
assert.ok(Math.hypot(g.v.x-oldTruck[0],g.v.z-oldTruck[1]) < 1e-6, 'moving bus cannot displace a valid stationary rig');

const geometry = schoolBusArt().arm.children[0].geometry;
const p = geometry.attributes.position, colour = geometry.attributes.color;
const front = [], back = [];
for (let i = 0; i < p.count; i++) if (Math.abs(colour.getX(i) - .94) < 1e-5 && Math.abs(p.getZ(i)) > .035) {
  (p.getZ(i) > 0 ? back : front).push(p.getZ(i) > 0 ? p.getX(i) : -1.52 - p.getX(i));
}
front.sort((a,b)=>a-b); back.sort((a,b)=>a-b);
assert.ok(front.length > 0); assert.equal(front.length, back.length);
assert.ok(front.every((x,i)=>Math.abs(x-back[i]) < 1e-6), 'STOP letters face the reader on both sides');
console.log('PASS real bus/trailer contact, attachment, rollback, score-only cost, noon hint and two-sided STOP geometry');
