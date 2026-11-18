#!/usr/bin/env node
// RUN=truck-check.mjs VIEWS='truck|vehicle=truck' tools/yard-shots.sh 1600 1000
// Opens the isolated model viewer on that server; game terrain is not needed for these contracts.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { open } from './truck-cdp.mjs';
import { inspectTruck } from './truck-geometry.mjs';
const [out,first]=process.argv.slice(2),origin=new URL(first).origin;
const p=await open(`${origin}/truck.html?view=front`);
try {
  await p.read(`window.inspectTruck=${inspectTruck.toString()}; window.requestAnimationFrame=()=>0; for(const w of [...Object.values(truckPreview.car.wheels),...truckPreview.car.extraWheels])w.rotation.x=0;`);
  const stats=await p.read(`(()=>{const {car,renderer,scene,camera}=truckPreview;const s=inspectTruck(car);const hidden=scene.children.filter(n=>n!==car.root&&!n.isLight).map(n=>[n,n.visible]);hidden.forEach(([n])=>n.visible=false);car.root.traverse(n=>n.frustumCulled=false);renderer.render(scene,camera);s.drawCalls=renderer.info.render.calls;hidden.forEach(([n,v])=>n.visible=v);return s;})()`);
  const checks={
    budget:s=>s.triangles<=60000&&s.materials<=12&&s.drawCalls<=30,
    sound:s=>s.finite&&s.normals&&s.flat===0&&s.reversed===0&&s.twisted===0,
    dimensions:s=>s.dimensions[0]>2.4&&s.dimensions[0]<2.85&&s.dimensions[1]>2&&s.dimensions[1]<2.15&&s.dimensions[2]>6.6&&s.dimensions[2]<7&&Math.abs(s.bounds.min[1])<.001,
    pivots:s=>s.contracts&&s.pivots.every((p,i)=>JSON.stringify(p.spin)==='[0,0.43,0]'&&!p.underBody&&p.axle[2]===(i<2?-2.225:2.225)&&p.axle[0]===[-.87,.87,-1.04,1.04,-.70,.70][i]),
    tread:s=>s.shoulderSamples>100&&s.inwardShoulders===0,
    eye:s=>JSON.stringify(s.eye)==='[-0.52,1.72,-0.64]',
  };
  for(const [label,test]of Object.entries(checks))assert.ok(test(stats),`${label}: ${JSON.stringify(stats)}`);
  // Real rig mutations, always restored, demonstrate each model assertion rejects the fault it claims to detect.
  const mutants={
    budget:`const clone=c.body.children.find(n=>n.isMesh).clone(); c.body.add(clone); clone.geometry=clone.geometry.clone();const old=clone.geometry;clone.geometry=old.clone();const n=old.attributes.position.count;clone.geometry.setDrawRange(0,n);for(let i=0;i<50;i++)c.body.add(clone.clone());`,
    sound:`const g=c.body.children.find(n=>n.isMesh).geometry;g.attributes.position.setXYZ(0,NaN,0,0);`,
    dimensions:`c.root.scale.y=1.3;`,
    pivots:`c.wheels.fl.position.y=.2;`,
    tread:`const n=c.wheels.fl.children.find(n=>n.isMesh&&n.material.name==='All-terrain rubber and liner').geometry.attributes.normal;for(let i=0;i<n.array.length;i++)n.array[i]*=-1;`,
    eye:`c.driverEye.position.x=.52;`,
  };
  for(const [label,mutation]of Object.entries(mutants)){
    const s=await p.read(`(async()=>{const {createTruck}=await import('/src/truck.ts');const c=createTruck();${mutation}return inspectTruck(c);})()`);
    assert.ok(!checks[label]({...s,drawCalls:s.calls+1}),`mutation rejected: ${label}`);console.log('MUTATION rejected',label);
  }
  // The two easy-to-miss extrusion faults are separate mutations, judged by shared edges and face normals.
  for(const [label,mutation]of [
    ['mirror winding',`const g=c.body.children.find(n=>n.isMesh&&n.material.name==='Black enamel').geometry;g.scale(-1,1,1);`],
    ['hole wall winding',`const g=c.body.children.find(n=>n.isMesh&&n.material.name==='Black enamel').geometry,p=g.attributes.position,n=g.attributes.normal;for(let i=0;i<p.count;i+=3){if(p.getY(i)>1.35&&p.getY(i)<1.95&&Math.abs(n.getX(i))<.5){for(const a of Object.values(g.attributes)){for(let k=0;k<a.itemSize;k++){const t=a.array[i*a.itemSize+k];a.array[i*a.itemSize+k]=a.array[(i+2)*a.itemSize+k];a.array[(i+2)*a.itemSize+k]=t;}}}}`],
  ]){
    const s=await p.read(`(async()=>{const {createTruck}=await import('/src/truck.ts');const c=createTruck();${mutation}return inspectTruck(c);})()`);assert.ok(!checks.sound(s),`mutation rejected: ${label}`);console.log('MUTATION rejected',label);
  }
  writeFileSync(`${out}/truck-model-v2.json`,JSON.stringify(stats,null,2)+'\n');
  console.log('PASS truck model',JSON.stringify(stats));
}finally{await p.close();}

if(process.env.TRUCK_PICTURES === '1') await import('./truck-pictures.mjs');
if(process.env.TRUCK_PICTURES === '2') await import('./truck-art-shots.mjs');
