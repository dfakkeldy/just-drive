// Only run through tools/yard-shots.sh, which owns tools/browser.sh and its shared slot:
//   RUN=party-line-browser.mjs HUD=1 tools/yard-shots.sh 1280 800
// The Party Line's call-ins in Get Fired on the dev server, desktop and phone, with the real radio (data/audio/out) and
// fixture calls: audio/calls.json and two short silent MP3s are answered by the browser's request interception, so
// nothing is written to data/ and no encoder is needed. A scored offence brings a call on 94.9 in a pause of the station; the radio line says "Caller
// about: <name>" (the multiplayer handle, or the invented call sign); the call and its nickname play on the radio's own
// player, then the piece goes on from the same second; the end card names the player and the nickname. Another
// station hears no call. Mail play and Just Drive never ask for calls.json.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep } from './cdp.mjs';

const [out, first] = process.argv.slice(2), port = process.env.CDP_PORT;
const catalogue = JSON.parse(readFileSync(new URL('./radio_stations.json', import.meta.url), 'utf8'));
const talk = catalogue.stations.find(s => s.tracks.some(t => t.credit === 'talk'));
assert.equal(talk.dial, '94.9', '94.9 is the talk station');
// Silence stands in for a call and its nickname: MPEG-1 Layer III frames (128 kbit/s, 44.1 kHz, mono) whose side
// information is all zero, so each decodes to 1152 silent samples. A real MP3 the browser plays, made without an encoder.
const silence = (seconds) => {
  const frame = Buffer.alloc(417); frame.writeUInt32BE(0xFFFB90C4, 0);
  return Buffer.concat(Array(Math.round(seconds * 44100 / 1152)).fill(frame)).toString('base64');
};
const files = { 'talk-react-box-5.mp3': silence(12), 'talk-nick-theresa-box-1.mp3': silence(1.0) };
// Every piece of 94.9 is "in a pause" from its start, so a call may start as soon as it has arrived.
const calls = { dial: '94.9', catalogueHash: 'fixture',
  calls: [{ file: 'talk-react-box-5.mp3', seconds: 12, about: 'box', caller: 'theresa', name: true }],
  nicknames: [{ file: 'talk-nick-theresa-box-1.mp3', seconds: 1, kind: 'box', caller: 'theresa', name: 'Box Basher' }],
  gaps: Object.fromEntries(talk.tracks.map(t => [t.source + '.mp3', [[0, 100000]]])) };
