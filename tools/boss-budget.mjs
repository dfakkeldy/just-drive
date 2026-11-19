// What the Boss's car costs to draw in Get Fired, at the Mabou start: desktop (HIGH) or phone (BOSS_LOW=1, LOW).
// BOSS_MAIL=1: the same in mail play on a ride-along day (ride-along.ts, ?rideAlong=1), the same car at its post.
// Only run through tools/yard-shots.sh. The fixture is tools/point-tupper-driver-budget.mjs's (hour, exag, shadows,
// res, quality, viewport, touch; no radio). The real game loop runs; the page's own Boss is held still in view, 30 m
// along the camera's forward line.
//   in-page leg : the same settled view with the Boss hidden, then shown; full-frame maxima over every render() call.
//   attribution : the draws and triangles the renderer submitted for the Boss's own meshes.
//   scene bound : visible Boss meshes x passes, and their index counts, read from the scene graph.
// Then a second page with ?boss=0 (no Boss built) at the same view. Asserts: per frame, shown minus the Boss's own draws
// == hidden; attributed <= scene bound; shown - (boss=0 page) <= scene bound; the Boss draws no more than the player's
// own mail car plus its one door-words strip; LOW only: the start with the Boss shown fits PHONE_CAP
// (tools/frame-budget-policy.mjs), so a phone in Get Fired stays inside the ceiling with the Boss in view.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
import { PHONE_CAP } from './frame-budget-policy.mjs';
const [out, first] = process.argv.slice(2), port = process.env.CDP_PORT, LOW = process.env.BOSS_LOW === '1', MAIL = process.env.BOSS_MAIL === '1';
const mode = `${MAIL ? 'ride-along-' : ''}${LOW ? 'phone' : 'desktop'}`;

async function openPage(extra) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const c = await cdp(tab.webSocketDebuggerUrl, { deadline: 240000 });
  const read = async expression => {
    const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.error || r.result?.exceptionDetails) throw Error(JSON.stringify(r.error ?? r.result.exceptionDetails));
    return r.result.result.value;
  };
  const close = async () => { await c.send('Page.close').catch(() => {}); c.close?.(); };
  const params = new URLSearchParams({ mode: MAIL ? 'mail' : 'fired', ...MAIL ? { rideAlong: '1' } : {}, mp: '0', radio: '0', run: '1', day: '1', scene: '0',
    hour: '16.75', exag: '1.5', hud: '1', shadows: '1', res: '1', q: LOW ? 'low' : 'high', ...extra });
  if (LOW) params.set('touch', '1');
  await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: LOW ? 390 : 1400, height: LOW ? 844 : 950, deviceScaleFactor: 1, mobile: LOW });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: LOW });
  await c.send('Page.navigate', { url: new URL('/?' + params, first).href });
  let ready = false;
  for (let i = 0; i < 400 && !ready; i++) { await sleep(500); ready = await read("document.documentElement.dataset.mmmReady==='true' && !!window.mmm?.renderer").catch(() => false); }
  assert.ok(ready, `${params}: page loads`);
  assert.deepEqual(await read('[innerWidth,innerHeight,mmm.renderer.domElement.width,mmm.renderer.domElement.height]'),
    LOW ? [390, 844, 390, 844] : [1400, 950, 1400, 950], 'fixed CSS viewport and drawing buffer');
  assert.equal(await read('mmm.low'), LOW, 'quality');
  assert.equal(await read('mmm.renderer.shadowMap.enabled'), !LOW, 'desktop shadows / LOW has no shadow pass');
  assert.equal(await read('mmm.gameMode'), MAIL ? 'mail' : 'fired');
  await read("document.getElementById('titleStart')?.click()");
  await sleep(1500);
  await read(`(()=>{const r=mmm.renderer,b=window.__boss={rows:[],acc:{calls:0,triangles:0,mirror:0},own:{calls:0,triangles:0}};
    r.info.autoReset=false;r.info.reset();
    const render=r.render.bind(r);r.render=(s,c)=>{render(s,c);if(c!==mmm.camera)b.acc.mirror++;};
    const tick=()=>{b.acc.calls=r.info.render.calls;b.acc.triangles=r.info.render.triangles;r.info.reset();b.rows.push({...b.acc,ownCalls:b.own.calls,ownTriangles:b.own.triangles,restCalls:b.acc.calls-b.own.calls,restTriangles:b.acc.triangles-b.own.triangles,geometries:r.info.memory.geometries,textures:r.info.memory.textures,
      programs:r.info.programs.length,pending:mmm.terrain.pending+(mmm.grass?.pending??0)+(mmm.trees?.pending??0)});
      b.acc={calls:0,triangles:0,mirror:0};b.own={calls:0,triangles:0};if(b.rows.length>400)b.rows.splice(0,200);requestAnimationFrame(tick);};
    requestAnimationFrame(tick);})()`);
  // A picture of the frame measured (the Boss in view), for the PR and the colour choice.
  const shot = async label => writeFileSync(`${out}/boss-${mode}-${label}.png`, Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  return { read, close, shot };
}
async function settle(page, label) {
  await page.read('__boss.rows.length=0');
  const until = Date.now() + 120000;
  while (Date.now() < until) {
    await sleep(400);
    const rows = await page.read('__boss.rows.slice(-60)');
    if (rows.length < 60 || rows.some(r => r.pending || !r.calls)) continue;
    const max = w => Object.fromEntries(['calls', 'triangles', 'mirror', 'ownCalls', 'ownTriangles', 'restCalls', 'restTriangles', 'geometries', 'textures', 'programs'].map(k => [k, Math.max(...w.map(r => r[k]))]));
    const a = max(rows.slice(0, 30)), b = max(rows.slice(30));
    if (JSON.stringify(a) === JSON.stringify(b)) return b;
  }
  throw Error(`${label}: no two equal settled 30-frame windows`);
}
const VIEW = `(()=>{const c=mmm.camera,d=new (c.position.constructor)();c.getWorldDirection(d);const h=Math.hypot(d.x,d.z)||1;
  return {x:c.position.x+d.x/h*30,z:c.position.z+d.z/h*30,heading:Math.atan2(-d.x/h,d.z/h),camera:c.position.toArray()};})()`;
