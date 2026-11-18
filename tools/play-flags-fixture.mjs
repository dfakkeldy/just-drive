// Run the real frame and input callbacks. Normal checks use editable expectations, never git history.
// node tools/play-flags-fixture.mjs [--audit 9271608] [--mutations]
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import ts from '../web/node_modules/typescript/lib/typescript.js';
import { transformSync } from '../web/node_modules/esbuild/lib/main.js';
import { current, spy } from './world-update-fixture.mjs';

// Recorded by this fixture on main 9271608 before G17. dt is seconds at now=1050, last=1000.
// null means the frame returns before that consumer runs. Ending frames retain the previous damage value.
// name, overrides, dt, damage, playing (minimap/radio), road pause, shift clock dt
const recorded = [
  ['title card', { started: false }, 0, false, false, true, 0],
  ['hidden tab', { hidden: true }, 0, true, true, true, .05],
  ['interior', { inside: true }, .05, false, null, true, .05],
  ['ending', { ending: true }, 0, true, null, true, null],
  ['places panel', { panel: true, started: false, mailMode: false }, 0, false, false, true, 0],
  ['scene paused by title', { started: false, paused: true }, 0, false, false, true, 0],
  ['fly', { fly: true }, .05, false, false, false, .05],
  ['drive before started', { started: false }, 0, false, false, true, 0],
  ['drive after started', {}, .05, true, true, false, .05],
  ['shift ended', { ended: true }, 0, false, false, true, 0],
  ['panel busy with started', { panel: true }, .05, true, true, false, .05],
  ['waiting for pedal', { waiting: true }, .05, false, true, false, .05],
  ['demo', { demo: true }, .05, false, true, false, .05],
  ['explore', { mailMode: false }, .05, false, true, false, .05],
  ['road initially paused', { paused: true }, .05, true, true, false, .05],
  ['requested mail/photo before started', { started: false, mailRequested: true, photoRequested: true }, 0, false, false, true, 0],
  ['requested mail/photo while driving', { mailRequested: true, photoRequested: true }, .05, true, true, false, .05],
  ['requested mail/photo in fly mode', { fly: true, mailRequested: true, photoRequested: true }, .05, false, false, false, .05],
  ['M mail key before started', { started: false, mailKey: 'KeyM' }, 0, false, false, true, 0],
  ['E mail key before started', { started: false, mailKey: 'KeyE' }, 0, false, false, true, 0],
  ['focused Space before started', { started: false, mailKey: 'Space', mailFocused: true }, 0, false, false, true, 0],
  ['unfocused Space before started', { started: false, mailKey: 'Space' }, 0, false, false, true, 0],
  ['mail pointer before started', { started: false, mailPointer: true }, 0, false, false, true, 0],
  ['demo mail throw', { demo: true, demoThrow: true }, .05, false, true, false, .05],
  ['demo relief test', { demo: true, reliefTest: 1 }, .05, false, true, false, .05],
];
function observe(source, state, transition) {
  let dt;
  // Instrument only the value assigned to dt, not the expression that computes it.
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const frame = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'frame');
  let declaration;
  function find(n) {
    if (ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === 'dt')) declaration = n;
    ts.forEachChild(n, find);
  }
  find(frame); assert.ok(declaration, 'frame dt declaration');
  const instrumented = source.slice(0, declaration.end) + '\nplayProbe(dt);' + source.slice(declaration.end);
  const result = spy(instrumented, !!state.ending, state.dev ?? true, false, (c, trace) => {
    c.playProbe = value => { dt = value; };
    c.started = state.started ?? true; c.mode = state.fly ? 'fly' : 'drive';
    c.document.hidden = !!state.hidden; c.interiors.busy = !!state.inside;
    c.shift.ended = !!state.ended; c.placesUI.busy = !!state.panel;
    c.mailMode = state.mailMode ?? true; c.demo = state.demo ? 1 : 0; c.drove = c.demo;
    c.waitingToDrive = !!state.waiting;
    c.mailRequested = !!state.mailRequested; c.photoRequested = !!state.photoRequested;
    if (state.mailKey) c.keys.add(state.mailKey);
    if (state.mailFocused) { c.mailButton = { hidden: false }; c.document.activeElement = c.mailButton; }
    if (state.mailPointer) c.mailPointers.add(1);
    if (state.demoThrow) {
      c.params.set('throw', '1'); c.drove = 0;
      c.autopilot = () => ({ throttle: 0, steer: 0, handbrake: true });
    }
    c.reliefTest = state.reliefTest ?? 0;
    c.shift.takePhoto = trace('shift.photo');
    c.vehicle.damageActive = true; // Detect assignment skipped by the ending early return.
    c.sunShadows = null;
    c.picture = { measuring: true, frame: trace('picture') };
    c.roadScene.paused = !!state.paused;
    c.roadScene.setPaused = value => { c.roadScene.paused = value; trace('roadScene.pause')(value); };
    c.shift.end = () => { c.shift.ended = true; };
    c.driveVehicle = value => {
      trace('driveVehicle')(value);
      if (transition === 'ending during drive') c.endings.busy = true;
    };
    if (transition === 'shift ends during update') c.shift.update = value => { trace('shift')(value); c.shift.ended = true; };
    if (transition === 'report ends shift') c.params.set('report', '1');
    if (transition === 'indoor day ends') c.shift.updateIndoors = value => { trace('shift.indoors')(value); return true; };
    c.interiors.closeForDay = () => { c.interiors.busy = false; };
    c.touch = { steer: 0, throttle: 0 };
  });
  const first = (name, i = 0) => result.args[name]?.[0]?.[i] ?? null;
  for (const args of result.args['shift.photo'] ?? []) {
    assert.equal(args[0], result.context.vehicle, 'photo uses the real frame vehicle');
    assert.equal(args[1], result.context.camera, 'photo uses the real frame camera');
  }
  return {
    dt, damage: result.context.vehicle.damageActive, playing: first('miniMap.show'),
    roadPaused: first('roadScene.pause'), clock: first(state.inside ? 'shift.indoors' : 'shift'),
    picturePaused: first('picture', 1), enterEnabled: first('interiors', 3), pad: first('pad.show'),
    placesEnabled: first('placesUI', 1), journeyRuns: first('journey', 1),
    phoneActive: first('phoneMailHud', 2), multiplayerActive: first('multiplayer', 2),
    mailRequest: first('mail', 2), photos: result.args['shift.photo']?.length ?? 0,
    reliefClock: first('relief', 1), reliefEnabled: first('relief', 3),
    radioPlaying: first('radio'), radioIndoor: first('radio', 1),
  };
}
function expected(s) {
  const started = s.started ?? true, ended = !!s.ended, hidden = !!s.hidden, inside = !!s.inside;
  const ending = !!s.ending, drive = !s.fly, panel = !!s.panel;
  const clock = started && !ended, playing = drive && clock;
  const dt = clock && !ending && !hidden ? .05 : 0;
  const paused = !clock || ending || hidden || inside;
  const mailInput = !!(s.mailRequested || s.mailKey === 'KeyM' || s.mailKey === 'KeyE'
    || s.mailKey === 'Space' && s.mailFocused || s.mailPointer || s.demoThrow);
  return {
    dt, damage: ending || !!((s.mailMode ?? true) && playing && !inside && !s.demo && !s.waiting),
    playing: ending || inside ? null : playing, roadPaused: paused,
    clock: ending ? null : clock ? .05 : 0,
    picturePaused: ending ? null : !clock || hidden || inside,
    enterEnabled: ending ? null : inside ? false : playing,
    pad: ending ? false : inside ? !ended : drive && !ended && !panel,
    placesEnabled: ending || inside ? null : drive && started,
    journeyRuns: ending || inside ? null : drive && started && !panel,
    phoneActive: ending || inside ? null : drive && !paused,
    multiplayerActive: ending || inside ? null : dt > 0 && drive,
    // Mail requests deliberately omit started; photos use only mode after the early returns.
    mailRequest: ending || inside || ended ? null : drive && mailInput,
    photos: !ending && !inside && drive && s.photoRequested ? 1 : 0,
    reliefClock: ending || inside ? null : playing ? 6 : 0,
    reliefEnabled: ending || inside ? null : playing && (!s.demo || (s.reliefTest ?? 0) > 0),
    radioPlaying: ending || inside ? false : playing, radioIndoor: ending || inside,
  };
}
function states() {
  const all = recorded.map(([name, s]) => [name, s]);
  // All combinations include deliberately independent inputs, so similar meanings cannot collapse unnoticed.
  const keys = ['started', 'ended', 'hidden', 'inside', 'ending', 'fly', 'panel', 'mailMode', 'demo', 'waiting', 'mailRequested'];
  for (let bits = 0; bits < 1 << keys.length; bits++) {
    const s = Object.fromEntries(keys.map((key, bit) => [key, !!(bits & 1 << bit)]));
    s.photoRequested = s.mailRequested;
    all.push(['combination ' + bits, s]);
  }
  return all;
}
function events(source, s) {
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const helper = ast.statements.filter(n => ts.isFunctionDeclaration(n) && ['live', 'scenePaused'].includes(n.name?.text));
  const keydown = ast.statements.find(n => ts.isExpressionStatement(n) && n.getText(ast).startsWith("addEventListener('keydown',"));
  const honk = ast.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === 'honk'));
  // The drone's own keys (while it flies, C, R and the rest belong to it), when main.ts has them.
  const droneKeys = ast.statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === 'DRONE_KEYS'));
  const compiled = transformSync([...helper, ...droneKeys, keydown, honk].map(n => n.getText(ast)).join('\n'), { loader: 'ts' }).code;
  let listener, horns = 0, home = 0, resets = 0;
  const c = {
    started: s.started ?? true, shift: { ended: !!s.ended }, endings: { busy: !!s.ending }, fleet: s.fleetBusy ? { busy: true } : null,
    interiors: { busy: !!s.inside }, document: { hidden: !!s.hidden }, mode: s.fly ? 'fly' : 'drive',
    addEventListener: (_name, fn) => { listener = fn; }, ownedByControl: () => false, typing: () => false, mailMode: true,
    photoRequested: false, keys: new Set(), SHOTS: [], animals: { honk: () => { horns++; } },
    roadScene: { honk() {} }, roadAnimals: null, multiplayer: null, ride: { honk() {} }, vehicle: { respawn: () => { resets++; } }, pause: { blocked: false },
    drone: { active: !!s.drone }, droneHome: () => { home++; },
  };
  new Function('context', `with(context) { ${compiled}; honk(); }`)(c);
  listener({ code: 'KeyC', key: 'c', repeat: false, preventDefault() {} });   // C is the photo key; P pauses
  if (!s.drone) return { photo: c.photoRequested, horns };
  // While the drone flies, R flies it home instead of putting the car back on the road.
  listener({ code: 'KeyR', key: 'r', repeat: false, preventDefault() {} });
  return { photo: c.photoRequested, horns, home, resets, down: c.keys.has('KeyC') };
}
export function verifyPlayFlags(source, table = false) {
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const frame = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'frame');
  const flagNames = new Set(['frameLive', 'clockRuns', 'worldRuns', 'driving', 'roadPaused', 'playing',
    'picturePaused', 'damageActive', 'placesEnabled', 'journeyRuns', 'mailControls', 'padVisible']);
  const flags = [];
  function allocations(n) {
    assert.ok(![ts.SyntaxKind.NewExpression, ts.SyntaxKind.ArrayLiteralExpression, ts.SyntaxKind.ObjectLiteralExpression,
      ts.SyntaxKind.ArrowFunction, ts.SyntaxKind.FunctionExpression].includes(n.kind), 'play flags allocate no per-frame objects or closures');
    if (ts.isCallExpression(n)) assert.equal(n.expression.getText(ast), 'live', 'flags only call the plain boolean helper');
    ts.forEachChild(n, allocations);
  }
  function declarations(n) {
    if (ts.isVariableDeclaration(n) && flagNames.has(n.name.getText(ast))) { flags.push(n); allocations(n.initializer); }
    ts.forEachChild(n, declarations);
  }
  declarations(frame);
  if (source.includes('const frameLive =')) {
    assert.equal(flags.length, flagNames.size, 'each flag is declared once');
    const clock = source.indexOf('const clockDt =', frame.getStart(ast));
    assert.ok(flags.every(n => n.end < clock), 'all play flags precede the frame clocks');
  }
  for (const [name, s] of states()) {
    const value = observe(source, s);
    assert.deepEqual(value, expected(s), name + ' frame play values');
    assert.deepEqual(events(source, s), {
      photo: (s.started ?? true) && !s.ended && !s.ending && !s.inside,
      horns: (s.started ?? true) && !s.ended && !s.ending && !s.hidden && !s.inside && !s.fly ? 1 : 0,
    }, name + ' input play values');
  }
  for (const [name, s, ...values] of recorded) {
    const value = observe(source, s);
    assert.deepEqual([value.dt, value.damage, value.playing, value.roadPaused, value.clock], values, name + ' pinned main values');
    // Also run the shipping (non-dev) frame for the named states.
    assert.deepEqual(observe(source, { ...s, dev: false }), value, name + ' production frame');
    if (table) console.log(JSON.stringify({ state: name, ...value }));
  }
  // The camera drone: C lowers it (no photo), R flies it home (no road reset).
  assert.deepEqual(events(source, { fly: true, drone: true }), { photo: false, horns: 0, home: 1, resets: 0, down: true }, 'drone keys own C and R');
  assert.throws(() => assert.deepEqual(events(source.replace("'KeyR', 'KeyG'", "'KeyG'"), { fly: true, drone: true }), { photo: false, horns: 0, home: 1, resets: 0, down: true }), 'R that resets the car under a flying drone must fail');
  if(source.includes('!fleet?.busy')){
    assert.deepEqual(events(source,{started:true,fleetBusy:true}),{photo:false,horns:0},'a fleet transition owns photo and horn input');
    assert.throws(()=>assert.deepEqual(events(source.replace('live() && !fleet?.busy','live()'),{started:true,fleetBusy:true}),{photo:false,horns:0}),'a horn that ignores the transition must fail');
  }
  // These consumers must see transitions at their existing points within the same frame.
  const shiftEnds = observe(source, {}, 'shift ends during update');
  assert.equal(shiftEnds.playing, true); assert.equal(shiftEnds.phoneActive, false);
  assert.equal(observe(source, {}, 'report ends shift').phoneActive, false);
  assert.equal(observe(source, {}, 'ending during drive').playing, null);
  assert.equal(observe(source, { inside: true }, 'indoor day ends').clock, .05);
  console.log(`PASS play flags: ${states().length} state cases, ${recorded.length} shipping frames, requested mail/photo consumers, relief/radio arguments, real key/horn handlers and 4 transitions`);
}
export function auditPlayFlags(source, ref) {
  assert.match(ref, /^[a-zA-Z0-9_./-]+$/);
  const baseline = execFileSync('git', ['show', ref + ':web/src/main.ts'], { encoding: 'utf8' });
  verifyPlayFlags(baseline);
  for (const [name, s] of states()) assert.deepEqual(observe(source, s), observe(baseline, s), name + ' main/branch values');
  console.log('PASS play flags historical audit ' + ref);
}
export function playMutant(source, name) {
  const damage = source.includes('vehicle.damageActive = !horse && damageActive;')
    ? ['vehicle.damageActive = !horse && damageActive;', 'vehicle.damageActive = !horse && playing;']
    : ['vehicle.damageActive = damageActive;', 'vehicle.damageActive = playing;'];
  // The explore map (big-map.ts) pauses the journey as Places does, when main.ts has it.
  const journey = source.includes('const journeyRuns = placesEnabled && !placesUI?.busy && !bigMap?.busy;')
    ? 'const journeyRuns = placesEnabled && !placesUI?.busy && !bigMap?.busy;' : 'const journeyRuns = placesEnabled && !placesUI?.busy;';
  const changes = {
    'merge-world-clock': ['const worldRuns = frameLive && !document.hidden;', 'const worldRuns = clockRuns;'],
    'swap-playing-road': ['const playing = driving && clockRuns;', 'const playing = !roadPaused;'],
    'merge-journey-playing': [journey, 'const journeyRuns = playing;'],
    'merge-damage-playing': damage,
    'merge-mail-playing': ['mailControls && (mailRequested', 'playing && (mailRequested'],
    'merge-relief-world': ['playing ? clockDt * CLOCK_FACTOR : 0', 'worldRuns ? clockDt * CLOCK_FACTOR : 0'],
    'merge-radio-world': ['radio?.update(playing, false);', 'radio?.update(worldRuns, false);'],
  };
  const [from, to] = changes[name]; assert.equal(source.split(from).length, 2, name + ' anchor');
  return source.replace(from, to);
}
export function playMutations() {
  for (const name of ['merge-world-clock', 'swap-playing-road', 'merge-journey-playing', 'merge-damage-playing',
    'merge-mail-playing', 'merge-relief-world', 'merge-radio-world']) {
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname, '--mutation', name], { encoding: 'utf8' });
    assert.equal(r.status, 1, name + ' exits 1'); assert.match(r.stderr, /frame play values/);
    console.log('KILLED ' + name + ': real frame assertion, exit 1');
  }
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const mutation = process.argv.indexOf('--mutation');
  verifyPlayFlags(mutation < 0 ? current() : playMutant(current(), process.argv[mutation + 1]), mutation < 0);
  const at = process.argv.indexOf('--audit');
  if (at >= 0) auditPlayFlags(current(), process.argv[at + 1]);
  if (process.argv.includes('--mutations')) playMutations();
}
