import * as THREE from 'three';
import type { Guardrails } from './guardrails';
import { littleMabouMarshRail } from './november-road-details';
import type { Solid } from './parked';
import type { Road } from './roads';
import type { VehicleSpec } from './vehicle-spec';
import type { AreaContacts } from './world-contacts';
import { Mesher, type RGB } from './yard-kit';

/**
 * The two Little Mabou Road pony-truss bridges (Mabou pack, EPSG:2961).
 * Both are narrow one-lane grey steel pony trusses, reusing the truss proportions from yard-build.ts `bridgeLot`.
 */
export const PONY_TRUSS_BRIDGES = [
  { name: 'Little Mabou Road', start: [621405.3, 5102121.04] as const, end: [621420.71, 5102129.04] as const },
  { name: 'Little Mabou Road', start: [622210.0, 5102065.94] as const, end: [622241.11, 5102055.54] as const },
] as const;

export const PONY_TRUSS = {
  /** Half-width to truss centreline: 4.4 m centre-to-centre, 4.16 m clear asphalt roadway. */
  half: 2.2,
  /** Clear asphalt half-width between bottom chords. */
  clearHalf: 2.08,
  /** Inner collision face of the steel inner guard rail along each truss side. */
  railInner: 2.005,
  /** Outer face of the bottom chord and deck fascia. */
  outerHalf: 2.32,
  /** Target panel length (matching yard-build.ts `bridgeLot` ~3.5 m panels). */
  targetPanel: 3.4,
  chordSize: 0.24,
  endPostSize: 0.22,
  diagSize: 0.16,
  postSize: 0.16,
  railHeight: 0.62,
  deckThickness: 0.26,
} as const;

/** Span geometry and side-rail colliders for one pony-truss bridge, including panel/truss dimensions for vertical clipping. */
export interface PonyTrussSpan {
  readonly roadId: number;
  readonly ax: number;
  readonly az: number;
  readonly ux: number;
  readonly uz: number;
  readonly span: number;
  readonly panel: number;
  readonly height: number;
  readonly heading: number;
  readonly solids: readonly Solid[];
}

// Linear RGB vertex colours, slightly warm-neutral so the game's blue sky fill renders true grey steel.
const STEEL_CHORD: RGB = [0.33, 0.31, 0.27];
const STEEL_WEB: RGB = [0.27, 0.255, 0.22];
const STEEL_RAIL: RGB = [0.38, 0.36, 0.32];
const STEEL_DARK: RGB = [0.19, 0.18, 0.16];
const ABUTMENT: RGB = [0.28, 0.27, 0.24];
const DECK_ASPHALT: RGB = [0.085, 0.082, 0.078];

const MATCH_TOLERANCE = 5;

/** Pony-truss side height following yard-build.ts `bridgeLot` ~2.1 m proportions, rising gently on the 33 m span. */
export function ponyTrussHeight(span: number): number {
  return Math.min(2.4, Math.max(2.1, 1.85 + span * 0.015));
}

/** Tag the two Little Mabou Road pony-truss bridges in raw EPSG:2961 road data without editing the input. */
export function littleMabouPonyTruss(road: Road): Road {
  if (!road.bridge || road.kind !== 2 || road.pts.length < 2 || road.name !== 'Little Mabou Road') return road;
  const first = road.pts[0], last = road.pts[road.pts.length - 1];
  const matched = PONY_TRUSS_BRIDGES.some(b =>
    (Math.hypot(first[0] - b.start[0], first[1] - b.start[1]) <= MATCH_TOLERANCE && Math.hypot(last[0] - b.end[0], last[1] - b.end[1]) <= MATCH_TOLERANCE) ||
    (Math.hypot(first[0] - b.end[0], first[1] - b.end[1]) <= MATCH_TOLERANCE && Math.hypot(last[0] - b.start[0], last[1] - b.start[1]) <= MATCH_TOLERANCE));
  if (!matched || road.ponyTruss) return road;
  return { ...road, ponyTruss: true };
}

