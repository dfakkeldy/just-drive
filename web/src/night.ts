/**
 * The night look (light study only): head lamps, street and yard lamps, a twilight and star sky.
 *
 * main.ts builds none of this unless `nightPalette` (night-rules.ts) says the study's sun is below the horizon.
 *  - Things drawn with three.js materials (cars, rails, the bull, trees, buildings, poles) are lit by two real
 *    SpotLights at the head lamps.
 *  - The land, the grass and the coast rocks have their own shaders, which know no three.js lights. They get the same
 *    two cones and the lamp pools through one small GLSL function, added to their programs only on a night page (the
 *    same way paved.ts adds its layer). Daytime programs are never changed.
 *  - The sky dome swaps to a twilight and star material: one draw, as before. At dusk it carries the warm horizon band
 *    and the pink band of night-rules.ts DUSK.
 */
import * as THREE from 'three';
import type { Rig } from './vehicle-spec';
import { lampHead, milkyWay, nearestLamps, townLight, type NightPalette, type Place, type Pole } from './night-rules';
import { directionFromAngles } from './sun';

/** A lit lens: the car's lamp lens materials take this emissive; a batched lamp (Rig.headlamp) its colour times the strength. */
const LENS = { colour: [1, .9, .72] as const, strength: 5 };
/** Halogen low beam, as in the staged guard rail pictures (tools/guardrail-night-shots.mjs): wide, soft, aimed down. */
const BEAM = { outer: .95, penumbra: .9, candela: 520, colour: 0xfff0d0, aimDrop: 1.04, aimAhead: 40, ahead: .35 };
/** Street lamps: LED cobra heads (cool white). Yard lamps: old sodium dusk-to-dawn lights (warm). */
const STREET = { colour: [1.0, .93, .82] as const, power: 150, glow: 1.4, size: 3.6 };
// A yard lamp's glow is drawn larger than its head: across a dark valley a farm light reads as a soft spot, not a speck.
const YARD = { colour: [1.0, .66, .32] as const, power: 110, glow: 1.5, size: 6 };
const LAMP_HEIGHT = 7.82, LAMP_REACH = 700;
/** How far a lamp's glow is seen: a farm light shows across the valley. */
const GLOW_REACH = 4000;
/** A waiting lamp looks for its fine ground every this many renders (each look builds a surface object). */
const PLACE_EVERY = 8;
const CODE_CAR_LAMPS = [new THREE.Vector3(-.68, .84, -2.12), new THREE.Vector3(.68, .84, -2.12)];

const LAND_LAMPS = (pools: number) => /* glsl */ `
uniform vec3 nightLampA;
uniform vec3 nightLampB;
uniform vec3 nightLampDir;
uniform vec4 nightLamp;      // cos outer, cos inner, candela, lamps on (0, 1 or 2)
uniform vec4 nightPool[${pools}];      // lamp head xyz, power (0 = unused)
uniform vec3 nightPoolColour[${pools}];
// Light that the night's lamps add to a surface. upright 0: ground (a low beam reaches far along it, and is held
// flat for the first 9 m so the road at the bumper is not the brightest spot);
// upright 1: blades and faces (the inverse square).
vec3 nightLight(vec3 world, vec3 n, float upright) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    if (float(i) >= nightLamp.w) break;
    vec3 l = (i == 0 ? nightLampA : nightLampB) - world;
    float d = length(l);
    l /= d;
    float lit = smoothstep(nightLamp.x, nightLamp.y, dot(-l, nightLampDir));
    float face = mix(smoothstep(-0.02, 0.10, dot(n, l)), 1.0, upright * 0.5);
    sum += vec3(1.0, 0.92, 0.78) * lit * face
      * mix(nightLamp.z / 45.0 / pow(max(d, 9.0), 1.2), nightLamp.z * 0.45 / (5.0 * max(d * d, 6.0)), upright);
  }
  for (int i = 0; i < ${pools}; i++) {
    vec4 pool = nightPool[i];
    if (pool.w <= 0.0) continue;
    vec3 l = pool.xyz - world;
    float d2 = max(dot(l, l), 4.0), d = sqrt(d2);
    // Inverse square and the surface's angle to the lamp (a flat road gets light/d² × height/d).
    float face = mix(max(dot(n, l / d), 0.0), 1.0, upright * 0.5);
    sum += nightPoolColour[i] * pool.w * face / d2 * (1.0 - smoothstep(40.0, 65.0, d));
  }
  return sum;
}
`;

