#!/usr/bin/env node
import { cdp, cdpFetch, exitCheck } from './cdp.mjs';
import { current, verify, verifyPlaces, mutations } from './world-update-fixture.mjs';
import { verifyPlayFlags, playMutations } from './play-flags-fixture.mjs';
verify(current()); await verifyPlaces(current()); mutations();
verifyPlayFlags(current()); playMutations();
// The fixed-ending picture A/B replays an older drawEnding from git history, so it is an explicit refactor audit:
// MMM_WORLD_AUDIT=<revision> (for example f7428e7). Ordinary UI checks do not depend on git history.
if (process.env.MMM_WORLD_AUDIT) await import('./world-update-pictures.mjs');
if (process.env.MMM_WORLD_ONLY === '1') exitCheck();
// Checks focused controls, title-card pause, respawn trails, dev API keys and start-over reset order.
// Usage (dev server and Chromium come from the shots script):
//   RUN=ui-check.mjs VIEWS="ui|title=1" tools/yard-shots.sh 1280 720
const [, first] = process.argv.slice(2);
const base = new URL(first).origin;
const PORT = process.env.CDP_PORT ?? '9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(url) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const { ws, send } = await cdp(tab.webSocketDebuggerUrl);
  const read = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;
  const key = async (code, k, vk) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, code, key: k, windowsVirtualKeyCode: vk, ...(type === 'keyDown' && k === 'Enter' ? { text: '\r' } : {}) }); };
  await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url });
  for (let t = 0; t < 160; t++) { await sleep(1500); if (await read("document.documentElement.dataset.mmmReady === 'true'")) break; }
  return { read, key, send, close: async () => { await cdpFetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`); ws.close(); } };
}
const fails = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
const clock = (p) => p.read(`document.getElementById('shiftHud').textContent`);
const reportUp = (p) => p.read(`!document.getElementById('shiftReport').hidden`);

// Real DOM proof on both site policies, including the two available 1884 areas.
for (const just of [false, true]) for (const area of ['mabou', 'judique']) for (const historical of [false, true]) {
  const url = new URL(base);
  if (just) { url.hostname = 'localhost'; url.pathname = `/${area}${historical ? '-1884' : ''}`; }
  url.search = new URLSearchParams({title:'1', ...(just ? {site:'just'} : {area}), ...(historical && !just ? {era:'1884'} : {})}).toString();
  const p = await open(url.href);
  try {
    const line = await p.read(`(() => {
      const line = document.getElementById('titleOtherGame'), a = line?.querySelector('a');
      return {text:line?.textContent, href:a?.href, visible:!!line?.getClientRects().length && !document.getElementById('title').hidden,
        position:line?.parentElement === document.querySelector('#titleCard>h1')?.nextElementSibling,
        mode:document.getElementById('modeExplore')?.textContent};
    })()`);
    const expected = just ? `https://mmm.fakkeldy.ca/${historical ? `?era=1884&area=${area}` : ''}`
      : `https://justdrive.fakkeldy.ca/${!historical && area === 'mabou' ? '' : area + (historical ? '-1884' : '')}`;
    check(line?.href === expected && line.visible && line.position, `${just?'just':'mail'} ${area} ${historical?'1884':'today'}: visible reciprocal link in the introduction (${JSON.stringify(line)})`);
    check(line?.text === (just ? 'Want a job with your drive? Mabou Mail Madness: the same land, with a mail route.' : 'Just want to drive? Just Drive has every area, no mail.'), 'exact cross-brand words');
    if (!just && area === 'mabou' && !historical) check(line.mode === 'Just drive', 'mail keeps its in-game Just drive choice');
    // Phone fit: the added line must not widen, clip or push the start button out of reach.
    for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
      await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
      const fit = await p.read(`(() => {
        const t = document.getElementById('title'), card = document.getElementById('titleCard'), r = document.getElementById('titleOtherGame').getBoundingClientRect(), c = card.getBoundingClientRect();
        const start = document.getElementById('titleStart'); start.scrollIntoView({block:'nearest'}); const s = start.getBoundingClientRect();
        return {inside: r.width > 0 && r.left >= c.left - 0.5 && r.right <= c.right + 0.5, noSideScroll: t.scrollWidth <= t.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1,
          start: s.height >= 44 && s.top >= 0 && s.bottom <= innerHeight + 0.5, size: parseFloat(getComputedStyle(document.getElementById('titleOtherGame')).fontSize)};
      })()`);
      check(fit?.inside && fit.noSideScroll && fit.start && fit.size >= 12, `${just?'just':'mail'} ${area} ${historical?'1884':'today'} ${width}x${height}: cross-brand line fits, no sideways scroll, start reachable (${JSON.stringify(fit)})`);
    }
    await p.send('Emulation.clearDeviceMetricsOverride');
  } finally { await p.close(); }
}

