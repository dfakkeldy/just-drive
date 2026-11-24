import * as THREE from 'three';
import { canalBoatPose } from './canal-route';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CANAL_CYCLE, CANAL_STOPPING, CANAL_TRANSIT, CANAL_WARNING, canalState, canalSwing, stopAtGate, type CanalState } from './canal-timer';
import { SwingBridge, type RailJoinSpec } from './swing-bridge';
import type { Roads } from './roads';
import type { Terrain } from './terrain';

/** The player's body; `spec` (absent in some tests) gives its own extent. */
interface Car { x: number; z: number; vx: number; vz: number; speed: number; readonly spec?: { readonly halfLength: number; readonly halfWidth: number } }
const SIDES = [-1, 1] as const;
/** Centre distances beyond the deck end. DECK: a car's nose (half-length under 2.5 m) is past the deck end, and the
 * transit waits only for a car closer than this. GATE: the player's gate line, far enough out that traffic stopping
 * 12 m short of a player waiting there (in either lane) stays off the deck. STOP_LINE: the traffic stand-in, outside the
 * arm (ARM); a car stops 12 m short of it or, braking too late, stops between it and that point, its nose still outside
 * the arm, or drives on (it passes the stand-in up to 1.5 s after it appears, and takes 9 s or more to cross; each arm
 * stays up until such a car is through it). A player is clear of the arm, at any angle, once centred farther out than
 * ARM plus their body's half-diagonal (a towed trailer is not counted, as the gate line never counted it); NOSE, the
 * truck's 3.61 m padded, stands in for a body with no spec.
 * TRAFFIC_NOSE: an ambient car's half-length (2.25 m), padded; a car waiting for the stand-in stops beyond ARM +
 * TRAFFIC_NOSE, so it never holds an arm up (keep STOP_LINE above 11.5). EXIT_REACH: across from the centre line,
 * toward the exit lane, where that lane's traffic still brakes for the player (its 1.65 m line less 2.4 m, padded).
 * Times: HOLD, the longest the transit waits for the deck to clear, after which the vessel turns back (the deck stays,
 * the barrier opens on time); GIVE_WAY, the longest the closure waits for a player on the span once traffic is
 * stopping, after which the cycle returns to just before the stopping and waits there with the road open. So neither
 * the cycle nor the traffic can be held for ever. */
const DECK = 3, ARM = 9, GATE = 16, STOP_LINE = 12, HOLD = 20, CLEARANCE = 56, GIVE_WAY = 3, NOSE = 3.7, TRAFFIC_NOSE = 2.5, EXIT_REACH = -1;
/** The car's braking, for whether a player rolling toward the arm could still stop clear of it (m/s²). A heavier body
 * (the truck, the horse) brakes less; one that misjudges it is stopped by the arm line. */
const BRAKE = 8;
/** An ambient highway car, as AmbientTraffic keeps it. */
interface Traffic { readonly active: boolean; readonly solid: { readonly x: number; readonly z: number; readonly heading: number } }
/** A stopped stand-in that ambient traffic keeps its distance from (AmbientTraffic.others). */
interface Driver { x: number; z: number; heading: number; readonly speed: 0; readonly spec: { readonly halfLength: number }; readonly queue: true }

