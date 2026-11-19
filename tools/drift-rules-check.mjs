// The drift state: the pure rules (web/src/drift-rules.ts), the real 120 Hz Vehicle entering, holding and leaving a slide on
// flat stand-in ground, each ride's tuning, ordinary driving left exactly as it was, the score stream and Get Fired points,
// the tyre sound and the rear-wheel dust. Bundled and run by tools/drift-rules-mutations.mjs (cwd web/), never on its own.
import assert from 'node:assert/strict';
import { Object3D, PerspectiveCamera } from '../web/node_modules/three/build/three.module.js';
import { Drift, LOOSE, looseSurface, holdAngle, slideAngle, HANDBRAKE_STEER, LIFT_STEER, LIFT_WINDOW, LIFT_SECONDS, TOWED_SPEED, HOLD_STEER, FIRM_HOLD,
  SWING_SECONDS, LIFT_POWER, CATCH, EXIT_ANGLE, END_SPEED, COUNT_SECONDS, COUNT_ANGLE, COUNT_LENGTH, CHORD_SECONDS, phoneHandbrake } from '../web/src/drift-rules.ts';
import { readFileSync } from 'node:fs';
import { Vehicle } from '../web/src/vehicle.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import { SXS_SPEC } from '../web/src/sxs.ts';
import { TRUCK_SPEC } from '../web/src/truck.ts';
import { BIKE_SPEC } from '../web/src/bike.ts';
import { HORSE_SPEC } from '../web/src/horse.ts';
import { POINTS, ScoreBook, eventSize, offenceLabel, DRIFT_MARKS } from '../web/src/score-rules.ts';
import { tyreState, SQUEAL } from '../web/src/engine-sound-rules.ts';
import { DriftFeedback, DUST } from '../web/src/drift-feedback.ts';
import { DRIVING_KEYS, TOUCH } from '../web/src/controls.ts';
import { Shift } from '../web/src/shift.ts';
import { Roads } from '../web/src/roads.ts';
import { CLOCK_FACTOR } from '../web/src/shift-rules.ts';

let passed = 0;
// Each row starts with the lift-off entry locked (a player who has not drifted yet); rows that need it unlock it.
const ok = (name, fn) => { Drift.learned = false; fn(); passed++; };
const DEG = 180 / Math.PI, STEP = 1 / 120;
const node = () => new Object3D();
const rig = () => ({ root: node(), body: node(), steer: { fl: node(), fr: node() }, wheels: { fl: node(), fr: node(), rl: node(), rr: node() }, brakeLights: [], driverEye: node() });
// Road kinds: 3 a gravel road, 2 a paved one, 4 a dirt track; 0 with a far road is grass.
const KIND = { gravel: 3, pavement: 2, track: 4, grass: 0 };
function world(name) {
  const kind = KIND[name], surface = { ground: 0, canopy: 0, kind, washboard: false, roadDist: kind ? 0 : 900, halfWidth: kind ? 400 : 3, level: 8, mineral: false };
  return { terrain: { heightAt: () => 0, withContactHeight: (_, r) => r(), surfaceAt: () => surface }, roads: { roads: [], nearest: () => null, deckHeight: () => null } };
}
/** A ride on flat ground, heading north at `speed`. `tow` hitches a trailer load as towing.ts does. */
function ride(spec, ground = 'gravel', speed = 15, { tow = false, roads } = {}) {
  const w = world(ground), v = new Vehicle(rig(), w.terrain, roads ?? w.roads, -100, spec);
  v.assist = 0; v.place(0, 0, 0);
  if (tow) v.towLoad = { mass: 900, brakeShare: .5, dragShare: .3, driveMassShare: .8 };
  v.vz = -speed; v.speed = speed;
  return v;
}
const go = (throttle, steer, handbrake = false, touch = false) => ({ throttle, steer, handbrake, ...(touch ? { touch: true } : {}) });
/** Drive `seconds` with input(t) (t from the run start); returns a sample per step. */
function drive(v, seconds, input, t0 = 0) {
  const out = [];
  for (let i = 0; i < Math.round(seconds * 120); i++) {
    const t = t0 + i * STEP, before = v.heading;
    v.update(STEP, input(t, v));
    out.push({ t, active: v.drift.active, shown: v.drift.shown, angle: v.drift.angle, speed: Math.hypot(v.vx, v.vz), heading: v.heading, turn: v.heading - before,
      slip: slideAngle(v.vx * Math.sin(v.heading) - v.vz * Math.cos(v.heading), v.vx * Math.cos(v.heading) + v.vz * Math.sin(v.heading)),
      help: v.helpYaw, light: v.lightHelpYaw, x: v.x, z: v.z });
  }
  return out;
}
/** The classic entry: handbrake and the wheel right for 0.4 s; then power and counter-steer. */
const handbrakeIn = (counter = HOLD_STEER, until = 3.5) => t => t < .4 ? go(0, 1, true) : t < until ? go(1, -counter) : go(1, 0);
const spread = (xs) => Math.max(...xs) - Math.min(...xs);

// ---- The pure rules ----
ok('loose ground is gravel, dirt track, washboard and grass; everything else is firm', () => {
  assert.deepEqual([...LOOSE].sort(), ['dirt track', 'grass', 'gravel', 'washboard']);
  for (const s of ['pavement', 'concrete', 'rail trail', 'brush', '']) assert.equal(looseSurface(s), false, s);
});

ok('entering: the handbrake with the wheel turned at speed; pavement needs more speed; a trailer more still', () => {
  const s = CAR_SPEC.drift, g = (speed, surface = 'gravel', towed = false) => ({ speed, surface, mu: .7, towed, turn: 0 });
  const d = new Drift();
  assert.equal(d.begins(s, go(0, 1, true), g(s.looseSpeed)), 1);
  assert.equal(d.begins(s, go(0, -.5, true), g(s.looseSpeed)), -1);
  assert.equal(d.begins(s, go(0, 1, true), g(s.looseSpeed - .1)), 0, 'too slow');
  assert.equal(d.begins(s, go(0, HANDBRAKE_STEER - .01, true), g(20)), 0, 'wheel too straight');
  assert.equal(d.begins(s, go(0, .2, true), g(20)), 0, 'the handbrake to stop, the wheel nearly straight: a stop, not a slide');
  assert.equal(d.begins(s, go(1, 1, false), g(20)), 0, 'no handbrake, no lift: no slide');
  assert.ok(s.firmSpeed > s.looseSpeed + 3);
  assert.equal(d.begins(s, go(0, 1, true), g(s.firmSpeed - .1, 'pavement')), 0);
  assert.equal(d.begins(s, go(0, 1, true), g(s.firmSpeed, 'pavement')), 1);
  assert.equal(d.begins(s, go(0, 1, true), g(s.looseSpeed * TOWED_SPEED - .1, 'gravel', true)), 0, 'a trailer resists');
  assert.equal(d.begins(s, go(0, 1, true), g(s.looseSpeed * TOWED_SPEED, 'gravel', true)), 1);
});

