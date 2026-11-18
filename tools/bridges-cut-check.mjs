// Exact shader footprint, shared atlas lifetime and bounded scheduler regression controls.
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixture,areas,dispose,root,atlasRaster} from './bridges-fixture.mjs';
const read=p=>readFileSync(root+p,'utf8'),results=[];
const mesh=()=>new THREE.Mesh(new THREE.BufferGeometry(),new THREE.ShaderMaterial({uniforms:{tRoadCut:{value:null},roadCutRect:{value:new THREE.Vector4()},roadCutLayout:{value:new THREE.Vector4()},roadCuts:{value:0}}}));
const tile=()=>({x0:0,z0:0,size:256,roadCutRevision:-1,mesh:mesh()});
const predicate=f=>Function('u','v','return '+f.TERRAIN_FRAG.match(/if\((u>=[^\n]*?)\)lowest/)[1]);
async function contracts(replacements={}){
 const f=await fixture('mabou',1,replacements),small=new Float32Array([0,2,0,1,2,0,0,2,1,3,2,0,4,2,0,4,2,1]);let revision=1;
 const source={roadCutRevision:()=>revision,roadCutTriangles:()=>[small]},rc=new f.RoadCuts([source],new THREE.Texture()),a=tile(),b=tile();rc.update(a);rc.update(b);while(rc.pending)rc.step();
 const plain=new f.RoadCuts([],new THREE.Texture()),noCut=tile();plain.update(noCut);assert.equal(noCut.mesh.material.uniforms.tRoadCut.value,null,'plain land allocates no placeholder cut texture');plain.dispose();
 assert.ok(a.mesh.material.uniforms.tRoadCut.value===b.mesh.material.uniforms.tRoadCut.value,'tiles share a cut atlas');
 const raster=atlasRaster(a,rc.raster(a)),contains=predicate(f);for(const[x,z]of[[.75,.75],[1.5,.25],[2.5,.25]])assert.equal(f.cutRasterHeight(raster,x,z,contains),null,'exact shader footprint must not open land outside a skin');
 assert.equal(f.cutRasterHeight(raster,.2,.2,contains),2,'real interior is covered');
 const texture=a.mesh.material.uniforms.tRoadCut.value;let disposed=0;texture.addEventListener('dispose',()=>disposed++);rc.release(b);assert.equal(disposed,0,'tile eviction must not dispose the shared atlas');
 revision++;rc.update(a);assert.equal(a.mesh.material.uniforms.roadCuts.value,0,'stale cuts disable immediately before a changed footprint');while(rc.pending)rc.step();rc.dispose();assert.equal(disposed,1,'atlas owner disposes once');
 const plane=[];for(let z=0;z<128;z++)for(let x=0;x<128;x++)plane.push(x,2,z,x+1,2,z,x,2,z+1,x+1,2,z,x+1,2,z+1,x,2,z+1);
 const heavy=new f.RoadCuts([{roadCutRevision:()=>1,roadCutTriangles:()=>[new Float32Array(plane)]}],new THREE.Texture()),t=tile(),old=globalThis.performance;let clock=0;
 Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>clock+=.02}});
 try{heavy.update(t);let frames=0;while(heavy.pending){heavy.step();assert.ok(++frames<1000);}assert.ok(heavy.audit.maxFrameMs<8,'scheduler keeps each main-thread raster slice below 8ms under a controlled clock');}finally{Object.defineProperty(globalThis,'performance',{configurable:true,value:old});heavy.dispose();}
 dispose(f);console.log('PASS shared atlas, exact shader footprint, stale invalidation and bounded scheduler');
}
function raw(t,x,z){const p=t.mesh.geometry.getAttribute('position'),n=Math.round(Math.sqrt(p.count)),seg=n-3,fx=(x-t.x0)*seg/t.size,fz=(z-t.z0)*seg/t.size,a=Math.min(Math.floor(fx),seg-1),b=Math.min(Math.floor(fz),seg-1),u=fx-a,v=fz-b,i=(b+1)*n+a+1;return u+v<=1?p.getY(i)+(p.getY(i+1)-p.getY(i))*u+(p.getY(i+n)-p.getY(i))*v:p.getY(i+n+1)+(p.getY(i+n)-p.getY(i+n+1))*(1-u)+(p.getY(i+1)-p.getY(i+n+1))*(1-v);}
async function real(replacements={},list=areas){for(const area of list){const f=await fixture(area,1.5,replacements),M=f.roads.modern;assert.equal(f.terrain.sites.find(s=>s.deckMask)?.roadField,false,'bridge contact provider declares that it does not paint new road fields');await f.load(M.spans.flatMap(r=>r.pts));for(const r of M.spans)f.roads.update(new THREE.Vector3(r.pts[0][0],20,r.pts[0][1]));let tested=0,holes=0,blankFieldsAvoided=0;const contains=predicate(f);
 for(const t of f.terrain.tiles.values())if(t.ready&&t.mesh&&!f.terrain.hasRoad.has(`${t.level}/${t.i}_${t.j}`)){const sites=f.terrain.sites.filter(s=>!(s.box[2]<t.x0||s.box[0]>t.x0+t.size||s.box[3]<t.z0||s.box[1]>t.z0+t.size));if(sites.length&&sites.every(s=>s.roadField===false)){blankFieldsAvoided++;assert.ok(t.road===null,'bridge boxes must not allocate blank road fields');assert.ok(t.mesh.material.uniforms.tRoad.value===f.terrain.noRoad,'plain tiles share the no-road texture');}}
 assert.ok(blankFieldsAvoided>0,area+' tested blank bridge-box tiles');
 for(const r of M.spans)for(let s=-r.startLength+1;s<r.length+r.endLength;s++){const p=M.at(r,s),width=M.widthAt(r,s);for(let side=-width-4;side<=width+4;side+=.5){const x=p.x+p.nx*side,z=p.z+p.nz*side,t=f.terrain.find(x,z);if(!t?.mesh)continue;const index=atlasRaster(t,f.terrain.roadCuts.raster(t));if(!index)continue;tested++;const h=f.cutRasterHeight(index,x,z,contains);if(h!==null&&raw(t,x,z)>h-.035&&f.roads.deckHeight(x,z)===null)holes++;}}
 assert.equal(holes,0,area+' shader must not cut outside every actual road skin');const row={area,tested,holes,blankFieldsAvoided,atlases:f.terrain.roadCuts.audit.atlases,atlasBytes:f.terrain.roadCuts.audit.bytes};results.push(row);console.log('PASS S2 '+JSON.stringify(row));dispose(f);
 }}
