import * as THREE from 'three';
import { JUMP_LOAD } from './jump-rules';
import type { Building } from './buildings';
import { ArchCulvert } from './culvert';
import { ParkedVehicles, pushOut, type Parked, type Solid } from './parked';
import type { Terrain } from './terrain';
import type { Vehicle } from './vehicle';
import type { VehicleSpec } from './vehicle-spec';
import type { VehiclePlacement } from './vehicle';
import type { ContactBody, Pushable } from './parked';
type YardBody = Pushable & { y: number; spec: VehicleSpec; car: { root: { position: { x: number; z: number } } } };

import { buildYard, DERBY, watcher, type Ctx, type LooseKind, type LooseSpec, type YardSigns } from './yard-build';
import { letters, Mesher, seeded, SignAtlas, type RGB } from './yard-kit';
import { DOOR, MAILBOX, MAILBOX_BAKED, SLIP_RAMP, type YardSite } from './yard-site';

/** One loose piece: where it belongs, where it is now, and how it is moving. Positions are yard metres (u, height, v). */
interface Piece {
  spec: LooseSpec; mesh: THREE.InstancedMesh | THREE.Mesh; slot: number;
  home: THREE.Vector3; homeYaw: number;
  p: THREE.Vector3; yaw: number; vel: THREE.Vector3; spin: number;
  tip: number; tipU: number; tipV: number;   // how far it has fallen over (0 to 1), and about which level axis
  moving: boolean; cool: number; halfLen: number; rad: number;
}

const DEFAULT_SIZE: Record<LooseKind, [number, number, number]> = { box: [1, 1, 1], pipe: [6, 0.3, 0.3], drum: [0.6, 0.88, 0.6], cone: [0.4, 0.72, 0.4], tyre: [1.04, 0.3, 1.04], hpile: [7, 0.31, 0.31], frame: [1.5, 1.9, 1.5], wreck: [4.4, 1.4, 1.8] };
const LEAVE = 250;

/**
 * The works yard: the model, the full staff lot, the derby ring behind the shop, and the loop in which the car knocks
 * things over and the crew puts them back. Built when the car comes near and the ground there has loaded.
 */
export class Yard {
  readonly group = new THREE.Group();
  coupledBodies: (() => readonly ContactBody[]) | null = null;
  private local = new THREE.Group();   // the yard's own axes: x is u, z is v
  private solids: Solid[] = [];
  private rampBack: Solid[] = [];
  private jumpLoad: Solid[] = [];
  private pieces: Piece[] = [];
  private parked: ParkedVehicles | null = null;
  private signs: YardSigns | null = null;
  private stageNodes: { from: number; node: THREE.Object3D }[] = [];
  private built = false; private fine = 0; private dirty = false; private away = false;
  private material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private dummy = new THREE.Object3D(); private q = new THREE.Quaternion(); private axis = new THREE.Vector3();
  private probes: { x: number; z: number }[];
  /** How many times the crew has tidied up this session, and how many wrecks the car has hit. */
  resets = 0; smashes = 0;
  /** Every physical contact, including a stationary push out; the jump judge reads this monotonic serial. */
  contacts = 0;
  /** Triangles in the static model, for a look at the cost. */
  triangles = 0;

  constructor(readonly site: YardSite, private terrain: Terrain, private low: boolean) {
    const o = site.origin;
    this.local.position.set(o.x, 0, o.z);
    this.local.rotation.y = site.yaw;
    this.group.add(this.local);
    this.group.visible = false;
    this.probes = ([[0, 0], [-100, -20], [-95, 120], [120, 0], [250, 60], [40, -70], [-18, 47]] as [number, number][]).map(([u, v]) => site.world(u, v));
  }

  /** The measured boxes that the yard's own model replaces. In closed mode every box stays. */
  static buildings(list: Building[], site: YardSite, village: [number, number]): Building[] {
    if (site.mode === 'closed') return list;
    const [vx, vy] = village;
    return list.filter((b) => { const { u, v } = site.local(b.x - vx, vy - b.y); return !(u > -55 && u < 105 && Math.abs(v) < 26); });
  }

  /** The yard's mailbox moves from the highway to the shop door, so a delivery means driving into the lot. */
  static props<T>(json: T, site: YardSite, village: [number, number]): T {
    if (site.mode === 'closed') return json;
    const boxes = (json as { mailboxes?: { x: number; y: number; heading: number }[] }).mailboxes ?? [];
    const baked = site.world(MAILBOX_BAKED.u, MAILBOX_BAKED.v), to = site.world(MAILBOX.u, MAILBOX.v);
    const box = boxes.find((b) => Math.hypot(b.x - village[0] - baked.x, village[1] - b.y - baked.z) < 12);
    if (box) { box.x = to.x + village[0]; box.y = village[1] - to.z; box.heading = (THREE.MathUtils.radToDeg(site.heading(0, -1)) + 360) % 360; }
    return json;
  }