ok('entering: on loose ground a flick off the throttle arms it; power on, then the catch, begins it on the flick side', () => {
  const s = CAR_SPEC.drift, g = (speed, surface = 'gravel') => ({ speed, surface, mu: .7, towed: false, turn: 0 });
  Drift.learned = true;
  // Lift; the wheel hard to `first`, then (after `gap`) hard to `second` (the flick); `power` seconds of throttle still
  // steering `second`; then the catch. Returns [anything begun before the catch, what the catch begins].
  const flick = ({ surface = 'gravel', first = 1, second = -first, hold = .2, gap = 0, throttle = 0, speed = s.liftSpeed, lift = .1, power = .25, caught = .5 } = {}) => {
    const d = new Drift(), ground = g(speed, surface), seen = [];
    const at = c => { d.watch(c, STEP); seen.push(d.begins(s, c, ground)); };
    d.watch(go(1, 0), STEP); d.watch(go(throttle, 0), lift);
    for (let t = 0; t < hold; t += STEP) at(go(throttle, first));
    if (gap) d.watch(go(throttle, 0), gap);
    at(go(throttle, second));
    for (let t = 0; t < power - 1e-9; t += STEP) at(go(1, second));
    at(go(1, -Math.sign(second) * caught));
    return [seen.slice(0, -1).some(x => x !== 0), seen.at(-1)];
  };
  assert.deepEqual(flick(), [false, -1], 'the flick and the power begin nothing; the catch begins it on the flick side');
  Drift.learned = false; assert.deepEqual(flick(), [false, 0], 'locked until the first handbrake drift'); Drift.learned = true;
  assert.deepEqual(flick({ first: -1 }), [false, 1]);
  assert.deepEqual(flick({ second: 1 }), [false, 0], 'the same way twice is no flick');
  assert.deepEqual(flick({ second: -LIFT_STEER + .01 }), [false, 0], 'the second turn not hard');
  assert.deepEqual(flick({ first: .8, second: -.8 }), [false, 0], 'part lock both ways is steering, not a flick');
  assert.deepEqual(flick({ gap: LIFT_WINDOW + .05 }), [false, 0], 'too long between the turns');
  assert.deepEqual(flick({ gap: LIFT_WINDOW - .05 }), [false, -1]);
  assert.deepEqual(flick({ lift: LIFT_SECONDS }), [false, 0], 'the lift was too long ago');
  assert.deepEqual(flick({ throttle: 1 }), [false, 0], 'on the throttle: an ordinary S-bend');
  assert.deepEqual(flick({ throttle: -1 }), [false, 0], 'braking through it is not a lift');
  assert.deepEqual(flick({ surface: 'pavement' }), [false, 0], 'pavement needs the handbrake');
  assert.deepEqual(flick({ speed: s.liftSpeed - .1 }), [false, 0], 'too slow');
  assert.deepEqual(flick({ power: 0 }), [false, 0], 'the catch before the power: a wobble');
  assert.deepEqual(flick({ power: .15 }), [false, 0], 'not enough power first');
  assert.deepEqual(flick({ power: LIFT_WINDOW + .05 }), [false, 0], 'the catch too late');
  assert.deepEqual(flick({ caught: .1 }), [false, 0], 'a touch of counter-steer is no catch');
  assert.ok(LIFT_POWER >= .15 && CATCH >= .1);
  // Once the catch came first it stays spoiled: more power and another catch begin nothing.
  const d = new Drift(), ground = g(s.liftSpeed);
  d.watch(go(1, 0), STEP); d.watch(go(0, 0), .1); d.watch(go(0, 1), STEP); d.begins(s, go(0, 1), ground);
  d.watch(go(0, -1), STEP); assert.equal(d.begins(s, go(0, -1), ground), 0);
  d.watch(go(1, 1), STEP); assert.equal(d.begins(s, go(1, 1), ground), 0);
  for (let t = 0; t < .3; t += STEP) { d.watch(go(1, -1), STEP); assert.equal(d.begins(s, go(1, -1), ground), 0); }
  d.watch(go(1, 1), STEP); assert.equal(d.begins(s, go(1, 1), ground), 0, 'spoiled');
  const never = new Drift(); never.watch(go(0, 1), 1); never.watch(go(0, -1), STEP);
  assert.equal(never.begins(s, go(0, -1), g(30)), 0, 'no throttle before: nothing was lifted');
});

ok('holding: power and counter-steer hold an angle; wheel straight, steering into the slide or no power hold none', () => {
  const s = CAR_SPEC.drift;
  assert.ok(Math.abs(holdAngle(s, go(1, -HOLD_STEER), 1, 'gravel', false) - s.angle) < 1e-9);
  assert.equal(holdAngle(s, go(1, 0), 1, 'gravel', false), 0, 'wheel straight');
  assert.equal(holdAngle(s, go(1, .5), 1, 'gravel', false), 0, 'steering into the slide');
  assert.equal(holdAngle(s, go(0, -HOLD_STEER), 1, 'gravel', false), 0, 'lifted');
  assert.equal(holdAngle(s, go(-1, -HOLD_STEER), 1, 'gravel', false), 0, 'braking');
  assert.ok(holdAngle(s, go(1, -.6), 1, 'gravel', false) > s.angle, 'more counter-steer, wider');
  assert.ok(holdAngle(s, go(1, -.2), 1, 'gravel', false) < s.angle, 'less counter-steer, narrower');
  assert.ok(holdAngle(s, go(.4, -HOLD_STEER), 1, 'gravel', false) < s.angle, 'less throttle, narrower');
  assert.equal(holdAngle(s, go(1, -1), 1, 'gravel', false), s.maxAngle, 'never past the widest');
  assert.ok(Math.abs(holdAngle(s, go(1, HOLD_STEER), -1, 'gravel', false) - s.angle) < 1e-9, 'a left-hand slide counter-steers right');
  assert.ok(Math.abs(holdAngle(s, go(1, -HOLD_STEER), 1, 'pavement', false) - s.angle * FIRM_HOLD) < 1e-9);
  assert.ok(Math.abs(holdAngle(s, go(1, -HOLD_STEER), 1, 'gravel', true) - s.angle * s.towed) < 1e-9);
});

