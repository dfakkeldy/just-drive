// What the Point Tupper AI driver costs to draw, at a Point Tupper start, desktop (HIGH) or phone (DRIVER_LOW=1, LOW).
// LOW builds the AI from the parked display models (pickup, side by side, dirt bike; no car).
// Same fixture as tools/frame-budget-check.mjs (hour, exag, shadows, res, quality, viewport, touch) without its radio
// fixture, which fails on rented hosts. The real game loop runs; the page's own AI instance is held still in view.
// For each kind:
//   in-page leg   : the same settled view with the AI hidden, then shown. Full-frame maxima over every render() call.
//   attribution   : the draws and triangles the renderer submitted for the AI's own meshes (onBefore/AfterRender).
//   scene bound   : visible AI meshes x passes, and their index counts, read from the scene graph.
// Then a second page with ?aiDriver=0 (no AI built) at the same view. Asserts:
//   per frame, shown minus the AI's own draws == hidden; attributed <= scene bound (calls, triangles); geometries delta <= the rig's own geometries;
//   shown - (aiDriver=0 page) <= scene bound (calls, triangles);
//   LOW only: the start without the AI, and with each kind shown, fits PHONE_CAP (tools/frame-budget-policy.mjs, calls and
//   triangles): Point Tupper's LOW start fits a phone, AI and all. Frozen, so a saving in another scene cannot fail it.
// Report only: draws and triangles of the two cheaper rigs the repo already has (LOW pickup, fleet parked display).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
import { PHONE_CAP } from './frame-budget-policy.mjs';
import { farLand } from './frame-budget-far.mjs';
const FAR_STATE = farLand(); // throws on a half-installed far pack
const [out, first] = process.argv.slice(2), port = process.env.CDP_PORT, LOW = process.env.DRIVER_LOW === '1';
const mode = LOW ? 'phone' : 'desktop';
const baseline = JSON.parse(readFileSync(new URL('./baseline/frame-budget.json', import.meta.url)));
const phoneRows = Object.entries(baseline).filter(([k]) => k.includes('/phone-') && !k.startsWith('pointtupper-'));
// The cap is frozen (frame-budget-policy.mjs PHONE_CAP); the loosest phone pin of the other scenes is reported beside it.
const ceiling = Object.fromEntries(['calls', 'triangles'].map(k => [k, { value: PHONE_CAP[k], key: 'PHONE_CAP' }]));
const loosest = Object.fromEntries(['calls', 'triangles', 'geometries'].map(k => {
  const [key, row] = phoneRows.reduce((a, b) => b[1][k] > a[1][k] ? b : a); return [k, { value: row[k], key }];
}));
const KINDS = LOW ? ['sxs', 'truck', 'bike'] : ['car', 'sxs', 'truck', 'bike'];

