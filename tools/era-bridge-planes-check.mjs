// 1884 timber bridge deck planes across coarse/unloaded and fine terrain tiles,
// pinning all Mabou and Judique 1884 bridge planes on real baked land.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { Terrain } from '../web/src/terrain.ts';
import { Roads } from '../web/src/roads.ts';
import { Vehicle } from '../web/src/vehicle.ts';
import { HORSE_SPEC } from '../web/src/horse.ts';
import { historyGround } from '../web/src/eras/history-ground.ts';
import { HistoryBridgeApproaches } from '../web/src/eras/history-approaches.ts';
import { timberPlan, periodBridgePlane } from '../web/src/eras/timber-bridge.ts';

const ROOT = process.env.MMM_ROOT ?? process.cwd();

// Pinned on origin/main 0b518985 at exag = 1.5: [roadId, y0, y1, maxBankLevel].
const MABOU_PLANES = [
  [21, 129.445797, 128.47816, 8],
  [28, 6.710473, 6.441877, 8],
  [29, 19.680916, 17.556525, 8],
  [33, 6.33622, 6.96078, 8],
  [34, 62.015903, 63.163837, 8],
  [45, 3.528029, 3.373063, 7],
  [46, 2.485367, 2.339301, 7],
  [50, 2.3327, 4.309315, 8],
  [54, 3.211707, 2.408967, 8],
  [57, 11.193917, 11.726423, 8],
  [84, 5.007404, 7.009086, 8],
  [91, 18.389756, 19.065606, 8],
  [92, 3.51809, 2.375827, 8],
  [96, 50.885351, 49.620775, 7],
  [97, 56.443593, 58.763166, 6],
  [108, 35.67405, 36.001157, 8],
  [119, 79.827763, 79.395311, 7],
  [122, 60.849247, 62.002467, 7],
  [953, 8.510468, 7.743704, 8],
  [954, 113.116421, 113.244286, 6],
  [955, 8.089406, 8.321968, 8],
  [956, 14.886557, 14.88731, 7],
  [957, 7.743704, 5.368443, 8],
];

const JUDIQUE_PLANES = [
  [8, 45.286338, 43.910913, 8],
  [12, 104.00534, 103.432568, 6],
  [16, 50.410114, 50.082303, 8],
  [26, 71.385712, 71.522584, 8],
  [36, 37.02793, 38.981886, 8],
  [37, 17.574286, 16.558466, 8],
  [44, 12.222906, 12.677504, 8],
  [45, 13.053517, 12.365059, 8],
  [46, 25.689181, 23.551781, 8],
  [47, 20.486439, 21.585641, 8],
  [48, 12.737651, 15.32772, 8],
  [54, 119.826726, 119.171525, 8],
  [59, 47.128316, 47.212232, 8],
  [69, 93.12025, 93.1057, 8],
  [73, 209.488673, 209.858889, 6],
  [83, 53.040347, 54.216941, 8],
  [90, 44.640437, 45.875913, 8],
  [94, 40.185562, 40.634554, 8],
  [101, 301.412615, 302.060939, 8],
  [106, 3.57469, 3.02792, 8],
  [987, 191.408306, 190.876517, 6],
  [988, 79.669107, 79.994552, 8],
  [989, 9.579559, 9.945592, 7],
];