/** Apply modern Mabou road overrides (marsh guardrail and Little Mabou pony-truss bridges). */
export function mabouRoadOverrides(roads: readonly Road[], modern: boolean, areaId: string): Road[] {
  if (!modern || areaId !== 'mabou') return roads as Road[];
  return roads.map(littleMabouMarshRail).map(littleMabouPonyTruss);
}

/** Build the span frame and two side-rail walls for a world-space pony-truss bridge, aligned to inner rail and outer chord faces. */
export function ponyTrussSpan(road: Road): PonyTrussSpan | null {
  if (!road.ponyTruss || road.pts.length < 2) return null;
  const a = road.pts[0], b = road.pts[road.pts.length - 1];
  const dx = b[0] - a[0], dz = b[1] - a[1], span = Math.hypot(dx, dz);
  if (!span) return null;
  const ux = dx / span, uz = dz / span, heading = Math.atan2(dx, -dz);
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  const panels = Math.max(4, Math.round(span / PONY_TRUSS.targetPanel / 2) * 2);
  const centre = (PONY_TRUSS.railInner + PONY_TRUSS.outerHalf) / 2;
  const halfWidth = (PONY_TRUSS.outerHalf - PONY_TRUSS.railInner) / 2;
  return {
    roadId: road.id,
    ax: a[0],
    az: a[1],
    ux,
    uz,
    span,
    panel: span / panels,
    height: ponyTrussHeight(span),
    heading,
    solids: [-1, 1].map(side => ({
      x: mx - uz * side * centre,
      z: mz + ux * side * centre,
      half: span / 2,
      halfWidth,
      heading,
    })),
  };
}

const BOX_SPAN: [number, number] = [0, 0];

/** Clip a 2D rotated box centred at (sMid, yMid) with half-extents (hx, hy) to the vertical slice [yLo, yHi]. */
function clipRotatedBox(
  sMid: number, yMid: number, hx: number, hy: number, cosS: number, sinS: number,
  yLo: number, yHi: number, out: [number, number],
): boolean {
  const c0s = sMid - hx * cosS + hy * sinS, c0y = yMid - hx * sinS - hy * cosS;
  const c1s = sMid + hx * cosS + hy * sinS, c1y = yMid + hx * sinS - hy * cosS;
  const c2s = sMid + hx * cosS - hy * sinS, c2y = yMid + hx * sinS + hy * cosS;
  const c3s = sMid - hx * cosS - hy * sinS, c3y = yMid - hx * sinS + hy * cosS;
  if (yHi < Math.min(c0y, c1y, c2y, c3y) || yLo > Math.max(c0y, c1y, c2y, c3y)) return false;
  let lowS = Infinity, highS = -Infinity;
  const edge = (as: number, ay: number, bs: number, by: number) => {
    if (ay >= yLo && ay <= yHi) { if (as < lowS) lowS = as; if (as > highS) highS = as; }
    if ((ay < yLo) !== (by < yLo)) {
      const s = as + (bs - as) * ((yLo - ay) / (by - ay));
      if (s < lowS) lowS = s; if (s > highS) highS = s;
    }
    if ((ay > yHi) !== (by > yHi)) {
      const s = as + (bs - as) * ((yHi - ay) / (by - ay));
      if (s < lowS) lowS = s; if (s > highS) highS = s;
    }
  };
  edge(c0s, c0y, c1s, c1y); edge(c1s, c1y, c2s, c2y); edge(c2s, c2y, c3s, c3y); edge(c3s, c3y, c0s, c0y);
  if (highS <= lowS + 1e-6) return false;
  out[0] = lowS; out[1] = highS;
  return true;
}

/**
 * Emit each rendered steel member's exact longitudinal interval [sLeft, sRight] and lateral bounds [inner, outer]
 * that intersect the vehicle vertical slice [carY, carY + carHeight]. Uses the exact box geometry of buildPonyTrussBridge
 * with zero allocations and never merges disjoint members across empty gaps.
 */
