import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { BikeRide } from '../web/src/bike-ride.ts';
import { createBike } from '../web/src/bike.ts';
import { createSxs, SXS_SPEC } from '../web/src/sxs.ts';
import { Towing } from '../web/src/towing.ts';
import { createTruck, TRUCK_SPEC } from '../web/src/truck.ts';
import { Vehicle } from '../web/src/vehicle.ts';
import { AreaContacts } from '../web/src/world-contacts.ts';
import { makeGround, preload } from './phone-ground.mjs';
import { QuarrySite, COURSE_PADS, lakeAt, onApron, onCoursePad } from '../web/src/quarry-site.ts';
import { createQuarryStuntPark, quarryCoursePlaces } from '../web/src/quarry-stunt-park.ts';
import { STUNT_GUIDANCE } from '../web/src/stunt-guidance.ts';

const { terrain, roads } = makeGround('../data/baked/areas/westbay');
const origin = terrain.manifest.village;
const world = (e, n) => [e - origin[0], origin[1] - n];
const park = createQuarryStuntPark(terrain, true);
await park.prepare();
terrain.sites.push(new QuarrySite(origin));
const [upper] = COURSE_PADS;
// The bench falls back into the surveyed land beyond the tunnel's north ramp.
for (const [e,n] of [[-67,92],[-59,85],[-55,94]]) {
  const [x,z] = world(upper.e+e,upper.n+n);
  const surveyed = await terrain.surveyHeightAt(x,z);
  assert.ok(surveyed !== null && Math.abs(park.height(x,z,surveyed)-surveyed) < 2.2,
    `grade blends into the surveyed bench at ${e},${n}`);
}
assert.deepEqual(park.pieces.map(p => p.placement.piece.id).sort(), [
  'drop-0.8', 'drop-1.6', 'drop-2.4', 'footbridge', 'gap-4', 'gap-tanks', 'rollers',
  'slip-large', 'slip-medium', 'slip-small', 'tabletop', 'tanks', 'tunnel', 'whoops',
]);
function onDryCourse(x, z, label) {
  const e = x + origin[0], n = origin[1] - z;
  assert.ok(onCoursePad(e,n) && !onApron(e,n) && !lakeAt(e,n), label);
  assert.equal(roads.nearest(x,z,8), null, label);
}
for (const p of [...park.pieces, ...park.dressing]) {
  const [a,b,c,d] = p.box;
  for (const x of [a,c]) for (const z of [b,d]) onDryCourse(x,z,p.placement.piece.id);
}
await preload(terrain, COURSE_PADS.map(p => world(p.e,p.n)), 180);
for (const tile of terrain.tiles.values()) if (tile.mesh) {
  const e = tile.x0 + origin[0], n = origin[1] - tile.z0;
  const overlapsPad = tile.level === 8 && COURSE_PADS.some(p =>
    e < p.e+p.halfE && e+tile.size > p.e-p.halfE && n > p.n-p.halfN && n-tile.size < p.n+p.halfN);
  assert.equal('tSiteStyle' in tile.mesh.material.uniforms, overlapsPad,
    'lane texture only on the fine tiles touching a course pad');
  tile.mesh.visible = true;
  tile.mesh.material.uniforms.hideQuad.value.set(0,0,0,0);
}
const truck = new Vehicle(createTruck(false,true), terrain, roads, -.2, TRUCK_SPEC);
const sxs = new Vehicle(createSxs(false,{low:true}), terrain, roads, -.2, SXS_SPEC);
const bike = new BikeRide(createBike(false,true), terrain, roads, -.2);
const contacts = new AreaContacts();
contacts.add(park.contactProvider());
for (const ride of [truck, sxs, bike]) contacts.bindVehicle(ride);
const trailer = new Towing(truck, terrain, roads, true, false, {contacts}, false, true);
for (const pad of COURSE_PADS) {
  const [x,z] = world(pad.e,pad.n);
  park.update(0,truck,new THREE.Vector3(x,120,z));
}
for (const p of [...park.pieces, ...park.dressing]) {
  assert.ok(p.ready, p.placement.piece.id);
}
for (const {start} of quarryCoursePlaces()) {
  const [x,z] = world(start.e,start.n);
  const ground = terrain.meshHeightAt(x,z);
  assert.ok(ground !== null);
  // Full coupled rig at rest and the approach through the arch, with room on either side.
  for (let u = -16; u <= 22; u++) for (const v of [-3,0,3]) {
    const px = x + u*Math.sin(start.heading) + v*Math.cos(start.heading);
    const pz = z - u*Math.cos(start.heading) + v*Math.sin(start.heading);
    onDryCourse(px,pz,'run-up');
    assert.ok(park.clearCanopy(px,pz), 'run-up is cleared');
    const next = terrain.meshHeightAt(px + Math.sin(start.heading),pz - Math.cos(start.heading));
    const y = terrain.meshHeightAt(px,pz);
    assert.ok(y !== null && next !== null && Math.abs(next-y) < .15, `run-up grade at ${start.e},${start.n} + ${u},${v}: ${y} to ${next}`);
  }
  for (const ride of [truck, sxs, bike]) {
    ride.place(x,z,start.heading);
    assert.ok(Math.hypot(ride.x-x,ride.z-z) < .01,'run-up start accepted');
    if (ride === truck) {
      trailer.attach();
      assert.ok(trailer.attached,trailer.reason);
    }
    const impacts = park.contacts;
    const progress = () => (ride.x-x)*Math.sin(start.heading) - (ride.z-z)*Math.cos(start.heading);
    for (let tick=0; tick<1200 && progress()<17; tick++) {
      const throttle = Math.max(0, Math.min(.6, 4-ride.speed));
      terrain.withGroundContact(ride, () => ride.update(1/120,{throttle,steer:0},() => {
        contacts.resolve(ride);
        if (ride === truck) trailer.step();
      }));
      if (ride === truck) trailer.update();
    }
    assert.ok(progress()>=17 && !ride.airborne, 'drive through start arch');
    assert.equal(park.contacts, impacts, 'run-up stays clear of park solids');
    if (ride === truck) {
      assert.ok(trailer.attached && Math.abs(trailer.roll)<.26 && Math.abs(trailer.pitch)<.26, 'loaded trailer stays settled');
      trailer.detach();
    }
  }
}
console.log('PASS Sugar Camp piece footprints, production seats and both run-ups for the loaded rig, side by side and bike on baked land');

