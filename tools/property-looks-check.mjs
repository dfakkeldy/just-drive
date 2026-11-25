import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { Buildings, buildingAppearance, buildingSites, readBuildingStyles } from '../web/src/buildings.ts';
import { applyPropertyLookPack, applyPropertyLooks, areaPropertyLooks } from '../web/src/property-looks.ts';
import { MabouMainSite } from '../web/src/mabou-main-site.ts';
import { PorchSite } from '../web/src/porch-site.ts';
import { BlackstoneSite } from '../web/src/blackstone-site.ts';
import { isHillsideBuilding } from '../web/src/november-buildings.ts';

const sunDir = new THREE.Vector3(37, 24, 42).normalize();
const DEFAULT_STYLE = {
  wall: '#dcd8ce', roof: '#3d4043', trim: '#f0eee7', roofMaterial: 'shingle',
  entrance: 'none', front: { end: false, side: 1 }, chimney: false, dormer: false,
  shutters: false, satelliteDish: false, skirting: false, silo: false,
};

// 1. Unit tests for new BuildingStyle fields (shed roof, storeys, dormers, attachedGarage, wing safety)
{
  const village = [0, 0];
  const baseHouse = {
    id: 1, x: 0, y: 0, ground: 10, axisDeg: 0, length: 14, width: 8, eave: 5.4, ridge: 8.2,
    footprint: [[-4, -7], [4, -7], [4, 7], [-4, 7]], roof: 'gable', kind: 'house', confidence: 0.9,
  };

  // Strict readBuildingStyles validation: accept valid new fields, reject coerced arrays and bad ranges
  const valid = readBuildingStyles({
    version: 1,
    styles: {
      '1': { ...DEFAULT_STYLE, roofShape: 'shed', storeys: 2, dormer: true, dormers: 2,
        attachedGarage: { end: false, side: 1, offset: 3.2, width: 2.8, doors: 1, door: '#e5e3db' } },
    },
  });
  assert.equal(valid['1'].roofShape, 'shed');
  assert.equal(valid['1'].storeys, 2);
  assert.equal(valid['1'].dormers, 2);
  assert.throws(() => readBuildingStyles({ version: 1, styles: { '1': { ...DEFAULT_STYLE, roofShape: ['shed'] } } }));
  assert.throws(() => readBuildingStyles({ version: 1, styles: { '1': { ...DEFAULT_STYLE, entrance: ['none'] } } }));
  assert.throws(() => readBuildingStyles({ version: 1, styles: { '1': { ...DEFAULT_STYLE, storeys: 4 } } }));
  assert.throws(() => readBuildingStyles({ version: 1, styles: { '1': { ...DEFAULT_STYLE, dormers: 4 } } }));
  assert.throws(() => readBuildingStyles({ version: 1, styles: { '1': { ...DEFAULT_STYLE, attachedGarage: { end: false, side: 2 } } } }));

  // Shed roof shape + outward normals in wall-shadows mode
  const plain = new Buildings([baseHouse], village, 1, 0, { '1': DEFAULT_STYLE });
  const withShed = new Buildings([baseHouse], village, 1, 0, { '1': { ...DEFAULT_STYLE, roofShape: 'shed' } });
  assert.notEqual(withShed.triangles, plain.triangles, 'shed roofShape changes geometry');
  const shedShadow = new Buildings([baseHouse], village, 1, 0,
    buildingAppearance('wall-shadows', false, sunDir, { '1': { ...DEFAULT_STYLE, roofShape: 'shed' } }));
  const sp = shedShadow.mesh.geometry.getAttribute('position');
  const sn = shedShadow.mesh.geometry.getAttribute('normal');
  const sc = shedShadow.mesh.geometry.getAttribute('closedWall');
  let shedClosedEnds = 0;
  for (let i = 0; i < sp.count; i += 3) {
    if (sc.getX(i) > 0 && Math.abs(sn.getY(i)) < 0.001) {
      assert.ok(sp.getX(i) * sn.getX(i) + sp.getZ(i) * sn.getZ(i) > 0, 'closed shed wall/end faces outward');
      if (Math.abs(Math.abs(sp.getZ(i)) - 7) < 0.01 && Math.abs(Math.abs(sp.getZ(i + 1)) - 7) < 0.01 && Math.abs(Math.abs(sp.getZ(i + 2)) - 7) < 0.01 &&
          Math.max(sp.getY(i), sp.getY(i + 1), sp.getY(i + 2)) > 16) {
        shedClosedEnds++;
      }
    }
  }
  assert.equal(shedClosedEnds, 2, 'both shed roof end triangles face outward and participate in closedWall');

  // Dormers scaling
  const d1 = new Buildings([baseHouse], village, 1, 0, { '1': { ...DEFAULT_STYLE, dormer: true, dormers: 1 } });
  const d2 = new Buildings([baseHouse], village, 1, 0, { '1': { ...DEFAULT_STYLE, dormer: true, dormers: 2 } });
  const d3 = new Buildings([baseHouse], village, 1, 0, { '1': { ...DEFAULT_STYLE, dormer: true, dormers: 3 } });
  assert.ok(d1.triangles > plain.triangles && d2.triangles > d1.triangles && d3.triangles > d2.triangles, '1, 2 and 3 dormers scale cleanly');

  // Storeys on both long-wall and end-wall front faces
  const oneStorey = new Buildings([baseHouse], village, 1, 0, { '1': { ...DEFAULT_STYLE, storeys: 1 } });
  const twoStorey = new Buildings([baseHouse], village, 1, 0, { '1': { ...DEFAULT_STYLE, storeys: 2 } });
  assert.ok(twoStorey.triangles > oneStorey.triangles, 'storeys override changes long-wall window rows');
  const endOne = new Buildings([baseHouse], village, 1, 0, { '1': { ...DEFAULT_STYLE, front: { end: true, side: 1 }, storeys: 1 } });
  const endTwo = new Buildings([baseHouse], village, 1, 0, { '1': { ...DEFAULT_STYLE, front: { end: true, side: 1 }, storeys: 2 } });
  assert.ok(endTwo.triangles > endOne.triangles, 'storeys override adds upper row on road-facing gable end');

  // Attached garage: finite geometry, zero coplanar overlap with front door even when centred at doorU
  const narrowGarageHouse = { ...baseHouse, length: 9.4, width: 8.8 };
  const withGarage = new Buildings([narrowGarageHouse], village, 1, 0, {
    '1': { ...DEFAULT_STYLE, front: { end: false, side: 1 }, attachedGarage: { end: false, side: 1, offset: 0, width: 2.8, doors: 1 } },
  });
  assert.ok([...withGarage.mesh.geometry.getAttribute('position').array].every(Number.isFinite));
  // Check door and garage panels at offset 0.05 on side=+1 do not overlap horizontally (along z = -u)
  const gp = withGarage.mesh.geometry.getAttribute('position');
  const panelsAtFront = [];
  for (let i = 0; i < gp.count; i += 6) {
    const xs = [0, 1, 2, 3, 4, 5].map(k => gp.getX(i + k));
    const ys = [0, 1, 2, 3, 4, 5].map(k => gp.getY(i + k));
    const zs = [0, 1, 2, 3, 4, 5].map(k => gp.getZ(i + k));
    if (xs.every(x => Math.abs(x - (4.4 + 0.05)) < 0.002) && Math.min(...ys) < 10.5 && Math.max(...ys) > 11.5) {
      panelsAtFront.push([Math.min(...zs), Math.max(...zs)]);
    }
  }
  assert.ok(panelsAtFront.length >= 2, 'both garage door and shifted entry door fit on 9.4m wall');
  for (let a = 0; a < panelsAtFront.length; a++) {
    for (let b = a + 1; b < panelsAtFront.length; b++) {
      const overlap = Math.min(panelsAtFront[a][1], panelsAtFront[b][1]) - Math.max(panelsAtFront[a][0], panelsAtFront[b][0]);
      assert.ok(overlap <= 0.001, `front door and garage panels must not overlap (overlap=${overlap})`);
    }
  }

  // Porch must follow showDoor (no porch when 4 m wall drops door) and stay clear of garage on 9.4 m wall
  const tightGarageHouse = { ...baseHouse, length: 4.0, width: 6.0 };
  const tightPlain = new Buildings([tightGarageHouse], village, 1, 0, {
    '1': { ...DEFAULT_STYLE, front: { end: false, side: 1 }, entrance: 'none', attachedGarage: { end: false, side: 1, offset: 0, width: 2.6, doors: 1 } },
  });
  const tightPorch = new Buildings([tightGarageHouse], village, 1, 0, {
    '1': { ...DEFAULT_STYLE, front: { end: false, side: 1 }, entrance: 'front porch', attachedGarage: { end: false, side: 1, offset: 0, width: 2.6, doors: 1 } },
  });
  assert.deepEqual(tightPorch.mesh.geometry.getAttribute('position').array, tightPlain.mesh.geometry.getAttribute('position').array,
    'omitted entry door must also omit its porch so the porch cannot span the garage');

  const porchGarage = new Buildings([narrowGarageHouse], village, 1, 0, {
    '1': { ...DEFAULT_STYLE, front: { end: false, side: 1 }, entrance: 'front porch', attachedGarage: { end: false, side: 1, offset: 1.5, width: 2.6, doors: 1 } },
  });
  // Verify no porch vertex (x > 4.4 + 0.15) enters the garage opening span (u in [0.2, 2.8], i.e. z in [-2.8, -0.2])
  const pgp = porchGarage.mesh.geometry.getAttribute('position');
  for (let i = 0; i < pgp.count; i++) {
    const x = pgp.getX(i), z = pgp.getZ(i);
    if (x > 4.4 + 0.15) {
      assert.ok(z >= -0.06 || z <= -2.94, `porch vertex extends in front of garage opening at z=${z}`);
    }
  }

  // Wrap-around porch must omit its return when a garage sits on the adjacent end wall (end=true, side=-1)
  const wrapWithEndGarage = new Buildings([narrowGarageHouse], village, 1, 0, {
    '1': { ...DEFAULT_STYLE, front: { end: false, side: 1 }, entrance: 'wrap-around', attachedGarage: { end: true, side: -1, offset: 0, width: 2.6, doors: 1 } },
  });
  const wgp = wrapWithEndGarage.mesh.geometry.getAttribute('position');
  for (let i = 0; i < wgp.count; i++) {
    // End wall side=-1 is at u = -L = -4.7 (z = +4.7); return box would extend to z = +6.5.
    assert.ok(wgp.getZ(i) <= 4.7 + 0.55, `wrap-around return blocks adjacent end-wall garage at z=${wgp.getZ(i)}`);
  }

  // Tall stepped-shed deck with clipped span must keep every post clear of the front garage opening
  const steppedDeckGarage = new Buildings([narrowGarageHouse], village, 1, 0, {
    '1': {
      ...DEFAULT_STYLE, steppedShed: true, windowWall: true, front: { end: false, side: 1 }, entrance: 'deck',
      attachedGarage: { end: false, side: 1, offset: -1.5, width: 2.6, doors: 1 },
    },
  });
  const sdgp = steppedDeckGarage.mesh.geometry.getAttribute('position');
  // Garage opening sits at u in [-2.8, -0.2] (z in [0.2, 2.8]); clipped deck is on the +u side (z <= 0.06).
  for (let i = 0; i < sdgp.count; i++) {
    if (sdgp.getX(i) > 4.4 + 0.15) {
      assert.ok(sdgp.getZ(i) <= 0.06 || sdgp.getZ(i) >= 2.94,
        `stepped-shed deck post/rail enters front garage opening at z=${sdgp.getZ(i)}`);
    }
  }

  // Subsidiary wing must ignore dormers and attachedGarage
  const subWing = { ...baseHouse, id: 99, buildingId: 1 };
  const wingOff = new Buildings([subWing], village, 1, 0, { '1': DEFAULT_STYLE });
  const wingOn = new Buildings([subWing], village, 1, 0, {
    '1': { ...DEFAULT_STYLE, dormer: true, dormers: 3, attachedGarage: { end: false, side: 1, doors: 2 } },
  });
  assert.deepEqual(wingOn.mesh.geometry.getAttribute('position').array, wingOff.mesh.geometry.getAttribute('position').array);

  // Position-anchored rebake protection: far move refused, closer anchor beats reused ID, ambiguous ties and contested claims refused order-independently
  const shifted = [{ ...baseHouse, id: 1622, x: 500000, y: 5000000 }];
  assert.equal(applyPropertyLooks('mabou', shifted, {}), null, 'override refuses to attach when building moved > 4 m');
  const movedId = [{ ...baseHouse, id: 99999, x: 624455.9, y: 5103425.6, eave: 2.7, ridge: 5.6 }];
  const byPos = applyPropertyLooks('mabou', movedId, {});
  assert.ok(byPos && byPos.styles['99999'] && byPos.roofBoxes.length === 1 && byPos.roofBoxes[0].ridge === 7.4,
    'position anchor follows a rebaked ID and emits raised drone roofBox');
  // Reused ID 3 m away must lose to a new ID exactly at the anchor
  const reusedVsExact = [
    { ...baseHouse, id: 1622, x: 624458.9, y: 5103425.6 },
    { ...baseHouse, id: 88888, x: 624455.9, y: 5103425.6 },
  ];
  const exactWin = applyPropertyLooks('mabou', reusedVsExact, {});
  assert.ok(exactWin && exactWin.styles['88888'] && !exactWin.styles['1622'], 'exact anchor match beats a reused ID 3 m away');
  // Equidistant candidates (both 2 m away) must be rejected as ambiguous in both input orders
  const tieA = [
    { ...baseHouse, id: 77771, x: 624453.9, y: 5103425.6 },
    { ...baseHouse, id: 77772, x: 624457.9, y: 5103425.6 },
  ];
  assert.equal(applyPropertyLooks('mabou', tieA, {}), null, 'ambiguous equidistant candidates refused');
  assert.equal(applyPropertyLooks('mabou', [...tieA].reverse(), {}), null, 'ambiguous equidistant candidates refused regardless of order');
  // Contested duplicate claim: two overrides claiming the same building must both be rejected regardless of order
  const contestedBuilding = [{ ...baseHouse, id: 55555, x: 624455.9, y: 5103425.6 }];
  const contestedPackA = {
    version: 1, area: 'test', groups: { g: { label: 'G', roads: ['Highway 19'] } },
    overrides: {
      '1': { group: 'g', road: 'Highway 19', at: [624457.9, 5103425.6], wall: '#992222', ridge: 9.5 },
      '2': { group: 'g', road: 'Highway 19', at: [624455.9, 5103425.6], wall: '#225599' },
    },
  };
  const contestedPackB = {
    ...contestedPackA,
    overrides: { '2': contestedPackA.overrides['2'], '1': contestedPackA.overrides['1'] },
  };
  assert.equal(applyPropertyLookPack(contestedPackA, contestedBuilding, {}), null, 'contested building rejects all claims (farther listed first)');
  assert.equal(applyPropertyLookPack(contestedPackB, contestedBuilding, {}), null, 'contested building rejects all claims (exact listed first)');

  for (const m of [plain, withShed, shedShadow, d1, d2, d3, oneStorey, twoStorey, endOne, endTwo, withGarage, tightPlain, tightPorch, porchGarage, wrapWithEndGarage, steppedDeckGarage, wingOff, wingOn]) {
    m.mesh.geometry.dispose();
    m.mesh.material.dispose();
  }
}

