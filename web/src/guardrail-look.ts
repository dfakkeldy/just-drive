import * as THREE from 'three';
import { RAIL } from './guardrail-rules';
import type { DentShape } from './guardrail-damage';

/** What the rail looks like: its section, its timber and its metal. Placement and collision live elsewhere.
 *  Metres. Heights are above the smoothed road edge, never above the bumpy ground at one post. */
export const LOOK = {
  top: 0.71,          // top edge of the beam above the road edge (the surveyed rail is about 0.7 m)
  depth: 0.312,       // face depth of a W-beam
  post: 0.18,         // square timber post
  postProud: 0.03,    // the post top stands this far above the beam
  maxPostLeg: 1.05,   // prefer short legs; reaching the drawn soil takes priority
  bury: 0.5,          // normal embedment; reduced where a shorter grounded leg suffices
  block: 0.14,        // timber blockout between post and beam
  blockTall: 0.35,
  smooth: 5,          // rail samples either side in the height filter (binomial: about 3 m standard deviation)
  berm: 0.25,         // ground at the rail line may stand this far above the road edge before it lifts the rail
  endClear: 0.176,     // terminal middle: half the beam depth plus 2cm, so its bottom meets the soil
} as const;

/** W-beam section, top to bottom: [metres above the middle of the beam, metres toward the traffic].
 *  Two crowns stand toward the road; the valley between them and both edges lie back against the post. */
const W_FULL: readonly (readonly [number, number])[] = [[.156, 0], [.108, .078], [.066, .078], [.03, .012], [-.03, .012], [-.066, .078], [-.108, .078], [-.156, 0]];
const W_LOW: readonly (readonly [number, number])[] = [[.156, 0], [.087, .074], [0, .012], [-.087, .074], [-.156, 0]];
/** Timber kinds in the `rail` attribute. Steel carries its crush there (0 to 0.95). */
export const RAIL_POST = 1, RAIL_BLOCK = 2, RAIL_METAL_POST = -1;

export interface BeamSpan {
  ax: number; az: number; bx: number; bz: number;   // the rail line: the back of the beam
  ya: number; yb: number;                           // smoothed road-edge height at both ends
  ua: number; ub: number;                           // metres along the rail; posts and splices sit at whole post pitches
  side: number;                                     // +1 or -1, as in RailSpan: which side of the road the rail stands on
  pieces: number;                                   // lengthwise pieces: 1 for a straight span, more through a dent
  capStart?: boolean; capEnd?: boolean;
  shape: (t: number) => DentShape;                  // t runs 0 to 1 from a to b, and is asked a little outside that
  drop: (t: number) => number;                      // metres a run end is turned down
}

/** One indexed mesh for a whole chunk of rail: smooth normals across the rolled section, flat faces on the timber. */
export class RailMesher {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly rail: number[] = [];
  private readonly idx: number[] = [];
  private readonly corner: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  constructor(readonly low: boolean) {}
  get triangles(): number { return this.idx.length / 3; }

