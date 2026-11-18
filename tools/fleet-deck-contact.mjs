// Independent THREE.Ray intersections with the deck's actual mesh triangles, indexed in trailer space.
export function deckContact(THREE,FleetSurface,trailer){
 const root=new THREE.Group(),inverse=new THREE.Matrix4(),ray=new THREE.Ray(),hit=new THREE.Vector3(),worldHit=new THREE.Vector3(),seen=new Set(),candidates=new Map();let index,angles='';
 const rebuild=()=>{
  root.clear();const fixed=[],gates=[];
  for(const n of trailer.root.children)if(n.isMesh||trailer.ramps.includes(n)){const copy=n.clone(true);root.add(copy);(trailer.ramps.includes(n)?gates:fixed).push(copy)}
  root.updateMatrixWorld(true);index={bounds:new THREE.Box3(),cells:new Map()};candidates.clear();
  for(const[parts,ramp]of[[fixed,false],[gates,true]]){
   const surface=new FleetSurface(parts),touched=new Set();index.bounds.union(surface.bounds);
   for(const[key,triangles]of surface.cells){const cell=index.cells.get(key);if(cell)cell.push(...triangles);else index.cells.set(key,[...triangles]);
    for(const t of triangles){if(touched.has(t))continue;touched.add(t);const ab=t.b.clone().sub(t.a),ac=t.c.clone().sub(t.a);t.normal=ab.cross(ac);
     // Chocks and rails are obstacles, not rolling support. Use actual deck tops and ramp geometry.
     t.support=ramp||t.normal.y>0&&[t.a,t.b,t.c].every(p=>Math.abs(p.y-trailer.deckHeight)<.0001);
    }
   }
  }
  angles=trailer.ramps.map(r=>r.rotation.x).join(',');
 };rebuild();
 return{update(moving){trailer.root.updateWorldMatrix(true,true);inverse.copy(trailer.root.matrixWorld).invert();ray.direction.set(0,-1,0).transformDirection(inverse);if(angles!==trailer.ramps.map(r=>r.rotation.x).join(','))rebuild();},height(x,z,y){
  ray.origin.set(x,y+.6,z).applyMatrix4(inverse);let height=-Infinity;
  // The local ray can be oblique because the trailer pitches; visit its entire vertical index span.
  const b=index.bounds,at0=(b.min.y-ray.origin.y)/ray.direction.y,at1=(b.max.y-ray.origin.y)/ray.direction.y,xa=ray.origin.x+ray.direction.x*at0,xb=ray.origin.x+ray.direction.x*at1,za=ray.origin.z+ray.direction.z*at0,zb=ray.origin.z+ray.direction.z*at1;const a0=Math.floor(Math.min(xa,xb)*4),a1=Math.floor(Math.max(xa,xb)*4),c0=Math.floor(Math.min(za,zb)*4),c1=Math.floor(Math.max(za,zb)*4),key=a0+','+a1+','+c0+','+c1;let triangles=candidates.get(key);
  if(!triangles){triangles=[];seen.clear();for(let a=a0;a<=a1;a++)for(let c=c0;c<=c1;c++)for(const t of index.cells.get(a+','+c)??[])if(!seen.has(t)){seen.add(t);triangles.push(t);}candidates.set(key,triangles);}
  for(const t of triangles){if(!t.support||t.normal.dot(ray.direction)>=0)continue;if(ray.intersectTriangle(t.a,t.b,t.c,true,hit)){worldHit.copy(hit).applyMatrix4(trailer.root.matrixWorld);height=Math.max(height,worldHit.y)}}
  return height;
 }};
}
