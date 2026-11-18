// CPU-only check of the driving sounds' arithmetic (web/src/engine-sound-rules.ts): gears, engine speed, pitch, load and
// the tyre noise on each surface, plus the wiring that keeps the audio behind the first tap and off on a hidden page.
// The browser half is tools/engine-sound-browser.mjs.
// node tools/run-node-check.mjs tools/engine-sound-check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENGINES, engineKind, engineState, gearFor, tyreState, RADIO_DUCK, OUTPUT_TRIM } from '../web/src/engine-sound-rules.ts';
import { WASHBOARD_WAVE } from '../web/src/defects.ts';

const root = process.env.MMM_ROOT ?? process.cwd();
const read = file => readFileSync(resolve(root, file), 'utf8');
const flat = { airborne: false, grade: 0, towing: false };
let checks = 0;
const ok = (cond, what) => { assert.ok(cond, what); checks++; };

// Which garage ids have a motor.
for (const id of ['car', 'truck', 'sxs', 'bike']) ok(engineKind(id) === id, `${id} has an engine`);
for (const id of ['horse', '', 'trailer']) ok(engineKind(id) === null, `${id || 'empty'} has no engine`);

for (const [kind, p] of Object.entries(ENGINES)) {
  // A run from rest to top speed at full throttle, carrying the gear from moment to moment as the game does.
  const top = p.gears ? p.gears.at(-1) : 25;
  let gear = 1, lastGear = 1, lastRpm = 0, shifts = 0;
  for (let v = 0; v <= top * .95; v += .05) {
    const e = engineState(p, { ...flat, speed: v, throttle: 1 }, gear);
    ok(e.rpm >= p.idle - 1e-9 && e.rpm <= p.redline + 1e-9, `${kind} rpm in range at ${v.toFixed(2)} m/s`);
    ok(Math.abs(e.frequency - e.rpm / 60 * p.pulses) < 1e-9, `${kind} pitch is the firing rate`);
    ok(e.gear >= lastGear && e.gear - lastGear <= 1, `${kind} changes up one gear at a time under full throttle`);
    if (e.gear > lastGear) { shifts++; ok(e.rpm < lastRpm, `${kind} rpm drops at the change into ${e.gear}`); }
    else ok(e.rpm >= lastRpm - 1e-9, `${kind} rpm never falls while accelerating in one gear`);
    ok(e.cutoff >= 160 && e.cutoff <= 6000 && e.gain > 0 && e.gain <= 1, `${kind} voice settings in range`);
    gear = lastGear = e.gear; lastRpm = e.rpm;
  }
  if (p.gears) ok(shifts === p.gears.length - 1, `${kind} uses all ${p.gears.length} gears (${shifts + 1})`);
  else ok(shifts === 0, `${kind} belt drive never shifts`);

  // At rest and off the pedal: idle.
  const idle = engineState(p, { ...flat, speed: 0, throttle: 0 }, 1);
  ok(idle.rpm === p.idle && idle.gear === 1, `${kind} idles at rest`);
  // Pulling away, the engine rises with the pedal before the car moves.
  ok(engineState(p, { ...flat, speed: 0, throttle: 1 }, 1).rpm > p.idle * 1.5, `${kind} revs up when pulling away`);
  // Backing up is gear one, not a negative engine speed.
  const back = engineState(p, { ...flat, speed: -3, throttle: -1 }, 1);
  ok(back.rpm >= p.idle && back.gear === 1, `${kind} reverse runs forward`);
  // The reverse pedal is load, not coasting, and reverse is one gear however fast.
  ok(back.load > engineState(p, { ...flat, speed: -3, throttle: 0 }, 1).load + .3, `${kind} reverse pedal is load`);
  ok(engineState(p, { ...flat, speed: -6, throttle: -1 }, 3).gear === 1, `${kind} stays in reverse gear`);
  ok(engineState(p, { ...flat, speed: -.1, throttle: -1 }, 1).rpm > p.idle * 1.3, `${kind} revs when starting to back up`);
  // Forward pedal while rolling back is the brake, not load.
  ok(engineState(p, { ...flat, speed: -3, throttle: 1 }, 1).load < .1, `${kind} braking a backward roll is not load`);
  // Braking while rolling forward is not reverse.
  ok(engineState(p, { ...flat, speed: 8, throttle: -1 }, 2).load < .1, `${kind} braking forward is not load`);

  // Headroom: the loudest moment (redline, full load, uphill, towing, the loudest tyre surface, the rasp) stays under
  // full scale at slider 1. Voice amplitude 1, plus the upper voice at .35; filter resonance is not counted.
  const loud = engineState(p, { speed: top * .9, throttle: 1, airborne: false, grade: .2, towing: true }, p.gears?.length ?? 1);
  const tyreMax = Math.max(...['pavement', 'gravel', 'dirt track', 'washboard', 'grass'].map(s => tyreState(s, 30, false, p.tyres).gain));
  const peak = (loud.gain * 1.35 + tyreMax + p.level * .12 * loud.load ** 2) * OUTPUT_TRIM;
  ok(peak <= 1, `${kind} peak ${peak.toFixed(2)} stays under full scale`);

  // Load: full pedal > part pedal > coasting; uphill and towing add; louder with load.
  const at = (o) => engineState(p, { ...flat, speed: 12, ...o }, 2);
  const full = at({ throttle: 1 }), part = at({ throttle: .3 }), coast = at({ throttle: 0 }), hill = at({ throttle: .3, grade: .08 }), tow = at({ throttle: .3, towing: true });
  ok(full.load > part.load && part.load > coast.load, `${kind} load follows the pedal`);
  ok(hill.load > part.load, `${kind} works harder uphill`);
  ok(tow.load > part.load, `${kind} works harder towing`);
  ok(full.gain > part.gain && part.gain > coast.gain, `${kind} louder under load`);
  ok(full.cutoff > coast.cutoff, `${kind} brighter under load`);
  ok(at({ throttle: -1 }).load === coast.load, `${kind} braking is not load`);

  // In the air the engine flares with the pedal and the tyres go silent.
  const air = engineState(p, { ...flat, airborne: true, speed: 10, throttle: 1 }, 2);
  ok(air.rpm > .9 * p.redline, `${kind} flares in the air`);
  ok(engineState(p, { ...flat, airborne: true, speed: 10, throttle: 0 }, 2).rpm === p.idle, `${kind} drops to idle in the air off the pedal`);
}