ok('leaving: straightened, slowed, airborne, a hit, a reset; only a real drift is reported, a hit is not clean', () => {
  const s = CAR_SPEC.drift, g = { speed: 15, surface: 'gravel', mu: .72, towed: false, turn: 0 };
  const slide = (seconds, input = go(1, -HOLD_STEER)) => { const d = new Drift(); d.begin(1, 'handbrake', 0, 0, 0); let a = 0; for (let t = 0; t < seconds; t += STEP) a = d.step(s, input, g, a, STEP).angle; return d; };
  let d = slide(2); assert.equal(d.check(s, 15, 30, 0), ''); assert.ok(Math.abs(d.angle - s.angle) < .01);
  d.hit(30, 0); assert.equal(d.active, false); assert.equal(d.ended, 'hit');
  let f = d.take(); assert.equal(f.clean, false); assert.equal(d.take(), null, 'once');
  d = slide(2); assert.equal(d.check(s, END_SPEED, 30, 0), 'slowed'); f = d.take();
  assert.equal(f.clean, true); assert.equal(f.surface, 'gravel'); assert.ok(f.length > 25 && f.seconds > 1.9 && f.angle > 15 && f.peak >= f.angle, JSON.stringify(f));
  assert.deepEqual([f.x0, f.z0, f.x1, f.z1], [0, 0, 30, 0]);
  d = slide(2); d.airborne(1, 1); assert.equal(d.ended, 'airborne'); f = d.take();
  assert.ok(f); assert.equal(f.clean, false, 'an end in the air is not clean: the landing may be a crash');
  d = slide(2); d.finish('lost', 1, 1); assert.equal(d.take().clean, false, 'a lost slide is not clean');
  d = slide(2); d.finish('straightened', 1, 1); assert.equal(d.take().clean, true);
  // Steering into the slide, the path turns at least as the wheel asks of grip: a slide never runs wide of the line.
  d = new Drift(); d.begin(1, 'handbrake', 0, 0, 0); assert.ok(d.step(s, go(1, 1), { ...g, turn: 3 }, 0, STEP).pathRate >= 3);
  d = new Drift(); d.begin(-1, 'handbrake', 0, 0, 0); assert.ok(d.step(s, go(1, -1), { ...g, turn: -3 }, 0, STEP).pathRate <= -3);
  d = slide(2); d.reset(); assert.equal(d.active, false); assert.equal(d.take(), null, 'a placement drops the slide');
  // Straightened: the wheel straight lets the angle fall; below EXIT_ANGLE it has ended.
  d = slide(2); let a = d.angle, end = '';
  for (let i = 0; i < 240 && !end; i++) { a = d.step(s, go(1, 0), g, a, STEP).angle; end = d.check(s, 15, 0, 0); }
  assert.equal(end, 'straightened'); assert.ok(Math.abs(a) < EXIT_ANGLE);
  // The swing holds a fresh slide open whatever the wheel says; then counter-steer must take over.
  d = new Drift(); d.begin(1, 'handbrake', 0, 0, 0); a = 0;
  for (let t = 0; t < SWING_SECONDS - STEP; t += STEP) { a = d.step(s, go(1, 1), g, a, STEP).angle; assert.equal(d.check(s, 15, 0, 0), ''); }
  assert.ok(a > s.angle * .6, 'the tail swung out');
  // A flick has no swing of its own: power and counter-steer open it, and without them it is over at once.
  d = new Drift(); d.begin(1, 'lift', 0, 0, 0); a = d.step(s, go(0, 1), g, 0, STEP).angle;
  assert.equal(a, 0); assert.equal(d.check(s, 15, 0, 0), 'straightened');
  d = new Drift(); d.begin(1, 'lift', 0, 0, 0, -1); a = 0;
  for (let t = 0; t < 2; t += STEP) a = d.step(s, go(1, -HOLD_STEER), g, a, STEP).angle;
  assert.ok(Math.abs(a - s.angle) < .02, `the catch opens it to the held angle: ${a * DEG}`);
  // Too short, too narrow or too short a distance: not a drift.
  d = slide(COUNT_SECONDS - .1); d.finish('straightened', 0, 0); assert.equal(d.take(), null, 'too short');
  d = new Drift(); d.begin(1, 'lift', 0, 0, 0); a = 0;
  for (let t = 0; t < 2; t += STEP) a = d.step(s, go(0, 1), g, a, STEP).angle;
  d.finish('straightened', 0, 0); assert.equal(d.take(), null, 'too narrow');
  d = new Drift(); d.begin(1, 'handbrake', 0, 0, 0); a = 0;
  for (let t = 0; t < 1; t += STEP) a = d.step(s, go(1, -HOLD_STEER), { ...g, speed: COUNT_LENGTH / 1.2 }, a, STEP).angle;
  d.finish('straightened', 0, 0); assert.equal(d.take(), null, 'too short a distance');
  assert.ok(COUNT_ANGLE > 0 && COUNT_LENGTH > 0);
});

// ---- The real Vehicle ----
ok('the real car enters, holds and leaves a drift on a gravel road', () => {
  const v = ride(CAR_SPEC), s = CAR_SPEC.drift, run = drive(v, 6, handbrakeIn());
  const entered = run.findIndex(r => r.active);
  assert.ok(run.filter(r => r.shown).length > run.filter(r => r.active).length * .85, 'a real drift shows');
  assert.equal(entered, 0, 'handbrake + wheel at 54 km/h on gravel starts it at once');
  assert.ok(run[60].angle > s.angle * .75, `swung out ${run[60].angle * DEG}`);
  const held = run.filter(r => r.t > 1.5 && r.t < 3.4);
  assert.ok(held.every(r => r.active));
  assert.ok(spread(held.map(r => r.angle)) < 2 / DEG, `steady angle: ${spread(held.map(r => r.angle)) * DEG}`);
  assert.ok(Math.abs(held.at(-1).angle - s.angle) < 1.5 / DEG, `holds the spec angle ${held.at(-1).angle * DEG}`);
  assert.ok(held.every(r => Math.abs(r.slip - r.angle) < 1e-6), 'the body really moves at that angle to its heading');
  assert.ok(held.at(-1).heading - held[0].heading > .6, 'the path keeps turning');
  const out = run.findIndex(r => r.t > 3.5 && !r.active);
  assert.ok(out > 0 && run[out].t < 4.7, `straightened out by ${run[out]?.t}`);
  assert.equal(v.drift.ended, 'straightened');
  assert.ok(run.slice(out + 60).every(r => Math.abs(r.slip) < .01), 'the tyres take the last of the slip away');
  assert.ok(run.every(r => Math.abs(r.turn) < 2.5 / DEG), 'no jump in heading on any step');
  const f = v.takeDrift();
  assert.ok(f && f.clean && f.surface === 'gravel' && f.angle > 18 && f.length > 40, JSON.stringify(f));
});

ok('in a slide the front wheels turn as on grip: its lock and its turn-in rate, not at once', () => {
  const v = ride(CAR_SPEC); drive(v, 1.5, handbrakeIn()); assert.equal(v.drift.active, true);
  const s = CAR_SPEC, most = (s.steerBaseRate + s.steerSpeedRate) * STEP + 1e-9;
  for (let i = 0; i < 30; i++) { const before = v.steerAngle; v.update(STEP, go(1, i % 10 < 5 ? 1 : -1)); assert.ok(Math.abs(v.steerAngle - before) <= Math.max(most, s.steerReturnRate * STEP + 1e-9), `step ${i}`); }
  assert.ok(Math.abs(v.steerAngle) <= s.maxSteer);
});

ok('the driver widens and tightens the slide: more counter-steer or throttle wider, less narrower', () => {
  const at = (input) => { const v = ride(CAR_SPEC); drive(v, 2.5, t => t < .4 ? go(0, 1, true) : input); return v.drift.angle; };
  const base = at(go(1, -HOLD_STEER)), wide = at(go(1, -.6)), tight = at(go(1, -.25)), less = at(go(.5, -HOLD_STEER));
  assert.ok(wide > base + 4 / DEG && tight < base - 4 / DEG && less < base - 4 / DEG, [base, wide, tight, less].map(a => (a * DEG).toFixed(1)).join(' '));
});

