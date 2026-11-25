import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { Buildings, buildingAppearance, buildingSites, readBuildingStyles } from '../web/src/buildings.ts';
import { applyPropertyLooks, areaPropertyLooks } from '../web/src/property-looks.ts';
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

  // Subsidiary wing must ignore dormers and attachedGarage
  const subWing = { ...baseHouse, id: 99, buildingId: 1 };
  const wingOff = new Buildings([subWing], village, 1, 0, { '1': DEFAULT_STYLE });
  const wingOn = new Buildings([subWing], village, 1, 0, {
    '1': { ...DEFAULT_STYLE, dormer: true, dormers: 3, attachedGarage: { end: false, side: 1, doors: 2 } },
  });
  assert.deepEqual(wingOn.mesh.geometry.getAttribute('position').array, wingOff.mesh.geometry.getAttribute('position').array);

  // Position-anchored rebake protection + drone roofBoxes
  const shifted = [{ ...baseHouse, id: 1622, x: 500000, y: 5000000 }];
  assert.equal(applyPropertyLooks('mabou', shifted, {}), null, 'override refuses to attach when building moved > 4 m');
  const movedId = [{ ...baseHouse, id: 99999, x: 624455.9, y: 5103425.6, eave: 2.7, ridge: 5.6 }];
  const byPos = applyPropertyLooks('mabou', movedId, {});
  assert.ok(byPos && byPos.styles['99999'] && byPos.roofBoxes.length === 1 && byPos.roofBoxes[0].ridge === 7.4,
    'position anchor follows a rebaked ID and emits raised drone roofBox');

  for (const m of [plain, withShed, shedShadow, d1, d2, d3, oneStorey, twoStorey, endOne, endTwo, withGarage, wingOff, wingOn]) {
    m.mesh.geometry.dispose();
    m.mesh.material.dispose();
  }
}

// 2. Clean-clone pack validation (runs in CI without data/)
const mabouPack = areaPropertyLooks('mabou');
assert.ok(mabouPack && mabouPack.version === 1 && mabouPack.area === 'mabou');
const rawText = JSON.stringify(mabouPack);
assert.doesNotMatch(rawText, /\b\d{1,5}\s+[A-Z][a-z]+\s+(Road|Rd|Street|St|Lane|Ln|Drive|Dr|Avenue|Ave|Highway|Hwy)\b/, 'no civic addresses in property-looks data');
const VALID_KINDS = new Set(['house', 'barn', 'shed', 'large']);
const mergedForCi = {};
for (const [id, ov] of Object.entries(mabouPack.overrides)) {
  assert.match(id, /^\d+$/, `numeric building id ${id}`);
  assert.ok(ov.group in mabouPack.groups, `unknown group ${ov.group} for building ${id}`);
  assert.ok(typeof ov.road === 'string' && ov.road.length > 0, `missing road for building ${id}`);
  assert.ok(mabouPack.groups[ov.group].roads.includes(ov.road), `road ${ov.road} not listed in group ${ov.group} for building ${id}`);
  assert.ok(Array.isArray(ov.at) && ov.at.length === 2 && ov.at.every((v) => typeof v === 'number' && Number.isFinite(v)), `invalid at coords for ${id}`);
  if (ov.kind !== undefined) assert.ok(VALID_KINDS.has(ov.kind), `invalid kind ${ov.kind} for ${id}`);
  if (ov.eave !== undefined) assert.ok(typeof ov.eave === 'number' && Number.isFinite(ov.eave) && ov.eave > 1 && ov.eave < 25, `invalid eave for ${id}`);
  if (ov.ridge !== undefined) assert.ok(typeof ov.ridge === 'number' && Number.isFinite(ov.ridge) && ov.ridge > 1.5 && ov.ridge < 35, `invalid ridge for ${id}`);
  if (ov.eave !== undefined && ov.ridge !== undefined) assert.ok(ov.ridge > ov.eave, `ridge must exceed eave for ${id}`);
  if (ov.dormer) assert.ok(!ov.roofShape || ov.roofShape === 'gable' || ov.roofShape === 'gambrel', `dormer incompatible with roofShape=${ov.roofShape} for ${id}`);
  const { group: _g, road: _r, at: _a, kind: _k, eave: _e, ridge: _ri, ...styleFields } = ov;
  mergedForCi[id] = { ...DEFAULT_STYLE, ...styleFields };
}
// Validate every override's style fields even in clean-clone CI without data/
readBuildingStyles({ version: 1, styles: mergedForCi });

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
  const MAIN_NORMAL_TRIS = 192980;
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
