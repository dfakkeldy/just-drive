#!/usr/bin/env node
// The mail car's switch and its fallback, without a browser. About a second.
// car-switch.ts, car-model.ts and the shared model loader (glb-model.ts, with three's GLTFLoader) are bundled with
// the code car stubbed and the network faked,
// then every way the model file can fail is tried: the game must get the code car, and one console line.
//   node tools/blender-car-switch-check.mjs               the checks
//   node tools/blender-car-switch-check.mjs --mutations   each known mistake below must make a check fail
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../web/node_modules/esbuild/lib/main.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = { desktop: readFileSync(`${root}web/public/models/mail-car.glb`), low: readFileSync(`${root}web/public/models/mail-car-low.glb`) };
const LIMIT = 250;   // the test's stand-in for the game's 8 s
let serial = 0;

/** The three modules as one fresh module (its own "which car" state). `edits` rewrites sources by file name. */
async function load(edits = {}) {
  const plugin = { name: 'stub the code car, edit on request', setup(b) {
    b.onResolve({ filter: /^\.\/car$/ }, () => ({ path: 'code-car', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ loader: 'js',
      contents: 'export function createCar(mailTrim = true, cleanText = false) { return { root: { name: "code-car" }, mailTrim, cleanText }; }' }));
    b.onLoad({ filter: /[\\/]web[\\/]src[\\/](car-switch|car-model|glb-model)\.ts$/ }, args => {
      let source = readFileSync(args.path, 'utf8');
      const edit = edits[basename(args.path)];
      if (edit) { const next = edit(source); assert.notEqual(next, source, `the mutation must change ${basename(args.path)}`); source = next; }
      return { contents: source, loader: 'ts' };
    });
  } };
  const result = await build({ stdin: { contents: "export * from './car-switch'; export { loadGlbScene } from './glb-model';", resolveDir: `${root}web/src`, loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', write: false, nodePaths: [`${root}web/node_modules`],
    define: { 'import.meta.env.BASE_URL': '"/"' }, plugins: [plugin], logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text + `\n// ${++serial}`).toString('base64'));
}

// ---- a pretend browser: a page address, a picture decoder and a network, each with a way to misbehave
const world = { net: 'good', decode: 'ok', delay: 0, asked: [], aborted: 0, warnings: [], errors: [] };
globalThis.self = globalThis;                      // GLTFLoader asks `self` for URL
const network = globalThis.fetch;                  // the pictures inside the file are read through blob: addresses
globalThis.createImageBitmap = () => world.decode === 'never' ? new Promise(() => {}) : world.decode === 'fails' ? Promise.reject(new Error('not a picture')) : Promise.resolve({ width: 1, height: 1 });
const untilAborted = signal => new Promise((_, reject) => signal?.addEventListener('abort', () => { world.aborted++; reject(new DOMException('aborted', 'AbortError')); }));
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('blob:')) return network(url);
  world.asked.push(String(url));
  let bytes = String(url).endsWith('mail-car-low.glb') ? files.low : files.desktop;
  const body = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  switch (world.net) {
    case 'network': throw new TypeError('Failed to fetch');
    case 'slow file': await new Promise(done => setTimeout(done, world.delay)); break;                // a good file, late
    case 'stall': return untilAborted(init?.signal);                                         // the server never answers
    case 'slow body': return { ok: true, status: 200, arrayBuffer: () => untilAborted(init?.signal) };   // headers, then nothing
    case '404': return { ok: false, status: 404, arrayBuffer: async () => body(Buffer.from('no')) };
    // The offline worker has no such file in its download (tools/build-pwa.mjs leaves the car out while it is off).
    case 'not in the offline copy': return { ok: false, status: 409, arrayBuffer: async () => body(Buffer.from('{"error":"update"}')) };
    case 'html page': bytes = Buffer.from('<!doctype html><html><body>the game page, served where the model should be</body></html>'); break;
    case 'cut in the middle': bytes = bytes.subarray(0, bytes.length >> 1); break;
    case 'cut 300 bytes before the end': bytes = bytes.subarray(0, bytes.length - 300); break;      // only the last picture is short
    case 'cut inside its JSON': bytes = bytes.subarray(0, 20 + (bytes.readUInt32LE(12) >> 1)); break;
    case 'cut inside its header': bytes = bytes.subarray(0, 10); break;
    case 'grown by one byte': bytes = Buffer.concat([bytes, Buffer.from([0])]); break;
    // A whole, well-formed file of another glTF version: the loader reads version 2 only.
    case 'a version 3 file': bytes = Buffer.from(bytes); bytes.writeUInt32LE(3, 4); break;
    // Every part is there, but the header gives another length: the file is not what its maker wrote.
    case 'a header with the wrong length': bytes = Buffer.from(bytes); bytes.writeUInt32LE(bytes.length + 4, 8); break;
    // The whole length is right, but the data part says it is 300 bytes shorter: the last picture would be cut.
    case 'a part that does not fit the file': { bytes = Buffer.from(bytes); const at = 20 + bytes.readUInt32LE(12); bytes.writeUInt32LE(bytes.readUInt32LE(at) - 300, at); break; }
    case 'damaged json': bytes = Buffer.from(bytes); bytes[30] = 0x7b; break;
    case 'missing node': { bytes = Buffer.from(bytes); bytes.write('"name":"driver_eyx"', bytes.indexOf('"name":"driver_eye"')); break; }
  }
  return { ok: true, status: 200, arrayBuffer: async () => body(bytes) };
};
console.warn = (...args) => world.warnings.push(args.map(String).join(' ').slice(0, 120));
console.error = (...args) => world.errors.push(args.map(String).join(' ').slice(0, 120));      // three.js reports a lost picture here
let unhandled = 0;
process.on('unhandledRejection', () => unhandled++);
const within = (promise, ms) => Promise.race([promise.then(() => 'resolved', () => 'rejected'), new Promise(done => setTimeout(() => done('still waiting'), ms))]);
const params = text => new URLSearchParams(text);
const find = (car, test) => { let found; car.root.traverse(o => { if (!found && test(o)) found = o; }); return found; };