/** Shader text: the night function goes before main(), and one line adds its light before the colour is made. */
function patch(source: string, anchor: string, line: string, pools: number): string {
  const main = source.indexOf('void main()');
  if (main < 0 || !source.includes(anchor)) throw new Error('night look: a land shader changed; its anchor is gone');
  const out = source.slice(0, main) + LAND_LAMPS(pools) + source.slice(main);
  return out.replace(anchor, line + '\n' + anchor);
}
export const NIGHT_ANCHORS = {
  ground: ['  vec3 col = albedo * light * (1.0 - 0.25 * under);', '  light += nightLight(vWorld, n, 0.0);'],
  grass: ['  vec3 col = applyFog(paint * light, vWorld, cameraPosition);', '  light += nightLight(vWorld, vNormal, 1.0);'],
  coast: ['  vec3 col=applyFog(mineral*light,vWorld,cameraPosition);', '  light+=nightLight(vWorld,n,0.5);'],
} as const;

/** The land's half: uniforms (in `shared` before the terrain is made, so every tile spreads them) and the patches. */
export class NightShading {
  readonly pools: number;
  readonly uniforms: Record<string, THREE.IUniform>;
  constructor(readonly palette: NightPalette, readonly low: boolean) {
    this.pools = low ? 4 : 8;
    this.uniforms = {
      nightLampA: { value: new THREE.Vector3() }, nightLampB: { value: new THREE.Vector3() },
      nightLampDir: { value: new THREE.Vector3(0, 0, -1) },
      nightLamp: { value: new THREE.Vector4(Math.cos(BEAM.outer), Math.cos(BEAM.outer * (1 - BEAM.penumbra)), BEAM.candela, 0) },
      nightPool: { value: Array.from({ length: this.pools }, () => new THREE.Vector4()) },
      nightPoolColour: { value: Array.from({ length: this.pools }, () => new THREE.Vector3()) },
    };
  }
  private apply(material: THREE.ShaderMaterial, kind: keyof typeof NIGHT_ANCHORS): void {
    const [anchor, line] = NIGHT_ANCHORS[kind];
    material.fragmentShader = patch(material.fragmentShader, anchor, line, this.pools);
    Object.assign(material.uniforms, this.uniforms);
  }
  applyGround(material: THREE.ShaderMaterial): void { this.apply(material, 'ground'); }
  applyGrass(material: THREE.ShaderMaterial): void { this.apply(material, 'grass'); }
  applyCoast(material: THREE.ShaderMaterial): void { this.apply(material, 'coast'); }
}

/** Head lamp centres in the rig's own space (forward is -z), measured from its lamp parts. Empty: the ride has none. */
export function headlampPoints(root: THREE.Object3D): THREE.Vector3[] {
  root.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert(), local = new THREE.Matrix4(), v = new THREE.Vector3();
  const points: THREE.Vector3[] = [];
  root.traverse(part => {
    if (!(part instanceof THREE.Mesh)) return;
    const name = (part.material as THREE.Material).name;
    if (part.name !== 'Yellowed headlamp' && name !== 'Head lamp' && name !== 'LED lenses' && name !== 'Ice LED') return;
    local.multiplyMatrices(inverse, part.matrixWorld);
    const position = part.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) points.push(v.fromBufferAttribute(position, i).applyMatrix4(local).clone());
  });
  // The code car (car.ts) merges its lamp lenses into one draw per material, so its lamps have no part of their own.
  // Its head lamp surface spans y .75–.92 and z -1.98 to -2.17 at x ±.60–.75: these are that surface's centres.
  if (!points.length) return root.userData.tailLampFit ? CODE_CAR_LAMPS.map(p => p.clone()) : [];
  // Only the front: a white lens at the back (a reversing lamp) is not a head lamp.
  const front = Math.min(...points.map(p => p.z));
  const lit = points.filter(p => p.z < front + .5);
  const sides = [lit.filter(p => p.x < 0), lit.filter(p => p.x >= 0)].filter(s => s.length);
  return sides.map(s => s.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(s.length));
}