  beam(s: BeamSpan): void {
    const W = this.low ? W_LOW : W_FULL, P = W.length, n = s.pieces;
    const dx = s.bx - s.ax, dz = s.bz - s.az, len = Math.hypot(dx, dz);
    const ox = -dz / len * s.side, oz = dx / len * s.side;   // away from the road
    const mid = LOOK.top - LOOK.depth / 2;
    // One section before the span and one after it, so that the shading follows a bend across a joint.
    const sec: number[] = [], crush: number[] = [];
    for (let j = -1; j <= n + 1; j++) {
      const t = j / n, d = s.shape(t), c = Math.cos(d.roll), sn = Math.sin(d.roll);
      const x = s.ax + dx * t, y = s.ya + (s.yb - s.ya) * t + mid - s.drop(t) - d.sag, z = s.az + dz * t;
      crush.push(d.crush);
      for (let k = 0; k < P; k++) {
        // A hit folds the top edge down and presses the crowns flat; a leaning post rolls the whole face back.
        // The fold dies out down the upper crown, so that the section never turns inside out.
        const v = W[k][0] + d.lip * (k === 0 ? 1 : k === 1 ? .55 : k === 2 && !this.low ? .2 : 0), o = W[k][1] * (1 - .8 * d.crush);
        const out = d.bend - (o * c - v * sn);
        sec.push(x + ox * out, y + v * c + o * sn, z + oz * out);
      }
    }
    const base = this.pos.length / 3, at = (j: number, k: number) => ((j + 1) * P + k) * 3;
    for (let j = 0; j <= n; j++) for (let k = 0; k < P; k++) {
      const p = at(j, k), f = at(j + 1, k), r = at(j - 1, k), lo = at(j, Math.min(P - 1, k + 1)), hi = at(j, Math.max(0, k - 1));
      const tx = sec[f] - sec[r], ty = sec[f + 1] - sec[r + 1], tz = sec[f + 2] - sec[r + 2];
      const sx = sec[lo] - sec[hi], sy = sec[lo + 1] - sec[hi + 1], sz = sec[lo + 2] - sec[hi + 2];
      const nx = (ty * sz - tz * sy) * s.side, ny = (tz * sx - tx * sz) * s.side, nz = (tx * sy - ty * sx) * s.side;
      const l = Math.hypot(nx, ny, nz) || 1;
      this.pos.push(sec[p], sec[p + 1], sec[p + 2]); this.nor.push(nx / l, ny / l, nz / l);
      this.rail.push(s.ua + (s.ub - s.ua) * j / n, W[k][0], Math.min(.95, crush[j + 1]));
    }
    for (const end of [0, n]) {
      if (end === 0 ? !s.capStart : !s.capEnd) continue;
      const start = this.pos.length / 3, normal = end === 0 ? -1 : 1;
      // A narrow end plate closes the exposed rolled section in the existing chunk draw.
      for (const k of [0, 1, P - 2, P - 1]) {
        const p = at(end, k);
        this.pos.push(sec[p], sec[p + 1], sec[p + 2]); this.nor.push(normal * dx / len, 0, normal * dz / len);
        this.rail.push(end === 0 ? s.ua : s.ub, W[k][0], 0);
      }
      if (normal * s.side < 0) this.idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
      else this.idx.push(start, start + 2, start + 1, start, start + 3, start + 2);
    }
    // The traffic face is the front face, so that the stored normals light it and the flipped ones light the back.
    for (let j = 0; j < n; j++) for (let k = 0; k < P - 1; k++) {
      const a = base + j * P + k, b = a + P, c = b + 1, d = a + 1;
      if (s.side > 0) this.idx.push(a, b, c, a, c, d); else this.idx.push(a, c, b, a, d, c);
    }
  }

  /** A square timber post behind the beam. `lean` moves its top away from the road (a post knocked back). */
  post(cx: number, cz: number, dx: number, dz: number, ox: number, oz: number, bottom: number, top: number, lean = 0, metal = false): void {
    this.prism(cx, cz, dx, dz, ox, oz, metal ? .035 : LOOK.post / 2, metal ? .05 : LOOK.post / 2,
      bottom, top, lean, metal ? RAIL_METAL_POST : RAIL_POST, 5);
  }
  /** The blockout between post and beam: only its two cheeks and its top are ever seen. */
  block(cx: number, cz: number, dx: number, dz: number, ox: number, oz: number, bottom: number, top: number): void {
    this.prism(cx, cz, dx, dz, ox, oz, LOOK.post / 2, LOOK.block / 2, bottom, top, 0, RAIL_BLOCK, 3);
  }

