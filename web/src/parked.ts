import { CAR_SPEC, type VehicleSpec } from './vehicle-spec';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Mesher, seeded, type RGB } from './yard-kit';
import { LOT_PROP_SIZE } from './lot-props-rules';

/**
 * Parked vehicles for any lot in the game: cars, SUVs and pickups in the muted colours of a staff car park, and for a
 * house's yard also a small utility trailer, a motorhome and a ride-on mower (types 3, 4 and 5).
 * One instanced mesh per type. Every vehicle is solid: `pushOut` keeps the player's car out of them.
 * No badge, plate or lettering on any of them.
 */
export type ParkedType = 0 | 1 | 2 | 3 | 4 | 5;
export interface Parked { x: number; z: number; heading: number; type: ParkedType; colour: number }

/** A solid rectangle on the ground, in world metres: centre, half sizes, and the heading of its long axis. */
export interface Solid { x: number; z: number; half: number; halfWidth: number; heading: number }

/** Body colours, weighted toward what stands in a rural lot: white, silver, grey, black, with some blue and red. */
export const PARKED_COLOURS = [0xd9d9d4, 0xd9d9d4, 0xb4b7b9, 0xb4b7b9, 0x6f7376, 0x6f7376, 0x1b1c1e, 0x1b1c1e, 0x24364f, 0x7a1f1c, 0x4f5b4a, 0x8a8271, 0x2f3a45];
/** Length, width in metres by type: car, SUV, pickup, utility trailer (with its tongue), motorhome, ride-on mower. */
export const PARKED_SIZE: (readonly [number, number])[] = [LOT_PROP_SIZE.car, LOT_PROP_SIZE.suv, LOT_PROP_SIZE.pickup, LOT_PROP_SIZE.trailer, LOT_PROP_SIZE.motorhome, LOT_PROP_SIZE.mower];

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

const DECK: RGB = [0.42, 0.36, 0.28], STEEL: RGB = [0.2, 0.2, 0.21], STRIPE: RGB = [0.42, 0.28, 0.17], SEAT: RGB = [0.05, 0.05, 0.055], GREY: RGB = [0.3, 0.31, 0.32];

/** A small open utility trailer: a plank deck with low rails, one axle under fenders, and an A-frame tongue on a jack. */
type Place = (x: number, y: number, z: number, yaw?: number, pitch?: number, roll?: number) => void;

function trailerShape(m: Mesher, place: Place, body: RGB): void {
  const w = PARKED_SIZE[3][1] / 2 - 0.12, x0 = -1.8, x1 = 0.75, mid = (x0 + x1) / 2, len = x1 - x0;
  place(0, 0, 0);
  m.box(mid, 0.5, 0, len, 0.12, w * 2, body);                     // frame
  m.box(mid, 0.575, 0, len - 0.06, 0.04, w * 2 - 0.06, DECK);       // planks
  for (const s of [-1, 1]) {
    m.box(mid, 0.84, s * (w - 0.03), len, 0.05, 0.05, body);        // top rail
    for (let x = x0 + 0.03; x <= x1; x += len / 4 - 0.01) m.box(x, 0.71, s * (w - 0.03), 0.04, 0.26, 0.04, body);
    m.box(-0.45, 0.66, s * (w + 0.06), 0.9, 0.04, 0.2, body);       // fender
    m.box(-0.45, 0.5, s * (w + 0.06), 0.06, 0.3, 0.2, body);
  }
  m.box(x0 + 0.02, 0.71, 0, 0.04, 0.26, w * 2 - 0.06, body);        // tailgate
  for (const s of [-1, 1]) {
    // The tongue: two bars from the front corners to the hitch.
    const dx = 1.8 - x1, dz = -s * (w - 0.1), l = Math.hypot(dx, dz);
    place(x1 + dx / 2, 0.46, s * (w - 0.1) + dz / 2, Math.atan2(-dz, dx));
    m.box(0, 0, 0, l, 0.08, 0.07, body);
  }
  place(0, 0, 0);
  m.box(1.72, 0.46, 0, 0.18, 0.1, 0.12, STEEL);                     // coupler
  m.cyl(1.35, 0.27, 0, 0.035, 0.42, STEEL, 'y', 6);                 // jack, resting on the ground
  m.box(1.35, 0.03, 0, 0.16, 0.04, 0.16, STEEL);
  for (const s of [-1, 1]) { place(-0.45, 0.3, s * (w + 0.06)); m.cyl(0, 0, 0, 0.3, 0.18, TYRE, 'z', 8); }
}

