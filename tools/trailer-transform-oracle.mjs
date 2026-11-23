import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {createCar} from '../web/src/car.ts';
import {createTruck,TRUCK_SPEC} from '../web/src/truck.ts';
import {createSxs,SXS_SPEC} from '../web/src/sxs.ts';
import {CAR_SPEC} from '../web/src/vehicle-spec.ts';
import {Vehicle} from '../web/src/vehicle.ts';
import {wideDemo} from '../web/src/vehicle-demo.ts';
import {Towing} from '../web/src/towing.ts';
const rng=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
// Texture painting has no transform effect; production 3D car geometry remains intact in node.
function canvasDOM(){const old=globalThis.document;globalThis.document={createElement(){const canvas={width:0,height:0};const context=new Proxy({createLinearGradient:()=>({addColorStop(){}})},{get(o,k){return k in o?o[k]:()=>{};},set(o,k,v){o[k]=v;return true;}});canvas.getContext=()=>context;return canvas;}};return()=>{globalThis.document=old;};}
export async function transformOracle(terrain,roads,start){
 const{Vehicle:Stock,autopilot}=await import(process.env.TRAILER_TRUCK_ORACLE),restoreDOM=canvasDOM(),original=Math.random,steps=1200;
 try{
  // Warm deterministic shared material resources before either seeded build.
  createTruck();
  function run(Kind,build,spec,detached=false){Math.random=rng(913);const rig=build(),v=new Kind(rig,terrain,roads,-.2,spec);v.assist=0;v.place(start.x+Math.cos(start.heading)*1.8,start.z+Math.sin(start.heading)*1.8,start.heading);if(detached)new Towing(v,terrain,roads,true,false,{},false);const nodes=[];rig.root.traverse(n=>nodes.push(n));const wheelSet=new Set();for(const w of [...Object.values(rig.wheels),...(rig.extraWheels??[])])w.parent.traverse(n=>wheelSet.add(n));
   const corners=[];for(const w of [...Object.values(rig.wheels),...(rig.extraWheels??[])]){w.updateWorldMatrix(true,true);const inverse=w.matrixWorld.clone().invert(),box=new THREE.Box3().setFromObject(w,true),points=[];for(const x of[box.min.x,box.max.x])for(const y of[box.min.y,box.max.y])for(const z of[box.min.z,box.max.z])points.push(new THREE.Vector3(x,y,z).applyMatrix4(inverse));corners.push({index:nodes.indexOf(w),points});}
   const frames=[],states=[];for(let i=0;i<steps;i++){const hit=roads.nearest(v.x,v.z,40,r=>r.kind<=3);let heading=hit?.heading??v.heading;if(Math.cos(heading-v.heading)<0)heading+=Math.PI;terrain.withGroundContact(v,()=>v.update(1/120,hit?wideDemo(v,hit,heading,16):autopilot(v,roads,16)));rig.root.updateMatrixWorld(true);states.push([v.x,v.y,v.z,v.heading,v.vx,v.airborne?v.vy:0,v.vz,v.pitch,v.roll,v.airborne,v.steerAngle,v.speed]);const values=new Float64Array(nodes.length*32);nodes.forEach((n,j)=>{values.set(n.matrix.elements,j*32);values.set(n.matrixWorld.elements,j*32+16);});frames.push(values);}return{states,frames,mask:nodes.map(n=>wheelSet.has(n)),corners};}
  function compare(a,b,limit=steps){assert.deepEqual(a.states.slice(0,limit),b.states.slice(0,limit),'all driving-state components match');assert.equal(a.mask.length,b.mask.length);let displacement=0,maxFrame=0;const ma=new THREE.Matrix4(),mb=new THREE.Matrix4();for(let f=0;f<limit;f++){for(let i=0;i<a.frames[f].length;i++){assert.ok(Object.is(a.frames[f][i],b.frames[f][i]),`transform differs: frame ${f}, component ${i}`);}for(const w of a.corners){ma.fromArray(a.frames[f],w.index*32+16);mb.fromArray(b.frames[f],w.index*32+16);for(const p of w.points){const distance=p.clone().applyMatrix4(ma).distanceTo(p.clone().applyMatrix4(mb));if(distance>displacement){displacement=distance;maxFrame=f;}}}}assert.ok(displacement<.02,JSON.stringify({displacement,maxFrame,state:a.states[maxFrame]}));return{steps:limit,nodes:a.mask.length,maxTyreDisplacement:displacement};}
  function beforeFlight(stock,current){
   const takeoff=run=>run.states.findIndex(row=>row[9]);
   const limit=Math.min(steps,...[takeoff(stock),takeoff(current)].filter(i=>i>=0));
   assert.ok(limit>=100,'meaningful grounded transform comparison');
   return compare(stock,current,limit);
  }
  const sxsLive=run(Vehicle,createSxs,SXS_SPEC),truckLive=run(Vehicle,createTruck,TRUCK_SPEC);
  const result={
   car:beforeFlight(run(Stock,createCar,CAR_SPEC),run(Vehicle,createCar,CAR_SPEC)),
   sxs:beforeFlight(run(Stock,createSxs,SXS_SPEC),sxsLive),
   truck:beforeFlight(run(Stock,createTruck,TRUCK_SPEC),truckLive),
   sxsDetached:compare(sxsLive,run(Vehicle,createSxs,SXS_SPEC,true)),
   detached:compare(truckLive,run(Vehicle,createTruck,TRUCK_SPEC,true)),
  };
  console.log('MAIN STATE AND DRAWN TRANSFORMS',JSON.stringify(result));return result;
 }finally{restoreDOM();Math.random=original;}
}