export interface NightLamp extends Place {
  /** The head's height on the fine ground (null until it loads): the pool and a yard lamp's head wait for it. */
  y: number | null;
  /** The glow's height: from whatever ground is loaded, so a far farm light shows before its fine ground does. */
  glowY: number | null;
  /** The tile level that `glowY` came from: a finer tile in memory places the glow again. */
  glowLevel: number;
  colour: readonly [number, number, number]; power: number; glow: number; size: number;
}
interface NightParts {
  scene: THREE.Scene; sky: THREE.Mesh; sunDir: THREE.Vector3; car: Rig; fog: THREE.IUniform;
  heightAt(x: number, z: number): number | null; level(x: number, z: number): number;
  streets: readonly Pole[]; yards: readonly Pole[]; village: Place; when: Date; lat: number; lon: number;
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w;
}`;
const SKY_FRAG = /* glsl */ `
uniform vec3 fogColor;
uniform vec3 nightZenith;
uniform vec3 nightSun;       // the real sun, below the horizon
uniform vec3 nightGlowColour;
uniform float nightGlow;
uniform vec3 nightBand;      // the pink band above the horizon (night-rules.ts DUSK)
uniform vec3 nightHorizon;   // the warm band on the horizon
uniform vec2 nightBands;     // their strengths: warm, pink
uniform float nightStars;
uniform vec3 nightGalaxy;    // galactic north pole
uniform vec3 nightCentre;    // galactic centre
uniform vec4 nightTown;      // direction to town (xz), glow, unused
varying vec3 vDir;
float starHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(starHash(i), starHash(i + vec3(1,0,0)), f.x), mix(starHash(i + vec3(0,1,0)), starHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(starHash(i + vec3(0,0,1)), starHash(i + vec3(1,0,1)), f.x), mix(starHash(i + vec3(0,1,1)), starHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// Invented stars: one chance per cell of a fine grid on the sky; a few are bright, most are faint.
vec3 stars(vec3 d) {
  vec3 p = d * 260.0, cell = floor(p);
  float h = starHash(cell);
  if (h < 0.982) return vec3(0.0);
  vec3 centre = cell + 0.25 + 0.5 * vec3(starHash(cell + 7.1), starHash(cell + 3.7), starHash(cell + 1.3));
  float r = length(p - centre), w = max(fwidth(p.x) + fwidth(p.y), 0.04);
  float core = 1.0 - smoothstep(0.0, w * 1.2, r);
  float mag = pow((h - 0.982) / 0.018, 6.0);
  vec3 tint = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.86, 0.68), starHash(cell + 9.9));
  return tint * core * (0.10 + 3.2 * mag);
}
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 col = mix(fogColor, nightZenith, pow(h, 0.55));
  vec2 across = normalize(d.xz + 1e-5), sunFlat = normalize(nightSun.xz + 1e-5);
  float toward = max(dot(across, sunFlat), 0.0);
  // Dusk: a warm band on the horizon and a pink band above it, all around the sky but strongest on the sun's side.
  float side = 0.4 + 0.6 * toward * toward, above = (h - 0.15) / 0.09;   // no pow: its base is negative low down
  col = mix(col, nightBand, nightBands.y * side * exp(-above * above));
  col = mix(col, nightHorizon, nightBands.x * side * exp(-h * 18.0));
  // Twilight: the bright glow where the sun went down.
  col += nightGlowColour * nightGlow * 0.6 * pow(toward, 3.0) * exp(-h * 9.0);
  // Town: a faint orange-grey dome over the street lights.
  float townward = max(dot(across, normalize(nightTown.xy + 1e-5)), 0.0);
  col += vec3(0.060, 0.042, 0.026) * nightTown.z * pow(townward, 2.0) * exp(-h * 9.0);
  // The Milky Way: a soft, uneven band, brightest toward the galactic centre.
  float band = exp(-pow(dot(d, nightGalaxy) / 0.17, 2.0)) * (0.55 + 0.45 * noise3(d * 9.0)) * (0.6 + 0.4 * noise3(d * 23.0 + 4.0));
  band *= 0.6 + 0.4 * max(dot(d, nightCentre), 0.0);
  float clear = smoothstep(0.02, 0.30, d.y) * nightStars;
  col += vec3(0.085, 0.095, 0.125) * band * clear;
  col += stars(d) * clear;
  // Airglow: the moonless sky is a little brighter near the horizon, so hills and tree lines stand dark against it.
  col += vec3(0.010, 0.014, 0.026) * exp(-h * 5.0) * nightStars;
  if (d.y < 0.0) col = fogColor * (1.0 + d.y * 0.6);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const GLOW_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 glowColour;
