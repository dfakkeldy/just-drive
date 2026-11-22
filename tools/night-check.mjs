// CPU-only check of the light study's night look: the palette gate, the privacy guard of the invented yard lamps
// on the real baked land, the land-shader anchors, the main.ts wiring, and the bike's batched head lamp (one beam on the
// turning fork, a lens lit only while ridden). `--mutations` proves each guard bites.
// node tools/run-node-check.mjs tools/night-check.mjs [--mutations]
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import * as rules from '../web/src/night-rules.ts';
import { HORIZON } from '../web/src/light-study.ts';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import * as night from '../web/src/night.ts';
import { createBike } from '../web/src/bike.ts';
import { TERRAIN_FRAG } from '../web/src/shaders.ts';
import { CART_TERRAIN_FRAG } from '../web/src/eras/cart-shaders.ts';
import { COAST_BLOCK_FRAG } from '../web/src/coast-block-shaders.ts';
import { buildingSites } from '../web/src/buildings.ts';

const root = process.env.MMM_ROOT ?? process.cwd();
const read = file => readFileSync(resolve(root, file), 'utf8');
const rulesSource = read('web/src/night-rules.ts'), nightSource = read('web/src/night.ts'), main = read('web/src/main.ts');
const { NIGHT_ANCHORS, NightShading } = night;

function palette(api) {
  // No night outside the study, and none while the sun is at or above the level horizon.
  for (const el of [45, 3, 0, HORIZON]) assert.equal(api.nightPalette(el, true), null, `day at ${el}°`);
  for (const el of [-1, -20]) assert.equal(api.nightPalette(el, false), null, 'no study, no night');
  assert.equal(api.nightPalette(NaN, true), null);
  // Continuous at sunset: just below the horizon the colours are today's sunset colours.
  const edge = api.nightPalette(HORIZON - 1e-6, true);
  assert.ok(edge.level < 1e-6 && edge.sunScale > .999999);
  for (const key of ['sky', 'fog', 'ground']) edge[key].forEach((v, i) => assert.ok(Math.abs(v - api.SUNSET[key][i]) < 1e-6, `${key} at sunset`));
  // Darker all the way down, then constant from the end of nautical twilight.
  let last = edge;
  for (let el = HORIZON - .5; el > -40; el -= .5) {
    const p = api.nightPalette(el, true);
    assert.ok(p.level >= last.level && p.sunScale <= last.sunScale && p.stars >= last.stars && p.glow <= last.glow, `monotone at ${el}`);
    for (const key of ['sky', 'fog']) p[key].forEach((v, i) => assert.ok(v <= last[key][i] + 1e-12, `${key} darker at ${el}`));
    last = p;
  }
  const full = api.nightPalette(-12, true);
  assert.equal(full.level, 1); assert.equal(full.sunScale, 0); assert.equal(full.glow, 0);
  full.sky.forEach((v, i) => assert.ok(Math.abs(v - api.NIGHT.sky[i]) < 1e-12));
  // Dusk (Mabou, 10 Oct 18:50, about -4.5°): the sun's own light is gone, but the land is not yet night.
  const dusk = api.nightPalette(-4.5, true);
  assert.equal(dusk.sunScale, 0); assert.ok(dusk.level > .1 && dusk.level < .5, 'dusk is between');
  // Light falls by orders of magnitude at dusk: the blend is geometric, so mid-twilight is the geometric mean.
  for (const key of ['sky', 'fog']) dusk[key].forEach((v, i) => assert.ok(Math.abs(v - api.SUNSET[key][i] ** (1 - dusk.level) * api.NIGHT[key][i] ** dusk.level) < 1e-12, `${key} geometric`));
}

/** The dusk dome (night-rules.ts DUSK): a warm horizon band under a pink one and a grey green-blue top just after sunset;
 * a deep blue-grey top over a dull orange horizon late in dusk; the night sky itself as it was. */
