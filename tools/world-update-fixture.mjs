// Execute the real frame and ending functions with update spies, without WebGL.
// node tools/world-update-fixture.mjs [--mutations] [--experiment] [--audit f7428e7]
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from '../web/node_modules/typescript/lib/typescript.js';
import { transformSync } from '../web/node_modules/esbuild/lib/main.js';
export const current = () => readFileSync(new URL('../web/src/main.ts', import.meta.url), 'utf8');
export function frameSource(source, dev = true) {
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const names = new Set(['expose', 'live', 'scenePaused', 'syncRoadScenePause', 'updateWorld', 'drawEnding', 'frame']);
  const vars = new Set(['shadowFocus', 'hudState']);
  const setupStart = source.indexOf('type WorldSegment ='), setupEnd = source.indexOf('const shadowFocus =');
  return transformSync(ast.statements.filter(n =>
    setupStart >= 0 && n.getStart(ast) >= setupStart && n.end <= setupEnd ||
    ts.isFunctionDeclaration(n) && names.has(n.name?.text) ||
    ts.isVariableStatement(n) && n.declarationList.declarations.some(d => vars.has(d.name.getText(ast)))
  ).map(n => n.getText(ast)).join('\n').replaceAll('import.meta.env.DEV', String(dev)), { loader: 'ts', target: 'es2022' }).code;
}
export const hooksSource = () => readFileSync(new URL('../web/src/dev-hooks.ts', import.meta.url), 'utf8');
export function hookFactory(source = hooksSource()) {
  const ast = ts.createSourceFile('dev-hooks.ts', source, ts.ScriptTarget.Latest, true);
  const code = transformSync(ast.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(ast)).join('\n').replace('export class', 'class'), { loader: 'ts', target: 'es2022' }).code;
  return new Function('context', `with(context) { ${code}; return DevHooks; }`);
}
export function spy(source, ending = false, dev = true, absent = false, overrides = {}, execute = frame => frame(1050)) {
  const calls = [], args = {}, trace = name => (...values) => { calls.push(name); (args[name] ??= []).push(values); };
  const update = name => ({ update: trace(name), pending: 0 });
  function vec() { return { x: 3, y: 4, z: 5, set: trace('shadowFocus'), copy: trace('sky') }; }
  const position = vec(), camera = { position, updateMatrixWorld: trace('camera.matrix'), rotation: { set: trace('camera.rotation') } };
  const vehicle = { x: 3, y: 4, z: 5, heading: .7, vx: 0, vz: 0, vy: 0, speed: 0, place: trace('vehicle.place') };
  const context = {
    window: {}, performance: { now: () => 1000 + calls.length }, THREE: { Vector3: vec, MathUtils: { clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)) } },
    started: true, last: 1000, fps: 60, quiet: 25, camReady: true, mode: 'drive', vehicle, camera,
    endings: { ...update('endings'), busy: ending }, interiors: { ...update('interiors'), render: trace('interiors.render'), busy: false },
    wharves: null,
    terrain: { ...update('terrain'), drawnFine: new Set(['tile']), surfaceAt: () => ({ level: 8 }), failed: 0 },
    quality: { frame: trace('quality') }, picture: null, lawnDemo: null, mailMode: true, tall: null, farTurbines: null, farVisibility:null, farLoading:false, farKey:null,tallKey:null,
    demo: 0, demoPhoto: false, drove: 0, reliefTest: 0, waitingToDrive: false, loaded: true, beaconT: 0,
    beaconMat: { set emissiveIntensity(v) { trace('beacon')(v); } },
    shared: { tallViewport: { value: { set(){} } }, time: { set value(v) { trace('shared.time')(v); } } },
    sky: { position: { copy: trace('sky') } },
    aiDriver: null, horse: false, roadsidePlaying: false, engineSound: null, fleet: null, trafficSignals: null, updateFleetHud: null, ride: {}, car: {}, radio: { ...update('radio'), setWind: trace('radio.wind'), setPlace: trace('radio.place') }, partyLine: null /* Get Fired call-ins: absent in mail play */, manifest: { village: [1000, 2000] }, params: new URLSearchParams(),
    driveInput: () => ({ throttle: 0, steer: 0, handbrake: true }), driveVehicle: trace('driveVehicle'), chase: trace('chase'), fly: trace('fly'),
    animals: { ...update('animals'), influence: () => ({ brake: 0 }) },
    mail: { update: function (dt, car, requested, eye) { trace('mail')(dt, car, requested, eye); return 1; }, tally: '' },
    shift: { ...update('shift'), updateIndoors: trace('shift.indoors'), ended: false, damage: { windowStuck: false } }, shiftReady: false,
    // No controller: untraced, so call orders stay as they were.
    gamepad: { device: 'keyboard', poll() {}, feel() {} },
    // The drift dust and meter (drift-feedback.ts): untraced too, nothing slides here.
    driftFeedback: { update() {} },
    pad: { show: trace('pad.show') }, relief: { ...update('relief'), breaks: 0, busy: false },
    miniMap: { ...update('miniMap'), show: trace('miniMap.show') }, mapTimer: 0, refreshMap: trace('refreshMap'), mapStops: [], mapMarks: [], mapCars: [],
    propertyLayer: null, // Default-off ground mode has no per-frame update.
    placesUI: { ...update('placesUI'), busy: false }, journey: update('journey'),
    bigMap: null, footpaths: null, // The explore map dialog and hike paths: absent in mail mode and history eras.
    sunShadows: update('sunShadows'), vehicleSpec: { id: 'car' },
    canal: null, yardJob: null, pitch: .1, yaw: .2,
    fishing: { ...update('fishing'), judge: { cancel: trace('fishing.cancel') }, group: { visible: true } },
    renderer: { domElement: { width:1280, height:720 }, set localClippingEnabled(v) { trace('clipping')(v); }, render: trace('render') },
    multiplayer: { ...update('multiplayer'), choice: { on: false } }, scene: {}, LOW: true, CLOCK_FACTOR: 120, page: { stopped: false, ready: trace('page.ready'), fail: error => { throw error; } },
    document: { hidden: false }, keys: new Set(), mailPointers: new Set(), mailButton: null, mailScore: null, phoneMailHud: update('phoneMailHud'),
    pendingShot: null, mailRequested: false, photoRequested: false, touchDevice: false, bare: true,
    flySpeed: 20, SHOTS: [], AREA: {}, EXAG: 1.5,
    requestAnimationFrame: trace('raf'),
    // The old picture, straight to the screen (finish-choice.ts): the fixture's page is at low detail.
    FINISH: { low: true, mode: null, clouds: false, canvasSamples: false, samples: undefined, oneSample: false, offered: false },
    // The instant replay records without spy calls, so the established call orders stay as they were.
    replay: { active: false, record() {}, frame() {}, afterRender() {} }, quietGround: () => false,
    // An open pause gate keeps the old clock: dt from `last`, simulation time equal to the frame's time.
    pause: { blocked: false, time: 0, frame(now) { const dt = Math.max(0, (now - context.last) / 1000); context.last = now; this.time = now; return { paused: false, dt }; } },
  };
  for (const name of ['tall', 'deckhand', 'yard', 'yardDog', 'home', 'porch', 'porchDog', 'church', 'village', 'hawkesbury', 'mabouMain', 'stockpiles', 'cemeteries', 'trees', 'coast', 'airport', 'quarry', 'culvertMouths', 'landmarks', 'history', 'roads', 'edge', 'mineSite', 'roadScene', 'sidewalks', 'schoolBus', 'ambientTraffic', 'roadAnimals', 'props', 'grass', 'waterReflections', 'harbourLights']) context[name] = update(name);
  context.stuntPark=null;
  context.roadScene.setPaused = trace('roadScene.pause');
  context.waterReflections.settle = trace('water.settle'); context.waterReflections.afterRender = trace('water.afterRender');
  if (absent) for (const name of ['tall', 'stuntPark', 'deckhand', 'yard', 'yardDog', 'home', 'porch', 'porchDog', 'church', 'village', 'hawkesbury', 'mabouMain', 'stockpiles', 'cemeteries', 'trees', 'coast', 'airport', 'quarry', 'culvertMouths', 'landmarks', 'history', 'edge', 'mineSite', 'roadScene', 'sidewalks', 'schoolBus', 'ambientTraffic', 'roadAnimals', 'props', 'grass', 'waterReflections', 'fishing', 'harbourLights']) context[name] = null;
  if (typeof overrides === 'function') overrides(context, trace);
  else Object.assign(context, overrides);
  if (source.includes('devHooks.')) {
    if (context.demo && !context.params.has('demo')) context.params.set('demo', String(context.demo));
    const Hooks = hookFactory(context.hooksSource)(context);
    context.devHooks = new Hooks(context.params);
    context.demo = context.devHooks.demo;
  }
  context.dummy = update('dummy'); // Used only by the in-memory extensibility experiment.
  const runtime = new Function('context', `with(context) { ${frameSource(source, dev)}; return {frame, shadowFocus}; }`)(context);
  context.shadowFocus = runtime.shadowFocus;
  // Startup is complete before counting. The spy callbacks themselves use no array iteration.
  const original = Array.prototype[Symbol.iterator];
  let iterators = 0, iteratorSteps = 0;
  Array.prototype[Symbol.iterator] = function () {
    iterators++;
    const iterator = original.call(this);
    return { next() { iteratorSteps++; return iterator.next(); }, [Symbol.iterator]() { return this; } };
  };
  try { execute(runtime.frame, context); } finally { Array.prototype[Symbol.iterator] = original; }
  return { calls, args, context, cost: context.window.mmm?.cost, iterators, iteratorSteps };
}

