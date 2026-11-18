// Exact default coast buffers/material programs against current main, at every requested hill height.
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {Coast} from '../web/src/coast.ts';
import {CoastSite} from '../web/src/coast-site.ts';
import {mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.cwd(),work=mkdtempSync(join(tmpdir(),'quarry-coast-parity-'));
const {build}=await import(root+'/web/node_modules/esbuild/lib/main.js'),{preprocess,normalized}=await import(root+'/tools/coast-programs.mjs');
try{
 const file=join(work,'base.mjs');await build({stdin:{contents:"export {Coast} from './web/src/coast.ts';export {CoastSite} from './web/src/coast-site.ts';",resolveDir:root},bundle:true,platform:'node',format:'esm',outfile:file,logLevel:'silent',plugins:[{name:'reviewed-coast',setup(b){b.onLoad({filter:/web\/src\/coast(?:-site|-block-shaders)?\.ts$/},a=>({contents:execFileSync('git',['show','origin/main:'+a.path.slice(root.length+1)],{encoding:'utf8'}),loader:'ts',resolveDir:a.path.slice(0,a.path.lastIndexOf('/'))}));}}]});
 const baseline=await import(pathToFileURL(file)),village=[624230,5103300],camera=new THREE.Vector3(618700-village[0],20,village[1]-5109300);
 const same=(a,b)=>{for(const key of ['position','normal','coastFoot'])assert.deepEqual([...a.mesh.geometry.attributes[key].array],[...b.mesh.geometry.attributes[key].array],key+' bytes');assert.deepEqual([...a.mesh.instanceMatrix.array],[...b.mesh.instanceMatrix.array],'instance matrices');assert.deepEqual(a.blocks,b.blocks,'candidate/height/burial records');assert.deepEqual(a.mesh.material.defines,b.mesh.material.defines);for(const shader of ['vertexShader','fragmentShader'])assert.equal(normalized(preprocess(a.mesh.material[shader],Object.keys(a.mesh.material.defines))),normalized(preprocess(b.mesh.material[shader],Object.keys(b.mesh.material.defines))),shader+' compiled bytes');assert.equal(a.mesh.material.uniforms.coastExag.value,b.mesh.material.uniforms.coastExag.value);};
 for(const exag of [1,1.5,2,2.5])for(const low of [false,true]){
  const terrain={exag,low,uniforms:{seaLevel:{value:-.2}},drawnRevision:1,meshHeightAt:()=>2*exag,fitCoastRecesses(){}};
  const now=new Coast(new CoastSite(village),terrain,low),old=new baseline.Coast(new baseline.CoastSite(village),terrain,low);now.update(camera);old.update(camera);same(now,old);
  if(exag===1&&!low){const pos=now.mesh.geometry.attributes.position,x=pos.getX(0);pos.setX(0,x+.5);assert.throws(()=>same(now,old));pos.setX(0,x);same(now,old);console.log('REJECTED changed default coast block vertex');}
  console.log('PASS exact coast geometry, instances and compiled materials: hill',exag,low?'LOW':'desktop');
 }
}finally{rmSync(work,{recursive:true,force:true});}
