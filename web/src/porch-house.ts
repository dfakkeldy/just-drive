import * as THREE from 'three';
import type { Building } from './buildings';
import { pushOut, type Pushable, type Solid } from './parked';
import { FENCE, type PorchSite } from './porch-site';
import type { Terrain } from './terrain';
import { Mesher, type RGB } from './yard-kit';

/**
 * One house at the end of Beaton Road, built by hand in place of its surveyed box, so that the people who live
 * there know it: grey shingle walls with white trim, a dark roof, a gable with a red door toward the road, a taller
 * wing across behind it, and a porch round the north corner with wide wooden steps.
 *
 * Layout is in house metres (see porch-site.ts): u toward the road, v across. Heights are above the level pad.
 * The size of each part is an estimate from the outside: shapes only, with no sign, number or name.
 */
const hex = (value: number): RGB => { const c = new THREE.Color(value); return [c.r, c.g, c.b]; };
const shade = (k: RGB, f: number): RGB => [k[0] * f, k[1] * f, k[2] * f];
// Paint is chosen for evening shade: the sky lights a floor blue, so the boards are warmer here than they look there.
const SHINGLE = hex(0x9c9b96), TRIM = hex(0xecece6), ROOF = hex(0x5c5e61), PORCH_ROOF = hex(0x6c6862), GLASS: RGB = [0.07, 0.11, 0.14];
const DOOR = hex(0x7c1f1c), DECK_WOOD = hex(0xa99b87), NEW_WOOD = hex(0xc9a167), CONCRETE = hex(0xa8a7a0), FOUNDATION = hex(0x7d7d79);
const BRICK = hex(0x7a4535), BLACK = hex(0x1a1a1b), LATTICE = hex(0x6c665d), HOSTA = hex(0x8c9838), HOSTA_GOLD = hex(0xc6b048), FENCE_WHITE = hex(0xe6e6df);
const IRON = hex(0x70493a), SOOT = hex(0x15110f), LAMP: RGB = [2.6, 1.9, 0.9];
// The porch ceiling is brighter than any paint. The game's light from below is dim and brown, as under open sky over
// dark ground. Under this roof the light from below comes off pale boards and a lawn in the sun, and paint cannot
// show that: so the ceiling's own colour stands for that light too.
const CEILING: RGB = [1.6, 1.75, 2.3];

const DECK = 0.5, FLOOR = 0.56, EAVE = 4.3, FRONT_RIDGE = 6.8, CROSS_RIDGE = 7.2, OVERHANG = 0.3;
/** The gable toward the road, the taller wing across behind it, and the lower part at the back. */
const FRONT = { u0: 3.8, u1: 7.4, v0: 0.4, v1: 5.4 }, CROSS = { u0: -2.4, u1: 3.8, v0: -2.4, v1: 5.4 }, REAR = { u0: -7.5, u1: -2.4, v0: -1.2, v1: 5.4, eave: 2.9, ridge: 5.1 };
/** The porch: a bay beside the gable, then, set back, a landing with the steps and a deck along the side wall. */
const BAY = { u0: 3.8, u1: 6.2, v0: -2.4, v1: 0.4 }, SIDE = { u0: -2.4, u1: 4.9, v0: -5.4, v1: -2.4 }, STEPS = { v0: -4.7, v1: -2.6 };
/** Where the dog lies: at the top of the steps, turned a little toward the house, as a dog settles beside a door. */
export const PORCH_SEAT = { u: 4.25, v: -3.65, turn: -0.6 };
/** The guest on the boards is drawn only this near, in metres. Farther off it is a few pixels, and it costs its triangles and its shadow. */
const GUEST_SEEN = 250;

export class PorchHouse {
  readonly group = new THREE.Group();
  private local = new THREE.Group();   // the house's own axes: x is u, z is v
  private solids: Solid[] = [];
  private built = false; private fine = -1;
  private material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private probes: { x: number; z: number }[];
  private guest: THREE.Object3D | null = null;
  private near = false;
  triangles = 0;

  /** `lift` turns a true height above the sea into the game's stretched height. */
  constructor(readonly site: PorchSite, private terrain: Terrain, private lift: (metres: number) => number) {
    const o = site.origin;
    this.local.position.set(o.x, 0, o.z);
    this.local.rotation.y = site.yaw;
    this.group.add(this.local);
    this.group.visible = false;
    this.probes = ([[0, 0], [12, -4], [-15, -8], [8, -20], [-6, 9]] as [number, number][]).map(([u, v]) => site.world(u, v));
  }

