import * as THREE from '../web/node_modules/three/build/three.module.js';
import {touchesPlayer} from '../web/src/road-scene-rules.ts';
import {pushOut} from '../web/src/parked.ts';
export function posedEnvelopeCoverage(rig,spec){
 const p=new THREE.Vector3(),post={x:0,z:0,half:.1,halfWidth:.1,heading:0},solids=[post],actor={x:0,z:0,heading:0,vx:0,vz:0,speed:0,spec};
let cuts=0,misses=0,unresolved=0,maxVertexOutsideEnvelope=-Infinity;const examples=[];
for(const angle of [-.56,0,.56])for(const travel of [-.22,0,.24]){
 rig.steer.fl.rotation.y=rig.steer.fr.rotation.y=angle;rig.setTravel(travel,travel,travel,travel);rig.root.updateMatrixWorld(true);const seen=new Set();
 rig.root.traverse(n=>{if(!n.isMesh)return;const a=n.geometry.attributes.position;for(let i=0;i<a.count;i++){
  p.fromBufferAttribute(a,i).applyMatrix4(n.matrixWorld);if(p.y>1.2)continue;const key=[p.x,p.y,p.z].map(v=>Math.round(v*1e5)).join(',');if(seen.has(key))continue;seen.add(key);
  let outside=Infinity;const e=spec.envelope;for(let j=0;j<e.circles.length;j++)outside=Math.min(outside,Math.hypot(p.x-(e.circleSides?.[j]??0),-p.z-e.circles[j])-e.radius);maxVertexOutsideEnvelope=Math.max(maxVertexOutsideEnvelope,outside);
  for(const dx of [-.0699,0,.0699])for(const dz of [-.0699,0,.0699]){
   post.x=p.x+dx;post.z=p.z+dz;cuts++;const hit=touchesPlayer(post,actor,0,spec);if(!hit){misses++;if(examples.length<3)examples.push({angle,travel,vertex:p.toArray(),post:[post.x,post.z]});}
   actor.x=actor.z=actor.vx=actor.vz=actor.speed=0;pushOut(actor,solids);if(Math.hypot(actor.x,actor.z)<1e-10)unresolved++;actor.x=actor.z=0;
  }
 }});
}
rig.steer.fl.rotation.y=rig.steer.fr.rotation.y=0;rig.setTravel(0,0,0,0);rig.root.updateMatrixWorld(true);
 // A point more than 3 cm inside a post has a 3 cm disk inside that post. This bound therefore covers ANY post rotation.
 return{cuts,misses,unresolved,maxVertexOutsideEnvelope,examples};
}
