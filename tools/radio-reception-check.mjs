// CPU-only check of the car radio's reception by place (web/src/radio-reception.ts): the owner's words about his route
// held against the game's own transmitter table and the baked villages, the table against the station catalogue, the
// shape of a signal, the seeking dial, the sound of a weak station, and the wiring. `--mutations` proves each guard bites.
// node tools/run-node-check.mjs tools/radio-reception-check.mjs [--mutations]
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import * as rules from '../web/src/radio-reception.ts';
import { Radio } from '../web/src/radio.ts';
import { startKey } from '../web/src/start-key.ts';

const root = process.env.MMM_ROOT ?? process.cwd();
const read = file => readFileSync(resolve(root, file), 'utf8');
const rulesSource = read('web/src/radio-reception.ts');

const catalogue = JSON.parse(read('tools/radio_stations.json'));
const dials = catalogue.stations.map(s => String(s.dial).trim().toLowerCase());
// The talk station (the public broadcaster that comes in everywhere) is the one whose tracks use the `talk` credit.
const talk = String(catalogue.stations.find(s => s.tracks.some(t => t.credit === 'talk')).dial).trim().toLowerCase();
// The starting station for new players in all modes (tools/RADIO.md).
const start = String((catalogue.stations.find(s => s.start) ?? catalogue.stations[0]).dial).trim().toLowerCase();

// Each area's village, in map metres, from its own baked land. Mabou's land is the first one and has its own folder.
const village = id => JSON.parse(read(id === 'mabou' ? 'data/baked/terrain/manifest.json' : `data/baked/areas/${id}/manifest.json`)).village;
const areas = ['mabou', ...readdirSync(resolve(root, 'data/baked/areas')).filter(id => !id.startsWith('.')).sort()];
// The /blackstone start (deploy/_redirects: ?mode=mail&start=blackstone-road:0.43), in map metres.
const blackstonePlace = (() => {
  const [ve, vn] = village('mabou');
  const roads = JSON.parse(read('data/baked/terrain/roads.json')).roads.map(r => ({ ...r, pts: r.pts.map(([e, n]) => [e - ve, vn - n]) }));
  const pose = startKey('blackstone-road:0.43', roads, null);
  assert.ok(pose, 'blackstone-road:0.43 resolves on baked Mabou roads');
  return [pose.x + ve, vn - pose.z];
})();
// The places with Glencoe in their name that lie in the hollow, from the public place names (rounded to the metre).
const GLENCOE = { 'Glencoe Mills': [629755, 5092476], Glencoe: [629673, 5089747], 'Upper Glencoe': [632627, 5090312] };

/** The place itself, and eight more round it at each distance. */
const around = ([e, n], ...distances) => [[e, n], ...distances.flatMap(d => Array.from({ length: 8 }, (_, k) => [e + d * Math.cos(k * Math.PI / 4), n + d * Math.sin(k * Math.PI / 4)]))];
/** The music stations (every station but the talk one) that the dial stops at in a place. */
const music = (api, [e, n]) => dials.filter(dial => dial !== talk && api.comesIn(api.signalAt(api.RECEPTION, dial, e, n)));
const clear = (api, dial, [e, n]) => api.bandOf(api.signalAt(api.RECEPTION, dial, e, n)) === 'clear';

// The owner's words (17 Nov 2026): "the Mabou area gets only one station; Port Hood and Judique get two, except around
// Glencoe; around Glencoe only the public broadcaster comes in, which forces people to listen to the talk channel".
function words(api) {
  for (const place of [...areas.map(village), ...Object.values(GLENCOE)]) {
    assert.equal(api.signalAt(api.RECEPTION, talk, ...place), 1, `the talk station comes in whole at ${place}`);
  }
  const mabou = music(api, village('mabou'));
  assert.equal(mabou.length, 1, `Mabou gets one music station, not ${mabou}`);
  for (const place of around(village('mabou'), 2500, 5000)) {
    assert.deepEqual(music(api, place), mabou, `one station, the same one, round Mabou at ${place.map(Math.round)}`);
    assert.ok(clear(api, mabou[0], place), `and it is clear at ${place.map(Math.round)}`);
  }
  for (const id of ['porthood', 'judique']) {
    for (const place of around(village(id), 1500)) {
      const got = music(api, place);
      assert.equal(got.length, 2, `${id} gets two music stations at ${place.map(Math.round)}, not ${got}`);
      for (const dial of got) assert.ok(clear(api, dial, place), `${dial} is clear at ${id}`);
    }
  }
  for (const [name, place] of Object.entries(GLENCOE)) {
    for (const spot of around(place, 800)) {
      assert.deepEqual(music(api, spot), [], `only the talk station near ${name}`);
      for (const dial of dials) if (dial !== talk) assert.equal(api.bandOf(api.signalAt(api.RECEPTION, dial, ...spot)), 'lost', `${dial} near ${name}`);
    }
  }
}

