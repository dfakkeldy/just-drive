// Only run through tools/yard-shots.sh, which owns tools/browser.sh and its shared slot.
// The Boss in Get Fired, on the dev server and the real frame loop. BOSS_CASE=pullover (default) or escape;
// BOSS_PHONE=1 is the phone (390 x 844, touch, LOW).
//   pullover: no Boss at the start; the first discipline step brings it from a hidden road, on its way to the last
//     complaint; then it is set 30 m behind the stopped player on a straight road and the real pursuit runs: it sees
//     you (an offence then is witnessed and scores double), closes, holds close behind, flashes and honks, and you
//     are pulled over: the card, the clock jumps, the combo goes, points and step stay; it drives off unseen.
//   escape: it sees you coming the other way; you are far away (a hidden road) and it loses you after about 20 s:
//     "Lost the Boss", a bonus on the score stream, back on patrol. The end card counts both.
// Mail play and Just Drive build no Boss.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
const [out, first] = process.argv.slice(2), port = process.env.CDP_PORT;
const PHONE = process.env.BOSS_PHONE === '1', CASE = process.env.BOSS_CASE ?? 'pullover', name = `${CASE}-${PHONE ? 'phone' : 'desktop'}`;
const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const errors = [];
const c = await cdp(tab.webSocketDebuggerUrl, { deadline: 300000, onEvent: e => {
  if (e.method === 'Runtime.exceptionThrown') errors.push(e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text);
} });
const read = async expression => {
  const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.error || r.result?.exceptionDetails) throw Error(JSON.stringify(r));
  return r.result.result.value;
};
const shot = async label => writeFileSync(`${out}/boss-${name}-${label}.png`, Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
async function page(query, host = '127.0.0.1') {
  await c.send('Emulation.setDeviceMetricsOverride', { width: PHONE ? 390 : 1280, height: PHONE ? 844 : 800, deviceScaleFactor: 1, mobile: PHONE });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: PHONE });
  const url = new URL(`/?x=1&title=1&hud=1&radio=0&res=1&scene=0&day=1&run=1&${PHONE ? 'touch=1&q=low&' : ''}${query}`, first); url.hostname = host;
  await c.send('Page.navigate', { url: url.href });
  let ready = false;
  for (let i = 0; i < 360 && !ready; i++) { await sleep(500); ready = await read("document.documentElement.dataset.mmmReady === 'true' && !!window.mmm?.shift").catch(() => false); }
  assert.equal(ready, true, 'Mabou settles');
  assert.equal(await read("!!document.querySelector('vite-error-overlay')"), false);
}
const settle = async () => { for (let i = 0; i < 120; i++) { await sleep(500); if (await read("document.documentElement.dataset.mmmReady === 'true'")) return; } throw Error('no settle'); };
const until = async (what, expression, seconds) => {
  for (let i = 0; i < seconds * 5; i++) { const v = await read(expression); if (v) return v; await sleep(200); }
  throw Error(`${name}: ${what} not within ${seconds} s`);
};
// A long straight paved segment near the player: the player 45 m along it, facing along it, in the right lane.
const straight = `(async()=>{const {SceneRoad}=await import('/src/road-scene-rules.ts');const {roads:r,vehicle:v}=mmm;let best=null;
  for(const road of r.roads){if(road.kind>3||road.halfWidth<2.6||road.bridge)continue;const path=new SceneRoad(road.pts,0,1),len=path.cumulative.at(-1);
    for(let s=10;s+80<len;s+=10){const a={x:0,z:0,heading:0},b={x:0,z:0,heading:0};path.at(s,0,a);path.at(s+75,0,b);
      if(Math.cos(a.heading-b.heading)<.97||Math.abs(Math.hypot(b.x-a.x,b.z-a.z)-75)>1.5)continue;
      const d=Math.hypot(a.x-v.x,a.z-v.z);if(d>900||(best&&best.d<=d))continue;best={d,s,path,half:road.halfWidth,name:road.name};}}
  if(!best)throw Error('no straight road near the start');
  const lane=Math.min(best.half*.5,1.6);
  const at=(s,side=1)=>{const p={x:0,z:0,heading:0};best.path.at(best.s+s,side*lane,p);return p;};
  window.bossQA={at,best,lane};const p=at(0);return {name:best.name,d:Math.round(best.d),heading:p.heading};})()`;
