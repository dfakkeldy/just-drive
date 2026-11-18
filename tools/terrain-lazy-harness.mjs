// Bundled and run by tools/terrain-lazy-check.mjs (with or without one mutation). Real Mabou tiles, real Terrain.
// Two phone terrains, the same camera at the Highway 19 start: lazyRange 0 (as before) and 600 (as main.ts sets on LOW).
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { png } from './quarry-height-read.mjs';
import { Terrain } from '../web/src/terrain.ts';

const root = process.env.MMM_ROOT ?? process.cwd(), base = root + '/data/baked/terrain';
const manifest = JSON.parse(readFileSync(base + '/manifest.json', 'utf8'));
const reads = new Map();   // terrain base tag -> list of file paths
globalThis.fetch = async (url) => {
  const [tag, path] = String(url).split('|');
  reads.get(tag)?.push(path);
  return new Response(readFileSync(path));
};
globalThis.createImageBitmap = async (blob) => png(Buffer.from(await blob.arrayBuffer()));
globalThis.OffscreenCanvas = class { getContext() { let image; return { drawImage(b) { image = b; }, getImageData() { return { data: image.pixels }; } }; } };

// Each terrain reads through its own tag so the two read logs stay apart: base "<tag>|<real folder>".
function phoneTerrain(tag, lazyRange, exag = 1, land = manifest) {
  reads.set(tag, []);
  // The land-cover texture is a browser image; a blank texture stands in while the terrain is made.
  const loader = THREE.TextureLoader.prototype.load; THREE.TextureLoader.prototype.load = () => new THREE.Texture();
  let t;
  try { t = new Terrain(land, `${tag}|${base}`, {}, exag, 0); } finally { THREE.TextureLoader.prototype.load = loader; }
  t.split = 1.15; t.low = true; t.lazyRange = lazyRange; t.holdBackground = true;
  return t;
}
const full = phoneTerrain('full', 0), lazy = phoneTerrain('lazy', 600);

// The explicit Highway 19 start of tools/phone-cold-start.mjs, chase camera behind the car, 844 x 390 phone view.
const [VE, VN] = manifest.village, bearing = Math.atan2(3.1, 2.53);
const car = new THREE.Vector3(624303.3 - VE, 0, VN - 5103261.34);
const ahead = new THREE.Vector3(Math.sin(bearing), 0, -Math.cos(bearing));
function aim(camera, terrain, dir) {
  const ground = terrain.heightAt(car.x, car.z) ?? 10;
  camera.position.copy(car).addScaledVector(dir, -7); camera.position.y = ground + 3;
  camera.lookAt(car.x + dir.x * 30, ground + 1, car.z + dir.z * 30);
  camera.updateMatrixWorld(); camera.updateProjectionMatrix();
}
const camera = () => new THREE.PerspectiveCamera(51, 844 / 390, 0.45, 150000);
const tick = () => new Promise((r) => setImmediate(r));
async function settle(terrain, cam, dir, { maxFrames = 4000, quietFrames = 30, each } = {}) {
  let quiet = 0;
  for (let frame = 0; frame < maxFrames; frame++) {
    aim(cam, terrain, dir); terrain.update(cam, false); each?.(terrain);
    for (let k = 0; k < 4; k++) await tick();
    quiet = terrain.pending === 0 ? quiet + 1 : 0;
    if (quiet >= quietFrames) return frame;
  }
  throw Error('terrain did not settle');
}
const internal = (t) => t;   // private fields are plain properties in the bundle

