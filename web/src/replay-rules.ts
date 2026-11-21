// Instant replay rules (the project brief). No DOM, no three.js: node checks import this file directly
// (tools/replay-check.mjs, tools/replay-mutations.mjs).
//
// The recorder keeps the player's own ride for the last 30 seconds: one sample every 40 ms (25 a second), plus an
// extra sample at each hit or landing so an impact is never smoothed away. A sample is the rig as it was drawn
// (root place and attitude, body lean, steer, speed, velocity, height in the air, lamps), like the 22-byte car state
// of mp/wire.ts but kept locally. The ring holds 30 s x 25 + 64 spare samples of 20 four-byte numbers plus one
// eight-byte time: about 72 KB, allocated once.
//
// Version 1 limit: the replay moves the ride over the world as it is now. A mailbox that fell stays down.

import { RIDE_KINDS } from './ride-kinds';

export const REPLAY = {
  seconds: 30,
  hz: 25,
  /** Room for the extra samples taken at hits, landings and cuts. */
  spare: 64,
  /** The least recording the replay opens on, in seconds. */
  least: 1.5,
  /** The most simulated time one drawn frame carries (main.ts caps the physics step here; the clock runs on). */
  step: 0.1,
  /** A gap in the recording longer than this (frames the recorder did not see) starts a new run. */
  gap: 0.5,
  /** A ride that moved further than this during unseen frames was placed, not driven: a new run. */
  moved: 3,
} as const;

/** Thresholds for the marks. Both strengths are speeds in m/s, so a hit and a landing compare directly. */
export const MARK = {
  /** A landing marks when the ride came down at least this fast (the car scrubs speed from 3 m/s). */
  landing: 3,
  /** A hit marks when the horizontal velocity changed by at least this much in one drawn frame... */
  hit: 2.5,
  /**
   * ...at this rate or more over the time the physics simulated (a drawn frame carries at most REPLAY.step). Measured
   * worst non-solid changes in one 0.1 s step: car or truck braking with the handbrake at full lock 2.8 m/s, a bike
   * skid 4.2, braking in brush 3.7, strong touch help 3.4; a wall gives 125 m/s² and more. Water entry above about
   * 20 m/s (decay 3 v) does mark: that is a plunge.
   */
  decel: 60,
  /** Two marks of one kind closer than this are one event: the stronger one stays. */
  merge: 0.4,
  /** The least strength that earns slow motion. */
  slow: 4,
  /** The most marks kept. */
  keep: 48,
} as const;

/** Playback around the strongest mark, and the slow-motion button. */
export const SLOW = { rate: 0.25, full: 0.5, edge: 1.6 } as const;

/** Replay camera: orbit within this many seconds of the slow moment, or while the ride is nearly still. */
export const SHOT = {
  window: 2.5, still: 1.5, minRadius: 9, margin: 3, spin: 0.22, lift: 0.28, height: 2, clearance: 1.5,
  chaseBack: 7.5, chaseSpeedBack: 0.07, chaseMaxBack: 3, chaseHeight: 3, lookAhead: 3, lookHeight: 1.2,
} as const;

/** The saved clip: from this long before the slow moment to this long after it; without one, the last 8 s. */
export const CLIP = { before: 4, after: 3, plain: 8, fps: 30, desktopEdge: 1280, phoneEdge: 960 } as const;

export { RIDE_KINDS };   // the order is the frame's kind code (ride-kinds.ts)
export const rideCode = (kind: string): number => (RIDE_KINDS as readonly string[]).indexOf(kind);
const HORSE = rideCode('horse');