ok('a keyboard holds it too: the counter-steer key tapped on and off keeps a steady middle angle', () => {
  const v = ride(CAR_SPEC), s = CAR_SPEC.drift;
  const run = drive(v, 5, t => t < .4 ? go(0, 1, true) : go(1, (t * 4) % 1 < .25 ? -1 : 0));
  const held = run.filter(r => r.t > 1.5), lo = Math.min(...held.map(r => r.angle)), hi = Math.max(...held.map(r => r.angle));
  assert.ok(held.every(r => r.active), 'never drops out');
  assert.ok(lo > s.angle * .9 && hi < s.maxAngle * .99 && hi - lo < 6 / DEG, `${lo * DEG} ${hi * DEG}`);
  // Held down, the key opens the widest slide; let go, the slide ends.
  drive(v, 1.5, () => go(1, -1)); assert.ok(v.drift.angle > s.maxAngle * .95);
  drive(v, 2, () => go(1, 0)); assert.equal(v.drift.active, false); assert.equal(v.drift.ended, 'straightened');
});

ok('a slide costs speed: the same throttle gains less sideways than straight', () => {
  const straight = ride(CAR_SPEC), sliding = ride(CAR_SPEC);
  drive(straight, 3, t => t < .4 ? go(0, 0, true) : go(1, 0)); drive(sliding, 3, handbrakeIn(HOLD_STEER, 9));
  assert.equal(sliding.drift.active, true);
  assert.ok(Math.hypot(sliding.vx, sliding.vz) < Math.hypot(straight.vx, straight.vz) - 2, `${Math.hypot(sliding.vx, sliding.vz)} ${Math.hypot(straight.vx, straight.vz)}`);
});

ok('it ends when the driver slows: the brake and a lift both end it', () => {
  for (const input of [go(-1, -HOLD_STEER), go(0, -HOLD_STEER)]) {
    const v = ride(CAR_SPEC); drive(v, 3, t => t < .4 ? go(0, 1, true) : t < 1.2 ? go(1, -HOLD_STEER) : input);
    assert.equal(v.drift.active, false); assert.ok(['slowed', 'straightened'].includes(v.drift.ended), v.drift.ended);
  }
});

ok('pavement needs the handbrake and more speed; loose ground drifts easily', () => {
  const starts = (ground, speed, input) => { const v = ride(CAR_SPEC, ground, speed); return drive(v, .6, input).some(r => r.active); };
  const s = CAR_SPEC.drift, hb = () => go(0, 1, true);
  for (const ground of ['gravel', 'track', 'grass']) assert.equal(starts(ground, s.looseSpeed + .5, hb), true, ground);
  assert.equal(starts('pavement', s.looseSpeed + .5, hb), false);
  assert.equal(starts('pavement', s.firmSpeed + .5, hb), true);
  Drift.learned = true;
  const liftFlick = t => t < .15 ? go(1, 0) : t < .3 ? go(0, -1) : t < .35 ? go(0, 1) : t < .58 ? go(1, 1) : go(1, -.5);
  assert.equal(starts('gravel', s.liftSpeed + 1, liftFlick), true);
  assert.equal(starts('pavement', s.liftSpeed + 3, liftFlick), false);
});

ok('a new player who never drifts notices nothing: without the handbrake or a lift-and-flick, every step is exactly the old car', () => {
  const noDrift = { ...CAR_SPEC, drift: undefined };
  const scripts = {
    'full throttle, full lock': () => go(1, 1),
    'brake into the bend': t => t < .5 ? go(1, 0) : go(-1, 1),
    'steady arc': t => go(.7, Math.sin(t) * .8),
    'touch thumb': t => go(1, .6 * Math.sin(t * 2), false, true),
    'lift and coast straight': t => t < .5 ? go(1, 0) : go(0, 0),
    'lift and a gentle turn': t => t < .5 ? go(1, 0) : go(0, .5),
    'a keyboard corner: lift, turn in, power back on': t => t < .5 ? go(1, 0) : t < .8 ? go(0, 1) : go(1, 1),
    'lift, turn in hard, coast': t => t < .5 ? go(1, 0) : go(0, -1),
    'lift, turn in, straighten': t => t < .5 ? go(1, 0) : t < .8 ? go(0, 1) : go(1, 0),
    'an S-bend at part lock': t => t < .5 ? go(1, 0) : t < .8 ? go(0, .8) : go(1, -.8),
    'a handbrake stop, wheel nearly straight': t => t < .5 ? go(1, 0) : go(-1, HANDBRAKE_STEER - .05, true),
    'the handbrake held straight': t => t < .5 ? go(1, 0) : go(0, 0, true),
  };
  for (const ground of ['gravel', 'pavement', 'grass'])
    for (const speed of [8, 15, 22])
      for (const [name, script] of Object.entries(scripts)) {
        const a = ride(CAR_SPEC, ground, speed), b = ride(noDrift, ground, speed);
        const ra = drive(a, 3, script), rb = drive(b, 3, script);
        assert.ok(ra.every(r => !r.active), `${name} ${ground} ${speed}`);
        assert.deepEqual(ra.map(r => [r.x, r.z, r.heading, r.speed]), rb.map(r => [r.x, r.z, r.heading, r.speed]), `${name} ${ground} ${speed}: identical`);
      }
});

ok('a lift and a hard turn-in, with or without the power back, is exactly the old car, with the touch help too', () => {
  const road = { id: 1, name: 'Test Road', kind: 3, halfWidth: 400, bridge: false, pts: [[0, 600], [0, -600]] };
  const roads = { roads: [], deckHeight: () => null, nearest: (x, z) => ({ road, seg: 0, t: (600 - z) / 1200, dist: Math.abs(x), heading: 0, x: 0, z }) };
  for (const [ground, speed] of [['gravel', 18], ['gravel', 24], ['grass', 20], ['track', 22]])
    for (const touch of [false, true])
      for (const back of [0, 1]) {
        const script = t => t < .5 ? go(1, 0, false, touch) : t < .8 ? go(0, 1, false, touch) : go(back, 1, false, touch);
        const make = spec => { const v = ride(spec, ground, speed, { roads }); if (touch) { v.assist = .9; v.strongHelp = true; } return v; };
        const a = make(CAR_SPEC), b = make({ ...CAR_SPEC, drift: undefined }), ra = drive(a, 2, script), rb = drive(b, 2, script);
        assert.ok(ra.every(r => !r.active), `${ground} ${speed} ${touch} ${back}`);
        assert.deepEqual(ra.map(r => [r.x, r.z, r.heading]), rb.map(r => [r.x, r.z, r.heading]), `${ground} ${speed} touch ${touch} back ${back}: identical`);
        assert.equal(a.takeDrift(), null);
      }
});

