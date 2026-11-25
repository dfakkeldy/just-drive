import * as THREE from 'three';
import {
  PARKED_COLOURS, ParkedVehicles, parkedSolid, pushOut,
  type Parked, type Pushable, type Solid,
} from './parked';
import type { HandBuiltPlace } from './place';
import { GAS_PARKED_SPOTS, type PortHoodGasSite } from './porthood-gas-site';
import type { Terrain } from './terrain';
import { Mesher, SignAtlas, letters, seeded, type RGB } from './yard-kit';

/**
 * The Port Hood service station and gas bar (building 522, corner of High Road and Dunmore Road), built by hand:
 * - low-slope monopitch service station with medium-grey horizontal siding, dark charcoal lower wainscoting skirt,
 *   clean off-white fascia/trim, stepped front parapet, two north service bays with glazed roll-up doors, four
 *   gooseneck barn lamps and tire stacks;
 * - west storefront office entrance with centered white half-glass door, two large display windows, three gooseneck
 *   barn lamps, outdoor heat pump and electric meter;
 * - lower east lean-to service wing, rear shop windows and wall heat-pump condenser;
 * - raised concrete fuel pump island with two plain stainless/slate dispensers, protective steel bollards, trash
 *   bins, two tall galvanized columns with twin overhead LED floodlight heads and a suspended double-sided illuminated
 *   canopy sign beam;
 * - tall freestanding double-sided price pylon out on the southwest grassy corner facing Dunmore Road and Highway 19;
 * - dark-grey east storage shed with white roll-up door, rust-red corrugated shipping container and enclosed cargo
 *   trailer;
 * - 28 instanced generic random vehicles (cars, SUVs, pickups; no plates, badges or people) packed at the pumps and
 *   in every parking space, while keeping the drive-through lane to the open inner east pump clear for the player.
 *
 * The business name ("PORT HOOD SERVICE" / "CHESTICO FUELS") and teal-and-white sign colours are completely invented;
 * no real brand name, trademark colours, logo, civic number or resident name is used.
 */
const hex = (value: number): RGB => { const c = new THREE.Color(value); return [c.r, c.g, c.b]; };
const shade = (k: RGB, f: number): RGB => [k[0] * f, k[1] * f, k[2] * f];

const WALL_GREY = hex(0x828890);
const WAINSCOT = hex(0x3a4046);
const TRIM = hex(0xeeece4);
const TEAL = hex(0x235a5e);
const ROOF = hex(0x4b5056);
const CONCRETE = hex(0xb8b8b0);
const FOUNDATION = hex(0x949692);
const BAY_DOOR = hex(0x2f353b);
const BAY_LINE = hex(0x485058);
const DOOR_WHITE = hex(0xf2f2ec);
const GLASS: RGB = [0.09, 0.14, 0.19];
const GLASS_WARM: RGB = [0.11, 0.16, 0.21];
const STEEL = hex(0xa9aeb2);
const IRON = hex(0x2e3236);
const LAMP_GLOW = hex(0xfff1c8);
const PUMP_BODY = hex(0xd8dbdc);
const PUMP_SCREEN = hex(0x1f262a);
const HOSE = hex(0x1e2022);
const TIRE = hex(0x242527);
const SHED_WALL = hex(0x5c6268);
const SHED_ROOF = hex(0x3b4046);
const CONTAINER_RUST = hex(0x964538);
const TRAILER_BODY = hex(0xd7dad9);
const TRAILER_TRIM = hex(0x63686d);
const METER = hex(0xa2a6a4);
const POSTER_CARD = hex(0xe8e6dc);

/** Main service station building footprint in site (u, v). */
export const MAIN = {
  u0: -7.5, u1: 6.5, v0: -5.5, v1: 4.5,
  skirt: 1.05, frontTop: 4.65, rearTop: 3.95, parapet: 4.88,
};
/** Lower east lean-to service wing. */
export const EAST_WING = {
  u0: 6.5, u1: 10.2, v0: -4.4, v1: 3.2,
  highTop: 3.15, lowTop: 2.45,
};
/** Raised concrete fuel pump island on the north forecourt. */
export const PUMP_ISLAND = {
  u0: -8.8, u1: -1.2, v0: -13.7, v1: -12.3,
  curb: 0.20, colU: [-7.8, -2.2] as const, colH: 4.65,
  beamBot: 3.05, beamTop: 3.92,
};
/** Tall freestanding double-sided price pylon in the southwest corner lawn. */
export const PYLON = {
  u: -14.0, v: 19.0, yaw: -0.62,
  poleH: 6.85, boxBot: 3.70, boxTop: 6.85, boxW: 2.15, boxD: 0.36,
};
/** East dark-grey gable storage shed with white roll-up door facing west (-u). */
export const EAST_SHED = {
  u0: 17.5, u1: 22.0, v0: -15.2, v1: -11.2,
  eave: 2.45, ridge: 3.65,
};
/** Rust-red corrugated steel shipping container behind/beside the east storage shed. */
export const CONTAINER = {
  u0: 23.0, u1: 25.6, v0: -17.0, v1: -10.8,
  height: 2.6,
};
/** Enclosed silver/white cargo box trailer parked east of the garage wing. */
export const TRAILER = {
  u0: 12.6, u1: 17.0, v0: -5.4, v1: -3.2,
  floor: 0.42, height: 2.35,
};

interface SignCells {
  fascia: [number, number, number, number];
  storefront: [number, number, number, number];
  canopy: [number, number, number, number];
  pylon: [number, number, number, number];
}