// Recorded at main 9826d95 after full mail and Just Drive boots (including async radio).
// Stream crossings also expose the culverts inspection key.
// G14 deliberately adds cost; all earlier keys remain. The porch house adds porch, porchDog and porchSite.
// The engine sound (the project brief) adds engineSound. The Point Tupper fleet driver (#164) adds aiDriver (null outside Point Tupper).
// The wharf guide adds deckhand. The Canso Causeway canal (#123) adds canal (null elsewhere).
// Mabou's main street adds mabouMain. The camera drone adds drone, and freeCamera (the old F camera, for picture tools that hold the car still).
// The road animals (#118) add roadAnimals (null on test visits without wildlife=1).
// Kicker Field opens in Mabou by default (#57), so both boots add stuntPark and sunShadows. Maryville's place slot adds
// maryville (null outside Port Hood), like the other hand-built places. The house on D.R.'s Lane adds drLane (null outside Judique).
const devKeys = 'bigMap footpaths gamepad driftFeedback sidewalks hikes drawProbe finish farLand farTurbines farVisibility tall aiDriver ambientTraffic animals area buildings camera canal cemeteries chase church coast cost culverts deckhand detail drLane driveVehicle drone edge endings engineSound era fishing freeCamera gameMode grass harbourLights hawkesbury history home interiors journey landmarks low mabouMain maryville mineSite miniMap mp picture places porch porchDog porchSite props quality quarry radio relief renderer roadAnimals roadScene roads scene schoolBus shift stockpiles stuntPark sunShadows terrain trees vehicle vehicleId village water yard yardDog yardDogSite yardJob'.split(' ').sort();
const resetOrder = ['interiors', 'relief', 'yardJob', 'fishing', 'roadScene', 'schoolBus'];
for (const mode of ['mail', 'explore']) {
  const url = new URL(base);
  // localhost enables the real Just Drive site policy; mode alone keeps the mail branding.
  if (mode === 'explore') url.hostname = 'localhost';
  url.search = mode === 'explore' ? '?site=just&demo=8' : '?mode=mail&demo=8';
  const p = await open(url.href);
  try {
    for (let n = 0; n < 80; n++) {
      if (await p.read(`!!window.mmm && Object.hasOwn(mmm, 'radio')`)) break;
      await sleep(250);
    }
    const keys = await p.read('Object.keys(mmm).sort()');
    console.log(`MMM_KEYS ${mode} ${JSON.stringify(keys)}`);
    check(JSON.stringify(keys) === JSON.stringify(devKeys), `${mode}: full-boot dev API keeps main 9826d95 keys plus G14 cost, porch, yard-dog, cemeteries, ambient traffic, Judique village, Port Hawkesbury, Mabou main street, engine sound, fleet driver, stockpiles, deckhand, drone, road animal inspection, sidewalks, gamepad, drift feedback, Kicker Field (stuntPark, sunShadows), Maryville and D.R.'s Lane keys`);
    check(await p.read('mmm.gameMode') === (mode === 'explore' ? 'explore' : 'mail'), `${mode}: intended game mode booted`);
    if (mode === 'explore') {
      check(await p.read(`['yardJob', 'fishing', 'roadScene', 'schoolBus'].every(name => mmm[name] === null)`), 'Just Drive keeps optional mail features absent');
      continue;
    }
    const result = await p.read(`(() => {
      const names = ${JSON.stringify(resetOrder)}, calls = [], originals = [];
      const present = names.filter(name => mmm[name] != null);
      try {
        for (const name of present) {
          const feature = mmm[name], reset = feature.reset;
          originals.push(() => { feature.reset = reset; });
          feature.reset = function (...args) { calls.push(name); return reset.apply(this, args); };
        }
        document.getElementById('startOver').click();
        return { present, calls };
      } finally { for (const restore of originals) restore(); }
    })()`);
    const expected = resetOrder;
    check(JSON.stringify(result.present) === JSON.stringify(expected), `${mode}: expected reset features are present`);
    check(JSON.stringify(result.calls) === JSON.stringify(expected), `${mode}: start-over reset order ${JSON.stringify(result.calls)}`);
  } finally { await p.close(); }
}

