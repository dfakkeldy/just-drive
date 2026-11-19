// Only run through tools/yard-shots.sh, which owns tools/browser.sh and its shared slot.
// Today's run on the dev server, desktop and phone: entered from the title card's button and by ?daily=1; the seeded run
// (date, start, vehicle, weather, card) agrees with the rules; a real knock fills a bingo square in the HUD; the run ends
// at its time limit; the end card has the share picture, Copy (the copied line is read back) and the replay button; a
// second try is practice and the card keeps the first. Mail play and Just Drive show none of it.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
const [out, first] = process.argv.slice(2), port = process.env.CDP_PORT;
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
const shot = async name => writeFileSync(`${out}/${name}.png`, Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
const key = (type, code) => c.send('Input.dispatchKeyEvent', { type, code, key: code, windowsVirtualKeyCode: code === 'ArrowUp' ? 38 : 0 });
const waitReady = async () => {
  let ready = false;
  for (let i = 0; i < 360 && !ready; i++) { await sleep(500); ready = await read("document.documentElement.dataset.mmmReady === 'true' && !!window.mmm?.shift").catch(() => false); }
  assert.equal(ready, true, 'Mabou settles');
  assert.equal(await read("!!document.querySelector('vite-error-overlay')"), false);
};
async function page(phone, query, host = '127.0.0.1') {
  await c.send('Emulation.setDeviceMetricsOverride', { width: phone ? 390 : 1280, height: phone ? 844 : 800, deviceScaleFactor: 1, mobile: phone });
  const url = new URL(`/?x=1&title=1&hud=1&radio=0&res=1&${phone ? 'touch=1&q=low&' : ''}${query}`, first); url.hostname = host;
  await c.send('Page.navigate', { url: url.href });
  await waitReady();
}
const settle = async () => { for (let i = 0; i < 120; i++) { await sleep(500); if (await read("document.documentElement.dataset.mmmReady === 'true'")) return; } throw Error('no settle'); };
// The nearest upright mailbox on open road, and a pose 7 m before it along its road (as fired-browser does).
const aim = `(()=>{const {shift:s,props:p,roads:r,vehicle:v}=mmm;
  // A box close beside a straight piece of public road, so the 7 m run-up is open road, not trees.
  const ids=p.mail.map((_,i)=>i).filter(i=>{const b=p.mail[i];if(b.motion.down||s.placeAt(b.x,b.z)!=='route')return false;const h=r.nearest(b.x,b.z,25,x=>x.kind>=1&&x.kind<=3);if(!h||h.dist>8)return false;
    const q=h.road.pts,len=Math.hypot(q[h.seg+1][0]-q[h.seg][0],q[h.seg+1][1]-q[h.seg][1]);return len>30&&h.t*len>12;});
  ids.sort((a,b)=>Math.hypot(p.mail[a].x-v.x,p.mail[a].z-v.z)-Math.hypot(p.mail[b].x-v.x,p.mail[b].z-v.z));
  const i=ids[0],b=p.mail[i],h=r.nearest(b.x,b.z,25,x=>x.kind>=1&&x.kind<=3),q=h.road.pts,dx=q[h.seg+1][0]-q[h.seg][0],dz=-(q[h.seg+1][1]-q[h.seg][1]),l=Math.hypot(dx,dz);
  const heading=Math.atan2(dx/l,-(dz/l)),x=b.x-7*Math.sin(heading),z=b.z+7*Math.cos(heading);
  window.dailyQA={index:i,x,z,heading};return {index:i,box:{x:b.x,z:b.z},road:h.road.name};})()`;
async function knock() {
  const target = await read(aim);
  await read('mmm.vehicle.restart(dailyQA.x,dailyQA.z,dailyQA.heading)'); await settle();
  await read('mmm.vehicle.restart(dailyQA.x,dailyQA.z,dailyQA.heading);mmm.vehicle.speed=9;mmm.vehicle.vx=9*Math.sin(dailyQA.heading);mmm.vehicle.vz=-9*Math.cos(dailyQA.heading)');
  await key('keyDown', 'ArrowUp'); await sleep(1600); await key('keyUp', 'ArrowUp');
  return { ...target, down: await read('mmm.props.mail[dailyQA.index].motion.down'), speed: await read('Math.hypot(mmm.vehicle.vx,mmm.vehicle.vz)'),
    recent: await read("mmm.shift.score.recent.map(e=>e.kind+'@'+e.place)"),
    probe: await read("({elapsed:mmm.shift.elapsed,title:document.getElementById('title')?.hidden,ending:document.getElementById('endingFrame')?.hidden,at:Math.hypot(mmm.vehicle.x-dailyQA.x,mmm.vehicle.z-dailyQA.z),paused:document.body.className,active:document.activeElement?.id})") };
}
const box = sel => read(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);
  return {shown:s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0,inside:r.left>=-.5&&r.top>=-.5&&r.right<=innerWidth+.5&&r.bottom<=innerHeight+.5,
  text:e.textContent,height:r.height,width:r.width,left:r.left,right:r.right,top:r.top,bottom:r.bottom};})()`);
const today = await (async () => { const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Halifax', year: 'numeric', month: '2-digit', day: '2-digit' }); return f.format(new Date()); })();
const LADDER_NAMES = ['Clean record', 'Coaching chat', 'Verbal warning', 'Written warning', 'One-day suspension', 'Three-day suspension', 'Hearing', 'Fired'];
try {
  await c.send('Runtime.enable'); await c.send('Page.enable');
  for (const phone of [false, true]) {
    const name = phone ? 'phone' : 'desktop';
    // Entered from the mail title card's own button.
    await page(phone, 'mode=mail');
    await read("localStorage.removeItem('mmm.daily.v1');localStorage.removeItem('mmm.fired.best.v1')");
    const career = await read("localStorage.getItem('mmm.shift.v1')");
    const mailOrder = await read(`(()=>{const y=s=>document.querySelector(s).getBoundingClientRect();return {mode:y('#modeChoice').bottom,daily:y('#dailyChoice').top,dailyEnd:y('#dailyChoice').bottom,tag:y('#title .tag').top,h1:y('#title h1').bottom,start:y('#titleStart').top,keys:y('#title dl').top};})()`);
    assert.ok(mailOrder.mode <= mailOrder.daily && mailOrder.dailyEnd <= mailOrder.tag && mailOrder.h1 < mailOrder.keys && mailOrder.keys < mailOrder.start, `mail title order: ${JSON.stringify(mailOrder)}`);
    await shot(`daily-${name}-mail-title`);
    const offer = await box('#modeDaily');
    assert.ok(offer?.shown && offer.inside && offer.height >= 44, `the title offers Today's run, touch-sized: ${JSON.stringify(offer)}`);
    assert.equal(await read("document.getElementById('modeDaily').getAttribute('aria-pressed')"), 'false');
    assert.equal(await read('mmm.daily'), null, 'mail play has no daily run');
    await read("document.getElementById('modeDaily').click()");
    await sleep(800); await waitReady();
    assert.match(await read('location.search'), /daily=1/, 'the button opens ?daily=1');
    const plan = await read('mmm.daily.plan');
    assert.equal(plan.date, today, 'the Atlantic date'); assert.equal(plan.area, 'mabou');
    // The rules give the same run for the same day and area: the page's plan and card are the rules' own.
    const rules = await read(`(async()=>{const r=await import('/src/daily-rules.ts');const p=r.dailyPlan(${JSON.stringify(today)},'mabou');
      const s=r.supplyFor(p,{boxes:true,lawns:true,relief:true,painter:!!mmm.roadScene?.painter.enabled,fish:!!mmm.roadScene?.rules.enabled});
      return {plan:p,card:r.drawCard(p.seed,s),scene:{painter:!!mmm.roadScene?.painter.enabled,fish:!!mmm.roadScene?.rules.enabled}};})()`);
    assert.deepEqual(plan, rules.plan);
    assert.deepEqual(await read('mmm.daily.squares'), rules.card);
    console.log(name, 'plan', JSON.stringify(plan), 'scene', JSON.stringify(rules.scene), 'card', rules.card.map(s => s.label).join(' | '));
    assert.equal(await read('mmm.gameMode'), 'fired'); assert.equal(await read('mmm.shift.career.day'), plan.day, 'the seeded shift day');
    if (plan.scene === 'painter') assert.equal(rules.scene.painter, true, 'the painter is out on a painter day');
    if (plan.scene !== 'painter') assert.ok(!rules.card.some(s => s.kind === 'sceneDust'), 'no painter square without the painter');
    // The title: Today's run pressed, its card shown, the start button.
    const title = await read(`(()=>({pressed:[...document.querySelectorAll('#modeChoice button,#modeDaily')].map(b=>b.id+':'+b.getAttribute('aria-pressed')),
      tag:document.querySelector('#title .tag').textContent,squares:[...document.querySelectorAll('#titleBingo span')].map(s=>s.textContent),
      start:document.getElementById('titleStart').textContent,text:document.querySelector('#titleCard>p:nth-of-type(2)').textContent}))()`);
    assert.deepEqual(title.pressed, ['modeMail:false', 'modeExplore:false', 'modeFired:false', 'modeDaily:true']);
    assert.match(title.tag, /^Today’s run · \d{1,2} [A-Z][a-z]{2} · the same for everybody$/);
    assert.deepEqual(title.squares, rules.card.map(s => s.label)); assert.equal(title.start, 'Start today’s run');
    assert.match(title.text, /Five minutes on the clock/);
    for (const id of ['#titleBingo', '#titleStart']) { const b = await box(id); assert.ok(b.shown && b.left >= 0 && b.right <= (phone ? 390 : 1280), `${id} fits across`); }
    const order = await read(`(()=>{const y=s=>document.querySelector(s).getBoundingClientRect();return {mode:y('#modeChoice').bottom,daily:y('#dailyChoice').top,dailyEnd:y('#dailyChoice').bottom,
      tag:y('#title .tag').top,text:y('#titleCard>p:nth-of-type(2)').top,bingo:y('#titleBingo').top,bingoEnd:y('#titleBingo').bottom,start:y('#titleStart').top};})()`);
    assert.ok(order.mode <= order.daily && order.dailyEnd <= order.tag && order.tag < order.text && order.text < order.bingo && order.bingoEnd <= order.start,
      `title order: modes, today's run, tag, words, card, start: ${JSON.stringify(order)}`);
    await shot(`daily-${name}-title`);
    await read("document.getElementById('titleStart').click();document.activeElement?.blur()"); await sleep(600);
    // The seeded start: the car is on the start road, near the start-key place.
    const start = await read(`(async()=>{const {startKey}=await import('/src/start-key.ts');const p=startKey(mmm.daily.plan.start,mmm.roads.roads,mmm.vehicle.bounds);
      return {d:Math.hypot(mmm.vehicle.x-p.x,mmm.vehicle.z-p.z)};})()`);
    assert.ok(start.d < 60, `the run starts at its seeded place (${start.d.toFixed(1)} m)`);
    // HUD: the card in the panel (desktop) or small at the front of the phone line, and the time left.
    if (phone) {
      const line = await box('#firedLine'), mini = await box('#bingoMini');
      assert.ok(line.shown && line.inside && mini.shown && mini.inside, JSON.stringify({ line, mini }));
      assert.match(line.text, /^\d:\d\d · [\d,]+ pts/);
      assert.ok(await read("(()=>{const s=document.getElementById('phoneStatus');return s.scrollHeight<=s.clientHeight+1})()"), 'the phone status block holds its lines');
    } else {
      const hud = await box('#firedHud'), grid = await box('#bingoGrid');
      assert.ok(hud.shown && hud.inside && grid.shown && grid.inside, JSON.stringify({ hud, grid }));
      assert.match(hud.text, /\d:\d\d left/);
      const overlap = await read(`(()=>{const a=document.getElementById('firedHud').getBoundingClientRect();
        return ['hud','shiftHud','stopHint','miniMap','relief','radio','photoTag','mailScore','endShift','pauseButton','gear','credit','mailButton','cameraButton'].filter(id=>{
          const e=document.getElementById(id);if(!e)return false;const s=getComputedStyle(e),b=e.getBoundingClientRect();
          return s.display!=='none'&&s.visibility!=='hidden'&&b.width>0&&a.top<b.bottom&&b.top<a.bottom&&a.left<b.right&&b.left<a.right;});})()`);
      assert.deepEqual(overlap, [], 'the score panel with its card covers no other HUD piece');
    }
    // A real knock: the car drives into a box. Every box grade on the card counts it.
    const hit = await knock(); console.log(name, 'knock', JSON.stringify(hit));
    await shot(`daily-${name}-knock`);
    assert.ok(hit.recent.some(k => /^box:\w+@route$/.test(k)), 'the car hit the box: a box grade on open road');
    const live = await read(`(()=>({counts:mmm.daily.card.counts,done:mmm.daily.card.done,total:mmm.fired.book.total,
      on:[...document.querySelectorAll('#bingoGrid span')].map(s=>s.classList.contains('on')),mini:[...document.querySelectorAll('#bingoMini i')].map(s=>s.classList.contains('on'))}))()`);
    // Each square counts exactly the scoring facts of its kind (all on open road here).
    const kinds = hit.recent.filter(k => k.endsWith('@route')).map(k => k.split('@')[0]);
    rules.card.forEach((sq, i) => assert.equal(live.counts[i], Math.min(sq.need, kinds.filter(k => k === sq.kind).length), `${sq.label}: ${JSON.stringify(live)}`));
    assert.ok(rules.card.some((sq, i) => sq.kind.startsWith('box:') && live.counts[i] > 0) || !rules.card.some(sq => kinds.includes(sq.kind)), 'a box square on the card counted the knock');
    assert.deepEqual(live.on, live.mini, 'the panel and the phone card agree');
    assert.deepEqual(live.on, rules.card.map((s, i) => live.counts[i] >= s.need), 'filled squares show');
    await shot(`daily-${name}-hud`);
    // Run out the clock: three seconds before the limit, then real frames to the end.
    await read(`mmm.shift.elapsed=(mmm.daily.plan.limit-3)*20`);
    let ended = false;
    for (let i = 0; i < 40 && !ended; i++) { await sleep(250); ended = await read('mmm.shift.ended'); }
    assert.equal(ended, true, 'the run ends by itself at its time limit');
    await sleep(400);
    const card = await read(`(()=>{const f=document.getElementById('endingFrame'),img=f.querySelector('#dailyShare img');return {hidden:f.hidden,tag:f.querySelector('.endingTag')?.textContent,
      title:document.getElementById('endingTitle')?.textContent,lines:[...f.querySelectorAll('#endingCard>p')].map(p=>p.textContent),
      buttons:[...f.querySelectorAll('button')].map(b=>b.textContent),img:img&&{w:img.naturalWidth,h:img.naturalHeight,alt:img.alt},
      across:(()=>{const r=document.getElementById('endingCard').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})(),
      daily:localStorage.getItem('mmm.daily.v1'),best:localStorage.getItem('mmm.fired.best.v1'),career:localStorage.getItem('mmm.shift.v1')}})()`);
    console.log(name, 'card', JSON.stringify({ ...card, daily: undefined }));
    assert.equal(card.hidden, false); assert.match(card.tag, /^Today’s run · \d{1,2} [A-Z][a-z]{2}$/);
    assert.equal(card.title, LADDER_NAMES[await read('mmm.fired.book.step')]);
    assert.doesNotMatch(card.lines[0], /^Practice/); assert.match(card.lines[2], /this is today’s card/); assert.match(card.lines[3], /^Streak: 1 day\./);
    assert.deepEqual({ w: card.img?.w, h: card.img?.h }, { w: 1200, h: 630 }, 'the share picture');
    assert.ok(card.buttons.includes('Copy')); assert.equal(card.buttons.includes('Share'), await read("typeof navigator.share==='function'"));
    assert.ok(card.buttons.includes('Try again (practice)'));
    assert.ok(card.buttons.includes('Watch replay'), 'the replay button is on the end card');
    assert.equal(card.across, true, 'the end card fits across');
    assert.equal(card.best, null, 'Today’s run never writes the Get Fired best'); assert.equal(card.career, career, 'nor the shift career');
    const record = JSON.parse(card.daily).mabou; assert.equal(record.date, today); assert.equal(record.tries, 1);
    for (const id of ['#dailyCopy', '#endingChoices button']) { const b = await box(id); assert.ok(b.height >= 44, `${id} is touch-sized`); }
    await read("document.getElementById('dailyShare').scrollIntoView({block:'center'})"); await sleep(200);
    await shot(`daily-${name}-end`);
    // Copy: read the copied line back from the clipboard (permission granted to this test page).
    const origin = new URL(first).origin.replace('localhost', '127.0.0.1');
    await c.send('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});
    await c.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    await read(`(()=>{window.dailyCopied=null;const w=navigator.clipboard.writeText.bind(navigator.clipboard);navigator.clipboard.writeText=t=>{window.dailyCopied=t;return w(t);};})()`);
    await read("document.getElementById('dailyCopy').click()"); await sleep(400);
    const copied = await read(`(async()=>({spy:window.dailyCopied,status:document.getElementById('dailyShareStatus').textContent,
      board:await navigator.clipboard.readText().catch(e=>'unreadable: '+e.name)}))()`);
    console.log(name, 'copied', JSON.stringify(copied));
    const expected = await read(`(async()=>{const r=await import('/src/daily-rules.ts');const d=JSON.parse(localStorage.getItem('mmm.daily.v1')).mabou;return r.resultText(d.first,d.date,'Mabou');})()`);
    assert.equal(copied.spy, expected, 'Copy hands over the share line');
    assert.equal(copied.status, 'Copied. Paste it anywhere.');
    if (!copied.board.startsWith('unreadable')) assert.equal(copied.board, expected, 'the clipboard holds the share line');
    const lines = expected.split('\n');
    assert.match(lines[0], /^Mabou Mail Madness, \d{1,2} [A-Z][a-z]{2}, Mabou: (Fired in \d+:\d\d|[A-Za-z -]+, [\d,]+ points), bingo \d of 9$/);
    for (const row of lines.slice(1, 4)) assert.match(row, /^[🟧⬜]{3}$/u);
    assert.equal(lines[4], 'https://mmm.fakkeldy.ca/?daily=1'); assert.equal(lines.length, 5);
    // A second try: practice. The card and the share line keep the first finished try.
    await read("[...document.querySelectorAll('#endingChoices button')].find(b=>b.textContent==='Try again (practice)').click()"); await sleep(600);
    const fresh = await read('({ended:mmm.shift.ended,total:mmm.fired.book.total,done:mmm.daily.card.done,on:document.querySelectorAll("#bingoGrid span.on").length,elapsed:mmm.shift.elapsed})');
    assert.deepEqual({ ended: fresh.ended, total: fresh.total, done: fresh.done, on: fresh.on }, { ended: false, total: 0, done: 0, on: 0 }, 'a fresh try with a clear card');
    const again = await read(`(async()=>{const {startKey}=await import('/src/start-key.ts');const p=startKey(mmm.daily.plan.start,mmm.roads.roads,mmm.vehicle.bounds);return Math.hypot(mmm.vehicle.x-p.x,mmm.vehicle.z-p.z);})()`);
    assert.ok(again < 60, `the practice try starts at the same place (${again.toFixed(1)} m)`);
    await read("document.getElementById('endShift').click()"); await sleep(500);
    const practice = await read(`({title:document.getElementById('endingTitle')?.textContent,lines:[...document.querySelectorAll('#endingCard>p')].map(p=>p.textContent),
      record:JSON.parse(localStorage.getItem('mmm.daily.v1')).mabou,text:mmm.daily.text})`);
    assert.equal(practice.title, 'Practice'); assert.match(practice.lines[0], /^Practice: /); assert.match(practice.lines[2], /^Today’s card keeps your first finished run/);
    assert.equal(practice.record.tries, 2); assert.deepEqual(practice.record.first, record.first); assert.equal(practice.text, expected);
    await shot(`daily-${name}-practice`);
    console.log('PASS Today’s run', name, `day ${plan.day} (${plan.scene}), ${plan.vehicle}, ${plan.mood}, start ${plan.start}; title button, HUD card, real knock, time limit, end card, picture, copied line, replay button, practice`);
  }
  // Mail play: no daily run, no bingo anywhere; the stream still records.
  await page(false, 'mode=mail');
  await read("document.getElementById('titleStart').click();document.activeElement?.blur()"); await sleep(300);
  assert.deepEqual(await read(`({daily:mmm.daily,fired:mmm.fired,grid:!!document.getElementById('bingoGrid'),mini:!!document.getElementById('bingoMini')})`),
    { daily: null, fired: null, grid: false, mini: false });
  console.log('PASS mail play: no daily run, no bingo card');
  // Get Fired without daily: the plain run, no card, no time limit.
  await page(false, 'mode=fired&day=1&run=1&scene=0');
  assert.deepEqual(await read(`({daily:mmm.daily,grid:!!document.getElementById('bingoGrid'),pressed:document.getElementById('modeDaily').getAttribute('aria-pressed')})`), { daily: null, grid: false, pressed: 'false' });
  console.log('PASS Get Fired: no daily card or limit');
  // Just Drive never offers it, even when asked.
  await page(false, 'site=just&daily=1', 'localhost');
  assert.equal(await read('mmm.gameMode'), 'explore');
  assert.deepEqual(await read(`({daily:mmm.daily,button:!!document.getElementById('modeDaily'),grid:!!document.getElementById('bingoGrid')})`), { daily: null, button: false, grid: false });
  console.log('PASS Just Drive: no daily run');
  assert.deepEqual(errors, [], 'runtime exceptions');
} finally { c.close(); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {}); }