// 2. Clean-clone pack validation (runs in CI without data/)
const mabouPack = areaPropertyLooks('mabou');
assert.ok(mabouPack && mabouPack.version === 1 && mabouPack.area === 'mabou');
const ALLOWED_PACK_KEYS = new Set(['version', 'area', 'groups', 'overrides']);
const ALLOWED_GROUP_KEYS = new Set(['label', 'roads']);
const ALLOWED_OVERRIDE_KEYS = new Set([
  'group', 'road', 'at', 'kind', 'eave', 'ridge',
  'wall', 'roof', 'trim', 'roofMaterial', 'entrance', 'chimney', 'dormer', 'shutters',
  'satelliteDish', 'skirting', 'silo', 'door', 'rollUpDoor', 'boardAndBatten', 'metalCladding',
  'bareEnd', 'barnDoors', 'solarSide', 'steppedShed', 'windowWall', 'doorWindows',
  'roofShape', 'front', 'siloPosition', 'storeys', 'dormers', 'attachedGarage',
]);
const ALLOWED_BARE_END_KEYS = new Set(['side', 'wall']);
const ALLOWED_FRONT_KEYS = new Set(['end', 'side']);
const ALLOWED_GARAGE_KEYS = new Set(['end', 'side', 'offset', 'width', 'doors', 'door']);
const ALLOWED_SILO_POSITION_KEYS = new Set(['u', 'v', 'diameter', 'height']);
const assertAllowedKeys = (obj, allowed, ctx) => {
  assert.ok(obj && typeof obj === 'object' && !Array.isArray(obj), `${ctx} must be an object`);
  for (const key of Object.keys(obj)) assert.ok(allowed.has(key), `unexpected key "${key}" in ${ctx}`);
};
const VALID_KINDS = new Set(['house', 'barn', 'shed', 'large']);
function validatePack(pack) {
  assertAllowedKeys(pack, ALLOWED_PACK_KEYS, 'pack');
  for (const [gId, g] of Object.entries(pack.groups)) {
    assertAllowedKeys(g, ALLOWED_GROUP_KEYS, `group ${gId}`);
    assert.ok(typeof g.label === 'string' && g.label.length > 0, `invalid label for group ${gId}`);
    assert.ok(Array.isArray(g.roads) && g.roads.length > 0 && g.roads.every((r) => typeof r === 'string' && r.length > 0), `invalid roads for group ${gId}`);
  }
  const rawText = JSON.stringify(pack);
  assert.doesNotMatch(rawText, /\b\d{1,5}\s+[A-Z][a-z]+\s+(Road|Rd|Street|St|Lane|Ln|Drive|Dr|Avenue|Ave|Highway|Hwy)\b/, 'no civic addresses in property-looks data');
  const merged = {};
  for (const [id, ov] of Object.entries(pack.overrides)) {
    assertAllowedKeys(ov, ALLOWED_OVERRIDE_KEYS, `override ${id}`);
    if (ov.bareEnd !== undefined) assertAllowedKeys(ov.bareEnd, ALLOWED_BARE_END_KEYS, `override ${id}.bareEnd`);
    if (ov.front !== undefined) assertAllowedKeys(ov.front, ALLOWED_FRONT_KEYS, `override ${id}.front`);
    if (ov.attachedGarage !== undefined) assertAllowedKeys(ov.attachedGarage, ALLOWED_GARAGE_KEYS, `override ${id}.attachedGarage`);
    if (ov.siloPosition !== undefined) assertAllowedKeys(ov.siloPosition, ALLOWED_SILO_POSITION_KEYS, `override ${id}.siloPosition`);
    assert.match(id, /^\d+$/, `numeric building id ${id}`);
    assert.ok(ov.group in pack.groups, `unknown group ${ov.group} for building ${id}`);
    assert.ok(typeof ov.road === 'string' && ov.road.length > 0, `missing road for building ${id}`);
    assert.ok(pack.groups[ov.group].roads.includes(ov.road), `road ${ov.road} not listed in group ${ov.group} for building ${id}`);
    assert.ok(Array.isArray(ov.at) && ov.at.length === 2 && ov.at.every((v) => typeof v === 'number' && Number.isFinite(v)), `invalid at coords for ${id}`);
    if (ov.kind !== undefined) assert.ok(VALID_KINDS.has(ov.kind), `invalid kind ${ov.kind} for ${id}`);
    if (ov.eave !== undefined) assert.ok(typeof ov.eave === 'number' && Number.isFinite(ov.eave) && ov.eave > 1 && ov.eave < 25, `invalid eave for ${id}`);
    if (ov.ridge !== undefined) assert.ok(typeof ov.ridge === 'number' && Number.isFinite(ov.ridge) && ov.ridge > 1.5 && ov.ridge < 35, `invalid ridge for ${id}`);
    if (ov.eave !== undefined && ov.ridge !== undefined) assert.ok(ov.ridge > ov.eave, `ridge must exceed eave for ${id}`);
    if (ov.dormer) assert.ok(!ov.roofShape || ov.roofShape === 'gable' || ov.roofShape === 'gambrel', `dormer incompatible with roofShape=${ov.roofShape} for ${id}`);
    const { group: _g, road: _r, at: _a, kind: _k, eave: _e, ridge: _ri, ...styleFields } = ov;
    merged[id] = { ...DEFAULT_STYLE, ...styleFields };
  }
  readBuildingStyles({ version: 1, styles: merged });
}
validatePack(mabouPack);
// Verify nested allowlists reject extra fields on bareEnd and siloPosition
assert.throws(() => validatePack({
  version: 1, area: 'test', groups: { g: { label: 'G', roads: ['Highway 19'] } },
  overrides: { '1': { group: 'g', road: 'Highway 19', at: [0, 0], bareEnd: { side: 1, wall: '#cccccc', extra: 'x' } } },
}), /unexpected key "extra"/);
assert.throws(() => validatePack({
  version: 1, area: 'test', groups: { g: { label: 'G', roads: ['Highway 19'] } },
  overrides: { '1': { group: 'g', road: 'Highway 19', at: [0, 0], silo: true, siloPosition: { u: 0, v: 0, diameter: 4, height: 8, extra: 'x' } } },
}), /unexpected key "extra"/);

