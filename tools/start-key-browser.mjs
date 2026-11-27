#!/usr/bin/env node
// The player's start link in the real page, in headless Chromium: ?start=<road> (web/src/start-key.ts).
//   just   Just Drive on a phone held upright (390 x 844, touch). The title card and its buttons show, the tab keeps
//          its title and the radio waits. The car stands on the road, 150 m before its end, pointed at the end.
//          After a touch on Start the car is still there, the radio is on, and the porch at the end of the road is
//          on the screen with no land in front of it. A change of ride on the title card reloads the page: the car
//          keeps the place. An unknown road gives the title card and the normal start.
//   mail   The mail site: the same place before and after Start. An unknown road gives the day's start.
//   blackstone  The /blackstone short link (deploy/_redirects): mode=mail beats a saved Explore choice, the title card
//          shows, and after Start the car stands within 2 m of the independent point startKey gives for share 0.43 of Blackstone Road.
//          Not part of "all": it has its own row (start-key-blackstone-browser).
//   era    Mabou 1884 has the same roads, so the same place, with the title card.
// No page may throw. Every address holds player keys only (site, mode, era, q, mp, vehicle, start): one test key
// would skip the title card and prove nothing. The script holds no map position: it reads the road and the porch
// from the page, and its own arithmetic (not web/src/start-key.ts) says where the end of the road is.
// Usage (dev server and Chromium come from the shots script; about three minutes):
//   RUN=start-key-browser.mjs VIEWS="start|q=low" tools/yard-shots.sh 1280 720
// START_KEY_FAMILY=just|mail|era|blackstone runs one part. START_KEY_EXPECT_MUTATION is set by tools/start-key-browser-mutations.mjs.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { cdp, cdpFetch, exitCheck, sleep } from './cdp.mjs';
import { independentPoint } from './blackstone-point.mjs';

const [outDir, first] = process.argv.slice(2);
const web = new URL(first).port, PORT = process.env.CDP_PORT ?? '9333';
const JUST = `http://localhost:${web}/mabou?site=just&mp=0`, MAIL = `http://127.0.0.1:${web}/?mp=0`;
const family = process.env.START_KEY_FAMILY ?? 'all', marker = process.env.START_KEY_EXPECT_MUTATION;
const ROAD = 'Beaton Road', KEY = 'start=beaton-road';
const BACK = 150;   // START_BACK in web/src/start-key.ts

const said = [];
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); assert.ok(ok, what); };
const turn = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const READY = `document.documentElement.dataset.mmmReady === 'true' && !!window.mmm?.vehicle`;

async function open(width, height, phone = false) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const c = await cdp(tab.webSocketDebuggerUrl, { deadline: 180000 });
  const send = async (method, params) => { const r = await c.send(method, params); assert.ok(!r.error, JSON.stringify(r.error)); return r.result; };
  const read = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  const until = async (expression, what = expression) => {
    for (const end = Date.now() + 150000; Date.now() < end; await sleep(250)) {
      // A reload destroys the page's context for a moment: that answer is "not yet".
      try { if (await read(`(() => { try { return !!(${expression}); } catch { return false; } })()`)) return; }
      catch (error) { if (!/context|navigat|Cannot find/i.test(error.message)) throw error; }
    }
    throw Error(`timeout: ${what}`);
  };
  await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: phone });
  if (phone) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const settle = async (radio = true) => {
    await until(READY, 'the page is ready');
    for (let n = 0; marker; n++) {
      if (JSON.stringify(await read('globalThis.__mmmMutationSources')) === JSON.stringify([marker])) break;
      if (n === 4) throw Error('The intended source mutation was not loaded');
      await sleep(500); await send('Page.reload', { ignoreCache: true }); await sleep(300); await until(READY, 'the page is ready');
    }
    // The radio arrives after the first frames. Without this wait "the radio is off" would pass on a missing radio.
    // (The horse of 1884 has no radio, so that page does not wait.)
    if (radio) await until(`!!window.mmm.radio`, 'the radio has loaded');
    await send('Page.bringToFront'); await sleep(600);
  };
  const go = async (url, radio = true) => { await send('Page.navigate', { url }); await sleep(300); await settle(radio); };
  const touch = async (selector) => {
    const at = await read(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, ...at }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const shot = async (name) => { const m = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${outDir}/${name}.png`, Buffer.from(m.data, 'base64')); };
  const close = async () => { try { await cdpFetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`); } finally { c.close(); } };
  return { send, read, until, go, settle, touch, shot, close, errors: c.errors };
}

