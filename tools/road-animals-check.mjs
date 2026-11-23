// Road animals: daily routes on real road kinds, field/rail/site/keep-away rules, the hint before any complaint,
// near misses (never contact), the horn, pause, multiplayer, 1884, photo evidence and no allocation per physics step.
import assert from 'node:assert/strict';
import { PerformanceObserver } from 'node:perf_hooks';
import { ANIMAL, ANIMAL_RATE, ANIMAL_TEXT, animalRoutes, animalSpecies, routePoint, routeOutside, routeApart, routeSafety, moveAnimal,
  escapeDirection, farRoute, crossRoute, yieldRange, leave,
  animalReaction, animalHinting, startleRange } from '../web/src/road-animal-rules.ts';
import { Roads } from '../web/src/roads.ts';
import { RoadAnimals } from '../web/src/road-animals.ts';
import { ANIMAL_LOOK } from '../web/src/road-animal-look.ts';
import { Guardrails } from '../web/src/guardrails.ts';
import { Complaints } from '../web/src/complaints.ts';
import { Evidence } from '../web/src/evidence.ts';
import { Shift } from '../web/src/shift.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import { TRUCK_SPEC } from '../web/src/truck.ts';
import { TRAILER_SPEC } from '../web/src/trailer.ts';
import { Vector3, Matrix4 } from '../web/node_modules/three/build/three.module.js';
const at = (r, p) => routePoint(r, p, { x: 0, z: 0 });
const road = { id: 1, name: 'Fixture Road', kind: 3, bridge: false, halfWidth: 3, pts: [[-1000, 0], [1000, 0]] };
const routes = animalRoutes([road], 123, []);
assert.equal(routes.length, 4, 'four spaced routes');
assert.deepEqual(routes, animalRoutes([road], 123, []), 'daily routes repeat');
assert.notDeepEqual(routes, animalRoutes([road], 124, []), 'another day changes routes');
assert.equal(animalRoutes([{ ...road, kind: 1 }], 123, []).length, 0, 'no animals on highways (the traffic roads)');
assert.equal(animalRoutes([{ ...road, kind: 2 }], 123, []).length, 4, 'paved roads have animals');
assert.equal(animalRoutes([{ ...road, kind: 5 }], 123, []).length, 0, 'rail trail is not a motor road');
assert.equal(animalRoutes([{ ...road, railway: true }], 123, []).length, 0, 'railway excluded');
assert.equal(animalRoutes([{ ...road, bridge: true }], 123, []).length, 0, 'bridge excluded');
assert.equal(animalRoutes([road], 123, [[-2000, -100, 2000, 100]]).length, 0, 'hand-built site excluded');
assert.equal(animalRoutes([road], 123, [], [{ x: 0, z: 0 }]).every(r => Math.abs(r.home.x) >= ANIMAL.keepAway && Math.abs(r.stop.x) >= ANIMAL.keepAway), true, 'keep-away points are respected');
assert.ok(animalRoutes([road], 123, [], [], x => x > 0).every(r => r.home.x > 0 && r.stop.x > 0 && r.far.x > 0), 'only where the finest land is');
assert.equal(animalRoutes([road], 123, [], [], () => false).length, 0, 'no finest land, no animals');
{
  // A box on the far half alone (a pole across the road) keeps the route from taking a daily slot.
  const r = routes[0], f = at(r, 1.6), box = [f.x - .5, f.z - .5, f.x + .5, f.z + .5];
  assert.equal(routeOutside(r, [box]), true, 'the box is on the far half only');
  assert.ok(!animalRoutes([road], 123, [box]).some(q => q.road === r.road && q.along === r.along), 'the far half is checked when routes are chosen');
  // Land that will never do (no finest tile, marsh at sea level) blocks at once; land still loading waits.
  assert.equal(routeSafety(r, () => NaN, () => 'clear'), 'blocked');
  assert.equal(routeSafety(r, (x, z) => x === r.home.x && z === r.home.z ? NaN : 10, () => 'clear'), 'blocked', 'one never-good body sample blocks');
  assert.equal(routeSafety(r, (x, z) => x === r.home.x + ANIMAL.radius && z === r.home.z ? NaN : 10, () => 'clear'), 'blocked', 'a never-good edge sample blocks too');
}
assert.equal(routeApart(routes[0], [{ x: routes[0].stop.x + 100, z: 0 }]), false, 'a fixed animal site 100 m away keeps its road');
assert.equal(routeApart(routes[0], [{ x: routes[0].stop.x + ANIMAL.keepAway + 10, z: 0 }]), true, 'a far site does not');
// Species: deer most, foxes often, a rare moose on gravel only, at most one moose a day.
const tally = { deer: 0, fox: 0, moose: 0 }, long = { ...road, pts: [[-20000, 0], [20000, 0]] };
for (let day = 1; day <= 400; day++) {
  const today = animalRoutes([long], day, []);
  assert.ok(today.filter(r => r.species === 'moose').length <= 1, 'at most one moose a day');
  for (const r of today) tally[r.species]++;
  assert.ok(animalRoutes([{ ...long, kind: 2 }], day, []).every(r => r.species !== 'moose'), 'no moose on paved roads');
}
assert.ok(tally.deer > tally.fox && tally.fox > tally.moose && tally.moose > 0 && tally.moose < tally.deer / 4, 'plausible mix ' + JSON.stringify(tally));
assert.equal(animalSpecies(0, 3), 'moose'); assert.equal(animalSpecies(0, 2), 'fox'); assert.equal(animalSpecies(8 * 10, 3), 'deer');
for (const r of routes) {
  const home = at(r, 0), stop = at(r, 1);
  assert.ok(Math.abs(home.z) > road.halfWidth + 2, 'home is on the field side');
  assert.ok(Math.abs(stop.z) < road.halfWidth - 1, 'pause is on the real road');
  assert.equal(routeSafety(r, () => 10, () => 'clear'), 'clear', 'flat open ground accepted');
  assert.equal(routeSafety(r, () => 10, () => 'blocked'), 'blocked', 'rail crossing rejected');
  assert.equal(routeSafety(r, () => null, () => 'clear'), 'pending', 'missing ground waits');
  assert.equal(routeSafety(r, (x, z) => z * 2 + 100, () => 'clear'), 'blocked', 'steep field rejected');
}
assert.equal(routeOutside(routes[0], [[routes[0].stop.x - 1, routes[0].stop.z - 1, routes[0].stop.x + 1, routes[0].stop.z + 1]]), false, 'a box on the road pause excludes the route');
for (const r of routes) {
  const far = at(r, 2);
  assert.ok(Math.abs(far.z) > road.halfWidth + 2 && Math.sign(far.z) === -Math.sign(at(r, 0).z), 'the far field is across the road');
  assert.ok(Math.abs(Math.abs(at(r, r.onto).z) - road.halfWidth) < 1e-9 && Math.abs(Math.abs(at(r, r.off).z) - road.halfWidth) < 1e-9, 'the asphalt band ends at the road edges');
  assert.ok(Math.abs(at(r, (1 + r.off) / 2).z) < road.halfWidth, 'half way to the far edge is on the road');
  assert.ok(Math.abs(at(r, 0).z) - road.halfWidth === ANIMAL.field || Math.abs(Math.abs(at(r, 0).z) - road.halfWidth - ANIMAL.field) < 1e-9, 'its field is ANIMAL.field metres past the edge');
  assert.deepEqual(at(farRoute(r), 0), far, 'farRoute starts in the far field'); assert.deepEqual(at(farRoute(r), 1), at(r, 1), 'and meets the same lane stop');
}
const motion = { progress: 0, state: 'waiting', timer: 0, cooldown: 0, dir: -1 };
for (let i = 0; i < 500; i++) moveAnimal(motion, .05, 10, 10);
assert.equal(motion.state, 'waiting', 'it does not step out while a car is close to its lane stop');
for (let i = 0; i < 500; i++) moveAnimal(motion, .05, 10, ANIMAL.step + 1);
assert.equal(motion.state, 'stopped', 'approach walks then stops on road');
leave(motion, 'bolting', -1); for (let i = 0; i < 4; i++) moveAnimal(motion, .05, 10, 99);
assert.ok(motion.progress < routes[0].onto, 'a startled animal is off the asphalt within 0.2 s');
for (let i = 0; i < 12; i++) moveAnimal(motion, .05, 10, 99);
assert.equal(motion.progress, 0, 'and back in its field within 0.8 s');
motion.state = 'stopped'; motion.progress = 1; leave(motion, 'leaving', 1); let crossed = false;
for (let i = 0; i < 100 && !crossed; i++) crossed = moveAnimal(motion, .05, 10, 99);
assert.ok(crossed && motion.state === 'waiting' && motion.progress === 0, 'a crossing ends in the far field, reported once');
const swapped = { ...routes[0] }; crossRoute(swapped);
assert.deepEqual(swapped.home, routes[0].far); assert.deepEqual(swapped.far, routes[0].home); assert.equal(swapped.side, -routes[0].side);
assert.ok(Math.abs(Math.atan2(Math.sin(swapped.heading - routes[0].heading - Math.PI), Math.cos(swapped.heading - routes[0].heading - Math.PI))) < 1e-9, 'it now faces the road from the other side');
// Away from the car: across the road when the car is on its home side, home otherwise.
const r0 = routes[0], homeSide = at(r0, 0), farSide = at(r0, 2);
assert.equal(escapeDirection(r0, homeSide.x, homeSide.z, at(r0, 1)), 1); assert.equal(escapeDirection(r0, farSide.x, farSide.z, at(r0, 1)), -1);
const across = at(r0, 1.8), between = at(r0, 1.9);
assert.equal(escapeDirection(r0, between.x, between.z, across), -1, 'from where it is now: a car beyond it on the far side sends it back');
assert.equal(yieldRange(8), 8 / ANIMAL_RATE.leave + ANIMAL.margin, 'a closing car is met early enough to be off the road in time');
assert.equal(yieldRange(-5), ANIMAL.yield);
// Reactions: a fast closing car startles; a receding or slow one does not; a slow one close by sends it home.
assert.equal(animalReaction(12, 20, 20), 'startle');
assert.equal(animalReaction(12, 20, -20), 'startle', 'reversing fast towards it also startles');
assert.equal(animalReaction(12, -20, 20), 'none', 'driving away fast does not startle');
assert.equal(animalReaction(8, 5, 5), 'yield', 'slow and close: it walks off');
assert.equal(animalReaction(12, 0, 0), 'none', 'a car parked 12 m off does not move it');
assert.equal(animalReaction(14, 8, 8), 'yield', 'a car closing at 8 m/s moves it from further out');
assert.equal(animalReaction(30, 5, 5), 'none');
assert.equal(animalReaction(30, 20, 20), 'none', 'a fast car holds it frozen in the lane until the startle range');
assert.equal(animalReaction(22, 35, 35), 'startle', 'reaction distance grows with speed');
assert.equal(startleRange(35), 35 * ANIMAL.reaction);
assert.equal(animalHinting(150, 10, 10), true, 'hint from 160 m while closing');
assert.equal(animalHinting(150, -10, 10), false, 'no hint once past');
assert.equal(animalHinting(5, -10, 10), true, 'always while inside the startle range');
assert.equal(animalHinting(50, 0, 0), false, 'a parked car gets no hint');
assert.equal(animalHinting(5, 0, 0), false, 'a car parked beside it gets no hint either');
console.log('PASS road animal routes, species mix, keep-away, terrain, motion, reactions and hint rules ' + JSON.stringify(tally));

