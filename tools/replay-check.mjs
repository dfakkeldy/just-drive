// Instant replay rules (the project brief): the ring buffer, hit and landing marks, smooth blending, the slow-motion
// moment, the replay camera's framing rule and the clip format/caption rules. Pure: no browser, no land.
// node tools/run-node-check.mjs tools/replay-check.mjs        (tools/replay-mutations.mjs proves each guard bites)
import assert from 'node:assert/strict';
import {
  REPLAY, MARK, SLOW, SHOT, CLIP, ReplayBuffer, ReplayRecorder, emptyFrame, emptyShot, poseAt, slowMoment, playbackRate,
  startTime, replayCamera, clipRange, clipType, clipCaption, clipName, clipSize, wallSeconds, rideCode, turn, skipGap,
} from '../web/src/replay-rules.ts';

const pass = name => console.log(`PASS ${name}`);
const never = () => false;

/** Drive a recorder through frames. state(i, t) returns the ride's numbers for frame i; frames advance by dt. */
function drive(rec, { seconds, dt = 1 / 60, state, startT = 0, ride = 'ride', quiet = never, skip = () => false }) {
  const f = emptyFrame();
  let t = startT;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    t += dt;
    if (skip(i, t)) continue;
    const s = state(i, t);
    Object.assign(f, { t, kind: rideCode(s.kind ?? 'car'), x: s.x, y: s.y ?? 0, z: s.z, pitch: 0, yaw: s.yaw ?? 0, roll: 0,
      bodyPitch: 0, bodyRoll: 0, bodyLift: 0, steer: s.steer ?? 0, speed: s.speed ?? Math.hypot(s.vx, s.vz), vx: s.vx, vz: s.vz,
      air: s.air ?? 0, airborne: !!s.airborne, brake: 0.3, beacon: -1 });
    rec.observe(f, s.vy ?? 0, dt, s.ride ?? ride, quiet);
  }
  return { t };
}
const straight = v => (i, t) => ({ x: 0, z: -v * t, vx: 0, vz: -v });

// ---- the ring buffer --------------------------------------------------------------------------------------------
{
  const b = new ReplayBuffer();
  assert.equal(b.capacity, REPLAY.seconds * REPLAY.hz + REPLAY.spare, 'capacity: 30 s at 25 a second, plus room for marks');
  assert.ok(b.bytes <= 80_000, `small enough for a phone: ${b.bytes} bytes`);
  const f = emptyFrame();
  for (let i = 0; i < 2000; i++) { f.t = i * 0.04; f.x = i; b.push(f); }
  assert.equal(b.count, b.capacity, 'the ring stays full, never grows');
  assert.equal(b.read(0, emptyFrame()).x, 2000 - b.capacity, 'oldest sample after wrap');
  assert.equal(b.read(b.count - 1, emptyFrame()).x, 1999, 'newest sample after wrap');
  for (let i = 0; i < b.count - 1; i++) assert.ok(b.time(i) < b.time(i + 1), 'times rise through the wrap');
  assert.equal(b.find(b.time(10) + 0.01), 10, 'search finds the sample at or before a time');
  assert.equal(b.find(b.time(0) - 1), -1, 'before the first sample');
  f.t = b.time(b.count - 1) - 1; f.x = -5; b.push(f);
  assert.equal(b.read(b.count - 1, emptyFrame()).x, 1999, 'a sample back in time is refused');
  pass('ring buffer: fixed size, wrap, ordered search, under 80 KB');
}

// ---- sampling rate and window in every frame rate ---------------------------------------------------------------
for (const fps of [30, 60, 144]) {
  const rec = new ReplayRecorder();
  drive(rec, { seconds: 45, dt: 1 / fps, state: straight(20) });
  const b = rec.buffer, span = rec.span();
  assert.ok(span && span.to - span.from >= REPLAY.seconds - 1 / REPLAY.hz, `${fps} fps: keeps at least the last 30 s (${span && (span.to - span.from).toFixed(2)})`);
  const rate = (b.count - 1) / (b.time(b.count - 1) - b.time(0));
  assert.ok(rate >= 20 && rate <= 30, `${fps} fps: ${rate.toFixed(1)} samples a second`);
  assert.equal(rec.marks.length, 0, `${fps} fps: steady driving makes no marks`);
}
pass('sampling: 20 to 30 a second at 30, 60 and 144 frames a second; the last 30 s kept');