function decodePng(bytes) {
  const chunks = [];
  let width = 0, height = 0, channels = 0;
  for (let off = 8; off < bytes.length;) {
    const n = bytes.readUInt32BE(off);
    const type = bytes.toString('ascii', off + 4, off + 8);
    const body = bytes.subarray(off + 8, off + 8 + n);
    off += 12 + n;
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      assert.equal(body[8], 8);
      channels = body[9] === 2 ? 3 : body[9] === 6 ? 4 : 0;
      assert.ok(channels);
      assert.equal(body[12], 0);
    }
    if (type === 'IDAT') chunks.push(body);
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const decoded = new Uint8Array(stride * height);
  const pixels = new Uint8ClampedArray(width * height * 4);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const k = y * stride + x;
      const a = x >= channels ? decoded[k - channels] : 0;
      const b = y ? decoded[k - stride] : 0;
      const c = y && x >= channels ? decoded[k - stride - channels] : 0;
      decoded[k] = (raw[y * (stride + 1) + x + 1] + [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]) & 255;
    }
  }
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = decoded[i * channels];
    pixels[i * 4 + 1] = decoded[i * channels + 1];
    pixels[i * 4 + 2] = decoded[i * channels + 2];
    pixels[i * 4 + 3] = channels === 4 ? decoded[i * channels + 3] : 255;
  }
  return { pixels, width, height, close() {} };
}

function makeRig() {
  const node = () => new THREE.Group();
  return { root: node(), body: node(), driverEye: node(), brakeLights: [], steer: { fl: node(), fr: node() }, wheels: { fl: node(), fr: node(), rl: node(), rr: node() } };
}

function makeCoverReader(base, manifest) {
  const { pixels, width, height } = decodePng(readFileSync(`${base}/${manifest.cover.file}`));
  const c = manifest.cover, [ve, vn] = manifest.village;
  return (x, z) => {
    const u = (x + ve - c.xmin) / (c.xmax - c.xmin);
    const v = (c.ymax - vn + z) / (c.ymax - c.ymin);
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return 0;
    return pixels[(Math.floor(v * height) * width + Math.floor(u * width)) * 4 + 2];
  };
}

async function loadEraArea(base, exag = 1.5, withCover = false) {
  const manifest = JSON.parse(readFileSync(`${base}/manifest.json`, 'utf8'));
  const roadData = JSON.parse(readFileSync(`${base}/roads.json`, 'utf8'));
  globalThis.fetch = async path => new Response(readFileSync(path));
  globalThis.createImageBitmap = async blob => decodePng(Buffer.from(await blob.arrayBuffer()));
  globalThis.OffscreenCanvas = class {
    getContext() {
      let bmp;
      return {
        drawImage(b) { bmp = b; },
        getImageData() { return { data: bmp.pixels }; },
      };
    }
  };
  const oldLoad = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = () => new THREE.Texture();
  let terrain;
  try {
    terrain = new Terrain(manifest, base, {}, exag, -0.2, [], { cartRoads: true, low: true });
  } finally {
    THREE.TextureLoader.prototype.load = oldLoad;
  }
  if (withCover) terrain.coverAt = makeCoverReader(base, manifest);
  const roads = new Roads(roadData, manifest.village, terrain);
  const [ve, vn] = manifest.village;
  const ground = await historyGround(
    manifest,
    base,
    roads.roads.filter(r => r.bridge).flatMap(r => r.pts.map(([x, z]) => [x + ve, vn - z])),
  );
  const approaches = new HistoryBridgeApproaches(roads, terrain, ground);
  approaches.install(terrain);
  return { manifest, terrain, roads, approaches };
}

async function loadTileAt(terrain, level, x, z) {
  const m = terrain.manifest;
  const size = m.size / 2 ** level;
  const i = Math.floor((x + m.village[0] - m.origin[0]) / size);
  const j = Math.floor((z - m.village[1] + m.origin[1]) / size);
  const key = `${i}_${j}`;
  if (m.levels[level]?.includes(key)) await terrain.loadNow(level, i, j);
}

async function loadFinestAt(terrain, points, margin = 80, maxLevel = 8) {
  const m = terrain.manifest;
  const keys = new Set();
  for (const [x, z] of points) {
    for (let dz = -margin; dz <= margin; dz += 60) {
      for (let dx = -margin; dx <= margin; dx += 60) {
        for (let level = maxLevel; level >= 0; level--) {
          const size = m.size / 2 ** level;
          const i = Math.floor((x + dx + m.village[0] - m.origin[0]) / size);
          const j = Math.floor((z + dz - m.village[1] + m.origin[1]) / size);
          const name = `${i}_${j}`;
          if (m.levels[level]?.includes(name)) {
            keys.add(`${level}/${name}`);
            break;
          }
        }
      }
    }
  }
  for (const key of keys) {
    const [level, i, j] = key.split(/[/_]/).map(Number);
    await terrain.loadNow(level, i, j);
  }
}

