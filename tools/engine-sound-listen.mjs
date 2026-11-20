#!/usr/bin/env node
// Renders the driving sound to WAV files for ears: the game's own EngineSound class (web/src/engine-sound.ts) plays into
// an OfflineAudioContext in the headless browser, one display frame (1/60 s) at a time, through scripted drives: a full
// pedal run from rest on gravel, a lift and coast, and jumps with the pedal held. The speeds are a simple model (pull
// falling with the square of the speed), not the vehicle physics.
// Then it judges what it rendered (unless LISTEN_CHECK=0): nothing clips at full volume; the truck's voice is a periodic
// wave; on full-range speakers the truck's engine is darker than the car's; through a phone band (a 400 Hz high-pass on
// the LOW render) it is not a nasal buzz and is no more than 3 dB quieter than the car. The numbers measure; a person
// still listens.
// Usage: RUN=engine-sound-listen.mjs VIEWS="listen|engine=0" tools/yard-shots.sh 640 360
//   LISTEN_OUT   folder for the WAV files and timelines (default: the starter's output folder)
//   LISTEN_SRC   "label=<folder with engine-sound.ts> ..." (default "now=web/src"), e.g. a copy of main's web/src as before
//   LISTEN_PATCH JSON {label: {kind: {field: value}}}: changes a source's engine profiles before it renders, to compare
//                settings by ear without editing the source, e.g. '{"bright3": {"truck": {"bright": 3}}}'
//   LISTEN_ONLY  render only names that match this regular expression, e.g. "truck-" or "run-engine|jump-full"
//   LISTEN_CHECK 0: render only, no verdict (for a source that is meant to fail, such as main before a fix)
// Names end in -full (full detail) or -low (LOW detail, as a phone); "-engine" renders have no tyre noise.
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cdp, cdpFetch, exitCheck } from './cdp.mjs';

const root = resolve(import.meta.dirname, '..');
const [outDir] = process.argv.slice(2);
const out = resolve(process.env.LISTEN_OUT ?? outDir);
mkdirSync(out, { recursive: true });
const sources = (process.env.LISTEN_SRC ?? 'now=web/src').split(/\s+/).filter(Boolean).map(s => s.split('='));
const patches = JSON.parse(process.env.LISTEN_PATCH ?? '{}');
const only = process.env.LISTEN_ONLY ? new RegExp(process.env.LISTEN_ONLY) : null, judge = process.env.LISTEN_CHECK !== '0';
const RATE = 48000, FPS = 60;

// Speed models: pull a0 (m/s^2) at rest, falling to nothing at top speed v1. The truck's gives 0-100 km/h in about 4.2 s,
// as its physics does (20 Nov 2026), on gravel a little under its 45.5 m/s pavement top; the bike tops out at 41.7 m/s.
const MODEL = { truck: { a0: 7.7, v1: 44.5 }, car: { a0: 4.4, v1: 42 }, bike: { a0: 7, v1: 41.7 }, sxs: { a0: 4, v1: 30 } };
const moment = (kind, speed, throttle, surface, airborne = false) =>
  ({ kind, speed, throttle, surface, airborne, grade: 0, towing: false, radio: false, slide: 0 });
function drive(kind, seconds, plan, start = 0) {
  const { a0, v1 } = MODEL[kind], frames = [];
  let v = start;
  for (let i = 0; i < seconds * FPS; i++) {
    const { throttle, surface, airborne = false } = plan(i / FPS, v);
    frames.push(moment(kind, v, throttle, surface, airborne));
    const drag = .3 + 1.2 * (v / v1) ** 2;   // coasting: rolling and air drag
    const a = airborne ? -.1 : throttle > 0 ? a0 * throttle * (1 - (v / v1) ** 2) : throttle < 0 ? -6 * -throttle : -drag;
    v = Math.max(0, v + a / FPS);
  }
  return frames;
}
const SCENES = {
  // Rest for a second, then the pedal flat to the floor until the speed settles.
  run: (kind, surface = 'gravel') => drive(kind, 30, t => ({ throttle: t < 1 ? 0 : 1, surface })),
  // Held at speed, then off the pedal: the box falls through the gears; a stop and idle at the end.
  coast: (kind, surface = 'gravel') => drive(kind, 24, (t, v) => ({ throttle: t < 2 ? .25 : v > 3 && t < 21 ? 0 : v > 0 ? -1 : 0, surface }), 38),
  // A jump park: pedal held through two jumps on a dirt track, then a lift.
  jump: (kind, surface = 'dirt track') => drive(kind, 15, t => ({ throttle: t < 11 ? 1 : 0, surface, airborne: (t > 3 && t < 4.4) || (t > 7.5 && t < 8.5) }), 5),
};
// [kind, scene, LOW detail, surface ('' is no tyre noise; absent is the scene's own)]
const PLAN = [
  ...['run', 'coast', 'jump'].flatMap(s => [['truck', s, false], ['truck', s, true]]),
  ['truck', 'run', false, ''], ['truck', 'run', true, ''], ['truck', 'jump', false, ''], ['truck', 'jump', true, ''],
  ['car', 'run', false], ['car', 'coast', false], ['car', 'jump', false], ['car', 'run', true], ['car', 'run', false, ''], ['car', 'run', true, ''],
  ['bike', 'run', false, 'pavement'],
].map(([kind, scene, low, surface]) => ({ kind, scene, low, surface, part: `${scene}${surface === '' ? '-engine' : ''}-${low ? 'low' : 'full'}` }));

