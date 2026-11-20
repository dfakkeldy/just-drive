// CPU-only check of the driving sounds' arithmetic (web/src/engine-sound-rules.ts): gears, engine speed, pitch, load and
// the tyre noise on each surface, the truck's low V8 voice, plus the wiring that keeps the audio behind the first tap and
// off on a hidden page. The browser half is tools/engine-sound-browser.mjs; tools/engine-sound-mutations.mjs breaks each
// truck rule on purpose and proves this check fails. To hear the sounds, tools/engine-sound-listen.mjs renders WAV files.
// node tools/run-node-check.mjs tools/engine-sound-check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENGINES, engineKind, engineState, engineWave, gearFor, tyreState, voicePulses, RADIO_DUCK, OUTPUT_TRIM, RASP, UPPER } from '../web/src/engine-sound-rules.ts';
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
    ok(Math.abs(e.voice * voicePulses(p) - e.frequency) < 1e-9, `${kind} voice runs at the firing rate over its pulses`);
    ok(e.gear >= lastGear && e.gear - lastGear <= 1, `${kind} changes up one gear at a time under full throttle`);
    if (e.gear > lastGear) { shifts++; ok(e.rpm < lastRpm, `${kind} rpm drops at the change into ${e.gear}`); }
    else ok(e.rpm >= lastRpm - 1e-9, `${kind} rpm never falls while accelerating in one gear`);
    ok(e.cutoff >= 160 && e.cutoff <= (p.ceiling ?? 6000) && e.gain > 0 && e.gain <= 1, `${kind} voice settings in range`);
    gear = lastGear = e.gear; lastRpm = e.rpm;
  }
  if (p.gears) ok(shifts === p.gears.length - 1, `${kind} uses all ${p.gears.length} gears (${shifts + 1})`);
  else ok(shifts === 0, `${kind} belt drive never shifts`);
  // A custom wave needs its pulse train (engine-sound.ts builds the periodic wave from it), and a train needs that wave.
  ok((p.wave === 'custom') === !!p.train, `${kind} has a pulse train exactly when its wave is custom`);

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
  // full scale at slider 1. Voice amplitude 1 (the browser normalises a periodic wave to a peak of 1 too), plus the upper
  // voice at the profile's own gain; filter resonance is not counted.
  const loud = engineState(p, { speed: top * .9, throttle: 1, airborne: false, grade: .2, towing: true }, p.gears?.length ?? 1);
  const tyreMax = Math.max(...['pavement', 'gravel', 'dirt track', 'washboard', 'grass'].map(s => tyreState(s, 30, false, p.tyres).gain));
  const peak = (loud.gain * (1 + (p.upper ?? UPPER)) + tyreMax + p.level * .12 * loud.load ** 2) * OUTPUT_TRIM;
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

  // In the air the engine flares with the pedal and the tyres go silent. A profile with its own flare (the truck) stays
  // lower: its own pins below hold it under its change-up point.
  const air = engineState(p, { ...flat, airborne: true, speed: 10, throttle: 1 }, 2);
  ok(air.rpm > (p.flare === undefined ? .9 * p.redline : engineState(p, { ...flat, speed: 0, throttle: 1 }, 1).rpm), `${kind} flares in the air (${air.rpm.toFixed(0)} rpm)`);
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

// A full-pedal run from rest to `to` m/s, carrying the gear as the game does: each moment, and each change up.
function run(p, to, step = .02) {
  let gear = 1, last = null;
  const moments = [], changes = [];
  for (let v = 0; v <= to + 1e-9; v += step) {
    const e = engineState(p, { ...flat, speed: v, throttle: 1 }, gear);
    if (last && e.gear > last.gear) changes.push({ speed: v, from: last.rpm, to: e.rpm });
    moments.push({ v, ...e }); gear = e.gear; last = e;
  }
  return { moments, changes, last };
}
const list = (xs, d = 0) => xs.map(x => x.toFixed(d)).join(', ');