// 1. Road 28 coarse/unloaded reproduction (fails on main before the fix).
const mabouBase = `${ROOT}/data/baked/terrain`;
{
  const { terrain, roads } = await loadEraArea(mabouBase, 1.5, true);
  const road28 = roads.roads.find(r => r.id === 28);
  assert.ok(road28 && road28.bridge, 'Mabou road 28 exists as a bridge');
  const mid = road28.pts[Math.floor(road28.pts.length / 2)];
  const ba = road28.pts[0], bb = road28.pts[road28.pts.length - 1];
  const heading = Math.atan2(bb[0] - ba[0], ba[1] - bb[1]);
  assert.equal(terrain.coverAt(mid[0], mid[1]), 4, 'road 28 middle vertex sits over mapped river water');

  // Unloaded terrain tiles: HistoryBridgeApproaches already has the level-6 plane.
  const unloaded = periodBridgePlane(road28, roads.roads, terrain);
  assert.ok(unloaded, 'road 28 plane exists before any terrain tiles load');
  assert.equal(unloaded.level, 0);
  assert.ok(Math.abs(unloaded.y0 - 6.710473) < 1e-5, `unloaded y0 ${unloaded.y0}`);
  assert.ok(Math.abs(unloaded.y1 - 6.441877) < 1e-5, `unloaded y1 ${unloaded.y1}`);

  // Level 2 (q=low distant state): without a deck, restart rejects flat water or stands on wrong coarse ground.
  await loadTileAt(terrain, 2, mid[0], mid[1]);
  const l2 = periodBridgePlane(road28, roads.roads, terrain);
  assert.ok(l2, 'road 28 plane exists at level 2');
  assert.equal(l2.level, 2);
  assert.ok(Math.abs(l2.y0 - 6.710473) < 1e-5);
  assert.ok(Math.abs(l2.y1 - 6.441877) < 1e-5);
  const horseL2 = new Vehicle(makeRig(), terrain, roads, -0.2, HORSE_SPEC);
  horseL2.x = -5280.9; horseL2.z = -5914.9;
  assert.equal(horseL2.restart(mid[0], mid[1], heading), true, 'horse restart on road 28 succeeds at level 2');
  assert.ok(Math.hypot(horseL2.x - mid[0], horseL2.z - mid[1]) < 0.01);
  assert.ok(Math.abs(horseL2.y - 6.576216) < 0.01, `horse stands on deck at level 2, not coarse ground: y=${horseL2.y}`);

  // Level 5 (high-mode distant state from ?at=618990.1,5109215.9,350): mid ground is -0.37 m (river).
  await loadTileAt(terrain, 5, mid[0], mid[1]);
  const midLandL5 = terrain.heightAt(mid[0], mid[1]);
  assert.ok(midLandL5 !== null && midLandL5 < -0.2, `level-5 river bed under road 28 is wet (${midLandL5})`);
  const l5 = periodBridgePlane(road28, roads.roads, terrain);
  assert.ok(l5, 'road 28 plane exists at level 5');
  assert.equal(l5.level, 5);
  const deckL5 = roads.deckHeight(mid[0], mid[1]);
  assert.ok(deckL5 !== null && Math.abs(deckL5 - 6.576216) < 1e-4, `deckHeight at level 5: ${deckL5}`);
  const horseL5 = new Vehicle(makeRig(), terrain, roads, -0.2, HORSE_SPEC);
  horseL5.x = -5280.9; horseL5.z = -5914.9;
  assert.equal(horseL5.restart(mid[0], mid[1], heading), true, 'horse restart on road 28 succeeds at level 5');
  assert.ok(Math.hypot(horseL5.x - mid[0], horseL5.z - mid[1]) < 0.01);
  assert.ok(Math.abs(horseL5.y - deckL5) < 0.01);

  const coarseMesh = roads.group.getObjectByName('timber-bridge-28');
  assert.ok(coarseMesh, 'road 28 timber mesh built at level 5');
  const coarseGeo = coarseMesh.geometry;

  // Loading level 8 refits the timber deck mesh without changing its plane heights.
  await loadFinestAt(terrain, road28.pts, 80, 8);
  roads.update(new THREE.Vector3(mid[0], 10, mid[1]));
  const l8 = periodBridgePlane(road28, roads.roads, terrain);
  assert.ok(l8 && l8.level === 8, `road 28 plane advances to level 8, got ${l8?.level}`);
  assert.ok(Math.abs(l8.y0 - 6.710473) < 1e-5);
  assert.ok(Math.abs(l8.y1 - 6.441877) < 1e-5);
  const fineMesh = roads.group.getObjectByName('timber-bridge-28');
  assert.ok(fineMesh && fineMesh.geometry !== coarseGeo, 'level-8 arrival refits timber bridge geometry');
  const deckL8 = roads.deckHeight(mid[0], mid[1]);
  assert.ok(deckL8 !== null && Math.abs(deckL8 - deckL5) < 1e-9, 'deck height stays exact across level-5 to level-8 arrival');

  // Real Terrain.evict() emits contactTile events that dirty road 28's record.
  // Keeping the fine mesh and its cached approach profile prevents both coarse downgrade and drawn/contact drift.
  const endPrev = road28.pts[road28.pts.length - 2], endLast = road28.pts[road28.pts.length - 1];
  const endDx = endLast[0] - endPrev[0], endDz = endLast[1] - endPrev[1], endLen = Math.hypot(endDx, endDz);
  const apX = endLast[0] + (endDx / endLen) * 2.5, apZ = endLast[1] + (endDz / endLen) * 2.5;
  const measureApproach = () => {
    const mesh = roads.group.getObjectByName('timber-bridge-28');
    mesh.updateMatrixWorld(true);
    const drawn = new THREE.Raycaster(new THREE.Vector3(apX, 30, apZ), new THREE.Vector3(0, -1, 0)).intersectObject(mesh)[0]?.point.y;
    const contact = roads.deckHeight(apX, apZ);
    const horseGround = horseL5.groundAt(apX, apZ, deckL8);
    return { drawn, contact, horseGround };
  };
  const preEvict = measureApproach();
  assert.ok(preEvict.drawn !== undefined && preEvict.contact !== null && preEvict.horseGround !== null);
  assert.ok(Math.abs(preEvict.drawn - preEvict.horseGround) < 0.02, `pre-eviction approach sync: drawn=${preEvict.drawn} horse=${preEvict.horseGround}`);

  const fineGeo = fineMesh.geometry;
  const contactRevBeforeEvict = terrain.contactRevision;
  terrain.frame += 1000;
  for (const tile of terrain.tiles.values()) {
    if (tile.level > 5) {
      if (tile.mesh) tile.mesh.visible = false;
      tile.lastUsed = 0;
    } else {
      if (tile.mesh) tile.mesh.visible = true;
      tile.lastUsed = terrain.frame;
    }
  }
  terrain.wantedCount = 0;
  terrain.readyCount = 1000;
  terrain.evict();
  assert.equal(terrain.levelAt(mid[0], mid[1]), 5, 'eviction dropped road 28 back to level 5');
  assert.ok(terrain.contactRevision > contactRevBeforeEvict, 'production eviction emitted real contact events');
  roads.update(new THREE.Vector3(mid[0], 10, mid[1]));
  assert.equal(roads.group.getObjectByName('timber-bridge-28').geometry, fineGeo, 'production eviction preserves the level-8 timber mesh');
  assert.equal(roads.eraDecks.get(28).level, 8, 'production eviction does not downgrade eraDeck level');
  const postEvict = measureApproach();
  assert.ok(postEvict.drawn !== undefined && postEvict.contact !== null && postEvict.horseGround !== null);
  assert.ok(Math.abs(postEvict.drawn - postEvict.horseGround) < 0.02, `post-eviction approach stays synced: drawn=${postEvict.drawn} horse=${postEvict.horseGround}`);
  assert.ok(Math.abs(postEvict.contact - preEvict.contact) < 0.01, `retained approach contact stays close: ${preEvict.contact} vs ${postEvict.contact}`);
  console.log('PASS road 28 unloaded, level 2, level 5, level 8 refit and production eviction stability');
}

