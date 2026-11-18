// Test-only vertical-ray index. Raycaster still uses the original drawn mesh, attributes and triangles.
// The full index is restored synchronously before any render or physics update can run.
import * as THREE from '../web/node_modules/three/build/three.module.js';
export function indexDrawnMesh(mesh){
 if(!mesh.isMesh||mesh.userData.stuntRayIndex)return;
 const geometry=mesh.geometry,position=geometry.attributes.position,originalIndex=geometry.index,full=originalIndex?.array??Uint32Array.from({length:position.count},(_,i)=>i),buckets=new Map(),point=new THREE.Vector3(),inverse=new THREE.Matrix4(),size=4;
 for(let i=0;i<full.length;i+=3){let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;for(let j=0;j<3;j++){const k=full[i+j];x0=Math.min(x0,position.getX(k));x1=Math.max(x1,position.getX(k));z0=Math.min(z0,position.getZ(k));z1=Math.max(z1,position.getZ(k));}for(let x=Math.floor(x0/size);x<=Math.floor(x1/size);x++)for(let z=Math.floor(z0/size);z<=Math.floor(z1/size);z++){const key=x+','+z;let list=buckets.get(key);if(!list)buckets.set(key,list=[]);list.push(full[i],full[i+1],full[i+2]);}}
 for(const[key,list]of buckets)buckets.set(key,new THREE.BufferAttribute(new Uint32Array(list),1));
 const raycast=mesh.raycast,empty=new THREE.BufferAttribute(new Uint32Array(0),1);mesh.userData.stuntRayIndex=true;
 mesh.raycast=function(raycaster,hits){if(this.userData.stuntRayIndexBypass)return raycast.call(this,raycaster,hits);inverse.copy(this.matrixWorld).invert();point.copy(raycaster.ray.origin).applyMatrix4(inverse);const direction=raycaster.ray.direction.clone().transformDirection(inverse);if(Math.abs(direction.x)+Math.abs(direction.z)>1e-8)return raycast.call(this,raycaster,hits);const index=geometry.index;geometry.index=buckets.get(Math.floor(point.x/size)+','+Math.floor(point.z/size))??empty;try{return raycast.call(this,raycaster,hits);}finally{geometry.index=index;}};
}