// ---- hits ---------------------------------------------------------------------------------------------------------
{
  // A wall at 15 m/s: the velocity goes to zero in one frame.
  const rec = new ReplayRecorder();
  drive(rec, { seconds: 4, state: (i, t) => t < 2 ? { x: 0, z: -15 * t, vx: 0, vz: -15 } : { x: 0, z: -30, vx: 0, vz: 0.5 } });
  assert.equal(rec.marks.length, 1, 'a wall makes one mark');
  const m = rec.marks[0];
  assert.equal(m.kind, 'hit'); assert.ok(Math.abs(m.strength - 15.5) < 0.01, `strength is the change of velocity: ${m.strength}`);
  assert.ok(Math.abs(m.heading - 0) < 1e-6, 'travel direction north before the hit');
  assert.ok(rec.buffer.find(m.t) >= 0 && rec.buffer.time(rec.buffer.find(m.t)) === m.t, 'an extra sample at the exact hit moment');
}
{
  // A mailbox knocked down at 20 m/s keeps 91% of the speed (props.ts): 1.8 m/s lost in one frame is not a crash.
  const rec = new ReplayRecorder();
  drive(rec, { seconds: 3, state: (i, t) => ({ x: 0, z: -20 * t, vx: 0, vz: t < 1.5 ? -20 : -18.2 }) });
  assert.equal(rec.marks.length, 0, 'a knocked mailbox is not a hit');
}
for (const dt of [1 / 60, 0.07, 0.1, 0.25, 0.5]) {
  // The measured worst non-solid changes (third review, real Vehicle and BikeRide): never a hit at any frame length.
  const cap = Math.min(dt, REPLAY.step);
  for (const [what, rate, kind] of [['car brake + handbrake at full lock', 28.1, 'car'], ['bike skid', 42, 'bike'], ['braking in brush', 37, 'sxs'], ['strong touch help', 34, 'car']]) {
    const rec = new ReplayRecorder();
    // Velocity swings sideways at `rate` m/s² of simulated time: the speed holds near 25 m/s while its direction turns.
    drive(rec, { seconds: 3, dt, state: (i) => { const p = (i + 1) * cap, a = rate * p / 25; return { x: 25 * Math.sin(a) * 2, z: -25 * p, vx: 25 * Math.sin(a), vz: -25 * Math.cos(a), kind }; } });
    assert.equal(rec.marks.filter(m => m.kind === 'hit').length, 0, `${what} at ${dt.toFixed(3)} s frames: not a hit`);
  }
  // A horse leaving the road for brush loses 8 m/s at once: no hit for a horse, ever.
  const horse = new ReplayRecorder();
  drive(horse, { seconds: 3, dt, state: (i, t) => ({ x: 0, z: -9 * t, vx: 0, vz: t < 1.5 ? -9 : -1, kind: 'horse' }) });
  assert.equal(horse.marks.length, 0, `horse at ${dt.toFixed(3)} s frames: a surface change is not a hit`);
}
for (const dt of [0.15, 0.25, 0.5]) {
  // A respawn 10 m back on a long frame, the pedal still held (0.48 m/s after): a cut, never a hit.
  const rec = new ReplayRecorder();
  // Simulated motion per frame is capped as in the game; the respawn puts the ride 10 m behind its last place.
  const cap = Math.min(dt, REPLAY.step), n = Math.round(2 / dt);
  drive(rec, { seconds: 4, dt, state: (i) => i < n ? { x: 0, z: -25 * (i + 1) * cap, vx: 0, vz: -25 } : { x: 0, z: -25 * n * cap + 10 - 0.48 * (i - n) * cap, vx: 0, vz: -0.48 } });
  assert.equal(rec.marks.length, 0, `respawn on ${dt} s frames: no mark`);
  assert.ok(rec.buffer.runStart() > 0, `respawn on ${dt} s frames: a cut`);
}
for (const dt of [0.15, 0.25, 0.5]) {
  // A busy phone: every frame is long (the physics step is capped at 0.1 s, the clock is not). A wall still marks.
  const rec = new ReplayRecorder();
  const cap = Math.min(dt, REPLAY.step), n = Math.round(3 / dt);
  drive(rec, { seconds: 6, dt, state: (i) => i < n ? { x: 0, z: -12 * (i + 1) * cap, vx: 0, vz: -12 } : { x: 0, z: -12 * n * cap, vx: 0, vz: 0.5 } });
  assert.equal(rec.marks.length, 1, `long frames of ${dt} s: the wall is marked`);
}
{
  // Stopped to exactly zero where it stands: an animal's guard or a ground reload placed the ride; no solid does that.
  const rec = new ReplayRecorder();
  drive(rec, { seconds: 4, state: (i, t) => t < 2 ? { x: 0, z: -15 * t, vx: 0, vz: -15 } : { x: 0, z: -30, vx: 0, vz: 0 } });
  assert.equal(rec.marks.length, 0, 'a ride placed on the spot makes no mark');
}
for (const [name, dt] of [['60 fps', 1 / 60], ['a 10 fps phone', 0.1], ['a 5 fps stall', 0.2]]) {
  // The hardest brake any ride has (with the handbrake) never reads as a hit.
  const rec = new ReplayRecorder(), a = 9.5 + 5.5;
  // As in the game, a frame simulates at most REPLAY.step of motion however long it took.
  drive(rec, { seconds: 4, dt, state: (i) => { const p = (i + 1) * Math.min(dt, REPLAY.step), v = Math.max(0, 25 - a * p); return { x: 0, z: -(25 * p - a * p * p / 2), vx: 0, vz: -v }; } });
  assert.equal(rec.marks.length, 0, `${name}: braking is not a hit`);
}
{
  // A respawn: the ride jumps 300 m and stops. That is a new run, not a crash.
  const rec = new ReplayRecorder();
  drive(rec, { seconds: 4, state: (i, t) => t < 2 ? { x: 0, z: -20 * t, vx: 0, vz: -20 } : { x: 300, z: 50, vx: 0, vz: 0 } });
  assert.equal(rec.marks.length, 0, 'a teleport makes no mark');
  const b = rec.buffer, first = b.runStart();
  assert.ok(b.time(first) >= 2, 'the newest run starts at the teleport');
  assert.ok(b.segment(first - 1) !== b.segment(first), 'the old run keeps its own segment');
}
{
  // A frame the recorder did not see (a pause, an ending, the fly camera) is never read as a sudden stop.
  const rec = new ReplayRecorder();
  drive(rec, { seconds: 4, skip: (i, t) => t > 2 && t < 2.2, state: (i, t) => t < 2.1 ? { x: 0, z: -15 * t, vx: 0, vz: -15 } : { x: 0, z: -31.5, vx: 0, vz: 0.5 } });
  assert.equal(rec.marks.length, 0, 'unseen frames make no mark');
}
{
  // A different ride (a fleet switch) starts a new run even in the same place.
  const rec = new ReplayRecorder();
  drive(rec, { seconds: 4, state: (i, t) => ({ x: 0, z: -5 * t, vx: 0, vz: t < 2 ? -5 : 0, ride: t < 2 ? 'truck' : 'bike' }) });
  assert.equal(rec.marks.length, 0, 'a switch of ride is not a hit');
  assert.ok(rec.buffer.time(rec.buffer.runStart()) >= 2, 'a switch of ride starts a new run');
}
{
  // Two knocks 0.3 s apart are one event; the stronger stays.
  const rec = new ReplayRecorder();
  drive(rec, { seconds: 3, state: (i, t) => t < 1 ? { x: 0, z: -20 * t, vx: 0, vz: -20 } : t < 1.3 ? { x: 0, z: -20 - 16 * (t - 1), vx: 0, vz: -16 } : { x: 0, z: -24.8, vx: 0, vz: 0.5 } });
  assert.equal(rec.marks.length, 1, 'knocks close together merge');
  assert.ok(Math.abs(rec.marks[0].strength - 16.5) < 0.01, `the stronger knock stays: ${rec.marks[0].strength}`);
}
pass('hits: a wall marks once with its strength; braking, teleports, unseen frames and ride switches never do; close knocks merge');