// 2. Pin every Mabou and Judique 1884 bridge plane across unloaded and fine tiles.
for (const [label, base, pinned] of [
  ['mabou', mabouBase, MABOU_PLANES],
  ['judique', `${ROOT}/data/baked/areas/judique`, JUDIQUE_PLANES],
]) {
  const { terrain, roads } = await loadEraArea(base, 1.5, false);
  const bridges = roads.roads.filter(r => r.bridge);
  assert.equal(bridges.length, pinned.length, `${label} 1884 bridge count`);
  assert.deepEqual(bridges.map(r => r.id), pinned.map(p => p[0]), `${label} 1884 bridge ids`);

  // Check every bridge BEFORE loading any fine tile so shared bank tiles cannot leak across bridges.
  for (const [id, wantY0, wantY1] of pinned) {
    const road = bridges.find(r => r.id === id);
    const early = periodBridgePlane(road, roads.roads, terrain);
    assert.ok(early, `${label} road ${id} has a plane before any tiles load`);
    assert.equal(early.level, 0, `${label} road ${id} starts at level 0`);
    assert.ok(Math.abs(early.y0 - wantY0) < 1e-6, `${label} road ${id} early y0 ${early.y0} != ${wantY0}`);
    assert.ok(Math.abs(early.y1 - wantY1) < 1e-6, `${label} road ${id} early y1 ${early.y1} != ${wantY1}`);
  }
  for (const [id, wantY0, wantY1, wantLevel] of pinned) {
    const road = bridges.find(r => r.id === id);
    const plan = timberPlan(road, roads.roads);
    await loadFinestAt(terrain, [[plan.ax, plan.az], [plan.bx, plan.bz], ...road.pts], 80, 8);
    const fine = periodBridgePlane(road, roads.roads, terrain);
    assert.ok(fine, `${label} road ${id} has a plane after fine tiles load`);
    assert.equal(fine.level, wantLevel, `${label} road ${id} level ${fine.level} != ${wantLevel}`);
    assert.ok(Math.abs(fine.y0 - wantY0) < 1e-6, `${label} road ${id} y0 ${fine.y0} != ${wantY0}`);
    assert.ok(Math.abs(fine.y1 - wantY1) < 1e-6, `${label} road ${id} y1 ${fine.y1} != ${wantY1}`);
  }
  console.log(`PASS pinned all ${pinned.length} ${label} 1884 bridge planes (unloaded and fine)`);
}

