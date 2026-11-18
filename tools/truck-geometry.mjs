// Self-contained so the same inspector can run in Node and in the browser's renderer frame.
export function inspectTruck(rig) {
  rig.root.updateMatrixWorld(true);
  let triangles=0,finite=true,normals=true,flat=0,reversed=0,twisted=0,calls=0,shoulderSamples=0,inwardShoulders=0;
  const materials=new Set(),badEdges={}, bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  rig.root.traverse(n=>{if(!n.isMesh)return;calls++;const g=n.geometry,p=g.attributes.position,normal=g.attributes.normal,ix=g.index,edges=new Map();
    triangles+=(ix?.count??p.count)/3;materials.add(n.material);
    for(const a of Object.values(g.attributes))finite&&=[...a.array].every(Number.isFinite);
    const A=rig.root.position.clone(),B=A.clone(),C=A.clone(),F=A.clone(),N=A.clone(),M=A.clone();
    for(let i=0;i<p.count;i++){
      A.fromBufferAttribute(p,i).applyMatrix4(n.matrixWorld);[A.x,A.y,A.z].forEach((v,k)=>{bounds.min[k]=Math.min(bounds.min[k],v);bounds.max[k]=Math.max(bounds.max[k],v);});
      if(n.parent.name==='Tyre spin local X'&&n.material.name==='All-terrain rubber and liner'&&Math.hypot(p.getY(i),p.getZ(i))>.427){shoulderSamples++;if(normal.getY(i)*p.getY(i)+normal.getZ(i)*p.getZ(i)<=0)inwardShoulders++;}
      const length=Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i));if(Math.abs(length-1)>.001)normals=false;
    }
    const key=v=>[v.x,v.y,v.z].map(v=>Math.round(v*1e5)).join(',');
    for(let k=0;k<(ix?.count??p.count);k+=3){const a=ix?ix.getX(k):k,b=ix?ix.getX(k+1):k+1,c=ix?ix.getX(k+2):k+2;
      A.fromBufferAttribute(p,a);B.fromBufferAttribute(p,b);C.fromBufferAttribute(p,c);F.subVectors(B,A).cross(M.subVectors(C,A));
      if(F.length()<1e-10){flat++;continue;}
      N.fromBufferAttribute(normal,a).add(M.fromBufferAttribute(normal,b)).add(M.fromBufferAttribute(normal,c));if(F.normalize().dot(N.normalize())<-.5)reversed++;
      const ka=key(A),kb=key(B),kc=key(C);
      for(const e of [ka+'>'+kb,kb+'>'+kc,kc+'>'+ka]){const seen=edges.get(e)??0;if(seen===1){twisted++;badEdges[n.material.name]=(badEdges[n.material.name]??0)+1;}edges.set(e,seen+1);}
    }
  });
  const wheels=[...Object.values(rig.wheels),...rig.extraWheels??[]];
  const under=o=>{while(o&&o!==rig.root)o=o.parent;return o===rig.root;};
  const pivots=wheels.map(w=>({spin:w.position.toArray(),axle:w.parent.position.toArray(),underBody:rig.body.children.includes(w.parent)}));
  return {shoulderSamples,inwardShoulders,triangles,materials:materials.size,calls,finite,normals,flat,reversed,twisted,badEdges,bounds,dimensions:bounds.max.map((v,i)=>v-bounds.min[i]),pivots,
    eye:rig.driverEye.position.toArray(),brakes:rig.brakeLights.length,
    contracts:new Set(wheels).size===6&&wheels.every(under)&&rig.steer.fl===rig.wheels.fl.parent&&rig.steer.fr===rig.wheels.fr.parent&&rig.steer.fl!==rig.steer.fr&&rig.brakeLights.length>0&&rig.brakeLights.every(under)};
}
