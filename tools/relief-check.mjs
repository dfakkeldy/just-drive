#!/usr/bin/env node
import { cdp, cdpFetch, exitCheck } from './cdp.mjs';
// Checks the forced stop of the bladder gauge in headless Chromium: with the gauge full and the car left alone, the
// carrier must stop by himself after two minutes of play, and the gauge must be empty afterwards.
// The stop must come about 40 minutes on the game's own clock after play begins (the gauge's grace at full; that is
// two minutes of play). The game clock is read from the shift readout, so a slow start of the page does not matter.
// Usage (dev server and Chromium come from the shots script; the run takes about three minutes):
//   RUN=relief-check.mjs VIEWS="relief|x=1" tools/yard-shots.sh 1280 720
const [, first] = process.argv.slice(2);
const base = new URL(first).origin;
const PORT = process.env.CDP_PORT ?? '9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tab = await (await cdpFetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const logs = [];
const { ws, send } = await cdp(tab.webSocketDebuggerUrl, { onEvent: d => {
  if (d.method === 'Runtime.consoleAPICalled') logs.push(d.params.args.map((a) => a.value ?? a.description).join(' '));
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text));
} });
// Another screenshot browser can hide this tab and stop its animation clock.
const read = async (expression) => {
  await send('Page.bringToFront');
  return (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;
};
await send('Runtime.enable'); await send('Page.enable');
// A full gauge, on the rail trail in the woods, and nobody touches the car.
// Watching starts with the page, not after the land has settled: the clock runs while the land loads.
const t0 = Date.now();
await send('Page.navigate', { url: `${base}/?relief=1&road=${encodeURIComponent('Mabou Rivers Trail')}&f=0.4&hud=1` });
const card = () => read(`(() => { const c = document.getElementById('reliefCard'); return c && !c.hidden ? c.textContent : ''; })()`);
const bar = () => read(`document.querySelector('#relief b')?.style.width ?? ''`);
// The game clock, in minutes of the day, from the shift readout ("DAY 1 · 0/33 STOPS · 10:03").
const gameClock = async () => { const m = /(\d{1,2}):(\d{2})/.exec(String(await read(`document.getElementById('shiftHud')?.textContent ?? ''`))); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const seen = [];
let forced = false, done = false, forcedAt = 0, clock0 = null, clock1 = null;
while (Date.now() - t0 < 420000 && !done) {
  await sleep(1000);
  if (clock0 === null) clock0 = await gameClock();
  const text = await card();
  if (text && seen[seen.length - 1] !== text) seen.push(text);
  if (/IT CANNOT WAIT/.test(text) && !forced) { forced = true; forcedAt = Math.round((Date.now() - t0) / 1000); clock1 = await gameClock(); }
  if (forced && /(ALL CLEAR|SEEN)/.test(text)) done = true;
}
const waited = clock0 !== null && clock1 !== null ? clock1 - clock0 : null;
const after = await bar();
const took = Math.round((Date.now() - t0) / 1000);
console.log(`cards: ${seen.join(' | ')}`);
console.log(`gauge after: ${after}; forced stop after ${waited} game minutes (${forcedAt} s after the page opened); ${took} s in all`);
console.log(logs.filter((l) => /\[relief\]|EXCEPTION/.test(l)).join('\n'));
// 40 game minutes of grace. The first reading of the clock comes a second or two into play, so 36 to 42 is on time.
const onTime = waited !== null && waited >= 36 && waited <= 42;
const ok = forced && done && onTime && parseInt(after, 10) <= 5 && logs.some((l) => /\[relief\].*"forced":true/.test(l));
console.log(ok ? 'PASS: a full gauge left alone forces the stop after about two minutes, reports it as forced, and empties.' : `FAIL${forced && !onTime ? ': the stop came at the wrong time' : ''}`);
await cdpFetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`);
ws.close();
exitCheck(ok ? 0 : 1);