/** A class C motorhome: a van cab with a bunk over it and a tall box behind, with a plain stripe and no lettering. */
function motorhomeShape(m: Mesher, place: Place, body: RGB, glass: RGB | null): void {
  const w = PARKED_SIZE[4][1] / 2, cab = w - 0.15;
  place(0, 0, 0);
  m.extrude([[-3.7, 0.5], [1.7, 0.5], [1.7, 3.2], [-3.6, 3.2], [-3.7, 3.05]], -w, w, body);       // the coach
  m.extrude([[1.7, 0.5], [3.7, 0.5], [3.7, 1.05], [3.5, 1.35], [2.75, 1.5], [2.3, 2.25], [1.7, 2.3]], -cab, cab, body);   // the van cab
  m.extrude([[1.7, 2.3], [2.85, 2.4], [3.05, 2.75], [2.85, 3.05], [1.7, 3.15]], -w + 0.05, w - 0.05, body);              // the bunk over it
  for (const s of [-1, 1]) {
    m.box(-1.0, 1.35, s * (w + 0.01), 5.4, 0.2, 0.02, STRIPE);
    m.box(-1.0, 2.75, s * (w + 0.01), 5.4, 0.08, 0.02, STRIPE);
    if (glass) {
      m.box(2.05, 1.85, s * (cab + 0.012), 0.55, 0.5, 0.02, glass);                            // cab door glass
      for (const x of [-2.6, -0.4]) m.box(x, 2.15, s * (w + 0.012), 1.1, 0.55, 0.02, glass);   // coach windows
    }
  }
  if (glass) {
    // The windscreen, on the cab's slope.
    const lift = 0.014, zz = cab - 0.08;
    m.quad([[2.75 + lift, 1.52, zz], [2.75 + lift, 1.52, -zz], [2.3 + lift, 2.22, -zz], [2.3 + lift, 2.22, zz]], glass);
    m.box(-3.71, 2.3, 0, 0.02, 0.5, 1.2, glass);                                                   // rear window
  }
  m.box(1.0, 1.4, -w - 0.012, 0.6, 1.7, 0.02, [body[0] * 0.82, body[1] * 0.82, body[2] * 0.82]);   // the coach door, plain
  for (const s of [-1, 1]) {
    m.box(3.712, 0.95, s * (cab - 0.3), 0.03, 0.14, 0.36, LAMP);
    m.box(-3.712, 0.95, s * (w - 0.2), 0.03, 0.3, 0.2, TAIL);
  }
  m.box(0, 0.58, 0, 7.42, 0.16, w * 2 + 0.02, TRIM);
  for (const ax of [2.35, -1.75]) for (const s of [-1, 1]) { place(ax, 0.4, s * (w - 0.2)); m.cyl(0, 0, 0, 0.4, 0.28, TYRE, 'z', 8); }
}

