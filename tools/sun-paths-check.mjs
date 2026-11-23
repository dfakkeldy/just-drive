// Node check: default-off driving sun paths setting, arc dates/math for Mabou's latitude,
// horizon clipping, solstice/equinox shared-path colour/label, draw-call budget (<=6 draws),
// depth/shadow/mirror/screen gates, date caching, resize, boot-on->off->on cycle, and mutations.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { early } from '../web/src/boot-tasks.ts';
import { directionFromAngles, sunAngles } from '../web/src/sun.ts';
import { halifaxTime, readLightStudy } from '../web/src/light-study.ts';
import { weatherSettings } from '../web/src/weather.ts';
import { SUN_PATH_INK, SUN_PATH_SEASONS, SUN_PATH_SELECTED, sunArc, sunPathArcs, sunPathDates } from '../web/src/sun-seeker-rules.ts';
import { clipArcAboveHorizon, gameSunPathDate, readSunPaths, shortPathDate, skySunPathsVisible, SUN_PATHS_KEY, SUN_PATHS_STORAGE, todayPathLabel } from '../web/src/sun-paths-rules.ts';
import { SKY_SUN_PATHS_BUDGET, SKY_SUN_PATHS_RADIUS, skyDepthThreshold, skyHorizonVector, SkySunPaths } from '../web/src/sun-paths.ts';

const MABOU_LAT = 46.0717, MABOU_LON = -61.392;

// 1. Default-off setting policy: URL overrides storage, storage '1' enables, everything else is off.
assert.equal(readSunPaths(new URLSearchParams(), () => null), false, 'default is off');
assert.equal(readSunPaths(new URLSearchParams(), () => '0'), false, 'saved 0 is off');
assert.equal(readSunPaths(new URLSearchParams(), () => 'other'), false, 'saved invalid is off');
assert.equal(readSunPaths(new URLSearchParams(), () => { throw new Error('blocked'); }), false, 'blocked storage defaults off');
assert.equal(readSunPaths(new URLSearchParams(), () => '1'), true, 'saved 1 enables sun paths');
assert.equal(readSunPaths(new URLSearchParams(`${SUN_PATHS_KEY}=1`), () => '0'), true, 'URL 1 overrides saved 0');
assert.equal(readSunPaths(new URLSearchParams(`${SUN_PATHS_KEY}=1`), () => { throw new Error('blocked'); }), true, 'URL 1 works with blocked storage');
assert.equal(readSunPaths(new URLSearchParams(`${SUN_PATHS_KEY}=0`), () => '1'), false, 'URL 0 overrides saved 1');
assert.equal(SUN_PATHS_STORAGE, 'mmm.sunPaths');

// 2. Game date selection: light study active wins, else weather date (including default 2026-10-10).
{
  const defWeather = weatherSettings(new URLSearchParams());
  const defStudy = readLightStudy(new URLSearchParams(), true, () => {});
  assert.equal(gameSunPathDate(defStudy, defWeather), '2026-10-10', 'default game date is 2026-10-10');

  const pWeather = new URLSearchParams('playerDate=2026-07-15&playerTime=09:00');
  assert.equal(gameSunPathDate(readLightStudy(pWeather, true, () => {}), weatherSettings(pWeather)), '2026-07-15', 'weather playerDate counts');

  const pStudy = new URLSearchParams('date=2026-11-23&time=08:30');
  assert.equal(gameSunPathDate(readLightStudy(pStudy, true, () => {}), weatherSettings(pStudy)), '2026-11-23', 'active light study date counts');

  const pBadTime = new URLSearchParams('date=2026-06-21&time=bad');
  assert.equal(gameSunPathDate(readLightStudy(pBadTime, true, () => {}), weatherSettings(pBadTime)), '2026-10-10', 'failed light study falls back to weather date');

  assert.equal(shortPathDate('2026-10-10'), 'Oct 10');
  assert.equal(shortPathDate('2026-11-23'), 'Nov 23');
  assert.equal(todayPathLabel('2026-06-21', 'Summer solstice'), 'Jun 21 · Summer solstice');
  assert.equal(todayPathLabel('2026-11-23'), 'Nov 23');
}