/** Canso Canal swing bridge, barriers, waiting queues and passing vessels. */
export class Canal {
  readonly group = new THREE.Group();
  readonly bridge: SwingBridge;
  seconds = 0;
  readonly centre: THREE.Vector2;
  readonly along: THREE.Vector2;
  readonly halfLength: number;
  private boats: THREE.Mesh[] = [];
  private arms: THREE.Mesh[] = [];
  private queues: THREE.InstancedMesh;
  private matrix = new THREE.Matrix4();
  private deck = 0;
  private queueSlots = Array.from({ length: 6 }, () => ({ along: 0, across: 0, y: NaN }));
  private queueCount = 0;
  private tempPoint = new THREE.Vector2();
  private tempProjection = { along: 0, across: 0 };
  private span;
  private railSpanId: number | null = null;
  private railReversed = false;
  private cachedRevision = -1;
  private cachedY0: number | null = null;
  private cachedY1: number | null = null;
  private cachedRailY0: number | null = null;
  private cachedRailY1: number | null = null;
  /** main.ts passes the ambient highway pool: a car on the span holds the transit and a queue slot leaves room for one. */
  traffic: readonly Traffic[] = [];
  /** Stand-ins for ambient traffic: a stop line at each gate from 3 s before it closes (a car stops 12 m short of one)
   * and the last waiting car of each queue. Rewritten in place each update. */
  readonly drivers: Driver[] = [];
  private readonly driverPool: Driver[] = Array.from({ length: 4 }, () => ({ x: 0, z: 0, heading: 0, speed: 0, spec: { halfLength: 2.1 }, queue: true }));
  private trafficProjection = { along: 0, across: 0 };
  private beforeProjection = { along: 0, across: 0 };
  private readonly state: CanalState = canalState(0);
  private readonly resolveState: CanalState = canalState(0);
  private readonly stopAlongs = [0, 0];
  private readonly boatPose = { x: 0, z: 0, heading: 0 };
  private held = 0;

