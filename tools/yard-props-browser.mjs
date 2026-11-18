// Only run through tools/yard-shots.sh, which owns tools/browser.sh and its shared slot.
// Breakable yard and field props on the dev server, one kind group per row (YARD_KIND=fence|clothesline|ornament|
// woodpile|bale|bins). Desktop plays Get Fired with the keyboard; the phone plays mail on LOW detail with the touch GO
// pedal. For each kind the car really drives into a real placed prop on the real frame loop: the prop breaks into
// pieces that come to rest on the ground, the car slows, the score stream gets the fact (points in Get Fired), mail
// play files one property-damage call, and a new shift stands it up again. The fence row also proves a slow touch is
// a solid stop, nothing stands at a protected place, and Explore and Just Drive have no yard props; the bale row
// proves a rolling bale that hits another is a combo.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
const [out, first] = process.argv.slice(2), port = process.env.CDP_PORT;
const GROUPS = {
  fence: ['railFence', 'picketFence'], clothesline: ['clothesline'], ornament: ['whirligig', 'buoys', 'traps', 'well'],
  woodpile: ['woodpile'], bale: ['bale'], bins: ['garbageBin', 'recyclingBin'],
};
const group = process.env.YARD_KIND ?? 'fence', kinds = GROUPS[group];
assert.ok(kinds, `YARD_KIND must be one of ${Object.keys(GROUPS).join(', ')}`);
// Day 7 is garbage and recycling day for the seeded weekday (asserted in the page from the rules).
const DAY = 7;
const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const errors = [];
const c = await cdp(tab.webSocketDebuggerUrl, { deadline: 900000, onEvent: e => {
  if (e.method === 'Runtime.exceptionThrown') errors.push(e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text);
} });
const read = async expression => {
  const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.error || r.result?.exceptionDetails) throw Error(JSON.stringify(r).slice(0, 1500));
  return r.result.result.value;
};
const settle = async () => { for (let i = 0; i < 160; i++) { await sleep(400); if (await read("document.documentElement.dataset.mmmReady === 'true'")) return; } throw Error('no settle'); };
async function page(phone, query, host = '127.0.0.1') {
  await c.send('Emulation.setDeviceMetricsOverride', { width: phone ? 390 : 1280, height: phone ? 844 : 800, deviceScaleFactor: 1, mobile: phone });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: 5 });
  const url = new URL(`/?x=1&hud=1&radio=0&res=1&scene=0&day=${DAY}&run=1&${phone ? 'touch=1&q=low&' : ''}${query}`, first); url.hostname = host;
  await c.send('Page.navigate', { url: url.href });
  let ready = false;
  for (let i = 0; i < 360 && !ready; i++) { await sleep(500); ready = await read("document.documentElement.dataset.mmmReady === 'true' && !!window.mmm?.shift"); }
  assert.equal(ready, true, 'the page settles');
  assert.equal(await read("!!document.querySelector('vite-error-overlay')"), false);
}
// A picture of one prop from a fixed camera, rendered once with the frame loop held.
async function shot(name, id) {
  await read(`window.yqRAF=requestAnimationFrame;window.requestAnimationFrame=cb=>{window.yqFrame=cb;return 0;}`);
  await sleep(150);
  try {
    // Aimed at the pieces once it is broken (they may have rolled or scattered), else at the prop.
    await read(`(()=>{const {camera,renderer,scene,terrain,yardProps:y}=mmm,l=y.live[${id}],p=l.p,ps=l.pieces??[];
      const cx=ps.length?ps.reduce((s,q)=>s+q.x,0)/ps.length:p.x,cz=ps.length?ps.reduce((s,q)=>s+q.z,0)/ps.length:p.z,g=terrain.heightAt(cx,cz)??l.y;
      const a=p.yaw+2.3,d=p.kind==='bale'?10:p.kind.endsWith('Fence')||p.kind==='clothesline'?7:5;
      camera.position.set(cx+Math.sin(a)*d,g+(p.kind==='bale'?4.5:3.4),cz-Math.cos(a)*d);camera.lookAt(cx,g+.4,cz);camera.updateMatrixWorld();
      y.update(camera,0);renderer.render(scene,camera);})()`);
    writeFileSync(`${out}/${name}.png`, Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  } finally { await read('window.requestAnimationFrame=yqRAF;if(window.yqFrame)yqRAF(yqFrame);'); }
}
// The throttle: the arrow key on the desktop, the GO pedal by touch on the phone.
async function hold(phone, ms) {
  if (!phone) {
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'ArrowUp', key: 'ArrowUp', windowsVirtualKeyCode: 38 });
    await sleep(ms);
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ArrowUp', key: 'ArrowUp', windowsVirtualKeyCode: 38 });
    return;
  }
  const go = await read(`(()=>{const r=document.getElementById('tcGo').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width}})()`);
  assert.ok(go.w >= 44, 'the GO pedal is touch-sized');
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 3, x: go.x, y: go.y }] });
  await sleep(ms);
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
// Candidates of these kinds, nearest the car first, on ordinary ground and out today.
const candidates = list => read(`(async()=>{const {outToday}=await import('/src/yard-props-rules.ts');const {yardProps:y,vehicle:v,shift:s}=mmm;
  // A bale stands only in open field: skip those whose ground (even coarse) already shows trees.
  return y.live.filter(l=>${JSON.stringify(list)}.includes(l.p.kind)&&!l.broken&&l.field!==0&&outToday(l.p,y.day)&&s.placeAt(l.p.x,l.p.z)==='route'&&
      (!l.p.field||(mmm.terrain.surfaceAt(l.p.x,l.p.z)?.canopy??0)<1))
    .sort((a,b)=>Math.hypot(a.p.x-v.x,a.p.z-v.z)-Math.hypot(b.p.x-v.x,b.p.z-v.z)).slice(0,40).map(l=>l.p.id);})()`);
