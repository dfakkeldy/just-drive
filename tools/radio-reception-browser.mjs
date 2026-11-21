#!/usr/bin/env node
// Checks the car radio's reception in headless Chromium, on a desktop page and on a phone page: the game tells the radio
// where the car is, the dial passes over stations that do not come in there, a weak station plays under static, a lost
// one shows NO SIGNAL and is silent, and the static stops with the radio. Most steps put a small test map round the car
// (mmm.radio.useReception), so they do not depend on the game's own transmitter table.
// Usage (dev server and Chromium come from the shots script):
//   RUN=radio-reception-browser.mjs VIEWS="reception|demo=1" tools/yard-shots.sh 1280 720
// Needs the songs (data/audio/out, from tools/build_radio.py). The exit code is the verdict.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cdp, cdpFetch, exitCheck } from './cdp.mjs';

const [outDir, url] = process.argv.slice(2);
const PORT = process.env.CDP_PORT ?? '9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const village = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../data/baked/terrain/manifest.json'), 'utf8')).village;
const fails = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };

async function open() {
  const tab = await (await cdpFetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const { ws, send } = await cdp(tab.webSocketDebuggerUrl);
  // Every read is one expression that returns JSON-able data; a promise is waited for.
  const read = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const until = async (expression, what, ms = 30000) => {
    for (const end = Date.now() + ms; Date.now() < end;) { if (await read(expression)) return true; await sleep(150); }
    check(false, `${what} (waited ${ms / 1000} s)`); return false;
  };
  const shot = async (name) => writeFileSync(`${outDir}/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  const close = async () => { await cdpFetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`); ws.close(); };
  await send('Runtime.enable'); await send('Page.enable'); await send('Page.bringToFront');
  return { send, read, until, shot, close };
}

// What the page shows and plays now.
const STATE = `(() => { const r = window.mmm.radio, c = document.getElementById('radio'), a = r.audio, b = c.querySelector('b'), s = c.querySelector('span');
  return { cls: c.className.split(/\\s+/), dial: b.textContent, song: s.textContent, songShown: getComputedStyle(s).display !== 'none', nameColour: getComputedStyle(b).color,
    label: c.getAttribute('aria-label'), box: c.getBoundingClientRect().toJSON(), volume: a.volume, muted: a.muted, paused: a.paused, time: a.currentTime,
    set: r.volume, audible: r.audible, on: r.on, station: r.station < 0 ? 'off' : r.stations[r.station].dial, ...r.reception }; })()`;
const onDial = (d) => `document.querySelector('#radio b').textContent.split(' ').includes(${JSON.stringify(d)})`;
// A test map round the car. Every station but the starting one has a transmitter: far away (lost here), or 1500 m away
// with a range of 1000 to 2000 m (half a signal here: weak).
const useMap = (weak = []) => `(() => { const r = window.mmm.radio, p = r.reception, start = r.stations[r.first].dial, transmitters = {};
  for (const s of r.stations) if (s.dial !== start) transmitters[s.dial] = ${JSON.stringify(weak)}.includes(s.dial)
    ? { e: p.e + 1500, n: p.n, clear: 1000, edge: 2000 } : { e: p.e + 1e6, n: p.n, clear: 1000, edge: 2000 };
  r.useReception({ transmitters, hollows: [] }); return true; })()`;
const playing = `(() => { const r = window.mmm.radio; return r.audio.readyState >= 3 && !r.audio.paused && r.audio.currentTime > 0; })()`;
// A short record, kept in the page, of what the player and the page were told, each with the page's own time in ms.
// The steps that depend on the order of those events print it, so a failed run shows its cause.
const TRACE = `(() => { if (window.__trace) return true;
  const log = window.__trace = [], note = (from) => (e) => { log.push([Math.round(performance.now()), from + e.type, e.target?.id || e.target?.tagName || '']); if (log.length > 80) log.shift(); };
  for (const type of ['play', 'playing', 'pause', 'ended', 'emptied', 'waiting', 'error', 'abort']) window.mmm.radio.audio.addEventListener(type, note('audio '));
  for (const type of ['keydown', 'touchstart', 'touchend', 'touchcancel', 'click', 'contextmenu']) addEventListener(type, note(''), { capture: true, passive: true });
  return true; })()`;
const told = `(() => ({ now: Math.round(performance.now()), events: window.__trace.splice(0) }))()`;
const has = (state, name) => state.cls.includes(name);

