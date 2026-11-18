// Drive fixed stretches with the real Terrain and Vehicle code and report how the drive went: time, top speed,
// how rough the ride was, and the repair bill. Run it once on today's land and once on a trial bake, and compare.
// It asserts nothing; it measures. Run through tools/road-ground-drive.sh (it reads ../data/baked/terrain from web/).
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { Vehicle } from '../web/src/vehicle.ts';
import { Damage } from '../web/src/damage-rules.ts';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { makeGround, preload } from './phone-ground.mjs';

const { terrain, roads } = makeGround();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const random = seed => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
function line(pts) { const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum.at(-1) + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return { pts, cum, length: cum.at(-1) }; }
function at(path, s) { s = clamp(s, 0, path.length); let i = 1; while (i < path.cum.length - 1 && path.cum[i] < s) i++; const a = path.pts[i - 1], b = path.pts[i], t = (s - path.cum[i - 1]) / (path.cum[i] - path.cum[i - 1] || 1); return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, heading: Math.atan2(b[0] - a[0], -(b[1] - a[1])) }; }
function nearest(path, x, z, progress = null) { let best = { dist: Infinity }; for (let i = 1; i < path.pts.length; i++) { if (progress !== null && (path.cum[i] < progress - 20 || path.cum[i - 1] > progress + 70)) continue; const a = path.pts[i - 1], b = path.pts[i], dx = b[0] - a[0], dz = b[1] - a[1], t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1), px = a[0] + dx * t, pz = a[1] + dz * t, dist = Math.hypot(x - px, z - pz); if (dist < best.dist) best = { dist, s: path.cum[i - 1] + Math.hypot(dx, dz) * t, x: px, z: pz, heading: Math.atan2(dx, -dz) }; } return best; }
function segment(id, start, end) { const r = roads.roads.find(r => r.id === id), p = line(r.pts), pts = []; for (let s = start; s < end; s += 4) { const q = at(p, s); pts.push([q.x, q.z]); } const q = at(p, end); pts.push([q.x, q.z]); return line(pts); }

// The four stretches of the keyboard check (tools/phone-check.mjs), then the stretches the trial is about.
const street = roads.roads.find(r => r.id === 24), hwy = line(roads.roads.find(r => r.id === 26).pts), join = nearest(hwy, ...street.pts[0]);
const approach = segment(26, join.s, join.s + 650).pts.reverse();
const routes = [
  { name: 'Highway 19 (pinned)', path: segment(25, 4600, 5600) },
  { name: 'Glenora Falls Road, gravel (pinned)', path: segment(20, 100, 1100) },
  { name: 'Mabou Mines Road (pinned)', path: segment(55, 1800, 2800) },
  { name: 'Village and junction (pinned)', path: line([...approach, ...street.pts.slice(1)]), cruise: 5 },
  { name: 'Mabou Mines Road by the sea', path: segment(55, 5700, 6500) },
  { name: 'Rankinville Road', path: segment(101, 1100, 1900) },
  { name: 'Mabou Harbour Road', path: segment(48, 900, 1700) },
  { name: 'Highway 19 sidehill', path: segment(26, 10300, 11000) },
  { name: 'Rail trail', path: segment(972, 400, 1200) },
];

function car() { const node = () => new THREE.Object3D(); const v = new Vehicle({ root: node(), body: node(), steer: { fl: node(), fr: node() }, wheels: { fl: node(), fr: node(), rl: node(), rr: node() } }, terrain, roads, -.2); v.damage = new Damage(); v.damageActive = true; return v; }