// ---- landings -----------------------------------------------------------------------------------------------------
function jump(fall, scrub = 0.92) {
  const rec = new ReplayRecorder();
  drive(rec, { seconds: 4, state: (i, t) => {
    const air = t > 1 && t < 2;
    const vz = -20 * (t >= 2 ? scrub : 1);
    return { x: 0, z: -20 * t, y: air ? 2 : 0, vx: 0, vz, vy: air ? -fall : 0, airborne: air, air: air ? 2 : 0 };
  } });
  return rec;
}
{
  const hard = jump(8);
  assert.equal(hard.marks.length, 1, 'a hard landing marks once');
  assert.equal(hard.marks[0].kind, 'landing'); assert.equal(hard.marks[0].strength, 8, 'strength is the fall speed');
  assert.equal(jump(2).marks.length, 0, 'a soft landing makes no mark');
  // The landing scrubs 8% of 20 m/s (1.6 m/s) and 40% sideways: that loss belongs to the landing, never a hit.
  assert.ok(jump(8, 0.5).marks.every(m => m.kind === 'landing'), 'the landing scrub is not also a hit');
}
pass('landings: marked by fall speed; soft landings and the landing scrub make no hit');

// ---- quiet ground and the slow-motion moment ---------------------------------------------------------------------
{
  const rec = new ReplayRecorder();
  // A strong knock on quiet ground (x > 50) and a weaker one elsewhere.
  drive(rec, { seconds: 8, quiet: x => x > 50, state: (i, t) => {
    if (t < 2) return { x: 0, z: -20 * t, vx: 0, vz: -20 };
    if (t < 4) return { x: 0, z: -40, vx: 0, vz: 0.5 };
    if (t < 6) return { x: 100 + 20 * (t - 4), z: -40, vx: 20, vz: 0, ride: 'ride' };
    return { x: 100 + 40, z: -40, vx: -0.5, vz: 0 };
  } });
  // The second knock happens after a teleport-sized jump: give it its own drive on one run instead.
  const rec2 = new ReplayRecorder();
  drive(rec2, { seconds: 10, quiet: x => x > 50, state: (i, t) => {
    if (t < 2) return { x: 0, z: -12 * t, vx: 0, vz: -12 };            // 12 m/s knock at x=0
    if (t < 3) return { x: 0, z: -24, vx: 0, vz: 0.5 };
    if (t < 6) { const u = t - 3; return { x: 4 * u * u, z: -24, vx: 8 * u, vz: 0 }; }   // pull away east at 8 m/s² to x=36
    if (t < 7) return { x: 36 + 24 * (t - 6), z: -24, vx: 24, vz: 0 };                   // onto quiet ground (x > 50)
    return { x: 60, z: -24, vx: -0.5, vz: 0 };                                               // 24 m/s knock at x=60
  } });
  assert.equal(rec2.marks.length, 2, 'both knocks are marked');
  assert.equal(rec2.marks[1].quiet, true, 'the knock on quiet ground is quiet');
  assert.ok(rec2.span(), 'replayable');
  const span = rec2.span(), m = slowMoment(rec2.marks, span.from, span.to);
  assert.ok(m && !m.quiet && Math.abs(m.strength - 12.5) < 0.01, 'slow motion picks the strongest mark that is not quiet');
  assert.equal(slowMoment(rec2.marks.filter(x => x.quiet), span.from, span.to), null, 'quiet ground never gets slow motion');
  const plain = (t, strength) => ({ t, strength, kind: 'hit', quiet: false, segment: 0, x: 0, y: 0, z: 0, heading: 0 });
  assert.equal(slowMoment([plain(1, 6), plain(2, 9), plain(3, 7)], 0, 5).strength, 9, 'the strongest of several plain marks');
  assert.equal(slowMoment([{ ...m, strength: MARK.slow - 0.1 }], span.from, span.to), null, 'a small knock gets no slow motion');
  assert.equal(slowMoment(rec2.marks, m.t + 0.01, span.to)?.strength ?? null, null, 'only marks inside the range count');
  assert.equal(rec.marks.filter(x => !x.quiet).length, 1, 'the first drive: one plain knock');
}
{
  const m = { t: 10, strength: 9 };
  assert.equal(playbackRate(5, m, false), 1, 'full speed far from the moment');
  assert.equal(playbackRate(10, m, false), SLOW.rate, 'a quarter at the moment');
  assert.equal(playbackRate(10 + SLOW.full, m, false), SLOW.rate, 'a quarter just around it');
  let last = SLOW.rate;
  for (let d = SLOW.full; d <= SLOW.edge + 0.2; d += 0.05) { const r = playbackRate(10 + d, m, false); assert.ok(r >= last - 1e-12, 'eases back up without a jump'); last = r; }
  assert.equal(last, 1, 'back to full speed');
  assert.equal(playbackRate(3, null, true), SLOW.rate, 'the button holds slow motion');
  assert.equal(playbackRate(3, null, false), 1, 'no moment, no button: full speed');
  assert.equal(startTime(0, 30, m), 5, 'playback starts five seconds before the moment');
  assert.equal(startTime(0, 30, null), 20, 'without one, ten seconds before the end');
  assert.equal(startTime(8, 30, m), 8, 'never before the recording');
  const wall = wallSeconds(6, 13, m, false);
  assert.ok(wall > 7 + 2 && wall < 7 * 4, `slow motion stretches the clip: ${wall.toFixed(2)} s`);
}
pass('slow motion: strongest non-quiet mark in the run; eases to a quarter and back; the button holds a quarter');

