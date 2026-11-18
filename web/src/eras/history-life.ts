import * as THREE from 'three';import{Mesher}from'../yard-kit';
import type{Roads}from'../roads';import type{Terrain}from'../terrain';import{siteHash,farmBarn,type PeriodSite}from'./history-sites';
import {HistoryContacts,type HistoryContact} from './history-contacts';
interface Owner{site:PeriodSite;active:boolean;ready:boolean;notify:()=>void}
interface Item{slot?:number;matrix?:THREE.Matrix4;refs?:HistoryContact[];version?:number;shown?:boolean;owner:Owner;kind:'rail'|'log'|'hay'|'cart';x:number;z:number;bx:number;bz:number;level:number;heading:number}
/** Four instanced batches: split rails, firewood, straw and plain wooden carts. */
export class HistoryLife{
 readonly group=new THREE.Group();readonly counts={fences:0,woodpiles:0,hay:0,carts:0};
 private items:Item[]=[];private meshes:Record<Item['kind'],THREE.InstancedMesh>;private byOwner=new Map<Owner,Item[]>();private zero=new THREE.Matrix4().makeScale(0,0,0);
 readonly audit={fits:0,ownerUpdates:0,writes:0,owners:new Map<string,number>()};
 private dummy=new THREE.Object3D();private direction=new THREE.Vector3();private up=new THREE.Vector3(0,1,0);
 constructor(terrain:Terrain,roads:Roads,owners:readonly Owner[],contacts:HistoryContacts){
  const log=new THREE.CylinderGeometry(.075,.095,1,5,1,false),wood=new THREE.MeshLambertMaterial({color:0x817b68});
  const hay=new Mesher();for(let i=0;i<3;i++){hay.at((i-1)*.38,0,0,0,0,(i-1)*.15);hay.cyl(0,.62,0,.42,1.25,[.44,.35,.16],'y',6,.12);}hay.at(0,0,0);hay.box(0,.65,0,1.05,.08,.10,[.30,.25,.12]);
  const cart=new Mesher();cart.box(0,.8,0,1.65,.6,1.15,[.36,.32,.24]);for(const side of [-1,1])cart.box(side*.62,.7,-1.25,.10,.10,1.6,[.32,.28,.20]);for(const x of [-.7,.7])cart.cyl(x,.42,0,.42,.12,[.25,.24,.19],'x',8);
  for(const owner of owners){
   const s=owner.site,hash=(tag:string)=>siteHash(s.id+tag),road=roads.nearest(s.x,s.z,160,r=>r.kind>=1&&r.kind<=4&&!r.bridge);
   if(road&&hash('-fence')<.46){
    const dx=s.x-road.x,dz=s.z-road.z,d=Math.hypot(dx,dz)||1,nx=dx/d,nz=dz/d,fx=Math.sin(road.heading),fz=-Math.cos(road.heading),offset=road.road.halfWidth+2.4;
    const cx=road.x+nx*offset+fx*17,cz=road.z+nz*offset+fz*17;
    let valid=true;const nodes:[number,number][]=[];
    for(let i=0;i<5;i++){const along=-5+i*2.5,zig=i%2*.65,x=cx+fx*along+nx*zig,z=cz+fz*along+nz*zig,h=roads.nearest(x,z,10);if(h&&h.dist<h.road.halfWidth+1.5||terrain.coverAt(x,z)===4)valid=false;nodes.push([x,z]);}
    if(valid){this.counts.fences++;for(let i=1;i<nodes.length;i++)for(let level=0;level<4;level++)this.items.push({owner,kind:'rail',x:nodes[i-1][0],z:nodes[i-1][1],bx:nodes[i][0],bz:nodes[i][1],level:.28+level*.25,heading:0});}
   }
   const barn=farmBarn(s),centre=barn??s,c=Math.cos(s.yaw),a=Math.sin(s.yaw);
   const at=(x:number,z:number)=>({x:centre.x+x*c+z*a,z:centre.z-x*a+z*c});
   if(hash('-wood')<.45){const p=at(centre.width/2+1.3,-1);if(terrain.coverAt(p.x,p.z)!==4){this.counts.woodpiles++;for(let row=0;row<3;row++)for(let col=0;col<4-row;col++){const q=at(centre.width/2+1+col*.2,-1+row*.12);this.items.push({owner,kind:'log',...q,bx:q.x,bz:q.z,level:.12+row*.18,heading:s.yaw});}}}
   if(barn&&hash('-hay')<.48){this.counts.hay++;for(let i=0;i<3;i++){const p=at(-centre.width/2-1.8,-3+i*1.5);if(terrain.coverAt(p.x,p.z)!==4)this.items.push({owner,kind:'hay',...p,bx:p.x,bz:p.z,level:0,heading:s.yaw});}}
   if(hash('-cart')<.12){const p=at(centre.width/2+3.0,3);if(terrain.coverAt(p.x,p.z)!==4){this.counts.carts++;this.items.push({owner,kind:'cart',...p,bx:p.x,bz:p.z,level:0,heading:s.yaw});}}
  }
  const make=(kind:Item['kind'],geo:THREE.BufferGeometry,material:THREE.Material)=>{const n=this.items.filter(i=>i.kind===kind).length,mesh=new THREE.InstancedMesh(geo,material,Math.max(1,n));mesh.frustumCulled=false;mesh.castShadow=true;mesh.count=n;for(let i=0;i<n;i++)mesh.setMatrixAt(i,this.zero);mesh.instanceMatrix.needsUpdate=true;this.group.add(mesh);return mesh;};
  this.meshes={rail:make('rail',log,wood),log:make('log',log,new THREE.MeshLambertMaterial({color:0x6f6651})),hay:make('hay',hay.geometry(),new THREE.MeshLambertMaterial({vertexColors:true})),cart:make('cart',cart.geometry(),new THREE.MeshLambertMaterial({vertexColors:true}))};
  const slots={rail:0,log:0,hay:0,cart:0};
  for(const p of this.items){p.slot=slots[p.kind]++;p.matrix=new THREE.Matrix4();p.version=-1;p.shown=false;p.refs=[contacts.watch(p.x,p.z,p.owner.notify)];if(p.kind==='rail')p.refs.push(contacts.watch(p.bx,p.bz,p.owner.notify));const list=this.byOwner.get(p.owner);if(list)list.push(p);else this.byOwner.set(p.owner,[p]);}
 }
 updateOwner(owner:Owner):void{
  const items=this.byOwner.get(owner);if(!items)return;this.audit.ownerUpdates++;
  for(let i=0;i<items.length;i++){
   const p=items[i],refs=p.refs!;let version=0,known=true;for(let j=0;j<refs.length;j++){version+=refs[j].version;known=known&&refs[j].known;}
   const show=owner.active&&owner.ready&&known;let fitted=false;
   if(show&&version!==p.version){
    p.version=version;fitted=true;this.audit.fits++;this.audit.owners.set(owner.site.id,(this.audit.owners.get(owner.site.id)??0)+1);const y=refs[0].height;
    if(p.kind==='rail'){
     const by=refs[1].height;this.direction.set(p.bx-p.x,by-y,p.bz-p.z);const len=this.direction.length();this.direction.multiplyScalar(1/len);this.dummy.quaternion.setFromUnitVectors(this.up,this.direction);this.dummy.position.set((p.x+p.bx)/2,(y+by)/2+p.level,(p.z+p.bz)/2);this.dummy.scale.set(1,len,1);
    }else if(p.kind==='log'){this.dummy.position.set(p.x,y+p.level,p.z);this.dummy.rotation.set(Math.PI/2,p.heading,0);this.dummy.scale.set(1,1.4,1);}
    else{this.dummy.position.set(p.x,y,p.z);this.dummy.rotation.set(0,p.heading,0);this.dummy.scale.set(1,1,1);}
    this.dummy.updateMatrix();p.matrix!.copy(this.dummy.matrix);
   }
   if(fitted||show!==p.shown){const mesh=this.meshes[p.kind],slot=p.slot!;mesh.setMatrixAt(slot,show?p.matrix!:this.zero);mesh.instanceMatrix.addUpdateRange(slot*16,16);mesh.instanceMatrix.needsUpdate=true;this.audit.writes++;}
   p.shown=show;
  }
 }
}
