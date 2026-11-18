// Test-only acceleration. THREE.Ray still intersects the actual drawn triangles; no terrain height API is used.
export function verticalRays(THREE,groups,centre) {
 for(const group of groups)group.traverseVisible(mesh=>{
  if(!mesh.isMesh||mesh.userData.fleetVerticalRay)return;mesh.updateWorldMatrix(true,false);
  const bounds=new THREE.Box3().setFromObject(mesh);if(bounds.max.x<centre.x-25||bounds.min.x>centre.x+25||bounds.max.z<centre.z-25||bounds.min.z>centre.z+25)return;
  mesh.userData.fleetVerticalRay=true;const original=mesh.raycast;let revision=0,verified=-1,cells,previousGeometry=null,previousVersion=-1;const previousMatrix=new Float64Array(16);
  mesh.raycast=function(caster,hits){
   if(Math.abs(caster.ray.direction.x)+Math.abs(caster.ray.direction.z)>1e-10)return original.call(this,caster,hits);
   const geometry=this.geometry,position=geometry.attributes.position,uv=geometry.attributes.uv,e=this.matrixWorld.elements;
   if(Math.abs(caster.ray.origin.x-centre.x)>25||Math.abs(caster.ray.origin.z-centre.z)>25)return original.call(this,caster,hits);
   let changed=geometry!==previousGeometry||position.version!==previousVersion;for(let n=0;n<16&&!changed;n++)if(e[n]!==previousMatrix[n])changed=true;
   if(changed){revision++;previousGeometry=geometry;previousVersion=position.version;previousMatrix.set(e);cells=new Map();const count=geometry.index?.count??position.count;
    for(let i=0;i<count;i+=3){const indices=[0,1,2].map(n=>geometry.index?.getX(i+n)??i+n),[a,b,c]=indices.map(n=>new THREE.Vector3().fromBufferAttribute(position,n).applyMatrix4(this.matrixWorld));
     if(Math.abs((b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z))<1e-9)continue;
     const triangle={a,b,c,indices,faceIndex:i/3};for(let x=Math.max(Math.floor(Math.min(a.x,b.x,c.x)*2),Math.floor((centre.x-25)*2));x<=Math.min(Math.floor(Math.max(a.x,b.x,c.x)*2),Math.floor((centre.x+25)*2));x++)for(let z=Math.max(Math.floor(Math.min(a.z,b.z,c.z)*2),Math.floor((centre.z-25)*2));z<=Math.min(Math.floor(Math.max(a.z,b.z,c.z)*2),Math.floor((centre.z+25)*2));z++){const k=x+','+z,cell=cells.get(k);if(cell)cell.push(triangle);else cells.set(k,[triangle]);}
    }
   }
   const first=hits.length;
   const origin=caster.ray.origin,point=new THREE.Vector3(),weights=new THREE.Vector3();
   for(const t of cells.get(Math.floor(origin.x*2)+','+Math.floor(origin.z*2))??[]){if(!caster.ray.intersectTriangle(t.a,t.b,t.c,false,point))continue;const distance=point.distanceTo(origin);if(distance<caster.near||distance>caster.far)continue;const hit={distance,point:point.clone(),object:this,faceIndex:t.faceIndex};if(uv){THREE.Triangle.getBarycoord(point,t.a,t.b,t.c,weights);hit.uv=new THREE.Vector2(uv.getX(t.indices[0])*weights.x+uv.getX(t.indices[1])*weights.y+uv.getX(t.indices[2])*weights.z,uv.getY(t.indices[0])*weights.x+uv.getY(t.indices[1])*weights.y+uv.getY(t.indices[2])*weights.z)}hits.push(hit);}
   if(verified!==revision){const expected=[];original.call(this,caster,expected);const a=expected.reduce((n,h)=>Math.min(n,h.distance),Infinity),b=hits.slice(first).reduce((n,h)=>Math.min(n,h.distance),Infinity);if(a!==b&&Math.abs(a-b)>1e-6)throw Error('Vertical triangle index disagrees with THREE.Mesh.raycast: '+a+' / '+b);verified=revision;}
  };
 });
}
