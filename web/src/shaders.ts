import { CURVE_GLSL } from './far-rules';

// GLSL for the terrain and the sea. Colours are linear; three.js applies tone mapping and sRGB at the end.

export const LAND_LIGHT = /* glsl */ `
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 skyColor;
uniform vec3 fogColor;
uniform float fogDensity;
uniform float seaLevel;
uniform float time;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
#ifdef LOW
  return 0.6 * vnoise(p) + 0.34 * vnoise(p * 2.03 + 11.0);
#else
  return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03 + 11.0) + 0.125 * vnoise(p * 4.01 + 5.0) + 0.0625 * vnoise(p * 8.07);
#endif
}

// Sky colour in a direction: a cheap stand-in for the real sky, used for reflections and haze.
vec3 skyAt(vec3 d) {
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(fogColor, skyColor, pow(h, 0.45));
  float s = max(dot(normalize(d), sunDir), 0.0);
  return c + sunColor * (0.10 * pow(s, 6.0) + 0.5 * pow(s, 64.0));
}

vec3 applyFog(vec3 col, vec3 world, vec3 cam) {
  vec3 v = world - cam;
  float dist = length(v);
  // Haze is thicker near sea level.
  float hmid = max(0.5 * (world.y + cam.y), 0.0);
  float f = 1.0 - exp(-dist * fogDensity * exp(-hmid / 900.0));
  float s = max(dot(v / max(dist, 1.0), sunDir), 0.0);
  vec3 haze = fogColor + sunColor * 0.12 * pow(s, 5.0);
  return mix(col, haze, clamp(f, 0.0, 1.0));
}

`;

export const COMMON = /* glsl */ `
${LAND_LIGHT}
#ifdef LOW
vec3 waterColor(vec3 world, vec3 cam, float depthHint) {
  vec3 v = normalize(cam - world);
  float dist = length(cam - world);
  vec2 p = world.xz;
  // Small moving ripples; they fade with distance so far water stays calm.
  float amp = 0.11 / (1.0 + dist * 0.006);
  float t = time * 0.5;
  // Short wind ripples in three sizes; a sheltered harbour has no swell.
  vec2 g = vec2(vnoise(p * 1.1 + vec2(t, 0.4 * t)) - 0.5, vnoise(p * 1.1 + vec2(-0.3 * t, t) + 7.0) - 0.5)
    + 0.6 * vec2(vnoise(p * 3.1 - t * 1.3) - 0.5, vnoise(p * 3.1 + t * 1.1 + 9.0) - 0.5)
    + 0.35 * vec2(vnoise(p * 8.3 + t * 2.0) - 0.5, vnoise(p * 8.3 - t * 1.7 + 3.0) - 0.5);
  // Wide patches of calmer and rougher water.
  amp *= 0.55 + 0.9 * vnoise(p * 0.012 + 0.02 * t);
  vec3 n = normalize(vec3(g.x * amp, 1.0, g.y * amp));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  r.y = abs(r.y);
  vec3 deep = mix(vec3(0.030, 0.050, 0.045), vec3(0.012, 0.040, 0.060), depthHint);
  vec3 body = deep * (0.35 + 0.65 * max(sunDir.y, 0.0)) * (sunColor * 0.5 + skyColor * 0.8);
  vec3 refl = skyAt(r);
  float glint = pow(max(dot(r, sunDir), 0.0), 220.0);
  return mix(body, refl, fres) + sunColor * glint * 2.5;
}
#else
vec3 inlandWaterColor(vec3 world, vec3 cam, float depthHint) {
  vec3 v = normalize(cam - world);
  float dist = length(cam - world);
  vec2 p = world.xz;
  // Small moving ripples; they fade with distance so far water stays calm.
  float amp = 0.11 / (1.0 + dist * 0.006);
  float t = time * 0.5;
  // Short wind ripples in three sizes; a sheltered harbour has no swell.
  vec2 g = vec2(vnoise(p * 1.1 + vec2(t, 0.4 * t)) - 0.5, vnoise(p * 1.1 + vec2(-0.3 * t, t) + 7.0) - 0.5)
    + 0.6 * vec2(vnoise(p * 3.1 - t * 1.3) - 0.5, vnoise(p * 3.1 + t * 1.1 + 9.0) - 0.5)
    + 0.35 * vec2(vnoise(p * 8.3 + t * 2.0) - 0.5, vnoise(p * 8.3 - t * 1.7 + 3.0) - 0.5);
  // Wide patches of calmer and rougher water.
  amp *= 0.55 + 0.9 * vnoise(p * 0.012 + 0.02 * t);
  vec3 n = normalize(vec3(g.x * amp, 1.0, g.y * amp));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  r.y = abs(r.y);
  vec3 deep = mix(vec3(0.025, 0.032, 0.014), vec3(0.025, 0.032, 0.014), depthHint);
  vec3 body = deep * (0.35 + 0.65 * max(sunDir.y, 0.0)) * (sunColor * 0.5 + skyColor * 0.8);
  vec3 refl = skyAt(r);
  float glint = pow(max(dot(r, sunDir), 0.0), 220.0);
  return mix(body, refl, fres) + sunColor * glint * 2.5;
}
#endif
#if defined(SEA_WATER) && !defined(LOW)
uniform sampler2D tReflection;
uniform vec2 waterViewport;
uniform vec2 reflectionTexel;
uniform float reflectionOn;
uniform sampler2D tShore;
uniform vec4 shoreRect;
uniform vec2 waterOrigin;
uniform bool gulfTint;

float shoreDistance(vec2 p) {
  vec2 uv = (p - shoreRect.xy) * shoreRect.zw;
  if (shoreRect.z == 0.0 || min(uv.x, uv.y) < 0.0 || max(uv.x, uv.y) > 1.0) return 850.0;
  return texture2D(tShore, uv).r * 850.0;
}
#endif

#if defined(SEA_WATER) && !defined(LOW)
// footprint: how much water one pixel covers, in metres. The caller takes it from screen derivatives at the top of
// main(), outside every branch and discard: a derivative inside one is undefined where neighbours go another way.
vec3 waterColor(vec3 world, vec3 cam, float depthHint, float footprint) {
  vec3 v = normalize(cam - world);
  float dist = length(cam - world);
  vec2 p = world.xz;
  float tidal = 1.0 - smoothstep(0.6, 2.0, abs(world.y - seaLevel));
  // The gulf west of the mouth has fetch. Inside, small wind lanes leave broad calm patches.
  float gulf = 0.0;
  if (gulfTint) gulf = (1.0 - smoothstep(617900.0, 619400.0, p.x + waterOrigin.x)) * tidal;
  float windPatch = vnoise(p * vec2(0.008, 0.017) + vec2(time * 0.003, 0.0));
  float wind = mix(0.22, 1.0, smoothstep(0.25, 0.78, windPatch)) + gulf * 0.65;
  vec2 along = vec2(0.86, 0.51);
  // Unequal wave trains bend through a drifting field instead of crossing as a regular grid.
  vec2 warp = vec2(vnoise(p * 0.19 + vec2(time * 0.035, 0.0)),
    vnoise(p * 0.23 + vec2(19.0, -time * 0.027))) - 0.5;
  vec2 q = p + warp * 7.0;
  float small = 1.0 - smoothstep(0.12, 0.9, footprint);
  float medium = 1.0 - smoothstep(0.8, 5.0, footprint);
  vec2 d0 = vec2(0.91, 0.415), d1 = vec2(0.62, 0.785), d2 = vec2(0.995, -0.10);
  vec2 d3 = vec2(0.78, 0.626), d4 = vec2(0.45, 0.893);
  vec2 gradient = (
      d0 * sin(dot(q, d0) * 2.17 - time * 1.13) * 0.023 * medium
    + d1 * sin(dot(q + warp.yx * 3.7, d1) * 3.73 - time * 1.61 + 1.9) * 0.014 * medium
    + d2 * sin(dot(q, d2) * 8.91 - time * 3.37 + 4.2) * 0.019 * small
    + d3 * sin(dot(q - warp.yx * 2.3, d3) * 12.67 - time * 4.19 + 0.7) * 0.012 * small
    + d4 * sin(dot(q, d4) * 0.39 - time * 0.47 + windPatch * 9.0) * 0.007
    ) * wind;
  gradient += along * sin(dot(p, along) * 0.055 + windPatch * 9.0 - time * 0.48) * gulf * 0.032;
  vec3 n = normalize(vec3(-gradient.x, 1.0, -gradient.y));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n); r.y = abs(r.y);
  vec3 refl = skyAt(r);
  if (reflectionOn > 0.5 && tidal > 0.0) {
    // The reflected view uses the main projection. One vertical flip maps it to every screen pixel.
    vec2 uv = vec2(gl_FragCoord.x, waterViewport.y - gl_FragCoord.y) / waterViewport;
    uv += gradient * (0.025 + 0.055 * (1.0 - v.y));
    vec2 safeUv = clamp(uv, reflectionTexel * 0.5, 1.0 - reflectionTexel * 0.5);
    // Only an offset outside the image fades to sky; there is no fixed strip cut off at its edges.
    float edge = 1.0 - smoothstep(0.0, 0.012, length(uv - safeUv));
    vec4 land = texture2D(tReflection, safeUv);
    refl = mix(refl, land.rgb, land.a * edge * tidal);
  }
  float shore = (1.0 - smoothstep(0.0, 32.0, shoreDistance(p))) * tidal;
  // These are stained surfaces, not a claim about the unseen bottom of the harbour.
  vec3 deep = mix(vec3(0.025, 0.032, 0.014), vec3(0.016, 0.045, 0.050), tidal * depthHint);
  deep *= 0.8 + windPatch * 0.55;
  deep = mix(deep, vec3(0.055, 0.081, 0.057), shore * 0.6);
  vec3 body = deep * (sunColor * (0.25 + 0.35 * max(sunDir.y, 0.0)) + skyColor * 0.65);
  body += skyColor * wind * 0.018 * tidal;
  // A spread of unresolved slopes makes a long glitter path rather than a single bright dot.
  vec3 halfSun = normalize(v + sunDir);
  vec2 slope = halfSun.xz / max(halfSun.y, 0.05) + gradient;
  float rough = 0.055 + wind * 0.075;
  float glitter = exp(-dot(slope, slope) / (rough * rough));
  float sparkle = mix(1.0, 0.4 + vnoise(q * vec2(9.3, 6.1) + time * vec2(1.1, -0.7)), small);
  return mix(body, refl, fres) + sunColor * glitter * sparkle * (0.5 + 2.0 * fres);
}
#endif

`;