// The real Shift.showsHint decides what the HUD shows: a damage hint and earlier scenes come first.
const showsHint = Shift.prototype.showsHint;
const fishScene = { hint: '' };
const shift = { career: { day: 123 }, complaints: new Complaints(), elapsed: 100, ended: false, evidence: new Evidence(),
  roadside: [fishScene], damage: { hintTime: 0 }, showsHint(scene) { return showsHint.call(this, scene); } };
const camera = new Vector3(0, 100, 0);
const terrain = { cartRoads: false, sites: [], clear: [], low: false, dataRevision: 1, exag: 1, seaLevel: 0,
  surfaceAt: () => ({ ground: 100, level: 8, canopy: 0 }), heightAt: () => 100 };
const network = new Roads({ roads: [road] }, [0, 0], terrain), rails = network.guardrails;
function drain(g) { for (let i = 0; i < 2000; i++) { g.update(camera); if (!g.audit.pending) return; } assert.fail('rail planning drains'); }
assert.equal(rails.animalPassage(0, 0, 1), 'pending', 'unplanned rails block animals');
drain(rails);
assert.equal(rails.animalPassage(0, 0, 1), 'clear', 'finished flat road has no rail');
terrain.dataRevision++;
assert.equal(rails.animalPassage(0, 0, 1), 'pending', 'new terrain invalidates permission'); drain(rails);
const cliff = { ...terrain, surfaceAt: (x, z) => ({ ground: 100 - Math.max(0, z - 4) * .8, level: 8, canopy: 0 }), heightAt: (x, z) => 100 - Math.max(0, z - 4) * .8 };
const barrier = new Guardrails({ roads: [road], nearest: () => null }, cliff); drain(barrier);
assert.ok(barrier.chunks.some(c => c.spans.length), 'fixture actually has rails');
assert.equal(barrier.animalPassage(0, 4.2, 1.2), 'blocked', 'actual rail blocks the animal body');
assert.equal(barrier.animalPassage(0, 8, 1.2), 'clear', 'field side outside rail stays clear');
cliff.dataRevision++;
assert.equal(barrier.animalPassage(0, 4.2, 1.2), 'blocked', 'retained physical span blocks even while its replacement is pending');

