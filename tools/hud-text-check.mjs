// Node only. The old DOM expressions are frozen verbatim, not reconstructed from the new formatter.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from '../web/node_modules/esbuild/lib/main.js';

// Frozen from main 53bdb7e875c69dd409d55eadbf2c7d1c1c85d158, web/src/main.ts lines 897-914.
const oldSource = [
  "  if (!bare) {",
  "    // Behind the title card the readout said \"0 km/h off the map\" while the land was still loading: keep it out of sight.",
  "    hud.style.visibility = started ? '' : 'hidden';",
  "    if (mode === 'drive') {",
  "      hud.textContent = `${Math.abs(vehicle.speed * 3.6).toFixed(0)} km/h   ${vehicle.roadName ?? (yardSite?.surface(vehicle.x, vehicle.z) ? 'works yard' : homeSite?.surface(vehicle.x, vehicle.z) ? 'house yard' : 'off the map')}   ${vehicle.surfaceName}${vehicle.airborne ? '   AIR' : ''}` +",
  "        (touchDevice ? `   ${fps.toFixed(0)} fps${ride.jumpLine}`",
  "          : !mailMode ? ride.help : `\\nWASD/arrows: drive · space: brake · M/E: mail · C: photo · Esc/P: pause · Enter: end shift\\nH: horn · R: road · V: seat · F: fly · ${fps.toFixed(0)} fps`);",
  "    } else {",
  "      const e = camera.position.x + VE, n = VN - camera.position.z;",
  "      hud.textContent = `E ${e.toFixed(0)}  N ${n.toFixed(0)}  h ${camera.position.y.toFixed(1)} m   hills x${EXAG}\\n` +",
  "        `sun az ${sun.az.toFixed(0)} el ${sun.el.toFixed(0)}  tiles ${terrain.drawn}  load ${terrain.pending}  ${fps.toFixed(0)} fps\\n` +",
  "        `drag: look · WASD: fly · ${mailMode ? 'Q/E' : 'Q/space'}: down/up · wheel: speed ${flySpeed.toFixed(0)} m/s${SHOTS.length ? ` · 1-${SHOTS.length}: views` : ''} · F: drive`;",
  "    }",
  "    if (mailMode && mode === 'drive' && !touchDevice) hud.textContent += `\\n${shift.done}/${shift.stops} stops · ${mail.delivered} pieces delivered · ${mail.lawn + mail.ditch} on ground`;",
  "  }",
  "  if (towing?.reason && mode === 'drive' && !bare) hud.textContent += `\\nTrailer: ${towing.reason}`;",
  "  if (vehicle.atEdge && mode === 'drive' && !bare) hud.textContent += !mailMode ? '\\nThe map ends here.' : AREA.route ? '\\nEnd of your route. Somebody else delivers past here.' : '\\nEnd of this map.';",
  "  if (mailMode && params.has('lawn') && !bare) hud.textContent += `\\nTyre strips: ${shift.ruts.count} · Lawns damaged: ${shift.ruts.lawns}`;"
].join('\n');
const oldFrame = new Function('context', `with(context) { ${oldSource} }`);
// Keep the old oracle frozen. These exact edits describe the new player readout.
const expectedSource = oldSource
 .replace('   ${vehicle.surfaceName}', "${touchDevice ? '' : `   ${vehicle.surfaceName}`}")
 .replace('(touchDevice ? `   ${fps.toFixed(0)} fps${ride.jumpLine}`', '(touchDevice ? ride.jumpLine')
 .replace(': !mailMode ? ride.help :', ": drove >= 60 ? '' : !mailMode ? ride.help :")
 .replace('F: fly · ${fps.toFixed(0)} fps', 'F: drone')
 .replace('    } else {', "      if (!touchDevice) hud.textContent += ride.airLine || '';\n    } else {");