// 3. Land-backed validation & triangle budget check when data/baked/terrain is present
const terrainDir = 'data/baked/terrain';
if (fs.existsSync(`${terrainDir}/manifest.json`)) {
  const read = (f) => JSON.parse(fs.readFileSync(`${terrainDir}/${f}`, 'utf8'));
  const manifest = read('manifest.json');
  const rawBuildings = read('buildings.json').buildings;
  const bakedStyles = readBuildingStyles(read('building-styles.json'));
  const roads = read('roads.json').roads;
  const roadById = new Map(roads.map((r) => [r.id, r.name || '(unnamed)']));

  const sites = buildingSites(rawBuildings);
  const siteById = new Map(sites.map((b) => [String(b.id), b]));
  const mabouSite = new MabouMainSite(manifest.village);
  const handReplaced = new Set([
    ...[...mabouSite.replaced(rawBuildings)].map(String),
    String(PorchSite.find(rawBuildings)?.id ?? ''),
    String(BlackstoneSite.find(rawBuildings)?.id ?? ''),
    ...rawBuildings.filter(isHillsideBuilding).map((b) => String(b.id)),
  ]);

  const applied = applyPropertyLooks('mabou', rawBuildings, bakedStyles);
  const overrideCount = Object.keys(mabouPack.overrides).length;
  assert.ok(applied && Object.keys(applied.styles).length === overrideCount, 'every override matched its anchored property');
  readBuildingStyles({ version: 1, styles: applied.styles });

  for (const [id, ov] of Object.entries(mabouPack.overrides)) {
    const site = siteById.get(id);
    assert.ok(site, `building ${id} is not a Mabou property site`);
    assert.ok(!handReplaced.has(id), `building ${id} is already hand-built and must not be overridden`);
    const dist = Math.hypot(site.x - ov.at[0], site.y - ov.at[1]);
    assert.ok(dist <= 0.5, `building ${id} anchor off by ${dist.toFixed(2)} m`);
    const actualRoad = roadById.get(site.nearRoad) ?? '(unnamed)';
    assert.equal(ov.road, actualRoad, `building ${id} road mismatch: ${ov.road} vs ${actualRoad}`);
    // Verify dormers actually render on the effective roof shape (survey roof overridden if shed/flat)
    if (ov.dormer) {
      const effShape = ov.roofShape ?? site.roof;
      assert.ok(effShape === 'gable' || effShape === 'gambrel', `building ${id} requests dormer on ${effShape} roof`);
    }
  }

  // Exact triangle budget check against the pre-property-looks main baseline (normal + wall-shadows desktop + 7 phone views)
  const MAIN_NORMAL_TRIS = 192640;
  const MAIN_DESKTOP_TRIS = 192640;
  const MAIN_PHONE_TRIS = {
    'village-start': 56258,
    'harbour-water': 49644,
    'mines-lookoff-south': 49862,
    'works-yard': 49780,
    'highway19-far-land': 58452,
    'animal-home': 49862,
    'new-player-start': 57794,
  };
  const porchBox = PorchSite.find(rawBuildings);
  const blackstoneBox = BlackstoneSite.find(rawBuildings);
  const afterBuildings = mabouSite.drawn(applied.buildings.filter((b) =>
    b !== porchBox && b !== blackstoneBox && !isHillsideBuilding(b)));
  const afterStyles = { ...bakedStyles, ...applied.styles };

  const nextNormal = new Buildings(afterBuildings, manifest.village, 1.5, -0.2, afterStyles);
  assert.ok(nextNormal.triangles <= MAIN_NORMAL_TRIS,
    `normal Buildings triangles exceeded main baseline: ${nextNormal.triangles} > ${MAIN_NORMAL_TRIS}`);

  const nextDesk = new Buildings(afterBuildings, manifest.village, 1.5, -0.2, buildingAppearance('wall-shadows', false, sunDir, afterStyles));
  assert.ok(nextDesk.triangles <= MAIN_DESKTOP_TRIS,
    `desktop Buildings triangles exceeded main baseline: ${nextDesk.triangles} > ${MAIN_DESKTOP_TRIS}`);

  const nextLow = new Buildings(afterBuildings, manifest.village, 1.5, -0.2, buildingAppearance('wall-shadows', true, sunDir, afterStyles));
  const mabouCams = [
    ['village-start', 624230, 5103300],
    ['harbour-water', 619062.3, 5104643.4],
    ['mines-lookoff-south', 618976, 5109274],
    ['works-yard', 620525.2, 5099315.9],
    ['highway19-far-land', 624467.1, 5103372.3],
    ['animal-home', 619012, 5109310],
    ['new-player-start', manifest.village[0], manifest.village[1]],
  ];
  const cam = new THREE.PerspectiveCamera();
  for (const [name, east, north] of mabouCams) {
    cam.position.set(east - manifest.village[0], 10, manifest.village[1] - north);
    cam.updateMatrixWorld();
    nextLow.mesh.onBeforeRender(null, null, cam);
    const nTris = nextLow.mesh.geometry.drawRange.count / 3;
    const cap = MAIN_PHONE_TRIS[name];
    assert.ok(nTris <= cap,
      `phone ${name} Buildings triangles exceeded main baseline: ${nTris} > ${cap}`);
  }
  console.log(`PASS property-looks: ${overrideCount} Mabou overrides; normal tris ${nextNormal.triangles} <= ${MAIN_NORMAL_TRIS}; wall-shadows desktop ${nextDesk.triangles} <= ${MAIN_DESKTOP_TRIS}; drone roofBoxes=${applied.roofBoxes.length}; all 7 phone views <= baseline`);
  for (const m of [nextNormal, nextDesk, nextLow]) {
    m.mesh.geometry.dispose();
    m.mesh.material.dispose();
  }
} else {
  console.log(`PASS property-looks (no land data): ${Object.keys(mabouPack.overrides).length} Mabou overrides validated`);
}