const herd = new RoadAnimals(network, terrain, shift, []);
assert.equal(shift.roadside.at(-1), herd, 'a roadside scene of the shift, after the fish truck and painter');
assert.equal([...shift.evidence.subjects.keys()].filter(k => k.startsWith('road-animal:')).length, 4, 'one photo subject per slot');
// Every test body has the one plain shape of the game's Vehicle fields used here, so the step's property loads stay
// monomorphic as in the game (megamorphic loads of number fields box them, which the allocation probe would count).
const body = (x, z, heading, speed, vx, vz, spec) => ({ x, z, y: 100, heading, speed, vx, vz, spec });
const car = body(0, 0, Math.PI / 2, 0, 0, 0, CAR_SPEC);
/** Forward speed along the heading, no slide. */
const go = s => { car.speed = s; car.vx = s * Math.sin(car.heading); car.vz = -s * Math.cos(car.heading); };
herd.update(.05, car);
assert.equal(herd.residents.length, 4);
assert.equal(herd.group.children.length, 3, 'one instanced mesh per species');
for (const mesh of herd.group.children) { assert.ok(mesh.isInstancedMesh); assert.equal(mesh.castShadow, false); assert.equal(Array.isArray(mesh.material), false); }
const animal = herd.residents[0], slot = 0, stop = at(animal.route, 1), species = animal.route.species;
/** Put the first animal in the lane, standing, and the car `distance` metres west of it heading east at `speed`. */
function stage(distance, speed, lateral = stop.z) {
  herd.reset(); herd.update(0, car); shift.complaints = new Complaints();   // a fresh list: it drops repeated targets
  const a = herd.residents[0];
  for (const b of herd.residents) if (b !== a) { b.state = 'waiting'; b.progress = 0; b.cooldown = 1e9; }
  a.state = 'stopped'; a.progress = 1; a.timer = -1e9;
  car.x = stop.x - distance; car.z = lateral; car.heading = Math.PI / 2; go(speed);
  herd.update(.0001, car); assert.equal(a.visible, true, 'staged animal is drawn');
  return a;
}
/** Drive east at constant speed: 120 Hz physics steps, a frame every two steps, the HUD line read like refreshUI. */
function drive(seconds, speed, hud = { shown: [] }) {
  for (let i = 0; i < seconds * 120; i++) {
    car.x += speed / 120; herd.step(1 / 120, car, true);
    if (i % 2) herd.update(1 / 60, car);
    hud.shown.push(shift.showsHint(herd) ? herd.hint : '');
  }
  return hud;
}
// A fast pass after the hint: the hint shows first, then the animal bolts and the neighbours complain once.
let a = stage(200, 25);
const before = shift.complaints.all.length, hud = drive(9, 25);
const complaint = shift.complaints.all.slice(before);
assert.equal(complaint.length, 1, 'one near-miss complaint');
assert.equal(complaint[0].kind, 'sceneAnimal'); assert.equal(complaint[0].target, -60 - slot); assert.equal(complaint[0].road, road.id);
assert.match(complaint[0].customer, /^a neighbour on Fixture Road$/, 'an invented neighbour, never a name');
const firstHint = hud.shown.indexOf(ANIMAL_TEXT[species].approach), missed = hud.shown.indexOf(ANIMAL_TEXT[species].missed);
assert.ok(firstHint >= 0 && missed > firstHint, 'the slow-down hint shows before the complaint line');
assert.ok(missed - firstHint >= 120 * ANIMAL.read, 'the hint was on screen for at least a second first');
assert.equal(a.state === 'bolting' || a.state === 'waiting', true, 'the animal ran home');
assert.match(herd.reportLine(), /^Wildlife: 1 near miss\. Nobody was hurt\.$/);
drive(1, 25); assert.equal(shift.complaints.all.length, before + 1, 'one complaint per animal per day');
a.state = 'stopped'; a.progress = 1; a.timer = -1e9; car.x = stop.x - 200; drive(9, 25);
assert.match(herd.reportLine(), /: 1 near miss\./, 'the same animal back in the lane is still one near miss a day');
// The HUD line is somebody else's (a damage hint, or the fish scene first): no warning, so no complaint.
for (const blocker of ['damage', 'scene']) {
  a = stage(200, 25);
  if (blocker === 'damage') shift.damage.hintTime = 1e9; else fishScene.hint = 'A fish truck.';
  const n = shift.complaints.all.length; drive(9, 25);
  assert.equal(shift.complaints.all.length, n, `no complaint while the ${blocker} hint holds the HUD line`);
  assert.equal(a.state === 'bolting' || a.state === 'waiting', true, 'it still bolts clear');
  shift.damage.hintTime = 0; fishScene.hint = '';
}
// A car that arrives fast already inside the startle range had no warning: near miss, no complaint.
a = stage(12, 25); let n = shift.complaints.all.length; drive(1, 25);
assert.equal(shift.complaints.all.length, n, 'no complaint without a hint first');
assert.equal(a.state === 'bolting' || a.state === 'waiting', true);
// The warning must be unbroken up to the near miss: a second of hint, then a damage line until just before the startle
// range, then too little hint again. No complaint.
a = stage(200, 25); n = shift.complaints.all.length;
for (let i = 0; car.x < stop.x - startleRange(25) - 10; i++) {
  if (i === 3 * 120) shift.damage.hintTime = 1e9;
  car.x += 25 / 120; herd.step(1 / 120, car, true); if (i % 2) herd.update(1 / 60, car);
}
shift.damage.hintTime = 0; drive(2, 25);
assert.equal(shift.complaints.all.length, n, 'an old warning with a break before the pass does not count');
// A slow car: the animal walks off in time, no complaint.
a = stage(200, 6); n = shift.complaints.all.length; const slow = drive(40, 6);
assert.equal(shift.complaints.all.length, n, 'a slow pass is not a complaint');
assert.ok(slow.shown.includes(ANIMAL_TEXT[species].approach), 'a slow car closing still sees the hint');
// Never contact: at any speed and on any line, across the road, along the verges and through the fields beyond, the car
// body never reaches an animal that is drawn (waiting in a field, walking out, standing, walking off either way, bolting).
const clearance = (p) => {
  let gap = Infinity; const env = CAR_SPEC.envelope, fx = Math.sin(car.heading), fz = -Math.cos(car.heading);
  for (let c = 0; c < env.circles.length; c++) {
    const side = env.circleSides?.[c] ?? 0, cx = car.x + fx * env.circles[c] - fz * side, cz = car.z + fz * env.circles[c] + fx * side;
    gap = Math.min(gap, Math.hypot(p.x - cx, p.z - cz) - env.radius - ANIMAL.radius);
  }
  return gap;
};
let tightest = Infinity, crossings = 0;
const LINES = [-14, -12, -9, -6.5, -4.5, -3, -1.5, 0, 1.5, 3, 4.5, 6.5, 9, 12, 14];
for (const start of ['stopped', 'walking home', 'walking across', 'waiting']) for (const lateral of LINES) for (const speed of [1, 2, 4, 6, 8, 12, 25, 35]) {
  a = stage(start === 'stopped' ? 200 : 9 + speed * 2.5, speed, lateral); let gap = Infinity, across = false;
  if (start === 'waiting') { a.state = 'waiting'; a.progress = 0; a.cooldown = 1e9; }
  else if (start !== 'stopped') leave(a, 'leaving', start === 'walking home' ? -1 : 1);
  for (let i = 0; i < 230 / speed * 120; i++) {
    car.x += speed / 120; herd.step(1 / 120, car, true); if (i % 2) herd.update(1 / 60, car);
    if (a.dir > 0) across = true;
    if (a.visible) gap = Math.min(gap, clearance(at(a.route, a.progress)));
  }
  if (across) crossings++;
  tightest = Math.min(tightest, gap);
  assert.ok(gap > .25, `never contact: ${speed} m/s on line ${lateral} m, closest body gap ${gap.toFixed(2)} m`);
}
assert.ok(crossings > 0, 'cars on the home side send animals across the road');
{
  a = stage(200, 6); car.z = Math.sign(at(a.route, 0).z) * 3; const farField = { ...a.route.far }, homeField = { ...a.route.home };
  for (let i = 0; i < 40 * 120 && !(a.dir > 0 && a.state === 'waiting'); i++) { car.x += 6 / 120; herd.step(1 / 120, car, true); if (i % 2) herd.update(1 / 60, car); }
  assert.equal(a.state, 'waiting', 'the crossing finished');
  assert.deepEqual(a.route.home, farField, 'the far field is its home now'); assert.deepEqual(a.route.far, homeField);
  const drawn = shift.evidence.subjects.get('road-animal:0');
  assert.ok(Math.hypot(drawn.x - farField.x, drawn.z - farField.z) < .01, 'it stands in the far field, not back where it started');
}
{
  // Walking off across the road when a fast car comes along the far shoulder: it runs back, away from the car's line.
  a = stage(200, 25); a.state = 'leaving'; a.dir = 1; a.progress = 1.4;
  const farZ = at(a.route, 2).z; car.x = stop.x - 30; car.z = farZ;
  for (let i = 0; i < 120 && a.state === 'leaving'; i++) { car.x += 25 / 120; herd.step(1 / 120, car, true); }
  assert.equal(a.state, 'bolting'); assert.equal(a.dir, -1, 'a startled animal runs away from the car line');
  // Walking home towards the line of a slow car on its home verge: it turns round and crosses instead.
  a = stage(200, 4); a.state = 'leaving'; a.dir = -1; a.progress = .9; a.timer = 0;
  car.x = stop.x - 12; car.z = Math.sign(at(a.route, 0).z) * 4.5; herd.step(1 / 120, car, true);
  assert.equal(a.dir, 1, 'it turns round, away from the car line');
  // Nearly across, with the car between it and its lane stop: it runs on into the far field, not back over the car's line.
  a = stage(200, 25); a.state = 'leaving'; a.dir = 1; a.progress = 1.85;
  car.x = stop.x - 30; car.z = at(a.route, 1.3).z;
  for (let i = 0; i < 120 && a.state === 'leaving'; i++) { car.x += 25 / 120; herd.step(1 / 120, car, true); }
  assert.equal(a.state, 'bolting'); assert.equal(a.dir, 1, 'measured from where it is, not from its lane stop');
}
console.log(`PASS never contact from 4 starts on ${LINES.length} lines x 8 speeds: tightest body gap ${tightest.toFixed(2)} m, ${crossings} crossings`);
// The horn sends it home at a walk; the car is untouched by the animals.
a = stage(40, 0); herd.honk(car); assert.equal(a.state, 'leaving', 'horn sends it home');
a = stage(200, 25); herd.honk(car); assert.equal(a.state, 'stopped', 'the horn reaches 65 m, not 200');
assert.equal(car.speed, 25, 'the animals never change the car');
// Not playing (a demo or a free camera), shift ended, paused, multiplayer: no complaint.
for (const mode of ['playing', 'ended', 'paused', 'room']) {
  a = stage(200, 25); n = shift.complaints.all.length;
  if (mode === 'ended') shift.ended = true; if (mode === 'paused') herd.setPaused(true);
  for (let i = 0; i < 9 * 120; i++) {
    car.x += 25 / 120; herd.step(1 / 120, car, mode !== 'playing');
    if (i % 2) herd.update(1 / 60, car, mode !== 'room');
  }
  assert.equal(shift.complaints.all.length, n, `no complaint: ${mode}`);
  if (mode === 'paused') assert.equal(a.state, 'stopped', 'a paused animal does not move');
  if (mode === 'room') { assert.equal(herd.group.visible, false, 'a multiplayer room clears the road'); assert.equal(herd.hint, ''); assert.ok(herd.residents.every(r => r.progress === 0 && !r.visible)); }
  shift.ended = false; herd.setPaused(false);
}
// Photo evidence: a deer in the lane is a blocking animal in the picture; in the field it is not blocking.
a = stage(30, 0); const subject = shift.evidence.subjects.get('road-animal:0');
assert.equal(subject.active && subject.blocking, true, 'in the lane: active and blocking');
assert.ok(Math.hypot(subject.x - stop.x, subject.z - stop.z) < .01, 'subject follows the animal');
const photo = shift.evidence.take(1, car.x, car.z, Math.PI / 2, { updateMatrixWorld() {}, projectionMatrix: new Matrix4(), matrixWorldInverse: new Matrix4() });
assert.ok(photo.facts.some(f => f.id === 'road-animal:0' && f.blocking), 'a photograph records the animal blocking the road');
herd.reset(); assert.equal(subject.active, false, 'Start over clears the subject');
a = stage(30, 0); terrain.dataRevision++; herd.update(.01, car);
assert.equal(a.visible, true, 'an accepted animal survives a pending rail replan'); drain(rails);
console.log('PASS hint before complaint, HUD order, near misses only, horn, pause/end/demo/room, evidence');

