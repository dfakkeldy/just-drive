import * as THREE from 'three';
import type { Building } from './buildings';
import { BROOK, BROOK_BED, COTTAGE, HOUSE, RIPRAP, SHED, type HomeSite } from './home-site';
import { ParkedVehicles, pushOut, type Pushable, type Solid } from './parked';
import type { Terrain } from './terrain';
import { Mesher, seeded, type RGB } from './yard-kit';

/**
 * Red Roof by the Brook, a modelled house and yard in Judique:
 * a 66 ft by 16 ft house with a red metal roof, its entry deck, the old cottage and shed, an old trailer,
 * the garden, the fenced paddock, the rock wall and the brook. Layout is in house metres (see home-site.ts):
 * u toward the north end, v toward the brook. Wall and eave heights are estimates.
 */
const FT = 0.3048;
const WALL: RGB = [0.80, 0.80, 0.75], TRIM: RGB = [0.93, 0.93, 0.90], GLASS: RGB = [0.07, 0.11, 0.14], SKIRT: RGB = [0.50, 0.50, 0.48];
const ROOF: RGB = [0.62, 0.07, 0.10], ROOF_DARK: RGB = [0.50, 0.05, 0.08];
const WOOD: RGB = [0.40, 0.36, 0.31], WOOD_PALE: RGB = [0.56, 0.47, 0.34], SOIL: RGB = [0.13, 0.10, 0.07], STEEL: RGB = [0.60, 0.61, 0.60];
const FLOOR = 1.0;   // the floor is about five steps above the lawn

/** A model's turn about the vertical axis that points its local +x along (du, dv). */
const turn = (du: number, dv: number) => Math.atan2(-dv, du);

export class Home {
  readonly group = new THREE.Group();
  private local = new THREE.Group();   // the house's own axes: x is u, z is v
  private solids: Solid[] = [];
  private parked: ParkedVehicles | null = null;
  private built = false; private fine = -1;
  private material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private water = new THREE.MeshLambertMaterial({ color: 0x3f5a66, transparent: true, opacity: 0.82, side: THREE.DoubleSide });
  private probes: { x: number; z: number }[];
  triangles = 0;

  /** `lift` turns a true height above the sea into the game's stretched height. */
  constructor(readonly site: HomeSite, private terrain: Terrain, private lift: (metres: number) => number) {
    const o = site.origin;
    this.local.position.set(o.x, 0, o.z);
    this.local.rotation.y = site.yaw;
    this.group.add(this.local);
    this.group.visible = false;
    this.probes = ([[0, 0], [20, -15], [-25, 3], [-3, -41], [10, 15]] as [number, number][]).map(([u, v]) => site.world(u, v));
  }

  /** The surveyed box that stood for the cottage and the shed together: this model replaces it. */
  static buildings(list: Building[], site: HomeSite, village: readonly [number, number]): Building[] {
    return list.filter((b) => { const { u, v } = site.local(b.x - village[0], village[1] - b.y); return Math.hypot(u - 3.5, v + 17) > 12; });
  }

  private g = (u: number, v: number): number => { const w = this.site.world(u, v); return this.terrain.heightAt(w.x, w.z) ?? 0; };

  private ready(): number | null {
    let fine = 0;
    for (const p of this.probes) {
      const s = this.terrain.surfaceAt(p.x, p.z);
      if (!s || s.level < 7) return null;
      if (s.level >= 8) fine++;
    }
    return fine;
  }

  update(cam: THREE.Vector3, car: { x: number; z: number }): void {
    const o = this.site.origin, far = Math.min(Math.hypot(cam.x - o.x, cam.z - o.z), Math.hypot(car.x - o.x, car.z - o.z));
    if (far < 900) {
      const fine = this.ready();
      if (fine !== null && fine > this.fine) { this.build(); this.built = true; this.fine = fine; }
    }
    this.group.visible = this.built && far < 1600;
    if (this.built && this.parked && !this.parked.group.visible) this.parked.seat();   // its ground was still loading
  }