/** One recorded moment of the driven ride, as it was drawn. Angles in radians; the root rotation order is YXZ. */
export interface ReplayFrame {
  t: number;
  kind: number;
  segment: number;
  x: number; y: number; z: number;
  pitch: number; yaw: number; roll: number;
  bodyPitch: number; bodyRoll: number; bodyLift: number;
  steer: number; speed: number; vx: number; vz: number;
  /** Height of the ride above the ground while airborne, metres; 0 on the ground. */
  air: number;
  airborne: boolean;
  /** Seconds into a bike crash (0: riding), so the replay draws the rider off the bike. */
  crash: number;
  /** Emissive intensities of the brake lamps and the roof beacon (-1: the ride has none). */
  brake: number; beacon: number;
}
export const emptyFrame = (): ReplayFrame => ({
  t: 0, kind: -1, segment: 0, x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0, bodyPitch: 0, bodyRoll: 0, bodyLift: 0,
  steer: 0, speed: 0, vx: 0, vz: 0, air: 0, airborne: false, crash: 0, brake: -1, beacon: -1,
});

// Field order in the ring. Time lives in its own Float64Array (float32 seconds lose milliseconds after a day).
const F = { kind: 0, segment: 1, x: 2, y: 3, z: 4, pitch: 5, yaw: 6, roll: 7, bodyPitch: 8, bodyRoll: 9, bodyLift: 10,
  steer: 11, speed: 12, vx: 13, vz: 14, air: 15, airborne: 16, brake: 17, beacon: 18, crash: 19 } as const;
export const STRIDE = 20;

/** A fixed ring of samples, oldest first. Nothing is allocated after the constructor. */
export class ReplayBuffer {
  readonly capacity: number;
  private readonly data: Float32Array;
  private readonly times: Float64Array;
  private head = 0;
  count = 0;
  constructor(seconds: number = REPLAY.seconds, hz: number = REPLAY.hz, spare: number = REPLAY.spare) {
    this.capacity = Math.ceil(seconds * hz) + spare;
    this.data = new Float32Array(this.capacity * STRIDE);
    this.times = new Float64Array(this.capacity);
  }
  get bytes(): number { return this.data.byteLength + this.times.byteLength; }
  clear(): void { this.head = this.count = 0; }
  /** Logical index (0 = oldest) to ring slot. */
  private slot(i: number): number { return (this.head - this.count + i + this.capacity) % this.capacity; }
  push(f: ReplayFrame): void {
    // A sample never goes back in time; a clock that did would break the search below.
    if (this.count && f.t <= this.times[this.slot(this.count - 1)]) return;
    const s = this.head, d = this.data, o = s * STRIDE;
    this.times[s] = f.t;
    d[o + F.kind] = f.kind; d[o + F.segment] = f.segment;
    d[o + F.x] = f.x; d[o + F.y] = f.y; d[o + F.z] = f.z;
    d[o + F.pitch] = f.pitch; d[o + F.yaw] = f.yaw; d[o + F.roll] = f.roll;
    d[o + F.bodyPitch] = f.bodyPitch; d[o + F.bodyRoll] = f.bodyRoll; d[o + F.bodyLift] = f.bodyLift;
    d[o + F.steer] = f.steer; d[o + F.speed] = f.speed; d[o + F.vx] = f.vx; d[o + F.vz] = f.vz;
    d[o + F.air] = f.air; d[o + F.airborne] = f.airborne ? 1 : 0; d[o + F.brake] = f.brake; d[o + F.beacon] = f.beacon; d[o + F.crash] = f.crash;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }
  time(i: number): number { return this.times[this.slot(i)]; }
  segment(i: number): number { return this.data[this.slot(i) * STRIDE + F.segment]; }
  kindAt(i: number): number { return this.data[this.slot(i) * STRIDE + F.kind]; }
  read(i: number, out: ReplayFrame): ReplayFrame {
    const s = this.slot(i), d = this.data, o = s * STRIDE;
    out.t = this.times[s];
    out.kind = d[o + F.kind]; out.segment = d[o + F.segment];
    out.x = d[o + F.x]; out.y = d[o + F.y]; out.z = d[o + F.z];
    out.pitch = d[o + F.pitch]; out.yaw = d[o + F.yaw]; out.roll = d[o + F.roll];
    out.bodyPitch = d[o + F.bodyPitch]; out.bodyRoll = d[o + F.bodyRoll]; out.bodyLift = d[o + F.bodyLift];
    out.steer = d[o + F.steer]; out.speed = d[o + F.speed]; out.vx = d[o + F.vx]; out.vz = d[o + F.vz];
    out.air = d[o + F.air]; out.airborne = d[o + F.airborne] > 0; out.brake = d[o + F.brake]; out.beacon = d[o + F.beacon]; out.crash = d[o + F.crash];
    return out;
  }
  /** The last sample at or before t, or -1 before the first. */
  find(t: number): number {
    let lo = 0, hi = this.count - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.time(mid) <= t) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return best;
  }
  /** First index of the newest unbroken run: one ride, no teleport, no switch of vehicle. */
  runStart(): number {
    if (!this.count) return 0;
    const last = this.segment(this.count - 1);
    let i = this.count - 1;
    while (i > 0 && this.segment(i - 1) === last) i--;
    return i;
  }
}

