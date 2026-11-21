// The puddles of the rough stretches (rough-roads.ts), and the spray a wheel throws when it goes through one.
//
// Cost: one instanced draw for every puddle near the camera (a 20-sided disc each; none drawn, and no draw, away from a
// rough stretch), and one instanced draw for the spray, drawn only while a drop is in the air. The near set is chosen
// again at most four times a second. Nothing is made per frame.

import * as THREE from 'three';
import { LAND_LIGHT } from './shaders';
import { PUDDLE_POND, PUDDLE_POOL, type PuddleField, type Puddle } from './rough-roads';
import type { Terrain } from './terrain';

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec2 aInfo;   // seed, kind
varying vec2 vLocal;
varying vec2 vInfo;
varying vec2 vSize;
varying vec3 vWorld;
void main() {
  vLocal = position.xz; vInfo = aInfo;
  vSize = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
#include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${LAND_LIGHT}
varying vec2 vLocal;
varying vec2 vInfo;
varying vec2 vSize;
varying vec3 vWorld;
void main() {
#include <logdepthbuf_fragment>
  // A ragged edge: the ellipse warped and pushed in and out by noise measured in metres, so no two look alike.
  vec2 m = vLocal * vSize + vInfo.x * 41.0;
  vec2 warp = vec2(vnoise(m * 0.55) - 0.5, vnoise(m * 0.55 + 5.3) - 0.5) * 0.7;
  float r = length(vLocal + warp) + ((vnoise(m * 1.7) - 0.5) * 0.55 + (vnoise(m * 4.6) - 0.5) * 0.25) / max(min(vSize.x, vSize.y), 0.35) * 0.4;
  if (r > 1.0) discard;
  // Wet orange-brown mud around the water, darkest at the water line.
  float rim = smoothstep(0.5, 0.86, r);
  vec3 v = normalize(cameraPosition - vWorld);
  // Still water with a faint shiver; brown silt where it is shallow.
  float t = time * 0.4;
  vec2 g = vec2(vnoise(m * 2.2 + t) - 0.5, vnoise(m * 2.2 - t + 9.0) - 0.5) * 0.06;
  vec3 n = normalize(vec3(g.x, 1.0, g.y));
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 refl = reflect(-v, n); refl.y = abs(refl.y);
  vec3 light = sunColor * max(sunDir.y, 0.0) * 0.55 + skyColor * 0.75;
  vec3 silt = mix(vec3(0.085, 0.062, 0.040), vec3(0.120, 0.085, 0.052), vnoise(m * 0.9)) * light;
  vec3 mud = mix(vec3(0.110, 0.075, 0.045), vec3(0.150, 0.098, 0.058), vnoise(m * 3.1)) * light;
  // The sky is far brighter than the mud, so even from above a puddle reads as a mirror of it. A pool in a pothole is
  // half silt; a pond is deep and still enough to hold the sky. Patches of the surface are muddier than others.
  float mirror = (vInfo.y > 1.5 ? 0.55 : vInfo.y > 0.5 ? 0.45 : 0.3) * (0.75 + 0.5 * vnoise(m * 0.8));
  // The sky it mirrors, dark low down where the trees and brush stand round the road.
  vec3 sky = skyAt(refl) * mix(0.28 + 0.25 * vnoise(vec2(atan(refl.x, refl.z) * 40.0, 0.0)), 1.0, smoothstep(0.06, 0.4, refl.y));
  float k = clamp(mirror + fres, 0.0, 1.0);
  vec3 water = silt * 0.6 * (1.0 - k) + sky * k + sunColor * pow(max(dot(refl, sunDir), 0.0), 280.0) * 1.8;
  vec3 col = mix(water, mud * mix(0.7, 1.0, smoothstep(0.5, 1.0, r)), rim);
  col = applyFog(col, vWorld, cameraPosition);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** A soft round drop of spray: white, alpha falling to nothing at the rim. Made once. */
function dropTexture(): THREE.DataTexture {
  const n = 16, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = Math.hypot(x + .5 - n / 2, y + .5 - n / 2) / (n / 2), a = Math.max(0, 1 - r), i = (y * n + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(255 * a * a);
  }
  const t = new THREE.DataTexture(data, n, n); t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

/** What the splash reads from the driven ride. */
export interface Wading {
  x: number; z: number; y: number; heading: number; speed: number; airborne: boolean;
  readonly wheelWater: Float32Array;
  /** One wheel track (a bike): the wheels write slots 0 and 2, and the spray leaves from the middle to both sides. */
  readonly singleTrack?: boolean;
  readonly spec: { readonly wheelbase: number; readonly track: number; readonly rearTrack?: number };
}

/** How hard the wheels go through water now, 0 to 1, for the sound (engine-sound.ts DrivingMoment.splash). */
export function splashLevel(v: Wading): number {
  if (v.airborne) return 0;
  const w = v.wheelWater, wet = w[0] + w[1] + w[2] + w[3];
  return Math.min(1, wet * Math.abs(v.speed) / 1.5);
}

const NEAR = 150;          // metres: puddles drawn around the camera
const LIFT = 0.035;        // metres above the drawn ground
const LIFE = .75;          // seconds a drop flies

export class Puddles {
  readonly group = new THREE.Group();
  readonly mesh: THREE.InstancedMesh;
  readonly spray: THREE.InstancedMesh;
  /** Puddles drawn now, and drops in the air: for the checks. */
  shown = 0; drops = 0;
  private readonly max: number;
  private readonly info: THREE.InstancedBufferAttribute;
  private readonly dummy = new THREE.Object3D();
  private readonly basis = { x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(), m: new THREE.Matrix4() };
  private wait = 0;
  private readonly box: [number, number, number, number];
  // Spray pool.
  private readonly size: number;
  private readonly pos: Float32Array; private readonly vel: Float32Array; private readonly age: Float32Array; private readonly scale: Float32Array;
  private next = 0; private due = new Float32Array(4); private wasWet = new Float32Array(4);
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly color = new THREE.Color();

  constructor(private readonly field: PuddleField, private readonly terrain: Pick<Terrain, 'meshHeightAt' | 'uniforms'>, low: boolean) {
    this.group.name = 'Puddles on rough roads';
    this.max = low ? 160 : 400;
    const geo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
    this.info = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 2), 2);
    this.info.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aInfo', this.info);
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...terrain.uniforms },
      // Without a log depth buffer (LOW) the offset keeps the water over the ground it lies on.
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.max);
    this.mesh.name = 'Puddles'; this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.userData.shadowSet = true;   // flat water: no shadow of its own
    this.group.add(this.mesh);
    this.box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of field.puddles) {
      this.box[0] = Math.min(this.box[0], p.x); this.box[1] = Math.min(this.box[1], p.z);
      this.box[2] = Math.max(this.box[2], p.x); this.box[3] = Math.max(this.box[3], p.z);
    }

    this.size = low ? 24 : 64;
    this.pos = new Float32Array(this.size * 3); this.vel = new Float32Array(this.size * 3);
    this.age = new Float32Array(this.size).fill(LIFE); this.scale = new Float32Array(this.size);
    this.spray = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
      // Unlit, as the drift dust: a drop faces the camera, so a lit one would be dark with the sun behind it.
      new THREE.MeshBasicMaterial({ color: 0xffffff, map: dropTexture(), transparent: true, opacity: .55, depthWrite: false, fog: true }), this.size);
    this.spray.name = 'Puddle spray'; this.spray.frustumCulled = false; this.spray.visible = false; this.spray.renderOrder = 2;
    this.spray.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.spray.userData.shadowSet = true;
    for (let i = 0; i < this.size; i++) { this.spray.setMatrixAt(i, this.zero); this.spray.setColorAt(i, this.color.set(0xffffff)); }
    this.group.add(this.spray);
  }

  /** Once a frame, after the camera moved. `ride` is the driven ride, or null when nobody drives (no spray then). */
  update(dt: number, camera: THREE.Camera, ride: Wading | null): void {
    this.wait -= dt;
    const c = camera.position;
    const away = c.x < this.box[0] - NEAR || c.x > this.box[2] + NEAR || c.z < this.box[1] - NEAR || c.z > this.box[3] + NEAR;
    if (away) { if (this.mesh.visible) { this.mesh.visible = false; this.mesh.count = 0; this.shown = 0; } }
    else if (this.wait <= 0) { this.wait = .25; this.place(c); }
    if (ride && dt > 0) this.emit(dt, ride);
    if (this.drops || this.spray.visible) this.fly(dt, camera);
  }

  /** Lay the nearest puddles on the drawn ground, each tilted to it so its whole edge meets the land. */
  private place(c: THREE.Vector3): void {
    const near: [number, Puddle][] = [];
    for (const p of this.field.puddles) {
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < NEAR + p.a) near.push([d, p]);
    }
    if (near.length > this.max) near.sort((a, b) => a[0] - b[0]);
    let n = 0;
    const { x: ax, y: ay, z: az, m } = this.basis;
    for (const [, p] of near) {
      if (n >= this.max) break;
      const fx = Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = Math.sin(p.yaw);
      const la = Math.max(p.a * .8, .3), lb = Math.max(p.b * .8, .3);
      const h0 = this.terrain.meshHeightAt(p.x, p.z, true);
      const h1 = this.terrain.meshHeightAt(p.x + fx * la, p.z + fz * la, true);
      const h2 = this.terrain.meshHeightAt(p.x + rx * lb, p.z + rz * lb, true);
      if (h0 === null || h1 === null || h2 === null) continue;
      az.set(fx * la, h1 - h0, fz * la);
      ax.set(rx * lb, h2 - h0, rz * lb).normalize();
      ay.crossVectors(az, ax).normalize();
      if (ay.y < 0) ay.negate();
      // A right-handed basis keeps the disc's top face up (a mirrored one would be culled). The ellipse is symmetric,
      // so its long axis may point either way along the road.
      az.crossVectors(ax, ay).normalize();
      m.makeBasis(ax.multiplyScalar(p.b), ay, az.multiplyScalar(p.a));
      m.setPosition(p.x, h0 + LIFT, p.z);
      this.mesh.setMatrixAt(n, m);
      this.info.setXY(n, p.seed, p.kind);
      n++;
    }
    this.mesh.count = n; this.shown = n; this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true; this.info.needsUpdate = true;
  }

  /** Spray from each wheel in water: a burst as it goes in, then a steady sheet while it moves through. */
  private emit(dt: number, v: Wading): void {
    const speed = Math.abs(v.speed);
    const fx = Math.sin(v.heading), fz = -Math.cos(v.heading), rx = Math.cos(v.heading), rz = Math.sin(v.heading);
    const half = v.spec.track / 2, rear = (v.spec.rearTrack ?? v.spec.track) / 2, hl = v.spec.wheelbase / 2;
    for (let w = 0; w < 4; w++) {
      const water = v.airborne ? 0 : v.wheelWater[w];
      if (water <= 0 || speed < 1.5) { this.wasWet[w] = water; this.due[w] = 0; continue; }
      const entering = this.wasWet[w] <= 0;
      this.wasWet[w] = water;
      this.due[w] += dt * Math.min(40, water * 260 * speed / 10) + (entering ? Math.min(8, speed * water * 30) : 0);
      const along = w < 2 ? hl : -hl, side = v.singleTrack ? 0 : (w & 1 ? 1 : -1) * (w < 2 ? half : rear);
      while (this.due[w] >= 1) {
        this.due[w]--;
        const i = this.next, k = i * 3, j = ((i * 7919) % 97) / 97 - .5;
        this.next = (this.next + 1) % this.size;
        this.pos[k] = v.x + fx * along + rx * side; this.pos[k + 1] = v.y + .1; this.pos[k + 2] = v.z + fz * along + rz * side;
        // Up, out to the wheel's own side, and back: water leaves a tyre as a fan.
        const out = (v.singleTrack ? (i & 1 ? 1 : -1) : Math.sign(side)) * (1.2 + 1.5 * j + speed * .08), up = 1.6 + speed * .18 + j;
        this.vel[k] = rx * out - fx * speed * (.25 + .2 * j); this.vel[k + 1] = up; this.vel[k + 2] = rz * out - fz * speed * (.25 + .2 * j);
        this.age[i] = 0; this.scale[i] = .45 + .45 * (j + .5) + water * 3;
        // Grey-white water and brown mud, kept dim: unlit, a bright drop would glow like a lamp in the shade of the trees.
        this.spray.setColorAt(i, this.color.set(j > .2 ? 0x9a9e9c : 0x7d6c56));
        if (this.spray.instanceColor) this.spray.instanceColor.needsUpdate = true;
        this.drops++;
      }
    }
  }

  private fly(dt: number, camera: THREE.Camera): void {
    let alive = 0;
    for (let i = 0; i < this.size; i++) {
      if (this.age[i] >= LIFE) continue;
      const a = this.age[i] += dt;
      if (a >= LIFE) { this.spray.setMatrixAt(i, this.zero); continue; }
      alive++;
      const k = i * 3, drag = Math.max(0, 1 - 1.5 * dt);
      this.vel[k] *= drag; this.vel[k + 2] *= drag; this.vel[k + 1] -= 9.81 * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = a / LIFE, s = this.scale[i] * (.6 + 1.2 * t) * (1 - t * t);
      this.dummy.position.set(this.pos[k], this.pos[k + 1], this.pos[k + 2]);
      this.dummy.quaternion.copy(camera.quaternion);
      this.dummy.scale.set(s, s, s); this.dummy.updateMatrix();
      this.spray.setMatrixAt(i, this.dummy.matrix);
    }
    this.drops = alive;
    this.spray.instanceMatrix.needsUpdate = true;
    this.spray.visible = alive > 0;
  }

  /** For the checks: the puddle list's size by kind. */
  get counts() {
    const out = { pools: 0, ruts: 0, ponds: 0 };
    for (const p of this.field.puddles) p.kind === PUDDLE_POOL ? out.pools++ : p.kind === PUDDLE_POND ? out.ponds++ : out.ruts++;
    return out;
  }
}
