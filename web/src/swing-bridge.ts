import * as THREE from 'three';
import { CANAL_ROUTE } from './canal-route';
import { Mesher, type RGB } from './yard-kit';

/**
 * First-pass Canso Causeway swing bridge dimensions (metres, except counts/seconds).
 * Every dimension lives in this single table so R-063 tender drawings (due after 1 Dec)
 * or later survey notes can refine it in one place.
 *
 * Public sources (look-only photos, zero pixels copied or traced):
 * - Dimensions: Strait Area Museum construction exhibit (308 ft / 93.88 m length, 38 in / 0.965 m pivot pin,
 *   80 ft / 24.4 m canal lock), Wikipedia "Canso Canal Bridge", standard 1.435 m railway gauge.
 * - Baked survey: Highway 104 span 35 length/halfWidth and parallel Railroad span -100095 endpoints/elevations.
 * - Proportions and colour observed from Wikimedia Commons public photos:
 *   File:Bridge_and_Lighthouse_View_(15534591682).jpg (CC BY-SA 2.0),
 *   File:Canso_Causeway_-_Port_Hastings,_Nova_Scotia_2022-07-26.jpg (CC BY-SA 4.0),
 *   File:CapeBretonEntrance.jpg (Public domain).
 */
export const SWING_BRIDGE = Object.freeze({
  /** Published overall truss length (308 ft). Runtime uses the baked Highway 104 span length (~91.46 m) so abutments stay seamless. */
  nominalLength: 93.88,
  /** Published internal centre pivot pin diameter (38 in). */
  pivotPinDiameter: 0.965,
  /** Published Canso Canal lock width (80 ft). */
  canalLockWidth: 24.4,
  /** Baked Highway 104 half-width on the span. */
  highwayHalfWidth: 3.6,
  /** Baked single-track railway centreline offset south (+across) of Highway 104. */
  railAcross: 5.5,
  /** Standard North American railway track gauge (4 ft 8.5 in). */
  railGauge: 1.435,
  /** North outer truss centreline relative to Highway 104 centreline (estimated). */
  northTrussAcross: -4.5,
  /** South outer truss centreline relative to Highway 104 centreline (estimated). */
  southTrussAcross: 8.3,
  /** Centre-to-centre distance between the two outer steel trusses (estimated, ~42 ft). */
  trussWidth: 12.8,
  /** Pivot pier transverse offset (+across) from Highway 104 centreline: midpoint of the two trusses. */
  pivotAcross: 1.9,
  /** Highway-to-railway divider curb/guardrail offset (+across) from Highway 104 centreline (estimated). */
  dividerAcross: 3.85,
  /** Number of main Warren truss panels per arm (observed in public photos: 5 west + 5 east + 1 centre tower bay). */
  armPanels: 5,
  /** Narrow central tower bay over the pivot pier (estimated). */
  centerBayLength: 6.4,
  /** Outer flat top-chord height above the highway deck (estimated). */
  shoulderHeight: 7.6,
  /** Central pivot tower peak height above the highway deck (estimated). */
  peakHeight: 11.2,
  /** Clear headroom under overhead portal and sway bracing above the roadway deck (estimated). */
  portalClearance: 5.6,
  /** Main top/bottom chord width and depth (estimated). */
  chordWidth: 0.58,
  chordDepth: 0.54,
  /** Inclined end post square section (estimated). */
  endPostSize: 0.56,
  /** Interior Warren diagonal section (estimated). */
  diagSize: 0.38,
  /** Interior vertical post section (estimated). */
  verticalSize: 0.34,
  /** Heavier central pivot tower column section (estimated). */
  towerPostSize: 0.50,
  /** Depth of under-deck steel edge girders and transverse floor beams (estimated). */
  deckDepth: 1.35,
  /** Fallback railway trackbed drop below Highway 104 deck when baked railroad elevations are absent. */
  railDeckDrop: 0.18,
  /** Circular concrete pivot pier radius (estimated). */
  pivotPierRadius: 6.8,
  /** Circular steel turntable drum radius and height on top of the pivot pier (estimated). */
  turntableRadius: 6.2,
  turntableHeight: 0.55,
  /** Depth piers and abutments extend below deck so they remain grounded at every Hill scale (exag 0.5..2.5). */
  foundationDrop: 18.0,
  /** Distance outside each deck end to the green arched highway signal portal (clears the 9 m barrier arm). */
  portalOffset: 10.6,
  /** Clear half-width between the signal portal legs across Highway 104 (estimated). */
  portalHalfWidth: 4.25,
  /** Clear height under the overhead highway signal portal beam and its overall top height (estimated). */
  portalClearHeight: 5.7,
  portalTopHeight: 6.75,
  /** Fallback east overhang of the baked railroad span (-100095) beyond Highway 104's east end. */
  eastRailTail: 5.04,
  /** Horizontal swing-clearance margin between rotating span ends and fixed backwalls/aprons. */
  swingClearance: 0.80,
});