  constructor(private roads: Roads, private terrain: Terrain, private village: [number, number], private sea: number, low = false) {
    const hit = roads.nearest(623670.57 - village[0], village[1] - 5056096.30, 20, r => r.bridge && r.name === 'Highway 104');
    if (!hit) throw Error('Canal span missing');
    this.span = hit.road;
    const a = hit.road.pts[0], b = hit.road.pts.at(-1)!;
    this.centre = new THREE.Vector2((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    this.along = new THREE.Vector2(b[0] - a[0], b[1] - a[1]).normalize();
    this.halfLength = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
    let railJoin: RailJoinSpec | undefined;
    if (roads.bridgeRuns) {
      const railHit = roads.nearest(this.centre.x, this.centre.y, 20, r => r.name === 'Railroad');
      if (railHit) {
        const railRoadId = railHit.road.id;
        let bestDist = Infinity;
        for (const run of roads.bridgeRuns()) {
          if (run.roads.has(this.span.id) || !run.roads.has(railRoadId) || run.pts.length < 2) continue;
          const p0 = run.pts[0], p1 = run.pts[run.pts.length - 1];
          const rdx = p1[0] - p0[0], rdz = p1[1] - p0[1], rLen = Math.hypot(rdx, rdz);
          if (rLen < 20) continue;
          const align = Math.abs((rdx * this.along.x + rdz * this.along.y) / rLen);
          if (align < 0.95) continue;
          const dist = Math.hypot((p0[0] + p1[0]) * 0.5 - this.centre.x, (p0[1] + p1[1]) * 0.5 - this.centre.y);
          if (dist >= 12 || dist >= bestDist) continue;
          let spanId: number | null = null;
          for (const id of run.roads) if (id < 0) { spanId = id; break; }
          if (spanId === null) continue;
          bestDist = dist;
          this.railSpanId = spanId;
          const q0 = this.project(p0[0], p0[1]), q1 = this.project(p1[0], p1[1]);
          this.railReversed = q0.along > q1.along;
          const west = this.railReversed ? q1 : q0, east = this.railReversed ? q0 : q1;
          railJoin = {
            westAcross: west.across,
            eastAcross: east.across,
            eastTail: Math.max(0, east.along - this.halfLength),
          };
        }
      }
    }
    const paint = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.bridge = new SwingBridge(this.centre, this.along, this.halfLength, paint, low, railJoin);
    this.group.add(this.bridge.group);
    const colour = (g: THREE.BufferGeometry, hex: number) => {
      const c = new THREE.Color(hex), values = new Float32Array(g.attributes.position.count * 3);
      for (let j = 0; j < values.length; j += 3) { values[j] = c.r; values[j + 1] = c.g; values[j + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(values, 3)); return g;
    };
    // Merge each plain vessel into one draw. No textures, lettering or badges.
    for (let i = 0; i < 4; i++) {
      const cargo = i === 3, parts: THREE.BufferGeometry[] = [];
      const box = (w: number, h: number, l: number, y: number, z = 0) => parts.push(new THREE.BoxGeometry(w, h, l).translate(0, y, z));
      const width = cargo ? 6 : 2.8, length = cargo ? 22 : 8;
      const hull = new THREE.Shape([
        new THREE.Vector2(-width / 2, -length / 2), new THREE.Vector2(width / 2, -length / 2),
        new THREE.Vector2(width / 2, length * .25), new THREE.Vector2(0, length / 2), new THREE.Vector2(-width / 2, length * .25),
      ]);
      const shell = new THREE.ExtrudeGeometry(hull, { depth: cargo ? 2 : 1, bevelEnabled: false });
      shell.rotateX(Math.PI / 2); shell.translate(0, cargo ? 1.5 : .8, 0);
      // Normalise attribute/index layout for the merged hull, cabin and sail.
      const indexed = shell.index ? shell : shell.clone();
      if (!indexed.index) indexed.setIndex(Array.from({ length: indexed.attributes.position.count }, (_, n) => n));
      parts.push(indexed); if (indexed !== shell) shell.dispose();
      box(cargo ? 4 : 2, cargo ? 3 : 1, cargo ? 5 : 3, cargo ? 3 : 1.4, cargo ? -6 : 0);
      if (!cargo) {
        box(.12, 10, .12, 6);
        const sail = new THREE.BufferGeometry();
        sail.setAttribute('position', new THREE.Float32BufferAttribute([.1, 2, 0, .1, 10.8, 0, .1, 2, 3.8, .1, 2, 0, .1, 2, 3.8, .1, 10.8, 0], 3));
        sail.setIndex([0, 1, 2, 3, 4, 5]);
        sail.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
        sail.computeVertexNormals(); parts.push(sail);
      }
      parts.forEach((g, n) => colour(g, n === 0 ? [0x526f88, 0x984c3d, 0x50796b, 0x48566a][i] : 0xeee8d5));
      const geometry = mergeGeometries(parts)!; parts.forEach(g => g.dispose());
      const boat = new THREE.Mesh(geometry, paint); this.boats.push(boat); this.group.add(boat);
    }
    const red = new THREE.MeshLambertMaterial({ color: 0xe65838 });
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(.22, .24, 8.8), red);
      const post = new THREE.Mesh(new THREE.BoxGeometry(.55, 2, .55), new THREE.MeshLambertMaterial({ color: 0xe0d6ae }));
      const along = side * (this.halfLength + ARM);
      const p = this.point(along, -4.4);
      post.position.set(p.x, 0, p.y); post.userData.along = along;
      arm.userData.along = along;
      arm.rotation.order = 'YXZ';
      arm.rotation.y = Math.atan2(-this.along.y, this.along.x);
      this.arms.push(arm); this.group.add(arm, post);
    }
    // Six waiting cars share geometry and material, including dark windows and wheels.
    const parts = [new THREE.BoxGeometry(1.8, .8, 4.2).translate(0, .65, 0), new THREE.BoxGeometry(1.5, .6, 2.1).translate(0, 1.3, -.2)];
    for (const x of [-.9, .9]) for (const z of [-1.3, 1.3]) parts.push(new THREE.BoxGeometry(.25, .5, .6).translate(x, .3, z));
    parts.forEach((g, n) => colour(g, n === 0 ? 0x667d8a : n === 1 ? 0x263b48 : 0x24282b));
    const geometry = mergeGeometries(parts)!; parts.forEach(g => g.dispose());
    this.queues = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }), 6);
    this.queues.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.queues.count = 0;
    this.group.add(this.queues);
    this.update(0, { x: Infinity, z: Infinity, vx: 0, vz: 0, speed: 0 });
  }

  point(along: number, across: number, out = new THREE.Vector2()) {
    return out.set(this.centre.x + this.along.x * along - this.along.y * across, this.centre.y + this.along.y * along + this.along.x * across);
  }
  project(x: number, z: number, out = { along: 0, across: 0 }) {
    const dx = x - this.centre.x, dz = z - this.centre.y;
    out.along = dx * this.along.x + dz * this.along.y; out.across = -dx * this.along.y + dz * this.along.x; return out;
  }
  /** On the span or between its gates: the band the barrier closes. */
  private onSpan(p: { along: number; across: number }) { return Math.abs(p.along) < this.halfLength + GATE && Math.abs(p.across) < 6; }
  /** Over the deck, which hides while a vessel passes. */
  private onDeck(p: { along: number; across: number }) { return Math.abs(p.along) < this.halfLength + DECK && Math.abs(p.across) < 6; }
  /** Holds the closure: the player between the arms (their car under or inside one), or, within the gate band, rolling
   * toward the span too fast to stop clear of the arm. One whose body is stopped or slow outside the arm waits there and
   * sees it close, unless a car is crossing toward them in reach of its lane: it would stop 12 m short of them, on the
   * deck (off it only from GATE, less a metre, out), so the whole gate band holds the closure until that car is by. */
  private blocks(p: { along: number; across: number }, car: Car) {
    if (Math.abs(p.across) >= 6) return false;
    const out = Math.abs(p.along), side = Math.sign(p.along);
    const clear = side * p.across > EXIT_REACH && this.armHeld(side, false) ? this.halfLength + GATE : this.armLine(car);
    if (out < clear) return true;
    if (out >= this.halfLength + GATE) return false;
    const inward = -Math.sign(p.along) * (car.vx * this.along.x + car.vz * this.along.y);
    return inward > 0 && out - inward * inward / (2 * BRAKE) < clear;
  }
  /** Where a player's body is clear of the arm. */
  private armLine(car: Car) { return this.halfLength + ARM + (car.spec ? Math.hypot(car.spec.halfLength, car.spec.halfWidth) : NOSE); }
  /** Arm `side` stays up while a traffic car is between the arms heading for it, or (with `under`) under it: one that
   * drove on as traffic stopped, or, rarely, one stuck behind a player. */
  private armHeld(side: number, under = true) {
    const reach = this.halfLength + ARM;
    for (const t of this.traffic) {
      if (!t.active) continue;
      const q = this.project(t.solid.x, t.solid.z, this.trafficProjection);
      if (Math.abs(q.across) >= 6 || Math.abs(q.along) >= reach + TRAFFIC_NOSE) continue;
      const toward = Math.sin(t.solid.heading) * this.along.x - Math.cos(t.solid.heading) * this.along.y;
      if (under && side * q.along > reach - TRAFFIC_NOSE || side * toward > 0) return true;
    }
    return false;
  }
  private trafficOnDeck() {
    for (const t of this.traffic) if (t.active && this.onDeck(this.project(t.solid.x, t.solid.z, this.trafficProjection))) return true;
    return false;
  }
  /** No spawn on the span while traffic stops for it. */
  readonly keepOut = (x: number, z: number) => this.state.stopping && this.onSpan(this.project(x, z, this.trafficProjection));
  private slotTaken(along: number, across: number, p: { along: number; across: number }) {
    if (Math.abs(p.along - along) < 4.5 && Math.abs(p.across - across) < 2.5) return true;
    for (const t of this.traffic) {
      if (!t.active) continue;
      const q = this.project(t.solid.x, t.solid.z, this.trafficProjection);
      if (Math.abs(q.along - along) < 4.5 && Math.abs(q.across - across) < 2.5) return true;
    }
    return false;
  }
  /** Advance the timer. main.ts calls this from the fixed physics step beside the traffic, so the two never run apart
   * (fly mode, a fleet transition). `live` false (a multiplayer room, where other drivers are not stopped) keeps the
   * road open. */
  advance(dt: number, car: Car, live = true) {
    if (!live) { this.seconds = 0; this.held = 0; return; }
    // Close only once the player's whole car has left the span; hide the deck only once no car at all is over it.
    const p = this.project(car.x, car.z, this.tempProjection), next = this.seconds + dt;
    const from = this.seconds % CANAL_CYCLE, to = next % CANAL_CYCLE;
    // A player on the span holds the cycle with the road open; one who drives back on while traffic is stopping holds it
    // GIVE_WAY seconds, then the cycle steps back to before the stopping. One waiting outside the arm does not (see blocks).
    if (from < CANAL_STOPPING && to >= CANAL_STOPPING && this.blocks(p, car)) return;
    if (from < CANAL_WARNING && to >= CANAL_WARNING && this.blocks(p, car)) {
      if ((this.held += dt) > GIVE_WAY) { this.seconds -= from - CANAL_STOPPING + 1e-3; this.held = 0; }
      return;
    }
    if (from < CANAL_TRANSIT && to >= CANAL_TRANSIT && (this.onDeck(p) || this.trafficOnDeck())) {
      if ((this.held += dt) > HOLD) { this.seconds += CLEARANCE - from; this.held = 0; }
      return;
    }
    this.seconds = next; this.held = 0;
  }
  /** Once a frame: advance by `dt` (tests; main.ts passes 0 and advances from the physics step), then draw. */
  update(dt: number, car: Car, live = true) {
    if (dt) this.advance(dt, car, live); else if (!live) this.seconds = 0;
    const p = this.project(car.x, car.z, this.tempProjection);
    const s = canalState(this.seconds, this.state);
    const rev = this.roads.bridgeRevision;
    const refresh = typeof rev !== 'number' || rev !== this.cachedRevision || this.cachedY0 === null || (this.railSpanId !== null && this.cachedRailY0 === null);
    if (refresh) {
      const y0 = this.roads.bridgeElevation?.(this.span.id, 0) ?? null;
      const y1 = this.roads.bridgeElevation?.(this.span.id, 1) ?? null;
      if (y0 !== null && y1 !== null) {
        this.cachedY0 = y0; this.cachedY1 = y1;
      } else {
        const d = this.roads.deckHeight(this.centre.x, this.centre.y);
        this.cachedY0 = d; this.cachedY1 = d;
      }
      if (this.railSpanId !== null) {
        const e0 = this.roads.bridgeElevation?.(this.railSpanId, 0) ?? null;
        const e1 = this.roads.bridgeElevation?.(this.railSpanId, 1) ?? null;
        this.cachedRailY0 = this.railReversed ? e1 : e0;
        this.cachedRailY1 = this.railReversed ? e0 : e1;
      }
      if (typeof rev === 'number') this.cachedRevision = rev;
    }
    if (this.cachedY0 !== null && this.cachedY1 !== null) {
      this.deck = (this.cachedY0 + this.cachedY1) * 0.5;
      this.bridge.setPose(this.cachedY0, this.cachedY1, canalSwing(this.seconds), this.cachedRailY0, this.cachedRailY1);
      this.roads.showCanalDeck(this.span.id, false);
      if (this.railSpanId !== null) this.roads.showCanalDeck(this.railSpanId, false);
    } else {
      this.bridge.group.visible = false;
      this.roads.showCanalDeck(this.span.id, !s.passing);
      if (this.railSpanId !== null) this.roads.showCanalDeck(this.railSpanId, !s.passing);
    }
    const pose = canalBoatPose(s.progress, this.village, this.boatPose);
    for (let i = 0; i < this.boats.length; i++) {
      const boat = this.boats[i]; boat.visible = s.passing && s.vessel === i;
      boat.position.set(pose.x, this.sea, pose.z);
      boat.rotation.y = pose.heading;
    }
    for (const arm of this.arms) {
      const down = s.closed && !this.armHeld(Math.sign(arm.userData.along));
      const p = this.point(arm.userData.along, down ? 0 : -4.4, this.tempPoint);
      const ground = this.terrain.heightAt(p.x, p.y) ?? this.deck;
      arm.position.set(p.x, ground + (down ? 1.2 : 5.2), p.y);
      arm.rotation.x = down ? 0 : Math.PI / 2;
    }
    for (const node of this.group.children) if (node.userData.along !== undefined && !this.arms.includes(node as THREE.Mesh)) node.position.y = (this.terrain.heightAt(node.position.x, node.position.z) ?? this.deck) + 1;
    let count = 0, changed = false;
    for (const side of SIDES) for (let i = 0; i < s.queue; i++) {
      const along = side * (this.halfLength + 21 + i * 7), across = -side * 1.9;
      // Leave room for the player's whole car, or a traffic car's, as this lane's queue grows.
      if (this.slotTaken(along, across, p)) continue;
      const point = this.point(along, across, this.tempPoint);
      const y = this.terrain.heightAt(point.x, point.y);
      if (y === null) continue;
      const slot = this.queueSlots[count];
      if (slot.along !== along || slot.across !== across || slot.y !== y) {
        slot.along = along; slot.across = across; slot.y = y; changed = true;
        this.matrix.makeRotationY(Math.atan2(this.along.x * -side, this.along.y * -side));
        this.matrix.setPosition(point.x, y, point.y); this.queues.setMatrixAt(count, this.matrix);
      }
      count++;
    }
    if (count !== this.queueCount) changed = true;
    this.queueCount = count;
    this.drivers.length = 0;
    for (const side of SIDES) {
      let tail = 0;
      for (let i = 0; i < count; i++) if (this.queueSlots[i].along * side > tail) tail = this.queueSlots[i].along * side;
      this.stopAlongs[0] = s.stopping ? this.halfLength + STOP_LINE : 0; this.stopAlongs[1] = tail;
      for (const along of this.stopAlongs) {
        if (!along) continue;
        const d = this.driverPool[this.drivers.length], at = this.point(side * along, -side * 1.9, this.tempPoint);
        d.x = at.x; d.z = at.y; d.heading = Math.atan2(-side * this.along.x, side * this.along.y);
        this.drivers.push(d);
      }
    }
    if (changed) {
      this.queues.count = count; this.queues.instanceMatrix.needsUpdate = true; this.queues.computeBoundingSphere();
    }
  }
  resolve(car: Car, beforeX: number, beforeZ: number) {
    const s = canalState(this.seconds, this.resolveState), p = this.project(car.x, car.z, this.tempProjection), before = this.project(beforeX, beforeZ, this.beforeProjection);
    // The player's barrier keeps to the timer, not the drawn arm: an arm left up for a car that drove on is no way in.
    if (s.closed && Math.abs(before.across) > 6 && Math.abs(p.across) <= 6 && Math.abs(p.along) < this.halfLength + GATE) {
      car.x = beforeX; car.z = beforeZ; car.vx = car.vz = car.speed = 0; return;
    }
    if (Math.abs(p.across) > 6) return;
    let along = p.along;
    // The gate line, and the arm itself for a player who waited inside the gate line while it closed.
    if (s.closed) for (const side of SIDES) {
      along = stopAtGate(before.along, along, side, this.halfLength + GATE);
      along = stopAtGate(before.along, along, side, this.armLine(car));
    }
    // Resolve only rendered cars, in the player's lane, with space for both bumpers.
    for (let i = 0; i < this.queueCount; i++) {
      const slot = this.queueSlots[i], side = slot.along > 0 ? 1 : -1;
      if (Math.abs(p.across - slot.across) < 1.8) along = stopAtGate(before.along, along, side, Math.abs(slot.along) + 5);
    }
    if (along !== p.along) {
      const q = this.point(along, p.across, this.tempPoint); car.x = q.x; car.z = q.y;
      car.vx = car.vz = car.speed = 0;
    }
  }
}