  /** Walls, sheds, parked cars and tree trunks stop the car. */
  resolveSolids(car: Pushable): void {
    if (!this.built) return;
    const b = this.site.box;
    if (car.x < b[0] || car.x > b[2] || car.z < b[1] || car.z > b[3]) return;
    pushOut(car, this.solids);
  }

  private solid(u: number, v: number, half: number, halfWidth: number, du = 1, dv = 0): void {
    const w = this.site.world(u, v);
    this.solids.push({ x: w.x, z: w.z, half, halfWidth, heading: this.site.heading(du, dv) });
  }

  private build(): void {
    for (const child of [...this.local.children]) {
      this.local.remove(child);
      child.traverse((o) => { (o as THREE.Mesh).geometry?.dispose(); if (o instanceof THREE.InstancedMesh) o.dispose(); });
    }
    this.solids = [];
    const m = new Mesher(), rnd = seeded(117);
    this.house(m);
    this.outbuildings(m);
    this.yard(m, rnd);
    this.riprap(m, rnd);
    this.snags(m, rnd);
    this.local.add(new THREE.Mesh(m.geometry(), this.material));
    this.triangles = m.triangles;
    this.brook();
    // A dark SUV on the gravel by the door, and a silver car beside the cottage.
    if (!this.parked) {
      const suv = this.site.world(12.7, -4.7), car = this.site.world(12.8, -25.2);
      this.parked = new ParkedVehicles([
        { ...suv, heading: this.site.heading(1, 0.04), type: 1, colour: 0x2b2d31 },
        { ...car, heading: this.site.heading(1, 0.12), type: 0, colour: 0xb4b7b9 },
      ], (x, z) => this.terrain.heightAt(x, z));
      this.group.add(this.parked.group);
    }
    this.parked.seat();
    this.solids.push(...this.parked.solids);
  }

