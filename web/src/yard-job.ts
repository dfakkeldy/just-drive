import * as THREE from 'three';
import { Endings } from './ending';
import { JumpJudge } from './jump-rules';
import { SLIP_RAMP } from './yard-site';
import type { Yard } from './yard';
import type { Vehicle } from './vehicle';
import type { Terrain } from './terrain';

export const OFFER_LINES = [
  'I have a float that needs a driver.',
  'Anybody who can land that can back a trailer.',
  'The mail can wait. It has practice.',
] as const;
export const FLOAT_LINES = [
  'The route is somebody else’s problem now.',
  'The mail is still in the back seat.',
  'The new job pays $28 an hour. Waiting counts.',
  'The float has heat.',
] as const;

export class YardJob {
  readonly judge: JumpJudge;
  constructor(private yard: Yard, private vehicle: Vehicle, private terrain: Terrain,
    private camera: THREE.PerspectiveCamera, private endings: Endings) { this.judge = new JumpJudge(vehicle.spec); }

  step(dt: number, eligible: boolean, placement: number): void {
    if (this.yard.site.mode === 'closed' || this.endings.busy) return;
    const c = this.vehicle, s = this.yard.site, p = s.local(c.x, c.z);
    const ready = this.judge.step(dt, {
      along: SLIP_RAMP.u - p.u, across: p.v - SLIP_RAMP.v,
      y: c.y, ground: this.terrain.heightAt(c.x, c.z,c.y), obstacleTop: this.yard.jumpTop,
      deck: s.deckHeight(c.x, c.z), airborne: c.airborne, pitch: c.pitch, roll: c.roll, speed: c.speed,
      sideways: c.vx * Math.cos(c.heading) + c.vz * Math.sin(c.heading),
      contacts: this.yard.contacts, placement, eligible,
    });
    if (ready) this.endings.offer('The foreman', 'A different sort of driving', OFFER_LINES, [
      { label: 'Take the job', action: () => this.takeJob() },
      { label: 'Keep the route', action: () => this.endings.close() },
    ]);
  }

  private takeJob(): void {
    const car = this.vehicle, site = this.yard.site, camera = this.camera;
    const park = site.world(-105, -25);
    car.place(park.x, park.z, site.heading(-1, 0),car.y); car.vx = car.vz = car.speed = 0;
    if (car.car.beacon) car.car.beacon.visible = false;
    const from = camera.position.clone(), rotation = camera.quaternion.clone();
    const look = new THREE.Vector3(), eye = new THREE.Vector3(), turn = new THREE.PerspectiveCamera();
    this.endings.begin({ key: 'float-driver', title: 'You drive the float now.', lines: FLOAT_LINES,
      camera: seconds => {
        const t = Math.min(1, seconds / 12), ease = t * t * (3 - 2 * t), angle = -0.3 + ease * 0.55;
        const p = site.world(-105 - Math.cos(angle) * 34, -25 + Math.sin(angle) * 34);
        eye.set(p.x, car.y + 5 + 24 * ease, p.z);
        camera.position.copy(from).lerp(eye, Math.min(1, seconds / 2));
        const target = site.world(-65, 5);
        look.set(target.x, car.y + 2 + ease * 15, target.z);
        turn.position.copy(camera.position); turn.lookAt(look);
        camera.quaternion.copy(rotation).slerp(turn.quaternion, Math.min(1, seconds / 2));
      } });
  }
  reset(): void { this.judge.reset(); if (this.vehicle.car.beacon) this.vehicle.car.beacon.visible = true; }
}