// Capture the real lazy() box before the frustum decision. New bounds can be higher OR lower than
// the legacy table; missing fields retain the old limits, including unknown-area encoding fallback.
for (const [name, area, height, expectedMin, expectedMax] of [
  // A recorded minimum keeps 1 m below it for build()'s cuts (the brook crease); legacy offsets do not.
  ['new high', undefined, { min: -20, max: 500 }, -21, 1000],
  ['new low', undefined, { min: -10, max: 200 }, -11, 400],
  ['zero max', undefined, { min: 0, max: 0 }, manifest.seaFloor - 1, 0],
  ['legacy', undefined, {}, manifest.height.offset, 862],
  ['max only', undefined, { max: 500 }, manifest.height.offset, 1000],
  ['unknown legacy', { id: 'future-area' }, {}, manifest.height.offset, 2 * (65535 * manifest.height.scale + manifest.height.offset)],
]) {
  const t = phoneTerrain(`bounds-${name}`, 600, 2, { ...manifest, area,
    height: { scale: manifest.height.scale, offset: manifest.height.offset, ...height } });
  const tile = internal(t).tile(0, 0, 0);
  let box;
  internal(t).frustum.intersectsBox = b => { box = b.clone(); return true; };
  assert.equal(internal(t).lazy(tile, 2000, false), false);
  assert.equal(box.max.y, expectedMax + 255 * manifest.canopy.scale, `${name}: manifest max before table, then canopy`);
  assert.equal(box.min.y, expectedMin - Math.max(tile.size * .04, 6), `${name}: manifest min before offset, sea and skirt retained`);
}
console.log('PASS lazy manifest bounds: above/below table, zero, legacy, partial and unknown area');

const readyKeys = (t) => new Set([...internal(t).tiles.entries()].filter(([, x]) => x.ready).map(([k]) => k));
const drawnSelection = (t) => [...internal(t).tiles.entries()].filter(([, x]) => x.mesh?.visible)
  .map(([k, x]) => `${k}:${x.mesh.material.uniforms.hideQuad.value.toArray().join('')}`).sort();
const bytes = (paths) => paths.reduce((n, p) => n + statSync(p).size, 0);
const camFull = camera(), camLazy = camera();

