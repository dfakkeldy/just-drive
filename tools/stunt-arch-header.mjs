// Measure the real steel underside. The visual fabric banner carries no collision.
export function archHeader(THREE,group){
  group.updateMatrixWorld(true);
  const inverse=new THREE.Matrix4().copy(group.matrixWorld).invert(),matrix=new THREE.Matrix4();
  const u=.35;let lower=Infinity,upper=-Infinity;
  const take=p=>{if(Math.abs(p.x-u)<.10){lower=Math.min(lower,p.y);upper=Math.max(upper,p.y);}};
  group.traverse(o=>{
    if(!o.isMesh||o.name==='park banner')return;matrix.multiplyMatrices(inverse,o.matrixWorld);
    const pos=o.geometry.attributes.position,index=o.geometry.index,n=index?.count??pos.count;
    const p=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];
    for(let i=0;i<n;i+=3){
      for(let k=0;k<3;k++)o.getVertexPosition(index?index.getX(i+k):i+k,p[k]).applyMatrix4(matrix);
      for(let k=0;k<3;k++){
        const a=p[k],b=p[(k+1)%3];
        if(Math.abs(a.z)<1e-8)take(a);
        if(a.z*b.z<0)take(a.clone().lerp(b,-a.z/(b.z-a.z)));
      }
    }
  });
  if(!Number.isFinite(lower)||!Number.isFinite(upper))throw Error('drawn steel header edge missing');
  const origin=new THREE.Vector3(u,lower-1,0).applyMatrix4(group.matrixWorld),up=new THREE.Vector3(0,1,0).transformDirection(group.matrixWorld);
  const hit=new THREE.Raycaster(origin,up,0,4).intersectObject(group,true)[0];
  const ray=hit?hit.point.clone().applyMatrix4(inverse).y:null;
  return{lower,upper,ray,closed:ray!==null&&Math.abs(ray-lower)<1e-4};
}