// 1 and 2: with the title card, as a visitor sees it.
{
  const p = await open(`${base}/?title=1`);
  await p.read(`document.getElementById('titleStart').click()`);
  await sleep(3000);
  const t0 = await clock(p);
  await sleep(4000);
  check(await clock(p) !== t0, 'the shift clock runs after Start');
  // Enter on the focused map header folds the map and does not end the shift.
  const folded = await p.read(`document.getElementById('miniMap').classList.contains('folded')`);
  await p.read(`document.getElementById('miniMapHead').focus()`);
  await p.key('Enter', 'Enter', 13);
  await sleep(800);
  check(!(await reportUp(p)), 'Enter on a focused control does not end the shift');
  check(await p.read(`document.getElementById('miniMap').classList.contains('folded')`) !== folded, 'Enter on the focused map header folds the map');
  // Enter on the focused mail button does not end the shift either (only Space is the button's game key).
  await p.read(`document.getElementById('mailButton').focus()`);
  await p.key('Enter', 'Enter', 13);
  await sleep(800);
  check(!(await reportUp(p)), 'Enter on the focused mail button does not end the shift');
  // The card, opened again from the settings panel, stops the clock.
  await p.read(`document.activeElement.blur(); [...document.querySelectorAll('#settings button')].find((b) => /Controls/.test(b.textContent)).click()`);
  await sleep(1500);
  const t1 = await clock(p);
  await sleep(5000);
  check(await clock(p) === t1, 'the shift clock stands still while the title card is open again');
  await p.read(`document.getElementById('titleStart').click()`);
  await sleep(5000);
  check(await clock(p) !== t1, 'the shift clock runs again after the card closes');
  // With nothing focused, Enter still ends the shift.
  await p.key('Enter', 'Enter', 13);
  await sleep(800);
  check(await reportUp(p), 'Enter with no control focused ends the shift');
  await p.close();
}
// 3: a new start forgets the trail. (window.mmm exists on the dev server only.)
{
  const p = await open(`${base}/?demo=8`);
  await sleep(2000);
  const far = await p.read(`(() => { const v = mmm.vehicle, x0 = v.x, z0 = v.z; v.restart(x0 + 2500, z0 + 2500, 0); v.respawn(); return Math.hypot(v.x - x0, v.z - z0); })()`);
  check(far > 1500, `respawn after a new start stays near the new start (${Math.round(far)} m from the old road)`);
  await p.close();
}
console.log(fails.length ? `FAIL: ${fails.length} check(s)` : 'PASS: focused controls keep their keys, the title card pauses the shift, a new start forgets the old trail.');
exitCheck(fails.length ? 1 : 0);