ok('the lift-off drift: lift, flick, power back on, counter-steer', () => {
  const v = ride(CAR_SPEC, 'gravel', 18);
  Drift.learned = true;
  // Lift, a feint right, hard left (the flick), power on still steering left, then the catch to the right: a left-hand drift.
  const flick = (power = .25) => t => t < .5 ? go(1, 0) : t < .7 ? go(0, 1) : t < .75 ? go(0, -1) : t < .75 + power ? go(1, -1) : go(1, HOLD_STEER);
  const run = drive(v, 3, flick());
  assert.ok(run.findIndex(r => r.active) >= Math.round(.7 * 120), 'not before the flick');
  assert.ok(run.findIndex(r => r.active) >= Math.round(1 * 120) - 1, 'nothing until the catch');
  assert.equal(v.drift.active, true); assert.equal(v.drift.shown, true); assert.equal(v.drift.entry, 'lift'); assert.equal(Math.sign(v.drift.angle), -1, 'the tail out, the nose into the second turn');
  // The catch before the power (a wobble), or the power too late: the step never opens.
  for (const power of [0, .1, .5]) {
    const w = ride(CAR_SPEC, 'gravel', 18), r = drive(w, 3, flick(power));
    assert.ok(r.every(x => !x.active), `power ${power}: never begins`);
    assert.equal(w.takeDrift(), null);
  }
  // A stick: the same order at part throttle and part counter-steer opens it too.
  const st = ride(CAR_SPEC, 'gravel', 18);
  drive(st, 2.5, t => t < .5 ? go(1, 0) : t < .7 ? go(0, .9) : t < .75 ? go(0, -.9) : t < 1 ? go(.6, -.9) : go(.8, .35));
  assert.equal(st.drift.shown, true, 'a stick opens it');
  assert.ok(Math.abs(Math.abs(v.drift.angle) - CAR_SPEC.drift.angle) < 2 / DEG, `${v.drift.angle * DEG}`);
});

ok('a player who never drifts: no S-bend, lane change, correction or slalom, at any rhythm, begins a slide without the handbrake', () => {
  // 240 random runs: lifts, full-lock reversals at random lengths, the power back at random moments, on each ride.
  let seed = 7, unlocked = 0; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let n = 0; n < 240; n++) {
    const spec = [CAR_SPEC, SXS_SPEC, TRUCK_SPEC][n % 3], ground = ['gravel', 'grass', 'track'][Math.floor(n / 3) % 3], speed = 16 + rnd() * 10;
    const keys = []; let t = .3;
    // Each key: the wheel hard one way; the throttle off, on, coming on or going off part way (so power can run into the next key).
    for (let k = 0; k < 6; k++) { const len = .1 + rnd() * .4; keys.push([t, t + len, k % 2 ? -1 : 1, Math.floor(rnd() * 4), rnd() * len]); t += len; }
    const power = (mode, into) => mode === 1 || mode === 2 && into >= 0 || mode === 3 && into < 0 ? 1 : 0;
    const script = time => { if (time < .3) return go(1, 0); const k = keys.find(([a, b]) => time >= a && time < b); if (!k) return go(1, 0);
      return go(power(k[3], time - k[0] - k[4]), k[2], false, n % 4 === 0); };
    const a = ride(spec, ground, speed), b = ride({ ...spec, drift: undefined }, ground, speed);
    const ra = drive(a, t + .5, script), rb = drive(b, t + .5, script);
    assert.ok(ra.every(r => !r.active), `run ${n}: no slide`);
    assert.deepEqual(ra.map(r => [r.x, r.z, r.heading]), rb.map(r => [r.x, r.z, r.heading]), `run ${n}: identical`);
    // The same run once the player has drifted: some of these rhythms are a flick, power and a catch.
    Drift.learned = true; if (drive(ride(spec, ground, speed), t + .5, script).some(r => r.active)) unlocked++; Drift.learned = false;
  }
  assert.ok(unlocked > 0, 'the sweep holds flicks: it would see a lift-off entry that is not locked');
});

ok('the first counted handbrake drift opens the lift-off entry; a twitch does not', () => {
  const short = ride(CAR_SPEC); drive(short, .5, t => t < .2 ? go(0, 1, true) : go(1, 0)); short.takeDrift();
  assert.equal(Drift.learned, false, 'too short to count');
  const v = ride(CAR_SPEC); drive(v, 6, handbrakeIn()); assert.ok(v.takeDrift()); assert.equal(Drift.learned, true);
});

ok('an animal stop holds the car with the handbrake: never a slide, whatever the wheel', () => {
  const s = CAR_SPEC.drift, d = new Drift(), g = { speed: 20, surface: 'gravel', mu: .72, towed: false, turn: 0 };
  d.watch({ throttle: -1, steer: 1, handbrake: true, held: true }, STEP);
  assert.equal(d.begins(s, { throttle: -1, steer: 1, handbrake: true, held: true }, g), 0);
  const v = ride(CAR_SPEC, 'gravel', 18); drive(v, 2, () => ({ ...go(-1, .8, true), held: true })); assert.equal(v.takeDrift(), null);
  assert.ok(drive(ride(CAR_SPEC, 'gravel', 18), 2, () => ({ ...go(-1, .8, true), held: true })).every(r => !r.active));
  assert.match(readFileSync('src/main.ts', 'utf8'), /input\.handbrake = true; input\.held = true;/, 'main marks the animal stop');
  assert.match(readFileSync('src/fleet.ts', 'utf8'), /this\.stoppedInput\.held = input\.held;/, "the fleet pickup's own input keeps the mark");
  // Mid-slide, the hold ends it at once, not clean, and the held handbrake starts no other.
  const mid = ride(CAR_SPEC, 'gravel', 18), pull = handbrakeIn();
  const run = drive(mid, 4, t => t < 2 ? pull(t) : { ...go(-.5, -HOLD_STEER, true), held: true });
  assert.ok(run.some(r => r.t < 2 && r.active), 'a slide first');
  const after = run.filter(r => r.t >= 2);
  assert.ok(after.every(r => !r.active), 'the hold ends the slide that step');
  const f = mid.takeDrift(); assert.ok(f && f.clean === false, `reported, not clean: ${JSON.stringify(f)}`);
  assert.equal(mid.drift.ended, 'held');
});

ok('after the first drift too, an S-bend, a correction, a slalom off the throttle is exactly the old car (only power then a catch begins a flick)', () => {
  Drift.learned = true;
  const s = CAR_SPEC.drift, noDrift = { ...CAR_SPEC, drift: undefined };
  const scripts = {
    'S-bend, keys': t => t < .5 ? go(1, 0) : t < .8 ? go(0, 1) : go(t < 1.1 ? 0 : 1, -1),
    'S-bend, power back on the second turn': t => t < .5 ? go(1, 0) : t < .8 ? go(0, 1) : go(1, -1),
    'a quick correction': t => t < .5 ? go(1, 0) : t < .75 ? go(0, 1) : t < .9 ? go(0, -1) : go(1, 0),
    'S-bend, stick': t => t < .5 ? go(1, 0) : t < .8 ? go(0, .9) : go(.5, -.9),
    'a correction of a correction': t => t < .5 ? go(1, 0) : t < .8 ? go(0, 1) : t < 1.1 ? go(0, -1) : go(1, 1),
    'short taps then straight': t => t < .5 ? go(1, 0) : t < .65 ? go(0, 1) : t < .8 ? go(0, -1) : t < .95 ? go(1, 1) : go(1, 0),
    'a slalom, power back on': t => t < .5 ? go(1, 0) : go(t < 1.1 ? 0 : 1, Math.floor((t - .5) / .3) % 2 ? -1 : 1),
    'a coasting slalom': t => t < .5 ? go(1, 0) : go(0, Math.floor((t - .5) / .3) % 2 ? -1 : 1),
  };
  for (const [spec, tow] of [[CAR_SPEC, false], [SXS_SPEC, false], [TRUCK_SPEC, false], [TRUCK_SPEC, true]])
    for (const speed of [16, 20, 25])
      for (const [name, script] of Object.entries(scripts)) {
        const a = ride(spec, 'gravel', speed, { tow }), b = ride({ ...spec, drift: undefined }, 'gravel', speed, { tow });
        const ra = drive(a, 2.5, script), rb = drive(b, 2.5, script), why = `${spec.id ?? spec.name} ${speed} ${name}`;
        assert.ok(ra.every(r => !r.active), `${why}: no slide`); assert.equal(a.takeDrift(), null, `${why}: nothing counted`);
        assert.deepEqual(ra.map(r => [r.x, r.z, r.heading]), rb.map(r => [r.x, r.z, r.heading]), `${why}: identical`);
      }
  assert.equal(new Drift().shown, false);
});

