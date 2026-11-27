import * as THREE from 'three';
import {
  PARKED_COLOURS, ParkedVehicles, parkedSolid, pushOut,
  type Parked, type Pushable, type Solid,
} from './parked';
import type { HandBuiltPlace } from './place';
import {
  BROOK_PARKED_SPOTS, CHURCH_CENTER_V, type BrookVillageSite, type LocalFrame,
} from './brook-village-site';
import type { Terrain } from './terrain';
import { Mesher, SignAtlas, letters, seeded, type RGB } from './yard-kit';

/**
 * Brook Village hand-built landmarks (Mabou area, Highway 252):
 * 1. General store (building 69, corner of Highway 252 and Lake Ainslie Chapel Road):
 *    - two-storey steep-gabled weathered cedar-shingle building with lower rear extension;
 *    - bright emerald-green standing-seam metal main roof with rear brick chimney and bright yellow fascia,
 *      rake boards, corner boards and side window frames;
 *    - royal-blue recessed storefront with half-glass blue door, two large display windows (rainbow curtain
 *      visible inside the left window), dark pent awning roof, concrete stoop and straw bale;
 *    - upper front gable with two blue-framed windows, oval scenic medallion, arched invented sign
 *      ("BROOK VILLAGE / GENERAL STORE" — invented business name, keeping Brook Village as place name)
 *      and twin black gooseneck barn lamps;
 *    - west wall green-roofed wooden bin shelter, leaning ladder, heat-pump condenser, invented rustic
 *      wall plaques, plus a white/silver shipping container with rust-red doors, pallets and concrete curb block.
 * 2. St. John the Baptist Roman Catholic Church (building 1570, ~110 m east on the south side of Highway 252):
 *    - cream-white shingled cruciform church with dark charcoal shingled steep gable roof, white corner
 *      pilasters, eave returns and rear ridge finial cross;
 *    - front ridge-mounted square shingled bell tower with four arched louvered belfry vents, white cornice,
 *      steep dark pyramidal spire, orb finial and cross;
 *    - distinctive twin-arched nave windows, grand triple-arched front Venetian gable window, twin-arched
 *      front ground windows and arched west vestry door with wooden steps;
 *    - classical pedimented front portico with paired fluted white columns, semicircular tympanum emblem,
 *      arched dark double doors with fanlight transom, concrete front steps, cedar-and-black-baluster
 *      railings and long accessible ramp along the north front wall;
 *    - white metal flagpole with Canadian flag and two-post white wooden church signboard on the wide
 *      mown west lawn.
 *
 * No civic numbers, real resident names, or external image pixels are used.
 */
const hex = (value: number): RGB => { const c = new THREE.Color(value); return [c.r, c.g, c.b]; };
const shade = (k: RGB, f: number): RGB => [k[0] * f, k[1] * f, k[2] * f];

// Store palette
const CEDAR = hex(0xa39b8e);
const CEDAR_DARK = hex(0x70695e);
const GREEN_ROOF = hex(0x2d8b59);
const REAR_ROOF = hex(0x3f5f4e);
const YELLOW_TRIM = hex(0xe7c624);
const STORE_BLUE = hex(0x2c4a9c);
const STORE_DOOR = hex(0x3252b2);
const AWNING_DARK = hex(0x2f363e);
const BRICK = hex(0x7b3a30);
const STRAW = hex(0xc69f48);
const BIN_GREEN = hex(0x1f5a38);
const CONTAINER_WHITE = hex(0xd5d8d6);
const CONTAINER_RUST = hex(0x9a3d2b);
const PALLET_WOOD = hex(0xb38a54);
const CURTAIN_COLS: readonly RGB[] = [
  hex(0xd94b45), hex(0xe69138), hex(0xe8c945), hex(0x4ba35b), hex(0x3f78b8), hex(0x7c52a3),
];

// Church palette
const CHURCH_WALL = hex(0xede7db);
const CHURCH_TRIM = hex(0xf8f8f5);
const CHURCH_ROOF = hex(0x3a4046);
const CHURCH_FOUND = hex(0x272c31);
const CHURCH_DOOR = hex(0x1d2126);
const ARCH_HOOD = hex(0x2b3238);
const CEDAR_RAIL = hex(0xac7d42);
const BALUSTER = hex(0x23272b);
const CONCRETE = hex(0xb5b4ac);
const GLASS = hex(0x25343f);
const GLASS_WARM = hex(0x33454f);
const IRON = hex(0x2a2e32);
const STEEL = hex(0xa6abae);
const LAMP_GLOW = hex(0xfff1c8);
const GOLD = hex(0xd6ae40);
const MULCH = hex(0x4c3627);

// ---- Exported footprint constants (used by node & browser checks) ----
export const STORE_MAIN = { u0: -2.0, u1: 9.0, v0: -3.9, v1: 4.7, eave: 4.65, ridge: 8.45 };
export const STORE_REAR = { u0: -9.0, u1: -2.0, v0: -3.7, v1: 4.5, eave: 4.65, ridge: 6.35 };
export const STORE_CONTAINER = { u0: 0.0, u1: 8.0, v0: 13.6, v1: 16.2, height: 2.6 };
export const STORE_CURB = { u: 10.6, v: 17.5 };

const CV = CHURCH_CENTER_V;
export const CHURCH_NAVE = { u0: -10.5, u1: 12.5, v0: CV - 6.3, v1: CV + 6.3, eave: 5.15, ridge: 11.6 };
export const CHURCH_WINGS = { u0: -9.5, u1: -1.5, v0: CV - 9.3, v1: CV + 9.3, eave: 4.35, ridge: 8.4 };
export const CHURCH_PORTICO = { u0: 12.5, u1: 14.8, v0: CV - 2.2, v1: CV + 2.2, eave: 3.65, peak: 4.9 };
export const CHURCH_STEPS = { u0: 14.8, u1: 16.3, v0: CV - 2.0, v1: CV + 2.0, top: 0.65 };
export const CHURCH_RAMP = { u0: 13.4, u1: 14.7, v0: CV - 9.7, v1: CV - 2.0, top: 0.65 };
export const CHURCH_TOWER = { u0: 9.3, u1: 12.5, v0: CV - 1.6, v1: CV + 1.6, top: 13.75, spire: 15.85, cross: 17.35 };
export const CHURCH_FLAGPOLE = { u: -2.0, v: -24.0, height: 8.0 };
export const CHURCH_SIGNBOARD = { u: 10.0, v: -35.0, yaw: -0.18, w: 2.3, h: 1.25 };

interface SignCells {
  storeGable: [number, number, number, number];
  storePlaqueA: [number, number, number, number];
  storePlaqueB: [number, number, number, number];
  churchSign: [number, number, number, number];
  churchEmblem: [number, number, number, number];
  flag: [number, number, number, number];
}