function dome(api) {
  const lum = c => .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
  const early = api.nightPalette(HORIZON - 1e-6, true), late = api.nightPalette(-7, true);
  assert.ok(Math.abs(late.level - api.LATE) < .06, 'about 7° down is the late dusk look');
  // Early: the bands show at full strength; warm under pink under the top, brightest at the bottom.
  assert.ok(early.warm === 1 && early.pink > .999, 'both bands at sunset');
  const [hr, hg, hb] = early.horizon, [br, bg, bb] = early.band, [zr, zg, zb] = early.zenith;
  assert.ok(hr > hg && hg > hb && hb / hr < .25, 'the horizon band is warm (orange, not pink)');
  assert.ok(br > bg && br > bb && bb / bg > .8 && bb / bg > hb / hg, 'the band above is pink (less orange than the horizon)');
  assert.ok(lum(early.horizon) > lum(early.band) && lum(early.band) > lum(early.zenith), 'bright at the horizon, dimmer upward');
  assert.ok(zb >= zg && zg > zr && zb / zr < 2 && zg / zb > .8, 'the upper dusk sky is grey green-blue, not the day\'s blue');
  // Late: the pink is gone; a deep blue-grey top over a dull orange horizon.
  assert.ok(late.pink < .02 && late.warm > .95, 'late dusk keeps the warm band and loses the pink');
  const [lr, lg, lb] = late.zenith, [or, og, ob] = late.horizon;
  assert.ok(lb > lg && lg > lr && lum(late.zenith) < lum(early.zenith) / 4, 'late top: deep blue-grey');
  assert.ok(or > og && og > ob && lum(late.horizon) > 1.5 * lum(late.zenith) && lum(late.horizon) < lum(early.horizon) / 3, 'late horizon: dull orange, brighter than the top');
  // Night: the dome is the old night sky (top .004 .008 .024, no bands), from the end of nautical twilight down.
  for (const el of [-12, -20, -40]) {
    const p = api.nightPalette(el, true);
    assert.deepEqual([...p.zenith], [.004, .008, .024], `night top at ${el}`); assert.equal(p.warm, 0); assert.equal(p.pink, 0);
  }
  let last = early;
  for (let el = HORIZON - .5; el > -40; el -= .5) {
    const p = api.nightPalette(el, true);
    assert.ok(p.warm <= last.warm && p.pink <= last.pink && p.zenith.every((v, i) => v <= last.zenith[i] + 1e-12), `dome darker at ${el}`);
    last = p;
  }
}

function town(api) {
  assert.deepEqual(api.townLight(100, 0), { stars: 1, glow: 0 }, 'no street lamps, no town light');
  const near = api.townLight(0, 12), far = api.townLight(10000, 12);
  assert.ok(near.stars < .5 && near.glow > .9, 'stars fade in town');
  assert.ok(far.stars > .98 && far.glow < .03, 'stars come back in the country');
}

function nearest(api) {
  const lamps = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 5, z: 0 }, { x: 900, z: 0 }, { x: -3, z: 0 }];
  assert.deepEqual(api.nearestLamps(lamps, 0, 0, 3, 700), [0, 4, 2]);
  assert.deepEqual(api.nearestLamps(lamps, 0, 0, 8, 700), [0, 4, 2, 1], 'reach leaves the far lamp out');
  assert.deepEqual(api.nearestLamps(lamps, 1000, 0, 2, 50), []);
  // A lamp's head is 1.5 m out along the pole's heading (props.ts rotation π - heading).
  const head = api.lampHead({ x: 0, z: 0, heading: 90 });
  assert.ok(Math.abs(head.x - 1.5) < 1e-9 && Math.abs(head.z) < 1e-9);
  const north = api.lampHead({ x: 0, z: 0, heading: 0 });
  assert.ok(Math.abs(north.z + 1.5) < 1e-9, 'north is -z');
}

