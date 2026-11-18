#!/usr/bin/env node
// What the finish pass (web/src/finish.ts; web/src/finish-choice.ts says when it runs) costs in each frame, part by part. One page draws the world a
// different way on every frame, in a shuffled round: the old picture (twice: the two must agree, or the ruler is bad),
// the pass with nothing in it, the whole pass, and the whole pass with one part left out. Each draw is timed alone:
// the page waits for the graphics chip before and after it. So every way meets the same scene and the same load from
// other work on the machine. Dev server only.
//   FREE_RUN=1 RUN=finish-cost.mjs VIEWS="default|demo=120 four|demo=120&finish=1&clouds=1 low|demo=120&q=low&finish=1&clouds=1" tools/yard-shots.sh 1600 1000
// "default" is what a desktop player gets (one sample for each pixel, canvas without edge samples); its "old" columns
// are then the old world on that canvas, so compare them with the "old" of a finish=1 view for the true old picture.
//   DPR=2 (default)   WARM=15 seconds before timing   SECONDS=45 timed
// Page-load choices to compare between views: finishSamples=0|2|4 (edge samples), canvasAA=0|1, finishType=byte (colour store).
import { cdp, cdpFetch } from './cdp.mjs';
const [, ...urls] = process.argv.slice(2);
const PORT = process.env.CDP_PORT ?? '9333';
const DPR = Number(process.env.DPR ?? 2), WARM = Number(process.env.WARM ?? 15), SECONDS = Number(process.env.SECONDS ?? 45);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!urls.length) { console.error('finish-cost: no view to measure (give VIEWS to the shots script)'); process.exit(2); }
let failed = false;
const WAYS = ['old', 'old2', 'bare', 'full', '-shade', '-glow', '-clouds', '-sharpen'];
console.log('Median milliseconds for one world draw. "bare" = the pass with every part off; "-x" = the whole pass without x.');
console.log(`${'view'.padEnd(12)}${'canvas'.padEnd(11)}${WAYS.map((w) => w.padStart(9)).join('')}   | pass  bare  shade  glow  clouds  sharpen  ruler`);
for (const url of urls) {
  const name = new URL(url).searchParams.get('name') ?? 'view';
  let tab, c;
  try {
    tab = await (await cdpFetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    c = await cdp(tab.webSocketDebuggerUrl, { deadline: 15000 });
    const { send } = c;
    const read = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;
    await send('Runtime.enable'); await send('Page.enable');
    const [w, h] = JSON.parse(await read('JSON.stringify([innerWidth, innerHeight])') ?? '[1600,900]');
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: DPR, mobile: false });
    await send('Page.navigate', { url });
    await sleep(WARM * 1000);
    const sampler = `(() => {
      const m = window.mmm, f = m && m.finish, p = m && m.drawProbe, r = m && m.renderer;
      if (window.__costRun || !f || !p || !r) return;
      window.__costRun = true;
      const gl = r.getContext(), px = new Uint8Array(4), ways = ${JSON.stringify(WAYS)}, times = {};
      for (const w of ways) times[w] = [];
      const wait = () => { gl.finish(); if (gl.getParameter(gl.FRAMEBUFFER_BINDING) === null) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
      let round = [], way = 'old', t = 0, frames = 0; const t0 = performance.now();
      p.before = () => {
        if (!round.length) { round = ways.slice(); for (let i = round.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [round[i], round[j]] = [round[j], round[i]]; } }
        way = round.pop();
        f.on = way !== 'old' && way !== 'old2';
        const bare = way === 'bare';
        f.skip.ao = bare || way === '-shade'; f.skip.glow = bare || way === '-glow'; f.skip.clouds = bare || way === '-clouds'; f.skip.sharpen = bare || way === '-sharpen';
        wait(); t = performance.now();
      };
      p.after = () => {
        wait(); const now = performance.now();
        if (++frames > ${WAYS.length * 4}) times[way].push(now - t);
        if (now - t0 < ${SECONDS * 1000}) return;
        p.before = p.after = undefined; f.on = true; f.skip.ao = f.skip.glow = f.skip.clouds = f.skip.sharpen = false;
        const mid = (a) => { a.sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : NaN; };
        const out = { n: times.full.length, pixels: r.domElement.width + 'x' + r.domElement.height };
        for (const w of ways) out[w] = mid(times[w]);
        window.__cost = JSON.stringify(out);
      };
    })()`;
    let out = null;
    for (let t = 0; t < SECONDS + 40 && !out; t++) { await read(sampler); await sleep(1000); out = await read('window.__cost'); }
    if (!out) { console.log(`${name.padEnd(12)}not measured (no finish pass on the page, or not the dev server)`); failed = true; continue; }
    const m = JSON.parse(out), old = (m.old + m.old2) / 2, n = (v) => v.toFixed(1).padStart(6);
    console.log(`${name.padEnd(12)}${m.pixels.padEnd(11)}${WAYS.map((k) => m[k].toFixed(2).padStart(9)).join('')}   |${n(m.full - old)}${n(m.bare - old)}${n(m.full - m['-shade'])}${n(m.full - m['-glow'])}${n(m.full - m['-clouds'])} ${n(m.full - m['-sharpen'])}   ${n(Math.abs(m.old - m.old2))}  (${m.n} draws each)`);
  } catch (error) { console.log(`${name.padEnd(12)}not measured: ${error.message}`); failed = true; }
  finally {
    if (tab) await cdpFetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`, { signal: AbortSignal.timeout(5000) }).catch(() => {});
    c?.close();
  }
}
process.exit(failed ? 1 : 0);