// Linear RGB vertex colours calibrated for the game's Lambert lighting (no textures).
const GREEN_CHORD: RGB = [0.055, 0.215, 0.140];
const GREEN_WEB: RGB = [0.042, 0.170, 0.110];
const GREEN_DARK: RGB = [0.032, 0.125, 0.082];
const GREEN_PORTAL: RGB = [0.048, 0.195, 0.125];
const GREEN_SIGN: RGB = [0.030, 0.155, 0.090];
const ASPHALT: RGB = [0.16, 0.16, 0.17];
const STRIPE_YELLOW: RGB = [0.55, 0.40, 0.04];
const STRIPE_WHITE: RGB = [0.55, 0.55, 0.52];
const GUARDRAIL: RGB = [0.42, 0.43, 0.42];
const CONCRETE: RGB = [0.36, 0.37, 0.34];
const CONCRETE_DARK: RGB = [0.25, 0.26, 0.24];
const RAIL_BED: RGB = [0.20, 0.19, 0.18];
const RAIL_TIE: RGB = [0.15, 0.11, 0.08];
const RAIL_STEEL: RGB = [0.28, 0.23, 0.19];
const SIGNAL_YELLOW: RGB = [0.72, 0.52, 0.03];
const SIGNAL_DARK: RGB = [0.06, 0.06, 0.06];
const SIGNAL_RED: RGB = [0.65, 0.06, 0.04];
const SIGNAL_GREEN: RGB = [0.06, 0.55, 0.14];
const FENDER_TIMBER: RGB = [0.22, 0.16, 0.11];

/** Baked parallel railroad endpoints projected into the Canal frame (along/across from span centre). */
export interface RailJoinSpec {
  readonly westAcross: number;
  readonly eastAcross: number;
  readonly eastTail: number;
}

interface RailProfile {
  readonly westDrop: number;
  readonly eastDrop: number;
  readonly eastBaseY: number;
  readonly westAcross: number;
  readonly eastAcross: number;
  readonly eastTail: number;
}

/** Shortest signed turn (radians) from Highway 104's closed yaw to the canal alignment (parallel to CANAL_ROUTE). */
export function swingOpenDeltaYaw(alongX: number, alongZ: number): number {
  const baseYaw = Math.atan2(-alongZ, alongX);
  const canalYaw = Math.atan2(CANAL_ROUTE.northward, CANAL_ROUTE.eastward);
  return Math.atan2(Math.sin(canalYaw - baseYaw), Math.cos(canalYaw - baseYaw));
}

function trussNodeY(panelIndex: number): number {
  const D = SWING_BRIDGE;
  if (panelIndex <= 0) return D.chordDepth * 0.5;
  if (panelIndex <= 3) return D.shoulderHeight;
  if (panelIndex === 4) return (D.shoulderHeight + D.peakHeight) * 0.5;
  return D.peakHeight;
}

/** Add a straight steel member connecting two points in one constant-z truss plane. */
function trussBar(m: Mesher, x0: number, y0: number, x1: number, y1: number, z: number, depth: number, width: number, color: RGB): void {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  if (len < 1e-4) return;
  m.at((x0 + x1) * 0.5, (y0 + y1) * 0.5, z, 0, 0, Math.atan2(dy, dx));
  m.box(0, 0, 0, len, depth, width, color, false);
}

/** Add a horizontal diagonal member in a constant-y roof/floor plane. */
function flatBar(m: Mesher, x0: number, z0: number, x1: number, z1: number, y: number, height: number, width: number, color: RGB): void {
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
  if (len < 1e-4) return;
  m.at((x0 + x1) * 0.5, y, (z0 + z1) * 0.5, Math.atan2(-dz, dx));
  m.box(0, 0, 0, len, height, width, color, false);
}

