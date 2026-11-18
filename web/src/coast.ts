import * as THREE from 'three';
import type { Terrain } from './terrain';
import { COVE_SHORE, type RockSite } from './coast-site';
import { COAST_BLOCK_VERT, COAST_BLOCK_FRAG } from './coast-block-shaders';

export interface RockBlock { x:number;z:number;size:number;height:number;turn:number;y:number;burial:number }

/** One instanced batch in both modes. Surface recesses use the land shader and need no draw call. */
export interface RockBlocks {
  candidates:RockBlock[];capacity:number;minHeight:number;maxHeight:number;
  accept?(block:RockBlock):boolean;
  /** Quarry talus can bed deeper into an uneven toe; the coast retains its original strict bedding. */
  bedding?:number;
  revision?():string|number;
}
export class Coast {
  readonly group = new THREE.Group();
  readonly blocks:RockBlock[]=[];
  readonly mesh:THREE.InstancedMesh;
  private readonly candidates:RockBlock[]=[];
  private readonly matrix=new THREE.Matrix4();
  private readonly quaternion=new THREE.Quaternion();
  private readonly position=new THREE.Vector3();
  private readonly scale=new THREE.Vector3();
  private readonly up=new THREE.Vector3(0,1,0);
  private readonly feet:[number,number][]=[];
  private stamp:string|number='';
  private shadowBound=false;
  enabled=true;
  constructor(readonly site:RockSite,private readonly terrain:Terrain,low=terrain.low, private readonly options?:RockBlocks) {
    this.group.name='Coast fallen gypsum';
    const geo=new THREE.IcosahedronGeometry(1,0),p=geo.getAttribute('position');
    // Angular broken blocks with a flattened bedding face; no photograph or texture.
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),z=p.getZ(i),y=Math.max(0,(p.getY(i)+.53)/1.38);
      if(site.quarry){
        // Unequal broken planes and clipped corners: rockfall chunks, not regular cut cubes.
        const bx=Math.max(-.77,Math.min(.69,x*1.28)),bz=Math.max(-.72,Math.min(.78,z*1.24));
        const by=y<.10?0:Math.min(.96,y*(.92+.18*Math.sin(x*4+z*3)));
        p.setXYZ(i,bx*(1+.11*Math.sin(z*11)),by,bz*(.95+.10*Math.cos(x*5)));
      }else p.setXYZ(i,x*(1+.13*Math.sin(z*13)),y,z*(.82+.09*Math.cos(x*19)));
      if(p.getY(i)===0 && !this.feet.some(f=>Math.hypot(f[0]-p.getX(i),f[1]-p.getZ(i))<.001))this.feet.push([p.getX(i),p.getZ(i)]);
    }
    geo.computeVertexNormals();
    geo.setAttribute('coastFoot',new THREE.InstancedBufferAttribute(new Float32Array(options?.capacity ?? 44),1));
    const mat=new THREE.ShaderMaterial({clipping:true,vertexShader:COAST_BLOCK_VERT,fragmentShader:COAST_BLOCK_FRAG,
      defines:{...(low?{LOW:1}:{SHADOWS:1}),...(site.quarry?{QUARRY:1}:{})},uniforms:{...terrain.uniforms,coastExag:{value:terrain.exag},
        tShadow:{value:null},shadowOn:{value:0},shadowMatrix:{value:new THREE.Matrix4()},shadowTexel:{value:new THREE.Vector2(1,1)}}});
    terrain.night?.applyCoast(mat);
    this.mesh=new THREE.InstancedMesh(geo,mat,options?.capacity ?? 44);this.mesh.count=0;
    this.mesh.frustumCulled=true;
    // The main view and planar mirror are the two allowed draws. Keep the shared shadow scanner from adding a third.
    this.mesh.userData.shadowSet=true;this.mesh.castShadow=false;this.mesh.receiveShadow=true;
    this.group.add(this.mesh);
    if(options){this.candidates.push(...options.candidates);return;}
    let seed=761;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    // Toe and beach-side patches under the pale face. Candidate points are accepted only on loaded flat bedding.
    for(let i=0;i<160;i++){
      const n=5109035+random()*280;
      let j=1;while(j<COVE_SHORE.length-1 && COVE_SHORE[j][1]<n)j++;
      const [a,b]=COVE_SHORE[j-1],[c,d]=COVE_SHORE[j];
      const e=a+(c-a)*(n-b)/(d-b)+13+random()*22;
      const large=i%11===0,size=large?1.6+random()*.85:.35+random()*.95;
      this.candidates.push({x:e-site.village[0],z:site.village[1]-n,size,height:size*(.45+random()*.4),turn:random()*Math.PI,y:0,burial:0});
    }
  }
  update(camera:THREE.Vector3):void {
    if(!this.shadowBound&&this.terrain.uniforms?.tShadow){
      const u=(this.mesh.material as THREE.ShaderMaterial).uniforms;
      for(const key of ['tShadow','shadowOn','shadowMatrix','shadowTexel'])u[key]=this.terrain.uniforms[key];
      this.shadowBound=true;
    }
    const b=this.site.box;
    const dx=Math.max(b[0]-camera.x,0,camera.x-b[2]),dz=Math.max(b[1]-camera.z,0,camera.z-b[3]);
    this.group.visible=this.enabled && Math.hypot(dx,dz)<1800;
    if(!this.group.visible)return;
    // Refit when the drawn LOD changes, including coarse-to-fine loads and zooming back out.
    const stamp=this.options?.revision?.() ?? this.terrain.drawnRevision;
    if(stamp===this.stamp)return;
    this.stamp=stamp;
    this.terrain.fitCoastRecesses();
    this.blocks.length=0;
    let partlyBuried=0;
    for(const block of this.candidates){
      const centre=this.terrain.meshHeightAt(block.x,block.z,true);
      if(centre===null || centre<(this.options?.minHeight ?? .65)*this.terrain.exag || centre>(this.options?.maxHeight ?? 3.4)*this.terrain.exag)continue;
      if(this.options?.accept && !this.options.accept(block))continue;
      let lo=Infinity,hi=-Infinity;
      const c=Math.cos(block.turn),s=Math.sin(block.turn);
      for(const [u,v] of this.feet){
        const x=block.x+(u*c+v*s)*block.size,z=block.z+(-u*s+v*c)*block.size;
        const y=this.terrain.meshHeightAt(x,z,true);
        if(y===null){lo=-Infinity;break;}
        lo=Math.min(lo,y);hi=Math.max(hi,y);
      }
      // Bed each block slightly into the visible triangles; reject a footprint crossing a steep step.
      if(hi-lo>(this.options?.bedding?Math.min(this.options.bedding,block.height*.45):.23))continue;
      block.burial=!this.site.quarry&&partlyBuried<4&&block.height>.65?block.height*.5-.20:0;
      if(block.burial>.1)partlyBuried++;
      // Small quarry chunks need a proportional inset; the default coast keeps its exact bedding.
      block.y=hi-.20-block.burial;
      if(this.site.quarry)block.y+=.20-Math.min(.10,block.height*.08);
      if(this.options?.bedding)block.y-=hi-lo;
      this.position.set(block.x,block.y,block.z);this.scale.set(block.size,block.height,block.size);
      this.quaternion.setFromAxisAngle(this.up,block.turn);
      this.matrix.compose(this.position,this.quaternion,this.scale);
      (this.mesh.geometry.getAttribute('coastFoot') as THREE.InstancedBufferAttribute).setX(this.blocks.length,hi);
      this.mesh.setMatrixAt(this.blocks.length,this.matrix);this.blocks.push(block);
      if(this.blocks.length===(this.options?.capacity ?? 44))break;
    }
    this.mesh.count=this.blocks.length;this.mesh.instanceMatrix.needsUpdate=true;this.mesh.geometry.getAttribute('coastFoot').needsUpdate=true;this.mesh.computeBoundingSphere();
  }
}