// The player's own car, counted the same way (its visible meshes, one draw each, or one per material group).
const COUNT = `root=>{let draws=0,triangles=0;root.updateMatrixWorld(true);root.traverseVisible(o=>{if(!o.isMesh)return;const g=o.geometry;draws+=Array.isArray(o.material)?Math.max(1,g.groups.length):1;triangles+=(g.index?g.index.count:g.attributes.position.count)/3;});return {draws,triangles};}`;

const results = { mode, cap: PHONE_CAP };
let spot;
const page = await openPage({});
try {
  assert.ok(await page.read(MAIL ? '!!mmm.boss?.today' : '!!mmm.boss?.pursuit'), MAIL ? 'a ride-along day builds the Boss' : 'Get Fired builds the Boss');
  await sleep(3000);
  spot = await page.read(VIEW);
  // Hold the page's Boss: the game keeps calling update/step on it every frame.
  const rig = await page.read(`(async()=>{const THREE=await import('/node_modules/three/build/three.module.js');const b=mmm.boss,a=b.driver;
    b.update=()=>{};b.step=()=>{};a.update=()=>{};a.step=()=>{};a.resolve=()=>{};
    if(!a.vehicle.place(${spot.x},${spot.z},${spot.heading}))throw Error('Boss placement in view refused');a.active=true;a.group.visible=false;
    const r=mmm.renderer,B=__boss,geometries=new Set();let meshes=0,shadowMeshes=0,triangles=0,shadowTriangles=0;
    a.group.traverse(o=>{if(!o.isMesh)return;geometries.add(o.geometry);if(o.__bossWrapped)return;o.__bossWrapped=true;
      for(const [before,after] of [['onBeforeRender','onAfterRender'],['onBeforeShadow','onAfterShadow']]){let c=0,t=0;const ob=o[before],oa=o[after];
        o[before]=function(...x){ob?.apply(this,x);c=r.info.render.calls;t=r.info.render.triangles;};
        o[after]=function(...x){(B.drawn??=new Set()).add(this);B.own.calls+=r.info.render.calls-c;B.own.triangles+=r.info.render.triangles-t;oa?.apply(this,x);};}});
    a.group.visible=true;a.group.updateMatrixWorld(true);
    const twice=m=>m.transparent&&m.side===THREE.DoubleSide&&!m.forceSinglePass?2:1;
    a.group.traverseVisible(o=>{if(!o.isMesh)return;const g=o.geometry,mats=Array.isArray(o.material)?o.material:[o.material];
      const groups=Array.isArray(o.material)?g.groups.reduce((n,gr)=>n+twice(mats[gr.materialIndex]),0)||1:twice(o.material);
      const all=(g.index?g.index.count:g.attributes.position.count),tris=all/3*twice(mats[0]);meshes+=groups;triangles+=tris;
      if(o.castShadow&&r.shadowMap.enabled){shadowMeshes+=groups;shadowTriangles+=tris;}});
    window.__bossCounted=new Set();a.group.traverseVisible(o=>{if(o.isMesh)__bossCounted.add(o);});
    a.group.visible=false;
    const p=new THREE.Vector3(a.vehicle.x,a.vehicle.y+1,a.vehicle.z).project(mmm.camera);
    const count=${COUNT};
    return {meshes,shadowMeshes,triangles,shadowTriangles,geometries:geometries.size,ndc:[p.x,p.y,p.z],boss:count(a.vehicle.car.root),player:count(mmm.vehicle.car.root),
      blender:!!mmm.vehicle.car.root.getObjectByName('car_root')||mmm.vehicle.car.root.name==='car_root'};})()`);
  console.log(mode, 'rig', JSON.stringify(rig));
  assert.ok(Math.abs(rig.ndc[0]) < .8 && Math.abs(rig.ndc[1]) < .8 && rig.ndc[2] < 1, 'the Boss is inside the view');
  assert.ok(rig.boss.draws <= rig.player.draws + 1, `the Boss draws ${rig.boss.draws}: the mail car's ${rig.player.draws} and its door words, no more`);
  const hidden = await settle(page, 'Boss hidden');
  await page.read('__boss.drawn=new Set();mmm.boss.driver.group.visible=true');
  const shown = await settle(page, 'Boss shown');
  await page.shot('in-view');
  const missed = await page.read(`[...(__boss.drawn??[])].filter(o=>!__bossCounted.has(o)).map(o=>o.name||o.type)`);
  assert.deepEqual(missed, [], 'every drawn Boss mesh is in the counted visible scene graph');
  const mirrors = shown.mirror;
  const bound = { calls: rig.meshes * (1 + mirrors) + rig.shadowMeshes, triangles: rig.triangles * (1 + mirrors) + rig.shadowTriangles };
  const delta = { calls: shown.calls - hidden.calls, triangles: shown.triangles - hidden.triangles, geometries: shown.geometries - hidden.geometries,
    textures: shown.textures - hidden.textures, programs: shown.programs - hidden.programs };
  Object.assign(results, { rig, hidden, shown, delta, bound });
  console.log(`${mode} Boss: +${delta.calls} draws, +${delta.triangles} triangles, +${delta.geometries} geometries, +${delta.textures} textures, +${delta.programs} programs ` +
    `(attributed ${shown.ownCalls}/${shown.ownTriangles}; bound ${bound.calls}/${bound.triangles}); shown total ${shown.calls} draws, ${shown.triangles} triangles`);
  assert.equal(hidden.ownCalls, 0, 'a hidden Boss submits no draws');
  assert.equal(shown.restCalls, hidden.calls, 'showing the Boss adds only its own draws');
  assert.equal(shown.restTriangles, hidden.triangles, 'showing the Boss adds only its own triangles');
  assert.ok(shown.ownCalls > 0 && shown.ownCalls <= bound.calls, `Boss draws ${shown.ownCalls} within its scene bound ${bound.calls}`);
  assert.ok(shown.ownTriangles <= bound.triangles, `Boss triangles ${shown.ownTriangles} within ${bound.triangles}`);
  assert.ok(delta.geometries <= rig.geometries, `geometries +${delta.geometries} within the rig's own ${rig.geometries}`);
} finally { await page.close(); }