/** Every baked area: the yard lamps keep their distance from every property, mailbox and box, and from the village. */
function yards(api, quiet = false) {
  const areas = [['mabou', 'data/baked/terrain'], ...['cansocauseway', 'judique', 'pointtupper', 'porthood', 'westbay'].map(a => [a, `data/baked/areas/${a}`])];
  const counts = {};
  for (const [area, dir] of areas) {
    if (!existsSync(resolve(root, dir, 'props.json'))) { if (!quiet) console.log(`SKIP ${area}: no baked props`); continue; }
    const manifest = JSON.parse(read(`${dir}/manifest.json`)), props = JSON.parse(read(`${dir}/props.json`));
    const [VE, VN] = manifest.village, world = p => ({ x: p.x - VE, z: VN - p.y });
    const buildings = manifest.buildings ? JSON.parse(read(`${dir}/${manifest.buildings.file}`)).buildings : [];
    const places = [...buildingSites(buildings).map(world), ...props.mailboxes.map(world), ...props.communityBoxes.map(world)];
    const poles = props.poles.map(p => ({ ...world(p), heading: p.heading, light: !!p.light, transformer: !!p.transformer }));
    const chosen = api.chooseYardLights(poles, { protectedPlaces: places, excluded: [], village: { x: 0, z: 0 } });
    counts[area] = chosen.length;
    assert.ok(chosen.length > 0 && chosen.length <= api.YARD_MAX, `${area}: some yard lamps`);
    for (const lamp of chosen) {
      // The lamp's head too, not only its pole.
      for (const at of [lamp, api.lampHead(lamp)]) {
        const nearest = Math.min(...places.map(p => Math.hypot(p.x - at.x, p.z - at.z)));
        assert.ok(nearest >= api.YARD_GAP, `${area}: a yard lamp ${nearest.toFixed(1)} m from a property or box`);
      }
      assert.ok(Math.hypot(lamp.x, lamp.z) >= api.YARD_FROM_VILLAGE, `${area}: yard lamp in the village`);
      assert.ok(lamp.transformer && !lamp.light);
      for (const other of chosen) if (other !== lamp) assert.ok(Math.hypot(other.x - lamp.x, other.z - lamp.z) >= api.YARD_SPACING);
    }
    assert.deepEqual(api.chooseYardLights(poles, { protectedPlaces: places, excluded: [], village: { x: 0, z: 0 } }), chosen, 'same land, same lamps');
    // An excluded box keeps lamps out of it and its margin.
    const box = [chosen[0].x - 1, chosen[0].z - 1, chosen[0].x + 1, chosen[0].z + 1];
    assert.ok(!api.chooseYardLights(poles, { protectedPlaces: places, excluded: [box], village: { x: 0, z: 0 } }).some(l => l.x === chosen[0].x && l.z === chosen[0].z), `${area}: excluded box`);
  }
  if (!quiet) console.log('YARD LAMPS ' + JSON.stringify(counts));
  return counts;
}

/** A pole just clear of a house whose lamp head (1.5 m out toward the house) is not: no lamp there. */
function headGuard(api) {
  const pole = { x: 3000, z: 0, heading: 90, light: false, transformer: true }, house = { x: 3000 + 1.5 + api.YARD_GAP - 1, z: 0 };
  const rule = { protectedPlaces: [house], excluded: [], village: { x: 0, z: 0 } };
  assert.ok(Math.hypot(house.x - pole.x, house.z - pole.z) >= api.YARD_GAP, 'the pole itself is clear');
  assert.deepEqual(api.chooseYardLights([pole], rule), [], 'the lamp head keeps the gap too');
  assert.equal(api.chooseYardLights([{ ...pole, heading: 270 }], rule).length, 1, 'turned away, the head is clear');
}

function shaders() {
  const programs = { ground: [TERRAIN_FRAG, CART_TERRAIN_FRAG], coast: [COAST_BLOCK_FRAG] };
  const shading = new NightShading(rules.nightPalette(-20, true), false), low = new NightShading(rules.nightPalette(-20, true), true);
  for (const [kind, sources] of Object.entries(programs)) for (const fragmentShader of sources) {
    const [anchor, line] = NIGHT_ANCHORS[kind];
    assert.equal(fragmentShader.split(anchor).length, 2, `${kind} anchor once`);
    for (const s of [shading, low]) {
      const material = { fragmentShader, uniforms: {} };
      s[kind === 'ground' ? 'applyGround' : 'applyCoast'](material);
      assert.equal(material.fragmentShader.split(line).length, 2, `${kind}: one added line`);
      assert.ok(material.fragmentShader.indexOf('vec3 nightLight(') < material.fragmentShader.indexOf('void main()'), `${kind}: function before main`);
      assert.ok(material.fragmentShader.includes(`nightPool[${s.pools}]`));
      for (const key of Object.keys(s.uniforms)) assert.equal(material.uniforms[key], s.uniforms[key], `${kind}: shared ${key}`);
    }
  }
  // The grass program is a template in grass.ts; its anchor must be there once.
  assert.equal(read('web/src/grass.ts').split(NIGHT_ANCHORS.grass[0]).length, 2, 'grass anchor once');
  assert.throws(() => shading.applyGround({ fragmentShader: 'void main() {}', uniforms: {} }), /anchor/);
}

