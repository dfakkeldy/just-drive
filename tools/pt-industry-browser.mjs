// Fixed-camera Point Tupper industrial site browser check: desktop & phone, day & night,
// paired on/off whole-frame render deltas after full tile settle, and zero meshes outside Point Tupper.
// Start only through tools/yard-shots.sh.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { open, sleep } from './cdp.mjs';

const [out, ...urls] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

async function measure(url) {
  const q = new URL(url).searchParams;
  const phone = q.get('touch') === '1';
  const c = await open(url);
  try {
    if (phone) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await c.navigate(url);
    }
    // Wait until streaming terrain/grass/trees finish loading and two consecutive whole frames match.
    const deadline = Date.now() + 60000;
    let settled = null;
    while (Date.now() < deadline && !settled) {
      await sleep(500);
      const pending = await c.read('mmm.terrain.pending + (mmm.grass?.pending ?? 0) + (mmm.trees?.pending ?? 0)');
      if (pending > 0) continue;
      const sample = await c.read(`new Promise((resolve) => {
        const m = mmm, r = m.renderer, gl = r.getContext();
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const grp = m.scene.getObjectByName('Point Tupper industry');
        const meshes = grp ? grp.children.map(o => ({ name: o.name, count: o.isInstancedMesh ? o.count : 1 })) : [];
        const prevAuto = r.info.autoReset;
        r.info.autoReset = false;
        const frames = [];
        const capture = () => {
          r.info.reset();
          requestAnimationFrame(() => {
            frames.push({ calls: r.info.render.calls, triangles: r.info.render.triangles });
            if (frames.length < 3) { capture(); return; }
            r.info.autoReset = prevAuto;
            const pendingNow = m.terrain.pending + (m.grass?.pending ?? 0) + (m.trees?.pending ?? 0);
            const stable = pendingNow === 0 && frames[1].calls === frames[2].calls && frames[1].triangles === frames[2].triangles;
            resolve(stable ? {
              gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
              calls: frames[2].calls,
              triangles: frames[2].triangles,
              geometries: r.info.memory.geometries,
              textures: r.info.memory.textures,
              programs: r.info.programs.length,
              area: m.area.id,
              width: innerWidth,
              height: innerHeight,
              industryBuildMs: grp?.userData.buildMs ?? 0,
              industryMeshes: meshes,
            } : null);
          });
        };
        requestAnimationFrame(capture);
      })`);
      if (sample) settled = sample;
    }
    assert.ok(settled, `${url}: view did not settle within 60 s`);
    assert.equal(c.errors.length, 0, `page errors on ${url}: ${JSON.stringify(c.errors)}`);
    return { c, result: settled };
  } catch (err) {
    await c.close();
    throw err;
  }
}

// Target world-space verification points [east, north, yAboveSeaOrGround, isDryGround] aiming directly at each
// terminal's own rendered industrial geometry. The camera ray must hit the Point Tupper industry mesh first, with
// zero terrain mesh occlusion in front of that hit.
const TARGET_VISIBILITY = {
  'plant-desktop-day': [628901.5, 5049449.0, 50.0, true],          // 101 m concrete stack shaft
  'plant-desktop-night': [628901.5, 5049449.0, 50.0, true],        // 101 m concrete stack shaft
  'plant-phone-day': [628901.5, 5049449.0, 50.0, true],            // 101 m concrete stack shaft
  'coal-pier-desktop-day': [628603.0, 5048844.5, 13.0, false],     // Coal pier ship-unloader portal & deck
  'oil-desktop-day': [629220.0, 5048002.0, 5.0, false],            // Oil terminal Berth 1 concrete loading deck
  'oil-phone-night': [629220.0, 5048002.0, 5.0, false],            // Oil terminal Berth 1 concrete loading deck
  'paper-wharf-desktop-day': [627709.7, 5050391.9, 9.0, false],    // Paper mill wharf ship-loader tower
  'north-bulk-desktop-day': [626894.0, 5051392.0, 12.0, false],    // North bulk berth shiploader tower
};