attribute float glowSize;
varying vec3 vColour;
void main() {
  vColour = glowColour;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * view;
  // At least 4 screen pixels (the size is in drawing-buffer pixels; a phone has 2 or 3 of those per screen pixel).
  gl_PointSize = clamp(glowSize * projectionMatrix[1][1] * 0.5 * nightViewport / max(-view.z, 1.0), 4.0 * nightPixel, 64.0 * nightPixel);
  #include <logdepthbuf_vertex>
}`;
const GLOW_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
varying vec3 vColour;
void main() {
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  // A soft halo and a solid core: a far lamp still outshines the brightest star.
  float a = exp(-r * 5.0) + 1.5 * exp(-r * 30.0);
  gl_FragColor = vec4(vColour * a, 1.0);
}`;

/** The same dusk and star dome can also be drawn for a still sky preview. */
export function nightSkyMaterial(palette: NightPalette, fog: THREE.IUniform, sunDir: THREE.Vector3,
  when: Date, lat: number, lon: number): THREE.ShaderMaterial {
  const galaxy = milkyWay(when, lat, lon);
  const uniforms = {
    fogColor: fog,
    nightZenith: { value: new THREE.Color().setRGB(...palette.zenith) },
    nightSun: { value: sunDir.clone() },
    nightGlowColour: { value: new THREE.Color(.95, .42, .16) },
    nightGlow: { value: palette.glow },
    nightBand: { value: new THREE.Color().setRGB(...palette.band) },
    nightHorizon: { value: new THREE.Color().setRGB(...palette.horizon) },
    nightBands: { value: new THREE.Vector2(palette.warm, palette.pink) },
    nightStars: { value: palette.stars },
    nightGalaxy: { value: directionFromAngles(galaxy.pole.az, galaxy.pole.el) },
    nightCentre: { value: directionFromAngles(galaxy.centre.az, galaxy.centre.el) },
    nightTown: { value: new THREE.Vector4() },
  };
  return new THREE.ShaderMaterial({
    name: 'night sky', vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms,
    side: THREE.BackSide, depthWrite: false,
  });
}