/** Add a transverse member in a constant-x cross-frame plane. */
function crossBar(m: Mesher, x: number, y0: number, z0: number, y1: number, z1: number, thickX: number, thickOther: number, color: RGB): void {
  const dy = y1 - y0, dz = z1 - z0, len = Math.hypot(dy, dz);
  if (len < 1e-4) return;
  m.at(x, (y0 + y1) * 0.5, (z0 + z1) * 0.5, 0, Math.atan2(-dy, dz), 0);
  m.box(0, 0, 0, thickX, thickOther, len, color, false);
}

function buildSpanGeometry(halfLength: number, low: boolean, rail: RailProfile): THREE.BufferGeometry {
  const D = SWING_BRIDGE;
  const m = new Mesher();
  const fullLen = halfLength * 2;
  const halfW = D.trussWidth * 0.5; // ±6.4 m around pivot
  const hwyZ = -D.pivotAcross;      // -1.9 m
  const railZ0 = rail.westAcross - D.pivotAcross;
  const railZ1 = rail.eastAcross - D.pivotAcross;
  const railZMid = (railZ0 + railZ1) * 0.5;
  const railY0 = -rail.westDrop;
  const railY1 = -rail.eastDrop;
  const railYMid = (railY0 + railY1) * 0.5;
  const railDx = fullLen, railDy = railY1 - railY0, railDz = railZ1 - railZ0;
  const railLen = Math.hypot(railDx, railDy, railDz);
  const railYaw = Math.atan2(-railDz, railDx);
  const railSlope = Math.atan2(railDy, Math.hypot(railDx, railDz));
  const divZ = D.dividerAcross - D.pivotAcross; // +1.95 m
  const cHalf = D.centerBayLength * 0.5;
  const armLen = Math.max(20, halfLength - cHalf);
  const pLen = armLen / D.armPanels;

  // 1. Roadway asphalt deck, highway markings, curbs and multi-rail guardrails.
  m.at(0, 0, 0);
  // Top driving surface flush with y = 0 (matches ModernBridges deckHeight).
  m.quad([
    [-halfLength, 0, hwyZ + D.highwayHalfWidth],
    [halfLength, 0, hwyZ + D.highwayHalfWidth],
    [halfLength, 0, hwyZ - D.highwayHalfWidth],
    [-halfLength, 0, hwyZ - D.highwayHalfWidth],
  ], ASPHALT);
  // Deck slab underside & side fascia beneath the highway.
  m.box(0, -0.22, hwyZ, fullLen, 0.42, D.highwayHalfWidth * 2, CONCRETE_DARK, false);
  // Highway double-yellow centreline and white edge stripes (matching modern-bridges.ts).
  for (const side of [-1, 1]) {
    m.box(0, 0.012, hwyZ + side * 0.115, fullLen, 0.014, 0.12, STRIPE_YELLOW, true);
    m.box(0, 0.012, hwyZ + side * (D.highwayHalfWidth - 0.27), fullLen, 0.014, 0.12, STRIPE_WHITE, true);
  }
  // Concrete curbs along north roadway edge and highway-rail divider.
  m.box(0, 0.13, hwyZ - D.highwayHalfWidth - 0.24, fullLen, 0.26, 0.48, CONCRETE, false);
  m.box(0, 0.15, divZ, fullLen, 0.30, 0.46, CONCRETE, false);
  // Galvanized highway guardrails (triple-rail on desktop, single-rail on LOW).
  const railHeights = low ? [0.68] : [0.45, 0.72, 0.99];
  for (const rz of [hwyZ - D.highwayHalfWidth - 0.18, divZ - 0.16]) {
    for (const ry of railHeights) m.box(0, ry, rz, fullLen, 0.14, 0.09, GUARDRAIL, false);
    if (!low) {
      const postStep = fullLen / 16;
      for (let i = 0; i <= 16; i++) m.box(-halfLength + i * postStep, 0.55, rz, 0.12, 0.95, 0.12, GUARDRAIL, true);
    }
  }

  // 2. Parallel single-track railway deck fitted to baked railroad end elevations & alignment.
  m.at(0, railYMid, railZMid, railYaw, 0, railSlope);
  m.box(0, -0.16, 0, railLen, 0.32, 3.2, RAIL_BED, false);
  for (const side of [-1, 1]) {
    m.box(0, 0.07, side * (D.railGauge * 0.5), railLen, 0.14, 0.10, RAIL_STEEL, true);
  }
  if (!low) {
    const tieCount = Math.max(24, Math.round(fullLen / 2.2));
    for (let i = 0; i <= tieCount; i++) {
      const tx = -railLen * 0.5 + 0.5 + (railLen - 1.0) * (i / tieCount);
      m.box(tx, 0.02, 0, 0.24, 0.10, 2.45, RAIL_TIE, true);
    }
  }
  // Walk/service grating strip between south railbed and south truss.
  m.at(0, 0, 0);
  m.box(0, railYMid - 0.12, halfW - 0.45, fullLen, 0.22, 0.9, CONCRETE_DARK, false);

  // 3. Under-deck steel edge girders, transverse floor beams and central turntable box girders.
  for (const side of [-1, 1]) {
    m.box(0, -D.deckDepth * 0.5, side * halfW, fullLen, D.deckDepth, 0.54, GREEN_DARK, false);
  }
  const beamPositions: number[] = [];
  for (const sgn of [-1, 1]) {
    for (let i = 0; i <= D.armPanels; i++) {
      if (low && i % 2 === 1 && i !== D.armPanels) continue;
      // Inset outermost end floor beams inside ±halfLength so they never protrude past the deck ends during swing.
      const raw = cHalf + (D.armPanels - i) * pLen;
      beamPositions.push(sgn * (i === 0 ? Math.max(0, raw - 0.24) : raw));
    }
  }
  for (const bx of beamPositions) {
    m.box(bx, -D.deckDepth * 0.5 - 0.15, 0, 0.42, D.deckDepth * 0.72, D.trussWidth - 0.3, GREEN_DARK, false);
  }
  // Heavy longitudinal pivot cross-frame directly over the circular turntable.
  m.box(0, -D.deckDepth + 0.25, 0, D.centerBayLength + 0.6, 0.50, D.trussWidth - 0.4, GREEN_DARK, false);

  // 4. Twin green camelback Warren through-trusses (north z = -halfW, south z = +halfW).
  const yBot = D.chordDepth * 0.5;
  const nodeX = (sgn: number, idx: number) => sgn * (cHalf + (D.armPanels - idx) * pLen);
  for (const side of [-1, 1]) {
    const z = side * halfW;
    // Continuous bottom chord.
    m.at(0, yBot, z);
    m.box(0, 0, 0, fullLen, D.chordDepth, D.chordWidth, GREEN_CHORD, false);
    // Flat centre tower peak chord.
    trussBar(m, -cHalf - 0.15, D.peakHeight, cHalf + 0.15, D.peakHeight, z, D.chordDepth, D.chordWidth, GREEN_CHORD);
    // Centre tower X-bracing between the two tower columns.
    trussBar(m, -cHalf, yBot, cHalf, D.peakHeight, z, D.diagSize * 0.85, D.diagSize * 0.85, GREEN_WEB);
    trussBar(m, -cHalf, D.peakHeight, cHalf, yBot, z, D.diagSize * 0.85, D.diagSize * 0.85, GREEN_WEB);

    for (const sgn of [-1, 1]) {
      // Inclined end post L0 -> U1 (inset slightly at L0 so its bevel stays inside ±halfLength).
      const endInset = D.endPostSize * 0.35;
      trussBar(m, nodeX(sgn, 0) - sgn * endInset, yBot, nodeX(sgn, 1), trussNodeY(1), z, D.endPostSize, D.endPostSize, GREEN_CHORD);
      // Outer flat top chord U1 -> U3.
      trussBar(m, nodeX(sgn, 1), trussNodeY(1), nodeX(sgn, 3), trussNodeY(3), z, D.chordDepth, D.chordWidth, GREEN_CHORD);
      // Sloped upper top chord U3 -> U5 (rises cleanly toward central pivot tower).
      trussBar(m, nodeX(sgn, 3), trussNodeY(3), nodeX(sgn, 5), trussNodeY(5), z, D.chordDepth, D.chordWidth, GREEN_CHORD);

      // Vertical posts at every interior panel point (1..4) plus heavy pivot tower column at 5.
      for (let i = 1; i <= D.armPanels; i++) {
        const vx = nodeX(sgn, i), topY = trussNodeY(i);
        const sz = i === D.armPanels ? D.towerPostSize : D.verticalSize;
        m.at(vx, (yBot + topY) * 0.5, z);
        m.box(0, 0, 0, sz, topY - yBot, sz, i === D.armPanels ? GREEN_CHORD : GREEN_WEB, false);
      }

      // Alternating Warren diagonals from hip U1 to centre tower U5: U1->L2, L2->U3, U3->L4, L4->U5.
      for (let i = 1; i < D.armPanels; i++) {
        const x0 = nodeX(sgn, i), x1 = nodeX(sgn, i + 1);
        const down = i % 2 === 1;
        const y0 = down ? trussNodeY(i) : yBot;
        const y1 = down ? yBot : trussNodeY(i + 1);
        trussBar(m, x0, y0, x1, y1, z, D.diagSize, D.diagSize, GREEN_WEB);
      }
    }
  }

  // 5. Overhead portal frames, sway struts and top-lateral roof bracing.
  for (const sgn of [-1, 1]) {
    const xEnd = nodeX(sgn, 0), xHip = nodeX(sgn, 1);
    const portalT = (D.portalClearance + 0.45 - yBot) / (D.shoulderHeight - yBot);
    const xPortalLow = xEnd + (xHip - xEnd) * portalT;
    const xPortalHigh = xEnd + (xHip - xEnd) * 0.96;
    m.at(xPortalHigh, D.shoulderHeight - 0.15, 0);
    m.box(0, 0, 0, 0.46, 0.42, D.trussWidth, GREEN_CHORD, false);
    m.at(xPortalLow, D.portalClearance + 0.45, 0);
    m.box(0, 0, 0, 0.36, 0.34, D.trussWidth, GREEN_WEB, false);
    if (!low) {
      for (const side of [-1, 1]) {
        crossBar(m, xPortalLow, D.portalClearance + 0.45, side * (halfW - 1.8), D.shoulderHeight - 0.2, side * halfW, 0.24, 0.24, GREEN_WEB);
      }
    }

    // Overhead transverse top struts at interior top-chord joints.
    for (let i = 1; i <= D.armPanels; i++) {
      const tx = nodeX(sgn, i), ty = trussNodeY(i);
      m.at(tx, ty - 0.12, 0);
      m.box(0, 0, 0, 0.34, 0.32, D.trussWidth, i === D.armPanels ? GREEN_CHORD : GREEN_WEB, false);
      if (i === D.armPanels || (!low && i === 3)) {
        const lowY = i === D.armPanels ? D.portalClearance + 1.2 : D.portalClearance + 0.5;
        m.at(tx, lowY, 0);
        m.box(0, 0, 0, 0.28, 0.28, D.trussWidth, GREEN_WEB, false);
        if (!low) {
          for (const side of [-1, 1]) {
            crossBar(m, tx, lowY, side * (halfW - 2.2), ty - 0.15, side * halfW, 0.22, 0.22, GREEN_WEB);
          }
        }
      }
    }

    // Top-lateral diagonal X-bracing between outer top chords (desktop only).
    if (!low) {
      for (let i = 1; i < D.armPanels; i++) {
        const x0 = nodeX(sgn, i), x1 = nodeX(sgn, i + 1);
        const yMid = (trussNodeY(i) + trussNodeY(i + 1)) * 0.5 - 0.12;
        flatBar(m, x0, -halfW, x1, halfW, yMid, 0.18, 0.20, GREEN_WEB);
        flatBar(m, x0, halfW, x1, -halfW, yMid, 0.18, 0.20, GREEN_WEB);
      }
    }
  }
  if (!low) {
    flatBar(m, -cHalf, -halfW, cHalf, halfW, D.peakHeight - 0.14, 0.20, 0.22, GREEN_WEB);
    flatBar(m, -cHalf, halfW, cHalf, -halfW, D.peakHeight - 0.14, 0.20, 0.22, GREEN_WEB);
  }

  return m.geometry();
}