  private house(m: Mesher): void {
    const L = HOUSE.length / 2, W = HOUSE.width / 2, y = this.g(0, 0), o = 0.33;
    // Seen from the south end: x is v (the brook is to the right), z is toward the south.
    m.at(0, y, 0, -Math.PI / 2);
    m.box(0, -0.25, 0, HOUSE.width - 0.1, 2.5, HOUSE.length - 0.1, SKIRT);
    // The roof's ridge is not in the middle: a short slope falls to the gutter over the door, a long one to the brook.
    const ridge = -1.87, top = FLOOR + 3.95;
    m.extrude([[-W, FLOOR], [W, FLOOR], [W, top - 0.56], [ridge, top - 0.14], [-W, top - 0.35]], -L, L, WALL);
    m.extrude([[-W - o, top - 0.47], [ridge, top - 0.14], [W + o, top - 0.59], [W + o, top - 0.45], [ridge, top], [-W - o, top - 0.33]], -L - o, L + o, ROOF, TRIM);
    m.box(ridge, top + 0.03, 0, 0.36, 0.04, HOUSE.length + 2 * o + 0.04, ROOF_DARK);
    // The standing ribs of the metal sheets, one every 0.9 m.
    for (let z = -L - o + 0.1; z < L + o; z += 0.9) m.extrude([[-W - o, top - 0.33], [ridge, top], [W + o, top - 0.45], [W + o, top - 0.42], [ridge, top + 0.03], [-W - o, top - 0.30]], z, z + 0.05, ROOF_DARK);
    m.box(-W - o - 0.02, top - 0.42, 0, 0.04, 0.2, HOUSE.length + 2 * o, TRIM);
    m.box(-W - o - 0.1, top - 0.47, 0, 0.13, 0.11, HOUSE.length + 2 * o, TRIM);   // the gutter
    m.box(W + o + 0.02, top - 0.54, 0, 0.04, 0.2, HOUSE.length + 2 * o, TRIM);
    const roofAt = (v: number) => top - (v - ridge) * (0.45 / (W + o - ridge));
    for (const u of [0.8, -1.7, -4.2]) {   // three skylights
      m.box(0.45, roofAt(0.45) + 0.05, -u, 1.25, 0.1, 0.8, TRIM);
      m.box(0.45, roofAt(0.45) + 0.11, -u, 1.05, 0.02, 0.6, [0.32, 0.42, 0.48]);
    }
    m.cyl(1.2, roofAt(1.2) + 0.55, 6.3, 0.09, 1.1, [0.2, 0.2, 0.21]);   // the wood stove's pipe
    m.cyl(1.2, roofAt(1.2) + 1.14, 6.3, 0.15, 0.08, [0.2, 0.2, 0.21]);

    // Openings measured in feet from the south end.
    const open = (side: number, ft: number, w: number, sill: number, h: number, k: RGB = GLASS) => {
      const z = L - ft * FT, x = side * (W + 0.03);
      m.box(x, FLOOR + sill + h / 2, z, 0.05, h + 0.16, w + 0.16, TRIM);
      m.box(x + side * 0.02, FLOOR + sill + h / 2, z, 0.05, h, w, k);
    };
    // The brook side is the plan's front: tall glass with a transom over each piece.
    for (const ft of [6, 14.3, 32.6, 40.2, 47.5, 60]) { open(1, ft, 1.52, 0.06, 2.03); open(1, ft, 1.52, 2.3, 0.42); }
    for (const ft of [19.6, 23.4]) { open(1, ft, 0.91, 0.55, 1.52); open(1, ft, 0.91, 2.3, 0.42); }
    // The driveway side: the door near the north end, and two small high windows.
    open(-1, 56.4, 0.9, 0.03, 2.03, [0.20, 0.24, 0.26]);
    open(-1, 20.7, 0.99, 1.1, 1.02); open(-1, 31.9, 0.79, 1.1, 1.02);
    for (const v of [-1.75, 1.35]) {   // the south end: two bedroom windows
      m.box(v, FLOOR + 0.8 + 0.63, L + 0.03, 1.02, 1.43, 0.05, TRIM);
      m.box(v, FLOOR + 0.8 + 0.63, L + 0.05, 0.86, 1.27, 0.05, GLASS);
    }
    this.solid(0, 0, L + 0.1, W + 0.1);

    // From here on: x is u, z is v.
    m.at(0, y, 0);
    const doorU = -L + 56.4 * FT;
    // The entry deck, with its steps going down to the north.
    const d0 = doorU - 1.4, d1 = doorU + 1.35, dv0 = -W - 2.3;
    m.box((d0 + d1) / 2, FLOOR - 0.1, (-W + dv0) / 2, d1 - d0, 0.1, 2.3, WOOD);
    for (const u of [d0 + 0.08, d1 - 0.08]) for (const v of [dv0 + 0.08, -W - 0.3]) m.box(u, FLOOR / 2 - 0.3, v, 0.12, FLOOR + 0.5, 0.12, WOOD);
    for (const u of [d0 + 0.06, (d0 + d1) / 2, d1 - 0.06]) m.box(u, FLOOR + 0.45, dv0 + 0.06, 0.09, 1.0, 0.09, WOOD);
    m.box((d0 + d1) / 2, FLOOR + 0.93, dv0 + 0.06, d1 - d0, 0.07, 0.11, WOOD);
    m.box(d0 + 0.06, FLOOR + 0.93, (-W + dv0) / 2, 0.11, 0.07, 2.3, WOOD);
    m.box(d0 + 0.06, FLOOR + 0.45, -W - 0.1, 0.09, 1.0, 0.09, WOOD);
    for (let i = 0; i < 5; i++) m.box(d1 + 0.14 + i * 0.27, FLOOR - 0.12 - (i + 1) * 0.17, dv0 + 0.75, 0.29, 0.05, 1.4, WOOD);
    for (const v of [dv0 + 0.06, dv0 + 1.44]) m.box(d1 + 0.7, FLOOR / 2 - 0.2, v, 1.45, 0.07, 0.06, WOOD, false);
    this.solid((d0 + d1) / 2, (-W + dv0) / 2, (d1 - d0) / 2, 1.15);
    // Steps from the tall door on the brook side.
    const eu = -L + 14.3 * FT;
    m.box(eu, FLOOR - 0.12, W + 0.55, 1.7, 0.1, 1.1, WOOD);
    for (let i = 0; i < 4; i++) m.box(eu, FLOOR - 0.3 - i * 0.19, W + 1.22 + i * 0.27, 1.5, 0.05, 0.29, WOOD);
    for (const s of [-1, 1]) m.box(eu + s * 0.78, FLOOR / 2 - 0.2, W + 0.55, 0.1, FLOOR + 0.2, 1.0, WOOD);

    // Along the driveway wall: the heat pump, two gas cylinders, the power mast.
    m.box(2.9, 0.75, -W - 0.36, 0.95, 0.72, 0.36, [0.82, 0.83, 0.80]);
    m.box(2.9, 0.75, -W - 0.545, 0.5, 0.5, 0.01, [0.16, 0.17, 0.18]);
    for (const u of [2.5, 3.3]) m.box(u, 0.2, -W - 0.36, 0.06, 0.4, 0.3, STEEL);
    for (const u of [4.35, 4.75]) { m.cyl(u, 0.62, -W - 0.3, 0.17, 1.15, [0.88, 0.88, 0.85]); m.cyl(u, 1.27, -W - 0.3, 0.07, 0.14, [0.3, 0.3, 0.3]); }
    m.cyl(1.4, FLOOR + 3.3, -W - 0.08, 0.04, 2.4, STEEL);
    // Firewood: two stacked rows and the heap that is still to be split.
    for (const [u, v, len] of [[1.4, -5.5, 3.4], [0.6, -6.3, 2.4]] as const) {
      m.box(u, 0.6, v, len, 1.2, 0.42, WOOD_PALE);
      m.box(u, 1.22, v, len, 0.03, 0.46, [0.36, 0.30, 0.22]);
      this.solid(u, v, len / 2, 0.25);
    }
    m.cyl(8.9, 0.28, -8.3, 1.5, 0.56, WOOD_PALE, 'y', 9, 0.25, [0.47, 0.39, 0.28]);
    for (const [u, v] of [[-1.1, -6.6], [-2.7, -6.4]]) m.cyl(u, 0.03, v, 0.36, 0.06, [0.16, 0.42, 0.30], 'y', 12);   // septic lids
  }