async function checkTargetVisible(c, name) {
  const spec = TARGET_VISIBILITY[name];
  if (!spec) return null;
  const [e, n, y, isDry] = spec;
  const vis = await c.read(`(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const m = mmm;
    const grp = m.scene.getObjectByName('Point Tupper industry');
    if (!grp) return { inFrustum: false, industryHit: null, nearestTerrain: null, dist: 0 };
    const [VE, VN] = m.terrain.manifest.village;
    const tx = ${e} - VE, tz = VN - ${n};
    const ty = ${isDry} ? (m.terrain.heightAt(tx, tz) ?? 0) + ${y} : ${y};
    const target = new THREE.Vector3(tx, ty, tz);
    const ndc = target.clone().project(m.camera);
    const dir = target.clone().sub(m.camera.position);
    const dist = dir.length();
    dir.normalize();
    const rc = new THREE.Raycaster(m.camera.position, dir, 1, dist + 25);
    const indHits = rc.intersectObject(grp, true);
    const industryHit = indHits.length ? indHits[0].distance : null;
    const terrainMeshes = [];
    m.terrain.group.traverseVisible(o => { if (o.isMesh) terrainMeshes.push(o); });
    const rcTerr = new THREE.Raycaster(m.camera.position, dir, 1, (industryHit ?? dist) - 0.5);
    const tHits = rcTerr.intersectObjects(terrainMeshes, false);
    const nearestTerrain = tHits.length ? tHits[0].distance : null;
    return {
      inFrustum: Math.abs(ndc.x) < 0.95 && Math.abs(ndc.y) < 0.95 && ndc.z < 1,
      dist: +dist.toFixed(1),
      industryHit: industryHit !== null ? +industryHit.toFixed(1) : null,
      nearestTerrain: nearestTerrain !== null ? +nearestTerrain.toFixed(1) : null,
    };
  })()`);
  assert.ok(vis.inFrustum, `${name}: target structure not in camera frustum (${JSON.stringify(vis)})`);
  assert.ok(vis.industryHit !== null && Math.abs(vis.industryHit - vis.dist) < 35,
    `${name}: camera ray missed target terminal mesh (${JSON.stringify(vis)})`);
  assert.equal(vis.nearestTerrain, null, `${name}: terrain mesh occludes target terminal at ${vis.nearestTerrain} m (industry hit at ${vis.industryHit} m)`);
  return vis;
}

const summary = {};
for (const url of urls) {
  const parsed = new URL(url);
  const name = parsed.searchParams.get('name');
  const expectedArea = parsed.searchParams.get('area') ?? 'pointtupper';
  const expectOn = parsed.searchParams.get('expect') !== '0';
  const isNight = parsed.searchParams.get('time') === '22:30';

  const { c, result } = await measure(url);
  let visibility = null;
  try {
    assert.equal(result.area, expectedArea, `${name}: wrong area`);
    if (expectOn) {
      assert.ok(result.industryMeshes.length >= (isNight ? 4 : 3), `${name}: industry meshes missing`);
      assert.equal(result.industryMeshes.some((m) => m.name === 'pt-industry-lights'), isNight, `${name}: night light mesh mismatch`);
      assert.ok(result.calls > 10 && result.triangles > 10000, `${name}: whole-frame render counts missing`);
      visibility = await checkTargetVisible(c, name);
    } else {
      assert.equal(result.industryMeshes.length, 0, `${name}: unexpected industry meshes`);
    }
    await c.shot(`${out}/${name}.png`);
  } finally {
    await c.close();
  }

  let baseline = null;
  if (expectOn && parsed.searchParams.get('pair') === '1') {
    const offUrl = new URL(url);
    offUrl.searchParams.set('ptIndustry', '0');
    const off = await measure(offUrl.toString());
    baseline = off.result;
    await off.c.close();
    assert.equal(baseline.industryMeshes.length, 0, `${name} off baseline still had industry meshes`);
    const callDelta = result.calls - baseline.calls;
    const triDelta = result.triangles - baseline.triangles;
    console.log(`${name} pair: calls ${baseline.calls}->${result.calls} (${callDelta >= 0 ? '+' : ''}${callDelta}), tris ${baseline.triangles}->${result.triangles} (${triDelta >= 0 ? '+' : ''}${triDelta}), geo ${baseline.geometries}->${result.geometries}, tex ${baseline.textures}->${result.textures}, prog ${baseline.programs}->${result.programs}`);
    const maxProgDelta = isNight ? 1 : 0;
    assert.ok(result.programs - baseline.programs <= maxProgDelta, `${name}: added WebGL shader programs (${baseline.programs} -> ${result.programs})`);
    assert.equal(result.textures - baseline.textures, 0, `${name}: added GPU texture (${baseline.textures} -> ${result.textures})`);
    const maxCalls = isNight ? 10 : 8;
    assert.ok(callDelta >= 1 && callDelta <= maxCalls, `${name}: unexpected draw call delta ${callDelta} (must be 1..${maxCalls})`);
    assert.ok(triDelta >= 1000, `${name}: unexpected triangle delta ${triDelta} (expected >= 1000 visible triangles)`);
  }

  const entry = {
    ...result,
    ...(visibility ? { visibility } : {}),
    ...(baseline ? {
      off: {
        calls: baseline.calls,
        triangles: baseline.triangles,
        geometries: baseline.geometries,
        textures: baseline.textures,
        programs: baseline.programs,
      },
      delta: {
        calls: result.calls - baseline.calls,
        triangles: result.triangles - baseline.triangles,
        geometries: result.geometries - baseline.geometries,
        textures: result.textures - baseline.textures,
        programs: result.programs - baseline.programs,
      },
    } : {}),
  };
  summary[name] = entry;
  writeFileSync(`${out}/${name}.json`, JSON.stringify(entry, null, 2));
  console.log(name, JSON.stringify(entry));
}
writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
