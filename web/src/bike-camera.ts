import * as THREE from 'three';
import type { BikeRide } from './bike-ride';
import type { Terrain } from './terrain';
/** Closer chase and helmet eye. The chase inherits the car's canopy clearance and clamps after smoothing too. */
export class BikeCamera {
  private pos = new THREE.Vector3(); private look = new THREE.Vector3(); private heading = 0; private ready = false;
  constructor(private bike: BikeRide, private terrain: Terrain) {}
  update(camera: THREE.PerspectiveCamera, dt: number, view: 'chase' | 'seat', reset: boolean): void {
    const v = this.bike, eye = v.car.driverEye;
    if (view === 'seat') {
      eye.getWorldPosition(camera.position); camera.rotation.set(v.pitch, -v.heading + v.whip, v.roll, 'YXZ');
      const floor = this.terrain.heightAt(camera.position.x, camera.position.z,v.y); if (floor !== null) camera.position.y = Math.max(camera.position.y, floor + .5);
      if (camera.fov !== 74) { camera.fov = 74; camera.updateProjectionMatrix(); }
      this.ready = false; return;
    }
    if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); }
    const moving = Math.hypot(v.vx, v.vz) > 2 && v.speed > 0, want = moving ? Math.atan2(v.vx, -v.vz) : v.heading;
    if (reset || !this.ready) this.heading = want;
    this.heading += Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading)) * Math.min(1, dt * 3.5);
    const back = v.spec.chase.back + Math.min(Math.abs(v.speed) * v.spec.chase.speedBack, v.spec.chase.maxSpeedBack), tx = v.x - Math.sin(this.heading) * back, tz = v.z + Math.cos(this.heading) * back;
    const g = this.terrain.surfaceAt(tx, tz,v.y);
    const ty = Math.max(v.y + v.spec.chase.height, g ? g.ground + g.canopy * .5 + 1.3 : -Infinity);
    const k = !this.ready || reset ? 1 : Math.min(1, dt * 7);
    this.pos.lerp(new THREE.Vector3(tx, ty, tz), k); this.look.lerp(new THREE.Vector3(v.x + Math.sin(v.heading) * v.spec.chase.lookAhead, v.y + v.spec.chase.lookHeight, v.z - Math.cos(v.heading) * v.spec.chase.lookAhead), k);
    const floor = this.terrain.surfaceAt(this.pos.x, this.pos.z,v.y); if (floor) this.pos.y = Math.max(this.pos.y, floor.ground + floor.canopy * .5 + 1.3);
    camera.position.copy(this.pos); camera.lookAt(this.look); camera.rotateZ(v.roll * .08); this.ready = true;
  }
}
