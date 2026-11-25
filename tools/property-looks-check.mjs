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

// 1. Unit tests for new BuildingStyle fields (shed roof, storeys, dormers, attachedGarage, wing safety)
{
  const village = [0, 0];
  const baseHouse = {
    id: 1, x: 0, y: 0, ground: 10, axisDeg: 0, length: 14, width: 8, eave: 5.4, ridge: 8.2,
    footprint: [[-4, -7], [4, -7], [4, 7], [-4, 7]], roof: 'gable', kind: 'house', confidence: 0.9,
  };
  const baseStyle = {
    wall: '#dcd8ce', roof: '#3d4043', trim: '#f0eee7', roofMaterial: 'shingle',
    entrance: 'none', front: { end: false, side: 1 }, chimney: false, dormer: false,
    shutters: false, satelliteDish: false, skirting: false, silo: false,
  };

  // Validate readBuildingStyles accepts new optional fields and rejects invalid values
  const valid = readBuildingStyles({
    version: 1,
    styles: {
      '1': { ...baseStyle, roofShape: 'shed', storeys: 2, dormer: true, dormers: 2,
        attachedGarage: { end: false, side: 1, offset: 3.2, width: 2.8, doors: 1, door: '#e5e3db' } },
    },
  });
  assert.equal(valid['1'].roofShape, 'shed');
  assert.equal(valid['1'].storeys, 2);
  assert.equal(valid['1'].dormers, 2);
  assert.throws(() => readBuildingStyles({ version: 1, styles: { '1': { ...baseStyle, storeys: 4 } } }));
  assert.throws(() => readBuildingStyles({ version: 1, styles: { '1': { ...baseStyle, dormers: 4 } } }));
  assert.throws(() => readBuildingStyles({ version: 1, styles: { '1': { ...baseStyle, attachedGarage: { end: false, side: 2 } } } }));

  const plain = new Buildings([baseHouse], village, 1, 0, { '1': baseStyle });
  const withShed = new Buildings([baseHouse], village, 1, 0, { '1': { ...baseStyle, roofShape: 'shed' } });
  assert.notEqual(withShed.triangles, plain.triangles, 'shed roofShape changes geometry');

  const d1 = new Buildings([baseHouse], village, 1, 0, { '1': { ...baseStyle, dormer: true, dormers: 1 } });
  const d2 = new Buildings([baseHouse], village, 1, 0, { '1': { ...baseStyle, dormer: true, dormers: 2 } });
  const d3 = new Buildings([baseHouse], village, 1, 0, { '1': { ...baseStyle, dormer: true, dormers: 3 } });
  assert.ok(d1.triangles > plain.triangles && d2.triangles > d1.triangles && d3.triangles > d2.triangles, '1, 2 and 3 dormers scale cleanly');

  const oneStorey = new Buildings([baseHouse], village, 1, 0, { '1': { ...baseStyle, storeys: 1 } });
  const twoStorey = new Buildings([baseHouse], village, 1, 0, { '1': { ...baseStyle, storeys: 2 } });
  assert.ok(twoStorey.triangles > oneStorey.triangles, 'storeys override changes window rows');

  const withGarage = new Buildings([baseHouse], village, 1, 0, {
    '1': { ...baseStyle, attachedGarage: { end: false, side: 1, offset: 3.5, doors: 2 } },
  });
  assert.ok(withGarage.triangles !== plain.triangles, 'attachedGarage alters house geometry');
  assert.ok([...withGarage.mesh.geometry.getAttribute('position').array].every(Number.isFinite));

  // Subsidiary wing must ignore dormers and attachedGarage
  const subWing = { ...baseHouse, id: 99, buildingId: 1 };
  const wingOff = new Buildings([subWing], village, 1, 0, { '1': baseStyle });
  const wingOn = new Buildings([subWing], village, 1, 0, {
    '1': { ...baseStyle, dormer: true, dormers: 3, attachedGarage: { end: false, side: 1, doors: 2 } },
  });
  assert.deepEqual(wingOn.mesh.geometry.getAttribute('position').array, wingOff.mesh.geometry.getAttribute('position').array);

  for (const m of [plain, withShed, d1, d2, d3, oneStorey, twoStorey, withGarage, wingOff, wingOn]) {
    m.mesh.geometry.dispose();
    m.mesh.material.dispose();
  }
}

