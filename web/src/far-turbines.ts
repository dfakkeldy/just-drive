import * as THREE from 'three';
import { LAND_LIGHT } from './shaders';
import { CURVE_GLSL, FAR_RADIUS } from './far-rules';
import { WIND_HEADING, rotorPhase, rotorRate, type Turbine, type TallFile } from './tall-rules';

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
 #endif
 float range = length(w.xz - cameraPosition.xz);
 w.y -= farDrop(w.xz - cameraPosition.xz);
 vWorld = w.xyz;
 vFlash = step(fract(tallTime * 0.5 + farmPhase), 0.10) * step(range, ${FAR_RADIUS.toFixed(1)});
 gl_Position = projectionMatrix * viewMatrix * w;
 #ifdef BEACON
 // Two screen-space triangles, constant one-device-pixel light at horizon distance.
 gl_Position.xy += position.xy * 2.0 * gl_Position.w / beaconViewport;
 #endif
 #include <logdepthbuf_vertex>
}`;
const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${LAND_LIGHT}
varying vec3 vWorld;
varying float vFlash;
void main() {
 #include <logdepthbuf_fragment>
 if (distance(vWorld.xz,cameraPosition.xz) > ${FAR_RADIUS.toFixed(1)}) discard;
 #ifdef BEACON
 if (vFlash < 0.5) discard;
 // Preserve a small red emissive signal in haze, still terrain/sea depth tested.
 gl_FragColor = vec4(mix(vec3(1.8,0.008,0.002),applyFog(vec3(1.8,0.008,0.002),vWorld,cameraPosition),0.55),1.0);
 #else
 vec3 colour = vec3(0.64,0.68,0.70) * (skyColor * 0.65 + sunColor * 0.24);
 gl_FragColor = vec4(applyFog(colour,vWorld,cameraPosition),1.0);
 #endif
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;
export function farmPhase(id: string): number {
  let h = 2166136261;
  for (let i=0;i<id.length;i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
/** Coarse far views (far-choice.ts): the near turbines join the one far draw. Each is seated once, at load, on the
 * drawn near land where it is loaded (the far shader stretches its ground by the hill height again), else on its
 * baked ground. Near turbines keep their solids in TallLandmarks, which draws nothing in coarse. */
export function coarseTurbines(data: Pick<TallFile, 'turbines' | 'far'>, village: readonly number[], heightAt: (x: number, z: number) => number | null, seaLevel: number, exag: number): Turbine[] {
  const near = data.turbines.filter(p => p.ground !== null).map(p => {
    const h = heightAt(p.e - village[0], village[1] - p.n);
    return h === null || !Number.isFinite(h) ? p : { ...p, ground: h > seaLevel ? seaLevel + (h - seaLevel) / exag : h };
  });
  return [...near, ...data.far];
}
/** One body+rotor instanced draw; a second draw only for night beacons. Coarse leaves the shaft's end caps off. */
export class FarTurbines {
  readonly group = new THREE.Group();
  readonly time = { value: 0 };
  readonly viewport = { value: new THREE.Vector2(1920,1080) };
  readonly count: number;
  constructor(points: readonly Turbine[], origin: readonly number[], low: boolean, shared: Record<string, THREE.IUniform>, dark: boolean, coarse = false) {
    const list = points.filter(p => p.ground !== null); this.count = list.length;
    const pos: number[] = [], parts: number[] = [];
    const append = (g: THREE.BufferGeometry, part: number) => {
      const p=g.getAttribute('position'), index=g.index;
      for(let k=0;k<(index?.count??p.count);k++) { const i=index?index.getX(k):k; pos.push(p.getX(i),p.getY(i),p.getZ(i));parts.push(part); }
      g.dispose();
    };
    append(new THREE.CylinderGeometry(.012,.023,1,low?3:5,1,coarse).translate(0,.5,0),0);
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
      list.forEach((p,i)=>{sizes.set([p.hub,p.diameter,rotorPhase(p.e,p.n),rotorRate(p.diameter)],i*4);phases[i]=farmPhase(p.farm??'regional');});
      geometry.setAttribute('turbine',new THREE.InstancedBufferAttribute(sizes,4));geometry.setAttribute('farmPhase',new THREE.InstancedBufferAttribute(phases,1));
      const vert=beacon?FAR_TURBINE_VERT.replace('uniform float tallTime;','uniform float tallTime;\nuniform vec2 beaconViewport;').replace('vec3 p = position;','vec3 p = vec3(0.0);'):FAR_TURBINE_VERT;
      const mat=new THREE.ShaderMaterial({vertexShader:vert,fragmentShader:FRAG,defines:beacon?{BEACON:1}:{},uniforms:{...shared,tallTime:this.time,beaconViewport:this.viewport},side:THREE.DoubleSide});
      const mesh=new THREE.InstancedMesh(geometry,mat,list.length),d=new THREE.Object3D();
      list.forEach((p,i)=>{d.position.set(p.e-origin[0],p.ground!,origin[1]-p.n);d.rotation.set(0,Math.PI-WIND_HEADING,0);d.updateMatrix();mesh.setMatrixAt(i,d.matrix);});
      mesh.frustumCulled=false;mesh.name=beacon?'far-turbine-beacons':'far-turbines';this.group.add(mesh);
    };
    if(list.length) {
      const body=new THREE.BufferGeometry();body.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));body.setAttribute('part',new THREE.Float32BufferAttribute(parts,1));setup(body,false);
      if(dark) { const light=new THREE.PlaneGeometry(1,1).toNonIndexed();light.setAttribute('part',new THREE.Float32BufferAttribute(new Float32Array(6),1));setup(light,true); }
    }
  }
  update(seconds: number, width: number, height: number): void { this.time.value=seconds;this.viewport.value.set(width,height); }
}
