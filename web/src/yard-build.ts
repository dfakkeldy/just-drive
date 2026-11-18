import * as THREE from 'three';
import { JUMP_LOAD } from './jump-rules';
import { parkedRow, vehicleShape, type Parked } from './parked';
import { letters, Mesher, SignAtlas, type RGB } from './yard-kit';
import { DOOR, INVENTED_SIGN, NAMED_SIGN, SLIP_RAMP, slipLift, type YardMode } from './yard-site';

/**
 * What stands in the works yard, in yard metres (u along the shop toward the north-east, v away from the highway).
 * Layout follows the provincial aerial photo and the owner's video; the stock is the kind a heavy civil and marine
 * contractor keeps between jobs. Nothing here names a business.
 */

export type LooseKind = 'box' | 'pipe' | 'drum' | 'cone' | 'tyre' | 'hpile' | 'frame' | 'wreck';
/** A thing the car can knock about. Sizes are metres along the piece, up, and across. */
export interface LooseSpec {
  kind: LooseKind; u: number; v: number; lift: number; yaw: number;
  size: [number, number, number]; colour: number; stack: number; mass: number; tips: boolean; stage: number;
  mesh?: THREE.Mesh;
}

export interface Ctx {
  m: Mesher;            // everything that never moves
  s: Mesher;            // sign faces, textured from the atlas
  d: Mesher;            // flat marks on the ground: slab joints
  atlas: SignAtlas;
  low: boolean;
  mode: YardMode;
  rampBase: number;
  rnd: () => number;
  /** Ground height at a yard point. */
  g(u: number, v: number): number;
  /** A solid rectangle: centre, half length along its own axis, half width, and that axis turned by yaw. */
  solid(u: number, v: number, half: number, halfWidth: number, yaw?: number): void;
  loose(spec: Partial<LooseSpec> & { kind: LooseKind; u: number; v: number }): void;
  /** A new stack number: pieces that share one come down together. */
  stack(): number;
  park(list: Parked[]): void;
  /** An assembled arch culvert the car can drive through: centre, axis direction in yard axes, number of units. */
  culvert(u: number, v: number, du: number, dv: number, units: number): void;
  /** Yard metres and a direction in yard axes to world metres and a compass heading. */
  world(u: number, v: number): { x: number; z: number };
  heading(du: number, dv: number): number;
}

// Colours are linear, as the game's other vertex colours are.
const STEEL: RGB = [0.09, 0.11, 0.14], RUST: RGB = [0.24, 0.10, 0.05], PRIMER: RGB = [0.36, 0.09, 0.07], GALV: RGB = [0.42, 0.45, 0.47];
const CONCRETE: RGB = [0.52, 0.51, 0.47], PRECAST: RGB = [0.60, 0.58, 0.54], TIMBER: RGB = [0.27, 0.17, 0.09], NEW_TIMBER: RGB = [0.50, 0.37, 0.20];
const YELLOW: RGB = [0.72, 0.45, 0.04], DARK: RGB = [0.04, 0.04, 0.045], GLASS: RGB = [0.06, 0.09, 0.11], WHITE: RGB = [0.74, 0.74, 0.71];
const TYRE: RGB = [0.035, 0.035, 0.038], STONE: RGB = [0.30, 0.29, 0.27], EARTH: RGB = [0.27, 0.21, 0.14], HIVIS: RGB = [0.95, 0.38, 0.03], LIME: RGB = [0.62, 0.78, 0.08];
const hex = (k: RGB) => new THREE.Color(k[0], k[1], k[2]).getHex();
const BLUE_PIPE = 0x1d4f9c, HDPE = 0x0c0c0d, TIMBER_HEX = hex(TIMBER), NEW_TIMBER_HEX = hex(NEW_TIMBER), PRECAST_HEX = hex(PRECAST), PRIMER_HEX = hex(PRIMER);
const CONTAINER: RGB[] = [[0.10, 0.20, 0.36], [0.33, 0.10, 0.07], [0.62, 0.62, 0.60], [0.12, 0.26, 0.20], [0.50, 0.30, 0.07], [0.34, 0.36, 0.38]];
const shade = (k: RGB, f: number): RGB => [k[0] * f, k[1] * f, k[2] * f];

/** Place the static mesher on the ground at a yard point. */
const on = (c: Ctx, u: number, v: number, yaw = 0, lift = 0) => c.m.at(u, c.g(u, v) + lift, v, yaw);

// ---- buildings -----------------------------------------------------------------------------

function shop(c: Ctx): void {
  const m = c.m, WALL: RGB = [0.115, 0.15, 0.20], ROOF: RGB = [0.60, 0.59, 0.55], ROOF_NEW: RGB = [0.70, 0.69, 0.65], LEAN: RGB = [0.13, 0.15, 0.18], DOORK: RGB = [0.70, 0.70, 0.67];
  const u0 = -46, u1 = 22.5, uc = (u0 + u1) / 2, len = u1 - u0, vc = 0.75, hw = 9.75, eave = 7.8, ridge = 8.6;
  const y = c.g(-10, vc);
  // Local +z runs along the shop; local x is across it, with the highway side positive.
  m.at(uc, y, vc, Math.PI / 2);
  m.extrude([[-hw, -1.5], [hw, -1.5], [hw, eave], [0, ridge], [-hw, eave]], -len / 2, len / 2, WALL);
  const over = 0.35, drop = (over * (ridge - eave)) / hw, split = -len / 2 + 23;   // the south-west third is a newer, paler roof
  for (const [z0, z1, k] of [[-len / 2 - over, split, ROOF_NEW], [split, len / 2 + over, ROOF]] as [number, number, RGB][]) {
    m.quad([[-hw - over, eave - drop + 0.05, z1], [0, ridge + 0.05, z1], [0, ridge + 0.05, z0], [-hw - over, eave - drop + 0.05, z0]], k);
    m.quad([[0, ridge + 0.05, z1], [hw + over, eave - drop + 0.05, z1], [hw + over, eave - drop + 0.05, z0], [0, ridge + 0.05, z0]], shade(k, 0.93));
  }
  for (let z = -len / 2 + 4; z < len / 2; z += 9) m.box(0, ridge + 0.3, z, 0.9, 0.5, 0.9, GALV);   // ridge vents
  m.box(hw + 0.02, eave - 0.25, 0, 0.06, 0.5, len + 0.1, DOORK);   // a pale band under each eave
  m.box(-hw - 0.02, eave - 0.25, 0, 0.06, 0.5, len + 0.1, DOORK);
  // Office wing along the highway side: a low lean-to with a dark roof.
  const lw = 6, lu0 = -44, ll = u1 - lu0, lz = (lu0 + u1) / 2 - uc;
  m.extrude([[hw, -1.5], [hw + lw, -1.5], [hw + lw, 3.0], [hw, 4.6]], lz - ll / 2, lz + ll / 2, shade(WALL, 1.15));
  m.quad([[hw, 4.68, lz + ll / 2 + 0.2], [hw + lw + 0.4, 2.97, lz + ll / 2 + 0.2], [hw + lw + 0.4, 2.97, lz - ll / 2 - 0.2], [hw, 4.68, lz - ll / 2 - 0.2]], LEAN);
  const face = hw + lw + 0.03, doorZ = DOOR.u - uc;
  for (let z = lz - ll / 2 + 2.6; z < lz + ll / 2 - 1.5; z += 3.4) {
    if (Math.abs(z - doorZ) < 2.4) continue;
    m.box(face, 1.75, z, 0.06, 1.15, 1.7, GLASS);
    m.box(face + 0.01, 1.75, z, 0.06, 1.25, 0.07, DOORK);
  }
  // The main door, under a small canopy, with a concrete step.
  m.box(face, 1.08, doorZ, 0.08, 2.16, 1.9, GLASS);
  m.box(face + 0.02, 1.08, doorZ, 0.08, 2.16, 0.08, DOORK);
  m.box(face + 0.02, 2.22, doorZ, 0.1, 0.12, 2.1, DOORK);
  m.box(hw + lw + 0.9, 2.62, doorZ, 1.9, 0.14, 3.4, LEAN);
  m.box(hw + lw + 0.8, 0.06, doorZ, 1.6, 0.14, 3.0, CONCRETE);
  // Six repair bays on the yard side, each with a tall roll-up door.
  for (let i = 0; i < 6; i++) {
    const z = -38 + i * 10.2 - uc;
    m.box(-hw - 0.03, 2.9, z, 0.07, 5.8, 5.4, DOORK);
    for (let h = 0.9; h < 5.8; h += 0.95) m.box(-hw - 0.05, h, z, 0.07, 0.05, 5.4, shade(DOORK, 0.72));
    m.box(-hw - 0.05, 4.25, z, 0.07, 0.6, 3.6, GLASS);
    m.box(-hw - 0.06, 6.3, z, 0.08, 0.5, 0.9, WHITE);   // bay number plate
    for (const s of [-1, 1]) m.box(-hw - 0.4, 0.5, z + s * 3.1, 0.22, 1.0, 0.22, YELLOW);   // bollards
  }
  m.box(-hw - 0.03, 1.05, 5 * 10.2 - 38 + 6.2 - uc, 0.07, 2.1, 1.0, DOORK);
  // A wide door in the south-west end, and the two site trailers at the north-east end.
  m.box(-2, 2.6, -len / 2 - 0.03, 5.0, 5.2, 0.07, DOORK);
  c.solid(uc, vc, len / 2, hw);
  c.solid((lu0 + u1) / 2, vc - hw - lw / 2, ll / 2, lw / 2);
  for (const tu of [27.4, 31.2]) {
    on(c, tu, 3.5, 0, 0.45);
    m.box(0, 1.35, 0, 3.0, 2.7, 12.5, [0.70, 0.70, 0.66]);
    m.box(1.52, 1.6, -2, 0.05, 0.9, 1.4, GLASS); m.box(1.52, 1.05, 2.5, 0.05, 2.0, 0.9, [0.3, 0.3, 0.3]);
    c.m.at(tu, c.g(tu, 3.5), 3.5); for (const dv of [-5, 0, 5]) m.box(0, 0.22, dv, 2.2, 0.45, 0.4, TIMBER);
    c.solid(tu, 3.5, 6.25, 1.5, -Math.PI / 2);
  }
}

