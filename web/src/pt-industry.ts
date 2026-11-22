import * as THREE from 'three';
import { untoned } from './finish-shaders';
import {
  COAL_CONVEYORS, COAL_MOUNDS, COAL_PIER, COAL_YARD, NORTH_BULK_PIER, OIL_TERMINAL, PAPER_WHARF, POWER_PLANT,
  type CoalMoundGrid, type ConveyorRun, type DolphinSpec,
} from './pt-industry-data';

export type IndustryKind = 'box' | 'cyl' | 'taper';

export interface PlannedPiece {
  readonly kind: IndustryKind;
  readonly site: 'plant' | 'coal' | 'oil-pier' | 'coal-pier' | 'paper-wharf' | 'north-bulk';
  /** Map coordinates (EPSG:2961) of the piece centre, for clearance checks. */
  readonly e: number;
  readonly n: number;
  /** Baked ground elevation (metres CGVD2013) under the piece. */
  readonly baseG: number;
  /** Lowest point of the piece above ground (or sea when baseG <= sea), in true metres. */
  readonly clearance: number;
  readonly matrix: THREE.Matrix4;
  readonly color: number;
  /** World-space endpoints [A, B] for span pieces, so checks can verify transformed orientation and length. */
  readonly spanEnds?: readonly [THREE.Vector3, THREE.Vector3];
}

export interface PlannedLight {
  readonly e: number;
  readonly n: number;
  readonly y: number;
  readonly radius: number;
  readonly color: number;
}

export interface IndustryPlan {
  readonly pieces: PlannedPiece[];
  readonly lights: PlannedLight[];
}

/** Vertical ground stretch matches terrain.ts and buildings.ts: dry ground stretches, sea stays unstretched. */
export function industryGround(base: number, exag: number, sea: number): number {
  return base > sea ? sea + (base - sea) * exag : base;
}

/**
 * Clears bogus HRDEM DSM canopy returns over the open-water oil and coal marine piers where our
 * instanced pier, crane and loading-arm meshes replace the baked water-surface returns.
 * Strictly seaward of the shoreline so onshore trees are untouched.
 */
export function ptIndustryCanopyExcludes(east: number, north: number): boolean {
  // Oil Marine Terminal offshore water zone (Berth 1, Berth 2, offshore approach & 11 dolphins; strictly seaward of shore).
  if (east >= 628985 && east <= 629360 && north >= 5047795 && north <= 5048315) {
    // Strictly SW of the shoreline boundary passing through (629356, 5048109) so dry shore around (629360, 5048120) stays untouched.
    if ((east - 629356) * 0.85 + (north - 5048109) * 0.52 <= 0) return true;
  }
  // Coal Marine Terminal offshore pier head, ship unloader, hopper, flanking dolphins & offshore trestle.
  if (east >= 628395 && east <= 629000 && north >= 5048800 && north <= 5049015) {
    if ((east - 628995) * 0.90 + (north - 5048998) * 0.44 <= 0) return true;
  }
  return false;
}

// Industrial palette: weathered reinforced concrete, Maritime thermal-plant blue-grey cladding, dark structural steel,
// galvanized conveyor galleries, safety-yellow/orange crane & loading-arm accents, black marine rubber fenders.
const C = {
  concreteLight: 0xb7b5ac,
  concreteMid: 0x9c9b92,
  concreteDark: 0x7b7a73,
  concreteSoot: 0x52524f,
  flueSteel: 0x3b3e42,
  plantClad: 0x768590,
  plantCladAlt: 0x62717c,
  plantRib: 0x8d9aa3,
  plantLouver: 0x2d353c,
  plantTrim: 0x454d54,
  steelDark: 0x434a50,
  steelMid: 0x5c646b,
  steelGalv: 0x8c9398,
  galleryWall: 0x778087,
  galleryRoof: 0x596268,
  pipeGrey: 0xadb4b8,
  pipeWhite: 0xd5d8d7,
  armWhite: 0xdce0e1,
  armGrey: 0x899299,
  accentOrange: 0xc95a2b,
  accentYellow: 0xd4a428,
  craneBlue: 0x3b6382,
  fenderBlack: 0x1c1e21,
  siloTan: 0x9e9b8e,
  xfmrGrey: 0x566066,
  insulator: 0x7c5a46,
  lightRed: 0xff2211,
  lightGreen: 0x28e868,
  lightSodium: 0xffb84d,
  lightFlood: 0xffe4ad,
} as const;

const UP = new THREE.Vector3(0, 1, 0);
const ALT = new THREE.Vector3(1, 0, 0);

/**
 * Pure planner: computes every instanced piece and night light in world coordinates for the given
 * vertical exaggeration, sea level and quality level. Exported so Node checks can verify clearances
 * against roads, baked buildings and #112 power lines without starting a browser.
 */
