// What a drift looks like: dust, gravel or tyre smoke thrown from the rear wheels, and a small meter that shows only while
// the ride slides. The slide itself is drift-rules.ts and vehicle.ts; the tyre sound is engine-sound-rules.ts.
//
// Cost: one instanced draw, drawn only while a puff is alive (LOW: a smaller pool, fewer puffs); the meter is three DOM
// nodes, written only when its rounded text or width changes. Nothing is made per frame.

import * as THREE from 'three';
import { setHud } from './hud-text';
import type { DriftSpec } from './drift-rules';

/** What the feedback reads from the driven ride. */
export interface Sliding {
  x: number; y: number; z: number; heading: number; airborne: boolean; surfaceName: string;
  readonly spec: { readonly wheelbase: number; readonly track: number; readonly rearTrack?: number; readonly drift?: DriftSpec };
  readonly drift: { readonly active: boolean; readonly shown: boolean; readonly angle: number; readonly seconds: number; readonly length: number; slide(spec: DriftSpec | undefined): number };
}

/** Puff colours by surface (vehicle.ts SURFACES names); pavement and concrete give pale tyre smoke. */
export const DUST: Readonly<Record<string, number>> = Object.freeze({
  gravel: 0xa29a88, 'dirt track': 0x8f7759, washboard: 0x9c9079, grass: 0x6d6a45, brush: 0x6d6a45, 'rail trail': 0xb3a990,
  pavement: 0xd6d8da, concrete: 0xd6d8da,
});
/** Puffs per second per rear wheel with the slide fully open; pavement smokes less than loose ground throws. */
export const PUFFS = Object.freeze({ loose: 22, firm: 9, low: .5 });
const LIFE = .9;

