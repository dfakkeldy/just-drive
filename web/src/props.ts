import type { ContactBody } from './parked';
import type { FlightBounds } from './mail-flight';
import { entersMailbox, mailboxShape, mailboxDamage, type MailboxDamage } from './mailbox-rules';
import type { VehicleSpec } from './vehicle-spec';
import * as THREE from 'three';
import type { Terrain } from './terrain';

/** Candidate IDs retain the full hit test's original order. */
export interface MailCandidates { mail: readonly number[]; sites: readonly number[] }
export type MailContact = (index: number) => 'opening' | 'ground' | 'skip';
type Style = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
interface Position { x: number; y: number; heading: number }
interface Mailbox extends Position { style: Style; tilt: number; group: number | null; parcelBox: boolean }
interface Community extends Position { modules: number }
interface Pole extends Position { road: number; n: number; transformer: boolean; light: boolean }
interface ServiceDrop { building: number; road: number; n: number; x: number; y: number; height: number;
  ground: number | null; groundX: number; groundY: number }
interface PropsData { mailboxes: Mailbox[]; communityBoxes: Community[]; poles: Pole[]; serviceDrops: ServiceDrop[] }
interface WorldPosition { x: number; z: number; heading: number }
interface Part { key: string; matrix: THREE.Matrix4 }
interface Slot { mesh: THREE.InstancedMesh; index: number; local: THREE.Matrix4; idle: THREE.Matrix4; dent: boolean }
interface Motion { x: number; z: number; angle: number; down: boolean; damage: MailboxDamage; dx: number; dz: number; rock: number; contact: number; dirty: boolean }
interface MailTarget extends WorldPosition { flagUp?: boolean; served: boolean; motion: Motion }
interface SiteTarget extends WorldPosition { served: boolean; customers: number }
interface Pending { position: WorldPosition; tilt: number; slots: Slot[]; level: number; y: number; motion: Motion | null; mailIndex: number }
interface Wire { a: number; b?: number; drop?: ServiceDrop; levels: string; vertices: number[] }
interface Cell { x: number; z: number; mail: number[]; sites: number[]; poles: number[]; wires: Wire[];
  group: THREE.Group | null; pending: Pending[]; line: THREE.LineSegments | null; low: boolean }
interface Template { geometry: THREE.BufferGeometry; material: THREE.MeshLambertMaterial }
export const RAIL_PROP_RADII = { mailbox: .8, pole: .18, communityModule: .43, communityClear: 1 } as const;
const CELL = 256;
/** LOW (phone) range for the small parts: mailboxes, community boxes, insulators, transformers and lamps. A 1.3 m
 * mailbox is about 2 px tall at 500 m on a phone. Poles, crossarms and the wires keep the cell range (900 m). */
export const LOW_SMALL_RANGE = 500;
const TALL = new Set(['pole', 'crossarm']);
const rad = THREE.MathUtils.degToRad;

// Parse only the small, identity-free schema at the file boundary.
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid props record');
  return value as Record<string, unknown>;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid props number');
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid props boolean');
  return value;
}
function position(r: Record<string, unknown>): Position {
  return { x: number(r.x), y: number(r.y), heading: number(r.heading) };
}
function list(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('Invalid props list');
  return value.map(record);
}
function parse(data: unknown): PropsData {
  const d = record(data);
  if (d.crs !== 'EPSG:2961') throw new Error('Invalid props CRS');
  return {
    mailboxes: list(d.mailboxes).map((r) => {
      const style = number(r.style);
      if (style !== 0 && style !== 1 && style !== 2 && style !== 3 && style !== 4 && style !== 5 && style !== 6 && style !== 7) throw new Error('Invalid mailbox style');
      return { ...position(r), style, tilt: number(r.tilt), group: r.group === null ? null : number(r.group), parcelBox: boolean(r.parcelBox) };
    }),
    communityBoxes: list(d.communityBoxes).map((r) => {
      const modules = number(r.modules);
      if (!Number.isInteger(modules) || modules < 2 || modules > 4) throw new Error('Invalid community modules');
      return { ...position(r), modules };
    }),
    poles: list(d.poles).map((r) => ({ ...position(r), road: number(r.road), n: number(r.n), transformer: boolean(r.transformer), light: boolean(r.light) })),
    serviceDrops: list(d.serviceDrops ?? []).map((r) => ({ building: number(r.building), road: number(r.road), n: number(r.n),
      x: number(r.x), y: number(r.y), height: number(r.height), ground: r.ground === null ? null : number(r.ground),
      groundX: number(r.groundX), groundY: number(r.groundY) })),
  };
}

