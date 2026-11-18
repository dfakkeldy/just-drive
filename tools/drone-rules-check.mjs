// Node only: flies the camera drone's rules (web/src/drone-rules.ts) and checks that it handles like a camera drone.
// Then three broken copies of the rules (no floor, no braking, no range) must each fail it.
// node tools/drone-rules-check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from '../web/node_modules/esbuild/lib/main.js';

const source = readFileSync(new URL('../web/src/drone-rules.ts', import.meta.url), 'utf8');
async function load(text) {
  const { code } = await transform(text, { loader: 'ts', format: 'esm', target: 'es2022' });
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const idle = { forward: 0, right: 0, up: 0, turn: 0 };
const open = { ground: 0, floor: 2 };
const home = { x: 0, z: 0 };
function fresh(y = 30, yaw = 0) { return { x: 0, y, z: 0, vx: 0, vy: 0, vz: 0, yaw, yawRate: 0 }; }
function fly(m, s, cmd, seconds, speed = m.DRONE.speed, under = open, land, each) {
  let left = Infinity;
  for (let t = 0; t < seconds; t += 1 / 60) { left = m.stepDrone(s, cmd, 1 / 60, speed, under, home, land); each?.(s, t); if (land && left < 0.35) break; }
  return left;
}

function suite(m) {
  const D = m.DRONE;
  // Level flight relative to where it faces: W goes the way it faces, D to its right, neither changes height.
  let s = fresh(); fly(m, s, { ...idle, forward: 1 }, 3);
  assert.ok(s.z < -30 && Math.abs(s.x) < 1e-6 && Math.abs(s.y - 30) < 1e-6, 'W flies forward, level: ' + JSON.stringify(s));
  s = fresh(30, Math.PI / 2); fly(m, s, { ...idle, forward: 1 }, 3);
  assert.ok(s.x < -30 && Math.abs(s.z) < 1e-6, 'facing left, W flies toward -x');
  s = fresh(); fly(m, s, { ...idle, right: 1 }, 3);
  assert.ok(s.x > 30 && Math.abs(s.z) < 1e-6, 'D flies to the right');
  s = fresh(); fly(m, s, { ...idle, forward: 1, right: 1 }, 6);
  assert.ok(Math.hypot(s.vx, s.vz) <= D.speed + 1e-6, 'a diagonal is not faster');
  // Smooth: it does not jump to full speed, and it gets there in a few seconds.
  s = fresh(); fly(m, s, { ...idle, forward: 1 }, 0.1);
  assert.ok(Math.hypot(s.vx, s.vz) < 0.3 * D.speed, 'speeds up gradually');
  fly(m, s, { ...idle, forward: 1 }, 3);
  assert.ok(Math.hypot(s.vx, s.vz) > 0.95 * D.speed, 'reaches the top speed in about 3 s');
  // Let go: it brakes to a hover within about two seconds and holds its height.
  const y = s.y; fly(m, s, idle, 2);
  assert.ok(Math.hypot(s.vx, s.vz) < 0.1, 'brakes to a hover: ' + Math.hypot(s.vx, s.vz));
  const x = s.x, z = s.z; fly(m, s, idle, 10);
  assert.ok(Math.hypot(s.x - x, s.z - z) < 0.1 && Math.abs(s.y - y) < 1e-6, 'holds position and height with no stick');
  // Up and down.
  s = fresh(); fly(m, s, { ...idle, up: 1 }, 3);
  assert.ok(s.y > 40 && Math.abs(s.x) + Math.abs(s.z) < 1e-6, 'Space climbs straight up');
  s = fresh(); fly(m, s, { ...idle, up: -1 }, 2);
  assert.ok(s.y < 25, 'Shift goes down');
  // Turning: full stick is about 90 degrees a second, and it stops turning when let go.
  s = fresh(); fly(m, s, { ...idle, turn: 1 }, 1);
  assert.ok(s.yaw > 1.2 && s.yaw < 1.6, 'turns left at about 90 degrees a second: ' + s.yaw);
  const yaw = s.yaw; fly(m, s, idle, 3);
  assert.ok(s.yaw - yaw < 0.4 && Math.abs(s.yawRate) < 0.01, 'stops turning when let go');
  // The floor: two metres over trees and roofs, never far below, whatever the stick says.
  s = fresh(30); let lowest = Infinity;
  fly(m, s, { ...idle, up: -1, forward: 1 }, 20, D.speed, { ground: 0, floor: 14 }, undefined, st => { lowest = Math.min(lowest, st.y); });
  assert.ok(lowest > 12.5 && Math.abs(s.y - 14) < 0.5, 'held over the floor: ' + lowest + ' ' + s.y);
  // The ceiling: 120 m over the ground under it.
  s = fresh(110); fly(m, s, { ...idle, up: 1 }, 30);
  assert.ok(s.y <= D.ceiling + 1 && s.y > D.ceiling - 2, 'held under the ceiling: ' + s.y);
  // The range: it stops at 2 km from the vehicle.
  s = fresh(); fly(m, s, { ...idle, forward: 1 }, 60, 60);
  assert.ok(Math.hypot(s.x, s.z) <= D.range + 1e-6 && Math.hypot(s.x, s.z) > D.range - 5, 'held inside the range: ' + Math.hypot(s.x, s.z));
  // The return flight: from 1.5 km out and 60 m up, home onto the roof (4.1 m) in under 40 s, over the floor until close.
  s = fresh(60); s.x = 900; s.z = -1200;
  const roof = { x: 0, y: 4.1, z: 0 };
  let dipped = false, seconds = 0;
  const left = fly(m, s, { forward: 1, right: 0, up: 0, turn: 0 }, 40, D.speed, { ground: 0, floor: 20 }, roof, (st, t) => { seconds = t; if (Math.hypot(st.x, st.z) > 4 && st.y < 18.5) dipped = true; });
  assert.ok(left < 0.35, 'the return flight lands: ' + left + ' ' + JSON.stringify(s));
  assert.ok(!dipped, 'the return flight keeps over the floor until over the vehicle');
  assert.ok(seconds < 40, 'home within 40 s');
  // The wheel and the readout.
  assert.equal(m.wheelSpeed(15, -1), 18.75); assert.equal(m.wheelSpeed(15, 1), 12);
  assert.equal(m.wheelSpeed(D.maxSpeed, -1), D.maxSpeed); assert.equal(m.wheelSpeed(D.minSpeed, 1), D.minSpeed);
  assert.equal(m.droneReadout(12.4, 85.2, 9.04, 15, false), 'DRONE   height 12 m   distance 85 m   9 m/s (max 15)');
  assert.equal(m.droneReadout(null, 10, 0, 15, true), 'DRONE   height –   distance 10 m   returning');
  assert.match(m.droneReadout(5, D.range, 0, 15, false), /at range limit$/);
  assert.match(m.droneReadout(D.ceiling, 10, 0, 15, false), /at height limit$/);
  // The gimbal on held arrow keys: smooth start, about 60 degrees a second, stops at straight down and just above level.
  const g = { pitch: -0.3, rate: 0 }; m.stepGimbal(g, 1, 1 / 60);
  assert.ok(g.rate > 0 && g.rate < 0.3 * m.GIMBAL.rate, 'the tilt starts gently');
  for (let i = 0; i < 30; i++) m.stepGimbal(g, 1, 1 / 60);
  assert.ok(g.pitch > -0.05 && g.pitch < 0.3, 'half a second of ↑ tilts up about 25 degrees: ' + g.pitch);
  for (let i = 0; i < 300; i++) m.stepGimbal(g, 1, 1 / 60);
  assert.equal(g.pitch, m.GIMBAL.max); assert.equal(g.rate, 0);
  const held = g.pitch; for (let i = 0; i < 60; i++) m.stepGimbal(g, 0, 1 / 60);
  assert.equal(g.pitch, held, 'let go: the camera stays where it was');
  for (let i = 0; i < 600; i++) m.stepGimbal(g, -1, 1 / 60);
  assert.equal(g.pitch, m.GIMBAL.min, '↓ looks straight down and no further');
  assert.ok(m.GIMBAL.min <= -1.5 && m.GIMBAL.max > 0.2 && m.GIMBAL.max < 0.6, 'straight down to a little above the horizon');
}

const real = await load(source);
suite(real);
console.log('PASS drone rules: gimbal tilt on held keys, level flight relative to its heading, smooth speed-up and braking, hover hold, climb, turn, floor, ceiling, range, return flight, wheel, readout');

// The help text says drone, not fly, and F launches it.
const main = readFileSync(new URL('../web/src/main.ts', import.meta.url), 'utf8');
assert.ok(main.includes("if (ev.code === 'KeyF' && !ev.repeat) { yardJob?.judge.cancel(); if (mode === 'drive') launchDrone(); else landDrone(); }"), 'F launches and lands the drone');
// Keyboard alone: ↑/↓ tilt the camera and do not move the drone; ←/→ turn it; W/S alone fly forward and back.
assert.ok(main.includes("droneCommand.forward = droneKey('KeyW') - droneKey('KeyS') + (stick?.forward ?? 0);"), 'only W/S move the drone forward and back');
assert.ok(main.includes("drone.gimbal(dt, droneKey('ArrowUp') - droneKey('ArrowDown'), pitch);"), '↑/↓ tilt the gimbal');
assert.ok(main.includes("droneCommand.turn = Math.max(droneKey('ArrowLeft'), droneKey('KeyQ')) - Math.max(droneKey('ArrowRight'), droneKey('KeyE'))"), '←/→ turn the drone');
assert.ok(/const DRONE_KEYS = \[[^\]]*'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'\]/.test(main), 'the arrows belong to the drone while it flies');
assert.ok(!/Control(Left|Right)/.test(main.slice(main.indexOf('const DRONE_KEYS'), main.indexOf('function fly('))), 'Ctrl is not a drone key: Ctrl+W closes the tab');
assert.ok(main.includes("throttle: THREE.MathUtils.clamp(k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown')"), 'driving keeps the arrows');
assert.ok(/function applyShot\(s: Shot\) \{\n  drone\.stow\(\);/.test(main), 'a fixed view or ?cam puts the drone away');
for (const file of ['hud-text.ts', 'explore.ts', 'vehicle-choice.ts', 'controls.ts']) {
  const text = readFileSync(new URL(`../web/src/${file}`, import.meta.url), 'utf8');
  assert.ok(!/F: fly|Fly camera/.test(text), `${file} still says fly`);
}
console.log('PASS F launches the drone; help text says drone');

// Mutants: each broken rule must be caught.
const mutants = [
  ['no floor', 'if (under.floor !== null && !landing && s.y < under.floor) {', 'if (false) {'],
  ['no braking', "ease(want > now ? DRONE.accel : DRONE.brake, dt)", "ease(want > now ? DRONE.accel : 0, dt)"],
  ['no range', 'if (out > DRONE.range) {', 'if (false) {'],
  ['gimbal past straight down', 'if (g.pitch <= GIMBAL.min) {', 'if (false) {'],
  ['gimbal jumps', 'g.rate += (Math.max(-1, Math.min(1, input)) * GIMBAL.rate - g.rate) * (1 - Math.exp(-GIMBAL.ease * dt));', 'g.rate = Math.max(-1, Math.min(1, input)) * GIMBAL.rate;'],
  ['no height hold', 's.vy += (wantY - s.vy) * ease(DRONE.vertical, dt);', 's.vy += (wantY - s.vy) * ease(DRONE.vertical, dt) - 0.01;'],
];
for (const [name, from, to] of mutants) {
  assert.equal(source.split(from).length, 2, 'mutant anchor: ' + name);
  const broken = await load(source.replace(from, to));
  assert.throws(() => suite(broken), undefined, 'mutant survived: ' + name);
  console.log('REJECTED ' + name);
}
