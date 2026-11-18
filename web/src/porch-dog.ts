/**
 * The dog on the porch (tools/blender/porch_dog.py): an old red golden retriever that lies at the top of the steps
 * with its head up. It watches the car go by: the neck and the head turn after it, within what a dog's neck can do.
 * It never gets up, never chases and never barks.
 *
 * The model is a site file. If it does not load, there is no dog, and nothing else changes.
 */
import * as THREE from 'three';
import { loadGlbModel, type GlbModel } from './glb-model';

/** How far the neck and the head may turn to one side, in radians, and how far the head may tip. */
const NECK_TURN = 0.5, HEAD_TURN = 0.8, HEAD_UP = 0.3, HEAD_DOWN = 0.38;
/** The car is worth watching inside this distance, in metres. */
const NOTICE = 70;
/** Eye height above the boards. */
const EYES = 0.57;

export class PorchDog {
  /** Put this where the dog lies. Its forward is -z; its origin is on the floor. */
  readonly group = new THREE.Group();
  /** 'loading' until the file has come, then 'here', or 'absent' when it could not be used. */
  state: 'loading' | 'here' | 'absent' = 'loading';
  triangles = 0;
  private model: GlbModel | null = null;
  private material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private neck: THREE.Group | null = null; private head: THREE.Group | null = null; private tail: THREE.Group | null = null;
  private turn = 0; private tip = 0; private wag = 0; private first = true;
  private target = new THREE.Vector3();

  constructor(low: boolean) {
    loadGlbModel(low ? 'porch-dog-low.glb' : 'porch-dog.glb', this.material, ['root', 'neck', 'head', 'tail']).then((model) => {
      this.model = model;
      this.neck = model.pivots.neck; this.head = model.pivots.head; this.tail = model.pivots.tail;
      this.triangles = model.triangles;
      this.group.add(model.root);
      this.state = 'here';
    }, (error: unknown) => {
      this.state = 'absent';
      console.warn('The porch dog stays in: its model did not load.', error instanceof Error ? error.message : error);
    });
  }

  /** `watched` is what the dog looks at, in world metres: the car. `now` is in seconds. */
  update(dt: number, watched: { x: number; y: number; z: number }, now: number): void {
    if (!this.neck || !this.head || !this.tail || !this.group.parent) return;
    this.group.updateWorldMatrix(true, false);
    const p = this.group.worldToLocal(this.target.set(watched.x, watched.y + 1.0, watched.z));
    const flat = Math.hypot(p.x, p.z);
    // Near the car the dog follows it. With no car near, it looks down the road and its gaze drifts a little.
    const keen = flat < NOTICE ? 1 : 0;
    const drift = 0.16 * Math.sin(now * 0.23) + 0.07 * Math.sin(now * 0.61 + 1.3);
    const reach = NECK_TURN + HEAD_TURN;
    const turn = keen ? THREE.MathUtils.clamp(Math.atan2(-p.x, -p.z), -reach, reach) : drift;
    const tip = keen ? THREE.MathUtils.clamp(Math.atan2(p.y - EYES, Math.max(flat, 0.5)), -HEAD_DOWN, HEAD_UP) : 0;
    // A dog's head leads and settles: quick to start, slow to finish. The first frame has no past to ease from.
    const ease = this.first ? 1 : 1 - Math.exp(-dt * 3.2);
    this.first = false;
    this.turn += (turn - this.turn) * ease; this.tip += (tip - this.tip) * ease;
    const share = NECK_TURN / reach;
    this.neck.rotation.y = this.turn * share;
    this.head.rotation.set(this.tip * 0.85, this.turn * (1 - share), 0);
    // The tail sweeps the boards, slowly, while the car is close.
    const glad = flat < 22 ? 1 : 0;
    this.wag += (glad - this.wag) * (1 - Math.exp(-dt * 1.5));
    this.tail.rotation.y = this.wag * 0.2 * Math.sin(now * 4.2);
  }

  dispose(): void { this.model?.dispose(); this.material.dispose(); }
}