export function planPointTupperIndustry(
  village: readonly [number, number],
  exag: number,
  sea: number,
  low: boolean,
  night: boolean,
): IndustryPlan {
  const pieces: PlannedPiece[] = [];
  const lights: PlannedLight[] = [];
  const [VE, VN] = village;
  const obj = new THREE.Object3D();
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vDelta = new THREE.Vector3();
  const vRight = new THREE.Vector3(), vVert = new THREE.Vector3(), mBasis = new THREE.Matrix4();

  const wx = (e: number) => e - VE;
  const wz = (n: number) => VN - n;
  const wy = (base: number, lift = 0) => industryGround(base, exag, sea) + lift;
  /** Matches web/src/buildings.ts:236 verbatim (stretches all building bases about seaLevel, even below sea). */
  const buildingBaseY = (g: number) => sea + (g - sea) * exag;

  const pushMatrix = (
    kind: IndustryKind, site: PlannedPiece['site'], e: number, n: number, baseG: number,
    clearance: number, matrix: THREE.Matrix4, color: number,
    spanEnds?: readonly [THREE.Vector3, THREE.Vector3],
  ) => {
    pieces.push({ kind, site, e, n, baseG, clearance, matrix: matrix.clone(), color, ...(spanEnds ? { spanEnds } : {}) });
  };

  /** Place an upright box/cylinder/frustum centred at (e, n), base at wy(baseG, yBot), total height h. */
  const upright = (
    kind: IndustryKind, site: PlannedPiece['site'], e: number, n: number, baseG: number,
    yBot: number, sx: number, h: number, sz: number, yawRad: number, color: number,
  ) => {
    obj.position.set(wx(e), wy(baseG, yBot + h / 2), wz(n));
    obj.rotation.set(0, yawRad, 0);
    obj.scale.set(sx, h, sz);
    obj.updateMatrix();
    pushMatrix(kind, site, e, n, baseG, yBot, obj.matrix, color);
  };

  /** Place a box or cylinder spanning from world point A to world point B with upright cross-section (width x height). */
  const span = (
    kind: 'box' | 'cyl', site: PlannedPiece['site'],
    ae: number, an: number, ag: number, aLift: number,
    be: number, bn: number, bg: number, bLift: number,
    width: number, height: number, color: number,
  ) => {
    vA.set(wx(ae), wy(ag, aLift), wz(an));
    vB.set(wx(be), wy(bg, bLift), wz(bn));
    vDelta.subVectors(vB, vA);
    const len = vDelta.length();
    if (len < 1e-4) return;
    const dir = vDelta.clone().divideScalar(len);
    vRight.crossVectors(Math.abs(dir.y) > 0.999 ? ALT : UP, dir).normalize();
    vVert.crossVectors(dir, vRight).normalize();
    obj.position.copy(vA).add(vB).multiplyScalar(0.5);
    if (kind === 'cyl') {
      // CylinderGeometry axis is +Y: map local +Y to dir, +X to right, +Z to -vert so det = +1 (right-handed).
      mBasis.makeBasis(vRight, dir, vVert.negate());
      obj.quaternion.setFromRotationMatrix(mBasis);
      obj.scale.set(width, len, height);
    } else {
      mBasis.makeBasis(vRight, vVert, dir);
      obj.quaternion.setFromRotationMatrix(mBasis);
      obj.scale.set(width, height, len);
    }
    obj.updateMatrix();
    const clear = Math.min(aLift, bLift) - height / 2;
    pushMatrix(kind, site, (ae + be) / 2, (an + bn) / 2, (ag + bg) / 2, clear, obj.matrix, color, [vA.clone(), vB.clone()]);
  };

  const addLight = (e: number, n: number, baseG: number, lift: number, radius: number, color: number) => {
    if (night) lights.push({ e, n, y: wy(baseG, lift), radius, color });
  };

  /** Helper for a local frame anchored at (e, n) with +u along compass azimuth azDeg and +v to its right (azDeg + 90). */
  const frame = (e: number, n: number, azDeg: number) => {
    const a = azDeg * Math.PI / 180, s = Math.sin(a), c = Math.cos(a);
    const yaw = -a; // Three.js rotation about Y so local -z points along azDeg, +x along azDeg + 90
    return {
      pt: (u: number, v: number): [number, number] => [e + u * s + v * c, n + u * c - v * s],
      yaw,
    };
  };

  // ==========================================================================================================
  // 1. POINT TUPPER POWER PLANT: 101 m concrete stack, ESP, boiler house architecture, ash silo, intake, switchyard
  // ==========================================================================================================
  {
    const { stack, esp, ashSilo, blocks, crusher, transferNorth, transformers, intake } = POWER_PLANT;

    // --- 101 m tapered reinforced concrete stack (one continuous frustum + plinth + cornice + steel flue liner) ---
    // Taper geometry has top radius = 0.265 and bottom radius = 0.50 (ratio 0.53, matching 2.46 m / 4.65 m).
    upright('cyl', 'plant', stack.e, stack.n, stack.g, -2.0, stack.baseR * 2.24, 7.2, stack.baseR * 2.24, 0, C.concreteDark);
    upright('taper', 'plant', stack.e, stack.n, stack.g, -2.0, stack.baseR * 2.02, stack.height + 2.0, stack.baseR * 2.02, 0, C.concreteLight);
    // Subtle concrete slip-form expansion rings up the shaft
    for (const rh of [28.0, 52.0, 78.0]) {
      const r = stack.baseR + (stack.topR - stack.baseR) * (rh / stack.height);
      upright('cyl', 'plant', stack.e, stack.n, stack.g, rh, (r + 0.14) * 2, 0.55, (r + 0.14) * 2, 0, C.concreteMid);
    }
    // Slender concrete crown rim and protruding dark-steel inner flue liner
    upright('cyl', 'plant', stack.e, stack.n, stack.g, 99.8, stack.topR * 2.16, 1.35, stack.topR * 2.16, 0, C.concreteDark);
    upright('cyl', 'plant', stack.e, stack.n, stack.g, 100.6, stack.topR * 1.44, 4.2, stack.topR * 1.44, 0, C.flueSteel);

    // Two steel inspection & aircraft-warning galleries (at 66 m and 94 m) + vertical caged ladder
    for (const gh of [66.0, 94.0]) {
      const r = stack.baseR + (stack.topR - stack.baseR) * (gh / stack.height);
      upright('cyl', 'plant', stack.e, stack.n, stack.g, gh, (r + 1.05) * 2, 0.30, (r + 1.05) * 2, 0, C.steelDark);
      if (!low) {
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2;
          const pe = stack.e + Math.cos(ang) * (r + 0.96), pn = stack.n + Math.sin(ang) * (r + 0.96);
          upright('box', 'plant', pe, pn, stack.g, gh, 0.14, 1.15, 0.14, 0, C.steelMid);
        }
      }
      // Red aviation obstruction lights (3 around each gallery tier)
      for (let k = 0; k < 3; k++) {
        const ang = (k / 3) * Math.PI * 2 + 0.4;
        const lr = r + 1.05;
        addLight(stack.e + Math.cos(ang) * lr, stack.n + Math.sin(ang) * lr, stack.g, gh + (gh > 90 ? 6.8 : 1.4), 1.05, C.lightRed);
      }
    }
    // Vertical service ladder spine up the SE face of the stack
    span('box', 'plant', stack.e + 3.8, stack.n - 2.6, stack.g, 2.0, stack.e + 2.3, stack.n - 1.6, stack.g, 96.0, 0.65, 0.45, C.steelDark);

    // --- Electrostatic Precipitator (ESP) & Flue-Gas Breeching Ducts ---
    const ef = frame(esp.e, esp.n, esp.axisDeg);
    // Main elevated steel precipitator casing supported on 8 heavy steel H-columns
    upright('box', 'plant', esp.e, esp.n, esp.g, 9.5, 11.5, 13.5, 28.0, ef.yaw, C.plantCladAlt);
    upright('box', 'plant', esp.e, esp.n, esp.g, 23.0, 12.1, 0.7, 28.6, ef.yaw, C.plantTrim);
    // 6 pyramidal fly-ash hoppers under the ESP casing + support legs
    for (const u of [-9.5, 0, 9.5]) {
      for (const v of [-3.0, 3.0]) {
        const [he, hn] = ef.pt(u, v);
        // Inverted hopper via small box + tapered frustum pointing down
        obj.position.set(wx(he), wy(esp.g, 7.2), wz(hn));
        obj.rotation.set(Math.PI, ef.yaw, 0);
        obj.scale.set(4.2, 4.6, 4.2);
        obj.updateMatrix();
        pushMatrix('taper', 'plant', he, hn, esp.g, 4.9, obj.matrix, C.steelDark);
      }
      for (const v of [-5.2, 5.2]) {
        const [le, ln] = ef.pt(u, v);
        upright('box', 'plant', le, ln, esp.g, -1.5, 0.55, 11.5, 0.55, ef.yaw, C.steelDark);
      }
    }
    // Horizontal steel flue-gas breeching duct from ESP directly into the 101 m concrete stack
    span('box', 'plant', esp.e, esp.n, esp.g, 14.5, stack.e, stack.n, stack.g, 14.5, 5.2, 4.6, C.steelMid);
    // Upper boiler outlet ducts feeding into the ESP
    span('box', 'plant', 628871.0, 5049451.0, 3.87, 22.0, esp.e, esp.n, esp.g, 19.0, 4.6, 4.2, C.steelMid);
    span('box', 'plant', 628874.0, 5049464.0, 3.87, 22.0, esp.e, esp.n + 7, esp.g, 19.0, 4.2, 3.8, C.steelMid);

    // --- Fly-Ash Storage Silo (east of the precipitator) ---
    upright('cyl', 'plant', ashSilo.e, ashSilo.n, ashSilo.g, 6.5, 8.6, 16.0, 8.6, 0, C.siloTan);
    upright('taper', 'plant', ashSilo.e, ashSilo.n, ashSilo.g, 22.4, 8.8, 2.2, 8.8, 0, C.steelMid);
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2;
      upright('box', 'plant', ashSilo.e + Math.cos(ang) * 3.8, ashSilo.n + Math.sin(ang) * 3.8, ashSilo.g, -1.0, 0.45, 8.0, 0.45, 0, C.steelDark);
    }
    // Ash pneumatic transfer pipe from ESP hoppers to fly-ash silo
    span('cyl', 'plant', esp.e + 4, esp.n + 3, esp.g, 12.0, ashSilo.e, ashSilo.n, ashSilo.g, 21.5, 0.65, 0.65, C.pipeGrey);

    // --- Boiler House & Turbine Hall Architectural Dressing (hugging the 12 baked blocks of id 85) ---
    for (const b of blocks) {
      const bf = frame(b.e, b.n, b.axisDeg);
      const hL = b.length / 2, hW = b.width / 2;
      // Roof parapet coping framing each block's roofline
      for (const side of [-1, 1]) {
        const [pe, pn] = bf.pt(0, side * (hW + 0.15));
        upright('box', 'plant', pe, pn, b.g, b.eave - 0.4, 0.55, 1.15, b.length + 0.5, bf.yaw, C.plantTrim);
        const [ee, en] = bf.pt(side * (hL + 0.15), 0);
        upright('box', 'plant', ee, en, b.g, b.eave - 0.4, b.width + 0.5, 1.15, 0.55, bf.yaw, C.plantTrim);
      }
      if (b.role === 'boiler' && b.eave > 35) {
        // Horizontal architectural belt courses & dark industrial louver/clerestory bands on tall boiler blocks
        for (const frac of [0.36, 0.68, 0.90]) {
          const bandY = b.eave * frac;
          const isLouver = frac > 0.8;
          const col = isLouver ? C.plantLouver : C.plantCladAlt;
          const bh = isLouver ? 2.6 : 1.4;
          for (const side of [-1, 1]) {
            const [pe, pn] = bf.pt(0, side * (hW + 0.28));
            upright('box', 'plant', pe, pn, b.g, bandY, 0.36, bh, b.length + 0.4, bf.yaw, col);
            const [ee, en] = bf.pt(side * (hL + 0.28), 0);
            upright('box', 'plant', ee, en, b.g, bandY, b.width + 0.4, bh, 0.36, bf.yaw, col);
          }
        }
        // Vertical corrugated structural steel pilasters along the long walls (spaced every 9 m; fewer on LOW)
        const stride = low ? 14 : 9;
        const count = Math.max(2, Math.floor(b.length / stride));
        for (let i = 0; i <= count; i++) {
          const u = -hL + (i / count) * b.length;
          for (const side of [-1, 1]) {
            const [pe, pn] = bf.pt(u, side * (hW + 0.32));
            upright('box', 'plant', pe, pn, b.g, 0.5, 0.48, b.eave - 0.8, 0.62, bf.yaw, C.plantRib);
          }
        }
      } else if (b.role === 'turbine') {
        // Turbine hall horizontal clerestory window/louver ribbon + structural columns
        for (const side of [-1, 1]) {
          const [pe, pn] = bf.pt(0, side * (hW + 0.26));
          upright('box', 'plant', pe, pn, b.g, b.eave * 0.72, 0.32, 3.0, b.length + 0.3, bf.yaw, C.plantLouver);
          upright('box', 'plant', pe, pn, b.g, b.eave * 0.42, 0.32, 1.1, b.length + 0.3, bf.yaw, C.plantClad);
        }
        const stride = low ? 14 : 8.5;
        const count = Math.max(2, Math.floor(b.length / stride));
        for (let i = 0; i <= count; i++) {
          const u = -hL + (i / count) * b.length;
          for (const side of [-1, 1]) {
            const [pe, pn] = bf.pt(u, side * (hW + 0.30));
            upright('box', 'plant', pe, pn, b.g, 0.5, 0.42, b.eave - 0.8, 0.52, bf.yaw, C.plantRib);
          }
        }
      }
    }

    // Rooftop Boiler Penthouse / Steam-Drum Monitor atop the tallest block (id 3212, 48.39 m)
    const topBlock = blocks.find(b => b.id === 3212)!;
    const tf = frame(topBlock.e, topBlock.n, topBlock.axisDeg);
    upright('box', 'plant', topBlock.e, topBlock.n, topBlock.g, topBlock.eave, 12.5, 6.2, 13.5, tf.yaw, C.plantClad);
    upright('box', 'plant', topBlock.e, topBlock.n, topBlock.g, topBlock.eave + 3.8, 12.9, 1.6, 13.9, tf.yaw, C.plantLouver);
    upright('box', 'plant', topBlock.e, topBlock.n, topBlock.g, topBlock.eave + 6.2, 13.2, 0.55, 14.2, tf.yaw, C.plantTrim);
    // Four vertical cylindrical steam safety-valve exhaust silencers along the boiler roof
    for (const [e, n, g, baseY, h] of [
      [628858.0, 5049490.0, 7.21, 41.4, 8.5],
      [628864.0, 5049506.0, 7.21, 41.4, 7.2],
      [628869.0, 5049448.0, 3.87, 45.1, 8.0],
      [628850.0, 5049445.0, 3.91, 44.8, 6.8],
    ] as const) {
      upright('cyl', 'plant', e, n, g, baseY, 1.35, h, 1.35, 0, C.steelGalv);
      upright('cyl', 'plant', e, n, g, baseY + h - 0.8, 1.85, 1.1, 1.85, 0, C.steelDark);
    }

    // Exterior Steel Stair/Elevator Tower on the SW boiler house wall + Coal Bunker Tripper Bay on the east wall
    const stairE = 628826.5, stairN = 5049440.0, stairG = 3.91;
    upright('box', 'plant', stairE, stairN, stairG, 0, 4.6, 44.5, 4.6, tf.yaw, C.plantCladAlt);
    for (let y = 8; y <= 40; y += 8) {
      upright('box', 'plant', stairE, stairN, stairG, y, 5.1, 0.45, 5.1, tf.yaw, C.steelDark);
    }
    // Upper coal bunker tripper bay receiving the inclined coal conveyor at ~36 m
    upright('box', 'plant', 628876.0, 5049456.0, 4.29, 32.5, 9.0, 7.5, 14.0, ef.yaw, C.galleryWall);

    // Crusher House (id 29) & North Transfer House (id 2125) industrial headhouse crowns
    const cf = frame(crusher.e, crusher.n, crusher.axisDeg);
    upright('box', 'plant', crusher.e, crusher.n, crusher.g, crusher.eave, 13.0, 5.6, 12.0, cf.yaw, C.galleryWall);
    upright('box', 'plant', crusher.e, crusher.n, crusher.g, crusher.eave + 3.2, 13.4, 1.4, 12.4, cf.yaw, C.plantLouver);
    const nf = frame(transferNorth.e, transferNorth.n, transferNorth.axisDeg);
    upright('box', 'plant', transferNorth.e, transferNorth.n, transferNorth.g, transferNorth.eave, 12.5, 8.2, 11.5, nf.yaw, C.galleryWall);
    upright('box', 'plant', transferNorth.e, transferNorth.n, transferNorth.g, transferNorth.eave + 5.0, 12.9, 1.4, 11.9, nf.yaw, C.plantLouver);

    // Cooling-water intake screenhouse gantry at the canal mouth (id 2116)
    const inf = frame(intake.e, intake.n, intake.axisDeg);
    const [ie, in_] = inf.pt(-9.5, 0);
    upright('box', 'plant', ie, in_, intake.g, -1.5, 11.5, 3.2, 4.5, inf.yaw, C.concreteMid);
    for (const s of [-4.5, 4.5]) {
      const [ge, gn] = inf.pt(-9.5, s);
      upright('box', 'plant', ge, gn, intake.g, 1.5, 0.55, 6.5, 0.55, inf.yaw, C.steelDark);
    }
    upright('box', 'plant', ie, in_, intake.g, 7.6, 10.2, 0.8, 0.9, inf.yaw, C.accentYellow);

    // Step-up Generator Transformers & low bus portals in the substation yard (clear of #112 towers)
    for (const tr of transformers) {
      upright('box', 'plant', tr.e, tr.n, tr.g, 0, 5.2, 4.4, 3.6, 0.3, C.xfmrGrey);
      upright('box', 'plant', tr.e, tr.n - 2.6, tr.g, 0, 6.2, 5.4, 0.45, 0.3, C.concreteMid); // concrete blast wall
      for (const bx of [-1.4, 0, 1.4]) {
        upright('cyl', 'plant', tr.e + bx, tr.n, tr.g, 4.4, 0.36, 2.6, 0.36, 0, C.insulator);
      }
    }

    // Plant exterior night work lights (boiler house facade, turbine hall, crusher, transfer house, intake)
    for (const [le, ln, lg, ly, col] of [
      [628796, 5049472, 5.41, 23, C.lightSodium],
      [628816, 5049496, 5.41, 23, C.lightSodium],
      [628836, 5049430, 3.91, 26, C.lightFlood],
      [628852, 5049428, 3.91, 41, C.lightFlood],
      [628876, 5049448, 3.87, 36, C.lightSodium],
      [628862, 5049522, 7.21, 36, C.lightSodium],
      [628895, 5049458, 5.43, 22, C.lightSodium],
      [628925, 5049435, 5.51, 20, C.lightSodium],
      [629041, 5049362, 12.95, 17, C.lightSodium],
      [628686, 5049315, 1.62, 8.5, C.lightFlood],
    ] as const) {
      addLight(le, ln, lg, ly, 0.95, col);
    }
  }

  // ==========================================================================================================
  // 2. CONVEYOR HELPER (enclosed steel corrugated galleries + steel truss chords + braced A-frame bents)
  // ==========================================================================================================
  const buildConveyor = (run: ConveyorRun, site: PlannedPiece['site']) => {
    for (let i = 1; i < run.points.length; i++) {
      const a = run.points[i - 1], b = run.points[i];
      // Main enclosed galvanized-steel conveyor gallery box
      span('box', site, a.e, a.n, a.g, a.lift, b.e, b.n, b.g, b.lift, run.width, run.height, C.galleryWall);
      // Darker standing-seam gallery cap / roof lip
      span('box', site, a.e, a.n, a.g, a.lift + run.height / 2 + 0.14, b.e, b.n, b.g, b.lift + run.height / 2 + 0.14,
        run.width + 0.35, 0.28, C.galleryRoof);
      // Underslung steel truss stringers (skip extra stringer bar on LOW)
      if (run.truss && !low) {
        span('box', site, a.e, a.n, a.g, a.lift - run.height / 2 - 0.45, b.e, b.n, b.g, b.lift - run.height / 2 - 0.45,
          run.width * 0.82, 0.42, C.steelDark);
      }
      // Subtle night gallery work light every second span
      if (i % 2 === 1) {
        addLight((a.e + b.e) / 2, (a.n + b.n) / 2, (a.g + b.g) / 2, (a.lift + b.lift) / 2 + run.height / 2 + 0.8, 0.55, C.lightSodium);
      }
    }
    // Support bents (pair of steel legs + cross-head beam; over water, concrete pile cap + twin piles down to -12 m)
    for (let i = 0; i < run.points.length; i++) {
      const p = run.points[i];
      if (!p.bent) continue;
      const prev = run.points[Math.max(0, i - 1)], next = run.points[Math.min(run.points.length - 1, i + 1)];
      const dx = next.e - prev.e, dn = next.n - prev.n, l = Math.hypot(dx, dn) || 1;
      const perpE = -dn / l, perpN = dx / l;
      const yaw = -Math.atan2(dx, dn);
      const topY = p.lift - run.height / 2 - 0.1;
      const halfSpread = run.width * 0.52;
      const isWater = p.g <= sea;
      const footY = isWater ? (low ? -0.15 : -11.0) : -1.5;
      for (const s of [-1, 1]) {
        const le = p.e + perpE * halfSpread * s, ln = p.n + perpN * halfSpread * s;
        if (isWater) {
          // On LOW (where sea omits depth write), anchor pile bottom to sea level (-0.15 m) rather than submerged seabed.
          const pileBase = low ? sea : p.g;
          const topAboveBase = wy(p.g, topY) - wy(pileBase);
          upright('cyl', site, le, ln, pileBase, footY, 0.72, topAboveBase - footY, 0.72, 0, C.steelDark);
        } else {
          upright('box', site, le, ln, p.g, footY, 0.36, topY - footY, 0.36, yaw, C.steelDark);
        }
      }
      // Bent cross-head beam
      upright('box', site, p.e, p.n, p.g, topY - 0.45, run.width + 0.8, 0.48, 0.48, yaw, C.steelDark);
      if (isWater) {
        // Concrete marine pile cap at +3.2 m above sea
        upright('box', site, p.e, p.n, p.g, 2.4, run.width + 2.4, 1.4, 2.2, yaw, C.concreteMid);
      }
    }
  };

  // ==========================================================================================================
  // 3. COAL YARD: Transfer towers, radial stacker-reclaimers, conveyors & high-mast yard lights
  // ==========================================================================================================
  for (const run of COAL_CONVEYORS) {
    buildConveyor(run, run.id.startsWith('coal-pier') ? 'coal-pier' : 'coal');
  }
  {
    const { shoreTower, northStacker, southStacker, lightMasts } = COAL_YARD;
    // Shore transfer tower at the coal yard mouth
    upright('box', 'coal', shoreTower.e, shoreTower.n, shoreTower.g, -1.5, 10.0, 17.5, 10.0, 0.35, C.galleryWall);
    upright('box', 'coal', shoreTower.e, shoreTower.n, shoreTower.g, 15.8, 10.6, 0.8, 10.6, 0.35, C.galleryRoof);
    addLight(shoreTower.e, shoreTower.n, shoreTower.g, 17.2, 0.75, C.lightSodium);

    // North & South coal yard stacker-reclaimer towers with cantilevered lattice booms over the black coal mounds
    for (const st of [northStacker, southStacker]) {
      const sf = frame(st.e, st.n, st.boomAzDeg);
      // Clad steel transfer/stacker tower (north stacker reaches ~36 m CGVD2013 matching HRDEM DSM)
      const h = st === northStacker ? 20.5 : 15.0;
      upright('box', 'coal', st.e, st.n, st.g, -2.0, 7.6, h, 7.6, sf.yaw, C.galleryWall);
      upright('box', 'coal', st.e, st.n, st.g, h - 2.2, 8.2, 0.7, 8.2, sf.yaw, C.plantTrim);
      // Cantilevered luffing stacker boom reaching 34 m out over the coal pile
      const [tipE, tipN] = sf.pt(34.0, 0);
      const [backE, backN] = sf.pt(-12.0, 0);
      span('box', 'coal', st.e, st.n, st.g, h - 5.5, tipE, tipN, st.g, h + 3.5, 2.2, 1.8, C.accentYellow);
      // Boom mast + tension stay cables + rear counterweight
      upright('box', 'coal', st.e, st.n, st.g, h - 1.5, 1.4, 9.5, 1.4, sf.yaw, C.steelDark);
      span('cyl', 'coal', st.e, st.n, st.g, h + 7.2, tipE, tipN, st.g, h + 3.5, 0.16, 0.16, C.steelDark);
      span('box', 'coal', st.e, st.n, st.g, h - 5.5, backE, backN, st.g, h - 3.0, 2.0, 1.4, C.steelDark);
      upright('box', 'coal', backE, backN, st.g, h - 4.5, 3.4, 3.0, 3.2, sf.yaw, C.concreteDark);
      addLight(tipE, tipN, st.g, h + 4.4, 0.7, C.lightFlood);
    }

    // High-mast yard floodlight poles
    for (const m of lightMasts) {
      upright('cyl', 'coal', m.e, m.n, m.g, -1.0, 0.42, 19.0, 0.42, 0, C.steelGalv);
      upright('box', 'coal', m.e, m.n, m.g, 17.8, 2.4, 0.45, 0.65, 0, C.steelDark);
      addLight(m.e, m.n, m.g, 18.4, 0.85, C.lightSodium);
    }
  }

  // ==========================================================================================================
  // 4. MARINE HELPER: Pier decks, concrete pile bents, fenders, dolphins, catwalks, articulated loading arms
  // ==========================================================================================================
  const buildPierSpan = (
    site: PlannedPiece['site'],
    a: readonly [number, number], b: readonly [number, number],
    width: number, deckY: number, pileSpacing: number,
    opts: { fenders?: -1 | 0 | 1; rails?: boolean; bollards?: boolean; lamps?: boolean; baseG?: number } = {},
  ) => {
    const baseG = opts.baseG ?? sea;
    const baseLift = wy(baseG) - wy(sea);
    const deckTop = deckY + baseLift;
    const dx = b[0] - a[0], dn = b[1] - a[1], len = Math.hypot(dx, dn);
    const ux = dx / len, un = dn / len, perpE = -un, perpN = ux;
    const yaw = -Math.atan2(dx, dn);
    const midE = (a[0] + b[0]) / 2, midN = (a[1] + b[1]) / 2;

    // Main concrete pier deck slab + edge beam coping
    upright('box', site, midE, midN, baseG, deckY - 1.15, width, 1.15, len, yaw, C.concreteLight);
    if (!low) {
      for (const s of [-1, 1]) {
        const ce = midE + perpE * (width / 2 - 0.25) * s, cn = midN + perpN * (width / 2 - 0.25) * s;
        upright('box', site, ce, cn, baseG, deckY, 0.45, 0.32, len, yaw, C.concreteDark);
      }
    }
    // Pile bents extending below sea floor on desktop; clipped to waterline on LOW where sea omits depth write.
    const pileFoot = low ? -0.15 : -14.0;
    const bents = Math.max(2, Math.round(len / pileSpacing));
    const pileRows = width > 11 ? [-0.42, -0.14, 0.14, 0.42] : [-0.38, 0.38];
    for (let i = 0; i <= bents; i++) {
      const t = i / bents, pe = a[0] + dx * t, pn = a[1] + dn * t;
      // Concrete transverse cap beam under deck
      upright('box', site, pe, pn, baseG, deckY - 2.1, width - 0.4, 1.0, 1.35, yaw, C.concreteDark);
      for (const f of pileRows) {
        upright('cyl', site, pe + perpE * width * f, pn + perpN * width * f, sea, pileFoot, 0.78, deckTop - 1.5 - pileFoot, 0.78, 0, C.steelDark);
      }
      // Marine rubber fenders along the docking face (clipped to waterline on LOW)
      if (opts.fenders) {
        const fe = pe + perpE * (width / 2 + 0.55) * opts.fenders, fn = pn + perpN * (width / 2 + 0.55) * opts.fenders;
        const fBot = low && baseG <= sea ? Math.max(-0.15, deckY - 3.6) : deckY - 3.6;
        upright('box', site, fe, fn, baseG, fBot, 0.95, deckY + 0.2 - fBot, 1.7, yaw, C.fenderBlack);
      }
      if (opts.bollards && i % 2 === 0) {
        const side = opts.fenders || 1;
        const be = pe + perpE * (width / 2 - 0.9) * side, bn = pn + perpN * (width / 2 - 0.9) * side;
        upright('cyl', site, be, bn, baseG, deckY, 0.55, 0.85, 0.55, 0, C.accentYellow);
      }
      if (opts.lamps && i % 3 === 1) {
        const side = -(opts.fenders || 1);
        const le = pe + perpE * (width / 2 - 0.8) * side, ln = pn + perpN * (width / 2 - 0.8) * side;
        upright('cyl', site, le, ln, baseG, deckY, 0.24, 9.5, 0.24, 0, C.steelGalv);
        addLight(le, ln, baseG, deckY + 9.8, 0.72, C.lightFlood);
      }
    }
    if (opts.rails && !low) {
      for (const s of [-1, 1]) {
        if (s === opts.fenders) continue;
        const re = midE + perpE * (width / 2 - 0.25) * s, rn = midN + perpN * (width / 2 - 0.25) * s;
        upright('box', site, re, rn, baseG, deckY + 0.95, 0.14, 0.14, len, yaw, C.steelGalv);
      }
    }
  };

  const buildDolphin = (site: PlannedPiece['site'], d: DolphinSpec, deckY = 4.5) => {
    const df = frame(d.e, d.n, d.faceDeg);
    const sz = d.kind === 'breasting' ? 10.0 : 8.0;
    const dep = d.kind === 'breasting' ? 8.5 : 8.0;
    // Heavy reinforced concrete pile cap
    upright('box', site, d.e, d.n, sea, deckY - 2.0, sz, 2.0, dep, df.yaw, C.concreteMid);
    // 4 battered steel pipe piles (clipped to waterline on LOW where sea omits depth write)
    const pileFoot = low ? -0.15 : -14.0;
    const batterFrac = (deckY - 1.6 - pileFoot) / (deckY - 1.6 - (-14.0));
    const spread = 1 + 0.45 * batterFrac;
    for (const u of [-dep * 0.34, dep * 0.34]) {
      for (const v of [-sz * 0.34, sz * 0.34]) {
        const [topE, topN] = df.pt(u, v);
        const [botE, botN] = df.pt(u * spread, v * spread);
        span('cyl', site, botE, botN, sea, pileFoot, topE, topN, sea, deckY - 1.6, 0.75, 0.75, C.steelDark);
      }
    }
    // Ship-facing heavy black marine fender panel on breasting dolphins
    if (d.kind === 'breasting') {
      const [fe, fn] = df.pt(dep / 2 + 0.75, 0);
      upright('box', site, fe, fn, sea, deckY - 4.2, 5.8, 4.6, 1.35, df.yaw, C.fenderBlack);
    }
    // Yellow quick-release mooring hook assembly / bollard
    upright('box', site, d.e, d.n, sea, deckY, 1.6, 1.1, 1.4, df.yaw, C.accentYellow);
    // Marine light mast on end dolphins
    if (d.navLight) {
      upright('cyl', site, d.e, d.n, sea, deckY, 0.26, 6.2, 0.26, 0, C.pipeWhite);
      addLight(d.e, d.n, sea, deckY + 6.5, 0.85, d.navLight === 'red' ? C.lightRed : C.lightGreen);
    } else {
      addLight(d.e, d.n, sea, deckY + 3.2, 0.55, C.lightSodium);
    }
  };

  const buildCatwalk = (
    site: PlannedPiece['site'], e0: number, n0: number, e1: number, n1: number,
    y0 = 4.6, y1 = y0, g0 = sea, g1 = sea,
  ) => {
    span('box', site, e0, n0, g0, y0, e1, n1, g1, y1, 1.8, 0.38, C.steelGalv);
    if (!low) {
      const dx = e1 - e0, dn = n1 - n0, l = Math.hypot(dx, dn) || 1;
      const pe = -dn / l * 0.82, pn = dx / l * 0.82;
      for (const s of [-1, 1]) {
        span('box', site, e0 + pe * s, n0 + pn * s, g0, y0 + 1.05, e1 + pe * s, n1 + pn * s, g1, y1 + 1.05, 0.12, 0.12, C.steelMid);
      }
    }
  };

  /**
   * Counterweighted Articulated Marine Loading Arm in parked vertical-V attitude:
   * riser standpipe, inclined inboard boom, apex swivel joint, suspended outboard arm with triple-swivel coupler,
   * and rear pantograph counterweight beam + safety-orange counterweight box.
   */
  const buildLoadingArm = (
    site: PlannedPiece['site'], e: number, n: number, deckY: number, faceDeg: number, scale: number,
  ) => {
    const af = frame(e, n, faceDeg);
    const s = scale;
    // Steel manifold riser pedestal
    const [rE, rN] = af.pt(0, 0);
    upright('cyl', site, rE, rN, sea, deckY, 0.85 * s, 4.4 * s, 0.85 * s, 0, C.armGrey);
    upright('box', site, rE, rN, sea, deckY, 1.8 * s, 0.6 * s, 1.8 * s, af.yaw, C.steelDark);
    // Inboard boom angling upward & slightly forward to the apex knuckle (~19.5 m above deck at scale=1)
    const [knE, knN] = af.pt(2.6 * s, 0);
    const apexY = deckY + 18.8 * s;
    span('cyl', site, rE, rN, sea, deckY + 4.1 * s, knE, knN, sea, apexY, 0.68 * s, 0.68 * s, C.armWhite);
    // Apex swivel elbow housing
    upright('box', site, knE, knN, sea, apexY - 0.55 * s, 1.2 * s, 1.2 * s, 1.2 * s, af.yaw, C.accentOrange);
    // Outboard arm hanging forward/down in parked inverted-V silhouette
    const [tipE, tipN] = af.pt(5.5 * s, 0);
    const tipY = deckY + 5.6 * s;
    span('cyl', site, knE, knN, sea, apexY, tipE, tipN, sea, tipY, 0.56 * s, 0.56 * s, C.armWhite);
    // Triple-swivel coupler assembly at the ship-connection end
    upright('box', site, tipE, tipN, sea, tipY - 0.8 * s, 0.9 * s, 1.2 * s, 1.0 * s, af.yaw, C.accentOrange);
    // Rear pantograph counterweight arm & safety-orange counterweight block
    const [cwE, cwN] = af.pt(-4.8 * s, 0);
    const cwY = deckY + 6.4 * s;
    span('box', site, rE, rN, sea, deckY + 4.2 * s, cwE, cwN, sea, cwY, 0.42 * s, 0.52 * s, C.armGrey);
    if (!low) {
      span('cyl', site, knE, knN, sea, apexY - 1.2 * s, cwE, cwN, sea, cwY + 0.8 * s, 0.16 * s, 0.16 * s, C.steelDark);
    }
    upright('box', site, cwE, cwN, sea, cwY - 1.1 * s, 1.8 * s, 2.2 * s, 1.5 * s, af.yaw, C.accentOrange);
  };

  // ==========================================================================================================
  // 5. POINT TUPPER COAL MARINE TERMINAL (Pier head, equilibrium ship unloader, hopper, trestle & dolphins)
  // ==========================================================================================================
  {
    const { headStart, headEnd, headWidth, deckY, trestleEnd, trestleWidth, crane, hopper, elbowTower, dolphins } = COAL_PIER;
    // 182 m concrete-crib & pile docking pier head
    buildPierSpan('coal-pier', headStart, headEnd, headWidth, deckY, 18.0, { fenders: -1, rails: true, bollards: true, lamps: true });
    // Concrete caisson cribs along the pier face for massive visual weight
    const dx = headEnd[0] - headStart[0], dn = headEnd[1] - headStart[1];
    const headYaw = -Math.atan2(dx, dn);
    const cribFoot = low ? -0.15 : -10.0;
    for (let k = 0; k < 4; k++) {
      const t = (k + 0.5) / 4;
      upright('box', 'coal-pier', headStart[0] + dx * t, headStart[1] + dn * t, sea, cribFoot, headWidth - 1.2, deckY - 1.0 - cribFoot, 14.0, headYaw, C.concreteDark);
    }
    // Service walkway trestle parallel to the offshore coal conveyor bridge
    buildPierSpan('coal-pier', headEnd, trestleEnd, trestleWidth, 4.4, 24.0, { rails: true });
    // Elbow transfer house where the head collector feeds the offshore trestle conveyor
    upright('box', 'coal-pier', elbowTower.e, elbowTower.n, sea, deckY, 9.5, 11.5, 9.5, headYaw, C.galleryWall);
    upright('box', 'coal-pier', elbowTower.e, elbowTower.n, sea, deckY + 11.4, 10.1, 0.7, 10.1, headYaw, C.galleryRoof);
    addLight(elbowTower.e, elbowTower.n, sea, deckY + 12.6, 0.8, C.lightSodium);

    // Coal receiving hopper tower on the pier head (HRDEM DSM 16.7 m peak)
    upright('box', 'coal-pier', hopper.e, hopper.n, sea, deckY + 4.5, 7.6, 7.2, 8.4, headYaw, C.steelMid);
    obj.position.set(wx(hopper.e), wy(sea, deckY + 3.0), wz(hopper.n));
    obj.rotation.set(Math.PI, headYaw, 0);
    obj.scale.set(7.4, 3.2, 7.4);
    obj.updateMatrix();
    pushMatrix('taper', 'coal-pier', hopper.e, hopper.n, sea, deckY + 1.4, obj.matrix, C.steelDark);
    for (const sx of [-3.2, 3.2]) for (const sz of [-3.6, 3.6]) {
      const cf = frame(hopper.e, hopper.n, 106);
      const [le, ln] = cf.pt(sz, sx);
      upright('box', 'coal-pier', le, ln, sea, deckY, 0.55, 5.2, 0.55, headYaw, C.steelDark);
    }

    // Rail-mounted equilibrium balance-boom ship unloader (HRDEM DSM 24.9 m peak at 628603, 5048844.5)
    const crf = frame(crane.e, crane.n, 196); // faces SW out over the docked bulk carrier berth
    // Portal gantry legs straddling the pier rails
    for (const u of [-4.5, 4.5]) for (const v of [-5.2, 5.2]) {
      const [le, ln] = crf.pt(u, v);
      upright('box', 'coal-pier', le, ln, sea, deckY, 0.9, 8.0, 0.9, crf.yaw, C.craneBlue);
    }
    // Portal deck & slewing pedestal
    upright('box', 'coal-pier', crane.e, crane.n, sea, deckY + 7.6, 11.4, 1.6, 10.2, crf.yaw, C.craneBlue);
    upright('cyl', 'coal-pier', crane.e, crane.n, sea, deckY + 9.2, 4.4, 3.0, 4.4, 0, C.steelDark);
    // Machinery house + elevated glass-front operator cab
    const [cabE, cabN] = crf.pt(3.8, 2.4);
    upright('box', 'coal-pier', crane.e, crane.n, sea, deckY + 11.8, 5.8, 4.6, 8.2, crf.yaw, C.craneBlue);
    upright('box', 'coal-pier', cabE, cabN, sea, deckY + 13.8, 2.6, 2.8, 3.2, crf.yaw, C.accentYellow);
    // Equilibrium parallelogram boom reaching high over the berth (top ~25.5 m above sea)
    const [bTopE, bTopN] = crf.pt(14.5, 0);
    const [bTipE, bTipN] = crf.pt(26.0, 0);
    const [bBackE, bBackN] = crf.pt(-11.5, 0);
    span('box', 'coal-pier', crane.e, crane.n, sea, deckY + 14.5, bTopE, bTopN, sea, deckY + 21.0, 1.35, 1.65, C.accentYellow);
    span('box', 'coal-pier', crane.e, crane.n, sea, deckY + 16.5, bTopE, bTopN, sea, deckY + 22.8, 0.55, 0.55, C.craneBlue);
    // Outer stick arm & clamshell coal grab bucket
    span('box', 'coal-pier', bTopE, bTopN, sea, deckY + 21.0, bTipE, bTipN, sea, deckY + 11.5, 0.95, 1.15, C.accentYellow);
    upright('box', 'coal-pier', bTipE, bTipN, sea, deckY + 7.2, 3.2, 3.6, 3.6, crf.yaw, C.steelDark);
    // Rear balance arm & heavy counterweight box
    span('box', 'coal-pier', crane.e, crane.n, sea, deckY + 15.2, bBackE, bBackN, sea, deckY + 18.8, 1.1, 1.3, C.craneBlue);
    upright('box', 'coal-pier', bBackE, bBackN, sea, deckY + 15.5, 4.2, 4.6, 3.8, crf.yaw, C.accentOrange);
    addLight(bTopE, bTopN, sea, deckY + 23.4, 0.85, C.lightRed);
    addLight(cabE, cabN, sea, deckY + 17.2, 0.75, C.lightFlood);

    // Flanking offshore mooring dolphins + catwalks
    buildDolphin('coal-pier', dolphins[0], deckY);
    buildDolphin('coal-pier', dolphins[1], deckY);
    buildCatwalk('coal-pier', dolphins[0].e, dolphins[0].n, headStart[0], headStart[1], deckY);
    buildCatwalk('coal-pier', dolphins[1].e, dolphins[1].n, headEnd[0], headEnd[1], deckY);
  }

  // ==========================================================================================================
  // 6. POINT TUPPER LIQUID BULK MARINE TERMINAL (T-head jetty, pipe rack, loading arms, 11 dolphins & catwalks)
  // ==========================================================================================================
  {
    const {
      onshorePipe, shoreAbutment, approachStart, approachEnd, approachWidth, deckY,
      berth1Center, berth1Length, berth1Width, berth1AxisDeg,
      berth2Start, berth2End, berth2Width, controlHouse, gangwayTower,
      berth1Arms, berth2Arms, launchWharf, dolphins, catwalks,
    } = OIL_TERMINAL;

    // Onshore overhead multi-pipe rack from shore abutment up toward the tank farm
    for (let i = 1; i < onshorePipe.length; i++) {
      const a = onshorePipe[i - 1], b = onshorePipe[i];
      const dx = b.e - a.e, dn = b.n - a.n, l = Math.hypot(dx, dn) || 1;
      const pe = -dn / l, pn = dx / l;
      const pipeOffsets = low ? [-1.6, 0, 1.6] : [-2.2, -1.1, 0, 1.1, 2.2];
      for (const off of pipeOffsets) {
        span('cyl', 'oil-pier', a.e + pe * off, a.n + pn * off, a.g, a.lift, b.e + pe * off, b.n + pn * off, b.g, b.lift, 0.56, 0.56, off === 0 ? C.pipeWhite : C.pipeGrey);
      }
      span('box', 'oil-pier', a.e, a.n, a.g, a.lift - 0.55, b.e, b.n, b.g, b.lift - 0.55, 5.4, 0.35, C.steelDark);
    }
    for (const p of onshorePipe) {
      if (!p.bent) continue;
      upright('box', 'oil-pier', p.e - 1.5, p.n + 2.2, p.g, -1.5, 0.45, p.lift + 1.4, 0.45, 0.4, C.steelDark);
      upright('box', 'oil-pier', p.e + 1.5, p.n - 2.2, p.g, -1.5, 0.45, p.lift + 1.4, 0.45, 0.4, C.steelDark);
      upright('box', 'oil-pier', p.e, p.n, p.g, p.lift - 0.7, 5.8, 0.5, 0.5, 0.4, C.steelDark);
    }

    // Shore abutment concrete bulkhead + sloped transition ramp & continuous pipe transition onto the offshore trestle
    upright('box', 'oil-pier', shoreAbutment.e, shoreAbutment.n, shoreAbutment.g, -2.0, 16.0, shoreAbutment.deckLift + 2.0, 8.0, -234 * Math.PI / 180, C.concreteMid);
    span('box', 'oil-pier',
      shoreAbutment.e, shoreAbutment.n, shoreAbutment.g, shoreAbutment.deckLift - 0.55,
      approachStart[0], approachStart[1], sea, deckY - 0.55,
      approachWidth, 1.1, C.concreteLight);
    {
      const dx = approachEnd[0] - approachStart[0], dn = approachEnd[1] - approachStart[1], l = Math.hypot(dx, dn);
      const pe = -dn / l, pn = dx / l;
      const shorePrev = onshorePipe[onshorePipe.length - 2], shoreEnd = onshorePipe[onshorePipe.length - 1];
      const sdx = shoreEnd.e - shorePrev.e, sdn = shoreEnd.n - shorePrev.n, sl = Math.hypot(sdx, sdn) || 1;
      const spe = -sdn / sl, spn = sdx / sl;
      const pipeRows = low
        ? [[-3.6, 1.4], [-2.2, 1.4], [-3.6, 2.8], [-2.2, 2.8]]
        : [[-4.4, 1.4], [-3.3, 1.4], [-2.2, 1.4], [-4.4, 2.7], [-3.3, 2.7], [-2.2, 2.7]];
      const shoreOffsets = low ? [-1.6, 0, 0, 1.6] : [-2.2, -1.1, 0, 0, 1.1, 2.2];
      // Continuous sloped pipe transition starting at the exact last onshore pipe endpoints (0 m joint gap).
      for (let i = 0; i < pipeRows.length; i++) {
        const [off, py] = pipeRows[i];
        const sOff = shoreOffsets[i];
        span('cyl', 'oil-pier',
          shoreEnd.e + spe * sOff, shoreEnd.n + spn * sOff, shoreEnd.g, shoreEnd.lift,
          approachStart[0] + pe * off, approachStart[1] + pn * off, sea, deckY + py,
          0.56, 0.56, py > 2 ? C.pipeWhite : C.pipeGrey);
      }
      // 149 m Offshore Approach Trestle (100% over water) + Two-Tier 6-Pipe Rack
      buildPierSpan('oil-pier', approachStart, approachEnd, approachWidth, deckY, 16.0, { rails: true, lamps: true });
      const yaw = -Math.atan2(dx, dn);
      for (const [off, py] of pipeRows) {
        span('cyl', 'oil-pier',
          approachStart[0] + pe * off, approachStart[1] + pn * off, sea, deckY + py,
          approachEnd[0] + pe * off, approachEnd[1] + pn * off, sea, deckY + py,
          0.58, 0.58, py > 2 ? C.pipeWhite : C.pipeGrey);
      }
      // Steel pipe-rack portal bents along the approach trestle
      const bents = Math.round(l / 16);
      for (let i = 1; i < bents; i++) {
        const t = i / bents, be = approachStart[0] + dx * t - pe * 3.3, bn = approachStart[1] + dn * t - pn * 3.3;
        upright('box', 'oil-pier', be, bn, sea, deckY + 0.9, 3.8, 0.32, 0.32, yaw, C.steelDark);
        upright('box', 'oil-pier', be, bn, sea, deckY + 2.2, 3.8, 0.32, 0.32, yaw, C.steelDark);
        for (const s of [-1.75, 1.75]) {
          upright('box', 'oil-pier', be + pe * s, bn + pn * s, sea, deckY, 0.28, 3.2, 0.28, yaw, C.steelDark);
        }
      }
    }

    // Berth 1 Main Outer Loading Platform (74 m x 32 m concrete deck on heavy pile grid)
    const b1f = frame(berth1Center[0], berth1Center[1], berth1AxisDeg);
    const b1Start = b1f.pt(-berth1Length / 2, 0), b1End = b1f.pt(berth1Length / 2, 0);
    buildPierSpan('oil-pier', b1Start, b1End, berth1Width, deckY + 0.2, 14.0, { fenders: -1, bollards: true, lamps: true });

    // Dress the existing control/equipment house (id 49) on the loading head with steel frame, rooftop mast & monitor.
    // Anchor to buildingBaseY(-0.77) matching web/src/buildings.ts:236 so trim stays locked to id 49 at every exaggeration.
    const chf = frame(controlHouse.e, controlHouse.n, controlHouse.axisDeg);
    const chBase = buildingBaseY(-0.77);
    const uprightBuilding = (kind: IndustryKind, yBot: number, sx: number, h: number, sz: number, yawRad: number, color: number) => {
      obj.position.set(wx(controlHouse.e), chBase + yBot + h / 2, wz(controlHouse.n));
      obj.rotation.set(0, yawRad, 0);
      obj.scale.set(sx, h, sz);
      obj.updateMatrix();
      pushMatrix(kind, 'oil-pier', controlHouse.e, controlHouse.n, -0.77, yBot, obj.matrix, color);
    };
    uprightBuilding('box', controlHouse.eave, controlHouse.width + 0.6, 0.75, controlHouse.length + 0.6, chf.yaw, C.plantTrim);
    uprightBuilding('box', controlHouse.eave * 0.72, controlHouse.width + 0.45, 2.4, controlHouse.length + 0.45, chf.yaw, C.plantLouver);
    uprightBuilding('cyl', controlHouse.eave + 0.7, 0.45, 7.5, 0.45, 0, C.pipeWhite);
    if (night) lights.push({ e: controlHouse.e, n: controlHouse.n, y: chBase + controlHouse.eave + 8.4, radius: 0.85, color: C.lightRed });

    // Tall Gangway / Hose-Handling Crane & Fire-Monitor Tower on Berth 1 (HRDEM DSM 31.5 m peak)
    const gtf = frame(gangwayTower.e, gangwayTower.n, 234);
    for (const u of [-2.4, 2.4]) for (const v of [-2.4, 2.4]) {
      const [le, ln] = gtf.pt(u, v);
      upright('box', 'oil-pier', le, ln, sea, deckY + 0.2, 0.48, gangwayTower.height, 0.48, gtf.yaw, C.steelGalv);
    }
    for (const y of [8, 15, 22, gangwayTower.height - 0.6]) {
      upright('box', 'oil-pier', gangwayTower.e, gangwayTower.n, sea, deckY + y, 5.6, 0.55, 5.6, gtf.yaw, C.steelMid);
    }
    // Cantilevered ship access gangway boom + upper red fire-monitor turret
    const [gwE, gwN] = gtf.pt(11.0, 0);
    span('box', 'oil-pier', gangwayTower.e, gangwayTower.n, sea, deckY + 15.5, gwE, gwN, sea, deckY + 17.8, 1.6, 1.5, C.accentOrange);
    upright('box', 'oil-pier', gangwayTower.e, gangwayTower.n, sea, deckY + gangwayTower.height, 3.2, 2.2, 3.2, gtf.yaw, C.accentOrange);
    addLight(gangwayTower.e, gangwayTower.n, sea, deckY + gangwayTower.height + 2.6, 0.9, C.lightRed);
    addLight(gangwayTower.e, gangwayTower.n, sea, deckY + 17.5, 0.85, C.lightFlood);

    // Berth 1 Outer Bank: 5 Giant Articulated Supertanker Loading Arms + rear service gantry
    for (let i = 0; i < berth1Arms.count; i++) {
      const t = berth1Arms.count > 1 ? i / (berth1Arms.count - 1) : 0.5;
      const ae = berth1Arms.start[0] + (berth1Arms.end[0] - berth1Arms.start[0]) * t;
      const an = berth1Arms.start[1] + (berth1Arms.end[1] - berth1Arms.start[1]) * t;
      buildLoadingArm('oil-pier', ae, an, deckY + 0.2, berth1Arms.faceDeg, berth1Arms.scale);
    }
    // Elevated steel manifold & maintenance gantry behind the Berth 1 loading arm bank
    span('box', 'oil-pier', berth1Arms.start[0] + 3.5, berth1Arms.start[1] + 2.6, sea, deckY + 4.4,
      berth1Arms.end[0] + 3.5, berth1Arms.end[1] + 2.6, sea, deckY + 4.4, 3.6, 0.45, C.steelMid);
    addLight((berth1Arms.start[0] + berth1Arms.end[0]) / 2, (berth1Arms.start[1] + berth1Arms.end[1]) / 2, sea, deckY + 18.0, 0.9, C.lightFlood);

    // North Berth 2 Pier Arm (195 m long x 15 m wide) + 4-pipe rack + 4 medium articulated loading arms
    buildPierSpan('oil-pier', berth2Start, berth2End, berth2Width, deckY - 0.2, 16.0, { fenders: -1, rails: true, bollards: true, lamps: true });
    {
      const dx = berth2End[0] - berth2Start[0], dn = berth2End[1] - berth2Start[1], l = Math.hypot(dx, dn);
      const pe = -dn / l, pn = dx / l;
      for (const [off, py] of [[3.2, 1.2], [4.3, 1.2], [3.2, 2.3], [4.3, 2.3]] as const) {
        if (low && py > 2) continue;
        span('cyl', 'oil-pier',
          berth2Start[0] + pe * off, berth2Start[1] + pn * off, sea, deckY - 0.2 + py,
          berth2End[0] + pe * off, berth2End[1] + pn * off, sea, deckY - 0.2 + py,
          0.48, 0.48, py > 2 ? C.pipeWhite : C.pipeGrey);
      }
    }
    for (let i = 0; i < berth2Arms.count; i++) {
      const t = berth2Arms.count > 1 ? i / (berth2Arms.count - 1) : 0.5;
      const ae = berth2Arms.start[0] + (berth2Arms.end[0] - berth2Arms.start[0]) * t;
      const an = berth2Arms.start[1] + (berth2Arms.end[1] - berth2Arms.start[1]) * t;
      buildLoadingArm('oil-pier', ae, an, deckY - 0.2, berth2Arms.faceDeg, berth2Arms.scale);
    }

    // Small tug/launch service wharf (NSTDB WAWH40)
    buildPierSpan('oil-pier', launchWharf.start, launchWharf.end, launchWharf.width, launchWharf.deckY, 15.0, { fenders: -1, bollards: true });

    // All 11 NSTDB STBP60 mooring & breasting dolphins + steel truss catwalks spanning the 585 m berth line
    for (const d of dolphins) buildDolphin('oil-pier', d, 4.5);
    for (const [e0, n0, e1, n1] of catwalks) buildCatwalk('oil-pier', e0, n0, e1, n1, 4.6);
  }

  // ==========================================================================================================
  // 7. PAPER MILL MARINE WHARF (130 m apron, circular mooring dolphin, 149 m marine conveyor & ship-loader)
  // ==========================================================================================================
  {
    const { start, end, width, baseG, deckLift, dolphin, conveyor, loader } = PAPER_WHARF;
    buildPierSpan('paper-wharf', start, end, width, deckLift, 16.0, { fenders: -1, bollards: true, lamps: true, baseG });
    // Circular concrete mooring dolphin (OSM way 1084321647) + sloped steel truss catwalk to NW wharf corner
    const dolFoot = low ? -0.15 : -10.0;
    upright('cyl', 'paper-wharf', dolphin.e, dolphin.n, sea, dolFoot, dolphin.radius * 2, dolphin.deckY - dolFoot, dolphin.radius * 2, 0, C.concreteMid);
    upright('cyl', 'paper-wharf', dolphin.e, dolphin.n, sea, dolphin.deckY, 1.0, 0.9, 1.0, 0, C.accentYellow);
    addLight(dolphin.e, dolphin.n, sea, dolphin.deckY + 3.8, 0.72, C.lightRed);
    buildCatwalk('paper-wharf', dolphin.e, dolphin.n, start[0], start[1], dolphin.deckY + 0.3, deckLift + 0.1, sea, baseG);

    // 149 m enclosed marine conveyor gallery from mill building id 147 to the wharf ship-loading tower
    buildConveyor(conveyor, 'paper-wharf');
    const lf = frame(loader.e, loader.n, loader.faceDeg);
    upright('box', 'paper-wharf', loader.e, loader.n, baseG, deckLift, 8.0, 14.5, 8.0, lf.yaw, C.galleryWall);
    const [chE, chN] = lf.pt(14.5, 0);
    span('box', 'paper-wharf', loader.e, loader.n, baseG, deckLift + 12.5, chE, chN, baseG, deckLift + 15.0, 2.2, 1.8, C.craneBlue);
    upright('cyl', 'paper-wharf', chE, chN, baseG, deckLift + 6.5, 1.2, 8.5, 1.2, 0, C.steelGalv);
    addLight(loader.e, loader.n, baseG, deckLift + 15.6, 0.75, C.lightFlood);
  }

  // ==========================================================================================================
  // 8. NORTH BULK / GYPSUM MARINE TERMINAL PIER (OSM way 181364913, shiploader, peninsula conveyor & dolphins)
  // ==========================================================================================================
  {
    const { berthStart, berthEnd, berthWidth, baseG, deckLift, loader, conveyor, dolphins } = NORTH_BULK_PIER;
    buildPierSpan('north-bulk', berthStart, berthEnd, berthWidth, deckLift, 16.0, { fenders: -1, bollards: true, lamps: true, baseG });
    buildConveyor(conveyor, 'north-bulk');

    // Bulk shiploader tower & luffing boom on the berth head (anchored to the same peninsula bulkhead baseG)
    const lf = frame(loader.e, loader.n, loader.faceDeg);
    upright('box', 'north-bulk', loader.e, loader.n, baseG, deckLift, 8.4, 17.5, 8.4, lf.yaw, C.galleryWall);
    upright('box', 'north-bulk', loader.e, loader.n, baseG, deckLift + 17.4, 9.0, 0.7, 9.0, lf.yaw, C.plantTrim);
    const [bE, bN] = lf.pt(20.0, 0);
    span('box', 'north-bulk', loader.e, loader.n, baseG, deckLift + 13.5, bE, bN, baseG, deckLift + 18.2, 2.5, 2.1, C.accentYellow);
    span('cyl', 'north-bulk', loader.e, loader.n, baseG, deckLift + 22.5, bE, bN, baseG, deckLift + 18.5, 0.22, 0.22, C.steelDark);
    upright('box', 'north-bulk', loader.e, loader.n, baseG, deckLift + 17.5, 1.4, 5.5, 1.4, lf.yaw, C.steelDark);
    upright('cyl', 'north-bulk', bE, bN, baseG, deckLift + 7.5, 1.4, 10.8, 1.4, 0, C.steelGalv);
    addLight(loader.e, loader.n, baseG, deckLift + 23.2, 0.85, C.lightRed);
    addLight(bE, bN, baseG, deckLift + 19.0, 0.8, C.lightFlood);

    buildDolphin('north-bulk', dolphins[0], 4.5);
    buildDolphin('north-bulk', dolphins[1], 4.5);
    buildCatwalk('north-bulk', dolphins[0].e, dolphins[0].n, berthStart[0], berthStart[1], 4.5, deckLift + 0.1, sea, baseG);
    buildCatwalk('north-bulk', dolphins[1].e, dolphins[1].n, berthEnd[0], berthEnd[1], 4.5, deckLift + 0.1, sea, baseG);
  }

  return { pieces, lights };
}