/** Everything a night page adds beyond the land shaders. Built once; `update` runs before each render. */
export class Night {
  readonly lamps: NightLamp[];
  readonly beams: THREE.SpotLight[] = [];
  private readonly heads: THREE.Vector3[] = [];
  private activeCar: Rig | null = null;
  /** Each rig's head-lamp lens materials with their day values, so a parked rig's lamps go dark again. */
  private readonly lampLenses = new WeakMap<Rig, { material: THREE.MeshStandardMaterial; colour: THREE.Color; intensity: number }[]>();
  /** Every part a beam was ever hung on (rig roots, and a batched lamp's own part): a rollback may hang an old one back. */
  private readonly beamParents = new Set<THREE.Object3D>();
  private readonly beamWorld = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly aimWorld = new THREE.Vector3();
  private readonly glow: THREE.Points;
  private readonly glowPositions: THREE.BufferAttribute;
  private readonly glowColours: THREE.BufferAttribute;
  private readonly glowSizes: THREE.BufferAttribute;
  private readonly skyUniforms: Record<string, THREE.IUniform>;
  private readonly yardHeads: THREE.InstancedMesh | null;
  private readonly near: number[] = [];
  private readonly nearDistance: number[] = [];
  private readonly ready: NightLamp[] = [];
  private readonly town = { stars: 1, glow: 0 };
  /** Frames since the last try at placing lamps: the ground under a waiting lamp is looked up only every few frames. */
  private placeWait = 0;
  private readonly lampLights: THREE.PointLight[] = [];
  private readonly townLamps: number;
  private dayPreview = false;