const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const errors = [], asked = [];
const c = await cdp(tab.webSocketDebuggerUrl, { deadline: 300000, onEvent: e => {
  if (e.method === 'Runtime.exceptionThrown') errors.push(e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text);
  if (e.method === 'Fetch.requestPaused') {
    const name = new URL(e.params.request.url).pathname.split('/').pop();
    asked.push(name);
    const body = name === 'calls.json' ? Buffer.from(JSON.stringify(calls)).toString('base64') : files[name];
    void c.send('Fetch.fulfillRequest', body ? { requestId: e.params.requestId, responseCode: 200, body,
      responseHeaders: [{ name: 'Content-Type', value: name.endsWith('.json') ? 'application/json' : 'audio/mpeg' }] }
      : { requestId: e.params.requestId, responseCode: 404, body: '' });
  }
} });
const read = async expression => {
  const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.error || r.result?.exceptionDetails) throw Error(JSON.stringify(r));
  return r.result.result.value;
};
const shot = async name => writeFileSync(`${out}/${name}.png`, Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
const until = async (expression, ms, what) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await read(expression)) return;
  throw Error(`timed out: ${what}`);
};
async function page(phone, query, host = '127.0.0.1') {
  await c.send('Emulation.setDeviceMetricsOverride', { width: phone ? 390 : 1280, height: phone ? 844 : 800, deviceScaleFactor: 1, mobile: phone });
  const url = new URL(`/?x=1&title=1&hud=1&res=1&scene=0&day=1&run=1&reception=0&${phone ? 'touch=1&q=low&' : ''}${query}`, first); url.hostname = host;
  await c.send('Page.navigate', { url: url.href });
  let ready = false;
  for (let i = 0; i < 360 && !ready; i++) { await sleep(500); ready = await read("document.documentElement.dataset.mmmReady === 'true' && !!window.mmm?.shift"); }
  assert.equal(ready, true, 'Mabou settles');
  assert.equal(await read("!!document.querySelector('vite-error-overlay')"), false);
}
const chip = () => read("(()=>{const e=document.getElementById('radio');if(!e)return null;const r=e.getBoundingClientRect();const s=e.querySelector('span'),q=s.getBoundingClientRect();return {text:e.textContent,live:e.classList.contains('live'),inside:r.left>=0&&r.right<=innerWidth+.5&&r.top>=0&&r.bottom<=innerHeight+.5,shown:!e.hidden&&r.width>0,whole:getComputedStyle(s).display!=='none'&&s.scrollWidth<=s.clientWidth+1&&s.scrollHeight<=s.clientHeight+1&&q.left>=r.left-.5&&q.right<=r.right+.5&&q.top>=r.top-.5&&q.bottom<=r.bottom+.5}})()");
const report = kind => read(`mmm.shift.score.report({kind:'${kind}',place:'route',speed:6,time:mmm.shift.elapsed/60})`);
try {
  await c.send('Runtime.enable'); await c.send('Page.enable');
  await c.send('Fetch.enable', { patterns: [{ urlPattern: '*/audio/calls.json' }, { urlPattern: '*/audio/talk-react-*' }, { urlPattern: '*/audio/talk-nick-*' }] });
  for (const phone of [false, true]) {
    const name = phone ? 'phone' : 'desktop';
    // Desktop has a multiplayer handle; the phone has none, so it gets an invented call sign.
    const setup = await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('mmm.radio','94.9');${phone ? "localStorage.removeItem('mmm.mp.handle')" : "localStorage.setItem('mmm.mp.handle','Road Hog 7')"}}catch{}` });
    asked.length = 0;
    await page(phone, 'mode=fired');
    await until('!!window.mmm?.partyLine', 20000, 'the calls list arrives in Get Fired');
    const handle = await read('mmm.partyLine.handle');
    if (phone) assert.match(handle, /^(Muddy|Dusty|Sleepy|Foggy|Wobbly|Bouncy) (Tire|Gravel|Culvert|Window|Pothole|Mirror)$/, 'no handle: the invented call sign');
    else assert.equal(handle, 'Road Hog 7', 'the multiplayer handle');
    await read("document.getElementById('titleStart').click();document.activeElement?.blur()");
    // A real key press is the gesture that lets the page play sound (a key with no job in the game).
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'F24', key: 'F24', windowsVirtualKeyCode: 135 });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'F24', key: 'F24', windowsVirtualKeyCode: 135 });
    await until("!!mmm.radio&&!mmm.radio.audio.paused&&mmm.radio.audio.currentTime>0.5&&mmm.radio.tunedDial==='94.9'", 30000, '94.9 plays');
    // Not in a piece's last half minute: the piece the call goes into is the one that goes on after it.
    await until("!mmm.radio.audio.paused&&mmm.radio.audio.currentTime>0.5&&mmm.radio.audio.duration-mmm.radio.audio.currentTime>30", 90000, 'a piece with time left');
    const before = await read('({src:mmm.radio.audio.src,at:mmm.radio.audio.currentTime})');
    // A mailbox down, scored: Theresa calls, and says the nickname for what the player does most.
    await report('boxDown');
    await until('!!mmm.partyLine.board.onAir', 8000, 'the call starts within a few seconds');
    const during = await read("({src:mmm.radio.audio.src,paused:mmm.radio.audio.paused,audible:mmm.radio.audible,dial:mmm.radio.tunedDial,calls:mmm.partyLine.board.played.length})");
    const line = await chip();
    console.log(name, 'during', JSON.stringify(during), JSON.stringify(line));
    assert.notEqual(during.src, before.src, 'the call plays on the radio\'s own player');
    assert.ok(during.src.startsWith('blob:'), 'from memory');
    assert.ok([`94.9 THE PARTY LINECaller about: ${handle}`, `94.9 THE PARTY LINE ♪Caller about: ${handle}`].includes(line.text), 'the radio line names the player, as text');
    assert.equal(line.shown, true); assert.equal(line.inside, true, 'the radio line fits the screen');
    assert.equal(line.whole, true, 'the call line is shown whole: the name is never cut short');
    await sleep(800); assert.equal(await read('mmm.radio.audible'), true, 'it sounds (the driving sounds duck under it)');
    // The readout folds back after a few seconds (a phone shows only the station then): the call line stays, whole.
    await sleep(4000); assert.equal((await chip()).whole, true, 'and stays whole after the readout folds back');
    // The longest names, on narrower phones too: the call line's room, measured with each name in place for a moment.
    for (const width of phone ? [360, 375, 390] : [1280]) {
      if (phone) { await c.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(400); }
      const cut = await read(`(()=>{const e=document.getElementById('radio'),s=e.querySelector('span'),was=s.textContent,out=[];
        for(const n of ['Bouncy Culvert','Wobbly Pothole','RoadHogRoadHog','a bcdefghijklm','Sleepy Gravel']){s.textContent='Caller about: '+n;
          const r=e.getBoundingClientRect(),q=s.getBoundingClientRect();
          if(!(s.scrollWidth<=s.clientWidth+1&&s.scrollHeight<=s.clientHeight+1&&q.left>=r.left-.5&&q.right<=r.right+.5&&q.top>=r.top-.5&&q.bottom<=r.bottom+.5))out.push(n);}
        s.textContent=was;return out})()`);
      assert.deepEqual(cut, [], `${width}px: names cut short`);
    }
    if (phone) { await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(400); }
    await shot(`party-line-${name}-call`);
    await until('!mmm.partyLine.board.onAir', 20000, 'the call and the nickname end');
    // (A join in a piece's first second starts it from the top, as every join of the radio does.)
    const from = before.at <= 1 ? 0 : before.at - 0.5;
    // The piece is back once its seek has landed (the player plays at once, and joins the second when the length is known).
    await until(`mmm.radio.audio.src===${JSON.stringify(before.src)}&&!mmm.radio.audio.paused&&mmm.radio.audio.currentTime>=${from}`, 8000, 'the piece goes on');
    const after = await read('({at:mmm.radio.audio.currentTime})');
    console.log(name, 'piece', before.at.toFixed(2), '->', after.at.toFixed(2));
    assert.ok(after.at >= from && after.at < before.at + 4, `the piece goes on from the same second (${before.at.toFixed(2)} -> ${after.at.toFixed(2)})`);
    assert.ok(!(await chip()).text.includes('Caller about'), 'the radio line is back to the piece');
    assert.deepEqual(asked.filter(n => n !== 'calls.json').sort(), Object.keys(files).sort(), 'the call and its nickname were fetched');
    // The same kind again: that call is used, so no call (never twice in a run). Another station: no call either.
    await report('box:down'); await sleep(1500);
    assert.equal(await read('mmm.partyLine.board.played.length'), 1, 'never the same call twice in a run');
    // End the run: the end card names the player and the nickname.
    await read("document.getElementById('endShift').click()"); await sleep(500);
    const card = await read("[...document.querySelectorAll('#endingCard p')].map(p=>p.textContent)");
    console.log(name, 'card', JSON.stringify(card));
    assert.ok(card.includes(`94.9 THE PARTY LINE took a call about ${handle}. Callers know you as “Box Basher”.`), 'the end card line');
    await shot(`party-line-${name}-end`);
    // Try again: a new run, and on another station a scored offence brings no call.
    await read("document.querySelector('#endingChoices button').click()"); await sleep(500);
    assert.equal(await read('mmm.partyLine.board.played.length'), 0, 'a new run');
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyT', key: 't', text: 't', windowsVirtualKeyCode: 84 });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyT', key: 't', windowsVirtualKeyCode: 84 });
    await until("mmm.radio.tunedDial!=='94.9'", 5000, 'the dial moves');
    await report('boxDown'); await sleep(2500);
    assert.equal(await read('mmm.partyLine.board.played.length'), 0, 'no call on another station');
    assert.ok(!(await chip()).text.includes('Caller about'));
    await c.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: setup.result.identifier });
    console.log('PASS Party Line', name, 'call in a pause on 94.9, "Caller about" line, nickname, the piece goes on, end card, none twice, none on another station');
  }
  // Mail play and Just Drive: no call-ins, and calls.json is never asked for.
  asked.length = 0;
  await page(false, 'mode=mail'); await sleep(3000);
  assert.equal(await read('window.mmm.partyLine ?? null'), null); assert.deepEqual(asked, [], 'mail play never asks for calls');
  await page(false, 'site=just&mode=fired', 'localhost'); await sleep(3000);
  assert.equal(await read('window.mmm.partyLine ?? null'), null); assert.deepEqual(asked, [], 'Just Drive never asks for calls');
  console.log('PASS mail play and Just Drive: no call-ins, no calls.json request');
  assert.deepEqual(errors, [], 'runtime exceptions');
} finally {
  c.close(); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {});
}
