import * as THREE from 'three';
import { craneX, hotSpotState, PLANT_GOAL_Z, PLANT_HALF_WIDTH, PLANT_LENGTH, type PlantLayout, type PlantRun } from './plant-rules';
import { letters, Mesher, SignAtlas, type RGB } from './yard-kit';

/**
 * Procedural steel plant interior built from batched vertex-coloured meshes and instanced animated hazards.
 * Shadow-free; every GPU resource is owned and released by `dispose()`.
 */

const WALL: RGB = [0.11, 0.145, 0.195];
const WALL_DARK: RGB = [0.075, 0.095, 0.13];
const ROOF: RGB = [0.18, 0.21, 0.25];
const FLOOR: RGB = [0.17, 0.18, 0.195];
const FLOOR_SIDE: RGB = [0.12, 0.13, 0.145];
const STEEL: RGB = [0.24, 0.27, 0.31];
const RUST: RGB = [0.28, 0.12, 0.065];
const YELLOW: RGB = [0.85, 0.58, 0.06];
const SAFE_GREEN: RGB = [0.14, 0.44, 0.24];
const CAGE_GREEN: RGB = [0.18, 0.55, 0.30];
const BELT_DARK: RGB = [0.08, 0.09, 0.10];
const FURNACE_SHELL: RGB = [0.16, 0.14, 0.14];
const EMBER_WARM: RGB = [1.0, 0.42, 0.08];
const LAMP_GLOW: RGB = [1.0, 0.85, 0.55];
const GREEN_GLOW: RGB = [0.35, 1.0, 0.52];

const HALL_HW = 9.75; // matches the exterior shop width in yard-build.ts
const EAVE = 7.8;
const RIDGE = 8.6;
const RAIL_Y = 6.1;

interface RollerSlot {
  conveyor: number;
  frac: number;
}

export interface PlantSceneParts {
  readonly drawCalls: number;
  readonly triangles: number;
}