// The truck (the owner, 20 Nov 2026: "the sound is terrible. Too high-pitched"): a big V8 that stays low and lumpy. Its
// top speed is 45.5 m/s on pavement (the speed work of the same day, #63, truck.ts physics).
{
  const p = ENGINES.truck, TOP = 45.5;
  const { moments, changes, last } = run(p, TOP);
  ok(changes.length === p.gears.length - 1 && last.gear === p.gears.length, `the truck reaches its top gear before its top speed (${changes.length + 1} gears)`);
  ok(changes.every(c => c.from <= 3600), `the truck changes up by 3600 rpm at full pedal (${list(changes.map(c => c.from))})`);
  ok(changes.every(c => c.to >= 1800), `the truck lands at 1800 rpm or more after a change (${list(changes.map(c => c.to))})`);
  ok(changes.slice(1).every((c, i) => c.speed - changes[i].speed >= 6), `the truck's changes come at least 6 m/s apart (${list(changes.map(c => c.speed), 1)} m/s)`);
  ok(last.rpm <= .75 * p.redline, `the truck is well off its limiter at its top speed (${last.rpm.toFixed(0)} rpm at ${TOP} m/s)`);
  const most = key => Math.max(...moments.map(m => m[key]));
  ok(most('frequency') <= 240, `the truck fires at 240 Hz or less at full pedal (${most('frequency').toFixed(0)} Hz)`);
  ok(most('cutoff') <= 800, `the truck's exhaust stays dark: cutoff 800 Hz or less (${most('cutoff').toFixed(0)} Hz)`);
  ok(moments.every(m => m.rasp <= 3 * m.frequency), 'the truck\'s intake roar sits within 3x the firing note');
  const air = engineState(p, { ...flat, airborne: true, speed: 15, throttle: 1 }, 3);
  ok(air.rpm <= Math.max(...changes.map(c => c.from)) && air.rpm > Math.max(...changes.map(c => c.to)),
    `in the air the truck flares above its landing band but not past its change-up point (${air.rpm.toFixed(0)} rpm)`);
  const part = engineState(p, { ...flat, speed: 12, throttle: .3 }, 2);
  ok(part.cutoff <= 3 * part.frequency, `the truck at part pedal keeps its cutoff within 3x the firing note (${part.cutoff.toFixed(0)} Hz at ${part.frequency.toFixed(0)} Hz)`);
  const carRun = run(ENGINES.car, 26).moments, at = (ms, v) => ms.find(m => m.v >= v - 1e-9);
  for (const v of [8, 15, 25]) ok(at(moments, v).cutoff < at(carRun, v).cutoff, `the truck is darker than the car at ${v} m/s (${at(moments, v).cutoff.toFixed(0)} vs ${at(carRun, v).cutoff.toFixed(0)} Hz)`);
  ok(p.upper === 0, 'the truck has no octave-up voice');

  // The voice: one engine cycle of eight uneven pulses. The firing note (harmonic 8) leads; orders 1.5 and 2.5 (harmonics
  // 3 and 5) sit within 14 dB of it, which is the lope; the wave falls away above the firing note, so it stays dark.
  ok(p.wave === 'custom' && p.train.lump.length === 2 * p.pulses && p.train.skew.length === p.train.lump.length && voicePulses(p) === 8, 'the truck\'s wave holds one whole four-stroke cycle');
  const w = engineWave(p), mag = (wave, h) => Math.hypot(wave.real[h], wave.imag[h]), h8 = mag(w, 8), dB = h => 20 * Math.log10(mag(w, h) / h8);
  ok([...Array(15).keys()].map(i => i + 1).every(h => h === 8 || mag(w, h) < h8), 'the firing note is the strongest of harmonics 1 to 15');
  ok(dB(3) > -14 && dB(5) > -14, `orders 1.5 and 2.5 carry the lope (${dB(3).toFixed(1)} and ${dB(5).toFixed(1)} dB)`);
  ok(dB(24) < -6, `the wave falls away above the firing note (third firing harmonic ${dB(24).toFixed(1)} dB)`);
  const even = engineWave({ ...p, train: { lump: p.train.lump.map(() => 1), skew: p.train.skew.map(() => 0), decay: p.train.decay } });
  ok([1, 2, 3, 4, 5, 6, 7].every(h => mag(even, h) < 1e-6 * mag(even, 8)), 'control: even pulses leave nothing under the firing note');
}

