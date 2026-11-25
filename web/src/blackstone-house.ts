import * as THREE from 'three';
import type { BlackstoneSite } from './blackstone-site';
import { pushOut, type Pushable, type Solid } from './parked';
import type { HandBuiltPlace } from './place';
import type { Terrain } from './terrain';
import { Mesher, seeded, type RGB } from './yard-kit';

/**
 * A house on Blackstone Road (Mabou area), built by hand in place of its surveyed box (building 1454), with its yard
 * and outbuildings:
 * - deep royal-blue vertical board-and-batten house with crisp white trim and dark charcoal asphalt-shingle roofs;
 * - taller two-storey north-west gable wing with belt-course trim, square white-framed windows and two roof skylights;
 * - lower 1.5-storey main wing with a small front shed dormer, a large three-part front picture window and electric meter;
 * - steep front projecting gable entry vestibule with white glazed door, sidelights, gable floodlight, warm reddish-brown
 *   wooden porch, white diagonal lattice skirting, front steps and concrete stepping slabs;
 * - stacked two-storey reddish-brown wooden deck on the south-east gable with front stairs down to the gravel drive;
 * - small west blue gambrel shed with white double barn doors;
 * - large east two-storey blue gambrel barn/garage with a dark reddish-brown garage door, upper loft window and side
 *   windows, flanked by two white/grey arched hoop storage shelters and a stacked lumber pile;
 * - red wooden roadside parcel chest with white slanted lid beside the relocated green mailbox, wooden garden bench on a
 *   concrete pad, west backyard wooden playset, late-autumn deciduous trees on the west lawn, an autumn roadside shrub
 *   and a staked sapling on the east lawn (the gravel driveways and mown lawn are painted on the terrain in blackstone-site.ts).
 *
 * Layout is in house metres (see blackstone-site.ts): u east-south-east toward the east barn, v south-south-west away
 * from Blackstone Road. Heights on the main house are above the level pad; detached structures and yard props follow the
 * local ground. Rear windows not seen from the road are invented to match the front bays. No civic number, no names,
 * no lettering, no resident vehicles or custom dogs.
 */
const hex = (value: number): RGB => { const c = new THREE.Color(value); return [c.r, c.g, c.b]; };
const shade = (k: RGB, f: number): RGB => [k[0] * f, k[1] * f, k[2] * f];

const BLUE = hex(0x2d5ca8), BLUE_SHED = hex(0x305ea3), TRIM = hex(0xeeeee8), ROOF = hex(0x747980);
const GLASS: RGB = [0.09, 0.13, 0.18], SKYLIGHT_GLASS: RGB = [0.24, 0.30, 0.37];
const FOUNDATION = hex(0xa2a6a3), CONCRETE = hex(0xbabcb5), DOOR_WHITE = hex(0xf2f2ec);
const BARN_DOOR = hex(0x7d392b), DECK_WOOD = hex(0x9e5338), BENCH_WOOD = hex(0xaa6444);
const LATTICE_BG = hex(0xe2e2da), LATTICE_GAP = hex(0x464b50), METER = hex(0xa6aaa8), IRON = hex(0x3c4044);
const HOOP_END = hex(0xe6e7e2), HOOP_TARP_W = hex(0xc2c6c8), HOOP_TARP_E = hex(0x8899aa), LUMBER = hex(0xc6a374), LUMBER_DARK = hex(0x8c6b44);
const PARCEL_RED = hex(0xc22b26), PLAYSET_WOOD = hex(0xab8258), PLAYSET_ROOF = hex(0xcbc4ad);
const BARK = hex(0x70675c), BARK_LIGHT = hex(0x867d72), TREE_GOLD = hex(0xaa9642), TREE_OLIVE = hex(0x7c8644), TREE_RUSSET = hex(0xa46234);
const SHRUB_RUST = hex(0x946138), SHRUB_OLIVE = hex(0x73763b), SHRUB_GOLD = hex(0xb2943c);

/** Taller two-storey NW gable wing: ridge runs along u at v = 0. */
export const NW_WING = { u0: -5.6, u1: -1.4, half: 4.1, floor: 0.32, belt: 3.1, eave: 5.5, ridge: 8.2, over: 0.36, gableOver: 0.3 };
/** Lower 1.5-storey main wing: ridge runs along u at v = 0. */
export const MAIN = { u0: -1.4, u1: 5.0, half: 4.1, floor: 0.32, eave: 3.1, ridge: 6.2, over: 0.36, gableOver: 0.3 };
/** Front projecting gable entry vestibule on the road side (-v): ridge runs along v at u = 1.15. */
export const VESTIBULE = { u0: -0.2, u1: 2.5, v0: -6.0, v1: -4.1, eave: 2.95, ridge: 5.15, over: 0.28 };
/** Front wooden porch landing and stairs in front of the vestibule. */
export const PORCH = { u0: -0.2, u1: 2.5, v0: -7.25, v1: -6.0, floor: 1.05, rail: 1.98, stairU0: 0.35, stairU1: 1.95, stairV0: -8.65 };
/** Stacked two-storey wooden deck on the SE gable end (+u). */
export const SE_DECK = { u0: 5.0, u1: 7.8, v0: -3.6, v1: 3.4, upperV1: 1.8, lowerFloor: 1.35, upperFloor: 3.75, stairU0: 5.4, stairU1: 7.2, stairV0: -5.3 };
/** Small west blue gambrel shed: doors face +u toward the house and driveway. */
export const WEST_SHED = { u0: -19.8, u1: -16.2, v0: -9.9, v1: -7.1, eave: 1.95, knuckle: 2.72, ridge: 3.15 };
/** Large east two-storey blue gambrel barn/garage: garage door faces -u toward the house and driveway. */
export const EAST_BARN = { u0: 39.2, u1: 47.8, v0: 0.9, v1: 7.1, eave: 2.75, knuckle: 4.65, ridge: 5.65 };
/** Flanking arched fabric hoop storage shelters west and east of the east barn. */
export const HOOP_WEST = { u0: 33.8, u1: 36.8, v0: 2.6, v1: 7.8, wall: 1.35, ridge: 2.5 };
export const HOOP_EAST = { u0: 48.0, u1: 51.0, v0: 1.2, v1: 5.8, wall: 1.3, ridge: 2.4 };
/** Red wooden parcel chest beside the relocated dark-green mailbox at the west driveway entrance. */
export const PARCEL_BOX = { u: -12.3, v: -19.0 };