// Sugar Camp, 20 Nov 2026: the pickup must reach the sign speeds from rest.
// Distances are from each lane's cleared start to the piece origin, in piece coordinates.
const runupStarts = {
  'slip-small': -46, 'slip-medium': -40, 'slip-large': -40, 'gap-4': -41,
  'gap-tanks': -40, 'drop-0.8': -41, 'drop-1.6': -41, 'drop-2.4': -40,
};
for (const [id, startU] of Object.entries(runupStarts)) {
  const piece = park.pieces.find(p => p.placement.piece.id === id);
  const start = piece.world(startU, 0);
  const takeoff = piece.placement.piece.route.takeoff;
  const [min, max] = STUNT_GUIDANCE[id].truck;
  // The small kicker needs full throttle. On the other lines the driver sets the entry speed.
  const target = (min + max) / 2 / 3.6;
  assert.ok(park.clearCanopy(start.x, start.z), id+' start is cleared');
  const driveRunup = ride => {
    assert.ok(ride.place(start.x, start.z, piece.placement.heading));
    ride.assist = 0;
    const impacts = park.contacts;
    for (let tick = 0; tick < 12*120; tick++) {
      const throttle = id === 'slip-small' ? 1 : Math.max(-1, Math.min(1, (target-ride.speed)*2));
      terrain.withGroundContact(ride, () => ride.update(1/120, {throttle, steer:0}, () => park.step(1/120, ride)));
      if (park.contacts !== impacts) break;
      const along = piece.u(ride.x, ride.z);
      // The front axle can leave the lip before the ride's reference point reaches it.
      if (along >= takeoff || (ride.airborne && along >= takeoff-ride.spec.wheelbase/2)) return { kph:ride.speed*3.6, airborne:ride.airborne };
    }
    throw Error(id+' did not reach the lip cleanly');
  };
  const result = driveRunup(truck);
  console.log('PICKUP RUN-UP', id, JSON.stringify(result));
  assert.ok(result.kph >= min && result.kph <= max, `${id}: ${result.kph} km/h, posted ${min}–${max}`);
  assert.ok(result.airborne, id+' launches at its posted speed');
  if (id === 'slip-small') {
    const previous = new Vehicle(truck.car, terrain, roads, -.2, {
      ...TRUCK_SPEC, engineAcceleration:4.2, enginePower:122, tractionShare:.78, aeroDrag:.00115,
    });
    contacts.bindVehicle(previous);
    assert.ok(driveRunup(previous).kph < min, 'the previous pickup tune misses the launch band');
  }
}