// Facing, footing, Start over and 1884.
const diagonal = new Roads({ roads: [{ ...road, pts: [[-1000, -400], [1000, 400]] }] }, [0, 0], terrain);
const walkers = new RoadAnimals(diagonal, terrain, { ...shift, roadside: [], evidence: new Evidence(), showsHint() { return false; } }, []);
walkers.update(.01, car);
const walker = walkers.residents[0];
camera.set(walker.route.stop.x, 100, walker.route.stop.z); drain(diagonal.guardrails);
car.x = walker.route.stop.x; car.z = walker.route.stop.z; go(0);
walker.progress = .5; walker.state = 'walking';
walkers.update(.05, car);
assert.equal(walker.visible, true, 'diagonal fixture route is accepted');
const matrix = new Matrix4(), mesh = walkers.meshes[walker.route.species]; mesh.getMatrixAt(0, matrix);
const forward = new Vector3(0, 0, -1).transformDirection(matrix);
const walk = new Vector3(walker.route.stop.x - walker.route.home.x, 0, walker.route.stop.z - walker.route.home.z).normalize();
assert.ok(forward.dot(walk) > .99, 'model faces its walking direction');
walker.state = 'leaving'; walkers.update(.05, car); mesh.getMatrixAt(0, matrix);
assert.ok(new Vector3(0, 0, -1).transformDirection(matrix).dot(walk) < -.99, 'model faces home while leaving');
const sameDayRoutes = herd.residents.map(r => r.route);
herd.reset();
assert.equal(herd.group.visible, false, 'Start over hides the old encounter immediately');
assert.equal(herd.residents.length, 0, 'Start over drops the old animals before the next physics step');
assert.equal(herd.reportLine(), '', 'Start over clears near misses');
herd.update(.01, car);
assert.deepEqual(herd.residents.map(r => r.route), sameDayRoutes, 'Start over repeats the same daily routes');
assert.ok(herd.residents.every(r => r.progress === 0 && !r.complained), 'Start over resets every animal');
shift.career.day = 124; herd.update(.01, car);
assert.notDeepEqual(herd.residents.map(r => r.route), sameDayRoutes, 'the next mail day brings other animals');
const visibleGround = (x, z) => 100 + x * .1 + z * .05;
const slopeTerrain = { ...terrain, surfaceAt: (x, z) => ({ ground: visibleGround(x, z) - .2, level: 8, canopy: 0 }), heightAt: (x, z) => visibleGround(x, z) - .2, meshHeightAt: visibleGround };
const slopeRoads = new Roads({ roads: [road] }, [0, 0], slopeTerrain);
const slopeHerd = new RoadAnimals(slopeRoads, slopeTerrain, { ...shift, roadside: [], evidence: new Evidence() }, []);
slopeHerd.update(.01, car); const standing = slopeHerd.residents[0];
camera.set(standing.route.stop.x, 100, standing.route.stop.z); drain(slopeRoads.guardrails);
car.x = standing.route.stop.x; car.z = standing.route.stop.z; standing.progress = 1; standing.state = 'stopped';
slopeHerd.update(.01, car); assert.ok(standing.visible, 'sloped road fixture appears');
slopeHerd.meshes[standing.route.species].getMatrixAt(0, matrix);
const look = ANIMAL_LOOK[standing.route.species];
for (const x of [-look.legX, look.legX]) for (const z of [-look.legZ, look.legZ]) {
  const hoof = new Vector3(x, 0, z).applyMatrix4(matrix);
  assert.ok(Math.abs(hoof.y - visibleGround(hoof.x, hoof.z)) < .05, 'four soles stand on the visible road plane');
}
// Both fields must be proved: a road with a drop and a rail on one side has no animals on either side.
const cliffRoads = new Roads({ roads: [road] }, [0, 0], cliff), cliffHerd = new RoadAnimals(cliffRoads, cliff, { ...shift, roadside: [], evidence: new Evidence() }, []);
cliffHerd.update(0, car);
const west = cliffHerd.residents.find(r => r.route.side < 0);
assert.ok(west, 'the fixture has an animal on the flat side');
camera.set(west.route.stop.x, 100, west.route.stop.z); drain(cliffRoads.guardrails);
car.x = west.route.stop.x - 100; car.z = 0; cliffHerd.update(.01, car);
assert.equal(west.safe, false, 'its home side is flat, but it could not escape across the road: not used');
// The runtime asks the terrain where the finest land exists (Terrain.hasFinest): east of x = 0 only here.
const tiled = { ...terrain, manifest: { village: [0, 0], area: { id: 'fixture' } }, hasFinest: x => x > 0 };
const tiledHerd = new RoadAnimals(network, tiled, { ...shift, roadside: [], evidence: new Evidence() }, []);
tiledHerd.update(0, car);
assert.ok(tiledHerd.residents.length > 0 && tiledHerd.residents.every(r => r.route.stop.x > 0 && r.route.far.x > 0 && r.route.home.x > 0), 'routes only on the finest baked tiles');
{
  // A near miss counts only on the asphalt: one startled already on the verge is no complaint.
  shift.career.day = 123; camera.set(stop.x, 100, stop.z); drain(rails);
  for (const [where, expected] of [['verge', 0], ['asphalt', 1]]) {
    a = stage(200, 25); car.x = stop.x - 160; const n0 = shift.complaints.all.length;
    for (let i = 0; car.x < stop.x - startleRange(25) - 2; i++) { car.x += 25 / 120; herd.step(1 / 120, car, true); if (i % 2) herd.update(1 / 60, car); }
    a.state = 'leaving'; a.dir = -1; a.progress = where === 'verge' ? a.route.onto - .02 : a.route.onto + .15; a.timer = 0;
    for (let i = 0; i < 2 * 120 && a.state === 'leaving'; i++) { car.x += 25 / 120; herd.step(1 / 120, car, true); }
    assert.equal(a.state === 'bolting' || a.state === 'waiting', true, `startled on the ${where}`);
    assert.equal(shift.complaints.all.length - n0, expected, `startled on the ${where}: ${expected} complaints`);
  }
}
{
  // Marsh at sea level: the route is blocked once, not re-tested every frame.
  const marsh = { ...terrain, surfaceAt: () => ({ ground: -1, level: 8, canopy: 0 }), heightAt: () => -1, manifest: { village: [0, 0], area: { id: 'fixture' } }, hasFinest: () => true };
  const marshRoads = new Roads({ roads: [road] }, [0, 0], marsh), marshHerd = new RoadAnimals(marshRoads, marsh, { ...shift, roadside: [], evidence: new Evidence() }, []);
  marshHerd.update(0, car); const m0 = marshHerd.residents[0];
  camera.set(m0.route.stop.x, 100, m0.route.stop.z); drain(marshRoads.guardrails);
  car.x = m0.route.stop.x - 100; car.z = 0; marshHerd.update(.01, car);
  assert.equal(m0.safe, false); assert.equal(m0.revision, marsh.dataRevision, 'decided once for this land revision');
}
{
  // A car driven into the field right up to a waiting animal: it slips out of sight, so nothing is drawn under the car.
  a = stage(200, 0); a.state = 'waiting'; a.progress = 0; a.cooldown = 1e9;
  const field = at(a.route, 0); car.x = field.x - 30; car.z = field.z; go(0); herd.update(.01, car);
  assert.equal(a.visible, true, 'seen from 30 m');
  car.x = field.x - (CAR_SPEC.envelope.reach + ANIMAL.radius + ANIMAL.shy - .5); herd.update(.01, car);
  assert.equal(a.visible, false, 'not drawn with a car body inside ANIMAL.shy of it');
  car.z = 0;
}
{
  // A truck and its trailer. Body gaps from the real envelopes: the truck's and the trailer's circles.
  const trailer = { attached: true, x: 0, z: 0 }, truck = body(0, 0, Math.PI / 2, 0, 0, 0, TRUCK_SPEC);
  const bodyGap = q => {
    let g = Infinity;
    for (const [b, env] of [[truck, TRUCK_SPEC.envelope], [trailer, TRAILER_SPEC.envelope]]) for (const o of env.circles)
      g = Math.min(g, Math.hypot(q.x - (b.x + Math.sin(truck.heading) * o), q.z - (b.z - Math.cos(truck.heading) * o)) - env.radius - ANIMAL.radius);
    return g;
  };
  herd.towed = trailer; let worst = Infinity;
  // Reversing with the trailer leading, on lines across the road, slowly (the mailbox case) and faster.
  for (const lateral of [-4.5, -3, 0, 3, 4.5]) for (const back of [1, 2, 3, 5, 8]) {
    a = stage(200, 0); truck.x = stop.x + 40; truck.z = lateral; truck.vx = -back;
    for (let i = 0; i < 90 / back * 120; i++) {
      truck.x -= back / 120; trailer.x = truck.x - 9; trailer.z = truck.z;
      herd.step(1 / 120, truck, true); if (i % 2) herd.update(1 / 60, truck);
      if (a.visible) worst = Math.min(worst, bodyGap(at(a.route, a.progress)));
    }
  }
  // Forward through the fields and along the verges past a waiting animal.
  for (const lateral of [-14, -12, -9, -6.5, 6.5, 9, 12, 14]) {
    a = stage(200, 0); a.state = 'waiting'; a.progress = 0; a.cooldown = 1e9; truck.x = stop.x - 60; truck.z = lateral; truck.vx = 8;
    for (let i = 0; i < 130 / 8 * 120; i++) {
      truck.x += 8 / 120; trailer.x = truck.x - 9; trailer.z = truck.z;
      herd.step(1 / 120, truck, true); if (i % 2) herd.update(1 / 60, truck);
      if (a.visible) worst = Math.min(worst, bodyGap(at(a.route, a.progress)));
    }
  }
  assert.ok(worst > .25, `truck and trailer never reach a drawn animal: closest body gap ${worst.toFixed(2)} m`);
  herd.towed = null;
  // An ordinary pass in the near lane does not make a waiting animal blink out.
  a = stage(200, 15, Math.sign(at(herd.residents[0].route, 0).z) * 1.65); a.state = 'waiting'; a.progress = 0; a.cooldown = 1e9;
  let flips = 0, last = true;
  for (let i = 0; i < 20 * 120; i++) { car.x += 15 / 120; herd.step(1 / 120, car, true); if (i % 2) { herd.update(1 / 60, car); if (a.visible !== last) flips++; last = a.visible; } }
  assert.equal(flips, 0, 'a waiting animal stays in sight of a car in either lane');
  // A car sliding sideways at it: the real velocity closes, so it startles though the nose points away.
  a = stage(200, 0); const slide = body(stop.x - 12, stop.z, 0, 12, 14, -12, CAR_SPEC);
  herd.step(1 / 120, slide, true);
  assert.equal(a.state, 'bolting', 'a sliding car startles it');
  // A photograph counts it as blocking the road only while it is on the asphalt.
  a = stage(60, 0); const pic = shift.evidence.subjects.get('road-animal:0');
  a.state = 'walking'; a.progress = a.route.onto - .05; herd.update(.0001, car); assert.equal(pic.active && !pic.blocking, true, 'on the verge: in the picture, not blocking');
  a.progress = a.route.onto + .05; herd.update(.0001, car); assert.equal(pic.blocking, true, 'on the asphalt: blocking');
}
const historic = new RoadAnimals(network, { ...terrain, cartRoads: true }, { ...shift, roadside: [], evidence: new Evidence() }, []);
historic.update(.05, car);
assert.equal(historic.residents.length, 0, '1884 has no road animals');
console.log('PASS facing, footing on the drawn road, Start over, next day and 1884');