export type MarkKind = 'hit' | 'landing';
export interface ReplayMark {
  t: number; kind: MarkKind; strength: number;
  x: number; y: number; z: number;
  /** Direction of travel just before the mark: 0 = north, clockwise. */
  heading: number;
  segment: number;
  /** At a cemetery, a church ground or the school bus stop: never slowed down or shown off. */
  quiet: boolean;
}

/** Records the driven ride. Call observe once per drawn frame in which the ride really moved under the clock. */
export class ReplayRecorder {
  readonly buffer: ReplayBuffer;
  readonly marks: ReplayMark[] = [];
  private segment = 0;
  private nextSample = -Infinity;
  private readonly interval: number;
  private has = false;
  private prevRide: unknown = null;
  private readonly prev = emptyFrame();
  private prevVy = 0;
  constructor(seconds: number = REPLAY.seconds, hz: number = REPLAY.hz) {
    this.buffer = new ReplayBuffer(seconds, hz);
    this.interval = 1 / hz;
  }
  /** Start a new unbroken run: the replay never blends across it. */
  cut(): void { this.segment++; this.nextSample = -Infinity; }
  clear(): void { this.buffer.clear(); this.marks.length = 0; this.has = false; this.cut(); }
  /**
   * f: this frame's drawn state (f.segment is ignored). vy: vertical speed. dt: this frame's clock step (uncapped). The frame
   * follows the last observed one only when the clock moved by exactly dt since it; otherwise frames went unseen (an
   * ending, the day's report, the fly camera, a long frame) and no sudden stop is read across them.
   * ride: the driven object; a different one (a fleet switch, a new vehicle) starts a new run.
   */
  observe(f: ReplayFrame, vy: number, dt: number, ride: unknown, quiet: (x: number, z: number) => boolean): void {
    const p = this.prev;
    const follows = this.has && dt > 0 && Math.abs(f.t - p.t - dt) < 1e-6;
    let marked = false;
    if (!this.has || ride !== this.prevRide || f.kind !== p.kind) this.cut();
    // Unseen frames (the day's report, an end card, an interior, the title card): a placed ride or a long gap starts a
    // new run, so the replay never draws the ride sliding across the map between the two.
    else if (!follows) { if (f.t - p.t > REPLAY.gap || Math.hypot(f.x - p.x, f.z - p.z) > REPLAY.moved) this.cut(); }
    else {
      const jump = Math.hypot(f.x - p.x, f.z - p.z);
      // The ride moves at most REPLAY.step of simulated time per drawn frame, however long the frame took.
      const step = Math.min(dt, REPLAY.step);
      const reach = Math.max(Math.hypot(p.vx, p.vz), Math.hypot(f.vx, f.vz)) * step * 1.5 + 3;
      if (jump > reach) this.cut();   // a teleport: respawn, a place jump, a new day
      else {
        const landed = p.airborne && !f.airborne;
        if (landed && -this.prevVy >= MARK.landing) marked = this.mark('landing', -this.prevVy, p, quiet);
        const dv = Math.hypot(f.vx - p.vx, f.vz - p.vz);
        // A ride stopped to exactly zero was placed (an animal's guard, a reload of the ground, a respawn on the spot),
        // not hit: a solid only removes the part of the speed that goes into it.
        const placed = f.vx === 0 && f.vz === 0;
        // A horse's speed is clamped at once when the ground changes (road to brush): never a hit, only landings.
        const horse = f.kind === HORSE;
        if (!landed && !placed && !horse && dv >= MARK.hit && dv / step >= MARK.decel) marked = this.mark('hit', dv, f, quiet) || marked;
      }
    }
    f.segment = this.segment;
    if (marked || f.t >= this.nextSample) {
      this.buffer.push(f);
      if (f.t >= this.nextSample) this.nextSample = Math.max(this.nextSample + this.interval, f.t + this.interval * 0.5);
    }
    const oldest = this.buffer.count ? this.buffer.time(0) : f.t;
    while (this.marks.length && this.marks[0].t < oldest) this.marks.shift();
    Object.assign(p, f);
    this.prevVy = vy; this.prevRide = ride; this.has = true;
  }
  private mark(kind: MarkKind, strength: number, at: ReplayFrame, quiet: (x: number, z: number) => boolean): boolean {
    const last = this.marks[this.marks.length - 1];
    const heading = Math.atan2(this.prev.vx, -this.prev.vz);
    if (last && last.kind === kind && at.t - last.t < MARK.merge) {
      if (strength <= last.strength) return false;
      Object.assign(last, { t: at.t, strength, x: at.x, y: at.y, z: at.z, heading, quiet: quiet(at.x, at.z) });
      return true;
    }
    this.marks.push({ t: at.t, kind, strength, x: at.x, y: at.y, z: at.z, heading, segment: this.segment, quiet: quiet(at.x, at.z) });
    if (this.marks.length > MARK.keep) this.marks.shift();
    return true;
  }
  /**
   * The recording the replay shows: every run of the last REPLAY.seconds (a crash and the reset that follows it are two
   * runs; the replay cuts between them), or null when there is less than REPLAY.least of it.
   */
  span(): { from: number; to: number } | null {
    const b = this.buffer;
    if (!b.count) return null;
    const to = b.time(b.count - 1);
    let first = b.find(to - REPLAY.seconds);
    if (first < 0 || b.time(first) < to - REPLAY.seconds) first++;
    first = Math.max(0, Math.min(first, b.count - 1));
    // Only the ride being driven now: after a fleet switch the earlier ride's path is not this rig's to replay.
    const kind = b.kindAt(b.count - 1);
    let i = b.count - 1;
    while (i > first && b.kindAt(i - 1) === kind) i--;
    first = i;
    const from = b.time(first);
    return to - from >= REPLAY.least ? { from, to } : null;
  }
}

