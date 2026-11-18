// Cache every actual tyre vertex, including shoulders outside the nominal radius ring.
// The controller's parked-fit ring is not a substitute for the complete rendered contact geometry.
export function wheelVertices(THREE,rig,wheel){
 const inverse=wheel.matrixWorld.clone().invert(),point=new THREE.Vector3(),vertices=[],seen=new Set(),meshes=[];
 const read=(mesh,bone=-1)=>{const p=mesh.geometry.attributes.position,skin=mesh.geometry.attributes.skinIndex;for(let i=0;i<p.count;i++){if(bone>=0&&skin.getX(i)!==bone)continue;mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);const key=point.toArray().map(v=>v.toFixed(6)).join(',');if(!seen.has(key)){seen.add(key);vertices.push(point.clone())}}};
 if(rig.bikeMesh){rig.bikeMesh.skeleton.update();read(rig.bikeMesh,rig.bikeMesh.skeleton.bones.indexOf(wheel));}
 else {wheel.traverse(n=>{if(n.isMesh)meshes.push(n)});const rubber=meshes.filter(n=>/rubber|tyre/i.test(n.material.name));for(const mesh of rubber.length?rubber:meshes)read(mesh);}
 if(!vertices.length)throw Error('Missing rendered tyre vertices');return vertices;
}
