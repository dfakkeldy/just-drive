// Ongoing editable oracle: execute the extracted shipping frame + real hooks, without WebGL.
// History is consulted only with an explicit --audit REV.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import ts from '../web/node_modules/typescript/lib/typescript.js';
import { current, hooksSource, hookFactory, spy } from './world-update-fixture.mjs';

const auto = { throttle: .6, steer: .25, handbrake: false };
const manual = { throttle: .2, steer: -.1, handbrake: false, touch: true };
const brake = { throttle: 0, steer: 0, handbrake: true };
const call = (name, ...args) => [name, ...args];
// The input and extra effects below are the editable expectations, never derived from hooks.
const cases = [
  { name: 'plain visit', query: '', input: manual },
  { name: 'demo cruise', query: 'demo=2', cruise: 16, input: auto },
  { name: 'throw cruise and mail', query: 'demo=2&throw=1', cruise: 8, input: auto, mail: true },
  { name: 'throw without demo', query: 'throw=1', input: manual },
  { name: 'throw waits for terrain', query: 'demo=2&throw=1', unloaded: true, cruise: 8, input: auto },
  { name: 'knock shoulder', query: 'demo=2&knock=1', cruise: 16, nearest: true, input: { ...auto, steer: -.3 } },
  { name: 'knock without road', query: 'demo=2&knock=1', cruise: 16, nearest: true, noRoad: true, input: auto },
  { name: 'knock reversed heading', query: 'demo=2&knock=1', cruise: 16, nearest: true, reverse: true, input: { ...auto, steer: -.3 } },
  { name: 'knock without props', query: 'demo=2&knock=1', cruise: 16, nearest: true, noProps: true, input: { ...auto, steer: .21000000000000005 } },
  { name: 'lawn presence', query: 'demo=2&lawn=0', cruise: 16, input: { throttle: 1, steer: 0, handbrake: false } },
  { name: 'lawn pending', query: 'demo=2&lawn=4', cruise: 16, lawn: false, input: { throttle: 0, steer: 0, handbrake: true } },
  { name: 'lawn without demo', query: 'lawn=4', lawn: false, input: { ...manual, throttle: 0, handbrake: true } },
  { name: 'lawn explore', query: 'demo=2&lawn=4', explore: true, cruise: 16, input: auto },
  { name: 'stuffed presence', query: 'demo=2&stuffed=0', cruise: 16, input: { ...auto, throttle: 0, handbrake: true } },
  { name: 'stuffed without demo', query: 'stuffed=1', input: manual },
  { name: 'combined input precedence', query: 'demo=2&throw=1&knock=1&lawn=4&stuffed=0', cruise: 8, nearest: true, input: { throttle: 0, steer: 0, handbrake: true }, mail: true },
  { name: 'demo stopped', query: 'demo=2', drove: 2, parked: true, input: brake },
  { name: 'demo moving brake', query: 'demo=2', drove: 2, speed: .4, input: { ...brake, throttle: -1 } },
  { name: 'demo reverse brake', query: 'demo=2', drove: 2, speed: -.4, input: { ...brake, throttle: 1 } },
  { name: 'demo boundary after drive', query: 'demo=0.05&throw=1', cruise: 8, input: auto },
  { name: 'break without demo', query: 'break=1', input: manual, request: true },
  { name: 'break waits for demo', query: 'demo=2&break=1', cruise: 16, input: auto },
  { name: 'break after demo', query: 'demo=2&break=1', drove: 2, parked: true, input: brake, request: true },
  { name: 'break already used', query: 'break=1', breaks: 1, input: manual },
  { name: 'report without demo', query: 'report=1', input: manual, end: true },
  { name: 'report waits for demo', query: 'demo=2&report=1', cruise: 16, input: auto },
  { name: 'report waits for terrain', query: 'report=1', unloaded: true, input: manual },
  { name: 'report waits for relief', query: 'report=1', busy: true, input: brake },
  { name: 'report waits for break', query: 'break=1&report=1', input: manual, request: true },
  { name: 'report after break', query: 'break=1&report=1', breaks: 1, input: manual, end: true },
  { name: 'report too fast', query: 'report=1', speed: .15, input: manual },
  { name: 'photo once', query: 'demo=2&photo=1', cruise: 16, input: auto, photos: [true, false], frames: 2 },
  { name: 'photo retries', query: 'demo=2&photo=1', cruise: 16, input: auto, photos: [true, true], failPhoto: true, frames: 2 },
  { name: 'photo range edge', query: 'demo=2&photo=1', cruise: 16, input: auto, range: 43, photos: [true] },
  { name: 'photo out of range', query: 'demo=2&photo=1', cruise: 16, input: auto, range: 43.01 },
  { name: 'photo inactive', query: 'demo=2&photo=1', cruise: 16, input: auto, inactive: true },
  { name: 'photo unloaded', query: 'demo=2&photo=1', cruise: 16, input: auto, unloaded: true },
  { name: 'photo without demo', query: 'photo=1', input: manual },
  { name: 'photo before report', query: 'demo=2&photo=1&report=1', drove: 2, parked: true, input: brake, photos: [true], end: true },
  { name: 'switches require one', query: 'demo=2&throw=0&knock=yes&break=true&photo=2&report=0', cruise: 16, input: auto },
  { name: 'demo fly excludes input/photo', query: 'demo=2&photo=1', fly: true },
  { name: 'photo latch reset', query: 'demo=2&photo=1', cruise: 16, input: auto, photos: [true, true], frames: 2, reset: true },
];
for (const value of ['', '0', 'NaN', '-1', 'Infinity']) cases.push({ name: 'demo parsing ' + value, query: 'demo=' + value,
  ...(value === '-1' ? { parked: true, input: brake } : { cruise: 16, input: auto }) });
