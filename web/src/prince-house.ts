import * as THREE from 'three';
import { pushOut, type Pushable, type Solid } from './parked';
import type { HandBuiltPlace } from './place';
import type { PrinceSite } from './prince-site';
import type { Terrain } from './terrain';
import { Mesher, seeded, type RGB } from './yard-kit';

/**
 * A house on Prince Street, Port Hawkesbury, built by hand in place of its surveyed box, with its yard: a two-storey
 * pale blue-grey clapboard house with white trim and a dark weathered shingle roof, a one-storey rear lean-to wing, a
 * stepped exterior red-brick chimney on the north-west gable, a grey fuel oil tank beside the rear wing, an enclosed
 * front entry vestibule under a shed roof, a low wooden front landing with three warm-brown steps and a white picket
 * fence, an attached gabled carport on the south-east side with curved white corner arch brackets, firewood stack,
 * green compost bin and open breezeway, a detached pale-blue backyard shed with a garden bench, concrete sidewalk
 * slabs, trimmed front hedges, a copper-russet ornamental tree, a golden shrub, a large multi-stemmed deciduous tree
 * and a south-east hedgerow.
 *
 * Layout is in house metres (see prince-site.ts): u south-east along Prince Street toward the carport, v south-west
 * away from Prince Street toward the backyard. Heights are above the level pad. Rear windows and doors of the house
 * and the sides of the shed are not seen from Prince Street and are invented to match the front bays.
 */
const hex = (value: number): RGB => { const c = new THREE.Color(value); return [c.r, c.g, c.b]; };
const shade = (k: RGB, f: number): RGB => [k[0] * f, k[1] * f, k[2] * f];

const SIDING = hex(0xc6d4de), TRIM = hex(0xf6f6f3), ROOF = hex(0x88746c), GLASS: RGB = [0.08, 0.12, 0.16];
const FOUNDATION = hex(0x969a9c), CONCRETE = hex(0xb2b4af), ASPHALT = hex(0x646567), DRIVE_TONE = hex(0x8f8d88), DRIVE_EDGE = hex(0x9b978f), SOFFIT = hex(0xe2e4e4);
const BRICK = hex(0xa65e4e), MORTAR = hex(0xc9c3ba), FLUE = hex(0x44403f), TANK = hex(0xc4c9cc);
const DOOR = hex(0xf2f2ee), STEPS = hex(0x8e563c), DECK_WOOD = hex(0x9c8773), IRON = hex(0x3a3d40);
const WOOD_ENDS = hex(0xb59571), WOOD_DARK = hex(0x624831), BIN_GREEN = hex(0x368c50), BIN_LID = hex(0x296a3c);
const HEDGE_DARK = hex(0x737636), HEDGE_MID = hex(0x8e8d3d), HEDGE_GOLD = hex(0xb89a38), HEDGE_WARM = hex(0xa36932);
const RUSSET = hex(0xbe6733), RUSSET_LIGHT = hex(0xd48144), GOLD = hex(0xdca928), GOLD_LIGHT = hex(0xedc43e);
const BARK = hex(0x746b63), TREE_GREEN = hex(0x7d8a46), TREE_GOLD = hex(0xaa9a44), BUSH_OLIVE = hex(0x6e7b3c);

/** Main two-storey gabled body: ridge runs along u at v = 0. */
export const MAIN = { u0: -7.5, u1: 1.5, half: 4.1, floor: 0.45, eave: 5.15, ridge: 7.42, over: 0.35, gableOver: 0.32 };
/** One-storey rear lean-to wing behind the main house (south-west, +v). */
export const REAR = { u0: -7.5, u1: 1.5, v0: 4.1, v1: 6.7, top: 4.35, eave: 2.85, over: 0.3 };
/** Enclosed front entry vestibule projecting from the south-east half of the front wall (-v). */
export const VESTIBULE = { u0: -2.6, u1: 1.5, v0: -5.5, v1: -4.1, top: 3.3, eave: 2.7, over: 0.3 };
/** Front wooden deck landing and steps at the south-east end. */
export const DECK = { u0: -5.6, u1: 1.5, v0: -6.5, v1: -5.5, top: 0.62 };
/** Attached south-east carport: gable ridge runs along u at v = -1.0, front flush with vestibule. */
export const CARPORT = { u0: 1.5, u1: 8.2, v0: -5.5, v1: 3.5, vMid: -1.0, half: 4.5, eave: 2.7, ridge: 4.0, over: 0.3, gableOver: 0.3 };
/** Detached backyard shed directly behind the carport: gable faces Prince Street (-v), ridge along v. */
export const SHED = { u0: 3.0, u1: 6.6, v0: 8.0, v1: 12.8, eave: 2.15, ridge: 3.25 };

export class PrinceHouse implements HandBuiltPlace {
  readonly group = new THREE.Group();
  private local = new THREE.Group();   // house axes: x is u, z is v
  private solids: Solid[] = [];
  private built = false; private fine = -1; private near = false;
  private material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private probes: { x: number; z: number }[];
  triangles = 0;

  /** `lift` turns a true height above the sea into the game's stretched height. */
  constructor(readonly site: PrinceSite, private terrain: Terrain, private lift: (metres: number) => number, private low: boolean) {
    const o = site.origin;
    this.local.position.set(o.x, 0, o.z);
    this.local.rotation.y = site.yaw;
    this.group.add(this.local);
    this.group.visible = false;
    this.probes = ([[0, 0], [5, -12], [-6, -12], [4, 10], [13, -8]] as [number, number][]).map(([u, v]) => site.world(u, v));
  }

  /** True while the house is near and its model is still to come: a picture should wait. */
  get waiting(): boolean { return this.near && !this.built; }

  private g = (u: number, v: number): number => { const w = this.site.world(u, v); return this.terrain.heightAt(w.x, w.z) ?? this.lift(this.site.level); };