// Editable, ongoing oracle. A world() line pins order, arguments and the dev cost key together.
const call = (name, ...args) => ({ name, args });
const world = (name, ...args) => ({ name: name === 'mirror' ? 'waterReflections' : name, args, world: name });
const input = { throttle: 0, steer: 0, handbrake: true };
export function expectedDrive({ started = true, hidden = false, fly = false, absent = false } = {}) {
  const dt = started && !hidden ? .05 : 0, playing = started && !fly, paused = !started || hidden;
  return [
    call('quality', .05, true), call('roadScene.pause', paused), ...(fly ? [call('fishing.cancel')] : []),
    call('radio.wind', false, 0), call('radio.place', 1003, 1995), call('interiors', .05, input, '@vehicle', playing), call('pad.show', !fly),
    ...(fly ? [call('fly', dt), call('animals', dt, '@vehicle', '@camera'), call('camera.rotation', .1, .2, 0)]
      : [call('driveVehicle', dt, input), call('animals', dt, '@vehicle', '@camera'), call('chase', dt)]),
    call('mail', dt, '@vehicle', false, '@camera'),
    world('yard', dt, '@vehicle', '@camera.position'), world('yardDog', dt, '@vehicle'), world('home', '@camera.position', '@vehicle'),
    world('porch', '@camera.position', '@vehicle'), call('porchDog', dt, '@vehicle', 1.05), world('church', '@camera.position', 1050), world('village', '@camera.position', 1050), world('hawkesbury', '@camera.position', 1050), world('mabouMain', '@camera.position', 1050), world('stockpiles', '@camera.position'), world('cemeteries', '@camera.position', '@vehicle'),
    call('camera.matrix'), call('sky', '@camera.position'), call('shared.time', 1.05), call('beacon', dt ? 2.2 : .15),
    world('terrain', '@camera', paused), world('coast', '@camera.position'), world('airport', '@camera.position'), world('quarry', '@camera.position', '@vehicle'),
    world('trees', '@terrain.drawnFine', '@camera.position'), call('culvertMouths', '@camera.position'), world('landmarks', '@camera'),
    call('placesUI', '@vehicle', playing), call('journey', .05, playing), call('relief', dt, playing ? 6 : 0, '@vehicle', playing),
    call('miniMap.show', playing), call('refreshMap'), call('miniMap', .05, 3, 5, .7, '@mapStops', '@mapMarks', '@mapCars'), call('radio', playing, false),
    world('history', '@camera.position', dt), world('roads', '@camera.position'), world('sidewalks'), world('edge', '@camera.position'), world('mineSite', '@camera.position'),
    world('deckhand', dt, '@vehicle', '@camera.position'), world('fishing', dt, '@camera.position'), world('roadScene', '@camera'), world('schoolBus', '@camera'), world('ambientTraffic', '@camera', '@vehicle', true), world('roadAnimals', dt, '@vehicle', true), world('props', '@camera', dt), world('harbourLights', 1.05), world('tall', '@camera', 1.05), call('shift', started ? .05 : 0, '@vehicle'),
    ...(!fly ? [call('shadowFocus', 3, 4, 5), call('sunShadows', .05, '@shadowFocus', 0, paused)] : []),
    world('grass', .05, '@camera', 3, 5, .7, '@vehicleSpec'), call('clipping', !absent), call('multiplayer', .05, '@camera', dt > 0 && !fly),
    world('mirror', '@camera'), call('render', '@scene', '@camera'), call('water.settle'), call('water.afterRender', '@camera'),
    call('page.ready', true), call('phoneMailHud', '@shift', '@vehicle', playing && !paused), call('raf', '@function'),
  ];
}
export function expectedEnding({ absent = false } = {}) {
  return [
    call('quality', .05, true), call('roadScene.pause', true), call('endings', .05), call('pad.show', false), call('radio', false, true),
    call('camera.matrix'), call('sky', '@camera.position'), world('terrain', '@camera', true), world('trees', '@terrain.drawnFine', '@camera.position'),
    world('coast', '@camera.position'), world('airport', '@camera.position'), world('quarry', '@camera.position', '@vehicle'), world('landmarks', '@camera'), world('roads', '@camera.position'),
    world('props', '@camera', 0), world('sidewalks'), world('fishing', 0, '@camera.position'), call('clipping', !absent), world('mirror', '@camera'),
    call('render', '@scene', '@camera'), call('water.settle'), call('water.afterRender', '@camera'), call('raf', '@function'),
  ];
}
const optional = new Set('tall deckhand yard yardDog home porch porchDog church village hawkesbury mabouMain stockpiles cemeteries trees coast airport quarry culvertMouths landmarks history sidewalks edge mineSite roadScene schoolBus ambientTraffic roadAnimals roadScene.pause props grass waterReflections water.settle water.afterRender fishing harbourLights'.split(' '));
function normalized(values, ctx) {
  return JSON.parse(JSON.stringify(values, (_key, value) => {
    for (const [name, object] of Object.entries(ctx)) if (value === object && typeof object === 'object' && object !== null) return '@' + name;
    if (value === ctx.camera.position) return '@camera.position';
    if (value === ctx.terrain.drawnFine) return '@terrain.drawnFine';
    if (typeof value === 'function') return '@function';
    return value === undefined ? '@undefined' : value;
  }));
}
function traceOf(result) {
  const indexes = {};
  return result.calls.map(name => { const i = indexes[name] ?? 0; indexes[name] = i + 1; return { name, args: normalized(result.args[name][i], result.context) }; });
}
const scenarios = [{}, { ending: true }, { hidden: true }, { started: false }, { fly: true }, { absent: true }, { ending: true, absent: true }];
function run(source, s, dev = true) {
  return spy(source, s.ending, dev, s.absent, {
    ...(s.hidden ? { document: { hidden: true } } : {}), ...(s.started === false ? { started: false } : {}),
    ...(s.fly ? { mode: 'fly', sunShadows: null } : {}),
  });
}
export function verify(source, { drive = expectedDrive, ending = expectedEnding } = {}) {
  for (const s of scenarios) for (const dev of [true, false]) {
    const result = run(source, s, dev), expected = (s.ending ? ending : drive)(s);
    const filtered = s.absent ? expected.filter(x => !optional.has(x.name)) : expected;
    const label = s.ending ? 'ending' : 'drive';
    assert.deepEqual(result.calls, filtered.map(x => x.name), label + ' frame call order');
    assert.deepEqual(traceOf(result), filtered.map(({ name, args }) => ({ name, args })), label + ' frame arguments');
    assert.equal(result.iterators, 0, label + ' frame creates zero array iterators');
    assert.equal(result.iteratorSteps, 0, label + ' frame uses zero iterator steps');
    if (dev) {
      assert.ok(result.cost, 'dev cost exists');
      assert.deepEqual(Object.keys(result.cost), expected.filter(x => x.world).map(x => x.world), 'dev cost entries');
      assert.ok(Object.values(result.cost).every(n => Number.isFinite(n) && n >= 0));
      if(s.absent)assert.equal(result.cost.trees, 0, 'absent optional entry is timed without an update');
    } else assert.equal(result.cost, undefined, 'production has no cost');
  }
  hotLoop(source);
  if(source.includes("name: 'fleet'")){
    const checkFleet = code => {
      const result=spy(code,false,true,false,(context,trace)=>{
        context.fleet={busy:false,refresh:trace('fleet.refresh'),draw:trace('fleet.draw')};
        context.updateFleetHud=trace('fleet.hud');
      });
      const at=result.calls.indexOf('terrain');
      assert.deepEqual(result.calls.slice(at,at+5),['terrain','fleet.refresh','fleet.draw','fleet.hud','coast'],'fleet follows terrain in the landscape pipeline');
      assert.equal(result.args['fleet.refresh'][0][0],.05);
      assert.equal(result.args['fleet.draw'][0][0],result.context.camera.position);
    };
    checkFleet(source);
    const line=source.split('\n').find(l=>l.includes("name: 'fleet'"));
    assert.throws(()=>checkFleet(source.replace(line,'')),/fleet follows terrain/,'missing fleet pipeline update must fail');
  }
  if(source.includes("name: 'trafficSignals'")){
    const checkSignals = code => {
      const result=spy(code,false,true,false,(context,trace)=>{ context.trafficSignals={update:trace('trafficSignals'),group:{}}; });
      // Right after roads in the after-activities segment; only the sidewalks update may sit between them.
      const at=result.calls.indexOf('roads'),signals=result.calls.indexOf('trafficSignals');
      assert.ok(at>=0&&signals>at&&result.calls.slice(at+1,signals).every(name=>name==='sidewalks'),'traffic signals follow roads after the activities: '+JSON.stringify(result.calls));
      assert.deepEqual(result.args.trafficSignals[0],[.05,result.context.camera.position,.05],'signals take the world clock, the camera and the real clock');
      const ending=spy(code,true,true,false,(context,trace)=>{ context.trafficSignals={update:trace('trafficSignals'),group:{}}; });
      assert.ok(!ending.calls.includes('trafficSignals'),'signals stand still in an ending');
    };
    checkSignals(source);
    const line=source.split('\n').find(l=>l.includes("name: 'trafficSignals'"));
    assert.throws(()=>checkSignals(source.replace(line,'')),/traffic signals follow roads/,'missing signal update must fail');
  }
  return { drive: drive().map(x => x.name), ending: ending().map(x => x.name), iteratorsPerFrame: 0, iteratorStepsPerFrame: 0 };
}
function hotLoop(source) {
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'updateWorld');
  assert.ok(fn, 'registry runner exists');
  const forbidden = new Set([ts.SyntaxKind.ForOfStatement, ts.SyntaxKind.ForInStatement, ts.SyntaxKind.NewExpression,
    ts.SyntaxKind.ArrayLiteralExpression, ts.SyntaxKind.ObjectLiteralExpression, ts.SyntaxKind.ArrowFunction, ts.SyntaxKind.FunctionExpression]);
  function visit(n) {
    assert.ok(!forbidden.has(n.kind), 'registry hot loop contains no arrays, closures, objects or iterators');
    if (ts.isCallExpression(n)) assert.ok(['performance.now', 'entry.update'].includes(n.expression.getText(ast)), 'hot loop only calls updates and dev clocks');
    ts.forEachChild(n, visit);
  }
  visit(fn.body);
}
// Explicit, one-off refactor audit. No git history is read by verify() or the normal UI row's spies.
export function audit(source, ref) {
  assert.match(ref, /^[a-zA-Z0-9_./-]+$/, 'audit git revision');
  const baseline = execFileSync('git', ['show', ref + ':web/src/main.ts'], { encoding: 'utf8' });
  for (const s of scenarios) for (const dev of [true, false]) {
    const now = run(source, s, dev), before = run(baseline, s, dev);
    assert.deepEqual(traceOf(now), traceOf(before), 'historical frame call order and arguments ' + JSON.stringify(s));
  }
  console.log('PASS explicit historical audit ' + ref);
}
export function compareCaptures(captures, label, diagnostic = console.error) {
  const deterministic = captures[0].hash === captures[2].hash && captures[1].hash === captures[3].hash;
  if (!deterministic) {
    diagnostic('WORLD_ENDING_PROOF ' + JSON.stringify({ label, proof: 'INCONCLUSIVE', hashes: captures.map(x => x.hash),
      drawListsMatch: captures.every(x => JSON.stringify(x.calls) === JSON.stringify(captures[0].calls)) }));
    assert.fail('INCONCLUSIVE: ' + label + ' pixels are not deterministic; draw lists are diagnostic only');
  }
  assert.equal(captures[0].hash, captures[1].hash, label + ' identical main/branch RGBA pixels');
  return 'RGBA pixels';
}
export function mutated(source, name) {
  const terrain = source.split('\n').find(l => l.includes("name: 'terrain'")), coast = source.split('\n').find(l => l.includes("name: 'coast'"));
  assert.ok(terrain && coast, 'mutation anchors');
  const mutations = {
    swap: source.replace(terrain, '__SWAP__').replace(coast, terrain).replace('__SWAP__', coast),
    ending: source.replace("segment: 'landscape', ending: true, endingPosition: 1", "segment: 'landscape', ending: false, endingPosition: 1"),
    drop: source.replace(terrain, ''),
    treesPosition: source.replace('endingPosition: 1, ', ''), propsPosition: source.replace('endingPosition: 7, ', ''),
    mirror: source.replace("segment: 'mirror', ending: true", "segment: 'mirror', ending: false"),
    iterator: source.replace('for (let i = 0; i < list.length; i++) {\n    const entry = list[i];', 'for (const entry of list) {'),
  };
  assert.notEqual(mutations[name], source, name + ' changed source');
  return mutations[name];
}
export function mutations() {
  for (const name of ['swap', 'ending', 'drop', 'mirror', 'treesPosition', 'propsPosition', 'iterator']) {
    const result = spawnSync(process.execPath, [new URL(import.meta.url).pathname, '--mutation', name], { encoding: 'utf8' });
    assert.equal(result.status, 1, name + ' must exit 1');
    assert.match(result.stderr, name === 'iterator' ? /zero array iterators/ : /frame call order/, 'actual frame guard rejects ' + name);
    console.log(`KILLED ${name}: actual frame spy, exit ${result.status}`);
  }
  const bad = spawnSync(process.execPath, [new URL(import.meta.url).pathname, '--inconclusive'], { encoding: 'utf8' });
  assert.equal(bad.status, 1); assert.match(bad.stderr, /INCONCLUSIVE/);
  assert.match(bad.stderr, /"drawListsMatch":true/, 'matching draws cannot turn uncertain pixels into a pass');
  console.log('PASS nondeterministic pixels with matching draws: INCONCLUSIVE, exit 1');
}
export function experiment(source) {
  const anchor = source.split('\n').find(l => l.includes("name: 'grass'"));
  assert.ok(anchor);
  const entry = "  { ...(import.meta.env.DEV ? { name: 'dummy' } : {}), segment: 'grass', ending: false, update: () => dummy.update(camera) },";
  const changed = source.replace(anchor, entry + '\n' + anchor);
  const drive = s => {
    const expected = expectedDrive(s), i = expected.findIndex(x => x.world === 'grass');
    expected.splice(i, 0, world('dummy', '@camera')); // One editable expected-trace entry, including its arguments.
    return expected;
  };
  verify(changed, { drive });
  const wrong = s => { const expected = drive(s), i = expected.findIndex(x => x.world === 'dummy'); [expected[i], expected[i+1]] = [expected[i+1], expected[i]]; return expected; };
  assert.throws(() => verify(changed, { drive: wrong }), /frame call order/);
  console.log('PASS dummy entry + one expected-trace edit; wrong order rejected');
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (process.argv.includes('--inconclusive')) compareCaptures(['a','b','changed','b'].map(hash => ({hash,calls:[[1,2,3]]})), 'synthetic nondeterminism');
  const mutation = process.argv.indexOf('--mutation');
  if (mutation !== -1) verify(mutated(current(), process.argv[mutation + 1]));
  console.log(JSON.stringify(verify(current())));
  console.log('PASS ongoing frame regression (no historical comparison)');
  {
    const scheduled=[];let loads=0;
    const actual=spy(current(),false,true,false,{farKey:{file:'far-land.json'},farLoading:false,setTimeout:fn=>{scheduled.push(fn);return 1;},loadFarViews:()=>{loads++;return Promise.resolve();}},frame=>{frame(1050);frame(1067);});
    assert.ok(actual.calls.includes('render'),'first game frame drawn');assert.equal(loads,0,'no optional request in either frame');assert.equal(scheduled.length,1,'one deferred request');
    scheduled[0]();assert.equal(loads,1,'request runs after the frame');
    console.log('PASS actual first frame before optional scenery, scheduled only once');
  }

  if (process.argv.includes('--mutations')) mutations();
  if (process.argv.includes('--experiment')) experiment(current());
  const at = process.argv.indexOf('--audit');
  if (at !== -1) { assert.ok(process.argv[at+1], 'supply an audit revision'); audit(current(), process.argv[at+1]); }
}