// ---------- The desktop page ----------
{
  const { send, read, until, shot, close } = await open();
  const key = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyT', key: 't', text: 't', windowsVirtualKeyCode: 84 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyT', key: 't', windowsVirtualKeyCode: 84 });
  };
  const page = new URL(url); page.searchParams.set('hud', '1');
  await send('Page.navigate', { url: page.href });
  for (let t = 0; t < 160; t++) { await sleep(1500); if (String(await read('document.title')).startsWith('settled')) break; }
  await until(`!!window.mmm?.radio && Number.isFinite(window.mmm.radio.reception.e)`, 'the game tells the radio where the car is');
  const place = await read(`(() => { const p = window.mmm.radio.reception, v = window.mmm.vehicle; return { e: p.e, n: p.n, x: v.x, z: v.z }; })()`);
  check(Math.abs(place.e - place.x - village[0]) < 5 && Math.abs(place.n + place.z - village[1]) < 5, `that place is the car's, in map metres (${Math.round(place.e)}, ${Math.round(place.n)})`);

  const dials = await read(`window.mmm.radio.stations.map(s => s.dial)`), first = await read(`window.mmm.radio.first`);
  const start = dials[first], dead = dials[(first + 1) % dials.length], weak = dials[(first + 2) % dials.length];
  check(dials.length >= 4 && (await read(STATE)).station === start, `a new player is on the starting station (${start}) of ${dials.length}`);

  // The game's own table, at the car's own place: the dial stops only where the rules say a station comes in.
  const walk = await read(`import('/src/radio-reception.ts').then(R => { const r = window.mmm.radio, p = r.reception, out = [];
    const comes = i => R.comesIn(R.signalAt(R.RECEPTION, r.stations[i].dial, p.e, p.n));
    for (let at = R.nextOnDial(r.stations.length, r.station, r.first, comes); at >= 0; at = R.nextOnDial(r.stations.length, at, r.first, comes)) out.push(r.stations[at].dial);
    return out; })`);
  console.log(`the game's table at the start: ${[start, ...walk].join(', ')}, then off`);
  check(walk.length < dials.length - 1, `the game's table passes over a station at the start (${dials.length - 1 - walk.length} of them)`);
  for (const dial of walk) {
    await key();
    await until(onDial(dial), `T goes to ${dial}`);
    if (dial !== walk[0]) continue;
    await until(`${playing} && document.getElementById('radio').classList.contains('live')`, `${dial} plays`);
    const s = await read(STATE);
    console.log('clear', JSON.stringify(s));
    check(s.band === 'clear' && !has(s, 'weak') && !has(s, 'lost') && s.static === 0 && !s.muted && Math.abs(s.volume - s.set) < 1e-6, 'a clear station plays whole, with no static');
  }
  await key();
  await until(`document.getElementById('radio').classList.contains('off')`, 'after the last station that comes in, the radio is off');
  await key();
  await until(onDial(start), `and T from off is the starting station (${start})`);

  // From here on, the test map. One station is weak; the one before it on the dial is lost.
  await read(useMap([weak]));
  await key();
  await until(onDial(weak), `the dial passes over ${dead} (lost) and stops at ${weak} (weak)`);
  await until(`${playing} && document.getElementById('radio').classList.contains('live')`, 'the weak station plays');
  let s = await read(STATE);
  console.log('weak', JSON.stringify(s));
  await shot('reception-weak');
  check(s.band === 'weak' && has(s, 'weak') && has(s, 'live') && !has(s, 'lost'), 'the readout marks a weak station');
  check(s.song.startsWith('WEAK · ') && s.song.length > 7 && s.label.includes('weak signal'), `and says so (${s.song})`);
  check(s.music > 0 && s.music < 1 && s.volume > 0 && s.volume < s.set - 0.01 && !s.muted, `its music is lower (${s.volume.toFixed(3)} of ${s.set})`);
  check(s.static > 0 && s.context === 'running', `and static sounds over it (level ${s.static.toFixed(4)}, ${s.context})`);
  check(s.audible === true, 'the driving sounds still duck under a weak station');

  // The weak station goes: the dial stays, the music is gone, the station plays on unheard.
  await read(useMap([]));
  s = await read(STATE);
  console.log('lost', JSON.stringify(s));
  await shot('reception-lost');
  check(s.station === weak && s.dial.split(' ').includes(weak), 'a station that fades is not changed for the player');
  check(s.band === 'lost' && has(s, 'lost') && !has(s, 'live') && !has(s, 'weak') && s.song === 'NO SIGNAL', `the readout says NO SIGNAL (${s.song})`);
  check(s.label.includes('does not come in here'), 'and so does its spoken label');
  check(s.muted === true && s.volume === 0 && s.music === 0 && s.audible === false, 'no music is left, and the driving sounds do not duck');
  check(s.static > 0 && !s.paused, 'static sounds, and the station keeps its clock');
  await sleep(1500);
  const later = await read(STATE);
  check(later.time > s.time && later.band === 'lost', 'the lost station plays on, unheard');

  // It comes back.
  await read(useMap([weak]));
  s = await read(STATE);
  check(s.band === 'weak' && !s.muted && s.volume > 0 && has(s, 'live') && s.song.startsWith('WEAK · '), 'the station comes back as the signal does');

  // Out of the car, no static; back in the car, it returns.
  const out = await read(`(() => { const r = window.mmm.radio; r.update(true, true); const got = { static: r.reception.static, paused: r.audio.paused }; r.update(true, false); return got; })()`);
  check(out.static === 0 && out.paused === true, 'indoors, the static stops with the music');
  await until(`${playing} && window.mmm.radio.reception.static > 0`, 'and both come back in the car');
  // Turned right down, no static.
  await read(`(() => { const v = document.querySelector('#radioVolume input'); v.dataset.was = v.value; v.value = '0'; v.dispatchEvent(new Event('input')); return true; })()`);
  await until(`window.mmm.radio.reception.static === 0`, 'with the volume at zero, no static');
  await read(`(() => { const v = document.querySelector('#radioVolume input'); v.value = v.dataset.was; v.dispatchEvent(new Event('input')); return true; })()`);
  await until(`window.mmm.radio.reception.static > 0`, 'and it returns with the volume');

  // Nothing else comes in: the next press is off, and off is silent.
  await read(useMap([]));
  await read(TRACE); await read(told);
  await key();
  await until(`document.getElementById('radio').classList.contains('off')`, 'with no other station, T turns the radio off');
  // The readout and the driving sounds know at once that the radio is off; they do not wait for the player.
  s = await read(STATE);
  check(!has(s, 'live') && s.audible === false, 'off: at once the readout does not say it plays, and the driving sounds do not duck');
  // A key press can play a moment of silence (the engine's prime), so the player itself is not always paused at once.
  await until(`window.mmm.radio.audio.paused`, 'off: the player stops', 8000);
  s = await read(STATE);
  console.log('off', JSON.stringify({ ...s, box: undefined }), JSON.stringify(await read(told)));
  check(s.static === 0 && s.context === 'none' && s.paused, 'off is silent: no music, no static');
  check(s.band === 'clear' && !has(s, 'lost') && !has(s, 'weak') && !has(s, 'live'), 'and the readout has no word for a signal');

  // With no map, the dial is the dial it always was.
  await read(`(window.mmm.radio.useReception(null), true)`);
  await key();
  await until(onDial(start), 'T from off');
  await key();
  await until(onDial(dead), `with no map, the next station is the next on the dial (${dead})`);
  await until(`${playing} && document.getElementById('radio').classList.contains('live')`, 'and it plays');
  s = await read(STATE);
  check(s.band === 'clear' && s.signal === 1 && s.static === 0 && !s.muted && !/NO SIGNAL|WEAK/.test(s.song), 'clear, with no static');
  await close();
}

