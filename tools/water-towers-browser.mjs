// Fixed-camera browser check for municipal water towers, standpipes, reservoirs and small tanks:
// desktop and phone LOW, day and night, paired shown/hidden render deltas (1 draw call, 0 new programs/textures),
// raycast visibility of each standing landmark, removal of bogus tall-strait masts, and zero meshes in Mabou.
// Start only through tools/yard-shots.sh.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { open, sleep } from './cdp.mjs';

const [out, ...urls] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

// Raycast target [east, north, heightAboveGround] for views where a water tower or tank must be unobstructed.
const TARGETS = {
  'pitt-day': [628035.4, 5052689.2, 13.0],
  'pitt-night': [628035.4, 5052689.2, 13.0],
  'pitt-phone': [628035.4, 5052689.2, 13.0],
  'hastings-day': [624319.1, 5056590.7, 8.5],
  'mulgrave-n-day': [624283.5, 5052676.2, 8.0],
  'mulgrave-s-day': [624088.4, 5052187.7, 3.8],
  'porthood-day': [613850.5, 5097469.5, 4.5],
  'paintst-day': [629715.1, 5052506.0, 5.2],
};

async function waitSettled(c, url) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const pending = await c.read('mmm.terrain.pending + (mmm.grass?.pending ?? 0) + (mmm.trees?.pending ?? 0)');
    if (pending === 0) {
      return c.read(`new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const r = mmm.renderer;
          resolve({
            calls: r.info.render.calls,
            triangles: r.info.render.triangles,
            geometries: r.info.memory.geometries,
            textures: r.info.memory.textures,
            programs: r.info.programs.length,
          });
        }));
      })`);
    }
    await sleep(300);
  }
  throw new Error(`${url}: view did not settle within 60 s`);
}

async function checkVisible(c, name) {
  const target = TARGETS[name];
  if (!target) return null;
  const [e, n, lift] = target;
  const vis = await c.read(`(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const m = mmm;
    const grp = m.scene.getObjectByName('water towers');
    if (!grp) return { hit: false, reason: 'no group' };
    const [VE, VN] = m.terrain.manifest.village;
    const tx = ${e} - VE, tz = VN - ${n};
    const ty = (m.terrain.heightAt(tx, tz) ?? 0) + ${lift};
    const pt = new THREE.Vector3(tx, ty, tz);
    const ndc = pt.clone().project(m.camera);
    const dir = pt.clone().sub(m.camera.position);
    const dist = dir.length();
    dir.normalize();
    const rc = new THREE.Raycaster(m.camera.position, dir, 0.5, dist + 25);
    const hits = rc.intersectObject(grp, true);
    if (!hits.length) return { hit: false, ndc: [+ndc.x.toFixed(2), +ndc.y.toFixed(2)], dist: +dist.toFixed(1) };
    const hitDist = hits[0].distance;
    const terrainMeshes = [];
    m.terrain.group.traverseVisible(o => { if (o.isMesh) terrainMeshes.push(o); });
    const tHits = new THREE.Raycaster(m.camera.position, dir, 0.5, hitDist - 0.5).intersectObjects(terrainMeshes, false);
    return {
      hit: true,
      ndc: [+ndc.x.toFixed(2), +ndc.y.toFixed(2)],
      dist: +dist.toFixed(1),
      hitDist: +hitDist.toFixed(1),
      occluded: tHits.length > 0,
    };
  })()`);
  assert.ok(vis.hit, `${name}: raycast missed water towers mesh (${JSON.stringify(vis)})`);
  assert.ok(!vis.occluded, `${name}: terrain occluded water tower (${JSON.stringify(vis)})`);
  assert.ok(Math.abs(vis.ndc[0]) <= 0.9 && Math.abs(vis.ndc[1]) <= 0.9, `${name}: target out of frame (${JSON.stringify(vis.ndc)})`);
  return vis;
}