  /** The list to draw: all the surveyed boxes but this house's own. Every other reader keeps the full list. */
  static drawn(list: Building[], box: Building): Building[] { return list.filter((b) => (b.buildingId ?? b.id) !== box.id); }

  /** Put something on the boards at the top of the steps. It faces the road, less the seat's turn: its own forward is -z. */
  seat(guest: THREE.Object3D): void {
    this.guest = guest;
    guest.rotation.y = -Math.PI / 2 + PORCH_SEAT.turn;
    this.local.add(guest);
    this.place();
  }
  private place(): void { this.guest?.position.set(PORCH_SEAT.u, this.lift(this.site.level) + DECK, PORCH_SEAT.v); }

  /** True while the house is near and its model is still to come: a picture should wait. */
  get waiting(): boolean { return this.near && !this.built; }

  private g = (u: number, v: number): number => { const w = this.site.world(u, v); return this.terrain.heightAt(w.x, w.z) ?? this.lift(this.site.level); };

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
    this.near = far < 900;
    if (this.near) {
      const fine = this.ready();
      if (fine !== null && fine > this.fine) { this.build(); this.built = true; this.fine = fine; }
    }
    this.group.visible = this.built && far < 1600;
    if (this.guest) this.guest.visible = far < GUEST_SEEN;
  }

  /** The walls and the porch stop the car. */
  resolveSolids(car: Pushable): void {
    if (!this.built) return;
    const b = this.site.box;
    if (car.x < b[0] || car.x > b[2] || car.z < b[1] || car.z > b[3]) return;
    pushOut(car, this.solids);
  }

  private solid(box: { u0: number; u1: number; v0: number; v1: number }): void {
    const w = this.site.world((box.u0 + box.u1) / 2, (box.v0 + box.v1) / 2);
    this.solids.push({ x: w.x, z: w.z, half: (box.u1 - box.u0) / 2, halfWidth: (box.v1 - box.v0) / 2, heading: this.site.heading(1, 0) });
  }

  private build(): void {
    for (const child of [...this.local.children]) {
      if (child === this.guest) continue;
      this.local.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
    }
    this.solids = [];
    const m = new Mesher(), y = this.lift(this.site.level);
    this.house(m, y);
    this.porch(m, y);
    this.yard(m, y);
    this.local.add(new THREE.Mesh(m.geometry(), this.material));
    this.triangles = m.triangles;
    this.place();
    for (const box of [FRONT, CROSS, REAR, BAY, SIDE, { u0: SIDE.u1, u1: SIDE.u1 + 0.6, v0: STEPS.v0, v1: STEPS.v1 }]) this.solid(box);
  }

  /** A roof with two slopes over a part whose ridge runs along local z. Its ends are white, like the real rake boards. */
  private roof(m: Mesher, half: number, eave: number, ridge: number, z0: number, z1: number, over = OVERHANG): void {
    const drop = (over * (ridge - eave)) / half, t = 0.13;
    m.extrude([[-half - over, eave - drop], [0, ridge], [half + over, eave - drop], [half + over, eave - drop + t], [0, ridge + t], [-half - over, eave - drop + t]], z0, z1, ROOF, TRIM);
  }

  /**
   * Shingle courses: a thin shadow line every 19 cm up a wall, and on into its gable when `ridge` is given.
   * `face`, `plane` and `out` name the wall as in `opening`; the wall runs from a0 to a1.
   */
  private courses(m: Mesher, face: 'u' | 'v', plane: number, out: number, a0: number, a1: number, top: number, ridge = top): void {
    const mid = (a0 + a1) / 2, half = (a1 - a0) / 2, k = shade(SHINGLE, 0.8), p = plane + out * 0.012;
    for (let h = FLOOR + 0.1; h < ridge - 0.25; h += 0.19) {
      const w = (h <= top ? half : (half * (ridge - h)) / (ridge - top)) - 0.1;
      if (w <= 0.1) break;
      const a = mid - w, b = mid + w, y0 = h - 0.011, y1 = h + 0.011;
      m.quad(face === 'u' ? [[p, y0, a], [p, y0, b], [p, y1, b], [p, y1, a]] : [[a, y0, p], [b, y0, p], [b, y1, p], [a, y1, p]], k);
    }
  }

  /** A hosta: broad pointed leaves that arch out from one crown, yellowing in October. `turn` sets one plant apart from the next. */
  private hosta(m: Mesher, r: number, turn: number): void {
    const leaf = (angle: number, reach: number, lift: number, width: number, k: RGB) => {
      const c = Math.cos(angle), s = Math.sin(angle);
      const at = (along: number, up: number, across: number): [number, number, number] => [c * along - s * across, up, s * along + c * across];
      const base = at(0.04, 0.02, 0), left = at(reach * 0.5, lift * 0.88, -width), right = at(reach * 0.5, lift * 0.88, width), rib = at(reach * 0.55, lift, 0), tip = at(reach, lift * 0.22, 0);
      m.tri(...base, ...rib, ...left, k); m.tri(...base, ...right, ...rib, shade(k, 0.88));
      m.tri(...left, ...rib, ...tip, shade(k, 1.06)); m.tri(...rib, ...right, ...tip, shade(k, 0.82));
    };
    for (let i = 0; i < 9; i++) leaf(turn + (i / 9) * Math.PI * 2, r, r * 0.5, r * 0.3, i % 3 === 0 ? HOSTA_GOLD : HOSTA);
    for (let i = 0; i < 6; i++) leaf(turn + 0.5 + (i / 6) * Math.PI * 2, r * 0.6, r * 0.8, r * 0.24, i % 2 ? shade(HOSTA, 1.15) : HOSTA_GOLD);
  }

  /**
   * A window or a door in a wall. `face` is the wall: 'u' for a wall across the u axis at u = plane, 'v' for one at
   * v = plane; `out` is +1 or -1, the way the wall looks. `along` is the middle of the opening along the wall.
   */
  private opening(m: Mesher, face: 'u' | 'v', plane: number, out: number, along: number, bottom: number, w: number, h: number, fill: RGB = GLASS, bars = 1): void {
    const part = (depth: number, yc: number, ww: number, hh: number, k: RGB) => {
      const p = plane + out * depth;
      if (face === 'u') m.box(p, yc, along, 0.05, hh, ww, k); else m.box(along, yc, p, ww, hh, 0.05, k);
    };
    part(0.03, bottom + h / 2, w + 0.2, h + 0.2, TRIM);
    part(0.05, bottom + h / 2, w, h, fill);
    // The bar is a little wider than the glass. With the same width its ends lay in the plane of the glass's edges,
    // and the two surfaces flickered through each other as dark specks.
    for (let i = 1; i <= bars; i++) part(0.065, bottom + (h * i) / (bars + 1), w + 0.012, 0.05, TRIM);
  }

  private house(m: Mesher, y: number): void {
    const under = -1.2;   // the walls go below the pad, so no slope shows a gap
    // The wing across: its ridge runs along v.
    const cu = (CROSS.u0 + CROSS.u1) / 2, ch = (CROSS.u1 - CROSS.u0) / 2;
    m.at(cu, y, 0);
    m.extrude([[-ch, under], [ch, under], [ch, EAVE], [0, CROSS_RIDGE], [-ch, EAVE]], CROSS.v0, CROSS.v1, SHINGLE);
    this.roof(m, ch, EAVE, CROSS_RIDGE, CROSS.v0 - OVERHANG, CROSS.v1 + OVERHANG);
    // The gable toward the road and the part at the back: their ridges run along u. Here local x is -v and local z is u.
    const fv = (FRONT.v0 + FRONT.v1) / 2, fh = (FRONT.v1 - FRONT.v0) / 2;
    m.at(0, y, fv, Math.PI / 2);
    m.extrude([[-fh, under], [fh, under], [fh, EAVE], [0, FRONT_RIDGE], [-fh, EAVE]], cu, FRONT.u1, SHINGLE);
    // Each of these roofs runs on into the wing across, with no overhang there: the two roofs meet in a valley.
    this.roof(m, fh, EAVE, FRONT_RIDGE, CROSS.u1, FRONT.u1 + OVERHANG);
    this.roof(m, fh, EAVE, FRONT_RIDGE, cu, CROSS.u1, 0);
    const rv = (REAR.v0 + REAR.v1) / 2, rh = (REAR.v1 - REAR.v0) / 2;
    m.at(0, y, rv, Math.PI / 2);
    m.extrude([[-rh, under], [rh, under], [rh, REAR.eave], [0, REAR.ridge], [-rh, REAR.eave]], REAR.u0, CROSS.u0 + 0.1, SHINGLE);
    this.roof(m, rh, REAR.eave, REAR.ridge, REAR.u0 - OVERHANG, CROSS.u0);
    this.roof(m, rh, REAR.eave, REAR.ridge, CROSS.u0, cu - 1.6, 0);
    // The dormer on the road side of the wing across, beside the gable.
    const dv = -1.0, dh = 0.78, face = 3.2, sill = 4.8, brow = 5.7;
    m.at(0, y, dv, Math.PI / 2);
    m.extrude([[-dh, sill], [dh, sill], [dh, brow], [0, brow + dh * 0.85], [-dh, brow]], 1.4, face, SHINGLE);
    this.roof(m, dh, brow, brow + dh * 0.85, 1.1, face + 0.18, 0.16);

    // From here on: x is u, z is v.
    m.at(0, y, 0);
    for (const b of [FRONT, CROSS, REAR]) m.box((b.u0 + b.u1) / 2, (FLOOR - 0.14 + under) / 2, (b.v0 + b.v1) / 2, b.u1 - b.u0 + 0.08, FLOOR - 0.14 - under, b.v1 - b.v0 + 0.08, FOUNDATION);
    // Corner boards.
    for (const [u, v, top] of [[FRONT.u1, FRONT.v0, EAVE], [FRONT.u1, FRONT.v1, EAVE], [CROSS.u0, CROSS.v1, EAVE], [CROSS.u1, CROSS.v0, EAVE], [CROSS.u0, CROSS.v0, EAVE],
      [REAR.u0, REAR.v0, REAR.eave], [REAR.u0, REAR.v1, REAR.eave]]) m.box(u, (FLOOR + top) / 2, v, 0.16, top - FLOOR, 0.16, TRIM);
    // A white band under each gable, where the wall meets the roof's triangle.
    m.box(FRONT.u1 + 0.02, EAVE, fv, 0.05, 0.16, FRONT.v1 - FRONT.v0, TRIM);
    m.box(cu, EAVE, CROSS.v1 + 0.02, CROSS.u1 - CROSS.u0, 0.16, 0.05, TRIM);
    m.box(cu, EAVE, CROSS.v0 - 0.02, CROSS.u1 - CROSS.u0, 0.16, 0.05, TRIM);

    // The gable toward the road: the red door low on one side, one window above and a vent under the peak.
    const door = FRONT.v1 - (FRONT.v1 - FRONT.v0) / 3;
    this.opening(m, 'u', FRONT.u1, 1, door, FLOOR, 0.92, 2.05, DOOR, 0);
    m.box(FRONT.u1 + 0.07, FLOOR + 1.52, door, 0.03, 0.62, 0.56, GLASS);                                 // the glass in the door
    for (const h of [0.34, 0.86]) m.box(FRONT.u1 + 0.07, FLOOR + h, door, 0.03, 0.4, 0.6, shade(DOOR, 0.72));   // its two panels
    m.box(FRONT.u1 + 0.12, FLOOR + 2.42, door, 0.16, 0.2, 0.14, BLACK);                                  // the lamp over it
    m.box(FRONT.u1 + 0.5, FLOOR / 2 - 0.03, door, 1.0, FLOOR - 0.06, 1.5, CONCRETE);                     // the step at the door
    m.box(FRONT.u1 + 1.15, FLOOR / 4, door, 0.3, FLOOR / 2, 1.5, CONCRETE);
    this.opening(m, 'u', FRONT.u1, 1, fv, EAVE - 0.05, 0.9, 1.35);
    m.box(FRONT.u1 + 0.03, FRONT_RIDGE - 0.72, fv, 0.05, 0.42, 0.32, TRIM);
    m.box(FRONT.u1 + 0.05, FRONT_RIDGE - 0.72, fv, 0.05, 0.3, 0.2, shade(SHINGLE, 0.45));
    m.box(FRONT.u1 + 0.07, (EAVE + 2.9) / 2, FRONT.v0 + 0.05, 0.07, EAVE - 2.9, 0.07, TRIM);              // the downspout at its corner
    // The east side: two windows in the gable's long wall, then the end of the wing across.
    for (const u of [4.75, 6.4]) this.opening(m, 'v', FRONT.v1, 1, u, FLOOR + 0.85, 0.8, 1.3);
    for (const u of [-1.0, 1.9]) this.opening(m, 'v', CROSS.v1, 1, u, FLOOR + 0.85, 0.8, 1.3);
    for (const u of [0.0, 1.4]) this.opening(m, 'v', CROSS.v1, 1, u, EAVE + 0.25, 0.6, 0.95);
    m.box(3.0, 0.5, CROSS.v1 + 0.22, 0.86, 0.62, 0.34, hex(0xdcdcd6));                                   // the heat pump
    m.box(3.0, 0.5, CROSS.v1 + 0.4, 0.5, 0.5, 0.02, hex(0x2a2c2e));
    // The wall behind the porch bay: a glass door and the round window with its thick white frame.
    this.opening(m, 'u', CROSS.u1, 1, -0.45, FLOOR, 0.86, 2.0, GLASS, 0);
    m.cyl(CROSS.u1 + 0.04, FLOOR + 1.55, -1.75, 0.45, 0.08, TRIM, 'x', 28);
    m.cyl(CROSS.u1 + 0.07, FLOOR + 1.55, -1.75, 0.31, 0.08, GLASS, 'x', 28);
    m.box(CROSS.u1 + 0.1, FLOOR + 1.74, -2.16, 0.13, 0.27, 0.13, BLACK);                                 // the porch lamp, lit
    m.box(CROSS.u1 + 0.1, FLOOR + 1.72, -2.16, 0.15, 0.15, 0.15, LAMP);
    this.opening(m, 'u', face, 1, dv, sill + 0.14, 0.8, 0.72);                                           // the dormer's window
    // The west end of the wing across, behind the side porch: a door, a window, and a window above.
    this.opening(m, 'v', CROSS.v0, -1, 2.55, FLOOR, 0.86, 2.0, shade(TRIM, 0.92), 0);
    m.box(2.55, FLOOR + 1.45, CROSS.v0 - 0.07, 0.56, 0.7, 0.03, GLASS);
    this.opening(m, 'v', CROSS.v0, -1, 0.1, FLOOR + 0.85, 0.85, 1.3);
    this.opening(m, 'v', CROSS.v0, -1, cu, EAVE + 0.25, 0.8, 1.2);
    // The back.
    this.opening(m, 'u', REAR.u0, -1, rv, FLOOR + 0.85, 0.85, 1.25);
    this.opening(m, 'v', REAR.v1, 1, -5.0, FLOOR + 0.85, 0.8, 1.25);
    this.opening(m, 'v', REAR.v0, -1, -5.2, FLOOR + 0.85, 0.8, 1.25);
    // The brick chimney at the ridge.
    m.box(cu, CROSS_RIDGE + 0.15, 1.2, 0.56, 1.6, 0.56, BRICK);
    m.box(cu, CROSS_RIDGE + 0.99, 1.2, 0.66, 0.1, 0.66, shade(BRICK, 0.7));
    // The shingle courses.
    this.courses(m, 'u', FRONT.u1, 1, FRONT.v0, FRONT.v1, EAVE, FRONT_RIDGE);
    this.courses(m, 'v', FRONT.v1, 1, CROSS.u1, FRONT.u1, EAVE);
    this.courses(m, 'v', FRONT.v0, -1, CROSS.u1, FRONT.u1, EAVE);
    this.courses(m, 'u', CROSS.u1, 1, CROSS.v0, FRONT.v0, EAVE);
    this.courses(m, 'v', CROSS.v0, -1, CROSS.u0, CROSS.u1, EAVE, CROSS_RIDGE);
    this.courses(m, 'v', CROSS.v1, 1, CROSS.u0, CROSS.u1, EAVE, CROSS_RIDGE);
    this.courses(m, 'u', CROSS.u0, -1, CROSS.v0, REAR.v0, EAVE);
    this.courses(m, 'v', REAR.v0, -1, REAR.u0, CROSS.u0, REAR.eave);
    this.courses(m, 'v', REAR.v1, 1, REAR.u0, CROSS.u0, REAR.eave);
    this.courses(m, 'u', REAR.u0, -1, REAR.v0, REAR.v1, REAR.eave, REAR.ridge);
  }

  private porch(m: Mesher, y: number): void {
    m.at(0, y, 0);
    const post = 0.07, line = { u: BAY.u1 - post, v: BAY.v0 + post, front: SIDE.u1 - post, west: SIDE.v0 + post, south: SIDE.u0 + post };
    // The boards run toward the road, with a dark line at each gap. Under them: a rim board, then the dark skirt.
    for (const b of [BAY, SIDE]) {
      m.box((b.u0 + b.u1) / 2, DECK - 0.04, (b.v0 + b.v1) / 2, b.u1 - b.u0, 0.08, b.v1 - b.v0, DECK_WOOD);
      m.box((b.u0 + b.u1) / 2, DECK - 0.17, (b.v0 + b.v1) / 2, b.u1 - b.u0 - 0.03, 0.18, b.v1 - b.v0 - 0.03, shade(DECK_WOOD, 0.74));
      m.box((b.u0 + b.u1) / 2, (DECK - 0.26) / 2, (b.v0 + b.v1) / 2, b.u1 - b.u0 - 0.1, DECK - 0.26, b.v1 - b.v0 - 0.1, LATTICE);
      for (let v = b.v0 + 0.14; v < b.v1 - 0.06; v += 0.14) {
        m.quad([[b.u0, DECK + 0.003, v - 0.006], [b.u0, DECK + 0.003, v + 0.006], [b.u1, DECK + 0.003, v + 0.006], [b.u1, DECK + 0.003, v - 0.006]], shade(DECK_WOOD, 0.58));
      }
    }
    // The steps: two wide treads of new wood. Each is closed below, so the pair reads as a stair from every side.
    const sv = (STEPS.v0 + STEPS.v1) / 2, sw = STEPS.v1 - STEPS.v0;
    for (let i = 0; i < 2; i++) {
      const top = DECK - ((i + 1) * DECK) / 3, u = SIDE.u1 + 0.16 + i * 0.3;
      m.box(u, (top - 0.045) / 2, sv, 0.3, top - 0.045, sw - 0.06, shade(NEW_WOOD, 0.74));
      m.box(u + 0.012, top - 0.022, sv, 0.325, 0.045, sw, NEW_WOOD);
    }

    // Posts, and the beam they carry.
    const top = 2.42, beam = 0.16;
    const posts: [number, number][] = [[line.u, line.v], [line.u, BAY.v1 - post], [line.front, line.west], [2.4, line.west], [0, line.west], [line.south, line.west]];
    for (const [u, v] of posts) m.box(u, (DECK + top) / 2, v, 0.14, top - DECK, 0.14, TRIM);
    const run = (u0: number, v0: number, u1: number, v1: number, yc: number, w: number, h: number, k: RGB) =>
      m.box((u0 + u1) / 2, yc, (v0 + v1) / 2, Math.abs(u1 - u0) + w, h, Math.abs(v1 - v0) + w, k);
    const edges: [number, number, number, number][] = [
      [line.u, line.v, line.u, BAY.v1],             // the front of the bay
      [BAY.u0, line.v, line.u, line.v],             // its west side, back to the wall
      [line.front, line.west, line.front, line.v],  // the front of the landing, over the steps
      [line.south, line.west, line.front, line.west],   // the long west side
      [line.south, line.west, line.south, SIDE.v1],     // the south end
    ];
    for (const [u0, v0, u1, v1] of edges) run(u0, v0, u1, v1, top + beam / 2, 0.12, beam, TRIM);

    // Railings: a top and a bottom rail with square balusters between.
    const rail = (u0: number, v0: number, u1: number, v1: number) => {
      run(u0, v0, u1, v1, DECK + 0.93, 0.07, 0.06, TRIM);
      run(u0, v0, u1, v1, DECK + 0.12, 0.05, 0.05, TRIM);
      const length = Math.hypot(u1 - u0, v1 - v0), count = Math.max(1, Math.round(length / 0.125));
      for (let i = 1; i < count; i++) m.box(u0 + ((u1 - u0) * i) / count, DECK + 0.525, v0 + ((v1 - v0) * i) / count, 0.035, 0.76, 0.035, TRIM);
    };
    rail(line.u, line.v, line.u, BAY.v1 - post);
    rail(line.front + 0.07, line.v, line.u, line.v);
    rail(line.front, line.west, line.front, STEPS.v0);
    for (let i = 0; i < posts.length - 3; i++) rail(posts[i + 2][0], line.west, posts[i + 3][0], line.west);
    rail(line.south, line.west, line.south, SIDE.v1 - 0.05);
    for (const v of [STEPS.v0, STEPS.v1]) {   // the short posts at the steps
      m.box(line.front, DECK + 0.5, v, 0.14, 1.0, 0.14, TRIM);
      m.box(line.front, DECK + 1.03, v, 0.19, 0.06, 0.19, TRIM);
    }

    // The roof: low slopes that fall away from the walls, a white edge board, and a pale ceiling.
    const wall = 3.3, eave = 2.74, o = OVERHANG;
    const W1 = [BAY.u0, wall, BAY.v1], W2 = [BAY.u0, wall, BAY.v0], W3 = [SIDE.u0, wall, SIDE.v1];
    const E1 = [BAY.u1 + o, eave, BAY.v1], E2 = [BAY.u1 + o, eave, BAY.v0 - o], E3 = [SIDE.u1 + o, eave, BAY.v0 - o];
    const E4 = [SIDE.u1 + o, eave, SIDE.v0 - o], E5 = [SIDE.u0 - o, eave, SIDE.v0 - o], E6 = [SIDE.u0 - o, eave, SIDE.v1];
    m.quad([W1, W2, E2, E1], PORCH_ROOF);
    m.tri(W2[0], W2[1], W2[2], E3[0], E3[1], E3[2], E2[0], E2[1], E2[2], PORCH_ROOF);
    m.tri(W2[0], W2[1], W2[2], E4[0], E4[1], E4[2], E3[0], E3[1], E3[2], PORCH_ROOF);
    m.quad([W2, W3, E5, E4], PORCH_ROOF);
    m.tri(W3[0], W3[1], W3[2], E6[0], E6[1], E6[2], E5[0], E5[1], E5[2], PORCH_ROOF);
    const eaves = [E1, E2, E3, E4, E5, E6];
    for (let i = 0; i + 1 < eaves.length; i++) run(eaves[i][0], eaves[i][2], eaves[i + 1][0], eaves[i + 1][2], eave - 0.08, 0.04, 0.17, TRIM);
    // The ceiling: painted boards (see CEILING for its brightness).
    const under = eave - 0.17;
    for (const [u0, u1, v0, v1] of [[BAY.u0, BAY.u1 + o, BAY.v0 - o, BAY.v1], [SIDE.u0 - o, SIDE.u1 + o, SIDE.v0 - o, SIDE.v1]]) {
      m.quad([[u0, under, v1], [u1, under, v1], [u1, under, v0], [u0, under, v0]], CEILING);
      for (let v = v0 + 0.3; v < v1 - 0.1; v += 0.3) m.quad([[u0, under - 0.004, v + 0.008], [u1, under - 0.004, v + 0.008], [u1, under - 0.004, v - 0.008], [u0, under - 0.004, v - 0.008]], shade(CEILING, 0.7));
    }

    // The downspout at the bay's corner post: down from the gutter, with a kick at the foot.
    m.box(BAY.u1 + 0.09, (eave - 0.1) / 2 + 0.06, BAY.v0 - 0.09, 0.07, eave - 0.22, 0.07, TRIM);
    m.box(BAY.u1 + 0.19, 0.09, BAY.v0 - 0.09, 0.26, 0.07, 0.07, TRIM);
    // On the bay: the barbecue.
    m.box(5.45, DECK + 0.78, -0.55, 0.5, 0.34, 0.95, BLACK);
    m.box(5.45, DECK + 1.0, -0.55, 0.46, 0.12, 0.9, shade(BLACK, 1.6));
    for (const v of [-0.95, -0.15]) m.box(5.45, DECK + 0.3, v, 0.44, 0.6, 0.05, BLACK);
  }

  private yard(m: Mesher, y: number): void {
    const rise = (u: number, v: number) => this.g(u, v) - y;
    // The concrete walk from the steps to the road, and its branch along the front of the bay.
    const walk = (u0: number, v0: number, u1: number, v1: number, width: number) => {
      const length = Math.hypot(u1 - u0, v1 - v0), count = Math.max(1, Math.round(length / 1.2)), du = (u1 - u0) / length, dv = (v1 - v0) / length;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * length, b = ((i + 1) / count) * length - 0.025;
        const ya = rise(u0 + du * a, v0 + dv * a), yb = rise(u0 + du * b, v0 + dv * b);
        const pitch = -Math.atan2(yb - ya, b - a);
        m.at(u0 + (du * (a + b)) / 2, y + (ya + yb) / 2 + 0.035, v0 + (dv * (a + b)) / 2, Math.atan2(du, dv), pitch);
        m.box(0, 0, 0, width, 0.07, b - a, CONCRETE, false);
      }
    };
    const sv = (STEPS.v0 + STEPS.v1) / 2;
    walk(SIDE.u1 + 0.62, sv, 13.4, sv, 1.15);
    walk(6.95, sv + 0.58, 6.95, BAY.v1 - 0.1, 0.8);
    // Hostas on both sides of the walk, and a low plant at its end.
    const hostas: [number, number, number][] = [[6.25, -4.95, 0.56], [7.55, -5.0, 0.6], [8.85, -4.9, 0.52], [6.2, -2.15, 0.5], [7.95, -2.4, 0.58], [9.15, -2.5, 0.5], [10.3, -2.7, 0.3]];
    hostas.forEach(([u, v, r], i) => { m.at(u, y + rise(u, v), v, i * 1.7); this.hosta(m, r, i * 0.9); });
    // The clay stove beside the steps: three legs, a round belly with its mouth toward the walk, and a long neck.
    m.at(5.4, y + rise(5.4, -5.3), -5.3);
    for (let i = 0; i < 3; i++) m.box(0.2 * Math.cos(i * 2.094), 0.15, 0.2 * Math.sin(i * 2.094), 0.04, 0.3, 0.04, SOOT);
    const belly: [number, number][] = [[0.28, 0.15], [0.42, 0.29], [0.6, 0.33], [0.78, 0.3], [0.93, 0.19], [1.02, 0.11]];
    for (let i = 0; i + 1 < belly.length; i++) {
      const [y0, r0] = belly[i], [y1, r1] = belly[i + 1];
      m.cyl(0, (y0 + y1) / 2, 0, r0, y1 - y0, shade(IRON, 1 - 0.06 * i), 'y', 12, r1, i ? null : SOOT);
    }
    m.cyl(0, 1.3, 0, 0.11, 0.56, shade(IRON, 0.8), 'y', 10, 0.095, null);
    m.cyl(0, 1.6, 0, 0.125, 0.05, SOOT, 'y', 10);
    m.box(0.3, 0.6, 0, 0.08, 0.2, 0.24, SOOT);

    // The white board fence: posts, two rails, and a cross in each bay. It follows the ground.
    const beam = (a: number[], b: number[], w: number, h: number) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], length = Math.hypot(dx, dy, dz);
      m.at((a[0] + b[0]) / 2, y + (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, Math.atan2(dx, dz), -Math.asin(dy / length));
      m.box(0, 0, 0, w, h, length, FENCE_WHITE, false);
    };
    for (let s = 0; s + 1 < FENCE.length; s++) {
      const [u0, v0] = FENCE[s], [u1, v1] = FENCE[s + 1], length = Math.hypot(u1 - u0, v1 - v0), bays = Math.max(1, Math.round(length / 2.4));
      for (let i = 0; i < bays; i++) {
        const a = [u0 + ((u1 - u0) * i) / bays, 0, v0 + ((v1 - v0) * i) / bays], b = [u0 + ((u1 - u0) * (i + 1)) / bays, 0, v0 + ((v1 - v0) * (i + 1)) / bays];
        a[1] = rise(a[0], a[2]); b[1] = rise(b[0], b[2]);
        const at = (p: number[], h: number) => [p[0], p[1] + h, p[2]];
        if (i === 0) beam(at(a, -0.2), at(a, 1.2), 0.13, 0.13);
        beam(at(b, -0.2), at(b, 1.2), 0.13, 0.13);
        beam(at(a, 1.05), at(b, 1.05), 0.04, 0.13); beam(at(a, 0.32), at(b, 0.32), 0.04, 0.13);
        beam(at(a, 0.36), at(b, 1.0), 0.035, 0.1); beam(at(a, 1.0), at(b, 0.36), 0.035, 0.1);
      }
    }
  }
}