// ---------- The phone page ----------
{
  const { send, read, until, shot, close } = await open();
  const width = 390, height = 844;
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.clear();localStorage.setItem('mmm.picture','fast');` });
  await send('Page.navigate', { url: `${new URL(url).origin}/mabou?touch=1&q=low&res=1&hud=1&title=1` });
  await until(`!!window.mmm?.vehicle && document.documentElement.dataset.mmmReady === 'true' && !!document.getElementById('titleStart')`, 'the phone page is ready', 240000);
  await read(`(document.getElementById('titleStart').click(), true)`);
  await until(`document.body.classList.contains('tcOn') && !!document.getElementById('radio') && !document.getElementById('radio').hidden && !!window.mmm.radio && Number.isFinite(window.mmm.radio.reception.e)`, 'the phone readout is up', 60000);
  await read(TRACE);
  // A real touch, as a finger makes it: down and up go out together. (Sent one after the other, each waits for the
  // page's answer, and a slow page can stretch the pair into a long press, which is no tap.) Each tap prints what
  // was under the finger and what the page was told, so a tap that does nothing shows why.
  // The game hides the readout until the driving view is up, and a hidden readout has an empty box in the page's
  // corner. So the wait reads the box again each time, and the finger goes to the box that the wait saw last.
  const middle = `(() => { const b = document.getElementById('radio').getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), size: b.width * b.height }; })()`;
  const tap = async (what) => {
    const under = `(() => { const p = ${middle}, at = p.size > 0 ? document.elementFromPoint(p.x, p.y) : null; return !p.size ? 'no box' : !at ? 'nothing' : at.closest('#radio') ? 'radio' : at.id || at.tagName; })()`;
    await until(`${under} === 'radio'`, `${what}: the readout is on top where the finger goes`, 20000);
    const { x, y } = await read(middle), point = { x, y };
    await read(told);
    const down = send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    const up = send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await down; await up;
    await sleep(300);
    console.log(`tap (${what}) at ${point.x},${point.y} on ${await read(under)}:`, JSON.stringify(await read(told)));
  };
  const folded = (what) => until(`!document.getElementById('radio').classList.contains('expanded')`, what, 12000);
  const same = (a, b) => ['x', 'y', 'width', 'height'].every(k => Math.abs(a.box[k] - b.box[k]) < 0.6);
  const dials = await read(`window.mmm.radio.stations.map(s => s.dial)`), first = await read(`window.mmm.radio.first`);
  const start = dials[first], weak = dials[(first + 2) % dials.length];

  await read(useMap([weak]));
  await tap('first tap');
  await until(onDial(weak), `a tap passes over the lost station and stops at ${weak}`);
  await until(`${playing}`, 'the weak station plays on the phone');
  let s = await read(STATE);
  console.log('phone weak', JSON.stringify(s));
  check(await read(`(()=>{const e=document.getElementById('radio');return e.scrollHeight<=e.clientHeight;})()`),'reception status fits the phone radio');
  check(s.band === 'weak' && s.songShown && s.song.startsWith('WEAK · '), 'the open readout says WEAK');
  check(s.static > 0 && s.context === 'running', `static sounds after a tap (${s.context})`);
  check(s.box.x >= 0 && s.box.right <= width && s.box.bottom <= height, 'the open readout is inside the screen');
  const open1 = s;
  await folded('the readout folds again');
  const clear = await read(STATE);
  check(same(clear, open1), 'open or folded, the readout keeps its box');

  await read(useMap([]));
  // The readout opens at the page's next frame, not inside the call.
  await until(`document.getElementById('radio').classList.contains('expanded')`, 'a station that goes opens the readout', 5000);
  s = await read(STATE);
  console.log('phone lost', JSON.stringify(s));
  check(await read(`(()=>{const e=document.getElementById('radio');return e.scrollHeight<=e.clientHeight;})()`),'reception status fits the phone radio');
  await shot('reception-phone-lost');
  check(has(s, 'expanded') && s.songShown && s.song === 'NO SIGNAL', 'a station that goes opens the readout: NO SIGNAL');
  check(same(s, clear) && s.muted, 'in the same box, and the music is muted (a phone ignores the volume)');
  await folded('the readout folds again');
  s = await read(STATE);
  await shot('reception-phone-lost-folded');
  check(same(s, clear) && !s.songShown && s.nameColour !== clear.nameColour, `folded, the lost station's name is dim (${clear.nameColour} to ${s.nameColour})`);
  check(s.dial.split(' ').includes(weak), 'and it is still the station the player chose');
  await tap('tap on the lost station');
  await until(`document.getElementById('radio').classList.contains('off')`, 'a tap leaves the lost station: off, with nothing else here');
  s = await read(STATE);
  check(s.static === 0 && same(s, clear), 'off: no static, same box');
  await tap('tap from off');
  await until(onDial(start), 'and a tap from off is the starting station');
  await close();
}

console.log(fails.length ? `FAILED: ${fails.length}` : 'PASS: place, seeking dial, weak, lost, back, static stops, no map, phone.');
exitCheck(fails.length ? 1 : 0);