/** Procedural roadside props. Cell slots and mailbox IDs never change on camera movement. */
export class Props {
  readonly group = new THREE.Group();
  private readonly data: PropsData;
  readonly mail: MailTarget[];
  readonly sites: SiteTarget[];
  readonly totalCustomers: number;
  downCount = 0;
  mailRevision = 0;
  private readonly motions: Motion[] = [];
  private readonly animated: Pending[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly fall = new THREE.Matrix4();
  private readonly axis = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly cam = new THREE.Vector3();
  private readonly poles: WorldPosition[];
  private readonly cells = new Map<string, Cell>();
  private readonly templates = new Map<string, Template>();
  private readonly wireMaterial = new THREE.LineBasicMaterial({ color: 0x252322 });
  private readonly dummy = new THREE.Object3D();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly inverse = new THREE.Matrix4();
  private readonly entry = new THREE.Vector3();
  private readonly exit = new THREE.Vector3();
  private readonly aim = { x: 0, y: 0, z: 0, ground: false };
  private readonly dent = new THREE.Matrix4().makeTranslation(0, 1.05, 0)
    .multiply(new THREE.Matrix4().makeScale(1.12, .65, .9)).multiply(new THREE.Matrix4().makeTranslation(0, -1.05, 0));
  private nextUpdate = 0;

  /** Physical roadside objects that need a clear opening through a rail. */
  /** Every pole at its world place, with the bake's street-lamp and transformer marks (night.ts lights some). */
  get poleSites(): (WorldPosition & { light: boolean; transformer: boolean })[] {
    return this.poles.map((p, i) => ({ ...p, light: this.data.poles[i].light, transformer: this.data.poles[i].transformer }));
  }
  get railObstacles(): readonly (WorldPosition & { radius: number })[] {
    return [...this.mail.map(p => ({ ...p, radius: RAIL_PROP_RADII.mailbox })), ...this.sites.map((p, i) => ({ ...p, radius: this.data.communityBoxes[i].modules * RAIL_PROP_RADII.communityModule + RAIL_PROP_RADII.communityClear })), ...this.poles.map(p => ({ ...p, radius: RAIL_PROP_RADII.pole }))];
  }

  constructor(data: unknown, private readonly village: [number, number], private readonly terrain: Terrain, excludes?: (east: number, north: number) => boolean) {
    const parsed = parse(data);
    // New packs cannot put roadside clutter or mail targets inside these quiet places.
    // The cemetery check reports conflicts in the baked source; no coordinates are moved.
    const keep = (p: Position) => !excludes?.(p.x, p.y);
    this.data = { mailboxes: parsed.mailboxes.filter(keep), communityBoxes: parsed.communityBoxes.filter(keep), poles: parsed.poles.filter(keep), serviceDrops: parsed.serviceDrops };
    const world = (p: Position): WorldPosition => ({ x: p.x - village[0], z: village[1] - p.y, heading: p.heading });
    const frames = new Map<number, Motion>();
    this.mail = this.data.mailboxes.map((m) => {
      let motion = m.group === null ? undefined : frames.get(m.group);
      if (!motion) {
        motion = { x: m.x - village[0], z: village[1] - m.y, angle: 0, down: false, damage: 0, dx: 1, dz: 0, rock: 0, contact: 0, dirty: true };
        this.motions.push(motion);
        if (m.group !== null) frames.set(m.group, motion);
      }
      return { ...world(m), served: false, motion };
    });
    // Every member and its wooden frame rotate about the same base, including cell boundaries.
    for (const [id, motion] of frames) {
      let x = 0, z = 0, n = 0;
      this.mail.forEach((p, i) => { if (this.data.mailboxes[i].group === id) { x += p.x; z += p.z; n++; } });
      motion.x = x / n; motion.z = z / n;
    }
    this.sites = this.data.communityBoxes.map((p) => ({ ...world(p), served: false, customers: p.modules * 15 }));
    this.totalCustomers = this.mail.length + this.sites.reduce((sum, p) => sum + p.customers, 0);
    this.poles = this.data.poles.map(world);
    this.mail.forEach((p, i) => this.cell(p).mail.push(i));
    this.sites.forEach((p, i) => this.cell(p).sites.push(i));
    this.poles.forEach((p, i) => this.cell(p).poles.push(i));
    const runs = new Map<number, number[]>();
    this.data.poles.forEach((p, i) => {
      let run = runs.get(p.road);
      if (!run) runs.set(p.road, run = []);
      run.push(i);
    });
    for (const run of runs.values()) {
      run.sort((a, b) => this.data.poles[a].n - this.data.poles[b].n);
      for (let i = 1; i < run.length; i++) {
        const a = run[i - 1], b = run[i], p = this.poles[a], q = this.poles[b];
        if (Math.hypot(p.x - q.x, p.z - q.z) <= 80) this.cell(p).wires.push({ a, b, levels: '', vertices: [] });
      }
    }
    // References survive quiet-site filtering: a removed pole cannot reassign a drop to another pole.
    const poleByKey = new Map(this.data.poles.map((p, i) => [`${p.road}:${p.n}`, i]));
    for (const drop of this.data.serviceDrops) {
      const a = poleByKey.get(`${drop.road}:${drop.n}`);
      if (a !== undefined) this.cell(this.poles[a]).wires.push({ a, drop, levels: '', vertices: [] });
    }
    this.group.name = 'Roadside props';
  }

  /** Nearest rural mailbox in world metres. index is its permanent props.json index. */
  nearestMailbox(x: number, z: number, reach: number): { x: number; z: number; index: number } | null {
    let best = reach * reach, result: { x: number; z: number; index: number } | null = null;
    if (reach < 0) return null;
    for (let cz = Math.floor((z - reach) / CELL); cz <= Math.floor((z + reach) / CELL); cz++) {
      for (let cx = Math.floor((x - reach) / CELL); cx <= Math.floor((x + reach) / CELL); cx++) {
        for (const index of this.cells.get(`${cx},${cz}`)?.mail ?? []) {
          const p = this.mail[index], d = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d <= best) { best = d; result = { x: p.x, z: p.z, index }; }
        }
      }
    }
    return result;
  }

