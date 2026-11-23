import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR_SPEC, deepFreeze, type Rig, type VehicleSpec } from './vehicle-spec';

type P = [number, number, number];

/** Generate continuous two-row body plus wheel-corner collision circles with small scallops. */
function makeEnvelope(
  halfLength: number, halfWidth: number, height: number,
  wheelbase: number, track: number, radius: number, sideOffset: number,
) {
  const circles: number[] = [], circleSides: number[] = [];
  const end = halfLength - radius + 0.02;
  const steps = Math.max(10, Math.ceil((2 * end) / 0.30));
  for (const side of [-sideOffset, sideOffset]) {
    for (let i = 0; i <= steps; i++) {
      circles.push(Number((-end + (2 * end * i) / steps).toFixed(3)));
      circleSides.push(side);
    }
  }
  // Centreline bumper circles close the front/rear notch between the two body rows.
  for (const z of [Number(end.toFixed(3)), Number((-end).toFixed(3))]) {
    circles.push(z);
    circleSides.push(0);
  }
  const halfBase = Number((wheelbase / 2).toFixed(3));
  const halfTrack = Number((track / 2).toFixed(3));
  for (const z of [halfBase, -halfBase]) {
    for (const s of [-1, 1]) {
      circles.push(z);
      circleSides.push(Number((s * halfTrack).toFixed(3)));
    }
  }
  return {
    circles, circleSides, radius,
    reach: Number((Math.hypot(halfLength, halfWidth) + 1.35).toFixed(2)),
    sweepHalfWidth: Number((halfWidth + 0.24).toFixed(2)),
    sweepHalfLength: Number((halfLength + 0.06).toFixed(2)),
    overhead: Number((height + 0.06).toFixed(2)),
    grassHalfWidth: Number((halfWidth + 0.40).toFixed(2)),
    grassHalfLength: Number((halfLength + 0.48).toFixed(2)),
    nose: Number((halfLength + 0.88).toFixed(2)),
  };
}

/** 2-3 seat enclosed utility side by side with full doors, windshield and rear dump bed. */
export const SXS_UTILITY_SPEC: VehicleSpec = deepFreeze({
  ...CAR_SPEC, wheelbase: 2.38, track: 1.50, wheelRadius: .39,
  contactPlane: 1, halfLength: 1.74, halfWidth: .91, height: 1.96, mass: 1080,
  envelope: makeEnvelope(1.74, .91, 1.96, 2.38, 1.50, .48, .44),
  // Strong low-speed pull on steep gravel and tracks; steady ~108 km/h utility top speed on dirt.
  engineAcceleration: 5.4, enginePower: 120, tractionShare: 2.3, aeroDrag: .0036,
  brake: 9.4, handbrake: 6.0, cornering: 1.38, maxSteer: .55,
  steerBaseRate: .78, steerSpeedRate: 2.4, steerReturnRate: 4.1, gripLock: 1.12,
  lateralInertia: .92, landingForward: .97, landingSideways: .76,
  pitchGain: .0045, pitchLimit: .042, rollGain: .0065, rollLimit: .062, leanRate: 5,
  shakePitch: .006, shakeRoll: .008, shakeHeight: .012,
  washboardYaw: .0025, washboardSideways: .065, hardSteerDrag: 2.0,
  drift: { angle: .36, maxAngle: .65, rotate: 3.1, carve: 1.05, scrub: .56, looseSpeed: 9, firmSpeed: 14, liftSpeed: 14, towed: .5 },
  chase: { back: 6.5, height: 2.55, lookAhead: 3.9, lookHeight: 1.10, speedBack: .085, maxSpeedBack: 3.0 },
});

/** 4-6 seat long-wheelbase crew-cab utility side by side with four doors and an open dump bed. */
export const SXS_CREW_SPEC: VehicleSpec = deepFreeze({
  ...CAR_SPEC, wheelbase: 3.05, track: 1.54, wheelRadius: .40,
  contactPlane: 1, halfLength: 2.08, halfWidth: .93, height: 2.00, mass: 1380,
  envelope: makeEnvelope(2.08, .93, 2.00, 3.05, 1.54, .48, .45),
  // Heavy crew cab and bed: steady ~100 km/h on dirt, planted on washboard, wider turning circle.
  engineAcceleration: 4.9, enginePower: 108, tractionShare: 2.3, aeroDrag: .0040,
  brake: 8.8, handbrake: 5.8, cornering: 1.32, maxSteer: .50,
  steerBaseRate: .70, steerSpeedRate: 2.2, steerReturnRate: 3.8, gripLock: 1.13,
  lateralInertia: .88, landingForward: .96, landingSideways: .74,
  pitchGain: .004, pitchLimit: .040, rollGain: .006, rollLimit: .058, leanRate: 4.8,
  shakePitch: .005, shakeRoll: .007, shakeHeight: .010,
  washboardYaw: .0022, washboardSideways: .060, hardSteerDrag: 2.2,
  drift: { angle: .30, maxAngle: .55, rotate: 2.7, carve: 1.0, scrub: .62, looseSpeed: 10, firmSpeed: 15, liftSpeed: 15, towed: .5 },
  chase: { back: 7.4, height: 2.70, lookAhead: 4.1, lookHeight: 1.15, speedBack: .080, maxSpeedBack: 3.0 },
});