// What the page shows, and where the car is on the named road. `toFirst` and `toLast` are metres along the road to
// its two ends; `line` is the heading of the road at the car, toward its last point.
const facts = (page) => page.read(`(() => {
  const m = window.mmm, v = m.vehicle, title = document.getElementById('title');
  const seen = (id) => { const e = document.getElementById(id); if (!e) return false; const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 20 && r.height > 20 && r.top >= 0 && r.left >= 0 && r.right <= innerWidth; };
  const length = (pts) => pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
  const piece = m.roads.roads.filter((r) => r.name === ${JSON.stringify(ROAD)} && !r.bridge && r.kind <= 3).sort((a, b) => length(b.pts) - length(a.pts))[0];
  let spot = null, walked = 0;
  for (let i = 1; piece && i < piece.pts.length; i++) {
    const [ax, az] = piece.pts[i - 1], [bx, bz] = piece.pts[i], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    if (!l2) continue;
    const t = Math.max(0, Math.min(1, ((v.x - ax) * dx + (v.z - az) * dz) / l2)), off = Math.hypot(v.x - ax - t * dx, v.z - az - t * dz);
    if (!spot || off < spot.off) spot = { off, along: walked + t * Math.sqrt(l2), line: Math.atan2(dx, -dz) };
    walked += Math.sqrt(l2);
  }
  const house = m.porchSite ? m.porchSite.world(0, 0) : null, far = (p) => house ? Math.hypot(house.x - p[0], house.z - p[1]) : null;
  return { x: v.x, z: v.z, heading: v.heading, road: v.roadName ?? null,
    card: !!title && !title.hidden && getComputedStyle(title).display !== 'none', start: seen('titleStart'), credits: seen('titleCredits'),
    tab: document.title, radio: m.radio ? !!m.radio.on : null, mode: m.gameMode, era: m.era.id, ride: Object.getPrototypeOf(v).constructor.name,
    piece: !!piece, off: spot?.off ?? null, toFirst: spot?.along ?? null, toLast: spot ? walked - spot.along : null, line: spot?.line ?? null,
    houseFromFirst: piece ? far(piece.pts[0]) : null, houseFromLast: piece ? far(piece.pts.at(-1)) : null, houseFromCar: far([v.x, v.z]) };
})()`);
// Where the porch dog is on the screen (0 to 1 from the left and from the top), and how much room the land leaves
// under the line from the camera to it: a positive number means that no ground hides the porch.
const view = (page) => page.read(`(() => {
  const m = window.mmm, cam = m.camera, dog = cam.position.clone(), roof = cam.position.clone();
  m.porchDog.group.updateWorldMatrix(true, false); m.porchDog.group.getWorldPosition(dog);
  roof.copy(dog); roof.y += 3;
  let clear = Infinity;
  for (let i = 1; i < 60; i++) {
    const t = i / 60, x = cam.position.x + (roof.x - cam.position.x) * t, z = cam.position.z + (roof.z - cam.position.z) * t;
    const ground = m.terrain.heightAt(x, z);
    if (ground !== null) clear = Math.min(clear, cam.position.y + (roof.y - cam.position.y) * t - ground);
  }
  const on = (p) => { const n = p.clone().project(cam); return { x: (n.x + 1) / 2, y: (1 - n.y) / 2, front: n.z < 1 }; };
  return { state: m.porchDog.state, house: m.porch.group.visible, shown: m.porchDog.group.visible, dog: on(dog), roof: on(roof), clear, far: cam.position.distanceTo(dog), low: m.low,
    carOnLand: Math.abs(m.vehicle.y - m.terrain.heightAt(m.vehicle.x, m.vehicle.z)) };
})()`);
const placed = (f, what) => {
  check(f.piece && f.off < 0.5, `${what}: the car stands on ${ROAD}`);
  const endIsLast = f.houseFromLast !== null ? f.houseFromLast < f.houseFromFirst : null;
  return { endIsLast, toEnd: (end) => (end ? f.toLast : f.toFirst), aim: (end) => f.line + (end ? 0 : Math.PI) };
};
const same = (a, b, room = 0.01) => Math.hypot(a.x - b.x, a.z - b.z) < room && turn(a.heading, b.heading) < 0.02;
const fixed = (n) => (n === null || n === undefined ? 'none' : n.toFixed(2));