export class PlantArt {
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly instanced: THREE.InstancedMesh[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();

  private rollerMesh!: THREE.InstancedMesh;
  private rollerSlots: RollerSlot[] = [];
  private hotMesh!: THREE.InstancedMesh;
  private emberMesh!: THREE.InstancedMesh;
  private craneTrolleyMesh!: THREE.InstancedMesh;
  private craneBeamMesh!: THREE.InstancedMesh;
  private craneShadowMesh!: THREE.InstancedMesh;
  private carrierGroup!: THREE.Group;
  private carrierLeftLeg!: THREE.Mesh;
  private carrierRightLeg!: THREE.Mesh;
  private heldParcel!: THREE.Group;
  private deliveredParcel!: THREE.Group;
  private parcelMat!: THREE.MeshLambertMaterial;
  private stride = 0;

  build(scene: THREE.Scene, layout: PlantLayout): PlantSceneParts {
    const m = new Mesher();
    const s = new Mesher();
    const glow = new Mesher();
    const atlas = new SignAtlas(1024, 1024);

    // Coordinate convention: player progress +z maps to scene -Z so the camera looks forward along -Z.
    const zMin = -PLANT_LENGTH - 5;
    const zMax = 6;
    const len = zMax - zMin;
    const zMid = (zMin + zMax) / 2;

    // ---- Shell: floor, walls, gable roof, steel columns, trusses and overhead crane rails ----
    m.at(0, 0, zMid);
    // Main floor slab + dark machinery aprons outside the walkable lane.
    m.quad([[-HALL_HW, 0, len / 2], [HALL_HW, 0, len / 2], [HALL_HW, 0, -len / 2], [-HALL_HW, 0, -len / 2]], FLOOR);
    for (const side of [-1, 1]) {
      const x0 = side > 0 ? PLANT_HALF_WIDTH + 0.3 : -HALL_HW;
      const x1 = side > 0 ? HALL_HW : -PLANT_HALF_WIDTH - 0.3;
      m.quad([[x0, 0.015, len / 2], [x1, 0.015, len / 2], [x1, 0.015, -len / 2], [x0, 0.015, -len / 2]], FLOOR_SIDE);
      // Yellow safety aisle stripes along the walkable edges.
      const sx = side * (PLANT_HALF_WIDTH + 0.16);
      m.quad([[sx - 0.12, 0.02, len / 2], [sx + 0.12, 0.02, len / 2], [sx + 0.12, 0.02, -len / 2], [sx - 0.12, 0.02, -len / 2]], YELLOW);
      // Side walls (inward-facing).
      const wx = side * HALL_HW;
      if (side > 0) m.quad([[wx, 0, -len / 2], [wx, 0, len / 2], [wx, EAVE, len / 2], [wx, EAVE, -len / 2]], WALL);
      else m.quad([[wx, 0, len / 2], [wx, 0, -len / 2], [wx, EAVE, -len / 2], [wx, EAVE, len / 2]], WALL);
      // Overhead crane runway girder along each wall.
      m.box(side * (HALL_HW - 0.45), RAIL_Y, 0, 0.42, 0.55, len, YELLOW, false);
    }
    // Gable roof slopes (inward-facing underside).
    m.quad([[-HALL_HW, EAVE, -len / 2], [0, RIDGE, -len / 2], [0, RIDGE, len / 2], [-HALL_HW, EAVE, len / 2]], ROOF);
    m.quad([[0, RIDGE, -len / 2], [HALL_HW, EAVE, -len / 2], [HALL_HW, EAVE, len / 2], [0, RIDGE, len / 2]], [ROOF[0] * 0.9, ROOF[1] * 0.9, ROOF[2] * 0.9]);
    // End walls (inward-facing: entrance wall behind player at zMax faces -Z, far wall at zMin faces +Z).
    m.quad([[HALL_HW, 0, zMax - zMid], [-HALL_HW, 0, zMax - zMid], [-HALL_HW, EAVE, zMax - zMid], [HALL_HW, EAVE, zMax - zMid]], WALL_DARK);
    m.quad([[-HALL_HW, 0, zMin - zMid], [HALL_HW, 0, zMin - zMid], [HALL_HW, EAVE, zMin - zMid], [-HALL_HW, EAVE, zMin - zMid]], WALL_DARK);

    // Steel columns, overhead roof trusses, and high-bay sodium lamps every 9 m.
    for (let z = -3; z <= PLANT_LENGTH + 3; z += 9) {
      m.at(0, 0, -z);
      for (const side of [-1, 1]) {
        m.box(side * (HALL_HW - 0.25), EAVE / 2, 0, 0.36, EAVE, 0.36, STEEL);
        m.box(side * (HALL_HW - 0.65), RAIL_Y - 0.45, 0, 0.6, 0.32, 0.32, STEEL, false);
      }
      // Roof chord + ridge brace.
      m.box(0, EAVE - 0.15, 0, HALL_HW * 2 - 0.5, 0.28, 0.26, STEEL, false);
      m.box(0, (EAVE + RIDGE) / 2, 0, 0.24, RIDGE - EAVE, 0.24, STEEL, false);
      // High-bay industrial lamp fixtures.
      for (const lx of [-3.6, 3.6]) {
        m.box(lx, EAVE - 0.52, 0, 0.75, 0.2, 0.75, WALL_DARK, false);
        glow.at(lx, EAVE - 0.64, -z);
        glow.box(0, 0, 0, 0.58, 0.08, 0.58, LAMP_GLOW, false);
      }
    }

    // ---- Safe crossing strips & start apron ----
    for (const [z0, z1] of [[0, 5], [43.2, 47.8], [88.2, 92.8]]) {
      const zm = -(z0 + z1) / 2;
      const zd = z1 - z0;
      m.at(0, 0, zm);
      m.quad([[-PLANT_HALF_WIDTH, 0.025, zd / 2], [PLANT_HALF_WIDTH, 0.025, zd / 2], [PLANT_HALF_WIDTH, 0.025, -zd / 2], [-PLANT_HALF_WIDTH, 0.025, -zd / 2]], SAFE_GREEN);
      for (const ez of [-zd / 2 + 0.12, zd / 2 - 0.12]) {
        m.quad([[-PLANT_HALF_WIDTH, 0.03, ez + 0.1], [PLANT_HALF_WIDTH, 0.03, ez + 0.1], [PLANT_HALF_WIDTH, 0.03, ez - 0.1], [-PLANT_HALF_WIDTH, 0.03, ez - 0.1]], YELLOW);
      }
    }

    // ---- Side scenery: steel coils in Bay 1, glowing reheating furnaces in Bay 2, I-beam racks in Bay 3 ----
    for (let z = 10; z <= 40; z += 10) {
      for (const side of [-1, 1]) {
        m.at(side * 8.1, 0, -z);
        m.cyl(0, 0.95, 0, 0.95, 1.5, side > 0 ? STEEL : RUST, 'x', 10);
        m.box(0, 0.12, 0, 1.7, 0.24, 2.2, WALL_DARK);
      }
    }
    for (let z = 52; z <= 84; z += 10) {
      for (const side of [-1, 1]) {
        m.at(side * 8.2, 0, -z);
        m.box(0, 1.9, 0, 2.5, 3.8, 5.2, FURNACE_SHELL);
        m.box(0, 4.4, 0, 0.85, 1.6, 0.85, WALL_DARK); // flue stack
        glow.at(side * 6.9, 1.35, -z);
        glow.box(0, 0, 0, 0.14, 1.45, 3.4, EMBER_WARM, false);
      }
    }
    for (let z = 98; z <= 126; z += 9) {
      for (const side of [-1, 1]) {
        m.at(side * 8.1, 0, -z);
        for (let l = 0; l < 3; l++) m.box(0, 0.3 + l * 0.55, 0, 1.6, 0.34, 5.5, l % 2 ? RUST : STEEL);
        m.box(-side * 1.2, 0.55, -2.5, 0.18, 1.1, 0.18, YELLOW);
        m.box(-side * 1.2, 0.55, 2.5, 0.18, 1.1, 0.18, YELLOW);
      }
    }

    // ---- Conveyor beds (static frames; animated rollers sit on top in rollerMesh) ----
    for (const c of layout.conveyors) {
      const cx = (c.x0 + c.x1) / 2;
      const cz = -(c.z0 + c.z1) / 2;
      const w = c.x1 - c.x0;
      const d = c.z1 - c.z0;
      m.at(cx, 0, cz);
      m.box(0, 0.045, 0, w, 0.09, d, BELT_DARK);
      const curbColor: RGB = c.vz > 0 ? CAGE_GREEN : c.vz < 0 ? [0.68, 0.22, 0.10] : YELLOW;
      if (c.vx !== 0) {
        m.box(0, 0.08, d / 2 - 0.12, w, 0.14, 0.22, curbColor);
        m.box(0, 0.08, -d / 2 + 0.12, w, 0.14, 0.22, curbColor);
      } else {
        m.box(-w / 2 + 0.12, 0.08, 0, 0.22, 0.14, d, curbColor);
        m.box(w / 2 - 0.12, 0.08, 0, 0.22, 0.14, d, curbColor);
      }
    }

    // ---- Hot spot steel curb frames (glowing grates live in hotMesh) ----
    for (const spot of layout.hotSpots) {
      m.at(spot.x, 0, -spot.z);
      const w = spot.halfX * 2 + 0.24, d = spot.halfZ * 2 + 0.24;
      m.box(0, 0.035, d / 2 - 0.06, w, 0.07, 0.12, STEEL);
      m.box(0, 0.035, -d / 2 + 0.06, w, 0.07, 0.12, STEEL);
      m.box(-w / 2 + 0.06, 0.035, 0, 0.12, 0.07, d, STEEL);
      m.box(w / 2 - 0.06, 0.035, 0, 0.12, 0.07, d, STEEL);
    }

    // ---- Static overhead bridge girders for each crane (trolley + load move along them) ----
    for (const crane of layout.cranes) {
      m.at(0, RAIL_Y + 0.48, -crane.z);
      m.box(0, 0, -0.32, HALL_HW * 2 - 0.7, 0.52, 0.28, YELLOW, false);
      m.box(0, 0, 0.32, HALL_HW * 2 - 0.7, 0.52, 0.28, YELLOW, false);
    }

    // ---- Dispatch Cage at the far end (z = PLANT_GOAL_Z..PLANT_LENGTH+3) ----
    const goalZ = -PLANT_GOAL_Z;
    m.at(0, 0, goalZ - 2.2);
    m.quad([[-PLANT_HALF_WIDTH, 0.03, 2.2], [PLANT_HALF_WIDTH, 0.03, 2.2], [PLANT_HALF_WIDTH, 0.03, -2.5], [-PLANT_HALF_WIDTH, 0.03, -2.5]], CAGE_GREEN);
    // Counter desk + safety frame.
    m.box(0, 0.55, -1.6, 5.4, 1.1, 1.1, STEEL);
    m.box(0, 1.12, -1.6, 5.6, 0.08, 1.2, [0.58, 0.56, 0.50]);
    for (const px of [-3.4, 3.4]) m.box(px, 2.35, 1.6, 0.24, 4.7, 0.24, YELLOW);
    m.box(0, 4.6, 1.6, 7.0, 0.32, 0.28, YELLOW, false);
    // Foreman behind the counter (hi-vis vest, hard hat).
    m.box(0.9, 1.38, -2.55, 0.54, 0.68, 0.34, [0.85, 0.42, 0.04]);
    m.box(0.9, 1.92, -2.55, 0.28, 0.3, 0.28, [0.76, 0.60, 0.48]);
    m.box(0.9, 2.12, -2.55, 0.35, 0.16, 0.35, [0.92, 0.90, 0.85]); // white hard hat
    glow.at(0, 4.32, goalZ - 0.6);
    glow.box(0, 0, 0, 5.2, 0.18, 0.18, GREEN_GLOW, false);

    // ---- Overhead signs (hung high at y = 6.35 m, well above the 4.7 m chase camera) ----
    const addSign = (lines: string[], fg: string, bg: string, border: string, y: number, z: number, w: number, h: number) => {
      const slot = atlas.add(512, 192, (g, cw, ch) => letters(g, cw, ch, lines, fg, bg, { border }));
      m.at(0, y, -z);
      m.box(0, 0, -0.06, w + 0.18, h + 0.18, 0.1, WALL_DARK, false);
      s.at(0, y, -z);
      s.plate(w, h, slot.cell);
    };
    addSign(['HARBOUR RIDGE SHOP', 'BAY 1 · CONVEYORS'], '#ffe58a', '#161b22', '#e0a020', 6.35, 7.5, 6.2, 1.3);
    addSign(['BAY 2 · HOT FLOOR', 'CROSS ON DARK IRON'], '#ffb070', '#211310', '#e85a1c', 6.35, 46.5, 6.2, 1.3);
    addSign(['BAY 3 · CRANE SPAN', 'WATCH FLOOR SHADOWS'], '#ffe58a', '#1b1912', '#e0a020', 6.35, 91.5, 6.4, 1.3);
    addSign(['DISPATCH CAGE', 'DROP PARCEL HERE'], '#c8ffd6', '#102418', '#3dd672', 3.55, PLANT_GOAL_Z + 4.4, 5.8, 1.35);

    // Finalize static meshes.
    const staticGeo = m.geometry();
    const staticMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const staticMesh = new THREE.Mesh(staticGeo, staticMat);
    scene.add(staticMesh);

    const signGeo = s.geometry();
    const signMat = new THREE.MeshLambertMaterial({ map: atlas.texture, emissiveMap: atlas.texture, emissive: 0xffffff, emissiveIntensity: 0.35 });
    const signMesh = new THREE.Mesh(signGeo, signMat);
    scene.add(signMesh);

    const glowGeo = glow.geometry();
    const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const glowMesh = new THREE.Mesh(glowGeo, glowMat);
    scene.add(glowMesh);

    this.geometries.push(staticGeo, signGeo, glowGeo);
    this.materials.push(staticMat, signMat, glowMat);
    this.textures.push(atlas.texture);

    // ---- Instanced animated conveyor rollers ----
    this.rollerSlots = [];
    for (let i = 0; i < layout.conveyors.length; i++) {
      const c = layout.conveyors[i];
      const count = c.vx !== 0 ? 7 : 5;
      for (let k = 0; k < count; k++) this.rollerSlots.push({ conveyor: i, frac: k / count });
    }
    const rollerGeo = new THREE.BoxGeometry(1, 0.05, 1);
    const rollerMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.rollerMesh = new THREE.InstancedMesh(rollerGeo, rollerMat, this.rollerSlots.length);
    this.rollerMesh.frustumCulled = false;
    this.rollerSlots.forEach((slot, i) => {
      const c = layout.conveyors[slot.conveyor];
      this.color.setHex(c.vz > 0 ? 0x3ec96b : c.vz < 0 ? 0xd9552c : 0xd9a630);
      this.rollerMesh.setColorAt(i, this.color);
    });
    if (this.rollerMesh.instanceColor) this.rollerMesh.instanceColor.needsUpdate = true;
    scene.add(this.rollerMesh);
    this.geometries.push(rollerGeo);
    this.materials.push(rollerMat);

    // ---- Instanced hot floor grates + rising ember bars ----
    const hotGeo = new THREE.BoxGeometry(1, 0.06, 1);
    const hotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.hotMesh = new THREE.InstancedMesh(hotGeo, hotMat, layout.hotSpots.length);
    this.hotMesh.frustumCulled = false;
    scene.add(this.hotMesh);

    const emberGeo = new THREE.BoxGeometry(0.18, 0.45, 0.18);
    const emberMat = new THREE.MeshBasicMaterial({ color: 0xff6e1a });
    this.emberMesh = new THREE.InstancedMesh(emberGeo, emberMat, layout.hotSpots.length * 3);
    this.emberMesh.frustumCulled = false;
    scene.add(this.emberMesh);
    this.geometries.push(hotGeo, emberGeo);
    this.materials.push(hotMat, emberMat);

    // ---- Instanced overhead cranes (trolley+cables, suspended I-beam load, floor hazard shadow) ----
    const nCranes = layout.cranes.length;
    const trolleyMesher = new Mesher();
    trolleyMesher.at(0, 0, 0);
    trolleyMesher.box(0, 0, 0, 1.3, 0.55, 1.1, [0.22, 0.25, 0.29], false);
    for (const cx of [-0.95, 0.95]) trolleyMesher.box(cx, -2.4, 0, 0.06, 4.4, 0.06, [0.55, 0.58, 0.60], false);
    const trolleyGeo = trolleyMesher.geometry();
    const trolleyMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.craneTrolleyMesh = new THREE.InstancedMesh(trolleyGeo, trolleyMat, nCranes);
    this.craneTrolleyMesh.frustumCulled = false;
    scene.add(this.craneTrolleyMesh);

    const beamMesher = new Mesher();
    beamMesher.at(0, 0, 0);
    // Heavy structural I-beam load (unit X length = 1, scaled per crane halfX*2).
    beamMesher.box(0, 0.32, 0, 1.0, 0.14, 0.72, RUST, false);
    beamMesher.box(0, 0, 0, 1.0, 0.52, 0.2, [0.35, 0.16, 0.09], false);
    beamMesher.box(0, -0.32, 0, 1.0, 0.14, 0.72, RUST, false);
    // Bright yellow end caps so the hanging load reads immediately against the dark plant floor.
    beamMesher.box(-0.48, 0, 0, 0.06, 0.8, 0.76, YELLOW, false);
    beamMesher.box(0.48, 0, 0, 0.06, 0.8, 0.76, YELLOW, false);
    const beamGeo = beamMesher.geometry();
    const beamMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.craneBeamMesh = new THREE.InstancedMesh(beamGeo, beamMat, nCranes);
    this.craneBeamMesh.frustumCulled = false;
    scene.add(this.craneBeamMesh);

    const shadowGeo = new THREE.BoxGeometry(1, 0.025, 1);
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0xf5b324 });
    this.craneShadowMesh = new THREE.InstancedMesh(shadowGeo, shadowMat, nCranes);
    this.craneShadowMesh.frustumCulled = false;
    scene.add(this.craneShadowMesh);
    this.instanced.push(
      this.rollerMesh,
      this.hotMesh,
      this.emberMesh,
      this.craneTrolleyMesh,
      this.craneBeamMesh,
      this.craneShadowMesh,
    );
    this.geometries.push(trolleyGeo, beamGeo, shadowGeo);
    this.materials.push(trolleyMat, beamMat, shadowMat);