  private ready(): number | null {
    let fine = 0;
    for (const p of this.probes) {
      const level = this.terrain.drawnLevelAt?.(p.x, p.z) ?? this.terrain.surfaceAt(p.x, p.z)?.level ?? null;
      if (level === null || level < 7) return null;
      if (level >= 8) fine++;
    }
    return fine;
  }

  update(view: THREE.Vector3, _now: number, car: { x: number; z: number }): void {
    const o = this.site.origin, far = Math.min(Math.hypot(view.x - o.x, view.z - o.z), Math.hypot(car.x - o.x, car.z - o.z));
    this.near = far < 900;
    if (this.near || (this.built && far < 1600)) {
      const fine = this.ready();
      const coarse = fine !== null && fine < this.probes.length;
      if (fine !== null && (!this.built || coarse !== (this.fine < this.probes.length))) {
        this.build(coarse);
        this.built = true;
        this.fine = fine;
      }
    }
    this.group.visible = this.built && far < 1600;
  }

  /** The walls, front porch, carport posts and back wall, shed, hedges and tree trunk stop the car. */
  resolveSolids(car: Pushable): void {
    if (!this.built) return;
    const b = this.site.box;
    if (car.x < b[0] || car.x > b[2] || car.z < b[1] || car.z > b[3]) return;
    pushOut(car, this.solids);
  }

  private solid(u0: number, u1: number, v0: number, v1: number): void {
    const w = this.site.world((u0 + u1) / 2, (v0 + v1) / 2);
    this.solids.push({ x: w.x, z: w.z, half: (u1 - u0) / 2, halfWidth: (v1 - v0) / 2, heading: this.site.heading(1, 0) });
  }

  private build(coarse: boolean): void {
    for (const child of [...this.local.children]) { this.local.remove(child); (child as THREE.Mesh).geometry?.dispose(); }
    this.solids = [];
    const m = new Mesher(), y = this.lift(this.site.level), rnd = seeded(1308);
    this.mainHouse(m, y);
    this.chimneyAndTank(m, y);
    this.vestibuleAndPorch(m, y);
    this.carport(m, y);
    this.shed(m, y);
    this.yard(m, rnd, coarse);
    const mesh = new THREE.Mesh(m.geometry(), this.material);
    mesh.castShadow = mesh.receiveShadow = !this.low;
    this.local.add(mesh);
    this.triangles = m.triangles;

    // House, rear wing, front vestibule/deck, chimney and oil tank.
    this.solid(MAIN.u0, MAIN.u1, -MAIN.half, REAR.v1);
    this.solid(DECK.u0, DECK.u1 + 0.85, DECK.v0, -MAIN.half);
    this.solid(MAIN.u0 - 0.72, MAIN.u0, -2.2, -0.68);
    this.solid(MAIN.u0 - 0.8, MAIN.u0, 4.3, 5.5);
    // Carport: back storage wall (including rear-middle post) and all three SE edge posts/woodpile; parking bay (u = 1.9..6.7) stays open.
    this.solid(CARPORT.u0, 4.85, CARPORT.v1 - 0.45, CARPORT.v1);
    this.solid(6.8, CARPORT.u1 + 0.1, CARPORT.v0, -2.9);
    this.solid(CARPORT.u1 - 0.25, CARPORT.u1 + 0.1, CARPORT.vMid - 0.18, CARPORT.vMid + 0.18);
    this.solid(CARPORT.u1 - 0.25, CARPORT.u1 + 0.1, CARPORT.v1 - 0.35, CARPORT.v1 + 0.05);
    // Detached backyard shed.
    this.solid(SHED.u0, SHED.u1, SHED.v0, SHED.v1);
  }

  /** A two-slope gable roof along local z, with white rake ends and white eave fascia boards. */
  private roof(m: Mesher, half: number, eave: number, ridge: number, z0: number, z1: number, over: number, k = ROOF): void {
    const drop = (over * (ridge - eave)) / half, t = 0.14;
    m.extrude([[-half - over, eave - drop], [0, ridge], [half + over, eave - drop], [half + over, eave - drop + t], [0, ridge + t], [-half - over, eave - drop + t]], z0, z1, k, TRIM);
    for (const s of [-1, 1]) m.box(s * (half + over + 0.02), eave - drop + 0.02, (z0 + z1) / 2, 0.05, 0.2, z1 - z0, TRIM);
  }

  /**
   * A framed opening (window or door) on a wall. `face`: 'u' (wall at u=plane) or 'v' (wall at v=plane);
   * `out`: +1 or -1 outward normal. `hBars` and `vBars`: interior white mullions.
   */
  private opening(m: Mesher, face: 'u' | 'v', plane: number, out: number, along: number, bottom: number, w: number, h: number, fill: RGB = GLASS, hBars = 1, vBars = 1): void {
    const part = (depth: number, yc: number, ww: number, hh: number, k: RGB) => {
      const p = plane + out * depth;
      if (face === 'u') m.box(p, yc, along, 0.05, hh, ww, k); else m.box(along, yc, p, ww, hh, 0.05, k);
    };
    part(0.025, bottom + h / 2, w + 0.18, h + 0.18, TRIM);
    part(0.048, bottom + h / 2, w, h, fill);
    for (let i = 1; i <= hBars; i++) part(0.064, bottom + (h * i) / (hBars + 1), w + 0.012, 0.05, TRIM);
    for (let i = 1; i <= vBars; i++) {
      const off = along - w / 2 + (w * i) / (vBars + 1);
      const p = plane + out * 0.064;
      if (face === 'u') m.box(p, bottom + h / 2, off, 0.05, h + 0.012, 0.05, TRIM);
      else m.box(off, bottom + h / 2, p, 0.05, h + 0.012, 0.05, TRIM);
    }
  }