/** A ride-on mower: a hood, a black seat, a wheel to steer by, a grey cutting deck under it and big back wheels. */
function mowerShape(m: Mesher, place: Place, body: RGB): void {
  place(0, 0, 0);
  m.extrude([[0.05, 0.35], [0.9, 0.35], [0.9, 0.58], [0.72, 0.74], [0.05, 0.76]], -0.27, 0.27, body);   // hood
  m.box(-0.45, 0.5, 0, 0.8, 0.12, 0.84, body);                     // the body and footrests
  m.box(-0.48, 0.7, 0, 0.5, 0.28, 0.46, body);                     // under the seat
  m.box(-0.5, 0.88, 0, 0.42, 0.08, 0.44, SEAT);
  m.box(-0.72, 1.06, 0, 0.08, 0.36, 0.42, SEAT);                   // seat back
  place(0.1, 0.72, 0, 0, 0, 0.3); m.cyl(0, 0.15, 0, 0.025, 0.3, STEEL, 'y', 5);   // steering column, leaning back
  place(0, 0, 0);
  m.cyl(0.02, 1.0, 0, 0.17, 0.03, SEAT, 'y', 10);                  // steering wheel
  m.box(0.1, 0.2, 0, 0.95, 0.1, 1.08, GREY);                       // cutting deck
  for (const s of [-1, 1]) {
    place(-0.52, 0.3, s * 0.42); m.cyl(0, 0, 0, 0.3, 0.2, TYRE, 'z', 8);
    place(0.66, 0.18, s * 0.33); m.cyl(0, 0, 0, 0.18, 0.12, TYRE, 'z', 8);
  }
}

/** Any parked type as triangles: local +x is the nose, y is up. The paint is white so an instance colour can tint it. */
export function parkedShape(m: Mesher, type: ParkedType, frame: THREE.Matrix4 | null = null, body: RGB = WHITE, glass: RGB | null = GLASS): void {
  if (type <= 2) { vehicleShape(m, type as 0 | 1 | 2, frame, body, glass); return; }
  const place: Place = (x, y, z, yaw = 0, pitch = 0, roll = 0) => { if (frame) m.within(frame, x, y, z, yaw, pitch, roll); else m.at(x, y, z, yaw, pitch, roll); };
  if (type === 3) trailerShape(m, place, body);
  else if (type === 4) motorhomeShape(m, place, body, glass);
  else mowerShape(m, place, body);
}

/** The solid a parked vehicle stands in. */
export function parkedSolid(p: Parked): Solid {
  return { x: p.x, z: p.z, half: PARKED_SIZE[p.type][0] / 2, halfWidth: PARKED_SIZE[p.type][1] / 2, heading: p.heading };
}

/** The height under a point near parked vehicle `p`, or null while that ground has not loaded. */
export type ParkedGround = (x: number, z: number, p: Parked) => number | null;

/** Pose `o` so one parked vehicle stands on the ground (its matrix updated). False while that ground has not loaded. */
export function parkedMatrix<P extends { x: number; z: number; heading: number } = Parked>(p: P, ground: (x: number, z: number, p: P) => number | null, o: THREE.Object3D): boolean {
  const fx = Math.sin(p.heading), fz = -Math.cos(p.heading);
  const y = ground(p.x, p.z, p), nose = ground(p.x + fx * 1.4, p.z + fz * 1.4, p), tail = ground(p.x - fx * 1.4, p.z - fz * 1.4, p);
  if (y === null || nose === null || tail === null) return false;
  o.position.set(p.x, y, p.z);
  o.rotation.set(0, Math.PI / 2 - p.heading, Math.atan2(nose - tail, 2.8), 'YXZ');   // local +x is the nose
  o.updateMatrix();
  return true;
}

/**
 * Parked vehicles that never move, baked into one plain geometry in world coordinates (each body colour multiplied in,
 * as an instance colour would be): drawn with a vertex-coloured material, they join one mesh with other static parts
 * instead of one instanced draw per type. Null for an empty list; throws while some ground is still missing.
 */
export function bakeParked(list: Parked[], ground: ParkedGround): THREE.BufferGeometry | null {
  if (!list.length) return null;
  const shapes = new Map<number, THREE.BufferGeometry>(), parts: THREE.BufferGeometry[] = [], o = new THREE.Object3D();
  for (const p of list) {
    let shape = shapes.get(p.type);
    if (!shape) { const m = new Mesher(); parkedShape(m, p.type); shape = m.geometry(); shapes.set(p.type, shape); }
    if (!parkedMatrix(p, ground, o)) throw new Error('bakeParked: the ground under a parked vehicle has not loaded');
    const g = shape.clone().applyMatrix4(o.matrix), col = g.attributes.color, c = new THREE.Color(p.colour);
    for (let i = 0; i < col.count; i++) col.setXYZ(i, col.getX(i) * c.r, col.getY(i) * c.g, col.getZ(i) * c.b);
    parts.push(g);
  }
  const merged = mergeGeometries(parts);
  for (const g of [...parts, ...shapes.values()]) g.dispose();
  if (!merged) throw new Error('bakeParked: geometry could not be merged');
  return merged;
}