/** Three fabric storage arches side by side, their open ends toward the shop, and the three fuel tanks behind. */
function arches(c: Ctx): void {
  const m = c.m, FABRIC: RGB = [0.78, 0.78, 0.75], END_RED: RGB = [0.36, 0.13, 0.09], n = c.low ? 7 : 10;
  const profile: number[][] = [];
  for (let i = 0; i <= n; i++) { const t = (i / n) * Math.PI; profile.push([7.7 * Math.cos(t), 9.0 * Math.sin(t) ** 0.72]); }
  [-27.8, -12.2, 3.4].forEach((v, i) => {
    const y = c.g(84.5, v);
    m.at(84.5, y - 0.4, v, Math.PI / 2);
    m.extrude(profile, -7.5, 7.5, FABRIC, null);
    const end: RGB = i === 2 ? END_RED : shade(FABRIC, 0.95);
    for (const z of [-7.5, 7.5]) for (let k = 0; k < n; k++) {
      const a = profile[k], b = profile[k + 1];
      if (z < 0) m.tri(0, 0, z, b[0], b[1], z, a[0], a[1], z, end); else m.tri(0, 0, z, a[0], a[1], z, b[0], b[1], z, shade(FABRIC, 0.9));
    }
    m.box(0, 3.0, -7.56, 5.2, 5.2, 0.08, shade(FABRIC, 0.55));   // roll-up end door
    for (let k = 1; k < n; k += 1) { const a = profile[k]; m.box(a[0], a[1], 0, 0.12, 0.12, 15.1, shade(FABRIC, 0.82)); }   // frame lines under the fabric
    c.solid(84.5, v, 7.5, 7.7);
  });
  [-27, -11, 4.4].forEach((v) => {
    on(c, 96.4, v);
    m.cyl(0, 2.9, 0, 3.7, 5.8, [0.07, 0.10, 0.09], 'y', c.low ? 10 : 14, 3.7, null);
    m.cyl(0, 6.15, 0, 3.7, 0.7, [0.10, 0.13, 0.12], 'y', c.low ? 10 : 14, 0.4);
    m.cyl(0, 1.2, 0, 3.74, 0.5, [0.52, 0.50, 0.44], 'y', c.low ? 10 : 14, 3.74, null);
    m.box(3.8, 3.0, 0, 0.12, 6.0, 0.6, GALV);
    m.cyl(0, 0.12, 0, 4.3, 0.24, CONCRETE, 'y', 12);
    c.solid(96.4, v, 3.5, 3.5);
  });
}

// ---- things that stand in rows ---------------------------------------------------------------

function container(c: Ctx, u: number, v: number, yaw: number, k: RGB, len = 12.2, lift = 0): void {
  on(c, u, v, yaw, lift);
  c.m.box(0, 1.3, 0, len, 2.6, 2.44, k);
  for (let x = -len / 2 + 0.6; x < len / 2; x += 1.2) for (const s of [-1, 1]) c.m.box(x, 1.3, s * 1.23, 0.1, 2.4, 0.05, shade(k, 0.8));
  c.m.box(len / 2 + 0.01, 1.3, 0, 0.04, 2.3, 2.1, shade(k, 0.7));
  if (lift === 0) c.solid(u, v, len / 2, 1.22, yaw);
}

function barriers(c: Ctx, u: number, v: number, yaw: number, count: number): void {
  const profile = [[-0.3, 0], [0.3, 0], [0.3, 0.2], [0.12, 0.45], [0.08, 0.81], [-0.08, 0.81], [-0.12, 0.45], [-0.3, 0.2]];
  const du = Math.cos(yaw), dv = -Math.sin(yaw);
  for (let i = 0; i < count; i++) {
    const t = (i - (count - 1) / 2) * 3.1, bu = u + du * t, bv = v + dv * t;
    on(c, bu, bv, yaw + Math.PI / 2);
    c.m.extrude(profile, -1.5, 1.5, CONCRETE);
  }
  c.solid(u, v, count * 1.55, 0.3, yaw);
}

/** A stack of long pieces of one kind laid side by side in layers: pipe, timber, H-piles. All of it can be knocked down. */
function bundle(c: Ctx, kind: 'pipe' | 'hpile' | 'box', u: number, v: number, yaw: number, len: number, d: number, across: number, layers: number, colour: number, mass: number, opts: { taper?: boolean; height?: number; dunnage?: boolean; stage?: number } = {}): void {
  const stack = c.stack(), h = opts.height ?? d, nu = -Math.sin(yaw), nv = -Math.cos(yaw);   // across the pieces
  const base = opts.dunnage === false ? 0 : 0.15;
  if (base) for (const t of [-len * 0.3, len * 0.3]) {
    const du = Math.cos(yaw) * t, dv = -Math.sin(yaw) * t;
    on(c, u + du, v + dv, yaw + Math.PI / 2); c.m.box(0, 0.075, 0, across * d + 0.4, 0.15, 0.15, TIMBER);
  }
  for (let l = 0; l < layers; l++) {
    const n = opts.taper ? across - l : across, off = opts.taper ? l * 0.5 : 0;
    for (let i = 0; i < n; i++) {
      const t = (i + off - (across - 1) / 2) * d * 1.02;
      c.loose({ kind, u: u + nu * t, v: v + nv * t, lift: base + l * h * (kind === 'pipe' ? 0.87 : 1), yaw, size: [len, h, d], colour, stack, mass, stage: opts.stage ?? 0 });
    }
  }
}

/** A rack of long stock laid side by side on dunnage: steel sections, pipe, timber. It does not move. */
function rack(c: Ctx, u: number, v: number, yaw: number, n: number, len: number, palette: RGB[], w = 1.25): void {
  const span = n * (w + 0.25);
  on(c, u, v, yaw);
  for (const t of [-len * 0.3, len * 0.3]) c.m.box(t, 0.1, 0, 0.2, 0.2, span, TIMBER);
  for (let i = 0; i < n; i++) {
    const k = palette[Math.floor(c.rnd() * palette.length)], l = len * (0.78 + c.rnd() * 0.22), h = 0.35 + c.rnd() * 0.75;
    c.m.box((c.rnd() - 0.5) * (len - l), 0.2 + h / 2, (i - (n - 1) / 2) * (w + 0.25), l, h, w, shade(k, 0.85 + c.rnd() * 0.3));
  }
  c.solid(u, v, len / 2, span / 2, yaw);
}
const RUSTS: RGB[] = [RUST, [0.30, 0.13, 0.06], [0.20, 0.09, 0.05], PRIMER], STEELS: RGB[] = [STEEL, GALV, [0.16, 0.22, 0.30], [0.30, 0.32, 0.34]], MIXED: RGB[] = [RUST, GALV, TIMBER, NEW_TIMBER, STEEL, PRECAST];

function pallets(c: Ctx, u: number, v: number, yaw: number, count: number, load: number | null = null): void {
  const stack = c.stack();
  for (let i = 0; i < count; i++) c.loose({ kind: 'box', u, v, lift: i * 0.15, yaw: yaw + (c.rnd() - 0.5) * 0.06, size: [1.2, 0.14, 1.0], colour: NEW_TIMBER_HEX, stack, mass: 0.4 });
  if (load !== null) for (const [du, dv] of [[-0.3, -0.25], [0.3, -0.25], [-0.3, 0.25], [0.3, 0.25]]) {
    const a = Math.cos(yaw), b = -Math.sin(yaw);
    c.loose({ kind: 'drum', u: u + du * a - dv * b, v: v + du * b + dv * a, lift: count * 0.15, yaw: 0, colour: load, stack, mass: 0.8, tips: true });
  }
}

function cones(c: Ctx, pts: [number, number][], stage = 0): void {
  for (const [u, v] of pts) c.loose({ kind: 'cone', u, v, yaw: c.rnd() * 6, mass: 0.1, tips: true, stage, stack: 0 });
}
const ring = (u: number, v: number, hu: number, hv: number): [number, number][] => [[u - hu, v - hv], [u + hu, v - hv], [u + hu, v + hv], [u - hu, v + hv], [u, v - hv], [u, v + hv]];

