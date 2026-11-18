#!/usr/bin/env node
import { checkStations } from './radio-expectations.mjs';
import { cdp, cdpFetch, exitCheck } from './cdp.mjs';
// Checks the car radio in headless Chromium: the readout appears, a key starts the sound, the dial moves, and off is off.
// Usage (dev server and Chromium come from the shots script):
//   RUN=radio-check.mjs VIEWS="radio|demo=1" tools/yard-shots.sh 1280 720
// Needs the songs (data/audio/out, from tools/build_radio.py). The exit code is the verdict.
import { writeFileSync } from 'node:fs';

const [outDir, url] = process.argv.slice(2);
const PORT = process.env.CDP_PORT ?? '9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tab = await (await cdpFetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const logs = [];
const { ws, send } = await cdp(tab.webSocketDebuggerUrl, { onEvent: d => {
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text));
} });
const read = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;
const key = async (code, text) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: text, text, windowsVirtualKeyCode: text.toUpperCase().charCodeAt(0) });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: text, windowsVirtualKeyCode: text.toUpperCase().charCodeAt(0) });
};
const chip = () => read(`(() => { const c = document.getElementById('radio'); return c ? JSON.stringify({ text: c.textContent, cls: c.className, hidden: c.hidden, box: c.getBoundingClientRect().toJSON() }) : 'none'; })()`);
// Where the player is in the song, from the dev server's test handle: [from memory?, seconds in, song length].
const songs = () => read(`(() => { const a = window.mmm?.radio?.audio; return a ? JSON.stringify([a.src.slice(0, 5), Math.round(a.currentTime), Math.round(a.duration || 0), a.paused]) : 'no handle'; })()`);
const shot = async (name) => writeFileSync(`${outDir}/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));

await send('Runtime.enable'); await send('Page.enable'); await send('Page.bringToFront');
// The radio belongs to the readouts, so the page must be asked for them (the shots script asks for a bare picture).
const page = new URL(url); page.searchParams.set('hud', '1');
await send('Page.navigate', { url: page.href });
for (let t = 0; t < 160; t++) { await sleep(1500); if (String(await read('document.title')).startsWith('settled')) break; }
const fails = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
const state = async (label) => {
  const c = await chip(), a = await songs();
  console.log(`${label}  ${c}  ${a}`);
  return { chip: c === 'none' ? null : JSON.parse(c), song: a === 'no handle' ? null : JSON.parse(a) };
};
const first = await state('loaded');
checkStations(await read('window.mmm.radio.stations'));
check(await read('window.mmm.radio.storageKey') === 'mmm.radio', 'mail saved-station key is unchanged');
// A new player (this browser has no saved choice) is on the station that the list names as the start.
const startDial = (await send('Runtime.evaluate', { expression: `fetch('audio/radio.json').then((r) => r.json()).then((j) => j.start || '')`, awaitPromise: true, returnByValue: true })).result?.result?.value;
check(!!first.chip && !first.chip.hidden && first.chip.box.width > 20, 'the radio readout is on screen');
check(!!first.song, 'the dev server gives the test handle (window.mmm.radio)');
check(typeof startDial === 'string' && (startDial === '' || !!first.chip?.text.includes(` ${startDial} `)), `a new player starts on the list's starting station (${startDial || 'none named'})`);
await key('KeyT', 't');
// Whole-file fetch/decode can outlast six seconds while other checks compile. Bound readiness, then prove time advances.
for (const deadline=Date.now()+20000;Date.now()<deadline;) {
  if(await read(`window.mmm?.radio?.audio.readyState>=3&&!window.mmm.radio.audio.paused&&window.mmm.radio.audio.currentTime>0&&document.getElementById('radio')?.classList.contains('live')`))break;
  await sleep(150);
}
const on = await state('after T (1)');
await shot('radio-on');
// The chip carries state classes (live/off) beside layout ones such as 'expanded' (phone HUD, PR #83): test the token, not the whole name.
const has = (chip, name) => !!chip && chip.cls.split(/\s+/).includes(name);
check(has(on.chip, 'live') && !has(on.chip, 'off'), 'a key press starts a station (readout is live)');
check(!!on.song && on.song[0] === 'blob:' && !on.song[3] && on.song[1] > 0, 'the song plays from memory and its time runs');
await sleep(2000);
const later = await state('two seconds on');
check(!!later.song && !!on.song && later.song[1] > on.song[1], 'the song moves on');
await key('KeyT', 't'); await sleep(1500);
const next = await state('after T (2)');
await shot('radio-next');
check(!!next.chip && !!on.chip && next.chip.text !== on.chip.text, 'the next key press moves the dial');
// Keep turning: after the last station comes OFF, and off is silent.
let end = next;
for (let n = 3; n < (await read('window.mmm.radio.stations.length')) + 4 && end.chip && !has(end.chip, 'off'); n++) { await key('KeyT', 't'); await sleep(2500); end = await state(`after T (${n})`); }
check(has(end.chip, 'off') && !has(end.chip, 'live'), 'after the last station the radio is off');
check(!!end.song && end.song[3] === true, 'off is silent (the player is paused)');
check(logs.length === 0, `no script error${logs.length ? ': ' + logs.join(' | ').slice(0, 600) : ''}`);
await cdpFetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`);
ws.close();
console.log(fails.length ? `FAILED: ${fails.length}` : 'PASS: readout, start by key, play from memory, dial, off.');
exitCheck(fails.length ? 1 : 0);
