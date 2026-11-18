// Serialized into browser checks. Only tread-ring vertices on the lower hemisphere enter the probe.
// The closest point on EACH shoulder measures float; every sampled point can expose penetration.
export function tyreContacts(THREE, wheels, groups) {
 const shown=o=>{for(let n=o;n;n=n.parent)if(!n.visible)return false;return true;},drawn=[];
 for(const group of groups)group.traverse(n=>{if(n.isMesh&&shown(n))drawn.push(n);});
 const v=new THREE.Vector3(),centre=new THREE.Vector3(),local=new THREE.Vector3(),inverse=new THREE.Matrix4();
 return wheels.map(({name,wheel,radius})=>{
  wheel.updateWorldMatrix(true,true);wheel.getWorldPosition(centre);inverse.copy(wheel.matrixWorld).invert();
  const seen=new Set(),samples=[],shoulders=[Infinity,Infinity];let deepest=0,misses=0,inYard=true;
  wheel.traverse(mesh=>{if(!mesh.isMesh)return;const pos=mesh.geometry.attributes.position;
   for(let i=0;i<pos.count;i++){
    v.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);local.copy(v).applyMatrix4(inverse);
    if(Math.abs(Math.hypot(local.y,local.z)-radius)>radius*.005||v.y>centre.y+.001)continue;
    const key=[v.x,v.y,v.z].map(n=>n.toFixed(6)).join(',');if(seen.has(key))continue;seen.add(key);
    const ray=new THREE.Raycaster(new THREE.Vector3(v.x,v.y+.6,v.z),new THREE.Vector3(0,-1,0),0,3),hit=ray.intersectObjects(drawn,false).find(h=>{const hide=h.object.material?.uniforms?.hideQuad?.value;if(!hide||!h.uv)return true;const q=(h.uv.x>=.5?1:0)+(h.uv.y>=.5?2:0);return hide.getComponent(q)<.5;});
    if(!hit){misses++;continue;}const gap=v.y-hit.point.y,side=local.x<0?0:1;
    deepest=Math.min(deepest,gap);shoulders[side]=Math.min(shoulders[side],gap);
    let yard=false;for(let n=hit.object;n;n=n.parent)if(n===groups[1])yard=true;inYard&&=yard;
    samples.push({x:v.x,y:v.y,z:v.z,gap,ground:hit.point.y});
   }
  });
  const known=misses===0&&shoulders.every(Number.isFinite),float=known?Math.max(0,...shoulders):null;
  return{name,penetration:-deepest,float,shoulders:shoulders.map(n=>Number.isFinite(n)?n:null),gap:known?Math.max(-deepest,float):null,ray:known,inYard,count:samples.length,misses,samples};
 });
}

// Both vehicle checks visit the same real hillside and choose its cross direction from the loaded land.
export async function realCrossSlope(tt) {
 const{terrain,site,v,THREE}=tt,hill=site.world(180,230),height=terrain.heightAt(hill.x,hill.z)??65;
 await tt.view(new THREE.Vector3(hill.x,height+55,hill.z+65),new THREE.Vector3(hill.x,height,hill.z));
 let best=null;
 for(let u=-80;u<=320;u+=20)for(let w=150;w<=350;w+=20){
  const p=site.world(u,w),a=terrain.heightAt(p.x-1,p.z),b=terrain.heightAt(p.x+1,p.z),c=terrain.heightAt(p.x,p.z-1),d=terrain.heightAt(p.x,p.z+1);
  if([a,b,c,d].some(g=>g===null))continue;
  if(terrain.hasFinest&&[-16,0,16].some(dx=>[-16,0,16].some(dz=>!terrain.hasFinest(p.x+dx,p.z+dz))))continue;
  const gx=(b-a)/2,gz=(d-c)/2,slope=Math.hypot(gx,gz),score=Math.abs(slope-.4);
  if(slope>.12&&slope<1.2&&(!best||score<best.score)){
   const heading=Math.atan2(gz,gx),pose={...p,heading};if(v.placementGuard&&(!v.placementGuard(pose)||Math.hypot(pose.x-p.x,pose.z-p.z)>.1||Math.abs(Math.sin(pose.heading-heading))>.01))continue;
   best={...p,heading,slope,score};
  }
 }
 if(!best)throw Error('no real cross slope found');
 const g=terrain.heightAt(best.x,best.z);
 await tt.view(new THREE.Vector3(best.x+14,g+10,best.z+14),new THREE.Vector3(best.x,g+1,best.z));
 v.place(best.x,best.z,best.heading);v.assist=0;
 const centre={x:(v.x+(tt.t?.x??v.x))/2,z:(v.z+(tt.t?.z??v.z))/2};
 await tt.view(new THREE.Vector3(centre.x+16,v.y+12,centre.z+16),new THREE.Vector3(centre.x,v.y+1,centre.z));
 const contacts=tt.park();return{contacts,roll:(tt.t??v).roll,slope:best.slope,chosen:best,position:{x:v.x,y:v.y,z:v.z},airborne:(tt.t??v).airborne};
}