function rock(c: Ctx, u: number, v: number, size: number, k: RGB = STONE, lift = 0): void {
  const geo = new THREE.IcosahedronGeometry(1, 0).toNonIndexed(), p = geo.getAttribute('position');
  const sx = size * (0.8 + c.rnd() * 0.5), sy = size * (0.55 + c.rnd() * 0.3), sz = size * (0.8 + c.rnd() * 0.5), tone = 0.85 + c.rnd() * 0.3;
  on(c, u, v, c.rnd() * 6, lift + sy * 0.45);
  for (let i = 0; i < p.count; i += 3) {
    c.m.tri(p.getX(i) * sx, p.getY(i) * sy, p.getZ(i) * sz, p.getX(i + 1) * sx, p.getY(i + 1) * sy, p.getZ(i + 1) * sz, p.getX(i + 2) * sx, p.getY(i + 2) * sy, p.getZ(i + 2) * sz, shade(k, tone * (0.9 + 0.2 * ((i / 3) % 3) / 2)));
  }
  geo.dispose();
}

function heap(c: Ctx, u: number, v: number, r: number, h: number, k: RGB): void {
  on(c, u, v, c.rnd());
  c.m.cyl(0, h * 0.3, 0, r, h * 0.6, k, 'y', c.low ? 8 : 11, r * 0.5, null);
  c.m.cyl(0, h * 0.8, 0, r * 0.5, h * 0.4, shade(k, 1.08), 'y', c.low ? 8 : 11, 0.2);
  c.solid(u, v, r * 0.75, r * 0.75);
}

/** A stencilled board on a stake. The face looks along -v unless turned. */
function board(c: Ctx, u: number, v: number, lines: string[], yaw = Math.PI, w = 1.5, h = 0.8, ground = '#e9e4d2', ink = '#161616', top = 1.95): void {
  on(c, u, v, yaw);
  c.m.box(0, top / 2, -0.04, 0.07, top, 0.07, TIMBER);
  c.m.box(0, top - h / 2, -0.012, w + 0.04, h + 0.04, 0.02, [0.2, 0.2, 0.2]);
  const { cell } = c.atlas.add(256, Math.round((256 * h) / w), (g, cw, ch) => letters(g, cw, ch, lines, ink, ground, { font: '"Courier New", monospace', border: ink }));
  c.s.at(u, c.g(u, v) + top - h / 2, v, yaw); c.s.plate(w, h, cell, 0.024);
}

function person(c: Ctx, u: number, v: number, yaw: number, pose: 'stand' | 'folded' | 'clipboard' = 'stand', m: Mesher = c.m): void {
  const vest: RGB = c.rnd() < 0.5 ? HIVIS : LIME, y = c.g(u, v);
  m.at(u, y, v, yaw);
  for (const s of [-1, 1]) { m.box(s * 0.11, 0.42, 0, 0.17, 0.84, 0.2, [0.05, 0.06, 0.09]); m.box(s * 0.11, 0.05, 0.05, 0.18, 0.1, 0.3, DARK); }
  m.box(0, 1.14, 0, 0.44, 0.62, 0.25, vest);
  m.box(0, 1.08, 0, 0.455, 0.06, 0.26, [0.8, 0.8, 0.78]); m.box(0, 1.28, 0, 0.455, 0.06, 0.26, [0.8, 0.8, 0.78]);   // reflective bands
  m.box(0, 1.6, 0, 0.21, 0.24, 0.22, [0.55, 0.43, 0.34]);   // a head, and no face
  m.cyl(0, 1.76, 0, 0.15, 0.13, [0.82, 0.80, 0.74], 'y', 8, 0.11); m.box(0, 1.705, 0.07, 0.3, 0.03, 0.36, [0.82, 0.80, 0.74]);
  if (pose === 'folded') { m.box(0, 1.2, 0.16, 0.5, 0.11, 0.12, vest); for (const s of [-1, 1]) m.box(s * 0.27, 1.3, 0.06, 0.11, 0.3, 0.14, vest); }
  else if (pose === 'clipboard') {
    for (const s of [-1, 1]) m.box(s * 0.27, 1.22, 0.1, 0.11, 0.34, 0.2, vest);
    m.box(0, 1.15, 0.26, 0.26, 0.34, 0.03, [0.7, 0.68, 0.6]);
  } else for (const s of [-1, 1]) m.box(s * 0.28, 1.12, 0, 0.11, 0.62, 0.13, vest);
}
export const watcher = person;

// ---- machines --------------------------------------------------------------------------------

function wheels(c: Ctx, f: THREE.Matrix4, xs: number[], half: number, r: number, w = 0.35): void {
  for (const x of xs) for (const s of [-1, 1]) { c.m.within(f, x, r, s * half); c.m.cyl(0, 0, 0, r, w, TYRE, 'z', 8); }
}
const frameAt = (c: Ctx, u: number, v: number, yaw: number) => on(c, u, v, yaw).frame;

function excavator(c: Ctx, u: number, v: number, yaw: number): void {
  const m = c.m, f = frameAt(c, u, v, yaw);
  for (const s of [-1, 1]) { m.within(f, 0, 0, 0); m.box(0, 0.4, s * 1.25, 4.2, 0.8, 0.6, DARK); }
  m.within(f, 0, 0, 0, 0.5);
  m.box(-0.4, 1.55, 0, 3.4, 1.3, 2.6, YELLOW); m.box(-1.7, 1.35, 0, 0.9, 1.0, 2.7, shade(YELLOW, 0.7));
  m.box(0.75, 2.75, -0.75, 1.3, 1.3, 1.0, GLASS); m.box(0.75, 3.43, -0.75, 1.4, 0.08, 1.1, YELLOW);
  m.within(f, 1.2, 2.2, 0.45, 0.5, 0, 0.75); m.box(2.3, 0, 0, 5.0, 0.5, 0.42, YELLOW);
  m.within(f, 4.2, 5.05, -1.2, 0.5, 0, -1.05); m.box(1.5, 0, 0, 3.2, 0.36, 0.34, YELLOW);
  m.within(f, 5.35, 1.6, -1.85, 0.5); m.box(0, 0.2, 0, 1.0, 0.9, 1.1, DARK);
  c.solid(u, v, 2.6, 1.6, yaw);
}

function loader(c: Ctx, u: number, v: number, yaw: number): void {
  const m = c.m, f = frameAt(c, u, v, yaw);
  wheels(c, f, [-1.5, 1.5], 1.2, 0.8, 0.6);
  m.within(f, 0, 0, 0);
  m.box(-1.3, 1.5, 0, 2.6, 1.3, 2.2, YELLOW); m.box(1.0, 1.25, 0, 1.6, 0.9, 1.9, YELLOW);
  m.box(-0.2, 2.75, 0, 1.4, 1.3, 1.5, GLASS); m.box(-0.2, 3.45, 0, 1.5, 0.08, 1.6, YELLOW);
  for (const s of [-1, 1]) { m.within(f, 1.4, 1.5, s * 0.8, 0, 0, -0.32); m.box(1.3, 0, 0, 2.8, 0.28, 0.2, YELLOW); }
  m.within(f, 3.9, 0.55, 0); m.box(0, 0, 0, 1.1, 1.0, 2.9, DARK);
  c.solid(u, v, 3.0, 1.45, yaw);
}

function truck(c: Ctx, u: number, v: number, yaw: number, body: 'dump' | 'flat' | 'none', cab: RGB, hoodUp = false): void {
  const m = c.m, f = frameAt(c, u, v, yaw);
  wheels(c, f, body === 'none' ? [-2.2, 2.3] : [-2.9, -1.7, 2.6], 1.05, 0.52, 0.5);
  m.within(f, 0, 0, 0);
  m.box(-0.4, 0.95, 0, 7.4, 0.3, 1.0, DARK);
  m.box(2.2, 2.0, 0, 1.6, 1.9, 2.4, cab); m.box(2.95, 2.45, 0, 0.12, 0.75, 2.1, GLASS); m.box(3.55, 1.55, 0, 1.3, 1.0, 2.2, cab);
  m.box(4.23, 1.5, 0, 0.06, 0.7, 1.5, DARK);
  if (hoodUp) { m.within(f, 3.0, 2.05, 0, 0, 0, 1.0); m.box(0.6, 0, 0, 1.3, 0.07, 2.2, cab); }
  m.within(f, 0, 0, 0);
  if (body === 'dump') {
    m.box(-1.3, 2.1, 0, 5.0, 1.5, 2.5, [0.33, 0.34, 0.35]); m.box(-1.3, 2.86, 0, 4.8, 0.02, 2.3, [0.17, 0.16, 0.15]);
    m.box(1.3, 2.95, 0, 0.9, 0.12, 2.5, [0.33, 0.34, 0.35]);
  } else if (body === 'flat') {
    m.box(-1.4, 1.25, 0, 5.2, 0.2, 2.5, TIMBER);
    m.box(-1.4, 1.65, 0, 4.2, 0.6, 1.6, PRECAST);
  }
  c.solid(u, v, 4.1, 1.25, yaw);
}