  /** Horizontal 20 cm clapboard shadow lines (desktop only, keeping LOW lightweight). */
  private siding(m: Mesher, face: 'u' | 'v', plane: number, out: number, a0: number, a1: number, from: number, top: number, ridge = top, k = shade(SIDING, 0.8)): void {
    if (this.low) return;
    const mid = (a0 + a1) / 2, half = (a1 - a0) / 2, p = plane + out * 0.012;
    for (let h = from + 0.2; h < ridge - 0.18; h += 0.2) {
      const w = (h <= top ? half : (half * (ridge - h)) / (ridge - top)) - 0.08;
      if (w <= 0.12) break;
      const a = mid - w, b = mid + w, y0 = h - 0.012, y1 = h + 0.012;
      m.quad(face === 'u' ? [[p, y0, a], [p, y0, b], [p, y1, b], [p, y1, a]] : [[a, y0, p], [b, y0, p], [b, y1, p], [a, y1, p]], k);
    }
  }

  private mainHouse(m: Mesher, y: number): void {
    const under = -1.0, W = MAIN.half, mu = (MAIN.u0 + MAIN.u1) / 2;
    // Main two-storey gable shell: ridge runs along u (local z after +pi/2 yaw; local x = -v).
    m.at(0, y, 0, Math.PI / 2);
    m.extrude([[-W, under], [W, under], [W, MAIN.eave], [0, MAIN.ridge], [-W, MAIN.eave]], MAIN.u0, MAIN.u1, SIDING);
    this.roof(m, W, MAIN.eave, MAIN.ridge, MAIN.u0 - MAIN.gableOver, MAIN.u1 + MAIN.gableOver, MAIN.over);

    // Rear one-storey lean-to wing: extruded along u (local x = -v, so v = 4.1..6.7 -> x = -4.1..-6.7).
    m.extrude([[-REAR.v1, under], [-REAR.v0, under], [-REAR.v0, REAR.top], [-REAR.v1, REAR.eave]], REAR.u0, REAR.u1, SIDING);
    const rSlope = (REAR.top - REAR.eave) / (REAR.v1 - REAR.v0), rDrop = REAR.over * rSlope, rt = 0.13;
    m.extrude([
      [-REAR.v1 - REAR.over, REAR.eave - rDrop], [-REAR.v0, REAR.top],
      [-REAR.v0, REAR.top + rt], [-REAR.v1 - REAR.over, REAR.eave - rDrop + rt],
    ], REAR.u0 - 0.25, REAR.u1 + 0.25, ROOF, TRIM);

    // Back in house (u, v) frame.
    m.at(0, y, 0);
    // Rear wing back fascia.
    m.box(mu, REAR.eave - rDrop + 0.02, REAR.v1 + REAR.over + 0.02, REAR.u1 - REAR.u0 + 0.5, 0.18, 0.05, TRIM);
    // Exposed grey concrete foundation under main house and rear wing.
    m.box(mu, (MAIN.floor + under) / 2, 0, MAIN.u1 - MAIN.u0 + 0.08, MAIN.floor - under, 2 * W + 0.08, FOUNDATION);
    m.box(mu, (MAIN.floor + under) / 2, (REAR.v0 + REAR.v1) / 2, REAR.u1 - REAR.u0 + 0.08, MAIN.floor - under, REAR.v1 - REAR.v0 + 0.08, FOUNDATION);
    // White corner boards.
    for (const [u, v] of [[MAIN.u0, -W], [MAIN.u0, W], [MAIN.u1, -W], [MAIN.u1, W]]) m.box(u, (MAIN.floor + MAIN.eave) / 2, v, 0.14, MAIN.eave - MAIN.floor, 0.14, TRIM);
    for (const u of [REAR.u0, REAR.u1]) m.box(u, (MAIN.floor + REAR.eave) / 2, REAR.v1, 0.14, REAR.eave - MAIN.floor, 0.14, TRIM);

    // Front wall (-v, facing Prince Street): two upper 2x2 windows, and the 3-part ground-floor picture window.
    this.opening(m, 'v', -W, -1, -1.2, 3.45, 1.65, 1.35, GLASS, 1, 1);
    this.opening(m, 'v', -W, -1, -4.8, 3.45, 1.40, 1.35, GLASS, 1, 1);
    // Picture window: wide center pane flanked by two narrower side panes.
    const pw = 2.15, ph = 1.35, pu = -4.7, py = 1.05;
    m.box(pu, py + ph / 2, -W - 0.025, pw + 0.2, ph + 0.2, 0.05, TRIM);
    m.box(pu, py + ph / 2, -W - 0.048, pw, ph, 0.05, GLASS);
    for (const s of [-0.58, 0.58]) m.box(pu + s, py + ph / 2, -W - 0.064, 0.06, ph + 0.01, 0.05, TRIM);

    // North-west gable wall (u = -7.5): 2nd-floor 2x2 window behind the brick chimney.
    this.opening(m, 'u', MAIN.u0, -1, 1.4, 3.15, 1.05, 1.25, GLASS, 1, 1);

    // South-east gable wall (u = +1.5): two small upper windows above the carport roof + peak louver vent.
    this.opening(m, 'u', MAIN.u1, 1, -0.6, 4.15, 0.52, 0.92, GLASS, 1, 0);
    this.opening(m, 'u', MAIN.u1, 1, 0.4, 4.15, 0.52, 0.92, GLASS, 1, 0);
    m.box(MAIN.u1 + 0.03, 6.55, 0, 0.05, 0.5, 0.35, TRIM);
    m.box(MAIN.u1 + 0.05, 6.55, 0, 0.04, 0.36, 0.23, shade(SIDING, 0.5));
    // Side entry door and small window inside the carport along u = +1.5.
    this.opening(m, 'u', MAIN.u1, 1, -1.4, 0.35, 0.9, 2.0, DOOR, 0, 0);
    m.box(MAIN.u1 + 0.075, 1.65, -1.4, 0.02, 0.72, 0.52, GLASS);
    this.opening(m, 'u', MAIN.u1, 1, -3.7, 1.35, 0.65, 0.9, GLASS, 1, 0);

    // Rear wall (+v, guessed to match front bays): two upper 2x2 windows, rear lean-to back door and two windows.
    for (const u of [-4.8, -1.2]) this.opening(m, 'v', W, 1, u, 3.45, 1.2, 1.25, GLASS, 1, 1);
    this.opening(m, 'v', REAR.v1, 1, -1.2, MAIN.floor, 0.9, 2.0, DOOR, 0, 0);
    m.box(-1.2, MAIN.floor + 1.4, REAR.v1 + 0.075, 0.5, 0.65, 0.02, GLASS);
    for (const u of [-4.8, 0.2]) this.opening(m, 'v', REAR.v1, 1, u, 1.15, 1.15, 1.1, GLASS, 1, 1);

    // Siding course shadow lines on all four walls.
    this.siding(m, 'v', -W, -1, MAIN.u0, MAIN.u1, MAIN.floor, MAIN.eave);
    this.siding(m, 'v', W, 1, MAIN.u0, MAIN.u1, REAR.top, MAIN.eave);
    this.siding(m, 'v', REAR.v1, 1, REAR.u0, REAR.u1, MAIN.floor, REAR.eave);
    this.siding(m, 'u', MAIN.u0, -1, -W, W, MAIN.floor, MAIN.eave, MAIN.ridge);
    this.siding(m, 'u', MAIN.u1, 1, -W, W, CARPORT.eave, MAIN.eave, MAIN.ridge);
    this.siding(m, 'u', MAIN.u0, -1, REAR.v0, REAR.v1, MAIN.floor, REAR.eave);
    this.siding(m, 'u', MAIN.u1, 1, REAR.v0, REAR.v1, MAIN.floor, REAR.eave);
  }

