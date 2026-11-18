import { CAR_SPEC, type VehicleSpec } from './vehicle-spec';
import * as THREE from 'three';
import { Mesher, seeded, type RGB } from './yard-kit';

/**
 * Parked vehicles for any lot in the game: cars, SUVs and pickups in the muted colours of a staff car park.
 * One instanced mesh per type. Every vehicle is solid: `pushOut` keeps the player's car out of them.
 */
export interface Parked { x: number; z: number; heading: number; type: 0 | 1 | 2; colour: number }

/** A solid rectangle on the ground, in world metres: centre, half sizes, and the heading of its long axis. */
export interface Solid { x: number; z: number; half: number; halfWidth: number; heading: number }

/** Body colours, weighted toward what stands in a rural lot: white, silver, grey, black, with some blue and red. */
export const PARKED_COLOURS = [0xd9d9d4, 0xd9d9d4, 0xb4b7b9, 0xb4b7b9, 0x6f7376, 0x6f7376, 0x1b1c1e, 0x1b1c1e, 0x24364f, 0x7a1f1c, 0x4f5b4a, 0x8a8271, 0x2f3a45];
/** Length, width in metres by type: car, SUV, pickup. */
export const PARKED_SIZE: [number, number][] = [[4.5, 1.8], [4.7, 1.9], [5.7, 2.0]];

const GLASS: RGB = [0.06, 0.09, 0.11], TYRE: RGB = [0.035, 0.035, 0.038], WHITE: RGB = [1, 1, 1], LAMP: RGB = [0.9, 0.9, 0.82], TAIL: RGB = [0.5, 0.04, 0.03], TRIM: RGB = [0.16, 0.16, 0.17];

// Side views with the nose toward +x: [distance along the body, height], counter-clockwise.
const SIDE: number[][][] = [
  [[-2.25, 0.32], [2.25, 0.32], [2.25, 0.62], [2.12, 0.86], [1.05, 0.95], [0.38, 1.44], [-1.15, 1.46], [-1.9, 1.02], [-2.25, 0.96]],
  [[-2.35, 0.36], [2.35, 0.36], [2.35, 0.78], [2.2, 1.04], [1.2, 1.12], [0.62, 1.7], [-2.15, 1.72], [-2.35, 1.2]],
  [[-2.85, 0.44], [2.85, 0.44], [2.85, 0.92], [2.7, 1.2], [1.55, 1.26], [1.0, 1.88], [-0.55, 1.9], [-0.62, 1.22], [-2.85, 1.22]],
];
// Side glass as [x0, x1, y0, y1], and the two sloped panes as [x at foot, y at foot, x at head, y at head].
const SIDE_GLASS = [[[-1.05, 0.3, 1.0, 1.38]], [[-2.0, 0.5, 1.16, 1.62]], [[-0.45, 0.9, 1.3, 1.8]]];
const SCREENS = [[[1.02, 0.98, 0.42, 1.4], [-1.86, 1.06, -1.18, 1.42]], [[1.17, 1.15, 0.66, 1.66], [-2.34, 1.24, -2.17, 1.68]], [[1.52, 1.29, 1.04, 1.84], [-0.63, 1.3, -0.57, 1.86]]];
const AXLES = [[1.4, -1.35], [1.5, -1.45], [1.85, -1.75]], WHEEL_R = [0.32, 0.36, 0.42];