  /** An upright timber along (dx,dz) and (ox,oz). Faces in order: both cheeks, the top, then front and back. */
  private prism(cx: number, cz: number, dx: number, dz: number, ox: number, oz: number, ha: number, ho: number,
    bottom: number, top: number, lean: number, kind: number, faces: number): void {
    const q = this.corner;
    for (let i = 0; i < 8; i++) {
      const a = i & 1 ? 1 : -1, o = i & 2 ? 1 : -1, up = i & 4, shift = up ? lean : 0;
      q[i][0] = cx + dx * ha * a + ox * (ho * o + shift); q[i][1] = up ? top : bottom; q[i][2] = cz + dz * ha * a + oz * (ho * o + shift);
    }
    const midY = (bottom + top) / 2, tall = top - bottom;
    // Corner numbers: bit 0 along the rail, bit 1 away from the road, bit 2 up.
    const sides = [[1, 3, 7, 5], [2, 0, 4, 6], [4, 5, 7, 6], [0, 1, 5, 4], [3, 2, 6, 7]];
    for (let f = 0; f < faces; f++) {
      const [a, b, c, d] = sides[f], base = this.pos.length / 3;
      const ex = q[b][0] - q[a][0], ey = q[b][1] - q[a][1], ez = q[b][2] - q[a][2], fx = q[d][0] - q[a][0], fy = q[d][1] - q[a][1], fz = q[d][2] - q[a][2];
      let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      // Outward: away from the middle of the timber, whatever the corner order.
      const mx = (q[a][0] + q[c][0]) / 2 - cx - ox * lean / 2, my = (q[a][1] + q[c][1]) / 2 - midY, mz = (q[a][2] + q[c][2]) / 2 - cz - oz * lean / 2;
      const flip = nx * mx + ny * my + nz * mz < 0;
      if (flip) { nx = -nx; ny = -ny; nz = -nz; }
      for (const i of [a, b, c, d]) {
        this.pos.push(q[i][0], q[i][1], q[i][2]); this.nor.push(nx, ny, nz);
        // Grain runs down the timber: metres below its top, and metres across, shifted so that no two faces match.
        const across = f === 2 ? (i & 1 ? ha : -ha) : f < 2 ? (i & 2 ? ho : -ho) : (i & 1 ? ha : -ha);
        this.rail.push(f === 2 ? (i & 2 ? .02 : 0) : top - q[i][1] > tall / 2 ? tall : 0, across + f * .37 + cx * .13 + cz * .29, kind);
      }
      if (flip) this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2); else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  geometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('rail', new THREE.Float32BufferAttribute(this.rail, 3));
    geo.setIndex(this.idx);
    geo.computeBoundingSphere();
    return geo;
  }
}