/** A soft round puff: white, alpha falling from the middle to nothing at the rim. Made once. */
function puffTexture(): THREE.DataTexture {
  const n = 32, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = Math.hypot(x + .5 - n / 2, y + .5 - n / 2) / (n / 2), a = Math.max(0, 1 - r), i = (y * n + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(255 * a * a * (3 - 2 * a));
  }
  const t = new THREE.DataTexture(data, n, n); t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

const CSS = `
#driftMeter{position:fixed;z-index:3;left:50%;top:26vh;transform:translateX(-50%);
 display:flex;align-items:center;gap:7px;padding:4px 9px;border-radius:6px;background:var(--panel,rgba(8,14,20,.72));
 border-bottom:2px solid var(--maple,#d0632e);font:700 12px/1.3 var(--mono,ui-monospace,Menlo,Consolas,monospace);
 letter-spacing:.06em;color:var(--ink,#eef2f6);pointer-events:none;white-space:nowrap;font-variant-numeric:tabular-nums}
#driftMeter[hidden]{display:none}
#driftMeter i{display:block;width:64px;height:6px;border-radius:3px;background:#ffffff26;overflow:hidden}
#driftMeter i b{display:block;height:100%;width:0;background:var(--maple,#d0632e)}
body.tcOn #driftMeter{font-size:11px;gap:5px;padding:4px 7px}
body.tcOn #driftMeter i{width:40px}
body.indoorOn #driftMeter{display:none}
`;

export class DriftFeedback {
  readonly mesh: THREE.InstancedMesh;
  /** Live puffs now: for the checks. */
  alive = 0;
  private readonly size: number;
  private readonly pos: Float32Array; private readonly vel: Float32Array;
  private readonly age: Float32Array; private readonly scale: Float32Array;
  private next = 0; private due = 0; private shown = false;
  private readonly dummy = new THREE.Object3D();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly color = new THREE.Color();
  private readonly meter: HTMLElement | null = null;
  private readonly bar: HTMLElement | null = null;
  private readonly text: HTMLElement | null = null;
  private barWidth = ''; private meterShown = false; private meterDeg = -1; private meterLength = -1;

  constructor(private readonly low: boolean, hud: boolean) {
    this.size = low ? 24 : 56;
    this.pos = new Float32Array(this.size * 3); this.vel = new Float32Array(this.size * 3);
    this.age = new Float32Array(this.size).fill(LIFE); this.scale = new Float32Array(this.size);
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
      // Unlit: a puff faces the camera, so a lit one would be dark whenever the sun is behind it.
      new THREE.MeshBasicMaterial({ color: 0xe6e6e6, map: puffTexture(), transparent: true, opacity: .75, depthWrite: false, fog: true }), this.size);
    this.mesh.name = 'Drift dust from the rear wheels';
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 2;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.size; i++) { this.mesh.setMatrixAt(i, this.zero); this.mesh.setColorAt(i, this.color.set(0xffffff)); }
    if (!hud) return;
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
    this.meter = Object.assign(document.createElement('div'), { id: 'driftMeter', hidden: true });
    this.meter.setAttribute('aria-label', 'Drift');
    const label = Object.assign(document.createElement('span'), { textContent: 'DRIFT' });
    const track = document.createElement('i'); this.bar = track.appendChild(document.createElement('b'));
    this.text = document.createElement('span');
    this.meter.append(label, track, this.text);
    document.body.appendChild(this.meter);
  }

  /** Once a frame after the camera moved. `driving`: the player drives now (not the title card, the fly view or indoors). */
  update(dt: number, v: Sliding, camera: THREE.Camera, driving: boolean): void {
    const spec = v.spec.drift, sliding = driving && v.drift.shown && !v.airborne && !!spec;
    this.showMeter(sliding, v, spec);
    if (dt <= 0) return;
    if (sliding) this.emit(dt, v, spec!);
    else this.due = 0;
    if (!this.alive && !this.shown) return;
    let alive = 0;
    for (let i = 0; i < this.size; i++) {
      if (this.age[i] >= LIFE) continue;
      const a = this.age[i] += dt;
      if (a >= LIFE) { this.mesh.setMatrixAt(i, this.zero); continue; }
      alive++;
      const k = i * 3, drag = Math.max(0, 1 - 2.2 * dt);
      this.vel[k] *= drag; this.vel[k + 2] *= drag; this.vel[k + 1] = this.vel[k + 1] * drag + .4 * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = a / LIFE, s = this.scale[i] * (.45 + 1.6 * t) * (1 - t * t);
      this.dummy.position.set(this.pos[k], this.pos[k + 1], this.pos[k + 2]);
      this.dummy.quaternion.copy(camera.quaternion);
      this.dummy.scale.set(s, s, s); this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.alive = alive;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.shown = alive > 0; this.mesh.visible = this.shown;
  }

  /** Puffs from each rear wheel, thrown back and out of the slide. */
  private emit(dt: number, v: Sliding, spec: DriftSpec): void {
    const slide = v.drift.slide(spec), firm = v.surfaceName === 'pavement' || v.surfaceName === 'concrete';
    this.due += dt * slide * (firm ? PUFFS.firm : PUFFS.loose) * (this.low ? PUFFS.low : 1) * 2;
    const fx = Math.sin(v.heading), fz = -Math.cos(v.heading), rx = Math.cos(v.heading), rz = Math.sin(v.heading);
    const back = v.spec.wheelbase / 2, half = (v.spec.rearTrack ?? v.spec.track) / 2, side = Math.sign(v.drift.angle) || 1;
    this.color.set(DUST[v.surfaceName] ?? DUST.gravel);
    while (this.due >= 1) {
      this.due--;
      const i = this.next, k = i * 3, wheel = (i & 1) ? 1 : -1, j = (i * 7919 % 97) / 97 - .5;
      this.next = (this.next + 1) % this.size;
      this.pos[k] = v.x - fx * back + rx * half * wheel; this.pos[k + 1] = v.y + .25; this.pos[k + 2] = v.z - fz * back + rz * half * wheel;
      // Back along the body and out to the side the tail swings toward (away from the nose).
      const out = -side * (1.4 + j), up = firm ? .5 : 1.3 + j;
      this.vel[k] = -fx * (2.2 + j) + rx * out; this.vel[k + 1] = up; this.vel[k + 2] = -fz * (2.2 + j) + rz * out;
      this.age[i] = 0; this.scale[i] = (firm ? 1.1 : 1.5) * (1 + .3 * j) * (.6 + .4 * slide);
      this.mesh.setColorAt(i, this.color);
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
      this.alive++;
    }
  }

  private showMeter(sliding: boolean, v: Sliding, spec: DriftSpec | undefined): void {
    const meter = this.meter;
    if (!meter || !this.bar || !this.text) return;
    if (this.meterShown !== sliding) { this.meterShown = sliding; meter.hidden = !sliding; }
    if (!sliding || !spec) return;
    const deg = Math.round(Math.abs(v.drift.angle) * 180 / Math.PI), length = Math.round(v.drift.length);
    if (deg !== this.meterDeg || length !== this.meterLength) { this.meterDeg = deg; this.meterLength = length; setHud(this.text, `${deg}° · ${length} m`); }
    const width = `${Math.round(Math.min(1, Math.abs(v.drift.angle) / spec.maxAngle) * 20) * 5}%`;
    if (width !== this.barWidth) { this.barWidth = width; this.bar.style.width = width; }
  }
}