function wiring() {
  // Night belongs to a chosen clock only: the light study's, or the player's own date or time. A plain page has none.
  assert.match(main, /const chosenClock = lightStudy\.active \|\| weather\.chosen;/);
  assert.match(main, /const nightLook = nightPalette\(sun\.el, chosenClock\);/);
  assert.match(main, /const nightShading = nightLook \? new NightShading\(nightLook, LOW\) : null;/);
  assert.match(main, /const night = nightShading \? new Night\(/);
  // A night has no sun to cast shadows: the terrain is made without them.
  assert.match(main, /\nconst terrain = new Terrain\([^\n]*\n[^\n]*shadows: !LOW && params\.get\('shadows'\) !== '0' && !nightLook \}\);\n/);
  assert.match(main, /directionFromAngles\(sun\.az, studyLightingElevation\(sun\.el, chosenClock\)\)/, 'the light still never comes from below');
  // The privacy inputs: every property (in world x/z), every mailbox and community box, and the sites' boxes.
  assert.match(main, /protectedPlaces: \[\.\.\.properties\.map\(b => \(\{ x: b\.x - VE, z: VN - b\.y \}\)\), \.\.\.props\.mail, \.\.\.props\.sites\]/);
  // placeBoxes (terrain.ts) is the sites' boxes, less the sites that only repaint existing roads (rough-roads.ts).
  // A site spread over many places (the bridges: one box over the whole area) gives its own boxes (sitingBoxes) there.
  assert.match(main, /excluded: \[\.\.\.placeBoxes\(terrain\.sites\), \.\.\.\(coast \? \[coast\.site\.box\] : \[\]\)\]/);
  assert.match(read('web/src/terrain.ts'), /\.filter\(s => !s\.roadPaint\)\.flatMap\(s => s\.sitingBoxes \?\? \[s\.box\]\)/);
  assert.match(read('web/src/terrain.ts'), /this\.night\?\.applyGround\(mat\);/);
  assert.match(read('web/src/terrain.ts'), /this\.paved\?\.applyGround\(material\);\n\s*this\.night\?\.applyGround\(material\);/, 'the land seen in the water is lit too');
  assert.match(read('web/src/grass.ts'), /terrain\.night\?\.applyGrass\(this\.material\);/);
  assert.match(read('web/src/coast.ts'), /terrain\.night\?\.applyCoast\(mat\);/);
  // The dome takes the palette's dusk colours and bands; cloud hides the bands as it hides the stars.
  assert.ok(nightSource.includes('nightZenith: { value: new THREE.Color().setRGB(...palette.zenith) }'), 'dome top from the palette');
  assert.ok(nightSource.includes('nightBands: { value: new THREE.Vector2(palette.warm, palette.pink) }'), 'dome bands from the palette');
  // The bands are weighted by their strengths, so at full night (both 0) the sky is the old one.
  assert.ok(nightSource.includes('col = mix(col, nightBand, nightBands.y * side *'), 'pink band weighted by its strength');
  assert.ok(nightSource.includes('col = mix(col, nightHorizon, nightBands.x * side *'), 'warm band weighted by its strength');
  assert.ok(nightSource.includes('nightBands.y * side * exp(-above * above)'), 'the band shape squares itself: pow of a negative base is undefined in GLSL');
  assert.match(main, /nightLook\.warm \*= 1 - mood\.flat; nightLook\.pink \*= 1 - mood\.flat;/);
}