/** Deterministic broken-coal colour tone from map coordinates (integer hash, identical everywhere). */
function coalTone(e: number, n: number): [number, number, number] {
  let h = Math.imul(Math.round(e) | 0, 374761393) ^ Math.imul(Math.round(n) | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const r = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  const s = 0.032 + 0.036 * r;
  return [s + 0.004, s + 0.002, s];
}

/** Build one draped dark-anthracite coal surface over the two baked coal-yard mounds when manifest.stockpiles is absent. */
function buildCoalYardMesh(
  mounds: readonly CoalMoundGrid[],
  village: readonly [number, number],
  exag: number,
  sea: number,
): THREE.Mesh | null {
  const pos: number[] = [], col: number[] = [];
  const [VE, VN] = village;
  for (const m of mounds) {
    const grid = new Int16Array(m.rows * m.cols).fill(-999);
    for (const sp of m.spans) {
      const r = sp[0], c0 = sp[1];
      for (let i = 2; i < sp.length; i++) grid[r * m.cols + c0 + i - 2] = sp[i];
    }
    const val = (r: number, c: number) => (r >= 0 && r < m.rows && c >= 0 && c < m.cols ? grid[r * m.cols + c] : -999);
    const active = (r: number, c: number) => val(r, c) > -900;
    const isRim = (r: number, c: number) => !active(r - 1, c) || !active(r + 1, c) || !active(r, c - 1) || !active(r, c + 1);
    const pt = (r: number, c: number): [number, number, number] => {
      const e = m.e0 + c * m.step, n = m.n0 + r * m.step, g = val(r, c) / 10;
      const lift = isRim(r, c) ? -0.22 : 0.18 + 0.50 * exag;
      return [e - VE, industryGround(g, exag, sea) + lift, VN - n];
    };
    const pushTri = (a: [number, number, number], b: [number, number, number], c: [number, number, number], e: number, n: number) => {
      const k = coalTone(e, n);
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      col.push(k[0], k[1], k[2], k[0], k[1], k[2], k[0], k[1], k[2]);
    };
    for (let r = 0; r < m.rows - 1; r++) {
      for (let c = 0; c < m.cols - 1; c++) {
        if (!active(r, c) || !active(r, c + 1) || !active(r + 1, c + 1) || !active(r + 1, c)) continue;
        const p0 = pt(r, c), p1 = pt(r, c + 1), p2 = pt(r + 1, c + 1), p3 = pt(r + 1, c);
        const ce = m.e0 + (c + 0.5) * m.step, cn = m.n0 + (r + 0.5) * m.step;
        // Split along p0-p2 (SW-NE) matching web/src/terrain.ts:529-530, with strictly upward (+Y) CCW winding.
        pushTri(p0, p1, p2, ce, cn);
        pushTri(p0, p2, p3, ce + 1, cn + 1);
      }
    }
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'pt-industry-coal';
  return mesh;
}

/**
 * Instanced Point Tupper industrial complex: power plant (101 m concrete stack, ESP, boiler house cladding & vents),
 * coal yard & conveyors, and the four Strait of Canso marine terminals with piers, loading arms, cranes and dolphins.
 *
 * Three instanced batches by day (boxes, cylinders, tapered frustums) plus optional draped coal mounds when
 * stockpiles are absent and one untoned instanced light batch at night: zero textures and zero new shader programs.
 */
export class PointTupperIndustry {
  readonly group = new THREE.Group();
  readonly plan: IndustryPlan;
  readonly excludesCanopy = ptIndustryCanopyExcludes;

  constructor(
    village: readonly [number, number],
    exag: number,
    sea: number,
    low: boolean,
    night: boolean,
    hasStockpiles = false,
  ) {
    const begun = performance.now();
    this.group.name = 'Point Tupper industry';
    this.plan = planPointTupperIndustry(village, exag, sea, low, night);

    const byKind: Record<IndustryKind, PlannedPiece[]> = { box: [], cyl: [], taper: [] };
    for (const p of this.plan.pieces) byKind[p.kind].push(p);

    const sharedMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const color = new THREE.Color();
    const specs: readonly [IndustryKind, string, () => THREE.BufferGeometry][] = [
      ['box', 'pt-industry-boxes', () => new THREE.BoxGeometry(1, 1, 1)],
      ['cyl', 'pt-industry-cylinders', () => new THREE.CylinderGeometry(0.5, 0.5, 1, low ? 6 : 10)],
      ['taper', 'pt-industry-tapered', () => new THREE.CylinderGeometry(0.265, 0.5, 1, low ? 10 : 18)],
    ];

    for (const [kind, name, makeGeo] of specs) {
      const list = byKind[kind];
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(makeGeo(), sharedMat, list.length);
      mesh.name = name;
      for (let i = 0; i < list.length; i++) {
        mesh.setMatrixAt(i, list[i].matrix);
        mesh.setColorAt(i, color.setHex(list[i].color));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }

    if (!hasStockpiles) {
      const coalMesh = buildCoalYardMesh(COAL_MOUNDS, village, exag, sea);
      if (coalMesh) this.group.add(coalMesh);
    }

    if (night && this.plan.lights.length) {
      const lightGeo = new THREE.SphereGeometry(1, 6, 4);
      const lightMat = untoned(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      const lightMesh = new THREE.InstancedMesh(lightGeo, lightMat, this.plan.lights.length);
      lightMesh.name = 'pt-industry-lights';
      const m = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), sc = new THREE.Vector3();
      const [VE, VN] = village;
      for (let i = 0; i < this.plan.lights.length; i++) {
        const l = this.plan.lights[i];
        pos.set(l.e - VE, l.y, VN - l.n);
        sc.setScalar(l.radius);
        m.compose(pos, quat, sc);
        lightMesh.setMatrixAt(i, m);
        lightMesh.setColorAt(i, color.setHex(l.color));
      }
      lightMesh.instanceMatrix.needsUpdate = true;
      if (lightMesh.instanceColor) lightMesh.instanceColor.needsUpdate = true;
      lightMesh.computeBoundingBox();
      lightMesh.computeBoundingSphere();
      this.group.add(lightMesh);
    }

    this.group.userData.buildMs = performance.now() - begun;
  }
}
