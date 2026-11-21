#!/usr/bin/env node
// Just Listen in headless Chromium, as a phone sees it: the page loads without the game, a tap starts a station in the
// middle of its piece, the dial moves, the credits show, the programme list and LIVE work, the page plays on when it
// is hidden, the layout fits every phone size upright and sideways, and a saved game's service worker lets it through.
// Usage (the site folder, its server and Chromium come from tools/check-listen.sh):
//   LISTEN_ORIGIN=http://127.0.0.1:<port> CDP_PORT=<port> node tools/listen-browser.mjs <out folder>
// The exit code is the verdict.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cdp, cdpFetch, exitCheck, sleep } from './cdp.mjs';

const [outDir] = process.argv.slice(2);
const ORIGIN = process.env.LISTEN_ORIGIN, PORT = process.env.CDP_PORT ?? '9333';
// The check's server has no folder index; the public host serves this same file at /listen/.
const PAGE = `${ORIGIN}/listen/index.html`;
const tab = await (await cdpFetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const requests = [];
const { ws, send } = await cdp(tab.webSocketDebuggerUrl, { onEvent: m => { if (m.method === 'Network.requestWillBeSent' && m.params.request.url.startsWith(ORIGIN + '/')) requests.push(new URL(m.params.request.url).pathname); } });
const read = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const fails = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); return ok; };
const until = async (expression, what, ms = 30000) => {
  for (const end = Date.now() + ms; Date.now() < end;) { if (await read(expression)) return true; await sleep(100); }
  return check(false, `in time: ${what}`);
};
// A few pictures are kept after a pass too (check-all keeps $MMM_CHECK_OUT/evidence/<row>/); the rest only after a failure.
const KEPT = process.env.MMM_CHECK_OUT ? `${process.env.MMM_CHECK_OUT}/evidence/listen-browser` : outDir;
mkdirSync(KEPT, { recursive: true });
const shot = async (name, keep = false) => writeFileSync(`${keep ? KEPT : outDir}/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
/** A finger's tap in the middle of an element (scrolled into view first). */
const tap = async (selector) => {
  const at = await read(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  if (!at) { check(false, `there is a ${selector} to tap`); return; }
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
const phone = async (width, height) => {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true, screenOrientation: width > height ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
};

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Page.bringToFront');
// The page's one player, for the check to read. The clock below is the check's own: the page must agree with it.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__ready = null; { const watch = setInterval(() => { if (document.documentElement?.dataset.listen === 'ready') { window.__ready = performance.now(); clearInterval(watch); } }, 10); }
  window.__audio = []; { const Real = window.Audio; window.Audio = function (...a) { const x = new Real(...a); window.__audio.push(x); return x; }; window.Audio.prototype = Real.prototype; }
  window.__clock = (stations, i) => { const t = stations[i].tracks, total = t.reduce((s, x) => s + x.seconds, 0); let at = (Date.now() / 1000 + i * 97) % total, k = 0; while (k < t.length - 1 && at >= t[k].seconds) at -= t[k++].seconds; return { track: k, at }; };
  window.__list = fetch('/audio/radio.json').then(r => r.json()).then(j => ({ start: j.start, stations: j.stations.map(s => ({ ...s, tracks: s.tracks.filter(t => t.seconds > 5) })).filter(s => s.tracks.length) }));
  window.__state = async () => { const l = await window.__list, a = window.__audio[0], dial = document.getElementById('dial').textContent, i = l.stations.findIndex(s => s.dial === dial);
    return { dial, i, name: document.getElementById('name').textContent, title: document.getElementById('title').textContent, next: document.getElementById('next').textContent, state: document.getElementById('state').textContent,
      unit: document.getElementById('unit').dataset.state, live: document.getElementById('live').getAttribute('aria-pressed'), clock: i < 0 ? null : window.__clock(l.stations, i), tracks: i < 0 ? [] : l.stations[i].tracks.map(t => t.title),
      song: a ? { blob: a.src.startsWith('blob:'), time: a.currentTime, length: a.duration || 0, paused: a.paused, ready: a.readyState } : null, saved: localStorage.getItem('mmm.radio.listen') }; };
` });
await phone(390, 844);
await send('Page.navigate', { url: PAGE });
await until(`document.documentElement.dataset.listen === 'ready'`, 'the page is ready');
const list = await read('window.__list');
const state = () => read('window.__state()');
/** Sound is out and the page says so. */
const sounding = (what) => until(`(() => { const a = window.__audio[0]; return !!a && a.src.startsWith('blob:') && a.readyState >= 3 && !a.paused && a.currentTime > 0 && document.getElementById('unit').dataset.state === 'sound'; })()`, what);
/** The page shows the piece that the station's clock is on, and the song stands at the clock's second. */
const onClock = async (what) => {
  let s;
  for (let n = 0; n < 12; n++) {
    s = await state();
    if (s.clock && s.tracks[s.clock.track] === s.title && s.song && Math.abs(s.song.time - s.clock.at) < 3) break;
    await sleep(500);   // the clock may be at the very end of a piece
  }
  check(!!s.clock && s.tracks[s.clock.track] === s.title, `${what}: the title is the clock's piece (${s.title})`);
  check(!!s.song && Math.abs(s.song.time - s.clock.at) < 3, `${what}: the song stands at the clock's second (song ${s.song?.time.toFixed(1)} s, clock ${s.clock?.at.toFixed(1)} s)`);
  return s;
};

