// Only run through tools/yard-shots.sh, which owns tools/browser.sh and its shared slot.
// Get Fired on the dev server, desktop and phone: the title choice, a short scripted run on the real frame loop
// (the car really drives into a route mailbox) to a ladder step, the steward's line, the HUD, the end card and the
// best run; then mail play (the stream records, nothing shows) and Just Drive (no Get Fired at all).
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
const [out, first] = process.argv.slice(2), port = process.env.CDP_PORT;
const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const errors = [];
const c = await cdp(tab.webSocketDebuggerUrl, { deadline: 240000, onEvent: e => {
  if (e.method === 'Runtime.exceptionThrown') errors.push(e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text);
} });
const read = async expression => {
  const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.error || r.result?.exceptionDetails) throw Error(JSON.stringify(r));
  return r.result.result.value;
};
const shot = async name => writeFileSync(`${out}/${name}.png`, Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
const key = (type, code) => c.send('Input.dispatchKeyEvent', { type, code, key: code, windowsVirtualKeyCode: code === 'ArrowUp' ? 38 : 0 });
async function page(phone, query, host = '127.0.0.1') {
  await c.send('Emulation.setDeviceMetricsOverride', { width: phone ? 390 : 1280, height: phone ? 844 : 800, deviceScaleFactor: 1, mobile: phone });
  const url = new URL(`/?x=1&title=1&hud=1&radio=0&res=1&scene=0&day=1&run=1&${phone ? 'touch=1&q=low&' : ''}${query}`, first); url.hostname = host;
  await c.send('Page.navigate', { url: url.href });
  let ready = false;
  for (let i = 0; i < 360 && !ready; i++) { await sleep(500); ready = await read("document.documentElement.dataset.mmmReady === 'true' && !!window.mmm?.shift"); }
  assert.equal(ready, true, 'Mabou settles');
  assert.equal(await read("!!document.querySelector('vite-error-overlay')"), false);
}
const settle = async () => { for (let i = 0; i < 120; i++) { await sleep(500); if (await read("document.documentElement.dataset.mmmReady === 'true'")) return; } throw Error('no settle'); };
// The nearest upright box on today's run that is on ordinary ground, and a pose 7 m before it along its road.
const aim = `(()=>{const {shift:s,props:p,roads:r,vehicle:v}=mmm;
  const ids=s.run.rural.filter(i=>!p.mail[i].motion.down&&s.placeAt(p.mail[i].x,p.mail[i].z)==='route'&&r.nearest(p.mail[i].x,p.mail[i].z,25));
  ids.sort((a,b)=>Math.hypot(p.mail[a].x-v.x,p.mail[a].z-v.z)-Math.hypot(p.mail[b].x-v.x,p.mail[b].z-v.z));
  const i=ids[0],b=p.mail[i],h=r.nearest(b.x,b.z,25),q=h.road.pts,dx=q[h.seg+1][0]-q[h.seg][0],dz=-(q[h.seg+1][1]-q[h.seg][1]),l=Math.hypot(dx,dz);
  const heading=Math.atan2(dx/l,-(dz/l)),x=b.x-7*Math.sin(heading),z=b.z+7*Math.cos(heading);
  window.firedQA={index:i,x,z,heading};return {index:i,box:{x:b.x,z:b.z},road:h.road.name};})()`;
async function knock() {
  const target = await read(aim);
  await read('mmm.vehicle.restart(firedQA.x,firedQA.z,firedQA.heading)'); await settle();
  // Real frames: the car starts at 9 m/s with the throttle held and drives into the box.
  await read('mmm.vehicle.restart(firedQA.x,firedQA.z,firedQA.heading);mmm.vehicle.speed=9;mmm.vehicle.vx=9*Math.sin(firedQA.heading);mmm.vehicle.vz=-9*Math.cos(firedQA.heading)');
  await key('keyDown', 'ArrowUp'); await sleep(1600); await key('keyUp', 'ArrowUp');
  return { ...target, down: await read('mmm.props.mail[firedQA.index].motion.down') };
}
const visible = id => read(`(()=>{const e=document.getElementById('${id}');if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);
  return {shown:s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth+.5&&r.bottom<=innerHeight+.5,text:e.textContent,height:r.height,width:r.width};})()`);
try {
  await c.send('Runtime.enable'); await c.send('Page.enable');
  for (const phone of [false, true]) {
    const name = phone ? 'phone' : 'desktop';
    await page(phone, 'mode=fired');
    const career = await read("localStorage.getItem('mmm.shift.v1')");
    const title = await read(`(()=>{const b=[...document.querySelectorAll('#modeChoice button')];return {ids:b.map(x=>x.id),pressed:b.map(x=>x.getAttribute('aria-pressed')),
      fit:b.every(x=>{const r=x.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height>=44;}),h1:document.querySelector('#title h1').textContent,tag:document.querySelector('#title .tag').textContent}})()`);
    assert.deepEqual(title.ids, ['modeMail', 'modeExplore', 'modeFired']); assert.deepEqual(title.pressed, ['false', 'false', 'true']);
    assert.equal(title.fit, true, 'three touch-sized choices fit'); assert.match(title.tag, /Get Fired/);
    assert.equal(await read('mmm.gameMode'), 'fired'); assert.equal(await read('mmm.shift.fired'), true);
    // The real places main.ts names: the Mabou church ground, every cemetery, the school bus stop; and open road.
    const places = await read(`(async()=>{const {BUS}=await import('/src/school-bus-rules.ts');const {shift:s,cemeteries:c,schoolBus:b,props:p}=mmm,v=[624271,5103301];
      const lm=await (await fetch('/terrain/landmarks.json')).json(),ch=lm.find(l=>/church/i.test(l.name));
      const church=ch.footprint.map(([e,n])=>s.placeAt(e-v[0],v[1]-n));
      const cem=c.list.map(x=>{const r=x.ring;for(let i=0;i<r.length;i++)for(let j=i+2;j<r.length;j++){const e=(r[i][0]+r[j][0])/2,n=(r[i][1]+r[j][1])/2;if(c.excludes(e,n))return s.placeAt(e-v[0],v[1]-n);}return 'none';});
      const stop={x:0,z:0,heading:0};b.road.at(BUS.stop,BUS.lane,stop);
      return {church,cem,bus:s.placeAt(stop.x,stop.z),road:s.placeAt(p.mail[s.run.rural[0]].x,p.mail[s.run.rural[0]].z)};})()`);
    assert.ok(places.church.every(p => p === 'church'), JSON.stringify(places.church));
    assert.ok(places.cem.length >= 1 && places.cem.every(p => p === 'cemetery'), JSON.stringify(places.cem));
    assert.equal(places.bus, 'busStop');
    await shot(`fired-${name}-title`);
    await read("document.getElementById('titleStart').click();document.activeElement?.blur()"); await sleep(500);
    assert.match(await read("document.getElementById('shiftHud').textContent"), /GET FIRED/);
    const hit = await knock(); console.log(name, 'knock', JSON.stringify(hit));
    assert.equal(hit.down, true, 'the car knocked the box down');
    const state = await read(`(()=>{const f=mmm.fired,b=f.book;return {total:b.total,step:b.step,kinds:[...b.kinds.keys()],note:document.getElementById('firedNote').textContent,noteHidden:document.getElementById('firedNote').hidden,
      recent:mmm.shift.score.recent.map(e=>e.kind+'@'+e.place)}})()`);
    console.log(name, 'run', JSON.stringify(state));
    assert.ok(state.kinds.includes('box:down') && state.kinds.includes('boxDown'), 'the grade and the call both scored');
    assert.ok(state.step >= 1, 'at least one ladder step'); assert.equal(state.noteHidden, false);
    assert.match(state.note, /^(Coaching chat|Verbal warning|Written warning).*You still work here\.$/);
    const note = await visible('firedNote'); assert.equal(note.shown, true); assert.equal(note.inside, true, 'the steward note fits the screen');
    if (phone) {
      const line = await visible('firedLine'); assert.equal(line.shown, true); assert.equal(line.inside, true);
      assert.match(line.text, /pts.* \d\/7/); assert.equal((await visible('firedHud')).shown, false);
      assert.ok(await read("document.getElementById('phoneStatus').contains(document.getElementById('firedLine'))"));
      assert.ok(await read("(()=>{const s=document.getElementById('phoneStatus');return s.scrollHeight<=s.clientHeight+1})()"), 'the phone status block holds both lines');
    } else {
      const hud = await visible('firedHud'); assert.equal(hud.shown, true); assert.equal(hud.inside, true); assert.match(hud.text, /pts/);
      const overlap = await read(`(()=>{const a=document.getElementById('firedHud').getBoundingClientRect();
        return ['hud','shiftHud','stopHint','miniMap','relief','radio','photoTag','mailScore','endShift','pauseButton','gear','credit','mailButton','cameraButton'].filter(id=>{
          const e=document.getElementById(id);if(!e)return false;const s=getComputedStyle(e),b=e.getBoundingClientRect();
          return s.display!=='none'&&s.visibility!=='hidden'&&b.width>0&&a.top<b.bottom&&b.top<a.bottom&&a.left<b.right&&b.left<a.right;});})()`);
      assert.deepEqual(overlap, [], 'the score panel covers no other HUD piece');
    }
    await shot(`fired-${name}-step`);
    // End the run: the end card, the best run on its own key, the shift career untouched.
    await read("document.getElementById('endShift').click()"); await sleep(400);
    const card = await read(`(()=>{const f=document.getElementById('endingFrame');return {hidden:f.hidden,title:document.getElementById('endingTitle')?.textContent,
      lines:[...f.querySelectorAll('#endingCard p')].map(p=>p.textContent),buttons:[...f.querySelectorAll('button')].map(b=>b.textContent),
      report:document.getElementById('shiftReport').hidden,best:localStorage.getItem('mmm.fired.best.v1'),career:localStorage.getItem('mmm.shift.v1'),
      fits:(()=>{const r=document.getElementById('endingCard').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()}})()`);
    console.log(name, 'card', JSON.stringify(card));
    assert.equal(card.hidden, false); assert.equal(card.lines[0], 'Get Fired'); assert.equal(card.title, ['Clean record', 'Coaching chat', 'Verbal warning', 'Written warning', 'One-day suspension', 'Three-day suspension', 'Hearing', 'Fired'][await read('mmm.fired.book.step')]);
    assert.ok(card.lines.some(l => /^1\. /.test(l)), 'top offences'); assert.ok(card.lines.some(l => /^Best combo: /.test(l)));
    assert.ok(card.lines.some(l => /^Your (best run|first run)/.test(l)));
    // Main's shared ending frame adds its replay button to every ending once a replay is ready.
    assert.equal(card.buttons[0], 'Try again'); assert.ok(card.buttons.slice(1).every(b => b === 'Watch replay'), JSON.stringify(card.buttons)); assert.equal(card.report, true, 'no daily report in Get Fired');
    assert.ok(card.best && JSON.parse(card.best).total > 0); assert.equal(card.career, career, 'mmm.shift.v1 untouched');
    assert.equal(card.fits, true, 'the end card fits');
    await shot(`fired-${name}-end`);
    await read("document.querySelector('#endingChoices button').click()"); await sleep(400);
    const again = await read('({ended:mmm.shift.ended,total:mmm.fired.book.total,card:document.getElementById("endingFrame").hidden,elapsed:mmm.shift.elapsed})');
    assert.deepEqual({ ended: again.ended, total: again.total, card: again.card }, { ended: false, total: 0, card: true }, 'try again starts a fresh run');
    console.log('PASS Get Fired', name, 'title, real knock to', state.step, 'step(s), steward line, HUD, end card, best run, retry');
  }
  // Mail play: the stream records the same knock; nothing shows it and nothing changes.
  await page(false, 'mode=mail');
  await read("document.getElementById('titleStart').click();document.activeElement?.blur()"); await sleep(300);
  const before = await read("localStorage.getItem('mmm.fired.best.v1')");
  const mailHit = await knock(); assert.equal(mailHit.down, true);
  const mail = await read(`({fired:mmm.fired,reported:mmm.shift.score.reported,hud:document.getElementById('firedHud'),note:document.getElementById('firedNote'),line:document.getElementById('firedLine'),
    shiftHud:document.getElementById('shiftHud').textContent,best:localStorage.getItem('mmm.fired.best.v1'),modeFired:document.getElementById('modeFired')?.getAttribute('aria-pressed')})`);
  assert.equal(mail.fired, null); assert.ok(mail.reported > 0, 'the stream records in mail play');
  assert.equal(mail.hud, null); assert.equal(mail.note, null); assert.equal(mail.line, null);
  assert.doesNotMatch(mail.shiftHud, /FIRED/); assert.equal(mail.best, before); assert.equal(mail.modeFired, 'false');
  console.log('PASS mail play: stream records', mail.reported, 'facts; no Get Fired HUD, card or storage');
  // Just Drive never offers it, even when asked.
  await page(false, 'site=just&mode=fired', 'localhost');
  assert.equal(await read('mmm.gameMode'), 'explore');
  assert.equal(await read("!!document.getElementById('modeFired')||!!document.getElementById('firedHud')"), false);
  console.log('PASS Just Drive: no Get Fired');
  assert.deepEqual(errors, [], 'runtime exceptions');
} finally { c.close(); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {}); }