function buildBaseGeometry(halfLength: number, openDeltaYaw: number, low: boolean, rail: RailProfile): THREE.BufferGeometry {
  const D = SWING_BRIDGE;
  const m = new Mesher();
  const hwyZ = -D.pivotAcross;
  const railEastZ = rail.eastAcross - D.pivotAcross;
  const pierSeg = low ? 10 : 16;

  // 1. Circular concrete pivot pier + coping cap + steel turntable ring girder under local (0, 0, 0).
  const drumTop = -D.deckDepth - 0.10;
  const drumBottom = drumTop - D.turntableHeight;
  const pierHeight = D.foundationDrop - (D.deckDepth + 0.10 + D.turntableHeight);
  m.at(0, 0, 0);
  m.cyl(0, (drumTop + drumBottom) * 0.5, 0, D.turntableRadius, D.turntableHeight, GREEN_DARK, 'y', pierSeg);
  m.cyl(0, drumBottom - 0.22, 0, D.pivotPierRadius + 0.28, 0.44, CONCRETE, 'y', pierSeg);
  m.cyl(0, drumBottom - 0.44 - pierHeight * 0.5, 0, D.pivotPierRadius, pierHeight, CONCRETE_DARK, 'y', pierSeg, D.pivotPierRadius, null);

  // 2. East & West concrete abutments (bridge seats below sloped closed girder, backwalls outside the circular swing arc).
  const seatTop = -D.deckDepth - 0.14;
  const abutH = D.foundationDrop - D.deckDepth - 0.14;
  const abutW = D.trussWidth + 1.4;
  const backFront = halfLength + D.swingClearance;
  const backThick = 1.15;
  for (const sgn of [-1, 1]) {
    // Bridge seat shelf beneath the truss ends.
    m.at(sgn * (halfLength + 0.95), seatTop - abutH * 0.5, 0);
    m.box(0, 0, 0, 2.6, abutH, abutW, CONCRETE, true);
    // Backwall strictly outside ±(halfLength + swingClearance), clearing the entire circular swing sweep.
    const backTop = Math.min(-0.34, rail.eastBaseY - 0.18);
    const backH = backTop - seatTop;
    if (backH > 0.05) {
      m.at(sgn * (backFront + backThick * 0.5), seatTop + backH * 0.5, 0);
      m.box(0, 0, 0, backThick, backH, abutW + 0.4, CONCRETE, true);
    }
    if (!low) {
      for (const side of [-1, 1]) {
        m.at(sgn * (backFront + 2.1), -1.9, side * (abutW * 0.5 + 0.15));
        m.box(0, 0, 0, 3.6, 3.3, 0.65, CONCRETE_DARK, true);
      }
    }
  }

  // Short static east railway approach apron closing the overhang of hidden baked span -100095.
  // Starts at halfLength + swingClearance so the rotating truss corner clears it cleanly, flush with baked railY1.
  const apronStart = halfLength + D.swingClearance;
  const apronEnd = halfLength + rail.eastTail + 0.15;
  const apronLen = apronEnd - apronStart;
  if (apronLen > 0.2) {
    const tailMid = (apronStart + apronEnd) * 0.5;
    const railTop = rail.eastBaseY;
    m.at(tailMid, railTop - 0.16, railEastZ);
    m.box(0, 0, 0, apronLen, 0.32, 3.2, RAIL_BED, false);
    for (const side of [-1, 1]) {
      m.at(tailMid, railTop + 0.07, railEastZ + side * (D.railGauge * 0.5));
      m.box(0, 0, 0, apronLen, 0.14, 0.10, RAIL_STEEL, true);
    }
  }

  // 3. West-bank swing rest piers and canal protection fender line along the open-span axis.
  m.at(0, 0, 0, openDeltaYaw);
  const restH = D.foundationDrop - D.deckDepth - 0.16;
  for (const sgn of [-1, 1]) {
    m.box(sgn * (halfLength - 5.5), seatTop - restH * 0.5, 0, 2.0, restH, 5.2, CONCRETE_DARK, true);
    m.box(sgn * (halfLength - 5.5), seatTop - 0.18, 0, 2.35, 0.36, 5.6, CONCRETE, true);
  }
  // Canal-side timber/concrete guide fender west of the 24.4 m navigation channel (local z = -7.35 m in open frame).
  const fenderZ = -(D.trussWidth * 0.5 + 0.95);
  m.box(0, seatTop - 2.6, fenderZ, 34, 4.6, 1.0, FENDER_TIMBER, true);
  if (!low) {
    for (let x = -16; x <= 16; x += 4) {
      m.box(x, seatTop - 2.5, fenderZ - 0.45, 0.45, 4.2, 0.45, FENDER_TIMBER, true);
    }
  }

  // 4. Iconic green curved-corner highway signal portal arches at both approaches (clear of the 9 m barrier arm).
  for (const sgn of [-1, 1]) {
    const px = sgn * (halfLength + D.portalOffset);
    const legW = 0.56, legD = 0.58;
    const hClear = D.portalClearHeight, hTop = D.portalTopHeight;
    const beamH = hTop - hClear;
    const halfSpan = D.portalHalfWidth;
    for (const side of [-1, 1]) {
      crossBar(m, px, hClear - 0.85, hwyZ + side * halfSpan, hClear + 0.15, hwyZ + side * (halfSpan - 1.0), legD * 0.95, 0.46, GREEN_PORTAL);
      m.at(px, 0, hwyZ);
      const lz = side * (halfSpan + legW * 0.5);
      m.box(0, (hTop - 1.0) * 0.5, lz, legD, hTop + 1.0, legW, GREEN_PORTAL, true);
      m.box(0, 0.35, lz, legD * 1.45, 1.7, legW * 1.65, GREEN_PORTAL, true);
      const sigZ = side * (halfSpan + legW + 0.34);
      const sigY = 4.25;
      m.box(sgn * 0.12, sigY, sigZ, 0.38, 1.18, 0.38, SIGNAL_YELLOW, false);
      if (!low) {
        m.box(sgn * 0.04, sigY, side * (halfSpan + legW + 0.12), 0.10, 0.12, 0.32, SIGNAL_YELLOW, false);
        m.box(sgn * 0.33, sigY + 0.34, sigZ, 0.08, 0.22, 0.22, SIGNAL_RED, false);
        m.box(sgn * 0.33, sigY, sigZ, 0.08, 0.22, 0.22, SIGNAL_YELLOW, false);
        m.box(sgn * 0.33, sigY - 0.34, sigZ, 0.08, 0.22, 0.22, SIGNAL_GREEN, false);
      } else {
        m.box(sgn * 0.33, sigY, sigZ, 0.08, 0.84, 0.22, SIGNAL_DARK, false);
      }
    }
    m.at(px, 0, hwyZ);
    m.box(0, hClear + beamH * 0.5, 0, legD, beamH, (halfSpan + legW) * 2, GREEN_PORTAL, false);
    m.box(sgn * (legD * 0.5 + 0.03), hClear + beamH * 0.5, 0, 0.06, beamH * 0.68, halfSpan * 1.75, GREEN_SIGN, false);
  }

  return m.geometry();
}