async function openPage(extra) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const c = await cdp(tab.webSocketDebuggerUrl, { deadline: 240000 });
  const read = async expression => {
    const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.error || r.result?.exceptionDetails) throw Error(JSON.stringify(r.error ?? r.result.exceptionDetails));
    return r.result.result.value;
  };
  const close = async () => { await c.send('Page.close').catch(() => {}); c.close?.(); };
  const params = new URLSearchParams({ area: 'pointtupper', mode: 'explore', vehicle: 'truck', mp: '0', radio: '0',
    hour: '16.75', exag: '1.5', hud: '1', shadows: '1', res: '1', q: LOW ? 'low' : 'high', ...extra });
  if (LOW) params.set('touch', '1');
  await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: LOW ? 390 : 1400, height: LOW ? 844 : 950, deviceScaleFactor: 1, mobile: LOW });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: LOW });
  await c.send('Page.navigate', { url: new URL('/?' + params, first).href });
  let ready = false;
  for (let i = 0; i < 400 && !ready; i++) { await sleep(500); ready = await read("document.documentElement.dataset.mmmReady==='true' && !!window.mmm?.renderer").catch(() => false); }
  assert.ok(ready, `${params}: page loads`);
  // The fixture must really be that device: frame-budget-check.mjs's viewport, quality and shadow asserts.
  assert.deepEqual(await read('[innerWidth,innerHeight,mmm.renderer.domElement.width,mmm.renderer.domElement.height]'),
    LOW ? [390, 844, 390, 844] : [1400, 950, 1400, 950], 'fixed CSS viewport and drawing buffer');
  assert.equal(await read('mmm.low'), LOW, 'quality');
  assert.equal(await read('mmm.renderer.shadowMap.enabled'), !LOW, 'forced desktop shadows / LOW has no shadow pass');
  assert.equal(await read('mmm.vehicleId'), 'truck', 'player drives the pickup');
  await read("document.getElementById('titleStart')?.click()");
  await sleep(1500);
  // Phone detail draws no far views unless asked (Settings > Advanced, far-choice.ts): LOW waits for none.
  if (FAR_STATE === 'after' && !LOW) {
    // As frame-budget-check.mjs: wait for every far part, then hold the far query meshes visible, so both pages
    // count the frame the game draws whenever a 5 Hz occlusion probe retries (not a probe phase).
    for (let i = 0; i < 120 && !await read('!!(mmm.farVisibility&&mmm.farLand&&mmm.tall&&mmm.farTurbines)'); i++) await sleep(500);
    await read('(() => {const v=mmm.farVisibility;if(!v)throw Error("far views never loaded on after land");v.update=()=>{};for(const r of v.records)r.mesh.visible=true;})()');
  }
  // Count every draw of one animation frame: main, mirror, water mask AND the shadow pass. three.js resets
  // renderer.info after drawing the shadow map (WebGLRenderer.render), so its own per-render counts omit shadow draws;
  // with autoReset off the counters run for the whole frame and this tick resets them once.
  await read(`(()=>{const r=mmm.renderer,b=window.__ai={rows:[],acc:{calls:0,triangles:0,mirror:0},ai:{calls:0,triangles:0}};
    r.info.autoReset=false;r.info.reset();
    const render=r.render.bind(r);r.render=(s,c)=>{render(s,c);if(c!==mmm.camera)b.acc.mirror++;};
    const tick=()=>{b.acc.calls=r.info.render.calls;b.acc.triangles=r.info.render.triangles;r.info.reset();b.rows.push({...b.acc,aiCalls:b.ai.calls,aiTriangles:b.ai.triangles,restCalls:b.acc.calls-b.ai.calls,restTriangles:b.acc.triangles-b.ai.triangles,geometries:r.info.memory.geometries,textures:r.info.memory.textures,
      programs:r.info.programs.length,pending:mmm.terrain.pending+(mmm.grass?.pending??0)+(mmm.trees?.pending??0)});
      b.acc={calls:0,triangles:0,mirror:0};b.ai={calls:0,triangles:0};if(b.rows.length>400)b.rows.splice(0,200);requestAnimationFrame(tick);};
    requestAnimationFrame(tick);})()`);
  return { read, close };
}
// Two consecutive 30-frame windows with the same maxima, nothing pending. Returns the window maxima.
async function settle(page, label) {
  await page.read('__ai.rows.length=0');
  const until = Date.now() + 120000;
  while (Date.now() < until) {
    await sleep(400);
    const rows = await page.read('__ai.rows.slice(-60)');
    if (rows.length < 60 || rows.some(r => r.pending || !r.calls)) continue;
    const max = w => Object.fromEntries(['calls', 'triangles', 'mirror', 'aiCalls', 'aiTriangles', 'restCalls', 'restTriangles', 'geometries', 'textures', 'programs'].map(k => [k, Math.max(...w.map(r => r[k]))]));
    const a = max(rows.slice(0, 30)), b = max(rows.slice(30));
    if (JSON.stringify(a) === JSON.stringify(b)) return b;
  }
  throw Error(`${label}: no two equal settled 30-frame windows`);
}
// The real chase view at the start, the player parked. The AI sits 30 m along the camera's forward line.
const VIEW = `(()=>{const c=mmm.camera,d=new (c.position.constructor)();c.getWorldDirection(d);const h=Math.hypot(d.x,d.z)||1;
  return {x:c.position.x+d.x/h*30,z:c.position.z+d.z/h*30,heading:Math.atan2(d.x/h,-d.z/h),camera:c.position.toArray()};})()`;