// 2. Data and privacy checks on every registered area pack (works in clean-clone CI without data/)
const mabouPack = areaPropertyLooks('mabou');
assert.ok(mabouPack && mabouPack.version === 1 && mabouPack.area === 'mabou');
const rawText = JSON.stringify(mabouPack);
assert.doesNotMatch(rawText, /\b\d{1,5}\s+[A-Z][a-z]+\s+(Road|Rd|Street|St|Lane|Ln|Drive|Dr|Avenue|Ave|Highway|Hwy)\b/, 'no civic addresses in property-looks data');
for (const [id, ov] of Object.entries(mabouPack.overrides)) {
  assert.match(id, /^\d+$/, `numeric building id ${id}`);
  assert.ok(ov.group in mabouPack.groups, `unknown group ${ov.group} for building ${id}`);
  assert.ok(typeof ov.road === 'string' && ov.road.length > 0, `missing road for building ${id}`);
}

// 3. Land-backed validation & triangle budget check when data/baked/terrain is present
const terrainDir = 'data/baked/terrain';
if (fs.existsSync(`${terrainDir}/manifest.json`)) {
  const read = (f) => JSON.parse(fs.readFileSync(`${terrainDir}/${f}`, 'utf8'));
  const manifest = read('manifest.json');
  const rawBuildings = read('buildings.json').buildings;
  const bakedStyles = readBuildingStyles(read('building-styles.json'));
  const roads = read('roads.json').roads;
  const roadNames = new Set(roads.map((r) => r.name).filter(Boolean));
  roadNames.add('(unnamed)');

  const sites = buildingSites(rawBuildings);
  const siteIds = new Set(sites.map((b) => String(b.id)));
  const mabouSite = new MabouMainSite(manifest.village);
  const handReplaced = new Set([
    ...[...mabouSite.replaced(rawBuildings)].map(String),
    String(PorchSite.find(rawBuildings)?.id ?? ''),
    String(BlackstoneSite.find(rawBuildings)?.id ?? ''),
    ...rawBuildings.filter(isHillsideBuilding).map((b) => String(b.id)),
  ]);

  const applied = applyPropertyLooks('mabou', rawBuildings, bakedStyles);
  const overrideCount = Object.keys(mabouPack.overrides).length;
  if (overrideCount > 0) {
    assert.ok(applied, 'applyPropertyLooks returns overrides when non-empty');
    // Validate every merged style via readBuildingStyles
    readBuildingStyles({ version: 1, styles: applied.styles });
    for (const [id, ov] of Object.entries(mabouPack.overrides)) {
      assert.ok(siteIds.has(id), `building ${id} is not a Mabou property site`);
      assert.ok(!handReplaced.has(id), `building ${id} is already hand-built and must not be overridden`);
      assert.ok(roadNames.has(ov.road), `road "${ov.road}" not found in Mabou roads.json`);
    }
  }

  // Exact triangle budget check against the pre-property-looks main baseline (Mabou desktop + 7 phone views)
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
  const drawn = mabouSite.drawn(rawBuildings.filter((b) =>
    b !== porchBox && b !== blackstoneBox && !isHillsideBuilding(b)));
  const afterBuildings = applied ? mabouSite.drawn(applied.buildings.filter((b) =>
    b !== porchBox && b !== blackstoneBox && !isHillsideBuilding(b))) : drawn;
  const afterStyles = applied ? { ...bakedStyles, ...applied.styles } : bakedStyles;

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
  console.log(`PASS property-looks: ${overrideCount} Mabou overrides; desktop tris ${nextDesk.triangles} <= ${MAIN_DESKTOP_TRIS} (${nextDesk.triangles - MAIN_DESKTOP_TRIS}); all 7 phone views <= baseline`);
  for (const m of [nextDesk, nextLow]) {
    m.mesh.geometry.dispose();
    m.mesh.material.dispose();
  }
} else {
  console.log(`PASS property-looks (no land data): ${Object.keys(mabouPack.overrides).length} Mabou overrides validated`);
}