/** Shortest turn from a to b. */
export const turn = (a: number, b: number): number => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
/** Cubic Hermite between two points with end slopes m0, m1 (already scaled by the interval). */
export function hermite(p0: number, m0: number, p1: number, m1: number, u: number): number {
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
}

/**
 * The ride at time t, blended between the two samples around it. Position follows the recorded velocity (a cubic
 * Hermite curve) when the samples agree with it, else a straight line (a hit changes the velocity inside the gap).
 * Samples from different runs never blend: the earlier one holds.
 */
export function poseAt(buffer: ReplayBuffer, t: number, out: ReplayFrame, a: ReplayFrame, b: ReplayFrame): ReplayFrame {
  if (!buffer.count) return out;
  const i = buffer.find(t);
  if (i < 0) return buffer.read(0, out);
  if (i >= buffer.count - 1) return buffer.read(buffer.count - 1, out);
  buffer.read(i, a); buffer.read(i + 1, b);
  if (a.segment !== b.segment || b.t <= a.t) return Object.assign(out, a);
  const h = b.t - a.t, u = Math.min(1, Math.max(0, (t - a.t) / h));
  const chordX = b.x - a.x, chordZ = b.z - a.z;
  const smooth = Math.hypot(chordX - (a.vx + b.vx) * h / 2, chordZ - (a.vz + b.vz) * h / 2) < 0.05;
  out.x = smooth ? hermite(a.x, a.vx * h, b.x, b.vx * h, u) : lerp(a.x, b.x, u);
  out.z = smooth ? hermite(a.z, a.vz * h, b.z, b.vz * h, u) : lerp(a.z, b.z, u);
  out.y = lerp(a.y, b.y, u);
  out.pitch = a.pitch + turn(a.pitch, b.pitch) * u;
  out.yaw = a.yaw + turn(a.yaw, b.yaw) * u;
  out.roll = a.roll + turn(a.roll, b.roll) * u;
  out.bodyPitch = lerp(a.bodyPitch, b.bodyPitch, u); out.bodyRoll = lerp(a.bodyRoll, b.bodyRoll, u); out.bodyLift = lerp(a.bodyLift, b.bodyLift, u);
  out.steer = lerp(a.steer, b.steer, u); out.speed = lerp(a.speed, b.speed, u);
  out.vx = lerp(a.vx, b.vx, u); out.vz = lerp(a.vz, b.vz, u); out.air = lerp(a.air, b.air, u);
  const near = u < 0.5 ? a : b;
  out.airborne = near.airborne; out.brake = near.brake; out.beacon = near.beacon; out.crash = lerp(a.crash, b.crash, u);
  out.t = t; out.kind = a.kind; out.segment = a.segment;
  return out;
}

