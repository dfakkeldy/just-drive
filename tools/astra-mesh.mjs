// Check that both facade studies preserve the surveyed house as a set of coloured triangles.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from '../web/node_modules/three/build/three.module.js';
import { Buildings, buildingAppearance } from '../web/src/buildings.ts';

const land = file => JSON.parse(readFileSync('data/baked/terrain/' + file, 'utf8'));
const { village, buildings, buildingStyles } = land('manifest.json');
const { styles } = land(buildingStyles.file);
const house = land(buildings.file).buildings.find(b => b.kind === 'house' && !b.shape && (styles[b.buildingId ?? b.id]?.roofShape ?? b.roof) === 'gable');
assert.ok(house);
const sunDir = new Vector3(37, 24, 42).normalize();
assert.equal(buildingAppearance('coastal-air', true, sunDir, styles), styles);
assert.equal(buildingAppearance(null, false, sunDir, styles), styles);
const mesh = study => new Buildings([house], village, 1.5, -0.2, buildingAppearance(study, false, sunDir, styles)).mesh;
const original = mesh(), windowStudy = mesh('window-light'), shadowStudy = mesh('wall-shadows');
for (const [flag, full] of [['window-light', windowStudy], ['wall-shadows', original]]) {
  const compact = new Buildings([house], village, 1.5, -0.2, buildingAppearance(flag, true, sunDir, styles)).mesh;
  assert.equal(compact.customDepthMaterial, undefined);
  const high = full.geometry.attributes, low = compact.geometry.attributes;
  assert.ok(low.position.count < high.position.count, 'subpixel detailing leaves the LOW mesh');
  assert.ok(low.color.normalized && low.color.array instanceof Uint8Array);
  assert.ok(low.normal.normalized && low.normal.array instanceof Int8Array);
  const vertex = (attrs, i) => [
    ...attrs.position.array.subarray(i * 3, i * 3 + 3),
    ...[attrs.normal.getX(i), attrs.normal.getY(i), attrs.normal.getZ(i)].map(n => Math.round(n * 127)),
    ...[attrs.color.getX(i), attrs.color.getY(i), attrs.color.getZ(i)].map(c => Math.round(c * 255)),
  ].join(',');
  const triangle = (attrs, i) => [0, 1, 2].map(j => vertex(attrs, i + j)).join('|');
  const kept = new Map();
  for (let i = 0; i < low.position.count; i += 3) {
    const key = triangle(low, i);
    kept.set(key, (kept.get(key) ?? 0) + 1);
  }
  for (let i = 0; i < high.position.count; i += 3) {
    const key = triangle(high, i), count = kept.get(key);
    if (count) {
      if (count === 1) kept.delete(key); else kept.set(key, count - 1);
      continue;
    }
    const p = high.position, ix = [i, i + 1, i + 2];
    const heights = ix.map(j => p.getY(j));
    const height = Math.max(...heights) - Math.min(...heights);
    const width = Math.max(...ix.map((j, k) => {
      const next = ix[(k + 1) % 3];
      return Math.hypot(p.getX(j) - p.getX(next), p.getZ(j) - p.getZ(next));
    }));
    assert.ok(flag === 'window-light' ? width < 0.051 : height < 0.019, 'only the thin upright or course can leave');
  }
  assert.equal(kept.size, 0, 'every retained LOW triangle keeps the original position, winding and paint');
}
// Each camera sees the same opaque mesh. Crossing into another cell replaces only the fine-paint indices.
const secondHouse = { ...house, x: house.x + 1_280 };
const lowWall = new Buildings([house, secondHouse], village, 1.5, -0.2, buildingAppearance('wall-shadows', true, sunDir, styles)).mesh;
const geo = lowWall.geometry, eye = new PerspectiveCamera();
function atHouseCell(x, z) {
  eye.position.set(x, 0, z); eye.updateMatrixWorld();
  lowWall.onBeforeRender(null, null, eye);
  return Array.from(geo.index.array.subarray(0, geo.drawRange.count));
}
const nearX = house.x - village[0], nearZ = village[1] - house.y;
const firstView = atHouseCell(nearX, nearZ), version = geo.index.version;
assert.deepEqual(atHouseCell(nearX, nearZ), firstView);
assert.equal(geo.index.version, version, 'staying in the same cell leaves the GPU index alone');
const secondView = atHouseCell(nearX + 1_280, nearZ);
const distant = atHouseCell(nearX + 3_000, nearZ);
const permanent = new Set(distant), nearSecond = new Set(secondView);
assert.ok(distant.length > 0 && distant.length < firstView.length);
assert.deepEqual(new Set(firstView.filter(i => nearSecond.has(i))), permanent);
assert.equal(new Set([...firstView, ...secondView]).size, geo.getAttribute('position').count);
assert.ok(Array.from({ length: 24 }, (_, i) => i).every(i => permanent.has(i)), 'all four shell walls remain');
const paint = geo.getAttribute('color').array;
assert.ok(distant.some(i => paint[3*i] === 17 && paint[3*i+1] === 27 && paint[3*i+2] === 33), 'distant windows retain their glass');
for (const view of [firstView, secondView, distant]) {
  assert.ok(view.every((index, i) => i === 0 || index > view[i - 1]), 'trim, pane and sash keep their original depth tie order');
  for (let i = 0; i < view.length; i += 3) assert.deepEqual(view.slice(i, i + 3), [view[i], view[i] + 1, view[i] + 2]);
}
assert.deepEqual(atHouseCell(nearX, nearZ), firstView, 'returning restores the original trim');
assert.equal(original.customDepthMaterial, undefined);
assert.equal(windowStudy.customDepthMaterial, undefined);
assert.equal(shadowStudy.material.shadowSide, null);
assert.ok(shadowStudy.customDepthMaterial?.isMeshDepthMaterial);
const testDepth = { vertexShader: '#include <project_vertex>', fragmentShader: 'original depth fragment' };
shadowStudy.customDepthMaterial.onBeforeCompile(testDepth);
assert.equal(testDepth.fragmentShader, 'original depth fragment');
assert.match(testDepth.vertexShader, /if \(closedWall > 1\.5\) gl_Position/);
assert.doesNotMatch(testDepth.vertexShader, /normalMatrix/);