export function forEachPonyTrussSteelClip(
  b: PonyTrussSpan,
  y0: number,
  y1: number,
  carY: number,
  carHeight: number,
  visit: (sLeft: number, sRight: number, inner: number, outer: number) => void,
): void {
  const span = b.span, panel = b.panel, h = b.height;
  const panels = Math.max(4, Math.round(span / panel));
  const half = PONY_TRUSS.half, chord = PONY_TRUSS.chordSize, yBase = chord * 0.5;
  const dy = y1 - y0, deckLen = Math.hypot(span, dy);
  const cosS = span / deckLen, sinS = dy / deckLen;
  const sideLen = deckLen - chord * Math.abs(sinS) - 0.004;
  const hx = sideLen * 0.5, sMid = span * 0.5, deckMidY = (y0 + y1) * 0.5;
  const carTop = carY + carHeight;
  const deckAt = (s: number) => y0 + dy * (s / span);
  const emitBox = (cs: number, cy: number, bhx: number, bhy: number, bc: number, bs: number, inner: number, outer: number) => {
    if (clipRotatedBox(cs, cy, bhx, bhy, bc, bs, carY, carTop, BOX_SPAN)) {
      const lo = Math.max(0, Math.min(span, BOX_SPAN[0]));
      const hi = Math.max(0, Math.min(span, BOX_SPAN[1]));
      if (hi > lo + 1e-5) visit(lo, hi, inner, outer);
    }
  };

  // 1. Inner steel guard rail.
  emitBox(sMid, deckMidY + PONY_TRUSS.railHeight, hx, 0.11, cosS, sinS, PONY_TRUSS.railInner, PONY_TRUSS.railInner + 0.07);
  // 2. Bottom chord.
  emitBox(sMid, deckMidY + yBase, hx, yBase, cosS, sinS, half - yBase, half + yBase);
  // 3. Top chord.
  const topSpan = span - 2 * panel;
  const topLen = Math.hypot(topSpan, dy * (topSpan / span)) + chord * 0.7;
  emitBox(sMid, deckMidY + h, topLen * 0.5, yBase, cosS, sinS, half - yBase, half + yBase);
  // 4. Inclined end posts and interior Warren diagonals.
  for (let i = 0; i < panels; i++) {
    const endStart = i === 0, endFinish = i === panels - 1, endPost = endStart || endFinish;
    const size = endPost ? PONY_TRUSS.endPostSize : PONY_TRUSS.diagSize;
    const halfSize = size * 0.5, up = i % 2 === 0;
    const rawS0 = i * panel, rawS1 = (i + 1) * panel;
    const rawYa = deckAt(rawS0) + (up ? yBase : h), rawYb = deckAt(rawS1) + (up ? h : yBase);
    const rawAng = Math.atan2(rawYb - rawYa, panel);
    const endInset = endPost ? halfSize * Math.abs(Math.sin(rawAng)) + 0.02 : 0;
    const s0 = endStart ? rawS0 + endInset : rawS0;
    const s1 = endFinish ? rawS1 - endInset : rawS1;
    const ya = deckAt(s0) + (up ? yBase : h), yb = deckAt(s1) + (up ? h : yBase);
    const dLen = Math.hypot(s1 - s0, yb - ya);
    emitBox((s0 + s1) * 0.5, (ya + yb) * 0.5, dLen * 0.5, halfSize, (s1 - s0) / dLen, (yb - ya) / dLen, half - halfSize, half + halfSize);
  }
  // 5. Interior plumb vertical posts and standoff brackets.
  const postHalf = PONY_TRUSS.postSize * 0.5;
  const railOuter = PONY_TRUSS.railInner + 0.07;
  const postInner = half - postHalf;
  const bracketWidth = postInner - railOuter + 0.025;
  const bracketCentre = railOuter + (postInner - railOuter) * 0.5 + 0.0075;
  const brIn = bracketCentre - bracketWidth * 0.5, brOut = bracketCentre + bracketWidth * 0.5;
  for (let i = 1; i < panels; i++) {
    const s = i * panel, y = deckAt(s);
    if (carTop >= y + yBase && carY <= y + h) visit(s - postHalf, s + postHalf, half - postHalf, half + postHalf);
    if (carTop >= y + PONY_TRUSS.railHeight - 0.09 && carY <= y + PONY_TRUSS.railHeight + 0.09) visit(s - 0.06, s + 0.06, brIn, brOut);
  }
  // 6. End-post standoff brackets.
  const endRailS = panel * ((PONY_TRUSS.railHeight - yBase) / (h - yBase));
  for (let k = 0; k < 2; k++) {
    const s = k === 0 ? endRailS : span - endRailS, y = deckAt(s);
    if (carTop >= y + PONY_TRUSS.railHeight - 0.09 && carY <= y + PONY_TRUSS.railHeight + 0.09) visit(s - 0.07, s + 0.07, brIn, brOut);
  }
}