/** 4-seat fully enclosed four-door trail cabin side by side (no open bed; enclosed rear cargo hatch). */
export const SXS_CABIN_SPEC: VehicleSpec = deepFreeze({
  ...CAR_SPEC, wheelbase: 2.95, track: 1.56, wheelRadius: .405,
  contactPlane: 1, halfLength: 2.02, halfWidth: .94, height: 2.01, mass: 1320,
  envelope: makeEnvelope(2.02, .94, 2.01, 2.95, 1.56, .49, .46),
  // Touring adventure cabin: ~122 km/h on dirt, long-travel suspension, composed trail handling.
  engineAcceleration: 5.6, enginePower: 152, tractionShare: 2.25, aeroDrag: .0034,
  brake: 9.2, handbrake: 6.0, cornering: 1.38, maxSteer: .52,
  steerBaseRate: .76, steerSpeedRate: 2.4, steerReturnRate: 4.0, gripLock: 1.12,
  lateralInertia: .94, landingForward: .975, landingSideways: .77,
  pitchGain: .0042, pitchLimit: .044, rollGain: .0062, rollLimit: .062, leanRate: 5,
  shakePitch: .0045, shakeRoll: .0065, shakeHeight: .009,
  washboardYaw: .002, washboardSideways: .055, hardSteerDrag: 1.95,
  drift: { angle: .42, maxAngle: .72, rotate: 3.5, carve: 1.12, scrub: .50, looseSpeed: 8, firmSpeed: 13, liftSpeed: 13, towed: .5 },
  chase: { back: 7.2, height: 2.65, lookAhead: 4.0, lookHeight: 1.15, speedBack: .085, maxSpeedBack: 3.2 },
});

/** Non-indexed suspension batches: update face normals in existing buffers, with no scratch-object allocation. */
function updateTravelNormals(g: THREE.BufferGeometry): void {
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i += 3) {
    const ax = p.getX(i + 1) - p.getX(i), ay = p.getY(i + 1) - p.getY(i), az = p.getZ(i + 1) - p.getZ(i);
    const bx = p.getX(i + 2) - p.getX(i), by = p.getY(i + 2) - p.getY(i), bz = p.getZ(i + 2) - p.getZ(i);
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, length = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(i, nx / length, ny / length, nz / length);
    n.setXYZ(i + 1, nx / length, ny / length, nz / length);
    n.setXYZ(i + 2, nx / length, ny / length, nz / length);
  }
  n.needsUpdate = true;
}

function makeEnvCube(): THREE.CubeTexture {
  const env = new THREE.CubeTexture();
  env.images = Array.from({ length: 6 }, (_, face) => {
    const data = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const sky = face === 2 || (face !== 3 && y < 18), stripe = sky && x > 18 && x < 25;
      const c = stripe ? [235, 241, 237] : sky ? [116, 155, 180] : [65, 72, 56];
      data.set([...c, 255], (y * 32 + x) * 4);
    }
    const t = new THREE.DataTexture(data, 32, 32); t.needsUpdate = true; return t;
  });
  env.needsUpdate = true; env.colorSpace = THREE.SRGBColorSpace;
  return env;
}

interface VariantLayout {
  name: string;
  spec: VehicleSpec;
  paintHex: number;
  paintRoughness: number;
  paintMetalness: number;
  cabHex: number;
  /** Front & rear cab Z boundaries (forward is -Z). */
  hoodFrontZ: number;
  hoodRearZ: number;
  windshieldTopZ: number;
  cabRearZ: number;
  rearEndZ: number;
  cabHalfWidth: number;
  roofY: number;
  beltY: number;
  floorY: number;
  rows: 1 | 2;
  enclosedBack: boolean;
  roofLightBar: boolean;
  bedCargo: boolean;
  bedRails: boolean;
  travelLimit: number;
  driverZ: number;
}

export type SxsBuildOptions = { low?: boolean; removableRider?: boolean; display?: boolean };