// A clear run-up to prop `id`: 9 m out, across a long prop, with no building, road solid or other yard prop on the way.
// With `toward`, the run-up lines up with that prop instead (a bale knocked into its neighbour).
const approach = (id, toward = -1) => read(`(()=>{const {yardProps:y,terrain:t}=mmm,l=y.live[${id}],p=l.p;
  const long=p.kind.endsWith('Fence')||p.kind==='clothesline'||p.kind==='woodpile'||p.kind==='traps';
  const dirs=[];
  if(${toward}>=0){const q=y.live[${toward}].p,dx=q.x-p.x,dz=q.z-p.z,n=Math.hypot(dx,dz);dirs.push([dx/n,dz/n]);}
  else for(let k=0;k<16;k++){const a=p.yaw+(long?Math.PI/2:0)+(k%2?-1:1)*Math.ceil(k/2)*Math.PI/8;dirs.push([Math.sin(a),-Math.cos(a)]);}
  const why={};
  for(const [dx,dz] of dirs){
    let ok=t.heightAt(p.x-dx*9,p.z-dz*9)!==null;if(!ok)why.unloaded=(why.unloaded||0)+1;
    // No roof or tree (the terrain's canopy) and no other yard prop on the run-up.
    for(let s=.3;ok&&s<=1.0;s+=.05){const x=p.x-dx*9*s,z=p.z-dz*9*s,g=t.surfaceAt(x,z);
      if(!g||g.canopy>.8){ok=false;why.canopy=g?.canopy;break;}
      for(const o of y.live)if(o!==l&&o.p.id!==${toward}&&Math.hypot(o.p.x-x,o.p.z-z)<2.6){ok=false;why.prop=o.p.kind;break;}
    }
    if(ok)return {x:p.x-dx*9,z:p.z-dz*9,heading:Math.atan2(dx,-dz)};
  }
  return {why};})()`);