  /** Exterior stepped red-brick chimney on the north-west gable and fuel oil tank beside the rear wing. */
  private chimneyAndTank(m: Mesher, y: number): void {
    m.at(0, y, 0);
    const uWall = MAIN.u0, proj = 0.62, uc = uWall - proj / 2;
    // Grey concrete plinth beneath the brick fireplace breast.
    m.box(uWall - 0.34, -0.15, -1.44, 0.72, 1.34, 1.52, FOUNDATION);
    // Wide lower brick breast (v = -2.15 .. -0.73, y = 0.52 .. 2.20).
    m.box(uc, 1.36, -1.44, proj, 1.68, 1.42, BRICK);
    // Narrower upper brick shaft rising past the north-west roof slope to y = 8.35.
    m.box(uc, (2.2 + 8.35) / 2, -1.075, proj, 8.35 - 2.2, 0.75, BRICK);
    // Sloped grey concrete shoulder on the front (-v) side (v = -2.15 -> -1.45, y = 2.20 -> 3.15).
    m.at(0, y, 0, Math.PI / 2);
    m.extrude([[1.43, 2.2], [2.17, 2.2], [2.17, 2.3], [1.43, 3.16]], uWall - proj - 0.02, uWall, CONCRETE);
    m.at(0, y, 0);
    // Concrete chimney cap and dark flue pots.
    m.box(uc, 8.4, -1.075, proj + 0.1, 0.1, 0.85, CONCRETE);
    for (const v of [-1.22, -0.93]) m.box(uc, 8.54, v, 0.24, 0.18, 0.22, FLUE);
    // Subtle pale mortar stripes on desktop for masonry texture.
    if (!this.low) {
      for (let h = 0.72; h < 2.15; h += 0.28) m.box(uWall - proj - 0.008, h, -1.44, 0.012, 0.022, 1.4, MORTAR);
      for (let h = 2.45; h < 8.25; h += 0.32) m.box(uWall - proj - 0.008, h, -1.075, 0.012, 0.022, 0.73, MORTAR);
    }

    // Light-grey cylindrical fuel oil tank on four short legs beside the rear wing (u = -7.9, v = +4.9).
    const tu = MAIN.u0 - 0.38, tv = 4.9;
    m.box(tu, 0.68, tv, 0.58, 0.56, 1.05, TANK);
    m.cyl(tu, 0.96, tv, 0.29, 1.05, TANK, 'z', 8);
    m.cyl(tu, 0.4, tv, 0.29, 1.05, shade(TANK, 0.88), 'z', 8);
    for (const [du, dv] of [[-0.18, -0.35], [0.18, -0.35], [-0.18, 0.35], [0.18, 0.35]]) m.box(tu + du, 0.12, tv + dv, 0.06, 0.36, 0.06, IRON);
    m.cyl(tu, 1.38, tv - 0.25, 0.028, 0.32, IRON, 'y', 6);
  }

