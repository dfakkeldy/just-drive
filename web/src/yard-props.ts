import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { pushOut, type Solid } from './parked';
import type { Terrain } from './terrain';
import type { Vehicle } from './vehicle';
import { CAR_SPEC } from './vehicle-spec';
import { type CarShape, SIZE, SECTION, isDry, boxDistance, breaks, isField, launch, laundryDay, outToday, rollBale, stepPiece, touches, SLOW,
  type Piece, type YardProp } from './yard-props-rules';

/**
 * Breakable yard and field props, drawn as three instanced meshes (boxes, cylinders and picket panels) for the props
 * near the camera. The layout is invented by yard-props-rules.ts; this file builds the parts, breaks them on a hit,
 * moves the pieces by script and puts everything back at the start of each shift.
 */
type Shape = 0 | 1 | 2;   // box, cylinder (axis up), picket panel (1 m long, 1 m high, pickets along x)
interface Part { shape: Shape; x: number; y: number; z: number; sx: number; sy: number; sz: number; rx: number; rz: number; colour: number; spin?: boolean }
interface Live {
  p: YardProp; parts: Part[] | null; broken: boolean; pieces: (Piece & { q: THREE.Quaternion; part: Part })[] | null;
  /** Ground at the centre and the pitch along the prop, once the fine ground is in (null before). */
  /** Ground height and the terrain detail level it was read at (refined as finer ground loads, as the mailboxes are). */
  y: number | null; level: number; pitch: number;
  /** Its fine ground is water, a brook or the shore (yard-props-rules.ts isDry): never drawn or hit. */
  wet: boolean;
  /** Bales: 1 open field, 0 not, -1 not known yet. */
  field: number;
  moving: boolean; slots: [number, number, number];
}
/** How many props the meshes hold and how far they reach: desktop, then phones and LOW detail. */
export interface YardLimit { readonly range: number; readonly props: number; readonly instances: readonly [number, number, number] }
export const YARD_LIMITS: Readonly<{ desktop: YardLimit; low: YardLimit }> = Object.freeze({
  desktop: { range: 240, props: 300, instances: [1800, 900, 160] },
  low: { range: 130, props: 110, instances: [650, 330, 60] },
});
const CELL = 64;
const WOOD = [0x8d8577, 0x7a6248, 0x6f6658], WHITE = 0xe9e7df;
const LAUNDRY = [0xf2f2ee, 0x9db4cf, 0xc9574b, 0xe2c96a, 0x6d8f6a, 0xd9a3b5];
const BUOY = [0xd8402f, 0xf1efe6, 0xe9b23b, 0x2f6fb5, 0x4f9a52];
const TRAP = [0x56704a, 0xb99a3a, 0x3f5f80];

export class YardProps {
  readonly group = new THREE.Group();
  readonly live: Live[];
  /** Props drawn now, nearest first. */
  readonly active: Live[] = [];
  /** A break: the prop, the hit speed, and true when a rolling bale did it (not the car). */
  onBreak: ((p: YardProp, speed: number, byBale: boolean) => void) | null = null;
  /** A car hit hard enough to break: the impact speed, for the repair rules. */
  onImpact: ((speed: number) => void) | null = null;
  day = 1;
  broken = 0;
  private readonly meshes: THREE.InstancedMesh[];
  private readonly limits: YardLimit;
  private readonly cells = new Map<number, Live[]>();
  private readonly near: Live[] = [];
  private refresh = 0;
  private time = 0;
  private dirty = true;
  private readonly m = new THREE.Matrix4();
  private readonly n = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly solid: Solid = { x: 0, z: 0, half: 0, halfWidth: 0, heading: 0 };
  private readonly solids = [this.solid];
  private readonly cam = new THREE.Vector3();
  private readonly car: CarShape = { x: 0, z: 0, heading: 0, radius: 0, circles: [], sides: undefined };
  private readonly slot = [0, 0, 0];
  private readonly need = [0, 0, 0];
  private readonly used = [0, 0, 0];
  /** Which of the three meshes a frame's writes touched (bit per shape). */
  private touched = 0;

