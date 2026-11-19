// Parcel tag in the real game, in every area: a desktop host and a phone guest against a local room only (run through
// tools/check-mp-game.sh with GAME_ROUND_S set, on the M4 browser runner). Each area uses another pair of rides.
import { multiplayerPage } from './mp-browser-page.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AREAS } from '../web/src/area.ts';
import { cdp, exitCheck, sleep } from './cdp.mjs';
const [rootOut, first] = process.argv.slice(2), base = new URL(first).origin, port = process.env.CDP_PORT, server = process.env.MP_SERVER;
const areas = process.env.MP_TAG_AREA ? process.env.MP_TAG_AREA.split(',') : AREAS.map(a => a.id);
assert.ok(areas.length && areas.every(id => AREAS.some(a => a.id === id)), 'known areas');
assert.match(server, /^ws:\/\/(127\.0\.0\.1|localhost):\d+$/);
const RIDES = ['car', 'truck', 'sxs', 'bike'];
const ROUND_S = Number(process.env.GAME_ROUND_S);
assert.ok(ROUND_S >= 10 && ROUND_S <= 40, 'run with a short local round (GAME_ROUND_S)');
// In the page: 2 m points along the nearest named road to the car, the clear stretch of `length` metres nearest it:
// clear of the real places where nothing scores (church grounds, cemeteries, the bus stop), which the rules row covers.
const PATH = length => `(() => {
  const v=mmm.vehicle,quiet=mmm.mp.current.host.quiet?.()??[],n=${length}/2;let found=null;
  const open=p=>!quiet.some(q=>Math.hypot(p.x-q.x,p.z-q.z)<=q.radius+30);
  for(const r of mmm.roads.roads){
    if(!r.name||r.railway||r.tags?.railway||r.kind>3)continue;
    const all=[{x:r.pts[0][0],z:r.pts[0][1]}];
    for(let i=1;i<r.pts.length;i++){const a=all[all.length-1],d=Math.hypot(r.pts[i][0]-a.x,r.pts[i][1]-a.z),k=Math.floor(d/2);for(let j=1;j<=k;j++)all.push({x:a.x+(r.pts[i][0]-a.x)*j*2/d,z:a.z+(r.pts[i][1]-a.z)*j*2/d});}
    let run=0;
    for(let i=0;i<all.length;i++){run=open(all[i])?run+1:0;if(run<n)continue;const s=i-n+1,d=Math.hypot(all[s].x-v.x,all[s].z-v.z);if(!found||d<found.from)found={name:r.name,from:d,points:all.slice(s,i+1)};}
  }
  return found?{...found,quiet:quiet.length}:{name:null,from:Infinity,points:[],quiet:quiet.length};
})()`;
async function tagArea(area, index) {
  const out = join(rootOut, area); mkdirSync(out, { recursive: true });
  const pages = [], receipt = { area, rides: [RIDES[index % 4], RIDES[(index + 1) % 4]] };
  async function open(ride, phone) {
    const tab = await multiplayerPage(port);
    const { ws, send, errors } = await cdp(tab.webSocketDebuggerUrl);
    const read = async expression => { await send('Page.bringToFront'); const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); assert.ok(!r.result?.exceptionDetails, JSON.stringify(r.result?.exceptionDetails)); return r.result.result.value; };
    const until = async (expr, what = expr) => { for (let i = 0; i < 600; i++) { if (await read(expr)) return; await sleep(150); } throw Error('Timeout: ' + what); };
    const shot = async name => writeFileSync(`${out}/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
    const p = { read, until, shot, errors, send, close: async () => { await tab.close(); ws.close(); } }; pages.push(p);
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', phone ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    if (phone) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const url = new URL(base);
    url.search = new URLSearchParams({ area, mode: 'explore', road: area === 'westbay' ? 'Marble Mountain Road' : 'Highway 19', f: '.4', mp: '1', room: 'tag' + index, mpserver: server, res: '1', hud: '1', q: 'low', vehicle: ride, ...(phone ? { touch: '1' } : {}) }).toString();
    await send('Page.navigate', { url: url.href }); await until('!!window.mmm && document.title.startsWith("settled")', 'the page to settle');
    await read(`if(!document.getElementById('title').hidden)document.getElementById('titleStart').click()`);
    await until('mmm.mp.current?.net.status === "on" && mmm.mp.current.net.gamesSupported && !!mmm.mp.current.net.game', 'a room that runs games');
    await read('mmm.vehicle.update=()=>{};mmm.vehicle.vx=mmm.vehicle.vz=mmm.vehicle.speed=0');
    // A fresh start holds the car parked (and zeroes its speed each frame) until a pedal is used: one tap of the
    // throttle, with the physics off, lets the poses below report as driving.
    for (const type of ['keyDown', 'keyUp']) { await send('Input.dispatchKeyEvent', { type, code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 }); await sleep(300); }
    await read('mmm.vehicle.vx=3;mmm.vehicle.speed=3'); await sleep(400);
    assert.equal(await read('mmm.vehicle.vx'), 3, 'the car keeps a set speed between frames (not held parked)');
    await read('mmm.vehicle.vx=mmm.vehicle.speed=0');
    return p;
  }
  // Puts the car at a point, moving along `dir` at `speed` m/s (so it reports as driving, not parked).
  const pose = (p, q, dir = { x: 0, z: 0 }, speed = 0) => p.read(`mmm.vehicle.place(${q.x},${q.z},${Math.atan2(dir.x, -dir.z)});mmm.vehicle.vx=${dir.x * speed};mmm.vehicle.vz=${dir.z * speed};mmm.vehicle.speed=${speed}`);
  const along = (pts, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], d = Math.hypot(b.x - a.x, b.z - a.z) || 1; return { x: (b.x - a.x) / d, z: (b.z - a.z) / d }; };
  const drive = async (p, pts, from, to, speed) => { const step = to > from ? 1 : -1; for (let i = from; i !== to; i += step) { const d = along(pts, i); await pose(p, pts[i], { x: d.x * step, z: d.z * step }, speed); await sleep(2000 / speed); } };
  let failed;
  try {
    const a = await open(receipt.rides[0], false), b = await open(receipt.rides[1], true);
    await a.until('mmm.mp.current.net.count===1'); await b.until('mmm.mp.current.net.count===1');
    const aId = await a.read('mmm.mp.current.net.me.id'), bId = await b.read('mmm.mp.current.net.me.id');
    await a.until(`mmm.mp.current.net.game.host===${aId}`, 'the first page to host');
    assert.equal(await a.read('mmm.mp.current.host.ride().kind'), receipt.rides[0]); assert.equal(await b.read('mmm.mp.current.host.ride().kind'), receipt.rides[1]);
    assert.ok(await b.read('!!document.getElementById("gamePanel").closest("#settings")'), 'the phone has the game controls in Settings');
    assert.ok(await b.read('document.querySelector("#gamePanel button").disabled'), 'a guest cannot start');
    assert.ok(await a.read('!document.getElementById("gamePanel").hidden && document.getElementById("gamePanel").getBoundingClientRect().bottom<=innerHeight'), 'the desktop panel is on screen');
    // Both cars on the same real road, 40 m apart; the host drives 80 m along it.
    const path = await a.read(PATH(130)); receipt.road = path.name; receipt.pathFrom = path.from; const pts = path.points;
    assert.ok(pts.length >= 60 && path.from < 1500, `a clear road to play on near the start (${pts.length} points on ${path.name}, ${Math.round(path.from)} m off)`);
    await pose(a, pts[0]); await pose(b, pts[20]); await sleep(1500);
    await a.read('document.getElementById("gamePanel").open=true');
    await a.until('!document.querySelector("#gamePanel button").disabled', 'Start to be ready');
    await a.read('document.querySelector("#gamePanel button").click()');
    await b.until('mmm.mp.current.net.game.phase===1', 'the guest to see the countdown');
    receipt.start = await a.read('mmm.mp.current.net.game.tag');
    const parcel = receipt.start.parcel, near = pts.reduce((k, q, i) => Math.hypot(q.x - parcel.x, q.z - parcel.z) < Math.hypot(pts[k].x - parcel.x, pts[k].z - parcel.z) ? i : k, 0);
    receipt.parcelAlong = near * 2;
    assert.ok(near >= 5 && near <= 15 && Math.hypot(pts[near].x - parcel.x, pts[near].z - parcel.z) < 3, `the parcel starts on the road between them: ${JSON.stringify(parcel)}, ${near * 2} m along`);
    await a.until('/Parcel tag in [1-5]/.test(document.querySelector("#gamePanel p").textContent)'); await a.shot('tag-countdown-desktop');
    await a.until('mmm.mp.current.net.game.phase===2', 'play');
    await drive(a, pts, 0, 34, 10);
    await a.until(`mmm.mp.current.net.game.tag.holder===${aId}`, 'the host to drive over the parcel');
    await b.until(`mmm.mp.current.net.game.tag.holder===${aId}`, 'the guest to hear it');
    await drive(a, pts, 34, 46, 10);
    await a.until(`(mmm.mp.current.net.game.table.find(r=>r.id===${aId})?.score??0)>=2`, 'the holder to score');
    // What each sees: the parcel over the holder, the arrow and the small-map mark at the guest, the tables.
    receipt.holderView = await a.read(`(()=>{const g=mmm.mp.current.games,p=g.parcel.position,o=[];mmm.mp.current.gameMarks(o);return {visible:g.group.visible,dx:p.x-mmm.vehicle.x,dz:p.z-mmm.vehicle.z,up:p.y-mmm.vehicle.y,scale:g.parcel.scale.x,arrow:g.arrow.visible,marks:o,table:document.getElementById('gameTable').textContent,status:document.querySelector('#gamePanel p').textContent};})()`);
    receipt.chaserView = await b.read(`(()=>{const m=mmm.mp.current,g=m.games,p=g.parcel.position,v=m.peers.find(q=>q.id===${aId}),o=[];m.gameMarks(o);const a=Math.atan2(p.x-mmm.vehicle.x,-(p.z-mmm.vehicle.z));
      return {visible:g.group.visible,peer:!!v,dx:v?p.x-v.x:null,dz:v?p.z-v.z:null,arrow:g.arrow.visible,arrowError:Math.abs(Math.atan2(Math.sin(g.arrow.rotation.y+a),Math.cos(g.arrow.rotation.y+a))),scale:g.parcel.scale.x,marks:o,readout:document.getElementById('gameReadout').textContent,readoutShown:!document.getElementById('gameReadout').hidden};})()`);
    console.log('VIEWS ' + JSON.stringify({ holder: receipt.holderView, chaser: receipt.chaserView }));
    const h = receipt.holderView, c = receipt.chaserView;
    assert.ok(h.visible && Math.hypot(h.dx, h.dz) < .5 && h.up > 2 && h.scale < 1 && !h.arrow, 'the holder carries the parcel over the car, small in their own view, with no arrow');
    assert.ok(/You \(parcel\): [2-9]/.test(h.table), 'the live table: ' + h.table);
    assert.ok(c.visible && c.peer && Math.hypot(c.dx, c.dz) < 1.5, 'the guest sees the parcel over the holder');
    assert.ok(c.arrow && c.arrowError < .05, 'the guest has an arrow to it');
    assert.ok(c.scale > 1.3, 'it grows with distance');
    for (const v of [h, c]) assert.ok(v.marks.length === 1 && v.marks[0].label === 'Parcel', 'the parcel on the small map');
    assert.ok(c.readoutShown && /^Tag \d:\d\d · \d+ m [NESW]+ · #2 · 0 pts$/.test(c.readout), 'the phone readout: ' + c.readout);
    await a.shot('tag-holder-desktop'); await b.shot('tag-chaser-phone');
    // A game phrase, by key on the desktop, reaches the phone.
    for (const type of ['keyDown', 'keyUp']) await a.send('Input.dispatchKeyEvent', { type, key: '0', code: 'Digit0', windowsVirtualKeyCode: 48, text: type === 'keyDown' ? '0' : undefined });
    await b.until(`mmm.mp.current.net.chats.some(c=>c.id===${aId}&&c.phrase===9)`, 'the phrase "Return to sender" to arrive');
    // The guest closes in from behind and bumps it off the holder, who creeps on.
    await pose(a, pts[46], along(pts, 46), .6);
    await drive(b, pts, 20, 52, 12);
    await a.until(`mmm.mp.current.net.game.tag.holder===${bId}`, 'the guest to steal the parcel');
    await b.until(`mmm.mp.current.net.game.tag.holder===${bId}`);
    await b.until('/parcel!/.test(document.getElementById("gameReadout").textContent)', 'the phone to say it has the parcel');
    await b.shot('tag-holder-phone');
    await pose(b, pts[52], along(pts, 52), 3);
    await a.until('mmm.mp.current.net.game.phase===3', 'the round to end', ROUND_S * 1000 + 20000);
    await b.until('mmm.mp.current.net.game.phase===3');
    receipt.final = [await a.read('mmm.mp.current.net.game.table'), await b.read('mmm.mp.current.net.game.table')];
    assert.deepEqual(receipt.final[0], receipt.final[1], 'one final table');
    assert.ok(receipt.final[0].find(r => r.id === aId).score >= 2, 'the host scored');
    await a.until('!document.getElementById("gameResults").hidden'); await b.until('!document.getElementById("gameResults").hidden');
    receipt.results = [await a.read('document.getElementById("gameResults").innerText'), await b.read('document.getElementById("gameResults").innerText')];
    assert.ok(receipt.results.every(t => /Parcel tag · final/.test(t) && /1\. /.test(t)), JSON.stringify(receipt.results));
    assert.ok(await b.read('(()=>{const r=document.getElementById("gameResults").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0;})()'), 'the phone results fit');
    await a.shot('tag-results-desktop'); await b.shot('tag-results-phone');
    if (index === 0) await a.until('mmm.mp.current.net.game.phase===0', 'free driving after the table', 60000);
    else { await a.read('[...document.querySelectorAll("#gamePanel button")].find(e=>e.textContent==="Stop game").click()'); await b.until('mmm.mp.current.net.game.phase===0', 'the host to stop the game'); }
    await b.until('!mmm.mp.current.games.group.visible && document.getElementById("gameReadout").hidden', 'nothing of the game left on the road');
    assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
    console.log(`PASS ${area} (${receipt.rides.join(' and ')} on ${receipt.road}): host start, fair start ${receipt.parcelAlong} m along, pickup, scoring, parcel over the holder, arrow, small map, phone readout, game phrase, steal, shared final table, free driving`);
  } catch (e) { failed = e; console.error(e.stack); for (const [i, p] of pages.entries()) { try { await p.shot('tag-failure-' + i); receipt['failure' + i] = await p.read('({game:mmm.mp.current?.net.game,status:mmm.mp.current?.net.status,told:mmm.mp.current?.net.told,pose:{x:mmm.vehicle.x,z:mmm.vehicle.z,vx:mmm.vehicle.vx,vz:mmm.vehicle.vz},quiet:mmm.mp.current?.host.quiet?.(),panel:document.getElementById("gamePanel")?.textContent})'); } catch { /* page gone */ } } }
  finally { writeFileSync(`${out}/tag-browser.json`, JSON.stringify(receipt, null, 2) + '\n'); for (const p of pages) await p.close(); }
  return failed ? 1 : 0;
}
let failed = false;
for (const [i, area] of areas.entries()) if (await tagArea(area, i)) failed = true;
exitCheck(failed ? 1 : 0);
