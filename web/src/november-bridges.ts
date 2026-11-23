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
  /** Clear asphalt half-width between bottom chords (exact lateral deckHeight limit). */
  clearHalf: 2.08,
  /** Paved approach apron past each end of the steel span, long enough to meet the drawn road surface cleanly. */
  approach: 7.0,
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

/** Shared height grids for the start and end 3 m approach aprons so rendered triangles and wheel support match exactly. */
export interface PonyTrussAprons {
  readonly start: Float64Array;
  readonly end: Float64Array;
}

// Linear RGB vertex colours, slightly warm-neutral so the game's blue sky fill renders true grey steel.
const STEEL_CHORD: RGB = [0.33, 0.31, 0.27];
const STEEL_WEB: RGB = [0.27, 0.255, 0.22];
const STEEL_RAIL: RGB = [0.38, 0.36, 0.32];
const STEEL_DARK: RGB = [0.19, 0.18, 0.16];
const ABUTMENT: RGB = [0.28, 0.27, 0.24];
const DECK_ASPHALT: RGB = [0.085, 0.082, 0.078];

const MATCH_TOLERANCE = 5;
const APRON_ALONG_STEPS = 10;
const APRON_ACROSS_STEPS = 6;
const APRON_COLS = APRON_ACROSS_STEPS + 1;

/** Smoothly blend the 3 m approach apron from the bridge deck edge into the local bank height across the lane width. */
function apronSurfaceY(endY: number, distPastEnd: number, land: number | null): number {
  const u = Math.max(0, Math.min(1, 1 - distPastEnd / PONY_TRUSS.approach));
  const blend = u * u * (3 - 2 * u);
  if (land === null) return endY;
  return Math.max(land, land + (endY - land) * blend);
}