/** The bike's batched head lamp: one beam on the turning fork (desktop and phone), its lens lit only while ridden. */
function bikeLamp({ Night, NightShading } = night) {
  for (const low of [false, true]) {
    const shading = new NightShading(rules.nightPalette(-20, true), low), scene = new THREE.Scene(), bike = createBike(true, low);
    const lamp = { root: new THREE.Group(), body: new THREE.Group(), brakeLights: [] };
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial());
    scene.add(bike.root, lamp.root, sky);
    const look = new Night(shading, { scene, sky, sunDir: new THREE.Vector3(0, -1, 0), car: bike, fog: { value: new THREE.Color() },
      heightAt: () => 0, level: () => 8, streets: [], yards: [], village: { x: 0, z: 0 }, when: new Date('2026-10-10T01:30:00Z'), lat: 46, lon: -61 });
    const spots = () => { const out = []; scene.traverse(o => { if (o.isSpotLight) out.push(o); }); return out; };
    assert.equal(spots().length, 1, 'one beam for the bike');
    const [beam] = spots();
    assert.ok(beam.parent === bike.headlamp.beam, 'the beam hangs on the lamp part');
    let onFork = false;
    for (let o = beam; o; o = o.parent) if (o === bike.steer.fl) onFork = true;
    assert.ok(onFork, 'the lamp part turns with the fork');
    assert.ok(bike.headlamp.lens.r > 1 && bike.headlamp.lens.b > .5, 'the ridden lens glows');
    assert.equal(shading.uniforms.nightLamp.value.w, 1, 'the land sees one cone');
    assert.equal(shading.uniforms.nightLamp.value.z, 520, 'the land sees it at one low beam\'s strength');
    const aim = steer => {
      bike.pose({ steer, spin: 0, front: 0, rear: 0, stand: 0, foot: 0, dive: 0, crash: 0, ground: 0, pitch: 0, roll: 0 });
      look.update({ getDrawingBufferSize: v => v.set(800, 600), getPixelRatio: () => 1 }, new THREE.PerspectiveCamera());
      const at = shading.uniforms.nightLampA.value.clone(), dir = shading.uniforms.nightLampDir.value.clone();
      return { at, dir, yaw: Math.atan2(-dir.x, -dir.z) };
    };
    const ahead = aim(0), turned = aim(.4);
    assert.ok(ahead.at.z < -1.17 && ahead.at.y > .6, 'the beam starts ahead of the front guard');
    assert.ok(Math.abs(ahead.yaw) < 1e-6 && ahead.dir.y < 0 && ahead.dir.y > -.06, 'straight ahead and a little down');
    assert.ok(Math.abs(turned.yaw - bike.steer.fl.rotation.y) < 1e-3 && Math.abs(turned.yaw) > .39, `the beam turns with the bars (${turned.yaw})`);
    // Another rig ridden: the bike's beam is gone and its lens dark; back on the bike, one beam again.
    look.setCar(lamp);
    assert.equal(spots().length, 0); assert.equal(bike.headlamp.lens.getHex(), 0, 'a parked bike lens is dark');
    look.setCar(bike);
    assert.equal(spots().length, 1);
  }
  // Day: the lens is a pale lens in the bike's one draw (no light, no extra draw), with the lamp attribute on its vertices.
  const bike = createBike(), glow = bike.bikeMesh.geometry.getAttribute('lampGlow');
  assert.equal(bike.headlamp.lens.getHex(), 0); assert.equal(bike.drawCalls, 2);
  const position = bike.bikeMesh.geometry.getAttribute('position'), centre = new THREE.Vector3(), v = new THREE.Vector3();
  let lens = 0, far = 0;
  for (let i = 0; i < glow.count; i++) if (glow.getX(i)) { lens++; centre.add(v.fromBufferAttribute(position, i)); }
  centre.divideScalar(lens);
  for (let i = 0; i < glow.count; i++) if (glow.getX(i)) far = Math.max(far, v.fromBufferAttribute(position, i).distanceTo(centre));
  assert.ok(lens > 50 && far < .06 && centre.y > .7 && centre.z < -.58, `one small lens on the mask: ${lens} vertices, ${far} m, ${centre.toArray()}`);
  assert.equal(bike.riderMesh.material.customProgramCacheKey(), bike.bikeMesh.material.customProgramCacheKey(), 'bike and rider share a program');
  // The lens patch finds its anchors in this three.js's standard shader, and refuses a shader without them.
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  bike.bikeMesh.material.onBeforeCompile(shader);
  assert.ok(shader.vertexShader.includes('vLampGlow = lampGlow;') && shader.fragmentShader.includes('totalEmissiveRadiance += lampLight * vLampGlow;'), 'lens patch applied');
  assert.ok(shader.uniforms.lampLight.value === bike.headlamp.lens, 'the lens colour is the uniform');
  assert.throws(() => bike.bikeMesh.material.onBeforeCompile({ uniforms: {}, vertexShader: 'void main() {}', fragmentShader: 'void main() {}' }), /anchor/);
}