// ---- runs: unseen teleports, long gaps, a crash and its reset -------------------------------------------------------
{
  // The day ends (no frames recorded for 10 s), and the new day starts 800 m away: never one run.
  const rec = new ReplayRecorder();
  const end = drive(rec, { seconds: 4, state: straight(15) });
  drive(rec, { seconds: 3, startT: end.t + 10, state: (i, t) => ({ x: 800, z: -300 - 15 * (t - end.t - 10), vx: 0, vz: -15 }) });
  const b = rec.buffer, first = b.runStart();
  assert.ok(b.time(first) > end.t + 9, 'a ride placed while unseen starts a new run');
  const mid = poseAt(b, end.t + 5, emptyFrame(), emptyFrame(), emptyFrame());
  assert.ok(Math.abs(mid.x) < 1e-6, `no slide across the map in the gap (x ${mid.x.toFixed(1)})`);
  const t = skipGap(b, end.t + 1);
  assert.ok(Math.abs(t - b.time(first)) < 1e-9, 'playback skips the dead time to the next run');
  assert.equal(skipGap(b, end.t - 1), end.t - 1, 'inside a run, time is untouched');
  assert.equal(rec.marks.length, 0, 'no mark across the gap');
}
{
  // Unseen for 2 s in the same place (an interior, a report): a long gap is a new run too.
  const rec = new ReplayRecorder();
  const end = drive(rec, { seconds: 3, state: (i, t) => ({ x: 0, z: 0, vx: 0, vz: 0 }) });
  drive(rec, { seconds: 2, startT: end.t + 2, state: () => ({ x: 0.5, z: 0, vx: 0, vz: 0 }) });
  assert.ok(rec.buffer.time(rec.buffer.runStart()) > end.t + 1.9, 'a long unseen gap starts a new run');
  // A short unseen stretch in place (one dropped frame) stays one run.
  const rec2 = new ReplayRecorder();
  const e2 = drive(rec2, { seconds: 3, state: straight(10) });
  drive(rec2, { seconds: 2, startT: e2.t + 0.05, state: (i, t) => ({ x: 0, z: -10 * t, vx: 0, vz: -10 }) });
  assert.equal(rec2.buffer.runStart(), 0, 'a dropped frame keeps the run');
}
{
  // A bike crash at 18 m/s, and 1.6 s later the reset to the last safe place 40 m back: two runs, one replay.
  const rec = new ReplayRecorder();
  drive(rec, { seconds: 8, state: (i, t) => t < 5 ? { x: 0, z: -18 * t, vx: 0, vz: -18, kind: 'bike' }
    : t < 6.6 ? { x: 0, z: -90, vx: 0, vz: 0.4, kind: 'bike' } : { x: 0, z: -50 - 6 * (t - 6.6), vx: 0, vz: -6, kind: 'bike' } });
  const span = rec.span();
  assert.ok(span, 'a crash and its reset can be replayed at once');
  const m = slowMoment(rec.marks, span.from, span.to);
  assert.ok(span.from <= 0.05 && span.to > 7.9, `the replay spans both runs (${span.from.toFixed(2)} to ${span.to.toFixed(2)})`);
  assert.ok(m && m.kind === 'hit' && Math.abs(m.t - 5) < 0.05, 'the crash before the reset is the slow moment');
  assert.ok(rec.buffer.runStart() > 0, 'the reset is a cut');
  // After the reset the camera follows the ride where it now is, never an orbit halfway back to the crash.
  const pose = emptyFrame(), shot = emptyShot();
  for (let t = 6.7; t < 7.6; t += 0.1) {
    poseAt(rec.buffer, t, pose, emptyFrame(), emptyFrame());
    replayCamera(pose, m, 50 * Math.PI / 180, 393 / 852, () => 0, shot);
    const off = Math.hypot(shot.x - pose.x, shot.z - pose.z);
    assert.ok(off < 20, `camera stays with the ride after the reset (${off.toFixed(1)} m at t ${t.toFixed(1)})`);
  }
}
{
  // A fleet switch: 10 s in the truck, then the car. The replay is the car's own path only.
  const rec = new ReplayRecorder();
  drive(rec, { seconds: 13, state: (i, t) => t < 10 ? { x: 0, z: -8 * t, vx: 0, vz: -8, kind: 'truck', ride: 'truck' } : { x: 5, z: -80 - 8 * (t - 10), vx: 0, vz: -8, kind: 'car', ride: 'car' } });
  const span = rec.span();
  assert.ok(span && span.from >= 10 && span.to > 12.9, `only the ride being driven (${span && span.from.toFixed(2)})`);
}
{
  // The window is the last 30 s, never more, even with a long gap inside the ring.
  const rec = new ReplayRecorder();
  const end = drive(rec, { seconds: 12, state: straight(5) });
  drive(rec, { seconds: 25, startT: end.t + 600, state: (i, t) => ({ x: 400, z: -5 * (t - end.t), vx: 0, vz: -5 }) });
  const span = rec.span();
  assert.ok(span.to - span.from <= REPLAY.seconds + 1e-9, `at most 30 s (${(span.to - span.from).toFixed(1)})`);
}
pass('runs: a ride placed or left unseen starts a new run; dead time is skipped; a crash and its reset replay together; 30 s window');

