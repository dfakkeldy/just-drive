import type { VehicleSpec } from './vehicle-spec';
import * as THREE from 'three';
import { complaintLine } from './complaints';
import { PainterScene } from './painter-scene';
import { fishArt } from './road-scene-art';
import { FISH, FISH_COWS, FISH_VISITOR, COW_FEET, fitCowFeet, HOOF_SET_IN, FishRules, SceneRoad, touchesPlayer, type Pose } from './road-scene-rules';
import { pushOut, type ContactBody, type Solid } from './parked';
import type { Roads } from './roads';
import type { Shift } from './shift';
import type { Terrain } from './terrain';
import type { Vehicle } from './vehicle';

/** One self-contained roadside scene. Future scenes can supply the same reset/step/update/solids/report hooks. */
export class RoadScene {
  readonly painter: PainterScene;
  readonly group = new THREE.Group();
  readonly rules = new FishRules();
  readonly solids: Solid[] = [];
  coupledBody: { x: number; z: number; heading: number; spec: VehicleSpec } | null = null;
  readonly road: SceneRoad | null;
  readonly centre: Pose = { x: 0, z: 0, heading: 0 };
  private readonly visitorCar: Solid = { x: 0, z: 0, heading: 0, half: FISH.carHalf, halfWidth: FISH.carWidth };
  private readonly truck: Solid = { x: 0, z: 0, heading: 0, half: FISH.truckHalf, halfWidth: FISH.truckWidth };
  private readonly candidate: Solid = { x: 0, z: 0, heading: 0, half: 0, halfWidth: 0 };
  private readonly front: Pose = { x: 0, z: 0, heading: 0 };
  private readonly back: Pose = { x: 0, z: 0, heading: 0 };
  private readonly carSolids = [this.visitorCar];
  private readonly truckSolids = [this.truck];
  private art: ReturnType<typeof fishArt> | null = null;
  readonly pasture: Pose[] = FISH_COWS.map(() => ({ x: 0, z: 0, heading: 0 }));
  readonly seaFeet = COW_FEET.map(() => ({ x: 0, z: 0, height: NaN, placedY: NaN }));
  private readonly seaHeights = [0, 0, 0, 0];
  private readonly seaPlane = { height: 0, across: 0, along: 0 };
  private seaBaseY: Float32Array | null = null;
  private seaBaseNormals: Float32Array | null = null;
  private seaCos = 1; private seaSin = 0;
  private seaHeight = NaN; private seaSlopeX = NaN; private seaSlopeZ = NaN;
  private readonly cowHeights = FISH_COWS.map(() => 0);
  private distance = Infinity;
  private placed = false;
  private sound: AudioContext | null = null;
  private hornGain: GainNode | null = null;
  private paused = false;
  private readonly forced: string | null;
  private roadId = -1;