  /** A plain gable building: its long axis points along (du, dv). */
  private gable(m: Mesher, at: { u: number; v: number; du: number; dv: number; length: number; width: number }, eave: number, ridge: number, wall: RGB, roof: RGB, door: 'side' | 'end'): void {
    const L = at.length / 2, W = at.width / 2, y = this.g(at.u, at.v), o = 0.3;
    m.at(at.u, y, at.v, turn(at.du, at.dv) - Math.PI / 2);   // x across the ridge, z along it
    m.extrude([[-W, -1.5], [W, -1.5], [W, eave], [0, ridge], [-W, eave]], -L, L, wall);
    const drop = (o * (ridge - eave)) / W;
    m.extrude([[-W - o, eave - drop - 0.02], [0, ridge - 0.02], [W + o, eave - drop - 0.02], [W + o, eave - drop + 0.12], [0, ridge + 0.14], [-W - o, eave - drop + 0.12]], -L - o, L + o, roof, [roof[0] * 0.8, roof[1] * 0.8, roof[2] * 0.8]);
    const dark: RGB = [wall[0] * 0.45, wall[1] * 0.45, wall[2] * 0.45];
    if (door === 'side') {
      // The model places the door on local -x.
      m.box(-W - 0.03, 1.0, L * 0.3, 0.05, 2.0, 0.9, dark);
      for (const z of [-L * 0.45, L * 0.75]) { m.box(-W - 0.03, 1.5, z, 0.05, 1.05, 0.95, TRIM); m.box(-W - 0.05, 1.5, z, 0.05, 0.9, 0.8, GLASS); }
      m.box(W + 0.03, 1.5, 0, 0.05, 1.05, 0.95, TRIM); m.box(W + 0.05, 1.5, 0, 0.05, 0.9, 0.8, GLASS);
    } else m.box(0, 0.95, L + 0.03, 1.3, 1.9, 0.05, dark);
    this.solid(at.u, at.v, L + 0.1, W + 0.1, at.du, at.dv);
  }