/** Evaluate the exact triangle plane built by Mesher.quad([A(0,1), B(1,1), C(1,0), D(0,0)]) inside an apron grid. */
function sampleApronGrid(grid: Float64Array, uNorm: number, vNorm: number): number {
  const fi = Math.max(0, Math.min(APRON_ALONG_STEPS, uNorm * APRON_ALONG_STEPS));
  const fj = Math.max(0, Math.min(APRON_ACROSS_STEPS, vNorm * APRON_ACROSS_STEPS));
  const i = Math.min(APRON_ALONG_STEPS - 1, Math.floor(fi));
  const j = Math.min(APRON_ACROSS_STEPS - 1, Math.floor(fj));
  const u = fi - i, v = fj - j;
  const hD = grid[i * APRON_COLS + j];
  const hA = grid[i * APRON_COLS + j + 1];
  const hC = grid[(i + 1) * APRON_COLS + j];
  const hB = grid[(i + 1) * APRON_COLS + j + 1];
  if (u + v >= 1) return hB + (1 - u) * (hA - hB) + (1 - v) * (hC - hB);
  return hD + u * (hC - hD) + v * (hA - hD);
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

/** Fast zero-allocation bounds test for a pony-truss span and its 3 m aprons, run before deck construction. */
export function inPonyTrussBounds(road: Road, x: number, z: number): boolean {
  const a = road.pts[0], b = road.pts[road.pts.length - 1];
  const dx = b[0] - a[0], dz = b[1] - a[1], len2 = dx * dx + dz * dz;
  if (!len2) return false;
  const span = Math.sqrt(len2);
  const along = ((x - a[0]) * dx + (z - a[1]) * dz) / span;
  const ap = PONY_TRUSS.approach;
  if (along < -ap || along > span + ap) return false;
  const across = (-(x - a[0]) * dz + (z - a[1]) * dx) / span;
  return Math.abs(across) <= PONY_TRUSS.clearHalf;
}

/** Packed tile-level signature across both span ends and apron corners so streaming either bank refreshes the deck. */
export function ponyTrussBankState(
  road: Road,
  levelAt: (x: number, z: number) => number,
): { minLevel: number; sig: number } {
  const a = road.pts[0], b = road.pts[road.pts.length - 1];
  const dx = b[0] - a[0], dz = b[1] - a[1], span = Math.hypot(dx, dz) || 1;
  const ux = dx / span, uz = dz / span, ap = PONY_TRUSS.approach, cw = PONY_TRUSS.clearHalf;
  let minLevel = 15, sig = 0;
  const sample = (s: number, off: number) => {
    const lvl = Math.max(0, Math.min(15, levelAt(a[0] + ux * s - uz * off, a[1] + uz * s + ux * off)));
    if (lvl < minLevel) minLevel = lvl;
    sig = sig * 16 + lvl;
  };
  sample(0, 0);
  sample(span, 0);
  sample(-ap, 0);
  sample(span + ap, 0);
  sample(-ap, -cw);
  sample(-ap, cw);
  sample(span + ap, -cw);
  sample(span + ap, cw);
  return { minLevel, sig };
}

/**
 * Exact wheel support on a pony-truss bridge and its 3 m approach aprons.
 * Evaluates the exact same triangle mesh surface built by buildPonyTrussBridge() (zero divergence, zero allocations).
 */
export function ponyTrussDeckHeight(
  road: Road,
  y0: number,
  y1: number,
  x: number,
  z: number,
  aprons: PonyTrussAprons,
): number | null {
  const a = road.pts[0], b = road.pts[road.pts.length - 1];
  const dx = b[0] - a[0], dz = b[1] - a[1], len2 = dx * dx + dz * dz;
  if (!len2) return null;
  const span = Math.sqrt(len2);
  const along = ((x - a[0]) * dx + (z - a[1]) * dz) / span;
  const ap = PONY_TRUSS.approach;
  if (along < -ap || along > span + ap) return null;
  const across = (-(x - a[0]) * dz + (z - a[1]) * dx) / span;
  const clearHalf = PONY_TRUSS.clearHalf;
  if (Math.abs(across) > clearHalf) return null;
  if (along < 0) return sampleApronGrid(aprons.start, (along + ap) / ap, (across + clearHalf) / (2 * clearHalf));
  if (along > span) return sampleApronGrid(aprons.end, (along - span) / ap, (across + clearHalf) / (2 * clearHalf));
  return y0 + (y1 - y0) * (along / span);
}

/** Two solid side-rail walls for a world-space pony-truss bridge, aligned to the inner rail and outer chord faces. */
export function ponyTrussSolids(road: Road): Solid[] {
  if (!road.ponyTruss || road.pts.length < 2) return [];
  const a = road.pts[0], b = road.pts[road.pts.length - 1];
  const dx = b[0] - a[0], dz = b[1] - a[1], span = Math.hypot(dx, dz);
  if (!span) return [];
  const ux = dx / span, uz = dz / span, heading = Math.atan2(dx, -dz);
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  const centre = (PONY_TRUSS.railInner + PONY_TRUSS.outerHalf) / 2;
  const halfWidth = (PONY_TRUSS.outerHalf - PONY_TRUSS.railInner) / 2;
  return [-1, 1].map(side => ({
    x: mx - uz * side * centre,
    z: mz + ux * side * centre,
    half: span / 2,
    halfWidth,
    heading,
  }));
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
  soloContacts.add({
    resolve: body => rails.blockBridge(body, isDriven(body) ? 0 : 1 / 120),
    allows: allows(p => rails.blockBridge(p)),
  });
}

/** Build one 8x8 apron height grid from a single cached 17x17 terrain sample pass (289 lookups per end, < 1 ms). */
function buildApronGrid(
  a: readonly [number, number],
  ux: number,
  uz: number,
  span: number,
  end: -1 | 1,
  endY: number,
  sampleY: (x: number, z: number) => number | null,
  pinOuter: boolean,
  padMin: number,
  padTarget: number,
): Float64Array {
  const ap = PONY_TRUSS.approach, clearHalf = PONY_TRUSS.clearHalf;
  const sub = 2;
  const sampleRows = APRON_ALONG_STEPS * sub + 1;
  const sampleCols = APRON_ACROSS_STEPS * sub + 1;
  const samples = new Float64Array(sampleRows * sampleCols);
  for (let r = 0; r < sampleRows; r++) {
    const uNorm = r / (sampleRows - 1);
    const s = end < 0 ? -ap * (1 - uNorm) : span + ap * uNorm;
    for (let c = 0; c < sampleCols; c++) {
      const vNorm = c / (sampleCols - 1);
      const across = -clearHalf + 2 * clearHalf * vNorm;
      const h = sampleY(a[0] + ux * s - uz * across, a[1] + uz * s + ux * across);
      samples[r * sampleCols + c] = h === null ? Number.NaN : h;
    }
  }
  const heights = new Float64Array((APRON_ALONG_STEPS + 1) * APRON_COLS);
  const joinRow = end < 0 ? APRON_ALONG_STEPS : 0;
  const outerRow = end < 0 ? 0 : APRON_ALONG_STEPS;
  for (let i = 0; i <= APRON_ALONG_STEPS; i++) {
    const t = i / APRON_ALONG_STEPS;
    const s = end < 0 ? -ap * (1 - t) : span + ap * t;
    const distPast = end < 0 ? -s : s - span;
    for (let j = 0; j <= APRON_ACROSS_STEPS; j++) {
      const raw = samples[(i * sub) * sampleCols + j * sub];
      const h = Number.isNaN(raw) ? null : raw;
      heights[i * APRON_COLS + j] = i === joinRow ? endY : pinOuter && i === outerRow && h !== null ? h : apronSurfaceY(endY, distPast, h);
    }
  }
  // Lift non-pinned vertices wherever cached mid-cell terrain samples rise above an apron triangle (zero extra terrain lookups).
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < APRON_ALONG_STEPS; i++) {
      for (let j = 0; j < APRON_ACROSS_STEPS; j++) {
        for (let si = 0; si <= sub; si++) {
          const su = si / sub, uNorm = (i + su) / APRON_ALONG_STEPS;
          for (let sj = 0; sj <= sub; sj++) {
            const sv = sj / sub, vNorm = (j + sv) / APRON_ACROSS_STEPS;
            const land = samples[(i * sub + si) * sampleCols + j * sub + sj];
            if (Number.isNaN(land)) continue;
            const onOuter = (end < 0 && i === 0 && si === 0) || (end > 0 && i === APRON_ALONG_STEPS - 1 && si === sub);
            const pMin = onOuter ? 0.003 : padMin;
            const pTarget = onOuter ? 0.006 : padTarget;
            const triY = sampleApronGrid(heights, uNorm, vNorm);
            if (land + pMin <= triY) continue;
            const excess = land + pTarget - triY;
            const verts: [number, number, number][] = su + sv >= 1
              ? [[i + 1, j + 1, su + sv - 1], [i, j + 1, 1 - su], [i + 1, j, 1 - sv]]
              : [[i, j, 1 - su - sv], [i + 1, j, su], [i, j + 1, sv]];
            const lockOuter = pinOuter || !onOuter;
            let freeWeight = 0;
            for (const [vi, , w] of verts) if (vi !== joinRow && (!lockOuter || vi !== outerRow)) freeWeight += w;
            if (freeWeight > 0.01) {
              const lift = excess / freeWeight;
              for (const [vi, vj, w] of verts) {
                if (vi !== joinRow && (!lockOuter || vi !== outerRow) && w > 0) heights[vi * APRON_COLS + vj] += lift;
              }
            }
          }
        }
      }
    }
  }
  return heights;
}