// Put the Boss's car on the road, as the driver itself does after a hidden spawn.
const placeBoss = (s, reverse) => `(()=>{const q=bossQA,p=q.at(${s},${reverse}?-1:1),d=mmm.boss.driver,h=p.heading+(${reverse}?Math.PI:0);
  if(!d.vehicle.place(p.x,p.z,h))throw Error('Boss placement refused');
  d.active=true;d.group.visible=true;d.onRoad[0]=d.vehicle;d.leaving=false;d.parked=0;return {x:p.x,z:p.z,h};})()`;
const state = `(()=>{const b=mmm.boss,p=b.pursuit,f=mmm.fired,v=mmm.vehicle,d=b.driver.vehicle;return {state:p.state,signal:p.signal,pulled:p.pulledOver,escaped:p.escaped,
  active:b.driver.active,leaving:b.driver.leaving,dist:Math.round(Math.hypot(d.x-v.x,d.z-v.z)*10)/10,bossSpeed:Math.round(d.speed*10)/10,honks:b.honks,
  total:f.book.total,step:f.book.step,chain:f.book.chain,elapsed:mmm.shift.elapsed,glow:!document.getElementById('bossGlow').hidden,
  roof:'#'+b.car.roof.emissive.getHexString(),map:mmm.miniMap?.bossDrawn??null,
  hud:(document.getElementById('firedHud')?.textContent??''),line:document.getElementById('firedLine')?.textContent??'',
  note:document.getElementById('firedNote').hidden?'':document.getElementById('firedNote').textContent}})()`;
const visible = id => read(`(()=>{const e=document.getElementById('${id}');if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);
  return {shown:s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth+.5&&r.bottom<=innerHeight+.5,text:e.textContent};})()`);
// Is the Boss's car in the camera's view?
const inView = `(()=>{const T=mmm.camera,d=mmm.boss.driver.vehicle,m=T.projectionMatrix.clone().multiply(T.matrixWorldInverse),p=T.position.clone().set(d.x,d.y+1,d.z).applyMatrix4(m);
  return Math.abs(p.x)<1&&Math.abs(p.y)<1&&p.z<1;})()`;