// No allocation per physics step, with an animal in view. Measured in chunks of a million steps after a warm-up: on a
// busy host the step can run unoptimised code (which boxes numbers) for a while. One heap number a step (16 bytes) makes
// about two minor collections per million steps, so eight or more in every four-million chunk; optimised clean code
// makes none (the observer may add one).
herd.reset(); shift.career.day = 123; a = stage(150, 0);
const plain = body(car.x, car.z, Math.PI / 2, 3, 3, 0, CAR_SPEC);
let scavenges = 0; const watcher = new PerformanceObserver(list => { for (const e of list.getEntries()) if (e.detail?.kind === 1 || e.kind === 1) scavenges++; });
watcher.observe({ entryTypes: ['gc'] });
for (let i = 0; i < 2e5; i++) { plain.x = stop.x - 150 + (i % 1000) * .1; herd.step(1 / 120, plain, true); }
const chunks = [];
for (let chunk = 0; chunk < 6 && !(chunks.length && Math.min(...chunks) === 0); chunk++) {
  await new Promise(r => setTimeout(r, 20)); scavenges = 0;
  for (let i = 0; i < 4e6; i++) { plain.x = stop.x - 150 + (i % 1000) * .1; herd.step(1 / 120, plain, true); }
  await new Promise(r => setTimeout(r, 20)); chunks.push(scavenges);
}
watcher.disconnect();
assert.ok(Math.min(...chunks) <= 2, `the physics step allocates nothing (minor collections per four million steps: ${chunks.join(', ')})`);
console.log(`PASS physics step makes no garbage: minor collections per four million steps ${chunks.join(', ')}`);