/** One vehicle as triangles: local +x is the nose, y is up. The body is white so an instance colour can tint it. */
export function vehicleShape(m: Mesher, type: 0 | 1 | 2, frame: THREE.Matrix4 | null = null, body: RGB = WHITE, glass: RGB | null = GLASS): void {
  const w = PARKED_SIZE[type][1] / 2;
  const place = (x: number, y: number, z: number, yaw = 0) => frame ? m.within(frame, x, y, z, yaw) : m.at(x, y, z, yaw);
  // The profile lies in x-y and is pushed along z, which is the width.
  place(0, 0, 0);
  m.extrude(SIDE[type], -w, w, body);
  if (type === 2) m.box(-1.74, 1.0, 0, 2.1, 0.44, w * 2 - 0.2, [0.08, 0.08, 0.085]);   // the bed is a dark well
  if (glass) {
    for (const [x0, x1, y0, y1] of SIDE_GLASS[type]) for (const s of [-1, 1]) {
      const z = s * (w + 0.012);
      m.quad(s > 0 ? [[x0, y0, z], [x1 + 0.3, y0, z], [x1, y1, z], [x0 + 0.12, y1, z]] : [[x1 + 0.3, y0, z], [x0, y0, z], [x0 + 0.12, y1, z], [x1, y1, z]], glass);
    }
    SCREENS[type].forEach(([xa, ya, xb, yb], i) => {
      const lift = 0.014, zz = w - 0.12, d = i === 0 ? lift : -lift;
      m.quad(i === 0 ? [[xa + d, ya + lift, zz], [xa + d, ya + lift, -zz], [xb + d, yb + lift, -zz], [xb + d, yb + lift, zz]]
        : [[xa + d, ya + lift, -zz], [xa + d, ya + lift, zz], [xb + d, yb + lift, zz], [xb + d, yb + lift, -zz]], glass);
    });
  }
  const len = PARKED_SIZE[type][0] / 2, nose = SIDE[type][2][1];
  for (const s of [-1, 1]) {
    m.box(len + 0.012, nose - 0.08, s * (w - 0.34), 0.03, 0.14, 0.42, LAMP);
    m.box(-len - 0.012, nose + 0.12, s * (w - 0.22), 0.03, 0.2, 0.26, TAIL);
  }
  m.box(len + 0.012, nose - 0.1, 0, 0.03, 0.2, w * 2 - 1.3, TRIM);
  m.box(0, SIDE[type][0][1] + 0.05, 0, len * 2 + 0.06, 0.16, w * 2 + 0.02, TRIM);   // sills and bumpers
  for (const ax of AXLES[type]) for (const s of [-1, 1]) {
    place(ax, WHEEL_R[type], s * (w - 0.11));
    m.cyl(0, 0, 0, WHEEL_R[type], 0.24, TYRE, 'z', 8);
  }
}