/**
 * Playback never sits in the dead time between two runs (the replay holds the last pose of a run for one sample
 * interval, then cuts to the next run's first sample).
 */
export function skipGap(buffer: ReplayBuffer, t: number, hz: number = REPLAY.hz): number {
  const i = buffer.find(t);
  if (i < 0 || i >= buffer.count - 1 || buffer.segment(i) === buffer.segment(i + 1)) return t;
  return t > buffer.time(i) + 1.5 / hz ? buffer.time(i + 1) : t;
}

/** The strongest mark between from and to that earns slow motion. Quiet places never do. */
export function slowMoment(marks: readonly ReplayMark[], from: number, to: number): ReplayMark | null {
  let best: ReplayMark | null = null;
  for (const m of marks) {
    if (m.quiet || m.t < from || m.t > to || m.strength < MARK.slow) continue;
    if (!best || m.strength > best.strength) best = m;
  }
  return best;
}

const smoothstep = (e0: number, e1: number, x: number) => { const u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return u * u * (3 - 2 * u); };
/** Playback speed at replay time t: full speed, easing to a quarter around the slow moment; the button holds a quarter. */
export function playbackRate(t: number, moment: ReplayMark | null, slow: boolean): number {
  const base = slow ? SLOW.rate : 1;
  if (!moment) return base;
  const w = 1 - smoothstep(SLOW.full, SLOW.edge, Math.abs(t - moment.t));
  return Math.min(base, 1 - (1 - SLOW.rate) * w);
}

/** Where playback starts: a little before the slow moment, else ten seconds before the end. */
export function startTime(from: number, to: number, moment: ReplayMark | null): number {
  return Math.max(from, moment ? moment.t - 5 : to - 10);
}

export interface CameraShot { kind: 'chase' | 'orbit'; x: number; y: number; z: number; lookX: number; lookY: number; lookZ: number }
export const emptyShot = (): CameraShot => ({ kind: 'chase', x: 0, y: 0, z: 0, lookX: 0, lookY: 0, lookZ: 0 });

/**
 * The replay camera, always outside the ride. Rule: within SHOT.window seconds of the slow moment, or while the ride
 * is nearly still, an orbit around the midpoint of the ride and the mark, far enough out that both fit the narrower
 * field of view with a margin; otherwise a chase view behind the direction of travel. fov is vertical, in radians.
 */