  private outbuildings(m: Mesher): void {
    this.gable(m, COTTAGE, 2.5, 4.4, [0.36, 0.34, 0.31], [0.30, 0.28, 0.27], 'side');
    this.gable(m, SHED, 1.9, 2.6, [0.40, 0.11, 0.09], [0.30, 0.30, 0.31], 'end');

    // The old trailer in the west clearing: a cream body under a rust-red roof.
    const tu = -3.05, tv = -41.05, du = 0.342, dv = 0.94, len = 11.4;
    m.at(tu, this.g(tu, tv), tv, turn(du, dv));
    m.box(0, 0.2, 0, len - 0.6, 0.4, 2.4, [0.16, 0.15, 0.14]);
    m.box(0, 1.6, 0, len, 2.4, 3.0, [0.72, 0.70, 0.63]);
    m.box(0, 1.25, 0, len + 0.02, 0.22, 3.02, [0.50, 0.24, 0.18]);
    m.box(0, 2.86, 0, len + 0.2, 0.14, 3.2, [0.46, 0.21, 0.16]);
    for (const x of [-4.2, -1.9, 0.6, 3.6]) for (const s of [-1, 1]) m.box(x, 1.95, s * 1.52, 1.0, 0.7, 0.03, GLASS);
    m.box(2.1, 1.3, 1.52, 0.8, 1.8, 0.03, [0.55, 0.53, 0.48]);
    this.solid(tu, tv, len / 2 + 0.1, 1.6, du, dv);

    // A box trailer left beside the road.
    const cu = 3.6, cv = -77.9, cdu = 0.236, cdv = 0.972;
    m.at(cu, this.g(cu, cv), cv, turn(cdu, cdv));
    m.box(0, 1.45, 0, 3.6, 1.9, 2.0, [0.66, 0.67, 0.67]);
    m.box(2.5, 0.5, 0, 1.5, 0.07, 0.07, [0.2, 0.2, 0.2]);
    for (const s of [-1, 1]) m.cyl(-0.3, 0.33, s * 1.05, 0.33, 0.2, [0.04, 0.04, 0.04], 'z', 8);
    this.solid(cu, cv, 1.9, 1.1, cdu, cdv);
  }

