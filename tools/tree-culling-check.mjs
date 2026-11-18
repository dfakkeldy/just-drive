#!/usr/bin/env node
// Run tools/check-trees.sh; WEB_PORT/CDP_PORT can override its per-checkout defaults.
// TREE_BASELINE=1 runs only the scene-graph surveys.
// TREE_SUPPLEMENT=1 repeats the live slider, elevated mutation and mask cases alone.
// TREE_DRIVE_ONLY=1 repeats the moving-camera case and stale-near mutation alone.
// Mirror rows are zero by construction: the mirror draws separate proxies.
// "off" is the new code with culling disabled, not a comparison with the old build.
// Two loads of one build can differ in shadow maps; compare pictures inside one page only.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const [out, first] = process.argv.slice(2), base = new URL(first).origin;
const supplement = Boolean(process.env.TREE_SUPPLEMENT);
const driveOnly = Boolean(process.env.TREE_DRIVE_ONLY);
mkdirSync(out, { recursive: true });
const endpoint = `http://127.0.0.1:${process.env.CDP_PORT}`;
const tab = await (await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let serial = 0;
const pending = new Map(), errors = [], rows = [], mutations = {}, motion = [];
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++serial, timer = setTimeout(() => reject(Error(`CDP timeout: ${method}`)), 180000);
  pending.set(id, m => { clearTimeout(timer); resolve(m); });
  ws.send(JSON.stringify({ id, method, params }));
});
const read = async expression => {
  const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (m.error || m.result.exceptionDetails) throw Error(JSON.stringify(m));
  return m.result.result.value;
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// This function executes in the real game page. No replacement scene or shader.
async function install(baseline = false) {
  const T = await import('/node_modules/three/build/three.module.js');
  if (T.REVISION !== '170') throw Error(`Expected three.js r170, found ${T.REVISION}`);
  const { renderer: r, terrain: t, camera: c, trees, water: w } = window.mmm;
  let scene = trees.group; while (scene.parent) scene = scene.parent;
  if (!scene.isScene) throw Error('Missing real scene');
  const start = { position: c.position.toArray(), quaternion: c.quaternion.toArray(), fov: c.fov };
  const gl = r.getContext(), originalRender = r.render.bind(r);
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const device = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  if (/swiftshader|llvmpipe|softpipe|software|basic render|warp/i.test(device)) throw Error(`Software graphics: ${device}`);
  const state = window.tc = { T, r, t, c, trees, w, scene, start, mode: 'off', counts: null, passes: null };
  const isTree = o => o.isInstancedMesh && o.geometry.hasAttribute('leafTint');
  const bounds = new WeakMap();
  const nearShapes = new Set(trees.nearShapes), firstNearBounds = new WeakMap();
  const outsideMain = (mesh, saved) => saved.box
    ? !state.mainFrustum.intersectsBox(saved.box.clone().applyMatrix4(mesh.matrixWorld))
    : saved.sphere && !state.mainFrustum.intersectsSphere(saved.sphere.clone().applyMatrix4(mesh.matrixWorld));
  const configure = mesh => {
    if (!baseline && mesh.parent === trees.group && bounds.get(mesh)?.version !== mesh.instanceMatrix.version &&
        (!mesh.frustumCulled || !mesh.boundingSphere || !mesh.boundingBox)) throw Error('Production tree missing culling bounds');
    if (bounds.get(mesh)?.version !== mesh.instanceMatrix.version) bounds.set(mesh, {
      version: mesh.instanceMatrix.version, sphere: mesh.boundingSphere?.clone(), box: mesh.boundingBox?.clone(),
    });
    const saved = bounds.get(mesh);
    const source = mesh.parent === trees.group;
    // Runtime mutation: retain the first populated near bound seen by this page,
    // while the actual game continues to repack its matrices and refresh its real bounds.
    if (source && nearShapes.has(mesh.geometry) && mesh.count && !firstNearBounds.has(mesh)) {
      firstNearBounds.set(mesh, { sphere: saved.sphere.clone(), box: saved.box.clone() });
    }
    mesh.boundingSphere = saved.sphere?.clone() ?? null;
    mesh.boundingBox = saved.box?.clone() ?? null;
    // Water's separate proxies already cull in production. Preserve that baseline
    // so the gain measures this source-tree fix, not an extra proxy optimization.
    mesh.frustumCulled = !source || state.mode !== 'off';
    if (source && state.mode === 'stale-near' && firstNearBounds.has(mesh)) {
      const first = firstNearBounds.get(mesh);
      mesh.boundingSphere = first.sphere.clone(); mesh.boundingBox = first.box.clone();
    }
    if (source && state.mode === 'half' && mesh.boundingSphere) mesh.boundingSphere.radius *= 0.5;
    if (source && state.mode === 'ignore-height') {
      // Mutate only the bound: reconstruct the CPU placements at Hill height 1.
      const box = new T.Box3(), instance = new T.Matrix4(), one = new T.Box3();
      mesh.geometry.computeBoundingBox();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, instance);
        const root = instance.elements[13] + 0.25;
        instance.elements[13] = t.seaLevel + (root - t.seaLevel) / t.exag - 0.25;
        box.union(one.copy(mesh.geometry.boundingBox).applyMatrix4(instance));
      }
      mesh.boundingBox = box; mesh.boundingSphere = box.getBoundingSphere(new T.Sphere());
    }
    const submit = pass => {
      if (!state.counts) return;
      state.counts.calls++;
      state.counts.triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 * mesh.count;
      state.counts.passes[pass] = (state.counts.passes[pass] ?? 0) + 1;
      if (pass !== 'main' && outsideMain(mesh, saved)) {
        state.counts.outsideMain[pass] = (state.counts.outsideMain[pass] ?? 0) + 1;
      }
    };
    mesh.onBeforeRender = (_r, _s, camera) => submit(camera === c ? 'main' : 'mirror');
    mesh.onBeforeShadow = () => submit('shadow');
    if (state.mode === 'main-only' && mesh.parent === trees.group && outsideMain(mesh, saved)) mesh.visible = false;
  };
  const pixels = target => {
    const previous = r.getRenderTarget();
    r.setRenderTarget(target);
    const width = target?.width ?? gl.drawingBufferWidth, height = target?.height ?? gl.drawingBufferHeight;
    const half = target?.texture.type === T.HalfFloatType;
    const data = half ? new Uint16Array(width * height * 4) : new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, half ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, data);
    const error = gl.getError(); r.setRenderTarget(previous);
    if (error) throw Error(`readPixels ${error} ${width}x${height}`);
    return { width, height, data };
  };
  r.render = (s, camera) => {
    s.traverse(o => { if (isTree(o)) configure(o); });
    originalRender(s, camera);
    if (state.passes) {
      const target = r.getRenderTarget();
      const name = target === w?.target ? 'mirror' : s === scene ? 'main' : 'water-mask';
      if (!state.capturePasses || state.capturePasses.has(name)) state.passes[name] = pixels(target);
    }
  };
  state.draw = (mode, capture = false) => {
    state.mode = mode;
    state.mainFrustum = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse));
    t.uniforms.time.value = 120; // Land/water time fixed; tree shaders have no wind displacement.
    t.update(c); trees.update(t.drawnFine, c.position);
    // A frozen RAF cannot run SunShadows' half-second flag sweep for newly loaded/near trees.
    // These opaque Lambert tree materials cast/receive under that sweep in the game.
    if (r.shadowMap.enabled) for (const mesh of trees.group.children) if (isTree(mesh)) {
      mesh.castShadow = mesh.receiveShadow = true; mesh.userData.shadowSet = true;
    }
    scene.updateMatrixWorld(true);
    trees.group.traverse(o => { if (isTree(o)) configure(o); });
    r.info.autoReset = false; r.info.reset();
    state.counts = { calls: 0, triangles: 0, passes: {}, outsideMain: {} }; state.passes = capture ? {} : null;
    state.capturePasses = Array.isArray(capture) ? new Set(capture) : null;
    r.shadowMap.needsUpdate = true;
    w?.update(c);
    try { r.render(scene, c); } finally { w?.settle(); }
    w?.afterRender(c);
    if (capture && (!state.capturePasses || state.capturePasses.has('shadow'))) scene.traverse(o => { if (o.isDirectionalLight && o.castShadow && o.shadow.map) state.passes.shadow = pixels(o.shadow.map); });
    if (gl.isContextLost()) throw Error('WebGL context lost');
    const result = { trees: state.counts, frame: { calls: r.info.render.calls, triangles: r.info.render.triangles }, passes: state.passes };
    state.counts = null; state.passes = null;
    return result;
  };
  const difference = (before, after) => {
    const differences = {};
    for (const name of new Set([...Object.keys(before.passes), ...Object.keys(after.passes)])) {
      const a = before.passes[name], b = after.passes[name];
      if (!a || !b || a.width !== b.width || a.height !== b.height) throw Error(`Pass changed: ${name}`);
      let different = 0, minX = a.width, minY = a.height, maxX = -1, maxY = -1;
      const samples = [];
      for (let p = 0; p < a.data.length; p += 4) {
        if (a.data[p] === b.data[p] && a.data[p+1] === b.data[p+1] && a.data[p+2] === b.data[p+2] && a.data[p+3] === b.data[p+3]) continue;
        different++; const x = p / 4 % a.width, y = Math.floor(p / 4 / a.width);
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        if (samples.length < 8) samples.push({ x, y, before: Array.from(a.data.subarray(p,p+4)), after: Array.from(b.data.subarray(p,p+4)) });
      }
      differences[name] = { pixels: different, ...(different ? { box: [minX,minY,maxX,maxY], samples } : {}) };
    }
    return { before: { trees: before.trees, frame: before.frame }, after: { trees: after.trees, frame: after.frame }, differences };
  };
  state.compareMany = (modes, capture = true, warm = true) => {
    // One reference buffer also serves the runtime mutations at a moving-camera step.
    if (warm) { state.draw('off'); state.draw('off'); }
    const before = state.draw('off', capture), results = {};
    for (const mode of modes) results[mode] = difference(before, state.draw(mode, capture));
    return results;
  };
  state.compare = mode => state.compareMany([mode])[mode];
  state.survey = () => {
    const frustum = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse));
    const totals = { meshes: 0, triangles: 0, outside: 0, outsideTriangles: 0 };
    for (const mesh of trees.group.children) if (isTree(mesh) && mesh.visible) {
      const original = mesh.boundingBox?.clone() ?? null;
      mesh.computeBoundingBox();
      const box = mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
      mesh.boundingBox = original; // The survey must not replace the production bound under test.
      const triangles = (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 * mesh.count;
      totals.meshes++; totals.triangles += triangles;
      if (!frustum.intersectsBox(box)) { totals.outside++; totals.outsideTriangles += triangles; }
    }
    const sun = scene.children.find(o => o.isDirectionalLight && o.castShadow);
    return { ...totals, device, position: c.position.toArray(),
      sunElevation: sun ? Math.asin(sun.position.clone().sub(sun.target.position).normalize().y) * 180 / Math.PI : null };
  };
  state.view = async view => {
    if (view.name === 'village' || view.name.startsWith('turn-')) {
      c.position.fromArray(start.position); c.quaternion.fromArray(start.quaternion); c.fov = start.fov;
      if (view.angle !== undefined) c.rotateOnWorldAxis(new T.Vector3(0,1,0), view.angle * Math.PI / 180);
    } else {
      c.position.set(view.e - t.manifest.village[0], view.y, t.manifest.village[1] - view.n);
      c.rotation.set(view.pitch * Math.PI / 180, -view.heading * Math.PI / 180, 0, 'YXZ'); c.fov = view.fov ?? 60;
    }
    c.updateProjectionMatrix(); c.updateMatrixWorld(true);
    for (let i = 0; i < 250; i++) {
      if (view.ground !== undefined) {
        c.position.y = Math.max(t.seaLevel, t.heightAt(c.position.x, c.position.z) ?? c.position.y) + view.ground;
        c.updateMatrixWorld(true);
      }
      state.draw('off');
      await new Promise(resolve => setTimeout(resolve, 40));
      if (i > 12 && !t.pending && !trees.pending) break;
      if (i === 249) throw Error('Tiles did not settle');
    }
    // CPU-populated scenery must follow the camera too. No simulation time passes.
    mmm.roads.update(c.position); mmm.coast?.update(c.position); mmm.landmarks?.update(c);
    // Refresh the real sun camera at this view, without exposing a new game hook.
    scene.traverse(o => { if (o.isDirectionalLight && o.castShadow) {
      const delta = o.position.clone().sub(o.target.position), focus = c.position.clone();
      focus.y = t.heightAt(focus.x, focus.z) ?? 0;
      o.target.position.copy(focus); o.position.copy(focus).add(delta);
      o.target.updateMatrixWorld(); o.updateMatrixWorld();
    } });
    for (let i = 0; i < 3; i++) state.draw('off');
  };
  state.drive = async phone => {
    const started = performance.now(), steps = [], packing = new Set();
    const hit = mmm.roads.nearest(c.position.x, c.position.z, 500, road => road.name === 'Highway 19' && !road.bridge);
    if (!hit) throw Error('No Highway 19 drive fixture');
    const pts = hit.road.pts, distances = [0];
    for (let i = 1; i < pts.length; i++) distances.push(distances[i-1] + Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]));
    const startDistance = distances[hit.seg] + Math.hypot(hit.x-pts[hit.seg][0], hit.z-pts[hit.seg][1]);
    const direction = distances.at(-1)-startDistance >= 490 ? 1 : -1;
    if (direction < 0 && startDistance < 490) throw Error('Road fixture needs 490 continuous metres');
    const at = distance => {
      let i = 1; while (distances[i] < distance) i++;
      const a = pts[i-1], b = pts[i], u = (distance-distances[i-1])/(distances[i]-distances[i-1]);
      return { x: a[0]+(b[0]-a[0])*u, z: a[1]+(b[1]-a[1])*u };
    };
    const place = async (position, heading, pitch, eye) => {
      c.position.x = position.x; c.position.z = position.z;
      c.rotation.set(pitch*Math.PI/180, -heading*Math.PI/180, 0, 'YXZ'); c.fov = 60; c.updateProjectionMatrix();
      let previous = '', stable = 0;
      for (let i = 0; i < 250; i++) {
        c.position.y = Math.max(t.seaLevel, t.heightAt(position.x,position.z) ?? c.position.y) + eye;
        c.updateMatrixWorld(true); state.draw('off'); gl.finish();
        // Yield for real occlusion-query results and incoming tiles, without a fixed delay at every yaw.
        await new Promise(resolve => setTimeout(resolve, t.pending || trees.pending ? 10 : 0));
        const signature = JSON.stringify([t.drawnRevision,c.position.y,w?.seaVisibility.visible,w?.landVisibility.visible]);
        stable = !t.pending && !trees.pending && signature === previous ? stable+1 : 0; previous = signature;
        if (stable >= 2) break;
        if (i === 249) throw Error('Drive tiles/query visibility did not settle');
      }
      mmm.roads.update(c.position); mmm.coast?.update(c.position); mmm.landmarks?.update(c);
      scene.traverse(light => { if (light.isDirectionalLight && light.castShadow) {
        const delta = light.position.clone().sub(light.target.position), focus = c.position.clone();
        focus.y = t.heightAt(focus.x,focus.z) ?? 0;
        light.target.position.copy(focus); light.position.copy(focus).add(delta);
        light.target.updateMatrixWorld(); light.updateMatrixWorld();
      } });
    };
    const step = async (group, i, position, heading, pitch, eye) => {
      await place(position,heading,pitch,eye);
      const compared = state.compareMany(phone ? ['on'] : ['on','stale-near'], ['main',...(phone?[]:['shadow'])], false);
      const positive = compared.on;
      if (!positive.differences.main || (!phone && !positive.differences.shadow)) throw Error('Drive pass missing');
      if (Object.values(positive.differences).some(d => d.pixels)) throw Error(`STOP drive ${group} ${i}: ${JSON.stringify(positive.differences)}`);
      let nearInstances = 0;
      for (const mesh of trees.group.children) if (mesh.visible && nearShapes.has(mesh.geometry)) nearInstances += mesh.count;
      packing.add(nearInstances);
      steps.push({group,i,position:c.position.toArray(),heading,nearInstances,
        pixels:Object.fromEntries(Object.entries(positive.differences).map(([pass,d])=>[pass,d.pixels])),
        mutation:compared['stale-near']?.differences});
    };
    await place(at(startDistance),0,-4,1.3);
    let position;
    for (let i = 0; i < 70; i++) {
      position = at(startDistance + direction*(i+1)*7);
      await step('drive',i,position,(i*47)%360,-4+(i%5)*3,i%3===2?6.5:1.3);
    }
    for (let i = 0; i < 120; i++) await step('yaw',i,position,i*3+1.5,[-25,-3,12,35][i%4],1.3);
    const caught = steps.filter(s => s.mutation && Object.values(s.mutation).some(d=>d.pixels));
    return { phone, road:hit.road.id, steps, distinctNearCounts:packing.size,
      caughtSteps:caught.length, driveCaught:caught.filter(s=>s.group==='drive').length,
      yawCaught:caught.filter(s=>s.group==='yaw').length,
      maxChangedPixels:Math.max(0,...caught.flatMap(s=>Object.values(s.mutation).map(d=>d.pixels))),
      seconds:(performance.now()-started)/1000 };
  };
}

