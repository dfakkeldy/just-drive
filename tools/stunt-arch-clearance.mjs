// Actual drawn bodies across the one-metre slab enclosing both steel rails.
// Skinning and every mesh instance keep their production transforms.
export function archClearance(THREE,group,floor,lower){
 group.updateMatrixWorld(true);
 const inverse=new THREE.Matrix4().copy(group.matrixWorld).invert(),matrix=new THREE.Matrix4(),base=new THREE.Matrix4(),instance=new THREE.Matrix4();
 const right=new THREE.Vector3(0,0,1).transformDirection(group.matrixWorld),centre=new THREE.Vector3().applyMatrix4(group.matrixWorld),ray=new THREE.Raycaster();
 let left=Infinity,rightEdge=Infinity;
 // Sweep the actual feet-to-header range; one foot can sit above the lane centre.
 const feetBottom=new THREE.Box3().setFromObject(group).min.y;
 for(let y=Math.min(floor-.5,feetBottom+.01);y<lower-.001;y+=.025)for(const sign of[-1,1]){
  ray.set(new THREE.Vector3(centre.x,y,centre.z),right.clone().multiplyScalar(sign));ray.far=6;
  const hit=ray.intersectObject(group,true)[0];if(hit){if(sign<0)left=Math.min(left,hit.distance);else rightEdge=Math.min(rightEdge,hit.distance);}
 }
 if(!Number.isFinite(left)||!Number.isFinite(rightEdge))throw Error('actual arch base opening was not measured');
 const shown=o=>{for(let p=o;p;p=p.parent)if(!p.visible)return false;return true;};
 return {left,rightEdge,lower,measure(roots){
  let rear=Infinity,side=Infinity,truckRoof=Infinity,trailerRoof=Infinity,samples=0;
  for(const {root,truck}of roots){root.updateMatrixWorld(true);root.traverse(o=>{
   if(!o.isMesh||!shown(o))return;base.multiplyMatrices(inverse,o.matrixWorld);
   if(o.isSkinnedMesh)o.computeBoundingBox();else if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();
   const bounds=o.isSkinnedMesh?o.boundingBox:o.geometry.boundingBox;
   for(let at=0;at<(o.isInstancedMesh?o.count:1);at++){
    matrix.copy(base);if(o.isInstancedMesh){o.getMatrixAt(at,instance);matrix.multiply(instance);}
    const box=bounds.clone().applyMatrix4(matrix);if(!truck)rear=Math.min(rear,box.min.x);
    if(box.min.x>.5||box.max.x<-.5)continue;
    const attr=o.geometry.attributes.position,index=o.geometry.index,n=index?.count??attr.count,p=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];
    const take=q=>{side=Math.min(side,left+q.z,rightEdge-q.z);if(truck)truckRoof=Math.min(truckRoof,lower-q.y);else trailerRoof=Math.min(trailerRoof,lower-q.y);samples++;};
    for(let i=0;i<n;i+=3){
     for(let k=0;k<3;k++)o.getVertexPosition(index?index.getX(i+k):i+k,p[k]).applyMatrix4(matrix);
     for(let k=0;k<3;k++){
      const a=p[k],b=p[(k+1)%3];if(Math.abs(a.x)<=.50000001)take(a);
      for(const plane of[-.5,.5])if((a.x-plane)*(b.x-plane)<0)take(a.clone().lerp(b,(plane-a.x)/(b.x-a.x)));
     }
    }
   }
  });}
  return{rear,side,truckRoof,trailerRoof,samples};
 }};
}