    // ---- Mail carrier carrying the steel-strapped parcel ----
    this.carrierGroup = new THREE.Group();
    const bodyMesher = new Mesher();
    bodyMesher.at(0, 0, 0);
    // Torso (hi-vis mail/safety vest over navy coat), arms reaching forward, head + cap.
    bodyMesher.box(0, 1.12, 0, 0.52, 0.62, 0.3, [0.92, 0.44, 0.05], false);
    bodyMesher.box(0, 1.12, 0.16, 0.48, 0.1, 0.02, [0.85, 0.92, 0.25], false); // reflective strip on back
    for (const ax of [-0.32, 0.32]) bodyMesher.box(ax, 1.1, -0.25, 0.14, 0.16, 0.52, [0.16, 0.22, 0.34], false);
    bodyMesher.box(0, 1.62, 0, 0.28, 0.28, 0.28, [0.80, 0.64, 0.50], false);
    bodyMesher.box(0, 1.79, -0.04, 0.32, 0.1, 0.36, [0.14, 0.24, 0.42], false);
    const bodyGeo = bodyMesher.geometry();
    const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.carrierGroup.add(new THREE.Mesh(bodyGeo, bodyMat));

    const legGeo = new THREE.BoxGeometry(0.18, 0.72, 0.2);
    const legMat = new THREE.MeshLambertMaterial({ color: 0x222c3c, flatShading: true });
    this.carrierLeftLeg = new THREE.Mesh(legGeo, legMat);
    this.carrierLeftLeg.position.set(-0.14, 0.36, 0);
    this.carrierRightLeg = new THREE.Mesh(legGeo, legMat);
    this.carrierRightLeg.position.set(0.14, 0.36, 0);
    this.carrierGroup.add(this.carrierLeftLeg, this.carrierRightLeg);

