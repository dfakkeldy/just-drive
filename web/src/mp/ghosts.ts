import { untoned } from '../finish-shaders';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FLAG, type PeerView, type Ride } from './wire';
import { rideGeometry, rideIndex, rideAxles } from './ride-model';
import { nearbyOpacity, easeOpacity, footprintsOverlap, type Footprint } from './nearby';

export interface GhostOptions {
  /** Ground height at a world point, including bridge decks; null while land loads. */
  ground: (x: number, z: number) => number | null;
  /** Phone mode uses a smaller default cap. */
  low: boolean;
  /** Nearest cars win. Default 6 on a phone, else 16. */
  cap?: number;
  label?: (name: string, id: number) => string;
}

export const PALETTE = [0x305b83, 0x8f2935, 0x326052, 0xe6e5df, 0x303842, 0xb17a32, 0x73536d, 0x557e80];
const WB = 2.62, TRACK = 1.57;
const ROW = 64, WIDTH = 320;

export interface TagBox { id: number; left: number; right: number; top: number; bottom: number }

/** Phone names use 12 CSS px of ink through 60 m, then shrink. */
export function callSignHeight(depth: number, projection: number, cssHeight: number, low: boolean, distance: number): number {
  const height = Math.max(.01, Math.min(6, .060 * depth / projection));
  return low ? 48 * depth / (Math.max(1, cssHeight) * projection) * Math.min(1, 60 / Math.max(.001, distance)) : height;
}


// One skin, with fixed colours for glass, tyres, trim and lamps.
function carGeometry(low: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  function part(g: THREE.BufferGeometry, hex: number, paint = 0, lamp = 0): void {
    const n = g.getAttribute('position').count, c = new THREE.Color(hex);
    const colours = new Float32Array(n * 3), masks = new Float32Array(n), lamps = new Float32Array(n);
    for (let i = 0; i < n; i++) { c.toArray(colours, i * 3); masks[i] = paint; lamps[i] = lamp; }
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    g.setAttribute('paint', new THREE.BufferAttribute(masks, 1));
    g.setAttribute('lamp', new THREE.BufferAttribute(lamps, 1));
    parts.push(g);
  }
  function box(w: number, h: number, d: number, x: number, y: number, z: number, colour: number, paint = 0, lamp = 0): void {
    part(new THREE.BoxGeometry(w, h, d).translate(x, y, z), colour, paint, lamp);
  }
  function prism(profile: number[][], width: number, hex: number, paint = 0): void {
    const shape = new THREE.Shape();
    for (let i = 0; i < profile.length; i++) {
      const [z, y] = profile[i];
      if (i) shape.lineTo(z, y); else shape.moveTo(z, y);
    }
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, steps: 1 });
    // Extrusion is along X; profile coordinates are Z and Y.
    g.rotateY(-Math.PI / 2).translate(width / 2, 0, 0);
    part(g, hex, paint);
  }
  prism([[-2.23, .68], [-2.23, .94], [-1.15, 1.10], [1.92, 1.15], [2.20, 1.10], [2.20, .68]], 1.78, 0xffffff, 1);
  prism([[-1.14, 1.11], [-.48, 1.63], [1.78, 1.63], [2.10, 1.17]], 1.51, 0x192e39);
  box(1.55, .065, 2.34, 0, 1.655, .645, 0xffffff, 1);
  for (const s of [-1, 1]) {
    box(.13, .52, .10, s * .78, 1.38, .12, 0xffffff, 1);
    box(.13, .42, .12, s * .78, 1.36, 1.18, 0xffffff, 1);
    box(.15, .085, 2.96, s * .78, 1.13, .39, 0xffffff, 1);
    box(.15, .065, 1.72, s * .84, .42, 0, 0x30383a);
    box(.12, .24, 1.76, s * .80, .61, 0, 0xffffff, 1);
    box(.24, .16, .27, s * .94, 1.13, -.91, 0xffffff, 1);
    box(.23, .18, .07, s * .64, .94, -2.26, 0xe8e9cb);
    box(.16, .30, .07, s * .72, .98, 2.22, 0x9c1324, 0, 1);
    for (const z of [-WB / 2, WB / 2]) {
      part(new THREE.CylinderGeometry(.35, .35, .22, low ? 8 : 12).rotateZ(Math.PI / 2).translate(s * TRACK / 2, .35, z), 0x192020);
      part(new THREE.CylinderGeometry(.21, .21, .015, low ? 6 : 8).rotateZ(Math.PI / 2).translate(s * .905, .35, z), 0xa1a9ab);
    }
  }
  box(1.67, .23, .16, 0, .60, -2.12, 0x343c3c);
  box(1.67, .23, .16, 0, .60, 2.12, 0x343c3c);
  const triangles = parts.map(g => g.index ? g.toNonIndexed() : g);
  const result = mergeGeometries(triangles);
  for (const g of new Set([...parts, ...triangles])) g.dispose();
  result.computeBoundingSphere();
  return result;
}