export class BlackstoneHouse implements HandBuiltPlace {
  readonly group = new THREE.Group();
  private local = new THREE.Group();   // house axes: x is u, z is v
  private solids: Solid[] = [];
  private built = false; private fine = -1; private near = false;
  private material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private probes: { x: number; z: number }[];
  triangles = 0;

  /** `lift` turns a true height above the sea into the game's stretched height. */
  constructor(readonly site: BlackstoneSite, private terrain: Terrain, private lift: (metres: number) => number, private low: boolean) {
    const o = site.origin;
    this.local.position.set(o.x, 0, o.z);
    this.local.rotation.y = site.yaw;
    this.group.add(this.local);
    this.group.visible = false;
    this.probes = ([[0, 0], [0, -14], [25, -4], [43, 3], [-16, -9]] as [number, number][]).map(([u, v]) => site.world(u, v));
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
        this.build();
        this.built = true;
        this.fine = fine;
      }
    }
    this.group.visible = this.built && far < 1600;
  }

  /** House, porches/decks, sheds, barn, hoop shelters, lumber pile, parcel chest and west maple trunks stop the car. */
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

  private build(): void {
    for (const child of [...this.local.children]) { this.local.remove(child); (child as THREE.Mesh).geometry?.dispose(); }
    this.solids = [];
    const m = new Mesher(), y = this.lift(this.site.level), rnd = seeded(1454);
    this.mainHouse(m, y);
    this.vestibuleAndPorch(m, y);
    this.seTwoStoreyDeck(m, y);
    this.westGambrelShed(m);
    this.eastGambrelBarn(m);
    this.hoopShelter(m, HOOP_WEST, HOOP_TARP_W);
    this.hoopShelter(m, HOOP_EAST, HOOP_TARP_E);
    this.yard(m, y, rnd);
    const mesh = new THREE.Mesh(m.geometry(), this.material);
    mesh.castShadow = mesh.receiveShadow = !this.low;
    this.local.add(mesh);
    this.triangles = m.triangles;

    // Collision solids: house body, vestibule/porch/stairs, SE deck/stairs, outbuildings, lumber, parcel box.
    this.solid(NW_WING.u0, MAIN.u1, -MAIN.half, MAIN.half);
    this.solid(PORCH.u0, PORCH.u1, PORCH.stairV0, -MAIN.half);
    this.solid(SE_DECK.u0, SE_DECK.u1, SE_DECK.stairV0, SE_DECK.v1);
    this.solid(WEST_SHED.u0, WEST_SHED.u1, WEST_SHED.v0, WEST_SHED.v1);
    this.solid(EAST_BARN.u0, EAST_BARN.u1, EAST_BARN.v0, EAST_BARN.v1);
    this.solid(HOOP_WEST.u0, HOOP_WEST.u1, HOOP_WEST.v0, HOOP_WEST.v1);
    this.solid(HOOP_EAST.u0, HOOP_EAST.u1, HOOP_EAST.v0, HOOP_EAST.v1);
    this.solid(18.0, 24.5, 4.4, 6.6);                                          // lumber stack
    this.solid(-15.0, -12.0, 5.2, 7.8);                                        // west backyard playset
    this.solid(PARCEL_BOX.u - 0.5, PARCEL_BOX.u + 0.5, PARCEL_BOX.v - 0.4, PARCEL_BOX.v + 0.4);
  }

  /** A two-slope gable roof along local z, with white rake ends and white eave fascia boards. */
  private roof(m: Mesher, half: number, eave: number, ridge: number, z0: number, z1: number, over: number, k = ROOF): void {
    const drop = (over * (ridge - eave)) / half, t = 0.14;
    m.extrude([[-half - over, eave - drop], [0, ridge], [half + over, eave - drop], [half + over, eave - drop + t], [0, ridge + t], [-half - over, eave - drop + t]], z0, z1, k, TRIM);
    for (const s of [-1, 1]) m.box(s * (half + over + 0.02), eave - drop + 0.02, (z0 + z1) / 2, 0.05, 0.2, z1 - z0, TRIM);
  }

  /** A gambrel roof profile along local z, with white rake ends and white eave fascia boards. */
  private gambrelRoof(m: Mesher, half: number, eave: number, knuckle: number, ridge: number, z0: number, z1: number, over: number, k = ROOF): void {
    const kh = half * 0.68, t = 0.12;
    const drop = (over * (knuckle - eave)) / (half - kh);
    m.extrude([
      [-half - over, eave - drop], [-kh, knuckle], [0, ridge], [kh, knuckle], [half + over, eave - drop],
      [half + over, eave - drop + t], [kh, knuckle + t], [0, ridge + t], [-kh, knuckle + t], [-half - over, eave - drop + t],
    ], z0, z1, k, TRIM);
    for (const s of [-1, 1]) m.box(s * (half + over + 0.02), eave - drop + 0.02, (z0 + z1) / 2, 0.05, 0.16, z1 - z0, TRIM);
  }

  /** Framed window or door opening on a wall in house (u, v) coordinates. */
  private opening(m: Mesher, face: 'u' | 'v', plane: number, out: number, along: number, bottom: number, w: number, h: number, fill: RGB = GLASS, hBars = 0, vBars = 0): void {
    const part = (depth: number, yc: number, ww: number, hh: number, k: RGB) => {
      const p = plane + out * depth;
      if (face === 'u') m.box(p, yc, along, 0.05, hh, ww, k); else m.box(along, yc, p, ww, hh, 0.05, k);
    };
    part(0.026, bottom + h / 2, w + 0.18, h + 0.18, TRIM);
    part(0.048, bottom + h / 2, w, h, fill);
    for (let i = 1; i <= hBars; i++) part(0.064, bottom + (h * i) / (hBars + 1), w + 0.012, 0.045, TRIM);
    for (let i = 1; i <= vBars; i++) {
      const off = along - w / 2 + (w * i) / (vBars + 1);
      const p = plane + out * 0.064;
      if (face === 'u') m.box(p, bottom + h / 2, off, 0.05, h + 0.012, 0.045, TRIM);
      else m.box(off, bottom + h / 2, p, 0.045, h + 0.012, 0.05, TRIM);
    }
  }

  /** Vertical board-and-batten shadow strips (desktop only, keeping LOW lightweight). */
  private verticalSiding(m: Mesher, face: 'u' | 'v', plane: number, out: number, a0: number, a1: number, from: number, eave: number, ridge = eave, k = shade(BLUE, 0.78)): void {
    if (this.low) return;
    const mid = (a0 + a1) / 2, half = (a1 - a0) / 2, p = plane + out * 0.012;
    for (let a = a0 + 0.4; a < a1 - 0.15; a += 0.42) {
      const top = ridge > eave ? eave + (ridge - eave) * Math.max(0, 1 - Math.abs(a - mid) / half) : eave;
      const h = top - from;
      if (h < 0.25) continue;
      const aL = a - 0.018, aR = a + 0.018;
      m.quad(face === 'u' ? [[p, from, aL], [p, from, aR], [p, top, aR], [p, top, aL]] : [[aL, from, p], [aR, from, p], [aR, top, p], [aL, top, p]], k);
    }
  }

  /** Wooden railing span between (u0, v0) and (u1, v1) from floor y0 to top rail y1. */
  private railing(m: Mesher, u0: number, v0: number, u1: number, v1: number, y0: number, y1: number, k = DECK_WOOD): void {
    const du = u1 - u0, dv = v1 - v0, len = Math.hypot(du, dv);
    if (len < 0.05) return;
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, alongU = Math.abs(du) >= Math.abs(dv);
    // Top cap rail and bottom rail.
    const rail = (ry: number, sy: number, thick: number) => alongU
      ? m.box(cu, ry, cv, len, sy, thick, k)
      : m.box(cu, ry, cv, thick, sy, len, k);
    rail(y1, 0.075, 0.11);
    rail(y0 + 0.1, 0.055, 0.07);
    // End posts.
    for (const [pu, pv] of [[u0, v0], [u1, v1]]) m.box(pu, (y0 + y1 + 0.06) / 2, pv, 0.11, y1 - y0 + 0.06, 0.11, shade(k, 0.94));
    // Vertical balusters (sparser on LOW).
    const step = this.low ? 0.36 : 0.17;
    const n = Math.max(1, Math.floor(len / step));
    for (let i = 1; i < n; i++) {
      const f = i / n;
      m.box(u0 + du * f, (y0 + 0.1 + y1) / 2, v0 + dv * f, 0.038, y1 - y0 - 0.1, 0.038, shade(k, 0.96));
    }
  }

  private mainHouse(m: Mesher, y: number): void {
    const under = -1.0, W = MAIN.half, N = NW_WING;
    // Both gable wings have ridges running along u (rotated frame: local x = -v, local z = u).
    m.at(0, y, 0, Math.PI / 2);
    // Tall 2-storey NW wing body + roof.
    m.extrude([[-W, under], [W, under], [W, N.eave], [0, N.ridge], [-W, N.eave]], N.u0, N.u1, BLUE);
    this.roof(m, W, N.eave, N.ridge, N.u0 - N.gableOver, N.u1 + N.gableOver, N.over);
    // Lower 1.5-storey main wing body + roof.
    m.extrude([[-W, under], [W, under], [W, MAIN.eave], [0, MAIN.ridge], [-W, MAIN.eave]], MAIN.u0, MAIN.u1, BLUE);
    this.roof(m, W, MAIN.eave, MAIN.ridge, MAIN.u0 - 0.05, MAIN.u1 + MAIN.gableOver, MAIN.over);

    // Back in house (u, v) frame.
    m.at(0, y, 0);
    // Low grey concrete foundation skirt under the whole house footprint.
    m.box((N.u0 + MAIN.u1) / 2, (MAIN.floor + under) / 2, 0, MAIN.u1 - N.u0 + 0.08, MAIN.floor - under, 2 * W + 0.08, FOUNDATION);
    // White corner boards and white sill trim along the base of the siding.
    for (const [u, v, top] of [
      [N.u0, -W, N.eave], [N.u0, W, N.eave], [N.u1, -W, N.eave], [N.u1, W, N.eave],
      [MAIN.u1, -W, MAIN.eave], [MAIN.u1, W, MAIN.eave],
    ]) m.box(u, (MAIN.floor + top) / 2, v, 0.14, top - MAIN.floor, 0.14, TRIM);
    m.box((N.u0 + MAIN.u1) / 2, MAIN.floor + 0.04, -W - 0.02, MAIN.u1 - N.u0 + 0.1, 0.09, 0.05, TRIM);
    // White horizontal belt-course drip trim between 1st and 2nd floor of the tall NW wing (wraps front, NW gable and rear).
    m.box((N.u0 + N.u1) / 2, N.belt, -W - 0.04, N.u1 - N.u0 + 0.16, 0.09, 0.13, TRIM);
    m.box((N.u0 + N.u1) / 2, N.belt, W + 0.04, N.u1 - N.u0 + 0.16, 0.09, 0.13, TRIM);
    m.box(N.u0 - 0.04, N.belt, 0, 0.13, 0.09, 2 * W + 0.16, TRIM);

    // Two white-framed rectangular skylights on the front (-v) roof slope of the tall NW wing.
    const nwSlope = Math.atan2(N.ridge - N.eave, W);
    for (const su of [-4.45, -2.35]) {
      const sv = -1.65, sy = N.eave + ((W + sv) / W) * (N.ridge - N.eave) + 0.16;
      m.at(su, y + sy, sv, 0, -nwSlope, 0);
      m.box(0, 0.02, 0, 0.72, 0.06, 0.96, TRIM);
      m.box(0, 0.055, 0, 0.58, 0.03, 0.82, SKYLIGHT_GLASS);
    }
    m.at(0, y, 0);

    // Small front shed dormer tucked right beside the tall NW wing (u = -1.4..-0.18).
    const du0 = -1.4, du1 = -0.18, dv0 = -3.35, dv1 = -1.45, dBot = 3.25, dFrontTop = 4.65, dBackTop = 4.95;
    m.box((du0 + du1) / 2, (dBot + dFrontTop) / 2, (dv0 + dv1) / 2, du1 - du0, dFrontTop - dBot, dv1 - dv0, BLUE);
    m.at(0, y, 0, Math.PI / 2);
    m.extrude([[-dv1, dBackTop], [-dv0 + 0.18, dFrontTop], [-dv0 + 0.18, dFrontTop + 0.1], [-dv1, dBackTop + 0.1]], du0 - 0.05, du1 + 0.15, ROOF, TRIM);
    m.at(0, y, 0);
    m.box((du0 + du1) / 2, dFrontTop + 0.02, dv0 - 0.18, du1 - du0 + 0.2, 0.14, 0.05, TRIM);
    this.opening(m, 'v', dv0, -1, (du0 + du1) / 2, 3.6, 0.68, 0.82, GLASS, 1, 0);

    // Front wall (-v) openings:
    // - NW wing 1st- and 2nd-floor square white-framed windows
    this.opening(m, 'v', -W, -1, -3.3, 1.48, 0.86, 0.86, GLASS, 0, 0);
    this.opening(m, 'v', -W, -1, -3.3, 3.88, 0.86, 0.86, GLASS, 0, 0);
    // - Small square 1st-floor window right between vestibule and NW wing
    this.opening(m, 'v', -W, -1, -0.82, 1.48, 0.72, 0.78, GLASS, 0, 0);
    // - Large 3-part picture window on the SE half of the front wall (wide center pane + 2 narrow side panes)
    const pu = 3.72, py = 1.38, pw = 1.92, ph = 1.24;
    m.box(pu, py + ph / 2, -W - 0.026, pw + 0.2, ph + 0.2, 0.05, TRIM);
    m.box(pu, py + ph / 2, -W - 0.048, pw, ph, 0.05, GLASS);
    for (const off of [-0.52, 0.52]) m.box(pu + off, py + ph / 2, -W - 0.064, 0.065, ph + 0.01, 0.05, TRIM);
    // - Grey electric meter box and vertical conduit near the front-SE corner
    m.box(4.72, 1.32, -W - 0.09, 0.26, 0.36, 0.16, METER);
    m.cyl(4.72, 0.65, -W - 0.06, 0.024, 1.2, METER, 'y', 6);

    // NW gable wall (u = -5.6, observed in dashcam): low basement window, 1st-floor and 2nd-floor windows.
    this.opening(m, 'u', N.u0, -1, -2.35, 0.42, 0.56, 0.56, GLASS, 0, 0);
    this.opening(m, 'u', N.u0, -1, -2.1, 1.52, 0.72, 0.82, GLASS, 0, 0);
    this.opening(m, 'u', N.u0, -1, -1.7, 3.85, 0.76, 0.86, GLASS, 0, 0);

    // SE gable wall (u = +5.0): 1st-floor and 2nd-floor sliding glass patio doors opening onto the two-storey deck.
    this.opening(m, 'u', MAIN.u1, 1, -0.5, SE_DECK.lowerFloor, 1.85, 2.02, GLASS, 0, 1);
    this.opening(m, 'u', MAIN.u1, 1, -0.5, SE_DECK.upperFloor, 1.65, 1.92, GLASS, 0, 1);

    // Rear wall (+v, invented cleanly to match front bays).
    this.opening(m, 'v', W, 1, -3.3, 1.48, 0.9, 0.9, GLASS, 0, 0);
    this.opening(m, 'v', W, 1, -3.3, 3.88, 0.9, 0.9, GLASS, 0, 0);
    this.opening(m, 'v', W, 1, 0.4, 1.38, 1.5, 1.15, GLASS, 0, 1);
    this.opening(m, 'v', W, 1, 3.2, 1.38, 1.3, 1.15, GLASS, 0, 1);

    // Vertical board-and-batten shadow strips on main walls (desktop only).
    this.verticalSiding(m, 'v', -W, -1, N.u0, N.u1, N.floor, N.eave);
    this.verticalSiding(m, 'v', -W, -1, MAIN.u0, MAIN.u1, MAIN.floor, MAIN.eave);
    this.verticalSiding(m, 'v', W, 1, N.u0, N.u1, N.floor, N.eave);
    this.verticalSiding(m, 'v', W, 1, MAIN.u0, MAIN.u1, MAIN.floor, MAIN.eave);
    this.verticalSiding(m, 'u', N.u0, -1, -W, W, N.floor, N.eave, N.ridge);
    this.verticalSiding(m, 'u', N.u1, 1, -W, W, MAIN.eave, N.eave, N.ridge);
    this.verticalSiding(m, 'u', MAIN.u1, 1, -W, W, MAIN.floor, MAIN.eave, MAIN.ridge);
  }

  /** Front steep-gabled entry vestibule, white door with sidelights, warm brown porch, white lattice skirting and steps. */
  private vestibuleAndPorch(m: Mesher, y: number): void {
    const V = VESTIBULE, P = PORCH, under = -0.8;
    const vu = (V.u0 + V.u1) / 2, vw = V.u1 - V.u0, vh = vw / 2;
    // Vestibule gable body + roof: ridge runs along v (local z in unrotated frame centered at u = vu).
    m.at(vu, y, 0);
    m.extrude([[-vh, under], [vh, under], [vh, V.eave], [0, V.ridge], [-vh, V.eave]], V.v0, V.v1 + 1.9, BLUE);
    this.roof(m, vh, V.eave, V.ridge, V.v0 - 0.3, V.v1 + 2.0, V.over);

    m.at(0, y, 0);
    // White corner boards, downspouts and foundation skirt on vestibule.
    for (const u of [V.u0, V.u1]) {
      m.box(u, (MAIN.floor + V.eave) / 2, V.v0, 0.13, V.eave - MAIN.floor, 0.13, TRIM);
      m.box(u + (u === V.u0 ? -0.1 : 0.1), V.eave / 2, V.v0 - 0.04, 0.075, V.eave, 0.075, TRIM);
    }
    m.box(vu, (MAIN.floor + under) / 2, (V.v0 + V.v1) / 2, vw + 0.06, MAIN.floor - under, V.v1 - V.v0 + 0.06, FOUNDATION);
    this.verticalSiding(m, 'v', V.v0, -1, V.u0, V.u1, P.floor, V.eave, V.ridge);
    this.verticalSiding(m, 'u', V.u0, -1, V.v0, V.v1, MAIN.floor, V.eave);
    this.verticalSiding(m, 'u', V.u1, 1, V.v0, V.v1, MAIN.floor, V.eave);

    // White front door with 9-lite upper glass + tall flanking sidelights (no numbers or signage).
    const dw = 1.88, dh = 2.04, db = P.floor;
    m.box(vu, db + dh / 2, V.v0 - 0.026, dw + 0.18, dh + 0.16, 0.05, TRIM);
    m.box(vu, db + dh / 2, V.v0 - 0.048, dw, dh, 0.05, DOOR_WHITE);
    // Center door upper glass + mullions.
    m.box(vu, db + 1.46, V.v0 - 0.068, 0.56, 0.84, 0.02, GLASS);
    for (const dy of [-0.14, 0.14]) m.box(vu, db + 1.46 + dy, V.v0 - 0.08, 0.58, 0.03, 0.02, TRIM);
    for (const du of [-0.14, 0.14]) m.box(vu + du, db + 1.46, V.v0 - 0.08, 0.03, 0.86, 0.02, TRIM);
    // Flanking sidelights.
    for (const side of [-1, 1]) {
      const su = vu + side * 0.66;
      m.box(su, db + 1.15, V.v0 - 0.068, 0.24, 1.42, 0.02, GLASS);
      for (let k = -1; k <= 1; k++) m.box(su, db + 1.15 + k * 0.36, V.v0 - 0.08, 0.26, 0.03, 0.02, TRIM);
    }
    // Small white twin floodlight fixture high in the front gable peak.
    m.box(vu, 4.18, V.v0 - 0.06, 0.24, 0.14, 0.1, TRIM);
    for (const s of [-0.07, 0.07]) m.cyl(vu + s, 4.18, V.v0 - 0.12, 0.04, 0.08, DOOR_WHITE, 'z', 6);

    // Warm reddish-brown wooden porch landing.
    const pw = P.u1 - P.u0, pd = P.v1 - P.v0, pcv = (P.v0 + P.v1) / 2;
    m.box(vu, P.floor - 0.07, pcv, pw + 0.08, 0.14, pd + 0.06, DECK_WOOD);
    // White diagonal lattice skirting tucked cleanly under the porch landing.
    m.box(vu, (P.floor - 0.14) / 2, pcv, pw - 0.14, P.floor - 0.14, pd - 0.12, LATTICE_BG);
    if (!this.low) {
      for (let u = P.u0 + 0.16; u < P.u1 - 0.14; u += 0.22) {
        if (u > P.stairU0 + 0.05 && u < P.stairU1 - 0.05) continue;
        m.box(u, 0.45, P.v0 + 0.055, 0.035, 0.82, 0.02, LATTICE_GAP);
      }
      for (const side of [P.u0 + 0.065, P.u1 - 0.065]) {
        for (let v = P.v0 + 0.16; v < P.v1 - 0.12; v += 0.22) m.box(side, 0.45, v, 0.02, 0.82, 0.035, LATTICE_GAP);
      }
    }
    // Front porch railings (left, right, and narrow front cheeks flanking the stairs).
    this.railing(m, P.u0 + 0.05, P.v1 - 0.06, P.u0 + 0.05, P.v0 + 0.06, P.floor, P.rail);
    this.railing(m, P.u1 - 0.05, P.v1 - 0.06, P.u1 - 0.05, P.v0 + 0.06, P.floor, P.rail);
    this.railing(m, P.u0 + 0.05, P.v0 + 0.06, P.stairU0, P.v0 + 0.06, P.floor, P.rail);
    this.railing(m, P.stairU1, P.v0 + 0.06, P.u1 - 0.05, P.v0 + 0.06, P.floor, P.rail);

    // 5-step front wooden stair descending from v = P.v0 to v = P.stairV0, with stringers, sloped handrails and stepping slabs.
    const steps = 5, su = (P.stairU0 + P.stairU1) / 2, sw = P.stairU1 - P.stairU0, run = P.v0 - P.stairV0;
    for (let i = 0; i < steps; i++) {
      const sy = P.floor - ((i + 1) / (steps + 0.2)) * P.floor;
      const sv = P.v0 - ((i + 0.5) / steps) * run;
      m.box(su, sy, sv, sw, 0.05, run / steps + 0.04, shade(DECK_WOOD, 1.06));
      m.box(su, sy - 0.09, sv + run / (steps * 2), sw - 0.06, 0.13, 0.03, shade(DECK_WOOD, 0.82));
    }
    const stairPitch = Math.atan2(P.floor, run), stairLen = Math.hypot(run, P.floor);
    for (const railU of [P.stairU0, P.stairU1]) {
      m.box(railU, 0.45, P.stairV0, 0.1, 0.92, 0.1, shade(DECK_WOOD, 0.92));
      m.at(railU, y + P.floor / 2 + 0.48, (P.v0 + P.stairV0) / 2, 0, -stairPitch, 0);
      m.box(0, 0.42, 0, 0.09, 0.07, stairLen + 0.15, DECK_WOOD);
      m.box(0, -0.45, 0, 0.08, 0.2, stairLen + 0.1, shade(DECK_WOOD, 0.84));
      m.at(0, y, 0);
      const nB = this.low ? 3 : 6;
      for (let i = 1; i < nB; i++) {
        const f = i / nB, bv = P.v0 - f * run, by = P.floor * (1 - f);
        m.box(railU, by + 0.42, bv, 0.038, 0.84, 0.038, shade(DECK_WOOD, 0.96));
      }
    }
    // Two pale grey concrete stepping slabs at the foot of the front stairs.
    for (const slabU of [su - 0.42, su + 0.42]) m.box(slabU, 0.03, P.stairV0 - 0.34, 0.78, 0.06, 0.58, CONCRETE);
  }

  /** Stacked two-storey reddish-brown wooden deck on the SE gable end, with front stairs down to the gravel drive. */
  private seTwoStoreyDeck(m: Mesher, y: number): void {
    const D = SE_DECK, du = (D.u0 + D.u1) / 2, dw = D.u1 - D.u0;
    m.at(0, y, 0);
    // Lower deck floor slab & rim joists (v = D.v0..D.v1).
    const ldv = (D.v0 + D.v1) / 2, ldd = D.v1 - D.v0;
    m.box(du, D.lowerFloor - 0.09, ldv, dw, 0.18, ldd, DECK_WOOD);
    // Support posts from ground (-0.8) up to lower deck, and tall corner/edge posts up to upper balcony floor.
    for (const pv of [D.v0 + 0.12, -1.2, 1.2, D.v1 - 0.12]) {
      const top = pv <= D.upperV1 + 0.1 ? D.upperFloor : D.lowerFloor;
      m.box(D.u1 - 0.12, (top - 0.8) / 2, pv, 0.16, top + 0.8, 0.16, shade(DECK_WOOD, 0.84));
    }
    // Lower deck railings (SE outer edge, rear edge, and front flanks either side of stairs).
    this.railing(m, D.u1 - 0.08, D.v0 + 0.08, D.u1 - 0.08, D.v1 - 0.08, D.lowerFloor, D.lowerFloor + 0.96);
    this.railing(m, D.u0 + 0.06, D.v1 - 0.08, D.u1 - 0.08, D.v1 - 0.08, D.lowerFloor, D.lowerFloor + 0.96);
    this.railing(m, D.u0 + 0.06, D.v0 + 0.08, D.stairU0, D.v0 + 0.08, D.lowerFloor, D.lowerFloor + 0.96);
    this.railing(m, D.stairU1, D.v0 + 0.08, D.u1 - 0.08, D.v0 + 0.08, D.lowerFloor, D.lowerFloor + 0.96);

    // Wide 6-step wooden stair descending from the front (-v) side of the lower deck down to the gravel edge.
    const steps = 6, su = (D.stairU0 + D.stairU1) / 2, sw = D.stairU1 - D.stairU0, run = D.v0 - D.stairV0;
    for (let i = 0; i < steps; i++) {
      const sy = D.lowerFloor - ((i + 1) / (steps + 0.15)) * D.lowerFloor;
      const sv = D.v0 - ((i + 0.5) / steps) * run;
      m.box(su, sy, sv, sw, 0.05, run / steps + 0.04, shade(DECK_WOOD, 1.06));
    }
    const sPitch = Math.atan2(D.lowerFloor, run), sLen = Math.hypot(run, D.lowerFloor);
    for (const railU of [D.stairU0, D.stairU1]) {
      m.box(railU, 0.48, D.stairV0, 0.11, 0.98, 0.11, shade(DECK_WOOD, 0.92));
      m.at(railU, y + D.lowerFloor / 2 + 0.48, (D.v0 + D.stairV0) / 2, 0, -sPitch, 0);
      m.box(0, 0.44, 0, 0.09, 0.07, sLen + 0.16, DECK_WOOD);
      m.box(0, -0.45, 0, 0.08, 0.22, sLen + 0.12, shade(DECK_WOOD, 0.84));
      m.at(0, y, 0);
      const nB = this.low ? 3 : 7;
      for (let i = 1; i < nB; i++) {
        const f = i / nB;
        m.box(railU, D.lowerFloor * (1 - f) + 0.44, D.v0 - f * run, 0.038, 0.86, 0.038, shade(DECK_WOOD, 0.96));
      }
    }

    // Upper 2nd-floor balcony deck floor, rim joists & railings (v = D.v0..D.upperV1).
    const udv = (D.v0 + D.upperV1) / 2, udd = D.upperV1 - D.v0;
    m.box(du, D.upperFloor - 0.1, udv, dw, 0.2, udd, DECK_WOOD);
    this.railing(m, D.u0 + 0.06, D.v0 + 0.08, D.u1 - 0.08, D.v0 + 0.08, D.upperFloor, D.upperFloor + 0.96);
    this.railing(m, D.u1 - 0.08, D.v0 + 0.08, D.u1 - 0.08, D.upperV1 - 0.08, D.upperFloor, D.upperFloor + 0.96);
    this.railing(m, D.u0 + 0.06, D.upperV1 - 0.08, D.u1 - 0.08, D.upperV1 - 0.08, D.upperFloor, D.upperFloor + 0.96);
  }

  /** Small west blue gambrel shed with white double barn doors facing east (+u) toward the house. */
  private westGambrelShed(m: Mesher): void {
    const S = WEST_SHED, su = (S.u0 + S.u1) / 2, sv = (S.v0 + S.v1) / 2, sh = (S.v1 - S.v0) / 2;
    const gy = this.g(su, sv), under = -1.0, kh = sh * 0.68;
    // Gambrel ridge runs along u (rotated frame: local x = -(v - sv), local z = u).
    m.at(0, gy, sv, Math.PI / 2);
    m.extrude([[-sh, under], [sh, under], [sh, S.eave], [kh, S.knuckle], [0, S.ridge], [-kh, S.knuckle], [-sh, S.eave]], S.u0, S.u1, BLUE_SHED);
    this.gambrelRoof(m, sh, S.eave, S.knuckle, S.ridge, S.u0 - 0.14, S.u1 + 0.14, 0.16);
    m.at(0, gy, 0);
    for (const [u, v] of [[S.u0, S.v0], [S.u1, S.v0], [S.u0, S.v1], [S.u1, S.v1]]) m.box(u, S.eave / 2, v, 0.1, S.eave, 0.1, TRIM);
    // Double white barn doors facing +u (east, toward the house/driveway).
    this.opening(m, 'u', S.u1, 1, sv, 0.06, 1.48, 1.88, DOOR_WHITE, 0, 1);
    m.box(S.u1 + 0.075, 1.0, sv + 0.08, 0.03, 0.18, 0.04, IRON);   // latch
  }

  /** Large east two-storey blue gambrel barn/garage with dark reddish-brown garage door and white loft/side windows. */
  private eastGambrelBarn(m: Mesher): void {
    const B = EAST_BARN, bu = (B.u0 + B.u1) / 2, bv = (B.v0 + B.v1) / 2, bh = (B.v1 - B.v0) / 2;
    const gy = this.g(bu, bv), under = -1.2, kh = bh * 0.68;
    // Gambrel ridge runs along u (rotated frame: local x = -(v - bv), local z = u).
    m.at(0, gy, bv, Math.PI / 2);
    m.extrude([[-bh, under], [bh, under], [bh, B.eave], [kh, B.knuckle], [0, B.ridge], [-kh, B.knuckle], [-bh, B.eave]], B.u0, B.u1, BLUE_SHED);
    this.gambrelRoof(m, bh, B.eave, B.knuckle, B.ridge, B.u0 - 0.24, B.u1 + 0.24, 0.26);
    m.at(0, gy, 0);
    // Low concrete/block foundation base and crisp white corner boards.
    m.box(bu, (0.24 + under) / 2, bv, B.u1 - B.u0 + 0.08, 0.24 - under, 2 * bh + 0.08, FOUNDATION);
    for (const [u, v] of [[B.u0, B.v0], [B.u1, B.v0], [B.u0, B.v1], [B.u1, B.v1]]) m.box(u, B.eave / 2, v, 0.14, B.eave, 0.14, TRIM);
    // West gable end (u = B.u0, facing the house/driveway): dark reddish-brown wide barn/garage door + upper loft window.
    this.opening(m, 'u', B.u0, -1, bv, 0.12, 2.38, 2.28, BARN_DOOR, 0, 0);
    this.opening(m, 'u', B.u0, -1, bv, 3.25, 0.88, 1.08, GLASS, 1, 0);
    // North road-facing side wall (v = B.v0): two white double-hung windows.
    this.opening(m, 'v', B.v0, -1, B.u0 + 2.2, 1.28, 0.82, 0.92, GLASS, 1, 0);
    this.opening(m, 'v', B.v0, -1, B.u1 - 2.3, 1.28, 0.82, 0.92, GLASS, 1, 0);
    // East gable end (u = B.u1): upper loft window.
    this.opening(m, 'u', B.u1, 1, bv, 3.25, 0.88, 1.08, GLASS, 1, 0);
    this.verticalSiding(m, 'v', B.v0, -1, B.u0, B.u1, 0.24, B.eave, B.eave, shade(BLUE_SHED, 0.78));
    this.verticalSiding(m, 'u', B.u0, -1, B.v0, B.v1, 0.24, B.eave, B.ridge, shade(BLUE_SHED, 0.78));
  }

  /** Rounded-arch fabric hoop storage shelter (Quonset profile along v, white end panels facing the road). */
  private hoopShelter(m: Mesher, H: { u0: number; u1: number; v0: number; v1: number; wall: number; ridge: number }, tarpK: RGB): void {
    const cu = (H.u0 + H.u1) / 2, cv = (H.v0 + H.v1) / 2, hw = (H.u1 - H.u0) / 2;
    const gy = this.g(cu, cv), segs = this.low ? 5 : 8;
    const pts: number[][] = [[-hw, -0.8], [hw, -0.8], [hw, H.wall]];
    for (let i = 1; i < segs; i++) {
      const a = (i / segs) * Math.PI;
      pts.push([Math.cos(a) * hw, H.wall + Math.sin(a) * (H.ridge - H.wall)]);
    }
    pts.push([-hw, H.wall]);
    m.at(cu, gy, 0);
    m.extrude(pts, H.v0, H.v1, tarpK, HOOP_END);
    // Simple zippered/framed front doorway outline on road-facing (-v) end.
    m.box(0, 0.95, H.v0 - 0.03, 1.1, 1.85, 0.03, shade(HOOP_END, 0.85));
    m.at(0, 0, 0);
  }

  /** Rounded two-tier foliage lobe (tapers under and over like Mabou's real deciduous crowns). */
  private crownLobe(m: Mesher, u: number, gy: number, v: number, ch: number, rx: number, ry: number, k: RGB, yaw: number): void {
    const sides = this.low ? 5 : 6;
    m.at(u, gy, v, yaw);
    m.cyl(0, ch - ry * 0.42, 0, rx * 0.56, ry * 0.84, shade(k, 0.84), 'y', sides, rx, shade(k, 0.92));
    m.cyl(0, ch + ry * 0.46, 0, rx, ry * 0.92, k, 'y', sides, rx * 0.42, shade(k, 1.08));
  }

  /** Multi-branched late-autumn deciduous tree (spreading grey-bark trunk and rounded autumn crown, matching Mabou trees). */
  private autumnTree(m: Mesher, u: number, v: number, h: number, r: number, rnd: () => number): void {
    const gy = this.g(u, v);
    m.at(u, gy, v);
    m.cyl(0, h * 0.24, 0, r, h * 0.5, BARK, 'y', this.low ? 5 : 7, r * 0.68);
    const limbs = this.low ? 4 : 6;
    const limbSpecs: [number, number, number][] = [];
    for (let i = 0; i < limbs; i++) {
      const ang = (i / limbs) * Math.PI * 2 + rnd() * 0.35;
      const tilt = 0.34 + rnd() * 0.2, len = h * (0.4 + rnd() * 0.14), br = r * (0.34 + rnd() * 0.12);
      limbSpecs.push([ang, tilt, len]);
      m.at(u, gy + h * 0.38, v, ang, 0, tilt);
      m.cyl(0, len / 2, 0, br, len, i % 2 ? BARK_LIGHT : BARK, 'y', 5, br * 0.3);
    }
    // Rounded autumn crown core plus outer bough lobes (keeps the house and blue shed visible beneath).
    this.crownLobe(m, u, gy, v, h * 0.78, h * 0.21, h * 0.18, shade(TREE_GOLD, 0.92 + rnd() * 0.12), rnd() * 6.3);
    const clumps = this.low ? 3 : 6;
    for (let i = 0; i < clumps; i++) {
      const [ang, tilt, len] = limbSpecs[i % limbSpecs.length];
      const frac = 0.78 + rnd() * 0.16;
      const reach = len * frac * Math.sin(tilt), ch = h * 0.42 + len * frac * Math.cos(tilt) + (rnd() - 0.5) * 0.4;
      const a = ang + (rnd() - 0.5) * 0.35, cr = h * (0.14 + rnd() * 0.05);
      const k = i % 3 === 0 ? TREE_RUSSET : i % 2 === 0 ? TREE_GOLD : TREE_OLIVE;
      this.crownLobe(m, u + Math.sin(a) * reach, gy, v + Math.cos(a) * reach, ch, cr, cr * 0.78, shade(k, 0.9 + rnd() * 0.18), rnd() * 6.3);
    }
    this.solid(u - r - 0.12, u + r + 0.12, v - r - 0.12, v + r + 0.12);
  }

  /** Rounded multi-lobe autumn shrub. */
  private bush(m: Mesher, u: number, v: number, r: number, h: number, rnd: () => number): void {
    const gy = this.g(u, v), n = this.low ? 3 : 6;
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.3, d = i ? r * (0.24 + rnd() * 0.42) : 0;
      const cr = r * (i ? 0.4 + rnd() * 0.2 : 0.62), ch = h * (i ? 0.42 + rnd() * 0.26 : 0.54);
      const k = i % 3 === 0 ? SHRUB_GOLD : i % 2 === 0 ? SHRUB_RUST : SHRUB_OLIVE;
      this.crownLobe(m, u + Math.cos(a) * d, gy, v + Math.sin(a) * d, ch, cr, ch * 0.85, shade(k, 0.9 + rnd() * 0.18), rnd() * 6.3);
    }
  }

  /** Yard details: red/white parcel box, wooden garden bench, lumber stack, playset, trees and shrubs. */
  private yard(m: Mesher, y: number, rnd: () => number): void {
    // 1. Red wooden parcel chest with white slanted lid beside the green mailbox (no lettering).
    const pgy = this.g(PARCEL_BOX.u, PARCEL_BOX.v);
    m.at(PARCEL_BOX.u, pgy, PARCEL_BOX.v);
    m.box(0, 0.32, 0, 0.88, 0.64, 0.56, PARCEL_RED);
    // Low slanted top wall under the overhanging white lid.
    m.box(0, 0.66, 0.22, 0.86, 0.12, 0.1, PARCEL_RED);
    // White slanted hinged lid facing Blackstone Road (-v).
    m.at(PARCEL_BOX.u, pgy + 0.69, PARCEL_BOX.v, 0, -0.22, 0);
    m.box(0, 0, 0, 0.96, 0.055, 0.66, DOOR_WHITE);
    m.at(0, y, 0);

    // 2. Wooden slatted garden bench on a small concrete pad in front of the NW wing (u = -3.3, v = -4.7).
    const bu = -3.3, bv = -4.7;
    m.box(bu, 0.03, bv, 1.95, 0.06, 0.95, CONCRETE);
    m.box(bu, 0.44, bv, 1.48, 0.07, 0.48, BENCH_WOOD);
    m.box(bu, 0.84, bv + 0.2, 1.32, 0.58, 0.06, BENCH_WOOD);
    for (const s of [-0.72, 0.72]) {
      m.box(bu + s, 0.32, bv, 0.14, 0.58, 0.52, shade(BENCH_WOOD, 0.9));
      m.box(bu + s, 0.62, bv, 0.24, 0.06, 0.54, BENCH_WOOD);
    }

    // 3. Stacked lumber pile in the gravel work area between house and barn (u = 18.2..24.2, v = 4.6..6.4).
    const lgy = this.g(21.2, 5.5);
    m.at(21.2, lgy, 5.5);
    m.box(-1.5, 0.32, 0.2, 3.2, 0.64, 1.15, LUMBER);
    m.box(1.5, 0.24, -0.1, 2.8, 0.48, 1.05, shade(LUMBER, 0.92));
    if (!this.low) {
      for (let r = 0; r < 3; r++) m.box(-1.5, 0.14 + r * 0.2, -0.39, 3.16, 0.03, 0.02, LUMBER_DARK);
    }

    // 4. Kids' wooden playset / swing set in the west backyard (u = -13.5, v = 6.5).
    const kgy = this.g(-13.5, 6.5);
    m.at(-13.5, kgy, 6.5);
    for (const [pu, pv] of [[-0.7, -0.6], [0.7, -0.6], [-0.7, 0.6], [0.7, 0.6]]) m.box(pu, 1.3, pv, 0.11, 2.6, 0.11, PLAYSET_WOOD);
    m.box(0, 1.25, 0, 1.45, 0.1, 1.25, PLAYSET_WOOD);
    m.box(0, 2.55, 0, 1.65, 0.12, 1.45, PLAYSET_ROOF);
    m.box(-1.6, 2.15, 0, 1.9, 0.1, 0.1, PLAYSET_WOOD);   // swing beam
    for (const pv of [-0.55, 0.55]) m.box(-2.45, 1.08, pv, 0.09, 2.2, 0.09, PLAYSET_WOOD);

    // 5. West lawn mature deciduous trees (maple/birch cluster between house, small blue shed and road).
    this.autumnTree(m, -14.8, -13.2, 8.6, 0.24, rnd);
    this.autumnTree(m, -18.8, -12.4, 8.2, 0.21, rnd);
    this.autumnTree(m, -13.6, -5.8, 7.6, 0.18, rnd);
    this.autumnTree(m, -21.6, -9.2, 9.2, 0.23, rnd);

    // 6. Bushy autumn shrub beside the east roadside edge of the front lawn island (u = 17.5, v = -16.2).
    this.bush(m, 17.5, -16.2, 1.35, 1.65, rnd);

    // 7. Staked young sapling on the wide east lawn (u = 32.0, v = -11.5).
    const tgy = this.g(32.0, -11.5);
    m.at(32.0, tgy, -11.5);
    m.cyl(0, 0.9, 0, 0.024, 1.8, BARK, 'y', 5, 0.012);
    m.cyl(0, 0.25, 0, 0.048, 0.5, DOOR_WHITE, 'y', 5);
    m.cyl(0, 1.65, 0, 0.24, 0.42, TREE_GOLD, 'y', 5, 0.12);
    for (const s of [-0.32, 0.32]) m.box(s, 0.68, 0, 0.032, 1.36, 0.032, LUMBER_DARK);
    m.at(0, 0, 0);
  }
}