function buildSignAtlas(): { atlas: SignAtlas; cells: SignCells } | null {
  if (typeof document === 'undefined') return null;
  const atlas = new SignAtlas(1024, 512);

  // 1. North service-bay fascia sign (invented name, teal-slate ground, cream border).
  const fascia = atlas.add(512, 96, (g, w, h) => {
    letters(g, w, h, ['PORT HOOD SERVICE'], '#f7f5ec', '#214c50', {
      font: 'system-ui, -apple-system, sans-serif', border: '#e8e2cf',
    });
  }).cell;

  // 2. West storefront fascia sign.
  const storefront = atlas.add(500, 96, (g, w, h) => {
    letters(g, w, h, ['PORT HOOD SERVICE', 'FUEL · TIRES · REPAIRS'], '#f7f5ec', '#214c50', {
      font: 'system-ui, -apple-system, sans-serif', border: '#e8e2cf', weights: [1.5, 0.8],
    });
  }).cell;

  // 3. Suspended fuel island canopy sign beam (invented brand "CHESTICO FUELS").
  const canopy = atlas.add(512, 112, (g, w, h) => {
    g.fillStyle = '#1d4d52';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e7e2d0';
    g.fillRect(0, 0, w, 10);
    g.fillRect(0, h - 10, w, 10);
    // Simple invented geometric compass-wave diamond mark on left.
    g.fillStyle = '#f5f2e6';
    g.beginPath();
    g.moveTo(56, 22); g.lineTo(86, 56); g.lineTo(56, 90); g.lineTo(26, 56); g.closePath();
    g.fill();
    g.fillStyle = '#2d7a7f';
    g.beginPath();
    g.moveTo(56, 36); g.lineTo(72, 56); g.lineTo(56, 76); g.lineTo(40, 56); g.closePath();
    g.fill();
    g.fillStyle = '#ffffff';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = 'bold 48px system-ui, -apple-system, sans-serif';
    g.fillText('CHESTICO FUELS', 106, 46, w - 124);
    g.fillStyle = '#d6e7e6';
    g.font = '700 22px ui-monospace, Menlo, monospace';
    g.fillText('SELF & FULL SERVE  ·  DIESEL', 108, 82, w - 126);
  }).cell;

  // 4. Tall freestanding roadside price pylon sign (invented brand + glowing red LED prices).
  const pylon = atlas.add(256, 384, (g, w, h) => {
    g.fillStyle = '#1c4a4f';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ebe6d6';
    g.lineWidth = 6;
    g.strokeRect(5, 5, w - 10, h - 10);
    // Top brand header + simple geometric diamond mark.
    g.fillStyle = '#f4f1e6';
    g.beginPath();
    g.moveTo(w / 2, 22); g.lineTo(w / 2 + 34, 56); g.lineTo(w / 2, 90); g.lineTo(w / 2 - 34, 56); g.closePath();
    g.fill();
    g.fillStyle = '#2d7a7f';
    g.beginPath();
    g.moveTo(w / 2, 34); g.lineTo(w / 2 + 20, 56); g.lineTo(w / 2, 78); g.lineTo(w / 2 - 20, 56); g.closePath();
    g.fill();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 30px system-ui, -apple-system, sans-serif';
    g.fillText('CHESTICO', w / 2, 114, w - 24);
    g.font = 'bold 20px system-ui, -apple-system, sans-serif';
    g.fillStyle = '#d7e8e6';
    g.fillText('FUELS', w / 2, 140, w - 24);
    // Dark LED price windows (Regular + Diesel, invented generic prices).
    const row = (y: number, label: string, price: string) => {
      g.fillStyle = '#15191c';
      g.fillRect(18, y, w - 36, 74);
      g.strokeStyle = '#475257';
      g.lineWidth = 2;
      g.strokeRect(18, y, w - 36, 74);
      g.fillStyle = '#cfd8d9';
      g.textAlign = 'left';
      g.font = 'bold 14px system-ui, sans-serif';
      g.fillText(label, 26, y + 16);
      g.fillStyle = '#ff3b2f';
      g.textAlign = 'center';
      g.font = 'bold 46px ui-monospace, Menlo, monospace';
      g.fillText(price, w / 2 + 4, y + 48, w - 52);
    };
    row(164, 'REGULAR', '159.9');
    row(248, 'DIESEL', '168.9');
    // Footer bar.
    g.fillStyle = '#f2efe4';
    g.fillRect(18, 336, w - 36, 30);
    g.fillStyle = '#1c4a4f';
    g.textAlign = 'center';
    g.font = 'bold 17px system-ui, sans-serif';
    g.fillText('SERVICE & TIRES', w / 2, 352, w - 44);
  }).cell;

  return { atlas, cells: { fascia, storefront, canopy, pylon } };
}

export class PortHoodGas implements HandBuiltPlace {
  readonly group = new THREE.Group();
  private local = new THREE.Group();   // site axes: x is u, z is v
  private solids: Solid[] = [];
  private built = false; private near = false; private drawnOk = false; private groundSig = NaN;
  private material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private signMaterial: THREE.MeshLambertMaterial;
  private signCells: SignCells;
  private parked: ParkedVehicles;
  private parkedList: Parked[];
  private probes: { x: number; z: number }[];
  /** Triangles in the hand-built station + sign meshes (excluding instanced parked vehicles). */
  triangles = 0;
  /** Triangles across all 28 instanced parked vehicles (3 InstancedMeshes * instance count). */
  parkedTriangles = 0;
  /** Full feature triangle count (station + signs + all 28 instanced parked vehicles). */
  get totalTriangles(): number { return this.triangles + this.parkedTriangles; }