/**
 * Build one merged vertex-coloured geometry for a narrow one-lane grey steel pony-truss bridge and its 3 m approach aprons.
 * Returns the geometry, wheel-support apron height grids, and bank-cleared end elevations shared with ponyTrussDeckHeight().
 */
export function buildPonyTrussBridge(
  pts: readonly [number, number][],
  rawY0: number,
  rawY1: number,
  len: number,
  supportHeightAt: (x: number, z: number) => number | null,
  drawnHeightAt: (x: number, z: number) => number | null = supportHeightAt,
  reuseSupport?: { aprons: PonyTrussAprons; y0: number; y1: number },
): { geometry: THREE.BufferGeometry; aprons: PonyTrussAprons; y0: number; y1: number } {
  const m = new Mesher();
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const span = Math.hypot(dx, dz) || len || 1;
  const ux = dx / span, uz = dz / span;
  const yaw = Math.atan2(-uz, ux);
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  const clearHalf = PONY_TRUSS.clearHalf;
  // Lift either span end above the highest loaded bank point across its seam so apron and steel deck meet with zero step.
  let y0 = reuseSupport ? reuseSupport.y0 : rawY0, y1 = reuseSupport ? reuseSupport.y1 : rawY1;
  if (!reuseSupport) {
    const seamSamples = APRON_ACROSS_STEPS * 2;
    for (let j = 0; j <= seamSamples; j++) {
      const across = -clearHalf + (2 * clearHalf * j) / seamSamples;
      const h0 = supportHeightAt(a[0] - uz * across, a[1] + ux * across);
      if (h0 !== null && h0 + 0.02 > y0) y0 = h0 + 0.02;
      const h1 = supportHeightAt(b[0] - uz * across, b[1] + ux * across);
      if (h1 !== null && h1 + 0.02 > y1) y1 = h1 + 0.02;
    }
  }
  const dy = y1 - y0, slope = Math.atan2(dy, span);
  const deckY = (s: number) => y0 + dy * (s / span);

  const half = PONY_TRUSS.half;
  const chord = PONY_TRUSS.chordSize;
  const panels = Math.max(4, Math.round(span / PONY_TRUSS.targetPanel / 2) * 2);
  const panel = span / panels;
  // Pony truss height follows bridgeLot's ~2.1 m proportion, rising gently on the 33 m span.
  const h = Math.min(2.4, Math.max(2.1, 1.85 + span * 0.015));
  const yBase = chord / 2;

  // One shared deck-aligned frame centred at the span midpoint; local +x runs from -span/2 to +span/2.
  const deckMidY = (y0 + y1) / 2;
  const deckLen = Math.hypot(span, dy);

  // Asphalt deck top and steel deck slab between the two trusses.
  const deckThick = PONY_TRUSS.deckThickness;
  const fasciaTop = -0.025;
  const fasciaBottom = fasciaTop - deckThick;
  const sinSlope = Math.abs(Math.sin(slope));
  // Trim tilted steel fascia inside [0, span] so no lower corner overhangs the span endpoints.
  const fasciaLen = deckLen - (deckThick + 0.05) * sinSlope * 2 - 0.01;
  m.at(mx, deckMidY, mz, yaw, 0, slope);
  // Top driving surface at exact local y = 0 (matches ponyTrussDeckHeight on [0, span]).
  m.quad([
    [-deckLen / 2, 0, clearHalf],
    [deckLen / 2, 0, clearHalf],
    [deckLen / 2, 0, -clearHalf],
    [-deckLen / 2, 0, -clearHalf],
  ], DECK_ASPHALT);
  // Deck slab sides and underside (steel deck fascia under the trusses, 2.5 cm below asphalt to avoid z-fighting).
  m.box(0, fasciaTop - deckThick / 2, 0, fasciaLen, deckThick, half * 2 + chord, STEEL_DARK, false);

  // Paved 7 m approach aprons: when settled, rendered asphalt and wheel support share one exact surface; during LOD streaming, visual outer edge meets the selected road.
  const ap = PONY_TRUSS.approach;
  const startGrid = reuseSupport ? reuseSupport.aprons.start : buildApronGrid(a, ux, uz, span, -1, y0, supportHeightAt, false, 0.036, 0.046);
  const endGrid = reuseSupport ? reuseSupport.aprons.end : buildApronGrid(a, ux, uz, span, 1, y1, supportHeightAt, false, 0.036, 0.046);
  const sameSurface = drawnHeightAt === supportHeightAt;
  const startVis = sameSurface ? startGrid : buildApronGrid(a, ux, uz, span, -1, y0, drawnHeightAt, true, 0.005, 0.012);
  const endVis = sameSurface ? endGrid : buildApronGrid(a, ux, uz, span, 1, y1, drawnHeightAt, true, 0.005, 0.012);
  m.at(0, 0, 0);
  for (const end of [-1, 1] as const) {
    const visHeights = end < 0 ? startVis : endVis;
    const grid: [number, number, number][][] = [];
    for (let i = 0; i <= APRON_ALONG_STEPS; i++) {
      const t = i / APRON_ALONG_STEPS;
      const s = end < 0 ? -ap * (1 - t) : span + ap * t;
      const row: [number, number, number][] = [];
      for (let j = 0; j <= APRON_ACROSS_STEPS; j++) {
        const across = -clearHalf + (2 * clearHalf * j) / APRON_ACROSS_STEPS;
        row.push([a[0] + ux * s - uz * across, visHeights[i * APRON_COLS + j], a[1] + uz * s + ux * across]);
      }
      grid.push(row);
    }
    for (let i = 0; i < APRON_ALONG_STEPS; i++) {
      for (let j = 0; j < APRON_ACROSS_STEPS; j++) {
        // Counter-clockwise from above (+Y normal); diagonal A(0,1)->C(1,0) matches sampleApronGrid().
        m.quad([grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j], grid[i][j]], DECK_ASPHALT);
      }
      // Side skirts drop cleanly down into the bank beneath the outer apron edges.
      for (const side of [0, APRON_ACROSS_STEPS]) {
        const p0 = grid[i][side], p1 = grid[i + 1][side];
        const b0 = [p0[0], p0[1] - 2.5, p0[2]], b1 = [p1[0], p1[1] - 2.5, p1[2]];
        if (side === APRON_ACROSS_STEPS) m.quad([b0, b1, p1, p0], ABUTMENT);
        else m.quad([b1, b0, p0, p1], ABUTMENT);
      }
    }
    // End skirt seals the outer apron edge down into the embankment in dark asphalt so the seam blends smoothly into the road.
    const outerRow = end < 0 ? 0 : APRON_ALONG_STEPS;
    for (let j = 0; j < APRON_ACROSS_STEPS; j++) {
      const p0 = grid[outerRow][j], p1 = grid[outerRow][j + 1];
      const b0 = [p0[0], p0[1] - 2.5, p0[2]], b1 = [p1[0], p1[1] - 2.5, p1[2]];
      if (end < 0) m.quad([b0, b1, p1, p0], DECK_ASPHALT);
      else m.quad([b1, b0, p0, p1], DECK_ASPHALT);
    }
  }

  // Transverse floor beams beneath the fascia at every panel point (tilted with the slope and inset inside [0, span]).
  const beamW = half * 2 + chord;
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

  return { geometry: m.geometry(), aprons: { start: startGrid, end: endGrid }, y0, y1 };
}