// No village is left with the talk station alone: only the hollow is.
function villages(api) {
  for (const id of areas) {
    const place = village(id), got = music(api, place);
    assert.ok(got.some(dial => clear(api, dial, place)), `${id} has a clear music station (it gets ${got})`);
  }
}

// The station for the owner's songs about the wait at the canal (he asked for it, 17 Nov 2026) is the canal's own.
// Its transmitter stands where the game finds the canal's span, and it is small: whole on all of the Causeway's fine
// land, where the barrier holds the cars, half gone at 4 km, gone past 5 km and at the centre of every other village.
const CANAL_DIAL = '90.3';
function canal(api) {
  assert.ok(dials.includes(CANAL_DIAL) && Object.hasOwn(api.RECEPTION.transmitters, CANAL_DIAL), `the canal station ${CANAL_DIAL} is on the dial and has a transmitter`);
  const found = /roads\.nearest\(\s*([\d.]+)\s*-\s*village\[0\],\s*village\[1\]\s*-\s*([\d.]+)\s*,/.exec(read('web/src/canal.ts'));
  assert.ok(found, 'web/src/canal.ts finds the span with roads.nearest(E - village[0], village[1] - N, ...); if that line has changed, read the place of the span here in the new way');
  const span = [Number(found[1]), Number(found[2])], tx = api.RECEPTION.transmitters[CANAL_DIAL];
  assert.ok(Math.hypot(tx.e - span[0], tx.n - span[1]) <= 25, `the transmitter of the canal station is at the canal's span, ${span}`);
  const signal = place => api.signalAt(api.RECEPTION, CANAL_DIAL, ...place);
  const [west, south, east, north] = JSON.parse(read('data/baked/areas/cansocauseway/manifest.json')).fine;
  const land = [village('cansocauseway'), [west, south], [west, north], [east, south], [east, north]];
  for (const place of [...land, ...around(span, 2900)]) assert.equal(signal(place), 1, `the canal station is whole at ${place.map(Math.round)}`);
  for (const place of around(span, 4000).slice(1)) assert.ok(Math.abs(signal(place) - 0.5) < 0.05, `the canal station is half gone 4 km out, at ${place.map(Math.round)}`);
  for (const place of around(span, 4600).slice(1)) assert.equal(api.bandOf(signal(place)), 'weak', `the canal station is weak 4.6 km out, at ${place.map(Math.round)}`);
  for (const place of around(span, 5100).slice(1)) assert.equal(signal(place), 0, `the canal station is gone 5 km out, at ${place.map(Math.round)}`);
  for (const id of areas) if (id !== 'cansocauseway') assert.equal(api.bandOf(signal(village(id))), 'lost', `the canal station is gone at the centre of ${id}`);
}

function table(api) {
  const { transmitters, hollows } = api.RECEPTION;
  assert.ok(Object.keys(transmitters).length > 0 && hollows.length > 0);
  for (const [dial, tx] of Object.entries(transmitters)) {
    assert.ok(dials.includes(dial), `transmitter ${dial} is a station in tools/radio_stations.json`);
    for (const key of ['e', 'n', 'clear', 'edge']) assert.ok(Number.isFinite(tx[key]), `${dial}.${key}`);
    assert.ok(tx.clear > 0 && tx.clear < tx.edge, `${dial}: clear inside edge`);
  }
  // The talk station is the one that comes in everywhere.
  assert.ok(!Object.hasOwn(transmitters, talk), 'the talk station has no transmitter');
  // 103.5 THE LONG WAY ROUND is the universal first station for new players in every mode.
  assert.equal(start, '103.5', '103.5 is the starting station');
  assert.equal(String(catalogue.just_start ?? '').trim().toLowerCase(), '103.5', '103.5 is the Just Drive starting station');
  for (const h of hollows) {
    for (const key of ['e', 'n', 'deep', 'rim']) assert.ok(Number.isFinite(h[key]), `hollow ${key}`);
    assert.ok(h.deep > 0 && h.deep < h.rim, 'hollow: deep inside rim');
  }
}

// The starting station (103.5) must come in full clear (music 1, hiss 0) at Mabou and at the /blackstone start.
function blackstone(api) {
  for (const [name, place] of [['Mabou village', village('mabou')], ['/blackstone start', blackstonePlace]]) {
    const sig = api.signalAt(api.RECEPTION, start, ...place);
    assert.equal(sig, 1, `${start} is full signal at ${name} (got ${sig})`);
    assert.equal(api.bandOf(sig), 'clear', `${start} is clear at ${name}`);
    assert.deepEqual(api.mix(sig, 'clear'), { music: 1, hiss: 0 }, `${start} has full music and zero static at ${name}`);
  }
}

const NEAR = { transmitters: { a: { e: 0, n: 0, clear: 1000, edge: 2000 }, b: { e: 10000, n: 0, clear: 50000, edge: 60000 }, c: { e: 9000, n: 0, clear: 1000, edge: 3000 } },
  hollows: [{ e: 10000, n: 0, deep: 500, rim: 1500 }] };

function shape(api) {
  const at = (dial, e, n = 0) => api.signalAt(NEAR, dial, e, n);
  // Whole inside `clear`, nothing past `edge`, half way at the middle, and never rising with distance.
  for (const d of [0, 400, 1000]) assert.equal(at('a', d), 1);
  for (const d of [2000, 2500, 9000]) assert.equal(at('a', d), 0);
  assert.ok(Math.abs(at('a', 1500) - 0.5) < 1e-12);
  for (let d = 0, last = 1; d <= 2400; d += 20) { const now = at('a', d); assert.ok(now <= last && now >= 0 && now <= 1, `falls with distance at ${d}`); last = now; }
  // The same in every direction.
  for (const [e, n] of [[0, 1500], [-1500, 0], [0, -1500], [900, 1200]]) assert.ok(Math.abs(api.signalAt(NEAR, 'a', e, n) - 0.5) < 1e-12);
  // A hollow shuts every transmitter out, however near and strong.
  for (const d of [0, 300, 500]) assert.equal(at('b', 10000 + d), 0, `nothing in the hollow at ${d}`);
  for (const d of [1500, 2000]) assert.equal(at('b', 10000 + d), 1, `whole again at ${d}`);
  for (let d = 500, last = 0; d <= 1500; d += 20) { const now = at('b', 10000 + d); assert.ok(now >= last, `rises out of the hollow at ${d}`); last = now; }
  // A weak station on the hollow's rim loses twice: both losses count.
  const both = at('c', 11000), fringe = 0.5, rim = 0.5;
  assert.ok(Math.abs(both - fringe * rim) < 1e-12, `fringe and rim multiply (${both})`);
  // A missing number never takes the radio away.
  assert.equal(at('zz', 500), 1, 'a station with no transmitter comes in everywhere');
  assert.equal(at('zz', 10000), 1, 'also in a hollow');
  for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) assert.equal(at(name, 500000), 1, `${name} is not a transmitter`);
  assert.equal(api.signalAt(null, 'a', 5000, 0), 1, 'no map: every station');
  for (const bad of [NaN, Infinity, undefined]) { assert.equal(api.signalAt(NEAR, 'a', bad, 0), 1); assert.equal(api.signalAt(NEAR, 'a', 5000, bad), 1); }
  assert.equal(api.signalAt({ transmitters: { a: { e: 0, n: 0, clear: NaN, edge: NaN } }, hollows: [] }, 'a', 5, 5), 1, 'a broken transmitter');
}

