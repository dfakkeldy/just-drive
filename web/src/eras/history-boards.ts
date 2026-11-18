import {planHistoryBoards,type BoardPlan} from './history-board-sites';
import * as THREE from 'three';
import type {Roads} from '../roads';import type {Terrain} from '../terrain';
import {Mesher} from '../yard-kit';import {historySignAtlas,historyGeometry} from './history-art';
import {HistoryContacts,type HistoryContact} from './history-contacts';
import {periodProfile} from './history-art';
import type{PeriodSite}from'./history-sites';
export interface BoardOwner {site:PeriodSite;active:boolean;ready:boolean;node:THREE.Group;notify:()=>void}
export interface TradeBoard {refs:HistoryContact[];version:number;shown:boolean;slot:number;matrices:THREE.Matrix4[];gableMesh?:THREE.Mesh;owner:BoardOwner;x:number;z:number;yaw:number;width:number;height:number;letterHeight:number;roadX:number;roadZ:number;approachX:number;approachZ:number;node:THREE.Group;mesh:THREE.Mesh;contacts:Float64Array;heights:Float64Array;sources:Float64Array}
/** High-contrast painted boards face a road approach. The two posts stay outside its driving strip. */
export class HistoryBoards {
 readonly group=new THREE.Group();readonly list:TradeBoard[]=[];
 readonly audit={fits:0,ownerUpdates:0,writes:0,owners:new Map<string,number>()};
 private dummy=new THREE.Object3D();private zero=new THREE.Matrix4().makeScale(0,0,0);private byOwner=new Map<BoardOwner,TradeBoard>();
 private posts:THREE.InstancedMesh;
 constructor(terrain:Terrain,roads:Roads,owners:readonly BoardOwner[],material:THREE.Material,groundContacts:HistoryContacts,storedPlans?:readonly BoardPlan[]){
  const words=owners.filter(o=>o.site.word).map(o=>o.site.word),atlas=historySignAtlas(words);
  const face=new THREE.MeshBasicMaterial({map:atlas.texture,side:THREE.FrontSide,toneMapped:false});
  const plans=storedPlans??planHistoryBoards(owners.map(o=>o.site),roads,(x,z)=>terrain.coverAt(x,z));
  for(const owner of owners){
   const s=owner.site;if(!s.word)continue;const plan=plans.find(p=>p.id===s.id);if(!plan)throw Error('Missing trade board '+s.id);
   const {x,z,yaw,roadX,roadZ,...size}=plan;
   const node=new THREE.Group();node.position.set(x,0,z);node.rotation.y=yaw;node.visible=false;node.name='trade-board-'+s.id;
   const m=new Mesher();m.at(0,1.45+size.height/2,0);m.plate(size.width,size.height,atlas.cell(s.word),.08);const mesh=new THREE.Mesh(m.geometry(),face);node.add(mesh);this.group.add(node);
   const contacts=new Float64Array([x,z,x-Math.cos(yaw)*(size.width/2-.2),z+Math.sin(yaw)*(size.width/2-.2),x+Math.cos(yaw)*(size.width/2-.2),z-Math.sin(yaw)*(size.width/2-.2)]);
   const board:TradeBoard={refs:[],version:-1,shown:false,slot:this.list.length*2,matrices:[new THREE.Matrix4(),new THREE.Matrix4()],owner,x,z,yaw,...size,letterHeight:atlas.capHeight(s.word),roadX,roadZ,approachX:roadX,approachZ:roadZ,node,mesh,contacts,heights:new Float64Array(3),sources:new Float64Array(3)};
   for(let i=0;i<3;i++)board.refs.push(groundContacts.watch(board.contacts[i*2],board.contacts[i*2+1],owner.notify));
   if(s.kind==='mill'){const p=periodProfile(s),gable=new Mesher(),width=Math.min(size.width,p.width*.9),height=Math.min(1.35,size.height*width/size.width);gable.at(0,p.eave-.45,p.length/2+.10);gable.plate(width,height,atlas.cell(s.word),.08);board.gableMesh=new THREE.Mesh(gable.geometry(),face);owner.node.add(board.gableMesh);}
   this.list.push(board);this.byOwner.set(owner,board);
   terrain.clear.push([x-size.width/2-3,z-size.width/2-3,x+size.width/2+3,z+size.width/2+3]);
  }
  const post=new Mesher();post.box(0,.5,0,.18,1,.18,[.34,.32,.27]);this.posts=new THREE.InstancedMesh(historyGeometry(post,new Array(post.pos.length/3).fill(3)),material,this.list.length*2);this.posts.castShadow=true;this.posts.frustumCulled=false;this.group.add(this.posts);for(let i=0;i<this.posts.count;i++)this.posts.setMatrixAt(i,this.zero);this.posts.instanceMatrix.needsUpdate=true;
 }
 updateOwner(owner:BoardOwner):void {
  const b=this.byOwner.get(owner);if(!b)return;this.audit.ownerUpdates++;
  let known=true,version=0;for(let i=0;i<b.refs.length;i++){known=known&&b.refs[i].known;version+=b.refs[i].version;}
  const show=owner.active&&owner.ready&&known;let fitted=false;
  if(show&&version!==b.version){
   b.version=version;fitted=true;this.audit.fits++;this.audit.owners.set(owner.site.id,(this.audit.owners.get(owner.site.id)??0)+1);
   for(let i=0;i<3;i++){b.heights[i]=b.refs[i].height;b.sources[i]=b.refs[i].source;}b.node.position.y=b.heights[0];
   for(let side=0;side<2;side++){
    const ground=b.heights[side+1],top=b.heights[0]+1.45+b.height+.2;
    this.dummy.position.set(b.contacts[(side+1)*2],ground-.08,b.contacts[(side+1)*2+1]);this.dummy.rotation.set(0,b.yaw,0);this.dummy.scale.set(1,top-ground+.08,1);this.dummy.updateMatrix();b.matrices[side].copy(this.dummy.matrix);
   }
  }
  if(fitted||show!==b.shown){for(let side=0;side<2;side++){const slot=b.slot+side;this.posts.setMatrixAt(slot,show?b.matrices[side]:this.zero);this.posts.instanceMatrix.addUpdateRange(slot*16,16);this.audit.writes++;}this.posts.instanceMatrix.needsUpdate=true;}
  b.shown=show;b.node.visible=show;
 }
}
