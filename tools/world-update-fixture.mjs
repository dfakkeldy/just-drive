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
  // The hand-built places list (built once at boot) feeds the before-camera updates and the frame's waiting test.
  // Its rows hold the home and porch wrappers; spy() gives the rows' helpers from place.ts and what the boot built.
  const vars = new Set(['shadowFocus', 'hudState', 'placeRows', 'places', 'handBuilt', 'placesWaiting']);
  const setupStart = source.indexOf('type WorldSegment ='), setupEnd = source.indexOf('const shadowFocus =');
  return transformSync(ast.statements.filter(n =>
    setupStart >= 0 && n.getStart(ast) >= setupStart && n.end <= setupEnd ||
    ts.isFunctionDeclaration(n) && names.has(n.name?.text) ||
    ts.isVariableStatement(n) && n.declarationList.declarations.some(d => vars.has(d.name.getText(ast)))
  ).map(n => n.getText(ast)).join('\n').replaceAll('import.meta.env.DEV', String(dev)), { loader: 'ts', target: 'es2022' }).code;
}
// The places rows' helpers (placeRow, lazyPlaceRow, placeSlots), read from the real place.ts like the dev hooks below.
export function placeHelpers() {
  const source = readFileSync(new URL('../web/src/place.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('place.ts', source, ts.ScriptTarget.Latest, true);
  const code = transformSync(ast.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(ast)).join('\n').replaceAll(/^export /gm, ''), { loader: 'ts', target: 'es2022' }).code;
  return new Function(`${code}; return { placeRow, lazyPlaceRow, placeSlots };`)();
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
    airportDrag: null, wharves: null, novemberRoads: null, maryville: null,
    terrain: { ...update('terrain'), drawnFine: new Set(['tile']), surfaceAt: () => ({ level: 8 }), failed: 0 },
    quality: { frame: trace('quality') }, picture: null, lawnDemo: null, mailMode: true, tall: null, farTurbines: null, farVisibility:null, farLoading:false, farKey:null,tallKey:null,
    demo: 0, demoPhoto: false, drove: 0, reliefTest: 0, waitingToDrive: false, loaded: true, beaconT: 0,
    beaconMat: { set emissiveIntensity(v) { trace('beacon')(v); } },
    shared: { tallViewport: { value: { set(){} } }, time: { set value(v) { trace('shared.time')(v); } } },
    sky: { position: { copy: trace('sky') } },
    aiDriver: null, boss: null, horse: false, roadsidePlaying: false, engineSound: null, fleet: null, trafficSignals: null, updateFleetHud: null, ride: {}, car: {}, radio: { ...update('radio'), setWind: trace('radio.wind'), setPlace: trace('radio.place') }, partyLine: null /* Get Fired call-ins: absent in mail play */, manifest: { village: [1000, 2000] }, params: new URLSearchParams(),
    driveInput: () => ({ throttle: 0, steer: 0, handbrake: true }), driveVehicle: trace('driveVehicle'), chase: trace('chase'), fly: trace('fly'),
    animals: { ...update('animals'), influence: () => ({ brake: 0 }) },
    mail: { update: function (dt, car, requested, eye) { trace('mail')(dt, car, requested, eye); return 1; }, tally: '' },
    shift: { ...update('shift'), updateIndoors: trace('shift.indoors'), ended: false, damage: { windowStuck: false } }, shiftReady: false,
    // No controller: untraced, so call orders stay as they were.
    gamepad: { device: 'keyboard', poll() {}, feel() {} },
    // The drift dust and meter (drift-feedback.ts): untraced too, nothing slides here.
    driftFeedback: { update() {} },
    pad: { show: trace('pad.show') }, relief: { ...update('relief'), breaks: 0, busy: false },
    drone: { active: false },
    miniMap: { setFlight() {}, ...update('miniMap'), show: trace('miniMap.show') }, mapTimer: 0, refreshMap: trace('refreshMap'), mapStops: [], mapMarks: [], mapCars: [],
    propertyLayer: null, // Default-off ground mode has no per-frame update.
    placesUI: { ...update('placesUI'), busy: false }, journey: update('journey'),
    bigMap: null, footpaths: null, // The explore map dialog and hike paths: absent in mail mode and history eras.
    sunShadows: update('sunShadows'), vehicleSpec: { id: 'car' },
    canal: null, yardJob: null, pitch: .1, yaw: .2,
    fishing: { ...update('fishing'), judge: { cancel: trace('fishing.cancel') }, group: { visible: true } },
    renderer: { domElement: { width:1280, height:720 }, set localClippingEnabled(v) { trace('clipping')(v); }, render: trace('render') },
    multiplayer: { ...update('multiplayer'), choice: { on: false } }, scene: {}, LOW: true, CLOCK_FACTOR: 120, page: { stopped: false, ready: trace('page.ready'), fail: error => { throw error; } },
    pauseButton: { hidden: true },
    document: { hidden: false, body: { classList: { toggle() {} } } }, keys: new Set(), mailPointers: new Set(), mailButton: null, mailScore: null, phoneMailHud: update('phoneMailHud'),
    pendingShot: null, mailRequested: false, photoRequested: false, pictureRequested: false, pictureButton: null, touchDevice: false, bare: true,
    flySpeed: 20, SHOTS: [], AREA: {}, EXAG: 1.5,
    requestAnimationFrame: trace('raf'),
    // The old picture, straight to the screen (finish-choice.ts): the fixture's page is at low detail.
    FINISH: { low: true, mode: null, clouds: false, canvasSamples: false, samples: undefined, oneSample: false, offered: false },
    // The instant replay records without spy calls, so the established call orders stay as they were.
    sunSeeker: null,
    replay: { active: false, record() {}, frame() {}, afterRender() {} }, quietGround: () => false,
    // An open pause gate keeps the old clock: dt from `last`, simulation time equal to the frame's time.
    pause: { blocked: false, time: 0, frame(now) { const dt = Math.max(0, (now - context.last) / 1000); context.last = now; this.time = now; return { paused: false, dt }; } },
  };
  for (const name of ['tall', 'deckhand', 'yard', 'yardDog', 'home', 'porch', 'porchDog', 'church', 'village', 'hawkesbury', 'mabouMain', 'stockpiles', 'cemeteries', 'trees', 'coast', 'lotProps', 'airport', 'quarry', 'culvertMouths', 'landmarks', 'history', 'roads', 'edge', 'mineSite', 'roadScene', 'sidewalks', 'schoolBus', 'ambientTraffic', 'roadAnimals', 'props', 'yardProps', 'grass', 'waterReflections', 'harbourLights']) context[name] = update(name);
  context.stuntPark=null;
  context.roadScene.setPaused = trace('roadScene.pause');
  context.waterReflections.settle = trace('water.settle'); context.waterReflections.afterRender = trace('water.afterRender');
  if (absent) for (const name of ['tall', 'stuntPark', 'deckhand', 'yard', 'yardDog', 'home', 'porch', 'porchDog', 'church', 'village', 'hawkesbury', 'mabouMain', 'stockpiles', 'cemeteries', 'trees', 'coast', 'lotProps', 'airport', 'quarry', 'culvertMouths', 'landmarks', 'history', 'edge', 'mineSite', 'roadScene', 'sidewalks', 'schoolBus', 'ambientTraffic', 'roadAnimals', 'props', 'yardProps', 'grass', 'waterReflections', 'fishing', 'harbourLights']) context[name] = null;
  // The places rows: their sites are only stored, and each built place is the spy (or null) of the same name, read late so `absent` and the overrides apply.
  Object.assign(context, placeHelpers(), { homeSite: {}, porchSite: {}, churchSite: {}, villageSite: {}, hawkesburySite: {}, mabouSite: {}, maryvilleSite: null, drLaneSite: null,
    builtPlaces: new Proxy({}, { get: (_target, name) => context[name] ?? null }) });
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
// A quiet() line is a world entry whose part is absent here: it pins the dev cost key and makes no call.
const call = (name, ...args) => ({ name, args });
const world = (name, ...args) => ({ name: name === 'mirror' ? 'waterReflections' : name, args, world: name });
const quiet = name => ({ name, args: [], world: name, quiet: true });
// The wharves, the November roads and the canal are absent in the base scenarios; `spied` gives them spies.
const wharfLines = spied => spied ? [world('wharves', '@camera.position'), world('novemberRoads', '@terrain', '@camera.position')] : [quiet('wharves'), quiet('novemberRoads')];
const canalLine = spied => spied ? world('canal', 0, '@vehicle', true) : quiet('canal');
const input = { throttle: 0, steer: 0, handbrake: true };
export function expectedDrive({ started = true, hidden = false, fly = false, absent = false, spied = false, mirror = false } = {}) {
  const dt = started && !hidden ? .05 : 0, playing = started && !fly, paused = !started || hidden;
  // `mirror` gives the Point Tupper driver, the boss and the far views spies (they run just before the water).
  const mirrorLines = mirror ? [world('aiDriver', '@camera', '@vehicle', true, 'car'), world('boss', '@camera', dt, false, started, fly || hidden)] : [quiet('aiDriver'), quiet('boss')];
  return [
    call('quality', .05, true), call('roadScene.pause', paused), ...(fly ? [call('fishing.cancel')] : []),
    call('radio.wind', false, 0), call('radio.place', 1003, 1995), call('interiors', .05, input, '@vehicle', playing), call('pad.show', !fly),
    ...(fly ? [call('fly', dt), call('animals', dt, '@vehicle', '@camera'), call('camera.rotation', .1, .2, 0)]
      : [call('driveVehicle', dt, input), call('animals', dt, '@vehicle', '@camera'), call('chase', dt)]),
    call('mail', dt, '@vehicle', false, '@camera'),
    world('yard', dt, '@vehicle', '@camera.position'), world('yardDog', dt, '@vehicle'), world('home', '@camera.position', '@vehicle'),
    world('porch', '@camera.position', '@vehicle'), call('porchDog', dt, '@vehicle', 1.05), world('church', '@camera.position', 1050, '@vehicle', dt), world('village', '@camera.position', 1050, '@vehicle', dt), world('hawkesbury', '@camera.position', 1050, '@vehicle', dt), world('mabouMain', '@camera.position', 1050, '@vehicle', dt), quiet('maryville'), quiet('drLane'), world('stockpiles', '@camera.position'), world('cemeteries', '@camera.position', '@vehicle'),
    call('camera.matrix'), call('sky', '@camera.position'), call('shared.time', 1.05), call('beacon', dt ? 2.2 : .15),
    world('terrain', '@camera', paused), ...wharfLines(spied), world('coast', '@camera.position'), world('lotProps', '@camera', '@vehicle'), world('airport', '@camera.position'), world('quarry', '@camera.position', '@vehicle'),
    world('trees', '@terrain.drawnFine', '@camera.position'), world('culvertMouths', '@camera.position'), world('landmarks', '@camera'),
    call('placesUI', '@vehicle', playing), call('journey', .05, playing), call('relief', dt, playing ? 6 : 0, '@vehicle', playing),
    call('miniMap.show', playing), call('refreshMap'), call('miniMap', .05, 3, 5, .7, '@mapStops', '@mapMarks', '@mapCars', null), call('radio', playing, false),
    world('history', '@camera.position', dt), world('roads', '@camera.position'), canalLine(spied), world('sidewalks'), world('edge', '@camera.position'), world('mineSite', '@camera.position'),
    world('deckhand', dt, '@vehicle', '@camera.position'), world('fishing', dt, '@camera.position'), world('roadScene', '@camera'), world('schoolBus', '@camera'), world('ambientTraffic', '@camera', '@vehicle', true), world('roadAnimals', dt, '@vehicle', true), world('props', '@camera', dt), world('yardProps', '@camera', dt), world('harbourLights', 1.05), world('tall', '@camera', 1.05), call('shift', started ? .05 : 0, '@vehicle'),
    ...(!fly ? [call('shadowFocus', 3, 4, 5), call('sunShadows', .05, '@shadowFocus', 0, paused)] : []),
    world('grass', .05, '@camera', 3, 5, .7, '@vehicleSpec'), call('clipping', !absent),
    ...mirrorLines, world('multiplayer', .05, '@camera', dt > 0 && !fly), mirror ? world('farVisibility', '@camera', 1.05) : quiet('farVisibility'), world('mirror', '@camera'), call('render', '@scene', '@camera'), call('water.settle'), call('water.afterRender', '@camera'),
    call('page.ready', true), call('phoneMailHud', '@shift', '@vehicle', playing && !paused), call('raf', '@function'),
  ];
}
export function expectedEnding({ absent = false, spied = false } = {}) {
  return [
    call('quality', .05, true), call('roadScene.pause', true), call('endings', .05), call('pad.show', false), call('radio', false, true),
    call('camera.matrix'), call('sky', '@camera.position'), world('terrain', '@camera', true), ...wharfLines(spied), world('trees', '@terrain.drawnFine', '@camera.position'),
    world('coast', '@camera.position'), world('lotProps', '@camera', '@vehicle'), world('airport', '@camera.position'), world('quarry', '@camera.position', '@vehicle'), world('landmarks', '@camera'), world('roads', '@camera.position'),
    canalLine(spied), world('props', '@camera', 0), world('sidewalks'), world('fishing', 0, '@camera.position'), call('clipping', !absent), world('mirror', '@camera'),
    call('render', '@scene', '@camera'), call('water.settle'), call('water.afterRender', '@camera'), call('raf', '@function'),
  ];
}
const optional = new Set('tall deckhand yard yardDog home porch porchDog church village hawkesbury mabouMain stockpiles cemeteries trees coast lotProps airport quarry culvertMouths landmarks history sidewalks edge mineSite roadScene schoolBus ambientTraffic roadAnimals roadScene.pause props yardProps grass waterReflections water.settle water.afterRender fishing harbourLights'.split(' '));
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
// `spied` gives the wharves, the November roads and the canal real spies: their calls keep the old nested order.
const scenarios = [{}, { ending: true }, { hidden: true }, { started: false }, { fly: true }, { absent: true }, { ending: true, absent: true },
  { spied: true }, { ending: true, spied: true }, { mirror: true }, { mirror: true, fly: true }, { mirror: true, hidden: true }, { mirror: true, started: false }];
function run(source, s, dev = true) {
  return spy(source, s.ending, dev, s.absent, (context, trace) => {
    Object.assign(context, {
      ...(s.hidden ? { document: { hidden: true, body: { classList: { toggle() {} } } } } : {}), ...(s.started === false ? { started: false } : {}),
      ...(s.fly ? { mode: 'fly', sunShadows: null } : {}),
    });
    if (s.spied) for (const name of ['wharves', 'novemberRoads', 'canal']) context[name] = { update: trace(name) };
    if (s.mirror) Object.assign(context, { aiDriver: { update: trace('aiDriver'), onRoad: [] }, boss: { update: trace('boss'), driver: { onRoad: [] }, mapSpot: null },
      farVisibility: { update: trace('farVisibility'), settle() {} }, aiDriverOn: () => true, garageEntry: { id: 'car' }, aiCars: [] });
  });
}
// Optional ending entries: the fleet sits in the landscape segment after terrain, the stunt park after the quarry.
// Neither may move trees off the terrain updates or props off roads and the canal (grok-bots#1308 C1).
const optionalEnding = {
  fleet: { after: 'trees', calls: [call('fleet.refresh', 0), call('fleet.draw', '@camera.position'), call('fleet.hud')],
    give: (context, trace) => { context.fleet = { busy: false, refresh: trace('fleet.refresh'), draw: trace('fleet.draw') }; context.updateFleetHud = trace('fleet.hud'); } },
  stuntPark: { after: 'quarry', calls: [call('stuntPark', 0, '@vehicle', '@camera.position')],
    give: (context, trace) => { context.stuntPark = { update: trace('stuntPark') }; } },
};
export function verifyOptionalEnding(source) {
  for (const names of [['fleet'], ['stuntPark'], ['fleet', 'stuntPark']]) for (const dev of [true, false]) {
    const result = spy(source, true, dev, false, (context, trace) => { for (const name of names) optionalEnding[name].give(context, trace); });
    const expected = expectedEnding().filter(x => !x.quiet);
    for (const name of names) {
      const at = expected.findIndex(x => x.name === optionalEnding[name].after);
      expected.splice(at + 1, 0, ...optionalEnding[name].calls);
    }
    const label = 'ending with ' + names.join(' and ');
    const calls = result.calls;
    assert.equal(calls[calls.indexOf('terrain') + 1], 'trees', label + ': trees right after terrain in the frame call order');
    assert.ok(calls.indexOf('roads') < calls.indexOf('props') && calls.indexOf('landmarks') < calls.indexOf('props'), label + ': roads before props in the frame call order: ' + JSON.stringify(calls));
    assert.deepEqual(calls, expected.map(x => x.name), label + ' frame call order');
    assert.deepEqual(traceOf(result), expected.map(({ name, args }) => ({ name, args })), label + ' frame arguments');
    if (dev) for (const name of names) assert.ok(Number.isFinite(result.cost[name]), label + ': dev cost has ' + name);
  }
}
export function verify(source, { drive = expectedDrive, ending = expectedEnding } = {}) {
  for (const s of scenarios) for (const dev of [true, false]) {
    const result = run(source, s, dev), expected = (s.ending ? ending : drive)(s);
    const filtered = (s.absent ? expected.filter(x => !optional.has(x.name)) : expected).filter(x => !x.quiet);
    const label = s.ending ? 'ending' : 'drive';
    assert.deepEqual(result.calls, filtered.map(x => x.name), label + ' frame call order');
    assert.deepEqual(traceOf(result), filtered.map(({ name, args }) => ({ name, args })), label + ' frame arguments');
    // The boss's AI car list is rebuilt with for...of, as it always was: only frames without a boss count iterators.
    if (!s.mirror) {
      assert.equal(result.iterators, 0, label + ' frame creates zero array iterators');
      assert.equal(result.iteratorSteps, 0, label + ' frame uses zero iterator steps');
    }
    if (dev) {
      assert.ok(result.cost, 'dev cost exists');
      assert.deepEqual(Object.keys(result.cost), expected.filter(x => x.world).map(x => x.world), 'dev cost entries');
      assert.ok(Object.values(result.cost).every(n => Number.isFinite(n) && n >= 0));
      if(s.absent)assert.equal(result.cost.trees, 0, 'absent optional entry is timed without an update');
    } else assert.equal(result.cost, undefined, 'production has no cost');
  }
  hotLoop(source);
  verifyOptionalEnding(source);
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
  return { drive: drive().filter(x => !x.quiet).map(x => x.name), ending: ending().filter(x => !x.quiet).map(x => x.name), iteratorsPerFrame: 0, iteratorStepsPerFrame: 0 };
}
// The places rows at boot and in the frame (grok-bots#1308 C52). verify() does not run the boot's build loop: its
// spies stand in for what the loop built. This lifts the real loop and the porch slot's waiting test.
export async function verifyPlaces(source) {
  // The porch slot waits for the dog too: a loading dog keeps the page from settling, as the porch does.
  const ready = (porchWaiting, dog) => spy(source, false, true, false, context => {
    context.porch.waiting = porchWaiting; context.porchDog.state = dog;
  }).args['page.ready'][0][0];
  assert.equal(ready(false, 'here'), true, 'porch and dog done: the page settles');
  assert.equal(ready(true, 'here'), false, 'porch still building: the page waits');
  assert.equal(ready(false, 'loading'), false, 'porch dog still loading: the page waits');
  // The build loop: a row without a site builds nothing and imports nothing; a row without load() adds no wait.
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const loops = ast.statements.filter(n => ts.isForOfStatement(n) && /\bplaceRows\b/.test(n.expression.getText(ast)));
  assert.equal(loops.length, 1, 'one boot loop over the places rows');
  // Every row has a contact row: the boot throws on one without (a place in every area, on or off, has a slot).
  const rows = ast.statements.flatMap(n => ts.isVariableStatement(n) ? n.declarationList.declarations : []).find(d => d.name.getText(ast) === 'placeRows');
  const contacts = ast.statements.flatMap(n => ts.isVariableStatement(n) ? n.declarationList.declarations : []).find(d => d.name.getText(ast) === 'siteContacts');
  assert.ok(rows && contacts && ts.isObjectLiteralExpression(rows.initializer) && ts.isArrayLiteralExpression(contacts.initializer), 'placeRows and siteContacts are where this check reads them');
  const named = new Set(contacts.initializer.elements.map(e => ts.isArrayLiteralExpression(e) && ts.isStringLiteral(e.elements[0]) ? e.elements[0].text : null));
  for (const p of rows.initializer.properties) assert.ok(named.has(p.name.getText(ast)), `places row '${p.name.getText(ast)}' has no contact row: the boot would throw`);
  const code = transformSync(loops[0].getText(ast), { loader: 'ts', target: 'es2022' }).code;
  const log = [], row = (name, site, lazy) => ({ site,
    build: (at, part) => { log.push(`build ${name} ${at === site} ${part}`); return { name }; },
    ...(lazy ? { load: () => { log.push('load ' + name); return Promise.resolve('part-' + name); } } : {}) });
  const context = { builtPlaces: {}, placeRows: { first: row('first', {}), offLazy: row('offLazy', null, true), off: row('off', null),
    lazy: row('lazy', {}, true), after: row('after', {}) } };
  const done = new Function('context', `return (async () => { with (context) { ${code} } })();`)(context);
  assert.deepEqual(log, ['build first true undefined', 'load lazy'], 'before any wait: the rows up to the first lazy one with a site');
  await done;
  assert.deepEqual(log, ['build first true undefined', 'load lazy', 'build lazy true part-lazy', 'build after true undefined'], 'places build loop order');
  assert.deepEqual(context.builtPlaces, { first: { name: 'first' }, offLazy: null, off: null, lazy: { name: 'lazy' }, after: { name: 'after' } }, 'built places');
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
    ending: source.replace("segment: 'landscape', ending: true, endingAfter: 'novemberRoads'", "segment: 'landscape', ending: false, endingAfter: 'novemberRoads'"),
    drop: source.replace(terrain, ''),
    treesPosition: source.replace("endingAfter: 'novemberRoads', ", ''), propsPosition: source.replace("endingAfter: 'canal', ", ''),
    // Anchors one entry too early: only the spied scenarios see trees before the wharves, or props before the canal.
    treesAnchor: source.replace("endingAfter: 'novemberRoads', ", "endingAfter: 'terrain', "), propsAnchor: source.replace("endingAfter: 'canal', ", "endingAfter: 'roads', "),
    anchor: source.replace("endingAfter: 'canal', ", "endingAfter: 'kanal', "),
    // The boss reads the frame's flags through the world table: a stale flag shows only in its arguments.
    bossHeld: source.replace('mirrorFlags.bossHeld = !driving ||', 'mirrorFlags.bossHeld = false ||'),
    mirror: source.replace("segment: 'mirror', ending: true", "segment: 'mirror', ending: false"),
    iterator: source.replace('for (let i = 0; i < list.length; i++) {\n    const entry = list[i];', 'for (const entry of list) {'),
  };
  assert.notEqual(mutations[name], source, name + ' changed source');
  return mutations[name];
}
export function mutations() {
  for (const name of ['swap', 'ending', 'drop', 'mirror', 'treesPosition', 'propsPosition', 'treesAnchor', 'propsAnchor', 'anchor', 'bossHeld', 'iterator']) {
    const result = spawnSync(process.execPath, [new URL(import.meta.url).pathname, '--mutation', name], { encoding: 'utf8' });
    assert.equal(result.status, 1, name + ' must exit 1');
    assert.match(result.stderr, name === 'iterator' ? /zero array iterators/ : name === 'anchor' ? /ending anchor 'kanal' for 'props' is missing/
      : name.endsWith('Anchor') ? /frame call order|dev cost entries/ : name === 'bossHeld' ? /frame arguments/ : /frame call order/, 'actual frame guard rejects ' + name);
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
  const entry = "  { name: 'dummy', segment: 'grass', ending: false, update: () => dummy.update(camera) },";
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
  await verifyPlaces(current());
  console.log('PASS places rows: porch dog waiting, boot build loop');
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