  /** Enclosed front entry vestibule, front wooden landing, three warm-brown steps and white picket fence. */
  private vestibuleAndPorch(m: Mesher, y: number): void {
    const V = VESTIBULE, D = DECK, under = -0.8;
    const vu = (V.u0 + V.u1) / 2, vw = V.u1 - V.u0;
    // Vestibule box and shed roof sloping down from under the 2nd-floor windows to meet the carport eave.
    m.at(0, y, 0, Math.PI / 2);
    m.extrude([[-V.v1, under], [-V.v0, under], [-V.v0, V.eave], [-V.v1, V.top]], V.u0, V.u1, SIDING);
    const vSlope = (V.top - V.eave) / (V.v1 - V.v0), vDrop = V.over * vSlope, vt = 0.12;
    m.extrude([
      [-V.v1, V.top], [-V.v0 + V.over, V.eave - vDrop],
      [-V.v0 + V.over, V.eave - vDrop + vt], [-V.v1, V.top + vt],
    ], V.u0 - 0.22, V.u1 + 0.02, ROOF, TRIM);

    m.at(0, y, 0);
    // Vestibule front fascia, foundation and NW corner board.
    m.box(vu - 0.1, V.eave - vDrop + 0.01, V.v0 - V.over - 0.02, vw + 0.26, 0.17, 0.05, TRIM);
    m.box(vu, (MAIN.floor + under) / 2, (V.v0 + V.v1) / 2, vw + 0.06, MAIN.floor - under, V.v1 - V.v0 + 0.06, FOUNDATION);
    m.box(V.u0, (MAIN.floor + V.eave) / 2, V.v0, 0.12, V.eave - MAIN.floor, 0.12, TRIM);
    this.siding(m, 'v', V.v0, -1, V.u0, V.u1, MAIN.floor, V.eave);
    this.siding(m, 'u', V.u0, -1, V.v0, V.v1, MAIN.floor, V.eave);

    // Vestibule front door (white storm door with tall divided glass), sconce light (no numbers) and small 1x2 window.
    this.opening(m, 'v', V.v0, -1, -1.55, D.top, 0.96, 2.02, DOOR, 0, 0);
    m.box(-1.55, D.top + 1.18, V.v0 - 0.075, 0.56, 1.32, 0.02, GLASS);
    m.box(-1.55, D.top + 1.18, V.v0 - 0.088, 0.58, 0.04, 0.02, TRIM);
    m.box(-1.55, D.top + 1.52, V.v0 - 0.088, 0.58, 0.04, 0.02, TRIM);
    m.box(-1.14, D.top + 0.98, V.v0 - 0.09, 0.04, 0.12, 0.06, IRON);
    m.box(-0.55, 1.88, V.v0 - 0.08, 0.12, 0.22, 0.12, TRIM);        // porch wall sconce
    this.opening(m, 'v', V.v0, -1, 0.55, 1.42, 0.72, 1.0, GLASS, 1, 0);

    // Low wooden porch landing across the front of the vestibule and picture window.
    const du = (D.u0 + D.u1) / 2, dw = D.u1 - D.u0;
    m.box(du, D.top - 0.04, (D.v0 + D.v1) / 2, dw, 0.08, D.v1 - D.v0, DECK_WOOD);
    m.box(du, (D.top - 0.08) / 2, (D.v0 + D.v1) / 2, dw - 0.08, D.top - 0.08, D.v1 - D.v0 - 0.08, shade(DECK_WOOD, 0.65));
    // Three warm-brown wooden steps at the SE end, stepping down to the driveway edge.
    for (let i = 0; i < 3; i++) {
      const top = D.top - (i + 1) * 0.19, u0 = D.u1 + i * 0.28;
      m.box(u0 + 0.15, top / 2, (D.v0 + D.v1) / 2, 0.3, Math.max(0.08, top), D.v1 - D.v0 - 0.06, STEPS);
      m.box(u0 + 0.16, top + 0.015, (D.v0 + D.v1) / 2, 0.32, 0.035, D.v1 - D.v0, shade(STEPS, 1.15));
    }

    // White vertical picket fence along the front of the landing and returning at the NW end.
    const fz = D.v0 - 0.04, fTop = 1.08;
    for (const ry of [0.35, 0.85]) {
      m.box((D.u0 + D.u1) / 2, ry, fz + 0.03, dw, 0.055, 0.04, TRIM);
      m.box(D.u0, ry, (fz + -MAIN.half) / 2, 0.04, 0.055, -MAIN.half - fz, TRIM);
    }
    if (this.low) {
      // Simpler slatted fence on LOW.
      m.box((D.u0 + D.u1) / 2, fTop / 2, fz, dw, fTop, 0.03, TRIM);
      m.box(D.u0, fTop / 2, (fz + -MAIN.half) / 2, 0.03, fTop, -MAIN.half - fz, TRIM);
    } else {
      for (let u = D.u0; u <= D.u1 - 0.02; u += 0.16) m.box(u, fTop / 2, fz, 0.085, fTop, 0.025, TRIM);
      for (let v = fz + 0.16; v < -MAIN.half; v += 0.16) m.box(D.u0, fTop / 2, v, 0.025, fTop, 0.085, TRIM);
    }
  }