let home = null;   // where ?start= put the car on Just Drive: the mail site and 1884 must give the same place
async function just() {
  const page = await open(390, 844, true);
  try {
    // The plain page gives the tab title and the normal start, to compare with.
    await page.go(`${JUST}&vehicle=car&q=low`);
    const plain = await facts(page);
    check(plain.card && !/^(settled|loading)$/.test(plain.tab) && plain.tab.length > 3, 'Just Drive, no key: the title card and a real tab title');

    await page.go(`${JUST}&${KEY}`);
    const before = await facts(page);
    check(before.card && before.start && before.credits, 'Just Drive: the title card shows, with Start and the credits on the screen');
    check(before.tab === plain.tab, `Just Drive: the tab keeps its title ("${before.tab}")`);
    check(before.radio === false, 'Just Drive: the radio waits for the title tap');
    const p = placed(before, 'Just Drive');
    check(p.endIsLast !== null && Math.abs(p.toEnd(p.endIsLast) - BACK) < 1, `Just Drive: the car stands ${BACK} m before the end of the road (${fixed(p.toEnd(p.endIsLast))} m; the porch is ${fixed(before.houseFromCar)} m away)`);
    check(turn(before.heading, p.aim(p.endIsLast)) < 0.02, 'Just Drive: the car points at the end of the road');
    check(!same(before, plain, 50), 'Just Drive: that is not the normal start');
    home = { x: before.x, z: before.z, heading: before.heading, endIsLast: p.endIsLast };
    await page.shot('start-key-title');

    await page.touch('#titleStart');
    await page.until(`document.getElementById('title')?.hidden !== false && !!window.mmm.radio?.on`, 'Start closes the card and starts the radio');
    await sleep(4000);
    const after = await facts(page);
    check(!after.card && after.radio === true, 'Just Drive: a touch on Start closes the card and starts the radio');
    check(same(after, before, 0.5), `Just Drive: the car is still at that place after Start (${fixed(Math.hypot(after.x - before.x, after.z - before.z))} m)`);
    check(after.road === ROAD, `Just Drive: the car is on "${after.road}"`);
    const seen = await view(page);
    await page.shot('start-key-phone');
    const inside = (q) => q.front && q.x > 0.04 && q.x < 0.96 && q.y > 0.04 && q.y < 0.96;
    check(seen.state === 'here' && seen.house, 'Just Drive: the porch house is drawn and its dog is on the porch');
    check(seen.shown, 'Just Drive: the dog is drawn from the start place (it is drawn only when the car or the camera is near)');
    check(inside(seen.dog) && inside(seen.roof), `Just Drive: the porch is on the phone's screen (dog at ${fixed(seen.dog.x)}, ${fixed(seen.dog.y)}; roof at ${fixed(seen.roof.x)}, ${fixed(seen.roof.y)}; ${fixed(seen.far)} m from the camera)`);
    check(seen.carOnLand < 2 && seen.clear > 0, `Just Drive: no land hides the porch (${fixed(seen.clear)} m of room under the line of sight)`);
    said.push(`Just Drive phone: ${fixed(p.toEnd(p.endIsLast))} m before the end, porch ${fixed(before.houseFromCar)} m away, dog on screen at ${fixed(seen.dog.x)}, ${fixed(seen.dog.y)}`);

    // A change of ride on the title card saves the place and reloads the page.
    await page.go(`${JUST}&${KEY}&q=low`);
    const car = await facts(page);
    check(car.card && same(car, home), 'Just Drive, a slow phone: the same place');
    await page.read(`document.querySelector('#title [data-vehicle="bike"]').click()`);
    await sleep(800);
    await page.settle();
    await page.until(`Object.getPrototypeOf(window.mmm.vehicle).constructor.name !== ${JSON.stringify(car.ride)}`, 'the other ride has loaded');
    const bike = await facts(page);
    check(bike.card && same(bike, home, 0.5), `Just Drive: a change of ride on the title card keeps the place (${bike.ride})`);
    await page.read(`localStorage.clear(); sessionStorage.clear()`);

    await page.go(`${JUST}&vehicle=car&q=low&start=no-such-road`);
    const lost = await facts(page);
    check(lost.card && lost.start, 'Just Drive, unknown road: the title card shows');
    check(same(lost, plain), 'Just Drive, unknown road: the normal start');
    check(page.errors.length === 0, 'Just Drive: no page threw');
    said.push(`Just Drive: tab "${before.tab}", ride change keeps the place, unknown road gives the normal start`);
  } finally { await page.close().catch(() => {}); }
}