if (process.argv.includes('--mutations')) {
  const { build } = await import('../web/node_modules/esbuild/lib/main.js');
  const { readFileSync, mkdtempSync, rmSync, mkdirSync } = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const { resolve } = await import('node:path');
  const root = process.env.MMM_ROOT ?? process.cwd(); mkdirSync(resolve(root, 'data/work/road-animals'), { recursive: true });
  const scratch = mkdtempSync(resolve(root, 'data/work/road-animals/mutants-'));
  const mutations = [
    ['road-only', 'road-animal-rules.ts', 'road.kind < 2 || road.kind > 3', 'false'],
    ['bridge', 'road-animal-rules.ts', '|| road.bridge', '|| false'],
    ['railway', 'road-animal-rules.ts', '|| railwayRoad(road)', '|| false'],
    ['daily-seed', 'road-animal-rules.ts', 'hash(day ^', 'hash(1 ^'],
    ['field-side', 'road-animal-rules.ts', 'along, side * (road.halfWidth + ANIMAL.field)', 'along, 0'],
    ['far-field', 'road-animal-rules.ts', 'along, -side * (road.halfWidth + ANIMAL.field)', 'along, side * road.halfWidth * .35'],
    ['road-stop', 'road-animal-rules.ts', 'side * road.halfWidth * .35', 'side * (road.halfWidth + 6)'],
    ['site-box', 'road-animal-rules.ts', '&& Math.min(route.home.z, route.stop.z) - pad <= b[3]) return false;', '&& false) return false;'],
    ['fine-land', 'road-animal-rules.ts', 'if (fine(home.x, home.z) && fine(stop.x, stop.z) && fine(far.x, far.z) && routeOutside', 'if (routeOutside'],
    ['fine-wired', 'road-animals.ts', 'this.apart, this.fine)) {', 'this.apart)) {'],
    ['keep-away', 'road-animal-rules.ts', '< ANIMAL.keepAway * ANIMAL.keepAway) return false;', '< 0) return false;'],
    ['one-moose', 'road-animal-rules.ts', "route.species = 'deer';", ''],
    ['moose-gravel', 'road-animal-rules.ts', "roll === 0 && kind === 3 ? 'moose'", "roll === 0 ? 'moose'"],
    ['rail-route', 'road-animal-rules.ts', "if (rail === 'blocked')", 'if (false)'],
    ['rail-plan', 'guardrails.ts', 'if (c.revision !== this.terrain.dataRevision) pending = true;', 'if (false) pending = true;'],
    ['rail-span', 'guardrails.ts', '< radius + .35', '< 0'],
    ['startle-speed', 'road-animal-rules.ts', 'if (Math.abs(speed) > ANIMAL.speed) return closing', 'if (Math.abs(speed) > 40) return closing'],
    ['startle-closing', 'road-animal-rules.ts', 'return closing > 0 && distance < startleRange(speed)', 'return distance < startleRange(speed)'],
    ['reaction-time', 'road-animal-rules.ts', 'Math.abs(speed) * ANIMAL.reaction', '0'],
    ['bolt-rate', 'road-animal-rules.ts', 'bolt: 1.4', 'bolt: .4'],
    ['hint-range', 'road-animal-rules.ts', 'distance < ANIMAL.hint && closing > 1', 'distance < 20 && closing > 1'],
    ['hint-parked', 'road-animal-rules.ts', 'return Math.abs(speed) > 1 && (', 'return ('],
    ['warning-needed', 'road-animals.ts', '&& a.warned >= ANIMAL.read', ''],
    ['warning-shown', 'road-animals.ts', "this.afterTime === 0 && this.shift.showsHint(this) ? this.named : null", 'this.named'],
    ['hud-order', 'shift.ts', 'if (this.roadside[i].hint) return this.roadside[i] === scene;', 'if (this.roadside[i] === scene) return !!scene;'],
    ['damage-first', 'shift.ts', 'if (this.damage.hintTime > 0) return false;\n    for', 'for'],
    ['one-complaint', 'road-animals.ts', '&& !a.complained &&', '&&'],
    ['playing', 'road-animals.ts', 'if (playing && !this.shift.ended &&', 'if (!this.shift.ended &&'],
    ['ended', 'road-animals.ts', 'if (playing && !this.shift.ended &&', 'if (playing &&'],
    ['paused', 'road-animals.ts', 'if (this.paused || !this.live) return;\n    this.afterTime', 'this.afterTime'],
    ['room', 'road-animals.ts', 'this.live = live;\n    if (!live) {', 'this.live = live;\n    if (false) {'],
    ['horn', 'road-animals.ts', "if (a.state === 'walking' || a.state === 'stopped') leave(a, 'leaving',", "if (false) leave(a, 'leaving',"],
    ['horn-range', 'road-animals.ts', '>= ANIMAL.horn) continue;', '>= 1e9) continue;'],
    ['yield', 'road-animals.ts', "if (reaction === 'yield' && (a.state !== 'leaving' || dir !== a.dir))", 'if (false)'],
    ['turn-round', 'road-animals.ts', "(a.state !== 'leaving' || dir !== a.dir)", "a.state !== 'leaving'"],
    ['escape-away', 'road-animal-rules.ts', '< 0 ? 1 : -1;', '< 0 ? -1 : -1;'],
    ['far-proved', 'road-animals.ts', "near === 'blocked' || far === 'blocked' ?", "near === 'blocked' ?"],
    ['warning-unbroken', 'road-animals.ts', 'a.warned = a === shown ? a.warned + dt : 0;', 'if (a === shown) a.warned += dt;'],
    ['yield-early', 'road-animal-rules.ts', 'Math.max(0, closing) / ANIMAL_RATE.leave + ANIMAL.margin', '0'],
    ['step-out', 'road-animal-rules.ts', '&& stopDistance > ANIMAL.step', ''],
    ['asphalt-only', 'road-animals.ts', ' && a.progress > a.route.onto && a.progress < a.route.off) this.complain', ') this.complain'],
    ['never-good', 'road-animal-rules.ts', "if (h !== null && Number.isNaN(h)) return 'blocked';", ''],
    ['never-good-edge', 'road-animal-rules.ts', "if (edge !== null && Number.isNaN(edge)) return 'blocked';", ''],
    ['marsh', 'road-animals.ts', 'return s.ground > this.terrain.seaLevel + .5 ? s.ground : NaN;', 'return s.ground > this.terrain.seaLevel + .5 ? s.ground : null;'],
    ['far-sites', 'road-animal-rules.ts', ' && routeOutside(farRoute(route), boxes)', ''],
    ['shy', 'road-animals.ts', "if (a.state === 'waiting' && this.gap(p, player) < ANIMAL.shy) continue;", ''],
    ['field-near', 'road-animal-rules.ts', 'field: 9,', 'field: 3.5,'],
    ['frozen', 'road-animal-rules.ts', "return closing > 0 && distance < startleRange(speed) ? 'startle' : 'none';", "if (closing > 0 && distance < startleRange(speed)) return 'startle';"],
    ['trailer', 'road-animals.ts', '      if (towed) {\n', '      if (false) {\n'],
    ['trailer-shy', 'road-animals.ts', 'if (towed) gap = Math.min(', 'if (false) gap = Math.min('],
    ['velocity', 'road-animals.ts', '(player.vx * dx + player.vz * dz) / centre', 'player.speed * (dx * Math.sin(player.heading) - dz * Math.cos(player.heading)) / centre'],
    ['shy-gap', 'road-animal-rules.ts', 'field: 9, shy: 2,', 'field: 9, shy: 9,'],
    ['blocking-asphalt', 'road-animals.ts', 's.blocking = onRoad(a) && a.progress > a.route.onto && a.progress < a.route.off;', 's.blocking = onRoad(a);'],
    ['cross-swap', 'road-animals.ts', 'if (moveAnimal(a, dt, distance, stopDistance)) crossRoute(a.route);', 'moveAnimal(a, dt, distance, stopDistance);'],
    ['escape-from-here', 'road-animals.ts', "const dir = reaction === 'none' ? 0 : escapeDirection(a.route, bx, bz, p);", "const dir = reaction === 'none' ? 0 : escapeDirection(a.route, bx, bz, a.route.stop);"],
    ['evidence', 'road-animals.ts', 's.active = true; s.blocking = onRoad(a) &&', 's.active = true; s.blocking = false &&'],
    ['facing', 'road-animals.ts', '2 * reach), -heading,', '2 * reach), heading,'],
    ['footing', 'road-animals.ts', 'this.terrain.meshHeightAt?.(x, z, true)', 'null'],
    ['pending', 'road-animals.ts', "if (safety !== 'pending')", 'if (true)'],
    ['reset', 'road-animals.ts', 'this.day = NaN; this.residents.length = 0;', 'this.day = NaN;'],
    ['day', 'road-animals.ts', 'if (this.shift.career.day !== this.day)', 'if (this.day !== this.day && false)'],
    ['era', 'road-animals.ts', 'if (this.terrain.cartRoads) return;', ''],
    ['step-alloc', 'road-animals.ts', 'const p = routePoint(a.route, a.progress, this.point);\n      // The nearer', 'const p = routePoint(a.route, a.progress, { x: 0, z: 0 });\n      // The nearer'],
    ['step-hypot', 'road-animals.ts', 'centre = Math.sqrt(dx * dx + dz * dz)', 'centre = Math.hypot(dx, dz)'],
  ];
  try {
    for (const [name, file, from, to] of mutations) {
      const outfile = resolve(scratch, name + '.mjs'); let applied = false;
      await build({ entryPoints: [resolve(root, 'tools/road-animals-check.mjs')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent',
        plugins: [{ name: 'mutant', setup(b) { b.onLoad({ filter: /\.ts$/ }, args => {
          if (!args.path.endsWith('/' + file)) return;
          const source = readFileSync(args.path, 'utf8'); assert.equal(source.split(from).length, 2, 'unique mutation ' + name);
          applied = true; return { contents: source.replace(from, to), loader: 'ts' };
        }); } }] });
      assert.ok(applied, name + ' applied');
      const run = spawnSync(process.execPath, [outfile], { cwd: root, encoding: 'utf8' });
      assert.notEqual(run.status, 0, 'mutant survived: ' + name); assert.match(run.stderr, /AssertionError/, 'assertion kills ' + name);
      console.log('KILLED ' + name);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
  console.log(`PASS ${mutations.length} source mutants rejected`);
}
