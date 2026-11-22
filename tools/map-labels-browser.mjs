#!/usr/bin/env node
// The small map's place names in the real game (the project brief), with pictures: Mabou village, Port Hood and
// Judique at 3.2 km, desktop and phone, small and enlarged map, property lines on (a synthetic grid: no Province
// request leaves the page) and the room switch on (no room server: only its panel is drawn).
// With MP_SERVER (tools/check-mp-game.sh starts a local room server) the room's Chat button shows too.
//   MP_PORT=5384 RUN=map-labels-browser.mjs tools/check-mp-game.sh
// MAP_LABELS_BEFORE=1 takes the pictures only, for a commit without the fix.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep, waitForSettled } from './cdp.mjs';
const [runnerOut, first] = process.argv.slice(2), base = new URL(first).origin, port = process.env.CDP_PORT, server = process.env.MP_SERVER;
const out = `${process.env.MMM_CHECK_OUT ?? runnerOut}/evidence/map-labels-browser`;
mkdirSync(out, { recursive: true });
const before = process.env.MAP_LABELS_BEFORE === '1';
const init = `(() => {
  try { if (!sessionStorage.mapLabels) { localStorage.clear(); sessionStorage.mapLabels = '1'; } } catch {}
  localStorage.setItem('mmm.map', 'open'); localStorage.setItem('mmm:province-license:v1', 'accepted');
  const c = document.createElement('canvas'); c.width = c.height = 640;
  const g = c.getContext('2d'); g.strokeStyle = '#7dffc9'; g.lineWidth = 1.5;
  // A synthetic boundary grid. It contains no Province information.
  for (let x = 20; x < 640; x += 80) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 65, 640); g.stroke(); }
  for (let y = 20; y < 640; y += 100) { g.beginPath(); g.moveTo(0, y); g.lineTo(640, y + 35); g.stroke(); }
  const picture = new Promise(resolve => c.toBlob(resolve, 'image/png'));
  const original = window.fetch;
  window.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.hostname.endsWith('novascotia.ca')) return new Response(await picture, { headers: { 'Content-Type': 'image/png' } });
    return original(input, options);
  };
})();`;
const PLACES = [
  ['mabou', 'mode=explore&vehicle=bike'],
  ['porthood', 'mode=explore&vehicle=bike&area=porthood'],
  ['judique', 'mode=explore&vehicle=bike&area=judique&at=617128,5081470,350'],
];
// 'laptop' is a 1366 × 768 screen less the browser's bars, a dock and a bookmarks bar: where the room panel met the map.
// MAP_LABELS_SCREENS=laptop takes only some of them.
// 'narrow' (1280 × 720) and 'compact' (850 × 700) windows bring the place card at the right close to the credit line.
const SCREENS = [['desktop', 1366, 768, false], ['laptop', 1366, 600, false], ['narrow', 1280, 720, false], ['compact', 850, 700, false], ['phone', 390, 844, true]]
  .filter(([name]) => !process.env.MAP_LABELS_SCREENS || process.env.MAP_LABELS_SCREENS.split(',').includes(name));
const rect = id => `(() => { const e = document.getElementById(${JSON.stringify(id)}); if (!e || e.hidden || !e.getClientRects().length) return null;
  const r = e.getBoundingClientRect(); return r.width && r.height ? { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom } : null; })()`;