ok('the flick clocks run in the air: a turn before a jump is no feint after it', () => {
  Drift.learned = true;
  const v = ride(CAR_SPEC, 'gravel', 20);
  drive(v, .7, t => t < .5 ? go(1, 0) : go(0, 1)); v.y += 2; v.vy = 3;
  const air = drive(v, 1.2, () => go(0, 0)); assert.ok(air.some((_, i) => i > 0) && v.airborne === false, 'landed');
  // Hard the other way, power, the catch: in time this would be a flick; after the jump it is nothing.
  drive(v, .45, t => t < .05 ? go(0, -1) : t < .3 ? go(1, -1) : go(1, .5)); assert.equal(v.drift.active, false);
});

ok('a trailer resists but its handbrake drift still shows and counts; so does a narrow one on pavement', () => {
  for (const [spec, ground, tow, counter] of [[TRUCK_SPEC, 'gravel', true, HOLD_STEER], [CAR_SPEC, 'pavement', true, HOLD_STEER], [TRUCK_SPEC, 'pavement', false, .25]]) {
    const v = ride(spec, ground, spec.drift.firmSpeed * TOWED_SPEED + 2, { tow }), run = drive(v, 5, handbrakeIn(counter, 2.5));
    const why = `${spec.id ?? spec.name} ${ground} tow ${tow}`;
    assert.ok(run.filter(r => r.shown).length > 240, `${why}: shows`); assert.ok(v.takeDrift(), `${why}: counts`);
  }
});

ok('into the water: the slide ends there and is not clean', () => {
  const v = ride(CAR_SPEC); drive(v, 1.5, handbrakeIn()); assert.equal(v.drift.active, true);
  const ground = v.terrain.surfaceAt(v.x, v.z); ground.water = true; ground.waterLimit = 10;
  drive(v, .05, () => go(1, -HOLD_STEER));
  assert.equal(v.drift.ended, 'hit'); assert.equal(v.takeDrift().clean, false);
  ground.water = false; delete ground.waterLimit;
});

ok('each ride has its own slide: the side by side is the drift toy, the pickup slow to rotate, a trailer resists', () => {
  const swing = (spec, tow = false) => { const v = ride(spec, 'gravel', 16, { tow }); const r = drive(v, 3, handbrakeIn(HOLD_STEER, 9)); return { at: Math.abs(r[30].angle), held: Math.abs(r.at(-1).angle) }; };
  const car = swing(CAR_SPEC), sxs = swing(SXS_SPEC), truck = swing(TRUCK_SPEC), towed = swing(TRUCK_SPEC, true);
  const view = JSON.stringify({ car, sxs, truck, towed });
  assert.ok(sxs.held > car.held && car.held > truck.held && truck.held > towed.held, `held angles: ${view}`);
  assert.ok(sxs.at > car.at && car.at > truck.at && truck.at > towed.at, `quarter-second swing: ${view}`);
  assert.ok(SXS_SPEC.drift.looseSpeed < CAR_SPEC.drift.looseSpeed && CAR_SPEC.drift.looseSpeed < TRUCK_SPEC.drift.looseSpeed);
  assert.ok(SXS_SPEC.drift.rotate > CAR_SPEC.drift.rotate && CAR_SPEC.drift.rotate > TRUCK_SPEC.drift.rotate);
  assert.ok(TRUCK_SPEC.drift.towed < 1);
  // The bike and the horse are not part of it; a computer driver never slides; a placement drops a slide.
  assert.equal(BIKE_SPEC.drift, undefined); assert.equal(HORSE_SPEC.drift, undefined);
  const ai = ride(CAR_SPEC); ai.canDrift = false; assert.ok(drive(ai, 1, () => go(-1, 1, true)).every(r => !r.active));
  const placed = ride(CAR_SPEC); drive(placed, .5, () => go(0, 1, true)); assert.equal(placed.drift.active, true);
  placed.place(10, 10, 0); assert.equal(placed.drift.active, false); assert.equal(placed.takeDrift(), null);
});

ok('a hit ends the slide and it is not clean; the air ends it too', () => {
  const v = ride(CAR_SPEC); drive(v, 1.5, handbrakeIn());
  assert.equal(v.drift.active, true); v.onSolidImpact(4);
  assert.equal(v.drift.active, false); assert.equal(v.drift.ended, 'hit'); assert.equal(v.takeDrift().clean, false);
  const w = ride(CAR_SPEC); drive(w, 1.5, handbrakeIn()); w.y += 2; w.vy = 3; drive(w, .1, () => go(1, -HOLD_STEER));
  assert.equal(w.drift.ended, 'airborne');
});

ok('the handbrake held with the wheel straight ends the slide; held on, it starts no other until let go', () => {
  const v = ride(CAR_SPEC, 'gravel', 18);
  const run = drive(v, 3, t => t < .4 ? go(0, 1, true) : go(0, 0, true));
  const out = run.findIndex(r => r.t > .4 && !r.active);
  assert.ok(out > 0 && run[out].t < 1.6, `straightened by ${run[out]?.t}`); assert.equal(v.drift.ended, 'straightened');
  assert.ok(run.slice(out).every(r => !r.active), 'no new slide while the handbrake is still held');
  const fast = () => { v.vx = Math.sin(v.heading) * 16; v.vz = -Math.cos(v.heading) * 16; v.speed = 16; };
  fast(); drive(v, .3, () => go(0, 1, true)); assert.equal(v.drift.active, false, 'still held, the wheel turned again: nothing');
  fast();
  drive(v, STEP, () => go(0, 1)); drive(v, STEP * 2, () => go(0, 1, true));
  assert.equal(v.drift.active, true, 'let go and pulled again: a new slide');
});

ok('the edge of the map is a hit: the slide ends there and is not clean', () => {
  const v = ride(CAR_SPEC); drive(v, 1.5, handbrakeIn()); assert.equal(v.drift.active, true);
  v.bounds = [v.x - .02, v.z - 200, v.x + .02, v.z + 200]; drive(v, .1, () => go(1, -HOLD_STEER));
  assert.equal(v.drift.ended, 'hit'); assert.equal(v.takeDrift().clean, false);
});