  /** Preserve original target order while excluding centres outside the entire possible preview corridor. */
  mailCandidates(bounds: FlightBounds): MailCandidates {
    const mail: number[] = [], sites: number[] = [];
    for (let i = 0; i < this.mail.length; i++) {
      const p = this.mail[i];
      if (p.x >= bounds.x0 && p.x <= bounds.x1 && p.z >= bounds.z0 && p.z <= bounds.z1) mail.push(i);
    }
    for (let i = 0; i < this.sites.length; i++) {
      const p = this.sites[i], reach = this.data.communityBoxes[i].modules * .43 + 2;
      if (p.x + reach >= bounds.x0 && p.x - reach <= bounds.x1 && p.z + reach >= bounds.z0 && p.z - reach <= bounds.z1) sites.push(i);
    }
    return { mail, sites };
  }

  /** Swept opening hit, or a community cabinet landing. Returns a stable target ID. */
  mailHit(ax: number, ay: number, az: number, bx: number, by: number, bz: number, landed: boolean, candidates?: MailCandidates, contact?: MailContact): number {
    for (let slot = 0, count = candidates?.mail.length ?? this.mail.length; slot < count; slot++) {
      const i = candidates ? candidates.mail[slot] : slot;
      const p = this.mail[i];
      const mode = contact?.(i) ?? (p.motion.down ? 'skip' : 'opening');
      if (mode === 'skip') continue;
      if (mode === 'ground') {
        if (landed && (p.x - bx) ** 2 + (p.z - bz) ** 2 <= 1) return i;
        continue;
      }
      if (p.x < Math.min(ax, bx) - 5 || p.x > Math.max(ax, bx) + 5 ||
        p.z < Math.min(az, bz) - 5 || p.z > Math.max(az, bz) + 5) continue;
      const ground = this.terrain.heightAt(p.x, p.z);
      if (ground === null) continue;
      this.mailboxMatrix(i, ground);
      this.inverse.copy(this.dummy.matrix).invert();
      this.entry.set(ax, ay, az).applyMatrix4(this.inverse);
      this.exit.set(bx, by, bz).applyMatrix4(this.inverse);
      if (entersMailbox(this.entry, this.exit, this.data.mailboxes[i].style)) return i;
    }
    if (landed) for (let slot = 0, count = candidates?.sites.length ?? this.sites.length; slot < count; slot++) {
      const i = candidates ? candidates.sites[slot] : slot;
      const p = this.sites[i], h = rad(p.heading);
      // Distance to the cabinet row, not only to the site's centre.
      const across = (bx - p.x) * -Math.cos(h) + (bz - p.z) * -Math.sin(h);
      const along = (bx - p.x) * Math.sin(h) - (bz - p.z) * Math.cos(h);
      const edge = Math.max(0, Math.abs(across) - this.data.communityBoxes[i].modules * .43);
      if (edge * edge + along * along <= 4) return this.mail.length + i;
    }
    return -1;
  }

  /** The preview aims at the same transformed opening that accepts the real piece. */
  mailAim(index: number, groundDrop = false): typeof this.aim | null {
    const p = this.mail[index], ground = this.terrain.heightAt(p.x, p.z);
    if (ground === null) return null;
    if (groundDrop) {
      this.aim.x = p.x; this.aim.y = ground + .08; this.aim.z = p.z; this.aim.ground = true;
      return this.aim;
    }
    const { height, depth } = mailboxShape(this.data.mailboxes[index].style);
    this.mailboxMatrix(index, ground);
    this.entry.set(0, 1.05 + height / 2, depth / 2 + .02).applyMatrix4(this.dummy.matrix);
    this.aim.x = this.entry.x; this.aim.y = this.entry.y; this.aim.z = this.entry.z; this.aim.ground = false;
    return this.aim;
  }

