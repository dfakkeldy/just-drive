// Side-normal rays against the adjacent painted skin. Self-contained so the same
// probe runs on the actual browser rig and on source-mutated Node rigs.
export function lampSideStandouts(car) {
  const skin=[], point=car.root.position.clone();
  car.root.updateMatrixWorld(true);
  car.body.traverse(mesh=>{
    if(!mesh.isMesh||mesh.material.name!=='Body paint')return;
    const p=mesh.geometry.attributes.position,ix=mesh.geometry.index,n=ix?.count??p.count;
    for(let k=0;k<n;k+=3){const v=[];for(let j=0;j<3;j++){point.fromBufferAttribute(p,ix?ix.getX(k+j):k+j).applyMatrix4(mesh.matrixWorld);v.push(point.x,point.y,point.z);}skin.push(v);}
  });
  return car.brakeLights.map(lamp=>{
    const p=lamp.geometry.attributes.position,ix=lamp.geometry.index,n=ix?.count??p.count,edges=new Map();
    const at=k=>ix?ix.getX(k):k,key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e5)).join(',');
    for(let k=0;k<n;k+=3)for(const[a,b]of[[0,1],[1,2],[2,0]]){
      const ka=key(at(k+a)),kb=key(at(k+b)),id=ka<kb?ka+'|'+kb:kb+'|'+ka;
      const edge=edges.get(id)??{count:0,vertices:[at(k+a),at(k+b)]};edge.count++;edges.set(id,edge);
    }
    // Long outline edges join height rows. Transverse chamber caps curve in Y
    // by a few mm; treating those cap points as new rows measures the rear face.
    const outline=new Set();for(const edge of edges.values())if(edge.count===1&&Math.abs(p.getY(edge.vertices[0])-p.getY(edge.vertices[1]))>.007)edge.vertices.forEach(i=>outline.add(i));
    const rows=new Map();for(const i of outline){point.fromBufferAttribute(p,i).applyMatrix4(lamp.matrixWorld);const key=Math.round(point.y*100);if(!rows.has(key))rows.set(key,[]);rows.get(key).push([point.x,point.y,point.z]);}
    let samples=0,misses=0,maxStandout=-Infinity,worstHeight=0;
    for(const row of rows.values()){
      const fore=(Math.min(...row.map(p=>p[2]))+Math.max(...row.map(p=>p[2])))/2;
      for(const[x,y,z]of row){if(z>fore+1e-6)continue;samples++;const side=Math.sign(x),rz=z-.01;let hit=-Infinity;
        // Intersect a ray from side*2 along -side X. YZ barycentric coordinates
        // give the same double-sided triangle intersections without a new THREE import.
        for(const v of skin){const by=v[4]-v[1],bz=v[5]-v[2],cy=v[7]-v[1],cz=v[8]-v[2],det=by*cz-bz*cy;if(Math.abs(det)<1e-12)continue;
          const u=((y-v[1])*cz-(rz-v[2])*cy)/det,w=(by*(rz-v[2])-bz*(y-v[1]))/det;
          if(u< -1e-6||w< -1e-6||u+w>1+1e-6)continue;
          const rx=side*(v[0]+u*(v[3]-v[0])+w*(v[6]-v[0]));if(rx<=2&&rx>hit)hit=rx;
        }
        if(!Number.isFinite(hit)){misses++;continue;}
        const standout=Math.abs(x)-hit;if(standout>maxStandout){maxStandout=standout;worstHeight=y;}
      }
    }
    return {rows:rows.size,samples,misses,maxStandout,worstHeight};
  });
}