  constructor(private readonly shading: NightShading, private readonly parts: NightParts) {
    const { palette, low } = shading;
    const { scene, car } = parts;
    // The three.js lights take the night colours: the sun is set and the sky fill is the night blue.
    scene.traverse(o => {
      // Its strength falls too: the day's 3.2 on the night blue left trees and the cab brighter than the land.
      if (o instanceof THREE.HemisphereLight) { o.groundColor.setRGB(...palette.ground); o.intensity *= 1 - .45 * palette.level; }
    });

    this.setCar(car);

    // Desktop: the two nearest lamps also light three.js materials (houses, poles, trees). A fixed count of lights,
    // so moving them never makes a shader rebuild. Phones go without.
    if (!low) for (let i = 0; i < 2; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 65, 2);
      light.name = 'night lamp ' + i;
      scene.add(light);
      this.lampLights.push(light);
    }
    // Lamps on poles: the street lamps the props already draw (in towns only), and the invented yard lamps.
    this.lamps = [
      ...parts.streets.map(p => ({ ...lampHead(p), y: null, glowY: null, glowLevel: -1, colour: STREET.colour, power: STREET.power, glow: STREET.glow, size: STREET.size })),
      ...parts.yards.map(p => ({ ...lampHead(p), y: null, glowY: null, glowLevel: -1, colour: YARD.colour, power: YARD.power, glow: YARD.glow, size: YARD.size })),
    ];
    this.townLamps = parts.streets.length;
    // A yard lamp's arm and head (a street lamp's are already part of its pole).
    if (parts.yards.length) {
      const arm = new THREE.BoxGeometry(.07, .07, 1.5).translate(0, 7.9, .75), head = new THREE.BoxGeometry(.3, .16, .36).translate(0, 7.82, 1.5);
      const geometry = mergeBoxes(arm, head);
      const material = new THREE.MeshLambertMaterial({ color: 0x6f716c, emissive: new THREE.Color(1, .62, .3), emissiveIntensity: 1.6 });
      this.yardHeads = new THREE.InstancedMesh(geometry, material, parts.yards.length);
      this.yardHeads.name = 'night yard lamps';
      this.yardHeads.count = 0;
      this.yardHeads.frustumCulled = false;
      scene.add(this.yardHeads);
    } else this.yardHeads = null;
    // Glow around each lamp head: one draw for all of them.
    const glowGeometry = new THREE.BufferGeometry();
    this.glowPositions = new THREE.BufferAttribute(new Float32Array(this.lamps.length * 3), 3);
    glowGeometry.setAttribute('position', this.glowPositions);
    // Filled in the same packed order as the positions, as each lamp finds its ground (update below).
    this.glowColours = new THREE.BufferAttribute(new Float32Array(this.lamps.length * 3), 3);
    this.glowSizes = new THREE.BufferAttribute(new Float32Array(this.lamps.length), 1);
    glowGeometry.setAttribute('glowColour', this.glowColours);
    glowGeometry.setAttribute('glowSize', this.glowSizes);
    glowGeometry.setDrawRange(0, 0);
    this.glow = new THREE.Points(glowGeometry, new THREE.ShaderMaterial({
      name: 'night lamp glow', vertexShader: 'uniform float nightViewport;\nuniform float nightPixel;\n' + GLOW_VERT, fragmentShader: GLOW_FRAG,
      uniforms: { nightViewport: { value: 1000 }, nightPixel: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.glow.name = 'night lamp glow';
    this.glow.frustumCulled = false;
    scene.add(this.glow);

    // The sky: twilight, town glow, the Milky Way and stars. The fog colour is its horizon, so far land meets it.
    const skyMaterial = nightSkyMaterial(palette, parts.fog, parts.sunDir, parts.when, parts.lat, parts.lon);
    this.skyUniforms = skyMaterial.uniforms;
    parts.sky.material = skyMaterial;
  }

  /** Rebind the night beams when the player selects another rig. World lamps are unchanged. */
  setCar(car: Rig): void {
    this.beamParents.add(car.root);
    if (car.headlamp) this.beamParents.add(car.headlamp.beam);
    this.cleanBeams();
    if (this.activeCar === car) return;
    if (this.activeCar) for (const lens of this.lampLenses.get(this.activeCar) ?? []) {
      lens.material.emissive.copy(lens.colour); lens.material.emissiveIntensity = lens.intensity;
    }
    this.activeCar?.headlamp?.lens.setRGB(0, 0, 0);
    for (const beam of this.beams) { beam.removeFromParent(); beam.target.removeFromParent(); beam.dispose(); }
    this.beams.length = 0; this.activeCar = car; this.parts.car = car;
    const { low } = this.shading;
    // A batched lamp: one cone, hung on its own part so it turns with the bars, and its lens lit.
    const own = car.headlamp;
    if (own) {
      const beam = new THREE.SpotLight(BEAM.colour, BEAM.candela, 0, BEAM.outer, BEAM.penumbra, 2), aim = new THREE.Object3D();
      beam.name = 'night head lamp';
      aim.position.set(0, -BEAM.aimDrop, -BEAM.aimAhead);
      own.beam.add(beam, aim); beam.target = aim;
      this.beams.push(beam);
      own.lens.setRGB(...LENS.colour).multiplyScalar(LENS.strength);
    }
    // Head lamps: two cones on the desktop, one (at the middle, twice as strong) on phones.
    this.heads.length = 0; if (!own) this.heads.push(...headlampPoints(car.root));
    const heads = low && this.heads.length === 2 ? [this.heads[0].clone().add(this.heads[1]).multiplyScalar(.5)] : this.heads;
    for (const at of heads) {
      const beam = new THREE.SpotLight(BEAM.colour, BEAM.candela * (this.heads.length / heads.length), 0, BEAM.outer, BEAM.penumbra, 2);
      const aim = new THREE.Object3D();
      beam.name = 'night head lamp';
      // Just ahead of the lens: a light at the lens itself burns the bonnet lip white (inverse square at ~0 m).
      beam.position.set(at.x, at.y - .05, at.z - BEAM.ahead); aim.position.set(at.x, at.y - BEAM.aimDrop, at.z - BEAM.aimAhead);
      car.root.add(beam, aim); beam.target = aim;
      this.beams.push(beam);
    }
    const u = this.shading.uniforms;
    (u.nightLamp.value as THREE.Vector4).w = this.beams.length;
    (u.nightLamp.value as THREE.Vector4).z = BEAM.candela * Math.max(1, this.heads.length / Math.max(1, heads.length));
    let lenses = this.lampLenses.get(car);
    if (!lenses) {
      // The car's own lamps glow: brighter head lamps, and tail lamps on.
      lenses = [];
      car.root.traverse(part => {
        if (!(part instanceof THREE.Mesh) || !(part.material instanceof THREE.MeshStandardMaterial)) return;
        const material = part.material;
        if (part.name === 'Yellowed headlamp' || material.name === 'Head lamp' || material.name === 'LED lenses' || material.name === 'Ice LED') {
          const own = material.clone();
          part.material = own;
          lenses!.push({ material: own, colour: own.emissive.clone(), intensity: own.emissiveIntensity });
        }
      });
      for (const brake of car.brakeLights) {
        const material = brake.material as THREE.MeshStandardMaterial;
        if (material.emissiveIntensity !== undefined) material.emissiveIntensity = Math.max(material.emissiveIntensity, 1.1);
      }
      this.lampLenses.set(car, lenses);
    }
    for (const lens of lenses) { lens.material.emissive.setRGB(...LENS.colour); lens.material.emissiveIntensity = LENS.strength; }
  }

  private cleanBeams(): void {
    // A fleet rollback can restore an older root hierarchy. Retire its old rendering lights again.
    for (const parent of this.beamParents) for (let i = parent.children.length - 1; i >= 0; i--) {
      const part = parent.children[i];
      if (part instanceof THREE.SpotLight && part.name === 'night head lamp' && !this.beams.includes(part)) {
        part.target.removeFromParent(); part.removeFromParent(); part.dispose();
      }
    }
  }

  private readonly yardMatrix = new THREE.Matrix4();
  private readonly yardTurn = new THREE.Euler();
  private readonly glowSize = new THREE.Vector2();

  setDayPreview(day: boolean): void {
    if (this.dayPreview === day) return;
    this.dayPreview = day;
    this.glow.visible = !day;
    if (this.yardHeads) (this.yardHeads.material as THREE.MeshLambertMaterial).emissiveIntensity = day ? 0 : 1.6;
    (this.shading.uniforms.nightLamp.value as THREE.Vector4).w = day ? 0 : this.beams.length;
  }

  /** Before every render: the land's copy of the beams follows the car, and the nearest lamps light their pools. */
  update(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    this.cleanBeams();
    const u = this.shading.uniforms, car = this.parts.car.root;
    car.updateMatrixWorld();
    for (let i = 0; i < this.beams.length; i++) this.beams[i].getWorldPosition(this.beamWorld[i]);
    if (this.beams.length) {
      (u.nightLampA.value as THREE.Vector3).copy(this.beamWorld[0]);
      (u.nightLampB.value as THREE.Vector3).copy(this.beamWorld[this.beams.length > 1 ? 1 : 0]);
      this.beams[0].target.getWorldPosition(this.aimWorld);
      (u.nightLampDir.value as THREE.Vector3).copy(this.aimWorld).sub(this.beamWorld[0]).normalize();
    }
    // Lamp heights wait for the fine ground (as the props do), then stay. A glow takes any loaded ground first.
    const at = camera.position;
    let placed = false;
    if (++this.placeWait >= PLACE_EVERY && this.ready.length < this.lamps.length) for (let i = (this.placeWait = 0); i < this.lamps.length; i++) {
      const lamp = this.lamps[i];
      if (lamp.y !== null) continue;
      const far = Math.hypot(lamp.x - at.x, lamp.z - at.z);
      if (far >= GLOW_REACH) continue;
      const level = this.parts.level(lamp.x, lamp.z);
      if (far < LAMP_REACH && level >= 6) {
        const ground = this.parts.heightAt(lamp.x, lamp.z);
        if (ground !== null) { lamp.y = lamp.glowY = ground + LAMP_HEIGHT; lamp.glowLevel = level; this.ready.push(lamp); placed = true; }
      } else if (level > lamp.glowLevel) {
        // A coarse tile can be tens of metres off on these hills: each finer tile that loads places the glow again.
        const ground = this.parts.heightAt(lamp.x, lamp.z);
        if (ground !== null) { lamp.glowY = ground + LAMP_HEIGHT; lamp.glowLevel = level; placed = true; }
      }
    }
    const pools = u.nightPool.value as THREE.Vector4[], colours = u.nightPoolColour.value as THREE.Vector3[];
    const ready = this.ready;
    nearestLamps(ready, at.x, at.z, pools.length, LAMP_REACH, this.near, this.nearDistance);
    for (let i = 0; i < pools.length; i++) {
      const lamp = !this.dayPreview && i < this.near.length ? ready[this.near[i]] : null;
      if (lamp) { pools[i].set(lamp.x, lamp.y!, lamp.z, lamp.power); colours[i].set(...lamp.colour); }
      else pools[i].w = 0;
    }
    for (let i = 0; i < this.lampLights.length; i++) {
      const light = this.lampLights[i], lamp = !this.dayPreview && i < this.near.length ? ready[this.near[i]] : null;
      // three.js divides a diffuse surface's light by π; the land's own term does not.
      // The scene's matrices were updated before this hook, so the moved light updates its own.
      if (lamp) { light.position.set(lamp.x, lamp.y! - .3, lamp.z); light.updateMatrixWorld(); light.color.setRGB(...lamp.colour); light.intensity = lamp.power * Math.PI; }
      else light.intensity = 0;
    }
    renderer.getDrawingBufferSize(this.glowSize);
    const glowUniforms = (this.glow.material as THREE.ShaderMaterial).uniforms;
    glowUniforms.nightViewport.value = this.glowSize.y;
    glowUniforms.nightPixel.value = renderer.getPixelRatio();
    const town = townLight(Math.hypot(this.parts.village.x - at.x, this.parts.village.z - at.z), this.townLamps, this.town);
    this.skyUniforms.nightStars.value = this.shading.palette.stars * town.stars;
    (this.skyUniforms.nightTown.value as THREE.Vector4).set(this.parts.village.x - at.x, this.parts.village.z - at.z, town.glow * this.shading.palette.level, 0);
    if (!placed) return;
    // A lamp found its ground: its glow (and a yard lamp's head) is drawn from now on.
    let glows = 0, yards = 0;
    for (let i = 0; i < this.lamps.length; i++) {
      const lamp = this.lamps[i];
      if (lamp.glowY === null) continue;
      this.glowColours.setXYZ(glows, lamp.colour[0] * lamp.glow, lamp.colour[1] * lamp.glow, lamp.colour[2] * lamp.glow);
      this.glowSizes.setX(glows, lamp.size);
      this.glowPositions.setXYZ(glows++, lamp.x, lamp.glowY - .12, lamp.z);
    }
    this.glowPositions.needsUpdate = this.glowColours.needsUpdate = this.glowSizes.needsUpdate = true;
    this.glow.geometry.setDrawRange(0, glows);
    if (this.yardHeads) {
      for (let i = this.townLamps; i < this.lamps.length; i++) {
        const lamp = this.lamps[i], pole = this.parts.yards[i - this.townLamps];
        if (lamp.y === null) continue;
        this.yardTurn.set(0, Math.PI - pole.heading * Math.PI / 180, 0);
        this.yardMatrix.makeRotationFromEuler(this.yardTurn).setPosition(pole.x, lamp.y - LAMP_HEIGHT, pole.z);
        this.yardHeads.setMatrixAt(yards++, this.yardMatrix);
      }
      this.yardHeads.count = yards;
      this.yardHeads.instanceMatrix.needsUpdate = true;
    }
  }
}

function mergeBoxes(...boxes: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [], normals: number[] = [], index: number[] = [];
  for (const box of boxes) {
    const base = positions.length / 3, p = box.getAttribute('position'), n = box.getAttribute('normal');
    for (let i = 0; i < p.count; i++) { positions.push(p.getX(i), p.getY(i), p.getZ(i)); normals.push(n.getX(i), n.getY(i), n.getZ(i)); }
    for (const i of box.getIndex()!.array) index.push(base + i);
    box.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setIndex(index);
  return out;
}