// Grass and land share their paint and shadow lookup, including all noise scales.
export const GROUND_COLOR = /* glsl */ `
vec3 groundColor(vec2 p, float cls, float big, float mid, float fine) {
  vec3 grass = mix(vec3(0.090, 0.150, 0.030), vec3(0.230, 0.230, 0.070), 0.6 * big + 0.4 * mid);
  vec3 rough = mix(vec3(0.130, 0.120, 0.045), vec3(0.230, 0.190, 0.070), mid);
  vec3 albedo = grass;
  if (cls > 4.5 || cls < 0.5) albedo = mix(rough, grass, 0.35);
  else if (cls < 1.5) albedo = mix(rough, vec3(0.110, 0.130, 0.040), mid);      // forest floor, cut blocks
  else if (cls > 2.5 && cls < 3.5) albedo = mix(grass, vec3(0.260, 0.250, 0.230), 0.25 * step(0.6, mid));
#ifdef GROUND_CLASSES
  if(cls==6.0)albedo=mix(vec3(.19,.17,.13),vec3(.31,.29,.24),.55*mid+.45*fine);
  else if(cls==7.0)albedo=mix(vec3(.17,.18,.17),vec3(.29,.29,.26),mid);
  else if(cls==8.0)albedo=mix(vec3(.085,.10,.035),vec3(.17,.18,.065),mid);
  else if(cls==9.0)albedo=mix(vec3(.055,.075,.045),vec3(.11,.12,.065),mid);
  else if(cls==10.0)albedo=mix(vec3(.28,.245,.17),vec3(.39,.35,.25),mid);
  else if(cls==11.0||cls==13.0)albedo=mix(vec3(.12,.14,.045),vec3(.21,.19,.075),mid);
  else if(cls==12.0)albedo=mix(vec3(.18,.17,.14),vec3(.27,.25,.21),fine);
#endif
  albedo *= (0.85 + 0.3 * fine) * (0.9 + 0.2 * vnoise(p * 7.0));
  return albedo;
}
`;

export const SUN_SHADOW = /* glsl */ `
#ifdef SHADOWS
uniform sampler2D tShadow;   // the sun's depth map, packed as three.js packs it
uniform mat4 shadowMatrix;   // world to that map: xy in 0..1, z the depth
uniform vec2 shadowTexel;
uniform float shadowOn;
// How much of the sun reaches a point on the land: 1 in the open, 0 behind a tree, a wall or the car.
float sunShadow(vec3 world) {
  if (shadowOn < 0.5) return 1.0;
  vec4 s = shadowMatrix * vec4(world, 1.0);
  vec3 c = s.xyz / s.w;
  vec2 edge = abs(c.xy - 0.5) * 2.0;
  if (max(edge.x, edge.y) >= 1.0 || c.z >= 1.0 || c.z <= 0.0) return 1.0;
  float lit = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++)
    lit += step(c.z - 0.00035, unpackRGBAToDepth(texture2D(tShadow, c.xy + vec2(float(i), float(j)) * shadowTexel)));
  // Shadows thin out toward the edge of the map, so no line shows where it ends.
  return mix(lit / 9.0, 1.0, smoothstep(0.82, 1.0, max(edge.x, edge.y)));
}
#endif
`;

export const TERRAIN_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${CURVE_GLSL}
uniform float farCurveOn;
attribute float ground;
varying vec2 vUv;
varying vec3 vWorld;
varying float vGround;
#ifdef QUARRY
attribute float quarryWaterDrop;
varying float vQuarryWaterDrop;
#endif
#ifdef COAST_SHORE
attribute vec4 coast;
varying vec4 vCoast;
#endif
void main() {
#ifdef COAST_SHORE
  vCoast = coast;
#endif
  vUv = uv;
  vGround = ground;
#ifdef QUARRY
  vQuarryWaterDrop=quarryWaterDrop;
#endif
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  float drop = farDrop(w.xz - cameraPosition.xz) * farCurveOn;
  if (drop > 0.0) gl_Position -= projectionMatrix * viewMatrix * vec4(0.0,drop,0.0,0.0);
  #include <logdepthbuf_vertex>
}
`;

export const MIRROR_TERRAIN_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${CURVE_GLSL}
uniform float farCurveOn;
attribute float ground;
attribute float mirrorCrown;
uniform vec2 mirrorFocus;
varying vec2 vUv;
varying vec3 vWorld;
varying float vGround;
#ifdef QUARRY
attribute float quarryWaterDrop;
varying float vQuarryWaterDrop;
#endif
#ifdef COAST_SHORE
attribute vec4 coast;
varying vec4 vCoast;
#endif
void main() {
#ifdef COAST_SHORE
  vCoast = coast;
#endif
  vUv = uv;
  vGround = ground;
#ifdef QUARRY
  vQuarryWaterDrop=quarryWaterDrop;
#endif
  vec4 w = modelMatrix * vec4(position, 1.0);
  w.y += mirrorCrown * smoothstep(280.0, 330.0, length(w.xz - mirrorFocus));
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  float drop = farDrop(w.xz - cameraPosition.xz) * farCurveOn;
  if (drop > 0.0) gl_Position -= projectionMatrix * viewMatrix * vec4(0.0,drop,0.0,0.0);
  #include <logdepthbuf_vertex>
}
`;