    this.parcelMat = new THREE.MeshLambertMaterial({ color: 0xc2985a, flatShading: true });
    const parcelGeo = new THREE.BoxGeometry(0.68, 0.44, 0.52);
    const strapGeo = new THREE.BoxGeometry(0.70, 0.46, 0.08);
    const strapMat = new THREE.MeshLambertMaterial({ color: 0x353c44, flatShading: true });

    const makeParcel = (): THREE.Group => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(parcelGeo, this.parcelMat));
      for (const sz of [-0.14, 0.14]) {
        const strap = new THREE.Mesh(strapGeo, strapMat);
        strap.position.z = sz;
        g.add(strap);
      }
      return g;
    };
    this.heldParcel = makeParcel();
    this.heldParcel.position.set(0, 1.14, -0.58);
    this.carrierGroup.add(this.heldParcel);
    scene.add(this.carrierGroup);

    this.deliveredParcel = makeParcel();
    this.deliveredParcel.position.set(-0.6, 1.38, goalZ - 3.8);
    this.deliveredParcel.visible = false;
    scene.add(this.deliveredParcel);

    this.geometries.push(bodyGeo, legGeo, parcelGeo, strapGeo);
    this.materials.push(bodyMat, legMat, this.parcelMat, strapMat);

    // Count exact meshes & triangles once for checks.
    let drawCalls = 0, triangles = 0;
    scene.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        drawCalls++;
        const count = mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count;
        const instances = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1;
        triangles += (count / 3) * instances;
      }
    });
    return { drawCalls, triangles };
  }

  sync(run: PlantRun, dt: number): void {
    const d = this.dummy;
    const t = run.elapsed;

    // 1. Animated conveyor rollers travelling along belt velocity.
    for (let i = 0; i < this.rollerSlots.length; i++) {
      const slot = this.rollerSlots[i];
      const c = run.layout.conveyors[slot.conveyor];
      const w = c.x1 - c.x0, depth = c.z1 - c.z0;
      if (c.vx !== 0) {
        const phase = (((slot.frac + (t * c.vx) / w) % 1) + 1) % 1;
        d.position.set(c.x0 + phase * w, 0.095, -(c.z0 + c.z1) / 2);
        d.rotation.set(0, 0, 0);
        d.scale.set(0.32, 1, depth - 0.55);
      } else {
        const phase = (((slot.frac + (t * c.vz) / depth) % 1) + 1) % 1;
        d.position.set((c.x0 + c.x1) / 2, 0.095, -(c.z0 + phase * depth));
        d.rotation.set(0, 0, 0);
        d.scale.set(w - 0.55, 1, 0.32);
      }
      d.updateMatrix();
      this.rollerMesh.setMatrixAt(i, d.matrix);
    }
    this.rollerMesh.instanceMatrix.needsUpdate = true;

    // 2. Hot floor grates + rising embers.
    let emberIdx = 0;
    for (let i = 0; i < run.layout.hotSpots.length; i++) {
      const spot = run.layout.hotSpots[i];
      const reading = hotSpotState(spot, t);
      d.position.set(spot.x, 0.035, -spot.z);
      d.rotation.set(0, 0, 0);
      d.scale.set(spot.halfX * 2, 1, spot.halfZ * 2);
      d.updateMatrix();
      this.hotMesh.setMatrixAt(i, d.matrix);
      if (reading.state === 'hot') {
        const pulse = 0.88 + 0.12 * Math.sin(t * 22 + i);
        this.color.setRGB(1.0 * pulse, 0.24 * pulse, 0.04);
      } else if (reading.state === 'warn') {
        const blink = 0.55 + 0.45 * Math.sin(t * 18 + i);
        const k = reading.intensity * blink;
        this.color.setRGB(0.22 + 0.72 * k, 0.18 + 0.36 * k, 0.16 * (1 - k));
      } else {
        this.color.setRGB(0.16, 0.17, 0.19);
      }
      this.hotMesh.setColorAt(i, this.color);

      // Three rising ember bars above active hot grates (scaled to 0 when cool).
      for (let k = 0; k < 3; k++) {
        if (reading.state === 'hot') {
          const rise = ((t * 1.4 + k * 0.33 + i * 0.17) % 1);
          const ox = (k - 1) * spot.halfX * 0.6;
          const oz = Math.sin(t * 3 + k * 2 + i) * spot.halfZ * 0.45;
          d.position.set(spot.x + ox, 0.2 + rise * 1.4, -(spot.z + oz));
          d.rotation.set(0, t * 2 + k, 0);
          const s = 1 - rise * 0.7;
          d.scale.set(s, s, s);
        } else {
          d.position.set(0, -10, 0);
          d.scale.set(0, 0, 0);
        }
        d.updateMatrix();
        this.emberMesh.setMatrixAt(emberIdx++, d.matrix);
      }
    }
    this.hotMesh.instanceMatrix.needsUpdate = true;
    if (this.hotMesh.instanceColor) this.hotMesh.instanceColor.needsUpdate = true;
    this.emberMesh.instanceMatrix.needsUpdate = true;

    // 3. Moving overhead bridge cranes + hanging beams + yellow floor hazard zones.
    for (let i = 0; i < run.layout.cranes.length; i++) {
      const crane = run.layout.cranes[i];
      const cx = craneX(crane, t);
      const cz = -crane.z;
      const sway = Math.cos(t * crane.speed + crane.phase) * 0.04;

      d.position.set(cx, RAIL_Y - 0.05, cz);
      d.rotation.set(0, 0, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      this.craneTrolleyMesh.setMatrixAt(i, d.matrix);

      d.position.set(cx, 1.35, cz);
      d.rotation.set(0, 0, sway);
      d.scale.set(crane.halfX * 2, 1, 1);
      d.updateMatrix();
      this.craneBeamMesh.setMatrixAt(i, d.matrix);

      d.position.set(cx, 0.04, cz);
      d.rotation.set(0, 0, 0);
      d.scale.set(crane.halfX * 2 + 0.2, 1, crane.halfZ * 2 + 0.2);
      d.updateMatrix();
      this.craneShadowMesh.setMatrixAt(i, d.matrix);
    }
    this.craneTrolleyMesh.instanceMatrix.needsUpdate = true;
    this.craneBeamMesh.instanceMatrix.needsUpdate = true;
    this.craneShadowMesh.instanceMatrix.needsUpdate = true;

    // 4. Carrier pose, walking stride, parcel integrity colour & delivery handoff.
    this.carrierGroup.position.set(run.x, 0, -run.z);
    const moveSpeed = Math.hypot(run.vx, run.vz);
    if (moveSpeed > 0.2 && run.phase === 'running') this.stride += dt * moveSpeed * 3.4;
    const swing = moveSpeed > 0.2 && run.phase === 'running' ? Math.sin(this.stride) * 0.48 : 0;
    this.carrierLeftLeg.rotation.x = swing;
    this.carrierRightLeg.rotation.x = -swing;
    this.carrierGroup.rotation.y = Math.max(-0.35, Math.min(0.35, -run.vx * 0.09));

    const delivered = run.phase === 'delivered' || (run.phase === 'finished' && !!run.result?.delivered);
    const ruined = run.phase === 'ruined' || (run.phase === 'finished' && run.integrity <= 0);
    const flash = run.phase === 'running' && run.invuln > 0 && Math.floor(run.invuln * 14) % 2 === 0;
    this.parcelMat.color.setHex(
      flash ? 0xff4c24 : run.integrity === 3 ? 0xc2985a : run.integrity === 2 ? 0x9c6e44 : 0x6e4234,
    );
    this.heldParcel.visible = !delivered && !ruined;
    this.heldParcel.position.y = 1.14 + Math.abs(Math.sin(this.stride)) * 0.04;
    this.heldParcel.rotation.z = run.phase === 'running' && run.invuln > 0.8 ? Math.sin(run.invuln * 30) * 0.28 : 0;
    this.deliveredParcel.visible = delivered;
  }

  dispose(): void {
    for (const mesh of this.instanced) mesh.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