/** Runs every check against the modules given by `edits`. Returns the labels that failed. */
async function run(edits) {
  const failed = [];
  const ok = (condition, label) => { if (!condition) failed.push(label); };
  const fresh = async net => { Object.assign(world, { net, decode: 'ok', delay: 0, asked: [], aborted: 0, warnings: [], errors: [] }); return load(edits); };

  let S = await fresh('good');
  await S.readyMailCar(params('car=code'), false); ok(S.buildMailCar().root.name === 'code-car' && world.asked.length === 0, '?car=code builds the code car and fetches nothing');
  const safe = test => { try { return test(); } catch { return false; } };      // a mutant may throw here: that is a failed check, not a crash
  const trims = build => safe(() => [[true, false], [false, false], [true, true], [false, true]].every(([mail, clean]) => { const car = build(mail, clean); return car.root.name === 'code-car' && car.mailTrim === mail && car.cleanText === clean; }));
  ok(trims(S.buildMailCar), 'the code car is built with the mail trim and the sign text that the mode asks for');
  // The Blender car is the default: an address that names no car gets it. ?car=code is the way back.
  ok(S.BLENDER_CAR_DEFAULT === true && S.wantsBlenderCar(params('')) && S.wantsBlenderCar(params('road=Highway 19')), 'an address that names no car asks for the Blender car');
  ok(S.wantsBlenderCar(params('car=blender')) && !S.wantsBlenderCar(params('car=code')), '?car=blender and ?car=code are read');
  world.asked = []; await S.readyMailCar(params(''), true);
  ok(S.buildMailCar().root.name === 'car_root', 'no ?car builds the Blender car: it is the default');
  ok(world.asked.length === 1 && world.asked[0] === '/models/mail-car-low.glb', 'a phone (LOW) asks for mail-car-low.glb, once');
  world.asked = []; await S.readyMailCar(params(''), false);
  ok(world.asked[0] === '/models/mail-car.glb', 'a desktop asks for mail-car.glb');
  world.asked = []; await S.readyMailCar(params('car=blender'), false);
  ok(S.buildMailCar().root.name === 'car_root' && world.asked.length === 0, '?car=blender builds the same car, from the file that is already here');
  await S.readyMailCar(params('car=code'), false); ok(S.buildMailCar().root.name === 'code-car', '?car=code still builds the code car after the Blender car was loaded');
  await S.readyMailCar(params(''), false);
  const duty = S.buildMailCar(true, false), off = S.buildMailCar(false, true);
  // The rig, read from the car the default path gave. (A mutant may give the code car here: then these are failed checks.)
  if (duty.root.name !== 'car_root' || off.root.name !== 'car_root') ok(false, 'the default path gives the Blender car, with its rig');
  else {
    ok(['fl', 'fr', 'rl', 'rr'].every(k => duty.wheels[k]) && duty.steer.fl && duty.steer.fr && duty.driverEye && duty.driverWindow && duty.brakeLights.length === 4, 'the rig has its wheels, pivots, eye, window and four brake lamps');
    const kit = car => find(car, o => o.name === 'roof_kit');
    ok(kit(off) && !kit(off).visible && !off.beacon.visible && !off.signLight.visible, 'off duty: roof kit, lamp and sign are hidden');
    ok(kit(duty)?.visible && duty.beacon.visible && duty.signLight.visible, 'on duty: roof kit, lamp and sign are shown');
    const plates = car => find(car, o => o.isMesh && o.material.name === 'Sign atlas' && o !== car.signLight).material;
    ok(off.signLight.material.map.offset.x === .5 && duty.signLight.material.map.offset.x === 0, 'clean text slides only that car\'s sign');
    ok(plates(off).map.offset.x === .25 && plates(duty).map.offset.x === 0, 'off duty slides only that car\'s plates, and not its sign\'s way');
    const mud = car => find(car, o => o.isMesh && o.material.name === 'Mud overlay').material;
    duty.setDirt(.2); ok(mud(duty).opacity === .2 && mud(off).opacity === .78, 'mud is per car: setDirt on one leaves the other alone');
    duty.setDirt(NaN); ok(mud(duty).opacity === 0 && !mud(duty).visible, 'setDirt(NaN) hides the mud');
    duty.setWindowDown(true); ok(!duty.driverWindow.visible, 'the driver\'s window opens');
    const lamps = car => find(car, o => o.isMesh && o.material.name === 'Head lamp')?.material;
    ok(lamps(duty)?.emissiveIntensity > 1 && lamps(off)?.emissiveIntensity > 1 && lamps(duty).emissiveMap, 'the head lamps are lit, brighter than the sign, on duty and off');
  }

  // Every way the file can fail, on the default path (an address that names no car): the game still gets a car (the code car), and one plain line in the console.
  for (const net of ['network', '404', 'not in the offline copy', 'html page', 'cut in the middle', 'cut 300 bytes before the end', 'cut inside its JSON', 'cut inside its header', 'grown by one byte', 'a version 3 file', 'a header with the wrong length', 'a part that does not fit the file', 'damaged json']) {
    S = await fresh(net);
    const state = await within(S.readyMailCar(params(''), false, LIMIT), 1000);
    ok(state === 'resolved', `${net}: readyMailCar resolves (it ${state})`);
    ok(S.buildMailCar().root.name === 'code-car' && world.warnings.length === 1, `${net}: the code car, and one console line (${world.warnings.length})`);
    ok(world.errors.length === 0, `${net}: nothing else in the console (${world.errors.join(' | ')})`);
    // The fallback is the car that the mode asked for: off duty has no mail trim, Just Drive has no words on the sign.
    ok(trims(S.buildMailCar), `${net}: the fallback car keeps the mail trim and sign text that the mode asks for`);
  }
  // A whole file with a picture that does not decode: three.js would go on without it. The car is not used.
  S = await fresh('good'); world.decode = 'fails';
  await within(S.readyMailCar(params(''), false, LIMIT), 1000);
  ok(safe(() => S.buildMailCar().root.name === 'code-car') && world.warnings.length === 1, 'a picture that does not decode: the code car, not a car without its pictures');
  for (const [net, decode] of [['stall', 'ok'], ['slow body', 'ok'], ['good', 'never']]) {
    S = await fresh(net); world.decode = decode;
    const label = decode === 'never' ? 'pictures never decode' : net, began = Date.now();
    const state = await within(S.readyMailCar(params(''), true, LIMIT), LIMIT + 600);
    ok(state === 'resolved', `${label}: readyMailCar gives up at its limit (it ${state} after ${Date.now() - began} ms)`);
    ok(S.buildMailCar().root.name === 'code-car' && world.warnings.length === 1, `${label}: the code car, and one console line (${world.warnings.length})`);
  }
  S = await fresh('missing node');
  await S.readyMailCar(params(''), false, LIMIT);
  let built; try { built = S.buildMailCar(); } catch { built = null; }
  ok(built?.root.name === 'code-car' && world.warnings.length === 1, 'a file without driver_eye: the build falls back to the code car, with one console line');
  try { built = S.buildMailCar(); } catch { built = null; }
  ok(built?.root.name === 'code-car' && world.warnings.length === 1, '... and the next build goes straight to the code car');
  // The reader on its own: a stalled request is given up, and really cancelled, at the limit.
  S = await fresh('stall');
  const alone = await within(S.loadGlbScene('mail-car.glb', LIMIT), LIMIT + 600);
  ok(alone === 'rejected' && world.aborted === 1, `the reader cancels a stalled request at its limit (it ${alone}, ${world.aborted} cancelled)`);
  // ... and so is a body that stops after fast headers: the limit does not end when the headers arrive.
  S = await fresh('slow body');
  const slow = await within(S.loadGlbScene('mail-car.glb', LIMIT), LIMIT + 600);
  ok(slow === 'rejected' && world.aborted === 1, `the reader cancels a body that never ends, after fast headers (it ${slow}, ${world.aborted} cancelled)`);
  // The clock starts when the game needs the car, not when the download starts. A slow first visit: the download
  // begins early (preloadMailCar), the land takes 300 ms, the file takes 700 ms. The game then waits up to 600 ms
  // and gets the Blender car 400 ms later. (Counted from the download's start, 600 ms would have been over.)
  S = await fresh('slow file'); world.delay = 700;
  S.preloadMailCar(params(''), false);
  ok(world.asked.length === 1 || await new Promise(done => setTimeout(() => done(world.asked.length === 1), 20)), 'the download starts at once, before the game needs the car');
  await new Promise(done => setTimeout(done, 300));
  await within(S.readyMailCar(params(''), false, 600), 1500);
  ok(safe(() => S.buildMailCar().root.name === 'car_root') && world.warnings.length === 0 && world.asked.length === 1, `a car file that arrives while the game waits is used, however long the land took (${world.warnings.length} warnings, ${world.asked.length} requests)`);
  // ... and the wait itself is still bounded: a file that needs longer than the limit after the game asks gives the code car.
  S = await fresh('slow file'); world.delay = 900;
  S.preloadMailCar(params(''), false); const asked = Date.now();
  const bounded = await within(S.readyMailCar(params(''), false, LIMIT), LIMIT + 400);
  ok(bounded === 'resolved' && safe(() => S.buildMailCar().root.name === 'code-car') && world.warnings.length === 1, `the game waits no longer than its limit once it needs the car (it ${bounded} after ${Date.now() - asked} ms)`);
  // An early download for the other file (phone or desktop) is not used: the right one is asked for.
  S = await fresh('good');
  S.preloadMailCar(params(''), true); await within(S.readyMailCar(params(''), false, LIMIT), 1000);
  ok(safe(() => S.buildMailCar().root.name === 'car_root') && world.asked.includes('/models/mail-car.glb'), 'ready asks for its own file when the early download was for the other quality');
  S = await fresh('good');
  S.preloadMailCar(params('car=code'), false); await within(S.readyMailCar(params('car=code'), false, LIMIT), 1000);
  ok(world.asked.length === 0 && safe(() => S.buildMailCar().root.name === 'code-car'), '?car=code starts no download, early or late');
  // A file that came too late is not kept: the next call asks the network again and gets the car.
  S = await fresh('good'); world.decode = 'never';
  await within(S.readyMailCar(params(''), false, LIMIT), LIMIT + 600);
  world.decode = 'ok'; world.asked = [];
  await within(S.readyMailCar(params(''), false, LIMIT), LIMIT + 600);
  ok(safe(() => S.buildMailCar().root.name === 'car_root') && world.asked.length === 1, `after a load that was given up, the next call asks again and gets the Blender car (${world.asked.length} requests)`);
  await new Promise(done => setTimeout(done, 30));
  ok(unhandled === 0, `no unhandled rejection (${unhandled})`); unhandled = 0;
  return failed;
}