/**
 * Shared production wiring for road guardrail and pony-truss bridge-rail contacts.
 * Fleet mode checks all rails; solo mode checks pony-truss rails for solo trailers and active-truck position correction
 * (dt = 0 on the active driven vehicle avoids applying rail steering a second time after Vehicle.step()).
 */
export function registerRailContacts(
  fleetContacts: AreaContacts,
  soloContacts: AreaContacts,
  rails: Guardrails,
  isDriven: (body: unknown) => boolean,
  defaultSpec: VehicleSpec,
): void {
  const probe = { x: 0, z: 0, y: 0, heading: 0, spec: defaultSpec, vx: 0, vz: 0, speed: 0 };
  const allows = (check: (body: typeof probe) => void) => (body: { x: number; z: number; y: number; heading: number; spec: VehicleSpec }) => {
    probe.x = body.x; probe.z = body.z; probe.y = body.y; probe.heading = body.heading; probe.spec = body.spec;
    probe.vx = probe.vz = probe.speed = 0;
    check(probe);
    return Math.hypot(probe.x - body.x, probe.z - body.z) < 1e-7;
  };
  fleetContacts.add({
    revision: () => rails.audit.planned + rails.audit.samples,
    resolve: body => { if (!isDriven(body)) rails.block(body); else rails.blockBridge(body, 0); },
    allows: allows(p => rails.block(p)),
  });
  fleetContacts.add({
    revision: () => rails.bridgeRevision,
    resolve: () => {},
    allows: () => true,
  });
  soloContacts.add({
    revision: () => rails.bridgeRevision,
    resolve: body => rails.blockBridge(body, isDriven(body) ? 0 : 1 / 120),
    allows: allows(p => rails.blockBridge(p)),
  });
}

/**
 * Build one merged vertex-coloured geometry for a narrow one-lane grey steel pony-truss bridge along [0, span]
 * at the exact y0 -> y1 deck plane computed by Roads.deck(), keeping the full deck shoulders visible out to `deckHalf`.
 */