  /** `lift` turns a true height above the sea into the game's stretched height. */
  constructor(readonly site: PortHoodGasSite, private terrain: Terrain, private lift: (metres: number) => number, private low: boolean) {
    this.group.name = 'porthood-gas';
    const o = site.origin;
    this.local.position.set(o.x, 0, o.z);
    this.local.rotation.y = site.yaw;
    this.group.add(this.local);
    this.group.visible = false;

    // Single shared sign atlas (1 texture, 1 draw call for all station & pylon signs).
    const builtAtlas = buildSignAtlas();
    this.signCells = builtAtlas?.cells ?? {
      fascia: [0, 0, 1, 1], storefront: [0, 0, 1, 1], canopy: [0, 0, 1, 1], pylon: [0, 0, 1, 1],
    };
    this.signMaterial = builtAtlas
      ? new THREE.MeshLambertMaterial({
        vertexColors: true, map: builtAtlas.atlas.texture,
        emissive: 0x3b3b3b, emissiveMap: builtAtlas.atlas.texture, side: THREE.DoubleSide,
      })
      : new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

    // 28 generic random parked vehicles (cars, SUVs, pickups; instanced in 3 draw calls total).
    const rnd = seeded(52219);
    this.parkedList = GAS_PARKED_SPOTS.map((s) => {
      const w = site.world(s.u, s.v);
      const wobble = (rnd() - 0.5) * 0.06;
      const colour = PARKED_COLOURS[Math.floor(rnd() * PARKED_COLOURS.length)];
      return { x: w.x, z: w.z, heading: site.heading(s.du, s.dv) + wobble, type: s.type, colour };
    });
    this.parked = new ParkedVehicles(
      this.parkedList,
      (x, z) => this.terrain.meshHeightAt?.(x, z, true) ?? this.terrain.heightAt(x, z) ?? this.lift(this.site.level),
      this.material,
    );
    this.parked.group.name = 'porthood-gas-parked';
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

    this.probes = ([
      [0, 0], [-5, -13], [20, -13], [PYLON.u, PYLON.v], [-25, -18], [4, 9],
    ] as [number, number][]).map(([u, v]) => site.world(u, v));
    this.initSolids();
  }

  /** Number of parked vehicles in the lot (all instanced in 3 meshes). */
  get parkedCount(): number { return this.parkedList.length; }

  /** True while the station is near, unbuilt, and L8 terrain is still loading or ready to build (never hangs on L7-only LOW). */
  get waiting(): boolean { return this.near && !this.built && ((this.terrain.pending ?? 0) > 0 || this.ready()); }

  private g = (u: number, v: number): number => {
    const w = this.site.world(u, v);
    return this.terrain.meshHeightAt?.(w.x, w.z, true) ?? this.terrain.heightAt(w.x, w.z) ?? this.lift(this.site.level);
  };

  /** Match PortHoodGasSite (maxTexel = 1): draw only when L8 terrain is drawn under every probe so pad and lot agree. */
  private ready(): boolean {
    for (const p of this.probes) {
      const level = this.terrain.drawnLevelAt ? (this.terrain.drawnLevelAt(p.x, p.z) ?? -1) : (this.terrain.levelAt?.(p.x, p.z) ?? -1);
      if (level < 8) return false;
    }
    return true;
  }

  private probeGroundSig(): number {
    let sig = 0;
    const fb = this.lift(this.site.level);
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
    this.near = far < 900;
    const ok = (this.near || (this.built && far < 1600)) && this.ready();
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
    this.group.visible = this.built && this.drawnOk && far < 1600;
  }

  /** Station building, east wing, fuel island, pylon, shed, container, trailer, tire stacks and all 28 parked cars stop the player. */
  resolveSolids(car: Pushable): void {
    const b = this.site.box;
    if (car.x < b[0] || car.x > b[2] || car.z < b[1] || car.z > b[3]) return;
    pushOut(car, this.solids);
  }

  private solid(u0: number, u1: number, v0: number, v1: number): void {
    const w = this.site.world((u0 + u1) / 2, (v0 + v1) / 2);
    const hu = (u1 - u0) / 2, hv = (v1 - v0) / 2;
    this.solids.push(hu >= hv
      ? { x: w.x, z: w.z, half: hu, halfWidth: hv, heading: this.site.heading(1, 0) }
      : { x: w.x, z: w.z, half: hv, halfWidth: hu, heading: this.site.heading(0, 1) });
  }

  /** Horizontal collision solids are fixed in site coordinates and active consistently before and after L8 loads. */
  private initSolids(): void {
    this.solid(MAIN.u0, MAIN.u1, MAIN.v0, MAIN.v1);
    this.solid(EAST_WING.u0, EAST_WING.u1, EAST_WING.v0, EAST_WING.v1);
    this.solid(PUMP_ISLAND.u0, PUMP_ISLAND.u1, PUMP_ISLAND.v0, PUMP_ISLAND.v1);
    this.solid(PYLON.u - 0.55, PYLON.u + 0.55, PYLON.v - 0.55, PYLON.v + 0.55);
    this.solid(EAST_SHED.u0, EAST_SHED.u1, EAST_SHED.v0, EAST_SHED.v1);
    this.solid(CONTAINER.u0, CONTAINER.u1, CONTAINER.v0, CONTAINER.v1);
    this.solid(TRAILER.u0, TRAILER.u1, TRAILER.v0, TRAILER.v1);
    this.solid(5.1, 6.6, -6.5, -5.5);   // stacked tires beside east service bay
    for (const p of this.parkedList) this.solids.push(parkedSolid(p));
  }

  private build(): void {
    for (const child of [...this.local.children]) {
      this.local.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
    }
    const m = new Mesher();
    const s = new Mesher();
    const y = this.lift(this.site.level);
    this.mainStation(m, s, y);
    this.eastWing(m, y);
    this.fuelIsland(m, s);
    this.pylonSign(m, s);
    this.eastShed(m);
    this.shippingContainer(m);
    this.cargoTrailer(m);

    const mesh = new THREE.Mesh(m.geometry(), this.material);
    mesh.castShadow = mesh.receiveShadow = !this.low;
    this.local.add(mesh);

    const signMesh = new THREE.Mesh(s.geometry(), this.signMaterial);
    signMesh.castShadow = false;
    signMesh.receiveShadow = !this.low;
    this.local.add(signMesh);

    this.triangles = m.triangles + s.triangles;
  }

