import * as THREE from 'three';
import { LAND_LIGHT } from './shaders';
import { centroidDepthVertex, centroidDepthFragment } from './far-materials';
import { CURVE_GLSL, CURVE_START, CURVE_FULL, CURVATURE, FAR_RADIUS, SEA_MIN_RADIUS, worldRoot, type FarFile } from './far-rules';
import type { FarLevelName } from './far-choice';

export const FAR_LAND_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${CURVE_GLSL}
uniform float farExag;
uniform float seaLevel;
varying vec3 vWorld;
void main() {
 vec4 w = modelMatrix * vec4(position, 1.0);
 w.y = w.y > seaLevel ? seaLevel + (w.y - seaLevel) * farExag : w.y;
 vWorld = w.xyz;
 w.y -= farDrop(w.xz - cameraPosition.xz);
 gl_Position = projectionMatrix * viewMatrix * w;
 #include <logdepthbuf_vertex>
}`;
const FAR_LAND_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${LAND_LIGHT}
varying vec3 vWorld;
uniform vec2 farLandAnchor;
void main() {
 #include <logdepthbuf_fragment>
 // Fade the pack's fixed geographic boundary into the curved sea, without an
 // alpha blend or another draw. The physical sightline targets are inside 75 km.
 float rim = smoothstep(75000.0,90000.0,length(vWorld.xz-farLandAnchor));
 float grain = fract(sin(dot(floor(gl_FragCoord.xy),vec2(12.9898,78.233)))*43758.5453);
 if (grain < rim) discard;
 // A cool untextured silhouette. The same sun/sky and fog uniforms own dusk.
 vec3 silhouette = vec3(0.19,0.25,0.30) * (skyColor * 0.8 + sunColor * 0.08);
 gl_FragColor = vec4(applyFog(silhouette, vWorld, cameraPosition),1.0);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;

const SEA_PATCH = /* glsl */ `
attribute float seaPatch;
varying float vSeaPatch;
varying float vSeaDrop;
uniform float seaLevel;
uniform float farCurveOn;
${CURVE_GLSL}
`;
function replaceOnce(source: string, from: string, to: string): string {
  if (source.split(from).length !== 2) throw Error('Sea shader anchor changed');
  return source.replace(from,to);
}
export function farSeaVertex(source: string): string {
  source=replaceOnce(source,'#include <logdepthbuf_pars_vertex>','#include <logdepthbuf_pars_vertex>\n'+SEA_PATCH);
  source=replaceOnce(source,'  gl_Position = projectionMatrix * viewMatrix * w;',`  gl_Position = projectionMatrix * viewMatrix * w;
  vSeaPatch = seaPatch; vSeaDrop = 0.0;
  if (seaPatch > 0.5) {
    vec2 seaPoint = position.xz;
    float radius = length(seaPoint);
    if (radius > ${FAR_RADIUS}.0) {
      float extent = max(${SEA_MIN_RADIUS}.0,sqrt((max(0.0,cameraPosition.y-seaLevel)+100.0)/${CURVATURE.toPrecision(16)})*1.2);
      seaPoint *= mix(${FAR_RADIUS}.0,extent,(radius-${FAR_RADIUS}.0)/${SEA_MIN_RADIUS-FAR_RADIUS}.0)/radius;
    }
    vec4 seaWorld = vec4(seaPoint.x + cameraPosition.x, seaLevel, seaPoint.y + cameraPosition.z, 1.0);
    vWorld = seaWorld.xyz;
    vSeaDrop = farDrop(seaWorld.xz - cameraPosition.xz) * farCurveOn;
    gl_Position = projectionMatrix * viewMatrix * seaWorld;
    if (vSeaDrop > 0.0) gl_Position -= projectionMatrix * viewMatrix * vec4(0.0,vSeaDrop,0.0,0.0);
  }
  // Extended water may pass the camera's finite far plane. Keep it as the
  // farthest backdrop there; nearer land still wins the depth test.
  if (seaPatch > 0.5) gl_Position.z = min(gl_Position.z,gl_Position.w);
  // Keep the original near triangles' clip coordinates, including far-plane
  // clipping. Forcing their z to w changes interpolation at grazing angles.
  // LOW local backdrop depth is handled in the fragment shader.
`);
  return centroidDepthVertex(source,'vWorld.xz - cameraPosition.xz');
}
export function farSeaFragment(source: string): string {
  const footprint='max(length(dFdx(vWorld.xz)), length(dFdy(vWorld.xz)))';
  if(source.includes(footprint))source=source.replace(footprint,'farWaterFootprint');
  source = replaceOnce(source,'void main() {',`varying float vSeaPatch;