const swap = (from, to) => source => { assert.ok(source.includes(from), `mutation anchor not found: ${from.slice(0, 60)}`); return source.replace(from, to); };
// M1 to M4 stand for the review's four (r1, 13 Nov 2026). Only M4 was found written down; M1 to M3 are this
// file's reading of the review notes. The rest are this file's own.
const MUTANTS = [
  ['M1 a phone is given the desktop file', { 'car-model.ts': swap("low ? 'mail-car-low' : 'mail-car'", "'mail-car'") }],
  ['M2 off duty keeps the roof kit', { 'car-model.ts': swap("node('roof_kit').visible = beacon.visible", 'beacon.visible') }],
  ['M3 every car shares one set of materials (one mud for all)', { 'car-model.ts': swap('mine = shared.clone();', 'mine = shared;') }],
  ['M4 the reader never cancels a stalled request', { 'glb-model.ts': swap('setTimeout(() => stop.abort(), timeoutMs)', 'setTimeout(() => {}, timeoutMs)') }],
  ['M5 a failed load is thrown at the game', { 'car-switch.ts': swap('    blender = null;\n    console.warn(\'The Blender mail car did not load.', '    throw error;\n    console.warn(\'The Blender mail car did not load.') }],
  ['M6 no limit over the whole load (decode can hang)', { 'car-switch.ts': swap('blender = await Promise.race([mine.load, late]);', 'blender = await mine.load;') }],
  ['M7 a failed build is thrown at the game', { 'car-switch.ts': swap("catch (error) { blender = null; console.warn('The Blender mail car could not be built.", "catch (error) { throw error; console.warn('The Blender mail car could not be built.") }],
  ['M8 clean text slides the plates too', { 'car-model.ts': swap("const plates = material('Sign atlas'), sign = plates.clone();", "const plates = material('Sign atlas'), sign = plates;") }],
  ['M9 off duty leaves the mail plate', { 'car-model.ts': swap('slide(plates, OFF_DUTY_PLATE); ', '') }],
  // Review r1 of the default branch, S3: the 8 s counted from the page's start, so a slow first visit lost the car.
  ['M17 the download does not start early', { 'car-switch.ts': swap('void {\n  early = null;\n  if (!wantsBlenderCar(params)) return;', 'void {\n  early = null;\n  return;') }],
  ['M18 the clock starts when the download starts', { 'car-switch.ts': swap('ms ago)`)), limitMs); });', 'ms ago)`)), Math.max(0, limitMs - (Date.now() - mine.startedAt))); });') }],
  ['M16 the code car is the default again', { 'car-switch.ts': swap('export const BLENDER_CAR_DEFAULT = true;', 'export const BLENDER_CAR_DEFAULT = false;') }],
  ['M10 the head lamps are lit no more than the sign', { 'car-model.ts': swap("material('Head lamp').emissiveIntensity = HEAD_LAMPS;", "material('Head lamp').emissiveIntensity = .24;") }],
  // Review r2 (14 Nov 2026): its M1 and M2 passed every row then.
  ['R2-M1 the fallback car ignores the mail trim', { 'car-switch.ts': swap('  return createCar(mailTrim, cleanText);', '  return createCar();') }],
  ['R2-M2 the time limit ends when the headers arrive', { 'glb-model.ts': swap('    if (!response.ok) throw new Error(`${file}: ${response.status}`);\n    const bytes = await response.arrayBuffer(), head', '    clearTimeout(timer);\n    if (!response.ok) throw new Error(`${file}: ${response.status}`);\n    const bytes = await response.arrayBuffer(), head') }],
  // The loader has two length checks (the header's whole length, and the parts end where the file ends). One alone
  // already stops a cut file, so M11 takes out both; M12 takes out the second, which alone stops a short data part.
  ['M11 a file that is cut short is read anyway', { 'glb-model.ts': source => swap('if (head.getUint32(8, true) !== bytes.byteLength) throw', 'if (false) throw')(swap('    if (at !== bytes.byteLength) throw', '    if (false) throw')(source)) }],
  ['M12 a file with a part that does not fit is read anyway', { 'glb-model.ts': swap('    if (at !== bytes.byteLength) throw', '    if (false) throw') }],
  // Review r3, N1: without the version rule a version 3 file loaded as a car, and every row still passed.
  ['M15 a file of another glTF version is read anyway', { 'glb-model.ts': swap(' || head.getUint32(4, true) !== 2) throw', ') throw') }],
  ['M13 a car without its pictures is used', { 'car-model.ts': swap('for (const name of PICTURED) if (!pictured.has(name)) throw', 'for (const name of PICTURED) if (false) throw') }],
  ['M14 a file that came too late is kept', { 'car-switch.ts': swap('      mine.forget();\n', '') }],
];

const base = await run();
for (const label of base) console.log('FAIL', label);
assert.deepEqual(base, [], 'the car switch checks');
console.log('PASS blender-car-switch: both files, the switch, LOW, mail trim, clean text, mud per car, and nineteen ways for the file to fail');
if (process.argv.includes('--mutations')) {
  for (const [name, edits] of MUTANTS) {
    const failed = await run(edits);
    assert.ok(failed.length > 0, `mutant survived: ${name}`);
    console.log(`CAUGHT ${name}: ${failed[0]}${failed.length > 1 ? ` (+${failed.length - 1} more)` : ''}`);
  }
  console.log(`PASS blender-car-switch mutations: all ${MUTANTS.length} caught`);
}
process.exit(0);