function buildSxsVariant(cfg: VariantLayout, options?: SxsBuildOptions): Rig {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  root.name = cfg.name;
  body.name = 'Sprung cab and chassis';
  const low = options?.low ?? false;
  const display = options?.display ?? false;
  const mat = (name: string, color: number, roughness: number, metalness = 0) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness }); m.name = name; return m;
  };
  const env = makeEnvCube();
  const paint = mat('Utility enamel', cfg.paintHex, cfg.paintRoughness, cfg.paintMetalness);
  const cab = mat('Satin cab trim', cfg.cabHex, .46, .30);
  const rubber = mat('Graphite rubber and upholstery', 0x1e2326, .90);
  const alloy = mat('Machined steel', 0x4b5862, .28, .80);
  const white = mat('Ice LED', 0xdff2ff, .18); white.emissive.setHex(0xc8ecff); white.emissiveIntensity = 1.6;
  const red = mat('Tail lamp', 0xb20817, .22); red.emissive.setHex(0xff1523); red.emissiveIntensity = .45;
  const glass = new THREE.MeshStandardMaterial({
    color: 0x8ea9b6, roughness: .08, metalness: .14,
    transparent: !display, opacity: display ? 1 : .30, depthWrite: display,
    side: THREE.FrontSide, envMap: env, envMapIntensity: .85,
  });
  glass.name = 'Cab glazing';
  for (const m of [paint, cab, alloy]) { m.envMap = env; m.envMapIntensity = .95; }

  const batches = new Map<THREE.Object3D, Map<THREE.Material, THREE.BufferGeometry[]>>();
  const halfTrack = cfg.spec.track / 2;
  const halfBase = cfg.spec.wheelbase / 2;
  const wr = cfg.spec.wheelRadius;

  function add(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = body, weight?: (x: number, y: number, z: number) => number) {
    let bucket = batches.get(parent);
    if (!bucket) { bucket = new Map(); batches.set(parent, bucket); }
    const list = bucket.get(m) ?? []; bucket.set(m, list);
    const geo = g.index ? g.toNonIndexed() : g; if (geo !== g) g.dispose(); geo.deleteAttribute('uv');
    if (parent.name.includes('coil-over')) {
      const p = geo.attributes.position, weights = new Float32Array(p.count);
      const span = Math.max(.2, halfTrack - .30);
      for (let i = 0; i < p.count; i++) weights[i] = weight ? weight(p.getX(i), p.getY(i), p.getZ(i)) : THREE.MathUtils.clamp((Math.abs(p.getX(i)) - .30) / span, 0, 1);
      geo.setAttribute('travelWeight', new THREE.BufferAttribute(weights, 1));
    }
    list.push(geo);
  }
  function box(at: P, size: P, m: THREE.Material, parent: THREE.Object3D = body, rx = 0, ry = 0, rz = 0) {
    const g = new THREE.BoxGeometry(...size);
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    if (rz) g.rotateZ(rz);
    g.translate(...at);
    add(g, m, parent);
  }
  function rod(a: P, b: P, r: number, m: THREE.Material, parent: THREE.Object3D = body, sides = 8, weight?: (x: number, y: number, z: number) => number) {
    if (display) sides = Math.min(4, sides);
    const v = new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
    if (v.lengthSq() < 1e-10) return;
    const g = new THREE.CylinderGeometry(r, r, v.length(), sides);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()));
    g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    add(g, m, parent, weight);
  }
  function ball(at: P, scale: P, m: THREE.Material, parent: THREE.Object3D = body) {
    const g = new THREE.SphereGeometry(1, display ? 6 : low ? 8 : 14, display ? 4 : low ? 5 : 9);
    g.scale(...scale).translate(...at);
    add(g, m, parent);
  }
  function shell(sections: { z: number; w: number; y: number; crown: number; bottom: number }[], m: THREE.Material, offsetX = 0) {
    const vertices: number[] = [], index: number[] = [];
    for (const s of sections) for (const [x, y] of [[-s.w, s.y], [0, s.y + s.crown], [s.w, s.y], [s.w * .88, s.bottom], [-s.w * .88, s.bottom]]) vertices.push(x + offsetX, y, s.z);
    for (let j = 0; j < sections.length - 1; j++) for (let i = 0; i < 5; i++) { const a = j * 5 + i, b = j * 5 + (i + 1) % 5; index.push(a, b, a + 5, b, b + 5, a + 5); }
    for (let i = 1; i < 4; i++) { index.push(0, i + 1, i); const a = (sections.length - 1) * 5; index.push(a, a + i, a + i + 1); }
    for (let i = 0; i < index.length; i += 3) { const a = index[i]; index[i] = index[i + 2]; index[i + 2] = a; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    g.setIndex(index);
    const flat = g.toNonIndexed(); g.dispose(); flat.computeVertexNormals();
    add(flat, m);
  }

  const W = cfg.cabHalfWidth;
  const roofW = W - .07;
  const floorY = cfg.floorY;
  const beltY = cfg.beltY;
  const roofY = cfg.roofY;
  const hoodMidZ = (cfg.hoodFrontZ + cfg.hoodRearZ) / 2;

  // --- Chassis floor pan, frame rails, rock sliders & skid plate ---
  const chassisLen = cfg.rearEndZ - cfg.hoodFrontZ - .18;
  const chassisMidZ = (cfg.hoodFrontZ + cfg.rearEndZ) / 2;
  box([0, floorY, chassisMidZ], [W * 1.48, .08, chassisLen], cab);
  box([0, floorY - .04, chassisMidZ - .06], [W * 1.12, .035, chassisLen * .88], alloy);
  for (const s of [-1, 1]) {
    rod([s * (W - .04), floorY + .02, cfg.hoodRearZ - .05], [s * (W - .04), floorY + .02, cfg.cabRearZ + .05], .038, cab);
    // Raised sill & step plate under doors.
    box([s * (W - .03), floorY + .09, (cfg.hoodRearZ + cfg.cabRearZ) / 2], [.10, .12, cfg.cabRearZ - cfg.hoodRearZ], cab);
  }

  // --- Faceted utility hood & grille ---
  shell([
    { z: cfg.hoodFrontZ, w: W * .78, y: beltY - .15, crown: .04, bottom: floorY + .24 },
    { z: hoodMidZ, w: W * .94, y: beltY - .04, crown: .065, bottom: floorY + .25 },
    { z: cfg.hoodRearZ, w: W * .96, y: beltY + .03, crown: .05, bottom: floorY + .24 },
  ], paint);
  // Front nose grille panel & slats.
  box([0, (beltY - .15 + floorY + .28) / 2, cfg.hoodFrontZ + .01], [W * 1.24, .28, .06], cab);
  for (let i = 0; i < 6; i++) {
    box([-W * .42 + i * (W * .84 / 5), (beltY - .15 + floorY + .30) / 2, cfg.hoodFrontZ - .02], [.045, .17, .02], rubber);
  }

  // --- Heavy front steel brush guard, winch bumper & skid plate ---
  const bumpZ = cfg.hoodFrontZ - .08;
  box([0, floorY + .24, bumpZ], [W * 1.62, .12, .11], cab);
  box([0, floorY + .11, bumpZ + .08], [.62, .22, .04], alloy, body, -.42);
  // Recessed winch drum & steel roller fairlead.
  box([0, floorY + .25, bumpZ - .055], [.26, .085, .04], alloy);
  rod([-.09, floorY + .25, bumpZ - .072], [.09, floorY + .25, bumpZ - .072], .014, rubber);
  // Upper bullbar loop & twin vertical push uprights.
  rod([-W * .66, beltY - .14, bumpZ + .01], [W * .66, beltY - .14, bumpZ + .01], .026, cab);
  for (const s of [-1, 1]) {
    rod([s * .27, floorY + .24, bumpZ], [s * .27, beltY - .14, bumpZ + .01], .024, cab);
    rod([s * W * .78, floorY + .24, bumpZ + .02], [s * W * .66, beltY - .14, bumpZ + .01], .024, cab);
    rod([s * W * .78, floorY + .24, bumpZ + .02], [s * W * .82, floorY + .26, cfg.hoodFrontZ + .14], .026, cab);
    // Stepped dual LED headlamps inside dark bezels.
    box([s * W * .60, beltY - .19, cfg.hoodFrontZ + .02], [.24, .11, .07], rubber);
    box([s * W * .60, beltY - .19, cfg.hoodFrontZ - .018], [.19, .065, .016], white);
  }

  // --- Wheel-arch fender flares (squared rugged arches matching utility/adventure UTVs) ---
  for (const s of [-1, 1]) {
    for (const axleZ of [-halfBase, halfBase]) {
      const archTopY = wr * 2 + .21;
      const archW = .16;
      const flareX = s * (W - .01);
      box([flareX, archTopY, axleZ], [archW, .055, .46], cab);
      box([flareX, archTopY - .095, axleZ - .31], [archW, .055, .26], cab, body, -.76);
      box([flareX, archTopY - .095, axleZ + .31], [archW, .055, .26], cab, body, .76);
    }
  }

  // --- Enclosed cab structure: A-pillars, windshield, doors, windows, roof ---
  const wsBotZ = cfg.hoodRearZ + .02;
  const wsTopZ = cfg.windshieldTopZ;
  const wsLen = Math.hypot(roofY - .05 - (beltY + .02), wsTopZ - wsBotZ);
  const wsPitch = Math.atan2(wsTopZ - wsBotZ, roofY - .05 - (beltY + .02));
  // Tall raked glass windshield & perimeter frame.
  box([0, (beltY + .02 + roofY - .05) / 2, (wsBotZ + wsTopZ) / 2], [roofW * 1.88, wsLen - .06, .014], glass, body, wsPitch);
  rod([-roofW, roofY - .04, wsTopZ], [roofW, roofY - .04, wsTopZ], .032, cab);
  rod([-W * .94, beltY + .02, wsBotZ], [W * .94, beltY + .02, wsBotZ], .030, cab);
  // Single wiper blade parked along lower windshield edge.
  rod([-.08, beltY + .07, wsBotZ - .015], [-.52, beltY + .12, wsBotZ + .005], .010, rubber);

  // Full hard doors (1 pair for utility cab; 2 pairs for crew cab & full cabin).
  const doorStartZ = cfg.hoodRearZ + .04;
  const doorEndZ = cfg.cabRearZ - .04;
  const midPillarZ = (doorStartZ + doorEndZ) / 2;
  const doorSpans: [number, number][] = cfg.rows === 2
    ? [[doorStartZ, midPillarZ - .03], [midPillarZ + .03, doorEndZ]]
    : [[doorStartZ, doorEndZ]];

  for (const s of [-1, 1]) {
    // A-pillar & rear cab pillar.
    rod([s * W * .94, floorY + .12, wsBotZ], [s * W * .94, beltY + .02, wsBotZ], .034, cab);
    rod([s * W * .94, beltY + .02, wsBotZ], [s * roofW, roofY - .04, wsTopZ], .034, cab);
    rod([s * W * .94, floorY + .12, cfg.cabRearZ], [s * roofW, roofY - .04, cfg.cabRearZ], .038, cab);
    // Roof cant rail.
    const railEndZ = cfg.enclosedBack ? cfg.rearEndZ - .14 : cfg.cabRearZ;
    rod([s * roofW, roofY - .04, wsTopZ], [s * roofW, roofY - .04, railEndZ], .034, cab);
    if (cfg.rows === 2) {
      // Sturdy vertical B-pillar between front and rear doors.
      rod([s * W * .94, floorY + .12, midPillarZ], [s * roofW, roofY - .04, midPillarZ], .040, cab);
    }

    // Side mirrors mounted on front A-pillar brackets.
    rod([s * W * .95, beltY + .18, wsBotZ + .08], [s * (W + .12), beltY + .21, wsBotZ + .06], .014, cab);
    box([s * (W + .15), beltY + .22, wsBotZ + .06], [.06, .16, .09], cab);

    // Build each full hard door: lower painted skin + dark upper window frame + glass pane + handle.
    for (let di = 0; di < doorSpans.length; di++) {
      const [z0, z1] = doorSpans[di];
      const len = z1 - z0, cz = (z0 + z1) / 2;
      const lowerH = beltY - (floorY + .10);
      // Painted lower door panel.
      box([s * (W - .02), floorY + .10 + lowerH / 2, cz], [.065, lowerH, len - .03], paint);
      // Lower door rub strip.
      box([s * (W + .016), floorY + .26, cz], [.02, .09, len - .06], cab);
      // Door handle.
      box([s * (W + .022), beltY - .10, z1 - .14], [.03, .04, .13], alloy);

      // Upper door frame & tinted glass window.
      const winBotY = beltY + .03;
      const winTopY = roofY - .08;
      const winH = winTopY - winBotY;
      const winX = s * ((W * .94 + roofW) / 2);
      const winTilt = s * Math.atan2(W * .94 - roofW, roofY - beltY);
      const frontGlassZ = di === 0 ? Math.max(z0 + .16, wsTopZ) : z0 + .05;
      const rearGlassZ = z1 - .05;
      const glassLen = Math.max(.25, rearGlassZ - frontGlassZ);
      const glassZ = (frontGlassZ + rearGlassZ) / 2;
      // Top & bottom window sash rails.
      box([winX, winBotY, cz], [.045, .045, len - .03], cab);
      box([s * (roofW + .01), winTopY + .02, glassZ], [.045, .045, glassLen + .08], cab);
      // Side glass pane (thin closed box so inspectSolids stays 100% outward-facing).
      box([winX, winBotY + winH / 2, glassZ], [.012, winH - .03, glassLen], glass, body, 0, 0, winTilt);
    }
  }

  // --- Solid overhanging hard roof (flat utility roof or full wagon roof) ---
  const roofFrontZ = wsTopZ - .09;
  const roofRearZ = cfg.enclosedBack ? cfg.rearEndZ - .10 : cfg.cabRearZ + .08;
  shell([
    { z: roofFrontZ, w: roofW + .04, y: roofY - .02, crown: .035, bottom: roofY - .06 },
    { z: (roofFrontZ + roofRearZ) / 2, w: roofW + .06, y: roofY, crown: .04, bottom: roofY - .055 },
    { z: roofRearZ, w: roofW + .04, y: roofY - .02, crown: .035, bottom: roofY - .06 },
  ], cab);
  if (cfg.roofLightBar) {
    // Sleek front-edge roof LED light bar + low expedition roof rack rails.
    box([0, roofY + .04, roofFrontZ + .07], [.86, .055, .07], rubber);
    for (let i = 0; i < 8; i++) box([-.35 + i * .10, roofY + .04, roofFrontZ + .03], [.07, .032, .016], white);
    for (const s of [-1, 1]) {
      rod([s * (roofW - .08), roofY + .05, roofFrontZ + .22], [s * (roofW - .08), roofY + .05, roofRearZ - .16], .018, cab);
      for (const rz of [roofFrontZ + .28, (roofFrontZ + roofRearZ) / 2, roofRearZ - .22]) {
        rod([s * (roofW - .08), roofY, rz], [s * (roofW - .08), roofY + .05, rz], .016, cab);
      }
    }
  }

  // --- Rear body: EITHER enclosed SUV/minivan cargo cabin OR open rear dump bed ---
  if (cfg.enclosedBack) {
    const qStartZ = cfg.cabRearZ + .02;
    const qEndZ = cfg.rearEndZ - .08;
    const qMidZ = (qStartZ + qEndZ) / 2;
    const qLen = qEndZ - qStartZ;
    const lowerH = beltY - (floorY + .16);
    for (const s of [-1, 1]) {
      // Lower rear quarter panels.
      box([s * (W - .02), floorY + .16 + lowerH / 2, qMidZ], [.07, lowerH, qLen], paint);
      // Angled D-pillar from rear beltline up to roof end.
      rod([s * W * .94, beltY, qEndZ], [s * roofW, roofY - .04, qEndZ - .08], .044, cab);
      // Rear-quarter cargo window glass.
      const winBotY = beltY + .04, winTopY = roofY - .08, winH = winTopY - winBotY;
      const winX = s * ((W * .94 + roofW) / 2);
      const winTilt = s * Math.atan2(W * .94 - roofW, roofY - beltY);
      box([winX, winBotY + winH / 2, qMidZ - .02], [.012, winH - .03, qLen - .14], glass, body, 0, 0, winTilt);
    }
    // Enclosed rear tailgate & upper hatchback window.
    box([0, floorY + .16 + lowerH / 2, qEndZ], [W * 1.88, lowerH, .08], paint);
    box([0, beltY + (roofY - .06 - beltY) / 2, qEndZ - .04], [roofW * 1.82, roofY - .12 - beltY, .014], glass, body, -.10);
    // Hatch frame & upper rear spoiler lip.
    rod([-roofW, roofY - .04, qEndZ - .08], [roofW, roofY - .04, qEndZ - .08], .034, cab);
    rod([-W * .94, beltY + .02, qEndZ], [W * .94, beltY + .02, qEndZ], .032, cab);
    // Rear steel bumper & recessed licence/handle panel (blank).
    box([0, floorY + .24, cfg.rearEndZ - .01], [W * 1.72, .12, .11], cab);
    box([0, beltY - .16, qEndZ + .042], [.34, .18, .02], cab);
    for (const s of [-1, 1]) {
      box([s * (W - .14), beltY - .10, qEndZ + .042], [.10, .28, .025], rubber);
      box([s * (W - .14), beltY - .10, qEndZ + .056], [.065, .22, .014], red);
    }
  } else {
    // Solid rear cab bulkhead with framed rear cab window looking into the dump bed.
    const bulkH = beltY - (floorY + .10);
    box([0, floorY + .10 + bulkH / 2, cfg.cabRearZ], [W * 1.84, bulkH, .06], cab);
    const rwBot = beltY + .05, rwTop = roofY - .09;
    box([0, (rwBot + rwTop) / 2, cfg.cabRearZ], [roofW * 1.66, rwTop - rwBot, .014], glass);
    rod([-roofW, roofY - .04, cfg.cabRearZ], [roofW, roofY - .04, cfg.cabRearZ], .032, cab);

    // Boxy open rear dump cargo bed.
    const bedStartZ = cfg.cabRearZ + .06;
    const bedEndZ = cfg.rearEndZ - .04;
    const bedLen = bedEndZ - bedStartZ;
    const bedMidZ = (bedStartZ + bedEndZ) / 2;
    const bedFloorY = Math.max(wr * 2 + .06, .84);
    const bedWallTopY = beltY + .06;
    const bedWallH = bedWallTopY - bedFloorY;
    const bedW = W - .04;
    // Bed floor + dark ribbed bed liner.
    box([0, bedFloorY, bedMidZ], [bedW * 1.94, .06, bedLen], rubber);
    for (let i = 0; i < 7; i++) {
      box([-.54 + i * .18, bedFloorY + .038, bedMidZ], [.03, .018, bedLen - .10], cab);
    }
    // Front bed wall, painted outer side walls, and tailgate.
    box([0, bedFloorY + bedWallH / 2, bedStartZ + .03], [bedW * 1.94, bedWallH, .06], cab);
    for (const s of [-1, 1]) {
      box([s * (bedW - .03), bedFloorY + bedWallH / 2, bedMidZ], [.08, bedWallH, bedLen], paint);
      box([s * (bedW - .03), bedWallTopY + .02, bedMidZ], [.095, .04, bedLen + .02], cab);
    }
    // Rear tailgate + steel latches.
    box([0, bedFloorY + bedWallH / 2, bedEndZ - .03], [bedW * 1.84, bedWallH, .07], paint);
    box([0, bedWallTopY + .02, bedEndZ - .03], [bedW * 1.88, .04, .08], cab);
    box([0, bedWallTopY - .08, bedEndZ + .012], [.16, .045, .02], alloy);
    // Under-bed rear steel bumper & vertical corner tail lamps.
    box([0, floorY + .24, cfg.rearEndZ - .02], [W * 1.66, .11, .11], cab);
    for (const s of [-1, 1]) {
      box([s * (bedW - .10), bedFloorY + bedWallH * .55, bedEndZ + .012], [.095, .24, .025], rubber);
      box([s * (bedW - .10), bedFloorY + bedWallH * .55, bedEndZ + .026], [.06, .19, .014], red);
    }
    if (cfg.bedRails) {
      // Tubular steel utility headache rack & bed side rails (matches Survey S1).
      for (const s of [-1, 1]) {
        rod([s * (bedW - .04), bedWallTopY + .03, bedStartZ + .08], [s * (bedW - .04), bedWallTopY + .25, bedStartZ + .08], .018, alloy);
        rod([s * (bedW - .04), bedWallTopY + .26, bedStartZ + .06], [s * (bedW - .04), bedWallTopY + .26, bedEndZ - .12], .018, alloy);
        rod([s * (bedW - .04), bedWallTopY + .03, bedEndZ - .14], [s * (bedW - .04), bedWallTopY + .25, bedEndZ - .14], .018, alloy);
      }
      rod([-(bedW - .06), bedWallTopY + .24, bedStartZ + .08], [bedW - .06, bedWallTopY + .24, bedStartZ + .08], .018, alloy);
    }
    if (cfg.bedCargo) {
      // Plain generic utility toolbox & trail pack strapped in the front of the crew bed (no logos/text).
      box([-.26, bedFloorY + .17, bedStartZ + .26], [.54, .26, .34], cab);
      box([-.26, bedFloorY + .305, bedStartZ + .26], [.56, .025, .36], alloy);
      box([.34, bedFloorY + .18, bedStartZ + .22], [.22, .28, .18], paint);
    }
  }

  // --- Interior: dashboard, steering wheel, bench/bucket seats, and removable generic driver ---
  const dashZ = cfg.hoodRearZ + .14;
  box([0, beltY - .06, dashZ], [W * 1.66, .24, .28], rubber);
  box([0, beltY - .02, dashZ + .145], [.24, .11, .02], cab);
  rod([-.31, beltY - .14, dashZ + .05], [-.31, beltY - .01, dashZ + .31], .024, alloy);
  const steering = new THREE.TorusGeometry(.14, .015, 6, display ? 12 : 24);
  steering.rotateX(-.36).translate(-.31, beltY + .01, dashZ + .34);
  add(steering, rubber);
  rod([-.44, beltY + .01, dashZ + .34], [-.18, beltY + .01, dashZ + .34], .012, alloy);

  const seatZs = cfg.rows === 2 ? [cfg.driverZ, cfg.driverZ + .92] : [cfg.driverZ];
  for (const sz of seatZs) {
    if (cfg.enclosedBack) {
      // Touring high-back bucket seats (two per row).
      for (const sx of [-.31, .31]) {
        box([sx, floorY + .30, sz], [.44, .11, .44], rubber);
        box([sx, floorY + .68, sz + .20], [.42, .66, .12], rubber, body, -.12);
        box([sx, floorY + 1.08, sz + .24], [.22, .18, .09], rubber);
      }
    } else {
      // Full-width utility bench seat + backrest + headrests.
      box([0, floorY + .30, sz], [W * 1.56, .11, .46], rubber);
      box([0, floorY + .68, sz + .20], [W * 1.54, .64, .12], rubber, body, -.10);
      for (const sx of [-.42, 0, .42]) box([sx, floorY + 1.06, sz + .24], [.20, .15, .08], rubber);
    }
  }

  // Generic driver in front-left seat (removable for parked trailer/display copies).
  const rider = options?.removableRider ? new THREE.Group() : body;
  if (rider !== body) { rider.name = 'Removable driver'; body.add(rider); }
  const dx = -.31, dz = cfg.driverZ;
  ball([dx, floorY + .62, dz + .05], [.16, .24, .11], rubber, rider);
  for (const s of [-1, 1]) {
    rod([dx + s * .11, floorY + .72, dz + .02], [dx + s * .15, floorY + .62, dz - .20], .044, rubber, rider);
    rod([dx + s * .15, floorY + .62, dz - .20], [dx + s * .11, beltY, dashZ + .34], .034, rubber, rider);
  }
  for (const lx of [-.08, .08]) {
    rod([dx + lx, floorY + .40, dz - .02], [dx + lx, floorY + .32, dz - .32], .052, rubber, rider);
    rod([dx + lx, floorY + .32, dz - .32], [dx + lx, floorY + .12, dz - .48], .042, rubber, rider);
  }
  ball([dx, floorY + .98, dz + .04], [.125, .145, .135], cab, rider);
  // Eye sits cleanly in front of the head and well behind the windshield glass.
  const driverEye = new THREE.Object3D();
  driverEye.name = 'Left driver eye';
  driverEye.position.set(dx, floorY + 1.02, dz - .16);
  body.add(driverEye);

  // --- Chunky off-road wheels ---
  const wheelParents: THREE.Group[] = [];
  function wheel(x: number, z: number) {
    const pivot = new THREE.Group(), spin = new THREE.Group();
    root.add(pivot); pivot.position.set(x, 0, z); spin.position.y = wr; pivot.add(spin);
    const r0 = wr * .51, r1 = wr * .72, r2 = wr * .91, r3 = wr * .965;
    const profile = [[r0, -.14], [r1, -.155], [r2, -.14], [r3, -.098], [r3, .098], [r2, .14], [r1, .155], [r0, .14]].map(p => new THREE.Vector2(p[0], p[1]));
    const tyre = new THREE.LatheGeometry(profile, display ? 12 : low ? 16 : 28);
    tyre.rotateZ(Math.PI / 2);
    add(tyre, rubber, spin);
    const lugs = display ? 16 : low ? 20 : 24;
    for (let i = 0; i < lugs; i++) for (const side of [-1, 1]) {
      const a = (i * Math.PI * 2) / lugs + (side > 0 ? .05 : 0);
      const g = new THREE.BoxGeometry(.125, .026, .064);
      g.rotateY(side * .30).translate(side * .068, wr - .014, 0).rotateX(a);
      add(g, rubber, spin);
    }
    const sign = Math.sign(x) || 1, face = sign * .148;
    const ring = new THREE.TorusGeometry(r0 * 1.06, .014, 6, display ? 14 : 24);
    ring.rotateY(Math.PI / 2).translate(face, 0, 0);
    add(ring, alloy, spin);
    const hub = new THREE.CylinderGeometry(.062, .062, .22, 10);
    hub.rotateZ(Math.PI / 2);
    add(hub, alloy, spin);
    const spokes = display ? 4 : 6;
    for (let i = 0; i < spokes; i++) {
      const a = (i * Math.PI * 2) / spokes;
      rod([face, .05 * Math.cos(a), .05 * Math.sin(a)], [face, r0 * Math.cos(a), r0 * Math.sin(a)], .022, alloy, spin, 5);
    }
    wheelParents.push(pivot);
    return { pivot, spin };
  }
  const fl = wheel(-halfTrack, -halfBase), fr = wheel(halfTrack, -halfBase);
  const rl = wheel(-halfTrack, halfBase), rr = wheel(halfTrack, halfBase);

  // --- Articulated double A-arms & coil-over shocks on all 4 corners ---
  const suspension: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const s = i % 2 ? 1 : -1, z = i < 2 ? -halfBase : halfBase;
    const parent = new THREE.Group();
    parent.name = i < 2 ? 'Double A arms and coil-over' : 'Rear A arms and coil-over';
    root.add(parent);
    suspension.push(parent);
    for (const y of [.34, .54]) for (const dzArm of [-.18, .18]) {
      rod([s * .28, y, z + dzArm], [s * halfTrack, y - .03, z], .019, cab, parent, 6);
    }
    rod([s * halfTrack, .31, z], [s * halfTrack, .56, z], .028, alloy, parent, 6);
    const topA = new THREE.Vector3(s * .48, .92, z), botB = new THREE.Vector3(s * (halfTrack - .04), .40, z);
    const axis = botB.clone().sub(topA);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().normalize());
    const shockWeight = (_x: number, y: number, _z: number) => THREE.MathUtils.clamp((topA.y - y) / (topA.y - botB.y), 0, 1);
    rod(topA.toArray() as P, botB.toArray() as P, .026, alloy, parent, 6, shockWeight);
    if (!display) {
      const steps = low ? 36 : 84;
      const path = Array.from({ length: steps + 1 }, (_, j) => {
        const t = j / steps, angle = t * 7 * Math.PI * 2;
        return new THREE.Vector3(.046 * Math.cos(angle), axis.length() * (.12 + t * .74), .046 * Math.sin(angle)).applyQuaternion(q).add(topA);
      });
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path), steps, .008, low ? 4 : 5, false), paint, parent, shockWeight);
    }
  }

  // Flush one merged geometry per material under each animated parent.
  const brakeLights: THREE.Mesh[] = [];
  for (const [parent, bucket] of batches) for (const [m, parts] of bucket) {
    const g = mergeGeometries(parts);
    if (!g) throw Error(`${cfg.name} material batch failed`);
    g.normalizeNormals();
    const mesh = new THREE.Mesh(g, m);
    mesh.name = m.name;
    mesh.castShadow = m !== glass;
    parent.add(mesh);
    if (m === red) brakeLights.push(mesh);
    for (const p of parts) p.dispose();
  }
  for (const parent of suspension) for (const mesh of parent.children) {
    if (mesh instanceof THREE.Mesh) { mesh.geometry.computeBoundingSphere(); mesh.geometry.boundingSphere!.radius += .6; }
  }
  const deform = suspension.map(parent => parent.children
    .filter((n): n is THREE.Mesh => n instanceof THREE.Mesh)
    .map(mesh => ({ mesh, base: Float32Array.from(mesh.geometry.attributes.position.array), weights: mesh.geometry.attributes.travelWeight })));
  const bodyPoint = new THREE.Vector3();
  const limit = cfg.travelLimit;
  const rig: Rig = {
    root, body,
    wheels: { fl: fl.spin, fr: fr.spin, rl: rl.spin, rr: rr.spin },
    steer: { fl: fl.pivot, fr: fr.pivot },
    driverEye, brakeLights,
    ...(rider !== body ? { setRiderVisible(visible: boolean) { rider.visible = visible; } } : {}),
    checkpointPose() { return () => {}; },
    // Hot path: no arrays, closures or new objects.
    setTravel(a, b, c, d) {
      for (let i = 0; i < 4; i++) {
        const travel = THREE.MathUtils.clamp(i === 0 ? a : i === 1 ? b : i === 2 ? c : d, -limit, limit);
        const bodyOffset = body.position.y + bodyPoint.set((i % 2 ? 1 : -1) * halfTrack, 0, (i < 2 ? -1 : 1) * halfBase).applyEuler(body.rotation).y;
        wheelParents[i].position.y = travel + bodyOffset;
        for (let part = 0; part < deform[i].length; part++) {
          const { mesh, base, weights } = deform[i][part];
          const p = mesh.geometry.attributes.position;
          for (let j = 0; j < p.count; j++) {
            const weight = weights.getX(j);
            p.setXYZ(j, base[j * 3], base[j * 3 + 1] + bodyOffset + travel * weight, base[j * 3 + 2]);
          }
          p.needsUpdate = true;
          mesh.geometry.boundingBox = null;
          updateTravelNormals(mesh.geometry);
        }
      }
    },
  };
  return rig;
}

