#!/usr/bin/env node
import { cdp, cdpFetch, exitCheck } from './cdp.mjs';
// Checks the picture setting (web/src/picture.ts) in a headless browser: the one measurement at a first visit, each
// choice, that the choice is kept, and the cases without a choice (an ordinary screen, a phone, a picture run, a
// pinned ratio). The measurement's own reckoning is checked without a browser by tools/check-picture.sh.
// The screen's pixel ratio is set through the DevTools protocol, so the check is the same on every computer.
// Usage (dev server and browser come from the shots script; window.mmm exists on the dev server only):
//   RUN=picture-check.mjs VIEWS="x|demo=8" tools/yard-shots.sh 1280 720
import { writeFileSync } from 'node:fs';
const [, first] = process.argv.slice(2);
const base = new URL(first).origin;
const PORT = process.env.CDP_PORT ?? '9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(url, scale) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const { ws, send } = await cdp(tab.webSocketDebuggerUrl);
  const read = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;
  const settle = async () => { for (let t = 0; t < 160; t++) { await sleep(1500); if (String(await read('document.title')).startsWith('settled')) return true; } return false; };
  await send('Runtime.enable'); await send('Page.enable');
  // Inject frame times: a shared GPU cannot supply a useful performance result.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'const raf=requestAnimationFrame;let clock=performance.now();window.requestAnimationFrame=fn=>raf(()=>fn(clock+=1000/60));' });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: scale, mobile: false });
  await send('Page.navigate', { url });
  const settled = await settle();
  const shot = async (file) => writeFileSync(file, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  return { read, settled, shot, reload: async () => { await send('Page.reload'); return settle(); },
    // Reload and come back as soon as the game's objects exist, long before the land has loaded: the measurement
    // counts no frame before that, so its first state can be read.
    early: async () => { await send('Page.reload'); for (let t = 0; t < 200; t++) { await sleep(300); if (await read(`!!(window.mmm && document.getElementById('picture'))`)) return true; } return false; }, close: async () => { await cdpFetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`); ws.close(); } };
}
const fails = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
// What the page draws: the renderer's ratio, the drawing buffer against the canvas on the page, and the control.
const STATE = `(() => { const c = document.querySelector('canvas'), g = document.getElementById('picture');
  return { ratio: mmm.renderer.getPixelRatio(), buffer: c.width / c.clientWidth, screen: devicePixelRatio, saved: localStorage.getItem('mmm.picture'),
    measuring: g ? g.dataset.measuring : null, control: !!g, inPanel: !!g && g.parentElement === document.getElementById('settings'),
    pressed: g ? [...g.querySelectorAll('button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.picture).join() : null,
    names: g ? [...g.querySelectorAll('button')].map((b) => b.textContent).join() : null }; })()`;
const near = (a, b) => Math.abs(a - b) < 0.011;
const choose = (p, key) => p.read(`document.querySelector('#picture button[data-picture="${key}"]').click()`);
const show = (s) => JSON.stringify(s);

// 1. A Retina screen (ratio 2), nothing saved: the one measurement runs, starting at Sharp, and ends with a saved
//    choice that is drawn. Which choice depends on this computer; that it is one of the three, drawn and kept, does not.
const LABEL = { sharp: 'Sharp', balanced: 'Balanced', fast: 'Fast' };
const named = pressed => Object.keys(LABEL).map(k => `${String(pressed).split(',').includes(k) ? '✓ ' : ''}${LABEL[k]}`).join();
const RATIO = { sharp: 2, balanced: 1.5, fast: 1 };
{
  const p = await open(`${base}/?demo=8`, 2);
  check(p.settled, 'the page settles');
  await p.read(`localStorage.removeItem('mmm.picture')`);
  check(await p.early(), 'and starts again with nothing saved');
  let s = await p.read(STATE);
  check(s.screen === 2, `the screen ratio is 2 in the test (${s.screen})`);
  check(s.control && s.inPanel && !!s.pressed && s.names === named(s.pressed), `the settings panel has the three choices: ${show(s)}`);
  const began = s.measuring === 'true' ? s : null;
  for (let t = 0; t < 80 && s.measuring === 'true'; t++) { await sleep(1500); s = await p.read(STATE); }
  check(!!began && near(began.ratio, 2) && began.pressed === 'sharp' && began.names === named(began.pressed) && began.saved === null, `the measurement starts at Sharp with nothing saved: ${show(began)}`);
  const first = s.saved;
  check(s.measuring === 'false' && Object.hasOwn(RATIO, first) && s.pressed === first && s.names === named(s.pressed) && near(s.ratio, RATIO[first]) && near(s.buffer, RATIO[first]),
    `the measurement ends with a saved choice that is drawn: ${show(s)}`);
  check(await p.reload(), 'the page settles after a reload');
  s = await p.read(STATE);
  check(s.measuring === 'false' && s.saved === first && s.pressed === first && s.names === named(s.pressed) && near(s.ratio, RATIO[first]), `the measured choice is kept and not measured again: ${show(s)}`);
  for (const key of ['sharp', 'fast', 'balanced']) {
    await choose(p, key); await sleep(600);
    s = await p.read(STATE);
    check(near(s.ratio, RATIO[key]) && near(s.buffer, RATIO[key]) && s.pressed === key && s.names === named(s.pressed) && s.saved === key, `${key}: ratio ${RATIO[key]}, drawn at once, saved: ${show(s)}`);
  }
  check(await p.reload(), 'the page settles after a reload');
  s = await p.read(STATE);
  check(near(s.ratio, 1.5) && near(s.buffer, 1.5) && s.pressed === 'balanced' && s.names === named(s.pressed) && s.measuring === 'false', `a choice by hand is kept over a reload: ${show(s)}`);
  // A saved value that is not a choice (an old or a damaged one) counts as nothing saved: the measurement runs.
  // A choice by hand during the measurement ends it and stays.
  await p.read(`localStorage.setItem('mmm.picture', 'toString')`);
  check(await p.early(), 'the page starts with a senseless saved value');
  s = await p.read(STATE);
  if (s.measuring === 'true') {
    await choose(p, 'fast'); await sleep(600);
    s = await p.read(STATE);
    check(s.measuring === 'false' && s.saved === 'fast' && s.pressed === 'fast' && s.names === named(s.pressed) && near(s.ratio, 1), `a choice by hand during the measurement ends it: ${show(s)}`);
    await sleep(12000);
    s = await p.read(STATE);
    check(s.saved === 'fast' && s.pressed === 'fast' && s.names === named(s.pressed) && near(s.ratio, 1), `and the measurement does not come back and overrule it: ${show(s)}`);
  } else check(false, `the measurement was still running when the page had settled (it needs over five seconds of play): ${show(s)}`);
  await p.close();
}
// 2. The cases without a choice of their own. A choice is saved each time, and must reach only the last two.
for (const [name, query, scale, saved, ratio, pressed] of [
  ['an ordinary screen has nothing to choose', 'demo=8', 1, 'sharp', 1, null],
  ['a picture run (hud=0) is at full sharpness, whatever is saved', 'demo=8&hud=0', 2, 'fast', 2, null],
  ['a pinned ratio (res=1.2)', 'demo=8&res=1.2', 2, 'sharp', 1.2, null],
  ['desktop Low detail (q=low)', 'demo=8&q=low', 3, 'sharp', 1.35, null],
  ['a screen ratio of 1.25: Sharp is the screen, not more', 'demo=8', 1.25, 'sharp', 1.25, 'sharp'],
  ['a screen ratio of 3: Sharp stops at 2', 'demo=8', 3, 'sharp', 2, 'sharp'],
]) {
  const p = await open(`${base}/?${query}`, scale);
  await p.read(`localStorage.setItem('mmm.picture', '${saved}')`);
  const s = await p.reload() ? await p.read(STATE) : null;
  check(!!s && s.saved === saved && near(s.ratio, ratio) && near(s.buffer, ratio) && s.control === (pressed !== null) && s.pressed === pressed && (pressed === null || s.names === named(s.pressed)),
    `${name}: ratio ${ratio}, ${pressed ? `control at ${pressed}` : 'no control'}: ${show(s)}`);
  if (s) await p.read(`localStorage.removeItem('mmm.picture')`);
  await p.close();
}
console.log(fails.length ? `FAIL: ${fails.length} check(s)` : 'PASS: at a first visit the picture is measured once and the result saved and drawn; each choice by hand is drawn at once and kept; desktop Low detail, picture runs and pinned ratios have no setting.');
exitCheck(fails.length ? 1 : 0);