// Unknown heights: a portrait phone looks up towards the north-east highlands, exag 1.5. Use the
// actual built vertices as the visibility witness, not the unknown box whose safety we are testing.
{
  const known = phoneTerrain('highlands-known', 0, 1.5), unseen = phoneTerrain('highlands-unread', 600, 1.5);
  await known.loadNow(4, 15, 2);
  const hill = internal(known).tiles.get('4/15_2');
  const cam = new THREE.PerspectiveCamera(51, 390 / 844, 0.45, 150000);
  cam.position.set(hill.x0 - 1000, 570, hill.z0 + hill.size + 50);
  const heading = Math.PI / 4, pitch = THREE.MathUtils.degToRad(28);
  cam.lookAt(cam.position.x + Math.sin(heading) * Math.cos(pitch), cam.position.y + Math.sin(pitch),
    cam.position.z - Math.cos(heading) * Math.cos(pitch));
  cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const view = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const vertices = hill.mesh.geometry.getAttribute('position'), point = new THREE.Vector3();
  let visibleHighVertices = 0;
  for (let k = 0; k < vertices.count; k++) {
    point.fromBufferAttribute(vertices, k);
    if (point.y > 600 && view.containsPoint(point)) visibleHighVertices++;
  }
  assert.ok(visibleHighVertices > 0, 'the upward phone view contains actual highland vertices above the old 600 m top');
  const unread = internal(unseen).tile(4, 15, 2);
  const oldBox = unread.box.clone(); oldBox.min.y = -200;
  assert.equal(view.intersectsBox(oldBox), false, 'the old unknown-height box misses the visible highlands');
  internal(unseen).frustum.copy(view);
  assert.ok(unread.box.distanceToPoint(cam.position) > 600, 'the highland witness is beyond lazyRange');
  assert.equal(internal(unseen).lazy(unread, unread.box.distanceToPoint(cam.position), false), false,
    'the upward phone view must not defer the unread highland tile');

  // Audit every deferral during the held start against independent bounds decoded from the real PNGs.
  const measured = new Map(), originalLazy = internal(unseen).lazy;
  let decisions = 0, deferred = 0, quiet = 0;
  internal(unseen).lazy = function(tile, dist, mirror) {
    const result = originalLazy.call(this, tile, dist, mirror); decisions++;
    if (!result) return result;
    deferred++;
    const key = `${tile.level}/${tile.i}_${tile.j}`;
    let box = measured.get(key);
    if (!box) {
      const { pixels } = png(readFileSync(`${base}/${key}.png`));
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < pixels.length; k += 4) {
        const raw = (pixels[k] * 256 + pixels[k + 1]) * manifest.height.scale + manifest.height.offset;
        const ground = raw > 0 ? raw * 1.5 : raw;
        lo = Math.min(lo, ground); hi = Math.max(hi, ground + pixels[k + 2] * manifest.canopy.scale);
      }
      box = new THREE.Box3(new THREE.Vector3(tile.x0, lo - Math.max(tile.size * 0.04, 6), tile.z0),
        new THREE.Vector3(tile.x0 + tile.size, hi, tile.z0 + tile.size));
      measured.set(key, box);
    }
    assert.equal(view.intersectsBox(box), false, `upward phone view must not defer an in-view tile: ${key}`);
    return result;
  };
  for (let frame = 0; quiet < 30; frame++) {
    assert.ok(frame < 4000, 'the highland phone start settles');
    unseen.update(cam, false); for (let k = 0; k < 4; k++) await tick();
    quiet = unseen.pending === 0 ? quiet + 1 : 0;
  }
  assert.ok(decisions > 0 && deferred > 0, 'the highland start exercises both selection and deferral');
  assert.ok(internal(unseen).tiles.get('4/15_2')?.ready, 'the visible highland tile is read while background is held');
  console.log(JSON.stringify({ highlands: { visibleHighVertices, decisions, deferred, inViewDeferred: 0 } }));

  // Level 2 and 3 skirts reach below -200 m. Centre a narrow view on a real bottom skirt vertex,
  // outside the tile: its unknown box must keep that visible vertex until the tile has been read.
  for (const [level, i, j] of [[2, 2, 0], [3, 5, 0]]) {
    await known.loadNow(level, i, j);
    const built = internal(known).tiles.get(`${level}/${i}_${j}`), positions = built.mesh.geometry.getAttribute('position');
    let lowest = new THREE.Vector3(0, Infinity, 0);
    for (let k = 0; k < positions.count; k++) {
      point.fromBufferAttribute(positions, k);
      if (point.y < lowest.y) lowest.copy(point);
    }
    assert.ok(lowest.y < -200, `level ${level} has a skirt below the old bottom`);
    const skirtCam = new THREE.PerspectiveCamera(1, 390 / 844, 0.45, 150000);
    skirtCam.position.set(built.x0 - 1000, lowest.y, lowest.z); skirtCam.lookAt(lowest); skirtCam.updateMatrixWorld();
    const skirtView = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(skirtCam.projectionMatrix, skirtCam.matrixWorldInverse));
    assert.ok(skirtView.containsPoint(lowest), 'a real bottom skirt vertex is visible');
    // The highland run may already have read it: use a fresh unread terrain for this probe.
    const skirtUnread = phoneTerrain(`skirt-${level}`, 600, 1.5), tile = internal(skirtUnread).tile(level, i, j);
    internal(skirtUnread).frustum.copy(skirtView);
    const old = tile.box.clone(); old.min.y = -200;
    assert.equal(skirtView.intersectsBox(old), false, `level ${level}: the old bottom misses the skirt`);
    assert.equal(internal(skirtUnread).lazy(tile, tile.box.distanceToPoint(skirtCam.position), false), false,
      `level ${level}: a visible coarse skirt must not be deferred`);
  }
}