  private mailboxMatrix(index: number, ground: number): void {
    const p = this.mail[index];
    this.propMatrix(p, this.data.mailboxes[index].tilt, p.motion, ground);
    if (p.motion.damage >= 2) this.dummy.matrix.multiply(this.dent);
  }

  /** Returns new customers only. Repeated deliveries never increase the served count. */
  serve(index: number, preExisting = false): number {
    if (index < this.mail.length) {
      const p = this.mail[index];
      if ((p.motion.down && !preExisting) || p.served) return 0;
      p.served = true; p.motion.rock = .65; p.motion.dirty = true;
      return 1;
    }
    const p = this.sites[index - this.mail.length];
    if (p.served) return 0;
    p.served = true;
    return p.customers;
  }

  onKnock: ((index: number) => void) | null = null;

  resetShift(): void {
    this.mailRevision++;
    this.downCount = 0;
    for (const p of this.mail) { p.served = false; p.flagUp = undefined; }
    for (const p of this.sites) p.served = false;
    for (const m of this.motions) { m.down = false; m.damage = 0; m.angle = m.rock = m.contact = 0; m.dirty = true; }
  }

  knockMailbox(index: number, vx: number, vz: number, preExisting = false): number {
    const motion = this.mail[index].motion;
    if (motion.down) return 0;
    motion.down = true; motion.damage = 3; motion.rock = 0; motion.dirty = true; this.mailRevision++;
    const speed = Math.hypot(vx, vz);
    motion.dx = speed > .01 ? vx / speed : 1;
    motion.dz = speed > .01 ? vz / speed : 0;
    let count = 0;
    for (let i = 0; i < this.mail.length; i++) if (this.mail[i].motion === motion) {
      count++; if (!preExisting) this.onKnock?.(i);
    }
    this.downCount += count;
    return count;
  }

  /** Read-only scenery contacts for scripted cargo. Upright posts must not be knocked over by a script. */
  allowsFleetBody(body: ContactBody): boolean {
    const e = body.spec.envelope, rx = Math.cos(body.heading), rz = Math.sin(body.heading);
    const touches = (p: WorldPosition) => { const x = p.x - body.x, z = p.z - body.z;
      return Math.abs(x * rx + z * rz) <= e.sweepHalfWidth + .12 && Math.abs(x * rz - z * rx) <= e.sweepHalfLength + .12; };
    const reach = Math.hypot(e.sweepHalfWidth + .12, e.sweepHalfLength + .12);
    // The same cells already index every post. Gate sweeps must not scan the whole map per sample.
    for (let x = Math.floor((body.x - reach) / CELL); x <= Math.floor((body.x + reach) / CELL); x++)
      for (let z = Math.floor((body.z - reach) / CELL); z <= Math.floor((body.z + reach) / CELL); z++) {
        const cell = this.cells.get(`${x},${z}`); if (!cell) continue;
        for (const i of cell.poles) if (touches(this.poles[i])) return false;
        for (const i of cell.mail) if (!this.mail[i].motion.down && touches(this.mail[i])) return false;
        for (const i of cell.sites) if (touches(this.sites[i])) return false;
      }
    return true;
  }

  /** Sweep the active body between frames. Teleports do not mow down a route. */
  hitCar(x: number, z: number, heading: number, vx: number, vz: number, oldX: number, oldZ: number, spec: VehicleSpec): number {
    const travel = Math.hypot(x - oldX, z - oldZ), steps = travel < 30 ? Math.max(1, Math.ceil(travel / .4)) : 1;
    const rx = Math.cos(heading), rz = Math.sin(heading), speed = Math.hypot(vx, vz);
    let factor = 1;
    for (let i = 0; i < this.mail.length; i++) {
      const p = this.mail[i], m = p.motion;
      if (m.down || Math.abs(p.x - x) > 5 + Math.min(travel, 30) || Math.abs(p.z - z) > 5 + Math.min(travel, 30)) continue;
      let touched = false;
      for (let j = 1; j <= steps; j++) {
        const t = j / steps, px = p.x - (x - (x - oldX) * (1 - t)), pz = p.z - (z - (z - oldZ) * (1 - t));
        if (Math.abs(px * rx + pz * rz) <= spec.envelope.sweepHalfWidth && Math.abs(px * rz - pz * rx) <= spec.envelope.sweepHalfLength) { touched = true; break; }
      }
      if (!touched) continue;
      const damage = mailboxDamage(speed);
      if (damage === 3) {
        this.knockMailbox(i, vx, vz);
        factor *= .91;
      } else if (damage > m.damage) {
        m.damage = damage; m.angle = damage === 2 ? .30 : .14;
        m.dx = speed > .01 ? vx / speed : 1; m.dz = speed > .01 ? vz / speed : 0;
        m.dirty = true; this.mailRevision++;
      }
      if (!m.down && m.contact <= 0) m.rock = 1;
      m.contact = .6;
    }
    return factor;
  }

