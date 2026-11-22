import * as THREE from 'three';
import type { Door, InteriorGame, InteriorResult } from './interiors';
import { PlantArt, type PlantSceneParts } from './plant-art';
import { PLANT_DOOR_RADIUS, PLANT_MAX_INTEGRITY, PlantRun } from './plant-rules';
import type { Input } from './vehicle';
import type { YardSite } from './yard-site';

/**
 * The Harbour Ridge steel plant package run: carry a strapped parcel across three bays of conveyors,
 * pulsing hot grates and moving overhead cranes to the far Dispatch Cage. Shadow-free, low draw count.
 */
export class PlantInterior implements InteriorGame {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 95);
  readonly parts: PlantSceneParts;
  run: PlantRun;
  private readonly art = new PlantArt();
  private readonly lamp = new THREE.PointLight(0xffb56b, 16, 26, 1.3);
  private readonly focus = new THREE.Vector3();
  private readonly size = new THREE.Vector2();
  private touch = false;

  constructor(day: number) {
    this.run = new PlantRun(day);
    this.scene.background = new THREE.Color(0x0c1015);
    this.scene.fog = new THREE.Fog(0x0c1015, 22, 74);
    this.scene.add(new THREE.HemisphereLight(0xb2c6d4, 0x6b4528, 1.65));
    const overhead = new THREE.DirectionalLight(0xffe1b5, 0.9);
    overhead.position.set(4, 14, 6);
    overhead.castShadow = false;
    this.scene.add(overhead);
    this.lamp.castShadow = false;
    this.scene.add(this.lamp);
    this.parts = this.art.build(this.scene, this.run.layout);
    this.syncView(0);
  }

  get result(): InteriorResult | null {
    return this.run.result;
  }

  get readout(): string {
    const r = this.run;
    const pct = Math.round(r.progress * 100);
    const controls = this.touch
      ? 'WALK / BACK: move · SIDE pad: strafe'
      : 'W/S or ↑/↓: move · A/D or ←/→: strafe';
    return `BAY ${r.bay}/3 · ${pct}% · PARCEL ${r.integrity}/${PLANT_MAX_INTEGRITY} · SCORE ${r.score} · ${Math.ceil(r.timeLeft)}s\n${r.message}\n${controls}`;
  }

  update(dt: number, input: Input): void {
    this.touch = !!input.touch;
    this.run.update(dt, { forward: input.throttle, side: input.steer });
    this.syncView(dt);
  }

  private syncView(dt: number): void {
    const r = this.run;
    this.art.sync(r, dt);
    if (r.phase === 'delivered' || (r.phase === 'finished' && !!r.result?.delivered)) {
      // Step the camera inside the Dispatch Cage doorway so the final crane cables stay behind the lens.
      this.camera.position.set(r.x * 0.4, 3.3, -r.z + 2.8);
      this.focus.set(0, 1.55, -r.z - 5.2);
    } else {
      this.camera.position.set(r.x * 0.62, 4.7, -r.z + 6.8);
      this.focus.set(r.x * 0.78, 1.15, -r.z - 10.5);
    }
    this.camera.lookAt(this.focus);
    this.lamp.position.set(r.x * 0.5, 4.4, -r.z - 4);
  }

  render(renderer: THREE.WebGLRenderer, draw?: (scene: THREE.Scene, camera: THREE.Camera) => void): void {
    const size = renderer.getSize(this.size);
    const aspect = size.x / size.y;
    if (this.camera.aspect !== aspect) {
      this.camera.aspect = aspect;
      this.camera.fov = aspect < 0.8 ? 72 : 58;
      this.camera.updateProjectionMatrix();
    }
    const exposure = renderer.toneMappingExposure;
    renderer.toneMappingExposure = 1.05;
    try {
      if (draw) draw(this.scene, this.camera);
      else renderer.render(this.scene, this.camera);
    } finally {
      renderer.toneMappingExposure = exposure;
    }
  }

  leave(): void {
    this.run.leave();
  }

  dispose(): void {
    this.art.dispose();
    this.lamp.dispose();
    this.scene.clear();
  }
}

/** Door at the contractor's main shop in the Harbour Ridge works yard. */
export function plantDoor(site: Pick<YardSite, 'door'>): Door {
  const d = site.door;
  return {
    id: 'plant',
    name: 'Harbour Ridge Shop',
    position: { x: d.x, z: d.z },
    radius: PLANT_DOOR_RADIUS,
    prompt: 'Heavy steel parcel for the far Dispatch Cage. Cross the plant floor for a shift tip.',
    leave: 'STEP OUT · Esc',
    controls: { go: 'WALK', brake: 'BACK', steer: 'SIDE' },
    create: day => new PlantInterior(day),
  };
}