/** Keyboard driving as in the keyboard check: taps left and right toward a point ahead. `cruise` in m/s, or null for full throttle. */
function drive(route, cruise) {
  Math.random = random(0x4b455953);
  const v = car(), p = at(route.path, 0); v.desktopPull = true; v.place(p.x, p.z, p.heading);
  const hash = createHash('sha256'), dt = 1 / 60;
  let progress = 0, pulse = 0, seconds = 0, top = 0, distance = 0, worst = 0, off = 0, washTime = 0, washDistance = 0;
  let rollSum = 0, pitchRate = 0, lastPitch = 0, lastRoll = 0, rollRate = 0, heave = 0, lastVy = 0, frames = 0, done = false;
  for (; seconds < 400; frames++) {
    seconds += dt;
    const h = nearest(route.path, v.x, v.z, progress); progress = Math.max(progress, h.s);
    const look = Math.max(3, Math.abs(v.speed) * .8), q = at(route.path, h.s + look), dx = q.x + Math.cos(q.heading) * 1.1 - v.x, dz = q.z + Math.sin(q.heading) * 1.1 - v.z;
    const s = terrain.surfaceAt(v.x, v.z), mu = s.washboard ? .6 : s.kind <= 2 ? 1 : .72, corner = s.washboard ? 1 : 1.7;
    const maxSteer = Math.min(.6, Math.atan(2.62 * 1.15 * corner * mu * 9.81 / Math.max(v.speed * v.speed, 4)));
    const ideal = clamp(Math.atan2(2 * 2.62 * Math.sin(wrap(Math.atan2(dx, -dz) - v.heading)), Math.max(1, Math.hypot(dx, dz))) / maxSteer, -1, 1); pulse += ideal;
    const steer = Math.abs(pulse) > .5 ? Math.sign(pulse) : 0; pulse -= steer;
    const throttle = cruise === null ? 1 : v.speed < cruise - .5 ? 1 : v.speed > cruise + .5 ? -1 : 0;
    const x = v.x, z = v.z;
    v.update(dt, { throttle, steer, handbrake: false, touch: false });
    const ds = Math.hypot(v.x - x, v.z - z); distance += ds;
    top = Math.max(top, v.speed * 3.6); worst = Math.max(worst, Math.abs((v.x - h.x) * Math.cos(h.heading) + (v.z - h.z) * Math.sin(h.heading) - 1.1));
    const now = terrain.surfaceAt(v.x, v.z);
    if (now.kind === 0 || now.roadDist > now.halfWidth + .4) off += ds;
    if (v.surfaceName === 'washboard') { washTime += dt; washDistance += ds; }
    rollSum += Math.abs(v.roll); pitchRate += ((v.pitch - lastPitch) / dt) ** 2; rollRate += ((v.roll - lastRoll) / dt) ** 2; lastPitch = v.pitch; lastRoll = v.roll;
    const vy = v.vy ?? 0; heave += ((vy - lastVy) / dt) ** 2; lastVy = vy;
    hash.update(new Uint8Array(new Float64Array([v.x, v.z, v.y, v.heading, v.speed]).buffer));
    if (progress > route.path.length - 5) { done = true; break; }
    if (h.dist > 90 || frames > 1800 && Math.abs(v.speed) < .05) break;
  }
  const deg = 180 / Math.PI;
  return {
    route: route.name, mode: cruise === null ? 'full throttle' : `cruise ${Math.round(cruise * 3.6)} km/h`, metres: +route.path.length.toFixed(0), finished: done,
    seconds: +seconds.toFixed(1), topKmh: +top.toFixed(1), meanKmh: +(distance / seconds * 3.6).toFixed(1), drivenMetres: +distance.toFixed(0),
    worstSideMetres: +worst.toFixed(2), offRoadMetres: +off.toFixed(0), bill: v.damage.total,
    leanDegrees: +(rollSum / frames * deg).toFixed(2), rollShake: +(Math.sqrt(rollRate / frames) * deg).toFixed(1), pitchShake: +(Math.sqrt(pitchRate / frames) * deg).toFixed(1),
    heave: +Math.sqrt(heave / frames).toFixed(2), washboardSeconds: +washTime.toFixed(1), washboardKmh: washTime ? +(washDistance / washTime * 3.6).toFixed(1) : null,
    pathHash: hash.digest('hex').slice(0, 12),
  };
}

const rows = [];
for (const r of routes) {
  await preload(terrain, r.path.pts, 180);
  for (const cruise of [r.cruise ?? 12, null]) { const row = drive(r, cruise); rows.push(row); console.log(JSON.stringify(row)); }
}
if (process.env.DRIVE_OUT) writeFileSync(process.env.DRIVE_OUT, JSON.stringify(rows, null, 1));