// Keep depth writes on. Fading cars never need transparent-object sorting.
const FADE = `
  if (vFade < 1.0) {
    float noise = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
    if (noise >= vFade) discard;
  }
`;
interface Slot { id: number; name: string; pitch: number; roll: number; opacity: number; used: boolean }

export class Ghosts {
  readonly group = new THREE.Group();
  drawn = 0;
  private labelCount = 0;
  readonly tagBoxes: TagBox[] = [];
  private readonly tagPool: TagBox[];
  private blend = 0;
  private readonly cap: number;
  private readonly low: boolean;
  private readonly ground: GhostOptions['ground'];
  private readonly cars: THREE.InstancedMesh;
  private readonly morph: THREE.Mesh;
  private readonly legacy: THREE.InstancedBufferAttribute;
  readonly labels: THREE.InstancedMesh;
  private readonly atlas: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly slots: Slot[];
  private readonly chosen: (PeerView | null)[];
  private readonly scores: Float64Array;
  private readonly labelBounds: Float64Array;
  private readonly fades: THREE.InstancedBufferAttribute;
  private readonly brakes: THREE.InstancedBufferAttribute;
  private readonly tints: THREE.InstancedBufferAttribute;
  private readonly labelFades: THREE.InstancedBufferAttribute;
  private readonly rows: THREE.InstancedBufferAttribute;
  private readonly palette = PALETTE.map(hex => new THREE.Color(hex));
  private readonly pose = new THREE.Object3D();
  private readonly billboard = new THREE.Object3D();
  private readonly cameraUp = new THREE.Vector3();
  private readonly cameraPosition = new THREE.Vector3();
  private readonly cameraRotation = new THREE.Quaternion();
  private readonly cameraScale = new THREE.Vector3();
  private readonly labelPosition = new THREE.Vector3();