function dial(api) {
  // Where every station comes in, the dial is the dial it always was: on round, and off after a full turn.
  for (let count = 1; count <= 7; count++) for (let first = 0; first < count; first++) for (let station = -1; station < count; station++) {
    const on = (station + 1) % count, old = station < 0 ? first : on === first ? -1 : on;
    assert.equal(api.nextOnDial(count, station, first, () => true), old, `old rule ${count}/${first}/${station}`);
  }
  // It passes over the ones that do not come in.
  const live = set => i => set.includes(i);
  assert.equal(api.nextOnDial(7, 2, 2, live([2, 5, 6, 0, 1])), 5);
  assert.equal(api.nextOnDial(7, 1, 2, live([2, 5, 6, 0, 1])), -1);
  assert.equal(api.nextOnDial(7, 2, 2, live([2])), -1, 'nothing else comes in: off');
  assert.equal(api.nextOnDial(7, 3, 2, live([2, 5])), 5, 'a tuned station that has gone still moves on');
  assert.equal(api.nextOnDial(7, 6, 2, live([2])), -1, 'and never back to the start without a stop at off');
  // From off: the starting station, or the next after it that comes in; with none at all, the starting one.
  assert.equal(api.nextOnDial(7, -1, 2, live([2, 5])), 2);
  assert.equal(api.nextOnDial(7, -1, 2, live([5, 0])), 5);
  assert.equal(api.nextOnDial(7, -1, 2, live([1])), 1);
  assert.equal(api.nextOnDial(7, -1, 2, live([])), 2);
  // Every walk from off stops at each station that comes in once, in dial order from the start, and then at off.
  for (let count = 1; count <= 6; count++) for (let first = 0; first < count; first++) for (let bits = 0; bits < 1 << count; bits++) {
    const comes = i => (bits >> i & 1) === 1, want = [];
    for (let k = 0; k < count; k++) if (comes((first + k) % count)) want.push((first + k) % count);
    const walk = [];
    for (let at = api.nextOnDial(count, -1, first, comes), n = 0; at >= 0; at = api.nextOnDial(count, at, first, comes)) { walk.push(at); assert.ok(++n <= count, 'the walk ends'); }
    assert.deepEqual(walk, want.length ? want : [first], `walk ${count}/${first}/${bits.toString(2)}`);
  }
}

