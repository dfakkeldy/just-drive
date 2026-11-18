// Bundle with web/node_modules/.bin/esbuild, then run with Node (tools/check-church-interior.sh). No browser, no map fetches.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { ChurchSite, CHURCH_GEOM, CHURCH_FEATURES, CHURCH_SCALE } from '../web/src/church-site.ts';
import { CHURCH_ROOM, CHURCH_WALL, CHURCH_DOOR_RADIUS, ceilingAt, churchDoorPosition, churchRail, railPoint } from '../web/src/church-room.ts';
import { ChurchVisit, WALK_PACE } from '../web/src/church-room-rules.ts';
import { Interiors } from '../web/src/interiors.ts';

const close = (a, b, what, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} is not ${b}`);
const S = CHURCH_SCALE, { nave: n, tower: t, vestry: v } = CHURCH_GEOM, R = CHURCH_ROOM, N = R.shell.nave, V = R.shell.vestry, F = R.fit;

// 1. Inside and outside agree: every shell number is the exterior's number, scaled, less the wall.
assert.match(readFileSync('src/church.ts', 'utf8'), /const T = 0\.25;/, 'church.ts wall thickness');
assert.equal(CHURCH_WALL, 0.25, 'the room uses the exterior wall thickness');
const entry = CHURCH_FEATURES.openings.find(o => o.kind === 'door');
close(N.x1 - N.x0, (n.x1 - n.x0 - 2 * CHURCH_WALL) * S, 'nave length');
close(N.z1 - N.z0, (n.zn + n.zs - 2 * CHURCH_WALL) * S, 'nave width');
close(N.eave, (n.eave - entry.y0) * S, 'eave height above the floor');
close(N.ridge, (n.ridge - entry.y0) * S, 'ridge height above the floor');
close(V.x1 - V.x0, (n.x0 - v.x0 - CHURCH_WALL) * S, 'vestry length');
close(V.z1 - V.z0, (v.z1 - v.z0 - 2 * CHURCH_WALL) * S, 'vestry width');
close(V.ceiling, (v.eave - entry.y0) * S, 'vestry ceiling');
assert.equal(R.shell.windows.length, 6, 'three round-headed windows on each side');
for (const w of R.shell.windows) {
  const o = CHURCH_FEATURES.openings.find(o => o.kind === 'arch' && o.face === (w.side > 0 ? 'nave_s' : 'nave_n') && Math.abs(o.u * S - w.x) < 1e-9);
  assert.ok(o, 'each inside window is an outside window'); close(w.width, o.w * S, 'window width'); close(w.sill, (o.y0 - entry.y0) * S, 'window sill');
}
assert.ok(N.x1 - N.x0 > 13 && N.x1 - N.x0 < 15.5 && N.z1 - N.z0 > 8.5 && N.z1 - N.z0 < 10.5, 'the nave is metres, not model units');
// The vestry lies on +z, which is the left when you walk toward the altar (-x): the same side as its door in the room.
assert.ok(F.vestryDoor.z - F.vestryDoor.width / 2 > V.z0 && F.vestryDoor.z + F.vestryDoor.width / 2 < V.z1 && F.vestryDoor.z > N.ridgeZ, 'vestry door opens into the vestry, left of the altar');
// The ceiling: a flat panel under the ridge, sloped sides down to the eaves, never above the roof.
const top = ceilingAt(R, N.ridgeZ);
close(ceilingAt(R, N.ridgeZ + F.ceiling.flatHalf), top, 'flat panel edge'); close(ceilingAt(R, N.z0), N.eave - F.ceiling.drop, 'ceiling meets the eave');
close(ceilingAt(R, N.z1), N.eave - F.ceiling.drop, 'ceiling meets the other eave'); assert.ok(top < N.ridge && top > N.eave + 1, 'flat panel lies between eave and ridge');
assert.ok(F.gallery.floor + F.gallery.front < N.eave, 'gallery rail is below the eave');
console.log(`PASS: room ${(N.x1 - N.x0).toFixed(2)} x ${(N.z1 - N.z0).toFixed(2)} m, eave ${N.eave.toFixed(2)} m, ridge ${N.ridge.toFixed(2)} m, flat ceiling ${top.toFixed(2)} m; all from church-site.ts.`);

// 2. The door: at the foot of the tower steps, and a car parked on the gravel can reach it.
const site = new ChurchSite([630000, 5080000]), door = churchDoorPosition(site), local = site.local(door.x, door.z);
close(local.x, t.x1 + CHURCH_FEATURES.steps.run, 'door is at the foot of the steps', 1e-6); close(local.z, CHURCH_FEATURES.steps.u, 'door is on the tower axis', 1e-6);
const st = CHURCH_FEATURES.steps;
// The site's own solids, each read back into model units.
const inSolid = (x, z) => site.solids.some(s => { const c = site.local(s.x, s.z); return Math.abs(x - c.x) < s.half / S && Math.abs(z - c.z) < s.halfWidth / S; });
assert.ok(inSolid((n.x0 + n.x1) / 2, 0) && inSolid(t.x1 + st.run / 2, 0), 'the nave and the steps are solid');
for (const [x, z] of [[8, 12], [t.x1 + st.run + 4, 0], [10, -4]]) {
  const p = site.world(x, z);
  assert.ok(!inSolid(x, z), `parking point ${x},${z} is outside every solid of the site`);
  assert.ok(Math.hypot(p.x - door.x, p.z - door.z) < CHURCH_DOOR_RADIUS - 2.5, `a car at model ${x},${z} is in reach of the door`);
}
const far = site.world(st.run + 40, 20); assert.ok(Math.hypot(far.x - door.x, far.z - door.z) > CHURCH_DOOR_RADIUS, 'the far end of the lot is out of reach');

// 3. The rail stays inside the room, with headroom, and visits the four places in order.
const rail = churchRail();
assert.deepEqual(rail.stops.map(s => s.id), ['door', 'altar', 'vestry', 'gallery', 'out']);
for (let i = 1; i < rail.stops.length; i++) assert.ok(rail.stops[i].at > rail.stops[i - 1].at, 'stops are in walking order');
close(rail.stops.at(-1).at, rail.total, 'the walk ends at the door');
for (let d = 0; d <= rail.total; d += .05) {
  const p = railPoint(rail, d), eye = p.y + F.eye, inVestry = p.x < N.x0;
  if (inVestry) assert.ok(p.x > V.x0 + .4 && p.z > V.z0 + .4 && p.z < V.z1 - .4 && eye < V.ceiling - .25, `in the vestry at ${d.toFixed(2)}`);
  else assert.ok(p.x < N.x1 - .3 && p.z > N.z0 + .25 && p.z < N.z1 - .25 && eye < ceilingAt(R, p.z) - .3, `in the nave with headroom at ${d.toFixed(2)} (${JSON.stringify(p)})`);
}
assert.ok(rail.total > 40 && rail.total < 90, `walk length ${rail.total}`);

// 4. The walk's rules: the visitor sets the pace; nothing is timed or scored.
const step = 1 / 60, hold = { walk: 1, look: 0 }, rest = { walk: 0, look: 0 };
const walkTo = (visit, id) => { for (let i = 0; i < 60 * 300 && visit.stop.id !== id && !visit.result; i++) visit.update(step, visit.halted && i % 2 ? rest : hold); return visit; };
{
  const visit = new ChurchVisit(rail, false);
  assert.equal(visit.stop.id, 'door'); assert.match(visit.message, /Box pews/);
  visit.update(600, rest); assert.equal(visit.distance, 0, 'standing still for ten minutes changes nothing'); assert.equal(visit.result, null);
  for (let i = 0; i < 60 * 60; i++) visit.update(step, hold);
  assert.equal(visit.stop.id, 'altar', 'holding forward stops at the altar and goes no further'); close(visit.distance, rail.stops[1].at, 'held at the altar');
  assert.match(visit.message, /three pointed arches outlined in gold/); assert.equal(visit.speed, 0);
  visit.update(step, rest); visit.update(.5, hold); assert.ok(visit.distance > rail.stops[1].at, 'letting go and pressing again walks on');
  const there = visit.distance; visit.update(2, { walk: -1, look: 0 }); assert.ok(visit.distance < there, 'the visitor can step back');
  for (let i = 0; i < 60 * 200; i++) visit.update(step, { walk: -1, look: 0 });
  assert.equal(visit.distance, 0, 'stepping back ends at the door, never outside the rail'); assert.equal(visit.result, null, 'stepping back does not end the visit');
  visit.update(2, { walk: 0, look: 5 }); assert.ok(visit.lookAngle > 1 && visit.lookAngle < 1.4, 'looking to the side is limited');
  assert.ok(visit.speed <= WALK_PACE);
}
{
  const visit = walkTo(new ChurchVisit(rail, false), 'out');
  assert.deepEqual(visit.result, { delivered: false, note: 'A quiet visit.' }, 'a drive-by visit leaves nothing'); assert.equal(visit.letter, false);
  assert.ok(visit.elapsed > 30 && visit.elapsed < 150, `an unhurried walk takes about a minute: ${visit.elapsed.toFixed(0)} s`);
  console.log(`PASS: full walk ${rail.total.toFixed(1)} m in ${visit.elapsed.toFixed(0)} s at ${WALK_PACE} m/s, four stops with words.`);
}
{
  const early = walkTo(new ChurchVisit(rail, true), 'altar'); early.leave();
  assert.equal(early.result.delivered, false, 'leaving before the vestry leaves no letter');
  const visit = walkTo(new ChurchVisit(rail, true), 'vestry');
  assert.equal(visit.letter, true); assert.match(visit.message, /You leave one letter on the chest of drawers\.$/);
  visit.leave(); assert.deepEqual(visit.result, { delivered: true, note: 'One letter left in the vestry.' });
  visit.leave(); assert.equal(visit.result.delivered, true, 'leaving twice changes nothing');
  assert.equal(walkTo(new ChurchVisit(rail, true), 'out').result.delivered, true, 'the whole walk in the mail game leaves one letter');
}
// The words describe what is seen. They name no person and state no date.
for (const s of rail.stops) { assert.doesNotMatch(s.text, /\d{3,}/, 'no years in the words'); assert.doesNotMatch(s.text, /\b(St\.|Saint|Father|Rev|Mac[A-Z]|Mc[A-Z])/, 'no names in the words'); }

// 5. The built scene. A stand-in canvas lets the hand-drawn textures run without a browser.
const pen = new Proxy({}, { get: (_, key) => key === 'createLinearGradient' || key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
const elements = new Map();
class Element {
  hidden = false; textContent = ''; children = []; listeners = new Map(); style = { values: new Map(), setProperty(k, v) { this.values.set(k, v); }, removeProperty(k) { this.values.delete(k); } };
  width = 0; height = 0; names = new Set(); classList = { add: c => this.names.add(c), remove: c => this.names.delete(c) };
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  append(...nodes) { this.children.push(...nodes); for (const node of nodes) if (node.id) elements.set(node.id, node); }
  appendChild(node) { this.append(node); return node; }
  getContext() { return pen; }
}
globalThis.document = { head: new Element(), body: new Element(), createElement() { return new Element(); } };
const { ChurchInterior, churchDoor } = await import('../web/src/interior-church.ts');
const idle = { throttle: 0, steer: 0, handbrake: false };
const room = new ChurchInterior(true); room.scene.updateMatrixWorld(true);
const { triangles, drawCalls } = room.parts;
assert.ok(triangles > 3000 && triangles < 30000, `triangles ${triangles}`); assert.ok(drawCalls <= 24, `draw calls ${drawCalls}`);
room.scene.traverse(o => { if (o.isMesh) { assert.equal(o.castShadow, false); assert.equal(o.receiveShadow, false); } if (o.isLight) assert.ok(!o.castShadow, 'no light casts a shadow'); });
// Every vertex lies inside the building's own outline (with the tower porch and the vestry).
const box = new THREE.Box3().setFromObject(room.scene), porch = R.shell.porch;
assert.ok(box.min.x >= V.x0 - .01 && box.max.x <= porch.x1 + .01 && box.min.z >= N.z0 - .01 && box.max.z <= N.z1 + .01 && box.min.y >= -.03 && box.max.y <= N.ridge, `scene bounds ${JSON.stringify(box)}`);
// Painted faces look inward: a ray from the aisle meets floor, both walls, the altar wall and the flat ceiling.
const ray = new THREE.Raycaster(), hit = (from, to) => { ray.set(new THREE.Vector3(...from), new THREE.Vector3(...to).normalize()); ray.far = 30; return ray.intersectObjects(room.scene.children, true)[0]; };
const mid = [(N.x0 + N.x1) / 2 - 1.3, 1.6, N.ridgeZ];
close(hit(mid, [0, -1, 0]).distance, 1.6, 'floor below', 1e-6); close(hit(mid, [0, 1, 0]).point.y, top, 'flat ceiling above', 1e-6);
// Past the end of the side galleries, so nothing stands between the aisle and the walls.
const clearX = N.x0 + F.gallery.sideEnd - 1.2;
close(hit([clearX, 2.6, mid[2]], [0, 0, 1]).point.z, N.z1, 'left wall', .02); close(hit([clearX, 2.6, mid[2]], [0, 0, -1]).point.z, N.z0, 'right wall', .02);
close(hit([mid[0], 5.6, mid[2]], [-1, 0, 0]).point.x, N.x0, 'altar wall', 1e-6);
const vestryMid = [(V.x0 + V.x1) / 2, 1.2, V.z0 + 1.6];
close(hit(vestryMid, [0, 1, 0]).point.y, V.ceiling, 'vestry ceiling', 1e-6); close(hit(vestryMid, [0, -1, 0]).point.y, 0, 'vestry floor', 1e-6);
// The rail never passes through a pew, a post, a tread, the altar, the chest or a picture: from shin to head, nothing
// lies within 0.3 m of the visitor, and nothing hangs within 0.3 m above the eye.
room.scene.traverse(o => { if (o.isMesh) o.material.side = THREE.DoubleSide; });
room.parts.groups.loft.visible = true;
const probe = (from, to, far, what) => {
  ray.set(from, to); ray.far = far;
  const blocked = ray.intersectObjects(room.scene.children, true)[0];
  assert.ok(!blocked, `something is ${blocked?.distance.toFixed(2)} m ${what} (${from.toArray().map(v => v.toFixed(2))})`);
};
const upward = new THREE.Vector3(0, 1, 0), downward = new THREE.Vector3(0, -1, 0);
let deepest = 0;
for (let d = 0; d <= rail.total; d += .05) {
  const p = railPoint(rail, d);
  for (const h of [.35, .9, F.eye, 1.85]) for (let a = 0; a < 8; a++) {
    probe(new THREE.Vector3(p.x, p.y + h, p.z), new THREE.Vector3(Math.cos(a * Math.PI / 4), 0, Math.sin(a * Math.PI / 4)), .3, `from the visitor at height ${h}, ${d.toFixed(2)} m along the rail`);
  }
  probe(new THREE.Vector3(p.x, p.y + F.eye, p.z), upward, .3, `above the eye ${d.toFixed(2)} m along the rail`);
  // The feet are on something: the floor, a tread or the gallery lies at most one riser below the path.
  ray.set(new THREE.Vector3(p.x, p.y + .3, p.z), downward); ray.far = 2;
  const ground = ray.intersectObjects(room.scene.children, true)[0];
  assert.ok(ground, `nothing under the feet ${d.toFixed(2)} m along the rail`);
  const sink = ground.distance - .3; deepest = Math.max(deepest, sink);
  assert.ok(sink > -.03 && sink < F.gallery.floor / F.stair.steps + .03, `the path is ${sink.toFixed(2)} m above what is under it at ${d.toFixed(2)} m (${JSON.stringify(p)})`);
}
room.scene.traverse(o => { if (o.isMesh) o.material.side = THREE.FrontSide; });
// No picture hangs in a doorway: across the vestry door, the first thing a level ray meets is the vestry's far wall.
for (const y of [.5, 1.2, 1.9]) for (const dz of [-.35, 0, .35]) {
  const through = hit([N.x0 + 1, y, F.vestryDoor.z + dz], [-1, 0, 0]);
  assert.ok(through.point.x < V.x1 - .5, `the vestry doorway is open at height ${y}, ${dz} from its middle (met something at x ${through.point.x.toFixed(2)})`);
}
// The gallery's own furniture is drawn only from up there; the letter appears only once it is left.
room.update(0, idle); assert.equal(room.parts.groups.loft.visible, false, 'loft furniture is not drawn from the floor'); assert.equal(room.parts.letter.visible, false);
assert.match(room.readout, /^One room\./); assert.match(room.readout, /W\/↑: walk/);
walkTo(room.visit, 'vestry'); room.update(0, idle); assert.equal(room.parts.letter.visible, true, 'the letter lies on the chest');
walkTo(room.visit, 'gallery'); room.update(0, { ...idle, touch: true }); assert.equal(room.parts.groups.loft.visible, true, 'loft furniture is drawn from the gallery');
assert.ok(room.camera.position.y > F.gallery.floor + 1.5 && room.camera.getWorldDirection(new THREE.Vector3()).x < -.8, 'the gallery view looks down the nave');
assert.match(room.readout, /WALK: go on/, 'phone words on a phone');
room.leave(); assert.equal(room.result.delivered, true); room.dispose(); assert.equal(room.scene.children.length, 0);
console.log(`PASS: scene ${triangles} triangles in ${drawCalls} draw calls, no shadows; faces look inward; 0.3 m clear from shin to head along the whole rail, feet on the floor or a tread; vestry doorway open; loft and letter appear when they should.`);

// 6. The shared door code: a church visit outside the mail game repeats, names its own controls, and files no receipt.
const receipts = [], doors = new Interiors(() => 0, () => '', r => receipts.push(r));
const quiet = churchDoor(site, false); doors.register(quiet);
assert.equal(quiet.repeat, true); assert.equal(churchDoor(site, true).repeat, false, 'in the mail game a visit counts once per shift');
const body = globalThis.document.body, hud = elements.get('interiorHud');
for (let visitNumber = 0; visitNumber < 2; visitNumber++) {
  doors.update(.1, idle, { x: door.x + 3, z: door.z, speed: 0 }, true); assert.equal(elements.get('doorPrompt').hidden, false, 'prompt at the steps');
  doors.enter(); assert.equal(doors.busy, true, `visit ${visitNumber + 1} begins`);
  assert.ok(body.names.has('indoorOn') && body.names.has('indoorGo'), 'the forward pedal is shown'); assert.equal(body.style.values.get('--indoor-go'), '"WALK"');
  assert.equal(hud.children[0].textContent, 'STEP OUT · Esc');
  doors.update(.41, idle, {}, true); doors.update(.1, idle, {}, true);
  assert.equal(hud.children[1].textContent, 'RIVER DENYS MOUNTAIN CHURCH', 'no day or clock on a drive');
  doors.leave(); doors.update(.41, idle, {}, true); assert.equal(doors.busy, false);
  assert.ok(!body.names.has('indoorOn') && !body.names.has('indoorGo') && body.style.values.size === 0, 'the page is put back');
}
assert.equal(receipts.length, 2); assert.ok(receipts.every(r => !r.result.delivered && r.result.note === 'A quiet visit.'));
// The mine keeps its own words and has no forward pedal.
doors.register({ id: 'pit', name: 'Pit', position: { x: 900, z: 0 }, radius: 5, prompt: '', create: () => ({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), result: null, readout: '', update() {}, render() {}, leave() { this.result = { delivered: false, note: '' }; }, dispose() {} }) });
doors.enter('pit'); assert.equal(hud.children[0].textContent, 'CLIMB OUT · Esc'); assert.ok(body.names.has('indoorOn') && !body.names.has('indoorGo'));
doors.leave(); doors.update(.41, idle, {}, true); doors.enter('pit'); assert.equal(doors.busy, false, 'other doors still open once per shift');
console.log('PASS: door at the step foot within reach of the lot; drive visits repeat and file a quiet receipt; mine labels unchanged.');