export class ParkedVehicles {
  readonly group = new THREE.Group();
  readonly solids: Solid[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private dummy = new THREE.Object3D();

  /** `ground` gives the height under a point, or null while that ground has not loaded. */
  constructor(readonly list: Parked[], private ground: (x: number, z: number) => number | null) {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    for (const type of [0, 1, 2] as const) {
      const mine = list.filter((p) => p.type === type);
      const m = new Mesher();
      vehicleShape(m, type);
      const mesh = new THREE.InstancedMesh(m.geometry(), material, Math.max(1, mine.length));
      mesh.count = mine.length;
      mine.forEach((p, i) => mesh.setColorAt(i, new THREE.Color(p.colour)));
      mesh.frustumCulled = false;   // instances are spread over a lot; the lot itself is shown or hidden as a whole
      mesh.userData.list = mine;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    for (const p of list) this.solids.push({ x: p.x, z: p.z, half: PARKED_SIZE[p.type][0] / 2, halfWidth: PARKED_SIZE[p.type][1] / 2, heading: p.heading });
    this.group.visible = false;
  }

  /** Stand every vehicle on the ground. Returns false while some ground is still missing; call again later. */
  seat(): boolean {
    for (const mesh of this.meshes) {
      const mine = mesh.userData.list as Parked[];
      for (let i = 0; i < mine.length; i++) {
        const p = mine[i], fx = Math.sin(p.heading), fz = -Math.cos(p.heading);
        const y = this.ground(p.x, p.z), nose = this.ground(p.x + fx * 1.4, p.z + fz * 1.4), tail = this.ground(p.x - fx * 1.4, p.z - fz * 1.4);
        if (y === null || nose === null || tail === null) return false;
        this.dummy.position.set(p.x, y, p.z);
        this.dummy.rotation.set(0, Math.PI / 2 - p.heading, Math.atan2(nose - tail, 2.8), 'YXZ');   // local +x is the nose
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.group.visible = true;
    return true;
  }
}

/**
 * A row of parking spaces, every one taken. The row runs from (x0, z0) to (x1, z1); each vehicle faces `heading`,
 * give or take a careless degree or two. `pickups` is the share of pickups, `skip` leaves named spaces empty.
 */
export function parkedRow(x0: number, z0: number, x1: number, z1: number, heading: number, seed: number, opts: { pitch?: number; pickups?: number; skip?: (i: number) => boolean } = {}): Parked[] {
  const rnd = seeded(seed), len = Math.hypot(x1 - x0, z1 - z0), pitch = opts.pitch ?? 2.75;
  const n = Math.max(1, Math.floor(len / pitch) + 1), out: Parked[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i * pitch) / len, r = rnd(), nose = rnd() < 0.2 ? Math.PI : 0;
    const type = r < (opts.pickups ?? 0.34) ? 2 : r < 0.68 ? 1 : 0;
    const colour = PARKED_COLOURS[Math.floor(rnd() * PARKED_COLOURS.length)], wobble = (rnd() - 0.5) * 0.07, creep = (rnd() - 0.5) * 0.5;
    if (opts.skip?.(i)) continue;
    out.push({ x: x0 + (x1 - x0) * t + Math.sin(heading) * creep, z: z0 + (z1 - z0) * t - Math.cos(heading) * creep, heading: heading + nose + wobble, type, colour });
  }
  return out;
}

/** A frozen collision pose, independent of its renderer or control class. */
export interface ContactBody { x: number; z: number; y: number; heading: number; spec: VehicleSpec; vx?: number; vz?: number }

/** Envelope-to-envelope contacts for real parked rigs, using the same circle projection as pushOut. */
export function bodyGap(a: ContactBody, b: ContactBody): number {
  if (a.y > b.y + b.spec.height || b.y > a.y + a.spec.height) return Infinity;
  const ae = a.spec.envelope, be = b.spec.envelope;
  const af = Math.sin(a.heading), ac = Math.cos(a.heading), bf = Math.sin(b.heading), bc = Math.cos(b.heading);
  let gap = Infinity;
  for (let i = 0; i < ae.circles.length; i++) for (let j = 0; j < be.circles.length; j++) {
    const x = a.x + af * ae.circles[i] + ac * (ae.circleSides?.[i] ?? 0) - b.x - bf * be.circles[j] - bc * (be.circleSides?.[j] ?? 0);
    const z = a.z - ac * ae.circles[i] + af * (ae.circleSides?.[i] ?? 0) - b.z + bc * be.circles[j] - bf * (be.circleSides?.[j] ?? 0);
    gap = Math.min(gap, Math.hypot(x, z) - ae.radius - be.radius);
  }
  return gap;
}

export function pushOutBodies(car: Pushable & ContactBody, bodies: readonly ContactBody[]): void {
  const ae = car.spec.envelope;
  for (const b of bodies) {
    if (car.y > b.y + b.spec.height || b.y > car.y + car.spec.height) continue;
    const be = b.spec.envelope, radius = ae.radius + be.radius;
    const af = Math.sin(car.heading), ac = Math.cos(car.heading), bf = Math.sin(b.heading), bc = Math.cos(b.heading);
    if (Math.hypot(car.x - b.x, car.z - b.z) > ae.reach + be.reach + radius) continue;
    for (let i = 0; i < ae.circles.length; i++) for (let j = 0; j < be.circles.length; j++) {
      const x = car.x + af * ae.circles[i] + ac * (ae.circleSides?.[i] ?? 0) - b.x - bf * be.circles[j] - bc * (be.circleSides?.[j] ?? 0);
      const z = car.z - ac * ae.circles[i] + af * (ae.circleSides?.[i] ?? 0) - b.z + bc * be.circles[j] - bf * (be.circleSides?.[j] ?? 0);
      const d = Math.hypot(x, z); if (d >= radius) continue;
      const nx = d > 1e-8 ? x / d : 1, nz = d > 1e-8 ? z / d : 0;
      car.x += nx * (radius - d + 1e-6); car.z += nz * (radius - d + 1e-6);
      const into = car.vx * nx + car.vz * nz;
      if (into < 0) { car.onSolidImpact?.(-into); car.vx -= into * nx; car.vz -= into * nz; }
    }
  }
  car.speed = car.vx * Math.sin(car.heading) - car.vz * Math.cos(car.heading);
}

/** What the car needs to be pushed about: its place, its heading and its ground velocity. */
export interface Pushable { x: number; z: number; heading: number; vx: number; vz: number; speed: number; spec?: VehicleSpec; onSolidImpact?(speed: number): void }

/**
 * Keep the player's car out of solid rectangles. The car is three circles along its length; each is pushed out of
 * any rectangle it enters, and the car loses the part of its velocity that points into the obstacle.
 * Returns the speed of the hardest hit in metres per second (0 for none).
 */
export function pushOut(car: Pushable, solids: readonly Solid[], coupled = false, railDt?: number): number {
  const env = (car.spec ?? CAR_SPEC).envelope, radius = env.radius;
  let railContact = false, tangent = car.heading;
  let hardest = 0, far = 0;   // far: the outermost circle centre of a coupled body, found with no allocation
  if (coupled) for (let i = 0; i < env.circles.length; i++) far = Math.max(far, Math.hypot(env.circles[i], env.circleSides?.[i] ?? 0));
  for (const s of solids) {
    const reach = coupled ? Math.hypot(s.half, s.halfWidth) + far + radius : s.half + env.reach;
    if (Math.abs(s.x - car.x) > reach || Math.abs(s.z - car.z) > reach) continue;
    const ax = Math.sin(s.heading), az = -Math.cos(s.heading);   // along the rectangle
    for (let circle=0;circle<env.circles.length;circle++) {
      const off=env.circles[circle],side=env.circleSides?.[circle];
      let cx = car.x + Math.sin(car.heading) * off - s.x, cz = car.z - Math.cos(car.heading) * off - s.z;
      if(side){cx+=Math.cos(car.heading)*side;cz+=Math.sin(car.heading)*side;}
      const a = cx * ax + cz * az, b = cx * -az + cz * ax;   // along, across
      const qa = Math.max(-s.half, Math.min(s.half, a)), qb = Math.max(-s.halfWidth, Math.min(s.halfWidth, b));
      let na = a - qa, nb = b - qb, gap = Math.hypot(na, nb);
      if (gap >= radius + (railDt === undefined ? 0 : .001)) continue;
      if (gap < 1e-4) {
        // The circle's middle is inside: leave by the nearest side.
        const da = s.half - Math.abs(a), db = s.halfWidth - Math.abs(b);
        if (da < db) { na = Math.sign(a) || 1; nb = 0; gap = -da; } else { na = 0; nb = Math.sign(b) || 1; gap = -db; }
      } else { na /= gap; nb /= gap; }
      const nx = na * ax + nb * -az, nz = na * az + nb * ax, push = radius - gap;
      car.x += nx * Math.max(0, push); car.z += nz * Math.max(0, push);
      if (railDt !== undefined) {
        railContact = true;
        tangent = s.heading;
        if (Math.cos(tangent - car.heading) < 0) tangent += Math.PI;
      }
      const into = car.vx * nx + car.vz * nz;
      if (into < 0) {
        hardest = Math.max(hardest, -into);
        car.vx -= nx * into; car.vz -= nz * into;
        if (railDt === undefined) { car.vx *= 0.97; car.vz *= 0.97; } // parked paint on paint
      }
    }
  }
  if (railContact && railDt !== undefined) {
    // A rail supplies a slow contact yaw, never instantaneous tyre/driver alignment.
    // 30 degrees/second: 12 degrees takes at least 0.4 seconds, 45 takes 1.5 seconds.
    const error = Math.atan2(Math.sin(tangent - car.heading), Math.cos(tangent - car.heading));
    car.heading += Math.max(-Math.PI / 6 * railDt, Math.min(Math.PI / 6 * railDt, error));
    // Continuous contact friction acts even after the into-rail velocity has been removed.
    const friction = Math.exp(-.02 * railDt);
    car.vx *= friction; car.vz *= friction;
  }
  if (hardest > 0 || railContact) car.speed = car.vx * Math.sin(car.heading) - car.vz * Math.cos(car.heading);
  if (hardest > 0) car.onSolidImpact?.(hardest);
  return hardest;
}
