import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Props } from '../web/src/props.ts';
import { Mail } from '../web/src/mail.ts';
import { launchMail } from '../web/src/mail-flight.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';

const terrain = { heightAt: () => 0, surfaceAt: () => ({ level: 8, roadDist: 20, halfWidth: 3 }) };
const box = (x = 0, extra = {}) => ({ x, y: 0, heading: 0, style: 0, tilt: 0, group: null, parcelBox: false, ...extra });
const make = (boxes = [box()]) => new Props({ crs: 'EPSG:2961', mailboxes: boxes, communityBoxes: [], poles: [] }, [0, 0], terrain);
const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 3, 8); camera.updateMatrixWorld();

const p = make();
assert.equal(p.mailHit(0, .1, -.4, 0, 0, -.2, true), -1, 'ground beside the post is a miss');
assert.equal(p.mailHit(0, 1.18, -2, 0, 1.18, 2, false), 0, 'front opening catches a fast swept throw');
assert.equal(p.mailHit(0, 1.18, -20, 0, 1.18, 20, false), 0, 'long swept contact cannot tunnel');
assert.equal(p.mailHit(.2, 1.18, -2, .2, 1.18, 2, false), -1, 'help never widens the opening');
assert.equal(p.mailHit(0, 1.5, -2, 0, 1.5, 2, false), -1, 'above the opening misses');
assert.equal(p.mailHit(0, 1.18, 2, 0, 1.18, -2, false), -1, 'back of the box rejects mail');

for (const [speed, severity] of [[0, 0], [.2, 0], [1, 1], [3, 2], [8, 3]]) {
  const props = make(); props.update(camera, 0);
  const inventory = props.group.children.flatMap(c => c.children).map(m => [m.uuid, m.count]);
  props.hitCar(0, 0, 0, speed, 0, 0, 0, CAR_SPEC);
  props.update(camera, 2);
  assert.equal(props.mail[0].motion.damage, severity, 'speed grades damage at ' + speed);
  assert.equal(props.downCount, severity === 3 ? 1 : 0);
  const m = new THREE.Matrix4(), meshes = props.group.children.flatMap(c => c.children);
  meshes.find(m => m.name === 'box-0').getMatrixAt(0, m);
  assert.ok(Math.abs(Math.hypot(m.elements[4], m.elements[5], m.elements[6]) - .28 * (severity >= 2 ? .65 : 1)) < 1e-7, 'dent squashes the box instance');
  if (severity > 0) assert.ok(Math.abs(m.elements[4]) > .02, 'impact visibly tilts the existing box instance');
  const settled = m.toArray();
  props.update(camera, 20);
  assert.equal(props.mail[0].motion.damage, severity, 'damage persists for the shift');
  meshes.find(m => m.name === 'box-0').getMatrixAt(0, m);
  assert.deepEqual(m.toArray(), settled, 'settled damage does not spring upright later');
  assert.deepEqual(props.group.children.flatMap(c => c.children).map(m => [m.uuid, m.count]), inventory, 'damage adds no meshes or instances');
  props.resetShift(); props.update(camera, 0);
  assert.equal(props.mail[0].motion.damage, 0, 'new shift clears all damage');
  assert.equal(props.mail[0].motion.angle, 0); assert.equal(props.downCount, 0);
  assert.deepEqual([props.mail[0].x, props.mail[0].z], [0, 0], 'site never moves');
}
for (const heading of [0, 67, 180, 270]) for (const tilt of [-10, 0, 8]) for (const speed of [0, 1, 3, 8]) {
  const props = make([box(0, { heading, tilt })]);
  props.hitCar(0, 0, 0, speed, 0, 0, 0, CAR_SPEC); props.update(camera, 2);
  const mesh = props.group.children.flatMap(c => c.children).find(m => m.name === 'box-0');
  const matrix = new THREE.Matrix4(); mesh.getMatrixAt(0, matrix);
  const a = new THREE.Vector3(0, 0, 2).applyMatrix4(matrix), b = new THREE.Vector3(0, 0, -2).applyMatrix4(matrix);
  assert.equal(props.mailHit(a.x, a.y, a.z, b.x, b.y, b.z, false, undefined, () => 'opening'), 0, 'opening follows the drawn box, including tilt, dent and fall');
  const aim = props.mailAim(0), expected = new THREE.Vector3(0, 0, .5 + .02 / .48).applyMatrix4(matrix);
  assert.ok(expected.distanceTo(aim) < 1e-6, 'preview aims at the actual opening');
}
const swept = make(); swept.hitCar(10, 0, Math.PI / 2, 3, 0, -10, 0, CAR_SPEC);
assert.equal(swept.mail[0].motion.damage, 2, 'swept car contact cannot skip a box');
const teleported = make(); teleported.hitCar(40, 0, 0, 8, 0, -40, 0, CAR_SPEC);
assert.equal(teleported.mail[0].motion.damage, 0, 'teleports do not damage a whole road');
const paused = make(), pausedMail = new Mail(terrain, paused, [], [0, 0], true);
pausedMail.update(0, { x: 0, z: 0, vx: 8, vz: 0, heading: 0, car: { driverEye: new THREE.Object3D() }, spec: CAR_SPEC }, false);
assert.equal(paused.downCount, 0, 'paused mail update never damages boxes');
const shared = make([box(0, { group: 1 }), box(.5, { group: 1 })]);
let complaints = 0; shared.onKnock = () => complaints++;
shared.hitCar(0, 0, 0, 8, 0, 0, 0, CAR_SPEC);
shared.hitCar(0, 0, 0, 8, 0, 0, 0, CAR_SPEC);
assert.equal(shared.downCount, 2); assert.equal(complaints, 2, 'each shared-frame customer is charged once');
assert.equal(shared.mail[0].motion.rock, 0, 'a fall does not also wobble past the ground');
shared.update(camera, .01);
assert.ok(shared.mail[0].motion.angle <= Math.PI * .49);
const preExisting = make(); preExisting.knockMailbox(0, 0, 0, true);
assert.equal(preExisting.mailHit(0, .1, -.4, 0, 0, -.2, true), -1, 'player-knocked boxes never accept ground mail by default');
assert.equal(preExisting.mailHit(0, .1, -.4, 0, 0, -.2, true, undefined, () => 'ground'), 0, 'only the service authorises a pre-existing ground drop');
assert.equal(preExisting.mailHit(0, .1, -.4, 1.01, 0, 0, true, undefined, () => 'ground'), -1, 'pre-existing drop remains within one metre');
const slow = make(); slow.hitCar(0, 0, 0, 1, 0, 0, 0, CAR_SPEC);
slow.hitCar(0, 0, 0, .2, 0, 0, 0, CAR_SPEC);
assert.equal(slow.mail[0].motion.damage, 1, 'a later slow touch cannot heal damage');

