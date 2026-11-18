// The finish pass: a film-style finish on the picture. finish-choice.ts says when it runs (by default on a desktop at
// full detail); without it none of this is built.
// The world is drawn into a bright-range (half float) picture first, with its depth. Then, on flat full-screen passes:
//   contact shade   darkening where things meet (a tree on its ground, a wall on its yard), read from the depth   [half size]
//   glow            the brightest parts spread a little light (the sun on the sea, a lamp at night)                [half size down]
//   finish          clouds and their shadows, tone curve, colour grade, soft corners, a little grain               [full size]
//   edges           when the world has one sample for each pixel: edge smoothing on the finished picture          [full size]
// The tone curve and exposure are the renderer's own (ACES, main.ts), so the picture without the grade is the old one.
// ?finish=ao shows the contact shade alone; ?finish=plain runs the chain with every effect at zero (the control).

import * as THREE from 'three';
import { CLOUD_GLSL, CLOUD_HEIGHT, untoneColor } from './finish-shaders';
import type { FinishMode } from './finish-choice';

const VERT = /* glsl */ `
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Depth back to metres in front of the camera. The desktop picture uses the logarithmic depth buffer
// (gl_FragDepth = log2(1 + w) / log2(1 + far)); the phone picture uses the plain one.
const DEPTH = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform highp sampler2D tDepth;
uniform vec4 uProj;   // near, far, tan(fov / 2), aspect
uniform float uLogDepth;
float metres(float d) {
  if (uLogDepth > 0.5) return exp2(d * log2(uProj.y + 1.0)) - 1.0;
  return (uProj.x * uProj.y) / (uProj.y - d * (uProj.y - uProj.x));
}
vec3 viewAt(vec2 uv, float z) { return vec3((uv * 2.0 - 1.0) * vec2(uProj.z * uProj.w, uProj.z) * z, -z); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

// Contact shade. The radius grows with distance (0.7 m near the car, 14 m far away), so a far wood still gets
// the dark between its trees. It fades out where the radius would be under a pixel, and toward the horizon.
const AO_FRAG = DEPTH + /* glsl */ `
uniform vec2 uTexel;      // one pixel of the full-size depth
out vec4 outColor;
const int TAPS = 12;
// The place a depth pixel shows, taken at that pixel's own centre. Reading between centres would put the depth of
// one pixel at the place of another: on a road seen at a low angle that is a metre of error, and it shows as bands.
vec3 placeAt(vec2 uv) {
  vec2 c = (floor(uv / uTexel) + 0.5) * uTexel;
  return viewAt(c, min(metres(texture(tDepth, c).r), 30000.0));
}
void main() {
  vec2 here = (floor(vUv / uTexel) + 0.5) * uTexel;
  float d = texture(tDepth, here).r;
  float z = min(metres(d), 30000.0);
  if (d >= 1.0 || z > 2500.0) { outColor = vec4(1.0, z, 0.0, 1.0); return; }
  vec3 p = viewAt(here, z);
  // The surface's facing, from the nearer neighbour on each side (so an edge does not bend it).
  vec3 l = placeAt(here - vec2(uTexel.x, 0.0)), r = placeAt(here + vec2(uTexel.x, 0.0));
  vec3 b = placeAt(here - vec2(0.0, uTexel.y)), t = placeAt(here + vec2(0.0, uTexel.y));
  vec3 dx = abs(l.z - p.z) < abs(r.z - p.z) ? p - l : r - p;
  vec3 dy = abs(b.z - p.z) < abs(t.z - p.z) ? p - b : t - p;
  vec3 n = normalize(cross(dx, dy));
  float radius = clamp(z * 0.025, 0.6, 9.0);
  float radiusUv = radius / (z * uProj.z * 2.0);            // as a share of the picture's height
  float px = radiusUv / uTexel.y;
  float seen = smoothstep(1.5, 5.0, px) * (1.0 - smoothstep(900.0, 2500.0, z));
  // None inside the driver's own cabin (the seat view): the dashboard and the wheel are dark already, and would sink to black.
  seen *= smoothstep(1.2, 3.0, z);
  if (seen <= 0.0) { outColor = vec4(1.0, z, 0.0, 1.0); return; }
  radiusUv = min(radiusUv, 0.09);
  float turn = ign(gl_FragCoord.xy) * 6.2831853;
  float shade = 0.0;
  for (int i = 0; i < TAPS; i++) {
    float f = (float(i) + 0.5) / float(TAPS);
    float a = turn + float(i) * 2.3999632;
    vec3 s = placeAt(here + vec2(cos(a) / uProj.w, sin(a)) * radiusUv * sqrt(f));
    vec3 v = s - p;
    float len2 = dot(v, v);
    float facing = max(dot(n, v) * inversesqrt(len2 + 1e-6) - 0.12, 0.0);
    float reach = max(1.0 - len2 / (radius * radius), 0.0);
    shade += facing * reach * reach;
  }
  float ao = clamp(1.0 - shade * (7.0 / float(TAPS)) * seen, 0.0, 1.0);
  outColor = vec4(ao, z, 0.0, 1.0);
}
`;

// Smooth the shade, but not across an edge (a neighbour much nearer or farther does not count).
const AO_BLUR_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D tAo;    // r = shade, g = metres
uniform vec2 uStep;
out vec4 outColor;
void main() {
  vec2 c = texture(tAo, vUv).rg;
  float sum = c.r * 0.2, weight = 0.2;
  for (int i = 1; i <= 4; i++) {
    float w = 0.2 - 0.035 * float(i);
    for (int side = -1; side <= 1; side += 2) {
      vec2 s = texture(tAo, vUv + uStep * float(i * side)).rg;
      float k = w * max(0.0, 1.0 - abs(s.g - c.g) / (0.06 * c.g + 0.05));
      sum += s.r * k; weight += k;
    }
  }
  outColor = vec4(sum / weight, c.g, 0.0, 1.0);
}
`;