// ---- It loads, light and without the game ----
// The whole page is one file, so it can be painted as soon as that file is read ("interactive"). A headless browser
// gives no paint time of its own; when one is there it is printed.
const timing = await read(`(() => { const n = performance.getEntriesByType('navigation')[0]; return { read: n.domInteractive, bytes: n.transferSize, ready: window.__ready, paint: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null }; })()`);
check(timing.read > 0 && timing.read < 1000 && timing.ready < 1500, `the page is read in ${Math.round(timing.read)} ms and has its stations in ${Math.round(timing.ready)} ms on this machine (limits 1000 and 1500 ms${timing.paint === null ? '' : `; first paint ${Math.round(timing.paint)} ms`})`);
check(requests.filter(p => !p.startsWith('/audio/')).join() === '/listen/index.html', 'the page is one request; only the station list follows');
let first = await state();
for (let n = 0; n < 6 && !(first.clock && first.tracks[first.clock.track] === first.title); n++) { await sleep(500); first = await state(); }   // the page draws the clock once a second
check(list.stations.length > 1 && first.dial === (list.start ?? list.stations[0].dial), `a new listener is on the list's starting station (${first.dial} ${first.name})`);
check(first.i >= 0 && first.name === list.stations[first.i].name, 'the station name is the list\'s');
check(!!first.clock && first.tracks[first.clock.track] === first.title && first.state === 'Press ▶ to listen', `before any tap the page names the clock piece and asks for Play (${first.title})`);
check(first.next === first.tracks[(first.clock.track + 1) % first.tracks.length], 'and the piece that comes next');
check(await read(`document.querySelectorAll('#presets .preset').length`) === list.stations.length, `one key for each station (${list.stations.length})`);
check(await read(`[...document.querySelectorAll('#presets .preset')].map(k => k.querySelector('b').textContent + ' ' + k.querySelector('span').textContent).join('|')`) === list.stations.map(s => `${s.dial} ${s.name}`).join('|'), 'each key shows its dial and its name, in the list\'s order');
check(!requests.some(p => /\/(terrain|models|areas)\/|app\.js|\/version|manifest/.test(p)), 'no land, no model, no game script was asked for');
check(!requests.some(p => p.endsWith('.mp3')), 'no song is downloaded before the listener asks');
check(await read(`!window.__audio[0] || window.__audio[0].paused`), 'and nothing plays by itself');
const generated = readFileSync(new URL('../web/src/radio-credits.generated.ts', import.meta.url), 'utf8').match(/export const PUBLIC_MUSIC_CREDIT = (".*");/)[1];
const credit = JSON.parse(generated).replace(/<[^>]+>/g, '');
check(await read(`(() => { const p = document.getElementById('listenMusic'), b = p.getBoundingClientRect(); return p.textContent === ${JSON.stringify(credit)} && b.width > 100 && b.height > 20 && getComputedStyle(p).visibility === 'visible'; })()`), 'the credits card shows the public music credit, word for word');
check(await read(`document.getElementById('coffee').href === 'https://ko-fi.com/fakkeldy' && document.getElementById('coffee').textContent === 'Buy the developer a coffee'`), 'the coffee link');
check(await read(`['https://mmm.fakkeldy.ca/', 'https://justdrive.fakkeldy.ca/mabou'].every(h => [...document.querySelectorAll('a.way')].some(a => a.href === h))`), 'links to Mail Madness and to Just Drive');
check(await read(`document.getElementById('volumeRow').hidden === matchMedia('(pointer: coarse)').matches`), 'a phone has no volume slider (its own buttons set the volume)');

