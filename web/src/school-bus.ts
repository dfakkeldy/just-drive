import * as THREE from 'three';
import { schoolBusArt } from './school-bus-art';
import { BUS, BusRules, BusPass } from './school-bus-rules';
import { SceneRoad, touchesPlayer, type Pose } from './road-scene-rules';
import { pushOut, type Solid, type ContactBody } from './parked';
import { START_TIME } from './shift-rules';
import { PENALTIES } from './score-rules';
import type { Roads } from './roads';
import type { Terrain } from './terrain';
import type { Shift } from './shift';
import type { Vehicle } from './vehicle';
import type { VehicleSpec } from './vehicle-spec';

/** The clock belongs to Shift. Motion uses the same fixed steps and pause gates as the fish truck. */
export class SchoolBus {
  readonly group = new THREE.Group();
  readonly road: SceneRoad | null;
  readonly rules: BusRules;
  readonly solid: Solid = { x: 0, z: 0, heading: 0, half: BUS.half, halfWidth: BUS.halfWidth };
  private readonly solids = [this.solid];
  private readonly noSolids: readonly Solid[] = [];
  coupledBody: { x: number; z: number; heading: number; spec: VehicleSpec } | null = null;
  /** Each unsafe pass, for the score stream. */
  onPass: ((player: Vehicle) => void) | null = null;
  get placementSolids(): readonly Solid[] { return this.active ? this.solids : this.noSolids; }
  captureTowMotion(bodies: readonly ContactBody[]): () => void {
    const { along, wait, stops } = this.rules;
    return () => {
      if (this.active && bodies.some(b => touchesPlayer(this.solid, b, -1e-7, b.spec))) {
        this.rules.along = along; this.rules.wait = wait; this.rules.stops = stops; this.place();
      }
    };
  }
  private readonly candidate: Solid = { ...this.solid, half: BUS.half + .5 };
  private readonly nose: Pose = { x: 0, z: 0, heading: 0 };
  private readonly tail: Pose = { x: 0, z: 0, heading: 0 };
  private readonly pass = new BusPass();
  private art: ReturnType<typeof schoolBusArt> | null = null;
  private distance = Infinity;
  private paused = false;
  private flashTime = 0;
  private violations = 0;
  private notice = 0;
  private ready = false;
  constructor(roads: Roads, private readonly terrain: Terrain, private readonly shift: Shift) {
    const loop = roads.roads.find(r => r.name === BUS.road && r.pts.length > 2 && Math.hypot(r.pts[0][0] - r.pts[r.pts.length - 1][0], r.pts[0][1] - r.pts[r.pts.length - 1][1]) < 1);
    this.road = loop ? new SceneRoad(loop.pts, 0, 1) : null;
    this.rules = new BusRules(this.road?.cumulative.at(-1) ?? 1);
    this.group.visible = false; this.place(); shift.roadside.push(this);
  }
  get score(): number { return this.violations ? -this.violations * BUS.penalty : 0; }
  get active(): boolean { return !!this.road && this.rules.active(START_TIME + this.shift.elapsed) && !this.shift.ended; }
  get hint(): string {
    if (this.active && this.notice > 0) return `Passed a flashing school bus: ${this.shift.fired ? PENALTIES.schoolBus : -BUS.penalty} points.`;
    return this.active && this.distance < 65 && this.rules.flashing ? 'STOP. School bus red lights. Wait for the stop arm to fold.' : '';
  }
  reportLine(): string { return this.violations ? `School bus: ${this.violations} unsafe ${this.violations === 1 ? 'pass' : 'passes'}, ${this.score} points.` : ''; }
  setPaused(paused: boolean): void { this.paused = paused; }
  reset(): void { this.rules.reset(); this.pass.reset(); this.violations = this.notice = this.flashTime = 0; this.ready = false; this.group.visible = false; this.place(); }
  private at(along: number, out: Pose): void { this.road?.at(((along % this.rules.length) + this.rules.length) % this.rules.length, BUS.lane, out); }
  private place(): void { this.at(this.rules.along, this.solid); }
  allows(pose: Pose, spec: VehicleSpec): boolean { return !this.active || !touchesPlayer(this.solid, pose, .25, spec); }
  /** Paused frames and placements discard pass history. A moving bus waits for the player's complete footprint. */
  step(dt: number, player: Vehicle, playing: boolean, placement: number): void {
    if (this.paused || !this.active || !playing) { this.pass.reset(); return; }
    this.notice = Math.max(0, this.notice - dt);
    this.distance = Math.hypot(player.x - this.solid.x, player.z - this.solid.z);
    this.at(this.rules.along + BUS.speed * dt, this.candidate);
    const ground = this.terrain.heightAt(this.candidate.x, this.candidate.z);
    this.at(this.rules.along + BUS.speed * dt + 3, this.nose);
    this.at(this.rules.along + BUS.speed * dt - 3, this.tail);
    this.ready = ground !== null && this.terrain.heightAt(this.nose.x, this.nose.z) !== null && this.terrain.heightAt(this.tail.x, this.tail.z) !== null;
    if (!this.ready) { this.pass.reset(); return; }
    const clear = !touchesPlayer(this.candidate, player, .3, player.spec)
      && (!this.coupledBody || !touchesPlayer(this.candidate, this.coupledBody, .3, this.coupledBody.spec));
    if (this.distance < BUS.draw) pushOut(player, this.solids);
    const wasFlashing = this.rules.flashing;
    this.rules.step(dt, START_TIME + this.shift.elapsed, clear);
    this.place(); this.flashTime += dt;
    if (!wasFlashing || !this.rules.flashing) this.pass.reset();
    if (this.pass.sample(player, this.solid, this.rules.flashing, placement)) {
      this.violations++; this.notice = 6; this.onPass?.(player);
    }
  }
  update(camera: THREE.Camera): void {
    if (!this.active || !this.road || Math.hypot(camera.position.x - this.solid.x, camera.position.z - this.solid.z) > BUS.draw) { this.group.visible = false; return; }
    this.at(this.rules.along + 3, this.nose); this.at(this.rules.along - 3, this.tail);
    const y = this.terrain.heightAt(this.solid.x, this.solid.z), front = this.terrain.heightAt(this.nose.x, this.nose.z), back = this.terrain.heightAt(this.tail.x, this.tail.z);
    if (y === null || front === null || back === null) { this.group.visible = false; return; }
    // Built on first active/near update, not at boot. The already-attached
    // group's add watcher hooks these new materials before their first draw.
    // Lambert/Basic may need first-use programs if uncached; no old program is
    // recompiled by the hook. BUS.draw is 300 m, safely inside the zero-bend zone.
    if (!this.art) { this.art = schoolBusArt(); this.group.add(this.art.root); }
    this.group.visible = true;
    const a = this.art;
    a.root.position.set(this.solid.x, y + .03, this.solid.z);
    a.root.rotation.set(Math.atan2(front - back, 6), -this.solid.heading, 0, 'YXZ');
    a.arm.visible = this.rules.flashing;
    const side = Math.floor(this.flashTime * 3) % 2;
    a.lamps[0].visible = this.rules.flashing && side === 0;
    a.lamps[1].visible = this.rules.flashing && side === 1;
  }
}