// `parked`: a demo that has already driven its distance and stands still, so the frame never reaches driveVehicle.

function observe(source, hooks, s, dev) {
  const result = spy(source, false, dev, false, (c, trace) => {
    c.params = new URLSearchParams(s.query);
    const value = c.params.get('demo'); c.demo = value === null ? 0 : parseFloat(value) || 8;
    c.drove = s.drove ?? 0; c.vehicle.speed = s.speed ?? 0; c.vehicle.heading = 0;
    c.sunShadows = null; c.mode = s.fly ? 'fly' : 'drive'; c.mailMode = !s.explore;
    c.hooksSource = hooks;
    c.driveInput = () => ({ ...manual });
    c.autopilot = (v, roads, cruise) => { assert.equal(v, c.vehicle); assert.equal(roads, c.roads); trace('autopilot')(cruise); return { ...auto }; };
    c.roads = { update: trace('roads'), nearest: (x, z, distance, filter) => {
      trace('nearest')(x, z, distance, filter({ kind: 3 }), filter({ kind: 4 }));
      return s.noRoad ? null : { x: 0, z: 5, heading: s.reverse ? -Math.PI : 0, road: { halfWidth: 3 } };
    } };
    c.props = s.noProps ? null : { update: trace('props'), mail: [
      { x: 5, z: 4, motion: { down: true } }, { x: -1, z: 4, motion: { down: false } },
      { x: 2, z: 0, motion: { down: false } }, { x: 3, z: -50, motion: { down: false } },
    ] };
    if (s.lawn !== undefined) c.lawnDemo = { driving: s.lawn, prepare: () => false };
    c.terrain.pending = s.unloaded ? 1 : 0;
    c.relief.busy = !!s.busy; c.relief.breaks = s.breaks ?? 0;
    c.relief.request = trace('relief.request');
    c.shift.evidence = { subjects: new Map([
      ['inactive', { active: false, x: 3, z: 5 }], ['far', { active: true, x: 100, z: 5 }],
      ['first', { active: !s.inactive, x: 3 + (s.range ?? 1), z: 5 }],
      ['second', { active: !s.inactive, x: 3 + (s.range ?? 2), z: 5 }],
    ]) };
    c.shift.takePhoto = (v, camera) => { assert.equal(v, c.vehicle); assert.equal(camera, c.camera); trace('shift.photo')(); return !s.failPhoto; };
    c.shift.end = () => { trace('shift.end')(); c.shift.ended = true; };
    c.driveVehicle = (dt, input) => trace('input')(JSON.parse(JSON.stringify(input)));
    c.vehicle.place = () => {}; // Parked demo does not reach driveVehicle; probe the hook return below too.
    c.devInputProbe = trace('demo.input');
  }, (frame, c) => {
    // Freeze parameters after startup. Any frame/hook read fails, including reads on the second frame.
    c.params.get = c.params.has = () => { throw Error('parameter read per frame'); };
    if (c.devHooks) {
      const input = c.devHooks.demoInput.bind(c.devHooks);
      c.devHooks.demoInput = (d, v, r, p, l, m, get) => { const value = input(d, v, r, p, l, m, get); c.devInputProbe(JSON.parse(JSON.stringify(value))); return value; };
    }
    for (let i = 0; i < (s.frames ?? 1); i++) {
      if (i && s.reset) { if (c.devHooks) c.devHooks.reset(); else c.demoPhoto = false; }
      // Baseline audit deliberately permits its historical URL reads.
      if (!c.devHooks) { delete c.params.get; delete c.params.has; }
      frame(1050 + i * 50);
    }
  });
  const indexes = {};
  const focus = new Set(['autopilot', 'nearest', 'input', 'mail', 'journey', 'relief.request', 'relief', 'render', 'shift.photo', 'shift.end']);
  const frames = []; let entries = [];
  for (const name of result.calls) {
    const i = indexes[name] ?? 0; indexes[name] = i + 1;
    if (focus.has(name)) {
      const args = result.args[name][i];
      if (name === 'mail') entries.push(call(name, args[2]));
      else if (['journey', 'relief', 'render'].includes(name)) entries.push(call(name));
      else entries.push(call(name, ...args));
    }
    if (name === 'raf') { frames.push(entries); entries = []; }
  }
  return { frames, inputs: result.args['demo.input']?.map(x => x[0]) ?? [], iterators: result.iterators };
}
function expected(s, i) {
  return [
    ...(s.cruise ? [call('autopilot', s.cruise)] : []),
    ...(s.nearest ? [call('nearest', 3, 5, 40, true, false)] : []),
    ...(!s.fly && !s.parked ? [call('input', s.input)] : []),
    call('mail', !!s.mail), call('journey'), ...(s.request ? [call('relief.request')] : []), call('relief'), call('render'),
    ...(s.photos?.[i] ? [call('shift.photo')] : []), ...(s.end ? [call('shift.end')] : []),
  ];
}
function guards(source, hooks) {
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const frame = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'frame');
  assert.doesNotMatch(frame.getText(ast), /params\s*\.\s*(get|has)\s*\(/, 'frame has no URL reads');
  const hookAst = ts.createSourceFile('dev-hooks.ts', hooks, ts.ScriptTarget.Latest, true);
  const forbidden = new Set([ts.SyntaxKind.NewExpression, ts.SyntaxKind.ObjectLiteralExpression, ts.SyntaxKind.ArrayLiteralExpression,
    ts.SyntaxKind.ArrowFunction, ts.SyntaxKind.FunctionExpression, ts.SyntaxKind.ForOfStatement, ts.SyntaxKind.ForInStatement]);
  function visit(n) { assert.ok(!forbidden.has(n.kind), 'hook hot path has no allocations/iterators'); ts.forEachChild(n, visit); }
  for (const n of hookAst.statements) if (ts.isClassDeclaration(n)) for (const m of n.members) {
    if (ts.isMethodDeclaration(m)) visit(m.body);
    if (ts.isPropertyDeclaration(m) && m.initializer && ts.isArrowFunction(m.initializer)) visit(m.initializer.body);
  }
  assert.match(source, /if \(devHooks\.afterEnabled\) devHooks\.afterFrame/);
  assert.match(source, /devHooks\.inputEnabled \? devHooks\.demoInput/);
}
function verify(source, hooks, verbose = true) {
  guards(source, hooks);
  const params = new URLSearchParams('demo=2'), reads = [];
  for (const method of ['get', 'has']) params[method] = function (key) { reads.push(method + ':' + key); return URLSearchParams.prototype[method].call(this, key); };
  const Hooks = hookFactory(hooks)({});
  const instance = new Hooks(params);
  assert.deepEqual(reads, ['get:demo', 'get:throw', 'get:knock', 'get:break', 'get:photo', 'get:report', 'has:lawn', 'has:stuffed'], 'each startup parameter is read once');
  const vehicle = { speed: .4 };
  const stopped = instance.demoInput(2, vehicle, null, null, null, false, null);
  vehicle.speed = -.4;
  assert.equal(instance.demoInput(2, vehicle, null, null, null, false, null), stopped, 'braking reuses the startup input');
  assert.deepEqual(stopped, { throttle: 1, steer: 0, handbrake: true });
  for (const s of cases) for (const dev of [true, false]) {
    const observed = observe(source, hooks, s, dev);
    assert.deepEqual(observed.frames, Array.from({ length: s.frames ?? 1 }, (_, i) => expected(s, i)), s.name + ' real frame trace');
    if (observed.inputs.length) for (const input of observed.inputs) assert.deepEqual(input, s.input, s.name + ' hook input');
    assert.equal(observed.iterators, 0, s.name + ' no frame array iterators');
  }
  if (verbose) console.log(`PASS ${cases.length} demo cases in dev + production; URL reads frozen after startup; frame/hook allocation guards`);
}
const mutationAt = process.argv.indexOf('--mutation');
let source = current(), hooks = hooksSource();
const mutations = {
  'swap-throw-cruise': ["this.throwMail ? 8 : 16", "this.throwMail ? 16 : 8"],
  'drop-knock': ['&& this.knock)', '&& false)'],
  'report-busy': ['&& !relief.busy &&', '&& true &&'],
  'photo-twice': ['&& !this.demoPhoto &&', '&& true &&'],
  'frame-param': ['const frameLive = started && !shift.ended && !endings.busy;', "const frameLive = started && !shift.ended && !endings.busy; params.get('throw');"],
  'throw-unloaded': ['drove < demo && loaded && devHooks.throwMail', 'drove < demo && devHooks.throwMail'],
  'hook-param': ['this.stopped.throttle =', "new URLSearchParams().get('demo'); this.stopped.throttle ="],
};
if (mutationAt >= 0) {
  const name = process.argv[mutationAt + 1], [from, to] = mutations[name];
  if (name === 'frame-param' || name === 'throw-unloaded') { assert.ok(source.includes(from)); source = source.replace(from, to); }
  else { assert.ok(hooks.includes(from)); hooks = hooks.replace(from, to); }
}
verify(source, hooks);
if (process.argv.includes('--mutations')) for (const name of Object.keys(mutations)) {
  const result = spawnSync(process.execPath, [new URL(import.meta.url).pathname, '--mutation', name], { encoding: 'utf8' });
  assert.equal(result.status, 1, name + ' exits 1');
  assert.match(result.stderr, /real frame trace|frame has no URL reads|hook hot path/);
  console.log('KILLED ' + name + ': exit 1');
}
const auditAt = process.argv.indexOf('--audit');
if (auditAt >= 0) {
  const ref = process.argv[auditAt + 1]; assert.match(ref, /^[\w./-]+$/);
  const baseline = execFileSync('git', ['show', ref + ':web/src/main.ts'], { encoding: 'utf8' });
  for (const s of cases) for (const dev of [true, false]) {
    assert.deepEqual(observe(source, hooks, s, dev).frames, observe(baseline, hooks, s, dev).frames, s.name + ' historical trace');
  }
  console.log('PASS explicit historical audit ' + ref);
}