function trailer(c: Ctx, u: number, v: number, yaw: number, load: 'mats' | 'empty' | 'van', k: RGB = WHITE): void {
  const m = c.m, f = frameAt(c, u, v, yaw);
  wheels(c, f, [-5.2, -4.0], 1.05, 0.5, 0.5);
  m.within(f, 0, 0, 0);
  m.box(0, 1.25, 0, 13.4, 0.25, 2.55, load === 'van' ? DARK : shade(STEEL, 1.4));
  for (const s of [-1, 1]) m.box(4.4, 0.55, s * 0.8, 0.14, 1.1, 0.14, GALV);
  if (load === 'mats') for (let i = 0; i < 3; i++) m.box(-0.5 + i * 0.1, 1.55 + i * 0.32, 0, 9.5, 0.3, 2.4, shade(TIMBER, 1 + i * 0.12));
  if (load === 'van') { m.box(0, 2.75, 0, 13.4, 2.75, 2.55, k); m.box(-6.72, 2.75, 0, 0.04, 2.5, 2.2, shade(k, 0.8)); }
  c.solid(u, v, 6.7, 1.28, yaw);
}

/** A crawler crane parked with its lattice boom lowered onto timber cribbing. */
function crane(c: Ctx, u: number, v: number, yaw: number): void {
  const m = c.m, f = frameAt(c, u, v, yaw), RED: RGB = [0.42, 0.08, 0.05];
  for (const s of [-1, 1]) { m.within(f, 0, 0, 0); m.box(0, 0.55, s * 1.9, 6.4, 1.1, 0.9, DARK); }
  m.within(f, 0, 0, 0);
  m.box(-0.6, 2.1, 0, 5.2, 1.9, 3.3, RED); m.box(-3.0, 1.9, 0, 1.2, 1.5, 3.4, shade(STEEL, 1.3));
  m.box(1.6, 3.0, -1.1, 1.5, 1.5, 1.1, GLASS);
  // The boom: four chords and lacing, as boxes; it slopes down to the cribs.
  const L = 26, tilt = -0.045;
  m.within(f, 2.0, 2.4, 0.4, 0, 0, tilt);
  for (const a of [-0.55, 0.55]) for (const b of [-0.55, 0.55]) m.box(L / 2, a, b, L, 0.12, 0.12, YELLOW);
  for (let x = 0.6; x < L; x += 1.3) { m.box(x, 0, 0.55, 0.07, 1.1, 0.07, YELLOW); m.box(x, 0, -0.55, 0.07, 1.1, 0.07, YELLOW); m.box(x, 0.55, 0, 0.07, 0.07, 1.1, YELLOW); }
  m.box(L + 0.5, 0, 0, 1.0, 0.8, 0.5, DARK);
  for (const x of [14, 26]) { m.within(f, x + 2, 0, 0.4); m.box(0, 0.45 + (26 - x) * 0.02, 0, 1.2, 0.9 + (26 - x) * 0.04, 1.8, TIMBER); }
  c.solid(u, v, 3.3, 2.4, yaw);
  const du = Math.cos(yaw), dv = -Math.sin(yaw);
  c.solid(u + du * 15.5, v + dv * 15.5 + 0.4 * du, 13.5, 0.8, yaw);
}

/** A small work barge on blocks, with a winch on deck: the marine side of the business. */
function barge(c: Ctx, u: number, v: number, yaw: number): void {
  const m = c.m, f = frameAt(c, u, v, yaw), HULL: RGB = [0.10, 0.12, 0.14];
  for (const x of [-4.5, 0, 4.5]) { m.within(f, x, 0, 0); m.box(0, 0.35, 0, 0.8, 0.7, 5.6, TIMBER); }
  m.within(f, 0, 0.7, 0, Math.PI / 2);
  m.extrude([[-2.6, 0.5], [-2.2, 0], [2.2, 0], [2.6, 0.5], [2.6, 1.6], [-2.6, 1.6]], -6.5, 6.5, HULL, [0.30, 0.10, 0.07]);
  m.within(f, 0, 0, 0);
  m.box(0, 2.34, 0, 12.6, 0.06, 4.9, [0.30, 0.31, 0.30]);
  m.box(3.5, 2.75, 0, 1.6, 0.8, 1.4, YELLOW); m.cyl(3.5, 3.0, 0, 0.45, 1.5, DARK, 'z', 8);   // winch
  for (const x of [-6, 6]) for (const s of [-1, 1]) m.box(x * 0.97, 2.6, s * 2.2, 0.25, 0.5, 0.25, DARK);   // bitts
  for (let x = -6; x <= 6; x += 3) m.cyl(x, 1.7, 2.75, 0.5, 0.3, TYRE, 'z', 8);   // tyre fenders
  c.solid(u, v, 6.5, 2.7, yaw);
}

/** A wind tower section on cradles, and two foundation anchor cages. */
function wind(c: Ctx, u: number, v: number, yaw: number): void {
  const m = c.m, f = frameAt(c, u, v, yaw);
  m.within(f, 0, 2.6, 0); m.cyl(0, 0, 0, 2.1, 20, [0.72, 0.73, 0.72], 'x', c.low ? 10 : 14, 1.9, [0.2, 0.2, 0.2]);
  for (const x of [-7, 7]) { m.within(f, x, 0, 0); m.box(0, 0.5, 0, 1.0, 1.0, 4.6, YELLOW); }
  c.solid(u, v, 10, 2.1, yaw);
  for (const off of [-7, 7]) {
    const cu = u + Math.cos(yaw) * off + Math.sin(yaw) * 7.5, cv = v - Math.sin(yaw) * off + Math.cos(yaw) * 7.5;
    on(c, cu, cv);
    for (const y of [0.12, 2.9]) m.cyl(0, y, 0, 2.2, 0.14, STEEL, 'y', 12, 2.2, null);
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; m.box(Math.cos(a) * 2.2, 1.5, Math.sin(a) * 2.2, 0.06, 3.0, 0.06, RUST); }
    c.solid(cu, cv, 2.2, 2.2);
  }
}

// ---- the five job lots ---------------------------------------------------------------------------

/** The precast arch culvert, set up as a trial assembly that the car can drive through, with spare footing sections. */
function archLot(c: Ctx, u: number, v: number): void {
  const m = c.m, units = 8, half = units * 0.9125;
  c.culvert(u, v, 1, 0, units);
  for (let i = 0; i < 4; i++) for (let l = 0; l < 2; l++) {
    on(c, u - 4 + i * 2.9, v + 9.4, 0, 0.15 + l * 0.72);
    m.box(0, 0.3, 0, 2.7, 0.6, 1.8, shade(CONCRETE, 0.95 + l * 0.08)); m.box(0, -0.06, 0, 0.15, 0.12, 1.8, TIMBER);
  }
  c.solid(u + 0.35, v + 9.4, 5.8, 0.9);
  board(c, u - half - 2.5, v - 6.4, ['BROADWAY:', 'ARCH 9.1 m']);
  cones(c, [[u - half - 1.5, v - 5.6], [u - half - 1.5, v + 5.6], [u + half + 1.5, v - 5.6], [u + half + 1.5, v + 5.6]], 2);
}