ok('touch: the speed limit holds in a slide as on grip', () => {
  const road = { id: 1, name: 'Test Road', kind: 3, halfWidth: 400, bridge: false, pts: [[0, 600], [0, -600]] };
  const roads = { roads: [], deckHeight: () => null, nearest: (x, z) => ({ road, seg: 0, t: (600 - z) / 1200, dist: Math.abs(x), heading: 0, x: 0, z }) };
  const top = limit => { const v = ride(SXS_SPEC, 'gravel', 19, { roads }); v.assist = .9; v.strongHelp = true; v.touchSpeedLimit = limit;
    const run = drive(v, 4, t => t < .4 ? go(0, 1, true, true) : go(1, -HOLD_STEER, false, true));
    assert.ok(run.filter(r => r.active).length > 300, 'it slid'); return Math.max(...run.filter(r => r.t > 1).map(r => r.speed)); };
  const free = top(false), held = top(true);
  assert.ok(held <= 75 / 3.6 + .5 && free > held + 1, `limited ${held} free ${free}`);
});

ok('touch: neither steering help fights a slide; both still help outside one', () => {
  const road = { id: 1, name: 'Test Road', kind: 3, halfWidth: 400, bridge: false, pts: [[0, 600], [0, -600]] };
  const roads = { roads: [], deckHeight: () => null, nearest: (x, z) => ({ road, seg: 0, t: (600 - z) / 1200, dist: Math.abs(x), heading: 0, x: 0, z }) };
  const v = ride(CAR_SPEC, 'gravel', 15, { roads }); v.assist = .9; v.strongHelp = true; v.touchSpeedLimit = false;
  const before = drive(v, .5, () => go(1, .1, false, true));
  assert.ok(before.some(r => r.help !== 0) && before.some(r => r.light !== 0), 'the help works on the road');
  const run = drive(v, 3, t => t < .4 ? go(0, 1, true, true) : go(1, -HOLD_STEER, false, true));
  const sliding = run.filter(r => r.active);
  assert.ok(sliding.length > 200 && sliding.every(r => r.help === 0 && r.light === 0));
});

ok('the phone handbrake: GO and BRAKE held a moment at speed with the wheel turned; a roll between pedals, slow, or a straight panic stop is the brake as before', () => {
  const s = CAR_SPEC.drift, turned = HANDBRAKE_STEER;
  assert.equal(phoneHandbrake(s, .1, 20, 1), false, 'a thumb rolling between the pedals');
  assert.equal(phoneHandbrake(s, CHORD_SECONDS, 20, turned), true); assert.equal(phoneHandbrake(s, .2, 20, -1), true);
  assert.equal(phoneHandbrake(s, 2, s.looseSpeed - .1, 1), false, 'below the least drift speed: brake and reverse as before');
  assert.equal(phoneHandbrake(s, 2, 0, 1), false); assert.equal(phoneHandbrake(s, 2, s.looseSpeed, 1), true);
  assert.equal(phoneHandbrake(TRUCK_SPEC.drift, 2, s.looseSpeed, 1), false, 'each ride its own speed');
  assert.equal(phoneHandbrake(s, 2, 25, 0), false, 'a panic stop with the wheel straight is the full brake');
  assert.equal(phoneHandbrake(s, 2, 25, turned - .01), false, 'and nearly straight');
  assert.equal(phoneHandbrake(s, 2, 25, .1, true), true, 'once on, the counter-steer keeps it on');
  assert.equal(phoneHandbrake(s, .1, 25, .1, true), false, 'a new chord starts again');
  assert.equal(phoneHandbrake(s, 2, s.looseSpeed - .1, .1, true), false, 'slow, it is the brake again');
  assert.ok(CHORD_SECONDS <= .2, 'quick enough to use');
  const main = readFileSync('src/main.ts', 'utf8'), touch = readFileSync('src/touch.ts', 'utf8');
  assert.match(main, /chordOn = touch\.handbrake && [^;]*phoneHandbrake\(drift, \(performance\.now\(\) - touch\.chordAt\) \/ 1000, vehicle\.speed, touch\.steer \+ g\.steer, chordOn\);/, 'main asks the rule, with the wheel and last frame');
  assert.match(main, /\(chord \? 0 : touch\.throttle\)/, 'no brake under the chord handbrake');
  assert.match(main, /fleet\?\.driven\.id !== 'truck'/, "not the fleet pickup's parking latch");
  assert.match(touch, /if \(both && !state\.handbrake\) state\.chordAt = performance\.now\(\);/);
});

ok('the phone has a handbrake (GO and BRAKE together) and the help rows say so', () => {
  assert.match(TOUCH.find(([k]) => k === 'Right thumb')[1], /Both at once: handbrake/);
  assert.match(DRIVING_KEYS.find(([k]) => k === 'Space')[1], /^Handbrake/);
});

// ---- Score ----
ok('a drift is a score-stream fact sized by length, angle and speed; clean earns the bonus; real places and animals never score', () => {
  const facts = (o = {}) => ({ angle: 25, peak: 30, length: 30, seconds: 2.5, speed: 12, surface: 'gravel', clean: false, x0: 0, z0: 0, x1: 1, z1: 1, ...o });
  const ev = (o = {}, extra = {}) => ({ kind: 'drift', place: 'route', speed: 12, time: 10, drift: facts(o), ...extra });
  assert.ok(POINTS.drift > 0); assert.notEqual(offenceLabel('drift'), 'drift');
  assert.equal(eventSize(ev()), 1);
  assert.equal(eventSize(ev({ clean: true })), DRIFT_MARKS.clean);
  assert.equal(eventSize(ev({ surface: 'pavement' })), DRIFT_MARKS.firm);
  assert.ok(eventSize(ev({ length: 60 })) > eventSize(ev()) && eventSize(ev({ angle: 35 })) > eventSize(ev()));
  assert.ok(eventSize(ev({}, { speed: 18 })) > eventSize(ev()));
  assert.equal(eventSize(ev({ length: 1e6, angle: 1e6, clean: true, surface: 'pavement' }, { speed: 1e6 })), DRIFT_MARKS.most * DRIFT_MARKS.clean, 'bounded');
  assert.ok(POINTS.drift * DRIFT_MARKS.most * DRIFT_MARKS.clean <= 1.5 * POINTS.sceneHit, 'the biggest drift is near the biggest other event');
  assert.equal(eventSize({ kind: 'rut', place: 'route', speed: 3, time: 1 }), 1, 'other kinds unchanged');
  const first = new ScoreBook().add(ev({ clean: true })).points, plain = new ScoreBook().add(ev()).points;
  assert.equal(first, Math.round(POINTS.drift * DRIFT_MARKS.clean * 2)); assert.equal(plain, POINTS.drift * 2);
  for (const place of ['cemetery', 'church', 'busStop']) assert.equal(new ScoreBook().add(ev({ clean: true }, { place })).points, 0, place);
  assert.equal(new ScoreBook().add(ev({ clean: true }, { subject: 'animal' })).points, 0, 'an animal never scores');
  // Repeats fade as every kind does: no drift pays forever.
  const book = new ScoreBook(); let last = Infinity;
  for (let i = 0; i < 12; i++) { const p = book.add(ev({ clean: true }, { time: 100 * i })).points; assert.ok(p <= last); last = p; }
  assert.ok(last < POINTS.drift * .1);
});