// Glow, first step: keep what is brighter than paper white, with a soft knee, at half size.
const BRIGHT_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D tScene;
uniform vec2 uTexel;
uniform vec3 uGlow;       // exposure, threshold, knee
out vec4 outColor;
vec3 bright(vec2 uv) {
  vec3 c = min(texture(tScene, uv).rgb * uGlow.x, vec3(40.0));
  float peak = max(c.r, max(c.g, c.b));
  float soft = clamp(peak - uGlow.y + uGlow.z, 0.0, 2.0 * uGlow.z);
  soft = soft * soft / (4.0 * uGlow.z + 1e-4);
  return c * max(soft, peak - uGlow.y) / max(peak, 1e-4);
}
void main() {
  // Four taps, each weighted down when very bright: one white pixel must not flicker as a firefly.
  vec3 a = bright(vUv + uTexel * vec2(-1.0, -1.0)), b = bright(vUv + uTexel * vec2(1.0, -1.0));
  vec3 c = bright(vUv + uTexel * vec2(-1.0, 1.0)), d = bright(vUv + uTexel * vec2(1.0, 1.0));
  float wa = 1.0 / (1.0 + max(a.r, max(a.g, a.b))), wb = 1.0 / (1.0 + max(b.r, max(b.g, b.b)));
  float wc = 1.0 / (1.0 + max(c.r, max(c.g, c.b))), wd = 1.0 / (1.0 + max(d.r, max(d.g, d.b)));
  outColor = vec4((a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd), 1.0);
}
`;

const DOWN_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;      // one pixel of the source
out vec4 outColor;
void main() {
  vec3 c = texture(tSrc, vUv).rgb * 4.0;
  c += texture(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  outColor = vec4(c / 8.0, 1.0);
}
`;

