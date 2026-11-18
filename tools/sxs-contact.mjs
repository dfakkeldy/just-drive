// Self-contained for injection into the renderer page. All clearances use a vertex and the land under THAT vertex.
export function tyreContacts(THREE,rig,objects) {
 const shown=o=>{for(let n=o;n;n=n.parent)if(!n.visible)return false;return true;};
 rig.root.updateMatrixWorld(true);const drawn=[];
 for(const g of objects)g.traverse(n=>{if(n.isMesh&&shown(n))drawn.push(n);});
 const point=new THREE.Vector3(),local=new THREE.Vector3(),ray=new THREE.Raycaster();
 ray.ray.direction.set(0,-1,0);ray.near=0;ray.far=3;
 return Object.entries(rig.wheels).map(([name,w])=>{
  const vertices=[];{const inverse=w.matrixWorld.clone().invert(),seen=new Set();
   w.traverse(n=>{if(!n.isMesh||!shown(n)||!/(rubber|tyre)/i.test(n.material.name))return;const p=n.geometry.attributes.position,matrix=inverse.clone().multiply(n.matrixWorld);
    for(let i=0;i<p.count;i++){point.fromBufferAttribute(p,i).applyMatrix4(matrix);const key=point.toArray().map(v=>Math.round(v*1e6)).join(',');if(!seen.has(key)){seen.add(key);vertices.push(point.clone());}}
   });
  }
  // Keep the lowest actual tread vertex in each angular bin on each axial half. On a plane aligned with the
  // wheel, this includes the exact support vertex. Curved tread points above it are not mistaken for wheel float.
  const bins=new Map();
  for(const v of vertices){local.copy(v).applyMatrix4(w.matrix).sub(w.position);if(local.y>1e-8)continue;const angle=Math.atan2(local.z,-local.y),side=local.x<0?0:1;
   const key=side*48+Math.max(0,Math.min(47,Math.floor((angle+Math.PI/2)/Math.PI*48))),old=bins.get(key);
   if(!old||local.y<old.y)bins.set(key,{v,y:local.y,side});
  }
  const samples=[],shoulders=[Infinity,Infinity];let deepest=Infinity,support=null;
  for(const {v,side}of bins.values()){
   point.copy(v).applyMatrix4(w.matrixWorld);ray.ray.origin.copy(point);ray.ray.origin.y+=.6;
   const hit=ray.intersectObjects(drawn,false)[0];
   if(!hit){samples.push({point:point.toArray(),gap:null,side});continue;}
   const gap=point.y-hit.point.y;shoulders[side]=Math.min(shoulders[side],gap);
   const inYard=objects[1]?(()=>{for(let n=hit.object;n;n=n.parent)if(n===objects[1])return true;return false;})():false;
   samples.push({point:point.toArray(),ground:hit.point.y,gap,side,inYard});if(gap<deepest){deepest=gap;support={ground:hit.point.y,inYard};}
  }
  const valid=samples.length>0&&samples.every(s=>s.gap!==null)&&shoulders.every(Number.isFinite);
  return{name,ray:valid,ground:support?.ground??null,inYard:support?.inYard??false,gap:valid?deepest:null,deepest:valid?deepest:null,
   penetration:valid?Math.max(0,-deepest):null,largestFloat:valid?Math.max(0,...shoulders):null,shoulders,samples};
 });
}

// Kept separate so the exact browser acceptance rule has direct partial-ray regression coverage.
export function contactIsSeated(c,requireYard=false) {
 return c.ray===true&&Number.isFinite(c.deepest)&&Number.isFinite(c.largestFloat)&&Number.isFinite(c.ground)&&c.samples.length>0&&c.samples.every(s=>Number.isFinite(s.gap))&&(!requireYard||c.inYard===true)&&c.deepest>-.04&&c.largestFloat<.04;
}