const stillBar=await read(`document.getElementById('bar').getBoundingClientRect().width`);
await sleep(2100);
check(await read(`document.getElementById('state').textContent !== 'ON THE AIR NOW' && document.getElementById('bar').getBoundingClientRect().width === ${stillBar}`),'before first Play the prompt is honest and progress stays still for two seconds');

// ---- A station plays, from the middle ----
await tap('#play');
await sounding('a tap on play starts the station');
const playing = await onClock('first station');
check(!!playing.song?.blob, 'the song plays from memory (the host cannot send part of a file)');
check(playing.state === 'NOW PLAYING' && playing.live === 'true', 'the page says NOW PLAYING, and its LIVE lamp is lit');
// The song goes on. (When a piece ends in these two seconds, the next piece is on instead, and that is right too.)
const movedOn = (was, now) => !now.song.paused && (now.song.time > was.song.time + 1 || now.title !== was.title);
await sleep(2000);
check(movedOn(playing, await state()), 'the song moves on');
check(requests.filter(p => p === '/audio/radio.json').length === 2, 'the page asked for the one list once (the check asked once too)');
const media = await read(`(() => { const m = navigator.mediaSession.metadata; return m ? { title: m.title, artist: m.artist, album: m.album, art: m.artwork.map(a => a.src), state: navigator.mediaSession.playbackState } : null; })()`);
check(!!media && media.title === (await state()).title && media.artist === `${playing.dial} ${playing.name}` && media.album === 'Just Listen' && media.state === 'playing', `the lock screen is told the title and the station (${media?.artist}: ${media?.title})`);
check(!!media && media.art.length === 2 && await read(`Promise.all(${JSON.stringify(media?.art ?? [])}.map(u => fetch(u).then(r => r.ok && r.headers.get('content-type') === 'image/png'))).then(a => a.every(Boolean))`), 'and gets its pictures');
await shot('listen-playing', true);

