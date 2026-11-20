import * as THREE from 'three';
import { growsGroundGrass } from './ground-cover';
import { toggle } from './settings';
import { GROUND_COLOR, LAND_LIGHT, SUN_SHADOW } from './shaders';
import type { Terrain } from './terrain';
import { CAR_SPEC, type VehicleSpec } from './vehicle-spec';

const CELL = 8, SIDE = 20, DENSE_SIDE = 40, REACH = 40, NEAR = 20;
const GROW = 0.7;   // seconds a new patch takes to grow in

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${LAND_LIGHT}
${GROUND_COLOR}
attribute vec4 root;
attribute vec4 shape;
attribute vec2 slope;
attribute float seedHead;
attribute float bladeAngle;
attribute float variation;
uniform float grassClock;
uniform float nearLayer;
uniform vec4 grassCar;
uniform vec2 grassFootprint;
varying vec3 vWorld;
varying vec3 vPaint;
varying vec3 vNormal;
varying float vTip;
varying float vSeed;
varying float vDry;
varying float vMown;
varying vec3 vTint;
varying vec3 vFace;
void main() {
  vec3 base = root.xyz;
  float distance = length(cameraPosition - base);
  // Each tuft has its own ending distance; height and width vanish before it leaves the ring.
  float end = nearLayer > 0.5 ? mix(18.0, 20.0, variation) : mix(29.0, ${REACH.toFixed(1)}, variation);
  float width = nearLayer > 0.5 ? 4.0 : 11.0;
  float fade = (1.0 - smoothstep(end - width, end, distance)) * smoothstep(0.0, ${GROW.toFixed(1)}, grassClock - root.w);
  vec2 toCar = base.xz - grassCar.xy;
  vec2 carLocal = vec2(dot(toCar, vec2(grassCar.z, grassCar.w)), dot(toCar, vec2(grassCar.w, -grassCar.z)));
  float outside = max(abs(carLocal.x) / grassFootprint.x, abs(carLocal.y) / grassFootprint.y);
  // Flatten below the whole car, including its floor when the player leaves the road.
  float press = smoothstep(0.85, 1.3, outside);
  vec3 blade = position;
  if (seedHead > 0.5 && (shape.x < 0.2 || variation < 0.88)) blade = vec3(0.0);
  float angle = shape.z + bladeAngle;
  float tint = fract(variation * 17.43 + bladeAngle * 4.17);
  float hue = fract(variation * 43.71 + bladeAngle * 1.63);
  vTint = mix(0.8, 1.2, tint) * mix(vec3(0.92, 1.04, 0.86), vec3(1.08, 0.96, 1.14), hue);
  vec2 across = vec2(cos(angle), sin(angle));
  vec2 along = vec2(-across.y, across.x);
  vFace = vec3(along.x, 0.0, along.y);
  float h = blade.y;
  vec2 wind = vec2(0.055, 0.025) * sin(time * 1.7 + dot(base.xz, vec2(0.21, 0.13)));
  vec2 bend = wind + normalize(toCar + vec2(0.001)) * (1.0 - press) * 0.45;
  vec2 offset = (across * blade.x * shape.y + along * blade.z * shape.x + bend * h * h) * fade;
  vWorld = base + vec3(offset.x, h * shape.x * fade * mix(0.035, 1.0, press), offset.y);
  // Roots follow the local slope rather than making a row of floating blades.
  vWorld.y += dot(offset, slope);
  vTip = h;
  vSeed = seedHead;
  vMown = 1.0 - step(0.2, shape.x);
  vDry = step(0.84, hue) * (1.0 - vMown);
  vNormal = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec2 p = base.xz;
  float big = fbm(p * 0.004), mid = fbm(p * 0.03), fine = vnoise(p * 0.9);
  vPaint = groundColor(p, shape.w, big, mid, fine);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <packing>
#include <logdepthbuf_pars_fragment>
${LAND_LIGHT}
${SUN_SHADOW}
varying vec3 vWorld;
varying vec3 vPaint;
varying vec3 vNormal;
varying float vTip;
varying float vSeed;
varying float vDry;
varying float vMown;
varying vec3 vTint;
varying vec3 vFace;
void main() {
  #include <logdepthbuf_fragment>
  // Shaded roots close the gaps; varied pale tips stay legible against the ground.
  float tip = clamp(vTip, 0.0, 1.0);
  vec3 paint = vPaint * vTint;
  paint = mix(paint, vec3(0.105, 0.180, 0.035), vMown * 0.25);
  paint = mix(paint, vec3(0.27, 0.225, 0.095), vDry * 0.65 + vSeed * 0.3);
  paint *= mix(0.38, 1.48, sqrt(tip));
  float shade = 1.0;
#ifdef SHADOWS
  shade = sunShadow(vWorld);
#endif
  float diff = max(dot(normalize(vNormal), sunDir), 0.0) * shade;
  vec3 light = sunColor * diff + skyColor * (0.65 + 0.55 * vNormal.y) + sunColor * vec3(0.060, 0.050, 0.035);
  // Thin blades transmit the low sun. Tree and building shadows also stop this warm light.
  vec3 eye = normalize(cameraPosition - vWorld);
  float through = pow(max(dot(eye, -sunDir), 0.0), 4.0) * (0.35 + 0.65 * abs(dot(normalize(vFace), sunDir)));
  light += sunColor * vec3(0.9, 0.72, 0.36) * through * shade * tip * 0.65;
  vec3 col = applyFog(paint * light, vWorld, cameraPosition);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface Patch {
  x: number; z: number;
  side: number; dense: boolean; active: boolean;
  cursor: number; count: number;
  /** The grass clock when the patch's mesh was made: it grows in from then. */
  built: number;
  roots: Float32Array; shapes: Float32Array; slopes: Float32Array; variations: Float32Array;
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> | null;
}

function random(x: number, z: number, salt: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(z, 19349663) ^ salt;
  h = Math.imul(h ^ h >>> 13, 0x5bd1e995);
  return ((h ^ h >>> 15) >>> 0) / 4294967296;
}

/**
 * Fixed world patches: moving the camera never moves or reseeds a blade.
 * The grass has no slow-computer guard of its own. It costs a few percent of the frame rate, the sharpness governor
 * (sharpness.ts) keeps the rate up, and the player has the switch in the settings panel.
 */
export class Grass {
  readonly group = new THREE.Group();
  private patches = new Map<string, Patch>();
  private dense = new Map<string, Patch>();
  readonly drawn = {
    far: { patches: 0, tufts: 0, vertices: 0, triangles: 0 },
    dense: { patches: 0, tufts: 0, vertices: 0, triangles: 0 },
  };
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly nearMaterial: THREE.ShaderMaterial;
  private readonly focus: THREE.Vector3;
  private readonly clock = { value: 0 };
  private readonly car = { value: new THREE.Vector4() };
  private readonly footprint = { value: new THREE.Vector2(CAR_SPEC.envelope.grassHalfWidth, CAR_SPEC.envelope.grassHalfLength) };
  private ready = false;
  private on = true;
  private box: HTMLInputElement | null = null;
  private scanX = Infinity;
  private scanZ = Infinity;
  private retry = 0;
  /** Active patches still planting, filled each frame in map order (far patches, then dense ones). One reused list. */
  private readonly planting: Patch[] = [];
  /** Dev readouts let a browser check the actual work budget, rather than guess from frame rate. */
  buildMaxMs = 0;

  constructor(private readonly terrain: Terrain, asked: string | null, private readonly excludes?: (east: number, north: number) => boolean) {
    const saved = (() => { try { return localStorage.getItem('mmm.grass'); } catch { return null; } })();
    this.on = (asked ?? saved) !== '0';
    this.group.name = 'desktop-grass';
    this.group.visible = this.on;
    this.focus = terrain.uniforms.grassFocus.value as THREE.Vector3;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide,
      defines: { ...(terrain.shadows ? { SHADOWS: 1 } : {}), ...(terrain.groundClasses ? { GROUND_CLASSES: 1 } : {}) },
      uniforms: { ...terrain.uniforms, grassClock: this.clock, grassCar: this.car, grassFootprint: this.footprint, nearLayer: { value: 0 } },
    });
    terrain.paved?.applyGrass(this.material);
    terrain.night?.applyGrass(this.material);
    this.nearMaterial = this.material.clone();
    // Cloned materials must still read the same live sun, shadow and car uniforms.
    this.nearMaterial.uniforms = { ...this.material.uniforms, nearLayer: { value: 1 } };
    this.blades();
    this.box = toggle('grass', 'Grass', this.on, on => { this.enabled = on; });
    if (this.on) this.prepare();
  }

  get enabled(): boolean { return this.on; }
  set enabled(on: boolean) {
    this.on = on; this.group.visible = on;
    if (on) this.prepare();
    else { this.focus.z = 0; this.clear(); }
  }

  private prepare(): void {
    if (this.ready) return;
    this.terrain.readCover().then(() => { this.ready = true; }).catch((error: unknown) => {
      console.warn('[grass] cover unavailable', error);
      this.enabled = false;
      if (this.box) this.box.checked = false;
    });
  }

  private blades(): void {
    const positions: number[] = [], seeds: number[] = [], angles: number[] = [], indices: number[] = [];
    for (let b = 0; b < 3; b++) {
      const angle = b * 2.399, scale = b === 1 ? 0.8 : 1;
      const points = [[-0.5, 0, 0], [0.5, 0, 0], [-0.24, 0.55, 0.13], [0.24, 0.55, 0.13], [0, 1, 0.3]];
      const start = positions.length / 3;
      for (const [x, y, z] of points) { positions.push(x, y * scale, z); seeds.push(0); angles.push(angle); }
      indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2, start + 2, start + 3, start + 4);
    }
    const start = positions.length / 3;
    for (const [x, y] of [[0, 0.86], [-0.55, 1.01], [0, 1.13], [0.55, 1.01]]) {
      positions.push(x, y, 0.3); seeds.push(1); angles.push(0);
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.geometry.setAttribute('seedHead', new THREE.Float32BufferAttribute(seeds, 1));
    this.geometry.setAttribute('bladeAngle', new THREE.Float32BufferAttribute(angles, 1));
    this.geometry.setIndex(indices);
  }

  /** A screenshot waits for the near patch jobs too, so it cannot judge half-grown grass. */
  get pending(): number {
    if (!this.on || !this.group.visible) return 0;
    if (!this.ready) return 1;
    let count = 0;
    for (const map of [this.patches, this.dense]) for (const p of map.values()) {
      if (p.active && (p.cursor < p.side * p.side || (p.mesh !== null && this.clock.value - p.built < GROW + 0.05))) count++;
    }
    return count;
  }

  private clear(): void {
    for (const map of [this.patches, this.dense]) {
      for (const patch of map.values()) if (patch.mesh) {
        this.group.remove(patch.mesh); patch.mesh.geometry.dispose();
      }
      map.clear();
    }
    this.scanX = this.scanZ = Infinity;
  }

  private patch(x: number, z: number, dense = false): Patch {
    const side = dense ? DENSE_SIDE : SIDE, count = side * side;
    return { x, z, dense, side, active: true, cursor: 0, count: 0, built: 0, roots: new Float32Array(count * 4),
      shapes: new Float32Array(count * 4), slopes: new Float32Array(count * 2), variations: new Float32Array(count), mesh: null };
  }

  private populate(p: Patch, deadline: number): void {
    const boxes = this.terrain.clear.filter((b) => b[0] < p.x + CELL && b[2] > p.x && b[1] < p.z + CELL && b[3] > p.z);
    while (p.cursor < p.side * p.side) {
      // Check often enough that a newly loaded terrain tile cannot turn this into a long frame.
      if (performance.now() >= deadline) return;
      const i = p.cursor++, gx = p.x * p.side / CELL + i % p.side, gz = p.z * p.side / CELL + Math.floor(i / p.side);
      const r = random(gx, gz, 31), r2 = random(gx, gz, 971);
      const x = (gx + 0.15 + 0.7 * r) * CELL / p.side, z = (gz + 0.15 + 0.7 * r2) * CELL / p.side;
      if (this.terrain.sidewalks?.vegetationAt(x,z)) continue;
      if (this.excludes?.(x + this.terrain.manifest.village[0], this.terrain.manifest.village[1] - z)) continue;
      const surface = this.terrain.surfaceAt(x, z);
      if (!surface || surface.level < 8) {
        // Past the edge of the finest land nothing will ever load: leave the spot bare. Land that is on its way is
        // waited for.
        if (!this.terrain.hasFinest(x, z)) continue;
        p.cursor--; return;
      }
      if (surface.canopy > 1.8 || surface.ground < this.terrain.seaLevel + 1.45) continue;
      // No grass in a brook or on its wet stones; the rank grass of the bank starts just beyond.
      if (surface.brook < 0.45) continue;
      const cls = this.terrain.coverAt(x, z);
      // Without the class runs (1884, or no promoted cover) the old rule holds: only water grows nothing.
      if (!(this.terrain.groundClasses ? growsGroundGrass(cls) : cls !== 4) || boxes.some((b) => x > b[0] - 0.3 && x < b[2] + 0.3 && z > b[1] - 0.3 && z < b[3] + 0.3)) continue;
      const shoulder = surface.kind <= 2 ? 2.1 : 1.25;
      const edge = surface.roadDist - surface.halfWidth;
      if (surface.kind && edge < shoulder + 0.25) continue;
      const h = surface.ground;
      const dx = ((this.terrain.heightAt(x + 1, z) ?? h) - (this.terrain.heightAt(x - 1, z) ?? h)) * 0.5;
      const dz = ((this.terrain.heightAt(x, z + 1) ?? h) - (this.terrain.heightAt(x, z - 1) ?? h)) * 0.5;
      const slope = Math.hypot(dx, dz);
      const coast=this.terrain.coast;
      if(coast?.contains(x,z) && coast.weights(x,z,this.terrain.seaLevel+(h-this.terrain.seaLevel)/this.terrain.exag,slope/this.terrain.exag)[3]>.15)continue;
      if (slope > 0.62 || r2 < THREE.MathUtils.smoothstep(slope, 0.38, 0.62)) continue;
      const verge = surface.kind > 0 && edge < shoulder + 4;
      const lawn = cls === 3 && !verge;
      const field = cls === 2 && !verge;
      // Lawns have more close-cut tufts; open land keeps its cheaper, looser spacing.
      if (!lawn && random(gx, gz, 1501) < (p.dense ? 0.44 : 0.36)) continue;
      const lowCover=this.terrain.groundClasses&&(cls===8||cls===11||cls===13);
      const height = lowCover ? 0.07+r*0.08 : lawn ? 0.05 + r * 0.05 : field ? 0.35 + r * 0.25 : 0.4 + r * 0.4;
      const k = p.count++;
      p.roots.set([x, (this.terrain.meshHeightAt(x, z) ?? h) - 0.015, z, 0], k * 4);
      p.shapes.set([height, lawn ? 0.055 : 0.085 + r2 * 0.045, r2 * Math.PI * 2, cls], k * 4);
      p.slopes.set([dx, dz], k * 2); p.variations[k] = random(gx, gz, 1907);
    }
    if (!p.count) return;
    for (let i = 0; i < p.count; i++) p.roots[i * 4 + 3] = this.clock.value;
    p.built = this.clock.value;
    const geometry = new THREE.InstancedBufferGeometry();
    // A leaving patch owns its buffers, so disposal cannot invalidate a neighbouring patch.
    geometry.index = this.geometry.index!.clone();
    for (const [name, attribute] of Object.entries(this.geometry.attributes)) geometry.setAttribute(name, attribute.clone());
    geometry.setAttribute('root', new THREE.InstancedBufferAttribute(p.roots, 4));
    geometry.setAttribute('shape', new THREE.InstancedBufferAttribute(p.shapes, 4));
    geometry.setAttribute('slope', new THREE.InstancedBufferAttribute(p.slopes, 2));
    geometry.setAttribute('variation', new THREE.InstancedBufferAttribute(p.variations, 1));
    geometry.instanceCount = p.count;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < p.count; i++) { lo = Math.min(lo, p.roots[i * 4 + 1]); hi = Math.max(hi, p.roots[i * 4 + 1]); }
    geometry.boundingBox = new THREE.Box3(new THREE.Vector3(p.x - 1, lo - 1, p.z - 1), new THREE.Vector3(p.x + CELL + 1, hi + 2, p.z + CELL + 1));
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    p.mesh = new THREE.Mesh(geometry, p.dense ? this.nearMaterial : this.material);
    p.mesh.name = p.dense ? 'grass-dense' : 'grass-far';
    p.mesh.visible = p.active;
    // This callback runs only for meshes the renderer really submits, after frustum culling.
    p.mesh.onBeforeRender = () => {
      const count = this.drawn[p.dense ? 'dense' : 'far'];
      count.patches++; count.tufts += p.count;
      count.vertices += geometry.getAttribute('position').count * p.count;
      count.triangles += geometry.index!.count / 3 * p.count;
    };
    p.mesh.matrixAutoUpdate = false;
    this.group.add(p.mesh);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, x: number, z: number, heading: number, spec: VehicleSpec): void {
    for (const count of Object.values(this.drawn)) count.patches = count.tufts = count.vertices = count.triangles = 0;
    if (!this.on || !this.ready) return;
    this.clock.value += dt;
    this.car.value.set(x, z, Math.cos(heading), Math.sin(heading));
    this.footprint.value.set(spec.envelope.grassHalfWidth, spec.envelope.grassHalfLength);
    const start = performance.now(), cx = camera.position.x, cz = camera.position.z;
    const ground = this.terrain.heightAt(cx, cz);
    this.group.visible = ground !== null && camera.position.y - ground < REACH;
    this.focus.set(cx, cz, this.group.visible ? Math.min(1, this.clock.value / 0.7) : 0);
    if (!this.group.visible) return;
    const gx = Math.floor(cx / CELL), gz = Math.floor(cz / CELL);
    this.retry -= dt;
    if (gx !== this.scanX || gz !== this.scanZ || this.retry <= 0) {
      this.scanX = gx; this.scanZ = gz; this.retry = 0.5;
      for (const [key, patch] of this.patches) if (Math.hypot(patch.x + CELL / 2 - cx, patch.z + CELL / 2 - cz) > REACH + CELL * 2) {
        if (patch.mesh) { this.group.remove(patch.mesh); patch.mesh.geometry.dispose(); }
        this.patches.delete(key);
      }
      const reach = Math.ceil(REACH / CELL);
      for (let j = gz - reach; j <= gz + reach; j++) for (let i = gx - reach; i <= gx + reach; i++) {
        const px = i * CELL, pz = j * CELL, key = `${i}/${j}`;
        if (this.patches.has(key) || Math.hypot(px + CELL / 2 - cx, pz + CELL / 2 - cz) > REACH + CELL) continue;
        // Wait for the metre-scale road and canopy data before planting anything.
        if ((this.terrain.surfaceAt(px + CELL / 2, pz + CELL / 2)?.level ?? 0) < 8) continue;
        this.patches.set(key, this.patch(px, pz));
      }
    }
    // The 16 m core has a 4 m fade. Other patches do not build or draw the dense set.
    const pending = this.planting;
    pending.length = 0;
    for (const [key, patch] of this.patches) {
      if (patch.active && patch.cursor < patch.side * patch.side) pending.push(patch);
      const dx = Math.max(patch.x - cx, 0, cx - patch.x - CELL);
      const dz = Math.max(patch.z - cz, 0, cz - patch.z - CELL);
      const near = Math.hypot(dx, dz) < NEAR && camera.position.y - (ground ?? 0) < NEAR;
      if (near && !this.dense.has(key)) this.dense.set(key, this.patch(patch.x, patch.z, true));
    }
    for (const [key, patch] of this.dense) {
      const distance = Math.hypot(Math.max(patch.x - cx, 0, cx - patch.x - CELL), Math.max(patch.z - cz, 0, cz - patch.z - CELL));
      patch.active = distance < NEAR && camera.position.y - (ground ?? 0) < NEAR;
      if (patch.mesh) patch.mesh.visible = patch.active;
      // A small cache lets a reversing car reuse exactly the same roots without another grow-in.
      if (distance > NEAR + CELL || !this.patches.has(key)) {
        if (patch.mesh) { this.group.remove(patch.mesh); patch.mesh.geometry.dispose(); }
        this.dense.delete(key);
      } else if (patch.active && patch.cursor < patch.side * patch.side) pending.push(patch);
    }
    if (pending.length > 0) {
      pending.sort((a, b) => Math.hypot(a.x + CELL / 2 - cx, a.z + CELL / 2 - cz) - Math.hypot(b.x + CELL / 2 - cx, b.z + CELL / 2 - cz));
      for (const patch of pending) {
        if (performance.now() - start >= 1.5) break;
        this.populate(patch, start + 1.5);
      }
    }
    this.buildMaxMs = Math.max(this.buildMaxMs, performance.now() - start);
  }
}