  /** Attached south-east gabled carport with arched front corner brackets, woodpile and green compost bin. */
  private carport(m: Mesher, y: number): void {
    const C = CARPORT, cw = C.u1 - C.u0, cu = (C.u0 + C.u1) / 2;
    // Gable roof with ridge along u at v = C.vMid (-1.0); rotated frame has local x = -(v - vMid), local z = u.
    m.at(0, y, C.vMid, Math.PI / 2);
    this.roof(m, C.half, C.eave, C.ridge, C.u0 - 0.05, C.u1 + C.gableOver, C.over);
    // Pale-blue gable triangle on the south-east end (u = C.u1).
    m.extrude([[-C.half, C.eave - 0.08], [C.half, C.eave - 0.08], [0, C.ridge]], C.u1 - 0.14, C.u1, SIDING);

    m.at(0, y, 0);
    // Shaded ceiling / soffit underside and weathered asphalt/concrete carport floor slab.
    m.box(cu, C.eave - 0.12, C.vMid, cw, 0.08, 2 * C.half - 0.1, SOFFIT);
    m.box(cu, 0.025, C.vMid, cw - 0.1, 0.05, 2 * C.half - 0.1, ASPHALT);

    // Front beam, white posts (front-NW with decorative collar, front-SE, mid-SE, rear-SE) and SE beam.
    m.box(cu, C.eave - 0.18, C.v0 + 0.08, cw, 0.32, 0.18, TRIM);
    m.box(C.u1 - 0.08, C.eave - 0.18, C.vMid, 0.18, 0.3, 2 * C.half, TRIM);
    const post = (u: number, v: number) => m.box(u, (C.eave - 0.15) / 2, v, 0.16, C.eave - 0.15, 0.16, TRIM);
    post(C.u0 + 0.18, C.v0 + 0.08);
    m.box(C.u0 + 0.18, 1.72, C.v0 + 0.08, 0.22, 0.08, 0.22, TRIM);   // decorative post collar
    post(C.u1 - 0.08, C.v0 + 0.08);
    post(C.u1 - 0.08, C.vMid);
    post(C.u1 - 0.08, C.v1 - 0.12);

    // Curved white corner arch brackets at both top corners of the carport front opening.
    const r = 0.64, topY = C.eave - 0.32, segs = this.low ? 4 : 7;
    const spandrel = (cornerU: number, dir: 1 | -1) => {
      const cx = cornerU + dir * r, cy = topY - r;
      const pts: number[][] = [[cornerU, topY]];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * (Math.PI / 2);
        pts.push([cx - dir * Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      // Ensure counter-clockwise winding for dir = +1 vs -1.
      if (dir === 1) pts.reverse();
      m.extrude(pts, C.v0 + 0.02, C.v0 + 0.14, TRIM);
    };
    spandrel(C.u0 + 0.24, 1);
    spandrel(C.u1 - 0.14, -1);

    // Enclosed rear storage wall behind the right parking bay (u = 1.5 .. 4.7), leaving a clear SE breezeway to the shed.
    m.box((C.u0 + 4.7) / 2, (C.eave - 0.12) / 2, C.v1 - 0.12, 4.7 - C.u0, C.eave - 0.12, 0.18, shade(SIDING, 0.78));
    post(4.72, C.v1 - 0.12);
    this.siding(m, 'v', C.v1 - 0.21, -1, C.u0, 4.7, 0.1, C.eave - 0.15, C.eave - 0.15, shade(SIDING, 0.62));

    // Stacked firewood pile behind the front-SE post (u = 6.9..8.0, v = -4.2..-3.1, height 1.55 m).
    m.box(7.45, 0.78, -3.65, 1.05, 1.56, 1.02, WOOD_ENDS);
    if (!this.low) {
      for (let row = 0; row < 7; row++) {
        m.box(7.45, 0.18 + row * 0.21, -4.17, 1.02, 0.028, 0.02, WOOD_DARK);
        for (let col = 0; col < 4; col++) m.box(7.08 + col * 0.25 + (row % 2) * 0.07, 0.18 + row * 0.21, -4.175, 0.022, 0.16, 0.02, WOOD_DARK);
      }
    }
    // Green wheeled compost bin in front of the firewood stack.
    m.box(7.35, 0.5, -4.65, 0.54, 0.98, 0.6, BIN_GREEN);
    m.box(7.35, 1.02, -4.65, 0.58, 0.08, 0.64, BIN_LID);
    for (const s of [-0.26, 0.26]) m.cyl(7.35 + s, 0.11, -4.4, 0.11, 0.05, IRON, 'x', 6);
  }

  /** Detached pale-blue gabled backyard shed behind the carport, with its front garden bench. */
  private shed(m: Mesher, y: number): void {
    const S = SHED, su = (S.u0 + S.u1) / 2, sh = (S.u1 - S.u0) / 2;
    m.at(su, y, 0);
    m.extrude([[-sh, -0.8], [sh, -0.8], [sh, S.eave], [0, S.ridge], [-sh, S.eave]], S.v0, S.v1, SIDING);
    this.roof(m, sh, S.eave, S.ridge, S.v0 - 0.22, S.v1 + 0.22, 0.24, ROOF);
    m.at(0, y, 0);
    for (const [u, v] of [[S.u0, S.v0], [S.u1, S.v0], [S.u0, S.v1], [S.u1, S.v1]]) m.box(u, S.eave / 2, v, 0.11, S.eave, 0.11, TRIM);
    m.box(su, S.eave, S.v0 - 0.03, S.u1 - S.u0, 0.12, 0.05, TRIM);
    this.siding(m, 'v', S.v0, -1, S.u0, S.u1, 0.1, S.eave, S.ridge);
    this.siding(m, 'u', S.u1, 1, S.v0, S.v1, 0.1, S.eave);
    // Guessed side window on SE wall.
    this.opening(m, 'u', S.u1, 1, (S.v0 + S.v1) / 2, 1.05, 0.72, 0.68, GLASS, 1, 1);

    // Small garden bench against the front gable wall (visible through the open carport).
    m.box(su, 0.44, S.v0 - 0.34, 1.38, 0.06, 0.44, DECK_WOOD);
    m.box(su, 0.78, S.v0 - 0.15, 1.38, 0.44, 0.05, DECK_WOOD);
    for (const s of [-0.62, 0.62]) {
      m.box(su + s, 0.32, S.v0 - 0.34, 0.05, 0.64, 0.44, IRON);
    }
    // Small hanging planter above the bench.
    m.cyl(su, 1.42, S.v0 - 0.22, 0.14, 0.16, IRON, 'y', 6, 0.09);
    m.cyl(su, 1.54, S.v0 - 0.22, 0.17, 0.14, HEDGE_MID, 'y', 6, 0.11);
  }

  /** A continuous trimmed autumn hedge following the ground slope, densely textured in olive, gold and bronze. */
  private hedge(m: Mesher, u0: number, u1: number, v: number, h: number, depthM: number, rnd: () => number): void {
    const len = u1 - u0, segs = Math.max(2, Math.round(len / 0.95));
    for (let i = 0; i < segs; i++) {
      const a = u0 + (len * i) / segs, b = u0 + (len * (i + 1)) / segs, uc = (a + b) / 2;
      const gy = this.g(uc, v), w = b - a + 0.08;
      m.at(uc, gy, v);
      m.box(0, h * 0.43, 0, w, h * 0.88, depthM * 0.92, shade(HEDGE_DARK, 0.95 + rnd() * 0.14));
      m.box(0, h * 0.88, 0, w, h * 0.18, depthM * 0.72, shade(HEDGE_MID, 0.92 + rnd() * 0.18));
      const clumps = this.low ? 3 : 8;
      for (let c = 0; c < clumps; c++) {
        const cu = a + (b - a) * rnd();
        const onTop = c < Math.ceil(clumps / 2);
        const cv = onTop ? v + (rnd() - 0.5) * depthM * 0.78 : v - depthM * (0.36 + rnd() * 0.18);
        const ch = onTop ? h * (0.8 + rnd() * 0.26) : h * (0.34 + rnd() * 0.56);
        const r = 0.22 + rnd() * 0.14;
        const k = c % 4 === 0 ? HEDGE_WARM : c % 3 === 0 ? HEDGE_GOLD : HEDGE_MID;
        m.at(cu, gy, cv, rnd() * 6.3);
        m.cyl(0, ch, 0, r, 0.26 + rnd() * 0.14, shade(k, 0.88 + rnd() * 0.24), 'y', 5, r * 0.65);
      }
    }
    this.solid(u0, u1, v - depthM / 2, v + depthM / 2);
  }

  /** A rounded ornamental shrub made of layered foliage clumps. */
  private bush(m: Mesher, u: number, v: number, r: number, h: number, k0: RGB, k1: RGB, rnd: () => number, clumps = 6): void {
    const y = this.g(u, v), n = this.low ? Math.max(2, Math.ceil(clumps / 2)) : clumps;
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.3, d = i ? r * (0.28 + rnd() * 0.35) : 0, cr = r * (i ? 0.45 + rnd() * 0.25 : 0.7), ch = h * (i ? 0.58 + rnd() * 0.35 : 0.92);
      const k = i % 2 ? k1 : k0;
      m.at(u + Math.cos(a) * d, y, v + Math.sin(a) * d, rnd() * 6.3);
      m.cyl(0, ch * 0.45, 0, cr, ch * 0.85, shade(k, 0.9 + rnd() * 0.2), 'y', this.low ? 5 : 7, cr * 0.5, shade(k, 1.08));
    }
  }

  /** A ground-hugging quad strip with tucked edges so it stays above terrain triangles at 2.5x vertical exaggeration. */
  private groundStrip(m: Mesher, u0: number, u1: number, v0: number, v1: number, liftM: number, k: RGB, nu: number, nv: number, skirt = 0.14): void {
    m.at(0, 0, 0);
    const P = (i: number, j: number, dy = liftM): number[] => {
      const u = u0 + ((u1 - u0) * i) / nu, v = v0 + ((v1 - v0) * j) / nv;
      return [u, this.g(u, v) + dy, v];
    };
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      m.quad([P(i, j), P(i, j + 1), P(i + 1, j + 1), P(i + 1, j)], k);
    }
    if (skirt > 0) {
      const ek = shade(k, 0.84), lowY = liftM - skirt;
      for (let i = 0; i < nu; i++) {
        m.quad([P(i, 0), P(i + 1, 0), P(i + 1, 0, lowY), P(i, 0, lowY)], ek);
        m.quad([P(i + 1, nv), P(i, nv), P(i, nv, lowY), P(i + 1, nv, lowY)], ek);
      }
      for (let j = 0; j < nv; j++) {
        m.quad([P(0, j + 1), P(0, j), P(0, j, lowY), P(0, j + 1, lowY)], ek);
        m.quad([P(nu, j), P(nu, j + 1), P(nu, j + 1, lowY), P(nu, j, lowY)], ek);
      }
    }
  }