// ---- The dial moves ----
await tap('#up');
await until(`document.getElementById('dial').textContent !== ${JSON.stringify(playing.dial)}`, 'the dial moves');
await sounding('the next station sounds');
const second = await onClock('station up');
check(second.i === (playing.i + 1) % list.stations.length && second.saved === second.dial, `station up is the next on the dial, and it is kept (${second.dial} ${second.name})`);
check(await read(`[...document.querySelectorAll('#presets .preset')].map(k => k.getAttribute('aria-pressed')).join() === ${JSON.stringify(list.stations.map((_, i) => String(i === second.i)).join())}`), 'its key is lit');
check(await read(`document.title`) === `${second.dial} ${second.name} · Just Listen`, 'the tab names the station');
await tap('#down'); await tap('#down');
await until(`document.getElementById('dial').textContent === ${JSON.stringify(list.stations.at(playing.i - 1).dial)}`, 'station down twice, round the end of the dial');
// The busiest station, for the list and the end of a piece.
const busy = list.stations.reduce((best, s, i) => s.tracks.length > list.stations[best].tracks.length ? i : best, 0);
await tap(`#presets .preset:nth-child(${busy + 1})`);
await until(`document.getElementById('dial').textContent === ${JSON.stringify(list.stations[busy].dial)}`, 'a station key tunes to its station');
await sounding('that station sounds');
await onClock('station key');
// A tap on the scale goes to the nearest station.
await read(`(() => { const b = document.getElementById('band'); b.scrollIntoView({ block: 'center' }); const box = b.getBoundingClientRect(), mark = b.querySelectorAll('.mark')[0].getBoundingClientRect(); b.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: mark.left + 4, clientY: box.top + 10 })); })()`);
await until(`document.getElementById('dial').textContent === ${JSON.stringify(list.stations[0].dial)}`, 'a tap on the scale tunes to the nearest station');
await tap(`#presets .preset:nth-child(${busy + 1})`);
await sounding('back on the busiest station');

// ---- Pause and play ----
await tap('#play');
await until(`window.__audio[0].paused && document.getElementById('unit').dataset.state === 'silent' && navigator.mediaSession.playbackState === 'paused'`, 'play again pauses the radio');
await tap('#play');
await sounding('and plays it again');
const again = await onClock('after a pause');

// ---- The page plays on when it is hidden; the car radio does not ----
await read(`(() => { for (const [k, v] of [['hidden', true], ['visibilityState', 'hidden']]) Object.defineProperty(document, k, { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')); })()`);
await sleep(1500);
check(movedOn(again, await state()), 'a hidden page (a locked phone) plays on');
// The end of a piece, hidden: the next one is already in memory, so no download stands between the two.
// The clock's own place in the list, not the first piece of that name: the busiest station plays some ads twice.
// At the join of two pieces the page's title can be a moment behind the clock, so the read waits until they agree.
let before = await state();
for (const end = Date.now() + 8000; Date.now() < end && before.tracks[before.clock?.track] !== before.title;) { await sleep(200); before = await state(); }
check(before.tracks[before.clock?.track] === before.title, 'hidden: the title is the clock\'s piece');
const k = before.clock.track, nextFile = list.stations[busy].tracks[(k + 1) % before.tracks.length].file;
for (const end = Date.now() + 15000; Date.now() < end && !requests.includes('/audio/' + nextFile);) await sleep(100);
check(requests.includes('/audio/' + nextFile), `the next piece is fetched while this one plays (${nextFile})`);
const asked = requests.filter(p => p.endsWith('.mp3')).length;
await read(`(() => { const a = window.__audio[0]; a.currentTime = Math.max(0, a.duration - 1.5); })()`);
await until(`document.getElementById('title').textContent === ${JSON.stringify(before.tracks[(k + 1) % before.tracks.length])} && !window.__audio[0].paused && window.__audio[0].currentTime > 0 && window.__audio[0].currentTime < 8`, 'at the end of a piece the next one starts');
check(requests.filter(p => p.endsWith('.mp3')).length <= asked + 1, 'with no download between the two (the one after is fetched ahead)');
check(await read(`navigator.mediaSession.metadata.title`) === before.tracks[(k + 1) % before.tracks.length], 'and the lock screen gets the new title');
// A change of station from the lock screen: the old song goes on until the new one has arrived.
const hiddenDial = (await state()).dial;
await read(`document.getElementById('up').click()`);
check(await read(`!window.__audio[0].paused`), 'a station change on a hidden page leaves no silence');
await until(`document.getElementById('dial').textContent !== ${JSON.stringify(hiddenDial)}`, 'the dial moves while hidden');
await sounding('the new station sounds while hidden');
await read(`(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); })()`);
await onClock('after the hidden station change');