  /** Horizontal lap siding shadow lines (desktop only, keeping LOW lightweight). */
  private horizontalSiding(m: Mesher, face: 'u' | 'v', plane: number, out: number, a0: number, a1: number, bot: number, top: number): void {
    if (this.low) return;
    const p = plane + out * 0.012, k = shade(WALL_GREY, 0.80);
    for (let y = bot + 0.32; y < top - 0.14; y += 0.34) {
      const y0 = y - 0.015, y1 = y + 0.015;
      m.quad(face === 'u'
        ? [[p, y0, a0], [p, y0, a1], [p, y1, a1], [p, y1, a0]]
        : [[a0, y0, p], [a1, y0, p], [a1, y1, p], [a0, y1, p]], k);
    }
  }

  /** Framed window opening on a wall in site (u, v) coordinates. */
  private windowBox(m: Mesher, face: 'u' | 'v', plane: number, out: number, along: number, bottom: number, w: number, h: number, fill: RGB = GLASS, mullions = 0): void {
    const part = (depth: number, yc: number, ww: number, hh: number, k: RGB) => {
      const p = plane + out * depth;
      if (face === 'u') m.box(p, yc, along, 0.05, hh, ww, k);
      else m.box(along, yc, p, ww, hh, 0.05, k);
    };
    part(0.025, bottom + h / 2, w + 0.22, h + 0.22, TRIM);
    part(0.048, bottom + h / 2, w, h, fill);
    for (let i = 1; i <= mullions; i++) {
      const off = along - w / 2 + (w * i) / (mullions + 1);
      const p = plane + out * 0.064;
      if (face === 'u') m.box(p, bottom + h / 2, off, 0.04, h + 0.01, 0.05, TRIM);
      else m.box(off, bottom + h / 2, p, 0.05, h + 0.01, 0.04, TRIM);
    }
  }

  /** Black gooseneck barn lamp jutting out from a wall above a signboard. */
  private gooseneckLamp(m: Mesher, face: 'u' | 'v', plane: number, out: number, along: number, mountY: number): void {
    if (this.low) {
      // Compact fixture on LOW.
      if (face === 'v') m.box(along, mountY + 0.14, plane + out * 0.35, 0.28, 0.12, 0.45, IRON);
      else m.box(plane + out * 0.35, mountY + 0.14, along, 0.45, 0.12, 0.28, IRON);
      return;
    }
    const p1 = plane + out * 0.18, p2 = plane + out * 0.48, p3 = plane + out * 0.62;
    if (face === 'v') {
      m.box(along, mountY, plane + out * 0.03, 0.12, 0.12, 0.06, IRON);
      m.box(along, mountY + 0.14, p1, 0.035, 0.30, 0.035, IRON);
      m.box(along, mountY + 0.28, (p1 + p3) / 2, 0.035, 0.035, 0.48, IRON);
      m.cyl(along, mountY + 0.14, p3, 0.15, 0.11, IRON, 'y', 8, 0.05);
      m.cyl(along, mountY + 0.08, p3, 0.08, 0.04, LAMP_GLOW, 'y', 6);
    } else {
      m.box(plane + out * 0.03, mountY, along, 0.06, 0.12, 0.12, IRON);
      m.box(p1, mountY + 0.14, along, 0.035, 0.30, 0.035, IRON);
      m.box((p1 + p3) / 2, mountY + 0.28, along, 0.48, 0.035, 0.035, IRON);
      m.cyl(p3, mountY + 0.14, along, 0.15, 0.11, IRON, 'y', 8, 0.05);
      m.cyl(p3, mountY + 0.08, along, 0.08, 0.04, LAMP_GLOW, 'y', 6);
    }
    void p2;
  }

  /** Garage service bay roll-up door with trim frame, horizontal section lines and upper vision lites. */
  private serviceBayDoor(m: Mesher, u: number, w: number, h: number): void {
    const v = MAIN.v0;
    // Outer off-white trim casing and spruce-teal jamb reveal behind the sectional door panels.
    m.box(u, h / 2 + 0.09, v - 0.022, w + 0.36, h + 0.24, 0.045, TRIM);
    m.box(u, h / 2 + 0.04, v - 0.036, w + 0.14, h + 0.08, 0.035, TEAL);
    // Sectional roll-up bay door face proud of the inner jamb so panels and vision lites read cleanly.
    m.box(u, h / 2, v - 0.056, w, h, 0.03, BAY_DOOR);
    if (!this.low) {
      for (let py = 0.55; py < h - 0.2; py += 0.52) {
        m.box(u, py, v - 0.075, w - 0.08, 0.04, 0.015, BAY_LINE);
      }
    }
    // Four framed glazed upper vision lites across the bay door.
    const paneW = (w - 0.6) / 4;
    for (let i = 0; i < 4; i++) {
      const pu = u - w / 2 + 0.3 + paneW * (i + 0.5);
      m.box(pu, h * 0.72, v - 0.074, paneW - 0.06, 0.44, 0.014, TRIM);
      m.box(pu, h * 0.72, v - 0.084, paneW - 0.14, 0.36, 0.014, GLASS_WARM);
    }
  }