  /** Scale ground-hugging lifts above default 2.5x vertical exaggeration (up to 3x). */
  private liftScale(): number {
    return Math.max(1, (this.lift(this.site.level + 1) - this.lift(this.site.level)) / 2.5);
  }

  /** Single joined tapered driveway surface from Prince Street to the carport, mottled grey and clear of terrain triangles. */
  private driveway(m: Mesher, rnd: () => number, coarse: boolean): void {
    m.at(0, 0, 0);
    // Level-7 terrain uses 4 m cells across the pad blend, so lift extra until all probes reach level 8 (2 m cells).
    const v0 = -18.9, v1 = -5.3, nu = this.low ? 3 : 4, nv = this.low ? 10 : 16, scale = this.liftScale();
    const liftM = (coarse ? 0.28 : 0.15) * scale, skirt = liftM + 0.2;
    const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const pt = (i: number, j: number, dy = liftM): number[] => {
      const v = v0 + ((v1 - v0) * j) / nv;
      const flare = smooth(-16.2, v0, v);
      const uL = 2.75 - 0.5 * flare, uR = 7.45 + 0.6 * flare;
      const u = uL + ((uR - uL) * i) / nu;
      return [u, this.g(u, v) + dy, v];
    };
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const edge = i === 0 || i === nu - 1;
      const base = edge ? DRIVE_EDGE : DRIVE_TONE;
      m.quad([pt(i, j), pt(i, j + 1), pt(i + 1, j + 1), pt(i + 1, j)], shade(base, 0.91 + rnd() * 0.17));
    }
    const ek = shade(DRIVE_EDGE, 0.82), lowY = liftM - skirt;
    for (let j = 0; j < nv; j++) {
      m.quad([pt(0, j + 1), pt(0, j), pt(0, j, lowY), pt(0, j + 1, lowY)], ek);
      m.quad([pt(nu, j), pt(nu, j + 1), pt(nu, j + 1, lowY), pt(nu, j, lowY)], ek);
    }
  }

  /** Driveway surface, sidewalk slabs, front hedges, ornamental russet tree, golden shrub, large SE tree and SE hedgerow. */
  private yard(m: Mesher, rnd: () => number, coarse: boolean): void {
    // Single joined mottled weathered grey driveway from Prince Street edge to the carport mouth.
    this.driveway(m, rnd, coarse);

    // Concrete sidewalk slabs following the real street slope (broken cleanly across the driveway mouth).
    const slabRow = (u0: number, u1: number) => {
      const step = 1.35, v0 = -17.6, v1 = -16.3, scale = this.liftScale();
      const liftM = (coarse ? 0.24 : 0.125) * scale, skirt = liftM + 0.2;
      for (let u = u0; u < u1 - 0.1; u += step) {
        const ue = Math.min(u + step - 0.04, u1);
        this.groundStrip(m, u, ue, v0, v1, liftM, shade(CONCRETE, 0.95 + rnd() * 0.09), this.low ? 1 : 2, this.low ? 1 : 2, skirt);
      }
    };
    slabRow(-9.0, 2.25);
    slabRow(8.05, 17.4);

    // Front trimmed hedges: main run, narrow NW gap and short NW block; SE hedge on the far side of the driveway.
    this.hedge(m, -4.6, 2.2, -14.8, 1.24, 1.0, rnd);
    this.hedge(m, -7.6, -5.6, -14.8, 1.24, 1.0, rnd);
    this.hedge(m, 10.2, 17.2, -14.8, 1.24, 1.0, rnd);

    // Copper-russet ornamental small tree in front of the NW corner of the house (airy multi-clump crown).
    const ou = -6.5, ov = -9.4, oy = this.g(ou, ov);
    for (let i = 0; i < 3; i++) {
      m.at(ou, oy, ov, i * 2.1 + 0.4, 0, 0.22);
      m.cyl(0, 0.95, 0, 0.06, 1.9, BARK, 'y', 5, 0.025);
    }
    const oClumps = this.low ? 5 : 14;
    for (let i = 0; i < oClumps; i++) {
      const a = rnd() * 6.3, d = i < 2 ? 0.25 : 0.45 + rnd() * 1.05, ch = 1.65 + rnd() * 1.45, cr = 0.45 + rnd() * 0.3;
      const k = i % 2 ? RUSSET_LIGHT : RUSSET;
      m.at(ou + Math.cos(a) * d, oy, ov + Math.sin(a) * d, rnd() * 6.3);
      m.cyl(0, ch, 0, cr, cr * 0.95, shade(k, 0.9 + rnd() * 0.22), 'y', this.low ? 5 : 6, cr * 0.55);
    }

    // Bright golden-yellow low spirea shrub on the SE side of the driveway.
    this.bush(m, 10.2, -8.6, 1.15, 1.05, GOLD, GOLD_LIGHT, rnd, 8);

    // Large multi-stemmed deciduous tree on the SE lawn (LiDAR height ~6.5 m): spreading bare limbs with airy late-autumn clusters.
    const tu = 13.2, tv = -7.8, ty = this.g(tu, tv);
    m.at(tu, ty, tv);
    m.cyl(0, 1.1, 0, 0.24, 2.2, BARK, 'y', 7, 0.16);
    const limbs: [number, number, number, number][] = [
      [0.2, 0.34, 3.8, 0.095], [1.45, 0.38, 3.6, 0.09], [2.7, 0.32, 3.9, 0.095],
      [3.95, 0.36, 3.5, 0.085], [5.15, 0.35, 3.7, 0.09],
      [0.85, 0.5, 2.9, 0.06], [2.1, 0.48, 3.0, 0.06], [4.55, 0.52, 2.8, 0.055],
    ];
    for (const [ang, tilt, len, rad] of limbs) {
      m.at(tu, ty + 1.45, tv, ang, 0, tilt);
      m.cyl(0, len / 2, 0, rad, len, BARK, 'y', 5, rad * 0.38);
    }
    const tClumps = this.low ? 5 : 13;
    for (let i = 0; i < tClumps; i++) {
      const [ang, tilt, len] = limbs[i % limbs.length];
      const frac = i < limbs.length ? 0.85 : 0.65 + rnd() * 0.25;
      const reach = len * frac * Math.sin(tilt), ch = 1.45 + len * frac * Math.cos(tilt) + (rnd() - 0.5) * 0.45;
      const a = ang + (rnd() - 0.5) * 0.35, cr = 0.48 + rnd() * 0.3;
      const k = i % 2 === 0 ? TREE_GOLD : TREE_GREEN;
      m.at(tu + Math.sin(a) * reach, ty, tv + Math.cos(a) * reach, rnd() * 6.3);
      m.cyl(0, ch, 0, cr, cr * 0.72, shade(k, 0.9 + rnd() * 0.22), 'y', 5, cr * 0.58);
    }
    this.solid(tu - 0.32, tu + 0.32, tv - 0.32, tv + 0.32);

    // Tall deciduous hedgerow along the SE property line (u ≈ +14.5, v = -2.5 .. +12.5).
    for (const [bu, bv, r, h] of [
      [14.3, -2.5, 1.35, 2.1], [14.5, 0.4, 1.45, 2.4], [14.6, 3.4, 1.55, 2.7],
      [14.5, 6.6, 1.6, 2.9], [14.7, 9.6, 1.6, 3.1], [14.6, 12.4, 1.5, 3.0],
    ] as [number, number, number, number][]) {
      this.bush(m, bu, bv, r, h, BUSH_OLIVE, HEDGE_MID, rnd, 4);
    }
  }
}