/** A trial slip on short pile bents and cribbing, with spare stock alongside. */
function slipLot(c: Ctx, u: number, v: number): void {
  const m = c.m;
  const r = SLIP_RAMP, base = c.rampBase, slope = (r.rise - r.toe) / r.length;
  const start = m.triangles;
  // Panels have true thickness and visible joints; their top corners use the site's exact height function.
  for (let row = 0; row < 4; row++) for (const side of [-1, 1]) {
    const a = r.lead + row * 4, b = a + 4, z0 = r.v + (side < 0 ? -2.4 : 0), z1 = z0 + 2.4;
    m.at(0, base, 0);
    const x0 = r.u - a, x1 = r.u - b, y0 = slipLift(a), y1 = slipLift(b);
    m.extrude([[x1, y1 - 0.25], [x0, y0 - 0.25], [x0, y0], [x1, y1]], z0, z1, shade(PRECAST, 1 + row * 0.015));
    // Dark, narrow seam marks do not introduce steps in the driving surface.
    if (side < 0) {
      m.at((x0 + x1) / 2, base + (y0 + y1) / 2 + 0.002, r.v, 0, 0, -Math.atan(slope));
      m.box(0, 0, 0, Math.hypot(4, 4 * slope), 0.003, 0.018, shade(CONCRETE, 0.55));
    }
    if (side < 0 && row > 0) {
      m.at(x0, base + y0 + 0.002, r.v, 0, 0, -Math.atan(slope));
      m.box(0, 0, 0, 0.018, 0.003, r.width, shade(CONCRETE, 0.55));
    }
  }
  // A steel-plate tongue reaches the ground without a wheel-catching vertical lip.
  m.at(0, base, 0);
  m.extrude([[r.u - r.lead, r.toe - 0.04], [r.u, -0.04], [r.u, 0], [r.u - r.lead, r.toe]], r.v - 2.4, r.v + 2.4, STEEL);
  for (let bent = 1; bent <= 4; bent++) {
    const along = r.lead + bent * 4 - 0.2, bu = r.u - along, top = base + slipLift(along) - 0.25;
    const floor = c.g(bu, r.v + 2.9), cap = top - 0.16;
    // The first joint beds directly on the ground; only the raised joints need stub bents.
    if (cap - floor < 0.1) continue;
    m.at(bu, floor, r.v);
    // Alternating crib layers close the underside; paired H stubs carry the steel cap.
    const crib = Math.max(0.08, cap - floor - 0.22), layers = Math.max(1, Math.ceil(crib / 0.2));
    for (let layer = 0; layer < layers; layer++) {
      const y = crib * (layer + 0.5) / layers, thick = crib / layers;
      if (layer % 2) for (const z of [-1.8, 0, 1.8]) m.box(0, y, z, 1.05, thick, 0.22, TIMBER);
      else for (const x of [-0.4, 0.4]) m.box(x, y, 0, 0.22, thick, 4.7, TIMBER);
    }
    for (const z of [-1.85, 1.85]) {
      const h = cap - floor - crib;
      for (const x of [-0.14, 0.14]) m.box(x, crib + h / 2, z, 0.035, h, 0.32, PRIMER);
      m.box(0, crib + h / 2, z, 0.28, h, 0.035, PRIMER);
    }
    m.box(0, cap - floor + 0.08, 0, 0.32, 0.16, 4.9, STEEL);
  }
  // Timber fenders guide the car. Narrow solids stop side entries without sealing either end of the deck.
  for (const side of [-1, 1]) {
    const mid = r.lead + r.length / 2;
    m.at(r.u - mid, base + slipLift(mid), r.v + side * 2.55, 0, 0, -Math.atan(slope));
    m.box(0, 0.12, 0, Math.hypot(r.length, r.rise - r.toe), 0.24, 0.28, TIMBER);
    for (let i = 0; i < 5; i++) m.box(-7.6 + i * 3.8, 0.13, -side * 0.15, 0.07, 0.07, 0.025, GALV);
    c.solid(r.u - mid, r.v + side * 2.55, r.length / 2, 0.14);
  }
  console.info(`[yard-ramp] ${m.triangles - start} assembly triangles`);
  // Three strapped pipe bundles on bearers. Their ends form one low, broad load across the flight path.
  const load = JUMP_LOAD, centre = r.u - load.near - load.length / 2;
  const bed = c.g(r.u - load.near - load.length, r.v);
  m.at(centre, bed, r.v);
  for (const z of [-2, 0, 2]) {
    for (const x of [-1.9, 1.9]) m.box(x, 0.04, z, 0.18, 0.08, 1.75, NEW_TIMBER);
    for (const dz of [-0.63, -0.21, 0.21, 0.63]) {
      m.cyl(0, 0.29, z + dz, 0.21, load.length, STEEL, 'x', c.low ? 8 : 12, 0.21, DARK);
      // Open bores and pale end rims make the low load legible from the run-up.
      for (const end of [-1, 1]) m.cyl(end * (load.length / 2 + 0.004), 0.29, z + dz, 0.16, 0.012, DARK, 'x', 8);
    }
    for (const x of [-1.8, 1.8]) m.box(x, 0.505, z, 0.065, 0.012, 1.72, YELLOW);
  }
  bundle(c, 'hpile', u - 6, v, 0, 7.0, 0.33, 3, 1, PRIMER_HEX, 2.5);
  const wave = [[0, 0], [0.2, 0], [0.45, 0.44], [0.95, 0.44], [1.2, 0], [1.4, 0], [1.4, -0.035], [1.18, -0.035], [0.93, 0.405], [0.47, 0.405], [0.22, -0.035], [0, -0.035]];
  for (let l = 0; l < 3; l++) for (let k = 0; k < 2; k++) {
    on(c, u + 3.2 + k * 1.45, v, 0, 0.2 + l * 0.11);
    m.within(m.frame, -0.7, 0.04, 0, Math.PI / 2); m.extrude(wave.map(([x, y]) => [x - 0.7, y]), -6, 6, shade(RUST, 0.9 + l * 0.05));
  }
  for (const t of [-4, 4]) { on(c, u + 3.9, v, 0); m.box(t, 0.1, 0, 0.2, 0.2, 3.2, TIMBER); }
  c.solid(u + 3.9, v, 6, 1.5);
  const stack = c.stack();
  for (let l = 0; l < 3; l++) c.loose({ kind: 'box', u: u - 5, v: v + 6, lift: 0.15 + l * 0.3, yaw: 0, size: [4.0, 0.25, 2.4], colour: PRECAST_HEX, stack, mass: 6 });
  for (const t of [-1.3, 1.3]) { on(c, u - 5 + t, v + 6); m.box(0, 0.075, 0, 0.15, 0.15, 2.4, TIMBER); }
  bundle(c, 'pipe', u + 3, v + 6, 0, 5.5, 0.3, 3, 1, TIMBER_HEX, 1.2, { taper: true });
  for (let i = 0; i < 5; i++) rock(c, u + 12 + (c.rnd() - 0.5) * 4.5, v + 1 + (c.rnd() - 0.5) * 3, 0.9 + c.rnd() * 0.7, STONE);
  c.solid(u + 12, v + 3, 3.2, 3.4);
  board(c, u - 10.6, v - 2.4, ['SEACOW PD:', 'SLIP']);
  board(c, r.u + 0.5, r.v - 4.5, ['TRIAL FIT', 'KEEP ENDS CLEAR']);
  cones(c, [[r.u + 1, r.v - 3.3], [r.u + 1, r.v + 3.3], [r.u - 18, r.v - 3.3], [r.u - 18, r.v + 3.3]]);
}

/** A steel pony-truss footbridge span, on blocks, waiting for its new deck. */
function bridgeLot(c: Ctx, u: number, v: number): void {
  const m = c.m, f = frameAt(c, u, v, 0), K: RGB = [0.10, 0.13, 0.15], span = 14, panel = span / 4, h = 2.1, half = 1.3;
  for (const x of [-5.5, 5.5]) { m.within(f, x, 0, 0); m.box(0, 0.3, 0, 0.9, 0.6, 3.6, TIMBER); }
  for (const s of [-1, 1]) {
    m.within(f, 0, 0.6, s * half);
    m.box(0, 0.1, 0, span, 0.2, 0.2, K); m.box(0, h, 0, span - 2 * panel, 0.2, 0.2, K);
    for (let i = 0; i < 4; i++) {
      const x0 = -span / 2 + i * panel, up = i % 2 === 0, len = Math.hypot(panel, h), ang = Math.atan2(h, panel);
      m.within(f, x0 + panel / 2, 0.6 + h / 2, s * half, 0, 0, up ? ang : -ang); m.box(0, 0, 0, len, 0.16, 0.16, K);
    }
    m.within(f, 0, 0.6, s * half); m.box(0, h / 2, 0, 0.14, h, 0.14, K);
  }
  m.within(f, 0, 0.6, 0);
  for (let x = -span / 2; x <= span / 2 + 0.01; x += panel / 2) m.box(x, 0.1, 0, 0.16, 0.18, half * 2, K);
  m.box(-3.5, 0.26, 0, 7, 0.1, 2.2, NEW_TIMBER);   // half of the new timber deck is on
  c.solid(u, v, span / 2, half + 0.2);
  bundle(c, 'box', u + 2, v + 3.4, 0, 4.8, 0.2, 5, 2, NEW_TIMBER_HEX, 0.6, { height: 0.09 });
  board(c, u - 8.2, v - 2.2, ['BLACK R.:', 'FOOTBRIDGE']);
  cones(c, ring(u, v + 0.8, 8.6, 3.6), 2);
}

/** Watermain job: a precast valve chamber, valves on a pallet, and blue ductile-iron pipe. */
function valveLot(c: Ctx, u: number, v: number): void {
  const m = c.m;
  on(c, u - 4, v);
  m.box(0, 1.1, 0, 2.4, 2.2, 2.4, PRECAST); m.cyl(0, 2.24, 0, 0.42, 0.08, DARK, 'y', 10); m.cyl(-1.22, 0.7, 0, 0.3, 0.06, DARK, 'x', 8); m.cyl(1.22, 0.7, 0, 0.3, 0.06, DARK, 'x', 8);
  c.solid(u - 4, v, 1.2, 1.2);
  bundle(c, 'pipe', u + 2, v, 0, 5.5, 0.34, 4, 2, BLUE_PIPE, 1.0, { taper: true });
  pallets(c, u - 4, v + 3.2, 0, 1);
  for (const [du, red] of [[-0.3, true], [0.3, false]] as [number, boolean][]) {
    on(c, u - 4 + du, v + 3.2, 0, 0.15);
    const k: RGB = red ? [0.45, 0.06, 0.04] : [0.06, 0.16, 0.42];
    m.cyl(0, 0.22, 0, 0.16, 0.5, k, 'z', 8); m.cyl(0, 0.22, 0.27, 0.24, 0.04, k, 'z', 8); m.cyl(0, 0.22, -0.27, 0.24, 0.04, k, 'z', 8);
    m.box(0, 0.5, 0, 0.16, 0.36, 0.16, k); m.cyl(0, 0.72, 0, 0.03, 0.2, GALV, 'y', 6); m.cyl(0, 0.83, 0, 0.17, 0.03, red ? DARK : [0.5, 0.05, 0.04], 'y', 8);
  }
  on(c, u - 2.2, v + 3.2); m.cyl(0, 0.3, 0, 0.14, 0.6, [0.06, 0.16, 0.42], 'y', 8); m.cyl(0, 0.66, 0, 0.2, 0.12, [0.06, 0.16, 0.42], 'y', 8);   // air valve
  board(c, u - 6.2, v - 2.0, ['LOUISBOURG:', 'PRV']);
  cones(c, ring(u - 0.5, v + 1, 6.3, 3.5), 2);
}