  /** Outdoor wall-mounted heat-pump condenser unit. */
  private heatPump(m: Mesher, face: 'u' | 'v', plane: number, out: number, along: number, y0: number): void {
    const p = plane + out * 0.24;
    if (face === 'u') {
      m.box(p, y0 + 0.34, along, 0.38, 0.64, 0.86, STEEL);
      if (!this.low) m.cyl(plane + out * 0.44, y0 + 0.34, along - 0.14, 0.20, 0.03, IRON, 'x', 8);
    } else {
      m.box(along, y0 + 0.34, p, 0.86, 0.64, 0.38, STEEL);
      if (!this.low) m.cyl(along - 0.14, y0 + 0.34, plane + out * 0.44, 0.20, 0.03, IRON, 'z', 8);
    }
  }

  /** Main service station block: monopitch parapet roof, two north service bays, west storefront, rear windows. */
  private mainStation(m: Mesher, s: Mesher, y: number): void {
    const M = MAIN, under = -0.9;
    const cu = (M.u0 + M.u1) / 2, len = M.u1 - M.u0;
    const cv = (M.v0 + M.v1) / 2, dep = M.v1 - M.v0;

    // Monopitch body extruded along u (rotated frame: local x = -v, local z = u).
    // Local x = -v => front wall (v = v0 = -5.5) is at local x = +5.5; rear wall (v = v1 = +4.5) is at local x = -4.5.
    m.at(0, y, 0, Math.PI / 2);
    m.extrude([
      [-M.v1, under], [-M.v0, under], [-M.v0, M.frontTop], [-M.v1, M.rearTop],
    ], M.u0, M.u1, WALL_GREY);
    // Low-slope dark roof cap overhanging slightly on eaves.
    m.extrude([
      [-M.v1 - 0.22, M.rearTop - 0.02], [-M.v0 + 0.18, M.frontTop + 0.02],
      [-M.v0 + 0.18, M.frontTop + 0.16], [-M.v1 - 0.22, M.rearTop + 0.12],
    ], M.u0 - 0.18, M.u1 + 0.18, ROOF, TRIM);

    // Back in site (u, v) frame.
    m.at(0, y, 0);
    // Stepped front parapet cap along north wall (-v) and crisp fascia trim around roof edges.
    m.box(cu, (M.frontTop + M.parapet) / 2, M.v0 + 0.12, len + 0.14, M.parapet - M.frontTop, 0.28, WALL_GREY);
    m.box(cu, M.parapet + 0.06, M.v0 + 0.10, len + 0.28, 0.14, 0.36, TRIM);
    m.box(M.u0 - 0.06, M.frontTop + 0.06, M.v0 + 0.18, 0.16, 0.32, 0.42, TRIM);
    // Low concrete foundation skirt and dark charcoal lower wainscoting band around all four walls.
    m.box(cu, (0.22 + under) / 2, cv, len + 0.12, 0.22 - under, dep + 0.12, FOUNDATION);
    m.box(cu, (0.22 + M.skirt) / 2, cv, len + 0.06, M.skirt - 0.22, dep + 0.06, WAINSCOT);
    // Crisp horizontal accent trim strip separating dark lower wainscot from upper grey siding.
    m.box(cu, M.skirt + 0.04, cv, len + 0.12, 0.09, dep + 0.12, TRIM);
    // Vertical corner trim boards.
    for (const [u, v, top] of [
      [M.u0, M.v0, M.parapet], [M.u1, M.v0, M.parapet], [M.u0, M.v1, M.rearTop], [M.u1, M.v1, M.rearTop],
    ]) m.box(u, (0.22 + top) / 2, v, 0.16, top - 0.22, 0.16, TRIM);

    // Horizontal siding texture strips on desktop.
    this.horizontalSiding(m, 'v', M.v0, -1, M.u0, M.u1, M.skirt + 0.1, M.frontTop);
    this.horizontalSiding(m, 'v', M.v1, 1, M.u0, M.u1, M.skirt + 0.1, M.rearTop);
    this.horizontalSiding(m, 'u', M.u0, -1, M.v0, M.v1, M.skirt + 0.1, M.rearTop);

    // ---- NORTH FRONT FACE (v = -5.5, facing High Road & fuel pumps) ----
    this.serviceBayDoor(m, -3.7, 3.65, 3.15);
    this.serviceBayDoor(m, 2.2, 3.65, 3.15);
    // Center pier service cabinet / hose box between the two service bays.
    m.box(-0.75, 1.55, M.v0 - 0.14, 0.55, 0.72, 0.22, TEAL);
    // Wide north fascia signboard above the two service bays ("PORT HOOD SERVICE").
    m.box(-0.5, 3.88, M.v0 - 0.06, 9.8, 0.86, 0.12, TEAL);
    s.at(-0.5, y + 3.88, M.v0 - 0.12, Math.PI);
    s.plate(9.6, 0.78, this.signCells.fascia);
    // Four black gooseneck barn lamps illuminating the north signboard.
    for (const lu of [-4.2, -1.7, 0.8, 3.3]) this.gooseneckLamp(m, 'v', M.v0, -1, lu, 4.44);
    // Stacks of black rubber tires outside the east bay jamb (real service-centre detail).
    const tireCols = this.low ? [[5.55, -5.95, 3], [6.2, -6.0, 2]] : [[5.45, -5.95, 4], [6.05, -6.02, 5], [5.75, -6.32, 3]];
    for (const [tu, tv, count] of tireCols) {
      for (let i = 0; i < count; i++) {
        m.cyl(tu, 0.14 + i * 0.26, tv, 0.31, 0.24, TIRE, 'y', this.low ? 6 : 10);
      }
    }

    // ---- WEST STOREFRONT FACE (u = -7.5, facing Dunmore Road & west apron) ----
    // Concrete stoop/step outside the storefront door.
    m.box(M.u0 - 0.45, 0.08, -0.8, 0.9, 0.16, 2.4, CONCRETE);
    // Centered white half-glass entry door.
    const du = M.u0;
    m.box(du - 0.03, 1.15, -0.8, 0.06, 2.26, 1.24, TRIM);
    m.box(du - 0.055, 1.12, -0.8, 0.05, 2.12, 1.04, DOOR_WHITE);
    m.box(du - 0.082, 1.56, -0.8, 0.02, 0.92, 0.72, GLASS_WARM);
    m.box(du - 0.095, 1.05, -0.42, 0.05, 0.18, 0.04, IRON);
    // Two large storefront display windows flanking the entry door.
    this.windowBox(m, 'u', du, -1, -3.25, 1.05, 1.85, 1.48, GLASS_WARM, 1);
    this.windowBox(m, 'u', du, -1, 1.65, 1.05, 1.85, 1.48, GLASS_WARM, 1);
    // Small framed notice/poster cards beside the doorway (matching real storefront, no real logos).
    m.box(du - 0.04, 1.48, -1.82, 0.03, 0.62, 0.42, POSTER_CARD);
    m.box(du - 0.04, 1.48, 0.22, 0.03, 0.62, 0.42, POSTER_CARD);
    // West storefront fascia signboard ("PORT HOOD SERVICE / FUEL · TIRES · REPAIRS").
    m.box(du - 0.06, 3.48, -0.8, 0.12, 0.78, 6.8, TEAL);
    s.at(du - 0.12, y + 3.48, -0.8, -Math.PI / 2);
    s.plate(6.6, 0.70, this.signCells.storefront);
    // Three black gooseneck barn lamps above the storefront sign.
    for (const lv of [-3.0, -0.8, 1.4]) this.gooseneckLamp(m, 'u', du, -1, lv, 4.02);
    // Outdoor heat-pump condenser & electric meter near the southwest corner.
    this.heatPump(m, 'u', du, -1, 3.35, 0.45);
    m.box(du - 0.08, 1.55, 4.05, 0.14, 0.34, 0.24, METER);

    // ---- SOUTH REAR FACE (v = +4.5, facing Highway 19 / Dunmore corner) ----
    // Two framed white shop windows + wall heat-pump condenser + two framed display panels near SW corner.
    this.windowBox(m, 'v', M.v1, 1, -1.2, 1.25, 1.15, 1.25, GLASS, 1);
    this.windowBox(m, 'v', M.v1, 1, 2.6, 1.25, 1.15, 1.25, GLASS, 1);
    this.heatPump(m, 'v', M.v1, 1, -3.5, 0.35);
    for (const pu of [-6.3, -5.0]) {
      m.box(pu, 2.05, M.v1 + 0.035, 0.92, 1.15, 0.04, TRIM);
      m.box(pu, 2.05, M.v1 + 0.055, 0.78, 1.00, 0.02, TEAL);
    }
  }