async function breakOne(phone, id, speed = 8, toward = -1, picture = '') {
  // Go there first, so the fine ground round it loads (a phone loads less of the map ahead).
  if (!(await read(`mmm.terrain.surfaceAt(mmm.yardProps.live[${id}].p.x,mmm.yardProps.live[${id}].p.z)?.level>=6`))) {
    await read(`(()=>{const p=mmm.yardProps.live[${id}].p;mmm.vehicle.restart(p.x+14*Math.cos(p.yaw),p.z+14*Math.sin(p.yaw),p.yaw)})()`); await settle();
  }
  const pose = await approach(id, toward);
  if (pose.why) { console.log('  skip', id, 'no clear run-up', JSON.stringify(pose.why)); return null; }
  await read(`mmm.vehicle.restart(${pose.x},${pose.z},${pose.heading})`); await settle();
  // The prop must be drawn (fine ground in, and a bale in open field) before the run.
  for (let i = 0; i < 30 && !(await read(`mmm.yardProps.active.includes(mmm.yardProps.live[${id}])`)); i++) await sleep(300);
  if (!(await read(`mmm.yardProps.active.includes(mmm.yardProps.live[${id}])&&!mmm.yardProps.live[${id}].broken`))) {
    console.log('  skip', id, 'not drawn', JSON.stringify(await read(`(()=>{const l=mmm.yardProps.live[${id}];return {y:l.y,field:l.field,active:mmm.yardProps.active.length}})()`)));
    return null;
  }
  if (picture) await shot(picture, id);
  const reported = await read('mmm.shift.score.reported');
  await read(`mmm.vehicle.restart(${pose.x},${pose.z},${pose.heading});mmm.vehicle.speed=${speed};mmm.vehicle.vx=${speed}*Math.sin(${pose.heading});mmm.vehicle.vz=-${speed}*Math.cos(${pose.heading})`);
  await hold(phone, 1500);
  const broken = await read(`mmm.yardProps.live[${id}].broken`);
  if (!broken) console.log('  missed', id, JSON.stringify(await read(`({car:[mmm.vehicle.x,mmm.vehicle.z],p:[mmm.yardProps.live[${id}].p.x,mmm.yardProps.live[${id}].p.z],pose:${JSON.stringify(pose)}})`)));
  return { pose, reported, broken };
}
const restingWithin = async (id, seconds) => {
  for (let i = 0; i < seconds * 4; i++) {
    if (await read(`mmm.yardProps.live[${id}].pieces.every(p=>p.resting)`)) return true;
    await sleep(250);
  }
  return false;
};
try {
  await c.send('Runtime.enable'); await c.send('Page.enable');
  // YARD_DEVICE=desktop|phone runs one of the two (a rerun while fixing); a check row runs both.
  for (const phone of [false, true].filter(p => !process.env.YARD_DEVICE || process.env.YARD_DEVICE === (p ? 'phone' : 'desktop'))) {
    const name = phone ? 'phone' : 'desktop', mode = phone ? 'mail' : 'fired';
    await page(phone, `mode=${mode}`);
    const rules = await read(`(async()=>{const r=await import('/src/yard-props-rules.ts');return {garbage:r.garbageDay(${DAY}),recycling:r.recyclingDay(${DAY})}})()`);
    assert.deepEqual(rules, { garbage: true, recycling: true }, 'day 7 is garbage and recycling day');
    assert.equal(await read('!!mmm.yardProps'), true, `${mode} play has yard props`);
    if (group === 'fence') {
      // Nothing stands at a cemetery, a church ground or the school bus stop: the game's own real places.
      const at = await read(`(()=>{const {yardProps:y,shift:s}=mmm;const places={};for(const l of y.live){const k=s.placeAt(l.p.x,l.p.z);places[k]=(places[k]||0)+1;}return places})()`);
      assert.deepEqual(Object.keys(at), ['route'], JSON.stringify(at));
    }
    for (const kind of kinds) {
      const ids = await candidates([kind]);
      assert.ok(ids.length > 0, `${kind}: placed somewhere today`);
      let hit = null, id = -1, toward = -1;
      for (const candidate of ids.slice(0, 14)) {
        let mate = -1;
        if (kind === 'bale') {
          // A bale with a neighbour in its row: knocked into it, it rolls on and breaks it.
          mate = await read(`(()=>{const y=mmm.yardProps,a=y.live[${candidate}].p;const m=y.live.filter(l=>l.p.kind==='bale'&&l.p.id!==a.id&&Math.hypot(l.p.x-a.x,l.p.z-a.z)<5)
            .sort((p,q)=>Math.hypot(p.p.x-a.x,p.p.z-a.z)-Math.hypot(q.p.x-a.x,q.p.z-a.z))[0];return m?m.p.id:-1})()`);
          if (mate < 0) { console.log('  skip', candidate, 'no neighbour'); continue; }
        }
        const r = await breakOne(phone, candidate, 8, mate, `yard-${name}-${kind}-before`);
        if (r?.broken) { hit = r; id = candidate; toward = mate; break; }
      }
      assert.ok(hit, `${kind}: the car drove into one and broke it`);
      const facts = await read(`mmm.shift.score.recent.slice(-12)`);
      const state = await read(`(async()=>{const {scoreKind}=await import('/src/yard-props-rules.ts');const {yardProps:y,shift:s,fired:f}=mmm,l=y.live[${id}];
        return {kind:scoreKind(l.p.kind),owner:l.p.owner,pieces:l.pieces.length,speed:Math.hypot(mmm.vehicle.vx,mmm.vehicle.vz),
          calls:s.complaints.all.filter(c=>c.kind==='propertyDamage').map(c=>c.target),
          book:f?{total:f.book.total,kinds:[...f.book.kinds.keys()],best:f.book.bestChain}:null}})()`);
      console.log(name, kind, JSON.stringify({ id, toward, state, facts: facts.map(e => `${e.kind}@${e.place}:${e.speed.toFixed(1)}`) }));
      const fact = facts.find(e => e.kind === state.kind);
      assert.ok(fact, `${kind}: a ${state.kind} fact in the score stream`);
      assert.equal(fact.place, 'route'); assert.ok(fact.speed > 1, 'the fact carries the hit speed');
      assert.ok(state.pieces >= 1, 'it came apart into pieces');
      assert.ok(state.calls.includes(state.owner), 'one property-damage call for its owner');
      if (state.book) assert.ok(state.book.kinds.includes(state.kind) && state.book.total > 0, `${kind}: points in Get Fired`);
      if (kind === 'bale') {
        const mate = await read(`mmm.yardProps.live[${toward}].broken`);
        assert.equal(mate, true, 'the rolling bale broke its neighbour');
        assert.ok(facts.some(e => e.kind === 'prop:baleStrike'), 'a bale strike fact');
        // The car's break alone is two kinds (the bale and the yard call); the strike makes a third.
        if (state.book) assert.ok(await read('mmm.fired.book.bestChain.kinds') >= 3, 'the strike adds to the combo');
      }
      assert.ok(await restingWithin(id, kind === 'bale' ? 24 : 9), `${kind}: every piece comes to rest`);
      const ground = await read(`(()=>{const {yardProps:y,terrain:t}=mmm;return y.live[${id}].pieces.map(p=>p.y-p.floor-(t.heightAt(p.x,p.z)??p.y-p.floor))})()`);
      assert.ok(ground.every(d => Math.abs(d) < .12), `${kind}: pieces rest on the ground ${JSON.stringify(ground)}`);
      await shot(`yard-${name}-${kind}-broken`, id);
      // A new shift stands it up again.
      // A new shift of the same day (a new career would start on day 1, which has no bins out).
      await read('mmm.shift.retry()'); await sleep(400);
      assert.equal(await read('mmm.yardProps.day'), DAY, 'the same day again');
      assert.deepEqual(await read(`({broken:mmm.yardProps.live[${id}].broken,pieces:mmm.yardProps.live[${id}].pieces,count:mmm.yardProps.broken})`), { broken: false, pieces: null, count: 0 }, 'a new shift resets it');
      console.log(`PASS ${name} ${kind}: real ${phone ? 'touch' : 'keyboard'} hit at ${fact.speed.toFixed(1)} m/s, ${state.pieces} pieces at rest, ${state.kind} fact, one call, reset`);
    }
    if (group === 'fence') {
      // Every kind is placed on the real land, and the houses' own clear boxes do not empty the yards
      // (the oriented building rule keeps props off the walls; woodpiles stand just behind the house).
      const counts = await read(`(()=>{const c={};for(const l of mmm.yardProps.live)c[l.p.kind]=(c[l.p.kind]??0)+1;return c})()`);
      for (const [k, min] of Object.entries({ railFence: 15, picketFence: 15, clothesline: 40, whirligig: 15, buoys: 15, traps: 15, well: 15, woodpile: 25, bale: 200, garbageBin: 60, recyclingBin: 60 }))
        assert.ok((counts[k] ?? 0) >= min, `${name}: at least ${min} ${k} on the real land, got ${counts[k] ?? 0} ${JSON.stringify(counts)}`);
      console.log(`PASS ${name}: placed on the real land ${JSON.stringify(counts)}`);
      // A slow touch: the fence holds and stops the car, and nothing is reported.
      const ids = await candidates(['railFence']);
      let done = false;
      for (const id of ids.slice(0, 10)) {
        const pose = await approach(id);
        if (pose.why) continue;
        const ax = pose.x + (await read(`mmm.yardProps.live[${id}].p.x`) - pose.x) * .55, az = pose.z + (await read(`mmm.yardProps.live[${id}].p.z`) - pose.z) * .55;
        await read(`mmm.vehicle.restart(${ax},${az},${pose.heading})`); await settle();
        if (!(await read(`mmm.yardProps.active.includes(mmm.yardProps.live[${id}])`))) continue;
        const before = await read('mmm.shift.score.reported');
        await read(`mmm.vehicle.speed=1.2;mmm.vehicle.vx=1.2*Math.sin(${pose.heading});mmm.vehicle.vz=-1.2*Math.cos(${pose.heading})`);
        await sleep(2500);
        const r = await read(`({broken:mmm.yardProps.live[${id}].broken,reported:mmm.shift.score.reported,speed:Math.hypot(mmm.vehicle.vx,mmm.vehicle.vz)})`);
        assert.equal(r.broken, false, 'a slow touch does not break a fence'); assert.equal(r.reported, before, 'and reports nothing');
        console.log(`PASS ${name}: a slow touch holds (speed after ${r.speed.toFixed(2)} m/s)`); done = true; break;
      }
      assert.ok(done, 'a slow-touch case ran');
    }
  }
  if (group === 'fence') {
    await page(false, 'mode=explore');
    assert.equal(await read('mmm.yardProps'), null, 'Explore has no yard props');
    await page(false, 'site=just&mode=fired', 'localhost');
    assert.equal(await read('mmm.gameMode'), 'explore'); assert.equal(await read('mmm.yardProps'), null, 'Just Drive has no yard props');
    await page(false, 'mode=mail&yardProps=0');
    assert.equal(await read('mmm.yardProps'), null, '?yardProps=0 leaves them out');
    console.log('PASS off in Explore, Just Drive and with ?yardProps=0');
  }
  assert.deepEqual(errors, [], 'runtime exceptions');
} finally { c.close(); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {}); }
