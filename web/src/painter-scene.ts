import * as THREE from 'three';
import { painterArt } from './painter-art';
import { PAINTER, painterDay, painterPose, painterDust, painterHint } from './painter-rules';
import { complaintLine } from './complaints';
import type { SceneRoad, Pose } from './road-scene-rules';
import type { Road } from './roads';
import type { Terrain } from './terrain';
import type { Shift } from './shift';
import type { Vehicle } from './vehicle';

/** The baked road record the scene stands beside; read once, so a pass costs no lookup. */
export type PainterRoad = Pick<Road, 'id' | 'halfWidth' | 'kind'>;

export class PainterScene {
  readonly group = new THREE.Group();
  readonly pose: Pose = {x:0,z:0,heading:0};
  enabled = false;
  private art: THREE.Mesh | null = null;
  /** One complaint per day; reset() clears it. */
  dusty = false;
  private readonly probe: Pose = {x:0,z:0,heading:0};
  /** Player distance, closing speed and speed, kept as plain numbers for the hint the HUD reads five times a second. */
  private distance = Infinity;
  private closing = 0;
  private speed = 0;
  constructor(private readonly road: SceneRoad | null, private readonly record: PainterRoad | null,
    private readonly terrain: Terrain, private readonly shift: Shift, private readonly params: URLSearchParams) {
    if (road) painterPose(road, this.pose);
  }
  reset(): void {
    this.enabled = this.road !== null && this.record !== null && painterDay(this.shift.career.day, this.params.get('scene'), this.params.get('era'));
    this.dusty = false; this.group.visible = false;
  }
  /** Like the fish scene's hint: nothing until the painter is drawn, so it never names an unseen scene. */
  get hint(): string { return this.group.visible ? painterHint(this.distance, this.closing, this.speed, this.dusty) : ''; }
  step(player: Vehicle, playing: boolean): void {
    // Cheap gates first: this runs every physics step. No allocation per step; the complaint is at most once a day.
    if (!this.enabled) return;
    this.speed = player.speed;
    const dx = this.pose.x-player.x, dz = this.pose.z-player.z, distance = this.distance = Math.hypot(dx,dz);
    // Forward is (sin heading, -cos heading); speed is signed, so reversing towards the painter also closes.
    this.closing = distance > 0 ? player.speed*(dx*Math.sin(player.heading)-dz*Math.cos(player.heading))/distance : 0;
    if (this.dusty || !playing || !this.group.visible || Math.abs(player.speed) <= PAINTER.speed) return;
    if (distance >= PAINTER.range || !this.road || !this.record) return;
    this.road.at(this.road.alongAt(player.x,player.z),0,this.probe);
    const fromCentre = Math.hypot(player.x-this.probe.x,player.z-this.probe.z);
    if (!painterDust(player.speed,distance,fromCentre,this.record.halfWidth,this.record.kind)) return;
    this.dusty = true;
    this.shift.complaints.add({kind:'sceneDust',target:-56,at:this.shift.elapsed,x:this.pose.x,z:this.pose.z,
      road:this.record.id,customer:'the painter on Mabou Mines Road',line:complaintLine('sceneDust',this.shift.career.day,-56)});
  }
  update(camera: THREE.Camera): void {
    this.group.visible = false;
    if (!this.enabled || Math.hypot(camera.position.x-this.pose.x,camera.position.z-this.pose.z)>PAINTER.draw) return;
    const y = this.terrain.meshHeightAt?.(this.pose.x,this.pose.z) ?? this.terrain.heightAt(this.pose.x,this.pose.z);
    if (y === null) return;
    if (!this.art) { this.art = painterArt(); this.group.add(this.art); }
    this.group.position.set(this.pose.x,y,this.pose.z);
    this.group.rotation.y = -this.pose.heading;
    this.group.visible = true;
  }
}