// Local shore materials, compiled only for tiles intersecting the surveyed coast box.
export const COAST_SURFACE = /* glsl */ `
#ifdef COAST_SHORE
varying vec4 vCoast;
uniform vec2 coastOrigin; // world xz to metres east/south of E618000 N5109000
uniform float coastExag;
uniform float coastOn;
#ifdef QUARRY
uniform vec4 quarryBox;
uniform float quarryReflectionLevel;
#endif
uniform vec4 coastRecessAnchor[5]; // shared map xz, unexaggerated height, width
uniform float coastRecessRise[5];
#ifdef LOW
uniform float coastPixelScale; // metres per drawing-buffer pixel at one metre of distance
#else
vec3 coastPixel; // screen footprint, set before any branch or discard in the land main program
#endif
// Ragged bed-aligned slots. IDs 0 and 4 are overhang shadows with no painted back.
void coastRecess(vec2 en, float h, vec2 centre, float centreHeight, vec2 size, float id, float distance,
    inout vec3 rock, inout vec3 normal) {
  float dx = en.x - centre.x;
  float x = dx * 1.3 / size.x;
  float y = (h - centreHeight - dx - 0.7 * (en.y - centre.y)) / size.y;
#ifdef LOW
  float pixel = max(coastPixelScale * distance,0.00001);
  float roof = 0.46 + sin(dx * 1.7 + id * 1.3) * 0.055;
  float floor = -0.42 + sin(dx * 2.1 + id * 2.3) * 0.065;
  float aaX = max(0.05,pixel * 1.3 * 1.2 / size.x);
  float aaY = max(0.05,pixel * (1.7 + 1.0/coastExag) * 1.2 / size.y);
  float nearFace = 1.0 - smoothstep(3.0,7.0,abs(en.y-centre.y));
  float inside = (1.0-smoothstep(1.0-aaX,1.0+aaX,abs(x)))
    * smoothstep(floor-aaY,floor+aaY,y) * (1.0-smoothstep(roof-aaY,roof+aaY,y)) * nearFace;
  // Use the shorter extent too: a narrow tilted slit must not survive as a subpixel dash.
  float extent = min(2.0*size.x/1.3,size.y*coastExag*0.75);
  float openingFade = smoothstep(3.5,4.0,extent/pixel) * smoothstep(3.0,6.0,extent/pixel);
  float floorLight = 1.0-smoothstep(floor,roof,y);
  vec3 hollow = mix(vec3(0.085,0.073,0.060),vec3(0.17,0.14,0.105),floorLight);
  rock = mix(rock,hollow,inside * openingFade * 0.75);
#else
  float roof = 0.48 + (vnoise(vec2(dx * 2.3, id + 7.0)) - 0.5) * 0.20;
  float floor = -0.43 + (vnoise(vec2(dx * 3.1 + 2.0, id)) - 0.5) * 0.25;
  float end = 1.0 - abs(x) + (vnoise(en * 1.7 + id) - 0.5) * 0.24;
  float aa = max(0.035, (coastPixel.y / coastExag + coastPixel.x + coastPixel.z * 0.7) / size.y);
  float nearFace = 1.0 - smoothstep(3.0, 7.0, abs(en.y - centre.y));
  float inside = smoothstep(0.0, 0.14, end) * smoothstep(0.0, aa, roof - y)
    * smoothstep(0.0, aa, y - floor) * nearFace;
  float floorLight = 1.0 - smoothstep(floor, roof, y);
  float roofLip = (1.0 - smoothstep(0.04, 0.22 + aa, abs(y - roof)))
    * smoothstep(0.0, 0.18, end) * nearFace;
  float lowerLip = (1.0 - smoothstep(0.03, 0.18 + aa, abs(y - floor)))
    * smoothstep(0.0, 0.18, end) * nearFace;
  vec3 up = normalize(vec3(0.0, 1.0, 0.0) - normal * normal.y);
  // Upper ledge catches light; its underside and the back stay dark, with a readable brown-grey floor.
  normal = normalize(normal + up * roofLip * 0.42 + up * lowerLip * 0.28);
  if (id < 0.5 || id > 3.5) {
    rock *= 1.0 - inside * (0.50 + 0.22 * (1.0 - floorLight));
  } else {
    vec3 back = mix(vec3(0.025,0.022,0.020),vec3(0.085,0.071,0.055),floorLight);
#ifndef LOW
    back *= 0.88 + vnoise(en * 4.1) * 0.20;
#endif
    rock = mix(rock,back,inside * 0.93);
  }
  rock *= 1.0 - roofLip * inside * 0.27;
  rock += vec3(0.018,0.014,0.009) * lowerLip * floorLight;
#endif
}
#ifndef LOW
// Groups contain many thin units and a few thick beds; their thresholds and hardness vary by group.
vec3 coastBed(float strata) {
  float q = strata * 0.058 + sin(strata * 0.013) * 0.7;
  float cell = floor(q), f = fract(q), seed = hash(vec2(cell,8.3));
  float a = 0.035 + seed * 0.025, b = a + 0.04 + hash(vec2(cell,2.1)) * 0.045;
  float c = b + 0.035 + hash(vec2(cell,4.7)) * 0.06;
  float d = c + 0.055 + hash(vec2(cell,6.2)) * 0.10;
  float e = 0.72 + hash(vec2(cell,3.9)) * 0.11;
  float lo = 0.0, hi = a, bed = 0.0;
  if(f>a){lo=a;hi=b;bed=1.0;} if(f>b){lo=b;hi=c;bed=2.0;}
  if(f>c){lo=c;hi=d;bed=3.0;} if(f>d){lo=d;hi=e;bed=4.0;}
  if(f>e){lo=e;hi=1.0;bed=5.0;}
  return vec3((f-lo)/max(hi-lo,0.02),(hi-lo)*17.0,hash(vec2(cell,bed+31.0)));
}

#endif
#ifdef LOW
float coastLowSeam(float strata, float level, float halfBed, float span, float along, float id) {
  float width = max(halfBed,span * 1.25);
  float band = 1.0-smoothstep(width,width+span,abs(strata-level));
  // Conserve a thin bed's coverage as its support grows. No hard pinching or dotted pixel lines.
  float strength = halfBed / width;
  return band * strength * (0.72 + 0.28*sin(along*0.018+id*2.1));
}
#endif
void coastSurface(vec2 p, float drawnHeight, float fine, float distance, inout vec3 albedo, inout vec3 normal) {
#ifdef QUARRY
  // Interpolated coarse vertices must not leak mineral paint beyond the workings' exact boundary.
  if(p.x<quarryBox.x||p.x>quarryBox.z||p.y<quarryBox.y||p.y>quarryBox.w||p.y+coastOrigin.y>47000.0)return;
#endif
  vec4 w = vCoast * coastOn;
#ifdef QUARRY
  w.yz=vec2(0.0);
#endif
  if (max(max(w.x, w.y), max(w.z, w.w)) < 0.001) return;
  vec2 en = p + coastOrigin;
  float h = seaLevel + (drawnHeight - seaLevel) / coastExag;
  float south = smoothstep(-250.0, 150.0, en.y);
#ifdef LOW
  // No new noise or texture fetches on phones. Existing fine detail and the interpolated slope/zone mask suffice.
  vec3 rock = vec3(0.69, 0.66, 0.59) * (0.88 + fine * 0.18);
#ifdef QUARRY
  rock = vec3(.83,.80,.73) * (.96 + fine * .08);
#endif
  albedo = mix(albedo, rock, w.x);
  vec3 beds = vec3(0.29, 0.245, 0.195) * (0.83 + fine * 0.24);
  if (w.y > 0.001) {
    float dip = en.y < -1100.0 ? 1.0 : mix(0.24, 2.15, 1.0 - smoothstep(130.0, 360.0, en.y));
    float across = en.y < -1100.0 ? en.x + en.y * 0.7 : en.y;
    float coalStrata = h - across * dip + (en.y < -1100.0 ? 0.0 : 450.0);
    float along = en.x * 0.57 - en.y * 0.82;
    float span = max(coastPixelScale * distance * (1.7 + 1.0/coastExag),0.00001);
    float c0 = coastLowSeam(coalStrata,235.0,0.10,span,along,0.0);
    float c1 = coastLowSeam(coalStrata,277.0,0.085,span,along,1.0);
    float c2 = coastLowSeam(coalStrata,326.0,0.115,span,along,2.0);
    float coal = max(c0,max(c1,c2));
    beds = mix(beds,vec3(0.028,0.029,0.028),coal * 0.85);
  }
  albedo = mix(albedo, beds, w.y);
  albedo = mix(albedo, vec3(0.255, 0.205, 0.165) * (0.82 + fine * 0.3), w.z);
  vec3 sand = mix(vec3(0.53, 0.46, 0.35), vec3(0.255, 0.225, 0.18), 1.0 - smoothstep(0.18, 1.0, h));
#ifdef QUARRY
  sand = vec3(.83,.805,.74);
#endif
  albedo = mix(albedo, sand * (0.9 + fine * 0.15) * (1.0 - south * 0.12), w.w);
#else
  float warp = vnoise(en * 0.13), grain = vnoise(vec2(en.x + en.y, h) * 7.3);
  if (w.x > 0.001) {
#ifdef QUARRY
    // Smooth, low-contrast mineral variation spans 7–16 m; never threshold noise into filled cells.
    vec2 local=en-vec2(13750.0,44500.0);
    vec2 broadDomain=vec2(dot(local,vec2(.62,.785)),h+dot(local,vec2(.08,-.05)));
    float broad=vnoise(broadDomain*.065),soft=vnoise(broadDomain*.14+7.0);
    vec3 gypsum=vec3(.83,.806,.744)*(.965+.05*broad+.015*soft);
    // A rotated face/up domain gives oblique joints; cell IDs only break the thin lines.
    vec2 faceAxis=abs(normal.z)>abs(normal.x)?vec2(1.0,0.0):vec2(0.0,1.0);
    vec2 face=vec2(dot(local,faceAxis),h);
    vec2 q=mat2(.978148,-.207912,.207912,.978148)*face;
    float jointCoord=q.x+.38*(vnoise(q*.075+3.0)-.5);
    float jointCell=floor(jointCoord/7.8),jointDistance=abs(fract(jointCoord/7.8)-.5)*7.8;
    float bedCoord=q.y+.45*(vnoise(q*.055+11.0)-.5);
    float bedCell=floor(bedCoord/10.5),bedDistance=abs(fract(bedCoord/10.5)-.5)*10.5;
    // coastPixel was differentiated before all branches/discards. Conserve a subpixel crack's coverage.
    float pixel=max(.002,dot(abs(faceAxis),coastPixel.xz)+coastPixel.y/coastExag);
    float aa=max(.003,pixel*.7),coverage=.045/(.045+aa);
    float joint=(1.0-smoothstep(.022,.022+aa,jointDistance))*coverage;
    float bed=(1.0-smoothstep(.018,.018+aa,bedDistance))*coverage;
    joint*=smoothstep(.27,.64,vnoise(vec2(jointCell*1.7,q.y*.12)));
    bed*=smoothstep(.48,.78,vnoise(vec2(q.x*.10,bedCell*1.3)));
    gypsum=mix(gypsum,vec3(.39,.325,.235),joint*.55+bed*.30);
    float seep=(1.0-smoothstep(.10,.30+aa,jointDistance))*smoothstep(.66,.86,soft);
    gypsum=mix(gypsum,vec3(.62,.50,.34),seep*.055);
    // Shadow belongs to measured bench feet, not an invented height contour.
    gypsum*=1.0-max(-vCoast.y,0.0)*.17;
    albedo=mix(albedo,gypsum,w.x);
  }
#else
    // Unequal upright lobes and vertical stained joints, never regular horizontal strata.
    float phase = en.y * 0.68 + en.x * 0.20 + vnoise(vec2(en.y * 0.11, h * 0.06)) * 3.0;
    float ribs = sin(phase), joint = 1.0 - smoothstep(0.02, 0.20, abs(sin(phase * 0.53 + warp * 0.7)));
    float dirty = smoothstep(0.63, 0.85, vnoise(vec2(en.y * 0.085, h * 0.23) + 13.0));
    vec3 gypsum = mix(vec3(0.70,0.67,0.61), vec3(0.87,0.85,0.79), warp);
    gypsum *= (0.88 + ribs * 0.10) * (0.91 + grain * 0.15);
    gypsum = mix(gypsum, vec3(0.30,0.205,0.125), joint * 0.66 + dirty * 0.25);
    albedo = mix(albedo, gypsum, w.x);
    normal = normalize(normal + vec3(0.0, ribs * 0.07, cos(phase) * 0.20) * w.x);
  }
#endif

  if (w.y > 0.001) {
    // Finlay's seaward beds dip about 45 degrees. Northward dip steepens beside the gypsum, then eases south.
    float dip = en.y < -1100.0 ? 1.0 : mix(0.24, 2.15, 1.0 - smoothstep(130.0, 360.0, en.y));
    float across = en.y < -1100.0 ? en.x + en.y * 0.7 : en.y;
    float strata = h - across * dip;
    vec3 bed = coastBed(strata + (warp - 0.5) * 0.35);
    float bend = clamp((en.y - 130.0) / 230.0, 0.0, 1.0);
    float dipChange = -1.91 * 6.0 * bend * (1.0 - bend) / 230.0;
    float span = coastPixel.y / coastExag + (en.y < -1100.0
      ? coastPixel.x + 0.7 * coastPixel.z : abs(dip + en.y * dipChange) * coastPixel.z);
    float aa = max(0.018, span / max(bed.y,0.3));
    float top = 1.0 - smoothstep(0.02, min(0.36,0.16/max(bed.y,0.3)) + aa, bed.x);
    float under = smoothstep(0.90-aa,0.99,bed.x);
    float slump = smoothstep(0.54,0.76,vnoise(vec2(en.x * 0.035, en.y * 0.023 + h * 0.045)));
    float jointCell = floor(en.x / 9.0);
    float jointX = (jointCell + 0.22 + hash(vec2(jointCell,3.7))*0.56)*9.0;
    float joint = 1.0 - smoothstep(0.04,0.18 + coastPixel.x,abs(en.x-jointX+sin(h*.23)*.16));
    float relief = (0.4 + bed.z * 0.6) * (1.0 - slump) * (1.0-joint*.6);
    vec3 gradient = en.y < -1100.0 ? vec3(-1.0,1.0/coastExag,-0.7)
      : vec3(0.0,1.0/coastExag,-dip-en.y*dipChange);
    vec3 bedUp = normalize(gradient-normal*dot(normal,gradient)+vec3(0.0,0.0001,0.0));
    normal = normalize(normal + bedUp * (top * 0.65 - under * 0.27) * relief * w.y);
    vec3 beds = vec3(0.30,0.26,0.22) * (0.94 + warp * 0.08) * (0.94 + grain * 0.10);
    float parting = (1.0 - smoothstep(0.015,0.045+aa,bed.x)) * step(0.62,bed.z) * relief;
    beds *= 1.0 - under * relief * 0.13 - parting * 0.10 - joint * 0.22;
    // Only three authored, unequal seam levels. Their thin traces pinch out and disappear in slumps.
    float along = en.x * 0.57 - en.y * 0.82;
    float coalStrata = strata + (en.y < -1100.0 ? 0.0 : 450.0);
    float c0 = (1.0-smoothstep(0.09,0.20+span,abs(coalStrata-235.0)))
      * smoothstep(0.25,0.66,vnoise(vec2(along*.035,3.7)));
    float c1 = (1.0-smoothstep(0.07,0.17+span,abs(coalStrata-277.0)))
      * smoothstep(0.30,0.70,vnoise(vec2(along*.028,8.1)));
    float c2 = (1.0-smoothstep(0.10,0.23+span,abs(coalStrata-326.0)))
      * smoothstep(0.23,0.65,vnoise(vec2(along*.041,12.4)));
    float coal = max(c0,max(c1,c2)) * (1.0-slump) / (1.0+span*1.5);
    beds = mix(beds,vec3(0.028,0.029,0.028),coal * 0.85);
    albedo = mix(albedo,beds,w.y);

  }
  if (w.z > 0.001) {
    float gully = vnoise(vec2(en.y * 0.45 + warp * 2.0, h * 0.045));
    vec3 broken = mix(vec3(0.19,0.165,0.15),vec3(0.32,0.24,0.19),warp) * (0.72 + gully * 0.42);
    float tongue = smoothstep(0.64,0.82,gully) * (1.0-smoothstep(0.3,0.8,vCoast.z));
    broken = mix(broken,vec3(0.12,0.17,0.055),tongue);
    albedo = mix(albedo,broken * (0.88+grain*0.2),w.z);
    normal = normalize(normal + vec3(0.0,0.04,(gully-.5)*.19)*w.z);
  }
  if (w.w > 0.001) {
    float wet = 1.0 - smoothstep(0.18, 1.1, h);
    vec3 sand = mix(vec3(0.55,0.48,0.365),vec3(0.245,0.22,0.18),wet);
    float sandGrain = vnoise(en * 4.3);
    // Height contours track the measured water edge: sparse broken tide lines, not cross-beach smears.
    float strandHeight = h + (vnoise(en * 0.11)-0.5)*0.05;
    float strandDistance = min(abs(strandHeight-0.30),abs(strandHeight-0.78));
    float strandPixel = coastPixel.y / coastExag;
    float strand = (1.0-smoothstep(0.015,0.045+strandPixel,strandDistance))
      * smoothstep(0.35,0.70,vnoise(en*.045)) * min(1.0,0.045/max(strandPixel,0.01));
    float toePatch = smoothstep(1.5,2.8,h) * smoothstep(.61,.84,vnoise(en*.28 + warp));
    sand = mix(sand,vec3(0.07,0.068,0.057),strand * 0.40 + toePatch * 0.22);
    float gravel = south * smoothstep(.57,.75,sandGrain);
    sand = mix(sand,vec3(0.18,0.17,0.155),gravel*.55);
#ifdef QUARRY
    sand = mix(vec3(.79,.765,.695),vec3(.89,.87,.81),sandGrain);
#endif
    albedo = mix(albedo,sand*(0.94+sandGrain*.12),w.w);
  }
#endif
  if (w.y > 0.1 && en.y < -1200.0 && en.x > 560.0 && en.x < 710.0) {
    vec3 rock = albedo;
    for (int i=0; i<5; i++) {
      vec4 anchor = coastRecessAnchor[i];
      coastRecess(en,h,anchor.xy,anchor.z,vec2(anchor.w,coastRecessRise[i]),float(i),distance,rock,normal);
    }
    albedo = mix(albedo,rock,coastOn);
  }
}
#endif
`;

