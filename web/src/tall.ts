import * as THREE from 'three';
import type { Terrain } from './terrain';
import { pushOut, type Pushable, type Solid } from './parked';
import { LAND_LIGHT } from './shaders';
import { farmPhase } from './far-turbines';
import { CURVE_GLSL } from './far-rules';
import { FAR_TURBINES, WIND_HEADING, rotorPhase, rotorRate, wireWorldHeight, type TallFile, type TallPoint } from './tall-rules';

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${CURVE_GLSL}
uniform float farCurveOn;
varying vec3 vWorld;
#ifdef BEACON
attribute float beaconPhase;
uniform vec2 tallViewport;
varying float vBeaconPhase;
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
 gl_Position.xy += position.xy * 2.0 * gl_Position.w / tallViewport;
 #endif
 #include <logdepthbuf_vertex>
}`;
const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${LAND_LIGHT}
uniform vec3 tallColour;
#ifdef BEACON
uniform float tallTime;
varying float vBeaconPhase;
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
 if (fract(tallTime * 0.5 + vBeaconPhase) > 0.10) discard;
 #endif
 vec3 colour=tallColour;
 #ifndef BEACON
 colour *= skyColor * 0.65 + sunColor * 0.24;
 #endif
 gl_FragColor=vec4(applyFog(colour,vWorld,cameraPosition),1.0);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;
const WIRE_VERT = VERT.replace('modelMatrix * instanceMatrix *', 'modelMatrix *');

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
  constructor(data: TallFile, private terrain: Terrain, low: boolean, shared: Record<string, THREE.IUniform>, dark: boolean, showFar = FAR_TURBINES, coarse = false) {
    const village = terrain.manifest.village;
    const material = (colour: number, defines: Record<string, number> = {}) => new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, defines, uniforms: { ...shared, tallTime: this.time, tallColour: { value: new THREE.Color(colour) } }, side: THREE.DoubleSide,
    });
    const white = material(0xc9cece), metal = material(0x8b979e,low?{LATTICE:1}:{}), red = material(0xff1807, { BEACON: 1 });
    const make = (geometry: THREE.BufferGeometry, mat: THREE.ShaderMaterial, count: number) => {
      const mesh = new THREE.InstancedMesh(geometry, mat, count);
      // Whole root square: never use a roadside draw-distance cutoff. Camera far plane and LAND_LIGHT fog apply.
      mesh.frustumCulled = false; mesh.name = 'tall'; this.group.add(mesh); return mesh;
    };
    const seat = (mesh: THREE.InstancedMesh, index: number, p: TallPoint, offset: number, scale: [number, number, number], yaw = 0, base = p) => {
      this.seating.push({ p, base, mesh, index, offset, height: NaN, scale, yaw });
    };
    // Unknown far ground is retained as null in data; do not float a turbine on a guessed sea-level base.
    const turbines = [...data.turbines, ...(showFar ? data.far : [])].filter(p => p.ground !== null);
    this.turbineCount = turbines.length;
    if (coarse) {
      // FarTurbines' shaft scales with the rotor diameter: the solid is as wide as the drawn base.
      for (const p of turbines) { const radius = Math.max(p.hub, p.diameter) * .023; this.solids.push({x:p.e-village[0],z:village[1]-p.n,half:radius,halfWidth:radius,heading:0}); }
      this.low = low;
      return;
    }
    if (turbines.length) {
      const shafts = make(new THREE.CylinderGeometry(.012, .023, 1, low ? 5 : 8).translate(0, .5, 0), white, turbines.length);
      const nacelles = make(new THREE.BoxGeometry(1, 1, 1), white, turbines.length);
      // Three tapered blades in one template, real radius 1, in the local XY plane.
      const vertices: number[] = [];
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI * 2 / 3, c = Math.cos(a), s = Math.sin(a);
        const blade = [[-.025,.06],[.055,.2],[.012,1],[-.012,.96],[-.035,.22]];
        for (let k = 1; k < blade.length - 1; k++) for (const p of [blade[0],blade[k],blade[k+1]]) vertices.push(p[0]*c-p[1]*s,p[0]*s+p[1]*c,0);
      }
      const blade = new THREE.BufferGeometry(); blade.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      const motion = new Float32Array(turbines.length * 2);
      turbines.forEach((p, i) => { motion[i*2]=rotorPhase(p.e,p.n); motion[i*2+1]=rotorRate(p.diameter); });
      blade.setAttribute('motion', new THREE.InstancedBufferAttribute(motion,2));
      const rotors = make(blade, material(0xd3d9d9,{ ROTOR: 1 }), turbines.length);
      rotors.name='tall-rotors';
      const beacon = new THREE.SphereGeometry(1,4,3);
      beacon.setAttribute('beaconPhase', new THREE.InstancedBufferAttribute(new Float32Array(turbines.map(p=>farmPhase(p.farm??'regional'))),1));
      const lights = dark ? make(beacon,red,turbines.length) : null;
      if (!lights) beacon.dispose();
      // Local +z faces the incoming WSW wind. North is -world z.
      const yaw = Math.PI - WIND_HEADING;
      turbines.forEach((p,i) => {
        const radius = p.hub * .023;
        this.solids.push({x:p.e-village[0],z:village[1]-p.n,half:radius,halfWidth:radius,heading:0});
        seat(shafts,i,p,0,[p.hub,p.hub,p.hub]);
        seat(nacelles,i,p,p.hub,[3,2.4,5],yaw);
        // Move the rotor 3 m upwind of the tower, in front of the nacelle.
        const rotorPoint = { ...p, e:p.e+Math.sin(WIND_HEADING)*3, n:p.n+Math.cos(WIND_HEADING)*3 };
        seat(rotors,i,rotorPoint,p.hub,[p.diameter/2,p.diameter/2,1],yaw,p);
        if(lights) seat(lights,i,p,p.hub+1.6,[.65,.65,.65]);
      });
    }
    const power = data.lines.flatMap(l=>l.towers.map((p,i)=>{const a=l.towers[Math.max(0,i-1)],b=l.towers[Math.min(l.towers.length-1,i+1)];return {...p,yaw:Math.atan2(a.e-b.e,b.n-a.n)};}));
    const mastGeometry = (transmission: boolean) => {
      const positions: number[]=[], uvs: number[]=[];
      const bar=(a:number[],b:number[],width:number) => {
        const g=new THREE.BoxGeometry(width,1,width), d=new THREE.Vector3(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
        const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.clone().normalize());
        g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2),q,new THREE.Vector3(1,d.length(),1)));
        const v=g.getAttribute('position'),idx=g.index!; for(let k=0;k<idx.count;k++){const i=idx.getX(k);positions.push(v.getX(i),v.getY(i),v.getZ(i));uvs.push(0,0);} g.dispose();
      };
      const width=transmission?.13:.035, steps=low?4:7;
      const corner=(side:number,y:number):number[]=>{const w=width*(1-.75*y);return [side&1?w:-w,y,side&2?w:-w];};
      if(low){
        for(let axis=0;axis<2;axis++){
          const p=[[-width,0,0],[width,0,0],[width*.25,1,0],[-width*.25,1,0]];
          const uv=[[0,0],[1,0],[1,1],[0,1]];
          for(const i of [0,1,2,0,2,3]) {positions.push(axis?p[i][2]:p[i][0],p[i][1],axis?p[i][0]:p[i][2]);uvs.push(...uv[i]);}
        }
      } else for(let s=0;s<4;s++){
        bar(corner(s,0),corner(s,1),.007);
        for(let k=0;k<steps;k++) {const y=k/steps, top=(k+1)/steps;
          bar(corner(s,y),corner(s^1,top),.004);
          if(!low) bar(corner(s,top),corner(s^1,y),.004);
          bar(corner(s,y),corner(s^2,top),.004);
        }
      }
      if(transmission){for(const y of [.82,1]) bar([-.25,y,0],[.25,y,0],.016);}
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));return g;
    };
    for(const [list,isPower] of [[data.towers,false],[power,true]] as const){
      if(!list.length)continue;
      const mesh=make(mastGeometry(isPower),metal,list.length);
      const beacon=new THREE.SphereGeometry(1,4,3);beacon.setAttribute('beaconPhase',new THREE.InstancedBufferAttribute(new Float32Array(list.length),1));
      const lights=dark&&!isPower?make(beacon,red,list.length):null;
      if(!lights)beacon.dispose();
      list.forEach((p,i)=>{
        seat(mesh,i,p,0,[p.height,p.height,p.height], 'yaw' in p ? Number(p.yaw) : 0);
        if(lights) seat(lights,i,p,p.height,[.6,.6,.6]);
        this.solids.push({x:p.e-village[0],z:village[1]-p.n,half:p.height*(isPower?.13:.035),halfWidth:p.height*(isPower?.13:.035),heading:0});
      });
    }
    // Static sag curves: one merged geometry per provincial polyline, three conductors.
    for(const line of data.lines){
      const positions:number[]=[];
      for(let k=0;k<line.spans.length;k++){
        const a=line.towers[k],b=line.towers[k+1],span=line.spans[k];
        const steps=(span.ground.length-1)*(low?1:2);
        const dx=b.e-a.e,dn=b.n-a.n,len=Math.hypot(dx,dn); if(!len)continue;
        for(const side of [-1,0,1])for(let j=0;j<steps;j++)for(const t of [j/steps,(j+1)/steps]){
          // Stretch ground only; keep structure sizes and sag in real metres.
          const index=t*(span.ground.length-1),j=Math.min(span.ground.length-2,Math.floor(index));
          const ground=THREE.MathUtils.lerp(span.ground[j],span.ground[j+1],index-j);
          positions.push(a.e+dx*t-village[0]+dn/len*side*4,wireWorldHeight(a.ground!+a.height,b.ground!+b.height,span.sag,t,ground,terrain.exag,terrain.seaLevel),village[1]-a.n-dn*t+dx/len*side*4);
        }
      }
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
      const mat=material(0x535d64);mat.vertexShader=WIRE_VERT;
      const mesh=new THREE.LineSegments(g,mat);this.group.add(mesh);
      g.computeBoundingSphere(); const c=g.boundingSphere!.center;
      this.wires.push({mesh,x:c.x,z:c.z,radius:g.boundingSphere!.radius});
    }
    this.low=low;
    this.update(new THREE.PerspectiveCamera(),0);
  }
  private readonly low: boolean;
  private bakedHeight(h: number): number { return h>this.terrain.seaLevel?this.terrain.seaLevel+(h-this.terrain.seaLevel)*this.terrain.exag:h; }
  update(camera: THREE.Camera, seconds: number): void {
    this.time.value=seconds;
    // A bounded seating pass twice a second, no allocations and no per-rotor CPU transform per frame.
    if(seconds>=this.nextSeat){
      this.nextSeat=seconds+.5;
      for(const s of this.seating){
        const x=s.p.e-this.terrain.manifest.village[0],z=this.terrain.manifest.village[1]-s.p.n;
        const bx=s.base.e-this.terrain.manifest.village[0],bz=this.terrain.manifest.village[1]-s.base.n;
        const height='hub' in s.base ? this.terrain.heightAt(bx,bz)??this.bakedHeight(s.base.ground??0) : this.bakedHeight(s.base.ground??0);
        if(height===s.height)continue; s.height=height;
        this.dummy.position.set(x,height+s.offset,z);this.dummy.rotation.set(0,s.yaw,0);this.dummy.scale.set(...s.scale);this.dummy.updateMatrix();
        s.mesh.setMatrixAt(s.index,this.dummy.matrix);s.mesh.instanceMatrix.needsUpdate=true;
      }
    }
    for(const w of this.wires)w.mesh.visible=!this.low||Math.hypot(camera.position.x-w.x,camera.position.z-w.z)<1800+w.radius;
  }
  resolveSolids(car: Pushable): void { pushOut(car,this.solids); }
}
