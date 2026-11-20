#!/usr/bin/env node
// The driving sounds in a real browser (web/src/engine-sound.ts): no audio context before the player's first input; the
// real title tap and the W key start it; the engine follows the car (engine speed rises, gears change); a hidden page
// suspends it and a shown one resumes it; the Settings slider turns it down; the pause screen and the fly view (not driving) suspend it and
// a key there does not wake it; LOW detail builds the smaller graph; a touch tap (a phone's gesture) starts it too. A truck
// pass proves its voice, a periodic wave of one whole engine cycle, plays in a real browser and reports its firing rate.
// It reads the Web Audio graph's state, which is the browser's own. It does not prove that a person heard the sound:
// a headless browser plays into a silent output.
// Usage: RUN=engine-sound-browser.mjs VIEWS="engine|vehicle=car" tools/yard-shots.sh 1280 720
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { cdp, cdpFetch, exitCheck, sleep } from './cdp.mjs';

const [outDir, first] = process.argv.slice(2);
const PORT = process.env.CDP_PORT ?? '9333';
const tab = await (await cdpFetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const { send, assertHealthy } = await cdp(tab.webSocketDebuggerUrl, { deadline: 180000 });
const read = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};
const until = async (expr, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await read(expr)) return true; await sleep(60); } return !!(await read(expr)); };
const snap = () => read('JSON.stringify(window.mmm?.engineSound?.snapshot ?? null)').then(JSON.parse);
const key = (type, code, text) => send('Input.dispatchKeyEvent', { type, code, key: text, windowsVirtualKeyCode: text.toUpperCase().charCodeAt(0) });
const evidence = [];
const note = async (label) => { const s = await snap(); const extra = await read('JSON.stringify({speed:+mmm.vehicle.speed.toFixed(2),surface:mmm.vehicle.surfaceName,hidden:document.hidden,contexts:qaAudio.map(a=>({state:a.state,tones:a.tones,buffers:a.buffers,ran:a.ran})),ios:navigator.maxTouchPoints,resumes:qaResumes.filter(r=>r.engine).map(r=>(r.active?"A":"x")).join("")})').then(JSON.parse); evidence.push({ label, ...s, ...extra }); console.log(label.padEnd(18), JSON.stringify({ ...s, ...extra })); return { ...s, ...extra }; };