const ROAD_CUT_PARS = /* glsl */ `
/* MODERN_ROAD_CUT_BEGIN */
uniform highp sampler2DArray tRoadCut;
uniform vec4 roadCutLayout;
uniform vec4 roadCutRect;
uniform float roadCuts;
vec4 cutPixel(int pixel){
  int side=int(roadCutLayout.w),pageSize=side*side,layer=pixel/pageSize,at=pixel-layer*pageSize;
  return texelFetch(tRoadCut,ivec3(at%side,at/side,int(roadCutLayout.z)+layer),0);
}
/* MODERN_ROAD_CUT_END */
`;
const ROAD_CUT_FRAG = /* glsl */ `
/* MODERN_ROAD_CUT_BEGIN */
bool roadCutDiscard=false;
if (roadCuts > 0.5) {
  ivec2 cell=ivec2(floor(vWorld.xz-roadCutRect.xy)),dims=ivec2(roadCutLayout.xy);
  if(min(cell.x,cell.y)>=0 && cell.x<dims.x && cell.y<dims.y){
    int cols=(dims.x+15)/16,head=(cell.y/16)*cols+cell.x/16;
    int block=int(cutPixel(head).r);
    if(block>=0){
      vec4 record=cutPixel(block+(cell.y%16)*16+cell.x%16);
      int offset=int(record.r),count=int(record.g);float lowest=1e20;
      for(int i=0;i<count;i++){
        int ix=offset+i;vec4 ids=cutPixel(ix/4);int vertex=int(ids[ix%4]);
        vec3 a=cutPixel(vertex).xyz,b=cutPixel(vertex+1).xyz,c=cutPixel(vertex+2).xyz;
        vec2 ab=b.xz-a.xz,ac=c.xz-a.xz,p=vWorld.xz-a.xz;float det=ab.x*ac.y-ab.y*ac.x;
        if(abs(det)<1e-8)continue;
        float u=(p.x*ac.y-p.y*ac.x)/det,v=(ab.x*p.y-ab.y*p.x)/det;
        if(u>=0.0&&v>=0.0&&u+v<=1.0)lowest=min(lowest,a.y+u*(b.y-a.y)+v*(c.y-a.y));
      }
      if(vWorld.y>lowest-.035)roadCutDiscard=true;
    }
  }
}
/* MODERN_ROAD_CUT_END */
`;