try {
  await c.send('Runtime.enable'); await c.send('Page.enable');
  await page('mode=fired');
  assert.ok(await read('!!mmm.boss'), 'Get Fired builds the Boss');
  assert.equal(await read("mmm.boss.vehicle.car.root.name"), 'The Boss');
  // The exact mail car (the same model as the player's), in its own colour, saying THE BOSS.
  const car = await read(`(()=>{const b=mmm.boss.vehicle.car,p=mmm.vehicle.car,names=r=>{const n=[];r.traverse(o=>{if(o.isMesh&&o.name!=='THE BOSS door words')n.push(o.name)});return n.sort().join()};
    let door=null;b.root.traverse(o=>{if(o.isMesh&&o.material.name==='Boss door words')door=o;});return {same:names(b.root)===names(p.root),door:!!door,doorTris:door?door.geometry.index.count/3:0,
    roofMap:b.signLight.material.map?.image?.width,roofOwn:b.signLight.material!==p.signLight.material}})()`);
  console.log(name, 'car', JSON.stringify(car));
  if (PHONE) {
    // LOW: the same car merged into a handful of draws (boss-car.ts mergeForLow); the door words stay their own strip.
    const low = await read("(()=>{let n=0;mmm.boss.vehicle.car.root.traverseVisible(o=>{if(o.isMesh)n++});return n})()");
    assert.ok(low <= 9, `LOW Boss car: ${low} meshes`);
  } else assert.equal(car.same, true, 'the same model as the player\'s mail car');
  assert.equal(car.door, true, 'THE BOSS on the doors'); assert.equal(car.roofOwn, true);
  await read("document.getElementById('titleStart').click();document.activeElement?.blur()"); await sleep(1500);
  assert.equal(await read('mmm.boss.driver.active'), false, 'no Boss at the start');
  assert.equal(await read('mmm.boss.line()'), '');
  await read(straight); await settle();
  // Clean record: some offences, not yet a step. The Boss stays away.
  const v0 = await read('({x:mmm.vehicle.x,z:mmm.vehicle.z})');
  await read(`mmm.shift.reportScore('flag',${v0.x},${v0.z},0)`); await sleep(2500);
  assert.equal(await read('mmm.fired.book.step'), 0); assert.equal(await read('mmm.boss.driver.active'), false, 'still no Boss before the first step');
  // The first discipline step: the Boss is on its way to the last complaint, from a road out of sight.
  for (const kind of ['sceneDust', 'sceneHit', 'indoors', 'sceneHorn', 'lawnDamage']) {
    if (await read('mmm.fired.book.step') >= 1) break;
    await read(`mmm.shift.reportScore('${kind}',${v0.x},${v0.z},0)`); await sleep(300);
  }
  assert.equal(await read('mmm.fired.book.step'), 1);
  assert.equal(await read('mmm.boss.pursuit.state'), 'onItsWay'); assert.deepEqual(await read('mmm.boss.pursuit.lead'), v0, 'its lead is the last complaint');
  await sleep(400);
  assert.match(await read(PHONE ? "document.getElementById('firedLine').textContent" : "document.getElementById('firedHud').textContent"), /The Boss is on its way\./);
  const arrival = await until('a hidden arrival', `mmm.boss.driver.active&&(()=>{const d=mmm.boss.driver.vehicle,v=mmm.vehicle;return {dist:Math.hypot(d.x-v.x,d.z-v.z),seen:${inView}};})()`, 40);
  console.log(name, 'arrival', JSON.stringify(arrival));
  assert.ok(arrival.dist >= 120, `appears far off (${arrival.dist} m)`); assert.equal(arrival.seen, false, 'appears out of sight');
  await shot('on-its-way');
  // Shift clock frozen for the checks below? No: it runs; record it just before the pull-over.
  if (CASE === 'pullover') {
    await read(`(()=>{const p=bossQA.at(45);mmm.vehicle.restart(p.x,p.z,p.heading);})()`); await settle();
    await read(`(()=>{const p=bossQA.at(45);mmm.vehicle.restart(p.x,p.z,p.heading);})()`);
    await read(placeBoss(15, false));
    const seen = await until('the Boss sees the player', "mmm.boss.pursuit.state==='following'", 10);
    assert.ok(seen);
    // Witnessed: an offence in front of the Boss scores double; one it cannot see does not.
    const w = await read(`(()=>{const v=mmm.vehicle;mmm.shift.reportScore('sceneDust',v.x,v.z,0);const a=mmm.shift.score.recent.at(-1);
      mmm.shift.reportScore('ditchMail',v.x+900,v.z+900,0);const b=mmm.shift.score.recent.at(-1);return {a:a.witnessed,b:b.witnessed,last:document.getElementById('firedHud')?.textContent??''};})()`);
    assert.deepEqual([w.a, w.b], [true, false], 'witnessed in front of the Boss, not out of its sight');
    await sleep(400);
    assert.match(await read(PHONE ? "document.getElementById('firedLine').textContent" : "document.getElementById('firedHud').textContent"), /witnessed ×2|The Boss has seen you/);
    await shot('followed');
    const signal = await until('the flash and the horn', `mmm.boss.pursuit.signal&&${state}`, 20);
    console.log(name, 'signal', JSON.stringify(signal));
    assert.ok(signal.dist < 16, 'close behind'); assert.ok(signal.chain > 0, 'a combo is running');
    await until('the amber flash', "!document.getElementById('bossGlow').hidden&&'#'+mmm.boss.car.roof.emissive.getHexString()==='#ffa526'", 4);
    await until('a honk', 'mmm.boss.honks>0', 4);
    await shot('flash');
    // Standing still under the flash pulls the player over half a second later: the signal sample is the before.
    const before = signal;
    const pulled = await until('pulled over', `mmm.boss.pursuit.pulledOver===1&&${state}`, 10);
    console.log(name, 'pulled', JSON.stringify(pulled));
    const { clockCost } = { clockCost: s => (15 + 5 * Math.max(1, s)) * 60 };
    const cost = clockCost(pulled.step), jumped = pulled.elapsed - before.elapsed;
    assert.ok(jumped >= cost - 5 && jumped < cost + 60, `the clock jumped ${jumped} s for ${cost} s at step ${pulled.step}`);
    assert.equal(pulled.chain, 0, 'the combo is gone'); assert.equal(pulled.total, before.total, 'the points stay'); assert.equal(pulled.step, before.step, 'the step stays');
    assert.match(pulled.note, new RegExp(`^Pulled over.*The Boss.*Suspended on the spot: the clock jumps ${cost / 60} minutes.*The steward grieves it`));
    assert.ok(pulled.leaving || !pulled.active, 'it is leaving, or already gone where nobody sees it'); assert.equal(pulled.state, 'patrol');
    const card = await visible('firedNote'); assert.equal(card.shown, true); assert.equal(card.inside, true, 'the card fits the screen');
    await shot('card');
    // It drives off where nobody sees it, and keeps away while it cools down.
    await until('the Boss gone', '!mmm.boss.driver.active', 20);
    await sleep(3000); assert.equal(await read('mmm.boss.driver.active'), false, 'it stays away in its cooldown');
    // The player was never pushed: the Boss stopped short.
    assert.ok(pulled.dist > 6, `stopped ${pulled.dist} m from the player`);
  } else {
    // It meets the player coming the other way, sees them, then loses them for about 20 s.
    await read(`(()=>{const p=bossQA.at(5);mmm.vehicle.restart(p.x,p.z,p.heading);})()`); await settle();
    await read(`(()=>{const p=bossQA.at(5);mmm.vehicle.restart(p.x,p.z,p.heading);})()`);
    await read(placeBoss(60, true));
    await until('the Boss sees the player', "mmm.boss.pursuit.state==='following'", 10);
    await sleep(600);
    const spotted = await read(state); console.log(name, 'seen', JSON.stringify(spotted));
    assert.equal(spotted.map ?? 'spot', 'spot', 'the small map shows where it is once it has seen you');
    await shot('seen');
    // Gone: far down the road network, out of its sight.
    await read(`(()=>{const {roads:r,vehicle:v}=mmm;let best=null;for(const road of r.roads){if(road.kind>2||road.bridge)continue;for(const p of road.pts){const d=Math.hypot(p[0]-v.x,p[1]-v.z);if(d>800&&d<1200&&(!best||d<best.d))best={d,x:p[0],z:p[1]};}}
      if(!best)throw Error('no far road');const h=r.nearest(best.x,best.z,10);mmm.vehicle.restart(h.x,h.z,h.heading);window.bossFar=best;})()`);
    const t0 = Date.now();
    const lost = await until('lost', `mmm.boss.pursuit.escaped===1&&${state}`, 45);
    const seconds = (Date.now() - t0) / 1000; console.log(name, 'lost after', seconds.toFixed(1), 's', JSON.stringify(lost));
    assert.ok(seconds > 15, 'about 20 s'); assert.equal(lost.state, 'lost');
    const bonus = await read("mmm.shift.score.recent.filter(e=>e.kind==='lostBoss')");
    assert.equal(bonus.length, 1, 'a bonus on the score stream'); assert.ok(await read("mmm.fired.book.kinds.get('lostBoss').points") > 0);
    await sleep(400);
    assert.match(await read(PHONE ? "document.getElementById('firedLine').textContent" : "document.getElementById('firedHud').textContent"), /Lost the Boss/);
    await shot('lost');
    await until('back on patrol', "mmm.boss.pursuit.state==='patrol'", 6);
  }
  if (PHONE) {
    const line = await visible('firedLine'); assert.equal(line.shown, true); assert.equal(line.inside, true);
    assert.ok(await read("(()=>{const s=document.getElementById('phoneStatus');return s.scrollHeight<=s.clientHeight+1})()"), 'the phone status block holds its lines');
  }
  // The end card counts them.
  await read("document.getElementById('endShift').click()"); await sleep(500);
  const lines = await read("[...document.querySelectorAll('#endingCard p')].map(p=>p.textContent)");
  console.log(name, 'end', JSON.stringify(lines));
  assert.ok(lines.includes(CASE === 'pullover' ? 'Pulled over once · lost the Boss never.' : 'Pulled over never · lost the Boss once.'), lines.join('|'));
  await shot('end');
  console.log(`PASS Boss ${name}`);
  if (CASE === 'pullover' && !PHONE) {
    // Mail play and Just Drive build none.
    await page('mode=mail'); assert.equal(await read('mmm.boss'), null, 'no Boss in mail play');
    assert.equal(await read("!!document.getElementById('bossGlow')"), false);
    await page('mode=fired&boss=0'); assert.equal(await read('mmm.boss'), null, '?boss=0');
    await page('site=just&mode=fired', 'localhost'); assert.equal(await read('mmm.boss'), null, 'no Boss in Just Drive');
    // Today's run is Get Fired on a five-minute shift clock, which a pull-over would jump: no Boss there either.
    await page('daily=1'); assert.equal(await read('mmm.fired !== null'), true, "Today's run is a Get Fired run"); assert.equal(await read('mmm.boss'), null, "no Boss in Today's run");
    console.log("PASS no Boss in mail play, with ?boss=0, in Just Drive or in Today's run");
  }
  assert.deepEqual(errors, [], 'runtime exceptions');
} finally { c.close(); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {}); }