const PITCH = RAIL.postPitch.toFixed(3);
/** Noise without a texture. Cell numbers wrap, so that a rail seven kilometres along a road keeps full precision. */
const RAIL_PARS = /* glsl */`
varying vec3 vRail;
float railHash(vec2 p) { p = mod(p, 289.0); return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float railNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(railHash(i), railHash(i + vec2(1.0, 0.0)), f.x), mix(railHash(i + vec2(0.0, 1.0)), railHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
#ifndef RAIL_LOW
// Zinc spangle: every flake is one crystal with its own tone. The nearest of nine jittered flake centres wins.
float railSpangle(vec2 p) {
  vec2 i = floor(p), f = fract(p); float best = 8.0, tone = 0.5;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), c = i + g;
    float d = length(g + vec2(railHash(c), railHash(c + 57.0)) - f);
    if (d < best) { best = d; tone = railHash(c + 113.0); }
  }
  return tone;
}
#endif
`;
/** After <color_fragment>: the surface colour, in linear light. vRail = (metres along, metres above the beam's middle, kind). */
const RAIL_ALBEDO = /* glsl */`
float railTimber = step(0.97, vRail.z);
float railShine = 0.0;
if (railTimber > 0.5) {
  // Weathered spruce: grey-brown, long grain down the member, a few dark checks.
  float grain = railNoise(vec2(vRail.y * 85.0, vRail.x * 2.5));
  float blotch = railNoise(vec2(vRail.y * 9.0 + 3.0, vRail.x * 1.3 + 11.0));
  vec3 wood = mix(vec3(0.175, 0.140, 0.104), vec3(0.400, 0.345, 0.275), grain * 0.55 + blotch * 0.45);
  wood *= 1.0 - 0.4 * smoothstep(0.72, 0.9, railNoise(vec2(vRail.y * 40.0 + 5.0, vRail.x * 0.7)));
  diffuseColor.rgb = wood;
} else if (vRail.z < -0.5) {
  diffuseColor.rgb = vec3(0.29, 0.30, 0.29);
  railShine = 0.7;
} else {
  float u = vRail.x, v = vRail.y, crush = vRail.z;
  float panel = floor(u / ${PITCH});
  float tone = 0.93 + 0.14 * railHash(vec2(panel, 3.0));
  float lower = smoothstep(0.156, -0.156, v);
  // Old zinc runs in long drips, darker toward the bottom; the valley of the W holds the dirt.
  float streak = railNoise(vec2(u * 9.0, v * 1.5 + panel));
  tone *= 1.0 - 0.24 * streak * streak * (0.35 + 0.65 * lower);
  tone *= 1.0 - 0.42 * (1.0 - smoothstep(0.028, 0.075, abs(v)));
  // Under a flat sky the W still has to read: faces that look up catch the light, faces that look down hold shade.
  float skyward = smoothstep(0.098, 0.118, v) + smoothstep(-0.076, -0.056, v) - smoothstep(-0.04, -0.02, v);
  float earthward = smoothstep(0.02, 0.04, v) - smoothstep(0.056, 0.076, v) + 1.0 - smoothstep(-0.118, -0.098, v);
  tone *= 1.0 + 0.10 * skyward - 0.14 * earthward;
  vec3 rust = vec3(0.150, 0.062, 0.028);
  float foot = smoothstep(-0.105, -0.156, v) * (0.2 + 0.8 * railNoise(vec2(u * 2.3, 1.0)));
  float torn = crush * smoothstep(0.085, 0.15, v);
  float stain = foot * 0.6 + torn * 0.75;
  #ifndef RAIL_LOW
  // Fine things show only where one pixel is smaller than they are; further off they melt into the mean tone.
  float fine = 1.0 - smoothstep(0.006, 0.03, fwidth(u) + fwidth(v));
  // Flakes a few centimetres across, taller than wide, with ragged edges: three tones, as hot-dip zinc shows.
  vec2 ragged = vec2(railNoise(vec2(u * 60.0, v * 45.0)), railNoise(vec2(u * 60.0 + 9.0, v * 45.0 + 4.0))) - 0.5;
  float flake = floor(railSpangle(vec2(u * 26.0, v * 16.0 + panel * 7.0) + ragged * 0.7) * 3.0) * 0.5;
  tone *= mix(1.0, 0.87 + 0.25 * flake, fine * 0.9);
  // A splice at every post: the lap edge, eight splice bolts, the post bolt, and the rust they weep.
  float du = u - ${PITCH} * floor(u / ${PITCH} + 0.5);
  vec2 q = vec2(abs(du) - 0.054, abs(abs(v) - 0.0865) - 0.0385);
  float bolt = max(1.0 - smoothstep(0.008, 0.012, length(q)), 1.0 - smoothstep(0.011, 0.015, length(vec2(du, v))));
  float weep = max(1.0 - smoothstep(0.010, 0.04, length(q * vec2(1.0, 0.55))), (1.0 - smoothstep(0.0, 0.075, abs(du))) * lower * 0.6);
  stain = max(stain, weep * 0.5 * fine);
  tone *= 1.0 - 0.45 * fine * (1.0 - smoothstep(0.002, 0.007, abs(du - 0.11)));
  tone *= 1.0 - 0.35 * fine * bolt;
  // The unused post-bolt slot in the middle of every panel.
  float dm = u - ${PITCH} * (floor(u / ${PITCH}) + 0.5);
  tone *= 1.0 - 0.9 * fine * (1.0 - smoothstep(0.026, 0.032, abs(dm))) * (1.0 - smoothstep(0.007, 0.011, abs(v)));
  // Where the bumper scraped, the zinc is scored along the beam and dull.
  tone *= 1.0 - crush * (0.22 + 0.5 * smoothstep(0.5, 0.78, railNoise(vec2(u * 2.6, v * 95.0))));
  #else
  tone *= 1.0 - 0.15 * crush;
  #endif
  stain = clamp(stain, 0.0, 0.85);
  diffuseColor.rgb = mix(vec3(0.400, 0.404, 0.400) * tone, rust, stain);
  railShine = 1.0 - stain;
}
`;
const RAIL_LIGHT_ANCHOR = 'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;';
/** In place of the Lambert sum. The sky fill is strongly blue: a grey rail lit only by it would read as blue paint.
 *  Zinc mirrors the whole scene, grey-brown road included, so it keeps little of that blue; old wood keeps more. */