export interface SwingBridgeStats {
  readonly draws: number;
  readonly triangles: number;
  readonly baseTriangles: number;
  readonly spanTriangles: number;
}

/**
 * Canso Causeway swing bridge: one static substructure mesh and one rotating through-truss span mesh
 * (2 main-pass draws; on desktop daylight shadows also submit both meshes into the shadow pass;
 * on phone LOW, shadows are off so total is 2 draws). Shares the existing vertex-coloured Lambert
 * material with zero textures and zero per-frame allocations.
 */
export class SwingBridge {
  readonly group = new THREE.Group();
  readonly baseMesh: THREE.Mesh;
  readonly spanMesh: THREE.Mesh;
  readonly pivot: THREE.Vector2;
  readonly baseYaw: number;
  readonly openDeltaYaw: number;
  readonly halfLength: number;
  readonly low: boolean;
  stats: SwingBridgeStats;
  swing = 0;
  private railProfile: RailProfile;

  constructor(
    centre: THREE.Vector2,
    along: THREE.Vector2,
    halfLength: number,
    material: THREE.Material,
    low = false,
    railJoin?: RailJoinSpec,
  ) {
    this.low = low;
    this.halfLength = halfLength;
    this.baseYaw = Math.atan2(-along.y, along.x);
    this.openDeltaYaw = swingOpenDeltaYaw(along.x, along.y);
    this.pivot = new THREE.Vector2(
      centre.x - along.y * SWING_BRIDGE.pivotAcross,
      centre.y + along.x * SWING_BRIDGE.pivotAcross,
    );
    this.railProfile = {
      westDrop: SWING_BRIDGE.railDeckDrop,
      eastDrop: SWING_BRIDGE.railDeckDrop,
      eastBaseY: -SWING_BRIDGE.railDeckDrop,
      westAcross: railJoin?.westAcross ?? SWING_BRIDGE.railAcross,
      eastAcross: railJoin?.eastAcross ?? SWING_BRIDGE.railAcross,
      eastTail: railJoin?.eastTail ?? SWING_BRIDGE.eastRailTail,
    };

    const baseGeo = buildBaseGeometry(halfLength, this.openDeltaYaw, low, this.railProfile);
    const spanGeo = buildSpanGeometry(halfLength, low, this.railProfile);
    this.baseMesh = new THREE.Mesh(baseGeo, material);
    this.baseMesh.name = 'Canso swing bridge substructure';
    this.baseMesh.rotation.order = 'YXZ';
    this.baseMesh.rotation.y = this.baseYaw;
    this.baseMesh.receiveShadow = true;
    this.baseMesh.castShadow = !low;

    this.spanMesh = new THREE.Mesh(spanGeo, material);
    this.spanMesh.name = 'Canso swing bridge span';
    this.spanMesh.rotation.order = 'YXZ';
    this.spanMesh.rotation.y = this.baseYaw;
    this.spanMesh.receiveShadow = true;
    this.spanMesh.castShadow = !low;

    this.stats = this.measureStats(baseGeo, spanGeo);
    this.group.name = 'Canso swing bridge';
    this.group.add(this.baseMesh, this.spanMesh);
    this.group.visible = false;
  }

