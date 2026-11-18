// node tools/run-node-check.mjs tools/lighthouses-check.mjs --mutations
import assert from 'node:assert/strict';
import { readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import * as production from '../web/src/harbour-lights.ts';
import { LIGHTS } from '../web/src/harbour-lights-data.ts';
import { bakedHeight } from './lighthouses-ground.mjs';
const sources=JSON.parse(readFileSync('web/src/harbour-light-sources.json'));
function verify(api){
 assert.ok(LIGHTS.length>=8);
 for(const area of new Set(LIGHTS.flatMap(r=>r.areas)))for(const [exag,seaLevel] of [[1,-.2],[2,-1]]){
  const model=new api.HarbourLights(area,[600000,5000000],exag,true,seaLevel),day=new api.HarbourLights(area,[600000,5000000],exag,false,seaLevel);
  assert.equal(day.group.getObjectByName('harbour beacons'),undefined,'day off');
  assert.ok(model.group.children.every(c=>c.isInstancedMesh),'instanced only');
  const beacon=model.group.getObjectByName('harbour beacons');assert.ok(beacon);
  for(const stage of ['vertex','fragment'])for(const prefix of ['logdepthbuf_pars_','logdepthbuf_'])assert.ok(beacon.material[stage+'Shader'].includes('#include <'+prefix+stage+'>'),'log depth');
  assert.ok(beacon.material.fragmentShader.includes('if(timing.x>0.&&mod(seconds,timing.x)>=timing.y)discard;'),'production cycle expression');
  const matrix=new THREE.Matrix4(),pos=new THREE.Vector3(),sc=new THREE.Vector3(),rot=new THREE.Quaternion();
  const records=LIGHTS.filter(r=>r.areas.includes(area)),bases=new Map();
  model.group.updateMatrixWorld(true);
  for(const mesh of model.group.children){
   mesh.geometry.computeBoundingBox();
   for(let i=0;i<mesh.count;i++){
    mesh.getMatrixAt(i,matrix);matrix.decompose(pos,rot,sc);
    const source=records.toSorted((a,b)=>Math.hypot(a.e-600000-pos.x,a.n-5000000+pos.z)-Math.hypot(b.e-600000-pos.x,b.n-5000000+pos.z))[0];
    assert.ok(Math.hypot(source.e-600000-pos.x,source.n-5000000+pos.z)<3.5,'drawn instance position');
    const bottom=mesh.geometry.boundingBox.clone().applyMatrix4(matrix).min.y;bases.set(source.number,Math.min(bases.get(source.number)??Infinity,bottom));
   }
  }
  for(const [i,r] of records.entries()){
   const source=sources.find(s=>s.number===r.number);assert.ok(source);
   assert.ok(Math.hypot(r.e-source.e,r.n-source.n)<3,'source position');
   assert.equal(r.height,source.towerHeight);assert.equal(r.colour,source.colour);assert.equal(r.character,source.character);
   assert.equal(r.period,source.period==='.....'?0:Number(source.period.slice(0,-1)));
   const ground=bakedHeight(area,r.e,r.n);assert.ok(ground.height>-.1,`land above sea ${r.number}`);
   assert.ok(Math.abs(bases.get(r.number)-(seaLevel+(ground.height-seaLevel)*exag))<.5,'drawn base matches land');
   beacon.getMatrixAt(i,matrix);pos.setFromMatrixPosition(matrix);
   assert.ok(Math.hypot(pos.x+600000-source.e,pos.z-5000000+source.n)<3,'beacon source position');
   // Four cardinal sight lines must reach the actual beacon, not an opaque lantern box.
   for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){
    const ray=new THREE.Raycaster(new THREE.Vector3(pos.x+dx*5,pos.y,pos.z+dz*5),new THREE.Vector3(-dx,0,-dz),0,6);
    assert.ok(ray.intersectObjects(model.group.children,false)[0]?.object===beacon,`beacon enclosed ${r.number} ${dx},${dz}: ${ray.intersectObjects(model.group.children,false).map(h=>h.object.name+"@"+h.distance.toFixed(3)).slice(0,3)}`);
   }
   assert.equal(api.beaconOn(r,0,false),false);assert.equal(api.beaconOn(r,0,true),true);
   if(r.character!=='F')assert.equal(api.beaconOn(r,r.period-.01,true),false);
  }
 }
}
verify(production);
for(const r of LIGHTS){const v=new production.HarbourLights(r.areas[0],[r.e,r.n],2,true,-1).sites.find(s=>s.number===r.number);assert.equal(v.y,-1+(r.ground+1)*2);assert.equal(v.height,r.height);}

if(process.argv.includes('--mutations')){
 const {build}=await import('../web/node_modules/esbuild/lib/main.js');const dir=mkdtempSync(join(tmpdir(),'mmm-lights-'));
 try{for(const [name,from,to]of [
  ['drawn east shift','new THREE.Vector3(x, y, z)','new THREE.Vector3(x + 20, y, z)'],
  ['north sign','z: village[1] - r.n','z: village[1] + r.n'],
  ['base floats','y: seaLevel + (r.ground - seaLevel) * exag','y: 20 + (r.ground - seaLevel) * exag'],
  ['day gate','if (!records.length || !night) return;','if (!records.length) return;'],
  ['exaggeration removed','y: seaLevel + (r.ground - seaLevel) * exag','y: seaLevel + (r.ground - seaLevel)'],
  ['beacon shift','makeTranslation(s.x,','makeTranslation(s.x + 20,'],
  ['opaque lantern','// Open lantern:',"add('box', box, x, y + h * .87, z, width, h * .15, width, dark); // Open lantern:"],
  ['depth removed','#include <logdepthbuf_pars_vertex>',''],
  ['period removed','if(timing.x>0.&&mod(seconds,timing.x)>=timing.y)discard;','']
 ]){
  const source=readFileSync('web/src/harbour-lights.ts','utf8');assert.ok(source.includes(from),name);
  const file=join(dir,name.replaceAll(' ','-')+'.mjs');await build({stdin:{contents:source.replace(from,to),resolveDir:process.cwd()+'/web/src',loader:'ts'},bundle:true,format:'esm',platform:'node',outfile:file,external:['three']});
  // Resolve three from the project without duplicating its class identity.
  const {writeFileSync}=await import('node:fs');writeFileSync(file,readFileSync(file,'utf8').replaceAll('from "three"','from '+JSON.stringify(pathToFileURL(process.cwd()+'/web/node_modules/three/build/three.module.js').href)));
  const api=await import(pathToFileURL(file));assert.throws(()=>verify(api),undefined,`survived ${name}`);console.log('KILLED',name);
 }}finally{rmSync(dir,{recursive:true,force:true});}
}
console.log('PASS harbour lights',LIGHTS.length);