// 3. Fallback guard without bridgeApproaches and cache invalidation when installed at same revision.
{
  const road = { id: 1, name: null, kind: 3, bridge: true, halfWidth: 2.1, pts: [[0, 0], [0, 20]] };
  const roads = [road];
  const terrain = {
    dataRevision: 0,
    bridgeApproaches: null,
    surfaceAt: (_x, z) => ({ ground: z < 0 ? 5 : 6, level: 5 }),
  };
  assert.equal(periodBridgePlane(road, roads, terrain), null, 'without bridgeApproaches, level < 6 stays null');

  // Installing bridgeApproaches at the same dataRevision invalidates the null cache.
  const precomputed = { id: 1, y0: 5.05, y1: 6.05, level: 6 };
  terrain.bridgeApproaches = { planeFor: r => (r.id === 1 ? precomputed : null) };
  const installed = periodBridgePlane(road, roads, terrain);
  assert.equal(installed, precomputed, 'installing bridgeApproaches invalidates stale null cache at same revision');
  assert.equal(installed.level, 5);

  // Without bridgeApproaches at level >= 6, bank sampling still works.
  terrain.bridgeApproaches = null;
  terrain.surfaceAt = (_x, z) => ({ ground: z < 0 ? 5 : 6, level: 6 });
  const sampled = periodBridgePlane(road, roads, terrain);
  assert.ok(sampled && sampled.level === 6 && Math.abs(sampled.y0 - 5.05) < 1e-9 && Math.abs(sampled.y1 - 6.05) < 1e-9);
  console.log('PASS no-approaches level-6 guard and install cache invalidation');
}