// ---- blending -----------------------------------------------------------------------------------------------------
{
  // A circle of 40 m at 20 m/s, sampled by the recorder at 60 fps. Between samples, the blend must stay on the circle.
  const rec = new ReplayRecorder(), r = 40, w = 20 / r;
  const circle = t => ({ x: r * Math.sin(w * t), z: -r * Math.cos(w * t) + r, vx: r * w * Math.cos(w * t), vz: r * w * Math.sin(w * t), yaw: -(w * t) });
  drive(rec, { seconds: 12, state: (i, t) => circle(t) });
  const out = emptyFrame(), a = emptyFrame(), b = emptyFrame(), buf = rec.buffer;
  let worst = 0, linear = 0;
  for (let i = 10; i < buf.count - 10; i++) {
    const t0 = buf.time(i), t1 = buf.time(i + 1), mid = (t0 + t1) / 2;
    poseAt(buf, mid, out, a, b);
    const truth = circle(mid);
    worst = Math.max(worst, Math.hypot(out.x - truth.x, out.z - truth.z));
    buf.read(i, a); buf.read(i + 1, b);
    linear = Math.max(linear, Math.hypot((a.x + b.x) / 2 - truth.x, (a.z + b.z) / 2 - truth.z));
  }
  assert.ok(worst < 0.005, `the blend follows the recorded path within 5 mm (${(worst * 1000).toFixed(2)} mm)`);
  assert.ok(linear > worst * 5, `a straight line would cut the curve (${(linear * 1000).toFixed(1)} mm)`);
  // The blended heading turns the short way across north (yaw wraps at ±pi).
  const f = emptyFrame(), g = emptyFrame(), bb = new ReplayBuffer();
  Object.assign(f, { t: 1, yaw: Math.PI - 0.05, vx: 1 }); Object.assign(g, { t: 1.04, yaw: -Math.PI + 0.05, vx: 1, x: 0.04 });
  bb.push(f); bb.push(g);
  const mid = poseAt(bb, 1.02, emptyFrame(), emptyFrame(), emptyFrame());
  assert.ok(Math.abs(turn(mid.yaw, Math.PI)) < 1e-6, `the short way round: ${mid.yaw}`);
  // Never blend across a teleport: the earlier sample holds.
  const c = emptyFrame(), d = emptyFrame(), cb = new ReplayBuffer();
  Object.assign(c, { t: 1, x: 0, segment: 1 }); Object.assign(d, { t: 1.04, x: 300, segment: 2 });
  cb.push(c); cb.push(d);
  assert.equal(poseAt(cb, 1.03, emptyFrame(), emptyFrame(), emptyFrame()).x, 0, 'no blend across runs');
  // A hit inside the gap: the velocity disagrees with the chord, so the line is straight (no overshoot into the wall).
  const h0 = emptyFrame(), h1 = emptyFrame(), hb = new ReplayBuffer();
  // 25 m/s into a wall 0.2 m ahead, bouncing back at 3 m/s: the curve would pass 4 cm into the wall.
  Object.assign(h0, { t: 1, z: 0, vz: -25 }); Object.assign(h1, { t: 1.04, z: -0.2, vz: 3 });
  hb.push(h0); hb.push(h1);
  for (let k = 0; k <= 10; k++) { const z = poseAt(hb, 1 + 0.004 * k, emptyFrame(), emptyFrame(), emptyFrame()).z; assert.ok(z <= 1e-6 && z >= -0.2 - 1e-6, `no overshoot at a hit: ${z}`); }
}
pass('blending: follows the recorded path within 5 mm, the short way round, never across a teleport or past a hit');