  /** Lower east lean-to service & tire bay wing attached to the main building (+u). */
  private eastWing(m: Mesher, y: number): void {
    const E = EAST_WING, under = -0.9;
    const cu = (E.u0 + E.u1) / 2, len = E.u1 - E.u0;
    const cv = (E.v0 + E.v1) / 2, dep = E.v1 - E.v0;
    // Extruded along v (local z = v, local x = u): slopes down from u0 (highTop) to u1 (lowTop).
    m.at(0, y, 0);
    m.extrude([
      [E.u0, under], [E.u1, under], [E.u1, E.lowTop], [E.u0, E.highTop],
    ], E.v0, E.v1, WALL_GREY);
    m.extrude([
      [E.u0 - 0.05, E.highTop], [E.u1 + 0.24, E.lowTop - 0.04],
      [E.u1 + 0.24, E.lowTop + 0.08], [E.u0 - 0.05, E.highTop + 0.12],
    ], E.v0 - 0.16, E.v1 + 0.16, ROOF, TRIM);
    // Matching dark lower wainscot & trim band.
    m.box(cu, (0.20 + MAIN.skirt) / 2, cv, len + 0.06, MAIN.skirt - 0.20, dep + 0.06, WAINSCOT);
    m.box(cu, MAIN.skirt + 0.04, cv, len + 0.10, 0.08, dep + 0.10, TRIM);
    for (const v of [E.v0, E.v1]) m.box(E.u1, (0.20 + E.lowTop) / 2, v, 0.14, E.lowTop - 0.20, 0.14, TRIM);
    // North personnel door & south small utility window.
    m.box(cu, 1.08, E.v0 - 0.03, 1.12, 2.12, 0.06, TRIM);
    m.box(cu, 1.06, E.v0 - 0.055, 0.94, 2.00, 0.04, DOOR_WHITE);
    this.windowBox(m, 'v', E.v1, 1, cu, 1.18, 0.92, 0.86, GLASS, 0);
  }

