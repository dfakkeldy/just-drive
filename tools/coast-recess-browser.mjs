// Independent rays on drawn triangles. Colour acceptance renders the real scene in coast-scene-browser.mjs.
export const recessProbe = String.raw`(async()=>{
 const T=ct.THREE,t=ct.t;
 const {RECESSES}=await import('/src/coast-site.ts');
 const source=[...t.tiles.values()].find(q=>q.mesh?.visible&&q.mesh.material.uniforms.coastRecessAnchor)?.mesh.material;
 const anchors=source.uniforms.coastRecessAnchor.value,ray=new T.Raycaster();
 t.group.updateMatrixWorld(true);
 const hitAt=(x,z)=>{
  // visible=true alone is insufficient: a parent can draw only its other quadrants.
  const meshes=[...t.tiles.values()].filter(q=>{
   if(!q.mesh?.visible||x<q.x0||x>q.x0+q.size||z<q.z0||z>q.z0+q.size)return false;
   const quarter=(x>=q.x0+q.size/2?1:0)+(z>=q.z0+q.size/2?2:0);
   return q.mesh.material.uniforms.hideQuad.value.getComponent(quarter)<.5;
  });
  ray.set(new T.Vector3(x,2000,z),new T.Vector3(0,-1,0));
  let hit=null;
  for(const q of meshes){
   // Ray the actual indexed cell (as in the full tree audit), not every triangle in the tile.
   const mesh=q.mesh,g=mesh.geometry,seg=Math.round(Math.sqrt(g.attributes.position.count))-3,n=seg+3;
   const ca=Math.max(0,Math.min(seg-1,Math.floor((x-q.x0)*seg/q.size))),cb=Math.max(0,Math.min(seg-1,Math.floor((z-q.z0)*seg/q.size))),old={...g.drawRange};
   g.setDrawRange(((cb+1)*(n-1)+ca+1)*6,6);const candidate=ray.intersectObject(mesh,false)[0];g.setDrawRange(old.start,old.count);
   if(candidate&&(!hit||candidate.distance<hit.distance))hit=candidate;
  }
  if(!hit)return null;
  const g=hit.object.geometry,p=g.attributes.position,f=hit.face;
  const a=new T.Vector3().fromBufferAttribute(p,f.a),b=new T.Vector3().fromBufferAttribute(p,f.b),c=new T.Vector3().fromBufferAttribute(p,f.c);
  const bary=T.Triangle.getBarycoord(hit.point,a,b,c,new T.Vector3()),mask=new T.Vector4(0,0,0,0);
  for(const [index,w] of [[f.a,bary.x],[f.b,bary.y],[f.c,bary.z]])mask.addScaledVector(new T.Vector4().fromBufferAttribute(g.attributes.coast,index),w);
  return {x,z,y:hit.point.y,normal:hit.face.normal.toArray(),mask:mask.toArray(),bary:bary.toArray()};
 };
 ct.hitAt=hitAt;ct.recessMetadata=RECESSES;
 return {rows:RECESSES.map((p,i)=>{const ray=hitAt(p.e-t.manifest.village[0],t.manifest.village[1]-p.n);return {i,e:p.e,n:p.n,ray,authoredHeight:anchors[i*4+2],expectedY:t.seaLevel+(anchors[i*4+2]-t.seaLevel)*t.exag}})};
})()`;
