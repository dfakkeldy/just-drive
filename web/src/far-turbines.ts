import * as THREE from 'three';
import { LAND_LIGHT } from './shaders';
import { CURVE_GLSL, FAR_RADIUS } from './far-rules';
import { TURBINE_FLASH_DUTY, TURBINE_FLASH_RATE, WIND_HEADING, rotorPhase, rotorRate, turbineOperating, type Turbine, type TallFile } from './tall-rules';

export const FAR_TURBINE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${CURVE_GLSL}
attribute float part;
attribute vec4 turbine;
attribute float farmPhase;
uniform float tallTime;
uniform float farExag;
uniform float seaLevel;
varying vec3 vWorld;
varying float vFlash;
#ifdef BEACON
varying vec2 vBeaconUv;
#endif
void main() {
 vec3 p = position;
 if (part < 0.5) { p.xy *= vec2(turbine.y, turbine.x); p.z *= turbine.y; }
 else if (part < 1.5) { p.y += turbine.x; }
 else {
  float angle = turbine.z + turbine.w * tallTime;
  float c = cos(angle), s = sin(angle);
  p.xy = mat2(c,s,-s,c) * p.xy * turbine.y * 0.5;
  p.y += turbine.x; p.z += 3.0;
 }
 vec4 w = modelMatrix * instanceMatrix * vec4(p,1.0);
 float base = (modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0)).y;
 w.y += max(0.0,base-seaLevel) * (farExag-1.0);
 #ifdef BEACON
 w.y += turbine.x + 1.6;
 vBeaconUv = position.xy * 2.0;
 #endif
 float range = length(w.xz - cameraPosition.xz);
 w.y -= farDrop(w.xz - cameraPosition.xz);
 vWorld = w.xyz;
 vFlash = step(0.0001, turbine.w) * step(fract(tallTime * ${TURBINE_FLASH_RATE.toFixed(2)} + farmPhase), ${TURBINE_FLASH_DUTY.toFixed(2)}) * step(range, ${FAR_RADIUS.toFixed(1)});
 gl_Position = projectionMatrix * viewMatrix * w;
 #ifdef BEACON
 // Operating turbines flash red in sync; non-operating or off-phase beacons collapse out of clip space.
 if (vFlash < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
 else {
  // ~2.5 CSS px bright core + soft red halo to ~8 CSS px diameter, scaled by device pixel ratio.
  float px = 8.0 * beaconPixelRatio;
  gl_Position.xy += position.xy * (2.0 * px) * gl_Position.w / beaconViewport;
 }
 #endif
 #include <logdepthbuf_vertex>
}`;
const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${LAND_LIGHT}
varying vec3 vWorld;
varying float vFlash;
#ifdef BEACON
varying vec2 vBeaconUv;
#endif
void main() {
 #include <logdepthbuf_fragment>
 if (distance(vWorld.xz,cameraPosition.xz) > ${FAR_RADIUS.toFixed(1)}) discard;
 #ifdef BEACON
 if (vFlash < 0.5) discard;
 float r = length(vBeaconUv);
 if (r > 1.0) discard;
 float core = 1.0 - smoothstep(0.16, 0.42, r);
 float halo = pow(max(0.0, 1.0 - r), 2.4) * 0.55;
 float alpha = clamp(core + halo, 0.0, 1.0);
 if (alpha < 0.02) discard;
 // Keep aviation red bright against night haze, still terrain/sea depth tested.
 vec3 red = vec3(1.0, 0.009, 0.001);
 vec3 lit = mix(red, applyFog(red, vWorld, cameraPosition), 0.12);
 gl_FragColor = vec4(lit * (0.80 + 0.65 * core), alpha);
 #else
 // Painted white with real 3D sun+sky shading: sunlit side reads bright white against hills, shaded side contrasts against bright horizon sky.
 vec3 fn = cross(dFdx(vWorld), dFdy(vWorld));
 float fnLen = length(fn);
 vec3 n = fnLen > 1e-6 ? fn / fnLen : vec3(0.0, 1.0, 0.0);
 if (!gl_FrontFacing) n = -n;
 float sunLit = max(dot(n, normalize(sunDir)), 0.0);
 vec3 colour = vec3(0.95, 0.96, 0.97) * (skyColor * 0.42 + sunColor * (0.04 + 0.42 * sunLit));
 vec3 fogged = applyFog(colour, vWorld, cameraPosition);
 float fogMix = mix(0.62, 1.0, smoothstep(0.00005, 0.00025, fogDensity));
 gl_FragColor = vec4(mix(colour, fogged, fogMix), 1.0);
 #endif
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;
export function farmPhase(id: string): number {
  let h = 2166136261;
  for (let i=0;i<id.length;i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
/** The ground to give the far shader for a drawn world height: it stretches ground above the sea by the hill height. */
export function farGround(h: number, seaLevel: number, exag: number): number { return h > seaLevel ? seaLevel + (h - seaLevel) / exag : h; }
/** The near turbines in the coarse far draw, kept on the drawn near land as its tiles stream in (FarTurbines.update). */
export interface NearSeat { count: number; heightAt: (x: number, z: number) => number | null; seaLevel: number; exag: number }
/** Coarse far views (far-choice.ts): the near turbines join the one far draw, first in the list. Each starts on the
 * drawn near land where it is loaded, else on its baked ground. Near turbines keep their solids in TallLandmarks,
 * which draws nothing in coarse. */
export function coarseTurbines(data: Pick<TallFile, 'turbines' | 'far'>, village: readonly number[], heightAt: (x: number, z: number) => number | null, seaLevel: number, exag: number): Turbine[] {
  const near = data.turbines.filter(p => p.ground !== null).map(p => {
    const h = heightAt(p.e - village[0], village[1] - p.n);
    return h === null || !Number.isFinite(h) ? p : { ...p, ground: farGround(h, seaLevel, exag) };
  });
  return [...near, ...data.far];
}
/** One body+rotor instanced draw; a second draw only for night beacons. Coarse leaves the shaft's end caps off. */
export class FarTurbines {
  readonly group = new THREE.Group();
  readonly time = { value: 0 };
  readonly viewport = { value: new THREE.Vector2(1920,1080) };
  readonly pixelRatio = { value: 1 };
  readonly count: number;
  private readonly list: Turbine[];
  private readonly grounds: number[];
  private nextSeat = 0;
  constructor(points: readonly Turbine[], private readonly origin: readonly number[], low: boolean, shared: Record<string, THREE.IUniform>, dark: boolean, coarse = false, private readonly near?: NearSeat) {
    const list = points.filter(p => p.ground !== null); this.count = list.length; this.list = list; this.grounds = list.map(p => p.ground!);
    const pos: number[] = [], parts: number[] = [];
    const append = (g: THREE.BufferGeometry, part: number) => {
      const p=g.getAttribute('position'), index=g.index;
      for(let k=0;k<(index?.count??p.count);k++) { const i=index?index.getX(k):k; pos.push(p.getX(i),p.getY(i),p.getZ(i));parts.push(part); }
      g.dispose();
    };
    append(new THREE.CylinderGeometry(.012,.023,1,low?3:5,1,coarse||!low).translate(0,.5,0),0);
    append(new THREE.BoxGeometry(3,2.4,5),1);
    const blades: number[]=[];
    for(let i=0;i<3;i++) {
      const a=i*Math.PI*2/3,c=Math.cos(a),s=Math.sin(a);
      const p=[[-.035,.04],[.06,.20],[.012,1],[-.012,.96]];
      for(const k of low?[0,1,2]:[0,1,2,0,2,3])blades.push(p[k][0]*c-p[k][1]*s,p[k][0]*s+p[k][1]*c,0);
    }
    append(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(blades,3)),2);
    const setup = (geometry: THREE.BufferGeometry, beacon: boolean) => {
      const sizes=new Float32Array(list.length*4),phases=new Float32Array(list.length);
      list.forEach((p,i)=>{sizes.set([p.hub,p.diameter,rotorPhase(p.e,p.n),turbineOperating(p)?rotorRate(p.diameter):0],i*4);phases[i]=farmPhase(p.farm??'regional');});
      geometry.setAttribute('turbine',new THREE.InstancedBufferAttribute(sizes,4));geometry.setAttribute('farmPhase',new THREE.InstancedBufferAttribute(phases,1));
      const vert=beacon?FAR_TURBINE_VERT.replace('uniform float tallTime;','uniform float tallTime;\nuniform vec2 beaconViewport;\nuniform float beaconPixelRatio;').replace('vec3 p = position;','vec3 p = vec3(0.0);'):FAR_TURBINE_VERT;
      const mat=new THREE.ShaderMaterial({vertexShader:vert,fragmentShader:FRAG,defines:beacon?{BEACON:1}:{},uniforms:{...shared,tallTime:this.time,beaconViewport:this.viewport,beaconPixelRatio:this.pixelRatio},side:THREE.DoubleSide,transparent:beacon,depthWrite:!beacon});
      const mesh=new THREE.InstancedMesh(geometry,mat,list.length);
      list.forEach((p,i)=>this.place(mesh,i,p.ground!));
      mesh.frustumCulled=false;mesh.name=beacon?'far-turbine-beacons':'far-turbines';this.group.add(mesh);
    };
    if(list.length) {
      const body=new THREE.BufferGeometry();body.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));body.setAttribute('part',new THREE.Float32BufferAttribute(parts,1));setup(body,false);
      if(dark && list.some(turbineOperating)) { const light=new THREE.PlaneGeometry(1,1).toNonIndexed();light.setAttribute('part',new THREE.Float32BufferAttribute(new Float32Array(6),1));setup(light,true); }
    }
  }
  private readonly dummy = new THREE.Object3D();
  private place(mesh: THREE.InstancedMesh, i: number, ground: number): void {
    const p=this.list[i],d=this.dummy;d.position.set(p.e-this.origin[0],ground,this.origin[1]-p.n);d.rotation.set(0,Math.PI-WIND_HEADING,0);d.updateMatrix();mesh.setMatrixAt(i,d.matrix);mesh.instanceMatrix.needsUpdate=true;
  }
  update(seconds: number, width: number, height: number, pixelRatio = 1): void {
    this.time.value=seconds;this.viewport.value.set(width,height);this.pixelRatio.value=pixelRatio>0?pixelRatio:1;
    // Twice a second, as TallLandmarks seats its near turbines: no per-frame CPU transform.
    if(!this.near||seconds<this.nextSeat)return;
    this.nextSeat=seconds+.5;
    for(let i=0;i<Math.min(this.near.count,this.count);i++){
      const p=this.list[i],h=this.near.heightAt(p.e-this.origin[0],this.origin[1]-p.n);
      if(h===null||!Number.isFinite(h))continue;
      const ground=farGround(h,this.near.seaLevel,this.near.exag);if(ground===this.grounds[i])continue;this.grounds[i]=ground;
      for(const mesh of this.group.children)this.place(mesh as THREE.InstancedMesh,i,ground);
    }
  }
}
