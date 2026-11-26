import * as THREE from 'three';
import type { Terrain } from './terrain';
import { pushOut, type Pushable, type Solid } from './parked';
import { LAND_LIGHT } from './shaders';
import { farmPhase } from './far-turbines';
import { CURVE_GLSL } from './far-rules';
import {
  FAR_TURBINES, TURBINE_FLASH_DUTY, TURBINE_FLASH_RATE, WIND_HEADING, mastLightClass, obstructionLights, rotorPhase, rotorRate,
  towerWidthScale, turbineOperating, wireWorldHeight, type Mast, type TallFile, type TallPoint,
} from './tall-rules';
import { mergeStraitTall } from './tall-strait';

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${CURVE_GLSL}
uniform float farCurveOn;
varying vec3 vWorld;
#ifdef BEACON
attribute float beaconPhase;
attribute vec2 beaconSpec;
attribute vec3 beaconColor;
uniform vec2 tallViewport;
uniform float tallPixelRatio;
varying float vBeaconPhase;
varying vec2 vBeaconSpec;
varying vec3 vBeaconColor;
varying vec2 vBeaconUv;
#endif
#ifdef LATTICE
varying vec2 vLattice;
#endif
#ifdef ROTOR
attribute vec2 motion;
uniform float tallTime;
#endif
void main() {
 vec3 p = position;
 #ifdef BEACON
 vBeaconPhase = beaconPhase;
 vBeaconSpec = beaconSpec;
 vBeaconColor = beaconColor;
 vBeaconUv = position.xy * 2.0;
 p = vec3(0.0);
 #endif
 #ifdef LATTICE
 vLattice=uv;
 #endif
 #ifdef ROTOR
 float angle = motion.x + motion.y * tallTime;
 float c=cos(angle), s=sin(angle);
 p.xy = mat2(c,s,-s,c) * p.xy;
 #endif
 vec4 world = modelMatrix * instanceMatrix * vec4(p,1.0);
 vWorld = world.xyz;
 gl_Position = projectionMatrix * viewMatrix * world;
 float drop = farDrop(world.xz - cameraPosition.xz) * farCurveOn;
 if (drop > 0.0) gl_Position -= projectionMatrix * viewMatrix * vec4(0.0,drop,0.0,0.0);
 #ifdef BEACON
 float rad = length(vec3(instanceMatrix[0].xyz));
 float worldPx = rad * projectionMatrix[1][1] * tallViewport.y / max(gl_Position.w, 0.1);
 float px = max(worldPx * 2.5, 8.0 * tallPixelRatio);
 gl_Position.xy += position.xy * (2.0 * px) * gl_Position.w / tallViewport;
 #endif
 #include <logdepthbuf_vertex>
}`;
const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${LAND_LIGHT}
uniform vec3 tallColour;
uniform vec2 tallLight;
uniform float tallFog;
#ifdef BEACON
uniform float tallTime;
varying float vBeaconPhase;
varying vec2 vBeaconSpec;
varying vec3 vBeaconColor;
varying vec2 vBeaconUv;
#endif
varying vec3 vWorld;
#ifdef LATTICE
varying vec2 vLattice;
#endif
void main() {
 #include <logdepthbuf_fragment>
 #ifdef LATTICE
 // Two crossed, tapered planes with procedural lattice holes. No phone texture or extra draw.
 float cell=fract(vLattice.y*8.0), x=vLattice.x;
 if(min(x,1.0-x)>.055 && min(cell,1.0-cell)>.035 && abs(x-cell)>.035 && abs(1.0-x-cell)>.035) discard;
 #endif
 #ifdef BEACON
 if (vBeaconSpec.y < 0.99 && fract(tallTime * vBeaconSpec.x + vBeaconPhase) > vBeaconSpec.y) discard;
 float r = length(vBeaconUv);
 if (r > 1.0) discard;
 float core = 1.0 - smoothstep(0.16, 0.42, r);
 float halo = pow(max(0.0, 1.0 - r), 2.4) * 0.55;
 float alpha = clamp(core + halo, 0.0, 1.0);
 if (alpha < 0.02) discard;
 vec3 colour = vBeaconColor;
 vec3 fogged = applyFog(colour,vWorld,cameraPosition);
 vec3 lit = mix(colour, fogged, 0.12);
 gl_FragColor = vec4(lit * (0.80 + 0.65 * core), alpha);
 #else
 vec3 colour = tallColour;
 if (tallFog < 0.99) {
  vec3 fn = cross(dFdx(vWorld), dFdy(vWorld));
  float fnLen = length(fn);
  vec3 n = fnLen > 1e-6 ? fn / fnLen : vec3(0.0, 1.0, 0.0);
  if (!gl_FrontFacing) n = -n;
  float sunLit = max(dot(n, normalize(sunDir)), 0.0);
  colour *= skyColor * tallLight.x + sunColor * (0.04 + tallLight.y * sunLit);
 } else {
  colour *= skyColor * tallLight.x + sunColor * tallLight.y;
 }
 vec3 fogged = applyFog(colour,vWorld,cameraPosition);
 float fogMix = mix(tallFog, 1.0, smoothstep(0.00005, 0.00025, fogDensity));
 gl_FragColor = vec4(mix(colour, fogged, fogMix), 1.0);
 #endif
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;
const WIRE_VERT = VERT.replace('modelMatrix * instanceMatrix *', 'modelMatrix *');

// Linear colours: keep red at unit gain so ACES tone mapping preserves saturated aviation red; boost white strobes.
const linearRgb = (hex: number, gain = 1): readonly [number, number, number] => { const c = new THREE.Color(hex); return [c.r * gain, c.g * gain, c.b * gain]; };
const RED_FLASH = linearRgb(0xff1807);
const RED_STEADY = linearRgb(0xe81406);
const WHITE_STROBE = linearRgb(0xffffff, 2.5);

/** A few instanced draws for the whole region. Blades rotate on the GPU: one time uniform per frame. */
export class TallLandmarks {
  readonly group = new THREE.Group();
  readonly solids: Solid[] = [];
  readonly time = { value: 0 };
  private readonly seating: { p: TallPoint; base: TallPoint; mesh: THREE.InstancedMesh; index: number; offset: number; height: number; scale: [number, number, number]; yaw: number }[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly wires: { mesh: THREE.LineSegments; x: number; z: number; radius: number }[] = [];
  private nextSeat = 0;
  readonly turbineCount: number;

  /** `coarse` (the phone's Coarse far views): no draws at all. The turbines' solids stay; FarTurbines draws them. */
  constructor(rawData: TallFile, private terrain: Terrain, low: boolean, shared: Record<string, THREE.IUniform>, dark: boolean, showFar = FAR_TURBINES, coarse = false) {
    const data = coarse ? rawData : mergeStraitTall(rawData);
    const village = terrain.manifest.village;
    // Unknown far ground is retained as null in data; do not float a turbine on a guessed sea-level base.
    const turbines = [...data.turbines, ...(showFar ? data.far : [])].filter(p => p.ground !== null);
    this.turbineCount = turbines.length;
    if (coarse) {
      // FarTurbines' shaft scales with the rotor diameter: the solid is as wide as the drawn base.
      for (const p of turbines) { const radius = Math.max(p.hub, p.diameter) * .023; this.solids.push({ x: p.e - village[0], z: village[1] - p.n, half: radius, halfWidth: radius, heading: 0 }); }
      this.low = low;
      return;
    }
    const material = (colour: number | THREE.Color, defines: Record<string, number> = {}, light: readonly [number, number] = [0.65, 0.24], fog = 1) => new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, defines,
      uniforms: {
        ...shared,
        tallPixelRatio: shared.tallPixelRatio ?? { value: 1 },
        tallTime: this.time,
        tallColour: { value: colour instanceof THREE.Color ? colour : new THREE.Color(colour) },
        tallLight: { value: new THREE.Vector2(light[0], light[1]) },
        tallFog: { value: fog },
      },
      side: THREE.DoubleSide,
      transparent: !!defines.BEACON,
      depthWrite: !defines.BEACON,
    });
    let beaconMat: THREE.ShaderMaterial | null = null;
    const getBeaconMat = () => (beaconMat ??= material(0xff1807, { BEACON: 1 }));
    const make = (geometry: THREE.BufferGeometry, mat: THREE.ShaderMaterial, count: number) => {
      const mesh = new THREE.InstancedMesh(geometry, mat, count);
      // Whole root square: never use a roadside draw-distance cutoff. Camera far plane and LAND_LIGHT fog apply.
      mesh.frustumCulled = false; mesh.name = 'tall'; this.group.add(mesh); return mesh;
    };
    const seat = (mesh: THREE.InstancedMesh, index: number, p: TallPoint, offset: number, scale: [number, number, number], yaw = 0, base = p) => {
      this.seating.push({ p, base, mesh, index, offset, height: NaN, scale, yaw });
    };
    const makeBeaconGeometry = (phases: Float32Array, specs: Float32Array, colours: Float32Array) => {
      const g = new THREE.PlaneGeometry(1, 1);
      g.setAttribute('beaconPhase', new THREE.InstancedBufferAttribute(phases, 1));
      g.setAttribute('beaconSpec', new THREE.InstancedBufferAttribute(specs, 2));
      g.setAttribute('beaconColor', new THREE.InstancedBufferAttribute(colours, 3));
      return g;
    };
    if (turbines.length) {
      // Bright painted white surfaces with 3D sun+sky shading (matches far-turbines.ts across the root edge).
      const white = material(new THREE.Color().setRGB(0.95, 0.96, 0.97), {}, [0.42, 0.42], 0.62);
      const shafts = make(new THREE.CylinderGeometry(.012, .023, 1, low ? 5 : 8, 1, true).translate(0, .5, 0), white, turbines.length);
      const nacelles = make(new THREE.BoxGeometry(1, 1, 1), white, turbines.length);
      // Three tapered blades in one template, real radius 1, in the local XY plane.
      const vertices: number[] = [];
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI * 2 / 3, c = Math.cos(a), s = Math.sin(a);
        const blade = [[-.025, .06], [.055, .2], [.012, 1], [-.012, .96], [-.035, .22]];
        for (let k = 1; k < blade.length - 1; k++) for (const p of [blade[0], blade[k], blade[k + 1]]) vertices.push(p[0] * c - p[1] * s, p[0] * s + p[1] * c, 0);
      }
      const blade = new THREE.BufferGeometry(); blade.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      const motion = new Float32Array(turbines.length * 2);
      turbines.forEach((p, i) => { motion[i * 2] = rotorPhase(p.e, p.n); motion[i * 2 + 1] = turbineOperating(p) ? rotorRate(p.diameter) : 0; });
      blade.setAttribute('motion', new THREE.InstancedBufferAttribute(motion, 2));
      const rotors = make(blade, material(new THREE.Color().setRGB(0.98, 0.99, 1.0), { ROTOR: 1 }, [0.42, 0.42], 0.62), turbines.length);
      rotors.name = 'tall-rotors';
      // Keep turbine beacons first in this.group so far-views-browser (tupper-night) finds them before tall-beacons.
      // Only operating turbines show flashing red aviation lights at night; built/uncommissioned ones stay dark.
      const litTurbines = dark ? turbines.filter(turbineOperating) : [];
      const lights = litTurbines.length ? (() => {
        const phases = new Float32Array(litTurbines.map(p => farmPhase(p.farm ?? 'regional')));
        const specs = new Float32Array(litTurbines.length * 2);
        const colours = new Float32Array(litTurbines.length * 3);
        for (let i = 0; i < litTurbines.length; i++) {
          specs[i * 2] = TURBINE_FLASH_RATE; specs[i * 2 + 1] = TURBINE_FLASH_DUTY;
          colours[i * 3] = RED_FLASH[0]; colours[i * 3 + 1] = RED_FLASH[1]; colours[i * 3 + 2] = RED_FLASH[2];
        }
        const mesh = make(makeBeaconGeometry(phases, specs, colours), getBeaconMat(), litTurbines.length);
        mesh.name = 'tall-turbine-beacons';
        return mesh;
      })() : null;
      // Local +z faces the incoming WSW wind. North is -world z.
      const yaw = Math.PI - WIND_HEADING;
      let lightIndex = 0;
      turbines.forEach((p, i) => {
        const radius = p.hub * .023;
        this.solids.push({ x: p.e - village[0], z: village[1] - p.n, half: radius, halfWidth: radius, heading: 0 });
        seat(shafts, i, p, 0, [p.hub, p.hub, p.hub]);
        seat(nacelles, i, p, p.hub, [3, 2.4, 5], yaw);
        // Move the rotor 3 m upwind of the tower, in front of the nacelle.
        const rotorPoint = { ...p, e: p.e + Math.sin(WIND_HEADING) * 3, n: p.n + Math.cos(WIND_HEADING) * 3 };
        seat(rotors, i, rotorPoint, p.hub, [p.diameter / 2, p.diameter / 2, 1], yaw, p);
        if (lights && turbineOperating(p)) seat(lights, lightIndex++, p, p.hub + 1.6, [.65, .65, .65]);
      });
    }

    // Deduplicate shared junction supports (e.g. L7004/L7003 joining the causeway double-circuit tower) keeping the tallest tower.
    type PowerTower = Mast & { yaw: number };
    const posKey = (p: TallPoint) => `${Math.round(p.e * 10)},${Math.round(p.n * 10)}`;
    const powerByPos = new Map<string, PowerTower>();
    for (const l of data.lines) {
      l.towers.forEach((p, i) => {
        const a = l.towers[Math.max(0, i - 1)], b = l.towers[Math.min(l.towers.length - 1, i + 1)];
        const yaw = Math.atan2(a.e - b.e, b.n - a.n);
        const key = posKey(p);
        const prev = powerByPos.get(key);
        if (!prev) powerByPos.set(key, { ...p, yaw });
        else {
          const taller = p.height > prev.height ? { ...p, yaw } : prev;
          const light = prev.light ?? p.light;
          powerByPos.set(key, light ? { ...taller, light } : taller);
        }
      });
    }
    const power = [...powerByPos.values()];

    const mastGeometry = (transmission: boolean) => {
      const positions: number[] = [], uvs: number[] = [];
      // 3-sided open strut prism (6 triangles per bar, no hidden end caps) keeps full lattice detail within triangle budgets.
      const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3(), alt = new THREE.Vector3(1, 0, 0);
      const bar = (a: readonly number[], b: readonly number[], radius: number) => {
        dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        if (dir.lengthSq() < 1e-12) return;
        dir.normalize();
        u.crossVectors(dir, Math.abs(dir.y) > 0.95 ? alt : up).normalize();
        v.crossVectors(dir, u).normalize();
        const r = radius * 0.65;
        const ring = (pt: readonly number[]) => [0, 1, 2].map(k => {
          const ang = k * Math.PI * 2 / 3, ca = Math.cos(ang) * r, sa = Math.sin(ang) * r;
          return [pt[0] + u.x * ca + v.x * sa, pt[1] + u.y * ca + v.y * sa, pt[2] + u.z * ca + v.z * sa];
        });
        const ra = ring(a), rb = ring(b);
        for (let k = 0; k < 3; k++) {
          const n = (k + 1) % 3;
          for (const p of [ra[k], ra[n], rb[n], ra[k], rb[n], rb[k]]) { positions.push(p[0], p[1], p[2]); uvs.push(0, 0); }
        }
      };
      const width = transmission ? .13 : .035;
      const corner = (side: number, y: number): [number, number, number] => { const w = width * (1 - .75 * y); return [side & 1 ? w : -w, y, side & 2 ? w : -w]; };
      if (low) {
        for (let axis = 0; axis < 2; axis++) {
          const p = [[-width, 0, 0], [width, 0, 0], [width * .25, 1, 0], [-width * .25, 1, 0]];
          const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
          for (const i of [0, 1, 2, 0, 2, 3]) { positions.push(axis ? p[i][2] : p[i][0], p[i][1], axis ? p[i][0] : p[i][2]); uvs.push(...uv[i]); }
        }
      } else {
        const steps = 6;
        const faces: readonly [number, number][] = [[0, 1], [1, 3], [3, 2], [2, 0]];
        for (let s = 0; s < 4; s++) bar(corner(s, 0), corner(s, 1), .007);
        for (const [a, b] of faces) {
          for (let k = 0; k < steps; k++) {
            const y = k / steps, top = (k + 1) / steps;
            bar(corner(a, y), corner(b, top), .004);
            bar(corner(a, top), corner(b, y), .004);
          }
        }
      }
      if (transmission) { for (const y of [.82, 1]) bar([-.25, y, 0], [.25, y, 0], .016); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      return g;
    };

    const nightLights: { p: TallPoint; offset: number; size: number; phase: number; rate: number; duty: number; colour: readonly [number, number, number] }[] = [];
    const metal = data.towers.length || power.length ? material(0x8b979e, low ? { LATTICE: 1 } : {}) : null;

    for (const [list, isPower] of [[data.towers, false], [power, true]] as const) {
      if (!list.length || !metal) continue;
      const mesh = make(mastGeometry(isPower), metal, list.length);
      list.forEach((p, i) => {
        const wScale = isPower ? towerWidthScale(p.height, p.kind) : p.height;
        seat(mesh, i, p, 0, [wScale, p.height, wScale], 'yaw' in p ? Number(p.yaw) : 0);
        const half = wScale * (isPower ? .13 : .035);
        this.solids.push({ x: p.e - village[0], z: village[1] - p.n, half, halfWidth: half, heading: 0 });
        if (dark) {
          const lightClass = isPower ? p.light : (p.light ?? mastLightClass(p.height));
          if (lightClass) {
            // Synchronise the Auld's Cove crossing towers together across the Strait; seed other masts by position.
            const phase = lightClass === 'W' ? 0 : rotorPhase(p.e, p.n) / (Math.PI * 2);
            for (const lamp of obstructionLights(lightClass)) {
              const isStrobe = lamp.kind === 'white-strobe';
              const isFlash = lamp.kind === 'red-flash';
              nightLights.push({
                p,
                offset: p.height * lamp.frac,
                size: isStrobe ? 1.5 : isFlash ? 1.0 : 0.72,
                phase,
                rate: isStrobe ? 2 / 3 : isFlash ? 0.5 : 0,
                duty: isStrobe ? 0.14 : isFlash ? 0.28 : 1.0,
                colour: isStrobe ? WHITE_STROBE : isFlash ? RED_FLASH : RED_STEADY,
              });
            }
          }
        }
      });
    }

    if (dark && nightLights.length) {
      const n = nightLights.length;
      const phases = new Float32Array(n), specs = new Float32Array(n * 2), colours = new Float32Array(n * 3);
      nightLights.forEach((l, i) => {
        phases[i] = l.phase;
        specs[i * 2] = l.rate; specs[i * 2 + 1] = l.duty;
        colours[i * 3] = l.colour[0]; colours[i * 3 + 1] = l.colour[1]; colours[i * 3 + 2] = l.colour[2];
      });
      const lightMesh = make(makeBeaconGeometry(phases, specs, colours), getBeaconMat(), n);
      lightMesh.name = 'tall-beacons';
      nightLights.forEach((l, i) => seat(lightMesh, i, l.p, l.offset, [l.size, l.size, l.size]));
    }

    // Static sag curves: merged LineSegments sharing one wire shader material. Desktop draws every wire, so one draw;
    // LOW hides wires past 1800 m, so it keeps 2.5 km buckets it can switch off.
    const wireBuckets = new Map<string, number[]>();
    for (const line of data.lines) {
      const tiers = line.circuits === 2 ? [0.82, 1.0] : [1.0];
      for (let k = 0; k < line.spans.length; k++) {
        const a = line.towers[k], b = line.towers[k + 1], span = line.spans[k];
        const steps=(span.ground.length-1)*(low?1:2);
        const dx = b.e - a.e, dn = b.n - a.n, len = Math.hypot(dx, dn); if (!len) continue;
        const spreadA = a.kind === 'crossing' ? 11 : line.circuits === 2 ? 5.5 : 4;
        const spreadB = b.kind === 'crossing' ? 11 : line.circuits === 2 ? 5.5 : 4;
        const mx = (a.e + b.e) * 0.5 - village[0], mz = village[1] - (a.n + b.n) * 0.5;
        const bucketKey = low ? `${Math.floor(mx / 2500)},${Math.floor(mz / 2500)}` : 'all';
        let positions = wireBuckets.get(bucketKey);
        if (!positions) { positions = []; wireBuckets.set(bucketKey, positions); }
        // A shared junction support is drawn once at the tallest height; every line's wires end at that drawn top.
        const hA = powerByPos.get(posKey(a))?.height ?? a.height, hB = powerByPos.get(posKey(b))?.height ?? b.height;
        for (const tier of tiers) {
          const attachA = a.kind === 'crossing' ? hA * 0.82 : hA * tier;
          const attachB = b.kind === 'crossing' ? hB * 0.82 : hB * tier;
          for (const side of [-1, 0, 1]) for (let j = 0; j < steps; j++) for (const t of [j / steps, (j + 1) / steps]) {
            // Stretch ground only; keep structure sizes and sag in real metres.
            const index = t * (span.ground.length - 1), idx = Math.min(span.ground.length - 2, Math.floor(index));
            const ground = THREE.MathUtils.lerp(span.ground[idx], span.ground[idx + 1], index - idx);
            const spread = THREE.MathUtils.lerp(spreadA, spreadB, t);
            positions.push(
              a.e + dx * t - village[0] + dn / len * side * spread,
              wireWorldHeight(a.ground! + attachA, b.ground! + attachB, span.sag, t, ground, terrain.exag, terrain.seaLevel),
              village[1] - a.n - dn * t + dx / len * side * spread,
            );
          }
        }
      }
    }
    if (wireBuckets.size) {
      const wireMat = material(0x535d64); wireMat.vertexShader = WIRE_VERT;
      for (const positions of wireBuckets.values()) {
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const mesh = new THREE.LineSegments(g, wireMat); this.group.add(mesh);
        g.computeBoundingSphere(); const c = g.boundingSphere!.center;
        this.wires.push({ mesh, x: c.x, z: c.z, radius: g.boundingSphere!.radius });
      }
    }
    this.low = low;
    this.update(new THREE.PerspectiveCamera(), 0);
  }
  private readonly low: boolean;
  private bakedHeight(h: number): number { return h > this.terrain.seaLevel ? this.terrain.seaLevel + (h - this.terrain.seaLevel) * this.terrain.exag : h; }
  update(camera: THREE.Camera, seconds: number): void {
    this.time.value = seconds;
    // A bounded seating pass twice a second, no allocations and no per-rotor CPU transform per frame.
    if (seconds >= this.nextSeat) {
      this.nextSeat = seconds + .5;
      for (const s of this.seating) {
        const x = s.p.e - this.terrain.manifest.village[0], z = this.terrain.manifest.village[1] - s.p.n;
        const bx = s.base.e - this.terrain.manifest.village[0], bz = this.terrain.manifest.village[1] - s.base.n;
        const height = 'hub' in s.base ? this.terrain.heightAt(bx, bz) ?? this.bakedHeight(s.base.ground ?? 0) : this.bakedHeight(s.base.ground ?? 0);
        if (height === s.height) continue; s.height = height;
        this.dummy.position.set(x, height + s.offset, z); this.dummy.rotation.set(0, s.yaw, 0); this.dummy.scale.set(...s.scale); this.dummy.updateMatrix();
        s.mesh.setMatrixAt(s.index, this.dummy.matrix); s.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    for (const w of this.wires) w.mesh.visible = !this.low||Math.hypot(camera.position.x-w.x,camera.position.z-w.z)<1800+w.radius;
  }
  resolveSolids(car: Pushable): void { pushOut(car, this.solids); }
}
