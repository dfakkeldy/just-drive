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
  assert.equal(m.droneReadout(12.4, 85.2, 9.04, 15, false), 'DRONE · Height 12 m · From the car 85 m · Speed 9 m/s · Heading N');
  assert.equal(m.droneReadout(null, 10, 0, 15, true), 'DRONE · Height – · From the car 10 m · Speed 0 m/s · Heading N · returning');
  assert.match(m.droneReadout(5, D.range, 0, 15, false), /at range limit$/);
  assert.match(m.droneReadout(D.ceiling, 10, 0, 15, false), /at height limit$/);
  // Standalone drone mode (home = null): no 2 km range limit, keeps the 120 m ceiling and roof floor.
  s = fresh(40);
  for (let t = 0; t < 100; t += 1 / 60) m.stepDrone(s, { ...idle, forward: 1 }, 1 / 60, D.maxSpeed, open, null);
  assert.ok(Math.hypot(s.x, s.z) > 5000, 'standalone drone flies past 5 km with no range limit: ' + Math.hypot(s.x, s.z));
  s = fresh(110);
  for (let t = 0; t < 30; t += 1 / 60) m.stepDrone(s, { ...idle, up: 1 }, 1 / 60, D.speed, open, null);
  assert.ok(s.y <= D.ceiling + 1 && s.y > D.ceiling - 2, 'standalone drone still keeps the 120 m ceiling: ' + s.y);
  s = fresh(30);
  for (let t = 0; t < 15; t += 1 / 60) m.stepDrone(s, { ...idle, up: -1 }, 1 / 60, D.speed, { ground: 0, floor: 18 }, null);
  assert.ok(s.y >= 17.5, 'standalone drone still keeps the roof floor: ' + s.y);
  // Loading speed cap: stops near unready land, ramps smoothly, full speed when clear ahead.
  assert.equal(m.loadSpeedCap(60, -1), 0);
  assert.equal(m.loadSpeedCap(60, m.DRONE_LOAD.stop), 0);
  assert.equal(m.loadSpeedCap(60, m.DRONE_LOAD.full), 60);
  const midCap = m.loadSpeedCap(60, (m.DRONE_LOAD.stop + m.DRONE_LOAD.full) / 2);
  assert.ok(midCap > 20 && midCap < 40, 'half-clear slows speed smoothly: ' + midCap);
  // Standalone readout: no distance, shows loading state when slowed.
  assert.equal(m.droneReadout(12.4, null, 9.04, 15, false), 'DRONE · Height 12 m · Speed 9 m/s · Heading N');
  assert.equal(m.droneReadout(12.4, null, 4.1, 60, false, 0, true), 'DRONE · Height 12 m · Speed 4 m/s (max 60) · Heading N · loading land');
  assert.equal(m.droneReadout(D.ceiling, null, 0, 15, false, 0, true), 'DRONE · Height 120 m · Speed 0 m/s · Heading N · at height limit');
  assert.equal(m.droneReadout(12.4, null, 4.1, 60, true, 0, true), 'DRONE · Height 12 m · Speed 4 m/s (max 60) · Heading N · returning');
  for (const [i, heading] of ['N','NE','E','SE','S','SW','W','NW'].entries()) assert.match(m.droneReadout(10, 2, 0, 15, false, -i * Math.PI / 4), new RegExp('Heading '+heading+'$'));
  assert.match(m.droneReadout(12.4, 85.2, 9.04, 20, false), /Speed 9 m\/s \(max 20\)/);
  assert.doesNotMatch(m.droneReadout(12.4, 85.2, 9.04, m.wheelSpeed(m.wheelSpeed(15, 1), -1), false), /\(max/, 'a wheel round trip hides the default despite floating point rounding');
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
console.log('PASS drone rules: gimbal tilt on held keys, level flight relative to its heading, smooth speed-up and braking, hover hold, climb, turn, floor, ceiling, range, return flight, wheel, readout, standalone drone and load speed cap');

// Standalone drone choice: explore / Just Drive only, never in mail play (URL or saved storage).
const garageSource = readFileSync(new URL('../web/src/garage.ts', import.meta.url), 'utf8');
const isDroneMatch = garageSource.match(/export function isDroneVehicle[\s\S]*?\n\}/);
assert.ok(isDroneMatch, 'isDroneVehicle exists in garage.ts');
const garageHelper = await load(`const VEHICLE_KEY = 'mmm.vehicle'; const GARAGE = [{ id: 'car', mail: true }, { id: 'bike', mail: true }, { id: 'horse', mail: true }]; const periodRides = () => GARAGE;\n${isDroneMatch[0]}`);
const mem = v => ({ getItem: () => v });
assert.equal(garageHelper.isDroneVehicle(new URLSearchParams('vehicle=drone'), true, () => mem(null)), true, 'URL vehicle=drone in explore');
assert.equal(garageHelper.isDroneVehicle(new URLSearchParams('vehicle=drone'), false, () => mem('drone')), false, 'never drone in mail play');
assert.equal(garageHelper.isDroneVehicle(new URLSearchParams(''), true, () => mem('drone')), true, 'saved drone restored in explore');
assert.equal(garageHelper.isDroneVehicle(new URLSearchParams(''), false, () => mem('drone')), false, 'saved drone ignored in mail play');
assert.equal(garageHelper.isDroneVehicle(new URLSearchParams('vehicle=car'), true, () => mem('drone')), false, 'explicit car overrides saved drone');
assert.equal(garageHelper.isDroneVehicle(new URLSearchParams('vehicle=bike'), true, () => mem('drone')), false, 'explicit bike overrides saved drone');
console.log('PASS isDroneVehicle: explore only, URL overrides storage, never mail play');

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
  ['no load speed cap', 'if (clear <= DRONE_LOAD.stop) return 0;', 'if (false) return 0;'],
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