const UTILITY_LAYOUT: VariantLayout = {
  name: 'Utility cab side by side',
  spec: SXS_UTILITY_SPEC,
  paintHex: 0x3b4d3e, paintRoughness: .36, paintMetalness: .22, cabHex: 0x1d2327,
  hoodFrontZ: -1.58, hoodRearZ: -.78, windshieldTopZ: -.48, cabRearZ: .48, rearEndZ: 1.68,
  cabHalfWidth: .75, roofY: 1.92, beltY: 1.14, floorY: .46,
  rows: 1, enclosedBack: false, roofLightBar: false, bedCargo: false, bedRails: true,
  travelLimit: .17, driverZ: .06,
};

const CREW_LAYOUT: VariantLayout = {
  name: 'Crew cab side by side',
  spec: SXS_CREW_SPEC,
  paintHex: 0x9e1c23, paintRoughness: .28, paintMetalness: .30, cabHex: 0x1b2024,
  hoodFrontZ: -1.92, hoodRearZ: -1.14, windshieldTopZ: -.84, cabRearZ: .92, rearEndZ: 2.02,
  cabHalfWidth: .77, roofY: 1.96, beltY: 1.16, floorY: .47,
  rows: 2, enclosedBack: false, roofLightBar: false, bedCargo: true, bedRails: false,
  travelLimit: .17, driverZ: -.36,
};

