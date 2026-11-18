// Uses production visibility/LOD selection, real controller contacts and THREE intersections, not terrain samplers.
export async function wheelRays(read){
 return read(`(async()=>{
  const THREE=await import('/node_modules/three/build/three.module.js'),{c,t,s}= {c:ft.c,t:ft.terrain,s:ft.s},oldMax=t.maxLevel;
  const poses=[];
  for(const u of [-4,12])for(const v of [-20,-12,-4,4,8,9.5,12,20])poses.push([u,v,Math.PI]);
  for(const v of [-26,-18,10,24,66,74])for(const u of [-4,0,7,13])poses.push([u,v,Math.PI]);
  for(const v of [10,64])for(const h of [0,Math.PI/2])poses.push([1,v,h]);
  const ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0)),rows=[];
  try{
   for(let level=0;level<=oldMax;level++){
    t.maxLevel=level;ft.camera.position.set(s.x+5,130,s.z+22);ft.camera.lookAt(s.x+5,0,s.z+22);ft.camera.updateMatrixWorld();
    for(let n=0;n<4;n++){t.update(ft.camera);mmm.trees?.update(t.drawnFine,ft.camera.position);}
    t.group.updateMatrixWorld(true);const meshes=[...t.tiles.values()].filter(a=>a.mesh?.visible).map(a=>a.mesh);
    let min=Infinity,max=-Infinity,count=0,wet=0,worst=null;
    for(const [u,v,h]of poses){
     ft.place(u,v,h);ft.stop(40);
     for(const p of c.groundContacts){
      const u=p.x-s.x,v=p.z-s.z;if(u>=2&&u<=12&&v>=10&&v<=64)continue;
      ray.ray.origin.set(p.x,1000,p.z);
      const hits=ray.intersectObjects(meshes,false).filter(hit=>{const a=hit.object,uv=hit.uv,q=(uv.x>=.5?1:0)|(uv.y>=.5?2:0),hide=a.material.uniforms.hideQuad?.value;return !hide||hide.getComponent(q)<.5;});
      const hit=hits[0];if(!hit)throw Error('No drawn triangle at '+JSON.stringify({level,u,v}));
      if(hit.point.y<-.2){wet++;continue;}
      const gap=p.height-hit.point.y;count++;min=Math.min(min,gap);if(gap>max){max=gap;worst={u,v,physical:p.height,drawn:hit.point.y};}
     }
    }
    rows.push({level,min,max,count,wet,worst});
   }
  }finally{t.maxLevel=oldMax;t.update(ft.camera);mmm.trees?.update(t.drawnFine,ft.camera.position);}
  return rows;
 })()`);
}
