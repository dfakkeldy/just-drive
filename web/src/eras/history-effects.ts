import * as THREE from 'three';
import {Mesher}from'../yard-kit';import{periodProfile}from'./history-art';import{siteHash,type PeriodSite}from'./history-sites';
interface Owner{site:PeriodSite;node:THREE.Group;active:boolean;ready:boolean}
/** Small preallocated flame tongues and three faint smoke puffs per hearth. */
export class HistoryEffects{
 readonly group=new THREE.Group();
 private fires:{owner:Owner;mesh:THREE.Mesh;material:THREE.MeshBasicMaterial;phase:number;profile:ReturnType<typeof periodProfile>}[]=[];
 private smoke:THREE.InstancedMesh;private dummy=new THREE.Object3D();private time=0;
 constructor(owners:readonly Owner[]){
  for(const owner of owners)if(owner.site.kind==='forge'){
   const p=periodProfile(owner.site),m=new Mesher();
   for(let i=0;i<3;i++){const x=(i-1)*.23;m.tri(x-.18,0,0,x+.18,0,0,x+.05,.42+i*.09,0,[1,.34+i*.14,.035]);m.tri(x-.13,0,.012,x+.13,0,.012,x-.02,.24+i*.06,.012,[1,.75,.15]);}
   const material=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,toneMapped:false});const mesh=new THREE.Mesh(m.geometry(),material);mesh.position.set(0,.74,p.length/2+.46);owner.node.add(mesh);
   this.fires.push({owner,mesh,material,phase:siteHash(owner.site.id)*10,profile:p});
  }
  const smokeMaterial=new THREE.MeshBasicMaterial({color:0x8f8d85,transparent:true,opacity:.16,depthWrite:false,toneMapped:false});
  this.smoke=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),smokeMaterial,this.fires.length*3);this.smoke.frustumCulled=false;this.group.add(this.smoke);
 }
 update(dt:number):void{
  this.time+=dt;let count=0;
  for(let i=0;i<this.fires.length;i++){
   const f=this.fires[i];if(!f.owner.active||!f.owner.ready)continue;
   const flicker=1+Math.sin(this.time*7.1+f.phase)*.08+Math.sin(this.time*12.3+f.phase)*.035;f.mesh.scale.set(.96+flicker*.04,flicker,1);
   const s=f.owner.site,p=f.profile,c=Math.cos(s.yaw),a=Math.sin(s.yaw),x=s.x+p.chimneyX*c+p.chimneyZ*a,z=s.z-p.chimneyX*a+p.chimneyZ*c;
   for(let j=0;j<3;j++){
    const age=(this.time*.17+j/3+f.phase)%1,size=.16+age*.32;
    this.dummy.position.set(x+age*.7,f.owner.node.position.y+p.eave+p.rise+.9+age*2.6,z+age*.25);this.dummy.rotation.set(0,f.phase+age,age*.3);this.dummy.scale.set(size,size*.72,size);this.dummy.updateMatrix();this.smoke.setMatrixAt(count++,this.dummy.matrix);
   }
  }
  this.smoke.count=count;this.smoke.instanceMatrix.needsUpdate=true;
 }
}