// Back up the sizes: each size adds its own, wider glow to the one above (drawn with additive blending).
const UP_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;      // one pixel of the source
out vec4 outColor;
void main() {
  vec3 c = texture(tSrc, vUv + uTexel * vec2(-1.0, 0.0)).rgb + texture(tSrc, vUv + uTexel * vec2(1.0, 0.0)).rgb;
  c += texture(tSrc, vUv + uTexel * vec2(0.0, -1.0)).rgb + texture(tSrc, vUv + uTexel * vec2(0.0, 1.0)).rgb;
  c = c * 2.0 + texture(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  outColor = vec4(c / 12.0, 1.0);
}
`;


// Focus blur, as a camera with a wide lens opening gives: what the middle of the picture looks at stays sharp, and
// the rest softens with its distance from that. Each pixel gathers from a disc as wide as its own blur. A neighbour
// that is itself sharp gives nothing (a sharp roof must not smear into the soft hill behind it).
const FOCUS_COMMON = /* glsl */ `
uniform vec4 uFocus;      // most blur as a share of the picture's height (near focus, far focus), sharp band, on
float focusMetres() {
  float z = 0.0;
  for (int i = 0; i < 5; i++) z += metres(texture(tDepth, vec2(0.5, 0.40) + vec2(float(i - 2) * 0.012, 0.0)).r);
  return clamp(z / 5.0, 3.0, 4000.0);
}
// Blur width in pixels of the full-size picture; below zero in front of the focus.
float blurAt(float z, float zf, float height) {
  float most = mix(uFocus.x, uFocus.y, smoothstep(25.0, 180.0, zf)) * height;
  float c = (z - zf) / max(z, 0.1);                        // a real lens: it levels off toward the horizon
  float a = max(abs(c) - uFocus.z, 0.0) / (1.0 - uFocus.z);
  return sign(c) * min(a * 1.6, 1.0) * most * uFocus.w;
}
`;
const FOCUS_FRAG = DEPTH + FOCUS_COMMON + /* glsl */ `
uniform sampler2D tScene;
uniform vec2 uTexel;      // one pixel of the full-size picture
out vec4 outColor;
const int TAPS = 32;
void main() {
  float zf = focusMetres(), height = 1.0 / uTexel.y;
  float own = blurAt(min(metres(texture(tDepth, vUv).r), 30000.0), zf, height);
  float radius = abs(own);
  vec3 sum = min(texture(tScene, vUv).rgb, vec3(30.0));
  float weight = 1.0;
  if (radius > 0.6) {
    float turn = ign(gl_FragCoord.xy) * 6.2831853;
    for (int i = 0; i < TAPS; i++) {
      float f = sqrt((float(i) + 0.5) / float(TAPS));
      float a = turn + float(i) * 2.3999632;
      vec2 uv = vUv + vec2(cos(a), sin(a)) * uTexel * radius * f;
      float theirs = abs(blurAt(min(metres(texture(tDepth, uv).r), 30000.0), zf, height));
      float w = clamp(theirs - radius * f + 1.0, 0.0, 1.0);
      sum += min(texture(tScene, uv).rgb, vec3(30.0)) * w; weight += w;
    }
  }
  outColor = vec4(sum / weight, own);
}
`;

const FINAL_FRAG = DEPTH + /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tAo;
uniform sampler2D tGlow;
uniform sampler2D tFocus;   // rgb = the blurred picture, a = blur width in pixels
uniform vec2 uTexel;       // one pixel of the full-size picture
uniform vec2 uAoTexel;     // one pixel of the shade
uniform vec4 uTone;        // exposure, contrast, colour strength, sharpen
uniform vec4 uLens;        // corner darkening, grain, glow strength, frame number
uniform vec4 uShade;       // contact shade strength, show it alone, grade strength, focus blur on
uniform vec2 uCurve;       // the contrast curve's middle (a screen tone), -
// Clouds: one flat layer of fair-weather cloud, high over the land. The sky shows it, and the
// land and sea take its shadow, along the sun's own direction, so a cloud and its shadow belong together.
uniform mat4 uCamWorld;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec4 uCloud;       // on, time (s), height of the layer (m), shadows on the land (0 at dusk and night)
${CLOUD_GLSL}
uniform vec3 uShadeTint;   // the colour a fully shaded place keeps (never black: the sky still lights it)
out vec4 outColor;
// The renderer's own ACES curve (three.js ACESFilmicToneMapping), so the ungraded picture matches the old one.
vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 color) {
  const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= uTone.x / 0.6;
  color = ACESOutputMat * RRTAndODTFit(ACESInputMat * color);
  return clamp(color, 0.0, 1.0);
}
vec3 toScreen(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// The half-size shade, taken from the neighbours at this pixel's own distance (so it does not leak over an edge).
float shadeAt(float z) {
  vec2 base = floor(vUv / uAoTexel - 0.5) + 0.5;
  vec2 f = vUv / uAoTexel - base;
  float sum = 0.0, weight = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 s = texture(tAo, (base + vec2(float(i), float(j))) * uAoTexel).rg;
    float w = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y) * max(1e-3, 1.0 - abs(s.g - z) / (0.08 * z + 0.05));
    sum += s.r * w; weight += w;
  }
  return sum / weight;
}
void main() {
  vec3 col = texture(tScene, vUv).rgb;
  // A light sharpen: the difference from the four neighbours, held back at strong edges (no bright rings).
  if (uTone.w > 0.0) {
    vec3 around = (texture(tScene, vUv + vec2(uTexel.x, 0.0)).rgb + texture(tScene, vUv - vec2(uTexel.x, 0.0)).rgb
      + texture(tScene, vUv + vec2(0.0, uTexel.y)).rgb + texture(tScene, vUv - vec2(0.0, uTexel.y)).rgb) * 0.25;
    vec3 detail = col - around;
    col = max(col + detail * uTone.w / (1.0 + 6.0 * luma(abs(detail)) / (luma(col) + 0.05)), 0.0);
  }

  if (uShade.w > 0.5) {
    vec4 soft = texture(tFocus, vUv);
    col = mix(col, soft.rgb, smoothstep(0.6, 2.2, abs(soft.a)));
  }
  float d = texture(tDepth, vUv).r;
  if (uCloud.x > 0.5) {
    vec3 eye = uCamWorld[3].xyz;
    if (d >= 1.0) {
      vec3 ray = normalize((uCamWorld * vec4(viewAt(vUv, 1.0), 0.0)).xyz);
      vec4 cloud = cloudSeen(eye, ray, uSunDir, uSunColor, uSkyColor, uCloud.y);
      col = mix(col, cloud.rgb, cloud.a);
    } else {
      vec3 world = (uCamWorld * vec4(viewAt(vUv, min(metres(d), 60000.0)), 1.0)).xyz;
      vec2 q = world.xz + uSunDir.xz * ((uCloud.z - world.y) / max(uSunDir.y, 0.10));
      col *= mix(vec3(1.0), vec3(0.56, 0.62, 0.74), cloudOver(q, 0.0, uCloud.y) * uCloud.w);
    }
  }
  float ao = d >= 1.0 || uShade.x <= 0.0 ? 1.0 : shadeAt(metres(d));
  ao = mix(1.0, ao, uShade.x);
  if (uShade.y > 0.5) { outColor = vec4(vec3(toScreen(vec3(ao * ao))), 1.0); return; }
  col *= mix(uShadeTint, vec3(1.0), ao);

  if (uLens.z > 0.0) col += texture(tGlow, vUv).rgb * uLens.z / uTone.x;        // the glow was taken after exposure
  col = aces(col);

  // The grade, on the finished tones. Shadows lean cool and deep, lights lean warm: the low October sun.
  float g = uShade.z;
  float l = luma(col);
  vec3 cool = vec3(0.93, 0.99, 1.08), warm = vec3(1.035, 1.005, 0.95);
  float blue = smoothstep(0.0, 0.12, col.b - max(col.r, col.g));   // a blue sky keeps its own colour
  col *= mix(vec3(1.0), mix(cool, mix(warm, vec3(1.0), blue), smoothstep(0.03, 0.55, l)), g);
  // Contrast as an S curve on screen tones, around the picture's own middle (lower at night: the dark must not sink).
  vec3 s = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  float mid = uCurve.x, power = 1.0 + uTone.y * g;
  s = mix(mid * pow(s / mid, vec3(power)), 1.0 - (1.0 - mid) * pow((1.0 - s) / (1.0 - mid), vec3(power)), step(mid, s));
  col = pow(s, vec3(2.2));
  // Colour strength: dull colours gain more than strong ones (no burnt grass, no orange skin on the hills).
  l = luma(col);
  float strong = max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b));
  col = max(mix(vec3(l), col, 1.0 + uTone.z * g * (1.0 - 0.6 * strong)), 0.0);

  // Soft corners, as a real lens gives.
  vec2 q = (vUv - 0.5) * vec2(min(uProj.w, 1.6), 1.0) / 0.8;
  col *= 1.0 - uLens.x * smoothstep(0.25, 1.15, dot(q, q));

  col = toScreen(clamp(col, 0.0, 1.0));
  // Grain, strongest in the middle tones; it also hides banding in the sky.
  float n = ign(gl_FragCoord.xy + uLens.w * 17.0) + ign(gl_FragCoord.yx * 1.31 + uLens.w * 29.0) - 1.0;
  col += n * uLens.y * (0.35 + 0.65 * (1.0 - abs(2.0 * luma(col) - 1.0)));
  outColor = vec4(col, 1.0);
}
`;

// Edge smoothing on the finished picture, for when the world is drawn with one sample for each pixel: along every
// strong edge, the pixel is mixed with its neighbours in the edge's own direction. The grain goes on after it.
const SMOOTH_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform vec2 uGrain;       // strength, frame number
out vec4 outColor;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  vec3 m = texture(tSrc, vUv).rgb;
  float lm = luma(m);
  float nw = luma(texture(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb), ne = luma(texture(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb);
  float sw = luma(texture(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb), se = luma(texture(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb);
  float lo = min(lm, min(min(nw, ne), min(sw, se))), hi = max(lm, max(max(nw, ne), max(sw, se)));
  vec3 col = m;
  if (hi - lo > max(0.035, hi * 0.11)) {
    vec2 dir = vec2(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
    float less = max((nw + ne + sw + se) * 0.03125, 0.0078125);
    dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + less), vec2(-8.0), vec2(8.0)) * uTexel;
    vec3 a = 0.5 * (texture(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
    vec3 b = a * 0.5 + 0.25 * (texture(tSrc, vUv - dir * 0.5).rgb + texture(tSrc, vUv + dir * 0.5).rgb);
    float lb = luma(b);
    col = lb < lo || lb > hi ? a : b;
  }
  float n = ign(gl_FragCoord.xy + uGrain.y * 17.0) + ign(gl_FragCoord.yx * 1.31 + uGrain.y * 29.0) - 1.0;
  col += n * uGrain.x * (0.35 + 0.65 * (1.0 - abs(2.0 * luma(col) - 1.0)));
  outColor = vec4(col, 1.0);
}
`;

/** The game's own sun, sky and clock (main.ts `shared`), for the clouds. */
export interface CloudLight { sunDir: THREE.IUniform<THREE.Vector3>; sunColor: THREE.IUniform<THREE.Color>; skyColor: THREE.IUniform<THREE.Color>; time: THREE.IUniform<number> }

const GLOW_STEPS = 5;

/** A draw of one scene, in place of `renderer.render(scene, camera)`. */
export type SceneDraw = (scene: THREE.Scene, camera: THREE.Camera) => void;

// The copy uses the renderer's own tone curve, exposure and screen colours (three.js adds them at these two lines
// when the copy goes to the canvas), so things come out as the canvas itself would have made them. Two differences
// remain: the edge samples are joined before the curve and not after it, and a background colour, which the canvas
// shows without the curve, is sent through the curve backwards first (`draw`).
const COPY_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const COPY_FRAG = /* glsl */ `
uniform sampler2D tSrc;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Edge samples for the scenes that do not go through the finish pass (the interiors), on a canvas that was made
 * without them. The scene is drawn into a picture with four samples for each pixel, and that is copied to the canvas.
 */
export class EdgeSamples {
  private readonly target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  private readonly copy = new THREE.ShaderMaterial({ vertexShader: COPY_VERT, fragmentShader: COPY_FRAG,
    uniforms: { tSrc: { value: this.target.texture } }, depthTest: false, depthWrite: false });
  private readonly flat = new THREE.Scene();
  private readonly flatCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly size = new THREE.Vector2();
  private readonly back = new THREE.Color();
  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copy);
    quad.frustumCulled = false; this.flat.add(quad);
  }
  readonly draw: SceneDraw = (scene, camera) => {
    const renderer = this.renderer, old = renderer.getRenderTarget();
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(2, this.size.x), h = Math.max(2, this.size.y);
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    const background = scene.background;
    if (background instanceof THREE.Color) scene.background = untoneColor(this.back.copy(background), renderer.toneMappingExposure);
    try { renderer.setRenderTarget(this.target); renderer.render(scene, camera); }
    finally { renderer.setRenderTarget(old); scene.background = background; }
    renderer.render(this.flat, this.flatCamera);
  };
}

export class Finish {
  private readonly sceneTarget: THREE.WebGLRenderTarget;
  private readonly aoA: THREE.WebGLRenderTarget;
  private readonly aoB: THREE.WebGLRenderTarget;
  private readonly focusTarget: THREE.WebGLRenderTarget | null;
  private readonly focus: THREE.ShaderMaterial | null;
  private readonly glow: THREE.WebGLRenderTarget[] = [];
  private readonly quad: THREE.Mesh;
  private readonly flat = new THREE.Scene();
  private readonly flatCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly ao: THREE.ShaderMaterial;
  private readonly aoBlur: THREE.ShaderMaterial;
  private readonly bright: THREE.ShaderMaterial;
  private readonly down: THREE.ShaderMaterial;
  private readonly up: THREE.ShaderMaterial;
  private readonly final: THREE.ShaderMaterial;
  private readonly smooth: THREE.ShaderMaterial | null;
  private readonly smoothTarget: THREE.WebGLRenderTarget | null;
  private readonly size = new THREE.Vector2();
  private readonly proj = new THREE.Vector4();
  private width = 0;
  private height = 0;
  private frame = 0;
  /** False draws the old picture for a frame: the cost check (tools/finish-cost.mjs) switches it in one page. */
  on = true;
  /** Parts left out for a frame, for the same check: it times the pass with each part missing in turn. */
  readonly skip = { ao: false, glow: false, clouds: false, sharpen: false };
  private readonly full: { ao: number; glow: number; clouds: number; sharpen: number };

  /** `night` is true under the night look: lamps then glow more. `clouds` gives the sun and sky that light them. */
  constructor(private readonly renderer: THREE.WebGLRenderer, mode: FinishMode, low: boolean, night: boolean, private readonly clouds: CloudLight | null = null,
    test: { samples?: number; type?: THREE.TextureDataType; smooth?: boolean } = {}) {
    const depth = new THREE.DepthTexture(1, 1, THREE.FloatType);
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type: test.type ?? THREE.HalfFloatType, samples: test.samples ?? (low ? 0 : 4), depthTexture: depth, depthBuffer: true });
    const half = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.aoA = new THREE.WebGLRenderTarget(1, 1, half);
    this.aoB = new THREE.WebGLRenderTarget(1, 1, half);
    for (let i = 0; i < GLOW_STEPS; i++) this.glow.push(new THREE.WebGLRenderTarget(1, 1, half));
    this.focusTarget = mode === 'small' ? new THREE.WebGLRenderTarget(1, 1, half) : null;

    const logDepth = { value: renderer.capabilities.logarithmicDepthBuffer ? 1 : 0 };
    const pass = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false,
    });
    const on = mode !== 'plain';
    this.ao = pass(AO_FRAG, { tDepth: { value: depth }, uProj: { value: this.proj }, uLogDepth: logDepth, uTexel: { value: new THREE.Vector2() } });
    this.aoBlur = pass(AO_BLUR_FRAG, { tAo: { value: null }, uStep: { value: new THREE.Vector2() } });
    this.bright = pass(BRIGHT_FRAG, { tScene: { value: this.sceneTarget.texture }, uTexel: { value: new THREE.Vector2() },
      uGlow: { value: new THREE.Vector3(renderer.toneMappingExposure, night ? 0.75 : 0.95, 0.6) } });
    this.down = pass(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.up = pass(UP_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.up.blending = THREE.AdditiveBlending; this.up.transparent = true;
    this.final = pass(FINAL_FRAG, {
      tScene: { value: this.sceneTarget.texture }, tDepth: { value: depth }, tAo: { value: this.aoA.texture }, tGlow: { value: this.glow[0].texture },
      uProj: { value: this.proj }, uLogDepth: logDepth, uTexel: { value: new THREE.Vector2() }, uAoTexel: { value: new THREE.Vector2() },
      uTone: { value: new THREE.Vector4(renderer.toneMappingExposure, on ? (night ? 0.10 : 0.24) : 0, on ? 0.14 : 0, on ? 0.35 : 0) },
      uLens: { value: new THREE.Vector4(on ? 0.24 : 0, on ? 0.018 : 0, on ? (night ? 0.24 : 0.10) : 0, 0) },
      uShade: { value: new THREE.Vector4(on ? 1 : 0, mode === 'ao' ? 1 : 0, on ? 1 : 0, mode === 'small' ? 1 : 0) },
      uCurve: { value: new THREE.Vector2(night ? 0.2 : 0.42, 0) },
      uCamWorld: { value: new THREE.Matrix4() }, uSunDir: { value: clouds?.sunDir.value ?? new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: clouds?.sunColor.value ?? new THREE.Color() }, uSkyColor: { value: clouds?.skyColor.value ?? new THREE.Color() },
      uCloud: { value: new THREE.Vector4(clouds ? 1 : 0, 0, CLOUD_HEIGHT, night ? 0 : 1) }, tFocus: { value: this.focusTarget?.texture ?? null },
      uShadeTint: { value: night ? new THREE.Vector3(0.30, 0.32, 0.40) : new THREE.Vector3(0.34, 0.37, 0.48) },
    });
    this.focus = this.focusTarget ? pass(FOCUS_FRAG, { tScene: { value: this.sceneTarget.texture }, tDepth: { value: depth }, uProj: { value: this.proj },
      uLogDepth: logDepth, uTexel: { value: new THREE.Vector2() }, uFocus: { value: new THREE.Vector4(0.0028, 0.0075, 0.14, 1) } }) : null;
    const u = this.final.uniforms;
    // Full detail with one sample for each pixel: the edges are smoothed on the finished picture instead.
    const post = !low && (test.smooth ?? this.sceneTarget.samples === 0);
    this.smoothTarget = post ? new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }) : null;
    this.smooth = this.smoothTarget ? pass(SMOOTH_FRAG, { tSrc: { value: this.smoothTarget.texture }, uTexel: { value: new THREE.Vector2() },
      uGrain: { value: new THREE.Vector2(u.uLens.value.y, 0) } }) : null;
    if (this.smooth) u.uLens.value.y = 0;
    this.full = { ao: u.uShade.value.x, glow: u.uLens.value.z, clouds: u.uCloud.value.x, sharpen: u.uTone.value.w };
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.final);
    this.quad.frustumCulled = false;
    this.flat.add(this.quad);
  }

  private resize(): void {
    this.renderer.getDrawingBufferSize(this.size);
    const w = Math.max(2, this.size.x), h = Math.max(2, this.size.y);
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    this.sceneTarget.setSize(w, h);
    this.smoothTarget?.setSize(w, h); this.smooth?.uniforms.uTexel.value.set(1 / w, 1 / h);
    const hw = Math.ceil(w / 2), hh = Math.ceil(h / 2);
    this.aoA.setSize(hw, hh); this.aoB.setSize(hw, hh);
    this.focusTarget?.setSize(hw, hh); this.focus?.uniforms.uTexel.value.set(1 / w, 1 / h);
    for (let i = 0; i < GLOW_STEPS; i++) this.glow[i].setSize(Math.max(1, Math.ceil(w / (2 << i))), Math.max(1, Math.ceil(h / (2 << i))));
    this.ao.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.bright.uniforms.uTexel.value.set(0.5 / w, 0.5 / h);
    this.final.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.final.uniforms.uAoTexel.value.set(1 / hw, 1 / hh);
  }

  private draw(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.flat, this.flatCamera);
  }

  /**
   * Run `draw` on the world picture and its depth, after `render`. The water check (water.ts `afterRender`) counts
   * the water that the land hides; with the pass on, the canvas holds only the flat finished picture and no depth.
   */
  onWorld(draw: () => void): void {
    const old = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.sceneTarget);
    try { draw(); } finally { this.renderer.setRenderTarget(old); }
  }

  /** Draw the world with the finish, in place of `renderer.render(scene, camera)`. */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const renderer = this.renderer;
    this.resize();
    const oldTarget = renderer.getRenderTarget(), oldAutoClear = renderer.autoClear;
    this.proj.set(camera.near, camera.far, Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / camera.zoom, camera.aspect);
    this.frame = (this.frame + 1) % 64;
    try {
      renderer.setRenderTarget(this.sceneTarget);
      renderer.render(scene, camera);
      renderer.autoClear = false;   // every flat pass covers its whole picture (and has no lights: the shadow map rests)
      // A part at zero strength is not drawn at all (the control, the night look, and the cost check's turns).
      const u = this.final.uniforms, skip = this.skip;
      u.uShade.value.x = skip.ao ? 0 : this.full.ao; u.uLens.value.z = skip.glow ? 0 : this.full.glow;
      u.uCloud.value.x = skip.clouds ? 0 : this.full.clouds; u.uTone.value.w = skip.sharpen ? 0 : this.full.sharpen;
      if (u.uShade.value.x > 0) {
        // Contact shade, at half size, then smoothed across and down.
        this.draw(this.ao, this.aoA);
        this.aoBlur.uniforms.tAo.value = this.aoA.texture; this.aoBlur.uniforms.uStep.value.set(1 / this.aoA.width, 0);
        this.draw(this.aoBlur, this.aoB);
        this.aoBlur.uniforms.tAo.value = this.aoB.texture; this.aoBlur.uniforms.uStep.value.set(0, 1 / this.aoA.height);
        this.draw(this.aoBlur, this.aoA);
      }
      if (this.focus) this.draw(this.focus, this.focusTarget);
      if (u.uLens.value.z > 0) {
        // Glow: down the sizes, then back up, each adding to the one above.
        this.draw(this.bright, this.glow[0]);
        for (let i = 1; i < GLOW_STEPS; i++) {
          this.down.uniforms.tSrc.value = this.glow[i - 1].texture;
          this.down.uniforms.uTexel.value.set(1 / this.glow[i - 1].width, 1 / this.glow[i - 1].height);
          this.draw(this.down, this.glow[i]);
        }
        for (let i = GLOW_STEPS - 1; i > 0; i--) {
          this.up.uniforms.tSrc.value = this.glow[i].texture;
          this.up.uniforms.uTexel.value.set(1 / this.glow[i].width, 1 / this.glow[i].height);
          this.draw(this.up, this.glow[i - 1]);
        }
      }
      u.uLens.value.w = this.frame;
      this.final.uniforms.uCamWorld.value.copy(camera.matrixWorld);
      if (this.clouds) this.final.uniforms.uCloud.value.y = this.clouds.time.value;
      this.draw(this.final, this.smoothTarget ?? oldTarget);
      if (this.smooth) { this.smooth.uniforms.uGrain.value.y = this.frame; this.draw(this.smooth, oldTarget); }
    } finally {
      renderer.setRenderTarget(oldTarget); renderer.autoClear = oldAutoClear;
    }
  }
}