async function mail() {
  const page = await open(1280, 720);
  try {
    await page.go(`${MAIL}&mode=mail&vehicle=car&q=low&${KEY}`);
    const before = await facts(page);
    check(before.mode === 'mail' && before.card && before.start && before.credits, 'mail site: the title card shows, with Start and the credits');
    check(before.radio === false, 'mail site: the radio waits for the title tap');
    const p = placed(before, 'mail site');
    check(Math.abs(p.toEnd(p.endIsLast) - BACK) < 1 && turn(before.heading, p.aim(p.endIsLast)) < 0.02, `mail site: the car stands ${BACK} m before the end of the road, pointed at it`);
    if (home) check(same(before, home), 'mail site: the same place as on Just Drive');
    await page.read(`document.getElementById('titleStart').click()`);
    await page.until(`document.getElementById('title')?.hidden !== false && !!window.mmm.radio?.on`, 'Start closes the card and starts the radio');
    await sleep(4000);
    const after = await facts(page);
    check(!after.card && same(after, before, 0.5), 'mail site: the car is still at that place after Start');

    await page.go(`${MAIL}&mode=mail&vehicle=car&q=low&start=no-such-road`);
    const lost = await facts(page), day = await page.read(`(() => { const s = window.mmm.shift.run.start; return { x: s.x, z: s.z, heading: s.heading }; })()`);
    check(lost.card && same(lost, day), "mail site, unknown road: the title card and the day's start");
    check(!same(before, day, 50), "mail site: the day's start is another place");
    check(page.errors.length === 0, 'mail site: no page threw');
    said.push('mail site: the same place before and after Start; unknown road gives the day\'s start');
  } finally { await page.close().catch(() => {}); }
}