// Runs in the page: EngineSound makes its context in the first key's handler, so the key is sent while AudioContext
// hands out the offline one. Each frame is one suspend point, where the renderer calls update() as the game does.
const RENDER = `async (global, low, frames, rate, patch) => {
  const { EngineSound, ENGINES } = window[global];
  for (const [kind, fields] of Object.entries(patch)) Object.assign(ENGINES[kind], fields);
  const ctx = new OfflineAudioContext(1, Math.ceil(frames.length / ${FPS} * rate), rate);
  const Real = window.AudioContext;
  let sound;
  window.AudioContext = function () { return ctx; };
  try { sound = new EngineSound(low); sound.volume = 1; window.dispatchEvent(new KeyboardEvent('keydown')); }
  finally { window.AudioContext = Real; }
  if (!sound.snapshot.built) throw Error('the graph was not built');
  // The renderer owns resuming: update() resumes a suspended context itself, which would race the next frame.
  const resume = OfflineAudioContext.prototype.resume;
  ctx.resume = () => Promise.resolve();
  const log = [];
  const step = i => { sound.update(1 / ${FPS}, frames[i]); const s = sound.snapshot; log.push([s.rpm, s.gear, s.load, s.wave]); };
  step(0);
  for (let i = 1; i < frames.length; i++) ctx.suspend(i / ${FPS}).then(() => { step(i); return resume.call(ctx); });
  const data = (await ctx.startRendering()).getChannelData(0);
  let peak = 0, sum = 0;
  const pcm = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) { const v = data[i]; peak = Math.max(peak, Math.abs(v)); sum += v * v; pcm[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767))); }
  const bytes = new Uint8Array(pcm.buffer);
  let text = '';
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return JSON.stringify({ log, peak, rms: Math.sqrt(sum / data.length), pcm: btoa(text) });
}`;