function buildSignAtlas(): { atlas: SignAtlas; cells: SignCells } | null {
  if (typeof document === 'undefined') return null;
  const atlas = new SignAtlas(1024, 512);

  // 1. Store front gable sign: weathered cedar board with arched INVENTED name & scenic oval medallion.
  const storeGable = atlas.add(512, 240, (g, w, h) => {
    g.fillStyle = '#a39b8e';
    g.fillRect(0, 0, w, h);
    // Subtle cedar shingle course lines behind the painted letters.
    for (let y = 0; y < h; y += 16) {
      g.fillStyle = 'rgba(55,50,44,0.14)';
      g.fillRect(0, y + 14, w, 2);
    }
    // Arched white serif title: "BROOK VILLAGE" (place name) over "GENERAL STORE" (invented business name).
    const text = 'BROOK VILLAGE';
    const cx = w / 2, cy = 258, rad = 215;
    g.font = 'bold 36px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const spread = 1.40;
    for (let i = 0; i < text.length; i++) {
      const a = -spread / 2 + (spread * i) / (text.length - 1);
      g.save();
      g.translate(cx + Math.sin(a) * rad, cy - Math.cos(a) * rad);
      g.rotate(a);
      g.fillStyle = '#2b2824';
      g.fillText(text[i], 2, 2);
      g.fillStyle = '#f8f6ef';
      g.fillText(text[i], 0, 0);
      g.restore();
    }
    g.font = 'bold 31px Georgia, serif';
    g.fillStyle = '#2b2824';
    g.fillText('· GENERAL STORE ·', w / 2 + 2, 110);
    g.fillStyle = '#f8f6ef';
    g.fillText('· GENERAL STORE ·', w / 2, 108);

    // Oval painted scenic medallion (sky, Cape Breton hills, brook & bridge motif).
    const ox = w / 2, oy = 178, rx = 74, ry = 42;
    g.save();
    g.beginPath();
    g.ellipse(ox, oy, rx, ry, 0, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#7ec0e6';
    g.fillRect(ox - rx, oy - ry, rx * 2, ry * 2);
    g.fillStyle = '#489454';
    g.beginPath();
    g.moveTo(ox - rx, oy + 6);
    g.quadraticCurveTo(ox - 20, oy - 18, ox + 16, oy + 2);
    g.quadraticCurveTo(ox + 52, oy - 12, ox + rx, oy + 4);
    g.lineTo(ox + rx, oy + ry);
    g.lineTo(ox - rx, oy + ry);
    g.closePath();
    g.fill();
    g.fillStyle = '#2b6cb0';
    g.beginPath();
    g.ellipse(ox, oy + 28, rx * 0.85, 22, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#f5f2e6';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(ox - 48, oy + 8);
    g.lineTo(ox + 48, oy + 8);
    g.stroke();
    g.restore();
    g.strokeStyle = '#25428a';
    g.lineWidth = 6;
    g.beginPath();
    g.ellipse(ox, oy, rx, ry, 0, 0, Math.PI * 2);
    g.stroke();
  }).cell;

  // 2. Two small invented rustic plaques for the west wall (no real brands).
  const storePlaqueA = atlas.add(160, 120, (g, w, h) => {
    g.fillStyle = '#f3f1ea';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2c4a9c';
    g.lineWidth = 6;
    g.strokeRect(4, 4, w - 8, h - 8);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
      g.fillStyle = (r + c) % 2 === 0 ? '#b6352e' : '#f3f1ea';
      g.fillRect(14 + c * 33, 14 + r * 22, 33, 22);
    }
    g.fillStyle = '#1f3672';
    g.font = 'bold 20px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('FEED & SEED', w / 2, 86, w - 20);
  }).cell;

  const storePlaqueB = atlas.add(160, 100, (g, w, h) => {
    letters(g, w, h, ['LOCAL', 'BAKERY'], '#fff9eb', '#a64d2c', {
      font: 'Georgia, serif', border: '#f0d68a', weights: [1, 1],
    });
  }).cell;

  // 3. Church lawn signboard (real public name in plain text, matching church.ts).
  const churchSign = atlas.add(512, 240, (g, w, h) => {
    g.fillStyle = '#f6f5ef';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#334252';
    g.lineWidth = 10;
    g.strokeRect(10, 10, w - 20, h - 20);
    g.strokeStyle = '#8b97a2';
    g.lineWidth = 3;
    g.strokeRect(22, 22, w - 44, h - 44);
    g.fillStyle = '#222f3c';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 38px Georgia, serif';
    g.fillText('ST. JOHN THE BAPTIST', w / 2, 74, w - 70);
    g.font = 'bold 24px Georgia, serif';
    g.fillStyle = '#3c4c5c';
    g.fillText('ROMAN CATHOLIC CHURCH', w / 2, 128, w - 70);
    g.font = 'bold 22px sans-serif';
    g.fillStyle = '#5c4c38';
    g.fillText('BROOK VILLAGE  ·  1893', w / 2, 178, w - 80);
  }).cell;

  // 4. Semicircular decorative pediment emblem for the church portico.
  const churchEmblem = atlas.add(128, 96, (g, w, h) => {
    g.fillStyle = '#f5f4ee';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3b4e3f';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(w / 2, h - 14, 42, Math.PI, 0);
    g.closePath();
    g.fillStyle = '#dfe5dc';
    g.fill();
    g.stroke();
    g.fillStyle = '#8a7234';
    g.fillRect(w / 2 - 4, h - 48, 8, 28);
    g.fillRect(w / 2 - 12, h - 40, 24, 7);
  }).cell;

  // 5. Canadian flag for the church lawn flagpole.
  const flag = atlas.add(192, 96, (g, w, h) => {
    g.fillStyle = '#d4262b';
    g.fillRect(0, 0, w * 0.25, h);
    g.fillRect(w * 0.75, 0, w * 0.25, h);
    g.fillStyle = '#f7f7f4';
    g.fillRect(w * 0.25, 0, w * 0.5, h);
    // Clean geometric maple leaf centred on the white pale.
    g.fillStyle = '#d4262b';
    g.beginPath();
    const cx = w / 2, cy = h / 2;
    g.moveTo(cx, cy - 30);
    g.lineTo(cx + 8, cy - 12);
    g.lineTo(cx + 24, cy - 16);
    g.lineTo(cx + 18, cy - 2);
    g.lineTo(cx + 28, cy + 4);
    g.lineTo(cx + 10, cy + 12);
    g.lineTo(cx + 12, cy + 20);
    g.lineTo(cx + 3, cy + 18);
    g.lineTo(cx + 3, cy + 32);
    g.lineTo(cx - 3, cy + 32);
    g.lineTo(cx - 3, cy + 18);
    g.lineTo(cx - 12, cy + 20);
    g.lineTo(cx - 10, cy + 12);
    g.lineTo(cx - 28, cy + 4);
    g.lineTo(cx - 18, cy - 2);
    g.lineTo(cx - 24, cy - 16);
    g.lineTo(cx - 8, cy - 12);
    g.closePath();
    g.fill();
  }).cell;

  return { atlas, cells: { storeGable, storePlaqueA, storePlaqueB, churchSign, churchEmblem, flag } };
}

interface RoofBox {
  frame: LocalFrame;
  u0: number; u1: number; v0: number; v1: number; top: number;
}

export class BrookVillage implements HandBuiltPlace {
  readonly group = new THREE.Group();
  private storeLocal = new THREE.Group();
  private churchLocal = new THREE.Group();
  private solids: Solid[] = [];
  private roofs: RoofBox[] = [];
  private built = false; private near = false; private drawnOk = false; private groundSig = NaN;
  private material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private signMaterial: THREE.MeshLambertMaterial;
  private signCells: SignCells;
  private parked: ParkedVehicles;
  private parkedList: Parked[];
  private probes: { x: number; z: number }[];
  /** Triangles in the hand-built store, church and sign meshes (excluding instanced parked vehicles). */
  triangles = 0;
  /** Triangles across all instanced parked vehicles. */
  parkedTriangles = 0;
  /** Full feature triangle count (buildings + signs + parked vehicles). */
  get totalTriangles(): number { return this.triangles + this.parkedTriangles; }

  constructor(readonly site: BrookVillageSite, private terrain: Terrain, private lift: (metres: number) => number, private low: boolean) {
    this.group.name = 'brook-village';

    this.storeLocal.position.set(site.store.origin.x, 0, site.store.origin.z);
    this.storeLocal.rotation.y = site.store.yaw;
    this.group.add(this.storeLocal);

    this.churchLocal.position.set(site.church.origin.x, 0, site.church.origin.z);
    this.churchLocal.rotation.y = site.church.yaw;
    this.group.add(this.churchLocal);
    this.group.visible = false;

    const builtAtlas = buildSignAtlas();
    this.signCells = builtAtlas?.cells ?? {
      storeGable: [0, 0, 1, 1], storePlaqueA: [0, 0, 1, 1], storePlaqueB: [0, 0, 1, 1],
      churchSign: [0, 0, 1, 1], churchEmblem: [0, 0, 1, 1], flag: [0, 0, 1, 1],
    };
    this.signMaterial = builtAtlas
      ? new THREE.MeshLambertMaterial({ vertexColors: true, map: builtAtlas.atlas.texture, side: THREE.DoubleSide })
      : new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

    const rnd = seeded(691570);
    this.parkedList = BROOK_PARKED_SPOTS.map((sp) => {
      const f = sp.place === 'store' ? site.store : site.church;
      const w = f.world(sp.u, sp.v);
      const wobble = (rnd() - 0.5) * 0.06;
      const colour = PARKED_COLOURS[Math.floor(rnd() * PARKED_COLOURS.length)];
      return { x: w.x, z: w.z, heading: f.heading(sp.du, sp.dv) + wobble, type: sp.type, colour };
    });
    this.parked = new ParkedVehicles(
      this.parkedList,
      (x, z) => this.terrain.meshHeightAt?.(x, z, true) ?? this.terrain.heightAt(x, z) ?? this.lift(this.site.store.level),
      this.material,
    );
    this.parked.group.name = 'brook-village-parked';
    let parkedTris = 0;
    for (const child of this.parked.group.children) {
      child.castShadow = child.receiveShadow = !this.low;
      const inst = child as THREE.InstancedMesh;
      if (inst.isInstancedMesh) {
        const geo = inst.geometry;
        const trisPer = geo.index ? geo.index.count / 3 : (geo.getAttribute('position')?.count ?? 0) / 3;
        parkedTris += trisPer * inst.count;
      }
    }
    this.parkedTriangles = parkedTris;
    this.group.add(this.parked.group);

    this.probes = [
      site.store.world(0, 0),
      site.store.world(-4, 16),
      site.church.world(1, CV),
      site.church.world(16, CV),
      site.church.world(CHURCH_FLAGPOLE.u, CHURCH_FLAGPOLE.v),
      site.church.world(CHURCH_SIGNBOARD.u, CHURCH_SIGNBOARD.v),
    ];
    this.initSolids();
  }

  get parkedCount(): number { return this.parkedList.length; }

  get waiting(): boolean { return this.near && !this.built && ((this.terrain.pending ?? 0) > 0 || this.ready()); }

  private g(frame: LocalFrame, u: number, v: number): number {
    const w = frame.world(u, v);
    return this.terrain.meshHeightAt?.(w.x, w.z, true) ?? this.terrain.heightAt(w.x, w.z) ?? this.lift(frame.level);
  }

  private ready(): boolean {
    for (const p of this.probes) {
      const level = this.terrain.drawnLevelAt ? (this.terrain.drawnLevelAt(p.x, p.z) ?? -1) : (this.terrain.levelAt?.(p.x, p.z) ?? -1);
      if (level < 8) return false;
    }
    return true;
  }

  private probeGroundSig(): number {
    let sig = 0;
    const fb = this.lift(this.site.store.level);
    for (let i = 0; i < this.probes.length; i++) {
      const p = this.probes[i];
      const h = this.terrain.meshHeightAt?.(p.x, p.z, true) ?? this.terrain.heightAt(p.x, p.z) ?? fb;
      sig += h * (i + 1);
    }
    return sig;
  }

  update(view: THREE.Vector3, _now: number, car: { x: number; z: number }): void {
    const o = this.site.origin;
    const far = Math.min(Math.hypot(view.x - o.x, view.z - o.z), Math.hypot(car.x - o.x, car.z - o.z));
    this.near = far < 950;
    const ok = (this.near || (this.built && far < 1650)) && this.ready();
    if (ok) {
      const sig = this.probeGroundSig();
      if (!this.built || sig !== this.groundSig) {
        this.build();
        this.parked.seat();
        this.built = true;
        this.groundSig = sig;
      }
    }
    this.drawnOk = ok;
    this.group.visible = this.built && this.drawnOk && far < 1650;
  }

  /** Drone roof floor height at world (x, z), matching drone.ts 1 m footprint margin. */
  roofAt(x: number, z: number): number {
    const b = this.site.box;
    if (x < b[0] - 2 || x > b[2] + 2 || z < b[1] - 2 || z > b[3] + 2) return -Infinity;
    const list = this.roofs.length ? this.roofs : this.liveRoofs();
    const margin = 1;
    let best = -Infinity;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const { u, v } = r.frame.local(x, z);
      if (u >= r.u0 - margin && u <= r.u1 + margin && v >= r.v0 - margin && v <= r.v1 + margin && r.top > best) best = r.top;
    }
    return best;
  }

  private liveRoofs(): RoofBox[] {
    const ys = this.lift(this.site.store.level);
    const yc = this.lift(this.site.church.level);
    const gCont = this.g(this.site.store, (STORE_CONTAINER.u0 + STORE_CONTAINER.u1) / 2, (STORE_CONTAINER.v0 + STORE_CONTAINER.v1) / 2);
    const gCurb = this.g(this.site.store, STORE_CURB.u, STORE_CURB.v);
    const gFlag = this.g(this.site.church, CHURCH_FLAGPOLE.u, CHURCH_FLAGPOLE.v);
    const gSign = this.g(this.site.church, CHURCH_SIGNBOARD.u, CHURCH_SIGNBOARD.v);
    return [
      { frame: this.site.store, u0: STORE_MAIN.u0 - 0.3, u1: STORE_MAIN.u1 + 0.8, v0: STORE_MAIN.v0 - 0.8, v1: STORE_MAIN.v1 + 1.1, top: ys + STORE_MAIN.ridge + 1.05 },
      { frame: this.site.store, u0: STORE_REAR.u0 - 0.3, u1: STORE_REAR.u1 + 0.2, v0: STORE_REAR.v0 - 0.8, v1: STORE_REAR.v1 + 0.6, top: ys + STORE_REAR.ridge + 0.30 },
      { frame: this.site.store, u0: STORE_CONTAINER.u0 - 0.1, u1: STORE_CONTAINER.u1 + 0.1, v0: STORE_CONTAINER.v0 - 0.6, v1: STORE_CONTAINER.v1 + 0.1, top: gCont + STORE_CONTAINER.height + 0.15 },
      { frame: this.site.store, u0: STORE_CURB.u - 0.7, u1: STORE_CURB.u + 0.7, v0: STORE_CURB.v - 1.3, v1: STORE_CURB.v + 1.3, top: gCurb + 0.85 },
      { frame: this.site.church, u0: CHURCH_NAVE.u0 - 0.4, u1: CHURCH_NAVE.u1 + 0.4, v0: CHURCH_NAVE.v0 - 0.4, v1: CHURCH_NAVE.v1 + 0.4, top: yc + CHURCH_NAVE.ridge + 1.2 },
      { frame: this.site.church, u0: CHURCH_WINGS.u0 - 0.4, u1: CHURCH_WINGS.u1 + 1.6, v0: CHURCH_WINGS.v0 - 0.4, v1: CHURCH_WINGS.v1 + 0.4, top: yc + CHURCH_WINGS.ridge + 0.4 },
      { frame: this.site.church, u0: CHURCH_PORTICO.u0 - 0.2, u1: CHURCH_STEPS.u1 + 0.2, v0: CHURCH_RAMP.v0 - 0.3, v1: CHURCH_PORTICO.v1 + 0.4, top: yc + CHURCH_PORTICO.peak + 0.3 },
      { frame: this.site.church, u0: CHURCH_TOWER.u0 - 0.3, u1: CHURCH_TOWER.u1 + 0.3, v0: CHURCH_TOWER.v0 - 0.3, v1: CHURCH_TOWER.v1 + 0.3, top: yc + CHURCH_TOWER.cross + 0.25 },
      { frame: this.site.church, u0: CHURCH_FLAGPOLE.u - 0.6, u1: CHURCH_FLAGPOLE.u + 1.6, v0: CHURCH_FLAGPOLE.v - 0.6, v1: CHURCH_FLAGPOLE.v + 1.6, top: gFlag + CHURCH_FLAGPOLE.height + 0.25 },
      { frame: this.site.church, u0: CHURCH_SIGNBOARD.u - 0.8, u1: CHURCH_SIGNBOARD.u + 0.8, v0: CHURCH_SIGNBOARD.v - 1.4, v1: CHURCH_SIGNBOARD.v + 1.4, top: gSign + 2.6 },
    ];
  }

  resolveSolids(car: Pushable): void {
    const b = this.site.box;
    if (car.x < b[0] || car.x > b[2] || car.z < b[1] || car.z > b[3]) return;
    pushOut(car, this.solids);
  }

  private addSolid(frame: LocalFrame, u0: number, u1: number, v0: number, v1: number): void {
    const w = frame.world((u0 + u1) / 2, (v0 + v1) / 2);
    const hu = (u1 - u0) / 2, hv = (v1 - v0) / 2;
    this.solids.push(hu >= hv
      ? { x: w.x, z: w.z, half: hu, halfWidth: hv, heading: frame.heading(1, 0) }
      : { x: w.x, z: w.z, half: hv, halfWidth: hu, heading: frame.heading(0, 1) });
  }

  private initSolids(): void {
    // Store main block, rear wing, front stoop, side bin shelter, shipping container & curb block.
    this.addSolid(this.site.store, STORE_MAIN.u0, STORE_MAIN.u1 + 0.7, STORE_MAIN.v0, STORE_MAIN.v1);
    this.addSolid(this.site.store, STORE_REAR.u0, STORE_REAR.u1, STORE_REAR.v0, STORE_REAR.v1);
    this.addSolid(this.site.store, 4.6, 7.1, STORE_MAIN.v1, STORE_MAIN.v1 + 0.95);
    this.addSolid(this.site.store, STORE_CONTAINER.u0, STORE_CONTAINER.u1, STORE_CONTAINER.v0 - 0.4, STORE_CONTAINER.v1);
    this.addSolid(this.site.store, STORE_CURB.u - 0.6, STORE_CURB.u + 0.6, STORE_CURB.v - 1.3, STORE_CURB.v + 1.3);

    // Church nave, cross-gable wings, portico, steps, ramp, flagpole & lawn signboard.
    this.addSolid(this.site.church, CHURCH_NAVE.u0, CHURCH_NAVE.u1, CHURCH_NAVE.v0, CHURCH_NAVE.v1);
    this.addSolid(this.site.church, CHURCH_WINGS.u0, CHURCH_WINGS.u1, CHURCH_WINGS.v0, CHURCH_WINGS.v1);
    this.addSolid(this.site.church, CHURCH_PORTICO.u0, CHURCH_STEPS.u1, CHURCH_PORTICO.v0, CHURCH_PORTICO.v1);
    this.addSolid(this.site.church, CHURCH_RAMP.u0, CHURCH_RAMP.u1, CHURCH_RAMP.v0, CHURCH_RAMP.v1);
    this.addSolid(this.site.church, CHURCH_FLAGPOLE.u - 0.55, CHURCH_FLAGPOLE.u + 0.55, CHURCH_FLAGPOLE.v - 0.55, CHURCH_FLAGPOLE.v + 0.55);
    this.addSolid(this.site.church, CHURCH_SIGNBOARD.u - 0.45, CHURCH_SIGNBOARD.u + 0.45, CHURCH_SIGNBOARD.v - 1.25, CHURCH_SIGNBOARD.v + 1.25);

    for (const p of this.parkedList) this.solids.push(parkedSolid(p));
  }

  private clearGroup(g: THREE.Group): void {
    for (const child of [...g.children]) {
      g.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
    }
  }

  private build(): void {
    this.clearGroup(this.storeLocal);
    this.clearGroup(this.churchLocal);

    const ms = new Mesher(), ss = new Mesher();
    this.buildStore(ms, ss);
    const storeMesh = new THREE.Mesh(ms.geometry(), this.material);
    storeMesh.castShadow = storeMesh.receiveShadow = !this.low;
    this.storeLocal.add(storeMesh);
    const storeSignMesh = new THREE.Mesh(ss.geometry(), this.signMaterial);
    storeSignMesh.castShadow = false; storeSignMesh.receiveShadow = !this.low;
    this.storeLocal.add(storeSignMesh);

    const mc = new Mesher(), sc = new Mesher();
    this.buildChurch(mc, sc);
    const churchMesh = new THREE.Mesh(mc.geometry(), this.material);
    churchMesh.castShadow = churchMesh.receiveShadow = !this.low;
    this.churchLocal.add(churchMesh);
    const churchSignMesh = new THREE.Mesh(sc.geometry(), this.signMaterial);
    churchSignMesh.castShadow = false; churchSignMesh.receiveShadow = !this.low;
    this.churchLocal.add(churchSignMesh);

    this.roofs = this.liveRoofs();
    this.triangles = ms.triangles + ss.triangles + mc.triangles + sc.triangles;
  }

  // ============================================================================================================
  // SHARED ARCHITECTURAL HELPERS
  // ============================================================================================================

  /** Subtle horizontal shingle course shadow strips on desktop only (zero extra draw calls). */
  private shingleCourses(m: Mesher, face: 'u' | 'v', plane: number, out: number, a0: number, a1: number, bot: number, top: number, baseCol: RGB, step = 0.42): void {
    if (this.low) return;
    const p = plane + out * 0.012, k = shade(baseCol, 0.86);
    for (let y = bot + step; y < top - 0.14; y += step) {
      const y0 = y - 0.016, y1 = y + 0.016;
      m.quad(face === 'u'
        ? [[p, y0, a0], [p, y0, a1], [p, y1, a1], [p, y1, a0]]
        : [[a0, y0, p], [a1, y0, p], [a1, y1, p], [a0, y1, p]], k);
    }
  }

  /** Framed rectangular window on a wall in local (u, v) coordinates. */
  private rectWindow(m: Mesher, face: 'u' | 'v', plane: number, out: number, along: number, bottom: number, w: number, h: number, trimCol: RGB, fill: RGB = GLASS, cols = 1, rows = 1): void {
    const part = (depth: number, yc: number, ww: number, hh: number, k: RGB) => {
      const p = plane + out * depth;
      if (face === 'u') m.box(p, yc, along, 0.05, hh, ww, k);
      else m.box(along, yc, p, ww, hh, 0.05, k);
    };
    part(0.025, bottom + h / 2, w + 0.22, h + 0.22, trimCol);
    part(0.048, bottom + h / 2, w, h, fill);
    if (!this.low) {
      for (let i = 1; i < cols; i++) {
        const off = along - w / 2 + (w * i) / cols, p = plane + out * 0.062;
        if (face === 'u') m.box(p, bottom + h / 2, off, 0.03, h, 0.038, CHURCH_TRIM);
        else m.box(off, bottom + h / 2, p, 0.038, h, 0.03, CHURCH_TRIM);
      }
      for (let j = 1; j < rows; j++) {
        const yy = bottom + (h * j) / rows, p = plane + out * 0.062;
        if (face === 'u') m.box(p, yy, along, 0.03, 0.038, w, CHURCH_TRIM);
        else m.box(along, yy, p, w, 0.038, 0.03, CHURCH_TRIM);
      }
    }
  }

  /** Black gooseneck barn lamp jutting out from a wall above a signboard. */
  private gooseneckLamp(m: Mesher, face: 'u' | 'v', plane: number, out: number, along: number, mountY: number): void {
    if (this.low) {
      if (face === 'u') m.box(plane + out * 0.34, mountY + 0.10, along, 0.42, 0.12, 0.24, IRON);
      else m.box(along, mountY + 0.10, plane + out * 0.34, 0.24, 0.12, 0.42, IRON);
      return;
    }
    const p1 = plane + out * 0.18, p3 = plane + out * 0.58;
    if (face === 'u') {
      m.box(plane + out * 0.03, mountY, along, 0.06, 0.12, 0.12, IRON);
      m.box(p1, mountY + 0.14, along, 0.035, 0.28, 0.035, IRON);
      m.box((p1 + p3) / 2, mountY + 0.27, along, 0.44, 0.035, 0.035, IRON);
      m.cyl(p3, mountY + 0.14, along, 0.14, 0.10, IRON, 'y', 8, 0.05);
      m.cyl(p3, mountY + 0.08, along, 0.075, 0.035, LAMP_GLOW, 'y', 6);
    } else {
      m.box(along, mountY, plane + out * 0.03, 0.12, 0.12, 0.06, IRON);
      m.box(along, mountY + 0.14, p1, 0.035, 0.28, 0.035, IRON);
      m.box(along, mountY + 0.27, (p1 + p3) / 2, 0.035, 0.035, 0.44, IRON);
      m.cyl(along, mountY + 0.14, p3, 0.14, 0.10, IRON, 'y', 8, 0.05);
      m.cyl(along, mountY + 0.08, p3, 0.075, 0.035, LAMP_GLOW, 'y', 6);
    }
  }

  /**
   * Romanesque single, twin or triple round-arched church window with white sash, mullions and crisp dark
   * outer arch hood trim, placed on a wall in local (u, v) coordinates.
   */
  private archedWindow(
    m: Mesher,
    face: 'u' | 'v',
    plane: number,
    out: number,
    centerAlong: number,
    y0: number,
    w: number,
    h: number,
    count: 1 | 2 | 3,
    tallerCenter = false,
    louvered = false,
  ): void {
    const gap = 0.05;
    const subW = (w - gap * (count - 1)) / count;
    const basePart = (d: number, along: number, yc: number, ww: number, hh: number, k: RGB) => {
      const p = plane + out * d;
      if (face === 'u') m.box(p, yc, along, 0.045, hh, ww, k);
      else m.box(along, yc, p, ww, hh, 0.045, k);
    };
    // Shared sill board and outer casing skirt.
    basePart(0.045, centerAlong, y0 - 0.04, w + 0.26, 0.09, CHURCH_TRIM);

    const segs = this.low ? 5 : 8;
    const drawArchDisc = (d: number, along: number, springY: number, r: number, k: RGB) => {
      const p = plane + out * d;
      for (let i = 0; i < segs; i++) {
        const a0 = (Math.PI * i) / segs, a1 = (Math.PI * (i + 1)) / segs;
        const x0 = Math.cos(a0) * r, yy0 = springY + Math.sin(a0) * r;
        const x1 = Math.cos(a1) * r, yy1 = springY + Math.sin(a1) * r;
        if (face === 'u') {
          m.tri(p, springY, along, p, yy0, along + x0, p, yy1, along + x1, k);
        } else {
          m.tri(along, springY, p, along + x0, yy0, p, along + x1, yy1, p, k);
        }
      }
    };

    for (let idx = 0; idx < count; idx++) {
      const subAlong = centerAlong - w / 2 + subW * (idx + 0.5) + gap * idx;
      const isMid = count === 3 && idx === 1;
      const sh = tallerCenter && isMid ? h * 1.18 : h;
      const r = subW / 2;
      const springY = y0 + sh - r;
      const rectH = Math.max(0.2, springY - y0);

      // Dark outer arch hood moulding (distinctive Brook Village church detail).
      if (!louvered) {
        drawArchDisc(0.020, subAlong, springY, r + 0.135, ARCH_HOOD);
      }
      // Crisp white outer casing jambs and arched head.
      basePart(0.028, subAlong, y0 + rectH / 2, subW + 0.16, rectH, CHURCH_TRIM);
      drawArchDisc(0.032, subAlong, springY, r + 0.085, CHURCH_TRIM);

      // Glass or louvered interior fill.
      const fillCol = louvered ? shade(CHURCH_WALL, 0.72) : GLASS;
      basePart(0.048, subAlong, y0 + rectH / 2, subW - 0.06, rectH - 0.04, fillCol);
      drawArchDisc(0.052, subAlong, springY, Math.max(0.06, r - 0.03), fillCol);

      // Muntins or belfry louver slats on desktop.
      if (!this.low) {
        if (louvered) {
          for (let ly = y0 + 0.12; ly < springY + r * 0.65; ly += 0.13) {
            const halfW = ly > springY ? Math.sqrt(Math.max(0.01, r * r - (ly - springY) ** 2)) : subW / 2 - 0.04;
            basePart(0.064, subAlong, ly, halfW * 1.9, 0.035, CHURCH_TRIM);
          }
        } else {
          if (subW > 0.55) {
            basePart(0.064, subAlong, y0 + (sh - 0.05) / 2, 0.035, sh - 0.06, CHURCH_TRIM);
          }
          for (const frac of [0.34, 0.66]) {
            basePart(0.064, subAlong, y0 + rectH * frac, subW - 0.04, 0.035, CHURCH_TRIM);
          }
          basePart(0.064, subAlong, springY, subW - 0.04, 0.038, CHURCH_TRIM);
        }
      }
    }
  }

  // ============================================================================================================
  // 1. BROOK VILLAGE GENERAL STORE (BUILDING 69)
  // ============================================================================================================

  private buildStore(m: Mesher, s: Mesher): void {
    const M = STORE_MAIN, R = STORE_REAR;
    const y = this.lift(this.site.store.level);
    const under = -0.9;
    const cvM = (M.v0 + M.v1) / 2, halfM = (M.v1 - M.v0) / 2;
    const cvR = (R.v0 + R.v1) / 2, halfR = (R.v1 - R.v0) / 2;

    // ---- Main steep-gable 2-storey cedar block (extruded along u: rotated frame local x = -(v - cvM), local z = u) ----
    m.at(0, y, cvM, Math.PI / 2);
    m.extrude([
      [-halfM, under], [halfM, under], [halfM, M.eave], [0, M.ridge], [-halfM, M.eave],
    ], M.u0, M.u1, CEDAR);
    // Bright emerald-green standing-seam metal roof with crisp overhang and yellow fascia/rake trim.
    const over = 0.34, drop = (over * (M.ridge - M.eave)) / halfM, rt = 0.14;
    m.extrude([
      [-halfM - over, M.eave - drop], [0, M.ridge], [halfM + over, M.eave - drop],
      [halfM + over, M.eave - drop + rt], [0, M.ridge + rt], [-halfM - over, M.eave - drop + rt],
    ], M.u0 - 0.20, M.u1 + 0.30, GREEN_ROOF, YELLOW_TRIM);
    // Standing-seam roof ribs on desktop.
    if (!this.low) {
      const ribCol = shade(GREEN_ROOF, 0.80);
      const slopeLen = Math.hypot(halfM + over, M.ridge - (M.eave - drop));
      const slopeAng = Math.atan2(M.ridge - (M.eave - drop), halfM + over);
      for (let ru = M.u0 + 0.4; ru < M.u1; ru += 0.95) {
        for (const side of [-1, 1]) {
          m.at(ru, y + (M.eave - drop + M.ridge) / 2 + rt + 0.01, cvM + side * (halfM + over) / 2, 0, side * slopeAng, 0);
          m.box(0, 0, 0, 0.045, 0.04, slopeLen, ribCol);
        }
      }
    }

    // ---- Rear lower 2-storey extension (u = -9.0..-2.0) ----
    m.at(0, y, cvR, Math.PI / 2);
    m.extrude([
      [-halfR, under], [halfR, under], [halfR, R.eave], [0, R.ridge], [-halfR, R.eave],
    ], R.u0, R.u1 + 0.05, CEDAR);
    const overR = 0.24, dropR = (overR * (R.ridge - R.eave)) / halfR;
    m.extrude([
      [-halfR - overR, R.eave - dropR], [0, R.ridge], [halfR + overR, R.eave - dropR],
      [halfR + overR, R.eave - dropR + 0.12], [0, R.ridge + 0.12], [-halfR - overR, R.eave - dropR + 0.12],
    ], R.u0 - 0.18, R.u1 + 0.05, REAR_ROOF, YELLOW_TRIM);

    // Back to store site frame (x = u, z = v).
    m.at(0, y, 0);
    // Dark ridge cap & small red brick chimney near rear ridge of main roof.
    m.box((M.u0 + M.u1) / 2, M.ridge + rt + 0.04, cvM, M.u1 - M.u0 + 0.52, 0.10, 0.26, shade(GREEN_ROOF, 0.72));
    m.box(-0.7, M.ridge + 0.32, cvM + 0.55, 0.56, 1.05, 0.56, BRICK);
    m.box(-0.7, M.ridge + 0.88, cvM + 0.55, 0.64, 0.08, 0.64, IRON);

    // Foundation dark cedar/concrete skirting around main and rear blocks.
    m.box((M.u0 + M.u1) / 2, (0.28 + under) / 2, cvM, M.u1 - M.u0 + 0.08, 0.28 - under, M.v1 - M.v0 + 0.08, CEDAR_DARK);
    m.box((R.u0 + R.u1) / 2, (0.28 + under) / 2, cvR, R.u1 - R.u0 + 0.08, 0.28 - under, R.v1 - R.v0 + 0.08, CEDAR_DARK);

    // Bright sunflower-yellow corner boards, continuous eave fascia bands, and front gable cornice returns.
    for (const [u, v, top] of [
      [M.u1, M.v0, M.eave], [M.u1, M.v1, M.eave], [R.u0, R.v0, R.eave], [R.u0, R.v1, R.eave],
    ]) m.box(u, (0.18 + top) / 2, v, 0.22, top - 0.18, 0.22, YELLOW_TRIM);
    // Continuous bold yellow eave fascia along both long sides (main + rear).
    for (const v of [M.v0 - 0.16, M.v1 + 0.16]) {
      m.box((R.u0 + M.u1) / 2, M.eave - 0.08, v, M.u1 - R.u0 + 0.44, 0.28, 0.14, YELLOW_TRIM);
    }
    // Front gable eave cornice returns (short horizontal yellow eaves jutting out at front corners).
    for (const v of [M.v0 - 0.28, M.v1 + 0.28]) {
      m.box(M.u1 + 0.14, M.eave - 0.08, v, 0.42, 0.28, 0.68, YELLOW_TRIM);
    }

    // Subtle shingle course lines on desktop.
    this.shingleCourses(m, 'v', M.v1, 1, R.u0, M.u1, 0.35, M.eave - 0.2, CEDAR);
    this.shingleCourses(m, 'v', M.v0, -1, R.u0, M.u1, 0.35, M.eave - 0.2, CEDAR);
    this.shingleCourses(m, 'u', M.u1, 1, M.v0, M.v1, 3.25, M.eave - 0.1, CEDAR);

    // ---- FRONT STOREFRONT FACE (u = +9.0, facing Lake Ainslie Chapel Rd / Highway 252) ----
    const fu = M.u1;
    // Concrete front stoop and golden straw bale on right side of entrance.
    m.box(fu + 0.48, 0.08, cvM, 0.96, 0.18, M.v1 - M.v0 - 0.2, CONCRETE);
    m.box(fu + 0.34, 0.22, cvM, 0.64, 0.14, 2.2, shade(CONCRETE, 0.94));
    m.box(fu + 0.42, 0.42, cvM - 1.65, 0.56, 0.46, 0.98, STRAW);

    // Royal-blue wooden storefront surround and recessed central entry door.
    m.box(fu + 0.03, 1.50, cvM, 0.08, 2.55, 7.6, STORE_BLUE);
    // Recessed entry bay backing & blue half-glass door.
    m.box(fu + 0.06, 1.38, cvM, 0.06, 2.40, 2.15, shade(STORE_BLUE, 0.72));
    m.box(fu + 0.085, 1.24, cvM, 0.05, 2.14, 1.08, STORE_DOOR);
    m.box(fu + 0.112, 1.62, cvM, 0.02, 0.92, 0.68, GLASS_WARM);
    m.box(fu + 0.125, 1.54, cvM, 0.012, 0.36, 0.28, CHURCH_TRIM);   // white hours card on door glass
    m.box(fu + 0.125, 1.15, cvM + 0.38, 0.05, 0.16, 0.04, GOLD);     // brass door handle

    // Two wide storefront display windows flanking the blue entry door.
    for (const [wv, rainbow] of [[cvM + 2.45, true], [cvM - 2.45, false]] as const) {
      m.box(fu + 0.065, 1.52, wv, 0.05, 1.98, 2.18, CHURCH_TRIM);
      m.box(fu + 0.085, 1.52, wv, 0.04, 1.82, 2.00, GLASS_WARM);
      if (rainbow) {
        // Cheerful vertical rainbow curtain stripes visible inside the left display window.
        const sw = 1.68 / CURTAIN_COLS.length;
        for (let i = 0; i < CURTAIN_COLS.length; i++) {
          m.box(fu + 0.104, 1.38, wv - 0.84 + sw * (i + 0.5), 0.015, 1.48, sw - 0.02, CURTAIN_COLS[i]);
        }
      } else {
        // Warm cream window blind / display card inside the right window.
        m.box(fu + 0.104, 1.62, wv, 0.015, 1.35, 1.68, shade(CHURCH_WALL, 0.92));
      }
      if (!this.low) {
        m.box(fu + 0.114, 2.02, wv, 0.025, 0.04, 2.02, CHURCH_TRIM);
        m.box(fu + 0.114, 1.52, wv, 0.025, 1.82, 0.04, CHURCH_TRIM);
      }
    }

    // Dark charcoal pent roof / awning projecting above the entire storefront.
    m.at(0, y, cvM, Math.PI / 2);
    // Wait: let's build the storefront awning cleanly in store (u, v) frame as an extruded wedge along v!
    m.at(0, y, 0);
    m.extrude([
      [fu, 2.74], [fu + 0.72, 2.74], [fu + 0.72, 2.86], [fu, 3.24],
    ], cvM - 4.05, cvM + 4.05, AWNING_DARK);
    m.box(fu + 0.73, 2.78, cvM, 0.06, 0.14, 8.14, STORE_BLUE);

    // Front gable sign plate (arched "BROOK VILLAGE / GENERAL STORE" + oval scenic medallion) and twin upper blue windows.
    s.at(fu + 0.06, y + 5.75, cvM, Math.PI / 2);
    s.plate(4.55, 2.15, this.signCells.storeGable);
    this.rectWindow(m, 'u', fu, 1, cvM + 2.35, 3.85, 0.96, 1.12, STORE_BLUE, GLASS, 2, 2);
    this.rectWindow(m, 'u', fu, 1, cvM - 2.35, 3.85, 0.96, 1.12, STORE_BLUE, GLASS, 2, 2);
    // Twin black gooseneck barn lamps high in the front gable peak.
    this.gooseneckLamp(m, 'u', fu, 1, cvM + 1.05, 7.02);
    this.gooseneckLamp(m, 'u', fu, 1, cvM - 1.05, 7.02);

    // ---- WEST SIDE WALL (v = +4.7, facing west gravel parking lot) ----
    const wv = M.v1;
    // Yellow-framed upper windows (2 on main block, 1 on rear wing) + 1 lower window + rear white personnel door.
    this.rectWindow(m, 'v', wv, 1, 6.2, 2.85, 0.92, 1.28, YELLOW_TRIM, GLASS, 2, 2);
    this.rectWindow(m, 'v', wv, 1, 1.4, 2.85, 0.92, 1.28, YELLOW_TRIM, GLASS, 2, 2);
    this.rectWindow(m, 'v', R.v1, 1, -6.2, 2.95, 0.80, 1.12, YELLOW_TRIM, GLASS, 1, 2);
    this.rectWindow(m, 'v', R.v1, 1, -3.2, 0.85, 0.86, 1.22, YELLOW_TRIM, GLASS, 2, 2);
    // Rear white personnel door near back-west corner.
    m.box(-7.8, 1.10, R.v1 + 0.03, 1.10, 2.10, 0.06, YELLOW_TRIM);
    m.box(-7.8, 1.08, R.v1 + 0.055, 0.92, 1.98, 0.04, CHURCH_TRIM);

    // Small green metal-roofed wooden lean-to bin shelter on the west wall near front corner.
    m.box(5.9, 0.56, wv + 0.42, 1.75, 0.86, 0.72, BIN_GREEN);
    for (const su of [5.0, 6.8]) m.box(su, 0.92, wv + 0.74, 0.09, 1.68, 0.09, BIN_GREEN);
    m.at(5.9, y + 1.85, wv + 0.46, 0, 0.34, 0);
    m.box(0, 0, 0, 2.05, 0.08, 1.15, GREEN_ROOF);
    m.at(0, y, 0);

    // Leaning wooden ladder beside the bin shelter (desktop) and outdoor heat-pump condenser unit.
    if (!this.low) {
      m.at(3.95, y + 1.15, wv + 0.24, 0, -0.18, 0);
      for (const lx of [-0.22, 0.22]) m.box(lx, 0, 0, 0.05, 2.35, 0.06, PALLET_WOOD);
      for (let ry = -0.95; ry <= 0.95; ry += 0.32) m.box(0, ry, 0, 0.42, 0.035, 0.04, PALLET_WOOD);
      m.at(0, y, 0);
    }
    // Heat-pump condenser mounted low on west wall.
    m.box(-1.0, 0.86, R.v1 + 0.24, 0.88, 0.64, 0.38, STEEL);
    if (!this.low) m.cyl(-1.14, 0.86, R.v1 + 0.44, 0.20, 0.03, IRON, 'z', 8);

    // Two small invented rustic plaques near front-west corner (using SignAtlas).
    m.box(8.0, 2.85, wv + 0.03, 1.12, 0.86, 0.04, CHURCH_TRIM);
    s.at(8.0, y + 2.85, wv + 0.055, 0);
    s.plate(1.04, 0.78, this.signCells.storePlaqueA);
    m.box(8.0, 1.88, wv + 0.03, 0.88, 0.56, 0.04, CHURCH_TRIM);
    s.at(8.0, y + 1.88, wv + 0.055, 0);
    s.plate(0.80, 0.48, this.signCells.storePlaqueB);

    // ---- EAST SIDE WALL (v = -3.9, facing Lake Ainslie Chapel Road) ----
    this.rectWindow(m, 'v', M.v0, -1, 5.8, 2.85, 0.92, 1.28, YELLOW_TRIM, GLASS, 2, 2);
    this.rectWindow(m, 'v', M.v0, -1, 1.0, 2.85, 0.92, 1.28, YELLOW_TRIM, GLASS, 2, 2);
    this.rectWindow(m, 'v', R.v0, -1, -5.8, 2.85, 0.82, 1.15, YELLOW_TRIM, GLASS, 1, 2);
    // Small dark projecting side entrance hood & door on east wall.
    m.box(-4.2, 1.10, R.v0 - 0.04, 1.05, 2.10, 0.06, YELLOW_TRIM);
    m.box(-4.2, 1.08, R.v0 - 0.065, 0.88, 1.98, 0.04, CHURCH_TRIM);
    m.at(-4.2, y + 2.38, R.v0 - 0.45, 0, -0.32, 0);
    m.box(0, 0, 0, 1.65, 0.08, 1.05, AWNING_DARK);
    m.at(0, y, 0);

    // ---- WEST GRAVEL LOT: WHITE SHIPPING CONTAINER WITH RUST-RED FRONT DOORS & CONCRETE CURB BLOCK ----
    const C = STORE_CONTAINER;
    const ccu = (C.u0 + C.u1) / 2, ccv = (C.v0 + C.v1) / 2;
    const clen = C.u1 - C.u0, cwid = C.v1 - C.v0;
    const gyC = this.g(this.site.store, ccu, ccv);
    const minC = Math.min(
      this.g(this.site.store, C.u0, C.v0), this.g(this.site.store, C.u1, C.v0),
      this.g(this.site.store, C.u0, C.v1), this.g(this.site.store, C.u1, C.v1),
    );
    const underC = Math.min(-0.45, minC - gyC - 0.35);
    m.at(ccu, gyC, ccv);
    // Dark concrete blocking plinth extending below the downhill corner so the white container stays level.
    m.box(0, (0.08 + underC) / 2, 0, clen - 0.08, 0.08 - underC, cwid - 0.08, CEDAR_DARK);
    // White/silver corrugated steel container sides & roof sitting cleanly on its blocking.
    m.box(0, (C.height + 0.06) / 2, 0, clen, C.height - 0.06, cwid, CONTAINER_WHITE);
    m.box(0, C.height + 0.03, 0, clen + 0.06, 0.08, cwid + 0.06, shade(CONTAINER_WHITE, 0.86));
    // Rust-red front end frame and cargo doors facing Highway 252 (+u).
    m.box(clen / 2 + 0.02, (C.height + 0.06) / 2, 0, 0.06, C.height - 0.06, cwid + 0.04, CONTAINER_RUST);
    // Dark recessed right-door opening matching the open supply container seen in footage.
    m.box(clen / 2 + 0.055, C.height * 0.50, -cwid * 0.22, 0.04, C.height - 0.26, cwid * 0.42, IRON);
    if (!this.low) {
      // Corrugation ribs on container side & vertical steel locking bars on front door.
      for (let du = -clen / 2 + 0.4; du < clen / 2 - 0.3; du += 0.56) {
        m.box(du, C.height / 2, -cwid / 2 - 0.02, 0.09, C.height - 0.22, 0.03, shade(CONTAINER_WHITE, 0.88));
      }
      for (const dv of [0.18, 0.58]) {
        m.box(clen / 2 + 0.065, C.height / 2, dv, 0.04, C.height - 0.24, 0.04, STEEL);
      }
      // Wooden pallets leaning against the container's east side.
      m.at(ccu + 2.6, gyC + 0.55, C.v0 - 0.28, 0, 0.22, 0);
      m.box(0, 0, 0, 1.15, 1.10, 0.16, PALLET_WOOD);
      m.box(1.22, 0, -0.04, 1.05, 1.05, 0.16, shade(PALLET_WOOD, 0.90));
    }

    // Weathered grey concrete curb block near the SW driveway corner by the utility pole.
    const gyCurb = this.g(this.site.store, STORE_CURB.u, STORE_CURB.v);
    const minCurb = Math.min(
      this.g(this.site.store, STORE_CURB.u - 0.5, STORE_CURB.v - 1.1),
      this.g(this.site.store, STORE_CURB.u + 0.5, STORE_CURB.v + 1.1),
    );
    const underCurb = Math.min(-0.35, minCurb - gyCurb - 0.25);
    m.at(STORE_CURB.u, gyCurb, STORE_CURB.v, 0.25);
    m.box(0, (0.72 + underCurb) / 2, 0, 0.72, 0.72 - underCurb, 2.15, shade(CONCRETE, 0.86));
  }

  // ============================================================================================================
  // 2. ST. JOHN THE BAPTIST ROMAN CATHOLIC CHURCH (BUILDING 1570)
  // ============================================================================================================

  private buildChurch(m: Mesher, s: Mesher): void {
    const N = CHURCH_NAVE, W = CHURCH_WINGS, P = CHURCH_PORTICO, ST = CHURCH_STEPS, RP = CHURCH_RAMP, T = CHURCH_TOWER;
    const y = this.lift(this.site.church.level);
    const under = -0.9;
    const cv = CV, halfN = (N.v1 - N.v0) / 2;
    const cuW = (W.u0 + W.u1) / 2, halfW = (W.u1 - W.u0) / 2;

    // ---- Main Nave (extruded along u: rotated frame local x = -(v - cv), local z = u) ----
    m.at(0, y, cv, Math.PI / 2);
    m.extrude([
      [-halfN, under], [halfN, under], [halfN, N.eave], [0, N.ridge], [-halfN, N.eave],
    ], N.u0, N.u1, CHURCH_WALL);
    const overN = 0.38, dropN = (overN * (N.ridge - N.eave)) / halfN, rtN = 0.16;
    m.extrude([
      [-halfN - overN, N.eave - dropN], [0, N.ridge], [halfN + overN, N.eave - dropN],
      [halfN + overN, N.eave - dropN + rtN], [0, N.ridge + rtN], [-halfN - overN, N.eave - dropN + rtN],
    ], N.u0 - 0.28, N.u1 + 0.28, CHURCH_ROOF, CHURCH_TRIM);

    // ---- Cruciform Rear Cross-Gable Wings (extruded along v from W.v0 to W.v1: local x = u - cuW, local z = v) ----
    m.at(cuW, y, 0);
    m.extrude([
      [-halfW, under], [halfW, under], [halfW, W.eave], [0, W.ridge], [-halfW, W.eave],
    ], W.v0, W.v1, CHURCH_WALL);
    const overW = 0.30, dropW = (overW * (W.ridge - W.eave)) / halfW, rtW = 0.14;
    m.extrude([
      [-halfW - overW, W.eave - dropW], [0, W.ridge], [halfW + overW, W.eave - dropW],
      [halfW + overW, W.eave - dropW + rtW], [0, W.ridge + rtW], [-halfW - overW, W.eave - dropW + rtW],
    ], W.v0 - 0.24, W.v1 + 0.24, CHURCH_ROOF, CHURCH_TRIM);

    // Back in church site frame (x = u, z = v).
    m.at(0, y, 0);
    // Dark charcoal foundation skirts around nave and wings + crisp white corner date stone at NE front corner.
    m.box((N.u0 + N.u1) / 2, (0.45 + under) / 2, cv, N.u1 - N.u0 + 0.08, 0.45 - under, N.v1 - N.v0 + 0.08, CHURCH_FOUND);
    m.box(cuW, (0.45 + under) / 2, cv, W.u1 - W.u0 + 0.08, 0.45 - under, W.v1 - W.v0 + 0.08, CHURCH_FOUND);
    m.box(N.u1 + 0.04, 0.30, N.v1 - 0.28, 0.14, 0.36, 0.62, CHURCH_TRIM);   // white 1893 cornerstone

    // Crisp white corner pilasters, eave frieze boards, and returned gable-end cornice mouldings.
    for (const [u, v, top] of [
      [N.u1, N.v0, N.eave], [N.u1, N.v1, N.eave], [N.u0, N.v0, N.eave], [N.u0, N.v1, N.eave],
      [W.u0, W.v0, W.eave], [W.u1, W.v0, W.eave], [W.u0, W.v1, W.eave], [W.u1, W.v1, W.eave],
    ]) m.box(u, (0.45 + top) / 2, v, 0.24, top - 0.45, 0.24, CHURCH_TRIM);
    for (const v of [N.v0 - 0.12, N.v1 + 0.12]) {
      m.box((N.u0 + N.u1) / 2, N.eave - 0.12, v, N.u1 - N.u0 + 0.56, 0.26, 0.18, CHURCH_TRIM);
    }
    // Front gable eave cornice returns & crisp white ridge cap.
    for (const v of [N.v0 - 0.32, N.v1 + 0.32]) {
      m.box(N.u1 + 0.14, N.eave - 0.12, v, 0.46, 0.26, 0.78, CHURCH_TRIM);
    }
    m.box((N.u0 + N.u1) / 2, N.ridge + rtN + 0.03, cv, N.u1 - N.u0 + 0.56, 0.10, 0.24, shade(CHURCH_ROOF, 0.78));
    // Slim white rear finial / gable cross at the south peak.
    m.box(N.u0 + 0.14, N.ridge + 0.56, cv, 0.16, 0.96, 0.16, CHURCH_TRIM);
    m.box(N.u0 + 0.14, N.ridge + 0.74, cv, 0.14, 0.14, 0.54, CHURCH_TRIM);

    // Subtle shingle course bands on desktop.
    this.shingleCourses(m, 'v', N.v0, -1, W.u1, N.u1, 0.52, N.eave - 0.25, CHURCH_WALL, 0.46);
    this.shingleCourses(m, 'v', N.v1, 1, W.u1, N.u1, 0.52, N.eave - 0.25, CHURCH_WALL, 0.46);
    this.shingleCourses(m, 'u', N.u1, 1, N.v0, N.v1, 0.52, N.eave - 0.25, CHURCH_WALL, 0.46);

    // ---- ROOF-MOUNTED SQUARE BELL TOWER / STEEPLE & CROSS ----
    const tu = (T.u0 + T.u1) / 2, tw = T.u1 - T.u0, tv = T.v1 - T.v0;
    const tBase = N.ridge - 2.4;
    m.box(tu, (tBase + T.top) / 2, cv, tw, T.top - tBase, tv, CHURCH_WALL);
    // White corner boards & stepped cornice overhang on tower.
    for (const [u, v] of [[T.u0, T.v0], [T.u1, T.v0], [T.u0, T.v1], [T.u1, T.v1]]) {
      m.box(u, (N.ridge - 0.6 + T.top) / 2, v, 0.16, T.top - (N.ridge - 0.6), 0.16, CHURCH_TRIM);
    }
    m.box(tu, T.top - 0.10, cv, tw + 0.34, 0.22, tv + 0.34, CHURCH_TRIM);
    m.box(tu, T.top + 0.05, cv, tw + 0.44, 0.10, tv + 0.44, CHURCH_ROOF);
    // Four arched louvered belfry vents (north, south, west, east).
    this.archedWindow(m, 'u', T.u1, 1, cv, T.top - 1.75, 1.05, 1.32, 1, false, true);
    this.archedWindow(m, 'u', T.u0, -1, cv, T.top - 1.75, 1.05, 1.32, 1, false, true);
    this.archedWindow(m, 'v', T.v0, -1, tu, T.top - 1.75, 1.05, 1.32, 1, false, true);
    this.archedWindow(m, 'v', T.v1, 1, tu, T.top - 1.75, 1.05, 1.32, 1, false, true);
    // Steep dark pyramidal spire roof (4-sided cone rotated 45 deg), orb finial and cross.
    const spireH = T.spire - T.top;
    m.at(tu, y + T.top + spireH / 2, cv, Math.PI / 4);
    m.cyl(0, 0, 0, (tw + 0.42) * 0.707, spireH, CHURCH_ROOF, 'y', 4, 0.06);
    m.at(0, y, 0);
    m.cyl(tu, T.spire + 0.08, cv, 0.12, 0.16, IRON, 'y', this.low ? 6 : 8, 0.08);
    const crossH = T.cross - T.spire - 0.14;
    m.box(tu, T.spire + 0.14 + crossH / 2, cv, 0.08, crossH, 0.08, IRON);
    m.box(tu, T.spire + 0.14 + crossH * 0.66, cv, 0.08, 0.08, crossH * 0.58, IRON);

    // ---- DISTINCTIVE ARCHED CHURCH WINDOWS ----
    // Front north gable (u = +12.5): grand triple-arched Venetian window high in gable + twin-arched windows flanking portico.
    this.archedWindow(m, 'u', N.u1, 1, cv, 5.45, 2.55, 2.45, 3, true, false);
    this.archedWindow(m, 'u', N.u1, 1, N.v0 + 1.85, 1.45, 1.12, 2.05, 2, false, false);
    this.archedWindow(m, 'u', N.u1, 1, N.v1 - 1.85, 1.45, 1.12, 2.05, 2, false, false);

    // West & East nave side walls: 1 narrow twin-arched front bay + 3 large wide twin-arched nave windows.
    for (const [plane, out] of [[N.v0, -1], [N.v1, 1]] as const) {
      this.archedWindow(m, 'v', plane, out, 10.35, 1.45, 1.08, 2.05, 2, false, false);
      for (const wu of [6.5, 3.1, -0.3]) {
        this.archedWindow(m, 'v', plane, out, wu, 1.40, 1.95, 2.55, 2, false, false);
      }
    }

    // West & East cross-gable wing ends (2 narrow tall windows each) + west vestry arched side door with wooden steps.
    for (const [plane, out] of [[W.v0, -1], [W.v1, 1]] as const) {
      this.rectWindow(m, 'v', plane, out, cuW + 1.65, 1.35, 0.72, 1.65, CHURCH_TRIM, GLASS, 2, 2);
      this.rectWindow(m, 'v', plane, out, cuW - 1.65, 1.35, 0.72, 1.65, CHURCH_TRIM, GLASS, 2, 2);
    }
    // Arched white side vestry door on the north face of the west cross-gable wing (u = W.u1 = -1.5).
    const vestryV = N.v0 - 1.45;
    this.archedWindow(m, 'u', W.u1, 1, vestryV, 0.72, 1.06, 2.15, 1, false, false);
    m.box(W.u1 + 0.055, 1.55, vestryV, 0.05, 1.66, 0.94, CHURCH_TRIM);
    m.box(W.u1 + 0.085, 1.85, vestryV, 0.025, 0.62, 0.54, GLASS_WARM);
    // Wooden steps & short brown timber rail outside the west vestry door.
    m.box(W.u1 + 0.58, 0.34, vestryV, 1.15, 0.68, 1.25, CEDAR_RAIL);
    m.box(W.u1 + 1.28, 0.16, vestryV, 0.42, 0.34, 1.25, shade(CEDAR_RAIL, 0.88));
    m.box(W.u1 + 0.58, 1.02, vestryV - 0.56, 1.15, 0.76, 0.08, CEDAR_RAIL);

    // ---- CLASSICAL PEDIMENTED FRONT PORTICO, STEPS & ACCESSIBLE RAMP ----
    const pHalf = (P.v1 - P.v0) / 2;
    // Portico roof & white triangular pediment (extruded along u).
    m.at(0, y, cv, Math.PI / 2);
    m.extrude([[-pHalf, P.eave], [pHalf, P.eave], [0, P.peak]], P.u0, P.u1, CHURCH_TRIM);
    const overP = 0.24, dropP = (overP * (P.peak - P.eave)) / pHalf;
    m.extrude([
      [-pHalf - overP, P.eave - dropP], [0, P.peak], [pHalf + overP, P.eave - dropP],
      [pHalf + overP, P.eave - dropP + 0.12], [0, P.peak + 0.12], [-pHalf - overP, P.eave - dropP + 0.12],
    ], P.u0 - 0.05, P.u1 + 0.20, CHURCH_ROOF, CHURCH_TRIM);
    m.at(0, y, 0);
    // White entablature beam & semicircular decorative pediment emblem.
    m.box((P.u0 + P.u1) / 2, P.eave - 0.18, cv, P.u1 - P.u0 + 0.18, 0.40, P.v1 - P.v0 + 0.18, CHURCH_TRIM);
    s.at(P.u1 + 0.04, y + P.eave + 0.46, cv, Math.PI / 2);
    s.plate(0.86, 0.64, this.signCells.churchEmblem);
    // Concrete portico deck & 4 front steps extending below ground.
    m.box((P.u0 + P.u1) / 2, (ST.top + under) / 2, cv, P.u1 - P.u0 + 0.12, ST.top - under, P.v1 - P.v0 + 0.12, CONCRETE);
    const stepCount = 4, stepRun = ST.u1 - ST.u0;
    for (let i = 0; i < stepCount; i++) {
      const h = ST.top * ((stepCount - i) / stepCount);
      const uA = ST.u0 + (stepRun * i) / stepCount;
      const uB = ST.u0 + (stepRun * (i + 1)) / stepCount;
      m.box((uA + uB) / 2, (h + under) / 2, cv, uB - uA + 0.04, h - under, ST.v1 - ST.v0, shade(CONCRETE, 1 - i * 0.02));
    }
    // Paired classical fluted white columns supporting the portico roof + wall pilasters.
    const colH = P.eave - 0.38 - ST.top;
    const colY = ST.top + colH / 2;
    for (const [cu, cvPos] of [
      [P.u1 - 0.24, P.v0 + 0.30], [P.u1 - 0.24, P.v0 + 0.82],
      [P.u1 - 0.24, P.v1 - 0.30], [P.u1 - 0.24, P.v1 - 0.82],
    ]) {
      m.cyl(cu, colY, cvPos, 0.16, colH, CHURCH_TRIM, 'y', this.low ? 6 : 10, 0.14);
      m.box(cu, ST.top + 0.10, cvPos, 0.40, 0.20, 0.40, CHURCH_TRIM);
      m.box(cu, P.eave - 0.46, cvPos, 0.42, 0.18, 0.42, CHURCH_TRIM);
    }
    for (const pv of [P.v0 + 0.32, P.v1 - 0.32]) {
      m.box(P.u0 + 0.16, colY, pv, 0.32, colH + 0.2, 0.36, CHURCH_TRIM);
    }
    // Arched dark double front entrance doors with fanlight transom and hanging porch lantern.
    this.archedWindow(m, 'u', P.u0, 1, cv, ST.top, 2.05, 2.75, 1, false, false);
    m.box(P.u0 + 0.055, ST.top + 1.05, cv, 0.06, 2.10, 1.88, CHURCH_DOOR);
    m.box(P.u0 + 0.095, ST.top + 1.05, cv, 0.02, 2.08, 0.04, IRON);   // centre door seam
    m.box(P.u0 + 0.10, ST.top + 1.02, cv - 0.10, 0.04, 0.06, 0.04, GOLD);
    m.box(P.u0 + 0.10, ST.top + 1.02, cv + 0.10, 0.04, 0.06, 0.04, GOLD);
    m.box(P.u0 + 0.85, P.eave - 0.62, cv, 0.18, 0.26, 0.18, IRON);
    m.box(P.u0 + 0.85, P.eave - 0.64, cv, 0.12, 0.16, 0.12, LAMP_GLOW);

    // Cedar railing helper with vertical black metal balusters (matching real church steps & ramp).
    const cedarRailing = (uA: number, vA: number, yA: number, uB: number, vB: number, yB: number, posts: number) => {
      const len = Math.hypot(uB - uA, vB - vA);
      const yaw = -Math.atan2(vB - vA, uB - uA);
      const pitch = Math.atan2(yB - yA, len);
      // Posts along the span.
      for (let i = 0; i <= posts; i++) {
        const t = i / posts;
        const pu = uA + (uB - uA) * t, pv = vA + (vB - vA) * t, py = yA + (yB - yA) * t;
        m.box(pu, py + 0.48, pv, 0.11, 0.96, 0.11, CEDAR_RAIL);
        m.box(pu, py + 0.08, pv, 0.13, 0.16, 0.13, BALUSTER);
      }
      // Top and bottom cedar rails.
      const totalLen = Math.hypot(len, yB - yA);
      for (const hOff of [0.88, 0.14]) {
        m.at((uA + uB) / 2, y + (yA + yB) / 2 + hOff, (vA + vB) / 2, yaw, 0, pitch);
        m.box(0, 0, 0, totalLen, 0.085, 0.075, CEDAR_RAIL);
      }
      // Vertical black metal balusters on desktop.
      if (!this.low) {
        const count = Math.max(2, Math.floor(len / 0.24));
        for (let k = 1; k < count; k++) {
          const t = k / count;
          const bu = uA + (uB - uA) * t, bv = vA + (vB - vA) * t, by = yA + (yB - yA) * t;
          m.at(0, y, 0);
          m.box(bu, by + 0.51, bv, 0.024, 0.72, 0.024, BALUSTER);
        }
      }
      m.at(0, y, 0);
    };
    // Front step handrails (both sides).
    cedarRailing(ST.u0, ST.v0 - 0.06, ST.top, ST.u1, ST.v0 - 0.06, 0.08, 1);
    cedarRailing(ST.u0, ST.v1 + 0.06, ST.top, ST.u1, ST.v1 + 0.06, 0.08, 1);

    // ---- ACCESSIBLE RAMP ALONG THE FRONT-WEST WALL ----
    // Concrete sloped ramp deck (extruded along u from RP.u0 to RP.u1, sloping down from v = RP.v1 to v = RP.v0).
    m.at(0, y, 0, Math.PI / 2);
    // In rotated frame (yaw = +PI/2): local x = -v, local z = u!
    m.extrude([
      [-RP.v1, under], [-RP.v0, under], [-RP.v0, 0.04], [-RP.v1, RP.top],
    ], RP.u0, RP.u1, CONCRETE);
    m.at(0, y, 0);
    // Outer and inner cedar-and-black-baluster railings lining the ramp.
    cedarRailing(RP.u1 - 0.06, RP.v1, RP.top, RP.u1 - 0.06, RP.v0, 0.04, 4);
    cedarRailing(RP.u0 + 0.06, RP.v1, RP.top, RP.u0 + 0.06, RP.v0, 0.04, 4);

    // ---- WEST LAWN: WHITE METAL FLAGPOLE WITH CANADIAN FLAG ----
    const FP = CHURCH_FLAGPOLE;
    const gyF = this.g(this.site.church, FP.u, FP.v);
    const minF = Math.min(this.g(this.site.church, FP.u - 0.4, FP.v - 0.4), this.g(this.site.church, FP.u + 0.4, FP.v + 0.4));
    const underF = Math.min(-0.35, minF - gyF - 0.25);
    m.at(FP.u, gyF, FP.v);
    m.box(0, (0.14 + underF) / 2, 0, 0.44, 0.14 - underF, 0.44, CONCRETE);
    m.cyl(0, FP.height / 2, 0, 0.065, FP.height, CHURCH_TRIM, 'y', this.low ? 6 : 10, 0.04);
    m.cyl(0, FP.height + 0.08, 0, 0.09, 0.14, GOLD, 'y', 6, 0.04);
    // Double-sided Canadian flag streaming gently southeast from the top of the mast.
    s.at(FP.u - 0.02, gyF + FP.height - 0.48, FP.v + 0.80, Math.PI / 2);
    s.plate(1.52, 0.76, this.signCells.flag, 0.02);

    // ---- WEST LAWN: WHITE TWO-POST CHURCH SIGNBOARD ----
    const SB = CHURCH_SIGNBOARD;
    const gyS = this.g(this.site.church, SB.u, SB.v);
    const minS = Math.min(this.g(this.site.church, SB.u - 0.4, SB.v - 1.2), this.g(this.site.church, SB.u + 0.4, SB.v + 1.2));
    const underS = Math.min(-0.35, minS - gyS - 0.25);
    m.at(SB.u, gyS, SB.v, SB.yaw);
    // Small dark mulch mound around the base of the two white posts.
    m.box(0, (0.12 + underS) / 2, 0, 0.86, 0.12 - underS, SB.w + 0.72, MULCH);
    // Two white wooden posts and peaked white cornice cap holding the sign board.
    for (const pz of [-SB.w / 2 - 0.06, SB.w / 2 + 0.06]) {
      m.box(0, (2.35 + underS) / 2, pz, 0.14, 2.35 - underS, 0.14, CHURCH_TRIM);
    }
    const boardY = 1.62;
    m.box(0, boardY, 0, 0.14, SB.h, SB.w, CHURCH_TRIM);
    m.box(0, boardY + SB.h / 2 + 0.08, 0, 0.28, 0.14, SB.w + 0.34, CHURCH_TRIM);
    m.box(0, boardY + SB.h / 2 + 0.16, 0, 0.32, 0.08, SB.w + 0.38, CHURCH_ROOF);
    // Textured church name sign on BOTH front (facing Highway 252, +u) and back faces.
    s.at(SB.u, gyS + boardY, SB.v, SB.yaw + Math.PI / 2);
    s.within(s.frame, 0, 0, 0.075);
    s.plate(SB.w - 0.12, SB.h - 0.12, this.signCells.churchSign, 0.15);
  }
}