const speedSite = '${Math.abs(vehicle.speed * 3.6).toFixed(0)} km/h';
assert.equal(expectedSource.split(speedSite).length, 2);
const capExpectedSource = expectedSource.replace(speedSite, speedSite + '${touchDevice && mailMode && !scenePaused() && vehicle.activeTouchSpeedLimit > 0 ? ` ▸ LIMIT ${(vehicle.activeTouchSpeedLimit * 3.6).toFixed(0)}` : ""}');
// The day card and tally own these counts in all mail modes. Keep the frozen source intact.
const countLine = capExpectedSource.split('\n').find(line => line.includes('pieces delivered'));
assert.ok(countLine, 'frozen count row found');
const expectedFrame = new Function('context', `with(context) { ${capExpectedSource.replace(countLine, '')} }`);
const main = readFileSync(new URL('../web/src/main.ts', import.meta.url), 'utf8');
const source = readFileSync(new URL('../web/src/hud-text.ts', import.meta.url), 'utf8');
const start = main.indexOf('  if (!bare) {', main.indexOf('if (mailScore && !bare'));
const stop = main.indexOf('\n\n  requestAnimationFrame(frame);', start);
assert.ok(start > 0 && stop > start, 'production HUD block found');
const frameSource = main.slice(start, stop);
const initialState = main.match(/const hudState: HudState = ([\s\S]*?\n});/)[1];
const initState = new Function('context', `with(context) { return ${initialState}; }`);
function frameFor() {
  return new Function('context', `with(context) { ${frameSource} }`);
}
async function load(text) {
  const { code } = await transform(text, { loader: 'ts', format: 'esm', target: 'es2022' });
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const periodNames = await load(readFileSync(new URL('../web/src/eras/history-road-names.ts', import.meta.url), 'utf8'));
function element(initial = '') {
  let text = initial, writes = 0, reads = 0, fpsWrites = 0;
  const dataset = new Proxy({}, { set(target, key, value) { if (key === 'fps') fpsWrites++; target[key] = value; return true; } });
  return {
    style: {}, dataset, fpsWrites: () => fpsWrites,
    get textContent() { reads++; return text; },
    set textContent(value) { writes++; text = value; },
    inspect: () => ({ text, writes, reads }),
  };
}
function context(s, module, bare = false, started = true) {
  const ctx = {
    mode: s.mode, mailMode: s.mailMode, touchDevice: s.touchDevice, fps: s.fps, drove: s.hintsHidden ? 60 : 0, bare, started, stuntPark: null, scenePaused: () => !ctx.started,
    ERA: { id: s.era ?? 'today' }, historyRoadName: periodNames.historyRoadName,
    vehicle: { speed: s.speed, activeTouchSpeedLimit: s.activeTouchSpeedLimit, roadName: s.rawRoad, surfaceName: s.surfaceName, airborne: s.airborne, atEdge: s.atEdge, x: 3, z: 4 },
    yardSite: s.yard === null ? null : { surface: () => s.yard }, homeSite: s.home === null ? null : { surface: () => s.home },
    ride: { help: s.help, jumpLine: s.jumpLine, airLine: s.airLine ?? '' },
    camera: { position: { x: s.e - 100, z: 200 - s.n, y: s.height } }, VE: 100, VN: 200, EXAG: s.exag,
    sun: { az: s.sunAz, el: s.sunEl }, terrain: { drawn: s.drawn, pending: s.pending }, flySpeed: s.flySpeed,
    SHOTS: { length: s.views }, shift: { done: s.done, stops: s.stops, ruts: { count: s.ruts, lawns: s.lawns } },
    mail: { delivered: s.delivered, lawn: s.lawn, ditch: s.ditch }, towing: { reason: s.trailerReason }, AREA: { route: s.route },
    params: new URLSearchParams(s.showRuts ? 'lawn=0' : ''), hud: element('unchanged'), fleet: null, drone: { active: false, readout: () => 'DRONE' }, ...module,
  };
  // Execute the production initializer too: do not duplicate its wiring in the fixture.
  ctx.hudState = initState(ctx);
  return ctx;
}
const base = {
  mode: 'drive', mailMode: true, touchDevice: true, fps: 60, speed: 0, activeTouchSpeedLimit: 0, roadName: 'off the map', rawRoad: undefined,
  surfaceName: 'gravel', airborne: false, help: '\nWASD: drive · V: seat', jumpLine: '', e: 123.6, n: -456.7,
  height: 12.35, exag: 1.5, sunAz: 234.6, sunEl: -3.5, drawn: 12, pending: 3, flySpeed: 25.5, views: 0,
  done: 2, stops: 11, delivered: 7, lawn: 3, ditch: 4, trailerReason: '', atEdge: false, route: false,
  showRuts: false, ruts: 6, lawns: 2, yard: null, home: null,
};
function verifyState(s, module, frame, integration = false) {
  const before = context(s, module); expectedFrame(before);
  const expected = before.hud.inspect().text;
  const actual = module.hudLine(s);
  if (actual !== expected) assert.equal(actual, expected, 'formatter parity: ' + JSON.stringify(s));
  if (s.brand === 'just' && !s.mailMode) assert.doesNotMatch(actual, /\b(mail|post|route|shift|carrier|delivery)\b/i);
  if (integration) {
    const after = context(s, module); frame(after);
    if (after.hud.inspect().text !== expected) assert.equal(after.hud.inspect().text, expected, 'actual frame adapter parity: ' + JSON.stringify(s));
    assert.equal(after.hud.inspect().reads, 0, 'frame never reads DOM text');
    assert.equal(after.hud.inspect().writes, 1, 'frame writes once');
  }
}
function writes(module) {
  const s = { ...base, debugFps: true }, hud = element();
  for (let i = 0; i < 120; i++) module.setHud(hud, module.hudLine(s));
  assert.deepEqual(hud.inspect(), { text: module.hudLine(s), writes: 1, reads: 0 }, '120 stable frames');
  const changed = element();
  for (let i = 0; i < 120; i++) { s.fps = 60 + Math.floor(i / 10); module.setHud(changed, module.hudLine(s)); }
  assert.equal(changed.inspect().writes, 12, 'one write per changed FPS digit');
  assert.equal(changed.inspect().reads, 0);
  const every = element();
  for (let i = 0; i < 120; i++) { s.fps = 60 + i % 2; module.setHud(every, module.hudLine(s)); }
  assert.equal(every.inspect().writes, 120, 'every-frame FPS change'); assert.equal(every.inspect().reads, 0);
  const second = element(); module.setHud(second, module.hudLine(s)); assert.equal(second.inspect().writes, 1, 'cache per element');
  module.setHud(second, 'preview'); module.setHud(second, module.hudLine(s)); assert.equal(second.inspect().writes, 3, 'another writer cannot stale the cache');
  const empty = element(); module.setHud(empty, ''); module.setHud(empty, ''); assert.equal(empty.inspect().writes, 1, 'first empty string is written');
}
// One context kept over many frames, with values that change between frames. The per-state runs above start
// from a fresh state each time, so only this part sees a field that main.ts stops refreshing in the reused
// hudState (a frozen fps number, a trailer reason that never clears, counters read once).
function sequence(module, frame) {
  let seed = 20261112, frames = 0;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32, pick = list => list[Math.floor(rnd() * list.length)];
  const numbers = [0, .5, 1.5, 2.5, -.5, -2.5, .1389, -12.5, 27.77, 59.5, 60.49999, 123.45];
  const names = [undefined, null, '', 'Track', 'Mabou Ridge Rd', ' lead', 'a\nb'];
  for (let session = 0; session < 1500; session++) {
    const s = { ...base, mailMode: rnd() < .5, touchDevice: rnd() < .5, route: rnd() < .5, showRuts: rnd() < .5, views: pick([0, 9]),
      yard: pick([null, false, true]), home: pick([null, true]) };
    const bare = rnd() < .06, old = context(s, module, bare), now = context(s, module, bare);
    for (let f = 0; f < 40; f++) {
      const edits = [], set = edit => edits.push(edit);
      if (rnd() < .3) { const v = pick(['drive', 'fly']); set(c => { c.mode = v; }); }
      if (rnd() < .5) { const v = pick(numbers.filter(n => n >= 0)); set(c => { c.fps = v; }); }
      if (rnd() < .5) { const v = pick(numbers) * pick([1, 1 / 3.6]); set(c => { c.vehicle.speed = v; }); }
      if (rnd() < .4) { const v = pick(names); set(c => { c.vehicle.roadName = v; }); }
      if (rnd() < .3) { const v = pick(['gravel', 'asphalt', '']); set(c => { c.vehicle.surfaceName = v; }); }
      if (rnd() < .3) { const v = rnd() < .5; set(c => { c.vehicle.airborne = v; }); }
      if (rnd() < .3) { const v = rnd() < .5; set(c => { c.vehicle.atEdge = v; }); }
      if (rnd() < .3) { const help = pick(['\nWASD: drive', '', '\nWASD · ⇧\nAir 2.4 s']), jump = pick(['', ' · Air 2.4 s · 19 m · clean']); set(c => { c.ride = { help, jumpLine: jump }; }); }
      if (rnd() < .5) { const x = pick(numbers), z = pick(numbers) * pick([1, 1000]), y = pick(numbers); set(c => { c.camera.position.x = x; c.camera.position.z = z; c.camera.position.y = y; }); }
      if (rnd() < .3) { const az = pick(numbers), el = pick(numbers); set(c => { c.sun.az = az; c.sun.el = el; }); }
      if (rnd() < .3) { const drawn = Math.floor(rnd() * 90), pending = Math.floor(rnd() * 9); set(c => { c.terrain.drawn = drawn; c.terrain.pending = pending; }); }
      if (rnd() < .2) { const v = pick([2, 40, 49.5, 62.5]); set(c => { c.flySpeed = v; }); }
      if (rnd() < .3) { const done = Math.floor(rnd() * 12), stops = Math.floor(rnd() * 12), count = Math.floor(rnd() * 30), lawns = Math.floor(rnd() * 5); set(c => { c.shift.done = done; c.shift.stops = stops; c.shift.ruts.count = count; c.shift.ruts.lawns = lawns; }); }
      if (rnd() < .3) { const delivered = Math.floor(rnd() * 40), lawn = Math.floor(rnd() * 5), ditch = Math.floor(rnd() * 5); set(c => { c.mail.delivered = delivered; c.mail.lawn = lawn; c.mail.ditch = ditch; }); }
      if (rnd() < .25) { const v = pick([null, '', 'No room to attach the trailer here.', 'Too steep']); set(c => { c.towing = v === null ? null : { reason: v }; }); }
      if (rnd() < .1) { const v = rnd() < .5; set(c => { c.started = v; }); }
      for (const c of [old, now]) for (const edit of edits) edit(c);   // about one frame in ten repeats the state exactly
      expectedFrame(old); frame(now); frames++;
      // Counts moved off the hint text. The shared adapter must still track every live value.
      if (!bare) assert.deepEqual([now.hudState.done, now.hudState.stops, now.hudState.delivered, now.hudState.lawn, now.hudState.ditch],
        [now.shift.done, now.shift.stops, now.mail.delivered, now.mail.lawn, now.mail.ditch], 'live counter adapter');
      const want = old.hud.inspect().text, got = now.hud.inspect().text;
      if (got !== want) assert.equal(got, want, `frame ${f} of session ${session}: ${JSON.stringify({ mailMode: s.mailMode, touchDevice: s.touchDevice, mode: now.mode })}`);
      if (now.hud.style.visibility !== old.hud.style.visibility) assert.fail('HUD visibility differs');
    }
    assert.ok(now.hud.inspect().writes <= old.hud.inspect().writes && now.hud.inspect().reads === 0, 'never more writes, never a read');
  }
  return frames;
}
function caps(module, frame) {
  for (const mailMode of [false, true]) for (const touchDevice of [false, true])
  for (const mode of ['drive', 'fly']) for (const activeTouchSpeedLimit of [0, 100 / 3.6, 90 / 3.6, 75 / 3.6, 55 / 3.6, 50 / 3.6]) {
    const s = { ...base, mailMode, touchDevice, mode, speed: 90 / 3.6, activeTouchSpeedLimit };
    verifyState(s, module, frame, true);
    assert.equal(module.hudLine(s).includes('LIMIT'), mailMode && touchDevice && mode === 'drive' && activeTouchSpeedLimit > 0);
  }
  const c = context({ ...base, speed: 90 / 3.6 }, module);
  for (const limit of [90 / 3.6, 0, 100 / 3.6, 0]) {
    c.vehicle.activeTouchSpeedLimit = limit; frame(c);
    assert.equal(c.hud.inspect().text.includes('LIMIT'), limit > 0, 'marker follows the reused frame state');
  }
  c.vehicle.activeTouchSpeedLimit = 90 / 3.6; c.started = false; frame(c);
  assert.equal(c.hud.inspect().text.includes('LIMIT'), false, 'paused scene hides held telemetry');
  c.started = true; frame(c);
  assert.equal(c.hud.inspect().text.includes('LIMIT'), true, 'running scene can show held telemetry again');
}
const module = await load(source), frame = frameFor();
for (const mailMode of [false,true]) {
 const s={...base,mailMode,touchDevice:false};
 assert.doesNotMatch(module.hudLine(s), /fps/);
 assert.match(module.hudLine({...s,debugFps:true}), /60 fps/);
 const c=context(s,module);c.drove=59.99;frame(c);assert.match(c.hud.inspect().text,/WASD/);
 c.drove=60;frame(c);assert.doesNotMatch(c.hud.inspect().text,/WASD/);
 assert.equal(c.hud.dataset.fps,'60','diagnostic rate stays available');
 for(let i=0;i<120;i++)frame(c);
 assert.equal(c.hud.fpsWrites(),1,'stable FPS writes its data attribute once');
 c.fps=42;frame(c);assert.equal(c.hud.dataset.fps,'42','diagnostic rate stays live');
 assert.equal(c.hud.fpsWrites(),2,'changed FPS writes its data attribute once');
 assert.match(module.hudLine({...c.hudState,hintsHidden:false}), /WASD/,'pause restores keys');
}

function airFeedback(module, frame) {
 for (const mailMode of [false, true]) for (const pad of [false, true]) {
  const airLine='\nAir 2.4 s · 19 m · 1 backflip · clean';
  const s={...base,mailMode,touchDevice:false,hintsHidden:true,airLine};
  const c=context(s,module);c.ride.padHelp='\nRT: drive';
  c.hudState.padHelp=pad?c.ride.padHelp:'';frame(c);
  assert.equal(c.hudState.hintsHidden,true);
  assert.match(c.hud.inspect().text,/\nAir 2\.4 s · 19 m · 1 backflip · clean/,'jump result survives hidden keys');
  assert.doesNotMatch(c.hud.inspect().text,/WASD|RT: drive/);
  c.drove=0;frame(c);
  assert.equal(c.hud.inspect().text.split(airLine).length-1,1,'jump result appears once with hints');
  c.ride.airLine='';frame(c);
  assert.doesNotMatch(c.hud.inspect().text,/Air 2\.4/,'expired jump feedback clears');
 }
}
airFeedback(module, frame);

{
  const c=context(base,module);c.stuntPark={hudLine:'gap-tanks: CLEAN'};
  for(let i=0;i<120;i++)frame(c);
  assert.equal(c.hud.inspect().text.split('gap-tanks: CLEAN').length-1,1,'one visible clean verdict after repeated frames');
  assert.equal(c.hud.inspect().reads,0,'verdict uses the shared write cache');
  c.stuntPark.hudLine='gap-tanks: FAILED · contact';frame(c);
  assert.ok(c.hud.inspect().text.includes('FAILED · contact'),'failed verdict is visible');
  c.stuntPark.hudLine='';frame(c);
  assert.ok(!c.hud.inspect().text.includes('gap-tanks:'),'expired verdict is removed');
}
caps(module, frame);
console.log('PASS phone-only active limiter marker, all modes, clearing and reused HUD adapter');
for (const [rawRoad, expected] of [['Highway 19', 'Post Road'], ['Highway 252', 'Road to Whycocomagh'], ['Highway 104', 'cart road']]) {
  const era = context({ ...base, era: '1884', rawRoad, mailMode: false }, module); frame(era);
  assert.equal(era.hudState.roadName, expected, 'actual era frame uses the shared period road names');
  assert.equal(era.vehicle.roadName, rawRoad, 'formatting must not rename source road data');
  const today = context({ ...base, rawRoad, mailMode: false }, module); frame(today);
  assert.equal(today.hudState.roadName, rawRoad, 'today keeps its original road name');
}
console.log('PASS actual frame period road names and unchanged today/source names');

let states = 0, adapters = 0;
const vehicles = ['car', 'truck', 'sxs', 'bike'];
const roads = [undefined, null, '', 'Track', 'A very long winding road through the hills '.repeat(4), '<Track> & "Turn" \'Lane\''];
for (const mailMode of [false, true]) for (const mode of ['drive', 'fly']) for (const touchDevice of [false, true])
for (const brand of ['mail', 'just']) for (const vehicle of vehicles) for (let bits = 0; bits < 128; bits++)
for (const fps of [0, 29.49, 60.5]) for (const speed of [0, -12.5, .1389, 27.77]) for (const rawRoad of roads) {
  const jump = bits & 2 ? '\nAir 2.4 s · 19 m · 1 backflip · clean' : '';
  const s = { ...base, brand, mailMode, mode, touchDevice, fps, speed, rawRoad,
    surfaceName: bits & 1 ? 'asphalt' : 'gravel', airborne: !!(bits & 1),
    help: `\nWASD: drive · ${vehicle} · ${brand === 'just' ? '⇧' : 'Shift'}`, airLine: jump,
    jumpLine: jump ? ' · ' + jump.slice(1) : '', trailerReason: bits & 4 ? 'Too steep & uneven' : undefined,
    atEdge: !!(bits & 8), route: !!(bits & 16), showRuts: !!(bits & 32), views: bits & 64 ? 9 : 0,
  };
  // Missing road names exercise both yard fallbacks as well as off-map; empty names stay empty.
  s.yard = bits & 16 ? true : bits & 8 ? false : null; s.home = bits & 32 ? true : null;
  s.roadName = rawRoad ?? (s.yard ? 'works yard' : s.home ? 'house yard' : 'off the map');
  const integration = fps === 0 && speed === 0;
  verifyState(s, module, frame, integration); states++; if (integration) adapters++;
}
writes(module);
// Title, interior and ending frames keep the same text when the HUD block runs; early returns are untouched.
for (const started of [false, true]) for (const bare of [false, true]) for (const mode of ['drive', 'fly']) {
  const s = { ...base, mode, showRuts: true, atEdge: true, trailerReason: 'Too steep' };
  const before = context(s, module, bare, started), after = context(s, module, bare, started);
  expectedFrame(before); frame(after);
  assert.equal(after.hud.inspect().text, before.hud.inspect().text);
  assert.deepEqual(after.hud.style, before.hud.style);
  assert.equal(after.hud.inspect().writes, bare ? 0 : 1);
}
// Ride getters can have side effects (bikeJump UI). Preserve their lazy access on every frame, even a cache hit.
for (const mode of ['drive', 'fly']) for (const mailMode of [false, true]) for (const touchDevice of [false, true]) {
  const ctx = context({ ...base, mode, mailMode, touchDevice }, module); let help = 0, jump = 0;
  ctx.ride = { get help() { help++; return base.help; }, get jumpLine() { jump++; return ''; } };
  for (let i = 0; i < 2; i++) frame(ctx);
  assert.equal(help, mode === 'drive' && !touchDevice && !mailMode ? 2 : 0);
  assert.equal(jump, mode === 'drive' && touchDevice ? 2 : 0);
}
const oldRest = context(base, module); for (let i = 0; i < 120; i++) oldFrame(oldRest);
assert.equal(oldRest.hud.inspect().writes, 120);
const full = { ...base, touchDevice: false, atEdge: true, showRuts: true, trailerReason: 'Too steep' };
const oldFull = context(full, module); for (let i = 0; i < 120; i++) oldFrame(oldFull);
assert.equal(oldFull.hud.inspect().writes, 600); assert.equal(oldFull.hud.inspect().reads, 480);
const newFull = context(full, module); for (let i = 0; i < 120; i++) frame(newFull);
assert.equal(newFull.hud.inspect().writes, 1); assert.equal(newFull.hud.inspect().reads, 0);
const sequenceFrames = sequence(module, frame);
function fleetFrames(module, frame) {
  for (const touchDevice of [false, true]) {
    const ctx = context({ ...base, mailMode: false, touchDevice }, module);
    ctx.fleet = { message: '', driven: { id: 'truck', entry: { name: 'Pickup' } }, handbrake: true };
    for (let i = 0; i < 120; i++) frame(ctx);
    assert.match(ctx.hud.inspect().text, /Handbrake on · Pickup$/);
    if (touchDevice) assert.equal(ctx.hud.inspect().text, '0 km/h · Handbrake on · Pickup');
    assert.equal(ctx.hud.inspect().writes, 1, 'stable fleet frames use the shared cache');
    ctx.fleet.driven.entry.name = 'Side by side'; ctx.fleet.handbrake = false; frame(ctx);
    assert.match(ctx.hud.inspect().text, /Side by side$/);
    ctx.fleet.message = 'Move the dirt bike clear of the ramp'; frame(ctx);
    assert.match(ctx.hud.inspect().text, /Move the dirt bike clear of the ramp$/);
    ctx.mode = 'fly'; frame(ctx); assert.doesNotMatch(ctx.hud.inspect().text, /Move the dirt bike/);
    ctx.mode = 'drive'; ctx.fleet = null; frame(ctx);
    assert.doesNotMatch(ctx.hud.inspect().text, /Pickup|Side by side|Move the dirt bike/);
    assert.equal(ctx.hud.inspect().reads, 0, 'fleet updates never read DOM text');
  }
}
fleetFrames(module, frame);
// The drone: its readout replaces the free camera's lines while it flies (keys on a desktop, the bare readout on a
// phone), and the reused state clears when it lands.
function droneFrames(module, frame) {
  for (const touchDevice of [false, true]) for (const mailMode of [false, true]) {
    const ctx = context({ ...base, mode: 'fly', mailMode, touchDevice }, module);
    let line = 'DRONE   height 12 m   distance 85 m   9 m/s (max 15)';
    ctx.drone = { active: true, readout: () => line };
    frame(ctx);
    const text = ctx.hud.inspect().text;
    assert.ok(text.startsWith(line), 'drone readout: ' + text);
    assert.equal(text.includes('R: fly back · F: land'), !touchDevice, 'desktop drone keys');
    assert.doesNotMatch(text, /sun az|tiles/, 'no free camera lines while the drone flies');
    line = 'DRONE   height 3 m   distance 0 m   returning'; frame(ctx);
    assert.ok(ctx.hud.inspect().text.startsWith(line), 'the readout follows the drone');
    ctx.drone.active = false; frame(ctx);
    assert.match(ctx.hud.inspect().text, /^E -?\d+  N/, 'a fixed view after the drone shows the free camera lines');
    ctx.mode = 'drive'; frame(ctx);
    assert.doesNotMatch(ctx.hud.inspect().text, /DRONE/, 'driving shows no drone');
  }
}
droneFrames(module, frame);
console.log('PASS drone readout replaces the free camera lines, desktop keys, phone readout, clears on landing');
console.log('PASS fleet selection, handbrake and refusal lines follow live state and share the HUD cache');
console.log(`PASS ${sequenceFrames} frames in 1,500 kept contexts with changing values: the player readout in every frame`);
console.log(`PASS ${states} frozen-old states with explicit player text changes; ${adapters} actual frame adapter states; bare/title guards and lazy ride hooks`);
console.log('PASS 120 rest frames: old 120 writes, new 1; all optional lines: old 600 writes/480 reads, new 1 write/0 reads');
console.log('PASS changing FPS: 12 writes for 12 values, 120 for 120 changes; zero DOM text reads; per-element/shared-writer cache');
if (process.argv.includes('--mutations')) {
  const fleetAnchor = 'if (s.fleetLine && s.mode';
  assert.ok(source.includes(fleetAnchor));
  const badFleet = await load(source.replace(fleetAnchor, 'if (false && s.fleetLine && s.mode'));
  assert.throws(() => fleetFrames(badFleet, frame), undefined, 'dropped fleet formatter line must fail');
  const fleetWiring = frameSource.match(/^.*hudState\.fleetLine =.*$/m)[0];
  const staleFleet = new Function('context', `with(context) { ${frameSource.replace(fleetWiring, '')} }`);
  assert.throws(() => fleetFrames(module, staleFleet), undefined, 'stale fleet binding must fail');
  console.log('KILLED fleet formatter and selection-wiring faults');
  const optional = source.slice(source.indexOf('  if (s.trailerReason'), source.indexOf('  if (s.mailMode && s.showRuts)'));
  const split = optional.indexOf('  if (s.atEdge');
  const trailer = optional.slice(0, split), edge = optional.slice(split);
  const mutations = [
    ['limit marker always shown', "activeTouchSpeedLimit > 0 ?", "true ?"],
    ['limit marker never shown', "activeTouchSpeedLimit > 0 ?", "false ?"],
    ['debug FPS removed', 's.debugFps ? `   ${s.fps.toFixed(0)} fps`', "false ? `   ${s.fps.toFixed(0)} fps`"],
    ['air feedback dropped', "(s.airLine || '')", "''"],
    ['key hints never hide', "s.hintsHidden ? '' :", "false ? '' :"],
    ['part dropped', trailer, ''],
    ['parts swapped', optional, edge + trailer],
    ['wrong cache comparison', 'lastText.get(hud) === text', 'lastText.get(hud) !== undefined'],
    ['DOM += left in', 'hud.textContent = text;', 'hud.textContent += text;'],
  ];
  for (const [name, from, to] of mutations) {
    assert.equal(source.split(from).length, 2, name + ' unique source site');
    const bad = await load(source.replace(from, to));
    assert.throws(() => { caps(bad, frameFor()); verifyState(full, bad, frameFor(), true); verifyState({ ...base, mailMode: false, touchDevice: false }, bad, frameFor(), true); verifyState({ ...base, touchDevice: false, hintsHidden: true }, bad, frameFor(), true); writes(bad); airFeedback(bad, frameFor()); }, undefined, name + ' must fail');
    console.log('KILLED ' + name);
  }  // Wiring faults in the frame block of main.ts: a field of the reused state that is no longer refreshed.
  const wiring = [
    ['air feedback not refreshed', "      hudState.airLine = touchDevice ? '' : ride.airLine;", ''],
    ['fps and mode not refreshed', 'hudState.mode = mode; hudState.fps = fps;', ''],
    ['limit not refreshed', ' hudState.activeTouchSpeedLimit = scenePaused() ? 0 : vehicle.activeTouchSpeedLimit;', ''],
    ['paused limit remains visible', 'scenePaused() ? 0 : vehicle.activeTouchSpeedLimit', 'vehicle.activeTouchSpeedLimit'],
    ['speed not refreshed', 'hudState.speed = vehicle.speed;', ''],
    ['fly speed not refreshed', ' hudState.flySpeed = flySpeed;', ''],
    ['trailer reason never clears', 'hudState.trailerReason = towing?.reason;', 'if (towing?.reason) hudState.trailerReason = towing.reason;'],
    ['map edge line sticks', 'hudState.atEdge = vehicle.atEdge;', 'hudState.atEdge ||= vehicle.atEdge;'],
    ['counters not refreshed', 'hudState.delivered = mail.delivered;', ''],
    ['drone readout not refreshed', "hudState.drone = drone.active ? drone.readout(touchDevice) : '';", ''],
    ['drone readout never clears', "hudState.drone = drone.active ? drone.readout(touchDevice) : '';", 'if (drone.active) hudState.drone = drone.readout(touchDevice);'],
  ];
  for (const [name, from, to] of wiring) {
    assert.equal(frameSource.split(from).length, 2, name + ' unique source site');
    const bad = new Function('context', `with(context) { ${frameSource.replace(from, to)} }`);
    assert.throws(() => { caps(module, bad); sequence(module, bad); droneFrames(module, bad); airFeedback(module, bad); }, undefined, name + ' must fail');
    console.log('KILLED ' + name);
  }
}