const results = { mode, measured: 'shipped', ceiling, loosest, kinds: {} };
let spot;
const page = await openPage({ aiDriverCheck: '1' });
try {
  assert.ok(await page.read('!!mmm.aiDriver'), 'aiDriverCheck=1 builds the AI on the dev server');
  assert.equal(await page.read('mmm.aiDriver.low'), LOW, 'LOW builds the display-model AI');
  await sleep(3000);
  spot = await page.read(VIEW);
  // Hold the page's instance: the game keeps calling update/step on it every frame.
  await page.read(`(()=>{const a=mmm.aiDriver;a.update=()=>{};a.step=()=>{};a.resolve=()=>{};a.active=true;a.group.visible=false;})()`);
  for (const kind of KINDS) {
    const rig = await page.read(`(async()=>{const {GARAGE}=await import('/src/garage.ts');const a=mmm.aiDriver,THREE=await import('/node_modules/three/build/three.module.js');
      const before=a.builds;if(a.entry.id!=='${kind}')a.mount(GARAGE.find(e=>e.id==='${kind}'));
      if(!a.vehicle.place(${spot.x},${spot.z},${spot.heading}))throw Error('AI placement in view rejected');a.group.visible=false;
      // Attribute submitted draws to the AI's own meshes, main and shadow passes alike.
      const r=mmm.renderer,b=__ai,geometries=new Set();let meshes=0,shadowMeshes=0,triangles=0,shadowTriangles=0;
      a.group.traverse(o=>{if(!o.isMesh)return;geometries.add(o.geometry);if(o.__aiWrapped)return;o.__aiWrapped=true;
        for(const [before,after] of [['onBeforeRender','onAfterRender'],['onBeforeShadow','onAfterShadow']]){let c=0,t=0;const ob=o[before],oa=o[after];
          o[before]=function(...x){ob?.apply(this,x);c=r.info.render.calls;t=r.info.render.triangles;};
          o[after]=function(...x){(b.drawn??=new Set()).add(this);b.ai.calls+=r.info.render.calls-c;b.ai.triangles+=r.info.render.triangles-t;oa?.apply(this,x);};}});
      a.group.visible=true;a.group.updateMatrixWorld(true);
      // three.js draws a transparent double-sided material twice (back faces, then front) unless forceSinglePass.
      const twice=m=>m.transparent&&m.side===THREE.DoubleSide&&!m.forceSinglePass?2:1;
      a.group.traverseVisible(o=>{if(!o.isMesh)return;const g=o.geometry,mats=Array.isArray(o.material)?o.material:[o.material];
        const groups=Array.isArray(o.material)?g.groups.reduce((n,gr)=>n+twice(mats[gr.materialIndex]),0)||1:twice(o.material);
        const all=(g.index?g.index.count:g.attributes.position.count),tris=Array.isArray(o.material)&&g.groups.length?g.groups.reduce((n,gr)=>n+Math.min(gr.count,all-gr.start)/3*twice(mats[gr.materialIndex]),0):all/3*twice(mats[0]),inst=o.isInstancedMesh?o.count:1;meshes+=groups;triangles+=tris*inst;
        if(o.castShadow&&r.shadowMap.enabled){shadowMeshes+=groups;shadowTriangles+=tris*inst;}});
      window.__aiCounted=new Set();a.group.traverseVisible(o=>{if(o.isMesh)__aiCounted.add(o);});
      a.group.visible=false;
      const p=new THREE.Vector3(a.vehicle.x,a.vehicle.y+1,a.vehicle.z).project(mmm.camera);
      return {built:a.builds-before,id:a.entry.id,meshes,shadowMeshes,triangles,shadowTriangles,geometries:geometries.size,ndc:[p.x,p.y,p.z]};})()`);
    assert.equal(rig.id, kind);
    assert.ok(Math.abs(rig.ndc[0]) < .8 && Math.abs(rig.ndc[1]) < .8 && rig.ndc[2] < 1, `${kind}: AI is inside the view`);
    const hidden = await settle(page, kind + ' hidden');
    await page.read('__ai.drawn=new Set();mmm.aiDriver.group.visible=true');
    const shown = await settle(page, kind + ' shown');
    const missed = await page.read(`[...__ai.drawn].filter(o=>!__aiCounted.has(o)).map(o=>{const path=[];for(let n=o;n&&n!==mmm.aiDriver.group;n=n.parent)path.push((n.name||n.type)+(n.visible?'':'(hidden)'));return {path:path.join('<'),type:o.type,count:o.count,tris:(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3};})`);
    assert.deepEqual(missed, [], `${kind}: every drawn AI mesh is in the counted visible scene graph`);
    await page.read('mmm.aiDriver.group.visible=false');
    // A mirror pass (a render with another camera) may draw the rig again: one more main-pass set per mirror pass.
    const mirrors = shown.mirror;
    const bound = { calls: rig.meshes * (1 + mirrors) + rig.shadowMeshes, triangles: rig.triangles * (1 + mirrors) + rig.shadowTriangles };
    const delta = { calls: shown.calls - hidden.calls, triangles: shown.triangles - hidden.triangles, geometries: shown.geometries - hidden.geometries,
      textures: shown.textures - hidden.textures, programs: shown.programs - hidden.programs };
    results.kinds[kind] = { rig, hidden, shown, delta, attributed: { calls: shown.aiCalls, triangles: shown.aiTriangles }, bound };
    console.log(`${mode} ${kind}: +${delta.calls} draws, +${delta.triangles} triangles, +${delta.geometries} geometries, +${delta.textures} textures, +${delta.programs} programs ` +
      `(attributed ${shown.aiCalls}/${shown.aiTriangles}; bound ${bound.calls}/${bound.triangles}); shown total ${shown.calls} draws, ${shown.triangles} triangles, ${shown.geometries} geometries`);
    assert.equal(hidden.aiCalls, 0, `${kind}: a hidden AI submits no draws`);
    // Frame by frame: everything but the AI's own draws is the hidden scene. Shadow and mirror passes do not run every
    // frame, so a difference of window maxima can mix frame kinds; the per-frame remainder cannot.
    assert.equal(shown.restCalls, hidden.calls, `${kind}: showing the AI adds only its own draws`);
    assert.equal(shown.restTriangles, hidden.triangles, `${kind}: showing the AI adds only its own triangles`);
    assert.ok(shown.aiCalls > 0 && shown.aiCalls <= bound.calls, `${kind}: AI draws ${shown.aiCalls} within its scene bound ${bound.calls}`);
    assert.ok(shown.aiTriangles <= bound.triangles, `${kind}: AI triangles ${shown.aiTriangles} within ${bound.triangles}`);
    assert.ok(delta.geometries <= rig.geometries, `${kind}: geometries +${delta.geometries} within the rig's own ${rig.geometries}`);
  }
  // Report only: the cheaper rigs the repo already builds.
  results.cheaper = await page.read(`(async()=>{const {createTruck}=await import('/src/truck.ts');const {fleetDisplay}=await import('/src/fleet-models.ts');
    const count=root=>{let draws=0,triangles=0;root.updateMatrixWorld(true);root.traverseVisible(o=>{if(!o.isMesh)return;const g=o.geometry;draws+=Array.isArray(o.material)?Math.max(1,g.groups.length):1;triangles+=(g.index?g.index.count:g.attributes.position.count)/3;});return {draws,triangles};};
    return {lowPickup:count(createTruck(false,true).root),...Object.fromEntries(['truck','sxs','bike'].map(id=>['display-'+id,count(fleetDisplay(id).root)]))};})()`);
  console.log('cheaper rigs (report only):', JSON.stringify(results.cheaper));
} finally { await page.close(); }