ok('the real Shift reports each finished drift once, with its place; a protected place or a frightened animal on the way scores nothing', () => {
  class El { hidden = false; textContent = ''; id = ''; children = []; style = { setProperty() {}, getPropertyValue() { return ''; } };
    classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
    addEventListener() {} setAttribute() {} after() {} focus() {} click() {} append(...n) { this.children.push(...n); } appendChild(n) { this.children.push(n); return n; }
    replaceChildren() {} querySelectorAll() { return []; } getContext() { return { drawImage() {} }; } }
  const els = new Map();
  globalThis.document = { head: new El(), body: new El(), getElementById(id) { if (!els.has(id)) els.set(id, Object.assign(new El(), { id })); return els.get(id); }, createElement: () => new El() };
  const store = new Map(), memory = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  Object.defineProperty(globalThis, 'localStorage', { get() { return memory; }, configurable: true });
  const terrain = { heightAt: () => 0, surfaceAt: () => ({ ground: 0, canopy: 0, roadDist: 10, halfWidth: 3, kind: 2, level: 7 }) };
  const roads = new Roads({ roads: [{ id: 7, name: 'Test Road', kind: 3, halfWidth: 3, bridge: false, pts: [[0, 0], [1000, 0]] }] }, [0, 0], terrain);
  const mail = { delivered: 0, lawn: 0, ditch: 0, reset() {} };
  const shift = new Shift(null, mail, roads, terrain, [], [0, 0], true, new URLSearchParams('run=1'), () => {});
  // The church ground stands between x 40 and 60 for this check.
  shift.placeAt = (x) => x > 40 && x < 60 ? 'church' : 'route';
  const facts = (x0, x1, o = {}) => ({ angle: 24, peak: 28, length: 40, seconds: 2, speed: 14, surface: 'gravel', clean: true, x0, z0: 0, x1, z1: 0, ...o });
  const fake = (x, active, pending = null) => ({ x, z: 0, vx: 10, vz: 0, heading: Math.PI / 2, airborne: false, speed: 10, spec: CAR_SPEC,
    drift: { active }, takeDrift() { const p = pending; pending = null; return p; } });
  shift.update(1, fake(0, false, facts(0, 30)));
  let last = shift.score.recent.at(-1);
  assert.ok(last, 'the drift is reported'); assert.equal(last.kind, 'drift'); assert.equal(last.place, 'route'); assert.equal(last.speed, 14); assert.equal(last.drift.angle, 24); assert.equal(last.subject, undefined);
  const reported = shift.score.reported;
  shift.update(1, fake(0, false)); assert.equal(shift.score.reported, reported, 'once');
  // Through the church ground: start and end on the road, a frame in between on the church ground.
  shift.update(1, fake(20, true)); shift.update(1, fake(50, true)); shift.update(1, fake(80, true));
  shift.update(1, fake(90, false, facts(20, 90)));
  assert.equal(shift.score.recent.at(-1).place, 'church');
  shift.update(1, fake(95, false, facts(92, 99))); assert.equal(shift.score.recent.at(-1).place, 'route', 'the next drift starts afresh');
  shift.update(1, fake(95, false, facts(95, 45))); assert.equal(shift.score.recent.at(-1).place, 'church', 'ends on the church ground');
  // An animal had to get out of the way while it lasted.
  shift.complaints.add({ kind: 'sceneAnimal', target: 1, x: 0, z: 0, at: shift.elapsed, road: -1, preExisting: false, customer: 'x', line: 'x' });
  shift.update(.5, fake(200, false, facts(150, 200)));
  last = shift.score.recent.at(-1); assert.equal(last.kind, 'drift'); assert.equal(last.subject, 'animal');
  assert.equal(new ScoreBook().add(last).points, 0);
  shift.update(30, fake(300, false, facts(250, 300))); assert.equal(shift.score.recent.at(-1).subject, undefined, 'a later drift is not the animal\'s');
  assert.ok(shift.score.recent.at(-1).time > 0 && CLOCK_FACTOR > 0);
  shift.end(); const n = shift.score.reported; shift.reportDrift(facts(0, 1)); assert.equal(shift.score.reported, n, 'nothing after the shift ends');
});

// ---- Sound and dust ----
ok('the tyres: a rolling car sounds as before; a slide squeals on pavement and throws a louder, lower crunch on gravel', () => {
  for (const surface of ['pavement', 'concrete', 'gravel', 'dirt track', 'rail trail', 'washboard', 'grass', 'brush', 'nowhere'])
    for (const speed of [0, .2, 5, 15, 30]) for (const air of [false, true])
      assert.deepEqual(tyreState(surface, speed, air, 1.2, 0), tyreState(surface, speed, air, 1.2), `${surface} ${speed}`);
  // The rolling numbers themselves (engine-sound-rules.ts), so a slide of 0 cannot quietly change them.
  assert.deepEqual(tyreState('pavement', 30, false), { gain: .16, frequency: 3200, q: .45, rate: 1, depth: 0 });
  assert.deepEqual(tyreState('gravel', 18, false), { gain: .3, frequency: 1150, q: .9, rate: 9 + 18 * .8, depth: .3 });
  const pave = tyreState('pavement', 15, false), squeal = tyreState('pavement', 15, false, 1, 1);
  assert.ok(squeal.gain > pave.gain + .1 && squeal.q > 5 && squeal.frequency >= SQUEAL.frequency, JSON.stringify(squeal));
  const gravel = tyreState('gravel', 15, false), spray = tyreState('gravel', 15, false, 1, 1);
  assert.ok(spray.gain > gravel.gain * 1.8 && spray.frequency < gravel.frequency && spray.depth > gravel.depth, JSON.stringify(spray));
  assert.equal(tyreState('gravel', 15, true, 1, 1).gain, 0, 'silent in the air');
});

ok('dust: puffs from the rear wheels only while sliding, in the surface colour, all gone soon after; LOW makes fewer', () => {
  const camera = new PerspectiveCamera();
  const count = (low) => {
    const fx = new DriftFeedback(low, false), v = ride(CAR_SPEC); let most = 0;
    for (let i = 0; i < 60; i++) { fx.update(1 / 60, v, camera, true); assert.equal(fx.alive, 0, 'none before a slide'); }
    const run = drive(v, 2, handbrakeIn());
    for (let i = 0; i < 120; i++) { v.update(STEP, go(1, -HOLD_STEER)); fx.update(1 / 60, v, camera, true); most = Math.max(most, fx.alive); }
    assert.equal(fx.mesh.visible, true);
    assert.ok(run.some(r => r.active));
    fx.update(1 / 60, v, camera, false);   // not driving (a pause): nothing new
    for (let i = 0; i < 60; i++) fx.update(1 / 60, v, camera, false);
    assert.equal(fx.alive, 0); assert.equal(fx.mesh.visible, false, 'hidden when the dust has settled');
    assert.ok(fx.mesh.count <= (low ? 24 : 56));
    return most;
  };
  const high = count(false), low = count(true);
  assert.ok(high > 10 && low > 3 && low < high, `${high} ${low}`);
  assert.ok(DUST.gravel !== DUST.pavement && DUST['dirt track'] && DUST.grass);
});

console.log(`drift rules: ${passed} checks passed`);