// Sample the complete projected lens, including clear chambers, and inspect
// the actual batched trim. No constructor metadata stands in for drawn faces.
export function lampSurfaceChecks(car) {
  const point=car.root.position.clone(),normal=point.clone(),paint=[],rubber=[],trim=[],other=[],lenses=[],reds=[],lensEdges=new Map();
  car.root.updateMatrixWorld(true);
  const world=(p,i,m)=>{point.fromBufferAttribute(p,i).applyMatrix4(m);return[point.x,point.y,point.z];};
  const isLamp=new Set(car.brakeLights);
  car.body.traverse(mesh=>{
    if(!mesh.isMesh)return;const g=mesh.geometry,p=g.attributes.position,uv=g.attributes.uv,ix=g.index,n=ix?.count??p.count;
    const color=mesh.material.color?.getHex(),red=isLamp.has(mesh),atlas=mesh.material.map&&mesh.material.emissiveMap===mesh.material.map;
    if(!mesh.visible||mesh.material.visible===false||mesh.material.opacity===0)return;
    const edges=new Map(),at=k=>ix?ix.getX(k):k,key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e5)).join(',');
    for(let k=0;k<n;k+=3){
      const ids=[at(k),at(k+1),at(k+2)],v=ids.map(i=>world(p,i,mesh.matrixWorld)),flat=v.flat();
      const clear=atlas&&uv&&v.every(q=>Math.abs(q[0])>.55&&q[1]>.91&&q[1]<1.245&&q[2]>1.5)
        &&ids.every(i=>uv.getX(i)>=.6-1e-5&&uv.getX(i)<=.97+1e-5&&uv.getY(i)>=.435-1e-5&&uv.getY(i)<=.49+1e-5);
      if(red||clear){
        lenses.push(flat);
        const ab=point.clone().fromArray(v[1]).sub(point.clone().fromArray(v[0])),ac=point.clone().fromArray(v[2]).sub(point.clone().fromArray(v[0]));
        const outward=ab.cross(ac).normalize().toArray(),inside=v[0].map((x,i)=>(x+v[1][i]+v[2][i])/3);
        for(const[a,b]of[[0,1],[1,2],[2,0]]){
          const ka=v[a].map(x=>Math.round(x*1e5)).join(','),kb=v[b].map(x=>Math.round(x*1e5)).join(','),id=ka<kb?ka+'|'+kb:kb+'|'+ka;
          const edge=lensEdges.get(id)??{count:0,a:v[a],b:v[b],inside,outward};edge.count++;lensEdges.set(id,edge);
        }
      }
      else if(mesh.material.name==='Body paint')paint.push(flat);
      else if(color===0x181d1d)rubber.push(flat);
      else if(color===0x555957)trim.push(flat);
      else other.push(flat);
      if(red)for(const[a,b]of[[0,1],[1,2],[2,0]]){const ka=key(ids[a]),kb=key(ids[b]),id=ka<kb?ka+'|'+kb:kb+'|'+ka;const e=edges.get(id)??{count:0,ids:[ids[a],ids[b]]};e.count++;edges.set(id,e);}
    }
    if(red)reds.push({mesh,edges});
  });
  const bins=triangles=>{const result=Array.from({length:96},()=>[]);for(const v of triangles){const lo=Math.max(0,Math.min(95,Math.floor((Math.min(v[1],v[4],v[7])-.68)/.01))),hi=Math.max(0,Math.min(95,Math.floor((Math.max(v[1],v[4],v[7])-.68)/.01)));for(let b=lo;b<=hi;b++)result[b].push(v);}return result;};
  const lensBins=bins(lenses),paintBins=bins(paint),rubberBins=bins(rubber),otherBins=bins([...other,...trim]);
  const sideHit=(bins,side,y,z)=>{let hit=-Infinity;for(const v of bins[Math.max(0,Math.min(95,Math.floor((y-.68)/.01)))]){
    const by=v[4]-v[1],bz=v[5]-v[2],cy=v[7]-v[1],cz=v[8]-v[2],det=by*cz-bz*cy;if(Math.abs(det)<1e-12)continue;
    const u=((y-v[1])*cz-(z-v[2])*cy)/det,w=(by*(z-v[2])-bz*(y-v[1]))/det;
    if(u< -1e-8||w< -1e-8||u+w>1+1e-8)continue;const x=side*(v[0]+u*(v[3]-v[0])+w*(v[6]-v[0]));if(x<=2&&x>hit)hit=x;
  }return hit;};
  // A 2 mm mounting rim is excluded; the rest of every red/clear triangle is sampled.
  const boundaries=[-1,1].map(side=>{const edges=new Map();for(const v of lenses){if(Math.sign(v[0]+v[3]+v[6])!==side)continue;for(const[a,b]of[[0,3],[3,6],[6,0]]){const pa=[v[a+1],v[a+2]],pb=[v[b+1],v[b+2]],ka=pa.map(x=>Math.round(x*1e5)).join(','),kb=pb.map(x=>Math.round(x*1e5)).join(','),id=ka<kb?ka+'|'+kb:kb+'|'+ka;const e=edges.get(id)??{count:0,a:pa,b:pb};e.count++;edges.set(id,e);}}return[...edges.values()].filter(e=>e.count===1);});
  const sides=[-1,1].map(side=>({side,samples:0,paintHits:0,rubberHits:0,maxPaintCover:0,maxRubberCover:0,worst:null}));
  for(const v of lenses){const side=Math.sign(v[0]+v[3]+v[6]),result=sides[side>0?1:0],outline=boundaries[side>0?1:0];
    for(let i=0;i<8;i++)for(let j=0;j<8-i;j++)for(const f of [1/3,2/3]){
      if(f> .5&&i+j===7)continue;const u=(i+f)/8,w=(j+f)/8,y=v[1]+u*(v[4]-v[1])+w*(v[7]-v[1]),z=v[2]+u*(v[5]-v[2])+w*(v[8]-v[2]);
      if(outline.some(e=>{const dy=e.b[0]-e.a[0],dz=e.b[1]-e.a[1],l=dy*dy+dz*dz,t=l?Math.max(0,Math.min(1,((y-e.a[0])*dy+(z-e.a[1])*dz)/l)):0;return(y-e.a[0]-t*dy)**2+(z-e.a[1]-t*dz)**2<4e-6;}))continue;
      const lens=sideHit(lensBins,side,y,z);if(!Number.isFinite(lens))continue;result.samples++;
      const p=sideHit(paintBins,side,y,z)-lens,r=sideHit(rubberBins,side,y,z)-lens,o=sideHit(otherBins,side,y,z)-lens;
      // Only the first surface counts: the existing mud/atlas foot panel stays
      // in place, as do the intentionally overlaid trim dividers.
      if(p>.001&&p>=r-1e-8&&p>=o-1e-8){result.paintHits++;if(p>result.maxPaintCover){result.maxPaintCover=p;result.worst=[y,z];}}
      if(r>.001&&r>p+1e-8&&r>=o-1e-8){result.rubberHits++;result.maxRubberCover=Math.max(result.maxRubberCover,r);}
    }
  }
  const rayHit=(triangles,o,d,maxDistance=.05)=>{let closest=Infinity;for(const v of triangles){const e1=[v[3]-v[0],v[4]-v[1],v[5]-v[2]],e2=[v[6]-v[0],v[7]-v[1],v[8]-v[2]],h=[d[1]*e2[2]-d[2]*e2[1],d[2]*e2[0]-d[0]*e2[2],d[0]*e2[1]-d[1]*e2[0]],det=e1[0]*h[0]+e1[1]*h[1]+e1[2]*h[2];if(Math.abs(det)<1e-12)continue;
    const s=[o[0]-v[0],o[1]-v[1],o[2]-v[2]],u=(s[0]*h[0]+s[1]*h[1]+s[2]*h[2])/det;if(u< -1e-6||u>1+1e-6)continue;
    const q=[s[1]*e1[2]-s[2]*e1[1],s[2]*e1[0]-s[0]*e1[2],s[0]*e1[1]-s[1]*e1[0]],w=(d[0]*q[0]+d[1]*q[1]+d[2]*q[2])/det;if(w< -1e-6||u+w>1+1e-6)continue;
    const t=(e2[0]*q[0]+e2[1]*q[1]+e2[2]*q[2])/det;if(t>=0&&t<=maxDistance)closest=Math.min(closest,t);
  }return closest;};
  // Trace the complete outer red/clear perimeter every 5 mm. The two offsets
  // sit just outside the lens in its tangent plane, inside the mounting rim.
  // Stop 40 mm behind the edge: a far-side/cabin surface cannot close a socket.
  const closure=[...paint,...rubber,...lenses],sockets=[-1,1].map(side=>({side,edges:0,samples:0,misses:0,maxRecess:0,worst:null}));
  for(const edge of lensEdges.values()){
    if(edge.count!==1)continue;const a=point.clone().fromArray(edge.a),b=point.clone().fromArray(edge.b),along=b.clone().sub(a),length=along.length();if(length<1e-6)continue;
    const n=point.clone().fromArray(edge.outward),across=point.clone().fromArray(edge.inside).sub(a);across.addScaledVector(along,-across.dot(along)/along.lengthSq()).normalize().negate();
    const result=sockets[edge.a[0]>0?1:0];result.edges++;const steps=Math.max(2,Math.ceil(length/.005));
    for(let i=0;i<steps;i++)for(const offset of [.0005,.0015]){
      const edgePoint=a.clone().addScaledVector(along,(i+.5)/steps).addScaledVector(across,offset),origin=edgePoint.clone().addScaledVector(n,.03);
      const hit=rayHit(closure,origin.toArray(),n.clone().negate().toArray(),.07);result.samples++;
      if(!Number.isFinite(hit)||hit>.070){result.misses++;if(!result.worst)result.worst=edgePoint.toArray();}
      else result.maxRecess=Math.max(result.maxRecess,hit-.03);
    }
  }
  const dividers=[];
  for(const{mesh,edges}of reds)for(const height of [.9225,1.234]){
    const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal;const result={side:Math.sign(p.getX(0)),height,samples:0,hits:0,maxOffset:0};
    const cap=[...edges.values()].filter(edge=>edge.count===1&&edge.ids.every(i=>Math.abs(p.getY(i)-height)<=.0065));
    const fore=Math.min(...cap.flatMap(edge=>edge.ids.map(i=>world(p,i,mesh.matrixWorld)[2])));
    for(const edge of cap){const[a,b]=edge.ids;
      const pa=world(p,a,mesh.matrixWorld),pb=world(p,b,mesh.matrixWorld),na=normal.clone().fromBufferAttribute(n,a).transformDirection(mesh.matrixWorld),nb=normal.clone().fromBufferAttribute(n,b).transformDirection(mesh.matrixWorld);
      for(const t of [.25,.75]){const at=pa.map((x,k)=>x+(pb[k]-x)*t);if(at[2]-fore<.001)continue;const dir=na.clone().lerp(nb,t).normalize(),o=at.map((x,k)=>x+[dir.x,dir.y,dir.z][k]*.025),hit=rayHit(trim,o,[-dir.x,-dir.y,-dir.z]);result.samples++;if(Number.isFinite(hit)){result.hits++;result.maxOffset=Math.max(result.maxOffset,Math.abs(.025-hit));}}
    }
    dividers.push(result);
  }
  return{sides,dividers,sockets};
}
