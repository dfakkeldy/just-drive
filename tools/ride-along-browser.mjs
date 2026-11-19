// Only run through tools/yard-shots.sh, which owns tools/browser.sh and its shared slot.
// The Boss's ride-along day in mail play (web/src/ride-along.ts), on the dev server and the real frame loop.
// RIDE_PHONE=1 is the phone (390 x 844, touch, LOW).
//   A seeded ride-along day (ride-along-rules.ts): the start card says so; the Boss waits at its post on the day's
//   run; the shift-start hint. The player is set 30 m ahead of it on its road, facing it, and throws mail onto a lawn
//   (the game's own landing path): seen by the Boss, on file at once; it follows and flashes (the hint, the amber roof
//   and glow, the horn); the player stands still and it pulls up alongside, never touching: the write-up card, the
//   clock jumps 20 minutes, the
//   shift goes on; it drives off. With every stop delivered the day's verdict is then a written warning, and the
//   report lists what the Boss saw and marks the complaint "Seen by the Boss. No photo accepted."
//   Desktop also: a clean ride-along day ends with the clean line; day 2 has no Boss on the road and no line; no
//   ride-along in Get Fired, Today's run, Just Drive or with ?boss=0.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
const [out, first] = process.argv.slice(2), port = process.env.CDP_PORT;
const PHONE = process.env.RIDE_PHONE === '1', name = PHONE ? 'phone' : 'desktop';
// Desktop: day 3 on run 1, all Highway 19 (it parks on the shoulder and pulls out); phone: day 16 on run 3, side roads
// (it crawls). Both are seeded ride-along days (ride-along-rules-check pins them).
const RIDE = PHONE ? 'day=16&run=3' : 'day=3&run=1';
const START = 'The Boss is out on the route today.', CLEAN = 'The Boss had nothing to say. That is the best he does.';
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
const shot = async label => writeFileSync(`${out}/ride-along-${name}-${label}.png`, Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
async function page(query, host = '127.0.0.1') {
  await c.send('Emulation.setDeviceMetricsOverride', { width: PHONE ? 390 : 1280, height: PHONE ? 844 : 800, deviceScaleFactor: 1, mobile: PHONE });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: PHONE });
  const url = new URL(`/?x=1&title=1&hud=1&radio=0&res=1&scene=0&${PHONE ? 'touch=1&q=low&' : ''}${query}`, first); url.hostname = host;
  await c.send('Page.navigate', { url: url.href });
  let ready = false;
  for (let i = 0; i < 360 && !ready; i++) { await sleep(500); ready = await read("document.documentElement.dataset.mmmReady === 'true' && !!window.mmm?.shift").catch(() => false); }
  assert.equal(ready, true, 'Mabou settles');
  assert.equal(await read("!!document.querySelector('vite-error-overlay')"), false);
}
const settle = async () => { for (let i = 0; i < 120; i++) { await sleep(500); if (await read("document.documentElement.dataset.mmmReady === 'true'")) return; } throw Error('no settle'); };
const until = async (what, expression, seconds) => {
  for (let i = 0; i < seconds * 5; i++) { const v = await read(expression); if (v) return v; await sleep(200); }
  throw Error(`${name}: ${what} not within ${seconds} s (${JSON.stringify(await read(STATE).catch(() => null))})`);
};
const visible = id => read(`(()=>{const e=document.getElementById('${id}');if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);
  return {shown:s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth+.5&&r.bottom<=innerHeight+.5,text:e.textContent};})()`);
const STATE = `(()=>{const b=mmm.boss,w=b.watch,v=mmm.vehicle,d=b.vehicle;return {state:w.state,signal:w.signal,seen:w.seen.map(o=>o.label),pulled:w.pulledOver,
  active:b.driver.active,leaving:b.driver.leaving,dist:Math.round(Math.hypot(d.x-v.x,d.z-v.z)*10)/10,elapsed:mmm.shift.elapsed,ended:mmm.shift.ended,honks:b.honks,
  glow:!document.getElementById('bossGlow').hidden,roof:'#'+b.car.roof.emissive.getHexString(),hint:document.getElementById('stopHint').textContent,
  note:document.getElementById('bossNote').hidden?'':document.getElementById('bossNote').textContent,map:!!b.mapSpot}})()`;
// Is the Boss's car in the camera's view?
const inView = `(()=>{const T=mmm.camera,d=mmm.boss.vehicle,m=T.projectionMatrix.clone().multiply(T.matrixWorldInverse),p=T.position.clone().set(d.x,d.y+1,d.z).applyMatrix4(m);
  return Math.abs(p.x)<1&&Math.abs(p.y)<1&&p.z<1;})()`;
// The player on the Boss's road, `metres` in front of it in the other lane, facing it (so the chase camera sees it).
const ahead = metres => `(()=>{const b=mmm.boss,p=b.post,d=b.vehicle,s=p.path.alongAt(d.x,d.z),h={x:0,z:0,heading:0};p.path.at(s,0,h);
  const dir=Math.cos(d.heading-h.heading)>=0?1:-1,q={x:0,z:0,heading:0};p.path.at(s+dir*${metres},-dir*p.edge,q);
  mmm.vehicle.restart(q.x,q.z,q.heading+(dir>0?Math.PI:0));return {x:q.x,z:q.z};})()`;