varying float vSeaDrop;
#ifdef LOW
uniform mat4 projectionMatrix;
#endif
void main() {
 #if defined(SEA_WATER) && !defined(LOW)
 // Derivatives must run before a lane can discard at the patch boundary.
 float farWaterFootprint = max(length(dFdx(vWorld.xz)), length(dFdy(vWorld.xz)));
 #endif
 // Masks share a projected flat-plane distance. A short opaque overlap
 // lies beyond 3 km; the original near-water pixels keep their exact triangles.
 float eye = max(cameraPosition.y-seaLevel,0.0001);
 float flatRange = length(vWorld.xz-cameraPosition.xz) * eye / (eye+vSeaDrop);
 if (vSeaPatch < 0.5 ? flatRange > ${CURVE_START+64}.0 : flatRange < ${CURVE_START+2}.0) discard;
`);
  source=replaceOnce(source,'#include <logdepthbuf_fragment>',`#include <logdepthbuf_fragment>
 #ifdef LOW
 // Preserve the old local backdrop: every object within the flat 3 km disc
 // stays in front, including the old near-water skirts. Unlike depth 1,
 // this finite depth still hides far land/turbines behind the local ocean.
 gl_FragDepth = gl_FragCoord.z;
 if (vSeaPatch < 0.5) {
   float radial = length(vWorld.xz-cameraPosition.xz);
   gl_FragDepth = clamp(0.5*(1.0-projectionMatrix[2][2]+projectionMatrix[3][2]*gl_FragCoord.w*min(radial,${CURVE_START.toFixed(1)})/${CURVE_START.toFixed(1)}),0.0,1.0);
 } else if (flatRange < ${CURVE_START+64}.0) {
   // Resolve 24-bit depth ties against the finite local backdrop, just as
   // the logarithmic path does. Only the covered far overlap moves in depth.
   gl_FragDepth = min(1.0,gl_FragDepth+0.00001);
 }
 #elif defined(USE_LOGDEPTHBUF)
 // In the overlap, give the original plane deterministic depth ownership.
 // The curved patch is almost coplanar here; quantized depth otherwise flickers.
 if (vSeaPatch > 0.5 && flatRange < ${CURVE_START+64}.0) gl_FragDepth = min(1.0,gl_FragDepth+0.00001);
 #endif
`);
  return centroidDepthFragment(source);
}
/** Original four plane vertices/indices first, followed by a camera-relative grid. Coarse (the phone's Coarse far
 * views) halves the rings: the curvature drop is per vertex, and between rings it bends by well under a metre. */
export function seaGeometry(low: boolean, coarse = false): THREE.BufferGeometry {
  const original = new THREE.PlaneGeometry(600000,600000).rotateX(-Math.PI/2);
  const p=Array.from(original.getAttribute('position').array), indices=Array.from(original.index!.array), patch=[0,0,0,0];
  const rings=coarse?24:low?48:96,sectors=coarse?48:low?64:128;
  const radii=[...new Set([...Array.from({length:rings+1},(_,r)=>FAR_RADIUS*Math.pow(r/rings,1.6)),CURVE_START,CURVE_START+64,CURVE_FULL,105000,120000,150000,200000,SEA_MIN_RADIUS])].sort((a,b)=>a-b);
  for(let r=0;r<radii.length;r++)for(let a=0;a<=sectors;a++){
    const angle=a/sectors*Math.PI*2;p.push(Math.cos(angle)*radii[r],0,Math.sin(angle)*radii[r]);patch.push(1);
    if(r&&a){const i=4+r*(sectors+1)+a;indices.push(i,i-1,i-sectors-2,i,i-sectors-2,i-sectors-1);}
  }
  original.dispose();
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geometry.setAttribute('seaPatch',new THREE.Float32BufferAttribute(patch,1));geometry.setIndex(indices);return geometry;
}

export class FarLand {
  readonly group = new THREE.Group();
  readonly root: [number, number, number, number];
  readonly land: THREE.Mesh;
  readonly seaGeometry: THREE.BufferGeometry;
  private constructor(readonly data: FarFile, geometry: THREE.BufferGeometry, low: boolean, shared: Record<string, THREE.IUniform>, readonly level: FarLevelName, coarse: boolean) {
    this.root = worldRoot(data.root, data.origin);
    this.land = new THREE.Mesh(geometry, new THREE.ShaderMaterial({ vertexShader: FAR_LAND_VERT, fragmentShader: FAR_LAND_FRAG, uniforms: {...shared,farLandAnchor:{value:new THREE.Vector2(data.anchor[0]-data.origin[0],data.origin[1]-data.anchor[1])}}, side: THREE.DoubleSide }));
    this.land.name = 'far-land'; this.land.frustumCulled = false;
    this.seaGeometry=seaGeometry(low,coarse);
    this.group.add(this.land);
  }
  /** `want`: the level the far plan asks for (far-choice.ts). A pack without a coarse level draws its LOW level. */
  static async load(data: FarFile, base: string, want: FarLevelName, shared: Record<string, THREE.IUniform>): Promise<FarLand> {
    const name: FarLevelName = want === 'coarse' && !data.levels?.coarse ? 'low' : want, low = name !== 'desktop';
    const level = data.levels?.[name];
    if (!Array.isArray(data.root) || data.root.length !== 4 || !data.root.every(Number.isFinite) || !Array.isArray(data.origin) || data.origin.length !== 2 || !data.origin.every(Number.isFinite) || !Array.isArray(data.anchor) || data.anchor.length!==2 || !data.anchor.every(Number.isFinite) || data.radius !== FAR_RADIUS) throw Error('Invalid far-land coordinates');
    if (data.crs !== 'EPSG:2961' || !level || !Number.isInteger(level.vertices) || !Number.isInteger(level.indices) || level.vertices < 3 || level.indices % 3 || level.bytes > 16_000_000 || !/^[a-z0-9-]+\.bin$/.test(level.file)) throw Error('Invalid far-land metadata');
    const response = await fetch(`${base}/${level.file}`); if (!response.ok) throw Error('Far-land mesh missing');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== level.bytes || level.bytes !== level.vertices * 12 + level.indices * 4) throw Error('Far-land mesh size');
    const positions = new Float32Array(bytes, 0, level.vertices * 3), indices = new Uint32Array(bytes, level.vertices * 12, level.indices);
    for (const p of positions) if (!Number.isFinite(p)) throw Error('Invalid far-land position');
    for (const i of indices) if (i >= level.vertices) throw Error('Invalid far-land index');
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions,3)); geometry.setIndex(new THREE.BufferAttribute(indices,1));
    return new FarLand(data, geometry, low, shared, name, want === 'coarse');
  }
}