/** Tank repaint job: only a tidy paint and blasting lot beside the yard's own tanks. */
function paintLot(c: Ctx, u: number, v: number): void {
  const m = c.m;
  pallets(c, u, v, 0, 1, 0x1e4a8a); pallets(c, u + 1.6, v, 0, 1, 0x8c8c86);
  on(c, u + 4.6, v, 0);   // towed compressor
  m.box(0, 0.95, 0, 2.6, 1.1, 1.4, [0.55, 0.45, 0.05]); m.box(1.7, 0.6, 0, 0.9, 0.08, 0.08, DARK);
  for (const s of [-1, 1]) m.cyl(-0.2, 0.36, s * 0.78, 0.36, 0.22, TYRE, 'z', 8);
  c.solid(u + 4.6, v, 1.3, 0.75);
  const stack = c.stack();
  for (let i = 0; i < 6; i++) c.loose({ kind: 'frame', u: u + 0.4, v: v + 2.4 + i * 0.13, yaw: Math.PI / 2, stack, mass: 0.3, tips: true, colour: 0x8a6a10 });
  on(c, u + 3.5, v + 2.8); m.box(0, 0.25, 0, 1.6, 0.5, 1.2, [0.07, 0.17, 0.40]); m.box(0, 0.56, 0, 1.5, 0.12, 1.1, [0.09, 0.22, 0.50]);   // folded tarps
  c.solid(u + 3.5, v + 2.8, 0.8, 0.6);
  board(c, u - 1.8, v - 1.4, ['TANKS: 5'], Math.PI, 1.2, 0.6);
  board(c, u + 2.6, v - 1.4, ['LEAD PAINT:', 'DO NOT SAND'], Math.PI, 1.7, 0.8, '#e8b21c', '#141414', 2.0);
  cones(c, ring(u + 2.2, v + 1.2, 4.8, 3.2), 2);
}

// ---- the derby ---------------------------------------------------------------------------------

export const DERBY = { u: -18, v: 47, r: 13 };

function sevenSeg(m: Mesher, digit: number, x: number, y: number, z: number, h: number, k: RGB, side: number): void {
  const on7 = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abfgcd'][digit], w = h * 0.5, t = h * 0.14;
  const seg: Record<string, [number, number, number, number]> = { a: [0, h / 2, w, t], g: [0, 0, w, t], d: [0, -h / 2, w, t], f: [-w / 2, h / 4, t, h / 2], b: [w / 2, h / 4, t, h / 2], e: [-w / 2, -h / 4, t, h / 2], c: [w / 2, -h / 4, t, h / 2] };
  for (const s of on7) { const [sx, sy, sw, sh] = seg[s]; m.box(x + sx * side, y + sy, z, sw + (sw < sh ? 0 : t), sh + (sw < sh ? t : 0), 0.02, k); }
}

/** One retired car for the ring: no glass, odd panels, a number on each door, and honest dents. */
function wreck(c: Ctx, index: number, material: THREE.Material): THREE.Mesh {
  const m = new Mesher(), type = (index % 3 === 2 ? 1 : 0) as 0 | 1, rnd = c.rnd;
  const paints: RGB[] = [[0.50, 0.07, 0.05], [0.07, 0.17, 0.42], [0.62, 0.48, 0.05], [0.10, 0.30, 0.14], [0.55, 0.55, 0.52], [0.42, 0.20, 0.05], [0.30, 0.08, 0.34], [0.07, 0.07, 0.08]];
  const body = paints[index % paints.length], odd = paints[(index + 3) % paints.length], w = type === 1 ? 0.95 : 0.9;
  vehicleShape(m, type, null, body, [0.015, 0.015, 0.018]);
  m.at(0, 0, 0);
  m.box(1.6, type === 1 ? 1.09 : 0.92, 0, 1.2, 0.05, w * 2 - 0.1, odd);                 // a hood from another car
  m.box(-0.2, 0.72, w + 0.015, 1.0, 0.5, 0.03, index % 2 ? odd : body);               // and a door, sometimes
  for (const s of [-1, 1]) {
    m.box(0.25, 0.74, s * (w + 0.03), 0.62, 0.5, 0.02, [0.8, 0.8, 0.76]);
    const n = 3 + index * 7, tens = Math.floor(n / 10) % 10, ones = n % 10;
    sevenSeg(m, tens, 0.25 - 0.14 * s, 0.74, s * (w + 0.045), 0.34, [0.03, 0.03, 0.03], s);
    sevenSeg(m, ones, 0.25 + 0.14 * s, 0.74, s * (w + 0.045), 0.34, [0.03, 0.03, 0.03], s);
  }
  // Dents: every corner is nudged by an amount that depends only on where it is, so shared corners stay together.
  for (let i = 0; i < m.pos.length; i += 3) {
    const x = m.pos[i], y = m.pos[i + 1], z = m.pos[i + 2];
    if (y < 0.45 || Math.abs(z) > w + 0.02) continue;   // wheels, sills and the painted numbers stay true
    const hsh = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + index * 5.1) * 43758.5453, r = hsh - Math.floor(hsh);
    const end = Math.max(0, Math.abs(x) - 1.3);
    m.pos[i] -= Math.sign(x) * end * (0.12 + 0.2 * r); m.pos[i + 1] += (r - 0.5) * 0.09; m.pos[i + 2] += (r - 0.5) * 0.09 * Math.min(1, end * 2.5);
  }
  void rnd;
  return new THREE.Mesh(m.geometry(), material);
}

function derby(c: Ctx, material: THREE.Material): void {
  const m = c.m, { u, v, r } = DERBY, gate = 0;   // the gap faces +u, toward the yard road
  // An earth berm around most of the ring, grassed on top.
  const segs = 22, R = r + 3.2;
  for (let i = 0; i < segs; i++) {
    const a = (i + 0.5) / segs * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a - gate), Math.cos(a - gate))) < 0.5) continue;
    const bu = u + Math.cos(a) * R, bv = v + Math.sin(a) * R, len = (2 * Math.PI * R) / segs + 0.5, h = 1.25 + 0.3 * Math.sin(i * 2.3);
    on(c, bu, bv, -a);   // local z lies along the ring
    m.extrude([[-1.9, -0.4], [1.9, -0.4], [0.5, h], [-0.5, h]], -len / 2, len / 2, EARTH, null);
    m.quad([[-0.5, h + 0.01, len / 2], [0.5, h + 0.01, len / 2], [0.5, h + 0.01, -len / 2], [-0.5, h + 0.01, -len / 2]], [0.16, 0.20, 0.07]);
    c.solid(bu, bv, len / 2, 1.2, -a + Math.PI / 2);
  }
  // Old tyres, two high, inside the berm. They are loose.
  const count = c.low ? 30 : 44;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a - gate), Math.cos(a - gate))) < 0.34) continue;
    const stack = c.stack();
    for (let l = 0; l < 2; l++) c.loose({ kind: 'tyre', u: u + Math.cos(a) * r, v: v + Math.sin(a) * r, lift: l * 0.3, yaw: 0, stack, mass: 0.35 });
  }
  // The wrecks, parked where the last heat left them.
  const spots: [number, number, number][] = [[-5, -4, 0.4], [3, -6, 2.2], [6.5, 1, 1.2], [-1, 5.5, 3.5], [-7, 3, 5.0], [1.5, 0, 0.9], [-3.5, -8.5, 1.9], [5, 7, 4.2]];
  spots.slice(0, c.low ? 6 : 8).forEach(([du, dv, yaw], i) => {
    c.loose({ kind: 'wreck', u: u + du, v: v + dv, yaw, size: [4.4, 1.4, 1.8], mass: 9, stack: 0, mesh: wreck(c, i, material) });
  });
  // A hand-painted sign at the gate, and a scoreboard on the shop side.
  const gu = u + R + 1.5, gv = v - 5.4;
  on(c, gu, gv, -Math.PI / 2);
  for (const s of [-1, 1]) m.box(s * 1.3, 1.1, -0.06, 0.1, 2.2, 0.1, TIMBER);
  m.box(0, 1.75, -0.02, 3.1, 1.3, 0.04, [0.45, 0.33, 0.18]);
  const { cell } = c.atlas.add(512, 216, (g, w, h) => {
    letters(g, w, h, ['SMASH-UP DERBY', 'LUNCH HOUR ONLY', 'HARD HATS, PLEASE'], '#b3261a', '#efe6cc', { font: '"Comic Sans MS", "Marker Felt", cursive', weights: [1.5, 0.9, 0.8] });
    g.strokeStyle = '#1f4f8f'; g.lineWidth = 7; g.strokeRect(9, 9, w - 18, h - 18);
  });
  c.s.at(gu, c.g(gu, gv) + 1.75, gv, -Math.PI / 2); c.s.plate(3.0, 1.26, cell, 0.04);
}

