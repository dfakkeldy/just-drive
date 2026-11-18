import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {PlacedDressing,startArch} from '../web/src/stunt-dressing.ts';
import {archHeader} from './stunt-arch-header.mjs';
import {archClearance} from './stunt-arch-clearance.mjs';
const ground={surfaceAt:()=>({level:8}),drawnLevelAt:()=>8,meshHeightAt:()=>0};let cases=0;
for(const low of[false,true])for(const heading of[0,.75,-1.3]){
 const d=new PlacedDressing({piece:startArch(),x:23,z:-17,heading});assert.ok(d.build(ground,low,new THREE.MeshLambertMaterial({side:THREE.DoubleSide}),null,null));
 const lower=archHeader(THREE,d.group).lower,read=archClearance(THREE,d.group,0,lower),holder=new THREE.Group();holder.position.copy(d.group.position);holder.rotation.copy(d.group.rotation);
 const body=new THREE.Group(),cube=new THREE.Mesh(new THREE.BoxGeometry(4,2,2));cube.position.y=1;body.add(cube);holder.add(body);
 const roots=[{root:holder,truck:true},{root:holder,truck:false}],plain=read.measure(roots);
 assert.ok(Math.abs(plain.side-2.9)<1e-4);assert.ok(Math.abs(plain.truckRoof-(lower-2))<1e-4);assert.ok(Math.abs(plain.rear+2)<1e-4);
 body.rotation.z=.2;const pitched=read.measure(roots),expected=lower-(2/Math.cos(.2)+.5*Math.tan(.2));assert.ok(Math.abs(pitched.truckRoof-expected)<1e-4,'pitched full-slab bound follows the analytic box face');
 body.rotation.z=0;body.position.y=4;assert.ok(read.measure(roots).truckRoof<0,'raised physical body is rejected');
 body.position.y=0;cube.scale.z=4;assert.ok(read.measure(roots).side<.6,'wide physical body is rejected');cases++;
}
// Uneven real ground can put one foot well above the lane centre.
{
 const d=new PlacedDressing({piece:startArch(),x:0,z:0,heading:Math.PI/2});
 const slope={...ground,meshHeightAt:(x,z)=>z*.7};assert.ok(d.build(slope,false,new THREE.MeshLambertMaterial({side:THREE.DoubleSide}),null,null));
 const read=archClearance(THREE,d.group,0,archHeader(THREE,d.group).lower);
 assert.ok(Math.abs(read.left-3.9)<1e-4&&Math.abs(read.rightEdge-3.9)<1e-4,'actual feet define the conservative width on unequal ground');
}
// An instanced body at y+4/z+4 must affect both roof and side bounds.
{
 const d=new PlacedDressing({piece:startArch(),x:0,z:0,heading:0});d.build(ground,false,new THREE.MeshLambertMaterial({side:THREE.DoubleSide}),null,null);
 const lower=archHeader(THREE,d.group).lower,read=archClearance(THREE,d.group,0,lower),holder=new THREE.Group();holder.position.copy(d.group.position);holder.rotation.copy(d.group.rotation);
 const instanced=new THREE.InstancedMesh(new THREE.BoxGeometry(4,2,2).translate(0,1,0),new THREE.MeshBasicMaterial(),2);instanced.setMatrixAt(0,new THREE.Matrix4());instanced.setMatrixAt(1,new THREE.Matrix4().makeTranslation(0,4,4));holder.add(instanced);
 const result=read.measure([{root:holder,truck:true},{root:holder,truck:false}]);
 assert.ok(result.truckRoof<0&&result.side<0,'drawn instance transforms must affect roof and side bounds');
}
console.log('PASS analytic drawn body sections and roof/width negative controls',{cases});