export function buildPonyTrussBridge(
  pts: readonly [number, number][],
  y0: number,
  y1: number,
  len: number,
  deckHalf: number = PONY_TRUSS.outerHalf,
): THREE.BufferGeometry {
  const m = new Mesher();
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const span = Math.hypot(dx, dz) || len || 1;
  const ux = dx / span, uz = dz / span;
  const yaw = Math.atan2(-uz, ux);
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  const clearHalf = PONY_TRUSS.clearHalf;
  const dy = y1 - y0, slope = Math.atan2(dy, span);
  const deckY = (s: number) => y0 + dy * (s / span);

  const half = PONY_TRUSS.half;
  const chord = PONY_TRUSS.chordSize;
  let chordSlack = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    chordSlack = Math.max(chordSlack, Math.abs(-(pts[i][0] - a[0]) * uz + (pts[i][1] - a[1]) * ux));
  }
  const outerHalf = Math.max(PONY_TRUSS.outerHalf, deckHalf + (deckHalf > PONY_TRUSS.outerHalf ? chordSlack + 0.01 : 0));
  const panels = Math.max(4, Math.round(span / PONY_TRUSS.targetPanel / 2) * 2);
  const panel = span / panels;
  const h = ponyTrussHeight(span);
  const yBase = chord / 2;

  // One shared deck-aligned frame centred at the span midpoint; local +x runs from -span/2 to +span/2.
  const deckMidY = (y0 + y1) / 2;
  const deckLen = Math.hypot(span, dy);

  // Asphalt roadway between the trusses plus concrete cantilevered outer deck shoulders matching Roads.deck() width.
  const deckThick = PONY_TRUSS.deckThickness;
  const fasciaTop = -0.025;
  const fasciaBottom = fasciaTop - deckThick;
  const sinSlope = Math.abs(Math.sin(slope));
  // Trim tilted steel fascia inside [0, span] so no lower corner overhangs the span endpoints.
  const fasciaLen = deckLen - (deckThick + 0.05) * sinSlope * 2 - 0.01;
  // Top driving surface aligned to local end-segment normals (matching Roads.deck() portal corners and exact y0 -> y1 plane).
  const n0d = Math.hypot(pts[1][0] - a[0], pts[1][1] - a[1]) || 1;
  const n0x = -(pts[1][1] - a[1]) / n0d, n0z = (pts[1][0] - a[0]) / n0d;
  const prev = pts[pts.length - 2];
  const n1d = Math.hypot(b[0] - prev[0], b[1] - prev[1]) || 1;
  const n1x = -(b[1] - prev[1]) / n1d, n1z = (b[0] - prev[0]) / n1d;
  m.at(0, 0, 0);
  const deckStrip = (zLo: number, zHi: number, rgb: RGB) => m.quad([
    [a[0] + n0x * zHi, y0, a[1] + n0z * zHi],
    [b[0] + n1x * zHi, y1, b[1] + n1z * zHi],
    [b[0] + n1x * zLo, y1, b[1] + n1z * zLo],
    [a[0] + n0x * zLo, y0, a[1] + n0z * zLo],
  ], rgb);
  deckStrip(-clearHalf, clearHalf, DECK_ASPHALT);
  if (outerHalf > clearHalf + 1e-4) {
    deckStrip(-outerHalf, -clearHalf, ABUTMENT);
    deckStrip(clearHalf, outerHalf, ABUTMENT);
  }
  // Deck slab sides and underside (steel deck fascia across the full visible deck width, 2.5 cm below top to avoid z-fighting).
  m.at(mx, deckMidY, mz, yaw, 0, slope);
  m.box(0, fasciaTop - deckThick / 2, 0, fasciaLen, deckThick, outerHalf * 2, STEEL_DARK, false);

  // Transverse floor beams beneath the fascia at every panel point (tilted with the slope and inset inside [0, span]).
  const beamW = outerHalf * 2;
  const beamEndInset = 0.12 + (0.28 + Math.abs(fasciaBottom)) * sinSlope;
  for (let i = 0; i <= panels; i++) {
    const s = i === 0 ? beamEndInset : i === panels ? span - beamEndInset : i * panel;
    const bx = a[0] + ux * s, bz = a[1] + uz * s, by = deckY(s);
    m.at(bx, by, bz, yaw, 0, slope);
    m.box(0, fasciaBottom - 0.145, 0, 0.20, 0.28, beamW - 0.04, STEEL_DARK, false);
  }
  const abutmentDrop = 0.01 + 0.34 * Math.abs(dy / span);
  for (const s of [0.34, span - 0.34]) {
    const ax = a[0] + ux * s, az = a[1] + uz * s, ay = deckY(s);
    m.at(ax, ay, az, yaw);
    m.box(0, fasciaBottom - abutmentDrop - 0.58, 0, 0.64, 1.16, beamW + 0.08, ABUTMENT, true);
  }

  // Two grey steel pony-truss sides: bottom chord, top chord, inclined end posts, Warren diagonals, vertical posts, inner guard rail.
  const topSpan = span - 2 * panel;
  const topLen = Math.hypot(topSpan, dy * (topSpan / span)) + chord * 0.7;
  const sideLen = deckLen - chord * sinSlope - 0.004;
  for (const side of [-1, 1]) {
    const zOff = side * half;
    const nx = -uz * zOff, nz = ux * zOff;

    // Bottom chord along deck edge.
    m.at(mx + nx, deckMidY + yBase, mz + nz, yaw, 0, slope);
    m.box(0, 0, 0, sideLen, chord, chord, STEEL_CHORD, false);

    // Top chord spanning the interior panels between the inclined end posts.
    m.at(mx + nx, deckMidY + h, mz + nz, yaw, 0, slope);
    m.box(0, 0, 0, topLen, chord, chord, STEEL_CHORD, false);

    // Inner steel guard rail running full span inside the truss posts (inner face at PONY_TRUSS.railInner).
    const railZ = side * (PONY_TRUSS.railInner + 0.035);
    m.at(mx - uz * railZ, deckMidY + PONY_TRUSS.railHeight, mz + ux * railZ, yaw, 0, slope);
    m.box(0, 0, 0, sideLen, 0.22, 0.07, STEEL_RAIL, false);

    // Diagonals (inclined end posts at i=0 and i=panels-1, trimmed inside [0, span]; alternating Warren diagonals inside).
    for (let i = 0; i < panels; i++) {
      const endStart = i === 0, endFinish = i === panels - 1, endPost = endStart || endFinish;
      const size = endPost ? PONY_TRUSS.endPostSize : PONY_TRUSS.diagSize;
      const up = i % 2 === 0;
      const rawS0 = i * panel, rawS1 = (i + 1) * panel;
      const rawYa = deckY(rawS0) + (up ? yBase : h), rawYb = deckY(rawS1) + (up ? h : yBase);
      const rawAng = Math.atan2(rawYb - rawYa, panel);
      const endInset = endPost ? (size / 2) * Math.abs(Math.sin(rawAng)) + 0.02 : 0;
      const s0 = endStart ? rawS0 + endInset : rawS0;
      const s1 = endFinish ? rawS1 - endInset : rawS1;
      const ya = deckY(s0) + (up ? yBase : h);
      const yb = deckY(s1) + (up ? h : yBase);
      const sMid = (s0 + s1) / 2;
      const dLen = Math.hypot(s1 - s0, yb - ya);
      const ang = Math.atan2(yb - ya, s1 - s0);
      m.at(a[0] + ux * sMid + nx, (ya + yb) / 2, a[1] + uz * sMid + nz, yaw, 0, ang);
      m.box(0, 0, 0, dLen, size, size, endPost ? STEEL_CHORD : STEEL_WEB, false);
    }

    // Plumb vertical posts at every interior panel joint, plus steel standoff brackets tying the inner rail to each post.
    const railOuter = PONY_TRUSS.railInner + 0.07;
    const postInner = half - PONY_TRUSS.postSize / 2;
    const bracketWidth = postInner - railOuter + 0.025;
    const bracketZ = side * (railOuter + (postInner - railOuter) / 2 + 0.0075);
    const bnx = -uz * bracketZ, bnz = ux * bracketZ;
    for (let i = 1; i < panels; i++) {
      const s = i * panel;
      const y = deckY(s);
      m.at(a[0] + ux * s + nx, y + yBase + (h - yBase) / 2, a[1] + uz * s + nz, yaw);
      m.box(0, 0, 0, PONY_TRUSS.postSize, h - yBase, PONY_TRUSS.postSize, STEEL_WEB, false);
      m.at(a[0] + ux * s + bnx, y + PONY_TRUSS.railHeight, a[1] + uz * s + bnz, yaw);
      m.box(0, 0, 0, 0.12, 0.18, bracketWidth, STEEL_DARK, false);
    }
    // Tie the inner rail ends into the inclined end posts where they cross railHeight.
    const endRailS = panel * ((PONY_TRUSS.railHeight - yBase) / (h - yBase));
    for (const s of [endRailS, span - endRailS]) {
      const y = deckY(s);
      m.at(a[0] + ux * s + bnx, y + PONY_TRUSS.railHeight, a[1] + uz * s + bnz, yaw);
      m.box(0, 0, 0, 0.14, 0.18, bracketWidth, STEEL_DARK, false);
    }
  }

  return m.geometry();
}