const CABIN_LAYOUT: VariantLayout = {
  name: 'Full cabin side by side',
  spec: SXS_CABIN_SPEC,
  paintHex: 0x4a5248, paintRoughness: .38, paintMetalness: .24, cabHex: 0x1b2125,
  hoodFrontZ: -1.86, hoodRearZ: -1.08, windshieldTopZ: -.76, cabRearZ: 1.00, rearEndZ: 1.96,
  cabHalfWidth: .78, roofY: 1.94, beltY: 1.15, floorY: .47,
  rows: 2, enclosedBack: true, roofLightBar: true, bedCargo: false, bedRails: false,
  travelLimit: .20, driverZ: -.30,
};

/** 2-3 seat enclosed utility side by side with full doors, windshield and dump bed. Forward is -Z. */
export function createSxsUtility(_mailTrim = true, options?: SxsBuildOptions): Rig {
  return buildSxsVariant(UTILITY_LAYOUT, options);
}

/** 4-6 seat crew-cab side by side with four full doors, windshield and open dump bed. Forward is -Z. */
export function createSxsCrew(_mailTrim = true, options?: SxsBuildOptions): Rig {
  return buildSxsVariant(CREW_LAYOUT, options);
}

/** 4-seat fully enclosed four-door trail cabin side by side with enclosed rear hatch. Forward is -Z. */
export function createSxsCabin(_mailTrim = true, options?: SxsBuildOptions): Rig {
  return buildSxsVariant(CABIN_LAYOUT, options);
}