const meet = (a, b) => !!a && !!b && a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const results = [];
let failed = 0;
const check = (pass, name) => { console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`); if (!pass) failed++; };

async function page(query, width, height, phone, use) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const c = await cdp(tab.webSocketDebuggerUrl, { deadline: 240000 });
  try {
    const read = async expression => (await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result.value;
    await c.send('Page.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: phone ? 2 : 1, mobile: phone });
    if (phone) await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: init });
    const url = `${base}/?${query}&mp=1&hud=1${phone ? '&touch=1' : ''}${server ? `&mpserver=${encodeURIComponent(server)}` : ''}`;
    await c.send('Page.navigate', { url });
    assert.ok(await waitForSettled(read, url), `${query} ${width}x${height} settled`);
    if (server && !phone) for (let n = 0; n < 40 && !await read(`(()=>{const card=document.getElementById('mpSocial');if(card)card.open=true;return !!document.getElementById('mpChatButton')?.offsetParent})()`); n++) await sleep(500);
    await read(`document.getElementById('propertyLines').click()`);
    for (let n = 0; n < 3 && await read(`document.getElementById('miniMapHead').textContent`) !== 'MAP3.2 km'; n++) {
      await read(`document.getElementById('miniMapCanvas').click()`); await sleep(300);
    }
    const shot = async name => writeFileSync(`${out}/${name}.png`, Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
    await use(read, shot);
  } finally {
    c.close(); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {});
  }
}
// The car arrow and the N mark, worked out here from the canvas and the heading (not read from the map's own record).
const KEEP = `(() => { const c = document.getElementById('miniMapCanvas'), r = c.getBoundingClientRect(), s = c.width / Math.min(devicePixelRatio || 1, 2);
  const f = Math.min(r.width, r.height) / s, h = s / 2, a = mmm.vehicle.heading, nx = h + Math.sin(-a) * (h - 11), ny = h - Math.cos(-a) * (h - 11);
  return [{ x0: (h - 8) * f, y0: (h * 1.25 - 10) * f, x1: (h + 8) * f, y1: (h * 1.25 + 8) * f }, { x0: (nx - 8) * f, y0: (ny - 8) * f, x1: (nx + 8) * f, y1: (ny + 8) * f }]; })()`;
const STATE = `({ range: document.getElementById('miniMapHead').textContent, size: (r => Math.min(r.width, r.height))(document.getElementById('miniMapCanvas').getBoundingClientRect()),
  labels: mmm.miniMap.labels ?? null, keep: ${KEEP}, map: ${rect('miniMap')}, radio: ${rect('radio')}, relief: ${rect('relief')},
  social: ${rect('mpSocial')}, chat: ${rect('mpChatButton')}, licence: ${rect('propertyCredit')}, credit: ${rect('credit')}, arrival: ${rect('placeArrival')},
  stopHint: ${rect('stopHint')}, mailScore: ${rect('mailScore')}, shiftHud: ${rect('shiftHud')} })`;
const near = l => Math.hypot(Math.max(l.x0 - l.px, 0, l.px - l.x1), Math.max(l.y0 - l.py, 0, l.py - l.y1)) <= 16;

for (const [place, query] of PLACES) for (const [screen, width, height, phone] of SCREENS) await page(query, width, height, phone, async (read, shot) => {
  for (const size of ['small', 'large']) {
    if (size === 'large') {
      await read(`(document.querySelector('#miniMap:not(.enlarged) #miniMapLarge:not([hidden])')?.offsetParent ? document.getElementById('miniMapLarge') : document.getElementById('miniMapEnlargeSetting')).click()`);
    }
    await sleep(1500);
    const name = `${before ? 'before' : 'after'}-${place}-${screen}-${size}`;
    await shot(name);
    const state = await read(STATE);
    results.push({ name, ...state });
    console.log(name, state.range, `${state.size}px`, state.labels ? state.labels.map(l => l.label).join(' · ') : '(no record)');
    if (before) continue;
    check(state.range === 'MAP3.2 km', `${name}: map at 3.2 km`);
    const cap = Math.max(3, Math.min(12, Math.round(state.size * state.size / 8000)));
    check(state.labels.length <= cap, `${name}: ${state.labels.length} names, at most ${cap}`);
    if (size === 'small' && place === 'mabou' && !phone) check(state.labels.length >= 2, `${name}: Mabou names shown`);
    check(state.labels.every((a, i) => state.labels.every((b, j) => i === j || !meet(a, b))), `${name}: no two names overlap`);
    check(state.keep?.length === 2 && state.labels.every(l => state.keep.every(k => !meet(l, k))), `${name}: no name on the car arrow or the N mark`);
    check(state.labels.every(near), `${name}: every name within 16 px of its point`);
    check(!!state.licence && (phone || !!state.credit), `${name}: licence banner${phone ? '' : ' and credit line'} shown`);
    check(!meet(state.licence, state.credit) && !meet(state.arrival, state.credit), `${name}: credit line clear of the licence banner and the arrival card`);
    if (phone || size === 'large') continue;
    check(!server || !!state.social && !!state.chat, `${name}: room panel and Chat shown`);
    check(!meet(state.map, state.social) && !meet(state.radio, state.social), `${name}: room panel clear of the map and the radio`);
    if (!server || place !== 'mabou') continue;
    await read(`document.getElementById('mpChatButton').click()`); await sleep(400);
    await shot(`${name}-chat`);
    const open = await read(STATE);
    check(!meet(open.map, open.social) && !meet(open.radio, open.social), `${name}: room panel with Chat open clear of the map and the radio`);
    await read(`document.getElementById('mpChatButton').click()`);
  }
});
// A canvas shown smaller than it is laid out (as on a phone), with room for names: they stay 10 px tall on screen,
// inside the shown map and clear of the car and N.
if (!before) await page(PLACES[0][1], 1366, 768, false, async (read, shot) => {
  await read(`document.head.append(Object.assign(document.createElement('style'), { textContent: '#miniMapCanvas{width:150px!important;height:150px!important}' }))`);
  await sleep(1500); await shot('after-mabou-desktop-shrunk');
  const s = await read(STATE);
  results.push({ name: 'after-mabou-desktop-shrunk', ...s });
  check(Math.round(s.size) === 150 && s.labels.length >= 1, `shown smaller: ${s.labels.length} names on the 150 px map`);
  check(s.labels.every(l => l.x0 >= 0 && l.y0 >= 0 && l.x1 <= 150 && l.y1 <= 150 && near(l)), 'shown smaller: names inside the shown map, beside their points');
  check(s.labels.every(l => s.keep.every(k => !meet(l, k))), 'shown smaller: no name on the car arrow or the N mark');
  check(await read(`(() => { const g = document.getElementById('miniMapCanvas').getContext('2d'); g.save(); g.font = '700 10px system-ui,sans-serif';
    const w = g.measureText(mmm.miniMap.labels[0].label).width; g.restore(); return Math.abs(mmm.miniMap.labels[0].x1 - mmm.miniMap.labels[0].x0 - w) < 0.5; })()`), 'shown smaller: names measured at 10 px on screen');
});
// Mail mode on the short laptop window: the stop hint, mail score and shift card stay clear of the room panel too.
if (server && !before) await page('mode=mail', 1366, 600, false, async (read, shot) => {
  await read(`document.getElementById('titleStart')?.click()`); await sleep(1500);
  await read(`document.getElementById('mpChatButton').click()`); await sleep(400);
  await shot('after-mabou-laptop-mail-chat');
  const s = await read(STATE);
  results.push({ name: 'after-mabou-laptop-mail-chat', ...s });
  check(!!s.social && !!s.stopHint && !!s.mailScore, 'mail mode: room panel, stop hint and mail score shown');
  for (const other of ['map', 'radio', 'relief', 'stopHint', 'mailScore', 'shiftHud'])
    check(!meet(s[other], s.social), `mail mode, Chat open: room panel clear of ${other}`);
});
writeFileSync(`${out}/${before ? 'before' : 'after'}${process.env.MAP_LABELS_SCREENS ? '-' + process.env.MAP_LABELS_SCREENS : ''}.json`, JSON.stringify(results, null, 1));
if (failed) { console.log(`FAIL map-labels-browser: ${failed}`); process.exit(1); }
console.log(`PASS map-labels-browser${before ? ' (pictures only)' : ''}`);