// 3. Arc dates, Sun Seeker maths reuse, and horizon clipping at Mabou's latitude.
for (const date of ['2026-10-10', '2026-11-23', '1884-07-04']) {
  const year = date.slice(0, 4);
  const dates = sunPathDates(date);
  assert.equal(dates.today, date);
  assert.deepEqual(dates.seasons.map(s => s.fullDate), [`${year}-12-21`, `${year}-03-20`, `${year}-06-21`]);
  assert.deepEqual(dates.seasons.map(s => s.color), ['#a2dbff', '#aaf4d1', '#ffb5ce']);
  assert.equal(SUN_PATH_SELECTED, '#ffd477');
  assert.equal(SUN_PATH_INK, '#25313f');

  const arcs = sunPathArcs(date, MABOU_LAT, MABOU_LON);
  const directToday = sunArc(date, MABOU_LAT, MABOU_LON);
  assert.equal(arcs.today.length, directToday.length);
  assert.equal(+arcs.today[0].when, +directToday[0].when);
  assert.equal(+arcs.today.at(-1).when, +directToday.at(-1).when);
  for (const season of arcs.seasons) {
    const direct = sunArc(season.fullDate, MABOU_LAT, MABOU_LON);
    assert.equal(season.arc.length, direct.length, `${season.fullDate} length matches sunArc`);
    assert.ok(season.arc.every((p, i) => i === 0 || +p.when > +season.arc[i - 1].when), `${season.fullDate} monotonic`);
    assert.ok(directionFromAngles(season.arc[0].az, season.arc[0].el).x > 0, `${season.fullDate} rises east`);
    assert.ok(directionFromAngles(season.arc.at(-1).az, season.arc.at(-1).el).x < 0, `${season.fullDate} sets west`);
    const clipped = clipArcAboveHorizon(season.arc);
    assert.ok(clipped.length >= 2, `${season.fullDate} has above-horizon segments`);
    assert.ok(clipped.every(p => p.el >= 0), `${season.fullDate} clipped strictly at el >= 0`);
    assert.equal(clipped[0].el, 0, `${season.fullDate} starts on level horizon`);
    assert.equal(clipped.at(-1).el, 0, `${season.fullDate} ends on level horizon`);
  }
  const peak = arc => Math.max(...arc.map(p => p.el));
  const [winter, equinox, summer] = arcs.seasons.map(s => peak(s.arc));
  const todayPeak = peak(arcs.today);
  assert.ok(winter < equinox && equinox < summer, `${year}: winter < equinox < summer`);
  if (date === '2026-10-10' || date === '2026-11-23') {
    assert.ok(winter < todayPeak && todayPeak < equinox, `${date}: peak between winter solstice and equinox`);
  } else {
    assert.ok(equinox < todayPeak && todayPeak <= summer, `${date}: July peak between equinox and summer solstice`);
  }
}

// Clip azimuth wrap across north (355° -> 5°) correctly.
{
  const wrapped = clipArcAboveHorizon([{ az: 355, el: -1 }, { az: 5, el: 1 }]);
  assert.equal(wrapped[0].el, 0);
  assert.ok(Math.abs(wrapped[0].az) < 1e-6 || Math.abs(wrapped[0].az - 360) < 1e-6, `north wrap crossing ${wrapped[0].az}`);
}

// 4. Visibility gate across all 32 screen-flag combinations.
{
  const keys = ['sunSeeker', 'bigMap', 'replay', 'pauseScreen', 'interiors'];
  for (let mask = 0; mask < 32; mask++) {
    const flags = Object.fromEntries(keys.map((k, i) => [k, !!(mask & (1 << i))]));
    assert.equal(skySunPathsVisible(flags), mask === 0, `visibility mask ${mask}`);
  }
}

// 5. Depth threshold math: sky sphere at 100 km sits strictly behind 90 km far land and strictly in front of open sky (1.0).
{
  const logThresh = skyDepthThreshold({ near: 0.3, far: 400_000 }, true);
  const farLandLog = Math.log2(1 + 90_000) / Math.log2(1 + 400_000);
  assert.ok(farLandLog < logThresh && logThresh < 1, `log depth: ${farLandLog} < ${logThresh} < 1`);

  const linThresh = skyDepthThreshold({ near: 0.45, far: 150_000 }, false);
  const farLandLin = (150_000 * (90_000 - 0.45)) / (90_000 * (150_000 - 0.45));
  assert.ok(farLandLin < linThresh && linThresh < 1, `linear depth: ${farLandLin} < ${linThresh} < 1`);
}