// Second page: no AI is built at all. Same view, same fixture.
const off = await openPage({ aiDriver: '0' });
try {
  assert.equal(await off.read('mmm.aiDriver'), null, 'aiDriver=0 builds no AI');
  await sleep(3000);
  const offView = await off.read(VIEW);
  assert.ok(Math.hypot(...offView.camera.map((v, i) => v - spot.camera[i])) < .05, 'aiDriver=0 page has the same start view');
  results.off = await settle(off, 'aiDriver=0');
} finally { await off.close(); }
console.log(`${mode} aiDriver=0: ${results.off.calls} draws, ${results.off.triangles} triangles, ${results.off.geometries} geometries`);
for (const kind of KINDS) {
  const k = results.kinds[kind], cross = { calls: k.shown.calls - results.off.calls, triangles: k.shown.triangles - results.off.triangles, geometries: k.shown.geometries - results.off.geometries };
  const noise = { calls: k.hidden.calls - results.off.calls, triangles: k.hidden.triangles - results.off.triangles, geometries: k.hidden.geometries - results.off.geometries };
  k.cross = cross; k.noise = noise;
  assert.ok(noise.calls === 0 && noise.triangles === 0, `${kind}: the hidden AI page draws exactly what the aiDriver=0 page draws`);
  console.log(`${mode} ${kind} vs aiDriver=0: +${cross.calls} draws, +${cross.triangles} triangles, +${cross.geometries} geometries (hidden vs aiDriver=0: ${JSON.stringify(noise)})`);
  assert.ok(cross.calls <= k.bound.calls, `${kind}: shown - aiDriver=0 draws ${cross.calls} exceed the rig bound ${k.bound.calls}`);
  assert.ok(cross.triangles <= k.bound.triangles, `${kind}: shown - aiDriver=0 triangles ${cross.triangles} exceed the rig bound ${k.bound.triangles}`);
}
writeFileSync(`${out}/point-tupper-driver-budget-${mode}.json`, JSON.stringify(results, null, 2));
// The ceiling verdict comes last so one run records every kind and the aiDriver=0 page first.
if (LOW) {
  const over = [];
  for (const k of ['calls', 'triangles']) {
    console.log(`LOW ${k}: cap ${ceiling[k].value} (PHONE_CAP; loosest other phone pin now ${loosest[k].value}, ${loosest[k].key}); aiDriver=0 ${results.off[k]}; shown ` +
      KINDS.map(kind => `${kind} ${results.kinds[kind].shown[k]}`).join(', '));
    if (results.off[k] > ceiling[k].value) over.push(`no AI: ${k} ${results.off[k]} > ${ceiling[k].value}`);
    for (const kind of KINDS) if (results.kinds[kind].shown[k] > ceiling[k].value) over.push(`${kind}: ${k} ${results.kinds[kind].shown[k]} > ${ceiling[k].value}`);
  }
  assert.deepEqual(over, [], 'the Point Tupper LOW start (without and with each AI kind) fits the phone cap (frame-budget-policy.mjs PHONE_CAP)');
}
console.log(`PASS Point Tupper AI frame cost, ${mode}${LOW ? ' (display models; within PHONE_CAP)' : ''}`);