// ---- the replay camera --------------------------------------------------------------------------------------------
const flat = () => 0;
function inView(shot, p, fov, aspect) {
  const dx = shot.lookX - shot.x, dy = shot.lookY - shot.y, dz = shot.lookZ - shot.z;
  const px = p.x - shot.x, py = p.y - shot.y, pz = p.z - shot.z;
  const cos = (dx * px + dy * py + dz * pz) / Math.hypot(dx, dy, dz) / Math.hypot(px, py, pz);
  const half = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * aspect)) / 2;
  return Math.acos(Math.min(1, cos)) <= half - 0.02;   // a circle inside the picture, with a little margin
}
{
  const fov = 50 * Math.PI / 180, shot = emptyShot(), pose = emptyFrame();
  let cases = 0;
  for (const aspect of [16 / 9, 4 / 3, 393 / 852, 844 / 390]) for (const heading of [0, 1, 2.5, -2]) for (const away of [0, 4, 12, 25]) {
    const m = { t: 10, x: 5, y: 2, z: -7, heading, strength: 9, kind: 'hit', quiet: false, segment: 0 };
    for (let dt = -SHOT.window; dt <= SHOT.window + 1e-9; dt += 0.25) {
      const along = away * (dt / SHOT.window);
      Object.assign(pose, { t: m.t + dt, x: m.x + Math.sin(heading) * along, y: m.y, z: m.z - Math.cos(heading) * along, vx: Math.sin(heading) * 8, vz: -Math.cos(heading) * 8, yaw: -heading });
      replayCamera(pose, m, fov, aspect, flat, shot);
      assert.equal(shot.kind, 'orbit', 'near the moment the camera orbits');
      assert.ok(inView(shot, pose, fov, aspect), `ride in frame (aspect ${aspect.toFixed(2)}, ${away} m, t ${dt})`);
      assert.ok(inView(shot, m, fov, aspect), `hit in frame (aspect ${aspect.toFixed(2)}, ${away} m, t ${dt})`);
      assert.ok(Math.hypot(shot.x - pose.x, shot.y - pose.y, shot.z - pose.z) >= SHOT.minRadius * 0.5, 'outside the ride');
      cases++;
    }
  }
  // Away from the moment, a moving ride gets a chase view behind its direction of travel.
  Object.assign(pose, { t: 0, x: 0, y: 0, z: 0, vx: 20, vz: 0, yaw: -Math.PI / 2 });
  replayCamera(pose, { t: 20, x: 0, y: 0, z: 0, heading: 0 }, fov, 16 / 9, flat, shot);
  assert.equal(shot.kind, 'chase');
  assert.ok(shot.x < -SHOT.chaseBack + 0.01 && Math.abs(shot.z) < 1e-9, `behind the travel: ${shot.x}, ${shot.z}`);
  assert.ok(shot.lookX > 0, 'looking where the ride goes');
  assert.ok(inView(shot, pose, fov, 16 / 9), 'the ride is in the chase view');
  // A still ride is orbited, not chased from an arbitrary side.
  Object.assign(pose, { vx: 0.2, vz: 0 });
  assert.equal(replayCamera(pose, null, fov, 16 / 9, flat, shot).kind, 'orbit', 'a still ride gets an orbit');
  // Never under the ground.
  Object.assign(pose, { t: 10, x: 0, y: 0, z: 0, vx: 0, vz: 0 });
  replayCamera(pose, { t: 10, x: 0, y: 0, z: 0, heading: 0, strength: 9 }, fov, 16 / 9, () => 40, shot);
  assert.ok(shot.y >= 40 + SHOT.clearance - 1e-9, `above a hill: ${shot.y}`);
  pass(`camera: ride and hit in frame in ${cases} orbit cases on desktop and phone shapes; chase behind travel; never underground`);
}