async function load(phone, hill, extra = '') {
  await send('Emulation.setDeviceMetricsOverride', { width: phone ? 390 : 1400, height: phone ? 844 : 950, deviceScaleFactor: 1, mobile: false });
  // Pin the village instead of today's changing daily-route start.
  const start = /area=judique|route-start/.test(extra) ? '' : '&at=624271,5103301,45';
  await send('Page.navigate', { url: `${base}/?name=tree-culling&q=${phone?'low':'high'}&touch=${phone?1:0}&res=1&hud=0&radio=0&exag=${hill}&hour=17.5&shadows=1${start}${extra}` });
  await ready();
}
async function ready() {
  let settled = false;
  for (let i = 0; i < 720; i++) {
    await pause(250);
    if (await read("document.title === 'settled' && !!window.mmm?.trees")) { settled = true; break; }
  }
  assert.ok(settled, 'real page settled');
  await read('window.requestAnimationFrame = f => { window.treeFrame = f; return 0; }');
  await pause(100);
  await read(`(${install.toString()})(${Boolean(process.env.TREE_BASELINE)})`);
}
const views = [
  { name: 'village' },
  { name: 'highway-19', e: 624303.3, n: 5103261.34, y: 40, ground: 2.2, heading: 50.78, pitch: -3 },
  { name: 'harbour-mirror', e: 624000, n: 5103300, y: 3, heading: 60, pitch: -30, fov: 45 },
  { name: 'low-sun-shadow', e: 624230, n: 5103300, y: 45, ground: 2.2, heading: 325, pitch: -8 },
  { name: 'down-400m', e: 624230, n: 5103300, y: 400, heading: 0, pitch: -90 },
  ...Array.from({ length: 12 }, (_, i) => ({ name: `turn-${i*30}`, angle: i*30 })),
  ...[1,2,3,4].map(shot => ({ name: `shot-${shot}`, shot })),
];
async function sliderCheck(phone) {
  // Return to a populated village page before changing the actual UI. The high
  // canonical shot can contain no single trees after the height change.
  await load(phone, 1);
  assert.equal(await read('tc.t.exag'), 1);
  await read("document.getElementById('exag').value='2.5'; document.getElementById('exag').dispatchEvent(new Event('input')); document.getElementById('exag').dispatchEvent(new Event('change'))");
  await pause(500); await ready();
  assert.equal(await read('tc.t.exag'), 2.5);
  const row = { phone, hill: 'live-1-to-2.5', camera: 'slider', ...await read("tc.compare('on')") };
  rows.push(row); console.log('PICTURE', JSON.stringify(row));
  assert.ok(row.before.trees.calls > 0 && row.after.trees.calls > 0, 'live slider compares populated trees');
  assert.ok(Object.values(row.differences).every(d => d.pixels === 0), `STOP: ${JSON.stringify(row)}`);
}
async function heightCheck() {
  // This elevated wooded route exposes the wrong root bound in the main picture,
  // even when broad village tile boxes mask it or only the shadow map differs.
  await load(true, 2.5, '&route-start=1');
  await read("tc.view({name:'turn-240',angle:240})");
  const row = { phone: true, hill: 2.5, camera: 'elevated-route-control', ...await read("tc.compare('on')") };
  rows.push(row); console.log('PICTURE', JSON.stringify(row));
  assert.ok(Object.values(row.differences).every(d => d.pixels === 0), `STOP: ${JSON.stringify(row)}`);
  const result = await read("tc.compare('ignore-height')");
  assert.ok(result.differences.main.pixels > 0, 'unexaggerated bound must change main picture at Hill 2.5');
  mutations['ignore-height'] = { phone: true, hill: 2.5, camera: row.camera, ...result };
  console.log('REJECTED ignore-height', JSON.stringify(mutations['ignore-height']));
}
async function maskCheck() {
  await load(false, 1.5, '&cam=624000,5103300,3,60,-30,45');
  // The water-mask warm-up normally finishes before a settled photograph. Replay
  // that real pass so it also has explicit framebuffer coverage. It contains land, not trees.
  const result = await read(`(() => {
    const draw = tc.draw;
    tc.draw = (...args) => { tc.w.maskWarm = false; return draw(...args); };
    try { return tc.compare('on'); } finally { tc.draw = draw; }
  })()`);
  const row = { phone: false, hill: 1.5, camera: 'water-mask-warm', ...result };
  rows.push(row); console.log('PICTURE', JSON.stringify(row));
  assert.ok(row.differences['water-mask'], 'real water-mask pass executed');
  assert.ok(Object.values(row.differences).every(d => d.pixels === 0), `STOP: ${JSON.stringify(row)}`);
}
async function driveCheck() {
  const started = performance.now();
  for (const phone of [false,true]) {
    await load(phone,1.5);
    const result = await read(`tc.drive(${phone})`); motion.push(result);
    assert.equal(result.steps.length,190,'70 road steps plus 120 three-degree yaw steps');
    if (!phone) {
      assert.ok(result.distinctNearCounts >= 20,'drive must exercise many near packings');
      assert.ok(result.caughtSteps >= 50 && result.driveCaught >= 10 && result.yawCaught >= 20,
        `stale near bound must fail MANY steps: ${JSON.stringify({...result,steps:undefined})}`);
      mutations['stale-near'] = {...result,steps:undefined};
    } else assert.ok(result.steps.every(s=>s.nearInstances===0),'LOW never repacks near trees');
    console.log('DRIVE',JSON.stringify({...result,steps:result.steps.length}));
  }
  console.log(`PASS moving camera: 380 steps, 0 changed main/shadow pixels; ${(performance.now()-started)/1000}s including page loads`);
}
try {
  await send('Runtime.enable'); await send('Page.enable');
  for (const phone of supplement || driveOnly ? [] : [true, false]) for (const hill of process.env.TREE_BASELINE ? [1.5] : [1,1.5,2.5]) {
    await load(phone, hill);
    const survey = await read('tc.survey()');
    console.log('SURVEY', JSON.stringify({ phone, hill, ...survey, frame: await read("tc.draw('off').frame") }));
    if (process.env.TREE_BASELINE) continue;
    for (const view of views) {
      if (view.shot) {
        // The game's own shot keys keep its canonical camera placement.
        await load(phone, hill, `&shot=${view.shot}`);
      } else await read(`tc.view(${JSON.stringify(view)})`);
      const row = { phone, hill, camera: view.name, ...await read("tc.compare('on')") };
      rows.push(row); console.log('PICTURE', JSON.stringify(row));
      assert.ok(Object.values(row.differences).every(d => d.pixels === 0), `STOP: ${phone?'phone':'desktop'} Hill ${hill} ${view.name}: ${JSON.stringify(row.differences)}`);
      if (hill === 1.5 && !view.name.startsWith('turn-')) {
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(`${out}/${phone?'phone':'desktop'}-${view.name}.png`, Buffer.from(shot.result.data, 'base64'));
      }
      if (!phone && ['harbour-mirror','low-sun-shadow'].includes(view.name)) {
        const mode = view.name === 'harbour-mirror' ? 'mirror-control' : 'shadow-control';
        if (!mutations[mode]) {
          const result = await read("tc.compare('main-only')");
          const pass = mode === 'mirror-control' ? 'mirror' : 'main';
          if (result.differences[pass]?.pixels > 0) {
            mutations[mode] = { phone, hill, camera: view.name, ...result };
            console.log('REJECTED main-camera-only', mode, JSON.stringify(mutations[mode]));
          }
        }
      }
      for (const mode of ['half', ...(hill === 2.5 ? ['ignore-height'] : [])]) if (!mutations[mode]) {
        const result = await read(`tc.compare('${mode}')`);
        if (Object.values(result.differences).some(d => d.pixels > 0)) { mutations[mode] = { phone, hill, camera: view.name, ...result }; console.log('REJECTED', mode, JSON.stringify(mutations[mode])); }
      }
    }
    if (hill === 1) await sliderCheck(phone);
  }
  if (!process.env.TREE_BASELINE && !supplement && !driveOnly) {
    assert.ok(mutations.half, 'half-radius mutation must fail');
    await heightCheck();
    assert.ok(mutations['ignore-height'], 'ignore-height mutation must fail at Hill 2.5');
    assert.ok(mutations['mirror-control'], 'mirror view must show trees excluded by the main camera');
    assert.ok(mutations['shadow-control'], 'offscreen casters must cast shadows into the main picture');
    // Separate representations and pre-load home clearing retain the same picture too.
    for (const [name, extra] of [['forced-far','&trees=far'], ['home-clear','&area=judique']]) {
      await load(false, 2.5, extra);
      const row = { phone: false, hill: 2.5, camera: name, ...await read("tc.compare('on')") };
      rows.push(row); console.log('PICTURE', JSON.stringify(row));
      assert.ok(Object.values(row.differences).every(d => d.pixels === 0), `STOP: ${JSON.stringify(row)}`);
    }
    assert.ok(rows.some(row => row.before.frame.calls > row.after.frame.calls), 'culling reduces draws');
    assert.ok(await read('tc.r.info.programs.every(p => !p.diagnostics || p.diagnostics.runnable)'), 'programs compile');
  }
  if (!process.env.TREE_BASELINE && !driveOnly) {
    if (supplement) { for (const phone of [true, false]) await sliderCheck(phone); await heightCheck(); }
    await maskCheck();
  }
  if (!process.env.TREE_BASELINE && !supplement) await driveCheck();
  assert.deepEqual(errors, [], 'no page exceptions');
  console.log('PASS tree culling', rows.length, 'fixed pictures,', motion.reduce((n,r)=>n+r.steps.length,0), 'moving steps; all pass pixel differences = 0');
} finally {
  writeFileSync(`${out}/tree-culling${process.env.TREE_BASELINE?'-baseline':supplement?'-supplement':driveOnly?'-drive':''}.json`, JSON.stringify({ rows, motion, mutations, errors }, null, 2));
  await fetch(`${endpoint}/json/close/${tab.id}`).catch(() => {}); ws.close();
}
