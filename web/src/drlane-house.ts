import * as THREE from 'three';
import { DrLaneDog } from './drlane-dog';
import { BED, type DrLaneSite } from './drlane-site';
import { pushOut, type Pushable, type Solid } from './parked';
import type { HandBuiltPlace } from './place';
import type { Terrain } from './terrain';
import { Mesher, seeded, type RGB } from './yard-kit';

/**
 * The house on D.R.'s Lane, built by hand in place of its surveyed box, with its yard: a sage-green bungalow with white
 * trim and a dark roof, a taller split-level part at its south-east end with its gable toward the lane, a stove pipe, a
 * low deck with a red skirt and a white swing, a stained board shed, the gravel drive, a woodpile under a green tarp,
 * the garden bed along the lane with its stone edge, its shrubs and its red-berried bush, two pines, a flagpole and a
 * white dog (drlane-dog.ts).
 *
 * Layout is in house metres (see drlane-site.ts): u toward the taller end (south-east), v toward the lane. Heights are
 * above the level pad. The roofs, the walls and the yard follow the elevation survey; the windows, the doors and the
 * shed follow pictures. The back of the house, its north-east side, its two ends and the back of the
 * shed are not seen from the lane: their windows are invented. No sign, number or name.
 */
const hex = (value: number): RGB => { const c = new THREE.Color(value); return [c.r, c.g, c.b]; };
const shade = (k: RGB, f: number): RGB => [k[0] * f, k[1] * f, k[2] * f];
const SAGE = hex(0x8a9b87), TRIM = hex(0xecece6), ROOF = hex(0x626468), GLASS: RGB = [0.07, 0.11, 0.14], FOUNDATION = hex(0x8d8c86);
const PANEL = hex(0x5c6a66), DOOR = hex(0xe4e4de), DARK_DOOR = hex(0x3b4446), STEEL = hex(0xb9bcbf), SOOT = hex(0x2a2a2b);
const DECK_WOOD = hex(0x8a7d6c), SKIRT = hex(0x8e2a26), SLATS = hex(0xd8cdb4), CHAIR = hex(0xd9b43a);
const STAIN = hex(0x8a6a4c), SHED_ROOF = hex(0x5e5f62), BARK = hex(0x5a4636), PINE_BARK = hex(0xa0603c);
const NEEDLES = hex(0x2f4a2e), NEEDLES_LIGHT = hex(0x3f5c37), BERRIES = hex(0xc8321e), TWIGS = hex(0x6e4a38);
const BOX = hex(0x3e5e32), GOLD = hex(0xb9b23a), STRAW = hex(0xa89a72), SEDUM = hex(0x7a2a2c), STONE = hex(0x8e8e88);
const WOOD_ENDS = hex(0xa89a84), TARP = hex(0x3c9a68), POST = hex(0x7d7466), STAKE = hex(0xe0582a), FLAG_RED = hex(0xc8202a);

/** The bungalow: its walls, floor, eave and ridge (the ridge runs along u). */
export const MAIN = { u0: -9.4, u1: 0.95, half: 4.6, floor: 0.3, eave: 2.6, ridge: 4.45, over: 0.45, gableOver: 0.3 };
/** The taller part: its ridge runs across, along v, so its gable faces the lane. Its front is set back from the bungalow's. */
export const TALL = { u0: 1.0, u1: 10.4, v0: -4.3, v1: 3.7, eave: 3.6, ridge: 5.65, over: 0.35, band: 1.6 };
/** The low deck along the bungalow's front, round into the corner under the bungalow's roof. */
export const DECK = { u0: -6.2, u1: 2.3, v0: MAIN.half, v1: 6.6, top: 0.28 };
/** The shed: its ridge runs along v, its doors face the lane. */
export const SHED = { u0: 8.2, u1: 13.4, v0: 11.3, v1: 17.7, eave: 2.3, ridge: 3.6 };
/** Tree trunks [u, v, height, crown radius, crown from], and the woodpile [u, v, length, depth]. */
export const PINES: readonly (readonly [number, number, number, number, number])[] = [[7.3, 18.8, 11.5, 3.6, 2.6], [-0.6, 17.2, 7.2, 2.2, 0.7]];
export const WOODPILE = [-14, 8.8, 3.8, 1.0] as const;
const SLOPE = (MAIN.ridge - MAIN.eave) / MAIN.half;
/** A car's half length, as the farm dogs at houses take it when they slip away (lot-props.ts). */
const CAR_REACH = 3.4;

