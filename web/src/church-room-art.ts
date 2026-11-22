import * as THREE from 'three';
import { ceilingAt, churchStair, type ChurchRoom } from './church-room';

/**
 * The church room, drawn by hand. Every texture is painted in code on a canvas: no photograph, scan or still is used.
 * Boxes are batched into one mesh per zone and paint, so the whole room is a few dozen draw calls.
 */
type V3 = [number, number, number];
export type Zone = 'nave' | 'vestry' | 'loft';
type Skin = 'boards' | 'bead' | 'bare' | 'peel' | 'plain';
type Sheet = 'window' | 'sash' | 'stations' | 'devotions' | 'altar7' | 'altar3' | 'lectern' | 'map';
type Axis = 'x' | 'y' | 'z';
type UVRect = [number, number, number, number];

const PAINT = {
  side: 0x8fcfe0, altarWall: 0xeceee8, green: 0xaad8cc, ceiling: 0xeceee9, floor: 0x858b8c, platform: 0x7c8284,
  pew: 0xb4c8da, post: 0x9ad3e2, front: 0xa3c6d6, soffit: 0xe3e7e6, white: 0xeeeee8, gold: 0xb7924a, frame: 0x7a5a34,
  red: 0x9c2f2b, chair: 0x76482b, seat: 0x5c5749, iron: 0xbfcdd2, wood: 0x8d6a4c, vestry: 0x9aadb7, base: 0x545c61,
  ply: 0xc39a63, ply2: 0xa97a4c, grey: 0x8f8a80, cane: 0xcbb082, cushion: 0xd6d2b6, paper: 0xf3efe3, dark: 0x3d4447,
  bench: 0xd4c6b2, galleryPew: 0x7c4636, pewEnd: 0xe6ebec, cobalt: 0x1b3296, crimson: 0x6d1f26, robe: 0xebe4d4,
  maryBlue: 0x6ba7d4, sage: 0x6b8761, skin: 0xdcb99a, hair: 0x4b3324, brass: 0xb69546, hymn: 0x265c6c, metal: 0x9fa8ad,
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

/** Paint a simple period-style standing or kneeling figure for the Stations of the Cross lithographs. */
function drawFigure(g: CanvasRenderingContext2D, x: number, y: number, h: number, robe: string, cloak: string | null, opts: { halo?: boolean; kneel?: boolean; lean?: number; veil?: boolean; bareChest?: boolean } = {}): void {
  const headR = h * .11, lean = (opts.lean ?? 0) * h, bodyTop = y - h * (opts.kneel ? .66 : .86), headX = x + lean, headY = bodyTop;
  if (opts.halo) {
    const glow = g.createRadialGradient(headX, headY, headR * .3, headX, headY, headR * 2.5);
    glow.addColorStop(0, 'rgba(248,236,192,.78)'); glow.addColorStop(.55, 'rgba(235,212,150,.3)'); glow.addColorStop(1, 'rgba(235,212,150,0)');
    g.fillStyle = glow; g.beginPath(); g.arc(headX, headY, headR * 2.5, 0, Math.PI * 2); g.fill();
  }
  // Robe / lower body
  g.fillStyle = robe;
  g.beginPath();
  if (opts.kneel) {
    g.moveTo(headX - headR * 1.1, headY + headR);
    g.lineTo(headX + headR * 1.2, headY + headR);
    g.lineTo(x + h * .24, y);
    g.lineTo(x - h * .22, y);
  } else {
    g.moveTo(headX - headR * 1.2, headY + headR);
    g.lineTo(headX + headR * 1.2, headY + headR);
    g.lineTo(x + h * .18, y);
    g.lineTo(x - h * .18, y);
  }
  g.closePath(); g.fill();
  if (opts.bareChest) {
    g.fillStyle = '#d3b293';
    g.fillRect(headX - headR * .95, headY + headR, headR * 1.9, h * .28);
  }
  if (cloak) {
    g.fillStyle = cloak;
    g.beginPath();
    g.moveTo(headX - headR * 1.25, headY + headR);
    g.lineTo(headX + headR * .5, headY + headR * 1.5);
    g.lineTo(x + h * .08, y - h * .08);
    g.lineTo(x - h * .2, y - h * .05);
    g.closePath(); g.fill();
  }
  // Head & hair/veil
  if (opts.veil) {
    g.fillStyle = cloak ?? '#263448';
    g.beginPath(); g.arc(headX, headY, headR * 1.35, Math.PI * .9, Math.PI * 2.1); g.lineTo(headX + headR * 1.4, headY + headR * 2.2); g.lineTo(headX - headR * 1.4, headY + headR * 2.2); g.closePath(); g.fill();
  } else {
    g.fillStyle = '#3f2d21';
    g.beginPath(); g.arc(headX, headY - headR * .1, headR * 1.12, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#d8b99a';
  g.beginPath(); g.arc(headX + lean * .1, headY + headR * .05, headR * .85, 0, Math.PI * 2); g.fill();
}

/** Draw a wooden cross beam inside a Station scene. */
function drawBeam(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, width: number): void {
  g.strokeStyle = '#4c3422'; g.lineWidth = width; g.lineCap = 'butt';
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  g.strokeStyle = 'rgba(145,108,74,.45)'; g.lineWidth = Math.max(1.5, width * .3);
  g.beginPath(); g.moveTo(x0, y0 - 1); g.lineTo(x1, y1 - 1); g.stroke();
}

/**
 * Eleven hanging Stations of the Cross packed into one 4x3 texture atlas (one draw call for all Stations).
 * Each cell paints a respectful 19th-century chromolithograph scene of that Station in code: no pixels copied.
 * Order matches the eleven frames hanging in the church: I, II, IV, V, VI, VIII, IX, X, XI, XII, XIV.
 */
const STATION_NUMERALS = ['S. I', 'S. II', 'S. IV', 'S. V', 'S. VI', 'S. VIII', 'S. IX', 'S. X', 'S. XI', 'S. XII', 'S. XIV'] as const;
function stationsAtlasTexture(): HTMLCanvasElement {
  const cols = 4, rows = 3, cw = 256, ch = 256, [c, g] = canvas(cols * cw, rows * ch);
  g.fillStyle = '#7a5a34'; g.fillRect(0, 0, c.width, c.height);
  for (let idx = 0; idx < STATION_NUMERALS.length; idx++) {
    const col = idx % cols, row = Math.floor(idx / cols), ox = col * cw, oy = row * ch;
    g.save(); g.translate(ox, oy);
    // Antique gilded wooden frame
    g.fillStyle = '#6c5024'; g.fillRect(0, 0, cw, ch);
    g.fillStyle = '#a98641'; g.fillRect(5, 5, cw - 10, ch - 10);
    g.fillStyle = '#cab068'; g.fillRect(10, 10, cw - 20, ch - 20);
    g.fillStyle = '#5c4520'; g.fillRect(15, 15, cw - 30, ch - 30);
    // Aged cream paper mat
    g.fillStyle = '#e7e0cf'; g.fillRect(18, 18, cw - 36, ch - 36);
    const sx = 34, sy = 32, sw = cw - 68, sh = 160;
    g.save(); g.beginPath(); g.rect(sx, sy, sw, sh); g.clip();
    // Period sky and stone ground backdrop
    const sky = g.createLinearGradient(sx, sy, sx, sy + sh);
    if (idx === 9) { sky.addColorStop(0, '#3e424c'); sky.addColorStop(.55, '#6a655e'); sky.addColorStop(1, '#4c4338'); }
    else if (idx === 10) { sky.addColorStop(0, '#2c2927'); sky.addColorStop(.6, '#50473f'); sky.addColorStop(1, '#3d342b'); }
    else { sky.addColorStop(0, '#7e888e'); sky.addColorStop(.55, '#b6ac98'); sky.addColorStop(1, '#7a6c5a'); }
    g.fillStyle = sky; g.fillRect(sx, sy, sw, sh);
    g.fillStyle = '#635646'; g.fillRect(sx, sy + sh * .74, sw, sh * .26);
    const groundY = sy + sh * .95;
    switch (idx) {
      case 0: // S. I: Jesus condemned to death
        g.fillStyle = '#8b7d6b'; g.fillRect(sx, sy + sh * .2, sw * .34, sh * .8);
        drawFigure(g, sx + sw * .2, groundY - 12, 86, '#7b2f2d', '#d6cdb8');
        drawFigure(g, sx + sw * .54, groundY, 92, '#dcd5c6', '#8d3632', { halo: true });
        drawFigure(g, sx + sw * .8, groundY, 90, '#4f5d6b', '#7d442c');
        break;
      case 1: // S. II: Jesus takes up His cross
        drawBeam(g, sx + sw * .36, sy + sh * .15, sx + sw * .86, groundY, 12);
        drawBeam(g, sx + sw * .32, sy + sh * .34, sx + sw * .58, sy + sh * .12, 10);
        drawFigure(g, sx + sw * .24, groundY, 92, '#8b4c32', '#3f4954');
        drawFigure(g, sx + sw * .54, groundY, 92, '#d9d2c2', '#6e2e2b', { halo: true, lean: -.06 });
        drawFigure(g, sx + sw * .8, groundY, 84, '#5a6168', '#8a5534');
        break;
      case 2: // S. IV: Jesus meets His Mother
        drawBeam(g, sx + sw * .14, groundY - 6, sx + sw * .64, sy + sh * .14, 13);
        drawBeam(g, sx + sw * .38, sy + sh * .12, sx + sw * .58, sy + sh * .36, 10);
        drawFigure(g, sx + sw * .38, groundY, 88, '#7a332d', '#542322', { halo: true, kneel: true, lean: .08 });
        drawFigure(g, sx + sw * .74, groundY, 90, '#c8c0b2', '#263952', { veil: true, lean: -.05 });
        break;
      case 3: // S. V: Simon of Cyrene helps carry the cross
        drawBeam(g, sx + sw * .16, sy + sh * .22, sx + sw * .84, groundY - 8, 12);
        drawBeam(g, sx + sw * .12, sy + sh * .42, sx + sw * .38, sy + sh * .14, 10);
        drawFigure(g, sx + sw * .32, groundY, 90, '#7c322c', '#572422', { halo: true, lean: -.06 });
        drawFigure(g, sx + sw * .62, groundY, 88, '#856544', '#4d3a28', { lean: -.05 });
        drawFigure(g, sx + sw * .84, groundY, 86, '#4b5563', '#8c3b30');
        break;
      case 4: // S. VI: Veronica wipes the face of Jesus
        drawBeam(g, sx + sw * .44, sy + sh * .16, sx + sw * .90, groundY - 4, 12);
        drawBeam(g, sx + sw * .38, sy + sh * .34, sx + sw * .64, sy + sh * .12, 10);
        drawFigure(g, sx + sw * .26, groundY, 76, '#50647a', '#314257', { kneel: true, veil: true, lean: .08 });
        g.fillStyle = '#efeadd'; g.fillRect(sx + sw * .36, sy + sh * .54, 18, 22);
        drawFigure(g, sx + sw * .6, groundY, 90, '#7d342e', '#562422', { halo: true, lean: -.07 });
        drawFigure(g, sx + sw * .84, groundY, 84, '#5a4a3a', '#7c4430');
        break;
      case 5: // S. VIII: Jesus meets the women of Jerusalem
        drawBeam(g, sx + sw * .26, sy + sh * .16, sx + sw * .62, groundY, 11);
        drawBeam(g, sx + sw * .18, sy + sh * .34, sx + sw * .44, sy + sh * .14, 9);
        drawFigure(g, sx + sw * .2, groundY, 86, '#545d66', '#7a3a2e');
        drawFigure(g, sx + sw * .48, groundY, 94, '#d8d0c0', '#7e312c', { halo: true });
        drawFigure(g, sx + sw * .74, groundY, 76, '#485a72', '#2b384a', { kneel: true, veil: true });
        drawFigure(g, sx + sw * .86, groundY, 72, '#8b6e52', '#523c2c', { kneel: true, veil: true });
        break;
      case 6: { // S. IX: Jesus falls the third time
        const x0 = sx + sw * .14, y0 = sy + sh * .40, x1 = sx + sw * .86, y1 = groundY - 8;
        const px = x0 + (x1 - x0) * .28, py = y0 + (y1 - y0) * .28;
        const len = Math.hypot(x1 - x0, y1 - y0), nx = -(y1 - y0) / len * 32, ny = (x1 - x0) / len * 32;
        drawBeam(g, x0, y0, x1, y1, 13);
        drawBeam(g, px - nx, py - ny, px + nx, py + ny, 10);
        drawFigure(g, sx + sw * .48, groundY, 72, '#80342e', '#572220', { halo: true, kneel: true, lean: .12 });
        drawFigure(g, sx + sw * .22, groundY, 90, '#4f5d6b', '#874832');
        drawFigure(g, sx + sw * .78, groundY, 88, '#66523c', '#3c4752');
        break;
      }
      case 7: { // S. X: Jesus is stripped of His garments
        const x0 = sx + sw * .66, y0 = sy + sh * .18, x1 = sx + sw * .92, y1 = groundY - 2;
        const px = x0 + (x1 - x0) * .26, py = y0 + (y1 - y0) * .26;
        const len = Math.hypot(x1 - x0, y1 - y0), nx = -(y1 - y0) / len * 26, ny = (x1 - x0) / len * 26;
        drawBeam(g, x0, y0, x1, y1, 11);
        drawBeam(g, px - nx, py - ny, px + nx, py + ny, 9);
        drawFigure(g, sx + sw * .24, groundY, 78, '#46617d', '#314459', { kneel: true, lean: .08 });
        drawFigure(g, sx + sw * .52, groundY, 96, '#d9d3c5', '#7c2e2b', { halo: true, bareChest: true });
        drawFigure(g, sx + sw * .8, groundY, 88, '#425264', '#6d4430');
        break;
      }
      case 8: // S. XI: Jesus is nailed to the cross
        drawBeam(g, sx + sw * .1, groundY - 12, sx + sw * .82, sy + sh * .44, 14);
        drawBeam(g, sx + sw * .14, sy + sh * .46, sx + sw * .48, sy + sh * .76, 12);
        // Reclining figure of Christ on the cross
        g.strokeStyle = '#d8b99a'; g.lineWidth = 12; g.beginPath(); g.moveTo(sx + sw * .34, sy + sh * .56); g.lineTo(sx + sw * .72, groundY - 12); g.stroke();
        g.strokeStyle = '#e4dfd2'; g.lineWidth = 15; g.beginPath(); g.moveTo(sx + sw * .44, sy + sh * .64); g.lineTo(sx + sw * .64, groundY - 18); g.stroke();
        g.fillStyle = '#d8b99a'; g.beginPath(); g.arc(sx + sw * .34, sy + sh * .52, 8, 0, Math.PI * 2); g.fill();
        drawFigure(g, sx + sw * .56, groundY - 24, 72, '#3c4c5c', '#29333e');
        drawFigure(g, sx + sw * .8, groundY, 90, '#965438', '#416384', { lean: -.06 });
        break;
      case 9: // S. XII: Jesus dies on the cross (Crucifixion)
        // Two flanking crosses
        for (const [tx, ty] of [[sx + sw * .18, sy + sh * .22], [sx + sw * .82, sy + sh * .22]]) {
          drawBeam(g, tx, ty, tx, groundY, 7); drawBeam(g, tx - 22, ty + 16, tx + 22, ty + 16, 6);
          g.fillStyle = '#c8aa8d'; g.fillRect(tx - 5, ty + 14, 10, 38); g.fillStyle = '#d8d2c4'; g.fillRect(tx - 6, ty + 34, 12, 12);
        }
        // Central cross with Christ
        drawBeam(g, sx + sw * .5, sy + sh * .08, sx + sw * .5, groundY, 10);
        drawBeam(g, sx + sw * .28, sy + sh * .24, sx + sw * .72, sy + sh * .24, 9);
        g.strokeStyle = '#d8b99a'; g.lineWidth = 5; g.beginPath(); g.moveTo(sx + sw * .33, sy + sh * .24); g.lineTo(sx + sw * .67, sy + sh * .24); g.stroke();
        g.fillStyle = '#d8b99a'; g.fillRect(sx + sw * .5 - 6, sy + sh * .22, 12, 54);
        g.fillStyle = '#ebe5d8'; g.fillRect(sx + sw * .5 - 8, sy + sh * .42, 16, 16);
        g.fillStyle = '#d8b99a'; g.beginPath(); g.arc(sx + sw * .5, sy + sh * .2, 7, 0, Math.PI * 2); g.fill();
        // Mary & St. John at the foot
        drawFigure(g, sx + sw * .34, groundY, 64, '#5a6774', '#2c3b4f', { kneel: true, veil: true });
        drawFigure(g, sx + sw * .66, groundY, 64, '#7d3932', '#242b34', { kneel: true, veil: true });
        break;
      case 10: // S. XIV: Jesus is laid in the tomb
        g.fillStyle = '#24201c'; g.beginPath(); g.arc(sx + sw * .58, groundY - 36, 48, Math.PI, 0); g.lineTo(sx + sw * .58 + 48, groundY); g.lineTo(sx + sw * .58 - 48, groundY); g.closePath(); g.fill();
        drawFigure(g, sx + sw * .18, groundY, 84, '#7c6b58', '#544535', { lean: .08 });
        drawFigure(g, sx + sw * .4, groundY - 12, 78, '#3f5a75', '#273a4f', { veil: true });
        drawFigure(g, sx + sw * .78, groundY, 80, '#725c48', '#4a3a2c', { lean: -.08 });
        // Shrouded body of Christ resting on stone slab
        g.fillStyle = '#e2dcd0'; g.beginPath(); g.ellipse(sx + sw * .54, groundY - 22, 46, 15, .08, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#d8b99a'; g.beginPath(); g.arc(sx + sw * .66, groundY - 36, 8, 0, Math.PI * 2); g.fill();
        break;
    }
    g.restore();
    // Crisp dark rule around scene
    g.strokeStyle = 'rgba(65,58,48,.55)'; g.lineWidth = 1.5; g.strokeRect(sx, sy, sw, sh);
    // Roman numeral and delicate caption bars on the mat
    g.fillStyle = '#3b352c'; g.font = 'bold 15px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(STATION_NUMERALS[idx], cw / 2, sy + sh + 16);
    g.fillStyle = 'rgba(80,74,64,.45)';
    g.fillRect(48, sy + sh + 14, 46, 1.5); g.fillRect(cw - 94, sy + sh + 14, 46, 1.5);
    g.fillRect(62, sy + sh + 26, cw - 124, 1.5);
    g.restore();
  }
  return c;
}

/**
 * Four framed chancel devotional pictures packed into one 1024x512 atlas (one draw call):
 * 0: Sacred Heart of Jesus (left of spires, above vestry door)
 * 1: Immaculate Heart of Mary (right of spires, upper)
 * 2: Sacred Heart of Jesus standing painting (right of spires, lower)
 * 3: Oval clerical portrait (right chancel side wall)
 */
function devotionsAtlasTexture(): HTMLCanvasElement {
  const pw = 256, ph = 512, [c, g] = canvas(pw * 4, ph);
  const goldFrame = (ox: number, darkFrame = false, wideMat = true) => {
    g.fillStyle = darkFrame ? '#3a2a18' : '#735b2e'; g.fillRect(ox, 0, pw, ph);
    g.fillStyle = darkFrame ? '#5e4526' : '#a88a48'; g.fillRect(ox + 7, 7, pw - 14, ph - 14);
    g.fillStyle = darkFrame ? '#a98a4a' : '#cbb06a'; g.fillRect(ox + 13, 13, pw - 26, ph - 26);
    g.fillStyle = '#3a3022'; g.fillRect(ox + 18, 18, pw - 36, ph - 36);
    if (wideMat) { g.fillStyle = '#e5e0d3'; g.fillRect(ox + 21, 21, pw - 42, ph - 42); }
  };
  const drawHeart = (cx: number, cy: number, r: number, colour: string, withCross: boolean) => {
    const glow = g.createRadialGradient(cx, cy, r * .15, cx, cy, r * 2.8);
    glow.addColorStop(0, 'rgba(250,244,228,.85)'); glow.addColorStop(.45, 'rgba(220,210,188,.32)'); glow.addColorStop(1, 'rgba(220,210,188,0)');
    g.fillStyle = glow; g.beginPath(); g.arc(cx, cy, r * 2.8, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(244,236,214,.35)'; g.lineWidth = 1.2;
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 1.1, cy + Math.sin(a) * r * 1.1); g.lineTo(cx + Math.cos(a) * r * 2.2, cy + Math.sin(a) * r * 2.2); g.stroke();
    }
    g.fillStyle = colour;
    g.beginPath();
    g.moveTo(cx, cy + r * 1.15);
    g.bezierCurveTo(cx - r * 1.35, cy + r * .35, cx - r * 1.15, cy - r * .85, cx, cy - r * .2);
    g.bezierCurveTo(cx + r * 1.15, cy - r * .85, cx + r * 1.35, cy + r * .35, cx, cy + r * 1.15);
    g.fill();
    g.fillStyle = '#f2e8cc';
    g.beginPath(); g.moveTo(cx, cy - r * 1.25); g.quadraticCurveTo(cx + r * .4, cy - r * .4, cx, cy - r * .2); g.quadraticCurveTo(cx - r * .4, cy - r * .4, cx, cy - r * 1.25); g.fill();
    if (withCross) {
      g.strokeStyle = '#efe7d2'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(cx, cy - r * 1.65); g.lineTo(cx, cy - r * .65); g.moveTo(cx - r * .42, cy - r * 1.25); g.lineTo(cx + r * .42, cy - r * 1.25); g.stroke();
    }
  };
  /** Softly shaded portrait head & neck in charcoal/sepia mezzotint or warm oil tones. */
  const shadedHead = (cx: number, cy: number, rx: number, ry: number, light: string, mid: string, shadow: string, beard: boolean) => {
    // Neck
    g.fillStyle = mid; g.fillRect(cx - rx * .46, cy + ry * .7, rx * .92, ry * .75);
    // Shaded face oval
    const fg = g.createRadialGradient(cx - rx * .18, cy - ry * .22, rx * .15, cx, cy, ry * 1.1);
    fg.addColorStop(0, light); fg.addColorStop(.68, mid); fg.addColorStop(1, shadow);
    g.fillStyle = fg; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
    // Soft brow, eyes and nose shadow (chiaroscuro rather than harsh dots)
    g.fillStyle = shadow; g.globalAlpha = .55;
    g.beginPath(); g.ellipse(cx - rx * .34, cy - ry * .08, rx * .2, ry * .08, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(cx + rx * .34, cy - ry * .08, rx * .2, ry * .08, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(cx - rx * .07, cy - ry * .06); g.lineTo(cx + rx * .07, cy - ry * .06); g.lineTo(cx + rx * .11, cy + ry * .26); g.lineTo(cx - rx * .11, cy + ry * .26); g.closePath(); g.fill();
    g.globalAlpha = 1;
    if (beard) {
      g.fillStyle = shadow;
      g.beginPath(); g.moveTo(cx - rx * .84, cy + ry * .22); g.quadraticCurveTo(cx - rx * .65, cy + ry * 1.12, cx, cy + ry * 1.18);
      g.quadraticCurveTo(cx + rx * .65, cy + ry * 1.12, cx + rx * .84, cy + ry * .22);
      g.quadraticCurveTo(cx + rx * .45, cy + ry * .62, cx, cy + ry * .56);
      g.quadraticCurveTo(cx - rx * .45, cy + ry * .62, cx - rx * .84, cy + ry * .22); g.fill();
    } else {
      g.strokeStyle = shadow; g.lineWidth = 1.6; g.beginPath(); g.moveTo(cx - rx * .22, cy + ry * .48); g.quadraticCurveTo(cx, cy + ry * .54, cx + rx * .22, cy + ry * .48); g.stroke();
    }
  };

  // Panel 0: Sacred Heart of Jesus (monochrome charcoal mezzotint vignette, antique gold frame)
  {
    const ox = 0, mx = ox + 36, my = 44, mw = pw - 72, mh = ph - 104, cx = ox + pw / 2;
    goldFrame(ox, false, true);
    g.save(); g.beginPath(); g.rect(mx, my, mw, mh); g.clip();
    const bg = g.createRadialGradient(cx, my + 148, 22, cx, my + 180, 175);
    bg.addColorStop(0, '#8e8d87'); bg.addColorStop(.45, '#4c4d4e'); bg.addColorStop(1, '#222426');
    g.fillStyle = bg; g.fillRect(mx, my, mw, mh);
    // Soft luminous halo behind head
    const halo = g.createRadialGradient(cx, my + 124, 16, cx, my + 124, 72);
    halo.addColorStop(0, 'rgba(238,236,228,.72)'); halo.addColorStop(.55, 'rgba(182,180,174,.25)'); halo.addColorStop(1, 'rgba(60,60,60,0)');
    g.fillStyle = halo; g.beginPath(); g.arc(cx, my + 124, 72, 0, Math.PI * 2); g.fill();
    // Curved draped shoulders & warm charcoal robe (distinct from Mary's veiled silhouette)
    const robeGrad = g.createLinearGradient(cx - 80, my + 190, cx + 80, my + mh);
    robeGrad.addColorStop(0, '#44413c'); robeGrad.addColorStop(.5, '#2e2c29'); robeGrad.addColorStop(1, '#1e1d1b');
    g.fillStyle = robeGrad;
    g.beginPath(); g.moveTo(cx - 98, my + mh); g.quadraticCurveTo(cx - 92, my + 206, cx - 36, my + 186);
    g.lineTo(cx + 36, my + 186); g.quadraticCurveTo(cx + 92, my + 206, cx + 98, my + mh); g.closePath(); g.fill();
    // Diagonal draped mantle fold across left shoulder & warm mid-grey tunic (no stark white wimple)
    const tunic = g.createLinearGradient(cx - 42, my + 196, cx + 42, my + mh);
    tunic.addColorStop(0, '#6a665e'); tunic.addColorStop(.5, '#8c877d'); tunic.addColorStop(1, '#58544d');
    g.fillStyle = tunic;
    g.beginPath(); g.moveTo(cx - 24, my + 188); g.lineTo(cx + 28, my + 188); g.quadraticCurveTo(cx + 42, my + 275, cx + 30, my + mh);
    g.lineTo(cx - 34, my + mh); g.quadraticCurveTo(cx - 42, my + 275, cx - 24, my + 188); g.fill();
    // Shoulder-length dark hair falling past ears (narrower crown so it reads as hair, not a veil)
    g.fillStyle = '#24211e';
    g.beginPath(); g.moveTo(cx - 28, my + 112); g.quadraticCurveTo(cx - 38, my + 162, cx - 35, my + 198);
    g.lineTo(cx + 35, my + 198); g.quadraticCurveTo(cx + 38, my + 162, cx + 28, my + 112);
    g.arc(cx, my + 112, 28, 0, Math.PI, true); g.fill();
    shadedHead(cx, my + 122, 23, 32, '#ddd8cc', '#afa99c', '#3c3832', true);
    // Fuller dark beard and moustache clearly distinguishing Christ's face
    g.fillStyle = '#2a2622';
    g.beginPath(); g.moveTo(cx - 19, my + 132); g.quadraticCurveTo(cx - 16, my + 160, cx, my + 164);
    g.quadraticCurveTo(cx + 16, my + 160, cx + 19, my + 132);
    g.quadraticCurveTo(cx + 10, my + 144, cx, my + 142); g.quadraticCurveTo(cx - 10, my + 144, cx - 19, my + 132); g.fill();
    // Raised right blessing hand & left hand gesturing toward the glowing Sacred Heart
    g.fillStyle = '#383531';
    g.beginPath(); g.moveTo(cx - 86, my + 318); g.quadraticCurveTo(cx - 60, my + 264, cx - 38, my + 252); g.lineTo(cx - 30, my + 286); g.lineTo(cx - 78, my + 354); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(cx + 88, my + 312); g.quadraticCurveTo(cx + 56, my + 282, cx + 24, my + 288); g.lineTo(cx + 32, my + 326); g.lineTo(cx + 84, my + 354); g.closePath(); g.fill();
    g.fillStyle = '#cfc9bc';
    g.beginPath(); g.ellipse(cx - 42, my + 236, 9, 15, -.15, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(cx + 26, my + 294, 14, 8, .35, 0, Math.PI * 2); g.fill();
    drawHeart(cx, my + 274, 15, '#c8beb0', true);
    g.restore();
    g.fillStyle = 'rgba(72,68,60,.45)'; g.fillRect(ox + 64, my + mh + 22, pw - 128, 2);
  }

  // Panel 1: Immaculate Heart of Mary (monochrome charcoal mezzotint vignette, antique gold frame)
  {
    const ox = pw, mx = ox + 36, my = 44, mw = pw - 72, mh = ph - 104, cx = ox + pw / 2;
    goldFrame(ox, false, true);
    g.save(); g.beginPath(); g.rect(mx, my, mw, mh); g.clip();
    const bg = g.createRadialGradient(cx, my + 146, 22, cx, my + 180, 175);
    bg.addColorStop(0, '#96989b'); bg.addColorStop(.45, '#525559'); bg.addColorStop(1, '#26292d');
    g.fillStyle = bg; g.fillRect(mx, my, mw, mh);
    const halo = g.createRadialGradient(cx, my + 124, 16, cx, my + 124, 70);
    halo.addColorStop(0, 'rgba(240,240,235,.72)'); halo.addColorStop(.55, 'rgba(182,184,186,.24)'); halo.addColorStop(1, 'rgba(60,64,68,0)');
    g.fillStyle = halo; g.beginPath(); g.arc(cx, my + 124, 70, 0, Math.PI * 2); g.fill();
    // Flowing dark veil & mantle curving gently down over shoulders
    const veil = g.createLinearGradient(cx - 75, my + 100, cx + 75, my + mh);
    veil.addColorStop(0, '#343a40'); veil.addColorStop(.5, '#24292e'); veil.addColorStop(1, '#1c2024');
    g.fillStyle = veil;
    g.beginPath(); g.arc(cx, my + 122, 42, Math.PI, 0); g.quadraticCurveTo(cx + 62, my + 206, cx + 92, my + mh);
    g.lineTo(cx - 92, my + mh); g.quadraticCurveTo(cx - 62, my + 206, cx - 42, my + 122); g.fill();
    // Pale wimple border around face & softly folded inner gown
    g.fillStyle = '#cfcdc5';
    g.beginPath(); g.ellipse(cx, my + 128, 28, 37, 0, 0, Math.PI * 2); g.fill();
    const gown = g.createLinearGradient(cx - 38, my + 200, cx + 38, my + mh);
    gown.addColorStop(0, '#a8a8a3'); gown.addColorStop(.5, '#d2d0c8'); gown.addColorStop(1, '#989894');
    g.fillStyle = gown;
    g.beginPath(); g.moveTo(cx - 24, my + 190); g.lineTo(cx + 24, my + 190); g.quadraticCurveTo(cx + 48, my + 290, cx + 44, my + mh);
    g.lineTo(cx - 44, my + mh); g.quadraticCurveTo(cx - 48, my + 290, cx - 24, my + 190); g.fill();
    shadedHead(cx, my + 126, 21, 29, '#dedbd2', '#b4b1a9', '#5a5854', false);
    // Graceful sleeves & hands framing the Immaculate Heart
    g.fillStyle = '#2d3339';
    g.beginPath(); g.moveTo(cx - 82, my + 318); g.quadraticCurveTo(cx - 50, my + 286, cx - 22, my + 294); g.lineTo(cx - 28, my + 330); g.lineTo(cx - 78, my + 356); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(cx + 82, my + 318); g.quadraticCurveTo(cx + 50, my + 286, cx + 22, my + 294); g.lineTo(cx + 28, my + 330); g.lineTo(cx + 78, my + 356); g.closePath(); g.fill();
    g.fillStyle = '#ccc8be';
    g.beginPath(); g.ellipse(cx - 24, my + 298, 12, 7.5, -.3, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(cx + 24, my + 298, 12, 7.5, .3, 0, Math.PI * 2); g.fill();
    drawHeart(cx, my + 280, 14, '#706d67', false);
    g.restore();
    g.fillStyle = 'rgba(72,68,60,.45)'; g.fillRect(ox + 64, my + mh + 22, pw - 128, 2);
  }

  // Panel 2: Sacred Heart of Jesus painting (lower right: warm sepia/ochre/crimson oil style, dark bronze-gold frame)
  {
    const ox = pw * 2, mx = ox + 20, my = 20, mw = pw - 40, mh = ph - 40, cx = ox + pw / 2;
    goldFrame(ox, true, false);
    g.save(); g.beginPath(); g.rect(mx, my, mw, mh); g.clip();
    const bg = g.createRadialGradient(cx, my + 165, 22, cx, my + 220, 210);
    bg.addColorStop(0, '#8a7254'); bg.addColorStop(.5, '#4b3b2b'); bg.addColorStop(1, '#251c14');
    g.fillStyle = bg; g.fillRect(mx, my, mw, mh);
    const halo = g.createRadialGradient(cx, my + 120, 10, cx, my + 120, 62);
    halo.addColorStop(0, 'rgba(248,228,172,.78)'); halo.addColorStop(.55, 'rgba(196,158,92,.26)'); halo.addColorStop(1, 'rgba(70,55,40,0)');
    g.fillStyle = halo; g.beginPath(); g.arc(cx, my + 120, 62, 0, Math.PI * 2); g.fill();
    // Flowing pale golden-ivory robe with soft shaded folds
    const tunic = g.createLinearGradient(cx - 60, my + 180, cx + 60, my + mh);
    tunic.addColorStop(0, '#a89470'); tunic.addColorStop(.48, '#d9c8a4'); tunic.addColorStop(1, '#907c5c');
    g.fillStyle = tunic;
    g.beginPath(); g.moveTo(cx - 38, my + 180); g.quadraticCurveTo(cx - 66, my + 220, cx - 76, my + mh);
    g.lineTo(cx + 76, my + mh); g.quadraticCurveTo(cx + 66, my + 220, cx + 38, my + 180); g.closePath(); g.fill();
    // Rich crimson cloak draped diagonally with soft fold shading
    const cloak = g.createLinearGradient(cx - 65, my + 190, cx + 65, my + mh);
    cloak.addColorStop(0, '#782b2c'); cloak.addColorStop(.55, '#581d20'); cloak.addColorStop(1, '#3b1215');
    g.fillStyle = cloak;
    g.beginPath(); g.moveTo(cx - 42, my + 184); g.quadraticCurveTo(cx - 4, my + 220, cx + 66, my + 314);
    g.lineTo(cx + 76, my + mh); g.lineTo(cx - 72, my + mh); g.quadraticCurveTo(cx - 70, my + 250, cx - 42, my + 184); g.fill();
    // Hair & softly shaded head
    g.fillStyle = '#3a2417';
    g.beginPath(); g.moveTo(cx - 28, my + 110); g.quadraticCurveTo(cx - 40, my + 162, cx - 36, my + 190);
    g.lineTo(cx + 36, my + 190); g.quadraticCurveTo(cx + 40, my + 162, cx + 28, my + 110);
    g.arc(cx, my + 110, 28, 0, Math.PI, true); g.fill();
    shadedHead(cx, my + 118, 21, 29, '#deb996', '#b88f6c', '#563926', true);
    // Shaded hands & glowing crimson-gold Sacred Heart
    g.fillStyle = '#cfa783';
    g.beginPath(); g.ellipse(cx - 22, my + 256, 12, 7.5, -.35, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(cx + 26, my + 264, 12, 7.5, .3, 0, Math.PI * 2); g.fill();
    drawHeart(cx, my + 242, 14, '#9d2d2a', true);
    g.restore();
  }

  // Panel 3: Oval clerical portrait (right chancel wall: thin black frame, cream mat, sepia oval portrait)
  {
    const ox = pw * 3, cx = ox + pw / 2, cy = ph * .47;
    g.fillStyle = '#1f2123'; g.fillRect(ox, 0, pw, ph);
    g.fillStyle = '#e7e3d8'; g.fillRect(ox + 14, 16, pw - 28, ph - 32);
    g.save();
    g.beginPath(); g.ellipse(cx, cy, 84, 148, 0, 0, Math.PI * 2); g.clip();
    const bg = g.createRadialGradient(cx, cy - 16, 18, cx, cy, 150);
    bg.addColorStop(0, '#6e6a62'); bg.addColorStop(.65, '#46433e'); bg.addColorStop(1, '#2b2926');
    g.fillStyle = bg; g.fillRect(ox + 20, 40, pw - 40, ph - 80);
    // Period parish priest: softly curved black cassock shoulders, white Roman collar, shaded sepia portrait head
    g.fillStyle = '#222120';
    g.beginPath(); g.moveTo(cx - 82, cy + 150); g.quadraticCurveTo(cx - 72, cy + 62, cx - 26, cy + 48);
    g.lineTo(cx + 26, cy + 48); g.quadraticCurveTo(cx + 72, cy + 62, cx + 82, cy + 150); g.closePath(); g.fill();
    g.fillStyle = '#e5e2d9'; g.fillRect(cx - 18, cy + 44, 36, 14);
    g.fillStyle = '#252423'; g.fillRect(cx - 18, cy + 47, 13, 11); g.fillRect(cx + 5, cy + 47, 13, 11);
    shadedHead(cx, cy - 8, 29, 40, '#cec7ba', '#a49d91', '#5a554e', false);
    g.fillStyle = '#48443e';
    g.beginPath(); g.arc(cx, cy - 22, 30, Math.PI * 1.05, Math.PI * 1.95); g.fill();
    g.restore();
    g.strokeStyle = 'rgba(70,66,60,.45)'; g.lineWidth = 2;
    g.beginPath(); g.ellipse(cx, cy, 84, 148, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(72,68,60,.45)'; g.fillRect(cx - 40, cy + 174, 80, 3);
  }
  return c;
}

/** A white Gothic altar front: pointed ogee-lancet panels outlined in gold, gold trefoils below, and IHS on the 7-arch main altar. */
function altarTexture(arches: number): HTMLCanvasElement {
  const w = arches === 7 ? 768 : 512, h = 280, [c, g] = canvas(w, h), r = random(arches);
  g.fillStyle = '#efefe9'; g.fillRect(0, 0, w, h);
  blotches(g, r, 512, 45, a => `rgba(120,116,104,${a})`, 30, 6, .09);
  const gold = '#b38e42';
  g.strokeStyle = gold; g.lineWidth = 5; g.strokeRect(20, 18, w - 40, h - 42);
  g.strokeStyle = 'rgba(90,86,76,.32)'; g.lineWidth = 2; g.strokeRect(27, 25, w - 54, h - 56);
  const pad = arches === 7 ? 42 : 48, span = (w - pad * 2) / arches, aw = Math.min(span * .68, arches === 7 ? 68 : 96);
  for (let i = 0; i < arches; i++) {
    const x = pad + span * (i + .5), base = h - 68, shoulder = 126, neck = 92, top = 50;
    const ogee = () => {
      g.beginPath();
      g.moveTo(x - aw / 2, base);
      g.lineTo(x - aw / 2, shoulder);
      g.quadraticCurveTo(x - aw / 2, neck + 6, x - aw * .28, neck);
      g.quadraticCurveTo(x - aw * .24, top + 16, x, top);
      g.quadraticCurveTo(x + aw * .24, top + 16, x + aw * .28, neck);
      g.quadraticCurveTo(x + aw / 2, neck + 6, x + aw / 2, shoulder);
      g.lineTo(x + aw / 2, base);
      g.closePath();
    };
    ogee(); g.fillStyle = '#e5e5df'; g.fill();
    g.save(); ogee(); g.clip();
    g.fillStyle = 'rgba(70,70,66,.18)'; g.fillRect(x - aw / 2, top, 6, base - top); g.fillRect(x - aw / 2, top, aw, 8);
    g.restore();
    ogee(); g.strokeStyle = gold; g.lineWidth = 3; g.stroke();
    // Gold IHS Christogram in the centre arch of the seven-arch main altar
    if (arches === 7 && i === 3) {
      g.fillStyle = gold; g.font = 'bold 26px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('IHS', x, (shoulder + base) / 2 + 4);
      g.fillRect(x - 1.5, (shoulder + base) / 2 - 26, 3, 14);
      g.fillRect(x - 6, (shoulder + base) / 2 - 22, 12, 2.5);
    }
  }
  // Row of small gold Gothic trefoils along the lower rail
  g.fillStyle = gold;
  const marks = arches === 7 ? 13 : 5;
  for (let i = 0; i < marks; i++) {
    const x = pad + (w - pad * 2) * (i + .5) / marks, y = h - 38;
    g.fillRect(x - 2, y - 10, 4, 16);
    g.beginPath(); g.arc(x, y - 12, 3.8, 0, Math.PI * 2); g.arc(x - 5, y - 4, 3.2, 0, Math.PI * 2); g.arc(x + 5, y - 4, 3.2, 0, Math.PI * 2); g.fill();
  }
  return c;
}

/** Packed texture for the white wooden lectern: top half holds the five-cross book-rest frieze, bottom half the vertical Gaelic post lettering. */
function lecternTexture(): HTMLCanvasElement {
  const w = 256, h = 256, [c, g] = canvas(w, h);
  g.fillStyle = '#eeeee8'; g.fillRect(0, 0, w, h);
  // Top half (v = 0.5..1.0): slanted book-rest front frieze with five gold crosses
  g.strokeStyle = 'rgba(130,130,124,.35)'; g.lineWidth = 3; g.strokeRect(4, 10, w - 8, 108);
  g.fillStyle = '#b38e42';
  for (let i = 0; i < 5; i++) {
    const x = 28 + i * 50, y = 64;
    g.fillRect(x - 3, y - 24, 6, 48);
    g.fillRect(x - 14, y - 10, 28, 6);
  }
  // Bottom half (v = 0.0..0.5): left band holds vertical antique-gold "FHACAL DHE" ("Word of God")
  const letters = ['F', 'H', 'A', 'C', 'A', 'L', ' ', 'D', 'H', 'E'];
  g.fillStyle = '#6c5222'; g.font = 'bold 12px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  letters.forEach((ch, i) => { if (ch !== ' ') g.fillText(ch, 64, 136 + i * 11.8); });
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

export interface TableVertexRange { mesh: THREE.Mesh; start: number; count: number }
export interface ChurchRoomParts { groups: Record<Zone, THREE.Group>; letter: THREE.Object3D; tableRanges: TableVertexRange[]; triangles: number; drawCalls: number }

/** The vestry chest of drawers along the right wall: its start from the far wall, and its length. The letter lies on it. */
const CHEST = { from: .85, long: 1.1 };
const DRAWN = new Map<string, HTMLCanvasElement>();

export class ChurchRoomArt {
  private readonly batches = new Map<string, Batch>();
  private readonly tableMarks: { key: string; start: number; count: number }[] = [];
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
        boards: boardsTexture, bare: bareTexture, peel: peelTexture, window: windowTexture, sash: sashTexture,
        stations: stationsAtlasTexture, devotions: devotionsAtlasTexture,
        altar7: () => altarTexture(7), altar3: () => altarTexture(3), lectern: lecternTexture, map: mapTexture,
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
  /** A short round disc with its axis along x, y or z: scrolled pew ends, vase and round stand top. */
  private disc(colour: number, cx: number, cy: number, cz: number, radius: number, thick: number, axis: Axis, sides = 10): void {
    const at = (i: number, side: number): V3 => {
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
  /** One picture (or atlas sub-rectangle `uv`) on a face: a is lower left seen from front, u runs right and v runs up. */
  private sheet(name: Sheet, a: V3, u: V3, v: V3, lit = true, uv: UVRect = [0, 0, 1, 1]): void {
    const batch = this.batch(`sheet|${name}`, () => lit ? new THREE.MeshLambertMaterial({ map: this.map(name), vertexColors: true })
      : new THREE.MeshBasicMaterial({ map: this.map(name), vertexColors: true, alphaTest: .5 }));
    const corner = (s: number, t: number): V3 => this.moved([a[0] + u[0] * s + v[0] * t, a[1] + u[1] * s + v[1] * t, a[2] + u[2] * s + v[2] * t]);
    const [u0, v0, u1, v1] = uv;
    const A = corner(0, 0), B = corner(1, 0), C = corner(1, 1), D = corner(0, 1), n = unit(cross(sub(B, A), sub(D, A)));
    for (const [p, s, t] of [[A, u0, v0], [B, u1, v0], [C, u1, v1], [A, u0, v0], [C, u1, v1], [D, u0, v1]] as [V3, number, number][]) {
      batch.position.push(p[0], p[1], p[2]); batch.normal.push(n[0], n[1], n[2]); batch.uv.push(s, t); batch.color.push(1, 1, 1);
    }
  }
  /** A small standing devotional statue (plinth, robe, mantle, hands, optional Sacred Heart emblem, head), facing +x. */
  private statue(x: number, y: number, z: number, height: number, robe: number, mantle: number, opts: { veil?: boolean; beard?: boolean; goldBelt?: boolean; heart?: boolean } = {}): void {
    const s = height / .66, plinth = .05 * s;
    this.disc(PAINT.grey, x, y + plinth / 2, z, .085 * s, plinth, 'y', 8);
    // Lower skirt & upper torso
    this.box('plain', robe, x - .06 * s, y + plinth, z - .07 * s, x + .06 * s, y + .34 * s, z + .07 * s);
    this.box('plain', robe, x - .05 * s, y + .34 * s, z - .065 * s, x + .05 * s, y + .52 * s, z + .065 * s);
    // Draped mantle over shoulders & side
    this.box('plain', mantle, x - .065 * s, y + .11 * s, z - .078 * s, x + .065 * s, y + .48 * s, z - .005 * s);
    this.box('plain', mantle, x - .065 * s, y + .38 * s, z - .08 * s, x + .04 * s, y + .53 * s, z + .08 * s);
    if (opts.goldBelt) this.box('plain', PAINT.gold, x - .058 * s, y + .34 * s, z - .072 * s, x + .058 * s, y + .365 * s, z + .072 * s);
    // Forearms & hands in front of chest, plus visible Sacred Heart emblem when requested
    this.box('plain', PAINT.skin, x + .04 * s, y + .39 * s, z - .032 * s, x + .078 * s, y + .44 * s, z + .032 * s);
    if (opts.heart) {
      this.box('plain', PAINT.gold, x + .052 * s, y + .43 * s, z - .022 * s, x + .068 * s, y + .485 * s, z + .022 * s);
      this.box('plain', PAINT.red, x + .064 * s, y + .438 * s, z - .015 * s, x + .076 * s, y + .472 * s, z + .015 * s);
    }
    // Head, hair or veil (rounded vertical cylinder so statues read smoothly close up)
    this.disc(PAINT.skin, x, y + .585 * s, z, .038 * s, .085 * s, 'y', 8);
    if (opts.veil) {
      this.box('plain', mantle, x - .046 * s, y + .52 * s, z - .044 * s, x + .016 * s, y + .64 * s, z + .044 * s);
    } else {
      this.disc(PAINT.hair, x - .01 * s, y + .595 * s, z, .042 * s, .085 * s, 'y', 8);
      if (opts.beard) this.box('plain', PAINT.hair, x + .012 * s, y + .535 * s, z - .024 * s, x + .040 * s, y + .565 * s, z + .024 * s);
    }
  }

  build(room: ChurchRoom): ChurchRoomParts {
    this.zone = 'nave'; this.shell(room); this.gallery(room); this.pews(room); this.altarEnd(room); this.wallPictures(room);
    this.zone = 'vestry'; this.vestry(room);
    const groups: Record<Zone, THREE.Group> = { nave: new THREE.Group(), vestry: new THREE.Group(), loft: new THREE.Group() };
    const meshes = new Map<string, THREE.Mesh>();
    let triangles = 0, drawCalls = 0;
    for (const [key, batch] of this.batches) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.position, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normal, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uv, 2));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(batch.color, 3));
      this.resources.push(geometry); triangles += batch.position.length / 9; drawCalls++;
      const mesh = new THREE.Mesh(geometry, batch.material); mesh.castShadow = mesh.receiveShadow = false; mesh.matrixAutoUpdate = false;
      groups[batch.zone].add(mesh); meshes.set(key, mesh);
    }
    const tableRanges = this.tableMarks.map(m => ({ mesh: meshes.get(m.key)!, start: m.start, count: m.count }));
    this.batches.clear(); this.tableMarks.length = 0;
    // The letter is its own small mesh, so the visit can show it only once it has been left.
    const v = room.shell.vestry, paper = new THREE.BoxGeometry(.24, .008, .12), ink = new THREE.MeshLambertMaterial({ color: PAINT.paper });
    this.resources.push(paper, ink);
    const letter = new THREE.Mesh(paper, ink); letter.position.set(v.x0 + CHEST.from + CHEST.long / 2, 1.014, v.z0 + .3); letter.rotation.y = .3; letter.visible = false;
    groups.vestry.add(letter);
    return { groups, letter, tableRanges, triangles: triangles + 12, drawCalls: drawCalls + 1 };
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
    const h = porch.ceiling, d0 = porch.z0, d1 = porch.z1;
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

  /** The gallery on three sides: slab, vertical-board parapet, cap rail, square posts, L-shaped stair, and measured benches/pews. */
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

    // Measured gallery benches and pews: three rough bare-wood plank benches on each side gallery,
    // two rows of backed dark-wood pews across the back gallery centre, and a pew plus three benches in the -z back corner.
    this.zone = 'loft';
    const plankBench = (x0: number, z0: number, x1: number, z1: number, kneeler = false) => {
      const long = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      this.box('bare', PAINT.bench, x0, top + .41, z0, x1, top + .45, z1, long ? 'x' : 'z');
      for (const k of [.08, .5, .92]) {
        const bx = x0 + (x1 - x0) * (long ? k : .5), bz = z0 + (z1 - z0) * (long ? .5 : k);
        this.box('bare', PAINT.bench, bx - (long ? .025 : .12), top, bz - (long ? .12 : .025), bx + (long ? .025 : .12), top + .41, bz + (long ? .12 : .025), 'y', .9);
      }
      if (kneeler && long) {
        const kz = (z0 + z1) / 2 + (z0 > 0 ? -.22 : .22);
        this.box('bare', PAINT.bench, x0 + .08, top + .09, kz - .05, x1 - .08, top + .12, kz + .05, 'x', .85);
        for (const k of [.12, .5, .88]) {
          const kx = x0 + (x1 - x0) * k;
          this.box('bare', PAINT.bench, kx - .02, top, kz - .045, kx + .02, top + .09, kz + .045, 'y', .82);
        }
      }
    };
    for (const side of [-1, 1] as const) {
      const wall = side < 0 ? N.z0 : N.z1;
      for (const [idx, off] of [0.30, 0.94, 1.56].entries()) {
        plankBench(tip + .18, wall - side * off, edge + .08, wall - side * (off + .28), idx < 2);
      }
    }
    // Dark-wood backed pews on the back gallery (facing the altar -x; clear of the gallery walk rail at dx = 9.38)
    const galleryPew = (xb: number, za: number, zb: number, hymnals = false) => {
      this.box('bead', PAINT.wood, xb - .02, top + .08, za, xb + .02, top + .86, zb, 'y', .85);
      this.box('plain', PAINT.galleryPew, xb - .035, top + .86, za, xb + .035, top + .90, zb);
      this.box('bare', PAINT.bench, xb - .38, top + .41, za, xb - .02, top + .45, zb, 'z', .9);
      for (const z of [za, zb]) {
        this.box('plain', PAINT.galleryPew, xb - .40, top, z - .025, xb + .04, top + .60, z + .025);
        this.box('plain', PAINT.galleryPew, xb - .16, top + .60, z - .025, xb + .04, top + .90, z + .025);
      }
      if (hymnals) {
        for (const k of [.2, .52, .8]) {
          const hz = za + (zb - za) * k;
          this.box('plain', PAINT.hymn, xb - .28, top + .45, hz - .07, xb - .12, top + .485, hz + .07);
        }
      }
    };
    galleryPew(N.x0 + 10.16, c - 1.05, well - .15, true);
    galleryPew(N.x0 + 11.02, c - 1.05, well - .15, true);
    galleryPew(N.x0 + 10.16, c - 2.95, c - 1.52, false);
    for (const dx of [10.48, 11.02, 11.50]) plankBench(N.x0 + dx, c - 2.95, N.x0 + dx - .26, c - 1.48);
    this.zone = 'nave';
  }

  /** Two blocks of pews on each side of the aisle: vertical-board backs, a seat, and white scrolled ends. */
  private pews(room: ChurchRoom): void {
    const N = room.shell.nave, f = room.fit, p = f.pews, c = N.ridgeZ;
    for (const side of [-1, 1] as const) {
      const aisle = c + side * f.aisle / 2, wall = (side < 0 ? N.z0 : N.z1) - side * .04;
      for (let i = 0; i < p.rows; i++) {
        // On the +z side the stair takes the first row, and the three-seat red bench stands where the front row would be.
        if (side > 0 && (i === 0 || i === p.rows - 1)) continue;
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

  /** The east end: chancel step, altar platform, main altar, gradines, tabernacle, spires, front arched table,
   * devotional prints and statues, rebuilt confessional, lectern, armchair, red table, cushioned bench and seating. */
  private altarEnd(room: ChurchRoom): void {
    const N = room.shell.nave, f = room.fit, a = f.altar, c = N.ridgeZ, w = N.x0, ch = f.chancel, pf = f.platform, rise = pf.rise, fl = ch.rise;
    this.box('boards', PAINT.floor, w, 0, N.z0, w + ch.depth, ch.rise, N.z1, 'x');
    this.box('boards', PAINT.platform, w, ch.rise, c - pf.width / 2, w + pf.depth, rise, c + pf.width / 2, 'x');

    // The long main altar on the platform, with seven pointed Gothic arches and IHS across its front.
    const ax = w + a.back, at = rise + a.height;
    this.box('plain', PAINT.white, ax, rise, c - a.width / 2, ax + a.depth, at, c + a.width / 2);
    this.box('plain', PAINT.white, ax - .02, at, c - a.width / 2 - .04, ax + a.depth + .04, at + .04, c + a.width / 2 + .04);
    this.sheet('altar7', [ax + a.depth + .006, rise + .04, c + a.width / 2 - .06], [0, 0, -(a.width - .12)], [0, a.height - .08, 0]);

    // Two measured gradines behind the mensa.
    const [gr1, gr2] = a.gradines, g1 = at + gr1.rise, g2 = g1 + gr2.rise;
    this.box('plain', PAINT.white, w, rise, c - a.width / 2 + gr1.inset, w + gr1.depth, g1, c + a.width / 2 - gr1.inset);
    this.box('plain', PAINT.white, w, g1, c - a.width / 2 + gr2.inset, w + gr2.depth, g2, c + a.width / 2 - gr2.inset);

    // The Gothic tabernacle in the centre: pointed-arch doorway, doorknob, scalloped top crest, gold corner pinnacles and side finials.
    const tb = a.tabernacle, tx0 = w + .24, tx1 = tx0 + tb.depth, ty0 = at, ty1 = ty0 + tb.height;
    this.box('plain', PAINT.white, tx0, ty0, c - tb.width / 2, tx1, ty1, c + tb.width / 2);
    // Pointed Gothic arch door on the tabernacle front with small dark keyhole/knob
    this.box('plain', PAINT.white, tx1, ty0 + .02, c - .13, tx1 + .012, ty0 + .30, c + .13, 'y', .92);
    this.face('plain', PAINT.white, [tx1 + .012, ty0 + .30, c + .13], [tx1 + .012, ty0 + .30, c - .13], [tx1 + .012, ty0 + .46, c], [tx1 + .012, ty0 + .46, c], 'z', .92);
    this.box('plain', PAINT.dark, tx1 + .012, ty0 + .16, c + .08, tx1 + .028, ty0 + .19, c + .105);
    // Subtle scalloped cresting across the top of the tabernacle front
    for (let k = -2; k <= 2; k++) this.box('plain', PAINT.white, tx1 - .015, ty1 - .07, c + k * .065 - .016, tx1 + .01, ty1 - .03, c + k * .065 + .016, 'y', .88);
    // Flanking gold-trimmed corner pinnacles and four small battlements along each side
    for (const side of [-1, 1]) {
      const pz = c + side * (tb.width / 2 - .02);
      this.box('plain', PAINT.white, tx1 - .04, ty1, pz - .022, tx1 + .005, ty1 + tb.pinnacle * .65, pz + .022);
      this.box('plain', PAINT.gold, tx1 - .032, ty1 + tb.pinnacle * .65, pz - .014, tx1 - .002, ty1 + tb.pinnacle, pz + .014);
      for (let k = 0; k < 4; k++) {
        const bx = tx0 + .05 + k * .085;
        this.box('plain', PAINT.gold, bx - .01, ty1, pz - .012, bx + .01, ty1 + .09, pz + .012);
      }
    }

    // Cobalt-blue glass vase on the left end of gradine 2 (+z side)
    const vz = c + 1.04, vx = w + .34;
    this.disc(PAINT.cobalt, vx, g2 + .03, vz, .05, .06, 'y', 8);
    this.disc(PAINT.cobalt, vx, g2 + .14, vz, .078, .15, 'y', 8);
    this.disc(PAINT.cobalt, vx, g2 + .245, vz, .045, .07, 'y', 8);
    this.disc(PAINT.cobalt, vx, g2 + .29, vz, .055, .025, 'y', 8);

    // Standing Sacred Heart of Jesus statue on the right side of gradine 2 (-z side)
    this.statue(w + .36, g2, c - .66, .68, PAINT.robe, PAINT.crimson, { beard: true, goldBelt: true, heart: true });

    // Five tall scalloped Gothic spires behind gradine 2, edged in gold and each topped with a gold Latin cross.
    a.spires.forEach((tall, i) => {
      const z = c + (i - 2) * a.spacing, footHalf = a.spireWidths[i] / 2, base = g2;
      // Smooth triangular white core with gold inner edge trim and discrete scalloped crocket notches along both edges
      this.face('plain', PAINT.white, [w + .046, base, z + footHalf], [w + .046, base, z - footHalf], [w + .046, base + tall, z], [w + .046, base + tall, z], 'z');
      const crockets = Math.max(8, Math.round(tall / .16)), step = tall / crockets;
      for (let k = 0; k < crockets; k++) {
        const y0 = base + k * step, ym = y0 + step * .5, frac = k / crockets;
        const edge = footHalf * (1 - frac * .94);
        for (const side of [-1, 1]) {
          const cz = z + side * edge;
          this.box('plain', PAINT.gold, w + .014, y0, cz - .012, w + .034, y0 + step * .92, cz + .012);
          this.box('plain', PAINT.white, w + .018, ym - step * .24, cz + side * .004, w + .042, ym + step * .24, cz + side * .034);
        }
      }
      const chCross = i === 2 ? .17 : .145;
      this.box('plain', PAINT.gold, w + .02, base + tall, z - .01, w + .04, base + tall + chCross, z + .01);
      this.box('plain', PAINT.gold, w + .02, base + tall + chCross * .56, z - chCross * .34, w + .04, base + tall + chCross * .70, z + chCross * .34);
    });

    // The front arched altar table: stands on the chancel floor right in front of the platform step,
    // with three gold-outlined pointed arches on the nave face and two cabinet doors on the altar side.
    // All trim (base plinth and overhanging top) stays inside t.fromWall .. t.fromWall + t.depth and fl .. fl + t.height.
    const tableBefore = new Map([...this.batches.entries()].map(([k, b]) => [k, b.position.length / 3]));
    const t = a.table, tbx = w + t.fromWall, bodyX0 = tbx + .02, bodyX1 = tbx + t.depth - .04, bodyW = t.width - .08, topY = fl + t.height - .04;
    this.box('plain', PAINT.white, bodyX0, fl, c - bodyW / 2, bodyX1, topY, c + bodyW / 2);
    this.box('plain', PAINT.white, tbx, topY, c - t.width / 2, tbx + t.depth, fl + t.height, c + t.width / 2);
    this.box('plain', PAINT.white, tbx + .01, fl, c - bodyW / 2 - .025, tbx + t.depth - .015, fl + .10, c + bodyW / 2 + .025);
    this.sheet('altar3', [bodyX1 + .006, fl + .10, c + bodyW / 2 - .03], [0, 0, -(bodyW - .06)], [0, topY - fl - .12, 0]);
    for (const side of [-1, 1]) {
      const cz = c + side * (bodyW * .23);
      this.box('plain', PAINT.white, bodyX0 - .01, fl + .14, cz - bodyW * .20, bodyX0, topY - .06, cz + bodyW * .20, 'y', .92);
    }
    for (const [key, b] of this.batches) {
      const start = tableBefore.get(key) ?? 0, count = b.position.length / 3 - start;
      if (count > 0) this.tableMarks.push({ key, start, count });
    }

    // Devotional framed pictures on the altar wall and right chancel wall (one atlas draw call):
    // 0: Sacred Heart of Jesus (above vestry door, z=+1.95, y=2.45..3.20, 0.60x0.75)
    // 1: Immaculate Heart of Mary (right of spires upper, z=-2.12, y=2.40..3.15, 0.60x0.75)
    // 2: Sacred Heart of Jesus painting (right of spires lower, z=-2.16, y=1.38..2.22, 0.72x0.84)
    const hangAltar = (z: number, y0: number, pw: number, ph: number, panel: number) => {
      const u0 = panel * .25 + .002, u1 = (panel + 1) * .25 - .002;
      this.box('plain', PAINT.frame, w, y0, z - pw / 2, w + .026, y0 + ph, z + pw / 2);
      this.sheet('devotions', [w + .028, y0, z + pw / 2], [0, 0, -pw], [0, ph, 0], true, [u0, .002, u1, .998]);
    };
    hangAltar(c + 1.95, 2.45, .60, .75, 0);
    hangAltar(c - 2.12, 2.40, .60, .75, 1);
    hangAltar(c - 2.16, 1.38, .72, .84, 2);
    // 3: Oval clerical portrait on the right (-z) chancel wall (dx=1.01, y=2.18..2.84, 0.46x0.66)
    {
      const px = w + 1.01, py0 = 2.18, pw = .46, ph = .66;
      this.box('plain', PAINT.dark, px - pw / 2, py0, N.z0, px + pw / 2, py0 + ph, N.z0 + .022);
      this.sheet('devotions', [px - pw / 2, py0, N.z0 + .025], [pw, 0, 0], [0, ph, 0], true, [.752, .002, .998, .998]);
    }

    // The vestry doorway on the left (+z), trimmed in pale blue.
    const d = f.vestryDoor, back = room.shell.vestry.x1;
    for (const side of [-1, 1]) this.box('plain', PAINT.post, back, 0, d.z + side * d.width / 2, w + .03, d.height + .1, d.z + side * (d.width / 2 + .1));
    this.box('plain', PAINT.post, back, d.height, d.z - d.width / 2 - .1, w + .03, d.height + .1, d.z + d.width / 2 + .1);
    this.box('bare', 0xffffff, back, -.02, d.z - d.width / 2, w, .002, d.z + d.width / 2, 'x', .8);

    // Built-in wooden confessional in the +z chancel corner (replaces the old estimated cupboard):
    // 1.90 m along the +z wall from the altar wall, 1.23 m deep from the +z wall, 2.28 m high above the chancel step.
    // Two white four-panel doors face -z (toward the altar and vestry doorway), both hinged at the centre mullion, opening outward.
    const cf = f.confessional, cx0 = w, cx1 = w + cf.length, cz0 = N.z1 - cf.depth, cz1 = N.z1, cTop = fl + cf.height;
    // Pale-blue vertical-boarded enclosure (solid +x end wall facing the pews, flat roof, and molded top cornice)
    this.box('bead', PAINT.side, cx0, fl, cz0, cx1, cTop - .10, cz1, 'y');
    this.box('boards', PAINT.green, cx0, cTop - .10, cz0, cx1, cTop, cz1, 'x', .85);
    this.box('plain', PAINT.post, cx0, cTop - .11, cz0 - .045, cx1 + .045, cTop, cz1);
    // Low white pediment and upright white Latin cross centred on top of the confessional facing -z
    const midX = (cx0 + cx1) / 2;
    this.box('plain', PAINT.white, midX - .27, cTop, cz0 + .01, midX + .27, cTop + .04, cz0 + .06);
    this.box('plain', PAINT.white, midX - .14, cTop + .04, cz0 + .01, midX + .14, cTop + .065, cz0 + .06);
    this.box('plain', PAINT.white, midX - .018, cTop + .065, cz0 + .018, midX + .018, cTop + .065 + cf.crossHeight, cz0 + .052);
    this.box('plain', PAINT.white, midX - .11, cTop + .065 + cf.crossHeight * .62, cz0 + .018, midX + .11, cTop + .065 + cf.crossHeight * .73, cz0 + .052);
    // Two white four-panel doors on the -z face, framed by pale-blue outer jambs, centre mullion and header
    const mullion = .11, dW = cf.doorWidth, dH = cf.doorHeight, dStart = midX - mullion / 2 - dW;
    const doors = [
      { x0: dStart, x1: dStart + dW, knobX: dStart + .07, hingeX: dStart + dW - .01 },                   // altar-side door: knob on -x (vestry side), hinged at centre
      { x0: midX + mullion / 2, x1: midX + mullion / 2 + dW, knobX: midX + mullion / 2 + dW - .07, hingeX: midX + mullion / 2 + .01 }, // pew-side door: knob on +x, hinged at centre
    ];
    for (const dr of doors) {
      // Door slab recessed slightly behind the pale-blue frame
      this.box('plain', PAINT.white, dr.x0, fl + .01, cz0 - .022, dr.x1, fl + dH, cz0 + .004);
      // Four recessed wooden panels (two tall upper, two lower)
      const pw = (dW - .22) / 2;
      for (const px of [dr.x0 + .08, dr.x1 - .08 - pw]) {
        this.box('plain', PAINT.white, px, fl + .16, cz0 - .027, px + pw, fl + .82, cz0 - .022, 'y', .90);
        this.box('plain', PAINT.white, px, fl + .96, cz0 - .027, px + pw, fl + dH - .14, cz0 - .022, 'y', .90);
      }
      // White escutcheon plate and dark round doorknob on the outer edge
      this.box('plain', PAINT.white, dr.knobX - .025, fl + .82, cz0 - .030, dr.knobX + .025, fl + .98, cz0 - .022);
      this.disc(PAINT.dark, dr.knobX, fl + .91, cz0 - .046, .026, .026, 'z', 8);
      // Exposed butt hinges on the centre-mullion edge showing outward -z swing
      for (const hy of [fl + .26, fl + 1.05, fl + 1.76]) {
        this.box('plain', PAINT.metal, dr.hingeX - .012, hy - .04, cz0 - .030, dr.hingeX + .012, hy + .04, cz0 - .012);
      }
    }
    // Pale-blue door casing around both doors on the -z face
    this.box('plain', PAINT.post, cx0, fl, cz0 - .032, dStart, cTop - .10, cz0);
    this.box('plain', PAINT.post, midX - mullion / 2, fl, cz0 - .032, midX + mullion / 2, cTop - .10, cz0);
    this.box('plain', PAINT.post, midX + mullion / 2 + dW, fl, cz0 - .032, cx1, cTop - .10, cz0);
    this.box('plain', PAINT.post, cx0, fl + dH, cz0 - .032, cx1, cTop - .10, cz0);
    // Solid pew-facing (+x) wall fixtures: metal donation box, small plain plaque, and two small framed notices (no text)
    const fz = (cz0 + cz1) / 2;
    this.box('plain', PAINT.metal, cx1, fl + .86, fz - .08, cx1 + .13, fl + 1.02, fz + .08);
    this.box('plain', PAINT.paper, cx1, fl + 1.16, fz - .13, cx1 + .016, fl + 1.36, fz + .13);
    this.box('plain', PAINT.dark, cx1, fl + 1.43, fz - .10, cx1 + .018, fl + 1.65, fz + .10);
    this.box('plain', PAINT.paper, cx1 + .018, fl + 1.45, fz - .08, cx1 + .022, fl + 1.63, fz + .08);
    this.box('plain', PAINT.dark, cx1, fl + 1.72, fz - .10, cx1 + .018, fl + 2.00, fz + .10);
    this.box('plain', PAINT.paper, cx1 + .018, fl + 1.74, fz - .08, cx1 + .022, fl + 1.98, fz + .08);

    // Three-seat red upholstered folding bench on the +z nave floor in front of the +z pews (measured from scan & video)
    {
      const bx0 = w + 3.04, bx1 = w + 3.44, bz0 = 1.76, bz1 = 3.44, seats = 3, sw = (bz1 - bz0) / seats;
      this.box('plain', PAINT.dark, bx0, .02, bz0, bx1, .06, bz1);
      for (let i = 0; i <= seats; i++) {
        const az = bz0 + i * sw;
        this.box('plain', PAINT.dark, bx0, 0, az - .018, bx0 + .035, .64, az + .018);
        this.box('plain', PAINT.dark, bx1 - .035, 0, az - .018, bx1, .64, az + .018);
        this.box('plain', PAINT.red, bx0 - .02, .62, az - .03, bx1 + .02, .68, az + .03);
      }
      for (let i = 0; i < seats; i++) {
        const za = bz0 + i * sw + .035, zb = bz0 + (i + 1) * sw - .035;
        this.box('plain', PAINT.red, bx0 + .02, .41, za, bx1 - .04, .48, zb);
        this.box('plain', PAINT.red, bx1 - .08, .48, za, bx1, .86, zb);
      }
    }

    // Right (-z) side of the chancel: wooden armchair, white lectern ("FHACAL DHE"), red two-tier table with statues,
    // red-legged cushioned bench and small folding chair.
    // 1. Medium-brown wooden armchair with shaped splat and upholstered seat (dx=0.52, z=-1.92)
    {
      const cx = w + .52, cz = c - 1.92;
      for (const [dx, dz] of [[-.22, -.24], [-.22, .24], [.22, -.24], [.22, .24]]) {
        this.box('plain', PAINT.chair, cx + dx - .024, fl, cz + dz - .024, cx + dx + .024, fl + (dx < 0 ? .95 : .65), cz + dz + .024);
      }
      this.box('plain', PAINT.chair, cx - .24, fl + .40, cz - .25, cx + .24, fl + .45, cz + .25);
      this.box('plain', PAINT.seat, cx - .20, fl + .45, cz - .21, cx + .20, fl + .49, cz + .21);
      this.box('plain', PAINT.chair, cx - .24, fl + .88, cz - .26, cx - .20, fl + .96, cz + .26);
      this.box('plain', PAINT.chair, cx - .235, fl + .45, cz - .08, cx - .205, fl + .88, cz + .08);
      for (const dz of [-.25, .25]) this.box('plain', PAINT.chair, cx - .22, fl + .63, cz + dz - .022, cx + .24, fl + .67, cz + dz + .022);
    }

    // 2. White wooden lectern / ambo ("FHACAL DHE", five gold crosses across the book-rest front; dx=0.52, z=-2.62)
    {
      const lx = w + .52, lz = c - 2.62, lh = 1.30;
      // Cruciform scrolled white base
      this.box('plain', PAINT.white, lx - .21, fl, lz - .03, lx + .21, fl + .07, lz + .03);
      this.box('plain', PAINT.white, lx - .03, fl, lz - .21, lx + .03, fl + .07, lz + .21);
      this.box('plain', PAINT.white, lx - .11, fl + .07, lz - .025, lx + .11, fl + .25, lz + .025);
      this.box('plain', PAINT.white, lx - .025, fl + .07, lz - .11, lx + .025, fl + .25, lz + .11);
      // Central post with vertical gold Gaelic lettering on the front (+x) face
      this.box('plain', PAINT.white, lx - .03, fl + .25, lz - .04, lx + .03, fl + lh - .14, lz + .04);
      this.sheet('lectern', [lx + .033, fl + .30, lz + .038], [0, 0, -.076], [0, .82, 0], true, [.08, .02, .42, .48]);
      // Upper scrolled support bracket
      this.box('plain', PAINT.white, lx - .09, fl + lh - .24, lz - .15, lx + .09, fl + lh - .10, lz + .15);
      // Slanted white book-rest top with front frieze showing five gold crosses
      this.turned([lx, fl + lh - .04, lz], 'z', -.22, () => {
        this.box('plain', PAINT.white, lx - .18, fl + lh - .08, lz - .27, lx + .18, fl + lh, lz + .27);
        this.box('plain', PAINT.white, lx - .21, fl + lh, lz - .30, lx + .21, fl + lh + .025, lz + .30);
        this.sheet('lectern', [lx + .184, fl + lh - .08, lz + .27], [0, 0, -.54], [0, .08, 0], true, [.01, .52, .99, .98]);
      });
    }

    // 3. Red two-tier wooden table in the -z altar corner (dx=0.35, z=-3.47) with Virgin Mary, St. Joseph, Infant figurine & framed plaques
    {
      const rx = w + .35, rz = N.z0 + .38, rw = .54, rd = .50, rh = .74;
      for (const [dx, dz] of [[-rw / 2 + .03, -rd / 2 + .03], [-rw / 2 + .03, rd / 2 - .03], [rw / 2 - .03, -rd / 2 + .03], [rw / 2 - .03, rd / 2 - .03]]) {
        this.box('plain', PAINT.red, rx + dx - .022, fl, rz + dz - .022, rx + dx + .022, fl + rh, rz + dz + .022);
      }
      this.box('plain', PAINT.red, rx - rw / 2 + .02, fl + .26, rz - rd / 2 + .02, rx + rw / 2 - .02, fl + .29, rz + rd / 2 - .02);
      this.box('plain', PAINT.red, rx - rw / 2, fl + rh - .09, rz - rd / 2, rx + rw / 2, fl + rh, rz + rd / 2);
      this.box('plain', PAINT.red, rx - rw / 2 - .02, fl + rh, rz - rd / 2 - .02, rx + rw / 2 + .02, fl + rh + .03, rz + rd / 2 + .02);
      const topY = fl + rh + .03;
      // Virgin Mary statue (white gown, sky-blue mantle, gold waistband, 0.62 m tall)
      this.statue(rx - .12, topY, rz - .03, .62, PAINT.white, PAINT.maryBlue, { veil: true, goldBelt: true });
      // St. Joseph statue (ivory tunic, sage-green cloak, 0.46 m tall)
      this.statue(rx + .08, topY, rz - .11, .46, PAINT.robe, PAINT.sage, { beard: true });
      // Small seated Infant figurine (red mantle over white robe, seated on a low base)
      {
        const ix = rx + .12, iz = rz + .08;
        this.box('plain', PAINT.white, ix - .038, topY, iz - .044, ix + .038, topY + .075, iz + .044);
        this.box('plain', PAINT.red, ix - .042, topY + .02, iz - .048, ix + .018, topY + .11, iz + .048);
        this.box('plain', PAINT.white, ix + .018, topY + .01, iz - .034, ix + .054, topY + .055, iz + .034);
        this.disc(PAINT.skin, ix + .005, topY + .13, iz, .024, .042, 'y', 8);
        this.disc(PAINT.gold, ix + .005, topY + .156, iz, .02, .016, 'y', 8);
      }
      // Two small dark-framed certificates leaning behind the statues (plain cream paper, no text)
      this.box('plain', PAINT.dark, rx - .16, topY, rz + .08, rx - .13, topY + .30, rz + .24);
      this.box('plain', PAINT.paper, rx - .13, topY + .03, rz + .10, rx - .126, topY + .27, rz + .22);
      this.box('plain', PAINT.dark, rx + .02, topY, rz - .23, rx + .16, topY + .26, rz - .20);
      this.box('plain', PAINT.paper, rx + .04, topY + .03, rz - .20, rx + .14, topY + .23, rz - .196);
    }

    // 4. Red-legged cushioned bench / kneeler against the -z wall (dx=1.38, z=-3.54, 0.80 x 0.48 x 0.46 m)
    {
      const fx = w + 1.38, fz = N.z0 + .31;
      for (const [dx, dz] of [[-.35, -.19], [-.35, .19], [.35, -.19], [.35, .19]]) {
        this.box('plain', PAINT.red, fx + dx - .03, fl, fz + dz - .03, fx + dx + .03, fl + .36, fz + dz + .03);
      }
      this.box('plain', PAINT.red, fx - .38, fl + .26, fz - .22, fx + .38, fl + .36, fz + .22);
      this.box('plain', PAINT.cushion, fx - .40, fl + .36, fz - .24, fx + .40, fl + .46, fz + .24);
    }

    // 5. Small red and dark-metal folding chair beside the cushioned bench (dx=2.16, z=-3.60)
    {
      const kx = w + 2.16, kz = N.z0 + .25;
      for (const dx of [-.18, .18]) {
        this.turned([kx + dx, fl + .40, kz], 'x', .22, () => this.box('plain', PAINT.dark, kx + dx - .015, fl, kz - .015, kx + dx + .015, fl + .82, kz + .015));
        this.turned([kx + dx, fl + .40, kz], 'x', -.35, () => this.box('plain', PAINT.dark, kx + dx - .015, fl, kz - .015, kx + dx + .015, fl + .48, kz + .015));
      }
      this.box('plain', PAINT.red, kx - .18, fl + .42, kz - .17, kx + .18, fl + .45, kz + .17);
      this.box('plain', PAINT.red, kx - .18, fl + .66, kz - .14, kx + .18, fl + .80, kz - .10);
    }
  }

  /**
   * Eleven hanging Stations of the Cross at their scan-measured places and heights (y = 1.98..2.40 m, 0.52 x 0.42 m),
   * each painted with its own Station scene and topped by a small wooden cross: four on the +z wall, two flanking
   * the main doorway on the west wall, and five on the -z wall.
   */
  private wallPictures(room: ChurchRoom): void {
    const N = room.shell.nave, st = room.fit.stations, w = st.width, h = st.height, y = st.bottom;
    const uvFor = (idx: number): UVRect => {
      const col = idx % 4, row = Math.floor(idx / 4);
      return [col / 4 + .002, 1 - (row + 1) / 3 + .002, (col + 1) / 4 - .002, 1 - row / 3 - .002];
    };
    const sideStation = (side: -1 | 1, dx: number, idx: number) => {
      const x = N.x0 + dx, z = side > 0 ? N.z1 : N.z0, inward = -side;
      this.box('plain', PAINT.frame, x - w / 2, y, z, x + w / 2, y + h, z + inward * .02);
      this.sheet('stations', [x - inward * w / 2, y, z + inward * .022], [inward * w, 0, 0], [0, h, 0], true, uvFor(idx));
      this.box('plain', PAINT.frame, x - .013, y + h, z, x + .013, y + h + .145, z + inward * .02);
      this.box('plain', PAINT.frame, x - .052, y + h + .085, z, x + .052, y + h + .108, z + inward * .02);
    };
    const westStation = (z: number, idx: number) => {
      const x = N.x1;
      this.box('plain', PAINT.frame, x - .02, y, z - w / 2, x, y + h, z + w / 2);
      this.sheet('stations', [x - .022, y, z - w / 2], [0, 0, w], [0, h, 0], true, uvFor(idx));
      this.box('plain', PAINT.frame, x - .02, y + h, z - .013, x, y + h + .145, z + .013);
      this.box('plain', PAINT.frame, x - .02, y + h + .085, z - .052, x, y + h + .108, z + .052);
    };
    // +z (left) wall: Stations I, II, IV, V (from front toward stair)
    for (const [dx, idx] of st.sidePos) sideStation(1, dx, idx);
    // West (door) wall: Stations VI (right of door) and VIII (left of door)
    for (const [dz, idx] of st.west) westStation(N.ridgeZ + dz, idx);
    // -z (right) wall: Stations IX, X, XI, XII, XIV (from rear corner toward altar)
    for (const [dx, idx] of st.sideNeg) sideStation(-1, dx, idx);
  }

  /** The vestry: grey-blue boards, bare worn floor, sash windows, chest of drawers with brass crucifix and candlestick,
   * red cross-top stand, folding chair and framed hand-drawn map. */
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
    // Brass altar crucifix and matching brass candlestick standing on the chest of drawers (clear of the letter at chest centre)
    {
      const topY = 1.01, lz = V.z0 + .24;
      // Brass altar crucifix (left side of chest, facing +z)
      const crx = cx0 + .22;
      this.disc(PAINT.brass, crx, topY + .03, lz, .065, .06, 'y', 8);
      this.box('plain', PAINT.brass, crx - .015, topY + .06, lz - .015, crx + .015, topY + .24, lz + .015);
      this.box('plain', PAINT.brass, crx - .014, topY + .24, lz - .012, crx + .014, topY + .52, lz + .012);
      this.box('plain', PAINT.brass, crx - .095, topY + .41, lz - .012, crx + .095, topY + .435, lz + .012);
      // Small brass corpus on the altar crucifix
      this.box('plain', PAINT.gold, crx - .016, topY + .33, lz + .012, crx + .016, topY + .44, lz + .026);
      this.box('plain', PAINT.gold, crx - .065, topY + .412, lz + .012, crx + .065, topY + .432, lz + .024);
      // Matching brass candlestick with tapered ivory wax candle (right side of chest)
      const csx = cx1 - .20;
      this.disc(PAINT.brass, csx, topY + .03, lz, .065, .06, 'y', 8);
      this.box('plain', PAINT.brass, csx - .015, topY + .06, lz - .015, csx + .015, topY + .30, lz + .015);
      this.disc(PAINT.brass, csx, topY + .31, lz, .052, .024, 'y', 8);
      this.disc(PAINT.paper, csx, topY + .40, lz, .018, .16, 'y', 8);
    }
    // Small red round stand with white top and inlaid dark cross in the far-right vestry corner
    {
      const sx = V.x0 + .46, sz = V.z0 + .72;
      this.box('plain', PAINT.red, sx - .14, 0, sz - .025, sx + .14, .06, sz + .025);
      this.box('plain', PAINT.red, sx - .025, 0, sz - .14, sx + .025, .06, sz + .14);
      this.box('plain', PAINT.red, sx - .025, .06, sz - .025, sx + .025, .70, sz + .025);
      this.disc(PAINT.white, sx, .715, sz, .18, .03, 'y', 10);
      this.box('plain', PAINT.dark, sx - .11, .73, sz - .012, sx + .11, .735, sz + .012);
      this.box('plain', PAINT.dark, sx - .012, .73, sz - .11, sx + .012, .735, sz + .11);
    }
    // A folding chair: two crossed leg frames, a cane seat and a back rail.
    const fx = V.x1 - 2.3, fz = V.z1 - .95;
    for (const z of [fz - .2, fz + .2]) {
      this.turned([fx, .42, z], 'z', .42, () => this.box('plain', PAINT.ply, fx - .02, 0, z - .015, fx + .02, .86, z + .015));
      this.turned([fx, .42, z], 'z', -.5, () => this.box('plain', PAINT.ply, fx - .02, -.03, z - .015, fx + .02, .8, z + .015));
    }
    this.box('plain', PAINT.cane, fx - .2, .43, fz - .2, fx + .19, .46, fz + .2);
    this.turned([fx, .42, fz], 'z', .42, () => this.box('plain', PAINT.ply, fx - .02, .74, fz - .2, fx + .02, .86, fz + .2));
    // Leaning on the far wall: two plain boards, and the framed hand-drawn map in a weathered frame.
    const mz = (V.z0 + V.z1) / 2 - .35, lean = .2, foot = V.x0 + .42;
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