export class ParkedVehicles {
  readonly group = new THREE.Group();
  readonly solids: Solid[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private dummy = new THREE.Object3D();

  /** `ground` gives the height under a point near a vehicle, or null while that ground has not loaded. */
  /** `material` lets several sets share one (it must be vertex-coloured); by default each set makes its own. */
  constructor(readonly list: Parked[], private ground: ParkedGround, material: THREE.Material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })) {
    // The three cars always (as before); a yard type only when the list has one.
    for (const type of [0, 1, 2, ...([3, 4, 5] as const).filter((t) => list.some((p) => p.type === t))] as ParkedType[]) {
      const mine = list.filter((p) => p.type === type);
      const m = new Mesher();
      parkedShape(m, type);
      const mesh = new THREE.InstancedMesh(m.geometry(), material, Math.max(1, mine.length));
      mesh.count = mine.length;
      mine.forEach((p, i) => mesh.setColorAt(i, new THREE.Color(p.colour)));
      mesh.frustumCulled = false;   // instances are spread over a lot; the lot itself is shown or hidden as a whole
      mesh.userData.list = mine;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    for (const p of list) this.solids.push(parkedSolid(p));
    this.group.visible = false;
  }

  /** Stand every vehicle on the ground. Returns false while some ground is still missing; call again later. */
  seat(): boolean {
    for (const mesh of this.meshes) {
      const mine = mesh.userData.list as Parked[];
      for (let i = 0; i < mine.length; i++) {
        if (!parkedMatrix(mine[i], this.ground, this.dummy)) return false;
        mesh.setMatrixAt(i, this.dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.group.visible = true;
    return true;
  }
}

/** One of many things stood about an area: where it stands, which way its nose points, and its paint. */
export interface Placed { x: number; z: number; heading: number; colour: number }
/**
 * One kind of thing to draw many times. `range`: metres from the camera it is drawn within. `radius`: of a sphere
 * round one, centred `lift` metres over its ground point, for the view test (half its height, so a tall roof is in it). `pose` stands one on the ground (o's matrix updated): true when done, false while its
 * ground has not loaded, null when it can never stand there (it is dropped). `level` is the detail of the ground under
 * one (higher is finer): an item is posed again when finer ground comes.
 */
export interface NearKind<T extends Placed> {
  geometry: THREE.BufferGeometry; items: T[]; range: number; radius: number; lift: number; name?: string;
  pose(item: T, o: THREE.Object3D): boolean | null; level(item: T): number;
  /** False while an item is out of sight for its own reasons (a dog that has slipped away). */
  shown?(item: T, index: number): boolean;
}

const NEAR_CELL = 128;
const nearKey = (i: number, j: number) => (i + 0x8000) * 0x10000 + (j + 0x8000);
/**
 * Things spread over a whole area but drawn only near the camera: one instanced mesh per kind, however many there are.
 * Every frame each mesh holds just the items within its range and inside the view, so a kind costs one draw call while
 * any of it is on screen (none otherwise), and its triangles follow what is in view, not what the area holds.
 */
export class NearInstances<T extends Placed> {
  readonly group = new THREE.Group();
  readonly meshes: THREE.InstancedMesh[] = [];
  /** Items dropped because they can never stand where they are (see NearKind.pose). */
  readonly dropped = new Set<T>();
  private sets: { kind: NearKind<T>; mesh: THREE.InstancedMesh; cells: Map<number, number[]>; matrices: Float32Array; posed: Int8Array; y: Float32Array }[] = [];
  private frustum = new THREE.Frustum(); private view = new THREE.Matrix4(); private sphere = new THREE.Sphere();
  private dummy = new THREE.Object3D(); private colour = new THREE.Color();
  private frame = 0;

  constructor(kinds: NearKind<T>[], material: THREE.Material) {
    for (const kind of kinds) {
      const mesh = new THREE.InstancedMesh(kind.geometry, material, Math.max(1, kind.items.length));
      mesh.count = 0; mesh.visible = false; mesh.name = kind.name ?? '';
      mesh.frustumCulled = false;   // each instance is tested against the view here
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, this.colour.setHex(0xffffff));
      const cells = new Map<number, number[]>();
      kind.items.forEach((p, i) => { const key = nearKey(Math.floor(p.x / NEAR_CELL), Math.floor(p.z / NEAR_CELL)); const l = cells.get(key); if (l) l.push(i); else cells.set(key, [i]); });
      this.sets.push({ kind, mesh, cells, matrices: new Float32Array(kind.items.length * 16), posed: new Int8Array(kind.items.length).fill(-1), y: new Float32Array(kind.items.length) });
      this.meshes.push(mesh); this.group.add(mesh);
    }
  }

  /** Fill every mesh with the items near `camera` and in its view. `scale` shortens every range (1: as given). */
  update(camera: THREE.Camera, scale = 1): void {
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const cx = camera.matrixWorld.elements[12], cz = camera.matrixWorld.elements[14];
    // Finer ground is looked for every 15th frame: a cheap lookup, but not one to make for every item every frame.
    const recheck = this.frame++ % 15 === 0;
    for (const set of this.sets) {
      const { kind, mesh, cells, matrices, posed, y } = set, range = kind.range * scale;
      let n = 0;
      for (let i = Math.floor((cx - range) / NEAR_CELL); i <= Math.floor((cx + range) / NEAR_CELL); i++) for (let j = Math.floor((cz - range) / NEAR_CELL); j <= Math.floor((cz + range) / NEAR_CELL); j++) {
        const list = cells.get(nearKey(i, j));
        if (list) for (const k of list) {
          const p = kind.items[k];
          if (posed[k] === -2 || (p.x - cx) ** 2 + (p.z - cz) ** 2 > range * range) continue;
          if (posed[k] === -1 || (recheck && kind.level(p) > posed[k])) {
            const level = kind.level(p), done = kind.pose(p, this.dummy);
            if (done === null) { posed[k] = -2; this.dropped.add(p); continue; }
            if (done) { this.dummy.matrix.toArray(matrices, k * 16); y[k] = this.dummy.position.y; posed[k] = Math.max(0, level); }
          }
          if (posed[k] < 0 || (kind.shown && !kind.shown(p, k))) continue;
          if (!this.frustum.intersectsSphere(this.sphere.set(this.dummy.position.set(p.x, y[k] + kind.lift, p.z), kind.radius))) continue;
          const to = mesh.instanceMatrix.array as Float32Array;
          for (let e = 0; e < 16; e++) to[n * 16 + e] = matrices[k * 16 + e];
          mesh.setColorAt(n, this.colour.setHex(p.colour));
          n++;
        }
      }
      mesh.count = n; mesh.visible = n > 0;
      if (n) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    }
  }

  /** Items drawn this frame, by kind. */
  /** Leave one item out for good (as a dropped one): it is never posed or drawn again. */
  remove(item: T): void {
    for (const set of this.sets) { const k = set.kind.items.indexOf(item); if (k >= 0) { set.posed[k] = -2; this.dropped.add(item); return; } }
  }
  get counts(): number[] { return this.sets.map((s) => s.mesh.count); }
  dispose(): void { for (const s of this.sets) s.mesh.dispose(); }
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
export interface Pushable { x: number; z: number; y?: number; heading: number; vx: number; vz: number; speed: number; spec?: VehicleSpec; onSolidImpact?(speed: number): void }

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