// The box does not hunt: speed wobbling about a change point changes gear at most once.
{
  const p = ENGINES.car, edge = p.gears[0] * .9;
  let gear = 1, changes = 0;
  for (let i = 0; i < 400; i++) {
    const g = gearFor(p, edge + Math.sin(i) * .4, 1, gear);
    if (g !== gear) changes++;
    gear = g;
  }
  ok(changes <= 1, `no gear hunting (${changes} changes)`);
  // Cruising shifts earlier (lower rpm) than flat out.
  const shiftRpm = (throttle) => {
    let g = 1;
    for (let v = 0; v < 20; v += .05) { const e = engineState(p, { ...flat, speed: v, throttle }, g); if (e.gear === 2) return p.redline * (v - .05) / p.gears[0]; g = e.gear; }
    return Infinity;
  };
  ok(shiftRpm(.3) < shiftRpm(1) - 1000, 'a light foot changes up earlier');
  // Coming down: slowing in top gear falls through the gears to first.
  let g = p.gears.length;
  for (let v = 40; v >= 0; v -= .1) g = gearFor(p, v, 0, g);
  ok(g === 1, 'slowing down returns to first gear');
}

// The belt drive (side by side) holds its note: same pedal, different road speeds, nearly the same engine speed.
{
  const p = ENGINES.sxs, a = engineState(p, { ...flat, speed: 6, throttle: 1 }, 1), b = engineState(p, { ...flat, speed: 16, throttle: 1 }, 1);
  ok(Math.abs(a.rpm - b.rpm) < 1000 && a.rpm > 4000, `CVT holds its note (${a.rpm.toFixed(0)} vs ${b.rpm.toFixed(0)})`);
}

// Each motor has its own character.
ok(ENGINES.bike.wave === 'square' && ENGINES.car.wave === 'sawtooth', 'two-stroke buzz, four-stroke growl');
ok(ENGINES.truck.idle / 60 * ENGINES.truck.pulses > ENGINES.car.idle / 60 * ENGINES.car.pulses, 'the V8 fires faster at idle than the four');
ok(ENGINES.truck.redline < ENGINES.car.redline && ENGINES.bike.redline > ENGINES.car.redline, 'the truck turns slowest, the bike fastest');