const off = await openPage({ boss: '0' });
try {
  assert.equal(await off.read('mmm.boss'), null, 'boss=0 builds no Boss');
  await sleep(3000);
  const offView = await off.read(VIEW);
  assert.ok(Math.hypot(...offView.camera.map((v, i) => v - spot.camera[i])) < .05, 'boss=0 page has the same start view');
  results.off = await settle(off, 'boss=0');
} finally { await off.close(); }
const cross = { calls: results.shown.calls - results.off.calls, triangles: results.shown.triangles - results.off.triangles };
const noise = { calls: results.hidden.calls - results.off.calls, triangles: results.hidden.triangles - results.off.triangles };
Object.assign(results, { cross, noise });
console.log(`${mode} boss=0: ${results.off.calls} draws, ${results.off.triangles} triangles; shown - boss=0: +${cross.calls} draws, +${cross.triangles} triangles; hidden - boss=0: ${JSON.stringify(noise)}`);
assert.ok(noise.calls === 0 && noise.triangles === 0, 'a hidden Boss page draws exactly what the boss=0 page draws');
assert.ok(cross.calls <= results.bound.calls && cross.triangles <= results.bound.triangles, 'shown - boss=0 within the rig bound');
writeFileSync(`${out}/boss-budget-${mode}.json`, JSON.stringify(results, null, 2));
if (LOW) {
  const over = ['calls', 'triangles'].filter(k => results.shown[k] > PHONE_CAP[k]).map(k => `${k} ${results.shown[k]} > ${PHONE_CAP[k]}`);
  console.log(`LOW: cap ${PHONE_CAP.calls} calls, ${PHONE_CAP.triangles} triangles; boss=0 ${results.off.calls}/${results.off.triangles}; Boss shown ${results.shown.calls}/${results.shown.triangles}`);
  assert.deepEqual(over, [], `the ${MAIL ? 'ride-along mail' : 'Get Fired'} LOW start with the Boss in view fits the phone cap (frame-budget-policy.mjs PHONE_CAP)`);
}
console.log(`PASS Boss frame cost, ${mode}${LOW ? ' (within PHONE_CAP)' : ''}`);
