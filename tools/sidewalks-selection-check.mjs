// Shipped-cache regressions for arrival order and mixed terrain detail.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {build} from '../web/node_modules/esbuild/lib/main.js';
const root=process.cwd(),json=p=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
async function module(replacements={}){const built=await build({stdin:{contents:"export {Sidewalks,slabProbes} from './web/src/sidewalks.ts';export {Terrain} from './web/src/terrain.ts';export * from './web/src/sidewalks-worker.ts';",resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',alias:{three:resolve(root,'web/node_modules/three/build/three.module.js')},plugins:[{name:'selection-mutant',setup(b){for(const [file,contents]of Object.entries(replacements))b.onLoad({filter:new RegExp(file.replaceAll('.','\\.')+'$')},()=>({contents,loader:'ts'}));}}]});return import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));}
const M=await module();
const areas={};
for(const area of ['mabou','porthood','pointtupper'])areas[area]={data:JSON.parse(gunzipSync(Buffer.from(json(`web/src/sidewalks-packed-${area}.json`).payload,'base64'))),manifest:json(`data/baked/${area==='mabou'?'terrain':`areas/${area}`}/manifest.json`)};
function tile(manifest,key,height=30){
 const [l,xy]=key.split('/'),[i,j]=xy.split('_').map(Number),level=+l,size=manifest.size/2**level,x0=manifest.origin[0]+i*size-manifest.village[0],z0=manifest.village[1]-manifest.origin[1]+j*size,seg=level>=7?128:64,n=seg+3,positions=new Float32Array(n*n*3);
 for(let b=-1;b<=seg+1;b++)for(let a=-1;a<=seg+1;a++){const k=((b+1)*n+a+1)*3;positions[k]=x0+a*size/seg;positions[k+1]=height;positions[k+2]=z0+b*size/seg;}
 return {level,i,j,size,x0,z0,positions};
}
function worker(area,low=false,legacyMembers=false){
 const {data,manifest}=areas[area],c=structuredClone(data.compiled[low?1:0]),packets=[],scope={postMessage:p=>packets.push(p)},previous=globalThis.self;
 globalThis.self=scope;try{M.sidewalkHeightWorker(M.createSidewalkHeights);}finally{globalThis.self=previous;}
 scope.onmessage({data:{type:'init',points:c.points,topOwners:c.topOwners,topCount:c.topCount,coverage:c.coverage,manifest,bridges:[],jobs:c.jobs.map((j,i)=>({...j,road:data.plans[low?1:0].pieces[i]?.[3]}))}});
 return {packets,send(key,height=30){const record=data.terrain[key],members=(legacyMembers?record?.members:record?.heightMembers??record?.members)?.[low?1:0]??[[],[]];scope.onmessage({data:{type:'tile',tile:tile(manifest,key,height),members,pieceCount:data.plans[low?1:0].pieces.length,bridgeJobs:[]}});},cover(cells){scope.onmessage({data:{type:'coverage',cells}});}};
}
function emitted(packets,id){return packets.some(p=>{if(p.type!=='heights')return false;let at=0;for(let n=0;n<p.count;n++){const found=p.data[at++],g=p.data[at++],t=p.data[at++];if(found===id)return true;at+=2*(g+t);}return false;});}
function arrivalOrder(legacyMembers=false){const w=worker('porthood',false,legacyMembers);w.send('8/87_153');w.send('8/87_154');assert.ok(emitted(w.packets,196),'job196 must finish when its grass-strip neighbour arrives, without owner replay');}
function runtime(m=M,override,sparse=false){
 const {manifest}=areas.pointtupper,data=override??areas.pointtupper.data,t=Object.assign(Object.create(m.Terrain.prototype),{manifest,tiles:new Map(),frame:1,walkCoverageSerial:1,maxLevel:8,walkHeightAt:(level,x,z)=>{if(!sparse)return level===8?31:30;const size=manifest.size/2**level,key=`${level}/${Math.floor((x+manifest.village[0]-manifest.origin[0])/size)}_${Math.floor((z-(manifest.village[1]-manifest.origin[1]))/size)}`;return key==='8/143_197'?31:key==='7/72_98'?30:null;},meshHeightAt:()=>30,heightAt:()=>30,surfaceAt:()=>({level:8,ground:31}),dataRevision:1});
 const w=new m.Sidewalks(data,manifest.village,t,{roads:[],bridgeWalks:new Map()},false);
 const drain=()=>{let n=0;while(w.pending&&n++<100000)w.update();assert.equal(w.pending,0,'bounded queues drain');};
 for(const key of (sparse?['8/143_197','7/72_98']:Object.keys(data.terrain))){const [l,xy]=key.split('/'),[i,j]=xy.split('_').map(Number);t.tiles.set(key,{...tile(manifest,key),ready:true,mesh:{visible:false},walkCoverageSerial:0,walkCoveragePart:0});w.tileReady(+l,i,j);}drain();
 const selected=new Map();
 const select=(level,i,j,part=0)=>{const key=`${level}/${i}_${j}`,next=t.tiles.get(key);assert.ok(next);
  for(const [oldKey,old]of selected)if(old.level>level&&old.x0>=next.x0&&old.x0+old.size<=next.x0+next.size&&old.z0>=next.z0&&old.z0+old.size<=next.z0+next.size&&(!part||(part&(1<<((old.x0+old.size/2>=next.x0+next.size/2?1:0)+(old.z0+old.size/2>=next.z0+next.size/2?2:0))))))selected.delete(oldKey);
  selected.set(key,next);t.frame++;t.walkCoverageSerial++;for(const value of t.tiles.values())value.walkCoverageSerial=0;for(const value of selected.values()){value.walkCoverageSerial=t.walkCoverageSerial;value.walkCoveragePart=value===next?part:value.walkCoveragePart;}w.coverageSelected(level,i,j,part);w.tileSelected(level,i,j,part);drain();};
 return {w,drain,manifest,select};
}
function mixedSelection(m=M,override){
 const {w,drain,manifest,select}=runtime(m,override);
 try{
  select(0,0,0);select(8,143,197);
  const fine=tile(manifest,'8/143_197'),job=w.jobs[407];
  const indices=w.meshes.map(mesh=>Array.from(mesh.geometry.index.array));
  select(7,71,98,7); // Partial parent retains its existing fine child.
  assert.equal(w.terrain.walkSelectedLevelAt(fine.x0+fine.size/2,fine.z0+fine.size/2),8);
  select(7,72,98);
  let tested=0,min=Infinity;
  for(const range of job.ranges.slice(0,1)){const g=w.meshes[range.bucket].geometry;for(let n=0;n<range.count;n++){const id=range.start+n,x=g.attributes.position.getX(id),z=g.attributes.position.getZ(id);if(x>=fine.x0&&x<fine.x0+fine.size&&z>=fine.z0&&z<fine.z0+fine.size){tested++;min=Math.min(min,g.attributes.position.getY(id));}}}
  assert.ok(tested>0);assert.ok(min>=31-.001,`job407 fine points must stay above active fine ground; minimum ${min}`);
  const slab=job.ranges[0],position=w.meshes[slab.bucket].geometry.attributes.position;
  for(let tri=0;tri<slab.count;tri+=3)for(let a=0;a<=60;a++)for(let b=0;b<=60-a;b++){
   const u=a/60,v=b/60,ids=[slab.start+tri,slab.start+tri+1,slab.start+tri+2],sample=axis=>(1-u-v)*position[axis](ids[0])+u*position[axis](ids[1])+v*position[axis](ids[2]);
   const x=sample('getX'),z=sample('getZ'),y=sample('getY'),level=w.terrain.walkSelectedLevelAt(x,z),ground=w.terrain.walkHeightAt(level,x,z);
   assert.ok(y>=ground-.001,`mixed-detail slab interior above active ground: ${y} < ${ground} at ${x},${z}, level ${level}`);
  }

  select(7,71,98);
  const max=Math.max(...job.ranges.flatMap(r=>Array.from({length:r.count},(_,i)=>w.meshes[r.bucket].geometry.attributes.position.getY(r.start+i))));
  assert.ok(max<=30.17,`genuine coarsening lowers the section instead of retaining a highest-ever height: ${max}`);
  assert.deepEqual(w.meshes.map(mesh=>Array.from(mesh.geometry.index.array)),indices,'height changes retain every index byte');
 }finally{w.dispose();}
}
function probes(surface){const bytes=Buffer.from(surface.probeBytes,'base64'),flat=new Float64Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/8);return surface.probes.length?surface.probes:Array.from({length:flat.length/2},(_,i)=>[flat[i*2],flat[i*2+1]]);}
function dependencyAudit(){
 let checked=0;
 for(const [area,{data,manifest}]of Object.entries(areas))for(const q of [0,1]){
  const c=data.compiled[q],exists=new Set(Object.entries(manifest.levels).flatMap(([level,names])=>names.map(name=>`${level}/${name}`)));
  c.jobs.forEach((job,id)=>{for(const p of [...job.refs.map(ref=>c.points[ref]),...job.surfaces.flatMap(probes)])for(let level=0;level<=8;level++){
   const size=manifest.size/2**level,key=`${level}/${Math.floor((p[0]+manifest.village[0]-manifest.origin[0])/size)}_${Math.floor((p[1]-(manifest.village[1]-manifest.origin[1]))/size)}`;if(!exists.has(key))continue;
   const [ids,fs]=data.terrain[key]?.heightMembers?.[q]??[[],[]],members=id<data.plans[q].pieces.length?ids:fs,needle=id<data.plans[q].pieces.length?id:id-data.plans[q].pieces.length;
   assert.ok(members.includes(needle),`${area}/${q} job${id} missing sampled dependency ${key}`);checked++;
  }});
 }
 console.log('PASS independent sampled dependency audit',checked,'point/level cases');
}
function readActive(packets){const ids=new Set(),tops=new Map();for(const p of packets)if(p.type==='active'){let at=0;for(let n=0;n<p.count;n++){const id=p.data[at++],g=p.data[at++],t=p.data[at++];ids.add(id);at+=g*2;for(let k=0;k<t;k++){tops.set(p.data[at],p.data[at+1]);at+=2;}}}return {ids,tops};}
function shuffled(values,seed){const a=[...values];let state=seed;for(let i=a.length-1;i>0;i--){state=(Math.imul(state,1664525)+1013904223)>>>0;const j=state%(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
function shuffleOrders(){
 for(const [area,{data,manifest}]of Object.entries(areas))for(const q of [0,1]){
  const c=data.compiled[q],coverage=c.coverage,exists=new Set(Object.entries(manifest.levels).flatMap(([l,names])=>names.map(name=>`${l}/${name}`))),changes=[];
  coverage.cells.forEach((ids,cell)=>{if(!ids.length)return;const x=coverage.col+cell%coverage.cols+.5,z=coverage.row+Math.floor(cell/coverage.cols)+.5;for(let level=8;level>=0;level--){const span=2**(9-level),key=`${level}/${Math.floor(x/span)}_${Math.floor(z/span)}`;if(exists.has(key)){changes.push(cell,level);break;}}});
  const candidates=c.jobs.map((job,id)=>job.bridge?-1:id).filter(id=>id>=0),chosen=[...new Set([candidates[0],...Array.from({length:7},(_,i)=>candidates[Math.floor(i*(candidates.length-1)/6)]),...(area==='porthood'&&!q?[196]:[]),...(area==='pointtupper'&&!q?[407]:[])])];
  let reference;
  for(const seed of [0,1,17,93]){
   const w=worker(area,!!q),keys=Object.keys(data.terrain),order=seed===0?keys:seed===1?[...keys].reverse():shuffled(keys,seed);
   if(seed!==1)w.cover(changes);
   order.forEach((key,i)=>{w.send(key,30+Number(key.split('/')[0])*.125);if(seed===1&&i===Math.floor(order.length/2))w.cover(changes);});
   const actual=readActive(w.packets),result=chosen.map(id=>{assert.ok(actual.ids.has(id),`${area}/${q} shuffled${seed} resolves job${id}`);return c.jobs[id].surfaces.flatMap(surface=>surface.tops.map(top=>[top,actual.tops.get(top)]));});
   if(reference)assert.deepEqual(result,reference,`${area}/${q}: heights independent of arrival order`);else reference=result;
  }
  console.log('PASS four shuffled arrival orders',area,q?'LOW':'desktop',chosen.length,'sample jobs');
 }
}
function sparseMixedDraw(){
 const {w,select}=runtime(M,undefined,true);try{select(8,143,197);select(7,72,98);
  assert.equal(w.activeCache.ready[407],1,'active mixed heights resolve without a uniform-level grid');
  const range=w.jobs[407].ranges[0],indices=w.meshes[range.bucket].geometry.index;
  for(let i=0;i<range.count;i++)assert.equal(indices.getX(range.start+i),range.start+i,'an owned section draws from resolved active heights');
 }finally{w.dispose();}
}
function primaryCoverage(){
 const events=[],make=(level,i,j,size,quadSea=[])=>({level,i,j,size,x0:i*size,z0:j*size,ready:true,mesh:{material:{uniforms:{hideQuad:{value:{set(){}}}}}},box:{distanceToPoint:()=>0},quadSea,walkCoverageSerial:-1,walkCoveragePart:-2,walkFrame:-1,walkPart:-2});
 const parent=make(0,0,0,512,[false,false,true,true]),child=make(1,0,0,256),tiles=new Map([['0/0_0',parent],['1/0_0',child]]);
 const t=Object.assign(Object.create(M.Terrain.prototype),{manifest:{origin:[0,0],village:[0,0],size:512},maxLevel:1,frame:1,walkCoverageSerial:0,tiles,split:1,cartRoads:false,sidewalks:{coverageSelected:(...args)=>events.push(['height',...args]),tileSelected:(...args)=>events.push(['draw',...args])},tile:(l,i,j)=>tiles.get(`${l}/${i}_${j}`),use(){},frustum:{intersectsBox:()=>false}});
 t.walkCoverageSerial++;t.visit(0,0,0,{},false);
 assert.ok(events.some(e=>e[0]==='height'&&e[1]===0&&e[4]===2),'off-screen partial parent notifies height coverage');
 assert.ok(!events.some(e=>e[0]==='draw'&&e[1]===0),'height coverage cannot change draw ownership');
 assert.equal(t.walkSelectedLevelAt(64,64),1);assert.equal(t.walkSelectedLevelAt(384,64),0);assert.equal(t.walkSelectedLevelAt(64,384),null,'hidden sea quarter is not selected land');
 t.split=0;t.walkCoverageSerial++;t.visit(0,0,0,{},false);assert.equal(t.walkSelectedLevelAt(64,64),0,'second primary pass withdraws the earlier fine tile in the same frame');
 const {data,manifest}=areas.pointtupper,c=structuredClone(data.compiled[0]);for(const job of c.jobs)for(const surface of job.surfaces)surface.probes=probes(surface);
 const resolver=M.createSidewalkHeights({...c,manifest});assert.equal(resolver.resolve(407,()=>30),null,'unobserved coverage waits');
 resolver.select(c.coverage.cells.flatMap((ids,cell)=>ids.length?[cell,-1]:[]));const used=new Set();assert.ok(resolver.resolve(407,(level)=>{used.add(level);return 30;}),'known no-land cells use loaded-land fallback');assert.deepEqual([...used],[8]);
}
let failed=false;
for(const [name,check]of [['job196 neighbour arrival',arrivalOrder],['job407 mixed detail and coarsening',mixedSelection],['owned mixed section without uniform grids',sparseMixedDraw],['primary coverage and sea fallback',primaryCoverage],['all-sample dependency index',dependencyAudit],['shuffled arrival orders',shuffleOrders]])try{check();console.log('PASS',name);}catch(error){failed=true;console.error('FAIL',name,error.message);}
assert.equal(failed,false,'selection/arrival regressions must all pass');
assert.throws(()=>arrivalOrder(true),/job196/);console.log('REJECTED slab-only dependency membership mutant');
const source=readFileSync('web/src/sidewalks.ts','utf8'),needle='this.activeCache?.ready[id]?this.activeCache:this.caches[level-6]';assert.ok(source.includes(needle));
const bad=await module({'web/src/sidewalks.ts':source.replace(needle,'this.caches[level-6]')});assert.throws(()=>mixedSelection(bad),/fine points/);console.log('REJECTED callback-level height mutant');

const withoutSides=structuredClone(areas.pointtupper.data),manifest=areas.pointtupper.manifest,compiled=withoutSides.compiled[0],origin=[manifest.origin[0]-manifest.village[0],manifest.village[1]-manifest.origin[1]];
for(const job of compiled.jobs)for(const surface of job.surfaces)surface.probes=M.slabProbes(surface.refs.map(ref=>compiled.points[ref].map(Math.fround)),origin,manifest.size/256/128);
assert.throws(()=>mixedSelection(M,withoutSides),/interior/);console.log('REJECTED missing one-sided seam-probe mutant');