const before = original.geometry.attributes, glass = windowStudy.geometry.attributes, walls = shadowStudy.geometry.attributes;
assert.deepEqual(glass.position.array, before.position.array);
assert.deepEqual(glass.normal.array, before.normal.array);
assert.notDeepEqual(glass.color.array, before.color.array);
assert.equal(before.position.count, walls.position.count);
const cx = house.x - village[0], cz = village[1] - house.y;
const vertex = (a, i) => [...a.position.array.subarray(i * 3, i * 3 + 3), ...a.color.array.subarray(i * 3, i * 3 + 3)].join(',');
const angle = house.axisDeg * Math.PI / 180, eaves = new Set();
let outward = 0, closedTriangles = 0;
for (let i = 0; i < before.position.count; i += 3) {
  const old = [0, 1, 2].map(j => vertex(before, i + j));
  const next = [0, 1, 2].map(j => vertex(walls, i + j));
  const flipped = old[1] !== next[1];
  assert.deepEqual(next.sort(), old.sort(), 'same triangle in world space, including vertex paint');
  const p = walls.position, n = walls.normal, mask = walls.closedWall;
  const closed = mask.getX(i);
  assert.equal(closed, mask.getX(i + 1)); assert.equal(closed, mask.getX(i + 2));
  if (i < 24) assert.ok(flipped && closed, 'all four original shell walls cast from their outward normals');
  if (closed) {
    assert.ok(flipped && Math.abs(n.getY(i)) < 0.001, 'only vertical shell faces get back-face depth');
    closedTriangles++;
  }
  // Each gable roof slope runs from the ridge centreline to an overhang past half the surveyed width.
  const transverse = [i, i + 1, i + 2].map(j => (p.getX(j) - cx) * Math.cos(angle) + (p.getZ(j) - cz) * Math.sin(angle));
  if (transverse.some(v => Math.abs(v) < 0.015) && transverse.some(v => Math.abs(v) > house.width / 2 + 0.1) && Math.abs(n.getY(i)) > 0.01) {
    assert.equal(closed, 0, 'a roof plane still casts from both sides');
    eaves.add(Math.sign(transverse.reduce((sum, v) => sum + v, 0)));
  }
  if (flipped) {
    assert.ok((p.getX(i) - cx) * n.getX(i) + (p.getZ(i) - cz) * n.getZ(i) > 0, 'corrected face points away from the house');
    outward++;
  }
}
// Check the preclassified byte against the winding seen by the game's directional shadow camera.
for (const direction of [sunDir, new Vector3(-27, 1.1, 35).normalize(), new Vector3(12, 37, -28).normalize()]) {
  const light = new OrthographicCamera(-60, 60, 60, -60, 0.1, 300);
  const centre = new Vector3(cx, walls.position.getY(0) + 4, cz);
  light.position.copy(centre).addScaledVector(direction, 90);
  light.lookAt(centre); light.updateMatrixWorld();
  const mask = new Buildings([house], village, 1.5, -0.2, buildingAppearance('wall-shadows', false, direction, styles)).mesh.geometry.getAttribute('closedWall');
  for (let i = 0; i < walls.position.count; i += 3) {
    if (!walls.closedWall.getX(i)) { assert.equal(mask.getX(i), 0); continue; }
    const [a,b,c] = [0,1,2].map(j => new Vector3().fromBufferAttribute(walls.position, i + j).project(light));
    const area = (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x);
    assert.equal(mask.getX(i), area > 0 ? 2 : 1, 'only sun-facing closed triangles clip before rasterization');
    assert.equal(mask.getX(i), mask.getX(i + 1)); assert.equal(mask.getX(i), mask.getX(i + 2));
  }
}
assert.equal(closedTriangles, 10, 'eight main wall triangles and two solid gable ends');
assert.deepEqual([...eaves].sort(), [-1, 1], 'both roof slopes reach their eaves');
console.log('PASS', before.position.count / 3, 'surveyed triangles retained;', outward, 'outward wall and panel triangles');