  private g = (u: number, v: number): number => { const w = this.site.world(u, v); return this.terrain.heightAt(w.x, w.z) ?? 0; };

  private build(): void {
    this.site.rampBase = null;
    for (const child of [...this.local.children, ...this.group.children.filter((c) => c !== this.local)]) {
      child.parent?.remove(child);
      // Free what the last build made: shapes, its own materials and the sign picture. The shared material stays.
      child.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        for (const mat of !mesh.material ? [] : Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (mat === this.material) continue;
          (mat as THREE.MeshLambertMaterial).map?.dispose();
          mat.dispose();
        }
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
    }
    this.solids = []; this.rampBack = []; this.jumpLoad = []; this.pieces = []; this.stageNodes = []; this.parked = null; this.signs = null;
    const site = this.site, m = new Mesher(), s = new Mesher(), d = new Mesher(), atlas = new SignAtlas(1024, 1536);
    const signMaterial = new THREE.MeshLambertMaterial({ map: atlas.texture, side: THREE.DoubleSide });
    const add = (mesher: Mesher, material: THREE.Material, parent: THREE.Object3D = this.local) => {
      const mesh = new THREE.Mesh(mesher.geometry(), material);
      parent.add(mesh);
      return mesh;
    };
    const solid = (u: number, v: number, half: number, halfWidth: number, yaw = 0) => {
      const w = site.world(u, v);
      this.solids.push({ x: w.x, z: w.z, half, halfWidth, heading: site.heading(Math.cos(yaw), -Math.sin(yaw)) });
    };
    if (site.mode === 'closed') {
      // The owners said no: a barrier across the entrance, and nothing of theirs behind it.
      const y = this.g(41, -78.5);
      m.at(41, y, -78.5);
      for (let i = 0; i < 10; i++) for (const h of [0.55, 1.0]) m.box(-9.5 + i * 2.1 + 0.05, h, 0, 2.1, 0.24, 0.06, (i + (h > 0.8 ? 1 : 0)) % 2 ? [0.62, 0.08, 0.05] : [0.85, 0.84, 0.78]);
      for (let i = 0; i <= 5; i++) { m.box(-10.4 + i * 4.16, 0.65, 0.09, 0.12, 1.3, 0.12, [0.2, 0.17, 0.13]); m.box(-10.4 + i * 4.16, 0.04, 0.09, 0.3, 0.08, 1.1, [0.2, 0.17, 0.13]); }
      for (const side of [-1, 1]) { m.at(41 + side * 11.5, this.g(41 + side * 11.5, -78.5), -78.5); for (let l = 0; l < 2; l++) m.box(0, 0.42 + l * 0.82, 0, 0.9, 0.8, 2.6, [0.52, 0.51, 0.47]); }
      solid(41, -78.5, 12.2, 0.5);
      add(m, this.material);
      this.triangles = m.triangles;
      return;
    }
    const parkedList: Parked[] = [], specs: LooseSpec[] = [];
    const r = SLIP_RAMP, back = site.world(r.u - r.lead - r.length + 0.2, r.v);
    const rampBase = this.g(r.u, r.v);
    this.rampBack.push({ ...back, half: 0.35, halfWidth: r.width / 2, heading: site.heading(1, 0) });
    const load = JUMP_LOAD, loadCentre = site.world(r.u - load.near - load.length / 2, r.v);
    this.jumpLoad.push({ ...loadCentre, half: load.length / 2, halfWidth: load.width / 2, heading: site.heading(-1, 0) });
    let stacks = 0;
    const ctx: Ctx = {
      m, s, d, atlas, low: this.low, mode: site.mode, rampBase, rnd: seeded(1964), g: this.g, solid,
      loose: (spec) => {
        const size = spec.size ?? DEFAULT_SIZE[spec.kind];
        specs.push({ lift: 0, yaw: 0, colour: 0xffffff, stack: 0, mass: 1, tips: false, stage: 0, ...spec, size });
      },
      stack: () => ++stacks,
      park: (list) => parkedList.push(...list),
      culvert: (u, v, du, dv, units) => {
        const w = site.world(u, v), piece = new ArchCulvert(w.x, w.z, site.heading(du, dv), units, (x, z) => this.terrain.heightAt(x, z), this.low);
        piece.seat(); this.solids.push(...piece.solids); this.group.add(piece.group);
      },
      world: (u, v) => site.world(u, v),
      heading: (du, dv) => site.heading(du, dv),
    };
    this.signs = buildYard(ctx, this.material);
    add(m, this.material);
    add(s, signMaterial);
    add(d, new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, depthWrite: false }));
    this.triangles = m.triangles;
    console.info(`[yard] ${m.triangles} triangles, ${specs.length} loose pieces, ${parkedList.length} parked vehicles, ${this.solids.length} solids`);

    // The door board and the two watchers arrive only after the crew has had to tidy up.
    const staged = (from: number, fill: (mm: Mesher, ss: Mesher) => void) => {
      const mm = new Mesher(), ss = new Mesher(), node = new THREE.Group();
      fill(mm, ss);
      if (mm.pos.length) add(mm, this.material, node);
      if (ss.pos.length) add(ss, signMaterial, node);
      node.visible = this.resets >= from;
      this.local.add(node);
      this.stageNodes.push({ from, node });
    };
    const bu = DOOR.u - 2.5, bv = DOOR.v - 0.1, by = this.g(bu, bv);
    staged(1, (mm, ss) => {
      mm.at(bu, by, bv, Math.PI);
      for (const side of [-1, 1]) mm.box(side * 0.8, 1.2, -0.06, 0.08, 2.4, 0.08, [0.3, 0.3, 0.3]);
      mm.box(0, 1.85, -0.02, 1.9, 1.0, 0.04, [0.9, 0.9, 0.86]);
      ss.at(bu, by + 1.85, bv, Math.PI); ss.plate(1.8, 0.9, this.signs!.incident.cell);
    });
    const watcherCtx: Ctx = { ...ctx, rnd: seeded(7) };
    staged(3, (mm) => watcher(watcherCtx, DOOR.u + 1.9, DOOR.v - 0.5, Math.PI, 'folded', mm));
    staged(4, (mm) => watcher(watcherCtx, DOOR.u + 2.8, DOOR.v - 0.7, Math.PI + 0.3, 'clipboard', mm));
    this.paintBoards();

    // Loose pieces: one instanced mesh per kind.
    const shapes = this.looseShapes();
    for (const kind of Object.keys(shapes) as LooseKind[]) {
      const mine = specs.filter((sp) => sp.kind === kind);
      if (!mine.length) continue;
      const mesh = new THREE.InstancedMesh(shapes[kind]!, this.material, mine.length);
      mesh.frustumCulled = false;
      mine.forEach((sp, i) => { mesh.setColorAt(i, new THREE.Color(sp.colour)); this.pieces.push(this.piece(sp, mesh, i)); });
      this.local.add(mesh);
    }
    for (const sp of specs) if (sp.kind === 'wreck' && sp.mesh) {
      sp.mesh.matrixAutoUpdate = false;
      this.local.add(sp.mesh);
      this.pieces.push(this.piece(sp, sp.mesh, 0));
    }
    for (const p of this.pieces) this.show(p);
    this.flush();

    this.parked = new ParkedVehicles(parkedList, (x, z) => this.terrain.heightAt(x, z));
    this.parked.seat();
    this.solids.push(...this.parked.solids);
    this.group.add(this.parked.group);
    site.rampBase = rampBase;
  }

  private looseShapes(): Partial<Record<LooseKind, THREE.BufferGeometry>> {
    const W: RGB = [1, 1, 1], seg = this.low ? 6 : 8;
    const make = (fill: (m: Mesher) => void) => { const m = new Mesher(); fill(m); return m.geometry(); };
    return {
      box: make((m) => m.box(0, 0.5, 0, 1, 1, 1, W, false)),
      pipe: make((m) => m.cyl(0, 0.5, 0, 0.5, 1, W, 'x', seg, 0.5, [0.3, 0.3, 0.3])),
      drum: make((m) => { m.cyl(0, 0.44, 0, 0.29, 0.88, W, 'y', seg + 2); for (const y of [0.29, 0.59]) m.cyl(0, y, 0, 0.3, 0.035, [0.7, 0.7, 0.7], 'y', seg + 2, 0.3, null); }),
      cone: make((m) => { m.box(0, 0.015, 0, 0.38, 0.03, 0.38, [0.05, 0.05, 0.05], false); m.cyl(0, 0.37, 0, 0.14, 0.68, [0.95, 0.30, 0.02], 'y', 7, 0.03); m.cyl(0, 0.42, 0, 0.105, 0.13, [0.9, 0.9, 0.86], 'y', 7, 0.082, null); }),
      tyre: make((m) => { m.cyl(0, 0.15, 0, 0.52, 0.3, [0.035, 0.035, 0.038], 'y', seg + 2); m.cyl(0, 0.15, 0, 0.27, 0.31, [0.012, 0.012, 0.012], 'y', seg); }),
      hpile: make((m) => {
        const a = 0.155, t = 0.022;
        m.at(0, 0, 0, -Math.PI / 2);
        m.extrude([[-a, 0], [a, 0], [a, t], [t / 2, t], [t / 2, 2 * a - t], [a, 2 * a - t], [a, 2 * a], [-a, 2 * a], [-a, 2 * a - t], [-t / 2, 2 * a - t], [-t / 2, t], [-a, t]], -0.5, 0.5, W, [0.5, 0.5, 0.5]);
      }),
      frame: make((m) => { for (const side of [-1, 1]) m.box(0, 0.95, side * 0.75, 0.05, 1.9, 0.05, W, false); for (const y of [0.4, 1.0, 1.6]) m.box(0, y, 0, 0.04, 0.04, 1.5, W, false); }),
    };
  }

  private piece(spec: LooseSpec, mesh: THREE.InstancedMesh | THREE.Mesh, slot: number): Piece {
    const home = new THREE.Vector3(spec.u, this.g(spec.u, spec.v) + spec.lift, spec.v);
    const rad = spec.kind === 'frame' ? 0.75 : spec.size[2] / 2;
    return {
      spec, mesh, slot, home, homeYaw: spec.yaw, p: home.clone(), yaw: spec.yaw, vel: new THREE.Vector3(), spin: 0,
      tip: 0, tipU: 1, tipV: 0, moving: false, cool: 0, halfLen: Math.max(0, spec.size[0] / 2 - rad), rad,
    };
  }

  /** Write one piece's place into its mesh. */
  private show(p: Piece): void {
    const d = this.dummy, sp = p.spec, hidden = sp.stage > this.resets;
    d.position.copy(p.p);
    d.quaternion.setFromAxisAngle(this.axis.set(0, 1, 0), p.yaw);
    if (p.tip > 0) {
      d.quaternion.premultiply(this.q.setFromAxisAngle(this.axis.set(p.tipU, 0, p.tipV), p.tip * Math.PI / 2));
      d.position.y += p.rad * Math.min(1, p.tip) * (sp.kind === 'frame' ? 0.05 : 1);
    }
    const stretch = sp.kind === 'box' || sp.kind === 'pipe';
    if (hidden) d.scale.setScalar(0);
    else if (stretch) d.scale.set(sp.size[0], sp.size[1], sp.size[2]);
    else if (sp.kind === 'hpile') d.scale.set(sp.size[0], 1, 1);
    else d.scale.setScalar(1);
    d.updateMatrix();
    if (p.mesh instanceof THREE.InstancedMesh) { p.mesh.setMatrixAt(p.slot, d.matrix); p.mesh.userData.stale = true; }
    else { p.mesh.matrix.copy(d.matrix); p.mesh.matrixWorldNeedsUpdate = true; }
  }

  private flush(): void {
    for (const child of this.local.children) {
      const mesh = child as THREE.InstancedMesh;
      if (mesh.isInstancedMesh && mesh.userData.stale) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; mesh.userData.stale = false; }
    }
  }

  private paintBoards(): void {
    if (!this.signs) return;
    const n = this.resets;
    this.signs.incident.repaint((g, w, h) => {
      letters(g, w, h, n >= 5 ? ['DAYS SINCE LAST INCIDENT', '0', `TIDIED UP ${n} TIMES TODAY`] : ['DAYS SINCE', 'LAST INCIDENT', '0'], '#f4f2ea', '#1d5c33', { weights: n >= 5 ? [0.7, 1.6, 0.6] : [0.8, 0.8, 1.7], border: '#f4f2ea' });
    });
    this.signs.score.repaint((g, w, h) => {
      letters(g, w, h, ['DERBY', `SMASHES ${this.smashes}`, `TIDY-UPS ${n}`], '#f2c230', '#101214', { font: '"Courier New", monospace', weights: [1.1, 1, 1], border: '#f2c230' });
    });
  }

  /** The crew puts everything back, and adds one more precaution. */
  private tidy(): void {
    this.resets++;
    this.dirty = false;
    for (const p of this.pieces) {
      p.p.copy(p.home); p.yaw = p.homeYaw; p.vel.set(0, 0, 0); p.spin = 0; p.tip = 0; p.moving = false; p.cool = 0;
      this.show(p);
    }
    this.flush();
    for (const s of this.stageNodes) s.node.visible = this.resets >= s.from;
    this.paintBoards();
  }

  private ready(): number | null {
    let fine = 0;
    for (const p of this.probes) {
      const s = this.terrain.surfaceAt(p.x, p.z);
      if (!s || s.level < 7) return null;
      if (s.level >= 8) fine++;
    }
    return fine;
  }

  update(dt: number, vehicle: Vehicle, cam: THREE.Vector3): void {
    const site = this.site, o = site.origin;
    const carFar = Math.hypot(vehicle.x - o.x, vehicle.z - o.z), far = Math.min(carFar, Math.hypot(cam.x - o.x, cam.z - o.z));
    if (far < 800) {
      const fine = this.ready();
      // Build on the first good ground; build again when finer ground arrives, unless the yard is in disarray.
      if (fine !== null && (!this.built || (fine > this.fine && !this.dirty))) { this.build(); this.built = true; this.fine = fine; }
    }
    this.group.visible = this.built && far < 1400;
    if (!this.built) return;

    const inside = site.inProperty(vehicle.x, vehicle.z);
    if (!this.coupledBodies) {
      if (site.mode !== 'closed' && inside > -40 && dt > 0) this.strike(vehicle);
      this.resolveSolids(vehicle);
    }
    if (site.mode === 'closed') return;
    if (dt > 0) this.move(dt);
    // When the car has gone, the crew tidies up. It takes them no time at all.
    const gone = inside < -LEAVE;
    if (gone && !this.away && this.dirty) this.tidy();
    this.away = gone;
  }

  private contactSolids(vehicle: YardBody, solids: readonly Solid[], coupled = false): void {
    const { x, z } = vehicle;
    pushOut(vehicle, solids, coupled);
    if (vehicle.x !== x || vehicle.z !== z) this.contacts++;
  }

  /** The strapped load is low enough to fly over, but solid all the way down to its bearers. */
  get jumpTop(): number {
    const r = SLIP_RAMP, load = JUMP_LOAD;
    return this.g(r.u - load.near - load.length, r.v) + load.height + 0.012;
  }

  private collisionEpoch = 0;
  private readonly collisionStamp: number[] = [];
  private stampAt = 0;
  private stampChanged = false;
  private stampSolid(value: number): void {
    if (this.collisionStamp[this.stampAt] !== value) { this.collisionStamp[this.stampAt] = value; this.stampChanged = true; }
    this.stampAt++;
  }
  /** Exact collider changes, without terrain reads. A shared contact registry can watch this version. */
  collisionVersion(): number {
    this.stampAt = 0; this.stampChanged = false;
    this.stampSolid(this.built ? 1 : 0); this.stampSolid(this.resets); this.stampSolid(this.site.rampBase ?? 0);
    for (const list of [this.solids, this.jumpLoad, this.rampBack]) { this.stampSolid(list.length); for (const s of list) {
      this.stampSolid(s.x); this.stampSolid(s.z); this.stampSolid(s.heading); this.stampSolid(s.half); this.stampSolid(s.halfWidth);
    } }
    for (const p of this.pieces) { this.stampSolid(p.p.x); this.stampSolid(p.p.y); this.stampSolid(p.p.z); this.stampSolid(p.yaw); this.stampSolid(p.rad); this.stampSolid(p.halfLen); this.stampSolid(p.spec.stage); }
    if (this.collisionStamp.length !== this.stampAt) { this.collisionStamp.length = this.stampAt; this.stampChanged = true; }
    if (this.stampChanged) this.collisionEpoch++;
    return this.collisionEpoch;
  }

  /** Coupled bodies use the same static and loose contacts at the same fixed step. */
  resolveTowBody(body: YardBody): void { this.resolveSolids(body, true); if (this.built && this.site.mode !== 'closed') this.strike(body); }

  /** Side-effect-free placement check, including parked and loose pieces already built in this yard. */
  allowsBody(pose: VehiclePlacement & { vx?: number; vz?: number }, spec: VehicleSpec, y?: number): boolean {
    if (!this.built) return true;
    if (this.site.mode === 'closed' && this.site.inProperty(pose.x, pose.z) > -spec.halfLength) return false;
    const p = { ...pose, vx: 0, vz: 0, speed: 0, spec };
    pushOut(p, [...this.solids, ...(y === undefined || y - .12 <= this.jumpTop ? this.jumpLoad : []), ...(y !== undefined && y < (this.site.rampBase ?? 0) + SLIP_RAMP.rise - .55 && this.site.local(pose.x, pose.z).u < SLIP_RAMP.u - SLIP_RAMP.lead - SLIP_RAMP.length && this.site.localDir(pose.vx ?? 0, pose.vz ?? 0).u > 0 ? this.rampBack : [])], true);
    if (Math.hypot(p.x - pose.x, p.z - pose.z) > 1e-6) return false;
    const c = this.site.local(pose.x, pose.z), f = this.site.localDir(Math.sin(pose.heading), -Math.cos(pose.heading));
    for (const piece of this.pieces) {
      if (piece.spec.stage > this.resets || y !== undefined && piece.p.y - this.g(piece.p.x, piece.p.z) > spec.envelope.overhead) continue;
      for (let i = 0; i < spec.envelope.circles.length; i++) {
        const a = spec.envelope.circles[i], side = spec.envelope.circleSides?.[i] ?? 0;
        const du = c.u + f.u * a - f.v * side - piece.p.x, dv = c.v + f.v * a + f.u * side - piece.p.z;
        const along = THREE.MathUtils.clamp(du * Math.cos(piece.yaw) - dv * Math.sin(piece.yaw), -piece.halfLen, piece.halfLen);
        if (Math.hypot(du - along * Math.cos(piece.yaw), dv + along * Math.sin(piece.yaw)) < spec.envelope.radius + piece.rad - 1e-7) return false;
      }
    }
    return true;
  }

  /** Moving pieces may not enter a previously clear rig, even when a correction would squeeze it elsewhere. */
  captureTowMotion(bodies: readonly ContactBody[]): () => void {
    const saved = this.pieces.filter(p => bodies.some(b => { const c = this.site.local(b.x, b.z); return Math.hypot(c.u - p.p.x, c.v - p.p.z) < 35; }))
      .map(piece => ({ piece, p: piece.p.clone(), yaw: piece.yaw, tip: piece.tip }));
    return () => {
      for (const old of saved) {
        const p = old.piece;
        const enters = bodies.some(b => {
          if (p.spec.stage > this.resets || p.p.y - this.g(p.p.x, p.p.z) > b.spec.envelope.overhead) return false;
          const c = this.site.local(b.x, b.z), f = this.site.localDir(Math.sin(b.heading), -Math.cos(b.heading));
          for (let i = 0; i < b.spec.envelope.circles.length; i++) {
            const a = b.spec.envelope.circles[i], side = b.spec.envelope.circleSides?.[i] ?? 0;
            const du = c.u + f.u * a - f.v * side - p.p.x, dv = c.v + f.v * a + f.u * side - p.p.z;
            const along = THREE.MathUtils.clamp(du * Math.cos(p.yaw) - dv * Math.sin(p.yaw), -p.halfLen, p.halfLen);
            if (Math.hypot(du - along * Math.cos(p.yaw), dv + along * Math.sin(p.yaw)) < b.spec.envelope.radius + p.rad - 1e-7) return true;
          }
          return false;
        });
        if (!enters) continue;
        p.p.copy(old.p); p.yaw = old.yaw; p.tip = old.tip; p.vel.set(0, 0, 0); p.spin = 0; p.moving = false; p.cool = Math.max(p.cool, .35);
        this.show(p);
      }
      this.flush();
    };
  }

  /** Static contacts also run after every fixed vehicle step, before another wheel sample can cross a wall. */
  resolveSolids(vehicle: YardBody, coupled = false): void {
    if (!this.built) return;
    const site = this.site;
    if (vehicle.x < site.box[0] - 4 || vehicle.x > site.box[2] + 4 || vehicle.z < site.box[1] - 4 || vehicle.z > site.box[3] + 4) return;
    const inside = site.inProperty(vehicle.x, vehicle.z);
    if (site.mode === 'closed') {
      // Nobody drives onto the property: the car is put back on the line it crossed.
      if (inside > 0) {
        const e = 0.6, gx = site.inProperty(vehicle.x + e, vehicle.z) - site.inProperty(vehicle.x - e, vehicle.z), gz = site.inProperty(vehicle.x, vehicle.z + e) - site.inProperty(vehicle.x, vehicle.z - e);
        const len = Math.hypot(gx, gz) || 1, nx = -gx / len, nz = -gz / len;
        vehicle.x += nx * inside; vehicle.z += nz * inside;
        const into = vehicle.vx * nx + vehicle.vz * nz;
        if (into < 0) { vehicle.vx -= nx * into; vehicle.vz -= nz * into; }
        vehicle.speed = vehicle.vx * Math.sin(vehicle.heading) - vehicle.vz * Math.cos(vehicle.heading);
      }
      if (inside > -30) this.contactSolids(vehicle, this.solids, coupled);
      vehicle.car.root.position.x = vehicle.x; vehicle.car.root.position.z = vehicle.z;
      return;
    }
    if (inside > -40) {
      this.contactSolids(vehicle, this.solids, coupled);
      if (vehicle.y - 0.12 <= this.jumpTop) this.contactSolids(vehicle, this.jumpLoad, coupled);
      // The last crib closes the underside. Above it the deck stays open for a launch or a gentle roll-off.
      const r = SLIP_RAMP;
      if (site.local(vehicle.x, vehicle.z).u < r.u - r.lead - r.length &&
          site.localDir(vehicle.vx, vehicle.vz).u > 0 && vehicle.y < (site.rampBase ?? 0) + r.rise - 0.55) this.contactSolids(vehicle, this.rampBack, coupled);
      vehicle.car.root.position.x = vehicle.x; vehicle.car.root.position.z = vehicle.z;
    }
  }

  /** The car against the loose pieces. */
  private strike(vehicle: YardBody): void {
    const site = this.site, c = site.local(vehicle.x, vehicle.z), f = site.localDir(Math.sin(vehicle.heading), -Math.cos(vehicle.heading));
    const cv = site.localDir(vehicle.vx, vehicle.vz), speed = Math.hypot(cv.u, cv.v);
    let slow = 1, backU = 0, backV = 0, hardest = 0;
    for (const p of this.pieces) {
      const du = p.p.x - c.u, dv = p.p.z - c.v;
      if (Math.abs(du) > 12 || Math.abs(dv) > 12 || p.spec.stage > this.resets) continue;
      if (p.p.y - this.g(p.p.x, p.p.z) > vehicle.spec.envelope.overhead) continue;   // overhead: it comes down with its stack
      const au = Math.cos(p.yaw), av = -Math.sin(p.yaw);
      for (let circle=0;circle<vehicle.spec.envelope.circles.length;circle++) {
        const off=vehicle.spec.envelope.circles[circle],side=vehicle.spec.envelope.circleSides?.[circle];
        let qu = c.u + f.u * off, qv = c.v + f.v * off;
        if(side){qu-=f.v*side;qv+=f.u*side;}
        // Nearest point of the piece's centre line to this circle of the car.
        const t = THREE.MathUtils.clamp((qu - p.p.x) * au + (qv - p.p.z) * av, -p.halfLen, p.halfLen);
        let nu = p.p.x + au * t - qu, nv = p.p.z + av * t - qv;
        const gap = Math.hypot(nu, nv), reach = vehicle.spec.envelope.radius + p.rad;
        if (gap >= reach) continue;
        this.contacts++;
        if (gap > 1e-4) { nu /= gap; nv /= gap; } else { nu = f.u; nv = f.v; }
        const heavy = p.spec.mass >= 5, give = 1 / (1 + p.spec.mass * 0.25);
        // The piece is shoved clear of the car; a heavy one shoves the car back too.
        p.p.x += nu * (reach - gap) * (heavy ? 0.5 : 1); p.p.z += nv * (reach - gap) * (heavy ? 0.5 : 1);
        if (heavy) { backU -= nu * (reach - gap) * 0.5; backV -= nv * (reach - gap) * 0.5; }
        const closing = Math.max(0, cv.u * nu + cv.v * nv);
        if (p.cool <= 0 && (closing > 0.3 || speed > 0.6)) {
          if (heavy) hardest = Math.max(hardest, closing);
          const k = (0.85 + Math.random() * 0.5) * give;
          p.vel.x = cv.u * k + nu * (0.6 + closing * 0.35) * give; p.vel.z = cv.v * k + nv * (0.6 + closing * 0.35) * give;
          p.vel.y = Math.min(3.5, speed * 0.2 * Math.random()) * give;
          p.spin = (Math.random() - 0.5) * Math.min(speed, 14) * 0.7 * give;
          if (p.spec.tips && p.tip === 0) { p.tipU = nv; p.tipV = -nu; p.tip = 0.001; }
          p.cool = 0.35;
          slow *= 1 - Math.min(0.45, 0.05 * p.spec.mass) * Math.min(1, speed / 6);
          if (p.spec.kind === 'wreck' && closing > 2.5) { this.smashes++; this.paintBoards(); }
          if (!p.moving && p.spec.stack) this.topple(p);
          this.dirty = true;
        }
        p.moving = true;
        break;
      }
    }
    if (backU || backV) { const w = site.worldDir(backU, backV); vehicle.x += w.x; vehicle.z += w.z; }
    if (hardest > 0) vehicle.onSolidImpact?.(hardest);   // closing speed before any piece slows the car
    if (slow < 1) { vehicle.vx *= slow; vehicle.vz *= slow; vehicle.speed *= slow; }
  }

  /** Everything stacked with a struck piece comes down with it. */
  private topple(hit: Piece): void {
    for (const p of this.pieces) {
      if (p === hit || p.spec.stack !== hit.spec.stack || p.moving) continue;
      const share = 0.25 + Math.random() * 0.55;
      p.vel.set(hit.vel.x * share + (Math.random() - 0.5) * 1.2, 0, hit.vel.z * share + (Math.random() - 0.5) * 1.2);
      p.spin = (Math.random() - 0.5) * 2.5;
      if (p.spec.tips) { const a = Math.random() * 6.28; p.tipU = Math.cos(a); p.tipV = Math.sin(a); p.tip = 0.001; }
      p.moving = true;
    }
  }

  private move(dt: number): void {
    const restore = this.coupledBodies ? this.captureTowMotion(this.coupledBodies()) : null;
    let any = false;
    const wrecks: Piece[] = [];
    for (const p of this.pieces) {
      if (p.spec.kind === 'wreck') wrecks.push(p);
      if (!p.moving) continue;
      any = true;
      p.cool -= dt;
      const floor = this.g(p.p.x, p.p.z), flat = Math.hypot(p.vel.x, p.vel.z);
      p.p.x += p.vel.x * dt; p.p.z += p.vel.z * dt;
      if (p.p.y > floor + 0.005 || p.vel.y > 0) { p.vel.y -= 9.8 * dt; p.p.y = Math.max(floor, p.p.y + p.vel.y * dt); if (p.p.y === floor) p.vel.y = 0; }
      else {
        p.p.y = floor;
        const grip = (p.spec.kind === 'pipe' || p.spec.kind === 'tyre' ? 3 : p.spec.kind === 'wreck' ? 5.5 : 7.5) * dt;
        if (flat <= grip) { p.vel.x = p.vel.z = 0; } else { p.vel.x *= 1 - grip / flat; p.vel.z *= 1 - grip / flat; }
        p.spin *= Math.max(0, 1 - 4 * dt);
      }
      p.yaw += p.spin * dt;
      if (p.tip > 0 && p.tip < 1) p.tip = Math.min(1, p.tip + dt * 3.2);
      if (flat < 0.05 && p.p.y <= floor + 0.005 && Math.abs(p.spin) < 0.05 && (p.tip === 0 || p.tip === 1) && p.cool <= 0) { p.moving = false; p.vel.set(0, 0, 0); p.spin = 0; }
      this.show(p);
    }
    // Wrecks shunt each other.
    for (const a of wrecks) {
      if (!a.moving) continue;
      for (const b of wrecks) {
        if (a === b) continue;
        const du = b.p.x - a.p.x, dv = b.p.z - a.p.z, gap = Math.hypot(du, dv);
        if (gap >= 3.0 || gap < 1e-3) continue;
        const nu = du / gap, nv = dv / gap, push = (3.0 - gap) / 2, along = (a.vel.x - b.vel.x) * nu + (a.vel.z - b.vel.z) * nv;
        a.p.x -= nu * push; a.p.z -= nv * push; b.p.x += nu * push; b.p.z += nv * push;
        if (along > 0) { a.vel.x -= nu * along * 0.6; a.vel.z -= nv * along * 0.6; b.vel.x += nu * along * 0.6; b.vel.z += nv * along * 0.6; b.spin += (Math.random() - 0.5) * along * 0.3; b.moving = true; this.show(b); }
      }
    }
    // The ring keeps its wrecks: one that reaches the tyres stops there.
    for (const w of wrecks) {
      const du = w.p.x - DERBY.u, dv = w.p.z - DERBY.v, d = Math.hypot(du, dv), limit = DERBY.r - 2.2;
      if (w.moving && d > limit && Math.abs(Math.atan2(dv, du)) > 0.45) { w.p.x = DERBY.u + (du / d) * limit; w.p.z = DERBY.v + (dv / d) * limit; const out = (w.vel.x * du + w.vel.z * dv) / d; if (out > 0) { w.vel.x -= (du / d) * out * 1.3; w.vel.z -= (dv / d) * out * 1.3; } }
    }
    if (any) { restore?.(); this.flush(); }
  }
}