export class DrLaneHouse implements HandBuiltPlace {
  readonly group = new THREE.Group();
  private local = new THREE.Group();   // the house's own axes: x is u, z is v
  private solids: Solid[] = [];
  private built = false; private fine = -1; private near = false;
  private material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private probes: { x: number; z: number }[];
  readonly dog: DrLaneDog;
  triangles = 0;

  /** `lift` turns a true height above the sea into the game's stretched height. */
  constructor(readonly site: DrLaneSite, private terrain: Terrain, private lift: (metres: number) => number, low: boolean) {
    const o = site.origin;
    this.local.position.set(o.x, 0, o.z);
    this.local.rotation.y = site.yaw;
    this.group.add(this.local);
    this.group.visible = false;
    this.probes = ([[0, 0], [12, 15], [-12, 8], [0, 28], [-6, 22]] as [number, number][]).map(([u, v]) => site.world(u, v));
    this.dog = new DrLaneDog(low);
    this.dog.group.visible = false;
    this.local.add(this.dog.group);
  }

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

  update(view: THREE.Vector3, _now: number, car: { x: number; z: number }, dt: number): void {
    const o = this.site.origin, carFar = Math.hypot(car.x - o.x, car.z - o.z), far = Math.min(Math.hypot(view.x - o.x, view.z - o.z), carFar);
    this.near = far < 900;
    if (this.near) {
      const fine = this.ready();
      if (fine !== null && fine > this.fine) { this.build(); this.built = true; this.fine = fine; }
    }
    this.group.visible = this.built && far < 1600;
    // The dog only while it is near enough to see: it keeps to its yard and its spot when no one is about.
    if (this.built && far < 250) {
      const rules = this.dog.rules;
      rules.update(dt, carFar < 120 ? this.site.local(car.x, car.z) : null, CAR_REACH);
      const w = this.site.world(rules.u, rules.v);
      this.dog.pose(dt, this.terrain.heightAt(w.x, w.z) ?? this.lift(this.site.level));
    } else this.dog.group.visible = false;
  }