async function blackstone() {
  const page = await open(1280, 720);
  try {
    // A visitor who saved Explore or Get Fired still gets the mail game from the link, and a fresh radio/engine visit
    // gets station 103.5 with no static and the lower default engine volume.
    await page.go(`${MAIL}&mode=explore&q=low`, false);
    await page.read(`localStorage.clear(); localStorage.setItem('mmm.mode', 'explore')`);
    // The query comes from the real redirect line in deploy/_redirects, not from a copy of it here.
    const rule = readFileSync(new URL('../deploy/_redirects', import.meta.url), 'utf8').split('\n').find((l) => l.startsWith('/blackstone '));
    check(!!rule && rule.endsWith(' 302'), 'Blackstone link: deploy/_redirects has the /blackstone 302 line');
    const target = new URL(rule.split(/\s+/)[1]);
    check(target.origin === 'https://mmm.fakkeldy.ca' && target.pathname === '/', 'Blackstone link: it goes to the mail site root');
    const link = `${MAIL}&${target.searchParams.toString()}&q=low`;
    await page.go(link);
    const before = await facts(page);
    check(before.mode === 'mail', 'Blackstone link: the mail game opens although Explore was saved');
    check(before.card && before.start && before.credits, 'Blackstone link: the title card shows, with Start and the credits');
    // The expected place is worked out in tools/blackstone-point.mjs from the page's own roads, not by start-key.ts.
    const roads = JSON.parse(await page.read(`JSON.stringify(window.mmm.roads.roads.map((r) => ({ name: r.name, kind: r.kind, bridge: r.bridge, pts: r.pts })))`));
    const want = independentPoint(roads, 0.43), other = independentPoint(roads, 0.40);
    check(Math.hypot(want.x - other.x, want.z - other.z) > 1, 'Blackstone link: shares 0.43 and 0.40 are different places');
    const at = (f, p) => Math.hypot(f.x - p.x, f.z - p.z);
    check(at(before, want) < 2, `Blackstone link: the car stands at the independent 0.43 point before Start (${fixed(at(before, want))} m)`);
    check(at(before, other) > 5, 'Blackstone link: and not at the 0.40 pose');
    await page.read(`document.getElementById('titleStart').click()`);
    await page.until(`document.getElementById('title')?.hidden !== false`, 'Start closes the card');
    await page.until(`Number.isFinite(window.mmm.radio?.reception?.e) && window.mmm.radio.on`, 'the radio starts at the Blackstone pose');
    await sleep(3000);
    const after = await facts(page);
    check(!after.card && after.mode === 'mail', 'Blackstone link: after Start the card is closed and the game is still the mail game');
    check(at(after, want) < 2, `Blackstone link: after Start the car is within 2 m of the independent point (${fixed(at(after, want))} m)`);
    check(after.road === 'Blackstone Road', `Blackstone link: the car is on "${after.road}"`);
    const freshAudio = await page.read(`(() => { const r = window.mmm.radio, e = window.mmm.engineSound, s = document.querySelector('#engineVolume input[type=range]');
      return { dial: r.stations[r.station]?.dial ?? null, tuned: r.tunedDial, ...r.reception, engineVol: e?.volume ?? null, slider: s?.value ?? null }; })()`);
    check(freshAudio.dial === '103.5' && freshAudio.tuned === '103.5', `Blackstone link: fresh player starts on 103.5 (got ${freshAudio.dial})`);
    check(freshAudio.band === 'clear' && freshAudio.signal === 1 && freshAudio.music === 1 && freshAudio.hiss === 0 && freshAudio.static === 0,
      `Blackstone link: 103.5 has clear music and no static (${JSON.stringify(freshAudio)})`);
    check(freshAudio.engineVol === 0.25 && freshAudio.slider === '0.25',
      `Blackstone link: default engine volume is 0.25 (vol ${freshAudio.engineVol}, slider ${freshAudio.slider})`);
    // A returning visitor whose saved station does not reach Blackstone (e.g. from Just drive) falls back to 103.5 with no static, keeping their saved choice.
    await page.read(`localStorage.setItem('mmm.radio', '92.5')`);
    await page.go(link);
    await page.read(`document.getElementById('titleStart').click()`);
    await page.until(`document.getElementById('title')?.hidden !== false && Number.isFinite(window.mmm.radio?.reception?.e) && window.mmm.radio.on`, 'saved-lost radio starts');
    await sleep(1000);
    const fallbackAudio = await page.read(`(() => { const r = window.mmm.radio; return { dial: r.stations[r.station]?.dial ?? null, saved: localStorage.getItem('mmm.radio'), ...r.reception }; })()`);
    check(fallbackAudio.dial === '103.5' && fallbackAudio.music === 1 && fallbackAudio.static === 0 && fallbackAudio.saved === '92.5',
      `Blackstone link: saved out-of-range station falls back to 103.5 with no static and keeps localStorage (${JSON.stringify(fallbackAudio)})`);
    // A returning visitor whose saved station comes in here (94.9) and who saved an engine volume keeps both.
    await page.read(`localStorage.setItem('mmm.radio', '94.9'); localStorage.setItem('mmm.engine.vol', '0.65')`);
    await page.go(link);
    const keptAudio = await page.read(`(() => { const r = window.mmm.radio, e = window.mmm.engineSound; return { dial: r.stations[r.station]?.dial ?? null, static: r.reception.static, engineVol: e?.volume ?? null }; })()`);
    check(keptAudio.dial === '94.9' && keptAudio.static === 0 && keptAudio.engineVol === 0.65,
      `Blackstone link: saved clear station and engine volume win (${JSON.stringify(keptAudio)})`);
    check(page.errors.length === 0, 'Blackstone link: no page threw');
    await page.read(`localStorage.clear()`);
    said.push(`Blackstone link: mail mode over a saved Explore, title card, car ${fixed(at(after, want))} m from the 0.43 pose after Start, 103.5 clear with static 0, engine default 0.25`);
  } finally { await page.close().catch(() => {}); }
}

async function era() {
  const page = await open(1280, 720);
  try {
    await page.go(`${MAIL}&era=1884&q=low&${KEY}`, false);
    const old = await facts(page);
    check(old.era === '1884' && old.card && old.start, 'Mabou 1884: the title card shows');
    check(old.piece && old.off < 0.5, `Mabou 1884: the car stands on the same road (${old.ride})`);
    if (home) check(same(old, home, 0.5), 'Mabou 1884: the same place as today');
    await page.go(`${MAIL}&era=1884&q=low&start=no-such-road`, false);
    const lost = await facts(page);
    check(lost.card && !same(lost, old, 50), 'Mabou 1884, unknown road: the title card and the normal start');
    check(page.errors.length === 0, 'Mabou 1884: no page threw');
    said.push(`Mabou 1884: the same place (${old.ride}); unknown road gives the normal start`);
  } finally { await page.close().catch(() => {}); }
}

try {
  if (family === 'all' || family === 'just') await just();
  if (family === 'all' || family === 'mail') await mail();
  if (family === 'all' || family === 'era') await era();
  if (family === 'blackstone') await blackstone();
  console.log('PASS the start key in the page\n  ' + said.join('\n  '));
} catch (error) {
  console.error('FAIL the start key in the page: ' + error.message + (said.length ? '\n  ' + said.join('\n  ') : ''));
  process.exitCode = 1;
}
exitCheck();