  /** Raised concrete fuel pump island, twin galvanized columns with twin LED floodlights, suspended sign beam and two dispensers. */
  private fuelIsland(m: Mesher, s: Mesher): void {
    const P = PUMP_ISLAND;
    const cu = (P.u0 + P.u1) / 2, cv = (P.v0 + P.v1) / 2;
    const gy = this.g(cu, cv);
    const minCorner = Math.min(this.g(P.u0, P.v0), this.g(P.u1, P.v0), this.g(P.u0, P.v1), this.g(P.u1, P.v1));
    const curbUnder = Math.min(-0.55, minCorner - gy - 0.30);
    const len = P.u1 - P.u0, wid = P.v1 - P.v0;

    m.at(0, gy, 0);
    // Raised concrete curb island extending below the lowest downhill corner so slopes never gap at 3x exaggeration.
    m.box(cu, (P.curb + curbUnder) / 2, cv, len, P.curb - curbUnder, wid, CONCRETE);
    m.box(cu, P.curb + 0.01, cv, len - 0.12, 0.02, wid - 0.12, shade(CONCRETE, 1.05));

    // Two tall galvanized steel columns rising from the island, each topped with twin rectangular downward LED floodlights.
    for (const colU of P.colU) {
      m.box(colU, P.curb + P.colH / 2, cv, 0.20, P.colH, 0.20, STEEL);
      m.box(colU, P.curb + 0.12, cv, 0.34, 0.24, 0.34, shade(STEEL, 0.85));   // base flange
      // Horizontal T-crossbar at top of pole along v.
      const topY = P.curb + P.colH;
      m.box(colU, topY, cv, 0.12, 0.12, 1.65, STEEL);
      // Twin rectangular downward-facing LED canopy floodlight housings per pole.
      for (const dv of [-0.62, 0.62]) {
        m.box(colU, topY - 0.04, cv + dv, 0.56, 0.14, 0.66, IRON);
        m.box(colU, topY - 0.115, cv + dv, 0.46, 0.02, 0.54, LAMP_GLOW, false);
      }
    }

    // Suspended illuminated double-sided canopy sign beam spanning between the two steel posts.
    const beamU0 = P.colU[0] - 0.25, beamU1 = P.colU[1] + 0.25;
    const beamLen = beamU1 - beamU0, beamH = P.beamTop - P.beamBot, beamY = P.curb + (P.beamBot + P.beamTop) / 2;
    m.box(cu, beamY, cv, beamLen, beamH, 0.34, TEAL);
    m.box(cu, P.curb + P.beamTop + 0.03, cv, beamLen + 0.08, 0.07, 0.40, TRIM);
    m.box(cu, P.curb + P.beamBot - 0.03, cv, beamLen + 0.08, 0.07, 0.40, TRIM);
    // Textured sign faces on BOTH north (-v) and south (+v) sides of the overhead sign beam.
    s.at(cu, gy + beamY, cv + 0.17, 0);
    s.plate(beamLen - 0.14, beamH - 0.08, this.signCells.canopy, 0.34);

    // Two modern neutral fuel pump dispensers between the columns.
    for (const du of [-6.1, -3.9]) {
      m.box(du, P.curb + 0.96, cv, 0.84, 1.92, 0.58, PUMP_BODY);
      m.box(du, P.curb + 1.76, cv, 0.88, 0.36, 0.62, TEAL);
      m.box(du, P.curb + 0.14, cv, 0.88, 0.28, 0.62, WAINSCOT);
      // Digital display screens on both drive-up faces (-v and +v).
      for (const side of [-1, 1]) {
        m.box(du, P.curb + 1.18, cv + side * 0.30, 0.66, 0.54, 0.03, PUMP_SCREEN);
        m.box(du, P.curb + 1.24, cv + side * 0.32, 0.52, 0.14, 0.015, LAMP_GLOW);
      }
      // Side fuel hose loops and nozzle boots (desktop only).
      if (!this.low) {
        for (const side of [-0.45, 0.45]) {
          m.box(du + side, P.curb + 1.10, cv, 0.05, 0.92, 0.05, HOSE);
          m.box(du + side * 0.92, P.curb + 0.64, cv, 0.12, 0.06, 0.08, HOSE);
        }
      }
    }

    // Protective steel pipe bollards and cylindrical trash/washer bins at both ends of the island.
    for (const bu of [P.u0 + 0.28, P.u1 - 0.28]) {
      m.cyl(bu, P.curb + 0.48, cv, 0.085, 0.96, IRON, 'y', this.low ? 6 : 8);
      m.cyl(bu, P.curb + 0.92, cv, 0.09, 0.12, TRIM, 'y', this.low ? 6 : 8);
    }
    for (const binU of [P.u0 + 0.68, P.u1 - 0.68]) {
      m.cyl(binU, P.curb + 0.46, cv, 0.24, 0.92, TEAL, 'y', this.low ? 6 : 10);
      m.cyl(binU, P.curb + 0.94, cv, 0.26, 0.06, IRON, 'y', this.low ? 6 : 10);
    }
  }

  /** Tall freestanding double-sided roadside price pylon in the southwest corner lawn. */
  private pylonSign(m: Mesher, s: Mesher): void {
    const P = PYLON;
    const gy = this.g(P.u, P.v);
    const minCorner = Math.min(this.g(P.u - 0.5, P.v - 0.5), this.g(P.u + 0.5, P.v - 0.5), this.g(P.u - 0.5, P.v + 0.5), this.g(P.u + 0.5, P.v + 0.5));
    const pedUnder = Math.min(-0.40, minCorner - gy - 0.30);
    const pedTop = 0.70;
    m.at(P.u, gy, P.v, P.yaw);
    // Tapered light-grey concrete pedestal base extending below downhill slope.
    m.cyl(0, (pedTop + pedUnder) / 2, 0, 0.46, pedTop - pedUnder, CONCRETE, 'y', 4, 0.30);
    // Galvanized steel sign pole.
    m.cyl(0, P.poleH / 2, 0, 0.14, P.poleH, STEEL, 'y', this.low ? 6 : 10, 0.12);
    // Rectangular double-sided illuminated price sign cabinet at top of pole.
    const bh = P.boxTop - P.boxBot, by = (P.boxBot + P.boxTop) / 2;
    m.box(0, by, 0, P.boxW, bh, P.boxD, TEAL);
    m.box(0, P.boxTop + 0.04, 0, P.boxW + 0.08, 0.08, P.boxD + 0.08, TRIM);
    m.box(0, P.boxBot - 0.04, 0, P.boxW + 0.08, 0.08, P.boxD + 0.08, TRIM);
    // Crisp textured brand & glowing red LED price display on both wide faces.
    s.at(P.u, gy + by, P.v, P.yaw);
    s.within(s.frame, 0, 0, P.boxD / 2);
    s.plate(P.boxW - 0.08, bh - 0.08, this.signCells.pylon, P.boxD);
  }