// 1. Held start (before the first pedal): the view settles on both.
await settle(full, camFull, ahead);
await settle(lazy, camLazy, ahead);
const fullReads = reads.get('full').length, lazyReads = reads.get('lazy').length;
const fullBytes = bytes(reads.get('full')), lazyBytes = bytes(reads.get('lazy'));
console.log(JSON.stringify({ start: { fullReads, lazyReads, fullMB: +(fullBytes / 1e6).toFixed(2), lazyMB: +(lazyBytes / 1e6).toFixed(2) } }));

// 2. What the player sees is the same: the same tiles drawn, with the same hidden quarters.
const a = drawnSelection(full), b = drawnSelection(lazy);
assert.deepEqual(b, a, 'the start view draws exactly the same tiles and quarters');
assert.equal(lazy.drawn, full.drawn, 'same draw count');
// 2b. The same at a coastal start, where some split tiles have only sea next to their lazy land: the village-start
//     camera of tools/frame-budget-policy.mjs (east, north, 4 m, heading 325, pitch -8, fov 58, portrait 390 x 844, exag 1.5), held.
{
  const coastFull = phoneTerrain('coast-full', 0, 1.5), coastLazy = phoneTerrain('coast-lazy', 600, 1.5);   // the budget pages use exag=1.5
  const fixed = () => {
    const cam = new THREE.PerspectiveCamera(58, 390 / 844, 0.45, 150000), h = THREE.MathUtils.degToRad(325), p = THREE.MathUtils.degToRad(-8);
    cam.position.set(624230 - VE, 4, VN - 5103300);
    cam.lookAt(cam.position.x + Math.sin(h) * Math.cos(p), 4 + Math.sin(p), cam.position.z - Math.cos(h) * Math.cos(p));
    cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    return cam;
  };
  for (const t of [coastFull, coastLazy]) {
    const cam = fixed(); let quiet = 0;
    for (let frame = 0; quiet < 30; frame++) {
      if (frame >= 4000) throw Error('coastal terrain did not settle');
      t.update(cam, false); for (let k = 0; k < 4; k++) await tick();
      quiet = t.pending === 0 ? quiet + 1 : 0;
    }
  }
  assert.ok(reads.get('coast-lazy').length < reads.get('coast-full').length, 'the coastal start defers some far land');
  // Same tiles drawn and the same draw count. A tile drawn in both may keep more quarters on the lazy side: its
  // lazy quarters are out of view (one draw either way). Before the fix, a parent whose land quarters were all lazy
  // fell through and was drawn whole: one extra draw that showed nothing (+1 call in six phone budget rows).
  const tilesOf = (t) => drawnSelection(t).map((s) => s.split(':')[0]);
  assert.deepEqual(tilesOf(coastLazy), tilesOf(coastFull), 'the coastal start view draws exactly the same tiles');
  assert.equal(coastLazy.drawn, coastFull.drawn, 'coastal start: same draw count');
}
// 3. Near the camera nothing is put off: every tile the old start read within lazyRange is in memory.
const near = [...readyKeys(full)].filter((k) => { const t = internal(full).tiles.get(k); return t.box.distanceToPoint(camFull.position) <= 600; });
const lazyReady = readyKeys(lazy);
assert.deepEqual(near.filter((k) => !lazyReady.has(k)), [], 'every tile within 600 m of the camera is read at the start');
// 4. It is a real saving.
assert.ok(lazyReads < fullReads * 0.8, `start reads ${lazyReads} vs ${fullReads}: expected at least 20% fewer`);

// 5. Held means held: no background read before the first pedal, however long the start waits.
for (let i = 0; i < 60; i++) { aim(camLazy, lazy, ahead); lazy.update(camLazy, false); await tick(); }
assert.equal(reads.get('lazy').length, lazyReads, 'no read while the background is held');
assert.equal(internal(lazy).backgroundQueue.length, 0, 'nothing queued while held');