export const TERRAIN_FRAG = /* glsl */ `
#ifdef AIRPORT
// Point Tupper airport markings, shaded on the land itself so they cannot float above a changing LOD.
// Only tiles that overlap the airport site compile this (terrain.ts sets AIRPORT); other programs are unchanged.
uniform vec4 airportFrame; // threshold world xz, unit direction world xz
uniform vec2 airportSize; // length, width; zero outside Point Tupper
float airportBox(vec2 p, vec2 c, vec2 h) { return 1.0-step(0.0,max(abs(p.x-c.x)-h.x,abs(p.y-c.y)-h.y)); }
float airportDigit(vec2 p,float digit){
  // Seven straight strokes. Local x across the runway, y along the reading direction.
  float a=airportBox(p,vec2(0.,8.),vec2(1.6,.35));
  float g=airportBox(p,vec2(0.,4.),vec2(1.6,.35));
  float d=airportBox(p,vec2(0.,0.),vec2(1.6,.35));
  float b=airportBox(p,vec2(1.6,6.),vec2(.35,2.));
  float c=airportBox(p,vec2(1.6,2.),vec2(.35,2.));
  float e=airportBox(p,vec2(-1.6,2.),vec2(.35,2.));
  float f=airportBox(p,vec2(-1.6,6.),vec2(.35,2.));
  return digit<1.5?max(b,c):digit<2.5?max(max(max(a,b),g),max(e,d)):max(max(max(a,b),c),max(max(f,g),d));
}
float airportPaint(vec2 world){
  if(airportSize.x<=0.)return 0.;
  vec2 d=world-airportFrame.xy,u=airportFrame.zw;
  float along=dot(d,u),across=dot(d,vec2(-u.y,u.x));
  if(along<0.||along>airportSize.x||abs(across)>airportSize.y*.5)return 0.;
  float end=min(along,airportSize.x-along);
  float edge=step(airportSize.y*.5-.65,abs(across));
  float centre=(1.-step(.45,abs(across)))*step(90.,end)*(1.-step(30.,mod(along,60.)));
  float bars=step(6.,end)*(1.-step(30.,end))*step(3.,abs(across))*(1.-step(18.,abs(across)))*(1.-step(1.8,mod(abs(across)-3.,3.)));
  bool west=along<airportSize.x*.5;
  vec2 p=vec2(west?across:-across,end-48.);
  float nums=max(airportDigit(p-vec2(-3.3,0.),west?1.:2.),airportDigit(p-vec2(3.3,0.),west?1.:9.));
  return max(max(edge,centre),max(bars,nums));
}
#endif
#include <common>
#include <packing>
#include <logdepthbuf_pars_fragment>
${COMMON}
${SUN_SHADOW}
${GROUND_COLOR}
${COAST_SURFACE}
#if !defined(LOW) && !defined(MIRROR)
uniform vec3 grassFocus;   // camera xz and local grass shade strength; zero when off
#endif
${ROAD_CUT_PARS}
/* MODERN_ROAD_PAINT_BEGIN */
// The road field is horizontal. Limit colour, keeping road occupancy/water logic unchanged.
bool roadPaintOnGrade(float grade) { return grade <= 0.70020754; } // tan(35 degrees)
/* MODERN_ROAD_PAINT_END */
uniform sampler2D tNormal;   // RG normal xz, B canopy height / 51 m, A ground slope
uniform sampler2D tCover;    // R red-turning share, G yellow-turning share, B class
uniform sampler2D tRoad;     // R distance to the road centreline (signed about roadZero when baked so), G half width / 12.75 m, B kind (1-5)
uniform float roadZero;      // 0 for the old unsigned field, 128/255 for the signed one
uniform sampler2D tBrook;    // RG vector to a brook's centre line in world x and z (128/255 is zero, 0.1 m a step), B half width / 5.1 m, A direction of flow
uniform float brook;         // 1 when this tile has a brook field
uniform vec4 hideQuad;       // 1 hides a quarter of the tile (NW, NE, SW, SE) that finer tiles draw instead
#ifdef MIRROR
uniform float sourceHull;
uniform vec2 mirrorFocus;
#define hull mix(sourceHull, 1.0, smoothstep(280.0, 330.0, length(vWorld.xz - mirrorFocus)))
#else
uniform float hull;
#endif
// 1: this tile shows forest as a raised surface; 0: single trees stand on it
uniform vec4 coverRect;      // xmin, zmin, 1/width, 1/depth in world units
uniform float texel;         // metres per sample of this tile
varying vec2 vUv;
varying vec3 vWorld;
varying float vGround;
#ifdef QUARRY
uniform sampler2D quarryLakeAtlas;
uniform mat4 projectionMatrix;
uniform vec4 quarryViewport; // actual draw viewport, including render targets
varying float vQuarryWaterDrop;
uniform vec4 quarryLakeGrid; // world xz origin, grid width, cell size
uniform vec2 quarryLakeAtlasSize;
uniform vec2 quarryLakeExtra; // coverage length and row count; boundary records follow it in atlas alpha
uniform vec2 quarryLakePlanes; // actual drawn planes, including their 0.18 m offset
uniform vec2 quarryLakeVisible;
float quarryLakeBits(vec2 p){
  vec2 cell=floor((p-quarryLakeGrid.xy)/quarryLakeGrid.w);
  float index=cell.y*quarryLakeGrid.z+cell.x;
  if(cell.x<0.0||cell.x>=quarryLakeGrid.z||cell.y<0.0||index>=quarryLakeExtra.x)return 0.0;
  ivec2 pixel=ivec2(int(mod(index,quarryLakeAtlasSize.x)),int(quarryLakeAtlasSize.y-1.0-floor(index/quarryLakeAtlasSize.x)));
  // WebGL2 texel fetch ignores the sign atlas's anisotropic colour filtering and mipmaps.
  return floor(texelFetch(quarryLakeAtlas,pixel,0).a*255.0+.5)-240.0;
}
float quarryLakeId(vec2 p){return mod(quarryLakeBits(p),4.0);}
// Alpha nibbles keep the existing opaque sign RGB intact; no extra texture or draw.
float quarryNibble(float index){
  ivec2 pixel=ivec2(int(mod(index,quarryLakeAtlasSize.x)),int(quarryLakeAtlasSize.y-1.0-floor(index/quarryLakeAtlasSize.x)));
  return floor(texelFetch(quarryLakeAtlas,pixel,0).a*255.0+.5)-240.0;
}
uint quarryWord(float at,int count){uint value=0u;for(int j=0;j<8;j++){if(j>=count)break;value|=uint(quarryNibble(at+float(j)))<<uint(j*4);}return value;}
float quarryFloat(float at){return uintBitsToFloat(quarryWord(at,8));}
bool quarryLakeBoundaryHit(vec2 p,int lake){
  float row=floor((p.y-quarryLakeGrid.y)/quarryLakeGrid.w);if(row<0.0||row>=quarryLakeExtra.y)return false;
  float head=quarryLakeExtra.x+(row*2.0+float(lake))*8.0,at=float(quarryWord(head,6));int count=int(quarryWord(head+6.0,2)),winding=0;
  for(int j=0;j<255;j++){
    if(j>=count)break;float base=at+float(j)*32.0;
    float az=quarryFloat(base+8.0),bz=quarryFloat(base+24.0);
    if((az>p.y)==(bz>p.y))continue;
    float ax=quarryFloat(base),bx=quarryFloat(base+16.0);
    float crossing=(bx-ax)*(p.y-az)/(bz-az);
    if(p.x-ax<crossing)winding+=bz>az?1:-1;
  }
  return winding!=0;
}
// Use the actual pixel, not interpolated surveyed heights. At grazing angles,
// subtracting their nearly equal Float32 values shifts the sheet hit by centimetres.
vec3 quarryViewRay(){
  vec2 ndc=(gl_FragCoord.xy-quarryViewport.xy)/quarryViewport.zw*2.0-1.0;
  vec2 xy=(ndc+vec2(projectionMatrix[2][0],projectionMatrix[2][1]))/vec2(projectionMatrix[0][0],projectionMatrix[1][1]);
  return transpose(mat3(viewMatrix))*vec3(xy,-1.0);
}
bool quarryWaterBacked(vec3 p){
  if(p.x<quarryBox.x||p.x>quarryBox.z||p.z<quarryBox.y||p.z>quarryBox.w)return false;
  vec3 ray=quarryViewRay();
  if(abs(ray.y)<.000001)return false;
  for(int i=0;i<2;i++){
    if((i==0?quarryLakeVisible.x:quarryLakeVisible.y)<.5)continue;
    float plane=i==0?quarryLakePlanes.x:quarryLakePlanes.y;
    float level=seaLevel+(plane-.18-seaLevel)/coastExag;
    // Each pool clips its own returns, viewed from above its real plane.
    if(cameraPosition.y<=plane||abs(100.0*vCoast.z-level)>.02)continue;
    float t=(plane-cameraPosition.y)/ray.y;
    if(t<=0.0)continue;
    vec2 hit=cameraPosition.xz+ray.xz*t;
    float id=float(i+1),back=quarryLakeId(hit);
    // Exposed bank remains. Higher survey returns are removed only inside this same lake,
    // with a real sheet triangle behind their screen ray.
    bool covered=abs(back-id)<.1||(back>2.5&&quarryLakeBoundaryHit(hit,i));
    if(covered&&(p.y<plane||p.y<vGround-vQuarryWaterDrop-.01))return true;
  }
  return false;
}
#endif

// Crowns: each tree is a cell of a jittered grid. Returns the cell id (xy) and the distance to its centre (z);
// off is the vector from the pixel to the crown centre.
// One pothole at most in each 3 m cell, from an integer hash. web/src/defects.ts has the same maths for the wheels.
float pothole(vec2 p, float density) {
  vec2 c = floor(p / 3.0);
  uint h = (uint(int(c.x)) * 73856093u) ^ (uint(int(c.y)) * 19349663u);
  h ^= h >> 13; h *= 0x5bd1e995u; h ^= h >> 15;
  float r1 = float(h & 255u) / 255.0, r2 = float((h >> 8) & 255u) / 255.0, r3 = float((h >> 16) & 255u) / 255.0, r4 = float(h >> 24) / 255.0;
  if (r1 >= density) return 0.0;
  vec2 pc = (c + 0.22 + 0.56 * vec2(r2, r3)) * 3.0;
  float radius = 0.25 + 0.4 * r4, d = length(p - pc);
  if (d >= radius) return 0.0;
  return (0.05 + 0.09 * r2) * min(1.0, (1.0 - d / radius) * 2.2);
}

vec3 crownCell(vec2 p, out vec2 off) {
  vec2 g = floor(p), f = fract(p);
  float md = 8.0;
  vec2 id = g;
  off = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j));
    vec2 c = g + o;
    vec2 r = o + vec2(hash(c), hash(c + 31.7)) - f;
    float d = dot(r, r);
    if (d < md) { md = d; id = c; off = r; }
  }
  return vec3(id, sqrt(md));
}

vec3 leafColor(float r, float v, float turned, float dull, float red, float yel) {
  vec3 conifer = mix(vec3(0.020, 0.050, 0.028), vec3(0.040, 0.085, 0.035), v);
  vec3 lateGreen = mix(vec3(0.090, 0.130, 0.030), vec3(0.150, 0.170, 0.040), v);
  vec3 redC = mix(vec3(0.230, 0.040, 0.020), vec3(0.400, 0.130, 0.028), v);
  vec3 yelC = mix(vec3(0.330, 0.200, 0.035), vec3(0.470, 0.330, 0.060), v);
  vec3 brown = vec3(0.150, 0.095, 0.050);
  vec3 c = conifer;
  if (r < red) c = turned < 0.82 ? mix(redC, brown, step(0.86, dull)) : lateGreen;
  else if (r < red + yel) c = turned < 0.78 ? mix(yelC, brown, step(0.90, dull)) : lateGreen;
  return c;
}

vec3 treeColor(vec2 p, float red, float yel, float dist) {
  // The average colour of the stand, for distances where one pixel holds many crowns.
  vec3 conifer = vec3(0.030, 0.068, 0.032), lateGreen = vec3(0.120, 0.150, 0.035);
  vec3 avg = conifer * max(1.0 - red - yel, 0.0)
    + red * mix(lateGreen, vec3(0.300, 0.085, 0.027), 0.82)
    + yel * mix(lateGreen, vec3(0.390, 0.260, 0.050), 0.78);
  avg *= 0.80;   // gaps between crowns are in shade
#if defined(MIRROR)
  float far = clamp(smoothstep(280.0, 420.0, dist) + step(3.0, texel), 0.0, 1.0);
#elif defined(LOW)
  float far = clamp(smoothstep(50.0, 200.0, dist) + step(3.0, texel), 0.0, 1.0);
#else
  float far = clamp(smoothstep(200.0, 1400.0, dist) + step(6.0, texel), 0.0, 1.0);
#endif
  if (far > 0.999) return avg * (0.9 + 0.2 * vnoise(p * 0.02));
  vec2 off;
  vec3 cell = crownCell(p / 5.5, off);
  vec2 id = cell.xy;
  vec3 c = leafColor(hash(id), hash(id + 17.3), hash(id + 71.9), hash(id + 5.5), red, yel);
  // A crown is a dome: darker at its rim, brighter on the side that faces the sun.
  float rim = 1.0 - 0.5 * smoothstep(0.22, 0.72, cell.z);
  float side = 1.0 + 0.35 * dot(normalize(-off + 1e-4), normalize(sunDir.xz + 1e-4)) * smoothstep(0.05, 0.5, cell.z);
  c *= rim * side * (0.85 + 0.3 * vnoise(p * 1.3));
  return mix(c, avg, far);
}

// A brook: shallow tea-brown water over stones. The pattern runs downstream; where the bed falls fast it breaks white.
// mid is 0 at the water's edge and 1 in the middle; fall is the slope of the bed along the flow (1 = one in four);
// light is what falls on the bed.
vec3 brookColor(vec3 world, vec3 cam, vec2 flow, float mid, float fall, vec3 light) {
  vec2 p = world.xz, across = vec2(-flow.y, flow.x);
  vec3 v = normalize(cam - world);
  vec3 bed = mix(vec3(0.060, 0.050, 0.036), vec3(0.120, 0.104, 0.080), vnoise(p * 3.7)) * (0.75 + 0.5 * vnoise(p * 13.0));
  vec3 body = mix(bed, vec3(0.030, 0.023, 0.013), smoothstep(0.0, 0.9, mid) * 0.8) * light;
#ifdef LOW
  return mix(body, skyAt(reflect(-v, vec3(0.0, 1.0, 0.0))) * 0.5, 0.2);
#else
  vec2 q = vec2(dot(p, across), dot(p, flow) - time * (0.45 + 1.8 * fall));
  float rip = 0.6 * vnoise(q * vec2(6.0, 1.1)) + 0.4 * vnoise(q * vec2(13.0, 2.4) + 7.0);
  float tilt = (rip - 0.5) * (0.30 + 0.5 * fall);
  vec3 n = normalize(vec3(across.x * tilt, 1.0, across.y * tilt));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  r.y = abs(r.y);
  // Banks and trees stand over a brook, so it mirrors only part of the sky.
  vec3 col = mix(body, skyAt(r) * 0.55, fres * 0.7) + sunColor * pow(max(dot(r, sunDir), 0.0), 160.0) * 0.35;
  // White water where it runs fast: thin streaks that move with the flow.
  float riffle = smoothstep(0.72, 0.92, rip) * smoothstep(0.16, 0.55, fall) * (0.35 + 0.65 * mid);
  return mix(col, vec3(0.42, 0.44, 0.42) * (0.3 + 0.7 * clamp(light.g, 0.15, 1.0)), riffle * 0.5);
#endif
}

void main() {
#if defined(COAST_SHORE) && !defined(LOW)
  // Derivatives must precede the material branches and quadrant discard, including in the mirror.
  coastPixel = fwidth(vec3(vWorld.x, vGround, vWorld.z));
#endif
#if defined(SEA_WATER) && !defined(LOW) && !defined(MIRROR)
  float waterFootprint = max(length(dFdx(vWorld.xz)), length(dFdy(vWorld.xz))), groundEdge = fwidth(vGround);
#endif
/* MODERN_ROAD_PAINT_BEGIN */
  // Use the rendered face, not the smoothed lighting normal or the clamped DTM slope.
  // Derivatives precede all quadrant/material discards, including the mirror pass.
  vec3 roadFace = cross(dFdx(vWorld), dFdy(vWorld));
  float roadGrade = length(roadFace.xz) / max(abs(roadFace.y), 0.000001);
  float roadPaint = roadPaintOnGrade(roadGrade) ? 1.0 : 0.0;
/* MODERN_ROAD_PAINT_END */
#ifdef QUARRY
  // The plane bounds ordinary clipping; higher survey noise needs a water-backed footprint too.
  if(vCoast.z>0.0 && quarryWaterBacked(vWorld))discard;
#ifdef MIRROR
  if(vWorld.x>=quarryBox.x&&vWorld.x<=quarryBox.z&&vWorld.z>=quarryBox.y&&vWorld.z<=quarryBox.w&&vGround<quarryReflectionLevel)discard;
#endif
#endif
  float quarter = step(0.5, vUv.x) + 2.0 * step(0.5, vUv.y);
  if ((quarter < 0.5 ? hideQuad.x : quarter < 1.5 ? hideQuad.y : quarter < 2.5 ? hideQuad.z : hideQuad.w) > 0.5) discard;
  #include <logdepthbuf_fragment>
  ${ROAD_CUT_FRAG}
  vec2 tuv = (vUv * 256.0 + 0.5) / 257.0;
  vec4 nm = texture2D(tNormal, tuv);
  vec2 nxz = nm.xy * 2.0 - 1.0;
  vec3 n = normalize(vec3(nxz.x, sqrt(max(1.0 - dot(nxz, nxz), 0.02)), nxz.y));
  float canopy = nm.b * 51.0;
  float slope = nm.a;
  float dist = length(cameraPosition - vWorld);

  vec2 cuv = vec2((vWorld.x - coverRect.x) * coverRect.z, (vWorld.z - coverRect.y) * coverRect.w);
  float inCover = step(0.0, cuv.x) * step(cuv.x, 1.0) * step(0.0, cuv.y) * step(cuv.y, 1.0);
  vec4 cov = texture2D(tCover, cuv);
  float cls = floor(cov.b * 255.0 + 0.5) * inCover;
#ifdef GROUND_CLASSES
  if(cls==6.0||cls==8.0)canopy=0.0;
#endif
  // 25 steps per tenth in the texture, so 250 = all of the stand.
  float red = mix(0.22, cov.r * 255.0 / 250.0, inCover * step(0.5, cls));
  float yel = mix(0.30, cov.g * 255.0 / 250.0, inCover * step(0.5, cls));
#ifdef GROUND_CLASSES
  if (cls > 1.5 && cls != 9.0) { red = 0.30; yel = 0.40; }   // class 9 retains the previous canopy palette in R/G
#else
  if (cls > 1.5) { red = 0.30; yel = 0.40; }   // trees outside forest stands: yards and fence lines
#endif

  vec2 p = vWorld.xz;
  float big = fbm(p * 0.004), mid = fbm(p * 0.03), fine = vnoise(p * 0.9);

  vec3 soil = vec3(0.150, 0.110, 0.075);
  vec3 albedo = groundColor(p, cls, big, mid, fine);
  albedo = mix(albedo, soil, smoothstep(0.55, 0.9, slope) * 0.7);
#ifdef GROUND_CLASSES
  if(cls==6.0)albedo=mix(albedo,vec3(.29,.29,.27)*(.8+.3*fine),smoothstep(.35,.75,slope));
#endif
  // Shingle and mud at the shore.
  albedo = mix(albedo, vec3(0.240, 0.210, 0.170), (1.0 - smoothstep(0.3, 1.4, vGround - seaLevel)) * step(canopy, 1.0));

#if defined(SEA_WATER) && !defined(LOW)
  // Wet shingle darkens below the last small lap; it dries gradually above the tide.
  float lap = 0.055 * sin(time * 1.35 + dot(p, vec2(0.18, 0.11)));
  float wet = (1.0 - smoothstep(0.12 + lap, 0.85, vGround - seaLevel)) * step(canopy, 1.0);
  albedo *= 1.0 - wet * 0.42;
#endif

#ifdef COAST_SHORE
  coastSurface(p, vGround, fine, dist, albedo, n);
#endif

#ifdef QUARRY
  bool inQuarry=p.x>=quarryBox.x&&p.x<=quarryBox.z&&p.y>=quarryBox.y&&p.y<=quarryBox.w;
#endif
  // ---- roads: painted from a distance field, so they cannot float above or sink into the land ----
  // The road field is read by hand, four samples at a time. Inside one road the signed distance blends smoothly and
  // passes through zero at the centre line. Where two roads meet, or a road ends, the samples disagree; a plain
  // blend there would pass through zero too and paint a thin false road along the seam (it showed as a zigzag strip
  // beside real roads). So in that case the unsigned distances are blended instead.
  vec2 rf = vUv * 256.0, r0 = min(floor(rf), 255.0), rw = rf - r0;
  ivec2 ri = ivec2(r0);
  vec4 qa = texelFetch(tRoad, ri, 0), qb = texelFetch(tRoad, ri + ivec2(1, 0), 0);
  vec4 qc = texelFetch(tRoad, ri + ivec2(0, 1), 0), qd = texelFetch(tRoad, ri + ivec2(1, 1), 0);
  // A sample with no road counts as far away.
  float sa = qa.b > 0.0 ? (qa.r - roadZero) * 25.5 : 13.0, sb = qb.b > 0.0 ? (qb.r - roadZero) * 25.5 : 13.0;
  float sc = qc.b > 0.0 ? (qc.r - roadZero) * 25.5 : 13.0, sd = qd.b > 0.0 ? (qd.r - roadZero) * 25.5 : 13.0;
  bool oneRoad = qa.b > 0.0 && qa.b == qb.b && qa.b == qc.b && qa.b == qd.b && qa.g == qb.g && qa.g == qc.g && qa.g == qd.g
    && max(max(abs(sa - sb), abs(sa - sc)), max(abs(sd - sb), abs(sd - sc))) < 1.6 * texel + 0.2;
  float rsigned = mix(mix(sa, sb, rw.x), mix(sc, sd, rw.x), rw.y);
  float rdist = oneRoad ? abs(rsigned) : mix(mix(abs(sa), abs(sb), rw.x), mix(abs(sc), abs(sd), rw.x), rw.y);
  // Kind and width are codes of the nearest sample, never blended.
  vec4 rk = rw.x < 0.5 ? (rw.y < 0.5 ? qa : qc) : (rw.y < 0.5 ? qb : qd);
  float rhalf = rk.g * 12.75;
  float rflags = floor(rk.b * 255.0 + 0.5);
  float rkind = mod(rflags, 16.0);
#ifdef AIRPORT
  // Inside the runway rectangle the field is exact: sampled paint would stair-step its 0.9 degree
  // edges. rdist reaches rhalf at the true edge, so the road edge and its stripe follow the line.
  {
    vec2 ad=vWorld.xz-airportFrame.xy;
    float aAlong=dot(ad,airportFrame.zw),aEdge=abs(dot(ad,vec2(-airportFrame.w,airportFrame.z)))-airportSize.y*.5;
    if(airportSize.x>0.&&aAlong>=0.&&aAlong<=airportSize.x&&aEdge<=0.){rkind=13.;rflags=13.;rhalf=2.;rdist=max(0.,aEdge+2.);}
  }
#endif
#ifdef SITE_GRAVEL
  float gravelOverlay=0.0;
  // Independent coverage avoids mixing the yard's distance field with mapped track distances.
  // The RGBA texels are already fetched above; no extra texture, sampler or draw is needed.
#ifdef QUARRY
  if(inQuarry){
#endif
  float coverage=mix(mix(qa.a,qb.a,rw.x),mix(qc.a,qd.a,rw.x),rw.y);
  gravelOverlay=smoothstep(0.25,0.75,coverage);
  if(gravelOverlay>0.001){
    float grit=vnoise(p*3.1),speck=vnoise(p*23.0);
    vec3 stone=mix(vec3(0.200,0.180,0.150),vec3(0.300,0.270,0.230),grit)*(0.8+0.4*speck);
#ifdef QUARRY
    if(inQuarry)stone=vec3(.74,.72,.66)*(0.92+speck*.14);
#endif
    albedo=mix(albedo,stone,gravelOverlay);
  }
#ifdef QUARRY
  }
#endif
#endif
  float wash = step(32.0, mod(rflags, 64.0));   // washboard road
  float onRoad = 0.0;
  if (rkind > 0.5 && rdist < 11.5) {
    float aa = max(fwidth(rdist), 0.02);
    float jump = oneRoad ? 0.0 : 1.0;   // no centre line and no ridges across a seam
    float paved = step(rkind, 2.5);
    onRoad = 1.0 - smoothstep(rhalf - aa, rhalf + aa, rdist);
    // A gravel shoulder beside pavement; a soft worn edge beside gravel and tracks.
    float shoulder = (1.0 - smoothstep(rhalf + mix(0.5, 1.3, paved), rhalf + mix(1.1, 1.9, paved) + aa, rdist)) * (1.0 - onRoad);
    float grit = vnoise(p * 3.1), speck = vnoise(p * 23.0);
    vec3 gravel = mix(vec3(0.200, 0.180, 0.150), vec3(0.300, 0.270, 0.230), grit) * (0.8 + 0.4 * speck);
    vec3 asphalt = mix(vec3(0.045, 0.046, 0.050), vec3(0.070, 0.070, 0.072), fbm(p * 0.35)) * (0.85 + 0.3 * speck);
    asphalt = mix(asphalt, vec3(0.030, 0.030, 0.033), step(0.72, vnoise(p * 0.11)) * 0.6);   // patches
    vec3 surface = asphalt;
    if (rkind > 7.5) {
      // A works yard or a lot (kinds 8 to 10): one even surface from edge to edge, with no potholes.
      float worn = fbm(p * 0.09);
      vec3 stone = mix(vec3(0.215, 0.212, 0.205), vec3(0.300, 0.292, 0.280), grit) * (0.82 + 0.36 * speck);
      vec3 sand = mix(vec3(0.330, 0.280, 0.215), vec3(0.430, 0.375, 0.290), grit) * (0.86 + 0.28 * speck);
      vec3 slab = mix(vec3(0.360, 0.350, 0.325), vec3(0.430, 0.420, 0.395), fbm(p * 0.6)) * (0.94 + 0.12 * speck);
      // Kind 12 is a mown lawn: short, even grass, a little striped by the mower.
      vec3 lawn = mix(vec3(0.085, 0.150, 0.035), vec3(0.150, 0.195, 0.055), fbm(p * 0.22)) * (0.90 + 0.20 * speck) * (0.95 + 0.05 * sin(p.x * 1.7 + p.y * 2.9));
      surface = rkind > 11.5 ? lawn : (rkind < 8.5 ? stone : rkind < 9.5 ? slab : sand) * (0.86 + 0.28 * worn);
#ifdef AIRPORT
      if (rkind > 12.5) surface = asphalt;
#endif
    } else if (rkind > 2.5 && rkind < 3.5) {
      // Gravel road: two packed wheel paths, loose stone between and outside, potholes.
      float track = smoothstep(0.55, 0.15, abs(rdist - rhalf * 0.5));
      surface = mix(gravel, gravel * 0.72, track);
    } else if (rkind > 4.5) {
      // Rail trail: fine crusher dust, packed flat and kept that way. Paler than a gravel road; no ruts, no holes.
      vec3 dust = mix(vec3(0.300, 0.280, 0.240), vec3(0.380, 0.360, 0.315), grit) * (0.92 + 0.16 * speck);
      float worn = smoothstep(0.5, 0.15, abs(rdist - rhalf * 0.45));
      surface = mix(dust, dust * 0.88, worn);
    } else if (rkind > 3.5) {
      // Track: dirt ruts with grass in the middle.
      float rut = smoothstep(0.45, 0.2, abs(rdist - 0.75));
#ifdef SITE_GRAVEL
      surface = mix(mix(albedo, vec3(0.160, 0.170, 0.060), 0.5*(1.0-gravelOverlay)), vec3(0.170, 0.130, 0.090), rut);
#else
      surface = mix(mix(albedo, vec3(0.160, 0.170, 0.060), 0.5), vec3(0.170, 0.130, 0.090), rut);
#endif
    } else if (rkind < 1.5) {
      // Highway paint: a double yellow centre line and white edge lines, worn in places.
      float wear = 0.55 + 0.45 * step(0.25, vnoise(p * 0.7));
      float yellow = smoothstep(0.045, 0.065 + aa, rdist) * (1.0 - smoothstep(0.165, 0.185 + aa, rdist)) * (1.0 - jump);
      float white = smoothstep(rhalf - 0.34 - aa, rhalf - 0.32, rdist) * (1.0 - smoothstep(rhalf - 0.22, rhalf - 0.20 + aa, rdist));
      float fade = 1.0 - smoothstep(60.0, 260.0, dist) * 0.6;
      surface = mix(surface, vec3(0.550, 0.400, 0.040), yellow * wear * fade);
      surface = mix(surface, vec3(0.550, 0.550, 0.520), white * wear * fade);
    }
    if (wash > 0.5) {
      // Washboard: ridges across the road. The road's direction is at right angles to the slope of the distance field.
      vec2 dpx = dFdx(vWorld.xz), dpy = dFdy(vWorld.xz);
      float ddx = dFdx(rsigned), ddy = dFdy(rsigned), det = dpx.x * dpy.y - dpx.y * dpy.x;
      vec2 g = abs(det) > 1e-9 ? vec2(ddx * dpy.y - ddy * dpx.y, ddy * dpx.x - ddx * dpy.x) / det : vec2(1.0, 0.0);
      vec2 along = normalize(vec2(-g.y, g.x) + 1e-5);
      float crest = 0.5 - 0.5 * cos(dot(p, along) * 10.134);   // one ridge every 0.62 m
      surface *= 1.0 - 0.30 * (1.0 - crest) * (1.0 - smoothstep(25.0, 90.0, dist)) * (1.0 - jump);
    }
#ifdef AIRPORT
    if(rkind>12.5) surface=mix(surface,vec3(.82),airportPaint(vWorld.xz));
#endif
    // Potholes: dark, broken bottoms. The wheels drop into the same ones.
    float density = rkind > 7.5 ? 0.0 : (rkind < 1.5 ? 0.17 : rkind < 2.5 ? 0.28 : rkind < 3.5 ? 0.42 : rkind < 4.5 ? 0.36 : 0.0) + 0.2 * wash;
    float hole = rdist < rhalf - 0.2 && density > 0.0 ? pothole(p, density) : 0.0;
    surface = mix(surface, mix(vec3(0.060, 0.052, 0.045), vec3(0.105, 0.092, 0.078), speck), smoothstep(0.0, 0.03, hole) * (1.0 - smoothstep(120.0, 400.0, dist)));
    albedo = mix(albedo, gravel, shoulder * 0.85 * step(rkind, 11.5) * roadPaint);   // a lawn has no gravel shoulder
#ifdef QUARRY
    if(inQuarry && ((rkind > 2.5 && rkind < 4.5) || rkind == 8.0)) {
      vec3 dust=vec3(.74,.72,.66)*(0.92+speck*.14);
      float wheel=1.0-smoothstep(.22,.52,abs(rdist-0.78));
      surface=mix(dust,dust*vec3(.58,.56,.51),wheel*.72*step(rkind,4.5));
#ifdef SITE_GRAVEL
      if(rkind==8.0)onRoad*=gravelOverlay;
#endif
      albedo=mix(albedo,dust*(.86+grit*.25),shoulder*.9 * roadPaint);
    }
#endif
    albedo = mix(albedo, surface, onRoad * roadPaint);
    canopy *= 1.0 - max(onRoad, shoulder);
  }

  // ---- brooks: painted from a field, read by hand as the road field is ----
  float brookWater = 0.0, brookMid = 0.0;
  vec2 brookFlow = vec2(0.0, 1.0);
  if (brook > 0.5) {
    vec4 ba = texelFetch(tBrook, ri, 0), bb = texelFetch(tBrook, ri + ivec2(1, 0), 0);
    vec4 bc = texelFetch(tBrook, ri + ivec2(0, 1), 0), bd = texelFetch(tBrook, ri + ivec2(1, 1), 0);
    // Each sample holds the vector from itself to the centre line. The blend of the four vectors passes through zero
    // on the line, so a brook narrower than a sample comes out whole, and no choice between formulas is needed.
    // Between two separate brooks the vectors point opposite ways and would also blend to zero. So each sample sets
    // a floor as well: a sample 8 m from every brook proves that a point 2 m from it is at least 6 m from one.
    // On the edge of a tile only the two edge samples count (the others fade out with their share of the blend),
    // so the next tile paints the same thing there. web/src/streams.ts has the same maths (brookBlend): keep them alike.
    // A point within painting distance of a brook (5 m at most) has a brook at all four samples: the field reaches
    // 12.5 m and is made only for samples 2 m apart or less (BROOK_NEAR and BROOK_SAMPLE in streams.ts give the sum).
    bool known = ba.b > 0.0 && bb.b > 0.0 && bc.b > 0.0 && bd.b > 0.0;
    vec2 va = ba.rg * 25.5 - 12.8, vb = bb.rg * 25.5 - 12.8, vc = bc.rg * 25.5 - 12.8, vd = bd.rg * 25.5 - 12.8;
    vec4 share = vec4((1.0 - rw.x) * (1.0 - rw.y), rw.x * (1.0 - rw.y), (1.0 - rw.x) * rw.y, rw.x * rw.y);
    vec4 away = vec4(length(rw), length(rw - vec2(1.0, 0.0)), length(rw - vec2(0.0, 1.0)), length(rw - vec2(1.0, 1.0))) * texel;
    // 0.071: the most that rounding a stored vector can add to its length, so a floor is never above the truth.
    vec4 least = vec4(length(va), length(vb), length(vc), length(vd)) - 0.071 - away - 20.0 * (1.0 - clamp(share * 8.0, 0.0, 1.0));
    float bdist = known ? max(length(va * share.x + vb * share.y + vc * share.z + vd * share.w), max(max(least.x, least.y), max(least.z, least.w))) : 13.0;
    vec4 bk = rw.x < 0.5 ? (rw.y < 0.5 ? ba : bc) : (rw.y < 0.5 ? bb : bd);
    float bhalf = bk.b * 5.1;
    if (known && bdist < bhalf + 3.0) {
      float baa = max(fwidth(bdist), 0.02);
      // Not under a road or its shoulder (the water is in a pipe there), and not on water that the map already shows.
      float nearRoad = rkind > 0.5 ? 1.0 - smoothstep(rhalf + 0.9, rhalf + 2.6, rdist) : 0.0;
      float mapped = (cls > 3.5 && cls < 4.5 && slope < 0.07) || vGround < seaLevel + 0.02 ? 1.0 : 0.0;
      float open = (1.0 - nearRoad) * (1.0 - mapped);
      brookWater = (1.0 - smoothstep(bhalf - baa, bhalf + baa, bdist)) * open;
      brookMid = clamp(1.0 - bdist / max(bhalf, 0.05), 0.0, 1.0);
      float ang = bk.a * 6.2831853;
      brookFlow = vec2(sin(ang), -cos(ang));   // world x is east, z is south
      // The banks: wet stones and mud at the edge, then a strip of rank grass that stays green late.
      float wet = (1.0 - smoothstep(bhalf + 0.15, bhalf + 0.75 + baa, bdist)) * open;
      float rank = (1.0 - smoothstep(bhalf + 0.8, bhalf + 2.8, bdist)) * open * (1.0 - smoothstep(1.8, 3.5, canopy));
      albedo = mix(albedo, mix(vec3(0.110, 0.140, 0.035), vec3(0.150, 0.165, 0.045), mid) * (0.8 + 0.4 * fine), rank * 0.6);
      albedo = mix(albedo, mix(vec3(0.090, 0.075, 0.055), vec3(0.200, 0.185, 0.160), step(0.55, vnoise(p * 2.3)) * vnoise(p * 9.0)), wet * 0.85);
      // No leaf litter on the water under single trees. A far forest, drawn as one raised surface, keeps its canopy:
      // the brook is under it and must stay hidden.
      canopy *= 1.0 - brookWater * (1.0 - hull);
    }
  }

  float tree = smoothstep(1.8, 3.5, canopy) * hull;
  // Under single trees the ground is leaf litter, in their shade.
  float under = smoothstep(1.8, 3.5, canopy) * (1.0 - hull);
  albedo = mix(albedo, vec3(0.170, 0.125, 0.070) * (0.8 + 0.4 * fine), under * 0.55);
  // Height shifts the crown pattern, so the steep side of a forest edge is not striped.
  albedo = mix(albedo, treeColor(p + vWorld.y * vec2(0.71, 0.37), red, yel, dist), tree);

#if !defined(LOW) && !defined(MIRROR)
#ifdef GROUND_CLASSES
  if (grassFocus.z > 0.0 && cls != 4.0 && cls != 6.0 && cls != 7.0 && cls != 10.0 && cls != 12.0 && canopy < 1.8 && vGround > seaLevel + 1.45 && slope < 0.62
#else
  if (grassFocus.z > 0.0 && cls != 4.0 && canopy < 1.8 && vGround > seaLevel + 1.45 && slope < 0.62
#endif
    && (rkind < 0.5 || rdist > rhalf + (rkind < 2.5 ? 2.35 : 1.5))) {
    // Dense roots shade the soil locally. Nothing changes beyond the near ring or on phones.
    float ring = (1.0 - smoothstep(14.0, 20.0, length(p - grassFocus.xy))) * grassFocus.z;
#ifdef COAST_SHORE
    // The bare beach has no grass roots; the old height cutoff otherwise draws a false sand seam.
    ring *= 1.0 - smoothstep(0.05,0.20,vCoast.w);
#endif
    albedo *= 1.0 - ring * (0.20 + 0.12 * vnoise(p * 11.0));
  }
#endif

  float diff = max(dot(n, sunDir), 0.0);
  // Crowns scatter light, so the shaded side of a forest is not black.
  diff = mix(diff, 0.35 + 0.65 * diff, tree * 0.5);
#ifdef SHADOWS
  diff *= sunShadow(vWorld);
#endif
  // Sky light from above, plus warm light that the sunlit land throws back onto shaded slopes.
  vec3 light = sunColor * diff + skyColor * (0.65 + 0.55 * n.y) * (1.0 - 0.35 * tree * (1.0 - n.y)) + sunColor * vec3(0.060, 0.050, 0.035);
#ifdef QUARRY
  if(inQuarry&&p.y+coastOrigin.y<=47000.0&&max(vCoast.x,vCoast.w)>.001){
  float mineralFill=smoothstep(.05,.60,max(vCoast.x,vCoast.w))*(1.0-tree);
  vec3 warmFill=vec3(max(dot(skyColor,vec3(.3,.5,.2)),.82*smoothstep(0.0,.20,sunDir.y)))*vec3(1.025,1.01,.97);
  light=mix(light,sunColor*diff+warmFill*(.82+.40*max(n.y,0.0))+sunColor*vec3(.10,.08,.05),mineralFill);
  }
#endif
  vec3 col = albedo * light * (1.0 - 0.25 * under);

  // Mapped water must also be flat: the map's shorelines are coarser than the LiDAR banks.
#ifdef LOW
  if (vGround < seaLevel + 0.02 || vWorld.y < seaLevel - 0.25) discard;   // the sea is painted behind the land in phone mode
#endif
  // A road or trail on a causeway is flat too, and the map's water polygon often runs under it: the road wins.
  bool water = (cls > 3.5 && cls < 4.5 && canopy < 1.5 && slope < 0.07 && onRoad < 0.5) || vGround < seaLevel + 0.02;
#ifdef QUARRY
  if(inQuarry)water = vGround < seaLevel + 0.02;
#endif
#ifdef LOW
  if (water) col = waterColor(vWorld, cameraPosition, 0.2);
#else
#ifdef MIRROR
  if (water || vWorld.y < seaLevel + 0.03) discard;
#elif defined(SEA_WATER)
  if (water) {
    float tidal = 1.0 - smoothstep(0.6, 2.0, abs(vGround - seaLevel));
    col = waterColor(vWorld, cameraPosition, mix(0.2, 1.0, tidal), waterFootprint);
  } else if (onRoad < 0.1 && canopy < 1.0 && abs(vGround - seaLevel) < 0.6) {
    // The measured bank supplies a thin lapping edge without needing underwater LiDAR.
    float wash = 1.0 - smoothstep(0.02 + lap, 0.30 + lap, vGround - seaLevel);
    vec3 washing = waterColor(vec3(vWorld.x, seaLevel, vWorld.z), cameraPosition, 1.0, waterFootprint);
    col = mix(col, washing, wash * 0.9);
    float edge = 1.0 - smoothstep(0.02, 0.09 + groundEdge, abs(vGround - seaLevel - 0.14 - lap));
    float broken = 0.45 + 0.55 * vnoise(p * 1.8 + time * 0.3);
    col = mix(col, skyColor * 0.45 + sunColor * 0.06, edge * broken * 0.4);
  }
#else
  if (water) col = inlandWaterColor(vWorld, cameraPosition, 0.2);
#endif
#endif
  // A far forest is drawn as one raised surface: the brook is under it.
  if (brookWater > 0.0) col = mix(col, brookColor(vWorld, cameraPosition, brookFlow, brookMid, clamp(dot(n.xz, brookFlow) / max(n.y, 0.3) * 4.0, 0.0, 1.0), light), brookWater * (1.0 - tree));

  col = applyFog(col, vWorld, cameraPosition);
  /* MODERN_ROAD_CUT_BEGIN */
  if(roadCutDiscard)discard;
  /* MODERN_ROAD_CUT_END */
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const SEA_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}
`;

