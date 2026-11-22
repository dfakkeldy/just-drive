import * as THREE from 'three';
import { ceilingAt, churchStair, type ChurchRoom } from './church-room';

/**
 * The church room, drawn by hand. Every texture is painted in code on a canvas: no photograph, scan or still is used.
 * Boxes are batched into one mesh per zone and paint, so the whole room is a few dozen draw calls.
 */
type V3 = [number, number, number];
export type Zone = 'nave' | 'vestry' | 'loft';
type Skin = 'boards' | 'bead' | 'bare' | 'peel' | 'plain';
type Sheet = 'window' | 'sash' | 'station' | 'devotion' | 'altar3' | 'altar1' | 'map';
type Axis = 'x' | 'y' | 'z';

const PAINT = {
  side: 0x8fcfe0, altarWall: 0xeceee8, green: 0xaad8cc, ceiling: 0xeceee9, floor: 0x858b8c, platform: 0x7c8284,
  pew: 0xb4c8da, post: 0x9ad3e2, front: 0xa3c6d6, soffit: 0xe3e7e6, white: 0xeeeee8, gold: 0xb7924a, frame: 0x7a5a34,
  red: 0x9c2f2b, chair: 0x8a3a2c, iron: 0xbfcdd2, wood: 0x8d6a4c, vestry: 0x9aadb7, base: 0x545c61, ply: 0xc39a63,
  ply2: 0xa97a4c, grey: 0x8f8a80, cane: 0xcbb082, paper: 0xf3efe3, dark: 0x3d4447, bench: 0x74513a, pewEnd: 0xe6ebec,
};
/** Metres covered by one texture tile, along and across the boards. Beadboard is the same boards at half size. */
const TILE: Record<Skin, [number, number]> = { boards: [2, 1.2], bead: [1.1, .6], bare: [2.4, 1.2], peel: [1, 1], plain: [1, 1] };
const AXIS: Record<Axis, V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const CELL = 0.7;