await send('Page.enable');
// Count every audio context and what each builds, from before the game's first line runs. On a touch screen the shim
// also plays by iPhone Safari's rule, which Chromium does not: a new context starts suspended, a finger's press is not a
// gesture (only the lift is), and until a context has run once, a resume outside a gesture's own event handler does
// nothing. (Chromium's userActivation stays active for seconds after a tap, so the shim reads the event being handled.)
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{
  window.qaAudio=[];window.qaResumes=[];const ios=navigator.maxTouchPoints>1;
  const lifts=new Set(['pointerup','touchend','click','mouseup','keydown','keyup']);
  const gesture=()=>{const e=window.event;return !!e&&(lifts.has(e.type)||(e.type==='pointerdown'||e.type==='mousedown')&&e.pointerType!=='touch'&&!ios);};
  const Base=window.AudioContext;
  window.AudioContext=class extends Base{
    constructor(...a){super(...a);qaAudio.push(this);this.tones=0;this.buffers=0;this.ran=!ios;if(ios)void super.suspend();}
    createOscillator(){this.tones++;return super.createOscillator();}
    createBufferSource(){this.buffers++;return super.createBufferSource();}
    resume(){const active=ios?gesture():!!navigator.userActivation?.isActive;qaResumes.push({engine:this.buffers>0,active,at:performance.now()});
      if(!this.ran&&!active)return Promise.resolve();this.ran=true;return super.resume();}
  };
})();` });

async function load(extra) {
  const url = new URL(first);
  url.searchParams.set('hud', '1'); url.searchParams.set('title', '1'); url.searchParams.set('radio', '0');
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  await send('Page.navigate', { url: url.href });
  assert.ok(await until(`!!window.mmm && 'engineSound' in mmm && !!document.getElementById('titleStart') && mmm.terrain?.pending === 0`, 240000), `page ready: ${url.search}`);
  await sleep(1500);
}
async function tapStart(touch) {
  // The title card scrolls when it is taller than the window (1280x720 is): a player scrolls to the start button first.
  const box = await read(`(() => { const b = document.getElementById('titleStart'); b.scrollIntoView({ block: 'nearest' }); return JSON.stringify(b.getBoundingClientRect()); })()`).then(JSON.parse);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  if (touch) {
    // A phone's tap: the browser counts the lift (touchend, pointerup, click) as the gesture, not the press.
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return;
  }
  const at = { x, y, button: 'left', clickCount: 1 };
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at });
}
const fails = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };

// Desktop with a mouse at full detail; then a touch screen at LOW detail, as a phone.
for (const [detail, touch] of [['high', false], ['low', true]]) {
  console.log(`--- q=${detail}${touch ? ', touch' : ''}`);
  await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1 });
  await load({ q: detail });
  let s = await note('loaded');
  check(s && s.context === 'none' && s.contexts.length === 0, 'no audio context before any input');
  // Other game sounds (yard dog, towing, road scene) make their own contexts at the tap; the engine's is the one with the noise loop.
  check(await read(`!!document.querySelector('#engineVolume input[type=range]')`), 'Settings has the Engine sound slider');
  check(s.low === (detail === 'low'), `the engine knows the detail level (${s.low})`);

  // A real mouse tap on the title's start button: the gesture that a phone needs. The context exists, but no engine runs
  // until the car is driven.
  await tapStart(touch);
  check(await until(`mmm.engineSound.snapshot.built`), 'the first tap builds the graph');
  // A phone runs a context only from a resume made inside a gesture: before any driving, the engine's context must have
  // run (unlocked) from such a call, not from a later frame's resume.
  check(await until(`mmm.engineSound.snapshot.unlocked && qaResumes.some(r => r.engine && r.active)`), 'the tap itself unlocks the context, inside the gesture');
  s = await note('tapped');
  const engines = s.contexts.filter(c => c.buffers > 0);
  check(engines.length === 1, `one audio context with the engine graph (${engines.length})`);
  check(engines[0]?.tones === (detail === 'low' ? 2 : 3) && engines[0]?.buffers === 1, `LOW builds the smaller graph (${engines[0]?.tones} oscillators, ${engines[0]?.buffers} noise source)`);

  // Hold W: the engine runs and follows the car.
  await key('keyDown', 'KeyW', 'w');
  check(await until(`mmm.engineSound.snapshot.context === 'running' && mmm.engineSound.snapshot.live`), 'driving starts the sound');
  const start = await note('pulling away');
  let top = start;
  for (let i = 0; i < 40; i++) { await sleep(150); const now = await snap(); if (now.rpm > top.rpm || now.gear > top.gear) top = { ...top, ...now }; if (now.gear >= 2) break; }
  const moving = await note('accelerating');
  check(moving.speed > 2, `the car moves (${moving.speed} m/s)`);
  check(moving.master > .2, `the engine is audible in the graph (master ${moving.master})`);
  check(top.gear >= 2 || top.rpm > start.rpm, `the engine follows the car (gear ${top.gear}, ${top.rpm} rpm)`);
  check(moving.frequency > 20 && moving.frequency < 400, `the voice sits at the firing frequency (${moving.frequency} Hz)`);

  // A hidden page: suspended at once. Shown again: resumed while still driving.
  await read('Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});document.dispatchEvent(new Event("visibilitychange"))');
  check(await until(`qaAudio.filter(a => a.buffers > 0).every(a => a.state === 'suspended') && mmm.engineSound.snapshot.context === 'suspended'`), 'a hidden page suspends the engine audio');
  await note('hidden');
  await read('delete document.hidden;document.dispatchEvent(new Event("visibilitychange"))');
  // Coming back from a hidden tab, the game waits on its pause screen (pause.ts): still quiet until Resume.
  if (await until(`!document.getElementById('pauseScreen')?.hidden`, 2000)) {
    await sleep(600);
    check(await read(`mmm.engineSound.snapshot.context === 'suspended'`), 'the pause screen after a hidden tab is quiet');
    await read(`document.getElementById('resumeGame').click()`);
  }
  check(await until(`qaAudio.some(a => a.buffers > 0) && qaAudio.filter(a => a.buffers > 0).every(a => a.state === 'running') && mmm.engineSound.snapshot.context === 'running'`), 'a shown page resumes the engine audio');
  await note('shown');

  // The slider at zero: the master falls to silence.
  await read(`(()=>{const s=document.querySelector('#engineVolume input');s.value='0';s.dispatchEvent(new Event('input'));})()`);
  check(await until(`mmm.engineSound.snapshot.master < .01`), 'the slider turns the engine down');
  check(await read(`localStorage.getItem('mmm.engine.vol') === '0'`), 'the volume is kept');
  await read(`(()=>{const s=document.querySelector('#engineVolume input');s.value='0.7';s.dispatchEvent(new Event('input'));})()`);
  await key('keyUp', 'KeyW', 'w');

  // The pause key (P): the pause screen suspends the engine; P again resumes it.
  await key('keyDown', 'KeyP', 'p'); await key('keyUp', 'KeyP', 'p');
  check(await until(`!document.getElementById('pauseScreen').hidden && qaAudio.filter(a => a.buffers > 0).every(a => a.state === 'suspended')`), 'the pause screen suspends the engine');
  await note('paused');
  await key('keyDown', 'KeyP', 'p'); await key('keyUp', 'KeyP', 'p');
  check(await until(`document.getElementById('pauseScreen').hidden && mmm.engineSound.snapshot.context === 'running'`), 'resuming the game resumes the engine');

  // The fly view (F) is not driving: the engine is suspended, and a key press there (a gesture) does not wake it.
  await key('keyDown', 'KeyF', 'f'); await key('keyUp', 'KeyF', 'f');
  check(await until(`qaAudio.filter(a => a.buffers > 0).every(a => a.state === 'suspended') && !mmm.engineSound.snapshot.live`), 'the fly view suspends the engine');
  const resumes = await read(`qaResumes.filter(r => r.engine).length`);
  await key('keyDown', 'KeyQ', 'q'); await key('keyUp', 'KeyQ', 'q'); await sleep(400);
  check(await read(`qaResumes.filter(r => r.engine).length === ${resumes} && qaAudio.filter(a => a.buffers > 0).every(a => a.state === 'suspended')`), 'a key in the fly view does not wake the engine');
  await note('flying');
  await key('keyDown', 'KeyF', 'f'); await key('keyUp', 'KeyF', 'f');
  check(await until(`mmm.engineSound.snapshot.context === 'running' && mmm.engineSound.snapshot.live`), 'back on the road, the engine runs again');

  await note('after');
  assertHealthy();
}

// The truck's voice is a periodic wave (setPeriodicWave: one engine cycle of eight uneven pulses); only a real browser can
// prove it plays. Its oscillator runs once per engine cycle, an eighth of the firing rate; the snapshot multiplies it back.
{
  console.log('--- vehicle=truck, q=high');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await load({ q: 'high', vehicle: 'truck' });
  await tapStart(false);
  check(await until(`mmm.engineSound.snapshot.built`), 'the truck: the first tap builds the graph');
  await key('keyDown', 'KeyW', 'w');
  check(await until(`mmm.engineSound.snapshot.live && mmm.engineSound.snapshot.kind === 'truck' && mmm.engineSound.snapshot.context === 'running'`), 'the truck: driving starts the sound');
  // The voice glides toward each new engine speed: keep the closest of a few readings to the target (rpm x 4 / 60).
  let best = null;
  for (let i = 0; i < 30; i++) {
    await sleep(150);
    const now = await snap(), target = now.rpm * 4 / 60, error = Math.abs(now.frequency - target) / target;
    if (!best || error < best.error) best = { ...now, target, error };
  }
  const truck = await note('truck pulling');
  check(truck.wave === 'custom', `the truck's voice is a periodic wave (type ${truck.wave})`);
  check(best.error < .1, `the snapshot reports the truck's firing rate (${best.frequency} Hz at ${best.rpm} rpm, target ${best.target.toFixed(1)} Hz)`);
  check(truck.frequency > 20 && truck.frequency < 400, `the truck's firing frequency is in range (${truck.frequency} Hz)`);
  check(truck.master > .2 && truck.speed > 1, `the truck moves and its engine is audible in the graph (master ${truck.master}, ${truck.speed} m/s)`);
  const engines = truck.contexts.filter(c => c.buffers > 0);
  check(engines.length === 1 && engines[0].tones === 3, `the truck adds no oscillator (${engines[0]?.tones})`);
  await key('keyUp', 'KeyW', 'w');
  assertHealthy();
}

await send('Emulation.setTouchEmulationEnabled', { enabled: false });
writeFileSync(`${outDir}/engine-sound.json`, JSON.stringify(evidence, null, 2));
if (fails.length) { console.log(`FAIL engine-sound-browser: ${fails.join('; ')}`); exitCheck(1); }
console.log(`PASS engine-sound-browser (${evidence.length} moments; ${outDir}/engine-sound.json)`);
exitCheck(0);