// Real six-area fixtures run in separate processes. Node caches imported bundles;
// retaining all six plus source variants in one process needlessly exhausts this Mac.
const realMutants=[
 ['web/src/terrain.ts',"sites.some(s=>s.roadField!==false&&s.roadField!=='painted')",'sites.length','bridge boxes must not allocate blank road fields'],
 ['web/src/modern-bridges.ts','roadField:false,','', 'bridge contact provider declares']];
if(process.env.BRIDGE_CUT_AREA){
 try{const replacements={},index=process.env.BRIDGE_CUT_MUTANT;
  if(index!==undefined){const[file,from,to]=realMutants[Number(index)],source=read(file);assert.equal(source.split(from).length,2);replacements[file]=source.replace(from,to);}
  await real(replacements,[process.env.BRIDGE_CUT_AREA]);
 }catch(error){console.error(error.name+': '+error.message);process.exitCode=1;}
}else{
 await contracts();
 const child=(area,mutant)=>spawnSync(process.execPath,[fileURLToPath(import.meta.url)],{env:{...process.env,BRIDGE_CUT_AREA:area,...(mutant===undefined?{}:{BRIDGE_CUT_MUTANT:String(mutant)})},encoding:'utf8',timeout:180000,maxBuffer:1024*1024});
 for(const area of areas){const result=child(area);assert.equal(result.status,0,area+' real-cut fixture: '+result.stderr);process.stdout.write(result.stdout);for(const line of result.stdout.split('\n'))if(line.startsWith('PASS S2 '))results.push(JSON.parse(line.slice(8)));}
 if(process.argv.includes('--mutations')){
  for(let i=0;i<realMutants.length;i++){const result=child('mabou',i),label=realMutants[i][3];assert.equal(result.status,1,'source negative must fail normally: '+result.signal+' '+result.error+' '+result.stderr);assert.match(result.stderr,new RegExp(label));console.log('KILLED '+label);}
  for(const[file,from,to,label]of[
   ['web/src/shaders.ts','u>=0.0&&v>=0.0&&u+v<=1.0','u>=-1000.0&&v>=-1000.0&&u+v<=1000.0','exact shader footprint'],
   ['web/src/road-cuts.ts','for(const atlas of this.atlases){','for(const atlas of []){','tiles share a cut atlas'],
   ['web/src/road-cuts.ts','u.tRoadCut.value=this.atlases[0]?.texture??null;','u.tRoadCut.value=this.atlases[0]?.texture??new THREE.DataArrayTexture(new Float32Array(4),1,1,1);','plain land allocates no placeholder'],
   ['web/src/road-cuts.ts','while(performance.now()-start<budgetMs){','while(true){','scheduler keeps each'],
   ['web/src/road-cuts.ts','(t.mesh.material as THREE.ShaderMaterial).uniforms.roadCuts.value=0;this.queue.set(t,e);','this.queue.set(t,e);', 'stale cuts disable']]){
    const source=read(file);assert.equal(source.split(from).length,2);await assert.rejects(()=>contracts({[file]:source.replace(from,to)}),new RegExp(label));console.log('KILLED '+label);
  }
 }
 if(process.env.OUT)writeFileSync(process.env.OUT+'/r3-cut-results.json',JSON.stringify(results,null,2)+'\n');
}