// The dirt bike's top speed is 41.7 m/s on pavement (the speed work, 20 Nov 2026, #63; 44 m/s at most downhill). Its five gears keep their old spacing,
// scaled so top gear reaches the redline at 41.7 / .92 m/s: at its top speed it turns at 92% of the redline, not on the limiter.
{
  const p = ENGINES.bike, TOP = 41.7, old = [7, 12, 17, 23, 30];
  ok(Math.abs(p.gears.at(-1) - TOP / .92) < .3, `the bike's top gear reaches the redline at ${p.gears.at(-1)} m/s`);
  ok(p.gears.every((g, i) => Math.abs(g / p.gears.at(-1) - old[i] / old.at(-1)) < .01), 'the bike\'s gears keep their spacing');
  const { last } = run(p, TOP);
  ok(last.gear === p.gears.length && last.rpm <= .95 * p.redline, `the bike is off its limiter at its top speed (${last.rpm.toFixed(0)} rpm)`);
}

// The car, the side by side and the bike (but for its gears) keep their voices: every number over a grid of moments is
// the same as before the truck's new sound (main, 20 Nov 2026). If one of them changes on purpose, update its fingerprint.
{
  function fingerprint(p) {
    let h = 0x811c9dc5;
    const eat = s => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } };
    for (const throttle of [-1, 0, .3, 1]) for (const airborne of [false, true]) for (const grade of [0, .1]) for (const towing of [false, true]) {
      let gear = 1;
      for (let v = -4; v <= 50; v += .25) {
        const e = engineState(p, { speed: v, throttle, airborne, grade, towing }, gear);
        gear = e.gear;
        eat([e.gear, e.rpm, e.load, e.frequency, e.gain, e.cutoff].join(','));
      }
    }
    return h.toString(16);
  }
  ok(fingerprint(ENGINES.car) === 'fbca8bc9', `the car's numbers are unchanged (${fingerprint(ENGINES.car)})`);
  ok(fingerprint(ENGINES.sxs) === '705ffe8f', `the side by side's numbers are unchanged (${fingerprint(ENGINES.sxs)})`);
  ok(fingerprint({ ...ENGINES.bike, gears: [7, 12, 17, 23, 30] }) === '1e95b72a', 'the bike\'s numbers are unchanged but for its gears');
  for (const kind of ['car', 'sxs', 'bike']) {
    const p = ENGINES[kind], e = engineState(p, { ...flat, speed: 12, throttle: 1 }, 2);
    ok(p.wave !== 'custom' && !p.train && (p.upper ?? UPPER) === .35 && e.voice === e.frequency && e.rasp === Math.min(5000, e.frequency * 6) && RASP === 6,
      `${kind} keeps its plain wave, its octave-up voice and its rasp`);
  }
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
  // The truck's voice: a periodic wave (the type 'custom' cannot be set; the browser throws), played once per engine cycle.
  ok(/if \(p\.wave === 'custom'\) \{[\s\S]{0,240}?g\.voice\.setPeriodicWave\(wave\);\s*\} else g\.voice\.type = p\.wave;/.test(sound), 'a pulse train is set as a periodic wave');
  ok(!/voice\.type = 'custom'/.test(sound), 'the voice type is never set to custom');
  ok(/glide\(g\.voice\.frequency, e\.voice\)/.test(sound), 'the voice plays the cycle rate (e.voice), not the firing rate');
  ok(/g\.upperGain\?\.gain\.setValueAtTime\(p\.upper \?\? UPPER, t\)/.test(sound), 'each motor sets its own octave-up gain');
  ok(/g\.raspFilter\.frequency\.setTargetAtTime\(e\.rasp, t, GLIDE\)/.test(sound), 'the rasp follows the profile\'s centre');
  ok(/frequency: this\.graph \? \+\(this\.graph\.voice\.frequency\.value \* \(this\.kind \? voicePulses\(ENGINES\[this\.kind\]\) : 1\)\)/.test(sound), 'the snapshot reports the firing rate');
  ok((sound.match(/createOscillator\(/g) ?? []).length === 3, 'no extra oscillators: voice, upper, and the tyre pulse');
}

console.log(`PASS engine-sound: ${checks} checks`);