for (const heading of [0, .6, Math.PI / 2, Math.PI]) {
  const a = launchMail({ x: 0, y: 1.3, z: 0, vx: 0, vz: 0, heading, kind: 0, thrown: 0 });
  const b = launchMail({ x: 0, y: 1.3, z: 0, vx: 4, vz: -7, heading, kind: 0, thrown: 0 });
  assert.ok(Math.abs(a.x * Math.cos(heading) + a.z * Math.sin(heading) - .48) < 1e-12, 'window side follows heading');
  assert.ok(Math.abs(b.vx - a.vx - 4) < 1e-12); assert.ok(Math.abs(b.vz - a.vz + 7) < 1e-12, 'throw inherits vehicle speed');
}
const mail = new Mail(terrain, null, [], [0, 0], true);
const eye = new THREE.Object3D(); eye.position.set(0, 1.36, 0); eye.updateMatrixWorld();
const vehicle = { x: 0, z: 0, vx: 0, vz: 0, heading: 0, car: { driverEye: eye }, spec: CAR_SPEC };
let groundCalls = 0; mail.service = { condition: () => 'ready', deliver: () => true, ground: () => groundCalls++ };
mail.update(1 / 60, vehicle, true);
for (let n = 0; n < 180; n++) mail.update(1 / 60, vehicle, false);
assert.equal(mail.delivered, 0); assert.equal(mail.lawn + mail.ditch, 1, 'miss counts in shift score');
assert.equal(groundCalls, 1); assert.equal(mail.pieces[0].state, 'litter', 'miss remains visible on ground');
mail.reset(); assert.equal(mail.lawn + mail.ditch, 0); assert.equal(mail.activeCount, 0);
const unloaded = new Mail({ heightAt: () => null, surfaceAt: () => null }, null, [], [0, 0], true);
unloaded.update(1 / 60, vehicle, true);
for (let n = 0; n < 130; n++) unloaded.update(.1, vehicle, false);
assert.equal(unloaded.lawn + unloaded.ditch, 1, 'a throw beyond loaded ground still counts as a miss');
console.log('PASS Stage 2 opening hits, speed/side, graded lasting damage, shared frame, fixed sites, instance inventory, miss score and reset');
