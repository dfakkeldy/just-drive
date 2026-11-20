// Just Listen without a browser: the built page (it is light, it names no game file, it carries the credits and the
// links), the one clock both radios read, the links to the page, and the service worker's rule that the page and its
// songs belong to the network. tools/check-listen.sh plays the page in a real browser.
// Usage: node tools/listen-check.mjs [--mutations]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { harness, source as worker } from './pwa-harness.mjs';
import { parseHeaders, headersFor } from './pwa-headers.mjs';
process.on('uncaughtException', e => { console.error(e.name + ': ' + e.message); process.exit(1); });

const bundle = async (contents) => {
  const { outputFiles } = await build({ stdin: { contents, resolveDir: process.cwd() + '/web/src', loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
  return import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));
};
const ENGINE = "export * from './credits'; export { PUBLIC_MUSIC_CREDIT } from './radio-credits.generated'; export { RadioPlayer, clockAt, readRadio } from './radio-player';";
const { ABOUT_URL, COFFEE_URL, COFFEE_TEXT, LISTEN_URL, LISTEN_TEXT, PUBLIC_MUSIC_CREDIT, RadioPlayer, clockAt, readRadio } = await bundle(ENGINE);
const text = html => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// ---- The built page ----
const out = mkdtempSync(join(tmpdir(), 'mmm-listen-'));
try {
  // Without the site's icons there is no page: a lock screen would show a broken picture.
  assert.throws(() => execFileSync('node', ['tools/listen-page.mjs', out], { stdio: 'pipe' }), e => e.status === 1 && String(e.stderr).includes('no icons yet'));
  assert.ok(!existsSync(out + '/listen'), 'a refused build writes nothing');
  mkdirSync(out + '/offline/icons', { recursive: true });
  for (const size of [180, 192, 512]) writeFileSync(`${out}/offline/icons/icon-${size}.png`, 'picture ' + size);
  execFileSync('node', ['tools/listen-page.mjs', out], { stdio: 'pipe' });
  const html = readFileSync(out + '/listen/index.html', 'utf8'), words = text(html);
  for (const size of [180, 192, 512]) assert.equal(readFileSync(`${out}/listen/icon-${size}.png`, 'utf8'), 'picture ' + size, 'the lock-screen pictures are the site icons');

  // One request paints it: no outside style, script, font or picture, and nothing of the game.
  assert.ok(Buffer.byteLength(html) < 48 * 1024, `the page is light (${Buffer.byteLength(html)} bytes; the limit is 48 kB)`);
  assert.equal([...html.matchAll(/<script\b/g)].length, 1, 'one script, inside the page');
  assert.doesNotMatch(html, /<script[^>]+\bsrc=|<link[^>]+rel="stylesheet"|@import|url\(/, 'no outside script, style or font');
  assert.doesNotMatch(html, /app\.js|terrain|manifest\.json|three|WebGL|serviceWorker|\.glb|\/areas\//i, 'nothing of the game or its land');
  assert.doesNotMatch(html, /rel="manifest"/, 'the page is no installable app of its own');
  assert.equal([...html.matchAll(/<title>/g)].length, 1);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.ok(html.includes(`<link rel="canonical" href="${LISTEN_URL.mail}">`));

  // One catalogue: the page asks for the car radio's lists, in the car radio's folder, and holds no station of its own.
  assert.match(html, /"\.\.\/audio"/, 'the songs are in the site audio folder');
  assert.match(html, /radio\.json/); assert.doesNotMatch(html, /radio-just\.json/, 'one list on both hosts: the page is the same page');
  const plan = JSON.parse(readFileSync('tools/radio_stations.json', 'utf8'));
  for (const station of plan.stations) {
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], rest = html.replace(script, '').replace(/<p id="listenMusic">[\s\S]*?<\/p>/, '');
    assert.ok(!script.includes(station.name), `no station name in the script (${station.name})`);
    assert.ok(!rest.includes(station.name) && !new RegExp(`(^|[^0-9.])${station.dial.replace('.', '\\.')}([^0-9]|$)`).test(text(rest)), `no station in the page text (${station.dial} ${station.name})`);
    for (const track of station.tracks) assert.ok(!html.includes(track.source + '.mp3') && !script.includes(JSON.stringify(track.title)), `no song in the page (${track.source})`);
  }
  assert.match(html, /"mmm\.radio\.listen"/, 'its own saved station');

  // The credits card is the public one, word for word; the coffee link; the two games.
  assert.ok(html.includes(PUBLIC_MUSIC_CREDIT.replace(' id="titleMusic"', ' id="listenMusic"')), 'the public music credit, word for word');
  assert.equal(html.split(`<a id="coffee" href="${COFFEE_URL}" rel="noopener">${COFFEE_TEXT}</a>`).length, 2, 'the coffee link, once');
  assert.ok(html.includes('href="https://mmm.fakkeldy.ca/"') && html.includes('href="https://justdrive.fakkeldy.ca/mabou"'), 'links to both games');
  assert.ok(html.includes(`href="${ABOUT_URL.mail}"`), 'a link to About');
  // The owner's standing rules for words on the site.
  assert.doesNotMatch(words, /Canada Post|postal service|post office|Honda|CR-V/i);
  // The parts the script fills must be there.
  for (const id of ['unit', 'dial', 'name', 'state', 'title', 'next', 'bar', 'timeNow', 'timeAll', 'band', 'needle', 'down', 'play', 'up', 'presets', 'volumeRow', 'volume', 'live', 'programme', 'programmeName'])
    assert.equal(html.split(`id="${id}"`).length, 2, `one #${id}`);
  // Small text reads at 4.5:1 or better on the lightest ground it stands on (the dim amber is for marks and lines only).
  const colour = name => html.match(new RegExp(`--${name}:(#[0-9a-f]{6})`))[1];
  const light = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const [hi, lo] = [light(a), light(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  for (const [name, ground] of [['amber-low', '#1c1407'], ['amber-soft', '#1c1407'], ['amber', '#1c1407'], ['quiet', '#1d2228'], ['dim', '#2a3038'], ['ink', '#2a3038']])
    assert.ok(contrast(colour(name), ground) >= 4.5, `--${name} reads on ${ground} (${contrast(colour(name), ground).toFixed(2)}:1)`);
  for (const rule of html.match(/<style>([\s\S]*?)<\/style>/)[1].split('}')) if (/color:var\(--amber-dim\)/.test(rule.replace(/border-color:var\(--amber-dim\)/g, ''))) assert.fail('text in the dim amber: ' + rule.trim().slice(0, 60));
  console.log(`PASS the built page: ${Buffer.byteLength(html)} bytes, one file, no game files, one catalogue, credits, coffee and game links`);
} finally { rmSync(out, { recursive: true, force: true }); }

// ---- One clock ----
{
  const stations = readRadio({ stations: [
    { dial: '88.1', name: 'A', tracks: [{ file: 'a.mp3', title: 'a', seconds: 100 }, { file: 'b.mp3', title: 'b', seconds: 50 }] },
    { dial: '99.9', name: 'B', tracks: [{ file: 'c.mp3', title: 'c', seconds: 300 }, { file: 'short.mp3', title: 'left out', seconds: 5 }] }] });
  assert.equal(stations[1].tracks.length, 1, 'a piece of 5 s or less is left out, as in the car');
  assert.deepEqual(clockAt(stations, 0, 0), { track: 0, at: 0 });
  assert.deepEqual(clockAt(stations, 0, 99_000), { track: 0, at: 99 });
  assert.deepEqual(clockAt(stations, 0, 100_000), { track: 1, at: 0 });
  assert.deepEqual(clockAt(stations, 0, 150_000 * 7 + 120_000), { track: 1, at: 20 }, 'the list comes round');
  assert.deepEqual(clockAt(stations, 1, 0), { track: 0, at: 97 }, 'each station is 97 s from the one before, as in the car');
  const car = readFileSync('web/src/radio.ts', 'utf8'), page = readFileSync('web/src/listen.ts', 'utf8'), engine = readFileSync('web/src/radio-player.ts', 'utf8');
  // The car and the page stand on the one engine; neither has a clock, a loader or a list reader of its own.
  for (const [name, file] of [['radio.ts', car], ['listen.ts', page]]) {
    assert.match(file, /from '\.\/radio-player'/, name + ' uses the engine');
    assert.doesNotMatch(file, /Date\.now\(\)|new Audio\(|createObjectURL|\.arrayBuffer\(\)|SPREAD/, name + ' has no clock or loader of its own');
  }
  assert.match(car, /class Radio extends RadioPlayer/); assert.match(page, /class ListenRadio extends RadioPlayer/);
  assert.equal(engine.split('Date.now()').length, 2, 'one place reads the wall clock');
  assert.match(engine, /protected live\(\): \{ track: number; at: number \} \{ return clockAt\(this\.stations, this\.station\); \}/);
  // The car's radio still stops when its page is hidden; only the page plays on.
  assert.match(car, /document\.addEventListener\('visibilitychange', \(\) => this\.hold\(\)\)/);
  assert.doesNotMatch(car, /this\.background = true/); assert.match(page, /this\.background = true/);
  assert.match(engine, /protected background = false;/);
  console.log('PASS one clock: both radios stand on radio-player.ts; the car still stops when hidden, the page plays on');
}

// ---- A join in a song's last second ----
// The engine with a stand-in player. The clock is put in the last second of a song; the file is as long as the list
// says. The station must stay on its clock (the next song starts). Only a file that is really shorter than the list
// says takes the station off its clock.
async function lastSecond(Player, fileSeconds) {
  const saved = Object.fromEntries(['Audio', 'document', 'localStorage', 'fetch'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  try {
    globalThis.Audio = class { constructor() { this.heard = {}; this.paused = true; this.src = ''; this.currentTime = 0; this.duration = NaN; }
      addEventListener(type, run) { (this.heard[type] ??= []).push(run); } emit(type) { for (const run of this.heard[type] ?? []) run(); }
      play() { this.paused = false; return Promise.resolve(); } pause() { this.paused = true; } };
    globalThis.document = { hidden: false };
    globalThis.localStorage = { getItem: () => null, setItem() {} };
    globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    const stations = [{ dial: '88.1', name: 'A', tracks: [{ file: 'a.mp3', title: 'a', seconds: 100 }, { file: 'b.mp3', title: 'b', seconds: 50 }] }];
    const radio = new Player(stations, '/audio', '88.1', 'test.radio');
    radio.live = () => ({ track: 0, at: 99.6 });
    const settle = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
    radio.start(); await settle();
    const first = radio.audio.src;
    radio.audio.duration = fileSeconds; radio.audio.emit('loadedmetadata'); await settle();
    return { plain: radio.plain.has(0), track: radio.track, moved: radio.audio.src !== first, seek: radio.audio.currentTime };
  } finally { for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
}
{
  assert.deepEqual(await lastSecond(RadioPlayer, 100), { plain: false, track: 1, moved: true, seek: 0 }, 'a join in the last second starts the next song and keeps the clock');
  assert.deepEqual(await lastSecond(RadioPlayer, 60), { plain: true, track: 0, moved: false, seek: 0 }, 'a file shorter than the list says still plays in order');
  console.log('PASS a join in a song\'s last second keeps the station on its clock; a wrong list length still plays in order');
}

// ---- A song that does not arrive ----
// Offline, only the songs the download saved arrive, and the clock is mostly on one it did not save. The engine must
// try the next songs at once, round the whole station, and play a saved one. A station with no saved song at all is
// tried once round, and then only every few seconds (no tight loop).
async function missingSongs(Player, saved) {
  const keep = Object.fromEntries(['Audio', 'document', 'localStorage', 'fetch'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  let radio;
  try {
    globalThis.Audio = class { constructor() { this.paused = true; this.src = ''; this.currentTime = 0; } addEventListener() {}
      play() { this.paused = false; return Promise.resolve(); } pause() { this.paused = true; } };
    globalThis.document = { hidden: false };
    globalThis.localStorage = { getItem: () => null, setItem() {} };
    const asked = [];
    globalThis.fetch = async (url) => {
      asked.push(url.slice('/audio/'.length));
      await new Promise(r => setTimeout(r, 0));   // an answer comes later, as from a network or a worker
      if (!saved.includes(url.slice('/audio/'.length))) throw new TypeError('Failed to fetch');
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    };
    const tracks = ['a', 'b', 'c', 'd', 'e'].map(name => ({ file: name + '.mp3', title: name, seconds: 60 }));
    radio = new Player([{ dial: '88.1', name: 'A', tracks }], '/audio', '88.1', 'test.radio');
    radio.live = () => ({ track: 2, at: 10 });   // the clock is on c.mp3
    radio.start();
    for (let n = 0; n < 20; n++) await new Promise(r => setTimeout(r, 0));   // well inside the few seconds of a slow retry
    return { track: radio.track, playing: radio.mine(), asked };
  } finally {
    if (radio) radio.station = -1;   // a retry that is still waiting does nothing
    for (const [key, descriptor] of Object.entries(keep)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
}
{
  assert.deepEqual(await missingSongs(RadioPlayer, ['b.mp3']), { track: 1, playing: true, asked: ['c.mp3', 'd.mp3', 'e.mp3', 'a.mp3', 'b.mp3'] },
    'a clock on a song that is not saved goes on at once, round the station, to the saved song');
  assert.deepEqual(await missingSongs(RadioPlayer, []), { track: 1, playing: false, asked: ['c.mp3', 'd.mp3', 'e.mp3', 'a.mp3', 'b.mp3'] },
    'a station with no song that arrives is tried once round, then waits');
  console.log('PASS a song that does not arrive: the radio goes on at once to a saved song, and tries a station with none only once round');
}

// ---- The links to the page ----
{
  const title = readFileSync('web/src/title.ts', 'utf8');
  assert.ok(title.includes(`<a id="titleListen" href="\${LISTEN_URL[just ? 'just' : 'mail']}" target="_blank" rel="noopener">\${LISTEN_TEXT}</a>`), 'the title card links the page of its own host');
  assert.deepEqual(LISTEN_URL, { mail: 'https://mmm.fakkeldy.ca/listen/', just: 'https://justdrive.fakkeldy.ca/listen/' });
  const { aboutPage } = await import('./about-pages.mjs');
  for (const brand of ['mail', 'just']) {
    const html = aboutPage(brand);
    assert.equal(html.split(`<a id="listen" href="${LISTEN_URL[brand]}">${LISTEN_TEXT}</a>`).length, 2, brand + ' About links the page, once in its text');
    assert.ok(html.includes(`<a href="${LISTEN_URL[brand]}">Just Listen</a>`), brand + ' About footer links the page');
  }
  const rules = parseHeaders(readFileSync('deploy/_headers', 'utf8'));
  assert.deepEqual(Object.fromEntries(headersFor(rules, new URL('https://mmm.fakkeldy.ca/listen/'))), { 'cache-control': 'no-cache' }, 'a new page reaches a listener at the next visit');
  const site = readFileSync('tools/build_site.sh', 'utf8');
  assert.ok(site.indexOf('tools/build-pwa.mjs') < site.indexOf('tools/listen-page.mjs'), 'the offline list of files is made before the page exists');
  assert.doesNotMatch(readFileSync('tools/build-pwa.mjs', 'utf8'), /listen/, 'the offline download knows nothing of the page');
  console.log('PASS links: the title card and both About pages; the header rule; the page is outside the offline download');
}

// ---- The service worker ----
// A game that is saved for offline play has a worker that answers for /audio/. The page is not the game: its songs
// must come from the network, and nothing of it may be saved. The worker knows the page by its client address. A
// referrer is no proof (a script can set one), and a game page keeps its version binding whatever referrer it sends.
async function workerCase(code) {
  const h = await harness(code);
  h.build('A');
  await h.message('prepare', 'game'); await h.flush();   // a bound game page, so the worker has a saved version
  h.routes.set('/audio/radio.json', new Response('{"stations":[]}'));
  h.live.set('listener', 'https://game.test/listen/');
  h.live.set('stranger', 'https://game.test/');
  const page = 'https://game.test/listen/';
  // The harness passes plain request objects; give the worker exactly the fields it reads.
  const event = (path, referrer, mode = 'cors', id = 'listener') => {
    let answered;
    h.listeners.fetch({ request: new Proxy(new Request('https://game.test' + path), { get: (r, key) => key === 'mode' ? mode : key === 'referrer' ? referrer : typeof r[key] === 'function' ? r[key].bind(r) : r[key] }),
      clientId: mode === 'navigate' ? '' : id, resultingClientId: mode === 'navigate' ? id : '',
      respondWith: p => { answered = Promise.resolve(p); answered.catch(() => { /* a mutant's answer may fail; the case reads it */ }); }, waitUntil: p => h.waitUntil(p) });
    return answered;
  };
  const status = async answered => answered === undefined ? 'untouched' : (await answered.then(r => r.status, () => 'failed'));
  const before = h.requests.length;
  const got = {
    // The worker never answers for the page or its pictures.
    navigation: await status(event('/listen/', '', 'navigate')), bare: await status(event('/listen', '', 'navigate')), picture: await status(event('/listen/icon-512.png', page)),
    // The page's list and songs: answered from the network.
    list: await status(event('/audio/radio.json', page)), song: await status(event('/audio/song.mp3', page)),
    // A page that is not the game and is not Just Listen gets no song, also when it sends the page's referrer.
    stranger: await status(event('/audio/song.mp3', 'https://game.test/', 'cors', 'stranger')),
    forged: await status(event('/audio/song.mp3', page, 'cors', 'stranger')),
    forgedLand: await status(event('/terrain/tile.bin', page, 'cors', 'stranger')),
    // A link from the page to the game on the same host is a game navigation as any other: the saved game answers.
    toGame: await status(event('/', page, 'navigate', 'visitor')),
  };
  await h.flush();
  got.network = h.requests.slice(before).filter(path => path.startsWith('/audio/'));
  got.saved = [...h.bins].flatMap(([name, bin]) => [...bin.keys()].filter(key => key.startsWith('/listen') || key === '/audio/radio.json').map(key => name + key));
  return got;
}
{
  const got = await workerCase(worker);
  assert.deepEqual([got.navigation, got.bare, got.picture], ['untouched', 'untouched', 'untouched'], 'the worker leaves the page and its pictures to the network');
  assert.deepEqual([got.list, got.song], [200, 200], 'the page gets its list and its songs');
  assert.deepEqual(got.network, ['/audio/radio.json', '/audio/song.mp3'], 'from the network, each asked for once');
  assert.deepEqual([got.stranger, got.forged, got.forgedLand], [409, 409, 409], 'a page that is not the game gets no game data, whatever referrer it sends');
  assert.equal(got.toGame, 200, 'a link from the page to the game opens the saved game');
  assert.deepEqual(got.saved, [], 'nothing of the page is saved');
  console.log('PASS service worker: the page and its pictures are untouched; its list and songs come from the network; a referrer opens nothing; nothing is saved');
}

if (process.argv.includes('--mutations')) {
  const mutants = [
    ['the client address rule', "(listenPath(new URL(client.url).pathname) || !mabouURL(new URL(client.url)))", '!mabouURL(new URL(client.url))', got => got.song === 200 && got.list === 200],
    // A worker that trusts the referrer (the first form of this rule) lets any page past the game's version binding.
    ['distrust of the referrer', "  if(JUST && r.mode==='navigate' && gameNavigation(url) && url.pathname!=='/' && url.pathname.endsWith('/'))", "  if(r.referrer && listenPath(new URL(r.referrer).pathname)) return;\n  if(JUST && r.mode==='navigate' && gameNavigation(url) && url.pathname!=='/' && url.pathname.endsWith('/'))", got => got.forged === 409 && got.forgedLand === 409 && got.toGame === 200],
  ];
  for (const [name, from, to, holds] of mutants) {
    assert.ok(worker.includes(from), 'mutation anchor: ' + name);
    const got = await workerCase(worker.replace(from, to));
    assert.equal(holds(got), false, `the check must fail without ${name}`);
  }
  console.log(`PASS ${mutants.length} service worker mutants rejected`);
  // The engine without its last-second rule: the station leaves its clock, as it did before.
  const engine = readFileSync('web/src/radio-player.ts', 'utf8'), anchor = "?.seconds ?? 0)) < 1.5) {";
  assert.ok(engine.includes(anchor), 'mutation anchor: the last-second rule');
  const { outputFiles } = await build({ stdin: { contents: ENGINE, resolveDir: process.cwd() + '/web/src', loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{ name: 'last-second-mutant', setup(b) { b.onLoad({ filter: /radio-player\.ts$/ }, () => ({ contents: engine.replace(anchor, "?.seconds ?? 0)) < 0) {"), loader: 'ts' })); } }] });
  const old = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));
  assert.deepEqual(await lastSecond(old.RadioPlayer, 100), { plain: true, track: 0, moved: false, seek: 0 }, 'the check must fail without the last-second rule');
  console.log('PASS the last-second mutant is rejected');
  // The engine as it was: a song that did not arrive was followed by one try every few seconds.
  const missedAnchor = 'if (++this.missed < tracks.length) this.tune(this.track + 1, 0); else this.skipSoon(ticket);';
  assert.ok(engine.includes(missedAnchor), 'mutation anchor: the turn of tries');
  const slow = await build({ stdin: { contents: ENGINE, resolveDir: process.cwd() + '/web/src', loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{ name: 'slow-skip-mutant', setup(b) { b.onLoad({ filter: /radio-player\.ts$/ }, () => ({ contents: engine.replace(missedAnchor, 'this.skipSoon(ticket);'), loader: 'ts' })); } }] });
  const slowEngine = await import('data:text/javascript;base64,' + Buffer.from(slow.outputFiles[0].text).toString('base64'));
  assert.notDeepEqual(await missingSongs(slowEngine.RadioPlayer, ['b.mp3']), { track: 1, playing: true, asked: ['c.mp3', 'd.mp3', 'e.mp3', 'a.mp3', 'b.mp3'] }, 'the check must fail with one try every few seconds');
  // Without a limit, a station with no song that arrives would be asked round and round without a pause.
  const endless = await build({ stdin: { contents: ENGINE, resolveDir: process.cwd() + '/web/src', loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{ name: 'endless-turn-mutant', setup(b) { b.onLoad({ filter: /radio-player\.ts$/ }, () => ({ contents: engine.replace(missedAnchor, 'this.tune(this.track + 1, 0);'), loader: 'ts' })); } }] });
  const endlessEngine = await import('data:text/javascript;base64,' + Buffer.from(endless.outputFiles[0].text).toString('base64'));
  assert.notDeepEqual(await missingSongs(endlessEngine.RadioPlayer, []), { track: 1, playing: false, asked: ['c.mp3', 'd.mp3', 'e.mp3', 'a.mp3', 'b.mp3'] }, 'the check must fail when the tries never stop');
  console.log('PASS the slow-skip and endless-turn mutants are rejected');
}