try {
  await c.send('Runtime.enable'); await c.send('Page.enable');
  // A ride-along day: the start card, the Boss at its post.
  await page(`mode=mail&${RIDE}`);
  const boss = await read('(()=>{const b=mmm.boss;return b&&{today:b.today,post:!!b.post,crawl:b.post?.crawl,stop:b.post?.stop,pursuit:!!b.pursuit,name:b.vehicle.car.root.name}})()');
  console.log(name, 'boss', JSON.stringify(boss));
  assert.equal(boss?.today, true, 'a ride-along day'); assert.equal(boss.crawl, PHONE, PHONE ? 'crawling on run 3' : 'parked on the highway shoulder'); assert.equal(boss.post, true, 'a post on the day\'s run'); assert.equal(boss.pursuit, false, 'not the Get Fired pursuit');
  assert.equal(boss.name, 'The Boss');
  const card = await visible('titleBoss'); assert.equal(card?.text, START, 'the start card says so'); assert.equal(card.shown, true); assert.equal(card.inside, true, 'the line fits the card');
  if (PHONE) assert.ok(await read("(()=>{let n=0;mmm.boss.vehicle.car.root.traverseVisible(o=>{if(o.isMesh)n++});return n})()") <= 9, 'LOW: the Boss car merged');
  await shot('start-card');
  await read("document.getElementById('titleStart').click();document.activeElement?.blur()"); await sleep(1200);
  assert.equal(await read('mmm.boss.driver.active'), true, 'the Boss is on the road at its post');
  assert.equal(await read("document.getElementById('stopHint').textContent"), START, 'the shift-start hint');
  const at = await read('(()=>{const d=mmm.boss.vehicle,s=mmm.shift,p=mmm.boss.post;return {place:s.placeAt(d.x,d.z),x:d.x,z:d.z,road:mmm.roads.nearest(d.x,d.z,8)?.road.kind}})()');
  console.log(name, 'post', JSON.stringify(at));
  assert.equal(at.place, 'route', 'never at a cemetery, a church ground or the bus stop');
  // In front of it, stopped; a piece of mail onto a lawn.
  // A crawl is set to the start of its out leg first, so "in front of it" is along the road, not across it mid-turn.
  if (boss.crawl) { await read('mmm.boss.crawl=1'); await sleep(500); }
  await read(ahead(30)); await settle(); if (boss.crawl) { await read('mmm.boss.crawl=1'); await sleep(500); } await read(ahead(30)); await sleep(800);
  await until('the Boss sees the player', `(()=>{mmm.boss.look=0;return mmm.boss.seen})()`, 6);
  assert.equal(await read(inView), true, 'the Boss in the picture');
  await shot('watching');
  const thrown = await read(`(()=>{const v=mmm.vehicle,n=mmm.shift.complaints.all.length;mmm.shift.mail.service.ground(v.x+Math.cos(v.heading)*4,v.z+Math.sin(v.heading)*4,true);
    const c=mmm.shift.complaints.all.slice(n);return c.map(x=>({kind:x.kind,seen:!!x.seen}));})()`);
  console.log(name, 'thrown', JSON.stringify(thrown));
  assert.deepEqual(thrown, [{ kind: 'lawnMail', seen: true }], 'seen by the Boss, on file at once');
  let s = await read(STATE);
  assert.equal(s.state, 'following'); assert.equal(s.signal, true, 'it flashes'); assert.deepEqual(s.seen, ['Mail on a lawn']);
  await until('the flash on screen', `(()=>{const s=${STATE};return s.glow&&s.roof==='#ffa526'&&s.hint==='The Boss is flashing at you. Pull over.'&&s})()`, 4);
  await until('a honk', 'mmm.boss.honks>0', 4);
  await shot('flash');
  // Standing still: pulled over once it is near.
  const before = await read(STATE), stood = await read('({x:mmm.vehicle.x,z:mmm.vehicle.z})');
  const pulled = await until('pulled over', `mmm.boss.watch.pulledOver===1&&${STATE}`, 25);
  console.log(name, 'pulled', JSON.stringify(pulled));
  if (!boss.crawl) assert.equal(await read('mmm.boss.pullSide<=mmm.boss.post.edge&&mmm.boss.post.side>mmm.boss.post.edge'), true, 'it pulled out from the shoulder into its lane');
  const jumped = pulled.elapsed - before.elapsed;
  assert.ok(jumped >= 1200 && jumped < 1200 + 25 * 20 + 60, `the clock jumped ${jumped} s (20 minutes and the seconds it took)`);
  assert.equal(pulled.ended, false, 'the shift goes on');
  assert.match(pulled.note, /^Written up.*The Boss.*Seen by the Boss: Mail on a lawn\.That took 20 minutes\. The shift goes on\.$/);
  const moved = await read(`Math.hypot(mmm.vehicle.x-(${stood.x}),mmm.vehicle.z-(${stood.z}))`);
  assert.ok(moved < .3, `the player was never pushed (${moved} m)`); assert.ok(pulled.dist > 2.5, `alongside, ${pulled.dist} m apart`);
  assert.equal(pulled.state, 'away'); assert.equal(pulled.signal, false);
  const note = await visible('bossNote'); assert.equal(note.shown, true); assert.equal(note.inside, true, 'the card fits the screen');
  await shot('write-up');
  // It drives off where nobody sees it.
  await until('the Boss gone', '!mmm.boss.driver.active||mmm.boss.driver.leaving', 10);
  // Every stop delivered: the day's own verdict is clear, and the one seen offence makes it a written warning.
  await read('mmm.shift.remaining.fill(0);mmm.shift.done=mmm.shift.stops');
  await read("document.getElementById('endShift').click()"); await sleep(600);
  const report = await read(`({verdict:document.getElementById('reportVerdict').textContent,boss:document.getElementById('reportBoss').hidden?null:document.getElementById('reportBoss').textContent,
    rows:[...document.querySelectorAll('#reportCalls li')].map(li=>li.textContent)})`);
  console.log(name, 'report', JSON.stringify(report));
  // The day's own verdict (shift-rules.ts) on the upheld calls, then the Boss's: one seen offence is at least a warning.
  // A box already down or old flyers passed on the way may add calls of their own (they are not the Boss's).
  const expected = await read(`(async()=>{const {verdict}=await import('/src/shift-rules.ts'),{seenVerdict}=await import('/src/ride-along-rules.ts'),{dismissed}=await import('/src/complaints.ts');
    const s=mmm.shift,base=verdict(s.complaints.all.filter(c=>!dismissed(c,s.evidence.photos)));return {base,final:seenVerdict(base,mmm.boss.watch.seen)};})()`);
  console.log(name, 'verdict', JSON.stringify(expected));
  const words = { clear: 'No action taken.', warning: 'Written warning.', suspension: 'One-day suspension. Without pay.' };
  assert.notEqual(expected.final, 'clear', 'one seen offence: at least a warning');
  assert.equal(report.verdict, words[expected.final], 'the report says the verdict with what the Boss saw');
  if (expected.base === 'clear') assert.equal(report.verdict, 'Written warning.', 'a clean day with one seen offence: a written warning');
  assert.equal(report.boss, 'Seen by the Boss: Mail on a lawn.');
  assert.ok(report.rows.some(r => r.endsWith('UPHELD · Seen by the Boss. No photo accepted.')), 'the call is marked seen');
  await read("document.getElementById('reportPanel').scrollTop=document.getElementById('reportBoss').offsetTop-80"); await sleep(300);
  const line = await visible('reportBoss'); assert.equal(line.shown, true);
  await shot('report');
  console.log(`PASS ride-along ${name}: one seen offence`);
  if (!PHONE) {
    // A clean ride-along day: the good line, and nothing else.
    await page('mode=mail&day=3&run=1');
    await read("document.getElementById('titleStart').click()"); await sleep(1000);
    await read('mmm.shift.remaining.fill(0);mmm.shift.done=mmm.shift.stops');
    await read("document.getElementById('endShift').click()"); await sleep(600);
    assert.equal(await read("document.getElementById('reportBoss').textContent"), CLEAN);
    assert.equal(await read("document.getElementById('reportVerdict').textContent"), 'No action taken.');
    // Day 2: mail play exactly as before.
    await page('mode=mail&day=2&run=1');
    assert.equal(await read('mmm.boss.today'), false);
    assert.equal(await read("(()=>{const e=document.getElementById('titleBoss');return !e||e.hidden})()"), true, 'no line on the start card');
    await read("document.getElementById('titleStart').click()"); await sleep(1500);
    assert.equal(await read('mmm.boss.driver.active||mmm.boss.group.visible'), false, 'no Boss on the road');
    assert.notEqual(await read("document.getElementById('stopHint').textContent"), START);
    await read("document.getElementById('endShift').click()"); await sleep(600);
    assert.equal(await read("document.getElementById('reportBoss').hidden"), true, 'no Boss line in the report');
    // Get Fired has its own Boss; Today's run and Just Drive none; ?boss=0 none.
    await page('mode=fired&day=3&run=1'); assert.equal(await read('!!mmm.boss?.pursuit'), true, 'Get Fired: the pursuing Boss, not the ride-along');
    await page('mode=mail&day=3&boss=0'); assert.equal(await read('mmm.boss'), null, '?boss=0');
    await page('mode=mail&day=3&rideAlong=0'); assert.equal(await read('mmm.boss'), null, '?rideAlong=0');
    await page('site=just&day=3', 'localhost'); assert.equal(await read('mmm.boss'), null, 'no Boss in Just Drive');
    await page('daily=1'); assert.equal(await read('mmm.boss'), null, "no Boss in Today's run");
    console.log("PASS ride-along: clean day line; day 2 as before; none in Get Fired (its own Boss), Today's run, Just Drive or with ?boss=0");
  }
  assert.deepEqual(errors, [], 'runtime exceptions');
} finally { c.close(); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {}); }
