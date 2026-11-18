// Shader text that only the finish pass brings (finish.ts; finish-choice.ts says when). It is kept out of shaders.ts on
// purpose: that file's programs are pinned (tools/baseline/programs.json), and a page without the finish must compile
// exactly the text it always did. So nothing here is in any shader until `cloudReflections` or `untoned` is called.

import * as THREE from 'three';
import { FINISH } from './finish-choice';

export const CLOUD_HEIGHT = 1700, CLOUD_CLEAR = 0.50;   // metres up; how much of the sky stays clear (0 to 1)
export const CLOUD_GLSL = `
float cloudHash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.y); }
float cloudNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cloudHash(i), cloudHash(i + vec2(1.0, 0.0)), f.x), mix(cloudHash(i + vec2(0.0, 1.0)), cloudHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// How thick the cloud is over a place (metres east, metres south) at clock t. fine = 0 leaves out the small detail.
float cloudOver(vec2 p, float fine, float t) {
  p = p * 0.00042 + t * vec2(0.0035, 0.0012);
  float n = 0.5 * cloudNoise(p) + 0.25 * cloudNoise(p * 2.03 + vec2(17.0, 9.0)) + 0.125 * cloudNoise(p * 4.01 + vec2(5.0, 31.0));
  n += fine * (0.0625 * cloudNoise(p * 8.07 + 3.0) + 0.03125 * cloudNoise(p * 16.1 + 11.0)) + (1.0 - fine) * 0.047;
  return smoothstep(${CLOUD_CLEAR.toFixed(2)}, ${(CLOUD_CLEAR + 0.20).toFixed(2)}, n / 0.97);
}
// The cloud seen from eye along ray: rgb = its colour, a = how much of the sky behind it is hidden.
vec4 cloudSeen(vec3 eye, vec3 ray, vec3 sunD, vec3 sunC, vec3 skyC, float t) {
  if (ray.y <= 0.012) return vec4(0.0);
  float dist = (${CLOUD_HEIGHT.toFixed(1)} - eye.y) / ray.y;
  vec2 q = eye.xz + ray.xz * dist;
  float cloud = cloudOver(q, 1.0, t);
  // Its own shade: thick cloud on the way to the sun leaves this part grey.
  float shaded = cloudOver(q + sunD.xz * 520.0, 1.0, t) * 0.6 + cloudOver(q + sunD.xz * 1300.0, 0.0, t) * 0.4;
  vec3 lit = sunC * 0.36 + skyC * 0.50, grey = skyC * 0.72 + sunC * 0.05;
  float near = exp(-dist * 0.00003);                       // far cloud sinks into the sky's own haze
  return vec4(mix(lit, grey, shaded * 0.8), cloud * smoothstep(0.012, 0.07, ray.y) * 0.94 * (0.25 + 0.75 * near));
}
`;

const SKY = 'vec3 skyAt(vec3 d) {', SKY_END = '  return c + sunColor * (0.10 * pow(s, 6.0) + 0.5 * pow(s, 64.0));';
/** A land or sea program with the clouds in its sky stand-in (shaders.ts `skyAt`); any other text comes back as it is. */
export function withCloudSky(fragment: string): string {
  if (!fragment.includes(SKY) || !fragment.includes(SKY_END)) return fragment;
  return fragment.replace(SKY, CLOUD_GLSL + SKY).replace(SKY_END, `  c += sunColor * (0.10 * pow(s, 6.0) + 0.5 * pow(s, 64.0));
  vec4 cloud = cloudSeen(cameraPosition, normalize(d), sunDir, sunColor, skyColor, time);
  return mix(c, cloud.rgb, cloud.a);`);
}

/**
 * Water and wet ground reflect the sky stand-in, not the sky: with clouds in the sky they must be in the stand-in too.
 * Every shader material compiled after this call passes through `withCloudSky`. main.ts calls it
 * once, before the first frame, and only on a page that draws clouds.
 */
export function cloudReflections(): void {
  THREE.ShaderMaterial.prototype.onBeforeCompile = function (shader) { shader.fragmentShader = withCloudSky(shader.fragmentShader); };
}

// The pass puts the tone curve on the whole picture. A material with `toneMapped: false` (a signal lamp, a name label)
// is drawn by the canvas without the curve; here it goes through the curve backwards first, so that the pass brings
// it out at its own colour. The curve is the one in finish.ts (three.js ACES filmic, exposure as in main.ts).
const UNTONE = (exposure: number) => `
  {
    const mat3 finishIn = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    const mat3 finishOut = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    // 0.93 and not 1: full white would need a light fifteen times paper white, and the glow would bloom on every label.
    vec3 y = clamp(inverse(finishOut) * clamp(gl_FragColor.rgb, 0.0, 1.0), 0.0, 0.93);
    vec3 a = 1.0 - y * 0.983729, b = 0.0245786 - y * 0.4329510, k = 0.000090537 + y * 0.238081;
    vec3 v = (-b + sqrt(b * b + 4.0 * a * k)) / (2.0 * a);
    gl_FragColor.rgb = max(inverse(finishIn) * v, 0.0) * ${(0.6 / exposure).toFixed(5)};
  }`;
/** A colour the canvas shows without the tone curve (a scene's background), run backwards through the curve in place. */
export function untoneColor(color: THREE.Color, exposure: number): THREE.Color {
  const o = [1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602];   // rows of the curve's output matrix
  const i = [0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777];        // rows of its input matrix
  const solve = (m: number[], v: number[]) => new THREE.Vector3(...v).applyMatrix3(new THREE.Matrix3().set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]).invert()).toArray();
  const v = solve(o, [color.r, color.g, color.b].map(c => THREE.MathUtils.clamp(c, 0, 1))).map(c => {
    const y = THREE.MathUtils.clamp(c, 0, 0.93), a = 1 - y * 0.983729, b = 0.0245786 - y * 0.4329510, k = 0.000090537 + y * 0.238081;
    return (-b + Math.sqrt(b * b + 4 * a * k)) / (2 * a);
  });
  const [r, g, b] = solve(i, v).map(c => Math.max(c, 0) * 0.6 / exposure);
  return color.setRGB(r, g, b);
}

/**
 * For a built-in material made with `toneMapped: false`: keeps its look under the finish pass. Without the pass it
 * does nothing, and the material is the one main always had. Call it after the material's own `onBeforeCompile` is set.
 */
export function untoned<M extends THREE.Material>(material: M, exposure = 0.55): M {
  if (!FINISH.mode) return material;
  const before = material.onBeforeCompile, key = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <tonemapping_fragment>', '#include <tonemapping_fragment>' + UNTONE(exposure));
  };
  material.customProgramCacheKey = () => 'untoned:' + exposure + ':' + (key === THREE.Material.prototype.customProgramCacheKey ? before.toString() : key.call(material));
  return material;
}