function sound(api) {
  const { LOST, CLEAR } = api;
  assert.ok(LOST > 0 && LOST < CLEAR && CLEAR < 1);
  assert.deepEqual(api.mix(0), { music: 0, hiss: 1 });
  assert.deepEqual(api.mix(1), { music: 1, hiss: 0 });
  assert.equal(api.mix(LOST).music, 0, 'no music where the station is lost');
  assert.equal(api.mix(CLEAR).music, 1, 'all of the music where it is clear');
  assert.ok(api.mix(CLEAR).hiss > 0.2, 'the static has begun before the music fades');
  assert.deepEqual(api.mix(NaN), { music: 1, hiss: 0 });
  assert.deepEqual(api.mix(7), api.mix(1)); assert.deepEqual(api.mix(-7), api.mix(0));
  for (let k = 0, last = api.mix(0); k <= 100; k++) {
    const now = api.mix(k / 100);
    assert.ok(now.music >= last.music && now.hiss <= last.hiss && now.music >= 0 && now.music <= 1 && now.hiss >= 0 && now.hiss <= 1, `mix at ${k}`);
    last = now;
  }
  // The dial and the readout agree, and the music is gone exactly where the readout says so.
  for (let k = 0; k <= 1000; k++) {
    const s = k / 1000, band = api.bandOf(s);
    assert.equal(band === 'lost', !api.comesIn(s), `lost and comesIn at ${s}`);
    assert.equal(band === 'lost', api.mix(s).music === 0, `lost and no music at ${s}`);
    assert.equal(band === 'clear', s >= CLEAR, `clear at ${s}`);
    // Also while the readout's word holds past its limit: a station that the readout calls lost plays no music at all.
    for (const was of ['clear', 'weak', 'lost']) {
      const held = api.bandOf(s, was);
      assert.equal(held === 'lost', api.mix(s, held).music === 0, `the word ${held} (it was ${was}) and the music at ${s}`);
    }
  }
  // The word on the readout holds a little past its limit, so it does not flicker.
  assert.equal(api.bandOf(CLEAR - 0.01, 'clear'), 'clear'); assert.equal(api.bandOf(CLEAR - 0.01, 'weak'), 'weak'); assert.equal(api.bandOf(CLEAR - 0.01), 'weak');
  assert.equal(api.bandOf(LOST + 0.01, 'lost'), 'lost'); assert.equal(api.bandOf(LOST + 0.01, 'weak'), 'weak'); assert.equal(api.bandOf(LOST + 0.01), 'weak');
  assert.equal(api.bandOf(CLEAR - 0.1, 'clear'), 'weak'); assert.equal(api.bandOf(LOST + 0.1, 'lost'), 'weak'); assert.equal(api.bandOf(0, 'clear'), 'lost'); assert.equal(api.bandOf(1, 'lost'), 'clear');
  for (const limit of [CLEAR, LOST]) {
    let band = api.bandOf(limit + 0.02), changes = 0;
    for (let k = 0; k < 200; k++) { const next = api.bandOf(limit + 0.02 * Math.cos(k), band); if (next !== band) changes++; band = next; }
    assert.ok(changes <= 1, `no flicker at ${limit} (${changes} changes)`);
  }
  // A weak signal dips as the car moves, by the place alone, never by more than 35 %, and never upward.
  let low = 1, high = 0;
  for (let s = 0.02; s < 1; s += 0.02) for (let k = 0; k < 600; k++) {
    const e = 620000 + k * 3.7, n = 5090000 + k * 1.3, f = api.flutter(s, e, n);
    assert.ok(f <= s + 1e-12 && f >= s * 0.65 - 1e-12, `flutter of ${s} at ${k}: ${f}`);
    assert.equal(f, api.flutter(s, e, n));
    if (Math.abs(s - 0.5) < 0.005) { low = Math.min(low, f / s); high = Math.max(high, f / s); }
  }
  assert.ok(low < 0.7 && high > 0.97, `a half signal really comes and goes (${low} to ${high})`);
  for (const s of [0, 1, -1, 2, NaN]) assert.ok(Object.is(api.flutter(s, 620000, 5090000), s), `flutter leaves ${s}`);
  assert.equal(api.flutter(0.5, NaN, 5090000), 0.5); assert.equal(api.flutter(0.5, 620000, NaN), 0.5);
}