// ---- The programme list and LIVE ----
await tap(`#presets .preset:nth-child(${busy + 1})`);
await sounding('the busiest station again');
const live = await onClock('before the list');
await tap('details.card summary');
check(await read(`document.querySelector('details.card').open && document.querySelectorAll('#programme button').length === ${list.stations[busy].tracks.length}`), `the programme lists every piece of the station (${list.stations[busy].tracks.length})`);
check(await read(`document.getElementById('programmeName').textContent`) === `${list.stations[busy].dial} ${list.stations[busy].name}`, 'under the station\'s name');
const chosen = (live.clock.track + 2) % live.tracks.length;
await tap(`#programme li:nth-child(${chosen + 1}) button`);
await until(`document.getElementById('title').textContent === ${JSON.stringify(live.tracks[chosen])} && document.getElementById('live').getAttribute('aria-pressed') === 'false'`, 'a tap on a piece chooses it');
await sounding('the chosen piece sounds');
const picked = await state();
check(picked.song.time < 5 && picked.state === 'FROM THE START', `the chosen piece plays from its start (${picked.song.time.toFixed(1)} s)`);
check(await read(`document.querySelector('#programme [aria-current]')?.querySelector('span').textContent`) === live.tracks[chosen], 'the list marks it');
// A chosen piece that is paused keeps its place, on the page and in the player.
await until(`window.__audio[0].currentTime > 2.2 || document.getElementById('title').textContent !== ${JSON.stringify(live.tracks[chosen])}`, 'the chosen piece plays for two seconds');
if ((await state()).title === live.tracks[chosen]) {
  await tap('#play');
  await until(`window.__audio[0].paused && document.getElementById('unit').dataset.state === 'silent'`, 'the chosen piece pauses');
  const paused = await state();
  check(paused.state === 'PAUSED' && paused.song.time > 2 && await read(`document.getElementById('timeNow').textContent`) !== '0:00', `a paused piece shows its own time (${await read(`document.getElementById('timeNow').textContent`)})`);
  await tap('#play');
  await sounding('and plays on from there');
  check((await state()).song.time >= paused.song.time, 'from the second where it stood');
}
await tap('#live');
await until(`document.getElementById('live').getAttribute('aria-pressed') === 'true'`, 'LIVE goes back to the clock');
await sounding('the station sounds on its clock again');
await onClock('after LIVE');

