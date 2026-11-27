// Bundle and run with esbuild, as for shift-check.mjs. Uses the real controller and prop reset hooks.
import assert from 'node:assert/strict';
import { Shift } from '../web/src/shift.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import { MAIL_CYCLE } from '../web/src/mail-flight.ts';
import { Mail } from '../web/src/mail.ts';
import { Props } from '../web/src/props.ts';
import { Roads } from '../web/src/roads.ts';
import { Paved } from '../web/src/paved.ts';
import { Ruts, isLawnSurface } from '../web/src/ruts.ts';
import { propsData, roads as bakedRoads, village, terrain as bakedTerrain } from './shift-fixture.mjs';
import { Evidence } from '../web/src/evidence.ts';
import * as THREE from '../web/node_modules/three/build/three.module.js';
class Element {
  hidden = false; textContent = ''; scrollTop = 0; width = 160; height = 90; children = []; listeners = new Map();
  classList = { add() {}, remove() {} };
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  after() {}
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  focus() {} getContext() { return { drawImage() {} }; }
  click() { this.listeners.get('click')?.(); }
}
const elements = new Map();
globalThis.document = { getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); }, createElement() { return new Element(); } };
Object.defineProperty(globalThis, 'localStorage', { get() { throw Error('Storage unavailable'); } });
const terrain = { heightAt() { return 0; }, surfaceAt() { return { ground: 0, canopy: 0, roadDist: 10, halfWidth: 3, kind: 2, level: 7 }; } };
const roads = new Roads({ roads: [{ id: 7, name: 'Birch Street', kind: 2, halfWidth: 3, bridge: false, pts: [[0, 0], [1000, 0]] }] }, [0,0], terrain);
const props = new Props({ crs: 'EPSG:2961', mailboxes: Array.from({ length: 20 }, (_, i) => ({ x: 100 + i * 10, y: 0, heading: 0, style: 0, tilt: 0, group: null, parcelBox: false })), communityBoxes: [{x:400,y:0,heading:0,modules:2}], poles: [] }, [0,0], terrain);
const mail = { delivered: 0, lawn: 0, ditch: 0, reset() { this.delivered = this.lawn = this.ditch = 0; }, get down() { return props.downCount; } };
let restarts = 0;
const shift = new Shift(props, mail, roads, terrain, [], [0,0], true, new URLSearchParams('day=1&run=8'), () => { restarts++; });
assert.equal(shift.career.day,1); assert.ok(props.downCount>=1 && props.downCount<=2);
const firstDraw = JSON.stringify(shift.today);
shift.roadside.push({hint: 'A roadside scene', reportLine: () => 'Mabou Mines Road: a fish truck, a parked car and a cow. Nobody knows how it ended.'});
const controllerCamera = new THREE.PerspectiveCamera(58,1,.1,100); controllerCamera.updateProjectionMatrix();
assert.doesNotThrow(()=>shift.takePhoto({x:0,z:0,heading:0},controllerCamera));
assert.equal(shift.evidence.photos.length,1);
const stuffed = shift.today.stuffed.findIndex(Boolean), box = props.mail[stuffed];
assert.equal(mail.service.condition(stuffed), 'stuffed');
const vehicle = { x: box.x, z: box.z, vx: 0, vz: 0, heading: 0, airborne: false };
shift.update(2, vehicle); assert.equal(shift.elapsed,40); assert.equal(shift.today.stuffed[stuffed],true);
vehicle.vx = 1; shift.update(.1, vehicle); vehicle.vx = 0;
shift.update(3.9, vehicle); assert.equal(shift.today.stuffed[stuffed],true,'moving resets cleaning');
shift.update(.11, vehicle); assert.equal(shift.today.stuffed[stuffed],false); assert.equal(mail.service.condition(stuffed),'ready');
const stop = shift.remaining.findIndex((n,i) => n>0 && !props.mail[i]?.motion.down && !shift.today.stuffed[i]);
assert.ok(stop >= 0);
const due = shift.remaining[stop];
for (let n=0;n<due;n++) { const complete = mail.service.deliver(stop); assert.equal(complete,n===due-1); mail.delivered++; }
assert.equal(shift.done,1); mail.service.deliver(stop); assert.equal(shift.done,1,'repeat throws do not count extra stops');
shift.end(); assert.equal(shift.ended,true); const frozen = shift.elapsed; shift.update(10, vehicle); assert.equal(shift.elapsed,frozen);
assert.equal(shift.roadsideReport.textContent, 'Mabou Mines Road: a fish truck, a parked car and a cow. Nobody knows how it ended.');
assert.ok(shift.complaints.all.some((c)=>c.kind==='late')); assert.equal(document.getElementById('shiftReport').hidden,false);
document.getElementById('nextDay').click(); assert.equal(shift.career.day,3); assert.equal(shift.career.double,true); assert.equal(shift.career.pay,345); assert.equal(shift.elapsed,0); assert.equal(mail.delivered,0); assert.equal(shift.done,0); assert.equal(restarts,1);
shift.elapsed = 8*3600-1; shift.update(.1,vehicle); assert.equal(shift.ended,true,'18:00 auto-end');
document.getElementById('startOver').click(); assert.equal(shift.career.day,1); assert.equal(shift.career.pay,0); assert.equal(JSON.stringify(shift.today), firstDraw); assert.equal(restarts,2);
const upright = props.mail.findIndex((p)=>!p.motion.down);
props.knockMailbox(upright,4,0); props.knockMailbox(upright,4,0);
assert.equal(shift.complaints.all.filter((c)=>c.kind==='boxDown' && c.target===upright).length,1);
const damages=[];
const ruts=new Ruts(terrain,[{id:99,x:0,y:0,kind:'house'}],[0,0],true,(...args)=>damages.push(args));
const crossing={x:0,z:10,vx:2,vz:0,heading:Math.PI/2,airborne:false};
for(let i=0;i<12;i++){crossing.x=i;ruts.update(crossing,i+1);}
assert.equal(damages.length,1); assert.ok(damages[0][3]<8,'damage time starts with the crossing'); assert.ok(ruts.count>2); assert.equal(ruts.mesh.count,320);
ruts.reset(); assert.equal(ruts.count,0); assert.equal(ruts.lawns,0);
// Hand-built mown yards (kind 12) take tyre tracks like ordinary grass, including across wide front lawns up to 60 m;
// real roads, gravel driveways, paved lots (including kind-12 overlaps), decks, water, mineral floors and dense canopy
// stay track-free, and Mail.miss agrees with Ruts on every surface and reach.
{
  let sampleAt = () => ({ ground: 0, canopy: 0, roadDist: 6.5, halfWidth: 10, kind: 12, level: 8 });
  let lotClass = 0;
  const yardTerrain = { heightAt: () => 0, surfaceAt: (x, z) => sampleAt(x, z), paved: { lotClassAt: () => lotClass } };
  const runDrive = (startX, z) => {
    const hits = [];
    const r = new Ruts(yardTerrain, [{ id: 1454, x: 0, y: 0, kind: 'house' }], [0, 0], true, id => hits.push(id));
    for (let i = 0; i < 12; i++) r.update({ x: startX + i * 0.8, z, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, i + 1);
    return { count: r.count, lawns: r.lawns, hits, mesh: r.mesh };
  };
  const checkMail = (x, z) => {
    const lawnMail = new Mail(yardTerrain, props, [{ id: 1454, x: 0, y: 0, kind: 'house' }], [0, 0], true);
    let lastGround = null;
    lawnMail.service = { condition: () => 'none', deliver: () => false, ground: (_x, _z, isLawn) => { lastGround = isLawn; } };
    lawnMail.miss({ x, z });
    return lastGround;
  };
  const lawn12 = { ground: 0, canopy: 0, roadDist: 6.5, halfWidth: 10, kind: 12, level: 8 };
  assert.equal(isLawnSurface(lawn12, false), true, 'kind 12 mown lawn accepts tracks');
  const nearLawn = runDrive(0, 12);
  assert.ok(nearLawn.count > 0 && nearLawn.lawns === 1, 'mown yard near house leaves ruts');
  assert.deepEqual(nearLawn.hits, [1454]);
  assert.equal(checkMail(0, 12), true, 'mail on kind-12 mown yard near house counts as lawnMail');
  const wideLawn = runDrive(36, 12);
  assert.ok(wideLawn.count > 0 && wideLawn.lawns === 1, 'wide mown yard (40 m from house) leaves ruts');
  assert.deepEqual(wideLawn.hits, [1454]);
  assert.equal(checkMail(42, 12), true, 'mail on wide kind-12 mown yard counts as lawnMail');
  // Per-wheel surface check: car centre on kind-12 lawn (z=12), left wheel on kind-8 gravel (z<11.5), right wheel on lawn.
  sampleAt = (_x, z) => z < 11.5
    ? { ground: 0, canopy: 0, roadDist: 8, halfWidth: 10, kind: 8, level: 8 }
    : lawn12;
  const edgeDrive = runDrive(0, 12);
  assert.ok(edgeDrive.count > 0 && edgeDrive.count < nearLawn.count, `straddling lawn/gravel draws only lawn-side strips (${edgeDrive.count} < ${nearLawn.count})`);
  const mat = new THREE.Matrix4();
  for (let i = 0; i < edgeDrive.count; i++) {
    edgeDrive.mesh.getMatrixAt(i, mat);
    assert.ok(mat.elements[14] >= 11.5, `strip ${i} z=${mat.elements[14].toFixed(2)} stays off gravel side`);
  }
  // Narrow 0.8 m kind-12 strip with kind-8 gravel on both sides: car centre stays on grass, both tyres stay on gravel -> 0 strips and 0 lawn damage.
  sampleAt = (_x, z) => Math.abs(z - 12) <= 0.4
    ? lawn12
    : { ground: 0, canopy: 0, roadDist: 8, halfWidth: 10, kind: 8, level: 8 };
  const bothGravel = runDrive(0, 12);
  assert.equal(bothGravel.count, 0, 'both tyres on gravel over narrow grass strip draw zero strips');
  assert.equal(bothGravel.lawns, 0, 'both tyres on gravel over narrow grass strip file zero lawn damage');
  assert.deepEqual(bothGravel.hits, [], 'both tyres on gravel trigger no lawn damage callback');
  // Same narrow strip when outer kind-8 samples are past halfWidth + 0.6 (roadDist=10.7, halfWidth=10):
  // both wheelOnLawn and the strip clipper agree that grass past the gravel edge takes tracks AND counts lawn damage.
  sampleAt = (_x, z) => Math.abs(z - 12) <= 0.4
    ? lawn12
    : { ground: 0, canopy: 0, roadDist: 10.7, halfWidth: 10, kind: 8, level: 8 };
  const pastGravelEdge = runDrive(0, 12);
  assert.ok(pastGravelEdge.count > 0 && pastGravelEdge.lawns === 1, 'kind-8 past halfWidth + 0.6 draws tracks consistently with lawn damage');
  // Real Paved atlas: unloaded mapped lot tile blocks tracks & lawn damage until loaded, and a diagonal corner graze
  // against a real 2 m gravel lot cell is clipped using Paved.lotGrid()'s real world origin.
  {
    const tileBytes = new Uint8Array(128 * 128);
    // Tile 0_0 covers world x in [0.75, 256.75), z in [0.25, 256.25) with non-integer origin/village offsets.
    // Gravel cell (col=1, row=5) spans [2.75, 4.75) x [10.25, 12.25); asphalt strip at row=15, col=1..12.
    tileBytes[5 * 128 + 1] = 2;
    for (let col = 1; col <= 12; col++) tileBytes[15 * 128 + col] = 1;
    let releaseTile;
    const tileGate = new Promise((resolve) => { releaseTile = resolve; });
    const oldFetch = globalThis.fetch;
    globalThis.fetch = async () => { await tileGate; return new Response(tileBytes); };
    const realPaved = new Paved({
      version: 1, area: 'mabou', epsg: 2961, origin: [1000.75, 2000.25],
      tileMetres: 256, resolution: 2, side: 128, classes: { '1': 'asphalt', '2': 'gravel' }, tiles: ['0_0.r8'],
    }, 'paved-test', [1000, 2000.5]);
    try {
      const realLotTerrain = { heightAt: () => 0, surfaceAt: () => lawn12, paved: realPaved };
      const flush = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
      // Drive 16 steps across the asphalt strip while 0_0.r8 is still in flight: zero ruts, zero lawn damage, ditchMail.
      realPaved.update(10, 31);
      assert.equal(realPaved.lotClassAt(4, 31), -1, 'unloaded mapped tile reports pending (-1)');
      const pendingHits = [];
      const rPending = new Ruts(realLotTerrain, [{ id: 138, x: 1000, y: 2000.5, kind: 'house' }], [1000, 2000.5], true, (id) => pendingHits.push(id));
      for (let i = 0; i < 16; i++) rPending.update({ x: 3.5 + i * 0.75, z: 31, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, i + 1);
      assert.equal(rPending.count, 0, 'driving over unloaded mapped lot tile leaves no ruts');
      assert.equal(pendingHits.length, 0, 'driving over unloaded mapped lot tile triggers no lawn damage');
      // Mail on ordinary grass inside an unloaded mapped tile stays lawnMail before (-1) and after (0) the tile loads.
      assert.equal(realPaved.lotClassAt(2, 1), -1, 'mail throw coordinate (2, 1) is in unloaded mapped tile (-1)');
      const mPending = new Mail({ heightAt: () => 0, surfaceAt: () => ({ ground: 0, canopy: 0, roadDist: 3.4, halfWidth: 3, kind: 2, level: 8 }), paved: realPaved }, props, [{ id: 138, x: 1000, y: 2000.5, kind: 'house' }], [1000, 2000.5], true);
      let pendingGround = null;
      mPending.service = { condition: () => 'none', deliver: () => false, ground: (_x, _z, isLawn) => { pendingGround = isLawn; } };
      mPending.miss({ x: 2, z: 1 });
      assert.equal(pendingGround, true, 'mail on ordinary grass in unloaded mapped tile stays lawnMail before tile loads');
      // Resolve tile fetch: asphalt stays track-free, adjacent empty grass (row=20, z=41) takes tracks.
      releaseTile(); await flush();
      assert.equal(realPaved.lotClassAt(2, 1), 0, 'mail throw coordinate (2, 1) transitions to empty (0) after tile loads');
      mPending.miss({ x: 2, z: 1 });
      assert.equal(pendingGround, true, 'mail on ordinary grass stays lawnMail consistently after tile loads');
      const mAsphalt = new Mail(realLotTerrain, props, [{ id: 138, x: 1000, y: 2000.5, kind: 'house' }], [1000, 2000.5], true);
      let asphaltGround = null;
      mAsphalt.service = { condition: () => 'none', deliver: () => false, ground: (_x, _z, isLawn) => { asphaltGround = isLawn; } };
      mAsphalt.miss({ x: 4, z: 31 });
      assert.equal(asphaltGround, false, 'mail on loaded mapped asphalt lot counts as ditchMail');
      assert.equal(realPaved.lotClassAt(4, 31), 1, 'loaded asphalt cell reads class 1');
      assert.equal(realPaved.lotClassAt(4, 41), 0, 'loaded empty grass cell reads class 0');
      const loadedAsphalt = new Ruts(realLotTerrain, [{ id: 138, x: 1000, y: 2000.5, kind: 'house' }], [1000, 2000.5], true, () => {});
      for (let i = 0; i < 16; i++) loadedAsphalt.update({ x: 3.5 + i * 0.75, z: 31, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, i + 1);
      assert.equal(loadedAsphalt.count, 0, 'loaded asphalt strip leaves no ruts');
      const loadedGrass = new Ruts(realLotTerrain, [{ id: 138, x: 1000, y: 2000.5, kind: 'house' }], [1000, 2000.5], true, () => {});
      for (let i = 0; i < 10; i++) loadedGrass.update({ x: 3.5 + i * 0.75, z: 41, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, i + 1);
      assert.ok(loadedGrass.count > 0 && loadedGrass.lawns === 1, 'loaded empty cell in mapped tile leaves ruts');
      // Diagonal 0.8 m step whose left (-1) wheel grazes real gravel cell corner (4.75, 12.25) between 0.1 m point samples.
      const rCorner = new Ruts(realLotTerrain, [{ id: 1454, x: 1000, y: 2000.5, kind: 'house' }], [1000, 2000.5], true, () => {});
      const hdg = Math.PI / 4, ux = Math.sin(hdg), uz = -Math.cos(hdg);
      const rx = Math.cos(hdg), rz = Math.sin(hdg);
      const cornerX = 4.75, cornerZ = 12.25;
      const endX = cornerX + rx * (0.785 + 0.10) + ux * 0.25, endZ = cornerZ + rz * (0.785 + 0.10) + uz * 0.25;
      rCorner.update({ x: endX - ux * 0.8, z: endZ - uz * 0.8, vx: ux * 4, vz: uz * 4, heading: hdg, airborne: false }, 1);
      rCorner.update({ x: endX, z: endZ, vx: ux * 4, vz: uz * 4, heading: hdg, airborne: false }, 2);
      assert.equal(rCorner.count, 2, 'diagonal drive beside real 2 m gravel lot draws both lawn strips');
      const c = new THREE.Vector3();
      let clippedLotStrip = false;
      for (let i = 0; i < rCorner.count; i++) {
        rCorner.mesh.getMatrixAt(i, mat);
        const len = Math.hypot(mat.elements[8], mat.elements[9], mat.elements[10]);
        if (len < 0.85) clippedLotStrip = true;
        for (let s = 0; s <= 40; s++) for (const lx of [-0.12, -0.06, 0, 0.06, 0.12]) {
          c.set(lx, 0, -0.5 + s * 0.025).applyMatrix4(mat);
          assert.equal(realPaved.lotClassAt(c.x, c.z), 0, `strip ${i} point (${lx},${s}) stays outside real 2 m gravel lot cell`);
        }
      }
      assert.ok(clippedLotStrip, 'left strip was clipped before grazing real 2 m gravel lot corner');
      // Unloaded mapped tile diagonal corner graze BEFORE the first Paved.update() call:
      // tile 0_0 covers [4.75-256, 4.75) x [12.25-256, 12.25), so SE corner is (4.75, 12.25).
      const prePaved = new Paved({
        version: 1, area: 'mabou', epsg: 2961, origin: [1004.75 - 256, 2000.5 - (12.25 - 256)],
        tileMetres: 256, resolution: 2, side: 128, classes: { '1': 'asphalt', '2': 'gravel' }, tiles: ['0_0.r8'],
      }, 'paved-pre', [1000, 2000.5]);
      try {
        assert.equal(prePaved.lotClassAt(4.74, 12.24), -1, 'pre-update mapped tile cell is pending (-1)');
        assert.equal(prePaved.lotClassAt(4.76, 12.26), 0, 'outside pre-update mapped tile is empty (0)');
        const preTerrain = { heightAt: () => 0, surfaceAt: () => lawn12, paved: prePaved };
        const rPre = new Ruts(preTerrain, [{ id: 1454, x: 1000, y: 2000.5, kind: 'house' }], [1000, 2000.5], true, () => {});
        rPre.update({ x: endX - ux * 0.8, z: endZ - uz * 0.8, vx: ux * 4, vz: uz * 4, heading: hdg, airborne: false }, 1);
        rPre.update({ x: endX, z: endZ, vx: ux * 4, vz: uz * 4, heading: hdg, airborne: false }, 2);
        assert.equal(rPre.count, 2, 'diagonal drive beside pre-update mapped tile draws both strips');
        let clippedPre = false;
        for (let i = 0; i < rPre.count; i++) {
          rPre.mesh.getMatrixAt(i, mat);
          if (Math.hypot(mat.elements[8], mat.elements[9], mat.elements[10]) < 0.85) clippedPre = true;
          for (let s = 0; s <= 40; s++) for (const lx of [-0.12, -0.06, 0, 0.06, 0.12]) {
            c.set(lx, 0, -0.5 + s * 0.025).applyMatrix4(mat);
            assert.equal(prePaved.lotClassAt(c.x, c.z), 0, `pre-update strip ${i} point (${lx},${s}) stays outside unloaded mapped tile`);
          }
        }
        assert.ok(clippedPre, 'left strip was clipped before grazing pre-update unloaded mapped tile corner');
      } finally {
        prePaved.texture.dispose();
      }
    } finally {
      globalThis.fetch = oldFetch;
      realPaved.texture.dispose();
    }
  }
  // Signed bilinear road-shoulder crossing (level-6 kind-4 road with signed distances +12.7 at z=40 and -5.8 at z=44,
  // halfWidth=1.6, sloped ground 1.5x + 0.25z): pitched strips stay outside roadDist <= 2.2 m.
  {
    const signedTerrain = {
      manifest: { origin: [0, 0], village: [0, 0], size: 65536 },
      heightAt: (x, z) => 1.5 * x + 0.25 * z,
      surfaceAt: (_x, z) => {
        const iz = Math.floor(z / 4), v = (z - iz * 4) / 4;
        const d0 = iz === 10 ? 12.7 : -5.8, d1 = iz === 10 ? -5.8 : -5.8;
        const signed = d0 * (1 - v) + d1 * v;
        return { ground: 0, canopy: 0, roadDist: Math.abs(signed), roadSigned: signed, halfWidth: 1.6, kind: 4, level: 6 };
      },
    };
    const rRoad = new Ruts(signedTerrain, [{ id: 1454, x: 10, y: -44, kind: 'house' }], [0, 0], true, () => {});
    rRoad.update({ x: 10, z: 44.502, y: 15 + 0.25 * 44.502, vx: 0, vz: -4, heading: 0, airborne: false }, 1);
    rRoad.update({ x: 10, z: 43.702, y: 15 + 0.25 * 43.702, vx: 0, vz: -4, heading: 0, airborne: false }, 2);
    assert.ok(rRoad.count > 0, 'pitched drive approaching signed road shoulder still draws lawn strips');
    const c = new THREE.Vector3();
    for (let i = 0; i < rRoad.count; i++) {
      rRoad.mesh.getMatrixAt(i, mat);
      for (let s = 0; s <= 40; s++) for (const lx of [-0.12, -0.06, 0, 0.06, 0.12]) {
        c.set(lx, 0, -0.5 + s * 0.025).applyMatrix4(mat);
        const surf = signedTerrain.surfaceAt(c.x, c.z);
        assert.ok(surf.roadDist > surf.halfWidth + 0.6, `signed-shoulder strip ${i} point (${lx},${s}) stays outside 2.2 m shoulder (dist=${surf.roadDist.toFixed(4)})`);
      }
    }
  }
  // Terrain resolution boundary (L7 below z=256, L8 above z=256 with a 2.66 m canopy peak at L8 vertex (11, 257)):
  // strip from (10.15, 255.7) to (10.95, 255.7) uses the L8 grid above z=256 and never enters canopy >= 1.6 m.
  {
    const seamTerrain = {
      manifest: { origin: [0, 0], village: [0, 0], size: 65536 },
      heightAt: () => 0,
      surfaceAt: (x, z) => {
        if (z < 256) return { ground: 0, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 7 };
        const a = Math.floor(x), b = Math.floor(z), u = x - a, v = z - b;
        const val = (gx, gz) => (gx === 11 && gz === 257 ? 2.66 : 0);
        const canopy = (val(a, b) * (1 - u) + val(a + 1, b) * u) * (1 - v) + (val(a, b + 1) * (1 - u) + val(a + 1, b + 1) * u) * v;
        return { ground: 0, canopy, roadDist: 99, halfWidth: 0, kind: 0, level: 8 };
      },
    };
    const rSeam = new Ruts(seamTerrain, [{ id: 1454, x: 10, y: -256, kind: 'house' }], [0, 0], true, () => {});
    rSeam.update({ x: 10.15, z: 255.7, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 1);
    rSeam.update({ x: 10.95, z: 255.7, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 2);
    assert.ok(rSeam.count > 0, 'drive along L7/L8 seam still draws lawn strips');
    const c = new THREE.Vector3();
    for (let i = 0; i < rSeam.count; i++) {
      rSeam.mesh.getMatrixAt(i, mat);
      for (let s = 0; s <= 40; s++) for (const lx of [-0.12, -0.06, 0, 0.06, 0.12]) {
        c.set(lx, 0, -0.5 + s * 0.025).applyMatrix4(mat);
        const surf = seamTerrain.surfaceAt(c.x, c.z);
        assert.ok(surf.canopy < 1.6, `L7/L8 seam strip ${i} point (${lx},${s}) stays below 1.6 m canopy (canopy=${surf.canopy.toFixed(4)})`);
      }
    }
  }
  // L7/L8 gravel seam (L7 lawn below z=256, L8 lawn in [256, 256.5), L8 kind-8 gravel at z>=256.5):
  // driving (10.15, 255.5) -> (10.95, 255.5) keeps both strips (centre-level-only L7 sub-cells drop the right strip).
  {
    const gravelSeamTerrain = {
      manifest: { origin: [0, 0], village: [0, 0], size: 65536 },
      heightAt: () => 0,
      surfaceAt: (_x, z) => {
        if (z < 256) return { ground: 0, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 7 };
        if (z < 256.5) return { ground: 0, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8 };
        return { ground: 0, canopy: 0, roadDist: 8, halfWidth: 10, kind: 8, level: 8 };
      },
    };
    const rGravelSeam = new Ruts(gravelSeamTerrain, [{ id: 1454, x: 10, y: -256, kind: 'house' }], [0, 0], true, () => {});
    rGravelSeam.update({ x: 10.15, z: 255.5, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 1);
    rGravelSeam.update({ x: 10.95, z: 255.5, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 2);
    assert.equal(rGravelSeam.count, 2, 'L7/L8 gravel seam draws both strips instead of over-clipping on L7 sub-cells');
    const c = new THREE.Vector3();
    for (let i = 0; i < rGravelSeam.count; i++) {
      rGravelSeam.mesh.getMatrixAt(i, mat);
      for (let s = 0; s <= 40; s++) for (const lx of [-0.12, -0.06, 0, 0.06, 0.12]) {
        c.set(lx, 0, -0.5 + s * 0.025).applyMatrix4(mat);
        assert.notEqual(gravelSeamTerrain.surfaceAt(c.x, c.z).kind, 8, `L7/L8 gravel seam strip ${i} stays off gravel`);
      }
    }
  }
  // Shoreline clipping: straight shore at z=5.95 keeps the dry strip stopping at z=5.905, while a triangular water tip
  // at (5.14, 5.9) clips the strip cleanly off (5.14, 5.903).
  {
    const makeWaterTerrain = (isWet) => ({
      manifest: { origin: [0, 0], village: [0, 0], size: 65536 },
      heightAt: () => 0,
      surfaceAt: (x, z) => ({ ground: 0, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, water: isWet(x, z), level: 8 }),
    });
    const straightShore = makeWaterTerrain((_x, z) => z >= 5.95);
    let shoreCalls = 0;
    const countedShore = { ...straightShore, surfaceAt: (x, z) => { shoreCalls++; return straightShore.surfaceAt(x, z); } };
    const rDry = new Ruts(countedShore, [{ id: 1454, x: 10, y: -5, kind: 'house' }], [0, 0], true, () => {});
    for (let i = 0; i < 24; i++) rDry.update({ x: 4.6 + i * 0.8, z: 5, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, i + 1);
    assert.equal(rDry.count, 46, 'dry 24-step drive beside straight shore at z=5.95 keeps all 46 strips');
    assert.ok(shoreCalls < 20000, `dry 24-step drive beside straight shore avoids dense scan (${shoreCalls} < 20000)`);
    // Connected inlets from bank (80 mm, 18 mm, steep diagonal 12 mm, tapered 12 mm rendered / 8 mm padded, and mirrored diagonal wet-edge budgets).
    const mirroredBandPred = (x, z) => {
      const q = 5.813 + 0.644 * (x - 5.565);
      return z >= 6.015 || z <= 3.985 || (x >= 5.565 && (Math.abs(z - q) <= 0.009 || Math.abs(10 - z - q) <= 0.009));
    };
    for (const [label, pred, maxLen, maxCalls, withSite, wetCheckPts] of [
      ['80 mm', (x, z) => z >= 6.01 || (z >= 5.84 && Math.abs(x - 5.65) <= 0.04), 0.90, 4000, false, []],
      ['18 mm', (x, z) => z >= 6.01 || (z >= 5.84 && Math.abs(x - 5.65) <= 0.009), 0.90, 4000, false, []],
      ['18 mm near front', (x, z) => z >= 6.01 || (z >= 5.84 && Math.abs(x - 5.82) <= 0.009), 0.92, 4000, false, []],
      ['steep diagonal inlet', (x, z) => z >= 6.01 || (x >= 5.588 && Math.abs(z - (5.822 + 1.5 * (x - 5.588))) <= 0.009), 0.80, 4000, false, []],
      ['tapered inlet', (x, z) => z >= 6.015 || (z >= 5.855 && Math.abs(x - (5.61343229 + 0.4 * (z - 5.9065))) <= Math.max(0.004, Math.min(0.009, 0.006 - (z - 5.905) * 4 / 3))), 0.80, 4000, false, [[5.61343, 5.88500], [5.5839, 5.8551]]],
      ['mirrored diagonal wet edge', (x, z) => x >= 5.93 || (x >= 5.772 && (Math.abs(z - (5.866 + x - 5.772)) <= 0.009 || Math.abs((10 - z) - (5.866 + x - 5.772)) <= 0.009)), 0.90, 4000, false, []],
      ['mirrored diagonal band (no site)', mirroredBandPred, 0.70, 4000, false, []],
      ['mirrored diagonal band (site)', mirroredBandPred, 0.70, 4000, true, []],
    ]) {
      let wetCalls = 0, waterSiteCalls = 0;
      const farBankInlet = makeWaterTerrain(pred);
      const site = withSite ? { box: [0, 0, 100, 100], waterLevel: (x, z) => { waterSiteCalls++; return pred(x, z) ? 0 : null; } } : null;
      const countedInlet = {
        ...farBankInlet,
        surfaceAt: (x, z) => {
          wetCalls++;
          return site
            ? { ground: 0, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, water: site.waterLevel(x, z) !== null, level: 8 }
            : farBankInlet.surfaceAt(x, z);
        },
        ...(site ? { sites: [site] } : {}),
      };
      const rFarInlet = new Ruts(countedInlet, [{ id: 1454, x: 5, y: -5, kind: 'house' }], [0, 0], true, () => {});
      rFarInlet.update({ x: 4.6, z: 5, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 1);
      rFarInlet.update({ x: 5.4, z: 5, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 2);
      assert.equal(rFarInlet.count, 2, `${label} connected inlet still draws both strips after clipping`);
      assert.ok(wetCalls < maxCalls, `${label} wet-edge refinement stays fast (${wetCalls} < ${maxCalls} calls)`);
      if (withSite) assert.ok(waterSiteCalls > 0 && waterSiteCalls < maxCalls, `${label} waterLevel queries exercised and fast (${waterSiteCalls} in (0, ${maxCalls}))`);
      let farInletLen = Infinity;
      const invMat = new THREE.Matrix4();
      for (let i = 0; i < rFarInlet.count; i++) {
        rFarInlet.mesh.getMatrixAt(i, mat);
        const len = Math.hypot(mat.elements[8], mat.elements[9], mat.elements[10]);
        if (len < farInletLen) farInletLen = len;
        for (const wetCheckPt of wetCheckPts) {
          invMat.copy(mat).invert();
          const lp = new THREE.Vector3(wetCheckPt[0], 0.045, wetCheckPt[1]).applyMatrix4(invMat);
          assert.ok(Math.abs(lp.x) > 0.12 || Math.abs(lp.z) > 0.5, `${label} strip ${i} does not contain wet point (${wetCheckPt[0]}, ${wetCheckPt[1]})`);
        }
        for (let s = 0; s <= 40; s++) for (const lx of [-0.12, -0.06, 0, 0.06, 0.12]) {
          const pt = new THREE.Vector3(lx, 0, -0.5 + s * 0.025).applyMatrix4(mat);
          assert.equal(farBankInlet.surfaceAt(pt.x, pt.z).water, false, `${label} strip ${i} point (${lx},${s}) stays dry`);
        }
      }
      assert.ok(farInletLen < maxLen, `${label} trimmed the affected strip (got ${farInletLen.toFixed(3)} m)`);
    }
    // Disconnected 5 cm radius water patch entirely inside the strip at (5.65, 5.82): caught by the coarse interior lines.
    const innerPatch = makeWaterTerrain((x, z) => Math.hypot(x - 5.65, z - 5.82) <= 0.05);
    const rInnerPatch = new Ruts(innerPatch, [{ id: 1454, x: 5, y: -5, kind: 'house' }], [0, 0], true, () => {});
    rInnerPatch.update({ x: 4.6, z: 5, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 1);
    rInnerPatch.update({ x: 5.4, z: 5, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 2);
    assert.equal(rInnerPatch.count, 2, '5 cm radius interior water patch still draws both strips after clipping');
    let innerPatchLen = Infinity;
    for (let i = 0; i < rInnerPatch.count; i++) {
      rInnerPatch.mesh.getMatrixAt(i, mat);
      const len = Math.hypot(mat.elements[8], mat.elements[9], mat.elements[10]);
      if (len < innerPatchLen) innerPatchLen = len;
      for (let s = 0; s <= 40; s++) for (const lx of [-0.12, -0.06, 0, 0.06, 0.12]) {
        const pt = new THREE.Vector3(lx, 0, -0.5 + s * 0.025).applyMatrix4(mat);
        assert.equal(innerPatch.surfaceAt(pt.x, pt.z).water, false, `5 cm interior water strip ${i} point (${lx},${s}) stays dry`);
      }
    }
    assert.ok(innerPatchLen < 0.72, `5 cm interior water patch trimmed the affected strip (got ${innerPatchLen.toFixed(3)} m)`);
    const tipWater = makeWaterTerrain((x, z) => z >= 5.9 && Math.abs(x - 5.14) <= (z - 5.9) * 2);
    const rTip = new Ruts(tipWater, [{ id: 1454, x: 5, y: -5, kind: 'house' }], [0, 0], true, () => {});
    rTip.update({ x: 4.6, z: 5, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 1);
    rTip.update({ x: 5.4, z: 5, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 2);
    assert.equal(rTip.count, 2, 'triangular water tip keeps both strips after clipping');
    const c = new THREE.Vector3();
    let clippedWet = false;
    for (let i = 0; i < rTip.count; i++) {
      rTip.mesh.getMatrixAt(i, mat);
      if (Math.hypot(mat.elements[8], mat.elements[9], mat.elements[10]) < 0.85) clippedWet = true;
      for (let s = 0; s <= 40; s++) for (const lx of [-0.12, -0.06, 0, 0.06, 0.12]) {
        c.set(lx, 0, -0.5 + s * 0.025).applyMatrix4(mat);
        assert.equal(tipWater.surfaceAt(c.x, c.z).water, false, `water-tip strip ${i} point (${lx},${s}) stays dry`);
      }
    }
    assert.ok(clippedWet, 'strip beside triangular water tip was clipped clear of (5.14, 5.903)');
    // Narrow water inlet off a shoreline (z>=5.95 lake body) entering the short front edge at (5.875, 5.815): clipped clear.
    const inletWater = makeWaterTerrain((x, z) => z >= 5.95 || (x >= 5.82 && Math.abs(z - 5.815) <= (x - 5.82) * 0.35));
    const rInlet = new Ruts(inletWater, [{ id: 1454, x: 5, y: -5, kind: 'house' }], [0, 0], true, () => {});
    rInlet.update({ x: 4.6, z: 5, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 1);
    rInlet.update({ x: 5.4, z: 5, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 2);
    assert.equal(rInlet.count, 2, 'short-edge water inlet still draws both clipped strips');
    let clippedInlet = false;
    for (let i = 0; i < rInlet.count; i++) {
      rInlet.mesh.getMatrixAt(i, mat);
      if (Math.hypot(mat.elements[8], mat.elements[9], mat.elements[10]) < 0.92) clippedInlet = true;
      for (let s = 0; s <= 40; s++) for (const lx of [-0.12, -0.06, 0, 0.03, 0.06, 0.12]) {
        c.set(lx, 0, -0.5 + s * 0.025).applyMatrix4(mat);
        assert.equal(inletWater.surfaceAt(c.x, c.z).water, false, `water-inlet strip ${i} point (${lx},${s}) stays dry`);
      }
    }
    assert.ok(clippedInlet, 'strip was clipped clear of short-edge water inlet at (5.875, 5.815)');
    // Concrete deck (kind=9, deck=true) starting at z=5.73 covers sub-cell midpoint z=5.75, yet never rejects the whole
    // sub-cell for a dry strip ending at z=5.705 (drive along z=4.8).
    const deckEdge = {
      manifest: { origin: [0, 0], village: [0, 0], size: 65536 },
      heightAt: () => 0,
      surfaceAt: (_x, z) => z >= 5.73
        ? { ground: 0, canopy: 0, roadDist: 0, roadSigned: 0, halfWidth: 3, kind: 9, deck: true, level: 8 }
        : { ground: 0, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8 },
    };
    const rDeckDry = new Ruts(deckEdge, [{ id: 1454, x: 5, y: -5, kind: 'house' }], [0, 0], true, () => {});
    rDeckDry.update({ x: 4.6, z: 4.8, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 1);
    rDeckDry.update({ x: 5.4, z: 4.8, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 2);
    assert.equal(rDeckDry.count, 2, 'dry strip ending at z=5.705 is not removed by kind-9 concrete deck covering sub-cell midpoint z=5.75');
    // Bilinear kind-8 gravel shoulder on a 1 m L8 grid: midpoint z=5.75 has roadDist=10.575 (<=10.6), but the strip starts
    // at z=5.785 where roadDist=10.6485 (>10.6) -> both strips stay intact (no coarse whole-sub-cell rejection).
    const gravelShoulder = {
      manifest: { origin: [0, 0], village: [0, 0], size: 65536 },
      heightAt: () => 0,
      surfaceAt: (_x, z) => {
        if (z < 5.5) return { ground: 0, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8 };
        const signed = 10.575 + (z - 5.75) * 2.1;
        return { ground: 0, canopy: 0, roadDist: Math.abs(signed), roadSigned: signed, halfWidth: 10, kind: 8, level: 8 };
      },
    };
    const rShoulder = new Ruts(gravelShoulder, [{ id: 1454, x: 5, y: -5, kind: 'house' }], [0, 0], true, () => {});
    rShoulder.update({ x: 4.6, z: 5.12, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 1);
    rShoulder.update({ x: 5.4, z: 5.12, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 2);
    assert.equal(rShoulder.count, 2, 'bilinear kind-8 shoulder with roadDist>10.6 across strip keeps both strips');
    // Diagonal narrow water inlet off a shoreline (z>=5.95): trims cleanly to the ~0.63 m dry track.
    const diagInlet = makeWaterTerrain((x, z) => z >= 5.95 || (x >= 5.56 && Math.abs(z - (5.865 + 0.16 * (x - 5.875))) <= 0.003));
    const rDiag = new Ruts(diagInlet, [{ id: 1454, x: 5, y: -5, kind: 'house' }], [0, 0], true, () => {});
    rDiag.update({ x: 4.6, z: 5, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 1);
    rDiag.update({ x: 5.4, z: 5, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 2);
    assert.equal(rDiag.count, 2, 'diagonal water inlet preserves the usable dry portion of the affected strip');
    let diagLen = Infinity;
    for (let i = 0; i < rDiag.count; i++) {
      rDiag.mesh.getMatrixAt(i, mat);
      const len = Math.hypot(mat.elements[8], mat.elements[9], mat.elements[10]);
      if (len < diagLen) diagLen = len;
      for (let s = 0; s <= 40; s++) for (const lx of [-0.12, -0.06, 0, 0.06, 0.12]) {
        c.set(lx, 0, -0.5 + s * 0.025).applyMatrix4(mat);
        assert.equal(diagInlet.surfaceAt(c.x, c.z).water, false, `diagonal-inlet strip ${i} point (${lx},${s}) stays dry`);
      }
    }
    assert.ok(diagLen >= 0.55 && diagLen < 0.70, `diagonal-inlet strip trimmed to usable ~0.63 m track (got ${diagLen.toFixed(3)} m)`);
    // Shoreline-connected 4 cm water finger (connected to z>=5.95 bank): detected by perimeter gate and clipped clear.
    const interiorWater = makeWaterTerrain((x, z) => z >= 5.95 || (z >= 5.825 && Math.abs(x - 5.6) <= 0.02));
    const rInterior = new Ruts(interiorWater, [{ id: 1454, x: 5, y: -5, kind: 'house' }], [0, 0], true, () => {});
    rInterior.update({ x: 4.6, z: 5, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 1);
    rInterior.update({ x: 5.4, z: 5, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 2);
    assert.equal(rInterior.count, 2, '4 cm shoreline finger keeps both strips after clipping');
    let interiorClipped = false;
    for (let i = 0; i < rInterior.count; i++) {
      rInterior.mesh.getMatrixAt(i, mat);
      if (Math.hypot(mat.elements[8], mat.elements[9], mat.elements[10]) < 0.75) interiorClipped = true;
      for (let s = 0; s <= 40; s++) for (const lx of [-0.12, -0.06, 0, 0.06, 0.12]) {
        c.set(lx, 0, -0.5 + s * 0.025).applyMatrix4(mat);
        assert.equal(interiorWater.surfaceAt(c.x, c.z).water, false, `4 cm finger strip ${i} point (${lx},${s}) stays dry`);
      }
    }
    assert.ok(interiorClipped, 'strip was clipped clear of 4 cm shoreline finger at x=5.6');
    // Two shoreline fingers straddling along=0 at x=5.2 and x=5.6: trimming each half independently preserves the ~0.35 m dry middle.
    const bothSidesWater = makeWaterTerrain((x, z) => z >= 5.95 || (z >= 5.825 && (Math.abs(x - 5.2) <= 0.02 || Math.abs(x - 5.6) <= 0.02)));
    const rBothSides = new Ruts(bothSidesWater, [{ id: 1454, x: 5, y: -5, kind: 'house' }], [0, 0], true, () => {});
    rBothSides.update({ x: 4.6, z: 5, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 1);
    rBothSides.update({ x: 5.4, z: 5, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 2);
    assert.equal(rBothSides.count, 2, 'water patches on both sides of wheel preserve the dry middle strip');
    let midLen = Infinity;
    for (let i = 0; i < rBothSides.count; i++) {
      rBothSides.mesh.getMatrixAt(i, mat);
      const len = Math.hypot(mat.elements[8], mat.elements[9], mat.elements[10]);
      if (len < midLen) midLen = len;
      for (let s = 0; s <= 40; s++) for (const lx of [-0.12, -0.06, 0, 0.06, 0.12]) {
        c.set(lx, 0, -0.5 + s * 0.025).applyMatrix4(mat);
        assert.equal(bothSidesWater.surfaceAt(c.x, c.z).water, false, `straddled-water strip ${i} point (${lx},${s}) stays dry`);
      }
    }
    assert.ok(midLen >= 0.30 && midLen <= 0.40, `straddled-water strip keeps ~0.35 m dry middle (got ${midLen.toFixed(3)} m)`);
    // Rolled dry strip on side-slope height = z / 2 beside a kind-9 deck at z >= 5.9: rolled footprint ends at z = 5.8923,
    // so both strips draw rather than being rejected by a flat +-0.12 m probe at z = 5.905.
    const rolledDeck = {
      manifest: { origin: [0, 0], village: [0, 0], size: 65536 },
      heightAt: (_x, z) => z / 2,
      surfaceAt: (_x, z) => z >= 5.9
        ? { ground: z / 2, canopy: 0, roadDist: 0, roadSigned: 0, halfWidth: 3, kind: 9, deck: true, level: 8 }
        : { ground: z / 2, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8 },
    };
    const rRolled = new Ruts(rolledDeck, [{ id: 1454, x: 5, y: -5, kind: 'house' }], [0, 0], true, () => {});
    rRolled.update({ x: 4.6, z: 5, y: 2.5, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 1);
    rRolled.update({ x: 5.4, z: 5, y: 2.5, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 2);
    assert.equal(rRolled.count, 2, 'rolled dry strip ending at z=5.8923 is not rejected by kind-9 deck at z>=5.9');
    for (let i = 0; i < rRolled.count; i++) {
      rRolled.mesh.getMatrixAt(i, mat);
      for (let s = 0; s <= 40; s++) for (const lx of [-0.12, -0.06, 0, 0.06, 0.12]) {
        c.set(lx, 0, -0.5 + s * 0.025).applyMatrix4(mat);
        assert.ok(c.z < 5.9, `rolled-deck strip ${i} point (${lx},${s}) stays off deck (z=${c.z.toFixed(4)})`);
      }
    }
  }
  // Ordinary off-road grass keeps Ruts's exact 35 m reach (<=) and preserves Mail.miss's existing 40 m range;
  // kind-12 mown lawns reach exact 60 m for both Ruts and Mail.miss.
  const tangentDrive = (dist) => {
    const r = new Ruts(yardTerrain, [{ id: 1454, x: 0, y: 0, kind: 'house' }], [0, 0], true, () => {});
    // Two steps ending at exact (dist, 0) (step 0 seeds oldX/oldZ; step 1 travels 0.8 m along +x to x=dist).
    r.update({ x: dist - 0.8, z: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 1);
    r.update({ x: dist, z: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false }, 2);
    return r.count;
  };
  sampleAt = () => ({ ground: 0, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8 });
  assert.ok(runDrive(0, 12).count > 0, 'ordinary grass within 35 m leaves ruts');
  assert.equal(checkMail(0, 12), true, 'mail on ordinary grass within 35 m counts as lawnMail');
  assert.ok(tangentDrive(35) > 0, 'ordinary grass at exact 35 m leaves ruts');
  assert.equal(checkMail(35, 0), true, 'mail on ordinary grass at exact 35 m counts as lawnMail');
  assert.equal(tangentDrive(35.1), 0, 'ordinary grass at 35.1 m leaves no ruts');
  assert.equal(checkMail(38, 0), true, 'mail on ordinary grass at 38 m preserves existing 40 m lawnMail range');
  assert.equal(checkMail(40, 0), true, 'mail on ordinary grass at exact 40 m counts as lawnMail');
  assert.equal(checkMail(40.1, 0), false, 'mail on ordinary grass at 40.1 m counts as ditchMail');
  sampleAt = () => lawn12;
  assert.ok(tangentDrive(60) > 0, 'kind-12 mown grass at exact 60 m leaves ruts');
  assert.equal(checkMail(60, 0), true, 'mail on kind-12 mown grass at exact 60 m agrees with ruts (lawnMail)');
  assert.equal(tangentDrive(60.1), 0, 'kind-12 mown grass at 60.1 m leaves no ruts');
  assert.equal(checkMail(60.1, 0), false, 'mail on kind-12 mown grass at 60.1 m agrees with ruts (ditchMail)');
  sampleAt = () => null;
  assert.equal(runDrive(0, 12).count, 0, 'missing terrain sample leaves no ruts');
  assert.equal(checkMail(0, 12), true, 'missing terrain sample preserves Mail.miss lawnMail fallback');
  // Parked, airborne, and out-of-house-range updates must not sample wheel terrain heights or surfaces.
  {
    let sCalls = 0, hCalls = 0;
    const countTerrain = {
      heightAt: () => { hCalls++; return 0; },
      surfaceAt: () => { sCalls++; return { ground: 0, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8 }; },
    };
    for (const [label, step] of [
      ['parked', (i) => ({ x: 5, z: 5, y: 0, vx: 0, vz: 0, heading: 0, airborne: false })],
      ['airborne', (i) => ({ x: 5 + (i % 2) * 0.2, z: 5, y: 2, vx: 4, vz: 0, heading: Math.PI / 2, airborne: true })],
      ['out-of-range', (i) => ({ x: 200 + (i % 2) * 0.2, z: 200, y: 0, vx: 4, vz: 0, heading: Math.PI / 2, airborne: false })],
    ]) {
      sCalls = 0; hCalls = 0;
      const rIdle = new Ruts(countTerrain, [{ id: 1454, x: 0, y: 0, kind: 'house' }], [0, 0], true, () => {});
      for (let i = 0; i < 1000; i++) rIdle.update(step(i), i + 1);
      assert.equal(sCalls, 1000, `${label} vehicle makes only centre surfaceAt call (${sCalls})`);
      assert.equal(hCalls, 0, `${label} vehicle makes zero wheel heightAt calls (${hCalls})`);
    }
  }
  // Road-edge margins: Ruts keeps 0.6 m while Mail.miss preserves its existing 0.3 m margin for ordinary roadside grass.
  sampleAt = () => ({ ground: 0, canopy: 0, roadDist: 3.2, halfWidth: 3, kind: 2, level: 8 });
  assert.equal(runDrive(0, 12).count, 0, 'road shoulder inside 0.3 m leaves no ruts');
  assert.equal(checkMail(0, 12), false, 'mail inside 0.3 m road margin counts as ditchMail');
  sampleAt = () => ({ ground: 0, canopy: 0, roadDist: 3.4, halfWidth: 3, kind: 2, level: 8 });
  assert.equal(runDrive(0, 12).count, 0, 'road shoulder inside 0.6 m margin leaves no ruts');
  assert.equal(checkMail(0, 12), true, 'mail at 3.4 m from 3 m road preserves existing 0.3 m lawnMail margin');
  sampleAt = () => ({ ground: 0, canopy: 0, roadDist: 3.7, halfWidth: 3, kind: 2, level: 8 });
  assert.ok(runDrive(0, 12).count > 0, 'grass past 0.6 m road margin leaves ruts');
  assert.equal(checkMail(0, 12), true, 'mail past 0.6 m road margin counts as lawnMail');
  for (const [label, s, cls = 0] of [
    ['highway', { ground: 0, canopy: 0, roadDist: 0, halfWidth: 3.5, kind: 1, level: 8 }],
    ['paved road', { ground: 0, canopy: 0, roadDist: 0, halfWidth: 3, kind: 2, level: 8 }],
    ['gravel road', { ground: 0, canopy: 0, roadDist: 0, halfWidth: 2.6, kind: 3, level: 8 }],
    ['gravel track', { ground: 0, canopy: 0, roadDist: 0, halfWidth: 1.6, kind: 4, gravel: true, level: 8 }],
    ['rail trail', { ground: 0, canopy: 0, roadDist: 0, halfWidth: 2, kind: 5, level: 8 }],
    ['yard gravel driveway', { ground: 0, canopy: 0, roadDist: 8, halfWidth: 10, kind: 8, level: 8 }],
    ['concrete apron', { ground: 0, canopy: 0, roadDist: 8, halfWidth: 10, kind: 9, level: 8 }],
    ['packed sand pad', { ground: 0, canopy: 0, roadDist: 8, halfWidth: 10, kind: 10, level: 8 }],
    ['airport runway', { ground: 0, canopy: 0, roadDist: 0, halfWidth: 2, kind: 13, level: 8 }],
    ['Maritime Inn paved lot', { ground: 0, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, lotAsphalt: true, level: 8 }],
    ['kind-12 overlapping lotAsphalt', { ground: 0, canopy: 0, roadDist: 6.5, halfWidth: 10, kind: 12, lotAsphalt: true, level: 8 }],
    ['mapped asphalt lot', { ground: 0, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8 }, 1],
    ['kind-12 overlapping mapped asphalt lot', { ground: 0, canopy: 0, roadDist: 6.5, halfWidth: 10, kind: 12, level: 8 }, 1],
    ['mapped gravel lot', { ground: 0, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8 }, 2],
    ['kind-12 overlapping mapped gravel lot', { ground: 0, canopy: 0, roadDist: 6.5, halfWidth: 10, kind: 12, level: 8 }, 2],
    ['bridge deck', { ground: 0, canopy: 0, roadDist: 99, halfWidth: 0, kind: 12, deck: true, level: 8 }],
    ['inland water', { ground: 0, canopy: 0, roadDist: 99, halfWidth: 0, kind: 12, water: true, level: 8 }],
    ['quarry mineral', { ground: 0, canopy: 0, roadDist: 99, halfWidth: 0, kind: 12, mineral: true, level: 8 }],
  ]) {
    sampleAt = () => s; lotClass = cls;
    const res = runDrive(0, 12);
    assert.equal(res.count, 0, `${label} leaves no tyre tracks`);
    assert.equal(res.lawns, 0, `${label} triggers no lawn damage`);
    assert.equal(checkMail(0, 12), false, `${label} counts as ditchMail, agreeing with Ruts`);
  }
  // Tree canopy on lawn and coarse L5 terrain: Ruts leaves no tracks, while Mail.miss preserves existing lawnMail scoring.
  sampleAt = () => ({ ground: 0, canopy: 2, roadDist: 99, halfWidth: 0, kind: 0, level: 8 }); lotClass = 0;
  assert.equal(runDrive(0, 10).count, 0, 'dense tree canopy leaves no tyre tracks');
  assert.equal(checkMail(0, 10), true, 'ordinary grass under tree canopy preserves existing lawnMail scoring');
  sampleAt = () => ({ ground: 0, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 5 }); lotClass = 0;
  assert.equal(runDrive(0, 12).count, 0, 'coarse level-5 terrain leaves no tyre tracks');
  assert.equal(checkMail(0, 12), true, 'coarse level-5 ordinary grass preserves existing lawnMail scoring');
}
// A subject can leave or change after the shutter. The stored photo remains unchanged.
const evidence = new Evidence(), camera = new THREE.PerspectiveCamera(58,1,.1,100);
camera.position.set(0,2,0); camera.lookAt(0,1,-20); camera.updateProjectionMatrix();
const s = evidence.register({ id:'future-obstacle', kind:'obstacle', x:0,z:-20,y:1,radius:2,active:true,blocking:true,road:7,label:'Road blocked' });
assert.equal(evidence.register({id:'simple',kind:'vehicle',x:200,z:200,radius:2}).active,true);
const photo=evidence.take(10,0,0,0,camera); assert.equal(photo.facts.length,1); s.x=300; s.blocking=false; assert.equal(photo.facts[0].x,0); assert.equal(photo.facts[0].blocking,true);
// Exercise the physical mail hook too: rejection bounces, lands, and attributes ground mail.
const realMail = new Mail(terrain, props, [], [0,0], true);
let groundTarget = -1;
realMail.service = { condition: () => 'stuffed', deliver: () => { throw Error('stuffed box must reject'); }, ground: (x,z) => { groundTarget=props.nearestMailbox(x,z,100)?.index ?? -1; } };
const parcel = { x:box.x,z:box.z,vx:4,vz:2,vy:-1,kind:0,rejected:false };
assert.equal(realMail.receive(parcel,stuffed),false); assert.equal(parcel.rejected,true); assert.ok(parcel.vx<0); assert.ok(parcel.vy>0);
realMail.miss(parcel); assert.equal(realMail.ditch,1); assert.equal(groundTarget,stuffed);
realMail.reset(); assert.equal(realMail.ditch,0);
console.log('PASS: real Shift/Props hooks, piece completion, four-second cleaning/reset, clock, report pause, next day, double mail/pay, day-one reset, denied storage, extensible photo snapshots.');

// Reproduce the instant-end failure using the actual road network and controller.
const makeShift=(query)=>{
  const p=new Props(propsData,village,bakedTerrain), m=new Mail(bakedTerrain,p,[],village,true);
  return {p,m,s:new Shift(p,m,bakedRoads,bakedTerrain,[],village,true,new URLSearchParams(query),()=>{})};
};
const instant=makeShift('day=1');instant.s.end();
assert.equal(instant.s.complaints.all.filter(c=>c.kind==='missing').length,3);
assert.equal(instant.s.complaints.all.length,3,'unvisited maintenance and off-run traps do not call');
assert.match(document.getElementById('reportMissed').textContent,/Stops missed: 35 · carried over to tomorrow/);
const carry=instant.s.remaining.slice();document.getElementById('nextDay').click();
assert.equal(instant.s.career.day,3);assert.equal(instant.s.career.double,true);
assert.deepEqual(instant.s.career.carryover,carry);
assert.ok(instant.s.run.rural.every(i=>instant.s.route.runs[2].rural.includes(i)));
// Exercise the real throw, landing and Shift service for every pre-existing down stop.
function physicalDownDrop(p,m,s,index){
  const target=p.mail[index],h=(target.heading-270)*Math.PI/180,eye=new THREE.Object3D();
  const v={x:0,z:0,vx:Math.sin(h)*20/3.6,vz:-Math.cos(h)*20/3.6,heading:h,speed:20/3.6,car:{driverEye:eye},spec:CAR_SPEC};
  const pose=ahead=>{v.x=target.x-Math.cos(h)*2.9-Math.sin(h)*ahead;v.z=target.z-Math.sin(h)*2.9+Math.cos(h)*ahead;
    eye.position.set(v.x+Math.cos(h)*.43+Math.sin(h)*.08,1.36,v.z+Math.sin(h)*.43-Math.cos(h)*.08);eye.updateMatrixWorld();};
  const before=s.remaining[index],misses=m.lawn+m.ditch;
  let found=false;
  for(let ahead=30;ahead>=0;ahead-=.1){pose(ahead);m.prepareThrow(v,MAIL_CYCLE[m.thrown%MAIL_CYCLE.length]);if(m.cue&&m.cueIndex===index){found=true;break;}}
  assert.ok(found,'real pre-existing stop has a physical drop pose on day '+s.career.day+' target '+index);
  const piece=m.cursor;m.update(1/120,v,true);
  for(let frame=0;frame<480&&m.pieces[piece].state==='flying';frame++)m.update(1/120,v,false);
  assert.equal(s.remaining[index],before-1,'physical ground drop reduces real Shift.remaining');
  assert.equal(m.lawn+m.ditch,misses,'authorised drop does not count as a miss');
}
// Clean all runs over three cycles, including flyer/light days and doubled days.
for(let day=1;day<=24;day++){
  const {p,m,s}=makeShift(`day=${day}${day%3===0?'&double=1':''}`);
  for(let i=0;i<s.today.pieces.length;i++)if(!s.route.members.has(i))assert.equal(m.service.condition(i),'none');
  for(const i of s.run.rural.filter(i=>s.today.stuffed[i])){
    const box=p.mail[i];s.update(4.01,{x:box.x,z:box.z,vx:0,vz:0,heading:0,airborne:false});
    assert.equal(s.today.stuffed[i],false);
  }
  for(const i of s.run.rural.filter(i=>s.today.down[i])){
    const box=p.mail[i],v={x:box.x,z:box.z+3,vx:0,vz:0,heading:0,airborne:false};s.update(.7,v);
    const cam=new THREE.PerspectiveCamera(58,1,.1,100);cam.position.set(v.x,2,v.z);cam.lookAt(box.x,.25,box.z);cam.updateProjectionMatrix();
    assert.equal(s.takePhoto(v,cam),true);assert.ok(s.evidence.photos.at(-1).facts.some(f=>f.kind==='preExisting' && f.target===i));
  }
  for(const stop of s.run.stops){
    const i=stop.index,box=i<p.mail.length?p.mail[i]:p.sites[i-p.mail.length];
    s.update(.01,{x:box.x,z:box.z+2,vx:0,vz:0,heading:0,airborne:false});
    if(i<p.mail.length && s.today.down[i]){
      assert.equal(p.mailHit(box.x,1,box.z,box.x,0,box.z,true,undefined,()=> 'ground'),i,'pre-existing post accepts the service-authorised ground drop');
      while(s.remaining[i]>0)physicalDownDrop(p,m,s,i);
    }
    while(s.remaining[i]>0){
      const piece={x:box.x,z:box.z,vx:0,vz:0,vy:0,kind:0,rejected:false,originX:box.x-20,originZ:box.z};
      assert.equal(m.receive(piece,i),true,`day ${day} target ${i} must accept physical mail`);
    }
  }
  assert.equal(s.done,s.stops);s.end();
  assert.equal(document.getElementById('reportVerdict').textContent,'No action taken.',`clean day ${day}`);
  assert.equal(s.complaints.all.some(c=>c.kind==='late'),s.run.rural.includes(s.route.late));
  if(s.run.rural.includes(s.route.late))assert.ok(document.getElementById('reportCalls').children.some(row=>row.children.some(el=>el.textContent==='UPHELD · No defence accepted.')));
}
// A pass within 60m, not an unseen property across the map, triggers maintenance calls.
const passed=makeShift('day=1');
const stuffedTarget=passed.s.today.stuffed.findIndex(Boolean), stuffedBox=passed.p.mail[stuffedTarget];
passed.s.update(.01,{x:stuffedBox.x+59,z:stuffedBox.z,vx:1,vz:0,heading:0,airborne:false});passed.s.end();
assert.ok(passed.s.complaints.all.some(c=>c.kind==='stuffed'&&c.target===stuffedTarget));
const outside=makeShift('day=1');const boxOutside=outside.p.mail[outside.s.today.stuffed.findIndex(Boolean)];
outside.s.update(.01,{x:boxOutside.x+61,z:boxOutside.z,vx:1,vz:0,heading:0,airborne:false});outside.s.end();
assert.equal(outside.s.complaints.all.some(c=>c.kind==='stuffed'&&c.target===outside.s.today.stuffed.findIndex(Boolean)),false);
const overflow=makeShift('day=1&run=8');
for(let i=0;i<12;i++)overflow.m.service.ground(overflow.p.mail[i].x,overflow.p.mail[i].z,false);
overflow.s.end();assert.equal(overflow.s.complaints.all.filter(c=>c.kind==='ditchMail').length,5);
assert.equal(document.getElementById('reportCalls').children.at(-1).textContent,'and 7 more like it');
console.log('PASS: instant day-one end has three calls; 24 clean physical-delivery days get No action taken; pre-existing photos, late calls, persisted carryover, doubled active runs, pass radius, ground overflow report.');

// Low mode never promises a steering pull. Damage still reaches its repair bill.
const lowDamage=makeShift('day=1&damage=alignment');lowDamage.s.update(0,{x:0,z:0,vx:0,vz:0,heading:0,airborne:false});
assert.equal(lowDamage.s.damage.total,55);assert.doesNotMatch(document.getElementById('stopHint').textContent,/pulls left/);
assert.match(document.getElementById('stopHint').textContent,/garage/);
lowDamage.s.update(5.1,{x:0,z:0,vx:0,vz:0,heading:0,airborne:false});assert.equal(lowDamage.s.damage.hintTime,0);
assert.doesNotMatch(document.getElementById('stopHint').textContent,/garage/);
console.log('PASS: low-mode damage hint describes the repair, expires in five seconds, and keeps its bill.');