const results = [];
for (const url of urls) {
  const q = new URL(url).searchParams;
  const name = q.get('name') ?? 'view';
  const phone = q.get('touch') === '1';
  const expectZero = q.get('expect') === '0';
  const c = await open(url);
  try {
    if (phone) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await c.navigate(url);
    }
    const shown = await waitSettled(c, url);
    assert.equal(c.errors.length, 0, `${name}: page errors ${JSON.stringify(c.errors)}`);
    const info = await c.read(`(() => {
      const m = mmm, grp = m.scene.getObjectByName('water towers');
      const meshes = grp ? grp.children.length : 0;
      const bogusMasts = m.tall ? m.tall.solids.filter(s =>
        [[628035.91,5052687.54],[629725.71,5053075.14],[624284.91,5052673.34],[624089.01,5052185.64]]
          .some(([e,n]) => Math.hypot(s.x - (e - m.terrain.manifest.village[0]), s.z - (m.terrain.manifest.village[1] - n)) < 20)
      ).length : 0;
      return { area: m.area.id, meshes, solids: m.waterTowers?.solids.length ?? 0, bogusMasts };
    })()`);

    if (expectZero) {
      assert.equal(info.meshes, 0, `${name}: expected 0 water tower meshes in ${info.area}`);
      assert.equal(info.solids, 0, `${name}: expected 0 water tower solids in ${info.area}`);
      console.log(`PASS ${name}`, JSON.stringify({ ...info, shown }));
      results.push({ name, ...info, shown });
      continue;
    }

    assert.equal(info.meshes, 1, `${name}: expected single merged water towers mesh`);
    assert.equal(info.bogusMasts, 0, `${name}: bogus water-tower masts must be absent from tall`);
    const vis = await checkVisible(c, name);
    await c.shot(`${out}/${name}.png`);

    // Exact same-frame shown vs hidden render delta (no AI car or sky drift between frames).
    const pairStats = await c.read(`(() => {
      const m = mmm, r = m.renderer, grp = m.scene.getObjectByName('water towers');
      const prevAuto = r.info.autoReset;
      r.info.autoReset = false;
      const measureOnce = (vis) => {
        if (grp) grp.visible = vis;
        r.info.reset();
        r.render(m.scene, m.camera);
        return {
          calls: r.info.render.calls,
          triangles: r.info.render.triangles,
          geometries: r.info.memory.geometries,
          textures: r.info.memory.textures,
          programs: r.info.programs.length,
        };
      };
      const on = measureOnce(true);
      const off = measureOnce(false);
      if (grp) grp.visible = true;
      r.info.autoReset = prevAuto;
      return { on, off };
    })()`);
    if (q.get('pair') === '1') {
      await c.read(`(() => { const g = mmm.scene.getObjectByName('water towers'); if (g) g.visible = false; mmm.renderer.render(mmm.scene, mmm.camera); return true; })()`);
      await c.shot(`${out}/${name}-hidden.png`);
      await c.read(`(() => { const g = mmm.scene.getObjectByName('water towers'); if (g) g.visible = true; return true; })()`);
    }

    const delta = {
      calls: pairStats.on.calls - pairStats.off.calls,
      triangles: pairStats.on.triangles - pairStats.off.triangles,
      programs: pairStats.on.programs - pairStats.off.programs,
      textures: pairStats.on.textures - pairStats.off.textures,
    };
    const maxCalls = phone ? 1 : 2; // Desktop shadow map adds 1 shadow-pass draw for the single merged mesh.
    assert.ok(delta.calls >= 0 && delta.calls <= maxCalls, `${name}: expected <=${maxCalls} draw call delta, got ${delta.calls}`);
    assert.equal(delta.programs, 0, `${name}: expected 0 new shader programs, got ${delta.programs}`);
    assert.equal(delta.textures, 0, `${name}: expected 0 new textures, got ${delta.textures}`);
    if (TARGETS[name]) {
      assert.ok(delta.calls >= 1 && delta.calls <= maxCalls, `${name}: expected 1..${maxCalls} draw calls when water tower is in view, got ${delta.calls}`);
      const triCap = phone ? 4000 : 23000;
      assert.ok(delta.triangles > 0 && delta.triangles <= triCap, `${name}: triangles delta ${delta.triangles} outside (0, ${triCap}]`);
    }
    console.log(`PASS ${name}`, JSON.stringify({ ...info, vis, delta, shown }));
    results.push({ name, ...info, vis, delta, shown });
  } finally {
    await c.close();
  }
}

writeFileSync(`${out}/receipt.json`, JSON.stringify(results, null, 2));
