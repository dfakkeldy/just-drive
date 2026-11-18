#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
// Measures how fast this machine draws the game, with the sun shadows on and off. It times the page's animation
// frames while the car drives itself, and takes from the game's own renderer the count of frames really drawn, so a
// page that draws nothing cannot pass. Dev server only (the game hands out its renderer there, not in a public build).
// Each view in VIEWS is measured twice: shadows=1 and shadows=0. The view should keep the car moving (demo=<seconds>
// longer than WARM + SECONDS). A number from software WebGL says nothing about a real computer: the run prints the
// graphics device so the reader can tell.
// Usage (dev server and browser come from the shots script; FREE_RUN=1 takes the frame-rate limit off):
//   FREE_RUN=1 RUN=fps-check.mjs VIEWS="village|demo=60 harbour|demo=60&road=Mabou%20Harbour%20Road&f=0.35" tools/yard-shots.sh 1600 1000
//   DPR=2 (default: a Retina screen)   WARM=12 seconds before timing   SECONDS=10 timed
//   MIN_FPS=<n> fails a view whose first row (shadows on; or "none" in phone mode, which has no shadows) is below n
// Exit code: 0 every view measured (and not under MIN_FPS), 1 a view not measured or too slow, 2 no view given.
import { cdp, cdpFetch, exitCheck } from './cdp.mjs';
const [, ...urls] = process.argv.slice(2);
const PORT = process.env.CDP_PORT ?? '9333';
const DPR = Number(process.env.DPR ?? 2), WARM = Number(process.env.WARM ?? 12), SECONDS = Number(process.env.SECONDS ?? 10);
const MIN_FPS = Number(process.env.MIN_FPS ?? 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Traffic views (trafficCheck=1) also count whole-frame draws, and their numbers go to the small evidence folder
// $MMM_CHECK_OUT/evidence/traffic-frame-time/ that check-all keeps after a pass. Other views run as before.
const trafficView = (url) => new URL(url).searchParams.get('trafficCheck') === '1';
const trafficCounts = [];

async function measure(url) {
  let tab, c;
  try {
    tab = await (await cdpFetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    c = await cdp(tab.webSocketDebuggerUrl, { deadline: 15000 });
    const { send, errors: logs } = c;
    const read = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;
    await send('Runtime.enable'); await send('Page.enable'); await send('Inspector.enable');
    const [w, h] = JSON.parse(await read('JSON.stringify([innerWidth, innerHeight])') ?? '[1600,900]');
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: DPR, mobile: false });
    if (trafficView(url)) await send('Page.addScriptToEvaluateOnNewDocument', {source:`(() => {
      const raf=requestAnimationFrame.bind(window);
      window.requestAnimationFrame=cb=>raf(t=>{
        const r=window.mmm?.renderer,game=cb.name==='frame'&&r;
        if(game){r.info.autoReset=false;r.info.reset();}
        cb(t);
        if(game)window.__wholeFrame={calls:r.info.render.calls,triangles:r.info.render.triangles};
      });
    })()`});
    await send('Page.navigate', { url });
    await sleep(WARM * 1000);
    // The page times its own frames and leaves the result in a global; this script only polls for it. A page that
    // loaded again by itself (the dev server does that once, after it has prepared its packages) loses that global
    // with its document, and is timed again.
    // Whether the game draws is not guessed: on the dev server the game hands out its renderer (window.mmm.renderer),
    // and three.js counts in it every frame it really draws; a frame asked for with a lost graphics context is not
    // counted. This script makes no graphics context of its own, so it cannot change the one the game gets.
    const sampler = `(() => {
      const r = window.mmm && window.mmm.renderer;
      if (window.__fpsRun || !r || r.getContext().isContextLost()) return;
      window.__fpsRun = true;
      let lost = false;
      r.domElement.addEventListener('webglcontextlost', () => { lost = true; });
      let maxCalls=0,maxTriangles=0,maxTraffic=0;
      const times = []; const t0 = performance.now(), drawn0 = r.info.render.frame; let last = t0;
      const tick = (t) => { maxCalls=Math.max(maxCalls,window.__wholeFrame?.calls??0); maxTriangles=Math.max(maxTriangles,window.__wholeFrame?.triangles??0); maxTraffic=Math.max(maxTraffic,window.mmm?.ambientTraffic?.cars.filter(c=>c.active).length??0); times.push(t - last); last = t; if (t - t0 < ${SECONDS * 1000}) requestAnimationFrame(tick); else {
        const drawn = r.info.render.frame - drawn0, asked = times.length;
        times.shift(); times.sort((a, b) => a - b);
        const sum = times.reduce((a, b) => a + b, 0), at = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
        const gl = r.getContext(), info = gl.getExtension('WEBGL_debug_renderer_info');
        window.__fps = JSON.stringify({ frames: times.length, fps: 1000 * times.length / sum, median: at(0.5), slow1: at(0.99), worst: times[times.length - 1],
          pixels: r.domElement.width + 'x' + r.domElement.height, device: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '?',
          maxCalls,maxTriangles,maxTraffic, drawn, asked, lost: lost || gl.isContextLost(), shadows: r.shadowMap.enabled });
      } };
      requestAnimationFrame(tick);
    })()`;
    let out = null;
    for (let t = 0; t < 2 * SECONDS + WARM + 20 && !out; t++) { await read(sampler); await sleep(1000); out = await read('window.__fps'); }
    const said = logs.length ? ` (${logs.join('; ').slice(0, 400)})` : '';
    // A script error or a crash spoils the number even when frames were counted.
    if (logs.length) return { why: `the page reported an error${said}` };
    if (!out) return { why: `no game renderer answered in ${2 * SECONDS + WARM + 20} s (the game did not start, or this is not the dev server)${said}` };
    const r = JSON.parse(out);
    if (r.lost) return { why: 'the graphics context was lost during the timing' };
    // The game draws once for each animation frame. Fewer drawn frames than timed ones means the timing saw frames
    // with no picture in them.
    if (r.drawn < 0.9 * r.asked) return { why: `the game drew ${r.drawn} frames while ${r.asked} were timed` };
    return r;
  } catch (error) { return { why: error.message }; }
  finally {
    if (tab) await cdpFetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`, { signal: AbortSignal.timeout(5000) }).catch(() => {});
    c?.close();
  }
}

if (!urls.length) { console.error('fps-check: no view to measure (give VIEWS to the shots script)'); process.exit(2); }
let failed = false, device = '';
console.log(`view              shadows   fps  median ms  1% slow ms  worst ms  frames  canvas`);
const row = (name, label, r) => `${name.padEnd(18)}${label.padEnd(8)}${r.fps.toFixed(0).padStart(5)}${r.median.toFixed(1).padStart(11)}${r.slow1.toFixed(1).padStart(12)}${r.worst.toFixed(0).padStart(10)}${String(r.frames).padStart(8)}  ${r.pixels}`;
for (const first of urls) {
  const name = new URL(first).searchParams.get('name') ?? 'view';
  // First as the player gets it, with shadows asked for. The row is labelled by what the game really did: a view
  // in phone mode has no shadows whatever the address says, and is measured once, as "none".
  const on = new URL(first); on.searchParams.set('shadows', '1');
  const a = await measure(on.href);
  if (!a.frames) { console.log(`${name.padEnd(18)}${'on'.padEnd(8)}not measured: ${a.why}`); failed = true; continue; }
  device = a.device;
  console.log('COUNTS '+JSON.stringify({name,...a}));
  if (trafficView(first)) { trafficCounts.push({ name, ...a }); if (!a.maxTraffic) { console.log('FAIL no active ambient traffic'); failed = true; } }
  console.log(row(name, a.shadows ? 'on' : 'none', a));
  if (MIN_FPS && a.fps < MIN_FPS) { console.log(`FAIL ${name}: ${a.fps.toFixed(0)} fps is under ${MIN_FPS}`); failed = true; }
  if (!a.shadows) continue;
  const off = new URL(first); off.searchParams.set('shadows', '0');
  const b = await measure(off.href);
  if (!b.frames) { console.log(`${name.padEnd(18)}${'off'.padEnd(8)}not measured: ${b.why}`); failed = true; continue; }
  if (b.shadows) { console.log(`${name.padEnd(18)}${'off'.padEnd(8)}not measured: the game kept its shadows on although the address said shadows=0`); failed = true; continue; }
  console.log(row(name, 'off', b));
}
console.log(`graphics device: ${device}`);
if (trafficCounts.length && process.env.MMM_CHECK_OUT) {
  const folder = process.env.MMM_CHECK_OUT + '/evidence/traffic-frame-time';
  mkdirSync(folder, { recursive: true }); writeFileSync(folder + '/result.json', JSON.stringify(trafficCounts, null, 2) + '\n');
}
if (/swiftshader|llvmpipe|software/i.test(device)) console.log('NOTE software drawing: these numbers do not describe a real computer');
exitCheck(failed ? 1 : 0);