// The car radio alone asks the rules; the Just Listen page and the shared engine never do.
const EXPLORE_LINE = "    if (gameMode === 'explore') radio?.useReception(null);\n";
const PLACE_LINE = 'radio?.setPlace(vehicle.x + manifest.village[0], manifest.village[1] - vehicle.z);';
// `main`: the text of main.ts, so that the mutants below can hand in a broken one.
function wiring(main = read('web/src/main.ts')) {
  for (const file of ['web/src/listen.ts', 'web/src/radio-player.ts']) assert.ok(!read(file).includes('radio-reception'), `${file} has no reception`);
  const radio = read('web/src/radio.ts');
  assert.equal(main.split(PLACE_LINE).length, 3, 'the game tells the radio where the car is on load and every frame');
  assert.equal(main.split("if (params.get('reception') === '0') radio?.useReception(null);").length, 2, '?reception=0');
  // Only the mail shift has reception: just driving (explore mode) hears every station everywhere (the owner, 20 Nov 2026).
  // The line must run after the radio is made, in loadRadio's own callback. Comment lines do not count.
  const code = main.split('\n').filter(line => !line.trim().startsWith('//')).join('\n'), drop = EXPLORE_LINE.trim();
  const callback = /loadRadio\(audioBase, siteRadio\(SITE\)\)\.then\(next => \{\n([\s\S]*?)\n\s*if \(import\.meta\.env\.DEV\) expose\(\{ radio \}\);/.exec(code)?.[1] ?? '';
  assert.ok(callback.includes('radio = next;'), 'main.ts makes the radio in a loadRadio callback; if that has moved, read it here in the new way');
  assert.equal(code.split(drop).length, 2, 'just driving takes the reception map away, once');
  assert.ok(callback.indexOf(drop) > callback.indexOf('radio = next;'), 'and after the radio is made, in its own callback');
  assert.ok(callback.indexOf(PLACE_LINE) > callback.indexOf(drop), 'initial car place is set after useReception and before expose/start');
  assert.equal(code.split('useReception(').length, 3, 'and nothing else in main.ts gives the radio a map');
  assert.ok(radio.includes("from './radio-reception'") && radio.includes('nextOnDial(') && radio.includes('private map: ReceptionMap | null = RECEPTION;'));
  assert.ok(radio.includes('this.audio.muted = this.music <= 0;'), 'a lost station is muted (a phone ignores the volume)');
  assert.ok(radio.includes('protected override level(): number { return this.volume * this.wind * this.music; }'), 'a weak signal takes some of the music');
}

function all(api) { words(api); villages(api); canal(api); table(api); blackstone(api); shape(api); dial(api); sound(api); }

// Startup at /blackstone: fresh player gets 103.5 playing with zero static and no dial burst; a saved out-of-range
// station falls back for this visit without overwriting localStorage (in either setPlace/start order); a saved clear
// station or 'off' stays; explore mode keeps any saved station; driving into a hollow after startup fades without moving the dial.
async function startup(RadioClass = Radio) {
  const keys = ['document', 'window', 'Audio', 'AudioContext', 'fetch', 'URL', 'localStorage', 'matchMedia', 'performance'];
  const savedGlobals = Object.fromEntries(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const el = () => ({ id: '', title: '', textContent: '', hidden: false, style: {}, classList: { contains() { return false; }, toggle() {}, add() {}, remove() {} }, setAttribute() {}, append() {}, appendChild() {}, addEventListener() {}, insertBefore() {} });
  const stations = catalogue.stations.map(s => ({ dial: s.dial, name: s.name, tracks: [{ file: s.tracks[0].source + '.mp3', title: s.tracks[0].title, seconds: 60 }] }));
  const trackFor = dial => stations.find(s => s.dial === dial).tracks[0].file;
  const tick = () => new Promise(r => setTimeout(r, 0));
  try {
    let staticCtxMade = 0;
    const FakeAudioContext = class { constructor() { staticCtxMade++; } };
    globalThis.AudioContext = FakeAudioContext;
    globalThis.window = { AudioContext: FakeAudioContext };
    globalThis.Audio = class {
      preload = ''; volume = 1; muted = false; paused = true; src = ''; readyState = 2; currentTime = 0; duration = 60;
      listeners = new Map();
      addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
      emit(type) { for (const fn of this.listeners.get(type) ?? []) fn(); }
      play() { this.paused = false; this.emit('playing'); return Promise.resolve(); }
      pause() { this.paused = true; this.emit('pause'); }
    };
    globalThis.document = { hidden: false, createElement: el, head: el(), body: el(), getElementById: () => null, addEventListener() {} };
    globalThis.matchMedia = () => ({ matches: true });
    globalThis.performance = { now: () => 0 };
    globalThis.URL = { createObjectURL: blob => `blob:${blob._tag ?? 'audio'}`, revokeObjectURL() {} };
    const makeFetch = (deferred = new Map()) => {
      const fetched = [];
      globalThis.fetch = url => {
        fetched.push(String(url));
        const file = String(url).split('/').pop();
        const response = { ok: true, status: 200, arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer) };
        if (deferred.has(file)) return deferred.get(file).promise.then(() => response);
        return Promise.resolve(response);
      };
      return fetched;
    };
    const runCase = async (savedDial, explore = false) => {
      staticCtxMade = 0;
      const fetched = makeFetch();
      const store = new Map(savedDial === null ? [] : [['mmm.radio', savedDial]]);
      globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
      const radio = new RadioClass(stations, '/audio', start, 'mmm.radio');
      if (explore) radio.useReception(null);
      radio.setPlace(...blackstonePlace);
      radio.start();
      await tick(); await tick();
      return { radio, store, fetched, staticCtxMade };
    };
    {
      const { radio, fetched, staticCtxMade: ctx } = await runCase(null);
      assert.equal(radio.tunedDial, '103.5', 'fresh player at /blackstone starts on 103.5');
      assert.equal(radio.reception.signal, 1); assert.equal(radio.reception.band, 'clear');
      assert.equal(radio.reception.music, 1); assert.equal(radio.reception.hiss, 0);
      assert.equal(radio.reception.static, 0); assert.equal(radio.reception.context, 'none');
      assert.equal(ctx, 0, 'fresh start at /blackstone creates no static AudioContext or dial burst');
      assert.deepEqual(fetched, ['/audio/' + trackFor('103.5')], 'fresh start fetches only 103.5');
      assert.equal(radio.audio.paused, false, '103.5 audio starts playing');
      assert.equal(radio.audio.muted, false, '103.5 audio is unmuted');
      assert.equal(radio.audible, true, '103.5 is audible from startup');
      // Driving into the Glencoe hollow after startup keeps 103.5 on the dial and lets it fade to NO SIGNAL.
      radio.setPlace(...GLENCOE.Glencoe);
      assert.equal(radio.reception.band, 'lost', 'driving into the hollow fades to lost without changing the dial');
      assert.equal(radio.reception.music, 0); assert.equal(radio.reception.hiss, 1);
      assert.equal(radio.tunedDial, null);
    }
    {
      const { radio, store, fetched, staticCtxMade: ctx } = await runCase('92.5');
      assert.equal(radio.tunedDial, '103.5', 'saved out-of-range station falls back to 103.5 at /blackstone');
      assert.equal(radio.reception.music, 1); assert.equal(radio.reception.hiss, 0); assert.equal(radio.reception.static, 0);
      assert.equal(ctx, 0, 'fallback creates no static AudioContext or dial burst');
      assert.deepEqual(fetched, ['/audio/' + trackFor('103.5')], 'saved out-of-range station is never fetched when place is set first');
      assert.equal(radio.audible, true, 'fallback 103.5 plays cleanly');
      assert.equal(store.get('mmm.radio'), '92.5', 'saved station is not overwritten in localStorage');
    }
    {
      // Late-placement safety: even if start() runs before setPlace(), fallback pauses/disowns the old fetch and plays 103.5 with no static burst.
      staticCtxMade = 0;
      let releaseOld;
      const deferred = new Map([[trackFor('92.5'), { promise: new Promise(r => { releaseOld = r; }) }]]);
      const fetched = makeFetch(deferred);
      const store = new Map([['mmm.radio', '92.5']]);
      globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
      const radio = new RadioClass(stations, '/audio', start, 'mmm.radio');
      radio.start();
      radio.setPlace(...blackstonePlace);
      await tick(); await tick();
      releaseOld();
      await tick(); await tick();
      assert.equal(radio.tunedDial, '103.5', 'late setPlace still falls back to 103.5');
      assert.equal(staticCtxMade, 0, 'late setPlace plays no static burst');
      assert.equal(radio.audible, true, 'late setPlace plays 103.5');
      assert.equal(fetched.at(-1), '/audio/' + trackFor('103.5'), '103.5 track owns the player');
      assert.equal(radio.songFile, trackFor('103.5'), 'stale 92.5 fetch cannot overwrite 103.5');
    }
    {
      const { radio, fetched, staticCtxMade: ctx } = await runCase('94.9');
      assert.equal(radio.tunedDial, '94.9', 'saved clear station wins at /blackstone');
      assert.equal(radio.reception.static, 0); assert.equal(ctx, 0);
      assert.deepEqual(fetched, ['/audio/' + trackFor('94.9')]);
      assert.equal(radio.audible, true);
    }
    {
      const { radio, fetched, staticCtxMade: ctx } = await runCase('off');
      assert.equal(radio.tunedDial, null, 'saved off stays off');
      assert.deepEqual(fetched, [], 'saved off fetches nothing');
      assert.equal(ctx, 0);
    }
    {
      const { radio, fetched, staticCtxMade: ctx } = await runCase('92.5', true);
      assert.equal(radio.tunedDial, '92.5', 'explore mode keeps any saved station');
      assert.equal(radio.reception.signal, 1); assert.equal(ctx, 0);
      assert.deepEqual(fetched, ['/audio/' + trackFor('92.5')]);
      assert.equal(radio.audible, true);
    }
  } finally {
    for (const [k, d] of Object.entries(savedGlobals)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
  }
}

all(rules); wiring(); await startup();
console.log(`PASS radio reception: ${areas.length} villages, ${Object.keys(rules.RECEPTION.transmitters).length} transmitters, ${dials.length} stations`);
for (const id of areas) console.log(`  ${id}: ${[talk, ...music(rules, village(id))].join(', ')}`);

if (process.argv.includes('--mutations')) {
  const load = async source => {
    const out = await build({ stdin: { contents: source, resolveDir: resolve(root, 'web/src'), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
    return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
  };
  const mutants = [
    ['R1 a second station reaches Mabou', "'107.3': { ...SHORE, clear: 8500, edge: 11500 }", "'107.3': { ...SHORE, clear: 16000, edge: 20000 }", words],
    ['R2 the hollow is not shut in', "hollows: [{ e: 630300, n: 5090900, deep: 4500, rim: 7500 }]", "hollows: [{ e: 630300, n: 5090900, deep: 450, rim: 750 }]", words],
    ['R3 the shore station does not reach Judique', "const SHORE = { e: 615500, n: 5088800 };", "const SHORE = { e: 615500, n: 5094800 };", words],
    ['R4 the talk station gets a transmitter', "'103.5': { ...WIDE, clear: 27000, edge: 35000 },", `'103.5': { ...WIDE, clear: 27000, edge: 35000 }, '${talk}': { ...WIDE, clear: 27000, edge: 35000 },`, table],
    ['R5 a transmitter for no station', "'96.1': {", "'96.2': {", table],
    ['R6 a village with no music', "const TOWN = { e: 627000, n: 5054000 };", "const TOWN = { e: 627000, n: 5024000 };", villages],
    ['R7 the canal station reaches the next village', "'90.3': { ...CANAL, clear: 3000, edge: 5000 }", "'90.3': { ...CANAL, clear: 3000, edge: 9000 }", canal],
    ['R8 the canal station is not at the canal', "const CANAL = { e: 623671, n: 5056096 };", "const CANAL = { e: 624671, n: 5056096 };", canal],
    ['R9 the canal station is not whole on its own land', "'90.3': { ...CANAL, clear: 3000, edge: 5000 }", "'90.3': { ...CANAL, clear: 1000, edge: 5000 }", canal],
    ['R10 the canal station has no weak ring before it is gone', "'90.3': { ...CANAL, clear: 3000, edge: 5000 }", "'90.3': { ...CANAL, clear: 3500, edge: 4500 }", canal],
    ['R11 103.5 has static at /blackstone', "'103.5': { ...WIDE, clear: 27000, edge: 35000 }", "'103.5': { ...WIDE, clear: 20000, edge: 35000 }", blackstone],
    ['S1 hollows are ignored', 'signal *= ramp(h.deep, h.rim, Math.hypot(e - h.e, n - h.n));', 'signal *= 1;', shape],
    ['S2 a station with no transmitter is lost', 'return 1;\n  const tx', 'return 0;\n  const tx', shape],
    ['S3 signal rises with distance', 'let signal = 1 - ramp(', 'let signal = ramp(', shape],
    ['S4 a broken number takes the radio away', 'return Number.isFinite(signal) ? signal : 1;', 'return signal;', shape],
    ['D1 the dial stops at a lost station', 'i = (i + 1) % count) if (comes(i)) return i;', 'i = (i + 1) % count) return i;', dial],
    ['D2 the dial never reaches off', 'i !== first; i = (i + 1) % count)', 'i !== station; i = (i + 1) % count)', dial],
    ['D3 from off, a lost start is tuned', 'if (comes((first + k) % count)) return (first + k) % count;', 'return first;', dial],
    ['M1 music is left where the station is lost', '(s - LOST) / (CLEAR - LOST)', 's / CLEAR', sound],
    ['M2 the readout flickers at clear', "signal >= (was === 'clear' ? CLEAR - SLACK : CLEAR)", 'signal >= CLEAR', sound],
    ['M3 the readout flickers at lost', "signal <= (was === 'lost' ? LOST + SLACK : LOST)", 'signal <= LOST', sound],
    ['M4 the dial and the readout disagree', 'return signal > LOST; }', 'return signal > LOST + 0.01; }', sound],
    ['M5 the flutter dips too far', 'FLUTTER * 4 * signal * (1 - signal)', 'FLUTTER * 8 * signal * (1 - signal)', sound],
    ['M6 the flutter is gone', 'const FLUTTER = 0.35;', 'const FLUTTER = 0;', sound],
    ['M7 no static until the music fades', 'const QUIET = 0.95;', 'const QUIET = 0.6;', sound],
    ['M8 music plays while the readout says NO SIGNAL', "music: band === 'lost' ? 0 : Math.min(", 'music: Math.min(', sound],
  ];
  for (const [name, from, to, test] of mutants) {
    assert.equal(rulesSource.split(from).length, 2, `${name}: anchor`);
    const api = await load(rulesSource.replace(from, to));
    assert.throws(() => test(api), assert.AssertionError, `${name} survived`);
    console.log(`KILLED ${name}`);
  }
  console.log(`PASS ${mutants.length} radio reception mutants killed`);
  // The explore-mode line in main.ts, broken four ways: the wiring check must catch each.
  const mainSource = read('web/src/main.ts'), made = "    radio = next; if (SITE.brand === 'just')";
  const wiringMutants = [
    ['W1 just driving keeps the map', s => s.replace(EXPLORE_LINE, '')],
    ['W2 the line is only a comment', s => s.replace(EXPLORE_LINE, `    // ${EXPLORE_LINE.trimStart()}`)],
    ['W3 the line runs before the radio is made', s => s.replace(EXPLORE_LINE, '').replace(made, EXPLORE_LINE + made)],
    ['W4 another line gives the radio a map again', s => s.replace(EXPLORE_LINE, `${EXPLORE_LINE}    radio?.useReception(RECEPTION);\n`)],
    ['W5 initial place is not set before radio start', s => s.replace(`    ${PLACE_LINE}\n`, '')],
  ];
  for (const [name, mutate] of wiringMutants) {
    assert.ok(mainSource.split(EXPLORE_LINE).length === 2 && mainSource.split(made).length === 2, `${name}: anchor`);
    assert.throws(() => wiring(mutate(mainSource)), assert.AssertionError, `${name} survived`);
    console.log(`KILLED ${name}`);
  }
  console.log(`PASS ${wiringMutants.length} wiring mutants killed`);
}