// 6. After the first pedal the rest streams in the background; it never counts as pending, and in the end the
//    phone holds the same land as before (a deferral, not a deletion).
lazy.holdBackground = false;
// Sample right after each update: local reads can finish within the same few ticks.
let maxBackground = 0, sawBackground = false, still = 0;
for (let frame = 0; frame < 6000; frame++) {
  const readsBefore = reads.get('lazy').length;
  aim(camLazy, lazy, ahead); lazy.update(camLazy, false);
  const loading = internal(lazy).backgroundLoading.size;
  maxBackground = Math.max(maxBackground, loading); if (loading) sawBackground = true;
  assert.equal(lazy.pending, 0, `background reads are not pending (frame ${frame})`);
  for (let k = 0; k < 4; k++) await tick();
  assert.equal(lazy.pending, 0, `background reads are not pending (frame ${frame})`);
  const idle = !internal(lazy).backgroundLoading.size && !internal(lazy).backgroundQueue.length && !internal(lazy).builds.length && reads.get('lazy').length === readsBefore;
  still = idle ? still + 1 : 0;
  if (sawBackground && still >= 30) break;
}
assert.ok(sawBackground, 'the background streams after the first pedal');
assert.ok(maxBackground <= 2, `at most two background reads at once (saw ${maxBackground})`);
const missing = [...readyKeys(full)].filter((k) => !readyKeys(lazy).has(k));
assert.deepEqual(missing, [], 'after streaming, the phone has every tile the old start had');
const lazyPaths = reads.get('lazy');
assert.equal(new Set(lazyPaths).size, lazyPaths.length, 'no tile is read twice');
assert.deepEqual(drawnSelection(lazy), a, 'and still draws the same view');

// 7. In view first: with background reads in flight, a turn to face backwards gets foreground slots at once.
//    The car has gone 300 m back past the start first (as in the browser U-turn), so far land behind is unread.
const fresh = phoneTerrain('turn', 600);
const camTurn = camera();
await settle(fresh, camTurn, ahead);
car.addScaledVector(ahead, -300);
await settle(fresh, camTurn, ahead);
fresh.holdBackground = false;
for (let i = 0; i < 400; i++) { aim(camTurn, fresh, ahead); fresh.update(camTurn, false); if (internal(fresh).backgroundLoading.size >= 2) break; await tick(); }
assert.equal(internal(fresh).backgroundLoading.size, 2, 'background reads are in flight before the turn');
const back = ahead.clone().negate();
aim(camTurn, fresh, back); fresh.update(camTurn, false);
const foreground = internal(fresh).active - [...internal(fresh).backgroundLoading].filter((t) => t.background).length;
assert.ok(foreground >= 1, `a tile in the new view starts reading at once (foreground reads ${foreground})`);
assert.ok(fresh.pending > 0, 'the land the turn brings into view is pending');
// A background read the view now wants counts as pending (it was promoted), so the page cannot say ready early.
for (const t of internal(fresh).tiles.values()) if (t.loading && t.wanted === internal(fresh).frame)
  assert.equal(t.background, false, 'a tile the view wants is no longer a background read');
// The near land stays fine while the far land behind loads: the finest tile under the car is still drawn.
const under = (t) => { const size = manifest.size / 256, i = Math.floor((car.x + VE - manifest.origin[0]) / size), j = Math.floor((car.z - (VN - manifest.origin[1])) / size); return internal(t).tiles.get(`8/${i}_${j}`); };
assert.ok(under(fresh)?.mesh?.visible, 'right after the turn, the fine tile under the car is still drawn');
// While a tile in view still waits for a read, no new background read starts.
for (let i = 0; i < 400 && internal(fresh).queue.length; i++) {
  const before = new Set(internal(fresh).backgroundLoading);
  aim(camTurn, fresh, back); fresh.update(camTurn, false);
  if (internal(fresh).queue.length) for (const t of internal(fresh).backgroundLoading)
    assert.ok(before.has(t), 'no background read starts while a tile in view waits');
  await tick();
}
await settle(fresh, camTurn, back);
console.log(JSON.stringify({ pass: true, drawn: full.drawn, selection: a.length, nearTiles: near.length, maxBackground }));