  /** The walls, the deck, the shed, the woodpile and the trunks stop the car. */
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
    for (const child of [...this.local.children]) { if (child === this.dog.group) continue; this.local.remove(child); (child as THREE.Mesh).geometry?.dispose(); }
    this.solids = [];
    const m = new Mesher(), y = this.lift(this.site.level), rnd = seeded(273);
    this.house(m, y);
    this.deck(m, y);
    this.shed(m, y);
    this.yard(m, rnd);
    this.local.add(new THREE.Mesh(m.geometry(), this.material));
    this.triangles = m.triangles;
    this.solid(MAIN.u0, TALL.u0, -MAIN.half, MAIN.half);
    this.solid(TALL.u0, TALL.u1, TALL.v0, TALL.v1);
    this.solid(DECK.u0, DECK.u1, DECK.v0, DECK.v1);
    this.solid(SHED.u0, SHED.u1, SHED.v0, SHED.v1);
  }

  /** A roof with two slopes over a part whose ridge runs along local z. Its ends are white, like the real rake boards. */
  private roof(m: Mesher, half: number, eave: number, ridge: number, z0: number, z1: number, over: number, k = ROOF): void {
    const drop = (over * (ridge - eave)) / half, t = 0.14;
    m.extrude([[-half - over, eave - drop], [0, ridge], [half + over, eave - drop], [half + over, eave - drop + t], [0, ridge + t], [-half - over, eave - drop + t]], z0, z1, k, TRIM);
    for (const s of [-1, 1]) m.box(s * (half + over + 0.02), eave - drop + 0.02, (z0 + z1) / 2, 0.05, 0.2, z1 - z0, TRIM);   // the fascia under each eave
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
    // The bar is a little wider than the glass, so its ends do not lie in the plane of the glass's edges.
    for (let i = 1; i <= bars; i++) part(0.065, bottom + (h * i) / (bars + 1), w + 0.012, 0.05, TRIM);
  }

  /** Siding: a thin shadow line every 20 cm up a wall, and on into its gable when `ridge` is given. Names as in `opening`. */
  private siding(m: Mesher, face: 'u' | 'v', plane: number, out: number, a0: number, a1: number, from: number, top: number, ridge = top, k = shade(SAGE, 0.78)): void {
    const mid = (a0 + a1) / 2, half = (a1 - a0) / 2, p = plane + out * 0.012;
    for (let h = from + 0.2; h < ridge - 0.2; h += 0.2) {
      const w = (h <= top ? half : (half * (ridge - h)) / (ridge - top)) - 0.08;
      if (w <= 0.1) break;
      const a = mid - w, b = mid + w, y0 = h - 0.012, y1 = h + 0.012;
      m.quad(face === 'u' ? [[p, y0, a], [p, y0, b], [p, y1, b], [p, y1, a]] : [[a, y0, p], [b, y0, p], [b, y1, p], [a, y1, p]], k);
    }
  }

  private house(m: Mesher, y: number): void {
    const under = -1.2;   // the walls go below the pad, so no slope shows a gap
    const W = MAIN.half, mid = (MAIN.u0 + MAIN.u1) / 2;
    // The bungalow, its ridge along u. Here local x is -v and local z is u.
    m.at(0, y, 0, Math.PI / 2);
    m.extrude([[-W, under], [W, under], [W, MAIN.eave], [0, MAIN.ridge], [-W, MAIN.eave]], MAIN.u0, MAIN.u1, SAGE);
    this.roof(m, W, MAIN.eave, MAIN.ridge, MAIN.u0 - MAIN.gableOver, TALL.u0, MAIN.over);
    // The taller part, its ridge along v: local x is u less its middle, local z is v.
    const tu = (TALL.u0 + TALL.u1) / 2, th = (TALL.u1 - TALL.u0) / 2;
    m.at(tu, y, 0);
    m.extrude([[-th, under], [th, under], [th, TALL.eave], [0, TALL.ridge], [-th, TALL.eave]], TALL.v0, TALL.v1, SAGE);
    this.roof(m, th, TALL.eave, TALL.ridge, TALL.v0 - 0.3, TALL.v1 + 0.3, TALL.over);

    // From here on: x is u, z is v.
    m.at(0, y, 0);
    // The bungalow's front slope runs on past the taller part's front, over the corner by its side door.
    const fz = (v: number) => MAIN.ridge - v * SLOPE, e0 = TALL.v1, e1 = W + MAIN.over, cu = TALL.u0 + 1.3;
    m.quad([[TALL.u0, fz(e0) + 0.14, e0], [cu, fz(e0) + 0.14, e0], [cu, fz(e1) + 0.14, e1], [TALL.u0, fz(e1) + 0.14, e1]], ROOF);
    m.quad([[TALL.u0, fz(e0), e0], [TALL.u0, fz(e1), e1], [cu, fz(e1), e1], [cu, fz(e0), e0]], shade(TRIM, 0.9));
    m.box(cu, (fz(e1) + fz(e0) + 0.28) / 2, (e0 + e1) / 2, 0.05, fz(e0) - fz(e1) + 0.14, e1 - e0, TRIM);
    m.box(cu - 0.2, (MAIN.floor + fz(W)) / 2, W - 0.1, 0.13, fz(W) - MAIN.floor, 0.13, TRIM);   // its corner post
    // Foundations: a strip of concrete under the bungalow; the taller part's lower level stands half in the ground.
    m.box(mid, 0.06, 0, MAIN.u1 - MAIN.u0 + 0.06, 0.32, 2 * W + 0.06, FOUNDATION);
    m.box(tu, 0.02, (TALL.v0 + TALL.v1) / 2, TALL.u1 - TALL.u0 + 0.06, 0.24, TALL.v1 - TALL.v0 + 0.06, FOUNDATION);
    // Corner boards.
    for (const [u, v] of [[MAIN.u0, -W], [MAIN.u0, W], [MAIN.u1 - 0.1, W]]) m.box(u, (0.2 + MAIN.eave) / 2, v, 0.14, MAIN.eave - 0.2, 0.14, TRIM);
    for (const [u, v] of [[TALL.u0, TALL.v1], [TALL.u1, TALL.v1], [TALL.u1, TALL.v0]]) m.box(u, (0.1 + TALL.eave) / 2, v, 0.14, TALL.eave - 0.1, 0.14, TRIM);
    // The white band across the taller part, where the upper level sits on the lower.
    m.box(tu, TALL.band, TALL.v1 + 0.04, TALL.u1 - TALL.u0 + 0.1, 0.16, 0.08, TRIM);
    m.box(TALL.u1 + 0.04, TALL.band, (TALL.v0 + TALL.v1) / 2, 0.08, 0.16, TALL.v1 - TALL.v0 + 0.1, TRIM);
    m.box(tu, TALL.eave - 0.02, TALL.v1 + 0.03, TALL.u1 - TALL.u0, 0.16, 0.05, TRIM);   // and under its gable

    // The bungalow's front: a window in a dark panel, the swing's wall, then a window group and the door.
    m.box(-6.85, 1.72, W + 0.015, 1.3, 1.36, 0.03, PANEL);
    this.opening(m, 'v', W, 1, -6.85, 1.2, 0.78, 1.05, GLASS, 2);
    m.box(-1.75, 1.5, W + 0.02, 2.75, 1.65, 0.04, TRIM);   // the frame round the group
    this.opening(m, 'v', W, 1, -2.87, 0.85, 0.55, 1.35, GLASS, 2);
    this.opening(m, 'v', W, 1, -1.93, 0.85, 1.15, 1.35, GLASS, 0);
    this.opening(m, 'v', W, 1, -0.82, MAIN.floor, 0.8, 2.0, DOOR, 0);
    m.box(-0.82, MAIN.floor + 1.45, W + 0.085, 0.5, 0.7, 0.02, GLASS);   // the glass of the storm door
    m.box(-0.36, MAIN.floor + 1.05, W + 0.1, 0.05, 0.05, 0.08, STEEL);   // its handle
    // The side door in the corner, in the taller part's front, and its lamp.
    this.opening(m, 'v', TALL.v1, 1, TALL.u0 + 0.66, MAIN.floor, 0.82, 2.0, DARK_DOOR, 0);
    m.box(TALL.u0 + 0.66, MAIN.floor + 1.4, TALL.v1 + 0.08, 0.5, 0.75, 0.02, GLASS);
    m.box(TALL.u0 + 1.22, MAIN.floor + 2.15, TALL.v1 + 0.1, 0.14, 0.22, 0.14, SOOT);
    // The taller part's gable toward the lane: two upper windows, two low ones in the lower level, a vent under the peak.
    this.opening(m, 'v', TALL.v1, 1, 3.6, 2.25, 0.9, 1.2, GLASS, 1);
    this.opening(m, 'v', TALL.v1, 1, 7.5, 2.5, 0.9, 0.85, GLASS, 1);
    for (const u of [3.5, 6.8]) this.opening(m, 'v', TALL.v1, 1, u, 0.28, 0.95, 0.55, GLASS, 0);
    m.box(tu, TALL.ridge - 0.75, TALL.v1 + 0.03, 0.42, 0.32, 0.05, TRIM);
    m.box(tu, TALL.ridge - 0.75, TALL.v1 + 0.05, 0.3, 0.2, 0.05, shade(SAGE, 0.45));

    // Not seen from the lane (invented): the back, the two ends and the taller part's far gable.
    for (const u of [-7.2, -3.4]) this.opening(m, 'v', -W, -1, u, 1.1, 0.9, 1.1);
    this.opening(m, 'u', MAIN.u0, -1, 1.2, 1.1, 0.9, 1.1);
    m.box(MAIN.u0 - 0.03, MAIN.ridge - 0.6, 0, 0.05, 0.3, 0.4, shade(SAGE, 0.45));
    for (const v of [-1.6, 1.4]) this.opening(m, 'u', TALL.u1, 1, v, 2.25, 0.9, 1.1);
    this.opening(m, 'u', TALL.u1, 1, -0.1, 0.28, 0.95, 0.55, GLASS, 0);
    this.opening(m, 'v', TALL.v0, -1, tu, 2.25, 0.9, 1.1);
    m.box(TALL.u1 + 0.25, 0.4, 2.0, 0.34, 0.6, 0.86, hex(0xdcdcd6));   // a heat pump on the far end

    // The stove pipe through the bungalow's front slope, with its dark collar and its cap.
    const pv = 2.3, pu = -3.3, base = fz(pv);
    m.box(pu, base + 0.08, pv, 0.42, 0.18, 0.42, SOOT);
    m.cyl(pu, (base + MAIN.ridge + 1.15) / 2, pv, 0.1, MAIN.ridge + 1.15 - base, STEEL, 'y', 10);
    m.cyl(pu, MAIN.ridge + 1.22, pv, 0.16, 0.12, STEEL, 'y', 10, 0.05);

    // Siding lines on the walls a driver sees from the lane, and on the far ones.
    this.siding(m, 'v', W, 1, MAIN.u0, TALL.u0, 0.25, MAIN.eave);
    this.siding(m, 'v', -W, -1, MAIN.u0, MAIN.u1, 0.25, MAIN.eave);
    this.siding(m, 'u', MAIN.u0, -1, -W, W, 0.25, MAIN.eave, MAIN.ridge);
    this.siding(m, 'v', TALL.v1, 1, TALL.u0, TALL.u1, 0.05, TALL.eave, TALL.ridge);
    this.siding(m, 'v', TALL.v0, -1, TALL.u0, TALL.u1, 0.05, TALL.eave, TALL.ridge);
    this.siding(m, 'u', TALL.u1, 1, TALL.v0, TALL.v1, 0.05, TALL.eave);
  }

  private deck(m: Mesher, y: number): void {
    m.at(0, y, 0);
    const d = DECK, mu = (d.u0 + d.u1) / 2;
    // The boards, and the red skirt under the open sides; in the corner it reaches back to the side door.
    m.box(mu, d.top - 0.03, (d.v0 + d.v1) / 2, d.u1 - d.u0, 0.06, d.v1 - d.v0, DECK_WOOD);
    m.box(TALL.u0 + 0.65, d.top - 0.03, (TALL.v1 + d.v0) / 2, 1.3, 0.06, d.v0 - TALL.v1, DECK_WOOD);
    for (let u = d.u0 + 0.14; u < d.u1; u += 0.14) m.quad([[u - 0.007, d.top + 0.002, d.v0], [u + 0.007, d.top + 0.002, d.v0], [u + 0.007, d.top + 0.002, d.v1], [u - 0.007, d.top + 0.002, d.v1]], shade(DECK_WOOD, 0.6));
    m.box(mu, (d.top - 0.06) / 2, d.v1 - 0.02, d.u1 - d.u0, d.top - 0.06, 0.05, SKIRT);
    for (const u of [d.u0 + 0.02, d.u1 - 0.02]) m.box(u, (d.top - 0.06) / 2, (d.v0 + d.v1) / 2, 0.05, d.top - 0.06, d.v1 - d.v0, SKIRT);
    m.box(-0.85, 0.07, d.v1 + 0.2, 1.2, 0.14, 0.4, DECK_WOOD);   // the step at the door
    // A slatted rail round the deck's north-west end.
    const rail = (u0: number, v0: number, u1: number, v1: number) => {
      const len = Math.hypot(u1 - u0, v1 - v0), n = Math.max(1, Math.round(len / 0.12));
      m.box((u0 + u1) / 2, d.top + 0.88, (v0 + v1) / 2, Math.abs(u1 - u0) + 0.07, 0.06, Math.abs(v1 - v0) + 0.07, SLATS);
      for (let i = 0; i <= n; i++) m.box(u0 + ((u1 - u0) * i) / n, d.top + 0.44, v0 + ((v1 - v0) * i) / n, 0.07, 0.86, 0.07, SLATS);
    };
    rail(d.u0 + 0.04, d.v0 + 0.1, d.u0 + 0.04, d.v1 - 0.04);
    rail(d.u0 + 0.04, d.v1 - 0.04, -4.9, d.v1 - 0.04);
    // The white swing in its arched frame, facing the lane.
    const su = -4.0, sv = 5.75, half = 0.95, top = d.top + 2.0;
    for (const s of [-1, 1]) for (const lean of [-1, 1]) {
      m.at(su + s * half, y + d.top, sv + lean * 0.3, 0, -lean * 0.16);   // the two legs of each end meet at the top
      m.box(0, 0.95, 0, 0.06, 1.9, 0.06, TRIM);
    }
    m.at(0, y, 0);
    for (let i = 0; i < 6; i++) {   // the arch, in six straight pieces
      const a0 = Math.PI * (i / 6), a1 = Math.PI * ((i + 1) / 6);
      const p0 = [su - Math.cos(a0) * half, top - 0.35 + Math.sin(a0) * 0.35], p1 = [su - Math.cos(a1) * half, top - 0.35 + Math.sin(a1) * 0.35];
      m.at((p0[0] + p1[0]) / 2, y + (p0[1] + p1[1]) / 2, sv, 0, 0, Math.atan2(p1[1] - p0[1], p1[0] - p0[0]));
      m.box(0, 0, 0, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + 0.04, 0.06, 0.06, TRIM);
    }
    m.at(0, y, 0);
    m.box(su, d.top + 0.5, sv, 1.3, 0.06, 0.5, TRIM);
    m.box(su, d.top + 0.8, sv - 0.24, 1.3, 0.5, 0.04, TRIM);
    for (const s of [-0.6, 0.6]) m.box(su + s, (d.top + 0.5 + top - 0.35) / 2, sv, 0.02, top - 0.35 - d.top - 0.5, 0.02, STEEL);
    // A yellow chair by the door.
    m.at(0.15, y + d.top, 5.55, 0.3);
    m.box(0, 0.38, 0, 0.62, 0.06, 0.6, CHAIR);
    m.box(0, 0.62, -0.32, 0.62, 0.62, 0.05, CHAIR);
    for (const [a, b] of [[-0.27, -0.25], [0.27, -0.25], [-0.27, 0.25], [0.27, 0.25]]) m.box(a, 0.18, b, 0.05, 0.36, 0.05, CHAIR);
  }

  private shed(m: Mesher, y: number): void {
    const s = SHED, su = (s.u0 + s.u1) / 2, sh = (s.u1 - s.u0) / 2;
    m.at(su, y, 0);
    m.extrude([[-sh, -1], [sh, -1], [sh, s.eave], [0, s.ridge], [-sh, s.eave]], s.v0, s.v1, STAIN);
    this.roof(m, sh, s.eave, s.ridge, s.v0 - 0.25, s.v1 + 0.25, 0.25, SHED_ROOF);
    m.at(0, y, 0);
    // Board lines, white corners, and the white band under the gable.
    this.siding(m, 'v', s.v1, 1, s.u0, s.u1, 0, s.eave, s.ridge, shade(STAIN, 0.72));
    this.siding(m, 'u', s.u1, 1, s.v0, s.v1, 0, s.eave, s.eave, shade(STAIN, 0.72));
    this.siding(m, 'u', s.u0, -1, s.v0, s.v1, 0, s.eave, s.eave, shade(STAIN, 0.72));
    for (const [u, v] of [[s.u0, s.v1], [s.u1, s.v1], [s.u0, s.v0], [s.u1, s.v0]]) m.box(u, s.eave / 2, v, 0.12, s.eave, 0.12, TRIM);
    m.box(su, s.eave, s.v1 + 0.03, s.u1 - s.u0, 0.14, 0.05, TRIM);
    // The double doors: white frames round brown panels, and black strap hinges.
    const du = 9.86, front = s.v1 + 0.03;
    m.box(du, 1.03, front, 1.96, 2.1, 0.04, TRIM);
    for (const side of [-1, 1]) {
      const leaf = du + side * 0.44;
      for (const [h0, h1] of [[0.12, 0.95], [1.1, 1.95]]) m.box(leaf, (h0 + h1) / 2, front + 0.02, 0.72, h1 - h0, 0.03, hex(0x8b6640));
      for (const h of [0.4, 1.6]) m.box(leaf + side * 0.25, h, front + 0.04, 0.4, 0.05, 0.02, SOOT);
    }
    m.box(du, 1.03, front + 0.035, 0.03, 2.0, 0.03, shade(TRIM, 0.7));
    // A small window in the far side (invented).
    this.opening(m, 'u', s.u1, 1, (s.v0 + s.v1) / 2, 1.2, 0.7, 0.6);
  }

  /** A pine: a bare trunk, then layers of needles that narrow toward the top. */
  private pine(m: Mesher, u: number, v: number, height: number, radius: number, from: number, rnd: () => number, round = false): void {
    const y = this.g(u, v);
    m.at(u, y, v, rnd() * 6.3);
    m.cyl(0, height * 0.42, 0, 0.24 * radius / 3.5, height * 0.84, round ? BARK : PINE_BARK, 'y', 7, 0.08);
    if (round) {
      // A young pine, full to the ground: rounded tiers that narrow to the top.
      for (let i = 0; i < 5; i++) {
        const t = i / 4, h0 = from + (height - from) * t * 0.86, r = radius * (1 - 0.75 * t * t) * (0.85 + rnd() * 0.3), k = i % 2 ? NEEDLES_LIGHT : NEEDLES, thick = (height - from) / 3.3;
        m.at(u + (rnd() - 0.5) * 0.4, y, v + (rnd() - 0.5) * 0.4, rnd() * 6.3);
        m.cyl(0, h0 + thick / 2, 0, r, thick, k, 'y', 8, r * 0.55, shade(k, 0.8));
      }
    } else {
      // An old pine: a bare trunk, then loose rounded clumps of needles on its branches, wide and flat, a crown on top.
      for (let i = 0; i < 11; i++) {
        const t = i / 10, h0 = from + (height - from - 1.2) * t, out = radius * (1 - 0.55 * t) * (0.35 + rnd() * 0.65), a = rnd() * 6.3;
        const r = radius * (0.42 - 0.12 * t) * (0.8 + rnd() * 0.4), k = i % 2 ? NEEDLES_LIGHT : NEEDLES;
        m.at(u + Math.cos(a) * out, y, v + Math.sin(a) * out, rnd() * 6.3);
        m.cyl(0, h0 + r * 0.3, 0, r, r * 0.65, k, 'y', 7, r * 0.6, shade(k, 0.8));
      }
      m.at(u, y, v, rnd() * 6.3);
      m.cyl(0, height - 0.6, 0, radius * 0.35, 1.2, NEEDLES, 'y', 7, radius * 0.12, shade(NEEDLES, 0.8));
    }
    this.solid(u - 0.3, u + 0.3, v - 0.3, v + 0.3);
  }

  /** A bush: a few rounded clumps around a point. */
  private bush(m: Mesher, u: number, v: number, r: number, h: number, k: RGB, rnd: () => number, clumps = 3): void {
    const y = this.g(u, v);
    for (let i = 0; i < clumps; i++) {
      const a = rnd() * 6.3, d = i ? r * 0.45 : 0, cr = r * (i ? 0.6 + rnd() * 0.2 : 0.8), ch = h * (i ? 0.7 + rnd() * 0.2 : 1);
      m.at(u + Math.cos(a) * d, y, v + Math.sin(a) * d, rnd() * 6.3);
      m.cyl(0, ch * 0.45, 0, cr, ch * 0.9, shade(k, 0.9 + rnd() * 0.2), 'y', 7, cr * 0.5, shade(k, 1.08));
    }
  }

  private yard(m: Mesher, rnd: () => number): void {
    // Two pines between the house and the lane, the larger one in front of the shed.
    PINES.forEach(([u, v, height, radius, from], i) => this.pine(m, u, v, height, radius, from, rnd, i === 1));
    // The garden bed: stones along both its edges, then its plants.
    for (let i = 0; i < BED.length; i++) {
      const [au, av] = BED[i], [bu, bv] = BED[(i + 1) % BED.length], len = Math.hypot(bu - au, bv - av);
      for (let s = 0; s < len; s += 0.34) {
        const t = (s + rnd() * 0.1) / len, u = au + (bu - au) * t, v = av + (bv - av) * t, r = 0.14 + rnd() * 0.1, k = shade(STONE, 0.8 + rnd() * 0.35);
        m.at(u, this.g(u, v) + r * 0.2, v, rnd() * 6.3, (rnd() - 0.5) * 0.4);
        m.cyl(0, 0, 0, r, r * (0.7 + rnd() * 0.4), k, 'y', 5, r * 0.55);
      }
    }
    // The red-berried bush: bare twigs thick with berries in November.
    const ru = -3.5, rv = 25.8, ry = this.g(ru, rv);
    for (let i = 0; i < 14; i++) {
      const a = rnd() * 6.3, lean = 0.25 + rnd() * 0.45, len = 2.2 + rnd() * 1.0;
      m.at(ru, ry, rv, a, 0, lean);
      m.cyl(0, len / 2, 0, 0.04, len, TWIGS, 'y', 4, 0.015, null);
    }
    // Berries in loose bunches all over the outer twigs: many small clusters with the twigs showing between them.
    for (let i = 0; i < 46; i++) {
      const a = rnd() * 6.3, d = 0.5 + rnd() * 1.4, h = 0.9 + rnd() * 2.1 - d * 0.25, r = 0.16 + rnd() * 0.14;
      m.at(ru + Math.cos(a) * d, ry + h, rv + Math.sin(a) * d, rnd() * 6.3, rnd() * 0.6);
      m.cyl(0, 0, 0, r, r * 0.8, shade(BERRIES, 0.8 + rnd() * 0.35), 'y', 5, r * 0.45, shade(BERRIES, 0.7));
    }
    this.bush(m, 3.0, 26.2, 0.75, 1.2, GOLD, rnd);                 // the golden shrub
    this.bush(m, -6.8, 26.9, 0.8, 1.0, BOX, rnd, 2);               // two round green ones near the drive
    this.bush(m, -5.6, 24.4, 0.9, 1.1, BOX, rnd, 2);
    for (const [u, v] of [[0.6, 27.6], [-1.6, 23.9], [2.2, 24.5], [-4.8, 28.6]]) this.bush(m, u, v, 0.5, 1.1, STRAW, rnd, 3);   // dry grasses
    for (const [u, v] of [[1.2, 28.8], [-2.2, 29.2], [4.0, 28.4]]) this.bush(m, u, v, 0.32, 0.35, SEDUM, rnd, 2);
    this.bush(m, -0.6, 13.6, 0.7, 1.0, BOX, rnd, 2);               // a shrub on the lawn

    // The woodpile past the drive: split wood in a long stack, half of it under a green tarp.
    const [wu, wv] = WOODPILE, wy = this.g(wu, wv);
    m.at(wu, wy, wv);
    m.box(0, 0.6, 0, 3.8, 1.2, 1.0, WOOD_ENDS);
    for (let i = 0; i < 18; i++) m.box(-1.8 + (i % 9) * 0.4 + 0.2, 0.3 + Math.floor(i / 9) * 0.55, 0.505, 0.3, 0.02, 0.01, shade(WOOD_ENDS, 0.7));
    m.box(-1.0, 1.24, 0, 1.95, 0.1, 1.15, TARP);
    m.box(-1.0, 0.75, 0.56, 1.95, 1.0, 0.04, TARP);
    m.box(-1.0, 0.75, -0.56, 1.95, 1.0, 0.04, TARP);
    m.box(1.6, 0.25, 0.9, 0.5, 0.5, 0.5, hex(0xe6e6e0));           // a white bag
    this.solid(wu - 1.9, wu + 1.9, wv - 0.5, wv + 0.5);

    // The flagpole by the apron, its flag hanging still.
    const fu = 7.3, fv = 24.6, fy = this.g(fu, fv);
    m.at(fu, fy, fv);
    m.cyl(0, 3.3, 0, 0.07, 6.6, POST, 'y', 6, 0.05);
    m.box(0.04, 6.0, 0.18, 0.01, 0.42, 0.24, FLAG_RED);
    m.box(0.04, 5.55, 0.18, 0.01, 0.48, 0.24, TRIM);
    m.box(0.045, 5.55, 0.18, 0.01, 0.16, 0.12, FLAG_RED);
    m.box(0.04, 5.1, 0.18, 0.01, 0.42, 0.24, FLAG_RED);
    this.solid(fu - 0.1, fu + 0.1, fv - 0.1, fv + 0.1);
    // A plain post at the mouth of the drive, and the orange snow stakes along it and at the apron.
    m.at(-7.2, this.g(-7.2, 24.7), 24.7, 0.2);
    m.box(0, 0.62, 0, 0.11, 1.24, 0.11, POST);
    this.solid(-7.26, -7.14, 24.64, 24.76);
    for (const [u, v] of [[-7.5, 27.6], [-7.6, 15.4], [-7.4, 11.8], [6.6, 26.2]]) {
      m.at(u, this.g(u, v), v);
      m.box(0, 0.35, 0, 0.025, 0.7, 0.025, hex(0xd8c040));
      m.box(0, 0.95, 0, 0.025, 0.5, 0.025, STAKE);
    }
  }
}