  constructor(list: readonly YardProp[], private readonly terrain: Terrain, low: boolean) {
    this.limits = low ? YARD_LIMITS.low : YARD_LIMITS.desktop;
    this.live = list.map(p => ({ p, parts: null, broken: false, pieces: null, y: null, level: 0, pitch: 0, wet: false, field: p.field ? -1 : 1, moving: false, slots: [0, 0, 0] }));
    for (const l of this.live) {
      const k = Math.floor(l.p.x / CELL) * 65536 + Math.floor(l.p.z / CELL), cell = this.cells.get(k);
      if (cell) cell.push(l); else this.cells.set(k, [l]);
    }
    // A picket panel one metre long (scaled to the section): fourteen plain pickets, a little over half the width wood.
    const pickets: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 14; i++) pickets.push(new THREE.BoxGeometry(.6 / 14, i % 2 ? .96 : 1, 1).translate(-.5 + (i + .5) / 14, i % 2 ? -.02 : 0, 0));
    const geometries = [new THREE.BoxGeometry(1, 1, 1), new THREE.CylinderGeometry(.5, .5, 1, low ? 7 : 10), mergeGeometries(pickets)];
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.meshes = geometries.map((g, i) => {
      const mesh = new THREE.InstancedMesh(g, material, this.limits.instances[i]);
      mesh.name = ['Yard props: boxes', 'Yard props: rounds', 'Yard props: pickets'][i];
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, this.c.set(0xffffff));
      mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false;
      return mesh;
    });
    this.group.name = 'Yard and field props'; this.group.add(...this.meshes);
  }

  /** A new shift: everything stands again; bins and laundry follow the day. */
  reset(day: number): void {
    this.day = day; this.broken = 0;
    for (const l of this.live) { l.broken = false; l.pieces = null; l.parts = null; l.moving = false; }
    this.refresh = 0; this.dirty = true;
  }

  /** Physics step (1/120 s): car contacts, then rolling bales against other props. */
  step(dt: number, vehicle: Vehicle, live: boolean): void {
    if (!live || dt <= 0) return;
    const spec = vehicle.spec ?? CAR_SPEC, env = spec.envelope, horse = spec.locomotion === 'horse';
    const car = this.car;
    car.x = vehicle.x; car.z = vehicle.z; car.heading = vehicle.heading; car.radius = env.radius; car.circles = env.circles; car.sides = env.circleSides;
    const speed = Math.hypot(vehicle.vx, vehicle.vz), r = env.reach + 4;
    for (const l of this.active) {
      if (l.broken || l.y === null || Math.abs(l.p.x - vehicle.x) > r + 3 || Math.abs(l.p.z - vehicle.z) > r + 3) continue;
      const k = l.p.kind;
      // A jump clears it; a hit at its height does not.
      if ((vehicle.y ?? l.y) - l.y > SIZE[k].height + .3) continue;
      if (!touches(car, l.p, k)) continue;
      if (!horse && breaks(k, speed)) {
        this.breakProp(l, speed, vehicle.vx, vehicle.vz, false);
        const f = SLOW[k]; vehicle.vx *= f; vehicle.vz *= f; vehicle.speed *= f;
        this.onImpact?.(speed);
      } else {
        const s = this.solid; s.x = l.p.x; s.z = l.p.z; s.heading = l.p.yaw; s.half = SIZE[k].half; s.halfWidth = SIZE[k].halfWidth;
        pushOut(vehicle, this.solids);
      }
    }
  }

  private breakProp(l: Live, speed: number, vx: number, vz: number, byBale: boolean): void {
    if (l.broken || l.y === null) return;
    const parts = this.partsOf(l);
    l.broken = true; l.moving = true; this.broken++;
    this.propMatrix(l);
    l.pieces = parts.map((part, i) => {
      this.partMatrix(part, 0);
      const world = this.n.multiplyMatrices(this.m, this.partLocal), q = new THREE.Quaternion();
      world.decompose(this.v, q, this.s);
      const piece = { x: this.v.x, y: this.v.y, z: this.v.z, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0,
        floor: Math.min(part.sx, part.sy, part.sz) / 2, rolling: false, resting: false, age: 0, q, part };
      if (l.p.kind === 'bale') { piece.floor = part.sx / 2; piece.ry = l.p.yaw + Math.PI / 2; }
      launch(piece, l.p.kind, i, parts.length, speed, vx, vz, l.p.id);
      return piece;
    });
    this.dirty = true;
    this.onBreak?.(l.p, speed, byBale);
  }

  /** Draw-side work: the near set every 0.3 s, moving pieces and whirligigs every frame. */
  update(camera: THREE.Camera, dt: number): void {
    this.time += dt;
    this.refresh -= dt;
    if (this.refresh <= 0) { this.refresh = .3; this.pick(camera.getWorldPosition(this.cam)); }
    let moved = false;
    for (const l of this.active) {
      if (!l.pieces || !l.moving) continue;
      let still = true;
      for (const piece of l.pieces) {
        if (piece.resting) continue;
        const ground = this.terrain.heightAt(piece.x, piece.z) ?? piece.y - piece.floor;
        if (piece.rolling) {
          const gx = ((this.terrain.heightAt(piece.x + 1, piece.z) ?? ground) - (this.terrain.heightAt(piece.x - 1, piece.z) ?? ground)) / 2;
          const gz = ((this.terrain.heightAt(piece.x, piece.z + 1) ?? ground) - (this.terrain.heightAt(piece.x, piece.z - 1) ?? ground)) / 2;
          rollBale(piece, dt, ground, gx, gz);
          if (Math.hypot(piece.vx, piece.vz) > 1) this.strike(l, piece);
        } else stepPiece(piece, dt, ground);
        if (!piece.resting) still = false;
      }
      l.moving = !still; moved = true;
      this.write(l);
    }
    if (this.dirty) { this.dirty = false; this.drawAll(); }
    else {
      for (const l of this.active) if (!l.broken && l.p.kind === 'whirligig') { this.write(l); moved = true; }
      // Only the meshes written this frame go back to the GPU.
      if (moved) this.meshes.forEach((mesh, i) => { if (this.touched & 1 << i) mesh.instanceMatrix.needsUpdate = true; });
    }
    this.touched = 0;
  }

  /** A rolling bale breaks what it reaches: another bale rolls on, a fence or a bin comes apart. */
  private strike(bale: Live, piece: Piece): void {
    const speed = Math.hypot(piece.vx, piece.vz);
    for (const l of this.active) {
      if (l === bale || l.broken || l.y === null || Math.abs(l.p.x - piece.x) > 4 || Math.abs(l.p.z - piece.z) > 4) continue;
      const { half, halfWidth } = SIZE[l.p.kind];
      if (boxDistance(piece.x, piece.z, l.p.x, l.p.z, l.p.yaw, half, halfWidth) >= piece.floor) continue;
      this.breakProp(l, speed, piece.vx, piece.vz, true);
      // The bale loses some of its way in the hit.
      piece.vx *= .7; piece.vz *= .7;
    }
  }

  private pick(cam: THREE.Vector3): void {
    const { range, props } = this.limits, near = this.near; near.length = 0;
    for (let cx = Math.floor((cam.x - range) / CELL); cx <= Math.floor((cam.x + range) / CELL); cx++)
      for (let cz = Math.floor((cam.z - range) / CELL); cz <= Math.floor((cam.z + range) / CELL); cz++)
        for (const l of this.cells.get(cx * 65536 + cz) ?? []) {
          if (!outToday(l.p, this.day) || (l.p.x - cam.x) ** 2 + (l.p.z - cam.z) ** 2 > range * range) continue;
          if (!l.broken) this.ground(l);
          if (l.y === null || l.wet) continue;
          if (l.field < 0) l.field = this.fieldAt(l);
          if (l.field === 0 || l.field < 0) continue;
          near.push(l);
        }
    near.sort((a, b) => (a.p.x - cam.x) ** 2 + (a.p.z - cam.z) ** 2 - ((b.p.x - cam.x) ** 2 + (b.p.z - cam.z) ** 2));
    const used = this.used, need = this.need, next: Live[] = [];
    used.fill(0);
    for (const l of near) {
      if (next.length >= props) break;
      need.fill(0);
      for (const part of this.partsOf(l)) need[part.shape]++;
      if (need.some((n, i) => used[i] + n > this.limits.instances[i])) continue;
      if (l.slots[0] !== used[0] || l.slots[1] !== used[1] || l.slots[2] !== used[2]) { l.slots[0] = used[0]; l.slots[1] = used[1]; l.slots[2] = used[2]; this.dirty = true; }
      for (let i = 0; i < 3; i++) used[i] += need[i];
      next.push(l);
    }
    const same = next.length === this.active.length && next.every((l, i) => l === this.active[i]);
    if (same) return;
    this.active.length = 0; this.active.push(...next);
    this.dirty = true;
  }

  /** The fine ground under a prop, and its pitch along its length; read again when finer ground has loaded.
   *  False while no fine ground has loaded or nothing finer has come since the last read. */
  private ground(l: Live): boolean {
    const s = this.terrain.surfaceAt(l.p.x, l.p.z);
    if (!s || s.level < 6 || s.level <= l.level) return false;
    const y = this.terrain.heightAt(l.p.x, l.p.z), h = SIZE[l.p.kind].half;
    const ax = Math.sin(l.p.yaw) * h, az = -Math.cos(l.p.yaw) * h;
    const a = this.terrain.heightAt(l.p.x + ax, l.p.z + az), b = this.terrain.heightAt(l.p.x - ax, l.p.z - az);
    if (y === null || a === null || b === null) return false;
    l.wet = !isDry({ water: s.water, brook: s.brook, height: y, seaLevel: this.terrain.seaLevel });
    l.y = y; l.level = s.level; l.pitch = l.p.kind === 'bale' || l.p.kind === 'well' ? 0 : Math.atan2(a - b, 2 * h);
    this.dirty = true;
    return true;
  }
  private fieldAt(l: Live): number {
    const s = this.terrain.surfaceAt(l.p.x, l.p.z);
    if (!s || s.level < 6) return -1;
    const h = (dx: number, dz: number) => this.terrain.heightAt(l.p.x + dx, l.p.z + dz);
    const e = h(3, 0), w = h(-3, 0), n = h(0, -3), so = h(0, 3);
    if (e === null || w === null || n === null || so === null) return -1;
    const slope = Math.hypot(e - w, so - n) / 6;
    return isField({ canopy: s.canopy, roadDist: s.roadDist, halfWidth: s.halfWidth, water: s.water, mineral: s.mineral, brook: s.brook, slope }) ? 1 : 0;
  }

  private drawAll(): void {
    const counts = [0, 0, 0];
    for (const l of this.active) {
      this.write(l, true);
      for (const part of this.partsOf(l)) counts[part.shape]++;
    }
    this.meshes.forEach((mesh, i) => {
      mesh.count = counts[i]; mesh.visible = counts[i] > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.boundingSphere = null;
    });
  }

  /** One prop's instances: whole, or as its pieces. */
  private write(l: Live, colours = false): void {
    const parts = this.partsOf(l), slot = this.slot;
    slot[0] = l.slots[0]; slot[1] = l.slots[1]; slot[2] = l.slots[2];
    if (!l.broken) this.propMatrix(l);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i], mesh = this.meshes[part.shape], at = slot[part.shape]++;
      this.touched |= 1 << part.shape;
      if (l.pieces) {
        const piece = l.pieces[i];
        if (l.p.kind === 'bale') {
          // Axle across the travel, turned about the axle as far as it has rolled.
          this.m.makeRotationY(Math.PI / 2 - piece.ry).multiply(this.n.makeRotationZ(piece.rz)).multiply(this.n.makeRotationX(Math.PI / 2));
          this.m.scale(this.s.set(part.sx, part.sy, part.sz)).setPosition(piece.x, piece.y, piece.z);
          mesh.setMatrixAt(at, this.m);
        } else {
          this.q.setFromEuler(this.e.set(piece.rx, piece.ry, piece.rz)).multiply(piece.q);
          mesh.setMatrixAt(at, this.n.compose(this.v.set(piece.x, piece.y, piece.z), this.q, this.s.set(part.sx, part.sy, part.sz)));
        }
      } else {
        this.partMatrix(part, part.spin ? this.time * 7 + l.p.look * 6 : 0);
        mesh.setMatrixAt(at, this.n.multiplyMatrices(this.m, this.partLocal));
      }
      if (colours) mesh.setColorAt(at, this.c.set(part.colour));
    }
  }

  private readonly partLocal = new THREE.Matrix4();
  /** The prop's own frame: local x along its length, y up, z across; pitched to follow the ground along it. */
  private propMatrix(l: Live): void {
    this.m.makeRotationY(Math.PI / 2 - l.p.yaw).multiply(this.n.makeRotationZ(l.pitch)).setPosition(l.p.x, l.y!, l.p.z);
  }
  private partMatrix(part: Part, spin: number): void {
    this.e.set(part.rx + spin, 0, part.rz);
    this.partLocal.compose(this.v.set(part.x, part.y, part.z), this.q.setFromEuler(this.e), this.s.set(part.sx, part.sy, part.sz));
  }

  /** The parts of one prop, in its own frame (metres, y from the ground up). Every part is also one loose piece. */
  private partsOf(l: Live): Part[] {
    if (l.parts) return l.parts;
    const p = l.p, out: Part[] = [], look = p.look;
    const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, colour: number, rx = 0, rz = 0, spin = false) =>
      out.push({ shape: 0, x, y, z, sx, sy, sz, rx, rz, colour, spin });
    const round = (x: number, y: number, z: number, d: number, h: number, colour: number, rx = 0, rz = 0) =>
      out.push({ shape: 1, x, y, z, sx: d, sy: h, sz: d, rx, rz, colour });
    switch (p.kind) {
      case 'railFence': {
        const L = SECTION.railFence, wood = WOOD[Math.floor(look * WOOD.length)];
        box(-L / 2, .55, 0, .13, 1.1, .13, wood);
        box(0, .45, 0, L + .1, .09, .05, wood); box(0, .85, 0, L + .1, .09, .05, wood);
        if (p.end) box(L / 2, .55, 0, .13, 1.1, .13, wood);
        break;
      }
      case 'picketFence': {
        const L = SECTION.picketFence;
        box(-L / 2, .5, 0, .1, 1.0, .1, WHITE);
        box(0, .28, -.04, L, .07, .035, WHITE); box(0, .72, -.04, L, .07, .035, WHITE);
        out.push({ shape: 2, x: 0, y: .5, z: .01, sx: L - .1, sy: .95, sz: .025, rx: 0, rz: 0, colour: WHITE });
        if (p.end) box(L / 2, .5, 0, .1, 1.0, .1, WHITE);
        break;
      }
      case 'clothesline': {
        const pole = look < .5 ? 0x9a9a92 : 0x6f5a41;
        for (const x of [-3, 3]) { box(x, 1.0, 0, .08, 2.0, .08, pole); box(x, 1.97, 0, .08, .06, .75, pole); }
        box(0, 1.94, -.3, 6, .015, .015, 0xd8d8d0); box(0, 1.94, .3, 6, .015, .015, 0xd8d8d0);
        if (laundryDay(this.day, p.owner)) for (let i = 0; i < 5; i++) {
          const sheet = (i + Math.floor(look * 7)) % 3 === 0, w = sheet ? 1.1 : .55, h = sheet ? .9 : .6;
          box(-2.2 + i * 1.1, 1.93 - h / 2, i % 2 ? .3 : -.3, w, h, .02, LAUNDRY[(i + Math.floor(look * 11)) % LAUNDRY.length]);
        }
        break;
      }
      case 'whirligig': {
        const body = look < .5 ? 0xb5432f : 0x2f6fb5;
        box(0, .62, 0, .06, 1.24, .06, 0x6f5a41);
        box(0, 1.3, 0, .55, .14, .12, body); box(-.24, 1.42, 0, .14, .22, .03, body);
        box(.3, 1.3, 0, .02, .7, .07, 0xe8e2d0, 0, 0, true); box(.3, 1.3, 0, .02, .07, .7, 0xe8e2d0, 0, 0, true);
        break;
      }
      case 'buoys': {
        box(-.55, .62, 0, .1, 1.24, .1, 0x7a6a55); box(.55, .62, 0, .1, 1.24, .1, 0x7a6a55);
        box(0, 1.2, 0, 1.3, .08, .08, 0x7a6a55);
        for (let i = 0; i < 3; i++) round(-.38 + i * .38, .82, 0, .28, .5, BUOY[(i + Math.floor(look * 5)) % BUOY.length]);
        break;
      }
      case 'traps': {
        const c = TRAP[Math.floor(look * TRAP.length)];
        box(-.5, .23, 0, .95, .45, .6, c); box(.5, .23, 0, .95, .45, .6, c);
        box(-.25, .69, 0, .95, .45, .6, c); if (look > .4) box(.0, 1.0, .02, .9, .02, .02, 0xd9cfa8);
        break;
      }
      case 'well': {
        round(0, .35, 0, 1.4, .7, 0x8e8a80);
        box(-.62, 1.05, 0, .08, 1.4, .08, 0x6b5236); box(.62, 1.05, 0, .08, 1.4, .08, 0x6b5236);
        box(0, 1.82, -.27, 1.6, .04, .62, 0x5d4a3a, .65); box(0, 1.82, .27, 1.6, .04, .62, 0x5d4a3a, -.65);
        box(0, 1.25, 0, 1.25, .05, .05, 0x6b5236);
        break;
      }
      case 'woodpile': {
        const bark = look < .5 ? 0x8a6a45 : 0x7c6347;
        // Split wood stacked across the pile: rounds lying with their ends out, four rows high, tapering.
        for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - row; i++)
          round(-.9 + row * .3 + i * .6, .17 + row * .3, 0, .32, .5, i % 2 ? bark : 0xa98559, Math.PI / 2);
        round(-.3, 1.0 - .07, 0, .3, .5, 0xa98559, Math.PI / 2); round(.3, .93, 0, .3, .5, bark, Math.PI / 2);
        break;
      }
      case 'bale':
        round(0, .75, 0, 1.5, 1.2, look < .3 ? 0xe6e6e0 : 0xc9ab5c, 0, Math.PI / 2);
        break;
      case 'garbageBin': case 'recyclingBin': {
        const c = p.kind === 'recyclingBin' ? 0x2f5d9e : look < .5 ? 0x2e4a37 : 0x45494c;
        box(0, .5, 0, .58, 1.0, .72, c); box(0, 1.03, -.02, .62, .06, .78, c === 0x2f5d9e ? 0x26497d : 0x283a2e);
        round(-.22, .1, .36, .2, .06, 0x1b1c1e, 0, Math.PI / 2); round(.22, .1, .36, .2, .06, 0x1b1c1e, 0, Math.PI / 2);
        break;
      }
    }
    return l.parts = out;
  }
}