export function replayCamera(pose: ReplayFrame, moment: ReplayMark | null, fov: number, aspect: number,
  ground: (x: number, z: number) => number | null, out: CameraShot): CameraShot {
  const speed = Math.hypot(pose.vx, pose.vz);
  // Only in the mark's own run: after a reset the ride is elsewhere, and a midpoint orbit would fly far off.
  const near = !!moment && pose.segment === moment.segment && Math.abs(pose.t - moment.t) <= SHOT.window;
  if (near || speed < SHOT.still) {
    const cx = near ? (pose.x + moment!.x) / 2 : pose.x, cz = near ? (pose.z + moment!.z) / 2 : pose.z;
    const cy = near ? (pose.y + moment!.y) / 2 : pose.y;
    const spread = near ? Math.hypot(pose.x - moment!.x, pose.y - moment!.y, pose.z - moment!.z) : 0;
    const half = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * aspect)) / 2;
    const radius = Math.max(SHOT.minRadius, (spread / 2 + SHOT.margin) / Math.tan(half));
    // From the side of the travel at the mark, turning slowly; a still ride is seen from its front quarter.
    const base = near ? moment!.heading + Math.PI / 2 : -pose.yaw + 2.3;
    const azimuth = base + (pose.t - (near ? moment!.t : 0)) * SHOT.spin;
    out.kind = 'orbit';
    out.x = cx + Math.sin(azimuth) * radius; out.z = cz - Math.cos(azimuth) * radius;
    out.y = cy + SHOT.height + radius * SHOT.lift;
    out.lookX = cx; out.lookY = cy + 0.8; out.lookZ = cz;
  } else {
    const dir = speed > 2 ? Math.atan2(pose.vx, -pose.vz) : -pose.yaw;
    const back = SHOT.chaseBack + Math.min(speed * SHOT.chaseSpeedBack, SHOT.chaseMaxBack);
    out.kind = 'chase';
    out.x = pose.x - Math.sin(dir) * back; out.z = pose.z + Math.cos(dir) * back;
    out.y = pose.y + SHOT.chaseHeight;
    out.lookX = pose.x + Math.sin(dir) * SHOT.lookAhead; out.lookY = pose.y + SHOT.lookHeight; out.lookZ = pose.z - Math.cos(dir) * SHOT.lookAhead;
  }
  const g = ground(out.x, out.z);
  if (g !== null && out.y < g + SHOT.clearance) out.y = g + SHOT.clearance;
  return out;
}

/** The part of the recording a saved clip covers. */
export function clipRange(from: number, to: number, moment: ReplayMark | null): { start: number; end: number } {
  if (moment) return { start: Math.max(from, moment.t - CLIP.before), end: Math.min(to, moment.t + CLIP.after) };
  return { start: Math.max(from, to - CLIP.plain), end: to };
}

/** Wall seconds a stretch of replay takes with slow motion. */
export function wallSeconds(start: number, end: number, moment: ReplayMark | null, slow: boolean): number {
  let wall = 0;
  const step = 1 / 120;
  for (let t = start; t < end; t += step) wall += Math.min(step, end - t) / playbackRate(t, moment, slow);
  return wall;
}

/** Video formats, best first: MP4 shares to phone galleries; WebM is the fallback where MP4 cannot be recorded. */
export const CLIP_TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'] as const;
export function clipType(supported: (type: string) => boolean): { type: string; ext: 'mp4' | 'webm' } | null {
  for (const type of CLIP_TYPES) if (supported(type)) return { type, ext: type.startsWith('video/mp4') ? 'mp4' : 'webm' };
  return null;
}

/** The clip's only marking: the game's name and its address. */
export function clipCaption(brand: 'mail' | 'just'): string {
  return brand === 'just' ? 'Just Drive · justdrive.fakkeldy.ca' : 'Mabou Mail Madness · mmm.fakkeldy.ca';
}
const two = (n: number) => String(n).padStart(2, '0');
export function clipName(date: Date, ext: string, brand: 'mail' | 'just'): string {
  const stamp = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
  return `${brand === 'just' ? 'just-drive' : 'mabou-mail-madness'}-replay-${stamp}.${ext}`;
}
/** Clip pixels: the picture scaled so its long edge fits, in even numbers (video encoders need them). */
export function clipSize(width: number, height: number, phone: boolean): { width: number; height: number } {
  const edge = phone ? CLIP.phoneEdge : CLIP.desktopEdge, k = Math.min(1, edge / Math.max(width, height, 1));
  const even = (n: number) => Math.max(2, Math.floor(n * k / 2) * 2);
  return { width: even(width), height: even(height) };
}

/** Seconds as the scrubber shows them: "12.4 s". */
export const clockText = (seconds: number): string => `${Math.max(0, seconds).toFixed(1)} s`;