  constructor(private readonly options: GhostOptions) {
    this.cap = Math.max(0, Math.floor(options.cap ?? (options.low ? 6 : 16)));
    this.ground = options.ground;
    this.low = options.low;
    this.group.name = 'Other players';
    this.pose.rotation.order = 'YXZ';
    this.slots = Array.from({ length: this.cap }, () => ({ id: -1, name: '', pitch: 0, roll: 0, opacity: 1, used: false }));
    this.chosen = new Array(this.cap).fill(null);
    this.scores = new Float64Array(this.cap);
    this.labelBounds = new Float64Array(this.cap * 4);
    this.tagPool = Array.from({ length: this.cap }, () => ({ id: 0, left: 0, right: 0, top: 0, bottom: 0 }));
    this.fades = new THREE.InstancedBufferAttribute(new Float32Array(this.cap), 1);
    this.brakes = new THREE.InstancedBufferAttribute(new Float32Array(this.cap), 1);
    this.tints = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
    const geometry = rideGeometry(carGeometry(options.low));
    this.legacy = new THREE.InstancedBufferAttribute(new Float32Array(this.cap),1);
    geometry.setAttribute('legacy',this.legacy);
    geometry.setAttribute('fade', this.fades); geometry.setAttribute('brake', this.brakes); geometry.setAttribute('tint', this.tints);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .66, metalness: .12, side: THREE.DoubleSide });
    material.onBeforeCompile = shader => {
      shader.vertexShader = `attribute float paint, lamp, fade, brake, legacy; attribute vec3 tint;
        varying float vFade, vLamp; varying vec3 vPaintTint;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vFade = fade; vLamp = lamp * brake * legacy; vPaintTint = mix(vec3(1.0), tint, paint * legacy);`);
      shader.fragmentShader = 'varying float vFade, vLamp; varying vec3 vPaintTint;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vPaintTint;\n' + FADE);
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vLamp * vec3(0.65, 0.002, 0.003);');
    };
    this.morph = new THREE.Mesh(geometry, material);
    this.cars = new THREE.InstancedMesh(geometry, material, this.cap);
    if (this.cap > 0) this.cars.setMorphAt(0,this.morph);
    this.cars.frustumCulled = false; this.cars.count = 0;
    this.cars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH; canvas.height = ROW * Math.max(1, this.cap);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Call signs need a 2D canvas.');
    this.ctx = ctx;
    this.atlas = new THREE.CanvasTexture(canvas); this.atlas.colorSpace = THREE.SRGBColorSpace;
    this.atlas.generateMipmaps = false; this.atlas.minFilter = THREE.LinearFilter;
    this.labelFades = new THREE.InstancedBufferAttribute(new Float32Array(this.cap), 1);
    this.rows = new THREE.InstancedBufferAttribute(new Float32Array(this.cap), 1);
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.setAttribute('fade', this.labelFades); plane.setAttribute('row', this.rows);
    const labelMaterial = new THREE.MeshBasicMaterial({ map: this.atlas, alphaTest: .15, toneMapped: false });
    labelMaterial.customProgramCacheKey = () => `ghost-labels-${this.cap}`;
    labelMaterial.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute float fade, row; varying float vFade;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
        vMapUv.y = (vMapUv.y + row) / ${Math.max(1, this.cap)}.0; vFade = fade;`);
      shader.fragmentShader = 'varying float vFade;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n' + FADE);
    };
    untoned(labelMaterial);
    this.labels = new THREE.InstancedMesh(plane, labelMaterial, this.cap);
    this.labels.frustumCulled = false; this.labels.count = 0;
    this.labels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.cars, this.labels);
  }

  // Insertion into a fixed buffer avoids sorting or making a new array.
  private choose(peer: PeerView): void {
    if (!(peer.alpha > 0)) return;
    const centre = this.ground(peer.x, peer.z); if (centre === null) return;
    const dx = peer.x - this.cameraPosition.x, dz = peer.z - this.cameraPosition.z;
    const dy = centre + peer.air - this.cameraPosition.y;
    let score = dx * dx + dy * dy + dz * dz;
    for (let i = 0; i < this.cap; i++) if (this.slots[i].id === peer.id) { score *= .90; break; }
    for (let i = 0; i < this.cap; i++) if (score < this.scores[i]) {
      for (let j = this.cap - 1; j > i; j--) { this.scores[j] = this.scores[j - 1]; this.chosen[j] = this.chosen[j - 1]; }
      this.scores[i] = score; this.chosen[i] = peer; break;
    }
  }

  update(dt: number, peers: Iterable<PeerView>, camera: THREE.Camera, local?: Footprint, localRide?: Ride): void {
    camera.updateWorldMatrix(true, false);
    camera.matrixWorld.decompose(this.cameraPosition, this.cameraRotation, this.cameraScale);
    this.cameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    this.chosen.fill(null); this.scores.fill(Infinity);
    // Arrays need no iterator. Other iterable sources own their iterator storage.
    if (Array.isArray(peers)) {
      for (let i = 0; i < peers.length; i++) this.choose(peers[i]);
    } else {
      for (const peer of peers) this.choose(peer);
    }
    // Preserve the slot (and its atlas row and attitude) when distance order changes.
    for (let i = 0; i < this.cap; i++) {
      const slot = this.slots[i]; slot.used = false;
      for (let j = 0; j < this.cap; j++) if (this.chosen[j]?.id === slot.id) { slot.used = true; break; }
    }
    this.drawn = this.labelCount = 0;
    this.blend = 1 - Math.exp(-10 * Math.max(0, Math.min(dt, .1)));
    for (let i = 0; i < this.cap; i++) {
      const peer = this.chosen[i]; if (!peer) break;
      let at = -1;
      for (let j = 0; j < this.cap; j++) if (this.slots[j].id === peer.id) { at = j; break; }
      let fresh = false;
      if (at < 0) {
        for (let j = 0; j < this.cap; j++) if (!this.slots[j].used) { at = j; break; }
        fresh = true;
      }
      const slot = this.slots[at]; slot.used = true; slot.id = peer.id;
      const target = local ? nearbyOpacity(Math.hypot(peer.x-local.x,peer.z-local.z), footprintsOverlap(local,peer,peer.ride,localRide)) : 1;
      slot.opacity = easeOpacity(fresh ? 1 : slot.opacity, target, dt);
      this.drawCar(peer, slot, fresh, at, camera);
    }
    for (let i = 0; i < this.cap; i++) if (!this.slots[i].used) this.slots[i].id = -1;
    this.cars.count = this.drawn; this.labels.count = this.labelCount;
    if (this.tagBoxes.length !== this.labelCount) this.tagBoxes.length = this.labelCount;
    if (this.cars.morphTexture) this.cars.morphTexture.needsUpdate = true;
    this.legacy.needsUpdate = true;
    this.cars.instanceMatrix.needsUpdate = true; this.labels.instanceMatrix.needsUpdate = true;
    this.tints.needsUpdate = this.fades.needsUpdate = this.brakes.needsUpdate = this.rows.needsUpdate = this.labelFades.needsUpdate = true;
  }

  private drawCar(peer: PeerView, slot: Slot, fresh: boolean, at: number, camera: THREE.Camera): void {
    const centre = this.ground(peer.x, peer.z); if (centre === null) return;
    const axles = rideAxles(peer.ride), wb = axles?.wheelbase ?? WB, track = axles?.track ?? TRACK;
    const fx = Math.sin(peer.heading), fz = -Math.cos(peer.heading), rx = Math.cos(peer.heading), rz = Math.sin(peer.heading);
    const fl = this.ground(peer.x + fx * wb / 2 - rx * track / 2, peer.z + fz * wb / 2 - rz * track / 2) ?? centre;
    const fr = this.ground(peer.x + fx * wb / 2 + rx * track / 2, peer.z + fz * wb / 2 + rz * track / 2) ?? centre;
    const rl = this.ground(peer.x - fx * wb / 2 - rx * track / 2, peer.z - fz * wb / 2 - rz * track / 2) ?? centre;
    const rr = this.ground(peer.x - fx * wb / 2 + rx * track / 2, peer.z - fz * wb / 2 + rz * track / 2) ?? centre;
    const pitch = Math.atan2((fl + fr - rl - rr) / 2, wb), roll = track > 0 ? Math.atan2((fr + rr - fl - rl) / 2, track) : 0;
    slot.pitch += (pitch - slot.pitch) * (fresh ? 1 : this.blend); slot.roll += (roll - slot.roll) * (fresh ? 1 : this.blend);
    const y = (fl + fr + rl + rr) / 4 + peer.air;
    this.pose.position.set(peer.x, y, peer.z); this.pose.rotation.set(slot.pitch, -peer.heading, slot.roll + (peer.ride?.kind === 'bike' ? THREE.MathUtils.clamp(-peer.steer * peer.speed * .08,-.55,.55) : 0));
    this.pose.updateMatrix(); this.cars.setMatrixAt(this.drawn, this.pose.matrix);
    const model = rideIndex(peer.ride);
    this.legacy.setX(this.drawn, model < 0 ? 1 : 0);
    const influences = this.morph.morphTargetInfluences!;
    for (let i=0;i<influences.length;i++) influences[i] = i===model ? 1 : 0;
    this.cars.setMorphAt(this.drawn,this.morph);
    const colour = this.palette[((peer.hue % 8) + 8) % 8 | 0];
    this.tints.setXYZ(this.drawn, colour.r, colour.g, colour.b);
    this.fades.setX(this.drawn, Math.min(1, peer.alpha) * slot.opacity); this.brakes.setX(this.drawn, peer.flags & FLAG.brake ? 1 : 0);
    this.drawn++;
    this.drawLabel(peer, slot, fresh, at, camera);
  }

  private drawLabel(peer: PeerView, slot: Slot, fresh: boolean, at: number, camera: THREE.Camera): void {
    const y = this.pose.position.y;
    const e = this.pose.matrix.elements;
    const roof = Math.max(peer.ride?.kind === 'truck' ? 2.5 : peer.ride?.kind === 'bike' || peer.ride?.kind === 'sxs' ? 2.1 : 1.8, e[5] * .85 + Math.abs(e[1]) * 1.1 + Math.abs(e[5]) * .85 + Math.abs(e[9]) * 2.3);
    this.labelPosition.set(peer.x, y + roof + .25, peer.z);
    const distance = this.labelPosition.distanceTo(this.cameraPosition);
    if (distance > 150) return;
    const name = this.options.label?.(peer.name, peer.id) ?? peer.name;
    if (fresh || slot.name !== name) {
      slot.name = name;
      const ctx = this.ctx, top = at * ROW;
      ctx.clearRect(0, top, WIDTH, ROW);
      ctx.fillStyle = '#16262eef'; ctx.beginPath(); ctx.roundRect(4, top + 4, WIDTH - 8, ROW - 8, 14); ctx.fill();
      ctx.strokeStyle = '#' + this.palette[((peer.hue % 8) + 8) % 8 | 0].getHexString() + '99'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#f5f3e6'; ctx.font = '600 32px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(name, WIDTH / 2, top + ROW / 2, WIDTH - 36);
      this.atlas.needsUpdate = true;
    }
    // Scale by view depth, with a small near limit. The bottom stays above the roof.
    this.labelPosition.applyMatrix4(camera.matrixWorldInverse);
    const perspective = camera.projectionMatrix.elements[15] === 0, projection = Math.abs(camera.projectionMatrix.elements[5]);
    // The 32/64 atlas font takes half the plane height; use CSS px, not drawing-buffer pixels.
    const base = this.labelPosition.z, rise = camera.matrixWorldInverse.elements[6];
    let height = callSignHeight(perspective ? Math.abs(base) : 1, projection, innerHeight, this.low, distance);
    // Size it again at the plane's centre, half a plane above the base, where it is drawn (view z moves by rise per metre up).
    if (perspective) height = callSignHeight(Math.abs(base + rise * height / 2), projection, innerHeight, this.low, distance);
    this.billboard.position.set(peer.x, y + roof + .25 + height / 2, peer.z);
    this.billboard.quaternion.copy(this.cameraRotation); this.billboard.scale.set(height * WIDTH / ROW, height, 1);
    this.arrangeLabel(camera, peer.id);
    this.billboard.updateMatrix(); this.labels.setMatrixAt(this.labelCount, this.billboard.matrix);
    this.rows.setX(this.labelCount, this.cap - 1 - at);
    this.labelFades.setX(this.labelCount, Math.min(1, peer.alpha) * Math.min(1, (150 - distance) / 20));
    this.labelCount++;
  }

  private arrangeLabel(camera: THREE.Camera, id: number): void {
    const height = this.billboard.scale.y;
    // Lift a crowded label above earlier ones, without hiding any names.
    this.labelPosition.copy(this.billboard.position).applyMatrix4(camera.matrixWorldInverse);
    const labelDepth = camera.projectionMatrix.elements[15] === 0 ? Math.max(.001, Math.abs(this.labelPosition.z)) : 1;
    this.labelPosition.applyMatrix4(camera.projectionMatrix);
    const halfW = height * WIDTH / ROW * Math.abs(camera.projectionMatrix.elements[0]) / (2 * labelDepth);
    const halfH = height * Math.abs(camera.projectionMatrix.elements[5]) / (2 * labelDepth);
    const left = this.labelPosition.x - halfW, right = this.labelPosition.x + halfW;
    const bottom = this.labelPosition.y - halfH, top = this.labelPosition.y + halfH;
    let lift = 0;
    for (let j = 0; j < this.labelCount; j++) {
      const b = j * 4;
      if (left < this.labelBounds[b + 1] + .008 && right > this.labelBounds[b] - .008
        && bottom + lift < this.labelBounds[b + 3] + .008 && top + lift > this.labelBounds[b + 2] - .008) {
        lift = this.labelBounds[b + 3] + .009 - bottom; j = -1;
      }
    }
    this.billboard.position.addScaledVector(this.cameraUp, lift * labelDepth / Math.abs(camera.projectionMatrix.elements[5]));
    const b = this.labelCount * 4;
    this.labelBounds[b] = left; this.labelBounds[b + 1] = right;
    this.labelBounds[b + 2] = bottom + lift; this.labelBounds[b + 3] = top + lift;
    const tag = this.tagPool[this.labelCount];
    tag.id = id; tag.left = (left + 1) * innerWidth / 2; tag.right = (right + 1) * innerWidth / 2;
    tag.top = (1 - top - lift) * innerHeight / 2; tag.bottom = (1 - bottom - lift) * innerHeight / 2;
    // Write in place: emptying the array each frame would make V8 allocate a new backing store.
    this.tagBoxes[this.labelCount] = tag;
  }

  dispose(): void {
    this.group.remove(this.cars, this.labels);
    this.cars.geometry.dispose(); this.labels.geometry.dispose();
    (this.cars.material as THREE.Material).dispose(); (this.labels.material as THREE.Material).dispose();
    this.cars.dispose(); this.labels.dispose(); this.atlas.dispose();
    this.ctx.canvas.width = this.ctx.canvas.height = 1;
    this.drawn = 0;
  }
}