palette(rules); dome(rules); town(rules); nearest(rules); yards(rules); headGuard(rules); shaders(); wiring(); bikeLamp();
console.log('PASS night look: palette gate and sunset continuity, the dusk bands, town stars, nearest lamps, yard-lamp privacy on every baked area, shader anchors, wiring, the bike head lamp.');

if (process.argv.includes('--mutations')) {
  const load = async source => {
    const out = await build({ stdin: { contents: source, resolveDir: resolve(root, 'web/src'), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
    return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
  };
  const lampSources = new Map();
  const mutants = [
    ['N1 night on every page', 'if (!studyActive || !Number.isFinite(elevation) || elevation >= HORIZON) return null;', 'if (!Number.isFinite(elevation)) return null;', palette],
    ['N2 night starts above the horizon', 'elevation >= HORIZON) return null;', 'elevation >= 2) return null;', palette],
    ['N3 linear dusk', 'a[i] ** (1 - t) * b[i] ** t', 'a[i] * (1 - t) + b[i] * t', palette],
    ['N4 no house guard', '      for (const p of grid.get(`${cx + dx},${cz + dz}`) ?? []) if (Math.hypot(p.x - q.x, p.z - q.z) < gap) return false;', '', yards],
    ['N5 guard grid too coarse', 'const reach = Math.ceil(gap / CELL);', 'const reach = 0;', yards],
    ['N6 village lamps', 'if (Math.hypot(pole.x - rule.village.x, pole.z - rule.village.z) < YARD_FROM_VILLAGE) continue;', '', yards],
    ['N7 lamp heads on the wrong side', 'z: pole.z - out * Math.cos(h)', 'z: pole.z + out * Math.cos(h)', nearest],
    ['N8 town keeps every star', 'out.stars = 1 - .8 * near * size', 'out.stars = 1', town],
    ['N9 lamp head not guarded', ' || !clear(lampHead(pole))', '', headGuard],
    ['N15 no warm band at dusk', 'warm: 1 - smooth(LATE, 1, level),', 'warm: 0,', dome],
    ['N16 night top changed', ': blend(late.zenith, NIGHT.zenith, night),', ': late.zenith,', dome],
    ['N17 the day\'s blue at dusk', 'early: { zenith: [.145, .215, .235] as RGB', 'early: { zenith: [.104, .198, .444] as RGB', dome],
    ['N18 pink all night', 'pink: 1 - smooth(.1, LATE, level),', 'pink: 1,', dome],
  ];
  // night.ts itself: the bike's batched lamp.
  const lampMutants = [
    ['N10 bike beam on the rig root', '      own.beam.add(beam, aim); beam.target = aim;', '      car.root.add(beam, aim); beam.target = aim;'],
    ['N11 bike lens never lit', '      own.lens.setRGB(...LENS.colour).multiplyScalar(LENS.strength);\n', ''],
    ['N12 parked bike lens stays lit', '    this.activeCar?.headlamp?.lens.setRGB(0, 0, 0);\n', ''],
    ['N13 bike gets no beam', '    if (own) {\n      const beam', '    if (!own) {\n      const beam'],
    ['N14 land never sees the bike beam', 'BEAM.candela * Math.max(1, this.heads.length / Math.max(1, heads.length))', 'BEAM.candela * (this.heads.length / Math.max(1, heads.length))'],
  ];
  bikeLamp(await load(nightSource)); // control: the loader itself does not break the lamp test
  for (const [name, from, to] of lampMutants) {
    assert.equal(nightSource.split(from).length, 2, `${name}: anchor`);
    mutants.push([name, null, null, bikeLamp]);
    lampSources.set(name, nightSource.replace(from, to));
  }
  for (const [name, from, to, test] of mutants) {
    if (lampSources.has(name)) {
      const api = await load(lampSources.get(name));
      assert.throws(() => test(api, true), assert.AssertionError, `${name} survived`);
      console.log(`KILLED ${name}`);
      continue;
    }
    assert.equal(rulesSource.split(from).length, 2, `${name}: anchor`);
    const api = await load(rulesSource.replace(from, to));
    assert.throws(() => test(api, true), assert.AssertionError, `${name} survived`);
    console.log(`KILLED ${name}`);
  }
  console.log(`PASS ${mutants.length} night mutants killed`);
}