  private measureStats(baseGeo: THREE.BufferGeometry, spanGeo: THREE.BufferGeometry): SwingBridgeStats {
    const triCount = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;
    const baseTriangles = triCount(baseGeo), spanTriangles = triCount(spanGeo);
    return { draws: 2, triangles: baseTriangles + spanTriangles, baseTriangles, spanTriangles };
  }

  /**
   * Place both meshes at the live baked deck elevation and rotate the swinging truss by `swing` in [0, 1].
   * When baked parallel railroad elevations (`railY0`, `railY1`) are supplied, refit the railbed and east
   * apron once if needed so both rail joins stay flush at every Hill scale (exag 1.0..2.5).
   */
  setPose(y0: number, y1: number, swing: number, railY0: number | null = null, railY1: number | null = null): void {
    const s = Math.max(0, Math.min(1, swing));
    const yMid = (y0 + y1) * 0.5;
    const slope = Math.atan2(y1 - y0, this.halfLength * 2);
    const westDrop = railY0 !== null ? y0 - railY0 : SWING_BRIDGE.railDeckDrop;
    const eastDrop = railY1 !== null ? y1 - railY1 : SWING_BRIDGE.railDeckDrop;
    const eastBaseY = railY1 !== null ? railY1 - yMid : (y1 - y0) * 0.5 - eastDrop;
    const cur = this.railProfile;
    if (
      Math.abs(westDrop - cur.westDrop) > 0.005 ||
      Math.abs(eastDrop - cur.eastDrop) > 0.005 ||
      Math.abs(eastBaseY - cur.eastBaseY) > 0.005
    ) {
      this.railProfile = { ...cur, westDrop, eastDrop, eastBaseY };
      const baseGeo = buildBaseGeometry(this.halfLength, this.openDeltaYaw, this.low, this.railProfile);
      const spanGeo = buildSpanGeometry(this.halfLength, this.low, this.railProfile);
      this.baseMesh.geometry.dispose();
      this.spanMesh.geometry.dispose();
      this.baseMesh.geometry = baseGeo;
      this.spanMesh.geometry = spanGeo;
      this.stats = this.measureStats(baseGeo, spanGeo);
    }
    this.swing = s;
    this.baseMesh.position.set(this.pivot.x, yMid, this.pivot.y);
    this.spanMesh.position.set(this.pivot.x, yMid, this.pivot.y);
    this.spanMesh.rotation.y = this.baseYaw + this.openDeltaYaw * s;
    this.spanMesh.rotation.z = slope * (1 - s);
    this.group.visible = true;
  }
}