  private paint(item: Pending): void {
    if (item.level < 6) return;
    this.propMatrix(item.position, item.tilt, item.motion, item.y);
    const target = item.mailIndex >= 0 ? this.mail[item.mailIndex] : null;
    const served = target ? target.flagUp ?? target.served : false;
    for (const slot of item.slots) {
      this.matrix.copy(this.dummy.matrix);
      if (slot.dent && item.motion && item.motion.damage >= 2) this.matrix.multiply(this.dent);
      this.matrix.multiply(served ? slot.local : slot.idle);
      slot.mesh.setMatrixAt(slot.index, this.matrix);
      slot.mesh.instanceMatrix.needsUpdate = true;
      slot.mesh.boundingSphere = null;
    }
  }

  private propMatrix(p: WorldPosition, tilt: number, m: Motion | null, y: number): void {
    this.dummy.position.set(p.x, y, p.z);
    this.dummy.rotation.set(0, Math.PI - rad(p.heading), rad(tilt), 'YXZ');
    this.dummy.scale.set(1, 1, 1);
    this.dummy.updateMatrix();
    if (m) {
      const angle = m.angle + Math.sin(m.rock * 24) * m.rock * .13;
      this.axis.set(m.dz, 0, -m.dx);
      this.rotation.setFromAxisAngle(this.axis, angle);
      const ground = this.terrain.heightAt(m.x, m.z) ?? y;
      this.fall.makeRotationFromQuaternion(this.rotation);
      this.fall.setPosition(m.x, ground, m.z);
      this.matrix.makeTranslation(-m.x, -ground, -m.z);
      this.fall.multiply(this.matrix);
      this.dummy.matrix.premultiply(this.fall);
    }
  }

  update(camera: THREE.Camera, dt = 0): void {
    for (const m of this.motions) {
      if (m.rock > 0 || m.down && m.angle < Math.PI * .49) this.mailRevision++;
      m.dirty = m.dirty || m.rock > 0 || m.down && m.angle < Math.PI * .49;
      m.contact = Math.max(0, m.contact - dt);
      m.rock = Math.max(0, m.rock - dt * 1.8);
      if (m.down) m.angle = Math.min(Math.PI * .49, m.angle + dt * 3.8);
    }
    for (const item of this.animated) if (item.motion?.dirty) this.paint(item);
    for (const m of this.motions) m.dirty = false;
    const now = performance.now();
    if (now < this.nextUpdate) return;
    this.nextUpdate = now + 350;
    const cam = camera.getWorldPosition(this.cam);
    for (const c of this.cells.values()) {
      // Distance to the cell square, so boundary props appear within 600 m too.
      const d = Math.hypot(Math.max(0, Math.abs(cam.x - c.x) - CELL / 2), Math.max(0, Math.abs(cam.z - c.z) - CELL / 2));
      const near = !this.terrain.low || d < LOW_SMALL_RANGE;
      if (c.group) { c.group.visible = d < 900; this.showSmall(c, near); }
      if (d > 600) continue;
      if (!c.group) {
        const positions = [...c.mail.map((i) => this.mail[i]), ...c.sites.map((i) => this.sites[i]), ...c.poles.map((i) => this.poles[i])];
        if (!positions.some((p) => (this.terrain.surfaceAt(p.x, p.z)?.level ?? -1) >= 6 && this.terrain.heightAt(p.x, p.z) !== null)) continue;
        this.buildCell(c); this.showSmall(c, near);
      }
      for (const item of c.pending) {
        const p = item.position, level = this.terrain.surfaceAt(p.x, p.z)?.level ?? -1;
        // Coarse horizon samples can differ by metres. Wait for the local ground.
        if (level < 6 || level <= item.level) continue;
        const y = this.terrain.heightAt(p.x, p.z);
        if (y === null) continue;
        item.level = level;
        item.y = y;
        this.paint(item);
      }
      this.updateWires(c);
    }
  }

  private cell(p: WorldPosition): Cell {
    const x = Math.floor(p.x / CELL), z = Math.floor(p.z / CELL), key = `${x},${z}`;
    let c = this.cells.get(key);
    if (!c) {
      c = { x: (x + .5) * CELL, z: (z + .5) * CELL, mail: [], sites: [], poles: [], wires: [], group: null, pending: [], line: null, low: this.terrain.low };
      this.cells.set(key, c);
    }
    return c;
  }