// ---- clips --------------------------------------------------------------------------------------------------------
{
  assert.deepEqual(clipRange(0, 30, { t: 20 }), { start: 20 - CLIP.before, end: 20 + CLIP.after });
  assert.deepEqual(clipRange(0, 30, { t: 29 }), { start: 25, end: 30 }, 'never past the recording');
  assert.deepEqual(clipRange(0, 30, null), { start: 30 - CLIP.plain, end: 30 });
  const all = new Set(['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']);
  assert.deepEqual(clipType(t => all.has(t)), { type: 'video/mp4;codecs=avc1', ext: 'mp4' }, 'MP4 first: phones share it to the gallery');
  assert.deepEqual(clipType(t => t.startsWith('video/webm')), { type: 'video/webm;codecs=vp9', ext: 'webm' }, 'WebM where MP4 cannot be recorded');
  assert.equal(clipType(() => false), null, 'no format: no button');
  assert.equal(clipCaption('mail'), 'Mabou Mail Madness · mmm.fakkeldy.ca', 'the caption is the name and the address');
  assert.equal(clipCaption('just'), 'Just Drive · justdrive.fakkeldy.ca');
  for (const brand of ['mail', 'just']) assert.doesNotMatch(clipCaption(brand), /post|canada|©|®|™|@|#|http/i, 'no other marks');
  assert.equal(clipName(new Date(2026, 10, 17, 9, 5, 3), 'mp4', 'mail'), 'mabou-mail-madness-replay-20261117-090503.mp4');
  for (const [w, h, phone] of [[2560, 1440, false], [1179, 2556, true], [1281, 721, false], [640, 360, false], [843, 389, true]]) {
    const s = clipSize(w, h, phone), edge = phone ? CLIP.phoneEdge : CLIP.desktopEdge;
    assert.ok(s.width % 2 === 0 && s.height % 2 === 0, `even pixels ${JSON.stringify(s)}`);
    assert.ok(Math.max(s.width, s.height) <= edge && Math.max(s.width, s.height) >= Math.min(edge, Math.max(w, h)) - 2, `long edge fits ${edge}: ${JSON.stringify(s)}`);
    assert.ok(Math.abs(s.width / s.height - w / h) < 0.02, 'keeps the picture shape');
  }
}
pass('clips: range around the moment, MP4 then WebM, caption is only the name and address, even pixel sizes');
// ---- main.ts wiring ------------------------------------------------------------------------------------------------
{
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(new URL('../web/src/main.ts', `file://${process.env.MMM_ROOT ?? process.cwd()}/tools/`), 'utf8');
  const call = main.match(/replay\.record\(vehicle, car, [^\n]*\);/)?.[0];
  assert.ok(call, 'main.ts records the driven ride');
  assert.match(call, /now \/ 1000, clockDt, quietGround\)/, 'the recorder gets the uncapped clock step, so long frames still follow each other');
  assert.match(main, /if \(dt > 0 && driving\) replay\.record\(/, 'recording only while the world runs and the ride is driven');
  assert.match(main, /if \(replay\.active\) \{\s*\/\/[^\n]*\n\s*replay\.frame\(now\);/, 'the paused frame draws the replay');
}
pass('wiring: main.ts records with the clock step, only while driving, and draws the replay in the paused frame');
console.log('PASS replay rules');