  /** Dark-grey gable storage shed on the east edge of the lot, white roll-up garage door facing west (-u). */
  private eastShed(m: Mesher): void {
    const S = EAST_SHED, cu = (S.u0 + S.u1) / 2, cv = (S.v0 + S.v1) / 2, half = (S.v1 - S.v0) / 2;
    const gy = this.g(cu, cv), under = -0.9;
    // Gable ridge runs along u (rotated frame: local x = -(v - cv), local z = u).
    m.at(0, gy, cv, Math.PI / 2);
    m.extrude([[-half, under], [half, under], [half, S.eave], [0, S.ridge], [-half, S.eave]], S.u0, S.u1, SHED_WALL);
    const over = 0.20, drop = (over * (S.ridge - S.eave)) / half, t = 0.12;
    m.extrude([
      [-half - over, S.eave - drop], [0, S.ridge], [half + over, S.eave - drop],
      [half + over, S.eave - drop + t], [0, S.ridge + t], [-half - over, S.eave - drop + t],
    ], S.u0 - 0.18, S.u1 + 0.18, SHED_ROOF, TRIM);
    m.at(0, gy, 0);
    for (const [u, v] of [[S.u0, S.v0], [S.u1, S.v0], [S.u0, S.v1], [S.u1, S.v1]]) {
      m.box(u, S.eave / 2, v, 0.12, S.eave, 0.12, IRON);
    }
    // White sectional roll-up garage door on the west gable end (u = S.u0).
    m.box(S.u0 - 0.03, 1.12, cv, 0.06, 2.24, 2.65, IRON);
    m.box(S.u0 - 0.055, 1.10, cv, 0.04, 2.12, 2.48, DOOR_WHITE);
    if (!this.low) {
      for (let py = 0.45; py < 2.0; py += 0.42) {
        m.box(S.u0 - 0.078, py, cv, 0.015, 0.025, 2.42, STEEL);
      }
    }
  }

  /** Rust-red corrugated steel shipping container standing beside the east storage shed. */
  private shippingContainer(m: Mesher): void {
    const C = CONTAINER, cu = (C.u0 + C.u1) / 2, cv = (C.v0 + C.v1) / 2;
    const gy = this.g(cu, cv), len = C.u1 - C.u0, dep = C.v1 - C.v0;
    const minCorner = Math.min(this.g(C.u0, C.v0), this.g(C.u1, C.v0), this.g(C.u0, C.v1), this.g(C.u1, C.v1));
    const under = Math.min(-0.45, minCorner - gy - 0.35);
    m.at(cu, gy, cv);
    // Container body seated down to the lowest downhill slope so no corner floats at 3x exaggeration.
    m.box(0, (C.height + under) / 2, 0, len, C.height - under, dep, CONTAINER_RUST);
    m.box(0, C.height + 0.03, 0, len + 0.06, 0.08, dep + 0.06, shade(CONTAINER_RUST, 0.84));
    // Corner posts and dark concrete blocking extending below the lowest corner.
    for (const [su, sv] of [[-len / 2, -dep / 2], [len / 2, -dep / 2], [-len / 2, dep / 2], [len / 2, dep / 2]]) {
      m.box(su, (C.height + under) / 2, sv, 0.12, C.height - under, 0.12, shade(CONTAINER_RUST, 0.78));
      m.box(su * 0.92, (0.04 + under) / 2, sv * 0.92, 0.34, 0.04 - under, 0.34, FOUNDATION);
    }
    if (!this.low) {
      for (const side of [-1, 1]) {
        for (let dv = -dep / 2 + 0.35; dv < dep / 2 - 0.25; dv += 0.48) {
          m.box(side * (len / 2 + 0.02), C.height / 2, dv, 0.04, C.height - 0.22, 0.10, shade(CONTAINER_RUST, 0.86));
        }
      }
      // Vertical steel locking bars on the north (-v) container end facing High Road.
      for (const du of [-0.45, -0.15, 0.15, 0.45]) {
        m.box(du, C.height / 2, -dep / 2 - 0.025, 0.04, C.height - 0.24, 0.04, STEEL);
      }
    }
  }

  /** Enclosed silver/white cargo box trailer parked near the east corner of the service garage. */
  private cargoTrailer(m: Mesher): void {
    const T = TRAILER, cu = (T.u0 + T.u1) / 2, cv = (T.v0 + T.v1) / 2;
    const gy = this.g(cu, cv), len = T.u1 - T.u0, wid = T.v1 - T.v0;
    const boxH = T.height - T.floor;
    m.at(cu, gy, cv);
    m.box(0.25, T.floor + boxH / 2, 0, len - 0.5, boxH, wid, TRAILER_BODY);
    m.box(0.25, T.height + 0.03, 0, len - 0.44, 0.06, wid + 0.04, TRAILER_TRIM);
    m.box(0.25, T.floor + 0.18, 0, len - 0.44, 0.34, wid + 0.04, shade(TRAILER_TRIM, 1.15));
    // A-frame hitch tongue & jack on the west (-u) front end.
    m.box(-len / 2 + 0.1, T.floor + 0.02, 0, 0.9, 0.09, 0.55, IRON);
    m.cyl(-len / 2 - 0.1, 0.22, 0, 0.04, 0.44, IRON, 'y', 6);
    // Wheels under side fenders.
    for (const side of [-1, 1]) {
      m.cyl(0.45, 0.32, side * (wid / 2 - 0.06), 0.32, 0.22, TIRE, 'z', 8);
    }
  }
}
