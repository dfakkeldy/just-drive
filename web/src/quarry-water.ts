import * as THREE from 'three';
import { COMMON } from './shaders';
import { QUARRY_LAKES } from './quarry-lakes';
import { edgeDistance, type Point } from './quarry-site';
import type { Terrain } from './terrain';
import type { WaterReflections } from './water';
const PIT_WATER_VERT=/* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
attribute float shore;
varying float vShore;
void main(){vec4 w=modelMatrix*vec4(position,1.0);vWorld=w.xyz;vShore=shore;gl_Position=projectionMatrix*viewMatrix*w;
#include <logdepthbuf_vertex>
}`;
const PIT_WATER_FRAG=/* glsl */ `
#include <common>
#include <packing>
#include <logdepthbuf_pars_fragment>
${COMMON}
varying vec3 vWorld;
varying float vShore;
void main(){
#ifndef LOW
  float footprint=max(length(dFdx(vWorld.xz)),length(dFdy(vWorld.xz)));
#endif
#include <logdepthbuf_fragment>
#ifdef LOW
  vec3 col=waterColor(vWorld,cameraPosition,.7);
#else
  vec3 col=inlandWaterColor(vWorld,cameraPosition,.7);
#endif
  float shallow=1.0-smoothstep(2.0,25.0,vShore);
  vec3 tint=vec3(.13,.32,.29)*(sunColor*.45+skyColor*.8);
  col=mix(col,tint,shallow*.72);
  col=applyFog(col,vWorld,cameraPosition);gl_FragColor=vec4(col,1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

/** Conservative full cells and exact partial-cell boundaries from the drawn lake triangles. */
export function quarryLakeMask(meshes:readonly THREE.Mesh[],village:readonly [number,number]){
  const step=2;let x=Infinity,z=Infinity,right=-Infinity,far=-Infinity;
  for(const mesh of meshes){mesh.geometry.computeBoundingBox();const b=mesh.geometry.boundingBox!;x=Math.min(x,b.min.x);z=Math.min(z,b.min.z);right=Math.max(right,b.max.x);far=Math.max(far,b.max.z);}
  x=Math.floor(x/step)*step-step;z=Math.floor(z/step)*step-step;
  const width=Math.ceil((right-x)/step)+2,height=Math.ceil((far-z)/step)+2,data=new Uint8Array(width*height),coverage=new Uint8Array(data.length),touched=new Uint8Array(data.length);
  for(let lake=0;lake<meshes.length;lake++){
    coverage.fill(0);touched.fill(0);
    const p=meshes[lake].geometry.getAttribute('position');
    for(let i=0;i<p.count;i+=3){
      const ax=p.getX(i),az=p.getZ(i),bx=p.getX(i+1),bz=p.getZ(i+1),cx=p.getX(i+2),cz=p.getZ(i+2);
      if((bx-ax)*(cz-az)-(bz-az)*(cx-ax)===0)continue;
      const minX=Math.max(0,Math.floor((Math.min(ax,bx,cx)-x)/step)),maxX=Math.min(width-1,Math.ceil((Math.max(ax,bx,cx)-x)/step));
      const minZ=Math.max(0,Math.floor((Math.min(az,bz,cz)-z)/step)),maxZ=Math.min(height-1,Math.ceil((Math.max(az,bz,cz)-z)/step));
      for(let j=minZ;j<=maxZ;j++)for(let k=minX;k<=maxX;k++){
        touched[j*width+k]=1;
        // Accumulate coverage across triangles: a cell may straddle an internal triangulation edge.
        for(let sample=0;sample<5;sample++){
          const u=x+(k+(sample===4?.5:sample%2))*step,v=z+(j+(sample===4?.5:Math.floor(sample/2)))*step;
          const a=(bx-ax)*(v-az)-(bz-az)*(u-ax),b=(cx-bx)*(v-bz)-(cz-bz)*(u-bx),c=(ax-cx)*(v-cz)-(az-cz)*(u-cx);
          if((a>=0&&b>=0&&c>=0)||(a<=0&&b<=0&&c<=0))coverage[j*width+k]|=1<<sample;
        }
      }
    }
    for(let i=0;i<data.length;i++){if(touched[i])data[i]=coverage[i]===31?lake+1:3;}
    // Five probes alone can miss a narrow re-entrant notch between them. Any actual
    // boundary crossing makes the cell partial and requires the exact fragment test.
    for(const [ax,az,bx,bz] of meshes[lake].userData.quarryBoundary??[]){
      const loX=Math.max(0,Math.floor((Math.min(ax,bx)-x)/step)),hiX=Math.min(width-1,Math.floor((Math.max(ax,bx)-x)/step));
      const loZ=Math.max(0,Math.floor((Math.min(az,bz)-z)/step)),hiZ=Math.min(height-1,Math.floor((Math.max(az,bz)-z)/step));
      for(let j=loZ;j<=hiZ;j++)for(let k=loX;k<=hiX;k++){
        let lo=0,hi=1;for(let axis=0;axis<2;axis++){
          const a=axis?az:ax,d=axis?bz-az:bx-ax,left=(axis?z+j*step:x+k*step);
          if(d===0){if(a<left||a>left+step){hi=-1;break;}}
          else{const u=(left-a)/d,v=(left+step-a)/d;lo=Math.max(lo,Math.min(u,v));hi=Math.min(hi,Math.max(u,v));}
        }
        if(lo<=hi)data[j*width+k]=3;
      }
    }
  }
  // Partial cells use the exact perimeter edges of the drawn, subdivided triangles.
  // Row buckets bound the phone work: only edges crossing this two-metre row are fetched.
  const rows=Array.from({length:height*2},()=>[] as number[][]);
  for(let lake=0;lake<meshes.length;lake++)for(const edge of meshes[lake].userData.quarryBoundary??[]){
    const [,az,,bz]=edge as number[];if(az===bz)continue;
    const lo=Math.max(0,Math.floor((Math.min(az,bz)-z)/step)),hi=Math.min(height-1,Math.floor((Math.max(az,bz)-z)/step));
    for(let j=lo;j<=hi;j++)rows[j*2+lake].push(edge);
  }
  const bytes:number[]=new Array(rows.length*8).fill(0),word=new DataView(new ArrayBuffer(4));
  const put=(at:number,value:number,nibbles:number)=>{for(let j=0;j<nibbles;j++)bytes[at+j]=(value>>>j*4)&15;};
  for(let j=0;j<rows.length;j++){
    const edges=rows[j];if(edges.length>255)throw Error('Lake row has too many boundary edges');
    put(j*8,data.length+bytes.length,6);put(j*8+6,edges.length,2);
    for(const edge of edges)for(const value of edge){word.setFloat32(0,value,true);const at=bytes.length;bytes.length+=8;put(at,word.getUint32(0,true),8);}
  }
  return {data,width,height,x,z,step,boundary:Uint8Array.from(bytes)};
}

/** Flat polygons over surveyed water returns. Their contour, not the cover raster, supplies the shore. */
export class QuarryWater {
  readonly group=new THREE.Group();
  readonly meshes:THREE.Mesh[]=[];
  private readonly viewed=new WeakSet<THREE.Mesh>();
  private readonly viewport=new THREE.Vector4();
  constructor(private terrain:Terrain,atlas:THREE.CanvasTexture){
    this.group.name='Sugar Camp pit lakes';
    terrain.uniforms.quarryViewport={value:new THREE.Vector4(0,0,1,1)};
    terrain.uniforms.quarryLakeVisible={value:new THREE.Vector2(1,1)};
    terrain.uniforms.quarryReflectionLevel={value:terrain.seaLevel};
    for(const lake of QUARRY_LAKES){
      // Round sub-grid contour notches, then overlap the wet land mask by two metres.
      // Higher bank triangles still occlude this flat plane: their measured height supplies the waterline.
      const rounded:Point[]=[];
      for(let i=0;i<lake.points.length;i++){const a=lake.points[i],b=lake.points[(i+1)%lake.points.length];rounded.push([a[0]*.75+b[0]*.25,a[1]*.75+b[1]*.25],[a[0]*.25+b[0]*.75,a[1]*.25+b[1]*.75]);}
      const area=rounded.reduce((sum,p,i)=>{const q=rounded[(i+1)%rounded.length];return sum+p[0]*q[1]-q[0]*p[1];},0),sign=Math.sign(area);
      const boundary:Point[]=rounded.map((p,i)=>{const a=rounded[(i+rounded.length-1)%rounded.length],b=rounded[(i+1)%rounded.length],dx=b[0]-a[0],dn=b[1]-a[1],len=Math.hypot(dx,dn)||1;return[p[0]+sign*dn/len*2,p[1]-sign*dx/len*2];});
      const points=boundary.map(([e,n])=>new THREE.Vector2(e,n));
      const faces=THREE.ShapeUtils.triangulateShape(points,[]),pos:number[]=[],shore:number[]=[],boundaryEdges:number[][]=[];
      const edgeCounts=new Map<string,number>(),edgeKey=(a:number,b:number)=>a<b?a+','+b:b+','+a;
      for(const face of faces)for(let i=0;i<3;i++){const key=edgeKey(face[i],face[(i+1)%3]);edgeCounts.set(key,(edgeCounts.get(key)??0)+1);}
      // Split the longest edge. Interior shore-distance vertices give blue-green shallows without a texture.
      const emit=(a:Point,b:Point,c:Point,depth=0,edges:readonly boolean[]=[false,false,false])=>{
        const lengths=[Math.hypot(a[0]-b[0],a[1]-b[1]),Math.hypot(b[0]-c[0],b[1]-c[1]),Math.hypot(c[0]-a[0],c[1]-a[1])];
        if(Math.max(...lengths)>32&&depth<16){
          const i=lengths.indexOf(Math.max(...lengths)),q=[a,b,c],u=q[i],v=q[(i+1)%3],w=q[(i+2)%3],mid:Point=[(u[0]+v[0])/2,(u[1]+v[1])/2];emit(u,mid,w,depth+1,[edges[i],false,edges[(i+2)%3]]);emit(mid,v,w,depth+1,[edges[i],edges[(i+1)%3],false]);return;
        }
        const q=[a,b,c];for(let i=0;i<3;i++)if(edges[i]){const u=q[i],v=q[(i+1)%3];boundaryEdges.push([Math.fround(u[0]-terrain.manifest.village[0]),Math.fround(terrain.manifest.village[1]-u[1]),Math.fround(v[0]-terrain.manifest.village[0]),Math.fround(terrain.manifest.village[1]-v[1])]);}
        for(const p of [a,c,b]){pos.push(p[0]-terrain.manifest.village[0],0,terrain.manifest.village[1]-p[1]);shore.push(edgeDistance(p[0],p[1],boundary));}
      };
      for(const [a,b,c] of faces){const q=[a,b,c];emit(boundary[a],boundary[b],boundary[c],0,q.map((v,i)=>edgeCounts.get(edgeKey(v,q[(i+1)%3]))===1));}
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('shore',new THREE.Float32BufferAttribute(shore,1));
      const y=terrain.seaLevel+(lake.level-terrain.seaLevel)*terrain.exag;
      const mat=new THREE.ShaderMaterial({vertexShader:PIT_WATER_VERT,fragmentShader:PIT_WATER_FRAG,side:THREE.DoubleSide,
        defines:terrain.low?{LOW:1}:{},uniforms:{...terrain.uniforms,seaLevel:{value:y},gulfTint:{value:false}}});
      const mesh=new THREE.Mesh(geo,mat);mesh.position.y=y+.18;mesh.name=`Pit lake ${lake.level} m`;mesh.renderOrder=1;mesh.userData.shadowSet=true;
      mesh.userData.quarryBoundary=boundaryEdges;this.meshes.push(mesh);this.group.add(mesh);
    }
    const mask=quarryLakeMask(this.meshes,terrain.manifest.village),canvas=atlas.image as HTMLCanvasElement,g=canvas.getContext('2d')!,pixels=g.getImageData(0,0,canvas.width,canvas.height);
    if(mask.data.length+mask.boundary.length>canvas.width*canvas.height)throw Error('Lake coverage exceeds the park atlas');
    // Opaque sign materials ignore map alpha. Pack IDs into its low four bits; RGB is untouched.
    // Reuse that existing GPU texture, rather than adding a phone texture or another drawing pass.
    for(let i=0;i<canvas.width*canvas.height;i++)pixels.data[i*4+3]=240+(i<mask.data.length?mask.data[i]:mask.boundary[i-mask.data.length]??0);
    g.putImageData(pixels,0,0);atlas.needsUpdate=true;
    terrain.uniforms.quarryLakeAtlas={value:atlas};
    terrain.uniforms.quarryLakeGrid={value:new THREE.Vector4(mask.x,mask.z,mask.width,mask.step)};
    terrain.uniforms.quarryLakeAtlasSize={value:new THREE.Vector2(canvas.width,canvas.height)};
    terrain.uniforms.quarryLakeExtra={value:new THREE.Vector2(mask.data.length,mask.height)};
    terrain.uniforms.quarryLakePlanes={value:new THREE.Vector2(this.meshes[0].position.y,this.meshes[1].position.y)};
    if(terrain.coast?.quarry)terrain.coast.prepareMesh=mesh=>this.prepareLand(mesh);
    const existing=terrain.group?.children??[];for(let i=0;i<existing.length;i++){const mesh=existing[i] as THREE.Mesh;if(mesh.isMesh)this.prepareLand(mesh);}
  }
  /** Install once per streamed land mesh. Cloned probe meshes retain this draw callback. */
  prepareLand(mesh:THREE.Mesh):void{
    const material=mesh.material as THREE.ShaderMaterial;
    if(!material.defines?.QUARRY||this.viewed.has(mesh))return;
    this.viewed.add(mesh);
    const geometry=mesh.geometry,pos=geometry.getAttribute('position'),ground=geometry.getAttribute('ground'),coast=geometry.getAttribute('coast');
    if(pos&&ground&&coast){
      // These are measured water returns, not the quarry bed. Keep raw ground/queries;
      // lower only their rendered positions. Dry bank vertices are byte-for-byte untouched.
      const drop=new Float32Array(pos.count);let changed=false;
      for(let i=0;i<pos.count;i++)if(coast.getY(i)===1){
        const level=coast.getZ(i)*100;let plane:number|null=null;
        for(let lake=0;lake<this.meshes.length;lake++)if(Math.abs(level-QUARRY_LAKES[lake].level)<.02)plane=this.meshes[lake].position.y;
        if(plane===null)continue;
        const g=ground.getX(i),target=Math.min(g,Math.fround(plane-.02)),amount=g-target;
        if(amount>0){drop[i]=amount;pos.setY(i,pos.getY(i)-amount);changed=true;}
      }
      geometry.setAttribute('quarryWaterDrop',new THREE.BufferAttribute(drop,1));
      if(changed){pos.needsUpdate=true;geometry.computeBoundingBox();geometry.computeBoundingSphere();}
    }
    const previous=mesh.onBeforeRender;
    mesh.onBeforeRender=(renderer,scene,camera,geometry,drawMaterial,group)=>{
      previous.call(mesh,renderer,scene,camera,geometry,drawMaterial,group);
      renderer.getCurrentViewport(this.viewport);
      const m=drawMaterial as THREE.ShaderMaterial,uniform=m.uniforms?.quarryViewport;if(!uniform)return;
      const visibility=m.uniforms.quarryLakeVisible;
      if(visibility){const a=this.group.visible&&this.meshes[0].visible?1:0,b=this.group.visible&&this.meshes[1].visible?1:0,v=visibility.value as THREE.Vector2;if(v.x!==a||v.y!==b){v.set(a,b);m.uniformsNeedUpdate=true;}}
      const value=uniform.value as THREE.Vector4;
      if(!value.equals(this.viewport)){value.copy(this.viewport);m.uniformsNeedUpdate=true;}
    };
  }
  /** Pit lakes use the shared sky/ripple model. A sea-plane mirror cannot represent their two elevations. */
  bind(_water:WaterReflections|null):void{
    for(const mesh of this.meshes)(mesh.material as THREE.ShaderMaterial).uniforms.reflectionOn={value:0};
  }
  update(camera:THREE.Vector3,_water:WaterReflections|null):void{
    for(const mesh of this.meshes){
      if(!mesh.geometry.boundingSphere)mesh.geometry.computeBoundingSphere();const b=mesh.geometry.boundingSphere!;
      mesh.visible=Math.hypot(camera.x-b.center.x,camera.z-b.center.z)<b.radius+2400;
    }
    this.terrain.uniforms.quarryReflectionLevel.value=this.terrain.seaLevel;
  }
}
