// Pure rules and real service-worker bypass. No request to the Province is made by this check.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { transformSync } from '../web/node_modules/esbuild/lib/main.js';
import { harness, source as worker } from './pwa-harness.mjs';
const source = readFileSync(new URL('../web/src/property-lines-rules.ts', import.meta.url), 'utf8');
const loader = readFileSync(new URL('../web/src/property-lines-loader.ts', import.meta.url), 'utf8');
const view = readFileSync(new URL('../web/src/property-lines.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../web/src/main.ts', import.meta.url), 'utf8');
const map = readFileSync(new URL('../web/src/minimap.ts', import.meta.url), 'utf8');
const title = readFileSync(new URL('../web/src/title.ts', import.meta.url), 'utf8');
const build = readFileSync(new URL('./build-pwa.mjs', import.meta.url), 'utf8');
// Independently transcribed from page 2 of Restricted Map Services License - NSPRD v1.pdf.
const expectedDisclaimer = `The Province of Nova Scotia makes no representations, expressed or implied, as to the accuracy, completeness and timeliness of the information, maps and other data, including PID numbers or property boundaries, which are displayed in this map that is presented in this application.

The map is provided on the understanding that it is not guaranteed to be correct or complete or current, is subject to change, and conclusions drawn or decisions made, based on an interpretation of the data, are the responsibility of the user.

By continuing to use this application, you agree to the terms of this disclaimer.`;
const expectedAttribution = 'Contains information obtained under license from the Province of Nova Scotia which is provided without warranty or liability for errors or omissions.';
function compileModule(file) {
  const module = {exports:{}};
  vm.runInNewContext(transformSync(readFileSync(new URL(`../web/src/${file}`, import.meta.url),'utf8'), {loader:'ts',format:'cjs'}).code, {module,exports:module.exports,Map,Set,Math});
  return module.exports;
}
function compile(text, imports = {}, globals = {}) {
  imports = { './element-visibility': compileModule('element-visibility.ts'), './map-labels': compileModule('map-labels.ts'), './hikes': compileModule('hikes.ts'), ...imports };
  const module = { exports: {} };
  vm.runInNewContext(transformSync(text, { loader: 'ts', format: 'cjs', target: 'es2022' }).code,
    { module, exports: module.exports, URLSearchParams, URL, Map, Math, Error, AbortController, setTimeout, clearTimeout, require: id => { assert.ok(id in imports, id); return imports[id]; }, ...globals });
  return module.exports;
}
const box = (offset = 0) => ({ west: 623821 + offset, south: 5102851, east: 624721 + offset, north: 5103751 });
const agree = gate => { gate.choose(true); gate.agree(); };
function issue(planner, b, time) { return planner.plan(b, time) ?? planner.plan(b, time + 400); }
function test(text) {
  const r = compile(text), { PropertyGate: Gate, PropertyPlanner: Planner } = r;
  assert.equal(r.PROPERTY_DISCLAIMER, expectedDisclaimer, 'verbatim disclaimer');
  assert.equal(r.PROPERTY_ATTRIBUTION, expectedAttribution, 'verbatim attribution');
  // Consent must say what a request reveals, and to whom, in the game's own words.
  for (const fact of [/Province of Nova Scotia's map service/, /which part of the map you are looking at/, /where you are in the game/, /your internet address/, /Nothing is sent before you agree, or while the layer is off/])
    assert.match(r.PROPERTY_REQUEST_NOTE, fact, 'consent note states: ' + fact);
  // An asymmetric view catches an inverted northing or a shifted image. Same transform for every land area.
  const absolute = r.propertyViewBox({ x0: -200, z0: -600, x1: 300, z1: 100 }, [624271, 5103301]);
  assert.equal(JSON.stringify(absolute), JSON.stringify({ west: 624071, south: 5103201, east: 624571, north: 5103901 }));
  assert.equal(JSON.stringify(r.propertyWorldRect(absolute, [624271, 5103301])), JSON.stringify([-200, -600, 500, 700]));
  assert.equal(r.PROPERTY_LICENSE_URL, 'https://nsgiwa.novascotia.ca/documents/licenses/MapService/Restricted%20Map%20Services%20License%20-%20NSPRD%20v1.pdf');
  const saved = new Map(), storage = { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) };
  const gate = new Gate(true, storage), planner = new Planner(gate);
  assert.equal(issue(planner, box(), 0), null, 'off: no request');
  gate.choose(true);
  assert.equal(gate.pending, true); assert.equal(gate.enabled, false);
  assert.equal(issue(planner, box(), 6000), null, 'unaccepted: no request');
  gate.choose(false); gate.agree();
  assert.equal(gate.enabled, false, 'Cancel cannot be followed by stale agreement');
  assert.equal(gate.pending, false); assert.equal(gate.accepted, false);
  agree(gate); assert.equal(gate.canRequest, true);
  assert.equal(saved.get(r.PROPERTY_ACCEPTANCE_KEY), 'accepted');
  const remembered = new Gate(true, storage);
  assert.equal(remembered.enabled, false, 'remember agreement, never activation');
  remembered.choose(true); assert.equal(remembered.canRequest, true); assert.equal(remembered.pending, false);
  gate.choose(false); assert.equal(issue(planner, box(), 12000), null, 'off after agreement');
  const historic = new Gate(false, storage); agree(historic);
  assert.equal(issue(new Planner(historic), box(), 0), null, '1884 never requests, even with saved agreement');
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  const privateGate = new Gate(true, blocked); agree(privateGate); assert.equal(privateGate.canRequest, true);
  assert.equal(new Gate(true, blocked).accepted, false, 'blocked storage asks next session');
  const p = new Planner(remembered);
  assert.equal(p.plan(box(), 0), null); assert.equal(p.plan(box(), 349), null, 'debounce');
  const first = p.plan(box(), 350); assert.ok(first);
  const u = new URL(first.url), q = u.searchParams;
  assert.equal(u.origin, 'https://nsgiwa2.novascotia.ca');
  assert.equal(u.pathname, '/arcgis/rest/services/PLAN/PLAN_NSPRD_WM84/MapServer/export');
  assert.doesNotMatch(u.href, /\/(query|identify)(?:\?|\/)/i);
  for (const [key, value] of Object.entries({ bboxSR: '2961', imageSR: '2961', format: 'png32', transparent: 'true', f: 'image', dpi: '96' })) assert.equal(q.get(key), value);
  const layers = JSON.parse(q.get('dynamicLayers'));
  assert.deepEqual(layers.map(l => l.source.mapLayerId), [0], 'only boundary layer 0');
  assert.deepEqual(layers.map(l => l.id), [0]);
  assert.equal(q.has('layers'), false); assert.equal(q.has('layerDefs'), false);
  assert.equal(layers[0].drawingInfo.showLabels, false);
  assert.deepEqual(layers[0].drawingInfo.labelingInfo, []);
  assert.equal(layers[0].drawingInfo.renderer.symbol.style, 'esriSFSNull', 'no polygon fill');
  assert.equal(layers[0].drawingInfo.renderer.symbol.outline.width, 0.8, 'thin outlines');
  const bounds = q.get('bbox').split(',').map(Number), [width, height] = q.get('size').split(',').map(Number);
  assert.equal((bounds[2] - bounds[0]) / width, (bounds[3] - bounds[1]) / height, 'image matches bbox aspect');
  assert.ok(Math.max(width, height) <= 1280); assert.ok((bounds[2] - bounds[0]) / width * 96 / 0.0254 <= 36114, 'service scale floor');
  // Widest rotated map view, all headings, all three ranges, all six real area origins.
  for (const reach of [450, 1200, 3200]) for (let heading = 0; heading < Math.PI * 2; heading += 0.1) {
    const span = 2 * reach * (Math.abs(Math.sin(heading)) + Math.abs(Math.cos(heading)));
    const url = new URL(r.propertyExportURL(r.propertyCoverage({ west: 624271 - span / 2, east: 624271 + span / 2, south: 5103301 - span / 2, north: 5103301 + span / 2 }).box));
    const [w, h] = url.searchParams.get('size').split(',').map(Number);
    const [west, south, east, north] = url.searchParams.get('bbox').split(',').map(Number);
    assert.ok(Math.max(w, h) <= 1280);
    assert.ok(w / ((east - west) / 100) >= 11 && h / ((north - south) / 100) >= 11, 'grown box keeps scale floor');
  }
  assert.equal(p.plan(box(5000), 1000), null);
  assert.equal(p.plan(box(5000), 1400), null, 'minimum request interval even outside pending coverage');
  assert.ok(issue(p, box(5000), 6000));
  assert.equal(issue(p, box(10000), 12000), null, 'at most two in flight'); assert.equal(p.flight.size, 2);
  const coverage = r.propertyCoverage(box());
  assert.equal(JSON.stringify(coverage.box), JSON.stringify({ west: 623300, south: 5102400, east: 625200, north: 5104300 }), 'half-view margin, outward rounding');
  assert.equal(coverage.safe.east, 625155, 'ten percent margin rim');
  const reuse = new Planner(remembered);
  const large = issue(reuse, box(), 0); reuse.complete(large, 'large-picture');
  for (let time = 6000; time < 60000; time += 1000) assert.equal(reuse.plan(box(400), time), null, 'moving inside picture makes no request');
  const leaving = issue(reuse, box(435), 60000); assert.ok(leaving, 'crossing inner rim requests one replacement');
  assert.equal(reuse.flight.size, 1);
  assert.ok(reuse.picture(box(435)), 'old picture covers view while replacing inside rim');
  for (let time = 61000; time < 70000; time += 1000) assert.equal(reuse.plan(box(435), time), null, 'covered in-flight replacement is not duplicated');
  assert.equal(reuse.picture(box(480)), undefined, 'partial pictures are never drawn');
  reuse.complete(leaving, 'replacement');
  assert.equal(reuse.plan(box(435), 70000), null, 'replacement reused');
  assert.equal(reuse.picture(box(435), 1200), undefined, 'old range picture not drawn');
  assert.ok(reuse.plan(box(435), 71000, 1200) === null && reuse.plan(box(435), 71400, 1200), 'range change requests its own picture');
  const disposed = [], cache = new Planner(remembered, value => disposed.push(value));
  for (let i = 0; i < 16; i++) {
    const request = issue(cache, box(i * 2000), i * 6000); assert.ok(request);
    cache.complete(request, i);
    assert.ok(cache.cache.size <= 8, 'cache cap');
  }
  assert.equal(cache.cache.size, 8); assert.equal(disposed.length, 8);
  assert.ok(cache.picture(box(15 * 2000))); assert.equal(cache.picture(box(-10000)), undefined);
  remembered.choose(false); assert.equal(cache.picture(box(15 * 2000)), undefined, 'off hides cached images');
  remembered.choose(true);
  const last = [...cache.cache.keys()].at(-1); assert.equal(issue(cache, box(15 * 2000), 100000), null, 'reuse session cache'); assert.equal([...cache.cache.keys()].at(-1), last);
  const failed = new Gate(true); agree(failed); const failures = new Planner(failed);
  assert.ok(issue(failures, box(), 0));
  assert.equal(failed.fail(1000), true, 'first failure gives notice'); assert.equal(failed.fail(1100), false, 'one notice');
  failures.clear();
  for (let time = 2000; time < 61000; time += 100) { failed.choose(false, time); failed.choose(true, time); assert.equal(failures.plan(box(), time), null, 'early switch attempts make no request'); }
  failed.choose(true, 60999); assert.equal(failed.canRequest, false, 'cooldown includes its last millisecond');
  for (let time = 61000; time < 121000; time += 100) assert.equal(failures.plan(box(), time), null, 'no automatic retry after cooldown');
  failed.choose(false, 121000); failed.choose(true, 121000); assert.equal(failed.canRequest, true, 'manual retry works without reload');
  const retry = issue(failures, box(), 121000); assert.ok(retry);
  assert.equal(failures.plan(box(), 121600), null, 'one retry in flight');
  assert.equal(failed.fail(122000), false, 'retry failure never repeats toast'); failures.clear();
  failed.choose(false, 181999); failed.choose(true, 181999); assert.equal(failed.canRequest, false, 'new failure resets cooldown');
  failed.choose(false, 182000); failed.choose(true, 182000); assert.equal(failed.canRequest, true, 'next manual retry after full minute');
  const lateGate = new Gate(true); agree(lateGate); const released = [];
  const late = new Planner(lateGate, image => released.push(image));
  const stale = issue(late, box(), 0); lateGate.choose(false);
  late.complete(stale, 'late-response');
  assert.equal(late.cache.size, 0, 'off completion cannot restore a picture');
  assert.equal(released.length, 1, 'off completion is disposed');
  const stationaryGate = new Gate(true); agree(stationaryGate); const stationary = new Planner(stationaryGate);
  const initial = issue(stationary, box(), 0); stationary.complete(initial, 'stub');
  for (let time = 1000; time <= 600000; time += 125) assert.equal(stationary.plan(box(), time), null, 'stationary: no repeated exports');
  cache.clear(); assert.equal(cache.cache.size, 0); assert.equal(disposed.length, 16);
  assert.equal(r.PROPERTY_FETCH_OPTIONS.cache, 'no-store', 'HTTP cache forbidden');
  assert.equal(r.PROPERTY_FETCH_OPTIONS.credentials, 'omit'); assert.equal(r.PROPERTY_FETCH_OPTIONS.mode, 'cors');
  return r;
}
const rules = test(source);
// Real production integration: a removed era gate or moved drawing order must fail Node, too.
const entryGate = main.match(/propertyLines\(miniMap, manifest\.village, (.*)\);/);
assert.ok(entryGate, 'entry-point gate');
const modern = new Function('ERA', 'params', 'return (' + entryGate[1] + ')');
for (const [resolved, asked, allowed] of [[true, '', true], [true, 'era=today', true], [false, 'era=1884', false], [true, 'era=1884', false]]) {
  assert.equal(modern({ modern: resolved }, new URLSearchParams(asked)), allowed, 'raw 1884 also blocks unsupported-area fallback');
}
assert.match(view, /if \(!map \|\| !modern\) return;/);
assert.match(loader, /this\.io\.fetch\(request\.url, \{ \.\.\.PROPERTY_FETCH_OPTIONS, signal:/);
assert.match(view, /textContent: PROPERTY_DISCLAIMER/); assert.match(view, /textContent: PROPERTY_REQUEST_NOTE/);
assert.match(view, /dialog\.append\(heading, note, disclaimer, licence\(\), document\.createElement\('br'\), agree, cancel\);/, 'the request note stands before the disclaimer and the buttons');
 assert.match(view, /credit\.append\(PROPERTY_ATTRIBUTION/);
assert.match(view, /if \(notice\)/); assert.match(view, /images\.clear\(\)/);
assert.ok(map.indexOf('this.underlay?.draw(g,') < map.indexOf('for (let pass = 5;'), 'image below roads');
assert.doesNotMatch(map + view, /getImageData|toDataURL|toBlob|caches\.open|indexedDB|\/query\?|\/identify\?/);
assert.match(title, /\$\{PROPERTY_ATTRIBUTION\}.*\$\{PROPERTY_LICENSE_URL\}/);
// Execute the service worker's actual fetch listener, on both host names, online and offline.
for (const origin of ['https://mmm.fakkeldy.ca', 'https://justdrive.fakkeldy.ca']) {
  const h = await harness(worker, { origin });
  for (const online of [true, false]) {
    h.network(online);
    h.listeners.fetch({ request: new Request(rules.propertyExportURL(rules.propertyBox(box()))),
      respondWith() { assert.fail('worker must not handle or cache property pictures'); },
      waitUntil() { assert.fail('no background caching'); } });
  }
  assert.equal(h.bins.size, 0); assert.equal(h.requests.length, 0);
}
assert.doesNotMatch(build, /novascotia\.ca|property.lines|PROPERTY_SERVICE/);
console.log('PASS property gate, exact licence text, lines-only export, debounce, rate/flight/cache caps, coverage reuse, manual retry cooldown, HTTP and PWA cache exclusion, draw order and both hosts');
// Ten-minute deterministic drive: stub completion after 150 ms, 20 m/s east, 8 redraws/s.
for (const reach of [450, 1200, 3200]) {
  const gate = new rules.PropertyGate(true); agree(gate); const p = new rules.PropertyPlanner(gate);
  let requests = 0, pending = [];
  for (let now = 0; now <= 600000; now += 125) {
    for (const job of pending.filter(j => j.at <= now)) p.complete(job.request, 'stub-image');
    pending = pending.filter(j => j.at > now);
    const e = 624271 + now / 1000 * 20;
    const job = p.plan({ west: e - reach, east: e + reach, south: 5103301 - reach * 0.75, north: 5103301 + reach * 1.25 }, now, reach);
    if (job) { requests++; pending.push({ request: job, at: now + 150 }); }
  }
  assert.ok(requests > 0 && requests <= ({450: 36, 1200: 16, 3200: 8})[reach], 'ten-minute rate bound');
  console.log(`STUB ten-minute 72 km/h drive, range ${reach} m: ${requests} export requests (off: 0; stationary after first image: 0 more)`);
}
if (process.argv.includes('--mutations')) {
  const mutants = [
    ['agreement bypass', 'accepted = false;', 'accepted = true;'],
    ['off bypass', 'this.modern && this.enabled && this.accepted', 'this.modern && this.accepted'],
    ['era bypass', 'constructor(readonly modern: boolean, private storage?: PropertyStorage) {', 'constructor(readonly modern: boolean, private storage?: PropertyStorage) { this.modern = true;'],
    ['cancel bypass', 'if (!this.pending || !this.modern || this.failed) return;', 'if (!this.modern || this.failed) return;'],
    ['remember lost', "storage?.getItem(PROPERTY_ACCEPTANCE_KEY) === 'accepted'", 'false'],
    ['licence changed', 'The Province of Nova Scotia makes no representations,', 'The Province of Nova Scotia makes representations,'],
    ['consent silent on the map area', 'which part of the map you are looking at (where you are in the game), together with ', ''],
    ['consent silent on the address', ', together with your internet address, as any visit to a website does', ''],
    ['attribution changed', 'provided without warranty or liability for errors or omissions.', 'provided without warranty.'],
    ['wrong endpoint', '/export?${query}', '/query?${query}'],
    ['wrong layer', "mapLayerId: 0", "mapLayerId: 1"],
    ['labels enabled', 'showLabels: false', 'showLabels: true'],
    ['northing inverted', 'south: origin[1] - b.z1', 'south: origin[1] + b.z1'],
    ['flight cap removed', 'this.flight.size >= PROPERTY_MAX_FLIGHT', 'false'],
    ['request floor removed', 'now - this.lastRequest < PROPERTY_INTERVAL_MS', 'false'],
    ['cache cap removed', 'this.cache.size > PROPERTY_CACHE_CAP', 'this.cache.size > 80'],
    ['repeat notice', 'if (this.noticed) return false;', 'if (false) return false;'],
    ['retry storm', 'this.failed = true; this.enabled = false; this.pending = false;', 'this.failed = false; this.enabled = false; this.pending = false;'],
    ['coverage reuse removed', 'find(([, entry]) => entry.range === range && contains(entry.safe, view))', 'find(([, entry]) => entry.range === range && false)'],
    ['retry cooldown removed', 'now >= this.retryAt', 'true'],
    ['manual retry removed', 'if (on && this.failed && now >= this.retryAt) this.failed = false;', 'if (false) this.failed = false;'],
    ['completion gate removed', '!current || !this.gate.canRequest || request.id !== this.serial', '!current || request.id !== this.serial'],
    ['HTTP cache enabled', "cache: 'no-store'", "cache: 'default'"],
  ];
  for (const [name, from, to] of mutants) {
    assert.equal(source.split(from).length, 2, 'unique anchor: ' + name);
    assert.throws(() => test(source.replace(from, to)), { name: 'AssertionError' }, 'mutant survived: ' + name);
    console.log('KILLED ' + name);
  }
}

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
async function lifecycle(rulesText = source, loaderText = loader) {
  const r = compile(rulesText), { PropertyImages } = compile(loaderText, { './property-lines-rules': r });
  for (const phase of ['fetch-off', 'off', 'hidden', 'newer', 'newer-finished', 'off-on']) {
    const gate = new r.PropertyGate(true); agree(gate);
    const created = [], revoked = [], fetches = [], decodes = [], jobs = [];
    let failures = 0;
    const images = new PropertyImages(gate, {
      fetch: (url, options) => { const d = deferred(); fetches.push({ ...d, signal: options.signal }); return d.promise; },
      createURL: () => { const url = 'blob:test-' + created.length; created.push(url); return url; },
      revokeURL: url => { assert.ok(!revoked.includes(url), 'URL revoked only once'); revoked.push(url); },
      decode: url => { const d = deferred(); decodes.push({ ...d, url }); return d.promise; },
      online: () => true, failure: () => { failures++; },
    });
    const start = (b, now) => {
      const request = issue(images.planner, b, now); assert.ok(request, 'planned ' + phase);
      const done = images.load(request); jobs.push(done); return { request, done, fetch: fetches.at(-1) };
    };
    const respond = job => job.fetch.resolve(new Response('synthetic-png', { headers: { 'Content-Type': 'image/png' } }));
    const decoded = async count => { for (let n = 0; n < 30 && decodes.length < count; n++) await flush(); assert.equal(decodes.length, count, 'decode is controlled'); };
    try {
      const first = start(box(), 0);
      if (phase === 'fetch-off') {
        gate.choose(false); images.clear(); respond(first); await first.done;
        assert.equal(created.length, 0, 'late fetch creates no URL');
      } else {
        respond(first); await decoded(1);
        if (phase === 'off' || phase === 'hidden') {
          if (phase === 'off') { gate.choose(false); images.clear(); } else images.cancel();
          assert.equal(first.fetch.signal.aborted, true);
          assert.equal(revoked.length, 1, 'pending decode URL revoked at cancellation');
          decodes[0].resolve('old'); await first.done;
        } else {
          if (phase === 'off-on') { gate.choose(false); images.clear(); gate.choose(true); }
          const second = start(phase === 'off-on' ? box() : box(5000), 6000);
          assert.equal(first.fetch.signal.aborted, true, 'old transfer aborted');
          if (phase !== 'newer-finished') {
            decodes[0].resolve('old'); await first.done;
            assert.equal(images.planner.flight.get(second.request.key), second.request, 'old finally cannot release newer request');
            assert.equal(images.planner.cache.size, 0, 'old response cannot populate cache');
          }
          respond(second); await decoded(2); decodes[1].resolve('new'); await second.done;
          if (phase === 'newer-finished') { decodes[0].resolve('old'); await first.done; }
          assert.equal(images.planner.cache.size, 1);
          assert.equal(images.planner.picture(phase === 'off-on' ? box() : box(5000)).image.image, 'new', 'latest picture survives late response');
        }
      }
      if (['fetch-off', 'off', 'hidden'].includes(phase)) assert.equal(images.planner.cache.size, 0, 'late response stays absent: ' + phase);
      assert.equal(failures, 0, 'aborts are quiet');
    } finally {
      images.clear();
      for (const f of fetches) f.resolve(new Response('', { headers: { 'Content-Type': 'image/png' } }));
      for (const d of decodes) d.resolve('cleanup');
      await Promise.allSettled(jobs);
    }
    assert.deepEqual([...revoked].sort(), [...created].sort(), 'every created URL revoked: ' + phase);
  }
}

function offWork(mapText = map, viewText = view) {
  let trig = 0, calls = 0;
  const math = Object.create(Math);
  for (const name of ['sin', 'cos']) math[name] = (...args) => { trig++; return Math[name](...args); };
  const context = new Proxy({}, { get: (o, k) => o[k] ?? (() => {}) });
  const nodes = [];
  class Element {
    hidden = false; children = []; listeners = {}; parentElement = null;
    style = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } };
    classList = { names: new Set(), contains(n) { return this.names.has(n); }, add(n) { this.names.add(n); }, toggle(n, on = !this.names.has(n)) { if (on) this.names.add(n); else this.names.delete(n); } };
    constructor() { nodes.push(this); }
    append(...items) { for (const item of items) if (item instanceof Element) { item.parentElement = this; this.children.push(item); } }
    appendChild(item) { this.append(item); }
    after() {} setAttribute() {} focus() {}
    addEventListener(name, callback) { this.listeners[name] = callback; }
    getContext() { return context; }
    getClientRects() { return []; }
  }
  const body = new Element(), head = new Element(), documentElement = new Element();
  const document = { body, head, documentElement, hidden: false, createElement: () => new Element(), getElementById: id => nodes.find(n => n.id === id) ?? null };
  const globals = { document, window: {}, innerWidth: 390, innerHeight: 844, devicePixelRatio: 1, Math: math,
    localStorage: { getItem: key => key === 'mmm.map' ? 'open' : null }, addEventListener() {},
    ResizeObserver: class { observe() {} }, MutationObserver: class { observe() {} disconnect() {} } };
  const r = compile(source); const original = r.PropertyPlanner.prototype.plan;
  r.PropertyPlanner.prototype.plan = function(...args) { calls++; return original.apply(this, args); };
  const loaded = compile(loader, { './property-lines-rules': r }, globals);
  const cancel = loaded.PropertyImages.prototype.cancel;
  loaded.PropertyImages.prototype.cancel = function(...args) { calls++; return cancel.apply(this, args); };
  const m = new (compile(mapText, {}, globals).MiniMap)({ roads: [] });
  compile(viewText, { './property-lines-rules': r, './property-lines-loader': loaded, './settings': {
    toggle() { const label = new Element(), box = new Element(); label.append(box); return box; },
  } }, globals).propertyLines(m, [624271, 5103301], true);
  calls = 0; trig = 0;
  assert.equal(m.underlay, null, 'off does not attach a property underlay');
  for (let i = 0; i < 60; i++) m.update(1 / 60, 0, 0, 0, [], []);
  assert.equal(calls, 0, 'off redraws never call property modules');
  assert.equal(trig, 16, 'off redraws retain only the ordinary north-marker trigonometry');
  document.getElementById('miniMapHead').listeners.click(); trig = 0;
  for (let i = 0; i < 60; i++) m.update(1 / 60, 0, 0, 0, [], []);
  assert.equal(calls, 0, 'folded off frames never idle property modules'); assert.equal(trig, 0);
  let idle = 0; m.underlay = { draw() { assert.fail('folded map cannot draw'); }, idle() { idle++; } };
  for (let i = 0; i < 60; i++) m.update(1 / 60, 0, 0, 0, [], []);
  assert.equal(idle, 1, 'an enabled folded map idles only on its visibility transition');
  m.underlay = null; document.getElementById('miniMapHead').listeners.click(); let hidden = 0;
  m.underlay = { draw() { assert.fail('CSS-hidden map cannot draw'); }, idle() { hidden++; } };
  for (let i=0;i<60;i++) m.update(1/60,0,0,0,[],[]);
  assert.equal(hidden,1,'a map inside closed Settings cancels only once');
}
await lifecycle(); offWork();
console.log('PASS controlled late fetch/decode, off, hidden, newer request, off-on identity, exact URL disposal; off redraws: zero property calls, 16 trig calls / 60 frames');
if (process.argv.includes('--mutations')) {
  for (const [name, file, from, to] of [
    ['request identity removed', 'rules', 'if (this.flight.get(request.key) === request) this.flight.delete(request.key);', 'this.flight.delete(request.key);'],
    ['pending URL disposal removed', 'loader', 'this.io.revokeURL(transfer.url); transfer.url = undefined;', 'transfer.url = undefined;'],
    ['cached URL disposal removed', 'loader', 'picture => io.revokeURL(picture.url)', 'picture => {}'],
    ['off bounds work restored', 'map', 'if (this.underlay && layerVisible) {', 'if (true) {'],
    ['permanent off underlay restored', 'view', `map.underlay = gate.enabled && mode === 'map' ? underlay : null;`, 'map.underlay = underlay;'],
    ['per-frame folded idle restored', 'map', 'if (!this.idle) { this.underlay?.idle(); this.idle = true; } return;', '{ this.underlay?.idle(); this.idle = true; } return;'],
  ]) {
    const text = { rules: source, loader, map, view }[file]; assert.equal(text.split(from).length, 2, 'unique anchor: ' + name);
    const mutant = text.replace(from, to);
    if (file === 'map' || file === 'view') assert.throws(() => offWork(file === 'map' ? mutant : map, file === 'view' ? mutant : view), { name: 'AssertionError' }, name);
    else await assert.rejects(() => lifecycle(file === 'rules' ? mutant : source, file === 'loader' ? mutant : loader), { name: 'AssertionError' }, name);
    console.log('KILLED ' + name);
  }
}

// Actual Three materials/textures: toggling and replacement must release the owned GPU image.
const { PropertyGround } = compile(readFileSync(new URL('../web/src/property-lines-ground.ts', import.meta.url), 'utf8'), { three: THREE });
const terrain = {group:new THREE.Group(), propertyOverlay:null};
const material = new THREE.ShaderMaterial({fragmentShader:'void main(){ vec3 col=vec3(0.0);\n  col = applyFog(col, vWorld, cameraPosition);\n}'});
terrain.group.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
const original = material.fragmentShader, overlay = new PropertyGround(terrain), firstImage = {}, secondImage = {};
let disposed = 0;
assert.equal(terrain.propertyOverlay, null);
overlay.show(firstImage, [10,20,30,40], {x:15,z:25});
const firstTexture = material.uniforms.propertyGroundImage.value;
firstTexture.addEventListener('dispose', () => disposed++);
assert.deepEqual(material.uniforms.propertyGroundRect.value.toArray(), [10,20,30,40]);
overlay.show(firstImage, [10,20,30,40], {x:16,z:26});
assert.equal(material.uniforms.propertyGroundImage.value, firstTexture, 'car motion reuses the current texture');
overlay.show(secondImage, [100,200,30,40], {x:115,z:225});
assert.equal(disposed, 1, 'image replacement disposes the preceding texture');
material.uniforms.propertyGroundImage.value.addEventListener('dispose', () => disposed++);
const patched = material.fragmentShader, kept = material.uniforms.propertyGroundImage.value;
material.needsUpdate = false; const version = material.version;
overlay.blank();
assert.equal(material.uniforms.propertyGroundOn.value, 0, 'pause or coverage gap stops painting');
assert.equal(material.fragmentShader, patched, 'pause keeps the patched shader (no recompile on resume)');
assert.equal(material.version, version, 'pause does not mark the land material for recompilation');
assert.equal(material.uniforms.propertyGroundImage.value, kept, 'pause keeps the current texture');
assert.equal(disposed, 1, 'pause disposes nothing');
overlay.show(secondImage, [100,200,30,40], {x:116,z:226});
assert.equal(material.uniforms.propertyGroundOn.value, 1, 'resume paints again');
assert.equal(material.version, version, 'resume does not recompile the land');
overlay.hide(); overlay.hide();
assert.equal(disposed, 2, 'off disposes the final texture exactly once');
assert.equal(material.fragmentShader, original, 'off restores the original terrain shader');
assert.equal(material.uniforms.propertyGroundImage, undefined, 'off retains no sampler');
assert.equal(terrain.propertyOverlay, null, 'off stops patching newly loaded terrain');
console.log('PASS ground texture reuse, replacement, pause without recompile, off disposal and original shader restoration');