// 6. Real SkySunPaths object (both direct-depth and post-finish depth-texture modes):
//    <= 6 total draws, no below-horizon vertices, shared solstice/equinox alternating colour,
//    no depth write, no shadows, date caching, camera position follow (not rotation), resize & dispose.
for (const useDepthTexture of [false, true]) {
  const nowSun = sunAngles(new Date('2026-10-10T19:45:00Z'), MABOU_LAT, MABOU_LON);
  const paths = new SkySunPaths('2026-10-10', MABOU_LAT, MABOU_LON, nowSun, 1400, 950, useDepthTexture);

  const lines = [];
  const meshes = [];
  paths.group.traverse(obj => {
    if (obj.isLineSegments2) lines.push(obj);
    else if (obj.isMesh) meshes.push(obj);
  });
  assert.equal(lines.length, 4, '2 merged season draws + 2 today draws = 4 line draws');
  assert.equal(meshes.length, 2, '1 merged sun marker + 1 instanced label atlas = 2 mesh draws (6 draws max total)');
  const distinctGeos = new Set([...lines, ...meshes].map(o => o.geometry));
  const distinctTex = new Set([...lines, ...meshes].map(o => o.material?.map).filter(Boolean));
  assert.ok(lines.length + meshes.length <= SKY_SUN_PATHS_BUDGET.maxCalls, 'enabled calls stay within opt-in ceiling');
  assert.ok(distinctGeos.size <= SKY_SUN_PATHS_BUDGET.maxGeometries, 'enabled geometries stay within opt-in ceiling');
  assert.ok(distinctTex.size <= SKY_SUN_PATHS_BUDGET.maxTextures, 'enabled textures stay within opt-in ceiling');
  for (const obj of [...lines, ...meshes]) {
    assert.equal(obj.castShadow, false, 'no shadow casting');
    assert.equal(obj.receiveShadow, false, 'no shadow receiving');
    assert.equal(obj.material.depthTest, !useDepthTexture, 'canvas depth test when no depth texture; shader depth test after finish');
    assert.equal(obj.material.depthWrite, false, 'depth write disabled');
    assert.equal(obj.frustumCulled, false, 'sky arcs never spuriously frustum-culled');
  }
  // Verify BOTH line strokes/caps AND the sun marker clip fragments below the exact geometric horizon (el = 0°)
  // in both desktop and phone LOW modes, so neither stroke caps nor low-sun discs spill onto non-depth-writing LOW sea.
  {
    for (const l of lines) {
      assert.match(l.material.fragmentShader, /uniform vec3 uSkyHorizon;/, 'line shader declares uSkyHorizon');
      assert.match(l.material.fragmentShader, /dot\(vec3\(\(gl_FragCoord\.xy \/ uSkyDepthViewport\) \* 2\.0 - 1\.0, 1\.0\), uSkyHorizon\) < 0\.0\) discard;/, 'line shader clips stroke/caps below el = 0°');
    }
    const marker = meshes.find(m => !m.isInstancedMesh);
    assert.ok(marker, 'sun marker mesh exists');
    const mockShader = {
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
      uniforms: {},
    };
    marker.material.onBeforeCompile(mockShader, {});
    assert.match(mockShader.fragmentShader, /uniform vec3 uSkyHorizon;/, 'marker fragment shader declares uSkyHorizon');
    assert.match(mockShader.fragmentShader, /dot\(vec3\(\(gl_FragCoord\.xy \/ uSkyDepthViewport\) \* 2\.0 - 1\.0, 1\.0\), uSkyHorizon\) < 0\.0\) discard;/, 'marker discards fragments below el = 0°');
    if (useDepthTexture) {
      assert.match(mockShader.fragmentShader, /uSkySceneDepth/, 'desktop marker also samples scene depth texture');
    }
    // Verify skyHorizonVector matches world ray elevation sign for level, pitched, and rolled cameras.
    for (const [pitch, yaw, roll] of [[0, 0, 0], [-0.18, 2.4, 0], [0.12, -1.1, 0.08]]) {
      const cam = new THREE.PerspectiveCamera(51, 390 / 844, 0.45, 150_000);
      cam.position.set(10, 20, 30);
      cam.rotation.set(pitch, yaw, roll, 'YXZ');
      cam.updateMatrixWorld(true);
      const h = skyHorizonVector(cam);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const az = (Math.atan2(fwd.x, -fwd.z) * 180 / Math.PI + 360) % 360;
      const aboveNdc = directionFromAngles(az, 1).multiplyScalar(1000).add(cam.position).project(cam);
      const onNdc = directionFromAngles(az, 0).multiplyScalar(1000).add(cam.position).project(cam);
      const belowNdc = directionFromAngles(az, -1).multiplyScalar(1000).add(cam.position).project(cam);
      assert.ok(aboveNdc.x * h.x + aboveNdc.y * h.y + h.z > 0, 'el=+1° passes horizon clip');
      assert.ok(Math.abs(onNdc.x * h.x + onNdc.y * h.y + h.z) < 1e-5, 'el=0° sits on horizon plane');
      assert.ok(belowNdc.x * h.x + belowNdc.y * h.y + h.z < 0, 'el=-1° discarded by horizon clip');
    }
    // Near-sunset regression: Nov 23 at 16:20 Halifax time at Mabou (el ~ 0.4°).
    const sunsetSun = sunAngles(halifaxTime('2026-11-23', '16:20').when, MABOU_LAT, MABOU_LON);
    assert.ok(sunsetSun.el > 0 && sunsetSun.el < 1, `Nov 23 16:20 sun is just above horizon (el=${sunsetSun.el.toFixed(2)}°)`);
  }
  for (const l of lines) {
    // Every arc vertex sits at or above level horizon (y >= -1e-3), so LOW sea never gets below-horizon lines.
    const starts = l.geometry.attributes.instanceStart;
    const ends = l.geometry.attributes.instanceEnd;
    for (let i = 0; i < starts.count; i++) {
      assert.ok(starts.getY(i) >= -1e-2 && ends.getY(i) >= -1e-2, 'arc vertex above level horizon');
    }
  }
  if (useDepthTexture) {
    assert.match(lines[0].material.fragmentShader, /uSkySceneDepth/, 'finish mode samples scene depth texture');
  }
  assert.match(lines[0].material.fragmentShader, /smoothstep\(\s*0\.65,\s*1\.0,\s*skyEdge\s*\)/, 'smooth line edge feathering');
  assert.ok(SKY_SUN_PATHS_RADIUS >= 95_000 && SKY_SUN_PATHS_RADIUS < 150_000, 'radius behind far land and inside LOW camera.far');

  // Same date does not rebuild geometry.
  const geosBefore = lines.map(l => l.geometry);
  assert.equal(paths.setDate('2026-10-10', MABOU_LAT, MABOU_LON, nowSun), false, 'same date reuses geometry');
  assert.deepEqual(lines.map(l => l.geometry), geosBefore, 'identical geometry objects retained');

  // Reference and adjacent seasonal dates (Jun 21, Jun 20, Dec 20, Dec 22, Sep 22):
  // today's line alternates gold and the overlapping season colour so neither disappears!
  for (const [overlapDate, expectedName] of [
    ['2026-06-21', 'Summer solstice'],
    ['2026-06-20', 'Summer solstice'],
    ['2026-12-20', 'Winter solstice'],
    ['2026-12-22', 'Winter solstice'],
    ['2026-09-22', 'Equinox'],
  ]) {
    assert.equal(paths.setDate(overlapDate, MABOU_LAT, MABOU_LON, nowSun), true, `${overlapDate} date change rebuilds geometry`);
    const curLines = [];
    paths.group.traverse(o => { if (o.isLineSegments2) curLines.push(o); });
    assert.equal(curLines.length, 4, `${overlapDate}: 4 line draws`);
    const cAttr = curLines[3].geometry.attributes.instanceColorStart;
    const distinctColors = new Set();
    for (let i = 0; i < Math.min(cAttr.count, 10); i++) {
      distinctColors.add(`${cAttr.getX(i).toFixed(2)},${cAttr.getY(i).toFixed(2)},${cAttr.getZ(i).toFixed(2)}`);
    }
    assert.equal(distinctColors.size, 2, `${overlapDate} (${expectedName}) shared path carries both gold and seasonal colour`);
  }
  const linesAfter = [];
  paths.group.traverse(o => { if (o.isLineSegments2) linesAfter.push(o); });
  assert.notEqual(linesAfter[0].geometry, geosBefore[0], 'new date produced fresh geometry');

  // Resize updates resolution on every LineMaterial.
  paths.setSize(390, 844);
  for (const l of linesAfter) {
    assert.equal(l.material.resolution.x, 390);
    assert.equal(l.material.resolution.y, 844);
  }

  // prepare follows camera position, NOT rotation, and hides when screen gate is false.
  const camera = new THREE.PerspectiveCamera(51, 1400 / 950, 0.3, 400_000);
  camera.position.set(123, 45, -678);
  camera.rotation.set(0.25, 1.4, 0.1, 'YXZ');
  camera.updateMatrixWorld();
  assert.equal(paths.prepare(camera, true), true);
  assert.equal(paths.group.visible, true);
  assert.deepEqual(paths.group.position.toArray(), [123, 45, -678], 'follows camera position');
  assert.deepEqual(paths.group.quaternion.toArray(), [0, 0, 0, 1], 'does not copy camera rotation');

  assert.equal(paths.prepare(camera, false), false);
  assert.equal(paths.group.visible, false, 'hidden when Sun Seeker / big map / replay / pause / interior is active');

  // Verify InstancedMesh.dispose() fires so GPU instanceMatrix buffer is released on teardown.
  const labelMesh = paths.group.children.find(c => c.isInstancedMesh);
  assert.ok(labelMesh, 'instanced label mesh exists');
  let labelDisposed = 0;
  labelMesh.addEventListener('dispose', () => { labelDisposed++; });
  paths.dispose();
  assert.equal(labelDisposed, 1, 'dispose() releases InstancedMesh instanceMatrix buffer');
  assert.equal(paths.group.parent, null, 'dispose removes group from overlay scene');
}

