// Mutants of web/src/replay-rules.ts: each one breaks a single rule, and tools/replay-check.mjs must reject it.
// node tools/replay-mutations.mjs              the plain check only
// node tools/replay-mutations.mjs --mutations  the plain check, then every mutant
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..'), dir = mkdtempSync(`${tmpdir()}/mmm-replay-`);
const mutants = [
  ['landing sign', '-this.prevVy >= MARK.landing', 'this.prevVy >= MARK.landing'],
  ['brake reads as a hit', 'dv / step >= MARK.decel', 'true'],
  ['small changes are hits', '!horse && dv >= MARK.hit', '!horse && dv >= 1'],
  ['horse surface is a hit', 'const horse = f.kind === HORSE;', 'const horse = false;'],
  ['long frame reaches far', 'const step = Math.min(dt, REPLAY.step);', 'const step = dt;'],
  ['landing scrub is a hit', 'if (!landed && !placed', 'if (!placed'],
  ['teleport not cut', 'if (jump > reach) this.cut();', 'if (false) this.cut();'],
  ['unseen frames read', 'Math.abs(f.t - p.t - dt) < 1e-6', 'true'],
  ['ride switch ignored', "ride !== this.prevRide || ", ''],
  ['placed stop is a hit', 'const placed = f.vx === 0 && f.vz === 0;', 'const placed = false;'],
  ['earlier ride replayed', 'while (i > first && b.kindAt(i - 1) === kind) i--;', 'i = first;'],
  ['crash camera across a reset', 'pose.segment === moment.segment && ', ''],
  ['unseen teleport kept', 'if (f.t - p.t > REPLAY.gap || Math.hypot(f.x - p.x, f.z - p.z) > REPLAY.moved) this.cut();', ''],
  ['unseen gap kept', 'f.t - p.t > REPLAY.gap || ', ''],
  ['newest run only', 'let first = b.find(to - REPLAY.seconds);', 'let first = b.runStart();'],
  ['window over 30 s', 'let first = b.find(to - REPLAY.seconds);', 'let first = 0;'],
  ['dead time played', 'return t > buffer.time(i) + 1.5 / hz ? buffer.time(i + 1) : t;', 'return t;'],
  ['merge keeps the weaker', 'if (strength <= last.strength) return false;', 'return false;'],
  ['no merge', 'at.t - last.t < MARK.merge', 'false'],
  ['no sample at a mark', 'if (marked || f.t >= this.nextSample)', 'if (f.t >= this.nextSample)'],
  ['double sample rate', 'this.nextSample + this.interval, ', 'this.nextSample + this.interval / 2, '],
  ['ring grows', 'if (this.count < this.capacity) this.count++;', 'this.count++;'],
  ['back-in-time sample', 'if (this.count && f.t <= this.times[this.slot(this.count - 1)]) return;', ''],
  ['window too short', 'Math.ceil(seconds * hz) + spare', 'Math.ceil(seconds * hz * 0.8) + spare'],
  ['quiet ground slowed', 'if (m.quiet || m.t < from', 'if (m.t < from'],
  ['weak knocks slowed', ' || m.strength < MARK.slow) continue;', ') continue;'],
  ['weakest wins', 'if (!best || m.strength > best.strength) best = m;', 'if (!best || m.strength < best.strength) best = m;'],
  ['no slow motion', 'return Math.min(base, 1 - (1 - SLOW.rate) * w);', 'return base;'],
  ['slow button ignored', 'const base = slow ? SLOW.rate : 1;', 'const base = 1;'],
  ['straight lines only', '(a.vz + b.vz) * h / 2) < 0.05', '(a.vz + b.vz) * h / 2) < -1'],
  ['curves through hits', '(a.vz + b.vz) * h / 2) < 0.05', '(a.vz + b.vz) * h / 2) < 1'],
  ['blends across runs', 'if (a.segment !== b.segment || b.t <= a.t)', 'if (b.t <= a.t)'],
  ['yaw the long way', 'out.yaw = a.yaw + turn(a.yaw, b.yaw) * u;', 'out.yaw = a.yaw + (b.yaw - a.yaw) * u;'],
  ['hit out of frame', 'Math.max(SHOT.minRadius, (spread / 2 + SHOT.margin) / Math.tan(half))', 'SHOT.minRadius'],
  ['wide field only', 'Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * aspect)) / 2', 'fov / 2'],
  ['looks at the ride only', 'out.lookX = cx; out.lookY = cy + 0.8; out.lookZ = cz;', 'out.lookX = pose.x; out.lookY = pose.y + 0.8; out.lookZ = pose.z;'],
  ['chase in front', 'out.x = pose.x - Math.sin(dir) * back; out.z = pose.z + Math.cos(dir) * back;', 'out.x = pose.x + Math.sin(dir) * back; out.z = pose.z - Math.cos(dir) * back;'],
  ['chase at the moment', 'if (near || speed < SHOT.still) {', 'if (speed < SHOT.still) {'],
  ['underground camera', 'if (g !== null && out.y < g + SHOT.clearance)', 'if (false)'],
  ['clip past the end', 'end: Math.min(to, moment.t + CLIP.after)', 'end: moment.t + CLIP.after'],
  ['WebM first', "['video/mp4;codecs=avc1', 'video/mp4', ", "['video/webm', 'video/mp4;codecs=avc1', 'video/mp4', "],
  ['extra mark on the clip', "'Mabou Mail Madness · mmm.fakkeldy.ca'", "'Mabou Mail Madness · mmm.fakkeldy.ca · #replay'"],
  ['odd clip pixels', 'Math.floor(n * k / 2) * 2', 'Math.floor(n * k)'],
  ['clip too big for a phone', 'const edge = phone ? CLIP.phoneEdge : CLIP.desktopEdge', 'const edge = CLIP.desktopEdge'],
];
let rejected = 0;
try {
  for (const mutant of [null, ...(process.argv.includes('--mutations') ? mutants : [])]) {
    const source = resolve(root, 'web/src/replay-rules.ts'), original = readFileSync(source, 'utf8');
    if (mutant) assert.equal(original.split(mutant[1]).length, 2, `${mutant[0]}: anchor must match once`);
    await build({ entryPoints: [resolve(root, 'tools/replay-check.mjs')], bundle: true, platform: 'node', format: 'esm', outfile: `${dir}/check.mjs`, logLevel: 'silent',
      plugins: mutant ? [{ name: 'mutate', setup(b) { b.onLoad({ filter: /\/replay-rules\.ts$/ }, () => ({ contents: original.replace(mutant[1], () => mutant[2]), loader: 'ts' })); } }] : [] });
    const r = spawnSync(process.execPath, [`${dir}/check.mjs`], { cwd: root, encoding: 'utf8', timeout: 120000 });
    if (!mutant) { assert.equal(r.status, 0, r.stdout + r.stderr); console.log(r.stdout.trim()); }
    else { assert.notEqual(r.status, 0, `${mutant[0]} survived`); assert.match(r.stderr, /AssertionError/, `${mutant[0]}: ${r.stderr.slice(0, 400)}`); console.log('REJECTED', mutant[0]); rejected++; }
  }
  if (rejected) console.log(`PASS ${rejected} of ${mutants.length} replay mutants rejected`);
} finally { rmSync(dir, { recursive: true, force: true }); }