  constructor(roads: Roads, private readonly terrain: Terrain, private readonly shift: Shift, params: URLSearchParams) {
    this.forced = params.get('scene');
    const village = terrain.manifest.village;
    // Public road geometry near the existing cow; this point is 60 m uphill from it.
    const hit = roads.nearest(618982.72 - village[0], village[1] - 5109266.90, 20, r => r.name === 'Mabou Mines Road');
    if (hit) {
      let along = 0;
      for (let i = 0; i < hit.seg; i++) along += Math.hypot(hit.road.pts[i + 1][0] - hit.road.pts[i][0], hit.road.pts[i + 1][1] - hit.road.pts[i][1]);
      along += Math.hypot(hit.road.pts[hit.seg + 1][0] - hit.road.pts[hit.seg][0], hit.road.pts[hit.seg + 1][1] - hit.road.pts[hit.seg][1]) * hit.t;
      this.road = new SceneRoad(hit.road.pts, along); this.roadId = hit.road.id; this.road.at(0, 0, this.centre);
    } else this.road = null;
    this.painter = new PainterScene(this.road, hit?.road ?? null, terrain, shift, params);
    this.reset();
    shift.roadside.push(this);
    // A short generated truck horn, unlocked by the first real input. No fetched audio or frame work.
    const unlock = () => {
      if (!this.sound) this.sound = new AudioContext();
      void this.sound.resume().catch(() => {});
    };
    // Touch activation is granted on release; pointerdown alone leaves mobile audio suspended.
    addEventListener('pointerup', unlock, { once: true });
    addEventListener('keydown', unlock, { once: true });
  }
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.stopHorn();
  }
  stopHorn(): void { this.hornGain?.disconnect(); this.hornGain = null; }
  reset(): void {
    this.stopHorn(); this.setPaused(false);
    this.rules.reset(this.shift.career.day, this.forced);
    this.painter.reset();
    if (!this.road) this.rules.enabled = false;
    this.distance = Infinity; this.placed = false; this.solids.length = 0; this.group.visible = false;
    this.place();
  }
  /** The fish story within 60 m; on painter days (never fish days) the painter's slow-down hint. */
  get hint(): string { return (this.distance < 60 ? this.rules.hint : '') || this.painter.hint; }
  reportLine(): string { return this.rules.reportLine; }
  /** Set both collider poses from the same path as the art. Nothing exists on a no-scene day. */
  place(): void {
    if (!this.rules.enabled || !this.road) return;
    this.road.at(this.rules.carAlong, this.rules.carSide, this.visitorCar); this.visitorCar.heading += Math.PI + this.rules.carTurn;
    this.road.at(this.rules.truckAlong, 0, this.truck);
  }
  /** Actors remain solid for coupled-body placement even outside the drawing distance. */
  get placementSolids(): readonly Solid[] { return this.rules.enabled && this.road ? [this.visitorCar, this.truck] : []; }
  /** Rewind an external or late actor advance that enters the rig's last valid pose. */
  captureTowMotion(bodies: readonly ContactBody[]): () => void {
    if (!this.rules.enabled || !this.road) return () => {};
    const along = this.rules.truckAlong, side = this.rules.carSide;
    return () => {
      let changed = false;
      if (bodies.some(b => touchesPlayer(this.truck, b, -1e-7, b.spec))) { this.rules.truckAlong = along; this.rules.speed = 0; changed = true; }
      if (bodies.some(b => touchesPlayer(this.visitorCar, b, -1e-7, b.spec))) { this.rules.carSide = side; changed = true; }
      if (changed) this.place();
    };
  }
  /** Refuse a blocked placement, including when the models are culled or still loading. */
  allowPlacement(pose: Pose, spec: VehicleSpec): boolean {
    if (!this.rules.enabled || !this.road || Math.hypot(pose.x - this.centre.x, pose.z - this.centre.z) > FISH.draw) return true;
    if (!this.blockedPlacement(pose, spec)) return true;
    const along = this.road.alongAt(pose.x, pose.z), candidate = this.front;
    // Nearest clear centre-line point, in 0.5 m steps. Uphill wins a tie: it is ahead of the climbing truck.
    for (let distance = .5; distance <= 40; distance += .5) for (let side = 1; side >= -1; side -= 2) {
      this.road.at(along + side * distance, 0, candidate);
      if (Math.cos(pose.heading - candidate.heading) < 0) candidate.heading += Math.PI;
      if (this.blockedPlacement(candidate, spec)) continue;
      pose.x = candidate.x; pose.z = candidate.z; pose.heading = candidate.heading; return true;
    }
    return false;
  }
  private blockedPlacement(pose: Pose, spec: VehicleSpec): boolean {
    return touchesPlayer(this.visitorCar, pose, .35, spec) || touchesPlayer(this.truck, pose, .35, spec);
  }
  honk(player: Vehicle): void {
    if (this.paused || this.shift.ended || !this.rules.enabled) return;
    const d = Math.hypot(player.x - this.centre.x, player.z - this.centre.z);
    if (this.rules.honk(d)) this.complain('sceneHorn');
  }
  private complain(kind: 'sceneHit' | 'sceneHorn'): void {
    this.shift.complaints.add({ kind, target: -55, at: this.shift.elapsed, x: this.centre.x, z: this.centre.z,
      road: this.roadId, customer: 'the visitor on Mabou Mines Road',
      line: complaintLine(kind, this.shift.career.day, -55) });
  }
  /** Called after each 1/120 s player physics step, alongside the yard's solids. */
  step(dt: number, player: Vehicle, playing = true): void {
    if (!this.paused) this.painter.step(player, playing && !this.shift.ended);
    if (this.paused || !this.rules.enabled || !this.road) return;
    this.distance = Math.hypot(player.x - this.centre.x, player.z - this.centre.z);
    if (this.distance > FISH.draw) { this.solids.length = 0; this.placed = false; return; }
    // Wait for loaded ground before adding solids; invisible/unplaced obstacles cannot bill the player.
    if (this.terrain.heightAt(this.visitorCar.x, this.visitorCar.z) === null || this.terrain.heightAt(this.truck.x, this.truck.z) === null) { this.solids.length = 0; this.placed = false; return; }
    this.placed = true;
    if (!this.solids.length) this.solids.push(this.visitorCar, this.truck);
    const hit = pushOut(player, this.carSolids);
    if (hit >= 2 && playing && !this.shift.ended) this.complain('sceneHit');
    pushOut(player, this.truckSolids);
    if (!playing || this.shift.ended) return;
    const c = this.candidate;
    const nextSide = Math.max(FISH.shoulder, this.rules.carSide - FISH.carSpeed * dt);
    this.road.at(6 * nextSide / FISH.shoulder, nextSide, c);
    c.heading += Math.PI - .7 * Math.sin(Math.PI * nextSide / FISH.shoulder); c.half = FISH.carHalf; c.halfWidth = FISH.carWidth;
    const carCanMove = !touchesPlayer(c, player, .35, player.spec) && (!this.coupledBody || !touchesPlayer(c, this.coupledBody, .35, this.coupledBody.spec));
    // Check the entire next swept advance plus 2 m braking room, including rotated player circles.
    this.road.at(this.rules.truckAlong + FISH.speed * dt, 0, c);
    c.half = FISH.truckHalf + FISH.gap; c.halfWidth = FISH.truckWidth;
    const truckCanMove = !touchesPlayer(c, player, .1, player.spec) && (!this.coupledBody || !touchesPlayer(c, this.coupledBody, .1, this.coupledBody.spec));
    this.rules.step(dt, this.distance, carCanMove, truckCanMove); this.place();
    if (this.rules.hornSignal) this.horn();
  }
  private horn(): void {
    const audio = this.sound;
    if (this.paused || !audio || audio.state !== 'running') return;
    this.hornGain?.disconnect();
    const gain = this.hornGain = audio.createGain(); gain.gain.setValueAtTime(.035, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .9); gain.connect(audio.destination);
    for (const hz of [110, 165]) { const tone = audio.createOscillator(); tone.type = 'sawtooth'; tone.frequency.value = hz; tone.connect(gain); tone.start(); tone.stop(audio.currentTime + .9); }
  }
  /** Visual updates and distance culling. No per-frame geometry, arrays, vectors or DOM nodes. */
  update(camera: THREE.Camera): void {
    if (this.paused) return;
    // Painter days are never fish days (painterDay excludes fishDay), so the fish test below already hides the fish group.
    this.painter.update(camera);
    if (!this.rules.enabled || !this.road || Math.hypot(camera.position.x - this.centre.x, camera.position.z - this.centre.z) > FISH.draw) { this.group.visible = false; return; }
    if (!this.art) { this.art = fishArt(); this.initializeCows(); this.group.add(this.art.group); this.art.group.visible = true; }
    const a = this.art;
    if (!this.pose(a.car, this.rules.carAlong, this.rules.carSide, Math.PI + this.rules.carTurn) || !this.pose(a.truck, this.rules.truckAlong, 0, 0)) { this.group.visible = false; return; }
    this.group.visible = true;
    this.seatCows();
    const entering = Math.min(1, this.rules.entering / FISH.enterTime);
    const side = FISH_VISITOR.side * (1 - entering);
    this.road.at(FISH_VISITOR.along * (1 - entering), side, this.front);
    const y = this.terrain.heightAt(this.front.x, this.front.z);
    a.visitor.visible = entering < 1 && y !== null;
    a.visitor.position.set(this.front.x, y ?? 0, this.front.z);
    // The lens follows the standing cow over the sea, across the road from the visitor.
    this.road.at(FISH_COWS[0].along, FISH_COWS[0].side, this.back);
    a.visitor.rotation.y = -Math.atan2(this.back.x - this.front.x, -(this.back.z - this.front.z)) + (this.rules.noticeTime > 0 ? -.15 : 0);
    a.hand.visible = this.rules.cleared && this.rules.truckAlong > 4 && this.rules.truckAlong < 30;
  }
  private initializeCows(): void {
    const art = this.art!, positions = art.cows.geometry.attributes.position, normals = art.cows.geometry.attributes.normal;
    art.cows.position.set(this.centre.x, 0, this.centre.z);
    for (let i = 0; i < FISH_COWS.length; i++) {
      const spec = FISH_COWS[i], p = this.pasture[i]; this.road!.at(spec.along, spec.side, p);
      const angle = -p.heading - spec.turn, c = Math.cos(angle), s = Math.sin(angle);
      for (let v = art.cowOffsets[i]; v < art.cowOffsets[i + 1]; v++) {
        const x = positions.getX(v), z = positions.getZ(v), nx = normals.getX(v), nz = normals.getZ(v);
        positions.setXYZ(v, x * c + z * s + p.x - this.centre.x, positions.getY(v), -x * s + z * c + p.z - this.centre.z);
        normals.setXYZ(v, nx * c + nz * s, normals.getY(v), -nx * s + nz * c);
      }
    }
    const spec = FISH_COWS[0], cow = this.pasture[0], angle = -cow.heading - spec.turn;
    this.seaCos = Math.cos(angle); this.seaSin = Math.sin(angle);
    for (let i = 0; i < COW_FEET.length; i++) {
      const local = COW_FEET[i], foot = this.seaFeet[i];
      foot.x = cow.x + this.seaCos * local.x + this.seaSin * local.z;
      foot.z = cow.z - this.seaSin * local.x + this.seaCos * local.z;
    }
    const count = art.cowOffsets[1];
    this.seaBaseY = new Float32Array(count); this.seaBaseNormals = new Float32Array(count * 3);
    for (let v = 0; v < count; v++) {
      this.seaBaseY[v] = positions.getY(v);
      this.seaBaseNormals[v * 3] = normals.getX(v); this.seaBaseNormals[v * 3 + 1] = normals.getY(v); this.seaBaseNormals[v * 3 + 2] = normals.getZ(v);
    }
    positions.needsUpdate = normals.needsUpdate = true;
  }
  private seatCows(): void {
    const art = this.art!, positions = art.cows.geometry.attributes.position;
    art.cows.visible = true;
    for (let i = 0; i < this.pasture.length; i++) {
      if (i === 0) { if (!this.seatSeaCow()) art.cows.visible = false; continue; }
      const p = this.pasture[i], height = this.terrain.heightAt(p.x, p.z);
      if (height === null) { art.cows.visible = false; continue; }
      const delta = height - this.cowHeights[i];
      if (Math.abs(delta) < .001) continue;
      for (let v = art.cowOffsets[i]; v < art.cowOffsets[i + 1]; v++) positions.setY(v, positions.getY(v) + delta);
      this.cowHeights[i] = height; positions.needsUpdate = true;
    }
  }
  private seatSeaCow(): boolean {
    for (let i = 0; i < this.seaFeet.length; i++) {
      // She stands on a steep bank: fit her to the triangles that are drawn, which can lie several
      // centimetres from the finer height sample (more at a high "Hill height").
      const foot = this.seaFeet[i], height = this.terrain.meshHeightAt?.(foot.x, foot.z) ?? this.terrain.heightAt(foot.x, foot.z);
      if (height === null) return false;
      foot.height = this.seaHeights[i] = height;
    }
    fitCowFeet(this.seaHeights, this.seaPlane);
    // Four feet on ground that is not flat cannot all touch. A hoof a little in the grass reads as standing;
    // a hoof in the air does not. So the whole cow comes down until no foot floats, and 2 cm more for the
    // edges of the soles where the bank is steeper than the plane she is fitted to.
    let float = HOOF_SET_IN;
    for (let i = 0; i < COW_FEET.length; i++) float = Math.max(float, HOOF_SET_IN + this.seaPlane.height + this.seaPlane.across * COW_FEET[i].x + this.seaPlane.along * (COW_FEET[i].z + .015) - this.seaHeights[i]);
    this.seaPlane.height -= float;
    const plane = this.seaPlane, sx = plane.across * this.seaCos + plane.along * this.seaSin, sz = -plane.across * this.seaSin + plane.along * this.seaCos;
    for (let i = 0; i < COW_FEET.length; i++) this.seaFeet[i].placedY = plane.height + plane.across * COW_FEET[i].x + plane.along * (COW_FEET[i].z + .015);
    if (Math.abs(plane.height - this.seaHeight) < .001 && Math.abs(sx - this.seaSlopeX) < .0001 && Math.abs(sz - this.seaSlopeZ) < .0001) return true;
    const art = this.art!, pos = art.cows.geometry.attributes.position, normal = art.cows.geometry.attributes.normal, cow = this.pasture[0];
    for (let v = 0; v < art.cowOffsets[1]; v++) {
      const dx = pos.getX(v) + this.centre.x - cow.x, dz = pos.getZ(v) + this.centre.z - cow.z;
      // A small ground-plane shear keeps the four existing hoof soles on the bank. Its bottom is -7 mm.
      pos.setY(v, this.seaBaseY![v] + .007 + plane.height + sx * dx + sz * dz + plane.along * .015);
      const ny = this.seaBaseNormals![v * 3 + 1], nx = this.seaBaseNormals![v * 3] - sx * ny, nz = this.seaBaseNormals![v * 3 + 2] - sz * ny, length = Math.hypot(nx, ny, nz);
      normal.setXYZ(v, nx / length, ny / length, nz / length);
    }
    this.seaHeight = plane.height; this.seaSlopeX = sx; this.seaSlopeZ = sz;
    pos.needsUpdate = normal.needsUpdate = true; return true;
  }
  private pose(root: THREE.Object3D, along: number, side: number, turn: number): boolean {
    this.road!.at(along, side, this.front); this.road!.at(along + 2, side, this.back);
    const y = this.terrain.heightAt(this.front.x, this.front.z), y2 = this.terrain.heightAt(this.back.x, this.back.z);
    if (y === null) return false;
    root.position.set(this.front.x, y + .04, this.front.z);
    const heading = this.front.heading;
    this.road!.at(along, side + .8, this.back);
    const right = this.terrain.heightAt(this.back.x, this.back.z);
    this.road!.at(along, side - .8, this.back);
    const left = this.terrain.heightAt(this.back.x, this.back.z);
    root.rotation.set(Math.atan2((y2 ?? y) - y, 2) * Math.cos(turn), -heading - turn, right !== null && left !== null ? Math.atan2(right - left, 1.6) * Math.cos(turn) : 0, 'YXZ');
    return true;
  }
  /** Inspectable without exposing mutable colliders to tests. */
  get ready(): boolean { return this.placed; }
}