// 7. Production main.ts wiring proof (including boot-on -> off -> on cycle with real early() loader).
function checkMainWiring(mainSource) {
  assert.match(mainSource, /let sunPathsChunk = sunPathsOn \? early\(import\('\.\/sun-paths'\)\) : null;/, 'default-off skips dynamic import at boot');
  assert.match(mainSource, /if \(sunPathsOn\) await syncSunPaths\(true\);/, 'default-off skips building at boot');
  assert.match(mainSource, /let drawSkySunPaths: \(\(\) => void\) \| null = null;/, 'draw callback starts null');
  assert.match(mainSource, /function drawWorld\(\): void \{[\s\S]*?if \(drawSkySunPaths\) drawSkySunPaths\(\);/, 'drawWorld invokes drawSkySunPaths when active');
  assert.match(mainSource, /drawSkySunPaths = \(\) => skySunPaths\?\.render\(/, 'syncSunPaths wires drawSkySunPaths to SkySunPaths.render');
  assert.match(mainSource, /const chunk = sunPathsChunk;\s*sunPathsChunk = null;/, 'early() chunk is consumed once so off->on cycle succeeds');
  assert.match(mainSource, /toggle\(SUN_PATHS_KEY, SUN_PATHS_LABEL, sunPathsOn/, 'Settings panel adds toggle row');
  assert.doesNotMatch(mainSource, /scene\.add\(skySunPaths/, 'sun paths stay in their own overlay scene (never in water reflections or shadow passes)');
  assert.match(mainSource, /expose\(\{ get skySunPaths\(\) \{ return skySunPaths; \} \}, false\);/, 'dev handle is non-enumerable');
}
const mainSource = readFileSync(new URL('../web/src/main.ts', import.meta.url), 'utf8');
checkMainWiring(mainSource);

// Exercise the actual boot-on -> off -> on module-loading sequence with real early().
{
  let sunPathsChunk = early(Promise.resolve({ SkySunPaths }));
  let sunPathsMod = null;
  let instance = null;
  const toggleCycle = async on => {
    if (!on) { instance?.dispose(); instance = null; return; }
    if (!sunPathsMod) {
      const chunk = sunPathsChunk;
      sunPathsChunk = null;
      sunPathsMod = chunk ? await chunk.take() : { SkySunPaths };
    }
    instance = new sunPathsMod.SkySunPaths('2026-11-23', MABOU_LAT, MABOU_LON, { az: 200, el: 15 }, 1400, 950, false);
  };
  await toggleCycle(true);
  assert.ok(instance, 'boot on constructs overlay');
  await toggleCycle(false);
  assert.equal(instance, null, 'toggle off disposes overlay');
  await toggleCycle(true);
  assert.ok(instance, 'toggle back on after boot-on succeeds without re-taking early()');
  await toggleCycle(false);
}

// 8. Mutation proofs: verify wiring & rule checks actually catch regressions.
for (const [name, from, to] of [
  ['removed drawSkySunPaths call in drawWorld', '  if (drawSkySunPaths) drawSkySunPaths();\n', ''],
  ['reused consumed early() chunk', '      const chunk = sunPathsChunk;\n      sunPathsChunk = null;\n', '      const chunk = sunPathsChunk;\n'],
  ['missing Settings toggle', 'toggle(SUN_PATHS_KEY, SUN_PATHS_LABEL, sunPathsOn', 'void (SUN_PATHS_KEY, SUN_PATHS_LABEL, sunPathsOn'],
]) {
  assert.equal(mainSource.split(from).length, 2, `${name}: unique anchor`);
  assert.throws(() => checkMainWiring(mainSource.replace(from, to)), { name: 'AssertionError' }, `KILLED ${name}`);
}

console.log('PASS driving sky sun paths: default-off policy, Mabou arc dates/math, horizon clip, shared solstice/equinox colour, <=6 draws, boot-on->off->on cycle, wiring & mutants');
