// Shadows from the low October sun, for the desktop picture. The phone build goes without them.
// One shadow map follows the car: a box about 220 m across, laid along the sun's direction. Models (trees, buildings,
// the car, props) cast and receive through three.js. The land does not cast: it only receives, and its own shader
// reads the same map (see `sunShadow` in shaders.ts). Hills still shade themselves by their slope, as before.

import * as THREE from 'three';
import { toggle } from './settings';

const SIZE = 2048;          // shadow map pixels on a side
const RANGE = 110;          // metres from the car to the side of the box, when driving
const BACK = 520;           // metres from the car back toward the sun: far enough for a tall spire on a hill
const RELIEF = 55;          // metres of rise or fall inside the box that still fits

export class SunShadows {
  /** Shared with the terrain shader. `shadowOn` is 0 until the first map exists, and when the player turns shadows off. */
  readonly uniforms = {
    tShadow: { value: null as THREE.Texture | null },
    shadowMatrix: { value: new THREE.Matrix4() },
    shadowTexel: { value: new THREE.Vector2(1 / SIZE, 1 / SIZE) },
    shadowOn: { value: 0 },
  };
  private on = true;
  private since = 1;
  private chosen = false;     // the player, or the address bar, has said yes or no: the slow-computer guard stands down
  private age = 0;
  private slow = 0;
  private box: HTMLInputElement | null = null;
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly at = new THREE.Vector3();
  private half = 0;
  private range = 0;

  /** `forced` is true when the address bar asked for shadows (?shadows=1): they then stay on, however slow. */
  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene,
    private readonly light: THREE.DirectionalLight, private readonly sunDir: THREE.Vector3, forced = false) {
    // The light looks down its own z axis. On level ground a strip `half` tall in the light's view is
    // half / sin(elevation) long, so a low sun needs only a short box.
    this.span(RANGE);
    light.shadow.mapSize.set(SIZE, SIZE);
    light.shadow.bias = -0.00012;
    light.shadow.normalBias = 0.16;
    this.right.crossVectors(new THREE.Vector3(0, 1, 0), sunDir).normalize();
    this.up.crossVectors(sunDir, this.right).normalize();
    scene.add(light.target);
    const saved = (() => { try { return localStorage.getItem('mmm.shadows'); } catch { return null; } })();
    this.enabled = forced || saved !== '0';
    this.chosen = forced || saved !== null;
    // A switch in the settings panel, remembered in the browser.
    this.box = toggle('shadows', 'Shadows', this.on, on => { this.enabled = on; this.chosen = true; });
  }

  /** Sets how far the box reaches to each side. A view from the air takes a wider box, with coarser shadows. */
  private span(range: number): void {
    if (range === this.range) return;
    this.range = range;
    this.half = range * Math.max(0.2, this.sunDir.y) + RELIEF * Math.sqrt(range / RANGE);
    const cam = this.light.shadow.camera;
    cam.left = -range; cam.right = range; cam.top = this.half; cam.bottom = -this.half; cam.near = 1; cam.far = (BACK + range) * 2;
    cam.updateProjectionMatrix();
  }

  get enabled(): boolean { return this.on; }
  set enabled(on: boolean) {
    this.on = on;
    this.renderer.shadowMap.enabled = on;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.light.castShadow = on;
    if (!on) this.uniforms.shadowOn.value = 0;
    this.since = 1;
  }

  /**
   * Call once a frame before the picture is drawn. `focus` is the car, or the ground the free camera looks at;
   * `distance` is how far the camera is from it (the box grows in steps as the camera climbs).
   * `busy` leaves paused frames and frames with tiles still pending (the first load, and streaming during play)
   * out of the slow-computer guard.
   */
  update(dt: number, focus: THREE.Vector3, distance = 0, busy = false): void {
    if (!this.on) return;
    // A computer that cannot keep up gets its speed back: after the first seconds, four seconds' worth of frames
    // slower than 25 a second turn the shadows off, unless the player has chosen. Only play frames count.
    if (!busy) {
      this.age += dt;
      if (!this.chosen && this.age > 6) {
        this.slow = dt > 0.04 ? this.slow + dt : Math.max(0, this.slow - dt * 0.5);
        if (this.slow > 4) {
          console.info('[shadows] this computer draws too slowly with shadows; they are off (Settings turns them back on)');
          this.enabled = false; this.chosen = true;
          if (this.box) this.box.checked = false;
          return;
        }
      }
    }
    this.span(distance < 160 ? RANGE : RANGE * Math.min(8, 2 ** Math.ceil(Math.log2(distance / 160))));
    // Move the box in whole map pixels, so shadow edges do not crawl as the car moves.
    const stepX = (2 * this.range) / SIZE, stepY = (2 * this.half) / SIZE;
    const fx = focus.dot(this.right), fy = focus.dot(this.up);
    this.at.copy(focus).addScaledVector(this.right, Math.round(fx / stepX) * stepX - fx).addScaledVector(this.up, Math.round(fy / stepY) * stepY - fy);
    this.light.target.position.copy(this.at);
    this.light.position.copy(this.at).addScaledVector(this.sunDir, BACK + this.range);
    this.light.target.updateMatrixWorld();
    const map = this.light.shadow.map;
    this.uniforms.tShadow.value = map ? map.texture : null;
    this.uniforms.shadowMatrix.value = this.light.shadow.matrix;
    this.uniforms.shadowOn.value = map ? 1 : 0;
    // New models arrive all the time (tree tiles, the yard, animals). Twice a second, tell the new ones about shadows.
    this.since += dt;
    if (this.since >= 0.5) { this.since = 0; this.scene.traverse(flag); }
  }
}

/** Solid lit models cast and receive. Flat decals on the ground only receive. Shader-drawn things (land, sea, sky) do neither here. */
function flag(o: THREE.Object3D): void {
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh || o.userData.shadowSet) return;
  o.userData.shadowSet = true;
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!mat || (mat as THREE.ShaderMaterial).isShaderMaterial) return;
  const lit = !(mat as THREE.MeshBasicMaterial).isMeshBasicMaterial;
  const solid = mat.depthWrite && !mat.transparent;
  mesh.castShadow = solid && lit;
  mesh.receiveShadow = lit;
}