// The measuring tools: power spectra (8192-point Hann windows), their centre, and a 400 Hz high-pass as a phone speaker.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}
/** Power-weighted centre (Hz) and share of power above 800 Hz, from `lo` Hz up, over samples [from, to). */
function spectrum(x, from, to, lo = 20) {
  const N = 8192, bin = RATE / N;
  let sum = 0, weighted = 0, high = 0;
  for (let s = from; s + N <= to; s += N / 2) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s + i] * (.5 - .5 * Math.cos(2 * Math.PI * i / (N - 1)));
    fft(re, im);
    for (let k = Math.ceil(lo / bin); k <= 8000 / bin; k++) { const pw = re[k] ** 2 + im[k] ** 2; sum += pw; weighted += pw * k * bin; if (k * bin > 800) high += pw; }
  }
  return { centre: weighted / sum, above800: high / sum };
}
function phone(x) {
  const w0 = 2 * Math.PI * 400 / RATE, al = Math.sin(w0) / Math.SQRT2, c = Math.cos(w0), a0 = 1 + al;
  const b0 = (1 + c) / 2 / a0, b1 = -(1 + c) / a0, a1 = -2 * c / a0, a2 = (1 - al) / a0, y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
const rmsDb = (x, from, to) => { let s = 0; for (let i = from; i < to; i++) s += x[i] * x[i]; return 10 * Math.log10(s / (to - from)); };

function wav(pcm) {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

const PORT = process.env.CDP_PORT ?? '9333';
const tab = await (await cdpFetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const { send, assertHealthy } = await cdp(tab.webSocketDebuggerUrl, { deadline: 600000 });
const evaluate = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const summary = [], kept = {}, fails = [];
const check = (pass, what) => { console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`); if (!pass) fails.push(what); };
for (const [label, dir] of sources) {
  const src = resolve(root, dir), global = `listen_${label.replace(/\W/g, '_')}`;
  const entry = `export { EngineSound } from ${JSON.stringify(resolve(src, 'engine-sound.ts'))}; export { ENGINES } from ${JSON.stringify(resolve(src, 'engine-sound-rules.ts'))};`;
  const bundle = await build({ stdin: { contents: entry, resolveDir: src, loader: 'ts' }, bundle: true, format: 'iife', globalName: global, write: false,
    logLevel: 'warning', define: { 'import.meta.env': '{"DEV":false}' } });
  await evaluate(bundle.outputFiles[0].text);
  for (const { kind, scene, low, surface, part } of PLAN) {
    const name = `${kind}-${label}-${part}`;
    if (only && !only.test(name)) continue;
    const frames = SCENES[scene](kind, surface);
    const r = JSON.parse(await evaluate(`(${RENDER})(${JSON.stringify(global)}, ${low}, ${JSON.stringify(frames)}, ${RATE}, ${JSON.stringify(patches[label] ?? {})})`));
    writeFileSync(`${out}/${name}.wav`, wav(Buffer.from(r.pcm, 'base64')));
    writeFileSync(`${out}/${name}.json`, JSON.stringify({ name, kind, label, scene, low, rate: RATE, fps: FPS, peak: r.peak, rms: r.rms, patch: patches[label] ?? {},
      frames: frames.map((f, i) => ({ t: +(i / FPS).toFixed(3), speed: +f.speed.toFixed(2), throttle: f.throttle, airborne: f.airborne, surface: f.surface,
        rpm: r.log[i][0], gear: r.log[i][1], load: r.log[i][2] })), wave: r.log[0][3] }));
    summary.push({ name, seconds: frames.length / FPS, peak: +r.peak.toFixed(3), rmsDb: +(20 * Math.log10(r.rms)).toFixed(1), wave: r.log[0][3] });
    console.log(JSON.stringify(summary.at(-1)));
    if (!judge) continue;
    check(r.peak < .99, `${name} does not clip at full volume (peak ${r.peak.toFixed(2)})`);
    if (kind === 'truck') check(r.log.every(l => l[3] === 'custom'), `${name}: the truck's voice is a periodic wave (${r.log[0][3]})`);
    if (part.startsWith('run-engine')) { const i16 = new Int16Array(new Uint8Array(Buffer.from(r.pcm, 'base64')).buffer); kept[`${kind}-${label}-${part}`] = Float64Array.from(i16, v => v / 32767); }
  }
  // The pedal is down from 1 s; judge from 3 s, when the engine pulls through the gears, to the end.
  const truck = kept[`truck-${label}-run-engine-full`], car = kept[`car-${label}-run-engine-full`];
  const truckLow = kept[`truck-${label}-run-engine-low`], carLow = kept[`car-${label}-run-engine-low`];
  if (judge && truck && car) {
    const t = spectrum(truck, 3 * RATE, truck.length), c = spectrum(car, 3 * RATE, car.length);
    check(t.centre <= 400 && t.centre < c.centre, `${label}: full pedal, the truck's engine centres at ${t.centre.toFixed(0)} Hz, under 400 Hz and under the car's ${c.centre.toFixed(0)} Hz`);
    check(t.above800 <= .08, `${label}: full pedal, ${(t.above800 * 100).toFixed(1)}% of the truck's engine is above 800 Hz (at most 8%)`);
  } else if (judge) console.log(`not judged: ${label} full-range centre (render truck and car run-engine-full)`);
  if (judge && truckLow && carLow) {
    const tp = phone(truckLow), cp = phone(carLow), from = 3 * RATE;
    const t = spectrum(tp, from, tp.length, 400), dt = rmsDb(tp, from, tp.length), dc = rmsDb(cp, from, cp.length);
    check(t.centre <= 750, `${label}: through a phone band the truck's engine centres at ${t.centre.toFixed(0)} Hz (at most 750 Hz: no nasal buzz)`);
    check(dt >= dc - 3, `${label}: through a phone band the truck's engine is ${(dt - dc).toFixed(1)} dB against the car's (at least -3 dB)`);
  } else if (judge) console.log(`not judged: ${label} phone band (render truck and car run-engine-low)`);
}
assertHealthy();
writeFileSync(`${out}/renders.json`, JSON.stringify(summary, null, 2));
console.log(`rendered ${summary.length} files into ${out}`);
if (judge && !summary.length) fails.push('nothing rendered');
if (fails.length) { console.log(`FAIL engine-sound-listen: ${fails.join('; ')}`); exitCheck(1); }
console.log(judge ? `PASS engine-sound-listen (${summary.length} renders)` : 'rendered without a verdict (LISTEN_CHECK=0)');
exitCheck(0);