// ---- Every phone size, upright and sideways ----
await read(`document.querySelector('details.card').open = false, scrollTo(0, 0)`);
const SIZES = [[320, 568], [360, 640], [375, 667], [390, 844], [412, 915], [430, 932], [494, 960], [540, 960], [568, 320], [640, 360], [667, 375], [844, 390], [915, 412], [932, 430], [768, 1024], [1280, 800]];
for (const [w, h] of SIZES) {
  await phone(w, h);
  await read(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => { scrollTo(0, 0); r(true); })))`);
  const bad = await read(`(() => {
    const bad = [], W = innerWidth, H = innerHeight, box = e => e.getBoundingClientRect();
    const hs=[...document.querySelectorAll('.preset')].map(e=>box(e).height);
    if (!(W > H && H <= 520) && Math.max(...hs)-Math.min(...hs) > .5) bad.push('preset heights differ by more than 0.5px');
    // The radio is sounding here, so the lit key shows its status. Where the status sits on the frequency line, it must not touch the frequency.
    // Any key can be lit, so test the lit key's status width against every key's frequency, the widest dials included.
    const lit = document.querySelector('.preset[aria-pressed=true]'), st = lit && getComputedStyle(lit, '::after');
    if (st && st.position === 'absolute' && st.content !== 'none') for (const key of document.querySelectorAll('.preset')) { const t = box(key), r = document.createRange(); r.selectNodeContents(key.querySelector('b')); const right = r.getBoundingClientRect().right, left = t.right - parseFloat(st.right) - parseFloat(st.width); if (right > left - 4) bad.push('a lit status would overlap ' + key.querySelector('b').textContent + ' (' + Math.round(right) + ' > ' + Math.round(left - 4) + ')'); }
    if (document.documentElement.scrollWidth > W) bad.push('the page scrolls sideways (' + document.documentElement.scrollWidth + ' > ' + W + ')');
    const all = [...document.querySelectorAll('#unit, #unit *, .card, .way, .foot a')].filter(e => e.getClientRects().length && !e.closest('svg') && getComputedStyle(e).position !== 'absolute');
    for (const e of all) { const b = box(e); if (b.left < -0.5 || b.right > W + 0.5) bad.push((e.id || e.className || e.tagName) + ' leaves the screen sideways'); }
    for (const id of ['dial', 'name', 'title', 'play', 'down', 'up']) { const b = box(document.getElementById(id)); if (b.top < 0 || b.bottom > H + 0.5) bad.push(id + ' is not on the first screen (bottom ' + Math.round(b.bottom) + ' > ' + H + ')'); }
    for (const e of [...document.querySelectorAll('#play, #down, #up, .preset, .way, .foot a, summary')]) { const b = box(e); if (b.width < 44 || b.height < 44) bad.push((e.id || e.className) + ' is smaller than a finger (' + Math.round(b.width) + 'x' + Math.round(b.height) + ')'); }
    for (const e of [...document.querySelectorAll('.preset span, .preset b, #name, #dial, .brand h1, .way')]) if (e.scrollWidth > e.clientWidth + 1) bad.push((e.id || e.className || e.tagName) + ' text is cut (' + e.textContent + ')');
    const keys = [...document.querySelectorAll('.preset, #play, #down, #up')].map(box);
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) if (keys[i].left < keys[j].right - 0.5 && keys[j].left < keys[i].right - 0.5 && keys[i].top < keys[j].bottom - 0.5 && keys[j].top < keys[i].bottom - 0.5) bad.push('two keys overlap');
    const glass = box(document.querySelector('.glass'));
    for (const id of ['dial', 'name', 'title', 'state', 'live', 'next', 'band']) { const b = box(document.getElementById(id)); if (b.left < glass.left - 0.5 || b.right > glass.right + 0.5 || b.bottom > glass.bottom + 0.5) bad.push(id + ' leaves the display'); }
    return bad;
  })()`);
  check(bad.length === 0, `${w}x${h} fits${bad.length ? ': ' + [...new Set(bad)].join('; ') : ''}`);
  await shot(`listen-${w}x${h}`, ['320x568', '390x844', '568x320', '844x390', '1280x800'].includes(`${w}x${h}`));
}
await phone(390, 844);

// ---- A game saved for offline play: its service worker lets the page through ----
await send('Page.navigate', { url: `${ORIGIN}/` });
await until(`!!navigator.serviceWorker.controller`, 'the game\'s service worker controls the site', 20000);
check(await read(`fetch('/audio/radio.json').then(r => r.status)`) === 409, 'the worker refuses the songs to a page that is not the game (so it is really at work)');
requests.length = 0;
await send('Page.navigate', { url: PAGE });
await until(`document.documentElement.dataset.listen === 'ready' && !!navigator.serviceWorker.controller`, 'the page loads under the worker');
await tap('#play');
await sounding('and a station plays under the worker');
await onClock('under the worker');
check(await read(`fetch('icon-512.png').then(r => r.ok)`), 'its pictures come through too');
check(await read(`caches.keys().then(async names => (await Promise.all(names.map(async n => (await (await caches.open(n)).keys()).map(r => new URL(r.url).pathname)))).flat().filter(p => p.startsWith('/audio/') || p.startsWith('/listen')))`).then(a => Array.isArray(a) && a.length === 0), 'and the worker saved no song and nothing of the page');

await cdpFetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`);
ws.close();
console.log(fails.length ? `FAILED: ${fails.length}\n  ${fails.join('\n  ')}` : 'PASS: Just Listen loads light, plays from the clock, moves the dial, shows credits, lists the programme, plays on hidden, fits every size, and passes the service worker.');
exitCheck(fails.length ? 1 : 0);