  private template(key: string, color: number, geometry?: THREE.BufferGeometry): void {
    if (!this.templates.has(key)) this.templates.set(key, {
      geometry: geometry ?? new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshLambertMaterial({ color }),
    });
  }

  private part(parts: Part[], key: string, color: number, x: number, y: number, z: number,
    sx: number, sy: number, sz: number, geometry?: THREE.BufferGeometry, rz = 0): void {
    this.template(key, color, geometry);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rz), new THREE.Vector3(sx, sy, sz));
    parts.push({ key, matrix: m });
  }

  private arch(key: string): THREE.BufferGeometry | undefined {
    if (this.templates.has(key)) return undefined;
    const s = new THREE.Shape();
    s.moveTo(-.5, -.5); s.lineTo(.5, -.5); s.lineTo(.5, 0);
    s.absarc(0, 0, .5, 0, Math.PI, false); s.lineTo(-.5, -.5);
    const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 8 });
    g.translate(0, 0, -.5);
    return g;
  }

  private mailbox(i: number, shared: boolean): Part[] {
    const m = this.data.mailboxes[i], parts: Part[] = [];
    const colors = [0x326740, 0x272b2c, 0xd2cec0, 0x797b78, 0x485d50, 0x92744b, 0xd9d2b7, 0x485d50];
    if (!shared && m.style >= 6) {
      if (m.style === 6) {
        // Curved generic pedestal, built once and instanced like the other parts.
        const key = 'curved-pedestal';
        const curve = !this.templates.has(key) ? new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 0, -.23), new THREE.Vector3(0, .38, -.27),
          new THREE.Vector3(0, .78, -.18), new THREE.Vector3(0, 1.05, 0)]) : null;
        this.part(parts, key, 0x4b5050, 0, 0, 0, 1, 1, 1,
          curve ? new THREE.TubeGeometry(curve, 8, .045, 5, false) : undefined);
      } else {
        this.part(parts, 'plastic-pedestal', 0x485d50, 0, .53, -.08, .17, 1.06, .24);
        this.part(parts, 'plastic-foot', 0x485d50, 0, .07, -.08, .38, .14, .42);
      }
    } else if (!shared) {
      const pipe = m.style === 2;
      this.part(parts, pipe ? 'pipe' : 'wood', pipe ? 0x7d8079 : 0x786044, 0, .53, -.05,
        pipe ? .055 : .105, 1.16, pipe ? .055 : .105,
        pipe && !this.templates.has('pipe') ? new THREE.CylinderGeometry(.5, .5, 1, 8) : undefined);
      this.part(parts, 'wood', 0x786044, 0, 1.02, 0, .32, .075, .52);
    }
    const { width, height, depth } = mailboxShape(m.style);
    const key = `box-${m.style}`;
    this.part(parts, key, colors[m.style], 0, 1.05 + height / 2, 0, width, height, depth,
      m.style === 5 || m.style === 6 ? undefined : this.arch(key));
    // A separate inset door and latch make the road-facing end readable at close range.
    const door = `door-${m.style}`;
    this.part(parts, door, colors[m.style], 0, 1.05 + height / 2, depth / 2 + .006,
      width * .87, height * .87, .013, m.style === 5 || m.style === 6 ? undefined : this.arch(door));
    this.part(parts, 'latch', 0xa7a393, 0, 1.05 + height * .63, depth / 2 + .018, .06, .022, .025);
    this.part(parts, 'flag', 0xa33326, width / 2 + .022, 1.05 + height * .75, .01, .018, .19, .025);
    this.part(parts, 'flag', 0xa33326, width / 2 + .022, 1.05 + height * .75 + .08, .05, .022, .045, .10);
    if (m.style === 3) this.part(parts, 'rust', 0x77503c, -.06, 1.09, .05, .07, .025, .18, undefined, .15);
    if (m.style === 6) {
      const gableKey = 'house-mail-gable';
      let gable: THREE.ExtrudeGeometry | undefined;
      if (!this.templates.has(gableKey)) {
        const shape = new THREE.Shape();
        shape.moveTo(-.5, 0); shape.lineTo(.5, 0); shape.lineTo(0, 1); shape.closePath();
        gable = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
        gable.translate(0, 0, -.5);
      }
      this.part(parts, gableKey, colors[m.style], 0, 1.05 + height, 0, width, .12, depth, gable);
      for (const side of [-1, 1]) this.part(parts, 'house-mail-roof', 0x604c36, side * width / 4,
        1.05 + height + .065, 0, width * .65, .035, depth + .05, undefined, -side * Math.PI / 5);
      this.part(parts, 'house-mail-window', 0x3b4a4d, -.07, 1.05 + height * .60, depth / 2 + .018, .055, .07, .02);
    }
    if (m.style === 5) {
      this.part(parts, 'wood-roof', 0x604c36, 0, 1.05 + height + .025, 0, width + .055, .05, depth + .05);
    }
    if (m.parcelBox) {
      this.part(parts, 'chest', 0x8e7047, .52, .24, -.67, .65, .48, .46);
      this.part(parts, 'wood-roof', 0x604c36, .52, .50, -.67, .69, .055, .50);
      this.part(parts, 'latch', 0xa7a393, .52, .41, -.432, .05, .13, .02);
    }
    return parts;
  }

  private community(i: number): Part[] {
    const parts: Part[] = [], n = this.data.communityBoxes[i].modules;
    this.part(parts, 'pad', 0x929084, 0, .07, 0, n * .86 + .35, .18, 1.10);
    for (let j = 0; j < n; j++) {
      const x = (j - (n - 1) / 2) * .86;
      this.part(parts, 'cabinet', 0x746f61, x, 1.02, 0, .8, 1.7, .5);
      this.part(parts, 'cap', 0x5b5b55, x, 1.88, 0, .84, .055, .55);
      // Physical seams, muted door faces and lock plates. No text or branding.
      for (let row = 0; row < 5; row++) for (let col = 0; col < 3; col++) {
        const xx = x + (col - 1) * .25, yy = .79 + row * .212;
        this.part(parts, 'small-door', 0x99968a, xx, yy, .258, .234, .194, .018);
        this.part(parts, 'lock', 0x454846, xx + .073, yy, .271, .022, .022, .014);
      }
      for (let col = 0; col < 2; col++) {
        const xx = x + (col - .5) * .375;
        this.part(parts, 'parcel-door', 0x8c887b, xx, .46, .258, .35, .40, .018);
        this.part(parts, 'lock', 0x454846, xx + .11, .46, .271, .025, .04, .014);
      }
    }
    return parts;
  }

  private pole(i: number): Part[] {
    const p = this.data.poles[i], parts: Part[] = [];
    this.part(parts, 'pole', 0x766046, 0, 4.65, 0, 1, 1, 1,
      !this.templates.has('pole') ? new THREE.CylinderGeometry(.085, .14, 9.7, 8) : undefined);
    this.part(parts, 'crossarm', 0x89714d, 0, 8.6, 0, 2.1, .14, .16);
    for (const x of [-.85, 0, .85]) this.part(parts, 'insulator', 0xaaa99b, x, 8.81, 0, .095, .22, .095);
    this.part(parts, 'crossarm', 0x89714d, .23, 6.5, 0, .5, .09, .11);
    this.part(parts, 'insulator', 0xaaa99b, .38, 6.64, 0, .08, .14, .08);
    if (p.transformer) {
      this.part(parts, 'transformer', 0x989d96, .33, 7.3, 0, .42, .75, .42,
        !this.templates.has('transformer') ? new THREE.CylinderGeometry(.5, .5, 1, 12) : undefined);
      this.part(parts, 'can-lid', 0x686f6c, .33, 7.69, 0, .46, .055, .46,
        !this.templates.has('can-lid') ? new THREE.CylinderGeometry(.5, .5, 1, 12) : undefined);
    }
    if (p.light) {
      this.part(parts, 'lamp-arm', 0x797d77, 0, 7.9, .75, .07, .07, 1.5);
      this.part(parts, 'lamp', 0xc6bd97, 0, 7.82, 1.5, .25, .13, .40);
    }
    return parts;
  }

  /** Small parts on or off (see LOW_SMALL_RANGE); poles, crossarms and the wire line stay with the cell. */
  private showSmall(c: Cell, near: boolean): void {
    for (const mesh of c.group!.children) if (mesh !== c.line && !TALL.has(mesh.name)) mesh.visible = near;
  }
  private buildCell(c: Cell): void {
    c.group = new THREE.Group();
    c.group.name = `Props cell ${c.x},${c.z}`;
    this.group.add(c.group);
    const batches = new Map<string, { item: Pending; part: Part }[]>();
    const add = (p: WorldPosition, tilt: number, parts: Part[], motion: Motion | null = null, mailIndex = -1) => {
      const item: Pending = { position: p, tilt, slots: [], level: -1, y: 0, motion, mailIndex };
      if (motion) this.animated.push(item);
      c.pending.push(item);
      for (const part of parts) {
        let batch = batches.get(part.key);
        if (!batch) batches.set(part.key, batch = []);
        batch.push({ item, part });
      }
    };
    for (const i of c.mail) {
      const m = this.data.mailboxes[i];
      add(this.mail[i], m.tilt, this.mailbox(i, m.group !== null), this.mail[i].motion, i);
    }
    // Shared frames belong to the first member's cell, even across a cell boundary.
    const groups = new Set(c.mail.map((i) => this.data.mailboxes[i].group).filter((g) => g !== null));
    for (const id of groups) {
      const members = this.data.mailboxes.flatMap((m, i) => m.group === id ? [i] : []);
      if (!c.mail.includes(members[0])) continue;
      const a = this.mail[members[0]], b = this.mail[members[members.length - 1]];
      const centre = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, heading: a.heading };
      const parts: Part[] = [], span = Math.hypot(a.x - b.x, a.z - b.z) + .45;
      this.part(parts, 'wood', 0x786044, 0, 1.005, 0, span, .09, .045);
      for (const x of [-Math.max(.22, span / 2 - .16), Math.max(.22, span / 2 - .16)]) {
        this.part(parts, 'wood', 0x786044, x, .50, 0, .11, 1.13, .11);
      }
      add(centre, 0, parts, this.mail[members[0]].motion);
    }
    for (const i of c.sites) add(this.sites[i], 0, this.community(i));
    for (const i of c.poles) add(this.poles[i], 0, this.pole(i));
    for (const [key, batch] of batches) {
      const t = this.templates.get(key)!;
      const mesh = new THREE.InstancedMesh(t.geometry, t.material, batch.length);
      mesh.name = key;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      batch.forEach(({ item, part }, index) => {
        mesh.setMatrixAt(index, this.zero);
        let idle = part.matrix;
        if (key === 'flag') {
          const hinge = new THREE.Matrix4().makeTranslation(0, 1.16, .01);
          hinge.multiply(new THREE.Matrix4().makeRotationX(Math.PI));
          hinge.multiply(new THREE.Matrix4().makeTranslation(0, -1.16, -.01));
          idle = new THREE.Matrix4().multiplyMatrices(hinge, part.matrix);
        }
        item.slots.push({ mesh, index, local: part.matrix, idle,
          dent: item.mailIndex >= 0 && part.matrix.elements[13] > 1.05 && key !== 'wood' });
      });
      c.group.add(mesh);
    }
  }

  private updateWires(c: Cell): void {
    if (!c.group) return;
    let changed = c.low !== this.terrain.low;
    c.low = this.terrain.low;
    const offset = (p: WorldPosition, cross: number) => {
      const h = rad(p.heading);
      return [p.x - Math.cos(h) * cross, p.z - Math.sin(h) * cross];
    };
    for (const w of c.wires) {
      const a = this.poles[w.a], drop = w.drop;
      if (drop && c.low) {
        if (w.vertices.length) { w.vertices = []; w.levels = ''; changed = true; }
        continue;
      }
      const b = drop ? { x: drop.x - this.village[0], z: this.village[1] - drop.y, heading: 0 } : this.poles[w.b!];
      const ground = drop ? { x: drop.groundX - this.village[0], z: this.village[1] - drop.groundY } : b;
      const la = this.terrain.surfaceAt(a.x, a.z)?.level ?? -1;
      const lb = this.terrain.surfaceAt(ground.x, ground.z)?.level ?? -1;
      const levels = `${la},${lb},${this.terrain.exag},${this.terrain.seaLevel}`;
      if (la < 6 || lb < 6 || levels === w.levels) continue;
      const ya = this.terrain.heightAt(a.x, a.z);
      // Surveyed buildings use a fixed ground datum; the hand-built church uses its model origin's terrain.
      const yb = drop && drop.ground !== null
        ? this.terrain.seaLevel + (drop.ground - this.terrain.seaLevel) * this.terrain.exag
        : this.terrain.heightAt(ground.x, ground.z);
      if (ya === null || yb === null) continue;
      const vertices: number[] = [], length = Math.hypot(b.x - a.x, b.z - a.z);
      const wires = drop ? [[.38, 6.71, drop.height]] : [[-.85, 8.92, 8.92], [0, 8.92, 8.92], [.85, 8.92, 8.92], [.38, 6.71, 6.71]];
      for (const [cross, ah, bh] of wires) {
        const [ax, az] = offset(a, cross), [bx, bz] = drop ? [b.x, b.z] : offset(b, cross);
        const point = (t: number) => [ax + (bx - ax) * t,
          ya + ah + (yb + bh - ya - ah) * t - 4 * t * (1 - t) * Math.min(drop ? .65 : 1.25, length * .018),
          az + (bz - az) * t];
        for (let segment = 0; segment < 10; segment++) vertices.push(...point(segment / 10), ...point((segment + 1) / 10));
      }
      w.vertices = vertices; w.levels = levels; changed = true;
    }
    if (!changed) return;
    if (c.line) { c.group.remove(c.line); c.line.geometry.dispose(); c.line = null; }
    const vertices = c.wires.flatMap(w => w.vertices);
    if (!vertices.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    c.line = new THREE.LineSegments(geometry, this.wireMaterial);
    c.line.name = 'Sagging wires and service drops';
    c.group.add(c.line);
  }
}