const RAIL_LIGHT = /* glsl */`
vec3 railSkyLight = reflectedLight.indirectDiffuse;
float railAlbedo = max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0001);
float railFill = dot(railSkyLight, vec3(0.2126, 0.7152, 0.0722)) / railAlbedo;
railSkyLight = mix(railSkyLight, diffuseColor.rgb * railFill, mix(0.82, 0.5, railTimber));
vec3 outgoingLight = reflectedLight.directDiffuse + railSkyLight + totalEmissiveRadiance;
if (railShine > 0.0) {
  // A dull zinc sheen: brighter where the eye skims along the face, and a wide soft glint from the sun.
  vec3 railEye = normalize(vViewPosition);
  float railSkim = pow(1.0 - max(dot(normal, railEye), 0.0), 3.0);
  vec3 railSheen = vec3(railFill) * vec3(0.95, 0.98, 1.0) * (0.035 + 0.16 * railSkim);
  #if NUM_DIR_LIGHTS > 0
  vec3 railSun = directionalLights[0].direction;
  float railGlint = pow(max(dot(normal, normalize(railSun + railEye)), 0.0), 18.0) * max(dot(normal, railSun), 0.0);
  railSheen += directionalLights[0].color * railGlint * 0.07;
  #endif
  #if NUM_SPOT_LIGHTS > 0
  // Lamps (headlights, when a scene has them): the same wide glint from each lamp. A face turned toward the
  // car answers brightly; a rail that runs alongside stays a dull grey band, as rough zinc does.
  IncidentLight railLamp;
  for (int i = 0; i < NUM_SPOT_LIGHTS; i++) {
    getSpotLightInfo(spotLights[i], -vViewPosition, railLamp);
    railSheen += railLamp.color * pow(max(dot(normal, normalize(railLamp.direction + railEye)), 0.0), 18.0) * max(dot(normal, railLamp.direction), 0.0) * 0.07;
  }
  #endif
  outgoingLight += railSheen * railShine;
}
`;

/** One material and one shader program for every rail. No texture: the zinc and the grain are worked out per pixel. */
export function railMaterial(low: boolean): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  material.name = 'Galvanized W-beam and weathered timber';
  material.onBeforeCompile = shader => {
    // A three.js upgrade that rewords the Lambert shader must not pass silently: the rail would turn blue again.
    if (!shader.fragmentShader.includes(RAIL_LIGHT_ANCHOR)) console.warn('[guardrails] the Lambert light sum has moved: the rail loses its neutral fill and its sheen');
    shader.vertexShader = 'attribute vec3 rail;\nvarying vec3 vRail;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRail = rail;');
    shader.fragmentShader = (low ? '#define RAIL_LOW\n' : '') + RAIL_PARS + shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + RAIL_ALBEDO).replace(RAIL_LIGHT_ANCHOR, RAIL_LIGHT);
  };
  material.customProgramCacheKey = () => `mmm-rail-${low ? 'low' : 'full'}`;
  return material;
}
