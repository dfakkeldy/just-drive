// Controller rules in Node (web/src/gamepad-rules.ts): the standard layout, the stick dead zone and curve, the
// triggers, which pad and which device count, menu moves, the latch after a menu, and when to rumble. Also the
// controller rows and HUD line (controls.ts, hud-text.ts). tools/gamepad-mutations.mjs runs it, plain and mutated.
import assert from 'node:assert/strict';
import * as R from '../web/src/gamepad-rules.ts';
import { padKeys, padHelp } from '../web/src/controls.ts';
import { hudLine } from '../web/src/hud-text.ts';
import { Shift } from '../web/src/shift.ts';
import { Mail } from '../web/src/mail.ts';

const near = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} != ${b}`);
const B = R.BUTTON;
function pad({ index = 0, mapping = 'standard', connected = true, axes = [0, 0, 0, 0], down = {}, values = {}, buttons = 17 } = {}) {
  return { index, mapping, connected, axes, buttons: Array.from({ length: buttons }, (_, i) => ({ pressed: !!down[i], value: values[i] ?? (down[i] ? 1 : 0) })) };
}

// The standard layout: A=0 B=1 X=2 Y=3, bumpers 4/5, triggers 6/7, Back 8, Start 9, sticks 10/11, d-pad 12-15.
assert.deepEqual({ ...R.BUTTON }, { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 });
console.log('PASS standard layout indexes');

// Stick: a dead zone, then a gentle curve to full lock, symmetrical, never past 1.
for (const x of [0, 0.05, 0.1, -0.1, 0.149, -0.149]) assert.equal(R.stickCurve(x), 0, `dead zone ${x}`);
assert.equal(R.STICK_DEAD, 0.15);
near(R.stickCurve(1), 1, 'full right'); near(R.stickCurve(-1), -1, 'full left');
near(R.stickCurve(1.4), 1, 'past the rim clamps'); near(R.stickCurve(-3), -1, 'past the rim clamps, left');
for (const bad of [NaN, Infinity, undefined, null, '0.8']) assert.equal(R.stickCurve(bad), 0, `junk ${bad}`);
near(R.stickCurve(0.575), Math.pow(0.5, 1.6), 'half way past the dead zone gives 0.5^1.6');
near(R.stickCurve(-0.575), -Math.pow(0.5, 1.6), 'and the same to the left');
assert.ok(R.stickCurve(0.2) > 0 && R.stickCurve(0.2) < 0.02, 'just past the dead zone: a whisper, not a jump');
assert.ok(R.stickCurve(0.5) < (0.5 - 0.15) / 0.85, 'gentle: under the straight line in the middle');
assert.ok(R.stickCurve(0.9) > 0.8, 'but most of the lock near the rim');
for (let x = 0, last = 0; x <= 1; x += 0.01) { const y = R.stickCurve(x); assert.ok(y >= last, `monotonic at ${x}`); last = y; near(R.stickCurve(-x), -y, `symmetric at ${x}`); }
console.log('PASS stick: dead zone 0.15, curve x^1.6, symmetric, monotonic, clamped, junk is centre');

// Triggers: a small dead zone, straight after it, 0..1.
assert.equal(R.triggerCurve(0.05), 0); near(R.triggerCurve(1), 1, 'full trigger'); near(R.triggerCurve(0.53), 0.5, 'half trigger');
assert.equal(R.triggerCurve(-1), 0); near(R.triggerCurve(2), 1, 'over-read'); assert.equal(R.triggerCurve(NaN), 0);
console.log('PASS triggers: dead zone 0.06, linear');

// Which pads are read.
assert.ok(R.usable(pad()), 'standard pad');
assert.ok(R.usable(pad({ mapping: '' })), 'unlabelled pad with 17 buttons and two sticks');
assert.ok(!R.usable(pad({ mapping: '', buttons: 12 })), 'a wheel or stick with few buttons is left alone');
assert.ok(!R.usable(pad({ mapping: '', axes: [0, 0] })), 'one stick only, unlabelled');
assert.ok(!R.usable(pad({ connected: false })), 'disconnected');
assert.ok(!R.usable(null) && !R.usable(undefined), 'empty slots');
console.log('PASS usable pads');

// Driving values.
const drive = p => R.readDrive(p);
assert.deepEqual(drive(pad()), { steer: 0, throttle: 0, handbrake: false, pull: false }, 'a resting pad drives nothing');
near(drive(pad({ values: { [B.RT]: 1 } })).throttle, 1, 'RT is throttle');
near(drive(pad({ values: { [B.LT]: 1 } })).throttle, -1, 'LT is brake and reverse');
near(drive(pad({ values: { [B.RT]: 0.53 } })).throttle, 0.5, 'RT is analog');
near(drive(pad({ values: { [B.LT]: 0.53 } })).throttle, -0.5, 'LT is analog');
near(drive(pad({ down: { [B.RT]: true }, values: { [B.RT]: 0.53 } })).throttle, 0.5, 'a trigger the browser calls pressed is still analog');
near(drive(pad({ down: { [B.LT]: true }, values: { [B.LT]: 0.2 } })).throttle, -(0.2 - R.TRIGGER_DEAD) / (1 - R.TRIGGER_DEAD), 'so is LT');
near(drive(pad({ down: { [B.RT]: true }, values: { [B.RT]: 0 } })).throttle, 1, 'a digital trigger (pressed, no value) is a full pedal');
near(drive(pad({ values: { [B.RT]: 1, [B.LT]: 1 } })).throttle, 0, 'both triggers cancel, as W and S do');
near(drive(pad({ axes: [1, 0, 0, 0] })).steer, 1, 'left stick right steers right');
near(drive(pad({ axes: [-1, 0, 0, 0] })).steer, -1, 'left stick left steers left');
assert.equal(drive(pad({ axes: [0, 0, 1, 0] })).steer, 0, 'the right stick does not steer');
assert.equal(drive(pad({ axes: [0, 1, 0, 0] })).throttle, 0, 'stick up/down is not a pedal');
assert.equal(drive(pad({ down: { [B.A]: true } })).handbrake, true, 'A is the handbrake');
assert.equal(drive(pad({ down: { [B.B]: true } })).handbrake, false, 'B is not');
assert.equal(drive(pad({ down: { [B.LB]: true } })).pull, true, 'LB pulls (dirt bike)');
assert.equal(drive(pad({ down: { [B.RB]: true } })).pull, true, 'RB pulls (dirt bike)');
assert.equal(drive(pad({ values: { [B.A]: 0.4 } })).handbrake, false, 'an analog face button below half travel is not down');
assert.equal(drive(pad({ values: { [B.A]: 0.6 } })).handbrake, true, 'past half travel it is');
console.log('PASS drive values: stick steers, RT/LT analog throttle and brake, A handbrake, bumpers pull');

// Driving actions and menu moves, as the task names them.
assert.deepEqual([...R.DRIVE_ACTIONS].sort((a, b) => a[0] - b[0]), [[B.B, 'view'], [B.X, 'horn'], [B.Y, 'mail'], [B.BACK, 'reset'], [B.START, 'pause'], [B.UP, 'radio'], [B.DOWN, 'photo'], [B.LEFT, 'relief'], [B.RIGHT, 'places']]);
assert.ok(!R.DRIVE_ACTIONS.has(B.A) && !R.DRIVE_ACTIONS.has(B.LT) && !R.DRIVE_ACTIONS.has(B.RT), 'pedals and handbrake are held values, not presses');
assert.deepEqual([...R.MENU_MOVES].sort((a, b) => a[0] - b[0]), [[B.A, 'choose'], [B.B, 'back'], [B.START, 'start'], [B.UP, 'previous'], [B.DOWN, 'next'], [B.LEFT, 'previous'], [B.RIGHT, 'next']]);
console.log('PASS actions: X horn, Y mail, B view, Start pause; menus: d-pad moves, A chooses, B back');

// Activity and the player's pad.
assert.ok(!R.padActive(pad()), 'resting');
assert.ok(!R.padActive(pad({ axes: [0.3, -0.3, 0.2, 0.1] })), 'a drifting stick is not a move');
assert.ok(R.padActive(pad({ axes: [0.5, 0, 0, 0] })), 'a real stick move');
assert.ok(R.padActive(pad({ axes: [0, 0, 0, -0.6] })), 'the right stick wakes it too');
assert.ok(!R.padActive(pad({ values: { [B.RT]: 0.2 } })), 'a resting finger on a trigger');
assert.ok(R.padActive(pad({ values: { [B.RT]: 0.45 } })), 'a trigger pressed');
assert.ok(R.padActive(pad({ down: { [B.UP]: true } })), 'a d-pad press');
assert.ok(!R.padActive(pad({ mapping: '', axes: [0, 0, -1, -1] })), 'unlabelled: a trigger axis resting at -1 is not a move');
assert.ok(R.padActive(pad({ mapping: '', axes: [0.7, 0, -1, -1] })), 'unlabelled: the left stick is');
assert.ok(R.padActive(pad({ mapping: '', down: { [B.START]: true } })), 'unlabelled: a button is');
const idle0 = pad({ index: 0 }), idle1 = pad({ index: 1 }), used1 = pad({ index: 1, down: { [B.A]: true } }), used0 = pad({ index: 0, axes: [1, 0, 0, 0] });
assert.equal(R.pickPad([idle0, idle1], null), null, 'a pad lying on the table is never picked');
assert.equal(R.pickPad([idle0, used1], null), 1, 'the pad that moves is picked');
assert.equal(R.pickPad([idle0, idle1], 1), 1, 'the current pad stays while idle');
assert.equal(R.pickPad([used0, idle1], 1), 0, 'another pad that moves takes over');
assert.equal(R.pickPad([used0, used1], 1), 1, 'two moving: the current one keeps it');
assert.equal(R.pickPad([idle0, null], 1), null, 'the current pad unplugged and nothing else moves');
assert.equal(R.pickPad([null, pad({ index: 1, connected: false })], 1), null, 'a disconnected slot');
console.log('PASS activity (wake 0.4) and pad choice');

// The last device used wins.
const N = R.nextDevice;
assert.equal(N('gamepad', { kind: 'key' }), 'keyboard');
assert.equal(N('keyboard', { kind: 'pad' }), 'gamepad');
assert.equal(N('gamepad', { kind: 'pointer', pointerType: 'touch' }), 'touch');
assert.equal(N('gamepad', { kind: 'pointer', pointerType: 'pen' }), 'touch');
assert.equal(N('gamepad', { kind: 'pointer', pointerType: 'mouse' }), 'keyboard');
assert.equal(N('touch', { kind: 'pointer', pointerType: '' }), 'touch', 'an unknown pointer changes nothing');
assert.equal(R.homeDevice(true), 'touch'); assert.equal(R.homeDevice(false), 'keyboard');
assert.equal(R.deviceAfterUnplug('gamepad', 0, true), 'touch', 'last pad out on a phone: back to touch');
assert.equal(R.deviceAfterUnplug('gamepad', 0, false), 'keyboard', 'on a desktop: back to the keys');
assert.equal(R.deviceAfterUnplug('gamepad', 1, false), 'gamepad', 'another pad is still there');
assert.equal(R.deviceAfterUnplug('touch', 0, false), 'touch', 'an unplug does not change another device');
console.log('PASS device choice: last used wins, unplug falls back');

// Menus.
assert.deepEqual([0, 1, 2].map(i => R.focusStep(i, 3, 'next')), [1, 2, 0], 'next wraps');
assert.deepEqual([0, 1, 2].map(i => R.focusStep(i, 3, 'previous')), [2, 0, 1], 'previous wraps');
assert.equal(R.focusStep(-1, 3, 'next'), 0); assert.equal(R.focusStep(-1, 3, 'previous'), 2); assert.equal(R.focusStep(7, 3, 'next'), 0);
assert.equal(R.focusStep(0, 0, 'next'), -1, 'an empty menu');
assert.ok(!R.repeatDue(0, 0.3) && !R.repeatDue(0.3, 0.44), 'no repeat before the delay');
assert.ok(R.repeatDue(0.44, 0.46), 'first repeat at the delay');
assert.ok(!R.repeatDue(0.46, 0.55) && R.repeatDue(0.55, 0.61), 'then every 0.15 s');
{ let n = 0; for (let t = 0; t < 2; t += 1 / 60) if (R.repeatDue(t, t + 1 / 60)) n++; assert.equal(n, 11, 'a 2 s hold repeats 11 times'); }
console.log('PASS menus: wrap, d-pad repeat after 0.45 s every 0.15 s');

// A held button carries no action out of a menu.
const downA = Array.from({ length: 17 }, (_, i) => i === B.A), none = Array(17).fill(false);
assert.deepEqual(R.pressedEdges(none, downA), [B.A], 'A went down');
assert.deepEqual(R.pressedEdges(downA, downA), [], 'held: one action per press, not one per frame');
assert.deepEqual(R.pressedEdges([], downA), [B.A], 'a pad just picked: what is down counts');
assert.deepEqual(R.pressedEdges(downA, none), [], 'a release is no press');
let l =R.latch(new Set(), downA, true);
assert.ok(l.has(B.A), 'A pressed in a menu is latched');
l = R.latch(l, downA, false);
assert.ok(l.has(B.A), 'still held after the menu closed: still latched');
assert.equal(R.unlatched({ steer: 0.5, throttle: 0, handbrake: true, pull: false }, l).handbrake, false, 'so no handbrake yet');
l = R.latch(l, none, false);
assert.equal(l.size, 0, 'released: free again');
assert.equal(R.latch(new Set(), downA, false).size, 0, 'a press while driving is not latched');
const both = new Set([B.RT]);
near(R.unlatched({ steer: 0, throttle: 1, handbrake: false, pull: false }, both).throttle, 0, 'a latched RT gives no throttle');
near(R.unlatched({ steer: 0, throttle: -0.4, handbrake: false, pull: false }, both).throttle, -0.4, 'LT still brakes');
near(R.unlatched({ steer: 0, throttle: 0.4, handbrake: false, pull: false }, new Set([B.LT])).throttle, 0.4, 'a latched LT leaves RT');
near(R.unlatched({ steer: 0, throttle: -1, handbrake: false, pull: false }, new Set([B.LT])).throttle, 0, 'a latched LT gives no brake');
near(R.unlatched({ steer: 0.7, throttle: 0, handbrake: false, pull: false }, new Set([B.A])).steer, 0.7, 'the stick is never latched');
assert.equal(R.unlatched({ steer: 0, throttle: 0, handbrake: false, pull: true }, new Set([B.LB])).pull, false, 'a latched bumper does not pull');
console.log('PASS latch: a button held out of a menu counts only after release');

// Rumble.
assert.equal(R.landingRumble(3), null, 'an ordinary bump');
assert.equal(R.landingRumble(5.9), null, 'just under a hard landing');
const land = R.landingRumble(9);
assert.ok(land && land.strong > 0 && land.strong <= 1 && land.weak <= 1 && land.duration >= 120 && land.duration <= 300, 'a hard landing rumbles');
assert.ok(R.landingRumble(20).strong > land.strong, 'harder lands harder');
assert.equal(R.landingRumble(NaN), null);
assert.equal(R.hitRumble(20, 19.85, 1 / 60, 0.33), null, 'full braking (9 m/s²) is no hit');
assert.equal(R.hitRumble(20, 19.3, 1 / 60, 0.33), null, 'a hard slide is no hit either');
assert.equal(R.hitRumble(20, 16.9, 0.25, 4.6), null, 'hard braking through a 4 fps hitch: a big drop, but slow');
assert.ok(R.hitRumble(20, 14, 0.1, 1.7), 'a hit in a slow frame still counts');
const wall = R.hitRumble(15, 0, 1 / 60, 0.2);
assert.ok(wall && wall.strong >= 0.9, 'a wall at 54 km/h is a big hit');
const tap = R.hitRumble(6, 2, 1 / 60, 0.08);
assert.ok(tap && tap.strong < wall.strong, 'a small hit is smaller');
assert.equal(R.hitRumble(-15, 0, 1 / 60, 0.2)?.strong, wall.strong, 'reversing into something counts the same');
assert.equal(R.hitRumble(20, 0, 1 / 60, 140), null, 'back on the road (a placement) is no hit');
assert.equal(R.hitRumble(20, 0, 0, 0), null, 'a paused frame');
assert.equal(R.hitRumble(20, 0, 0.5, 0), null, 'a long hitch is not one frame');
assert.equal(R.hitRumble(2.5, 0, 1 / 60, 0), null, 'a stop at walking pace');
assert.ok(R.placed(0, 1 / 60, 12) && R.placed(20, 1 / 60, 30), 'a jump of metres in one frame is a placement');
assert.ok(!R.placed(20, 1 / 60, 0.34) && !R.placed(0, 1 / 60, 0.5), 'driving, or a nudge, is not');
assert.ok(!R.probeDue(1500, 1000) && R.probeDue(2000, 1000) && R.probeDue(0, -Infinity), 'look for a missed pad once a second');
assert.ok(R.rumbleDue(1000, -Infinity) && !R.rumbleDue(1100, 1000) && R.rumbleDue(1180, 1000), 'effects 180 ms apart');
assert.ok(R.rumbleOn(null) && R.rumbleOn('1') && !R.rumbleOn('0'), 'the switch is on until turned off');
console.log('PASS rumble: hard landing from 6 m/s, a hit is a speed loss no brake gives, placements never rumble');

// Rows and the HUD line.
const mail = padKeys('car', true), just = padKeys('car', false), bike = padKeys('bike', false), horse = padKeys('horse', true);
const row = (rows, key) => rows.find(([k]) => k === key)?.[1];
assert.match(row(mail, 'Start'), /Pause/); assert.match(row(mail, 'Left stick'), /Steer/); assert.match(row(mail, 'RT / LT'), /reverse/);
assert.match(row(mail, 'A'), /Handbrake/); assert.match(row(mail, 'X'), /Horn/); assert.match(row(mail, 'Y'), /mail/); assert.match(row(mail, 'B'), /seat/);
assert.match(row(mail, 'Menus'), /D-pad.*A to choose/);
for (const rows of [just, bike]) for (const [k, v] of rows) assert.doesNotMatch(`${k} ${v}`, /\b(mail|post|route|shift|carrier|delivery)\b/i, 'Just Drive rows have no mail words');
assert.equal(row(just, 'Y'), undefined); assert.match(row(just, 'D-pad right'), /Places/);
assert.match(row(bike, 'LB or RB + RT'), /Wheelie/); assert.equal(row(mail, 'LB or RB + RT'), undefined, 'only the bike pulls');
assert.match(row(horse, 'X'), /Whinny/); assert.equal(row(horse, 'D-pad up'), undefined, 'no radio on a horse');
assert.equal(row(padKeys('car', false, false), 'D-pad up'), undefined, 'no radio row without a radio');
assert.doesNotMatch(padHelp('car', false), /\b(mail|post|shift)\b/i);
assert.match(padHelp('car', true), /Y: mail/); assert.match(padHelp('bike', false), /wheelie/); assert.doesNotMatch(padHelp('horse', true), /radio/);
const hud = { mode: 'drive', mailMode: true, touchDevice: false, fps: 60, speed: 10, activeTouchSpeedLimit: 0, roadName: 'Main Street', surfaceName: 'pavement', airborne: false, help: '\nWASD', jumpLine: '',
  e: 0, n: 0, height: 0, exag: 1.5, sunAz: 0, sunEl: 0, drawn: 0, pending: 0, flySpeed: 40, views: 0, done: 1, stops: 9, delivered: 3, lawn: 0, ditch: 0, trailerReason: '', atEdge: false, route: false, showRuts: false, ruts: 0, lawns: 0 };
assert.match(hudLine(hud), /WASD\/arrows: drive/, 'keys: the keyboard line');
const padLine = hudLine({ ...hud, padHelp: padHelp('car', true) });
assert.match(padLine, /RT\/LT: go\/brake/); assert.doesNotMatch(padLine, /WASD/);
// Counts live in the day card and tally alongside the controller help. Use their real writers.
const shiftHud = { id: 'shiftHud', textContent: '' }, mailScore = { id: 'mailScore', textContent: '' };
const shift = {
  hud: shiftHud, career: { day: 1, double: false }, done: hud.done, stops: hud.stops,
  elapsed: 0, run: { short: 'Test route' }, fired: false, ended: false,
  endButton: {}, cameraButton: {}, damage: { hintTime: 0 }, roadside: [], cleanIndex: -1,
  progress: { textContent: '', classList: { add() {}, remove() {} } }, idleHint: '', roadsideScore: 0,
};
const mailCounts = Object.assign(Object.create(Mail.prototype), {
  delivered: hud.delivered, lawn: hud.lawn, ditch: hud.ditch, customers: hud.done,
  props: { totalCustomers: hud.stops, downCount: 0 }, status: '',
});
Shift.prototype.refreshUI.call(shift); mailScore.textContent = mailCounts.tally;
assert.match(shiftHud.textContent, /\b1\/9 STOPS\b/, 'the day card keeps the stop count beside controller help');
assert.match(mailScore.textContent, /^Delivered 3 · Lawn 0 · Ditch 0 · Boxes down 0\nCustomers 1\/9$/, 'the tally keeps deliveries and customer counts');
assert.match(hudLine({ ...hud, mailMode: false, padHelp: padHelp('car', false) }), /^36 km\/h   Main Street   pavement\nstick: steer/, 'explore: the controller line without FPS');
assert.equal(hudLine({ ...hud, touchDevice: true, padHelp: padHelp('car', true) }), hudLine({ ...hud, touchDevice: true }), 'a phone line has no room for it');
assert.match(hudLine({ ...hud, driveHelp: '\nhorse keys', padHelp: padHelp('horse', true) }), /whinny/, 'the controller line wins over a ride line');
assert.equal(hudLine({ ...hud, padHelp: '' }), hudLine(hud), 'empty: as before');
console.log('PASS controller rows and HUD line');