  /** A wire fence around a closed line of points: posts and three strands. */
  private fence(m: Mesher, pts: [number, number][], gateAfter = -1): void {
    const k: RGB = [0.60, 0.61, 0.58], post: RGB = [0.42, 0.40, 0.35];
    for (let i = 0; i < pts.length; i++) {
      if (i === gateAfter) continue;
      const [au, av] = pts[i], [bu, bv] = pts[(i + 1) % pts.length], len = Math.hypot(bu - au, bv - av), n = Math.max(1, Math.round(len / 2.4));
      for (let j = 0; j < n; j++) {
        const u0 = au + ((bu - au) * j) / n, v0 = av + ((bv - av) * j) / n, u1 = au + ((bu - au) * (j + 1)) / n, v1 = av + ((bv - av) * (j + 1)) / n;
        const y0 = this.g(u0, v0), y1 = this.g(u1, v1), span = len / n;
        m.at(u0, y0, v0); m.box(0, 0.6, 0, 0.07, 1.3, 0.07, post);
        m.at((u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2, turn(u1 - u0, v1 - v0), 0, Math.atan2(y1 - y0, span));
        for (const h of [0.25, 0.55, 0.85, 1.15]) m.box(0, h, 0, span, 0.025, 0.025, k);
        for (let s = 1; s < 4; s++) m.box(-span / 2 + (span * s) / 4, 0.7, 0, 0.02, 0.92, 0.02, k);
      }
      m.at(bu, this.g(bu, bv), bv); m.box(0, 0.6, 0, 0.07, 1.3, 0.07, post);   // the post that ends this side (and a gate)
    }
  }

  private yard(m: Mesher, rnd: () => number): void {
    // Eight planter boxes along the driveway.
    for (const [u, v] of [[24.3, -15.7], [23.4, -13.8], [22.5, -12.1], [21.6, -10.5], [20.7, -8.7], [19.8, -7], [19, -5.6], [18, -3.7]]) {
      m.at(u, this.g(u, v), v, 0.45);
      m.box(0, 0.15, 0, 0.95, 0.3, 0.95, WOOD); m.box(0, 0.31, 0, 0.82, 0.02, 0.82, SOIL);
      if (rnd() < 0.6) m.cyl((rnd() - 0.5) * 0.3, 0.42, (rnd() - 0.5) * 0.3, 0.22, 0.2, [0.16, 0.26, 0.09], 'y', 6, 0.1);
    }
    // The garden at the south end: raised beds inside a wire fence.
    this.fence(m, [[-10.7, -2.3], [-10.6, 3.7], [-16.7, 6.7], [-15.9, -5.2]], 0);
    for (const [u, v, a] of [[-12.8, 1.2, 0], [-14.6, 1.1, 0], [-15, 3.5, 1], [-13, -1.3, 0], [-14.9, -1.8, 0], [-16.7, -2.1, 1], [-12.6, 3.4, 1]] as const) {
      m.at(u, this.g(u, v), v, a ? Math.PI / 2 : 0.05);
      m.box(0, 0.16, 0, 1.25, 0.32, 2.5, WOOD); m.box(0, 0.33, 0, 1.1, 0.02, 2.35, SOIL);
      for (let i = 0; i < 4; i++) if (rnd() < 0.55) m.cyl((rnd() - 0.5) * 0.6, 0.48, -0.9 + i * 0.6, 0.2, 0.3, [0.14, 0.24, 0.08], 'y', 5, 0.08);
    }
    m.at(-12.2, this.g(-12.2, 5), 5, 0.3); m.box(0, 0.35, 0, 1.3, 0.7, 1.1, [0.15, 0.33, 0.60]);   // a pile under a blue tarp
    for (let i = 0; i < 9; i++) { const u = -10.9 - rnd() * 1.2, v = 5.6 + rnd() * 1.3; m.at(u, this.g(u, v), v); m.cyl(0, 0.19, 0, 0.15, 0.38, [0.90, 0.90, 0.88], 'y', 7); }

    // The paddock, with its small shelter under a blue and white roof.
    this.fence(m, [[-17.8, -5.7], [-18, 9.5], [-21.6, 12.2], [-31.4, 13.4], [-32.4, -1.9], [-33.2, -7.7], [-27.4, -14.2], [-24, -10.6], [-21.9, -6.7]]);
    m.at(-26.5, this.g(-26.5, 6.5), 6.5, 0.25);
    m.box(0, 0.75, 0, 2.3, 1.5, 1.6, [0.62, 0.60, 0.55]);
    m.box(-0.5, 1.56, 0, 1.3, 0.08, 1.9, [0.86, 0.87, 0.86]); m.box(0.7, 1.56, 0, 1.1, 0.08, 1.9, [0.16, 0.36, 0.66]);
    m.box(1.16, 0.5, 0, 0.02, 0.8, 0.6, [0.1, 0.1, 0.1]);
    this.solid(-26.5, 6.5, 1.2, 0.85, 0.97, -0.25);
    m.at(-22.4, this.g(-22.4, -1.9), -1.9, 0.6); m.box(0, 0.5, 0, 1.3, 1.0, 1.3, [0.07, 0.07, 0.08]);
    m.at(-23.6, this.g(-23.6, 0.2), 0.2, 0.1); m.box(0, 0.07, 0, 1.2, 0.14, 1.0, WOOD_PALE);
  }

  /** The rock wall: big grey stones, three deep, between the lawn and the water. */
  private riprap(m: Mesher, rnd: () => number): void {
    for (let i = 1; i < RIPRAP.length; i++) {
      const [au, av] = RIPRAP[i - 1], [bu, bv] = RIPRAP[i], len = Math.hypot(bu - au, bv - av), nu = (bv - av) / len, nv = -(bu - au) / len;
      const out = nu * au + nv * av > 0 ? 1 : -1;   // toward the brook: away from the house
      for (let s = 0; s < len; s += 0.5) for (let row = 0; row < 4; row++) {
        const t = (s + rnd() * 0.4) / len, off = (row * 0.7 - 0.5 + rnd() * 0.3) * out;
        const u = au + (bu - au) * t + nu * off, v = av + (bv - av) * t + nv * off, r = 0.34 + rnd() * 0.3, shade = 0.36 + rnd() * 0.16;
        m.at(u, this.g(u, v) + r * 0.25, v, rnd() * 6.3, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5);
        m.cyl(0, 0, 0, r, r * (0.8 + rnd() * 0.4), [shade, shade * 0.99, shade * 0.95], 'y', 6, r * (0.5 + rnd() * 0.3));
      }
    }
  }

  /** Dead standing trees: the storm of 2022 left many, pale and bare. */
  private snags(m: Mesher, rnd: () => number): void {
    const spots: [number, number][] = [[3.4, -72.8], [21, -46.8], [9.9, -32.4], [2.1, -47.5], [-10.4, -25.7], [-4.3, -11.2], [-32.8, -48.9], [-30.6, -61.8],
      [-47.1, -9.2], [-23, 25.8], [12.2, 25.5], [26.8, 14.5], [-32.9, -40.7], [-38.7, -33.9], [-40.7, -22], [-45.7, 1.5], [-39.2, 16.5], [-22.3, -70], [-16.8, -63.4],
      [-44, -15], [-36, 24], [-12, 27], [20, -60], [-20, -45], [-27, -30], [8, -60]];
    for (const [u, v] of spots) {
      const h = 6 + rnd() * 5, shade = 0.55 + rnd() * 0.14, k: RGB = [shade, shade * 0.97, shade * 0.92], y = this.g(u, v), lean = (rnd() - 0.5) * 0.12;
      m.at(u, y, v, rnd() * 6.3, lean, lean * 0.6);
      m.cyl(0, h / 2, 0, 0.16, h, k, 'y', 6, 0.04);
      const trunk = m.frame;
      for (let b = 0; b < 5; b++) {
        const at = h * (0.35 + 0.12 * b), yaw = rnd() * 6.3, reach = 1.2 + rnd() * 1.6;
        m.within(trunk, 0, at, 0, yaw, 0, 0.9 + rnd() * 0.4);
        m.cyl(0, reach / 2, 0, 0.05, reach, k, 'y', 4, 0.015, null);
      }
      this.solid(u, v, 0.2, 0.2);
    }
  }

  /** The brook's water, as one ribbon that follows the bed down to the road. */
  private brook(): void {
    const pos: number[] = [], idx: number[] = [], half = BROOK_BED + 0.2;
    const pts: [number, number][] = [];
    for (let i = 1; i < BROOK.length; i++) {
      const [au, av] = BROOK[i - 1], [bu, bv] = BROOK[i], n = Math.max(1, Math.ceil(Math.hypot(bu - au, bv - av) / 2));
      for (let j = i === 1 ? 0 : 1; j <= n; j++) pts.push([au + ((bu - au) * j) / n, av + ((bv - av) * j) / n]);
    }
    pts.forEach(([u, v], i) => {
      const [pu, pv] = pts[Math.max(0, i - 1)], [qu, qv] = pts[Math.min(pts.length - 1, i + 1)], len = Math.hypot(qu - pu, qv - pv) || 1;
      const nu = -(qv - pv) / len, nv = (qu - pu) / len, y = this.lift(this.site.brookLevel(u, v));
      pos.push(u + nu * half, y, v + nv * half, u - nu * half, y, v - nv * half);
      if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.water);
    mesh.userData.shadowSet = true; mesh.castShadow = false; mesh.receiveShadow = false;
    this.local.add(mesh);
  }
}