// Tyres: every surface name the vehicle can report has a sound, and nothing else does.
const surfaces = [...read('web/src/vehicle.ts').matchAll(/^\s+\w+: \{ mu: [^}]*name: '([^']+)' \}/gm)].map(m => m[1]);
ok(surfaces.length >= 8 && surfaces.includes('washboard'), `found the surface table (${surfaces.join(', ')})`);
for (const s of surfaces) ok(tyreState(s, 12, false).gain > 0, `${s} has a tyre sound`);
ok(tyreState('nowhere', 12, false).gain === 0, 'an unknown surface is silent');
for (const s of surfaces) {
  ok(tyreState(s, 0, false).gain === 0, `${s} silent at rest`);
  ok(tyreState(s, 15, true).gain === 0, `${s} silent in the air`);
  ok(tyreState(s, 20, false).gain >= tyreState(s, 8, false).gain, `${s} louder with speed`);
  ok(Math.abs(tyreState(s, 12, false, .5).gain - tyreState(s, 12, false).gain * .5) < 1e-12, `${s} scales`);
}
for (const v of [3, 8, 14, 30]) {
  const w = tyreState('washboard', v, false);
  ok(Math.abs(w.rate - Math.min(60, v / WASHBOARD_WAVE)) < 1e-9, `washboard rattles at the ridge rate at ${v} m/s`);
  ok(w.depth > .7, 'washboard is a hard rattle');
}
ok(tyreState('washboard', 12, false).gain > tyreState('gravel', 12, false).gain && tyreState('gravel', 12, false).gain > tyreState('pavement', 12, false).gain, 'washboard > gravel > pavement');
ok(tyreState('pavement', 12, false).frequency > tyreState('gravel', 12, false).frequency && tyreState('gravel', 12, false).frequency > tyreState('washboard', 12, false).frequency, 'hiss high, crunch mid, rattle low');
ok(tyreState('pavement', 12, false).depth === 0 && tyreState('gravel', 12, false).depth > 0, 'asphalt is a steady hiss, gravel chatters');
ok(RADIO_DUCK > 0 && RADIO_DUCK < 1, 'the radio ducks the driving sound, never mutes it');

// Wiring (source): no context before a tap, suspended when hidden and when not driving, silenced at an ending.
{
  const sound = read('web/src/engine-sound.ts'), main = read('web/src/main.ts');
  const ctor = sound.slice(sound.indexOf('constructor('), sound.indexOf('private start('));
  ok(!/new Ctx|new AudioContext|webkitAudioContext/.test(ctor), 'the constructor makes no audio context');
  ok(/private start\(\)[\s\S]*?new Ctx\(\)/.test(sound), 'the context is made in the gesture handler');
  ok(/visibilitychange[^\n]*document\.hidden[^\n]*hush\(true\)/.test(sound), 'a hidden page suspends at once');
  ok(/suspend\(\)/.test(sound) && /QUIET_AFTER/.test(sound), 'not driving suspends after a short fade');
  ok(/function drawEnding[\s\S]*?engineSound\?\.update\(dt, null\)/.test(main), 'an ending silences the engine');
  ok(/if \(pauseFrame\.paused\) \{[^}]*engineSound\?\.update\(1 \/ 60, null\)/.test(main), 'the pause screen silences the engine');
  ok(/engineSound\.update\(realDt, playing && mode === 'drive' && !interiors\.busy && !document\.hidden \? m : null\)/.test(main), 'driving gates the engine');
  ok(/m\.towing = !!towing\?\.attached && ride\.kind === 'truck'/.test(main), 'only the truck pulls the fleet trailer');
  ok(/if \(\(this\.live \|\| !this\.unlocked\) && !document\.hidden && this\.ctx\.state !== 'running'/.test(sound), 'a later tap wakes the engine only while driving, or to unlock it');
  ok(/statechange[^\n]*running[^\n]*this\.unlocked = true/.test(sound), 'unlocked only once the context really ran');
  ok(/if \(now\) g\.master\.gain\.setValueAtTime\(0/.test(sound), 'suspending zeroes the gain first');
  ok(/!bare && !horse && params\.get\('engine'\) !== '0'/.test(main), 'pictures, the horse and ?engine=0 have no engine');
  ok(/m\.throttle = engineThrottle/.test(main) && /engineThrottle = input\.throttle/.test(main), 'the pedal the vehicle got drives the engine');
  ok(/m\.radio = !!radio\?\.audible/.test(main) && /this\.playing = live/.test(read('web/src/radio.ts')) && /this\.playing && this\.level\(\) > 0/.test(read('web/src/radio.ts')), 'the radio ducks it while music plays, turned up');
  ok(/if \(!this\.low\)/.test(sound), 'LOW detail builds the smaller graph');
}

console.log(`PASS engine-sound: ${checks} checks`);
