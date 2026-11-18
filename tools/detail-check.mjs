#!/usr/bin/env node
import { cdp, cdpFetch, exitCheck } from './cdp.mjs';
// Checks "Low detail" on a desktop (web/src/detail.ts) in a headless browser: the switch, the saved choice, the
// address that overrules it, the graphics line, the nudge after a slow first measurement, and the cases without it.
// Usage (window.mmm exists on the dev server only):
//   RUN=detail-check.mjs VIEWS="x|demo=8" tools/yard-shots.sh 1280 720
const [, first] = process.argv.slice(2);
const base = new URL(first).origin;
const PORT = process.env.CDP_PORT ?? '9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(url) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const { ws, send } = await cdp(tab.webSocketDebuggerUrl);
  const read = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;
  const settle = async () => { for (let t = 0; t < 160; t++) { await sleep(1500); if (String(await read('document.title')).startsWith('settled')) return true; } return false; };
  await send('Runtime.enable'); await send('Page.enable');
  // Inject frame times: a shared GPU cannot supply a useful performance result.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'const raf=requestAnimationFrame;let clock=performance.now();window.requestAnimationFrame=fn=>raf(()=>fn(clock+=1000/60));' });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url });
  const settled = await settle();
  return { read, settled, settle, close: async () => { await cdpFetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`); ws.close(); } };
}
const fails = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
const STATE = `(() => { const g = document.getElementById('detail'), box = g?.querySelector('input');
  return { low: mmm.low, ratio: mmm.renderer.getPixelRatio(), saved: localStorage.getItem('mmm.detail'), query: location.search,
    control: !!g, inPanel: !!g && g.parentElement === document.getElementById('settings'), checked: box ? box.checked : null,
    graphics: document.getElementById('graphics')?.textContent ?? null, software: !!document.getElementById('graphicsSoftware'),
    picture: !!document.getElementById('picture'), shadows: mmm.renderer.shadowMap.enabled, grass: !!mmm.grass, water: !!mmm.water,
    nudge: document.getElementById('detailNudge')?.textContent ?? null, open: document.getElementById('settings').classList.contains('open') }; })()`;
const show = (s) => JSON.stringify(s);
const flip = (p) => p.read(`(() => { const box = document.querySelector('#detail input'); box.checked = !box.checked; box.dispatchEvent(new Event('change', { bubbles: true })); })()`);

// 1. A desktop, nothing saved: full detail, the switch is there and off, and the graphics line names a device.
{
  const p = await open(`${base}/?demo=8`);
  await p.read(`localStorage.removeItem('mmm.detail'); localStorage.setItem('mmm.picture', 'balanced')`);
  await p.read(`location.reload()`); check(await p.settle(), 'the page settles');
  let s = await p.read(STATE);
  check(s.low === false && s.control && s.inPanel && s.checked === false && s.picture, `full detail, with the switch off: ${show(s)}`);
  check(typeof s.graphics === 'string' && s.graphics.startsWith('Graphics: ') && s.graphics.length > 14 && !/not told by the browser/.test(s.graphics), `the graphics line names what the browser draws with (this test browser tells): ${s.graphics}`);
  check(s.software === /swiftshader|llvmpipe|softpipe|software|basic render|warp/i.test(s.graphics), `the software warning shows only for software drawing: ${s.software} for ${s.graphics}`);
  // The nudge itself, called by hand: the panel opens and says the rate. (That a slow first measurement calls it
  // is in main.ts; the rate it is given is checked by tools/check-picture.sh. No test here runs a slow measurement.)
  check(s.nudge === null && s.open === false, 'no nudge by itself');
  await p.read(`mmm.detail.nudge(12.6)`);
  s = await p.read(STATE);
  check(s.open === true && /about 13 frames a second/.test(s.nudge ?? ''), `the slow-result nudge opens the panel and points at the switch: ${show(s.nudge)}`);
  // The switch: saved, and the page loads again in low detail.
  await flip(p); check(await p.settle(), 'the page loads again after the switch');
  s = await p.read(STATE);
  check(s.low === true && s.saved === 'low' && s.checked === true && !s.picture && s.ratio <= 1.351 && !s.shadows && !s.grass && !s.water && !/q=/.test(s.query),
    `low detail: saved, the simpler picture (no Picture setting, shadows, grass or mirror), switch on: ${show(s)}`);
  await p.read(`mmm.detail.nudge(9)`);
  s = await p.read(STATE);
  check(s.nudge === null, 'no nudge in low detail');
  // The address can overrule the saved choice, both ways; the switch then clears the address.
  await p.read(`location.search = '?demo=8&q=high'`); check(await p.settle(), 'the page settles with q=high');
  s = await p.read(STATE);
  check(s.low === false && s.saved === 'low' && s.checked === false, `q=high overrules a saved low: ${show(s)}`);
  await flip(p); check(await p.settle(), 'the page loads again');
  s = await p.read(STATE);
  check(s.low === true && !/q=/.test(s.query) && s.saved === 'low', `the switch clears the address's q and the saved choice rules: ${show(s)}`);
  await flip(p); check(await p.settle(), 'the page loads again');
  s = await p.read(STATE);
  check(s.low === false && s.saved === null && s.checked === false && s.picture, `switched off: nothing saved, full detail again: ${show(s)}`);
  await p.close();
}
// 2. A touch device has the mirrored switch and starts in phone detail. Picture runs have no switch.
for (const [name, query, low, control] of [['a touch device', 'demo=8&touch=1', true, true], ['a picture run (hud=0)', 'demo=8&hud=0', false, false]]) {
  const p = await open(`${base}/?${query}`);
  const s = p.settled ? await p.read(STATE) : null;
  check(!!s && s.low === low && s.control === control, `${name}: low ${low}, ${control ? 'with' : 'no'} switch: ${show(s)}`);
  await p.close();
}
console.log(fails.length ? `FAIL: ${fails.length} check(s)` : 'PASS: the Low detail switch saves its choice and loads the simpler picture; the address can overrule it; the graphics line names the device; the slow-result nudge opens the panel; touch has the mirrored switch and picture runs have no switch.');
exitCheck(fails.length ? 1 : 0);