function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = a + 0x6d2b79f5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function lattice(i: number, j: number, k: number): number {
  let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177);
  n = Math.imul(n ^ n >>> 13, 1274126177);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
}
/** Smooth 0..1 noise over about a metre: where the paint has thinned. The same place always wears the same way. */
function wear(x: number, y: number, z: number): number {
  const fx = x / 0.9, fy = y / 0.9, fz = z / 0.9, i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
  const s = (t: number) => t * t * (3 - 2 * t), u = s(fx - i), v = s(fy - j), w = s(fz - k);
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  return mix(mix(mix(lattice(i, j, k), lattice(i + 1, j, k), u), mix(lattice(i, j + 1, k), lattice(i + 1, j + 1, k), u), v),
    mix(mix(lattice(i, j, k + 1), lattice(i + 1, j, k + 1), u), mix(lattice(i, j + 1, k + 1), lattice(i + 1, j + 1, k + 1), u), v), w);
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

interface Batch { zone: Zone; material: THREE.Material; position: number[]; normal: number[]; uv: number[]; color: number[] }

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  const g = c.getContext('2d'); if (!g) throw new Error('Church room textures need a canvas context');
  return [c, g];
}
/** Blotches that wrap at the tile edge, so a repeated tile has no seam. */
function blotches(g: CanvasRenderingContext2D, r: () => number, size: number, count: number, colour: (a: number) => string, long: number, tall: number, alpha: number): void {
  for (let i = 0; i < count; i++) {
    const x = r() * size, y = r() * size, w = long * (.3 + r()), h = tall * (.3 + r());
    // A ragged patch: a few overlapping pieces, never one clean oval.
    for (let piece = 0; piece < 5; piece++) {
      const px = x + (r() - .5) * w * 1.5, py = y + (r() - .5) * h * 1.2, pw = w * (.25 + r() * .5), ph = h * (.3 + r() * .5), turn = (r() - .5) * .3;
      g.fillStyle = colour(alpha * (.15 + r() * .45));
      for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) { g.beginPath(); g.ellipse(px + dx, py + dy, pw, ph, turn, 0, Math.PI * 2); g.fill(); }
    }
  }
}
/** Painted boards running along u. Thin paint, seams, butt joints and scratches; the material colour tints it. */
function boardsTexture(): HTMLCanvasElement {
  const size = 512, [c, g] = canvas(size, size), r = random(1841), rows = 8, h = size / rows;
  g.fillStyle = '#f1f1ef'; g.fillRect(0, 0, size, size);
  for (let i = 0; i < rows; i++) { const tone = 228 + Math.floor(r() * 24); g.fillStyle = `rgb(${tone},${tone},${tone - 2})`; g.fillRect(0, i * h + 2, size, h - 2); }
  blotches(g, r, size, 60, a => `rgba(104,100,92,${a})`, 60, 8, .15);
  blotches(g, r, size, 46, a => `rgba(255,255,255,${a})`, 70, 7, .45);
  blotches(g, r, size, 60, a => `rgba(84,80,72,${a})`, 5, 1.2, .16);
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(60,60,58,${.04 + r() * .08})`; g.fillRect(r() * size, r() * size, 20 + r() * 90, 1); }
  for (let i = 0; i < rows; i++) {
    g.fillStyle = 'rgba(38,42,46,.34)'; g.fillRect(0, i * h, size, 2);
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, i * h + 2, size, 1);
    const joint = Math.floor(r() * size);
    g.fillStyle = 'rgba(38,42,46,.28)'; g.fillRect(joint, i * h + 2, 2, h - 2);
    for (const x of [joint - 9, joint + 10]) { g.fillStyle = 'rgba(50,46,40,.45)'; g.fillRect((x + size) % size, i * h + h * .3, 2, 2); g.fillRect((x + size) % size, i * h + h * .72, 2, 2); }
  }
  return c;
}
/** A bare plank floor: brown wood showing through what is left of a grey paint. */
function bareTexture(): HTMLCanvasElement {
  const size = 512, [c, g] = canvas(size, size), r = random(77), rows = 6, h = size / rows;
  g.fillStyle = '#806a58'; g.fillRect(0, 0, size, size);
  for (let i = 0; i < rows; i++) { const t = r(); g.fillStyle = `rgb(${118 + t * 30},${98 + t * 24},${80 + t * 20})`; g.fillRect(0, i * h, size, h); }
  for (let i = 0; i < 240; i++) { g.fillStyle = `rgba(70,52,40,${.05 + r() * .1})`; g.fillRect(r() * size, r() * size, 30 + r() * 160, 1 + r()); }
  blotches(g, r, size, 70, a => `rgba(168,170,166,${a})`, 90, 7, .8);
  blotches(g, r, size, 90, a => `rgba(200,200,194,${a})`, 26, 3, .7);
  blotches(g, r, size, 40, a => `rgba(120,70,52,${a})`, 50, 4, .35);
  for (let i = 0; i < rows; i++) { g.fillStyle = 'rgba(30,24,20,.6)'; g.fillRect(0, i * h, size, 2); }
  return c;
}
/** White paint lifting off in flakes. */
function peelTexture(): HTMLCanvasElement {
  const size = 256, [c, g] = canvas(size, size), r = random(9);
  g.fillStyle = '#f2f1ec'; g.fillRect(0, 0, size, size);
  blotches(g, r, size, 150, a => `rgba(150,146,138,${a})`, 7, 5, .7);
  blotches(g, r, size, 60, a => `rgba(112,98,84,${a})`, 4, 3, .6);
  blotches(g, r, size, 40, a => `rgba(255,255,255,${a})`, 14, 9, .5);
  return c;
}
/** A round-headed window with many small panes, seen against daylight. Outside the arch is transparent. */
function windowTexture(): HTMLCanvasElement {
  const w = 128, h = 256, [c, g] = canvas(w, h), radius = w / 2 - 3, spring = radius + 3;
  const outline = () => { g.beginPath(); g.moveTo(3, h - 2); g.lineTo(3, spring); g.arc(w / 2, spring, radius, Math.PI, 0); g.lineTo(w - 3, h - 2); g.closePath(); };
  outline(); g.save(); g.clip();
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#fbfdfc'); sky.addColorStop(.55, '#f1f6f1'); sky.addColorStop(1, '#cfdcc9');
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#a3b3b6'; g.lineWidth = 4;
  for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(w * i / 4, i === 2 ? 0 : spring); g.lineTo(w * i / 4, h); g.stroke(); }
  for (let i = 0; i < 6; i++) { const y = spring + (h - spring) * i / 6; g.lineWidth = i === 3 ? 7 : 4; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  g.lineWidth = 3;
  g.beginPath(); g.arc(w / 2, spring, radius * .52, Math.PI, 0); g.stroke();
  for (const a of [.25, .75]) { g.beginPath(); g.moveTo(w / 2 + Math.cos(Math.PI * (1 + a)) * radius * .52, spring + Math.sin(Math.PI * (1 + a)) * radius * .52); g.lineTo(w / 2 + Math.cos(Math.PI * (1 + a)) * radius, spring + Math.sin(Math.PI * (1 + a)) * radius); g.stroke(); }
  g.restore();
  g.strokeStyle = '#e9ece8'; g.lineWidth = 7; outline(); g.stroke();
  return c;
}
/** A six-over-six sash window. */
function sashTexture(): HTMLCanvasElement {
  const w = 128, h = 208, [c, g] = canvas(w, h);
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#f8fbfa'); sky.addColorStop(1, '#d3ddcf');
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#dfe3df'; g.lineWidth = 4;
  for (const x of [w / 3, w * 2 / 3]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for (const y of [h / 4, h * 3 / 4]) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  g.lineWidth = 9; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  g.lineWidth = 12; g.strokeRect(0, 0, w, h);
  return c;
}
/** A small framed print: soft patches of colour only. No figure is drawn. */
function stationTexture(): HTMLCanvasElement {
  const w = 160, h = 128, [c, g] = canvas(w, h), r = random(14);
  g.fillStyle = '#7a5a34'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#a98148'; g.fillRect(4, 4, w - 8, h - 8);
  g.fillStyle = '#e8e2d2'; g.fillRect(12, 12, w - 24, h - 24);
  g.fillStyle = '#c9bfa8'; g.fillRect(24, 22, w - 48, h - 50);
  for (let i = 0; i < 26; i++) {
    g.fillStyle = [`rgba(150,74,66,${.25 + r() * .3})`, `rgba(78,104,140,${.25 + r() * .3})`, `rgba(176,140,84,${.25 + r() * .3})`, `rgba(104,92,78,${.2 + r() * .3})`][i % 4];
    g.beginPath(); g.ellipse(30 + r() * (w - 60), 28 + r() * (h - 62), 6 + r() * 12, 5 + r() * 9, 0, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = 'rgba(110,104,92,.55)'; g.fillRect(44, h - 22, w - 88, 2);
  return c;
}
/** A larger framed print by the altar: a pale glow on a dark field. No figure is drawn. */
function devotionTexture(): HTMLCanvasElement {
  const w = 128, h = 160, [c, g] = canvas(w, h);
  g.fillStyle = '#8f7440'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#c2a560'; g.fillRect(4, 4, w - 8, h - 8);
  g.fillStyle = '#d9d5c8'; g.fillRect(10, 10, w - 20, h - 20);
  g.fillStyle = '#3b3d3f'; g.fillRect(16, 16, w - 32, h - 36);
  const glow = g.createRadialGradient(w / 2, h * .46, 4, w / 2, h * .46, 46);
  glow.addColorStop(0, 'rgba(226,220,204,.85)'); glow.addColorStop(.5, 'rgba(150,146,138,.4)'); glow.addColorStop(1, 'rgba(59,61,63,0)');
  g.fillStyle = glow; g.fillRect(16, 16, w - 32, h - 36);
  return c;
}
/** A white altar front: pointed-arch panels outlined in gold, with a row of small gold ornaments below. */
function altarTexture(arches: number): HTMLCanvasElement {
  const w = arches === 3 ? 512 : 220, h = 280, [c, g] = canvas(w, h), r = random(arches);
  g.fillStyle = '#efefe9'; g.fillRect(0, 0, w, h);
  blotches(g, r, 512, 50, a => `rgba(120,116,104,${a})`, 30, 6, .1);
  const gold = '#b08c44';
  g.strokeStyle = gold; g.lineWidth = 5; g.strokeRect(22, 20, w - 44, h - 50);
  g.strokeStyle = 'rgba(90,86,76,.35)'; g.lineWidth = 2; g.strokeRect(29, 27, w - 58, h - 64);
  const span = (w - 100) / arches, aw = Math.min(span * .62, 96);
  for (let i = 0; i < arches; i++) {
    const x = 50 + span * (i + .5), base = h - 78, shoulder = 118, top = 52;
    const lancet = () => { g.beginPath(); g.moveTo(x - aw / 2, base); g.lineTo(x - aw / 2, shoulder); g.quadraticCurveTo(x - aw / 2, top + 22, x, top); g.quadraticCurveTo(x + aw / 2, top + 22, x + aw / 2, shoulder); g.lineTo(x + aw / 2, base); g.closePath(); };
    lancet(); g.fillStyle = '#dfe0da'; g.fill();
    g.save(); lancet(); g.clip(); g.fillStyle = 'rgba(70,70,66,.22)'; g.fillRect(x - aw / 2, top, 7, base - top); g.fillRect(x - aw / 2, top, aw, 9); g.restore();
    lancet(); g.strokeStyle = gold; g.lineWidth = 3; g.stroke();
  }
  g.fillStyle = gold;
  const marks = arches === 3 ? 7 : 3;
  for (let i = 0; i < marks; i++) {
    const x = 50 + (w - 100) * (i + .5) / marks, y = h - 46;
    g.fillRect(x - 2, y - 12, 4, 20); g.fillRect(x - 9, y - 5, 18, 4);
    g.beginPath(); g.arc(x, y - 14, 4, 0, Math.PI * 2); g.fill();
  }
  return c;
}
/** A hand-drawn map: pencil roads, a brook and small houses. Its labels are scribbles, never words or names. */
function mapTexture(): HTMLCanvasElement {
  const w = 384, h = 288, [c, g] = canvas(w, h), r = random(41);
  g.fillStyle = '#f2efe6'; g.fillRect(0, 0, w, h);
  blotches(g, r, 384, 30, a => `rgba(170,160,138,${a})`, 40, 26, .12);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const line = (points: number[][], width: number, alpha: number) => {
    g.strokeStyle = `rgba(74,74,78,${alpha})`; g.lineWidth = width; g.beginPath(); g.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) { const [x, y] = points[i], [px, py] = points[i - 1]; g.quadraticCurveTo((px + x) / 2 + (r() - .5) * 14, (py + y) / 2 + (r() - .5) * 14, x, y); }
    g.stroke();
  };
  const roads = [[[18, 70], [90, 120], [150, 190], [210, 236], [300, 262]], [[200, 22], [226, 96], [214, 168], [210, 236]], [[226, 96], [290, 80], [350, 46]], [[90, 120], [120, 60], [112, 20]], [[214, 168], [280, 176], [366, 150]]];
  for (const road of roads) line(road, 1.6, .5);
  const brook = []; for (let i = 0; i <= 12; i++) brook.push([36 + i * 27, 214 + Math.sin(i * 1.3) * 12 - i * 6]);
  line(brook, 1, .3);
  for (const road of roads) for (let i = 0; i < road.length - 1; i++) {
    const k = .25 + r() * .5, x = road[i][0] + (road[i + 1][0] - road[i][0]) * k + (r() < .5 ? -15 : 13), y = road[i][1] + (road[i + 1][1] - road[i][1]) * k + (r() - .5) * 12;
    g.strokeStyle = 'rgba(64,64,70,.62)'; g.lineWidth = 1.1;
    g.beginPath(); g.moveTo(x - 4, y + 5); g.lineTo(x - 4, y - 2); g.lineTo(x, y - 7); g.lineTo(x + 4, y - 2); g.lineTo(x + 4, y + 5); g.closePath(); g.stroke();
    // The label beside a house: a short pencil scribble. It spells nothing.
    g.strokeStyle = 'rgba(74,74,80,.42)'; g.lineWidth = .9; g.beginPath(); g.moveTo(x + 9, y + 1);
    for (let s = 1; s <= 6 + Math.floor(r() * 5); s++) g.lineTo(x + 9 + s * 3.2, y + 1 + (s % 2 ? -2.6 : 1.4) * (.5 + r() * .7));
    g.stroke();
  }
  return c;
}

export interface ChurchRoomParts { groups: Record<Zone, THREE.Group>; letter: THREE.Object3D; triangles: number; drawCalls: number }

/** The vestry chest of drawers along the right wall: its start from the far wall, and its length. The letter lies on it. */
const CHEST = { from: .85, long: 1.1 };
/** Half the width of a spire at its foot. */
const SPIRE_FOOT = .2;
const DRAWN = new Map<string, HTMLCanvasElement>();

export class ChurchRoomArt {
  private readonly batches = new Map<string, Batch>();
  private readonly resources: { dispose(): void }[] = [];
  private readonly maps = new Map<string, THREE.Texture>();
  private readonly tints = new Map<number, V3>();
  private transform: THREE.Matrix4 | null = null;
  private zone: Zone = 'nave';
  private readonly point = new THREE.Vector3();

  private map(name: Skin | Sheet): THREE.Texture | null {
    if (name === 'plain') return null;
    if (name === 'bead') name = 'boards';
    let texture = this.maps.get(name);
    if (!texture) {
      const draw: Record<Exclude<Skin, 'plain' | 'bead'> | Sheet, () => HTMLCanvasElement> = {
        boards: boardsTexture, bare: bareTexture, peel: peelTexture, window: windowTexture, sash: sashTexture, station: stationTexture,
        devotion: devotionTexture, altar3: () => altarTexture(3), altar1: () => altarTexture(1), map: mapTexture,
      };
      // The drawing is the slow part, and it is the same every time: keep the canvas for the next visit.
      let canvas = DRAWN.get(name);
      if (!canvas) { canvas = draw[name](); DRAWN.set(name, canvas); }
      texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
      if (name === 'boards' || name === 'bare' || name === 'peel') texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      this.maps.set(name, texture); this.resources.push(texture);
    }
    return texture;
  }
  private batch(key: string, make: () => THREE.Material): Batch {
    const id = `${this.zone}|${key}`;
    let batch = this.batches.get(id);
    if (!batch) { const material = make(); this.resources.push(material); batch = { zone: this.zone, material, position: [], normal: [], uv: [], color: [] }; this.batches.set(id, batch); }
    return batch;
  }
  /** One material for each kind of surface in a zone: the paint colour itself is stored on the vertices. */
  private painted(skin: Skin): Batch {
    return this.batch(skin === 'bead' ? 'boards' : skin, () => new THREE.MeshLambertMaterial({ map: this.map(skin), vertexColors: true }));
  }
  private tint(colour: number): V3 {
    let rgb = this.tints.get(colour);
    if (!rgb) { const c = new THREE.Color(colour); rgb = [c.r, c.g, c.b]; this.tints.set(colour, rgb); }
    return rgb;
  }
  private moved(p: V3): V3 {
    if (!this.transform) return p;
    this.point.set(p[0], p[1], p[2]).applyMatrix4(this.transform);
    return [this.point.x, this.point.y, this.point.z];
  }
  /** Draw `build` turned about a pivot: used for things that lean or fold. */
  private turned(pivot: V3, axis: Axis, angle: number, build: () => void): void {
    const before = this.transform, m = new THREE.Matrix4().makeTranslation(pivot[0], pivot[1], pivot[2])
      .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(...AXIS[axis]), angle))
      .multiply(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]));
    this.transform = before ? before.clone().multiply(m) : m;
    build(); this.transform = before;
  }
  /** A flat four-cornered face, a to b to c to d anticlockwise seen from its front, cut into cells so wear shows. */
  private face(skin: Skin, colour: number, a: V3, b: V3, c: V3, d: V3, grain: Axis, shade = 1): void {
    const batch = this.painted(skin), [tu, tv] = TILE[skin], rgb = this.tint(colour);
    const A = this.moved(a), B = this.moved(b), C = this.moved(c), D = this.moved(d);
    let normal = cross(sub(B, A), sub(D, A));
    if (Math.hypot(...normal) < 1e-9) normal = cross(sub(B, A), sub(C, A));   // a triangle given as a face
    const n = unit(normal);
    let g = AXIS[grain]; if (Math.abs(dot(g, n)) > .9) g = AXIS[grain === 'y' ? 'x' : 'y'];
    const g2 = unit(cross(n, g));
    const nu = Math.max(1, Math.ceil(Math.max(Math.hypot(...sub(B, A)), Math.hypot(...sub(C, D))) / CELL));
    const nv = Math.max(1, Math.ceil(Math.max(Math.hypot(...sub(D, A)), Math.hypot(...sub(C, B))) / CELL));
    const at = (s: number, t: number): V3 => [0, 1, 2].map(i => (A[i] * (1 - s) + B[i] * s) * (1 - t) + (D[i] * (1 - s) + C[i] * s) * t) as V3;
    const put = (p: V3) => {
      batch.position.push(p[0], p[1], p[2]); batch.normal.push(n[0], n[1], n[2]); batch.uv.push(dot(p, g) / tu, dot(p, g2) / tv);
      const tone = (.76 + .24 * wear(p[0], p[1], p[2])) * shade; batch.color.push(rgb[0] * tone, rgb[1] * tone, rgb[2] * tone);
    };
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const p = at(i / nu, j / nv), q = at((i + 1) / nu, j / nv), r = at((i + 1) / nu, (j + 1) / nv), s = at(i / nu, (j + 1) / nv);
      put(p); put(q); put(r); put(p); put(r); put(s);
    }
  }
  /** A box from two opposite corners. `grain` is the way its boards run. */
  private box(skin: Skin, colour: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, grain: Axis = 'x', shade = 1): void {
    if (x0 > x1) [x0, x1] = [x1, x0]; if (y0 > y1) [y0, y1] = [y1, y0]; if (z0 > z1) [z0, z1] = [z1, z0];
    const f = (a: V3, b: V3, c: V3, d: V3) => this.face(skin, colour, a, b, c, d, grain, shade);
    f([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]); f([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    f([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]); f([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
    f([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); f([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
  }
  /** A short round disc with its axis along x, y or z: scrolled pew ends and the round stand top. */
  private disc(colour: number, cx: number, cy: number, cz: number, radius: number, thick: number, axis: Axis): void {
    const sides = 10, at = (i: number, side: number): V3 => {
      const a = i / sides * Math.PI * 2, u = Math.cos(a) * radius, v = Math.sin(a) * radius, w = side * thick / 2;
      return axis === 'z' ? [cx + u, cy + v, cz + w] : axis === 'x' ? [cx + w, cy + u, cz + v] : [cx + v, cy + w, cz + u];
    };
    const centre = (side: number): V3 => axis === 'z' ? [cx, cy, cz + side * thick / 2] : axis === 'x' ? [cx + side * thick / 2, cy, cz] : [cx, cy + side * thick / 2, cz];
    for (let i = 0; i < sides; i++) {
      this.face('plain', colour, centre(1), at(i, 1), at(i + 1, 1), centre(1), 'x');
      this.face('plain', colour, centre(-1), at(i + 1, -1), at(i, -1), centre(-1), 'x');
      this.face('plain', colour, at(i, -1), at(i + 1, -1), at(i + 1, 1), at(i, 1), 'x');
    }
  }
  /** One whole picture on a face: a is its lower left corner seen from the front, u runs right and v runs up. */
  private sheet(name: Sheet, a: V3, u: V3, v: V3, lit = true): void {
    const batch = this.batch(`sheet|${name}`, () => lit ? new THREE.MeshLambertMaterial({ map: this.map(name), vertexColors: true })
      : new THREE.MeshBasicMaterial({ map: this.map(name), vertexColors: true, alphaTest: .5 }));
    const corner = (s: number, t: number): V3 => this.moved([a[0] + u[0] * s + v[0] * t, a[1] + u[1] * s + v[1] * t, a[2] + u[2] * s + v[2] * t]);
    const A = corner(0, 0), B = corner(1, 0), C = corner(1, 1), D = corner(0, 1), n = unit(cross(sub(B, A), sub(D, A)));
    for (const [p, s, t] of [[A, 0, 0], [B, 1, 0], [C, 1, 1], [A, 0, 0], [C, 1, 1], [D, 0, 1]] as [V3, number, number][]) {
      batch.position.push(p[0], p[1], p[2]); batch.normal.push(n[0], n[1], n[2]); batch.uv.push(s, t); batch.color.push(1, 1, 1);
    }
  }

  build(room: ChurchRoom): ChurchRoomParts {
    this.zone = 'nave'; this.shell(room); this.gallery(room); this.pews(room); this.altarEnd(room); this.wallPictures(room);
    this.zone = 'vestry'; this.vestry(room);
    const groups: Record<Zone, THREE.Group> = { nave: new THREE.Group(), vestry: new THREE.Group(), loft: new THREE.Group() };
    let triangles = 0, drawCalls = 0;
    for (const batch of this.batches.values()) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.position, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normal, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uv, 2));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(batch.color, 3));
      this.resources.push(geometry); triangles += batch.position.length / 9; drawCalls++;
      const mesh = new THREE.Mesh(geometry, batch.material); mesh.castShadow = mesh.receiveShadow = false; mesh.matrixAutoUpdate = false;
      groups[batch.zone].add(mesh);
    }
    this.batches.clear();
    // The letter is its own small mesh, so the visit can show it only once it has been left.
    const v = room.shell.vestry, paper = new THREE.BoxGeometry(.24, .008, .12), ink = new THREE.MeshLambertMaterial({ color: PAINT.paper });
    this.resources.push(paper, ink);
    const letter = new THREE.Mesh(paper, ink); letter.position.set(v.x0 + CHEST.from + CHEST.long / 2, 1.014, v.z0 + .3); letter.rotation.y = .3; letter.visible = false;
    groups.vestry.add(letter);
    return { groups, letter, triangles: triangles + 12, drawCalls: drawCalls + 1 };
  }

  /** Floor, walls and the boarded ceiling: a flat panel in the middle, and sloped sides down to the long walls. */
  private shell(room: ChurchRoom): void {
    const { nave: N, porch } = room.shell, f = room.fit, c = N.ridgeZ, top = f.ceiling.flat, low = f.ceiling.wall;
    const a = c - f.ceiling.flatHalf, b = c + f.ceiling.flatHalf;
    this.face('boards', PAINT.floor, [N.x0, 0, N.z1], [N.x1, 0, N.z1], [N.x1, 0, N.z0], [N.x0, 0, N.z0], 'x');
    this.face('boards', PAINT.side, [N.x0, 0, N.z0], [N.x1, 0, N.z0], [N.x1, low, N.z0], [N.x0, low, N.z0], 'x');
    this.face('boards', PAINT.side, [N.x1, 0, N.z1], [N.x0, 0, N.z1], [N.x0, low, N.z1], [N.x1, low, N.z1], 'x');
    // End walls: a doorway in each, and a gable that follows the ceiling.
    const end = (x: number, facing: 1 | -1, colour: number, door: { z: number; width: number; height: number }) => {
      const wall = (z0: number, z1: number, y0: number, y1a: number, y1b = y1a) => facing > 0
        ? this.face('boards', colour, [x, y0, z1], [x, y0, z0], [x, y1b, z0], [x, y1a, z1], 'z')
        : this.face('boards', colour, [x, y0, z0], [x, y0, z1], [x, y1a, z1], [x, y1b, z0], 'z');
      const d0 = door.z - door.width / 2, d1 = door.z + door.width / 2;
      wall(N.z0, d0, 0, low); wall(d1, N.z1, 0, low); wall(d0, d1, door.height, low);
      // wall() takes the height at its second z first.
      for (const [za, zb] of [[N.z0, a], [a, b], [b, N.z1]]) wall(za, zb, low, ceilingAt(room, zb), ceilingAt(room, za));
    };
    end(N.x0, 1, PAINT.altarWall, f.vestryDoor);
    end(N.x1, -1, PAINT.side, { z: porch.door.z, width: porch.door.width, height: porch.door.height });
    this.face('boards', PAINT.green, [N.x0, low, N.z0], [N.x1, low, N.z0], [N.x1, top, a], [N.x0, top, a], 'x');
    this.face('boards', PAINT.ceiling, [N.x0, top, a], [N.x1, top, a], [N.x1, top, b], [N.x0, top, b], 'x');
    this.face('boards', PAINT.green, [N.x0, top, b], [N.x1, top, b], [N.x1, low, N.z1], [N.x0, low, N.z1], 'x');
    // The tower porch behind the visitor: a dim box, the closed outer door, the side door to the ramp and a small window.
    const h = 2.65, d0 = porch.z0, d1 = porch.z1;
    this.face('boards', PAINT.floor, [N.x1, 0, d1], [porch.x1, 0, d1], [porch.x1, 0, d0], [N.x1, 0, d0], 'x', .7);
    this.face('boards', PAINT.side, [N.x1, 0, d0], [porch.x1, 0, d0], [porch.x1, h, d0], [N.x1, h, d0], 'x', .6);
    this.face('boards', PAINT.side, [porch.x1, 0, d1], [N.x1, 0, d1], [N.x1, h, d1], [porch.x1, h, d1], 'x', .6);
    this.face('boards', PAINT.side, [porch.x1, 0, d0], [porch.x1, 0, d1], [porch.x1, h, d1], [porch.x1, h, d0], 'z', .6);
    this.face('boards', PAINT.ceiling, [N.x1, h, d0], [porch.x1, h, d0], [porch.x1, h, d1], [N.x1, h, d1], 'x', .6);
    this.box('boards', PAINT.white, porch.x1 - .05, 0, porch.door.z - porch.door.width / 2, porch.x1 - .01, porch.door.height, porch.door.z + porch.door.width / 2, 'y', .8);
    const sd = porch.side;
    this.box('boards', PAINT.white, sd.x - sd.width / 2, 0, d0 + .01, sd.x + sd.width / 2, sd.height, d0 + .05, 'y', .8);
    const pw = porch.window;
    this.sheet('window', [pw.x + pw.width / 2, pw.sill, d1 - .012], [-pw.width, 0, 0], [0, pw.spring - pw.sill + pw.width / 2, 0], false);
    // Round-headed windows of many small panes, each with a white sill. The galleries pass in front of most of them.
    for (const w of room.shell.windows) {
      const z = w.side > 0 ? N.z1 : N.z0, inward = -w.side, tall = w.spring - w.sill + w.width / 2;
      this.sheet('window', [w.x - inward * w.width / 2, w.sill, z + inward * .012], [inward * w.width, 0, 0], [0, tall, 0], false);
      this.box('plain', PAINT.white, w.x - w.width / 2 - .06, w.sill - .06, z, w.x + w.width / 2 + .06, w.sill, z + inward * .1);
    }
    // The two small windows high in the door wall, over the back gallery.
    for (const w of room.shell.gable) this.sheet('sash', [N.x1 - .012, w.sill, w.z - w.width / 2], [0, 0, w.width], [0, w.top - w.sill, 0], false);
    // The iron tie rod over the back gallery's front, with its turnbuckle in the middle. It ends where it meets the slope.
    const rodX = N.x1 - f.gallery.rear, rodY = f.tieRod.height, half = N.z1 - c;
    const reach = f.ceiling.flatHalf + (top - rodY) / (top - low) * (half - f.ceiling.flatHalf);
    this.box('plain', PAINT.iron, rodX - .02, rodY - .02, c - reach, rodX + .02, rodY + .02, c + reach);
    this.box('plain', PAINT.iron, rodX - .035, rodY - .045, c - .2, rodX + .035, rodY + .045, c + .2);
  }

  /** The gallery on three sides: slab, vertical-board parapet, cap rail, square posts, and the L-shaped stair up to it. */
  private gallery(room: ChurchRoom): void {
    const N = room.shell.nave, f = room.fit, g = f.gallery, s = f.stair, st = churchStair(room), c = N.ridgeZ;
    const top = g.floor, under = g.under, edge = N.x1 - g.rear, tip = N.x0 + g.sideEnd, well = c + s.well;
    const slab = (x0: number, x1: number, z0: number, z1: number) => {
      this.box('boards', PAINT.soffit, x0, under, z0, x1, top - .01, z1, 'x');
      this.face('bare', 0xffffff, [x0, top, Math.max(z0, z1)], [x1, top, Math.max(z0, z1)], [x1, top, Math.min(z0, z1)], [x0, top, Math.min(z0, z1)], 'x', .8);
    };
    // The back gallery, with an L-shaped opening over the stair in the +z corner.
    slab(edge, N.x1, N.z0, well); slab(edge, st.inner, well, st.landingZ); slab(edge, st.top, st.landingZ, N.z1);
    const front = (x0: number, z0: number, x1: number, z1: number) => {
      const along: Axis = Math.abs(x1 - x0) > Math.abs(z1 - z0) ? 'x' : 'z', t = .035;
      const bx = along === 'x' ? 0 : t, bz = along === 'x' ? t : 0;
      this.box('bead', PAINT.front, x0 - bx, under - .06, z0 - bz, x1 + bx, top + g.front, z1 + bz, 'y');
      this.box('plain', PAINT.soffit, x0 - bx * 2.4, top + g.front, z0 - bz * 2.4, x1 + bx * 2.4, top + g.front + .05, z1 + bz * 2.4);
      this.box('plain', PAINT.post, x0 - bx * 1.6, under - .06, z0 - bz * 1.6, x1 + bx * 1.6, under + .04, z1 + bz * 1.6);
    };
    // A guard round the opening: the same parapet, standing on the gallery floor.
    const guard = (x0: number, z0: number, x1: number, z1: number) => {
      this.box('bead', PAINT.front, x0, top, z0, x1, top + g.front, z1, 'y');
      this.box('plain', PAINT.soffit, x0 - .01, top + g.front, z0 - .01, x1 + .01, top + g.front + .05, z1 + .01);
    };
    for (const side of [-1, 1] as const) {
      const wall = side < 0 ? N.z0 : N.z1, inner = wall - side * g.side;
      slab(tip, edge, wall, inner);
      front(tip, inner, edge, inner); front(tip, wall, tip, inner);
      // A post at each end of the side gallery's front. The two at the back gallery's corners rise to the ceiling.
      this.box('boards', PAINT.post, tip - g.post / 2, 0, inner - g.post / 2, tip + g.post / 2, under - .06, inner + g.post / 2, 'y');
      this.box('boards', PAINT.post, edge - g.post / 2, 0, inner - g.post / 2, edge + g.post / 2, f.ceiling.flat, inner + g.post / 2, 'y');
    }
    front(edge, N.z0 + g.side, edge, N.z1 - g.side);
    guard(st.inner, well - .05, N.x1, well); guard(st.inner - .05, well, st.inner, st.landingZ);
    guard(st.top, st.landingZ - .05, st.inner, st.landingZ);
    // The lower flight along the door wall: closed risers, bare treads, and a boarded side that follows the nosings.
    for (let k = 0; k < s.steps - 1; k++) {
      const z0 = st.foot + k * st.tread, z1 = z0 + st.tread, y = (k + 1) * st.riser;
      this.box('bead', PAINT.front, st.inner, 0, z0, st.outer, y - .03, z1, 'y', .9);
      this.box('bare', 0xffffff, st.inner, y - .03, z0 - .02, st.outer, y, z1, 'x', .85);
    }
    this.box('bead', PAINT.front, st.inner, 0, st.landingZ, st.outer, s.landing - .03, N.z1, 'y', .9);
    this.box('bare', 0xffffff, st.inner, s.landing - .03, st.landingZ - .02, st.outer, s.landing, N.z1, 'x', .85);
    // Its open side is boarded only up to a stringer along the nosings; a plain handrail runs on the door wall.
    const nose = (z: number) => st.riser + Math.max(0, z - st.foot) * st.riser / st.tread, x = st.inner;
    const z0 = st.foot - .05, z1 = st.landingZ, h0 = nose(z0) + .08, h1 = s.landing + .08;
    this.face('bead', PAINT.front, [x - .05, 0, z0], [x - .05, 0, z1], [x - .05, h1, z1], [x - .05, h0, z0], 'y');
    this.face('bead', PAINT.front, [x, 0, z1], [x, 0, z0], [x, h0, z0], [x, h1, z1], 'y');
    this.face('plain', PAINT.post, [x - .05, h0, z0], [x - .05, h1, z1], [x, h1, z1], [x, h0, z0], 'z');
    const rail = (z: number) => nose(z) + .85;
    this.face('plain', PAINT.post, [st.outer - .06, rail(z0) - .05, z0], [st.outer - .06, rail(z1) - .05, z1], [st.outer - .06, rail(z1), z1], [st.outer - .06, rail(z0), z0], 'z');
    // The upper flight along the +z wall: thick steps over the pew below, and a boarded side up to the gallery floor.
    const steps = s.upper - 1;
    for (let j = 0; j < steps; j++) {
      const x0 = st.inner - j * s.tread, x1 = x0 - s.tread, y = s.landing + (j + 1) * st.upperRiser;
      this.box('bead', PAINT.front, x1, y - st.upperRiser - .3, st.landingZ, x0, y - .03, N.z1, 'y', .9);
      this.box('bare', 0xffffff, x1, y - .03, st.landingZ, x0 + .02, y, N.z1, 'x', .85);
    }
    // The step blocks hang .3 below each riser: the board's lower edge runs along their bottoms, just in front of them.
    const lowA = s.landing - .33, lowB = s.landing + (s.upper - 2) * st.upperRiser - .33, zs = st.landingZ - .01;
    this.face('bead', PAINT.front, [st.inner, lowA, zs], [st.top, lowB, zs], [st.top, under, zs], [st.inner, under, zs], 'y');
    this.face('bead', PAINT.front, [st.top, lowB, zs + .002], [st.inner, lowA, zs + .002], [st.inner, under, zs + .002], [st.top, under, zs + .002], 'y');
    this.zone = 'loft';
    // Plain old benches for the gallery.
    const bench = (x0: number, z0: number, x1: number, z1: number) => {
      const long = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      this.box('bare', PAINT.bench, x0, top + .4, z0, x1, top + .44, z1, long ? 'x' : 'z');
      for (const k of [.08, .5, .92]) {
        const bx = x0 + (x1 - x0) * (long ? k : .5), bz = z0 + (z1 - z0) * (long ? .5 : k);
        this.box('plain', PAINT.bench, bx - (long ? .03 : .13), top, bz - (long ? .13 : .03), bx + (long ? .03 : .13), top + .4, bz + (long ? .13 : .03));
      }
    };
    for (const side of [-1, 1] as const) {
      const wall = side < 0 ? N.z0 : N.z1;
      for (const off of [.45, 1.25]) bench(tip + .3, wall - side * off, edge - .3, wall - side * (off + .28));
    }
    for (const off of [.6, 1.5]) bench(N.x1 - off, N.z0 + .4, N.x1 - off - .28, c - .6);
    this.zone = 'nave';
  }

  /** Two blocks of pews on each side of the aisle: vertical-board backs, a seat, and white scrolled ends. */
  private pews(room: ChurchRoom): void {
    const N = room.shell.nave, f = room.fit, p = f.pews, c = N.ridgeZ;
    for (const side of [-1, 1] as const) {
      const aisle = c + side * f.aisle / 2, wall = (side < 0 ? N.z0 : N.z1) - side * .04;
      for (let i = 0; i < p.rows; i++) {
        // On the +z side the stair stands where the first row would be.
        if (side > 0 && i === 0) continue;
        const xb = N.x1 - p.rear - i * p.pitch;
        this.box('bead', PAINT.pew, xb - .02, .06, aisle, xb + .02, p.back, wall, 'y');
        this.box('plain', PAINT.pew, xb - .04, p.back, aisle, xb + .04, p.back + .04, wall);
        this.box('boards', PAINT.pew, xb - .02 - p.depth, p.seat - .03, aisle, xb - .02, p.seat, wall, 'z');
        this.box('bead', PAINT.pew, xb - .02 - p.depth, .06, aisle, xb - p.depth + .01, p.seat - .03, wall, 'y', .9);
        for (const z of [aisle, wall]) {
          const z0 = z - .03, z1 = z + .03;
          this.box('plain', PAINT.pewEnd, xb - p.depth - .1, 0, z0, xb + .05, p.seat + .2, z1);
          this.box('plain', PAINT.pewEnd, xb - .2, p.seat + .2, z0, xb + .05, p.back + .04, z1);
          this.disc(PAINT.pewEnd, xb - .09, p.back + .05, z, .1, .06, 'z');
          this.disc(PAINT.pewEnd, xb - p.depth - .04, p.seat + .2, z, .085, .06, 'z');
        }
      }
    }
  }

  /** The east end: the chancel step, the altar platform, the altar with its gradines, spires and arched table, and what stands near it. */
  private altarEnd(room: ChurchRoom): void {
    const N = room.shell.nave, f = room.fit, a = f.altar, c = N.ridgeZ, w = N.x0, ch = f.chancel, pf = f.platform, rise = pf.rise;
    this.box('boards', PAINT.floor, w, 0, N.z0, w + ch.depth, ch.rise, N.z1, 'x');
    this.box('boards', PAINT.platform, w, ch.rise, c - pf.width / 2, w + pf.depth, rise, c + pf.width / 2, 'x');
    // The long altar stands off the wall, with an arched panel at each end of its front.
    const ax = w + a.back, at = rise + a.height;
    this.box('plain', PAINT.white, ax, rise, c - a.width / 2, ax + a.depth, at, c + a.width / 2);
    this.box('plain', PAINT.white, ax - .02, at, c - a.width / 2 - .04, ax + a.depth + .04, at + .04, c + a.width / 2 + .04);
    for (const side of [-1, 1]) this.sheet('altar1', [ax + a.depth + .006, rise + .08, c + side * .82 + .3], [0, 0, -.6], [0, a.height - .14, 0]);
    // Two gradines behind it, and the small tabernacle in the middle with a pointed top and gold finials.
    const g1 = at + .12, g2 = g1 + .14;
    this.box('plain', PAINT.white, w, rise, c - a.width / 2 + .1, ax, g1, c + a.width / 2 - .1);
    this.box('plain', PAINT.white, w, g1, c - a.width / 2 + .1, w + .26, g2, c + a.width / 2 - .1);
    this.box('plain', PAINT.white, w + .02, g1, c - .2, w + .4, g1 + .5, c + .2);
    this.face('plain', PAINT.white, [w + .4, g1 + .5, c + .2], [w + .4, g1 + .5, c - .2], [w + .4, g1 + .7, c], [w + .4, g1 + .7, c], 'z');
    for (const dz of [-.18, .18]) this.box('plain', PAINT.gold, w + .37, g1 + .5, c + dz - .012, w + .4, g1 + .68, c + dz + .012);
    this.box('plain', PAINT.gold, w + .2, g1 + .7, c - .012, w + .23, g1 + .95, c + .012);
    // Five thin spires against the wall, white with a gold edge and scalloped in steps; the middle one is the tallest.
    a.spires.forEach((tall, i) => {
      const z = c + (i - 2) * a.spacing, base = g2, tiers = Math.round(tall / .17), step = tall / tiers;
      // Each tier a little narrower: the steps read as the scalloped edge. A thin gold line edges each side.
      for (let k = 0; k < tiers; k++) {
        const half = SPIRE_FOOT - .17 * k / (tiers - 1), y0 = base + k * step;
        this.box('plain', PAINT.gold, w + .01, y0 + .002, z - half - .012, w + .03, y0 + step - .002, z + half + .012);
        this.box('plain', PAINT.white, w + .012, y0, z - half, w + .045, y0 + step, z + half);
      }
      this.box('plain', PAINT.gold, w + .02, base + tall, z - .009, w + .038, base + tall + .13, z + .009);
      this.box('plain', PAINT.gold, w + .02, base + tall + .075, z - .04, w + .038, base + tall + .093, z + .04);
    });
    // The arched table in front of the altar: three pointed arches outlined in gold.
    const t = a.table, tx = w + pf.depth - t.front - t.depth;
    this.box('plain', PAINT.white, tx, rise, c - t.width / 2, tx + t.depth, rise + t.height, c + t.width / 2);
    this.box('plain', PAINT.white, tx - .02, rise + t.height, c - t.width / 2 - .05, tx + t.depth + .05, rise + t.height + .04, c + t.width / 2 + .05);
    this.box('plain', PAINT.white, tx, rise, c - t.width / 2 - .03, tx + t.depth + .03, rise + .1, c + t.width / 2 + .03);
    this.sheet('altar3', [tx + t.depth + .006, rise + .1, c + t.width / 2 - .04], [0, 0, -(t.width - .08)], [0, t.height - .12, 0]);
    // A framed picture high on each side of the spires, between the last spire and the vestry door's trim.
    const d = f.vestryDoor, back = room.shell.vestry.x1;
    const spireEdge = 2 * a.spacing + SPIRE_FOOT + .012, trimEdge = d.z - d.width / 2 - .1 - c;
    const half = Math.min(.33, (trimEdge - spireEdge) / 2 - .03), off = (spireEdge + trimEdge) / 2;
    for (const side of [-1, 1]) {
      const z = c + side * off;
      this.box('plain', PAINT.frame, w, 2.2, z - half, w + .03, 3.0, z + half);
      this.sheet('devotion', [w + .034, 2.22, z + half - .02], [0, 0, -(half * 2 - .04)], [0, .76, 0]);
    }
    // The vestry doorway on the left, trimmed in pale blue, and the tall white cupboard beside it.
    for (const side of [-1, 1]) this.box('plain', PAINT.post, back, 0, d.z + side * d.width / 2, w + .03, d.height + .1, d.z + side * (d.width / 2 + .1));
    this.box('plain', PAINT.post, back, d.height, d.z - d.width / 2 - .1, w + .03, d.height + .1, d.z + d.width / 2 + .1);
    this.box('bare', 0xffffff, back, -.02, d.z - d.width / 2, w, .002, d.z + d.width / 2, 'x', .8);
    const k = f.cupboard, k0 = d.z + d.width / 2 + .22, k1 = N.z1 - .05, fl = ch.rise;
    this.box('bead', PAINT.white, w, fl, k0, w + k.depth, k.height, k1, 'y');
    this.box('plain', PAINT.post, w, k.height, k0 - .04, w + k.depth + .05, k.height + .08, k1);
    for (const z of [k0, k1 - .06]) this.box('plain', PAINT.post, w + k.depth, fl, z, w + k.depth + .02, k.height, z + .06);
    this.box('plain', PAINT.post, w + k.depth, fl, (k0 + k1) / 2 - .03, w + k.depth + .02, k.height, (k0 + k1) / 2 + .03);
    for (const z of [(k0 + k1) / 2 - .09, (k0 + k1) / 2 + .09]) this.box('plain', PAINT.dark, w + k.depth + .02, 1.02, z - .015, w + k.depth + .05, 1.05, z + .015);
    // A small white desk at the front corner on the left.
    this.box('plain', PAINT.white, w + 1.75, fl, N.z1 - 1.3, w + 2.25, fl + .9, N.z1 - .55);
    // On the right: a red wooden chair, a tall white candle stand, a red table with two small white figures, and a red footstool.
    const cz = N.z0 + 1.55, cx = w + 1.55;
    for (const [dx, dz] of [[-.2, -.22], [-.2, .22], [.2, -.22], [.2, .22]]) this.box('plain', PAINT.chair, cx + dx - .025, fl, cz + dz - .025, cx + dx + .025, fl + (dx < 0 ? .98 : .62), cz + dz + .025);
    this.box('plain', PAINT.cane, cx - .2, fl + .42, cz - .22, cx + .22, fl + .46, cz + .22);
    this.box('plain', PAINT.chair, cx - .215, fl + .9, cz - .24, cx - .185, fl + .99, cz + .24);
    for (const dz of [-.235, .235]) this.box('plain', PAINT.chair, cx - .2, fl + .6, cz + dz - .02, cx + .22, fl + .64, cz + dz + .02);
    const sx = w + 1.0, sz = c - 1.75;
    this.disc(PAINT.white, sx, fl + .03, sz, .18, .06, 'y');
    this.box('plain', PAINT.white, sx - .025, fl, sz - .025, sx + .025, fl + 1.5, sz + .025);
    this.disc(PAINT.white, sx, fl + 1.5, sz, .12, .03, 'y');
    const rx = w + .45, rz = N.z0 + .45;
    for (const [dx, dz] of [[-.2, -.15], [-.2, .15], [.2, -.15], [.2, .15]]) this.box('plain', PAINT.red, rx + dx - .02, fl, rz + dz - .02, rx + dx + .02, fl + .72, rz + dz + .02);
    this.box('plain', PAINT.red, rx - .25, fl + .72, rz - .2, rx + .25, fl + .76, rz + .2);
    for (const dz of [-.08, .08]) this.box('plain', PAINT.white, rx - .05, fl + .76, rz + dz - .05, rx + .05, fl + 1.12, rz + dz + .05);
    const fx = w + 2.0, fz = N.z0 + .45;
    this.box('plain', PAINT.red, fx - .22, fl, fz - .15, fx + .22, fl + .3, fz + .15);
    this.box('plain', PAINT.cane, fx - .23, fl + .3, fz - .16, fx + .23, fl + .36, fz + .16);
  }

  /** Small framed pictures along the side walls, each with a small wooden cross above it. */
  private wallPictures(room: ChurchRoom): void {
    const N = room.shell.nave;
    for (const side of [-1, 1] as const) {
      const xs = room.shell.windows.filter(w => w.side === side).map(w => w.x).sort((a, b) => a - b);
      const between = [(N.x0 + xs[0]) / 2, (xs[0] + xs[1]) / 2, (xs[1] + xs[2]) / 2];
      // Not on the +z side by the door: the stair stands there.
      if (side < 0) between.push((xs[2] + N.x1) / 2 + .3);
      for (const x of between) {
        const z = side > 0 ? N.z1 : N.z0, inward = -side, y = 1.75;
        this.sheet('station', [x - inward * .23, y, z + inward * .02], [inward * .46, 0, 0], [0, .37, 0]);
        this.box('plain', PAINT.frame, x - .012, y + .37, z, x + .012, y + .5, z + inward * .02);
        this.box('plain', PAINT.frame, x - .045, y + .44, z, x + .045, y + .46, z + inward * .02);
      }
    }
  }

  /** The vestry: grey-blue boards, a bare worn floor, two sash windows, a chest of drawers, a folding chair and the map. */
  private vestry(room: ChurchRoom): void {
    const V = room.shell.vestry, d = room.fit.vestryDoor, h = V.ceiling;
    this.face('bare', 0xffffff, [V.x0, 0, V.z1], [V.x1, 0, V.z1], [V.x1, 0, V.z0], [V.x0, 0, V.z0], 'x');
    this.face('boards', PAINT.ceiling, [V.x0, h, V.z0], [V.x1, h, V.z0], [V.x1, h, V.z1], [V.x0, h, V.z1], 'x', .9);
    this.face('boards', PAINT.vestry, [V.x0, 0, V.z0], [V.x1, 0, V.z0], [V.x1, h, V.z0], [V.x0, h, V.z0], 'x');
    this.face('boards', PAINT.vestry, [V.x1, 0, V.z1], [V.x0, 0, V.z1], [V.x0, h, V.z1], [V.x1, h, V.z1], 'x');
    this.face('boards', PAINT.vestry, [V.x0, 0, V.z1], [V.x0, 0, V.z0], [V.x0, h, V.z0], [V.x0, h, V.z1], 'z');
    const d0 = d.z - d.width / 2, d1 = d.z + d.width / 2;
    for (const [z0, z1, y0] of [[V.z0, d0, 0], [d1, V.z1, 0], [d0, d1, d.height]]) if (y0 < h) this.face('boards', PAINT.vestry, [V.x1, y0, z0], [V.x1, y0, z1], [V.x1, h, z1], [V.x1, h, z0], 'z');
    // A dark baseboard.
    this.box('plain', PAINT.base, V.x0, 0, V.z0, V.x1, .13, V.z0 + .02); this.box('plain', PAINT.base, V.x0, 0, V.z1 - .02, V.x1, .13, V.z1);
    this.box('plain', PAINT.base, V.x0, 0, V.z0, V.x0 + .02, .13, V.z1);
    // A sash window on each long wall, where the windows are outside, and a closed four-panel door on the left wall.
    const tall = V.head - V.sill;
    for (const [z, inward, x] of [[V.z1, -1, V.window], [V.z0, 1, V.windowN]] as const) {
      this.sheet('sash', [x - inward * .4, V.sill, z + inward * .03], [inward * .8, 0, 0], [0, tall, 0], false);
      this.box('plain', PAINT.white, x - .47, V.sill - .07, z, x + .47, V.sill, z + inward * .09);
      for (const xf of [x - .47, x + .4]) this.box('plain', PAINT.white, xf, V.sill, z, xf + .07, V.head + .05, z + inward * .04);
      this.box('plain', PAINT.white, x - .47, V.head, z, x + .47, V.head + .07, z + inward * .04);
    }
    const dx = V.door, dh = V.doorHead;
    this.box('peel', PAINT.white, dx - .41, 0, V.z1 - .05, dx + .41, dh, V.z1);
    for (const [x, y0, y1] of [[-.19, .2, .8], [.19, .2, .8], [-.19, 1.0, dh - .18], [.19, 1.0, dh - .18]]) this.box('plain', PAINT.white, dx + x - .14, y0, V.z1 - .058, dx + x + .14, y1, V.z1 - .05, 'x', .86);
    this.box('plain', PAINT.wood, dx - .34, .95, V.z1 - .1, dx - .29, 1, V.z1 - .05);
    // A white chest of drawers with peeling paint, on the right wall toward the far end: in view from the stop, with the map.
    const cx0 = V.x0 + CHEST.from, cx1 = cx0 + CHEST.long, cz1 = V.z0 + .52;
    this.box('peel', PAINT.white, cx0, 0, V.z0 + .02, cx1, .98, cz1, 'x');
    this.box('peel', PAINT.white, cx0 - .03, .98, V.z0 + .02, cx1 + .03, 1.01, cz1 + .03, 'x');
    for (const y of [.26, .5, .74]) this.box('plain', PAINT.dark, cx0 + .04, y - .008, cz1, cx1 - .04, y + .008, cz1 + .004);
    for (const y of [.14, .38, .62, .86]) for (const x of [cx0 + .28, cx1 - .28]) this.box('plain', PAINT.dark, x - .025, y - .02, cz1, x + .025, y + .02, cz1 + .03);
    // A folding chair: two crossed leg frames, a cane seat and a back rail.
    const fx = V.x1 - 2.3, fz = V.z1 - .95;
    for (const z of [fz - .2, fz + .2]) {
      this.turned([fx, .42, z], 'z', .42, () => this.box('plain', PAINT.ply, fx - .02, 0, z - .015, fx + .02, .86, z + .015));
      this.turned([fx, .42, z], 'z', -.5, () => this.box('plain', PAINT.ply, fx - .02, -.03, z - .015, fx + .02, .8, z + .015));
    }
    this.box('plain', PAINT.cane, fx - .2, .43, fz - .2, fx + .19, .46, fz + .2);
    this.turned([fx, .42, fz], 'z', .42, () => this.box('plain', PAINT.ply, fx - .02, .74, fz - .2, fx + .02, .86, fz + .2));
    // Leaning on the far wall: two plain boards, and the framed hand-drawn map in a weathered frame.
    const mz = (V.z0 + V.z1) / 2 - .5, lean = .2, foot = V.x0 + .42;
    this.turned([foot, 0, mz], 'z', lean, () => {
      this.box('bare', PAINT.ply, foot - .05, 0, mz + .5, foot - .03, 1.5, mz + .98, 'y');
      this.box('bare', PAINT.ply2, foot - .08, 0, mz - .1, foot - .06, .72, mz + 1.3, 'z');
    });
    this.turned([foot + .12, 0, mz], 'z', lean, () => {
      const x = foot + .12, w = .92, t = .76, b = .07;
      this.box('plain', PAINT.grey, x - .03, 0, mz - w / 2, x, t, mz + w / 2);
      this.sheet('map', [x + .004, b, mz + w / 2 - b], [0, 0, -(w - 2 * b)], [0, t - 2 * b, 0]);
      for (const [y0, y1, z0, z1] of [[0, b, -w / 2, w / 2], [t - b, t, -w / 2, w / 2], [b, t - b, -w / 2, -w / 2 + b], [b, t - b, w / 2 - b, w / 2]]) this.box('plain', PAINT.grey, x, y0, mz + z0, x + .025, y1, mz + z1, 'z');
    });
  }

  dispose(): void { for (const r of this.resources) r.dispose(); this.resources.length = 0; this.maps.clear(); }
}