// 4. Coarse-only bridge (road 97) built early still receives a genuine apron raise when level 6 settles.
{
  const raiseLevel6Mesh = (terrain, deltaY) => {
    for (const t of terrain.tiles.values()) {
      if (t.level === 6 && t.mesh) {
        t.mesh.visible = true;
        t.mesh.material.uniforms.hideQuad.value.set(0, 0, 0, 0);
        const pos = t.mesh.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + deltaY);
        pos.needsUpdate = true;
        t.mesh.updateMatrixWorld();
      }
    }
  };

  const early = await loadEraArea(mabouBase, 1.5, false);
  const r97Early = early.roads.roads.find(r => r.id === 97);
  const mid97 = r97Early.pts[Math.floor(r97Early.pts.length / 2)];
  // Force early build at level 5 before level 6 loads.
  await loadTileAt(early.terrain, 5, mid97[0], mid97[1]);
  const beforeDeck = early.roads.deckHeight(mid97[0], mid97[1]);
  assert.ok(beforeDeck !== null, 'road 97 deck answers at level 5');
  const earlyGeoBefore = early.roads.group.getObjectByName('timber-bridge-97').geometry;

  // Load level 6 with bank triangles raised 2 m so TimberApron clearance must raise the span.
  await loadFinestAt(early.terrain, r97Early.pts, 120, 6);
  raiseLevel6Mesh(early.terrain, 2);
  early.roads.update(new THREE.Vector3(mid97[0], 60, mid97[1]));
  const afterEarly = early.roads.deckHeight(mid97[0], mid97[1]);
  assert.ok(afterEarly !== null && afterEarly > beforeDeck + 1.0, `road 97 apron raise lifted early deck (${beforeDeck} -> ${afterEarly})`);
  assert.notEqual(early.roads.group.getObjectByName('timber-bridge-97').geometry, earlyGeoBefore, 'apron raise rebuilt early deck mesh');

  // Compare with a fresh area where level 6 loads first.
  const fresh = await loadEraArea(mabouBase, 1.5, false);
  const r97Fresh = fresh.roads.roads.find(r => r.id === 97);
  await loadFinestAt(fresh.terrain, r97Fresh.pts, 120, 6);
  raiseLevel6Mesh(fresh.terrain, 2);
  fresh.roads.update(new THREE.Vector3(mid97[0], 60, mid97[1]));
  const afterFresh = fresh.roads.deckHeight(mid97[0], mid97[1]);

  assert.ok(afterFresh !== null && afterFresh > beforeDeck + 1.0, `road 97 apron raise lifted fresh deck (${beforeDeck} -> ${afterFresh})`);
  assert.ok(Math.abs(afterEarly - afterFresh) < 1e-6, `road 97 early (${afterEarly}) matches fresh (${afterFresh}) after level-6 apron raise`);
  console.log('PASS road 97 coarse-apron genuine raise continuity across early build and level-6 settle');
}