export const SEA_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${COMMON}
varying vec3 vWorld;
void main() {
  #include <logdepthbuf_fragment>
#if defined(SEA_WATER) && !defined(LOW)
  vec3 col = waterColor(vWorld, cameraPosition, 1.0, max(length(dFdx(vWorld.xz)), length(dFdy(vWorld.xz))));
#else
  vec3 col = waterColor(vWorld, cameraPosition, 1.0);
#endif
  col = applyFog(col, vWorld, cameraPosition);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const WATER_MASK_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${ROAD_CUT_PARS}
uniform sampler2D tNormal;
uniform sampler2D tCover;
uniform sampler2D tRoad;
uniform vec4 coverRect;
uniform vec4 hideQuad;
uniform float roadZero;
uniform float texel;
uniform float seaLevel;
varying vec2 vUv;
varying vec3 vWorld;
varying float vGround;
void main() {
  float quarter = step(0.5, vUv.x) + 2.0 * step(0.5, vUv.y);
  if ((quarter < 0.5 ? hideQuad.x : quarter < 1.5 ? hideQuad.y : quarter < 2.5 ? hideQuad.z : hideQuad.w) > 0.5) discard;
  #include <logdepthbuf_fragment>
  ${ROAD_CUT_FRAG}
  if (vGround >= seaLevel + 0.02) {
    if (vGround > seaLevel + 2.0) discard;
    vec4 nm = texture2D(tNormal, (vUv * 256.0 + 0.5) / 257.0);
    vec2 cuv = (vWorld.xz - coverRect.xy) * coverRect.zw;
    if (min(cuv.x, cuv.y) < 0.0 || max(cuv.x, cuv.y) > 1.0) discard;
    float cls = floor(texture2D(tCover, cuv).b * 255.0 + 0.5);
    if (cls != 4.0 || nm.a >= 0.07) discard;
  vec2 rf = vUv * 256.0, r0 = min(floor(rf), 255.0), rw = rf - r0;
  ivec2 ri = ivec2(r0);
  vec4 qa = texelFetch(tRoad, ri, 0), qb = texelFetch(tRoad, ri + ivec2(1, 0), 0);
  vec4 qc = texelFetch(tRoad, ri + ivec2(0, 1), 0), qd = texelFetch(tRoad, ri + ivec2(1, 1), 0);
  // A sample with no road counts as far away.
  float sa = qa.b > 0.0 ? (qa.r - roadZero) * 25.5 : 13.0, sb = qb.b > 0.0 ? (qb.r - roadZero) * 25.5 : 13.0;
  float sc = qc.b > 0.0 ? (qc.r - roadZero) * 25.5 : 13.0, sd = qd.b > 0.0 ? (qd.r - roadZero) * 25.5 : 13.0;
  bool oneRoad = qa.b > 0.0 && qa.b == qb.b && qa.b == qc.b && qa.b == qd.b && qa.g == qb.g && qa.g == qc.g && qa.g == qd.g
    && max(max(abs(sa - sb), abs(sa - sc)), max(abs(sd - sb), abs(sd - sc))) < 1.6 * texel + 0.2;
  float rsigned = mix(mix(sa, sb, rw.x), mix(sc, sd, rw.x), rw.y);
  float rdist = oneRoad ? abs(rsigned) : mix(mix(abs(sa), abs(sb), rw.x), mix(abs(sc), abs(sd), rw.x), rw.y);
  // Kind and width are codes of the nearest sample, never blended.
  vec4 rk = rw.x < 0.5 ? (rw.y < 0.5 ? qa : qc) : (rw.y < 0.5 ? qb : qd);
  float rhalf = rk.g * 12.75;
  float rflags = floor(rk.b * 255.0 + 0.5);
  float rkind = mod(rflags, 16.0);


    float onRoad = 0.0, shoulder = 0.0;
    if (rkind > 0.5 && rdist < 11.5) {
      float aa = max(fwidth(rdist), 0.02), paved = step(rkind, 2.5);
      onRoad = 1.0 - smoothstep(rhalf - aa, rhalf + aa, rdist);
      shoulder = (1.0 - smoothstep(rhalf + mix(0.5, 1.3, paved), rhalf + mix(1.1, 1.9, paved) + aa, rdist)) * (1.0 - onRoad);
    }
    if (onRoad >= 0.5 || nm.b * 51.0 * (1.0 - max(onRoad, shoulder)) >= 1.5) discard;
  }
  /* MODERN_ROAD_CUT_BEGIN */
  if(roadCutDiscard)discard;
  /* MODERN_ROAD_CUT_END */
  gl_FragColor = vec4(0.0);
}
`;

// The sea while it is hidden, and for the frame or two before the answer that it is in view: one plain sea colour
// under the sky's reflection, with the fog. No waves, no mirror, no shore.
export const SEA_QUERY_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${COMMON}
varying vec3 vWorld;
void main() {
  #include <logdepthbuf_fragment>
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = 0.02 + 0.98 * pow(1.0 - max(v.y, 0.0), 5.0);
  vec3 body = vec3(0.012, 0.040, 0.060) * (0.35 + 0.65 * max(sunDir.y, 0.0)) * (sunColor * 0.5 + skyColor * 0.8);
  vec3 col = mix(body, skyAt(vec3(-v.x, abs(v.y), -v.z)), fres);
  col = applyFog(col, vWorld, cameraPosition);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