// ---- the whole yard ----------------------------------------------------------------------------

export interface YardSigns { incident: ReturnType<SignAtlas['add']>; score: ReturnType<SignAtlas['add']> }

export function buildYard(c: Ctx, material: THREE.Material): YardSigns {
  const m = c.m;
  shop(c);
  arches(c);

  // The entrance sign, square to the highway so both directions read it, with the lot's standing joke under it.
  {
    const su = 27.5, sv = -73.5, sign = c.mode === 'named' && NAMED_SIGN.name ? NAMED_SIGN : INVENTED_SIGN;
    on(c, su, sv, 0);
    for (const s of [-1, 1]) m.box(0, 1.9, s * 2.5, 0.24, 3.8, 0.24, [0.12, 0.12, 0.13]);
    m.box(0, 2.75, 0, 0.14, 2.25, 5.8, [0.12, 0.12, 0.13]);
    m.box(0, 1.2, 0, 0.1, 0.62, 3.9, [0.12, 0.12, 0.13]);
    const main = c.atlas.add(768, 288, (g, w, h) => {
      letters(g, w, h, [sign.name, sign.line], '#f3f1ea', '#16324f', { weights: [1.5, 0.8] });
      g.fillStyle = '#d8902a'; g.fillRect(0, h - 22, w, 22); g.fillRect(0, 0, w, 10);
    });
    const full = c.atlas.add(384, 64, (g, w, h) => letters(g, w, h, ['STAFF PARKING: FULL'], '#16324f', '#f3f1ea'));
    for (const s of [-1, 1]) {
      c.s.at(su + s * 0.08, c.g(su, sv) + 2.75, sv, s * Math.PI / 2); c.s.plate(5.7, 2.14, main.cell);
      c.s.at(su + s * 0.06, c.g(su, sv) + 1.2, sv, s * Math.PI / 2); c.s.plate(3.4, 0.57, full.cell);
    }
    c.solid(su, sv, 0.3, 2.8);
  }

  // The lawn's one tree, and the post fence between the lawn and the laydown yard.
  on(c, 17, -41.5);
  m.cyl(0, 2.2, 0, 0.22, 4.4, [0.16, 0.12, 0.09], 'y', 6, 0.14);
  for (const [x, y, z, r] of [[0, 6.2, 0, 2.6], [1.3, 5.0, 0.6, 1.9], [-1.2, 5.3, -0.7, 2.0]]) { m.at(17 + x, c.g(17, -41.5) + y, -41.5 + z, x); m.cyl(0, 0, 0, r, r * 1.3, [0.60, 0.40, 0.06], 'y', 7, r * 0.45); m.cyl(0, -r * 0.95, 0, r * 0.5, r * 0.6, [0.52, 0.33, 0.05], 'y', 7, r); }
  c.solid(17, -41.5, 0.35, 0.35);
  const fence: [number, number][] = [[-150, -50.5], [-52, -50.5], [-34.5, -29]];
  for (let i = 0; i < fence.length - 1; i++) {
    const [au, av] = fence[i], [bu, bv] = fence[i + 1], len = Math.hypot(bu - au, bv - av), n = Math.round(len / 3);
    for (let k = 0; k <= n; k++) { const t = k / n; on(c, au + (bu - au) * t, av + (bv - av) * t); m.box(0, 0.6, 0, 0.14, 1.2, 0.14, TIMBER); }
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, yaw = Math.atan2(-(bv - av), bu - au);
      on(c, au + (bu - au) * t, av + (bv - av) * t, yaw); m.box(0, 0.95, 0, len / n, 0.1, 0.05, TIMBER); m.box(0, 0.5, 0, len / n, 0.1, 0.05, TIMBER);
    }
    c.solid((au + bu) / 2, (av + bv) / 2, len / 2, 0.12, Math.atan2(-(bv - av), bu - au));
  }

  // ---- the staff lot ----
  const world = c.world, row = (u0: number, v0: number, u1: number, v1: number, du: number, dv: number, seed: number, opts = {}) => {
    const a = world(u0, v0), b = world(u1, v1);
    c.park(parkedRow(a.x, a.z, b.x, b.z, c.heading(du, dv), seed, opts));
  };
  row(-15.6, -33.6, 34.4, -33.6, 0, 1, 11);                                                   // along the lawn, noses to the shop
  row(-15.6, -18.4, 33.6, -18.4, 0, -1, 23, { skip: (i: number) => i >= 7 && i <= 9 });       // along the office wall, with the door kept clear
  row(-25.0, -33.0, -25.0, -22.0, -1, 0, 37, { skip: (i: number) => i === 4 });                                                 // the south-west end
  row(50.5, -38.5, 50.5, -4.5, 1, 0, 41, { pickups: 0.5 });                                    // the overflow strip beside the driveway
  row(34.3, -70, 34.3, -43, 0, 1, 53, { pitch: 6.4, pickups: 0.2 });                           // and along the driveway, two wheels on the grass
  // The end space is kept clear for the slip trial run-up; its car fits beside the lawn.
  { const p = world(-30, -43); c.park([{ ...p, heading: c.heading(-1, 0), type: 0, colour: 0x6f7376 }]); }
  // The slab's joints, as the lot shows them.
  for (let ju = -13.5; ju < 36; ju += 4.5) { c.d.at(ju, c.g(ju, -25.5) + 0.02, -25.5); c.d.box(0, 0, 0, 0.04, 0.01, 22, [0.27, 0.265, 0.25]); }
  for (const jv of [-29, -22]) { c.d.at(9, c.g(9, jv) + 0.02, jv); c.d.box(0, 0, 0, 54, 0.01, 0.04, [0.27, 0.265, 0.25]); }
  for (let jv = -70; jv < 20; jv += 4.5) { c.d.at(40.75, c.g(40.75, jv) + 0.02, jv); c.d.box(0, 0, 0, 10, 0.01, 0.04, [0.27, 0.265, 0.25]); }
  // Two pickups on the grass at the end, because there was nowhere else.
  for (const [pu, pv, du, dv, colour] of [[-32.5, -33.5, -0.25, 1, 0x1b1c1e], [-36.5, -37.5, -0.5, 1, 0xd9d9d4]] as [number, number, number, number, number][]) {
    const p = world(pu, pv); c.park([{ x: p.x, z: p.z, heading: c.heading(du, dv), type: 2, colour }]);
  }

  // ---- behind the shop: repair bays, the fuel island, stores ----
  truck(c, 12.4, 16.5, Math.PI / 2 + 0.1, 'none', [0.62, 0.62, 0.60], true);                    // a truck with its hood up, outside bay 5
  for (const [tu, tv, n] of [[-44.5, 13.2, 4], [-43.2, 13.2, 4], [-44.5, 14.5, 3]]) for (let l = 0; l < n; l++) { on(c, tu, tv, 0, l * 0.31); m.cyl(0, 0.15, 0, 0.55, 0.3, TYRE, 'y', 9); }
  c.solid(-44, 13.8, 1.3, 1.3);
  on(c, -3.2, 14.4, 0.25);                                                                      // a welding screen on a frame
  m.box(0, 1.0, 0, 2.4, 1.6, 0.04, [0.50, 0.10, 0.04]); for (const s of [-1, 1]) { m.box(s * 1.2, 0.95, 0, 0.05, 1.9, 0.05, DARK); m.box(s * 1.2, 0.03, 0, 0.05, 0.05, 0.9, DARK); }
  on(c, 52, 4);                                                                                 // fuel island
  m.box(0, 0.1, 0, 5.5, 0.2, 2.2, CONCRETE); m.cyl(-0.8, 1.15, 0, 0.85, 3.0, WHITE, 'x', 10); m.box(1.9, 0.95, 0, 0.6, 1.5, 0.5, [0.5, 0.06, 0.04]);
  for (const s of [-1, 1]) for (const x of [-2.9, 2.9]) m.box(x, 0.55, s * 1.25, 0.2, 1.1, 0.2, YELLOW);
  c.solid(52, 4, 2.9, 1.2);
  [0, 1, 2].forEach((i) => container(c, 52 + i * 3.0, 47, Math.PI / 2, CONTAINER[i]));          // stores
  pallets(c, 44, 30, 0.1, 7); pallets(c, 45.6, 30, 0, 5); pallets(c, 44.2, 31.8, 0, 2, 0x12406e); pallets(c, 46, 32, 0.05, 2, 0x12406e);
  cones(c, ring(45, 31, 2.6, 2.4), 2);
  valveLot(c, 28, 32);
  // The machine row along the back of the yard, as in the aerial photo.
  excavator(c, 6, 65.5, Math.PI / 2 - 0.1); loader(c, 15, 65, Math.PI / 2); truck(c, 23.5, 65.5, -Math.PI / 2, 'dump', [0.5, 0.06, 0.05]);
  truck(c, 29, 65.5, -Math.PI / 2 + 0.04, 'flat', WHITE); trailer(c, 36.5, 63, -Math.PI / 2, 'mats'); excavator(c, 44.5, 65.5, Math.PI / 2 + 0.15);
  derby(c, material);

  // ---- the laydown yard to the south-west ----
  for (let i = 0; i < 5; i++) container(c, -143 + i * 2.5, -30 + i * 1.5, 1.05, i === 2 ? [0.60, 0.60, 0.57] : WHITE, 12.2);   // the white row at the west corner
  barriers(c, -92, -47.5, 0, 9); barriers(c, -92, -46.6, 0, 9);
  slipLot(c, -78, -34);
  crane(c, -126, -8, -0.12);
  // Precast: box culvert sections and bridge deck panels.
  for (let i = 0; i < 4; i++) {
    on(c, -74 + i * 2.0, -8, 0, 0.12);
    m.box(0, 0.12, 0, 1.5, 0.24, 2.9, PRECAST); m.box(0, 1.86, 0, 1.5, 0.24, 2.9, PRECAST);
    for (const s of [-1, 1]) m.box(0, 0.99, s * 1.33, 1.5, 1.5, 0.24, shade(PRECAST, 0.95));
    m.box(0, 0.99, 0, 1.46, 1.5, 2.4, [0.05, 0.05, 0.05]);
  }
  c.solid(-71, -8, 4, 1.5);
  { const stack = c.stack(); for (let l = 0; l < 4; l++) c.loose({ kind: 'box', u: -86, v: 2, lift: 0.15 + l * 0.42, yaw: 0, size: [7.5, 0.3, 2.4], colour: PRECAST_HEX, stack, mass: 9 }); on(c, -86, 2); for (const t of [-2.5, 2.5]) m.box(t, 0.075, 0, 0.15, 0.15, 2.4, TIMBER); }
  // Culvert pipe: corrugated steel, and concrete.
  for (let i = 0; i < 4; i++) { on(c, -112 + i * 2.2, -42, Math.PI / 2, 0); m.cyl(0, 0.95, 0, 0.95, 6, GALV, 'x', c.low ? 8 : 12, 0.95, DARK); }
  c.solid(-108.7, -42, 4.5, 3.0);
  for (let i = 0; i < 5; i++) { on(c, -64 + i * 1.75, 6, Math.PI / 2); m.cyl(0, 0.75, 0, 0.75, 2.4, CONCRETE, 'x', c.low ? 8 : 10, 0.75, DARK); }
  c.solid(-60.5, 6, 4.6, 1.3);
  bundle(c, 'pipe', -105, 8, 0.02, 12, 0.6, 5, 2, HDPE, 1.4, { taper: true });
  bundle(c, 'hpile', -128, 22, 0, 12, 0.33, 6, 2, hex(RUST), 3);
  bundle(c, 'pipe', -104, 24, 0, 9, 0.45, 5, 2, hex(RUST), 1.6, { taper: true });
  // Lower down: black pipe, crane mats, more steel, the barge, stone and aggregate.
  bundle(c, 'pipe', -120, 64, Math.PI / 2, 14, 0.7, 6, 3, HDPE, 1.6, { taper: true });
  bundle(c, 'box', -72, 84, Math.PI / 2, 6.0, 1.2, 4, 3, TIMBER_HEX, 5, { height: 0.3 });
  bundle(c, 'box', -72, 93, Math.PI / 2, 6.0, 1.2, 4, 2, TIMBER_HEX, 5, { height: 0.3 });
  bundle(c, 'hpile', -98, 104, Math.PI / 2 + 0.03, 14, 0.33, 7, 2, hex(RUST), 3);
  bundle(c, 'pipe', -84, 112, Math.PI / 2, 12, 0.5, 5, 2, 0x5d7f95, 1.6, { taper: true });
  barge(c, -128, 112, Math.PI / 2 - 0.08);
  for (let i = 0; i < (c.low ? 9 : 14); i++) rock(c, -132 + (c.rnd() - 0.5) * 9, 143 + (c.rnd() - 0.5) * 7, 1.0 + c.rnd() * 0.8, STONE, i > 8 ? 1.0 : 0);
  c.solid(-132, 143, 5, 4);
  for (const [ru, rv, s] of [[-121, 150, 2.1], [-118, 138, 1.8], [-140, 134, 2.3]]) { rock(c, ru, rv, s, shade(STONE, 1.1)); c.solid(ru, rv, s * 0.8, s * 0.8); }
  heap(c, -100, 176, 8, 4.6, [0.36, 0.35, 0.33]); heap(c, -82, 178, 7, 4.0, [0.24, 0.24, 0.25]); heap(c, -64, 176, 7.5, 4.2, [0.44, 0.40, 0.33]);
  loader(c, -86, 162, 0.4);
  truck(c, -62, 60, 0.3, 'dump', YELLOW);

  rack(c, -130, 38, 0, 7, 12, STEELS); rack(c, -100, 41, 0, 6, 10, RUSTS); rack(c, -74, 30, 0, 5, 9, MIXED);
  rack(c, -140, 84, Math.PI / 2, 8, 12, RUSTS); rack(c, -98, 80, Math.PI / 2, 6, 12, STEELS); rack(c, -110, 128, Math.PI / 2, 6, 10, MIXED);
  rack(c, -70, 132, 0, 6, 9, MIXED); rack(c, -62, 152, Math.PI / 2, 5, 8, RUSTS); rack(c, -44, 26, Math.PI / 2, 5, 8, STEELS);
  rack(c, -122, -44, 0, 4, 9, MIXED); trailer(c, -58, -31, Math.PI / 2, 'empty'); excavator(c, -138, -6, 1.2); loader(c, -118, -32, 2.6);
  rack(c, 205, 60, 0.2, 6, 12, RUSTS); rack(c, 262, 98, 0.2, 7, 12, STEELS); rack(c, 176, 86, 0.1, 5, 10, MIXED); rack(c, 262, 52, 0.2, 5, 9, MIXED);

  // ---- the tank pad ----
  paintLot(c, 104, -22);
  bridgeLot(c, 122, 2);
  archLot(c, 124, 30);
  trailer(c, 147, -30, Math.PI / 2, 'van'); trailer(c, 151, -29, Math.PI / 2, 'van', [0.66, 0.66, 0.62]); trailer(c, 150, 44, 0.3, 'empty');
  truck(c, 96, 55, 0.5, 'dump', [0.5, 0.06, 0.05]); loader(c, 104, -4, -0.6);
  pallets(c, 70, 20, 0, 6); pallets(c, 71.5, 20.2, 0.2, 4);

  // ---- the big pad to the north-east ----
  for (let i = 0; i < 6; i++) container(c, 236 + i * 5.6 + (i % 2) * 1.5, 24 + i * 3.2, 0.5, CONTAINER[i % CONTAINER.length]);
  container(c, 238.7, 26.2, 0.5, CONTAINER[3], 12.2, 2.6);
  for (let i = 0; i < 11; i++) {
    const t = i / 10, tu = 293 + 17 * t, tv = 64 + 70 * t;
    if (i % 3 === 0) trailer(c, tu, tv, 0.24, 'van', i % 2 ? WHITE : [0.60, 0.61, 0.60]); else container(c, tu, tv, 0.24, CONTAINER[(i * 2 + 1) % CONTAINER.length]);
  }
  wind(c, 236, 74, 0.2);
  excavator(c, 178, 34, -0.3); loader(c, 180, 46, -0.2); crane(c, 196, 104, -0.15); truck(c, 182, 58, -0.1, 'flat', YELLOW);
  for (let i = 0; i < 4; i++) { on(c, 150 + i * 2.6, 118, Math.PI / 2 + 0.2); m.cyl(0, 1.2, 0, 1.2, 7, shade(RUST, 1.2), 'x', c.low ? 8 : 12, 1.2, DARK); }
  c.solid(154, 118, 5.4, 3.6, 0.2);
  bundle(c, 'hpile', 222, 128, 0.05, 15, 0.33, 8, 2, PRIMER_HEX, 3);
  bundle(c, 'pipe', 262, 126, 0.02, 12, 0.6, 6, 2, BLUE_PIPE, 1.5, { taper: true });
  barriers(c, 250, 8, 0, 8);
  heap(c, 300, 22, 7, 3.6, [0.38, 0.33, 0.25]);

  // ---- the crew: at work, calm, and out of the way ----
  person(c, 10.5, 15.2, 2.6); person(c, 26, 35.5, -0.5, 'clipboard'); person(c, 27.2, 36, 0.4);
  person(c, 118, 36.5, 1.4, 'clipboard'); person(c, -70, -27, 1.0); person(c, 18, 61.5, -1.8);

  // Two boards that the game repaints: the one by the door, and the derby's.
  const incident = c.atlas.add(512, 256, (g, w, h) => letters(g, w, h, [''], '#111', '#eee'));
  const score = c.atlas.add(384, 256, (g, w, h) => letters(g, w, h, [''], '#111', '#eee'));
  const bu = DERBY.u + 1, bv = 13.2;
  on(c, bu, bv, 0);   // the scoreboard stands at the shop's back wall, facing the ring
  for (const s of [-1, 1]) m.box(s * 1.2, 1.3, -0.05, 0.1, 2.6, 0.1, TIMBER);
  m.box(0, 2.0, -0.02, 2.8, 1.8, 0.04, [0.06, 0.07, 0.08]);
  c.s.at(bu, c.g(bu, bv) + 2.0, bv, 0); c.s.plate(2.6, 1.7, score.cell);
  return { incident, score };
}
