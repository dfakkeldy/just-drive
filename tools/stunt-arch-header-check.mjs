import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {PlacedDressing,startArch} from '../web/src/stunt-dressing.ts';
import {archHeader} from './stunt-arch-header.mjs';
import {HARD_ARCH_RISE} from '../web/src/stunt-test-park.ts';
const terrain={surfaceAt:()=>({level:8}),drawnLevelAt:()=>8,meshHeightAt:()=>0};
assert.ok(HARD_ARCH_RISE>=5.8&&HARD_ARCH_RISE<=8.6,'hard frame stays inside its approved height cap');
let cases=0,mutants=0;
function check(group,solid,observation=archHeader(THREE,group)){
  assert.ok(Math.abs(observation.lower-solid.bottom)<1e-4,'clearance must read the drawn lower edge, not the top');
  assert.equal(observation.closed,true,'steel header must have a closed lower face');
  assert.ok(Math.abs(observation.ray-observation.lower)<1e-4,'underside ray meets the lower drawn edge');
  return observation;
}
for(const rise of new Set([5.8,HARD_ARCH_RISE]))for(const low of[false,true])for(const heading of[0,Math.PI/2,-.751]){
  const placed=new PlacedDressing({piece:startArch('TEST PARK',rise),x:-33,z:19,heading});
  assert.ok(placed.build(terrain,low,new THREE.MeshLambertMaterial({side:THREE.DoubleSide}),null,null));
  const solid=placed.solids.find(s=>s.half===.055&&s.halfWidth>4),sample=check(placed.group,solid);cases++;
  const mutant=placed.group.clone(true);let removed=0;
  mutant.traverse(o=>{
    if(!o.isMesh)return;o.geometry=o.geometry.clone();const g=o.geometry,p=g.attributes.position,index=g.index,n=index?.count??p.count,keep=[];
    for(let i=0;i<n;i+=3){
      const ids=[0,1,2].map(k=>index?index.getX(i+k):i+k);
      const bottom=ids.some(j=>p.getY(j)<solid.bottom+.055)&&ids.every(j=>Math.abs(p.getX(j)-.35)<.10&&p.getY(j)<solid.bottom+.12);
      if(bottom)removed++;else keep.push(...ids);
    }
    g.setIndex(keep);
  });
  assert.ok(removed>0,'open-bottom mutant removes the lower steel faces');
  assert.throws(()=>check(mutant,solid),{name:'AssertionError',message:/closed lower face|read the drawn lower edge/});mutants++;
  assert.throws(()=>check(placed.group,solid,{...sample,lower:sample.upper,ray:sample.upper}),/lower edge, not the top/);mutants++;
  mutant.traverse(o=>{if(o.isMesh)o.geometry.dispose();});
}
console.log('PASS drawn steel lower edge, closed underside and rejected open-bottom/top-read mutants',{cases,mutants});
