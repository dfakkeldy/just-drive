#!/usr/bin/env node
// Actual geometry/grass execution, plus independent Python source-road and obstacle oracles.
import assert from 'node:assert/strict';
import './sidewalks-poll-fixture.mjs';
import './sidewalks-timing-fixture.mjs';
import './sidewalks-probe-fixture.mjs';
import './sidewalks-settle-fixture.mjs';
import './sidewalks-frame-fixture.mjs';
import './sidewalks-counts-fixture.mjs';
import './sidewalks-interior-fixture.mjs';
import './sidewalks-output-fixture.mjs';
import './sidewalks-selection-check.mjs';
import {Worker as NodeWorker} from 'node:worker_threads';
import {resolveObjectURL} from 'node:buffer';
import {setTimeout as pause} from 'node:timers/promises';
import {gunzipSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spy,current} from './world-update-fixture.mjs';
import {build} from '../web/node_modules/esbuild/lib/main.js';
const root=fileURLToPath(new URL('../',import.meta.url)),read=p=>readFileSync(resolve(root,p),'utf8'),json=p=>JSON.parse(read(p));
const mutations=process.argv.includes('--mutations');
function python(args,input){const r=spawnSync('python3',['tools/sidewalks_oracle.py',...args],{cwd:root,input,encoding:'utf8',maxBuffer:32*1024*1024});assert.equal(r.status,0,r.stdout+'\n'+r.stderr);process.stdout.write(r.stdout);}
const areas=['mabou','porthood','pointtupper'],raw={};
for(const area of areas){const path=`data/baked/${area==='mabou'?'terrain':`areas/${area}`}/`;raw[area]={manifest:json(path+'manifest.json'),roads:json(path+'roads.json').roads,props:json(path+'props.json'),buildings:json(path+'buildings.json').buildings,cache:JSON.parse(gunzipSync(Buffer.from(json(`web/src/sidewalks-packed-${area}.json`).payload,'base64')))};}
async function module(replacements={},minify=false) {
 const result=await build({stdin:{contents:`export * from './web/src/sidewalks.ts';export * from './web/src/sidewalk-layout.ts';export {readWalkPlan} from './web/src/sidewalks-cache.ts';export {Grass} from './web/src/grass.ts';export {Props} from './web/src/props.ts';export {Terrain} from './web/src/terrain.ts';export * as THREE from 'three';`,resolveDir:root},bundle:true,write:false,minify,format:'esm',platform:'node',logLevel:'silent',alias:{three:resolve(root,'web/node_modules/three/build/three.module.js')},plugins:[{name:'walk-fault',setup(b){for(const [file,contents]of Object.entries(replacements))b.onLoad({filter:new RegExp(file.replaceAll('.','\\.')+'$')},()=>({contents,loader:'ts'}));}}]});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const M=await module();
for(const [terrainPending,walkPending,readyExpected]of [[1,5,false],[0,5,false],[0,0,true]]){
 const r=spy(current(),false,true,false,c=>{c.terrain.pending=terrainPending;c.sidewalks.pending=walkPending;c.quiet=25;});
 assert.equal(r.context.quiet,terrainPending?0:26,'tile work must not restart the existing quiet timer');assert.equal(r.args['page.ready'][0][0],readyExpected,'ready still waits for completed sidewalk work');
}

for(const area of areas){const planned=json(`web/src/sidewalks-plan-${area}.json`),packed=raw[area].cache;assert.deepEqual(packed.plans,planned.plans,'published plan equals the independently checked plan');assert.deepEqual(packed.roads,planned.roads);assert.deepEqual(packed.terrain,planned.terrain);}

function terrain(area,shape=false){const manifest=raw[area].manifest,grid=manifest.size/256/128,ox=manifest.origin[0]-manifest.village[0],oz=manifest.village[1]-manifest.origin[1];
 const height=(x,z)=>{if(!shape)return 30;const fx=(x-ox)/grid,fz=(z-oz)/grid,a=Math.floor(fx),b=Math.floor(fz),u=fx-a,v=fz-b;
  const at=(i,j)=>30+(((i*19+j*31)%7+7)%7)*.13;const h00=at(a,b),h10=at(a+1,b),h01=at(a,b+1),h11=at(a+1,b+1);return u+v<=1?h00+(h10-h00)*u+(h01-h00)*v:h11+(h01-h11)*(1-u)+(h10-h11)*(1-v);};
 return {manifest,walkHeightAt:(_l,x,z)=>height(x,z),meshHeightAt:height,heightAt:height,surfaceAt:(x,z)=>({level:8,ground:height(x,z)}),dataRevision:1,drawnRevision:'0',height};
}
function make(m,area,low=false,shape=false){const d=raw[area],t=terrain(area,shape),net={roads:d.cache.roads.map(r=>({id:r[0],pts:[[0,0],[1,1]]})),bridgeWalks:new Map(),deckHeight:()=>32};return {walk:new m.Sidewalks(d.cache,d.manifest.village,t,net,low),t};}
function ready(walk,area){for(const key of Object.keys(raw[area].cache.terrain)){const [l,xy]=key.split('/'),[i,j]=xy.split('_').map(Number);if(Number(l)<6)continue;walk.tileReady(+l,i,j);walk.coverageSelected?.(+l,i,j);walk.tileSelected(+l,i,j);}
 let loops=0;while(walk.pending&&loops++<100000)walk.update();assert.equal(walk.pending,0,'bounded geometry queue drains');}
function upAndBudget(walk,low){
 for(let id=0;id<walk.plan.pieces.length;id++){const p=walk.plan.pieces[id],s=walk.jobs[id].surfaces[0],corners=[p.a.inner,p.b.inner,p.b.outer,p.a.outer];for(let i=0;i<4;i++){const point=walk.points[s.refs[i]];assert.ok(Math.hypot(point[0]-(corners[i][0]-walk.village[0]),point[1]-(walk.village[1]-corners[i][1]))<1e-6,'compiled slab matches source geometry');}}
 for(const job of walk.jobs)for(const r of job.ranges){const g=walk.meshes[r.bucket].geometry;for(let i=0;i<r.count;i++){assert.equal(g.index.getX(r.start+i),r.start+i,'all planned faces rendered');if(job.surfaces.length){const p=walk.points[r.refs[i]];assert.ok(Math.hypot(g.attributes.position.getX(r.start+i)-p[0],g.attributes.position.getZ(r.start+i)-p[1])<.001,'actual slab/strip footprint equals checked source');}}}
const meshes=walk.group.children;assert.ok(meshes.length>0&&meshes.length<=2,'two draws');const tris=meshes.reduce((n,m)=>n+m.geometry.index.count/3,0);assert.equal(tris,walk.audit.triangles);assert.ok(tris<=(low?6000:14000),'triangle budget');
 for(const mesh of meshes){const g=mesh.geometry;assert.ok(Array.from(g.attributes.position.array).every(Number.isFinite),'finite geometry');for(let i=0;i<g.index.count;i+=3){const ix=g.index.getX(i);if(g.index.getX(i+1)===ix)continue;if(g.attributes.uv.getY(ix)>.5)assert.ok(g.attributes.normal.getY(ix)>0,'top faces upward');}}
}
// Execute the exact Blob worker program in a real Node worker as well as the normal browser path.
async function workerExecution(area,low,m=M){
 const previous=globalThis.Worker;
 globalThis.Worker=class {
  constructor(url){this.closed=false;this.ready=resolveObjectURL(url).text().then(source=>{const prelude=`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)};parentPort.on('message',data=>self.onmessage({data}));`;this.thread=new NodeWorker(prelude+source,{eval:true});this.thread.on('message',data=>this.onmessage?.({data}));this.thread.on('error',e=>this.onerror?.(e));if(this.closed)this.thread.terminate();return this.thread;});}
  postMessage(data,transfer){this.ready.then(w=>w.postMessage(data,transfer));}
  terminate(){this.closed=true;this.thread?.terminate();}
 };
 let walk;
 try {
  const setup=make(m,area,low,false),t=setup.t;walk=setup.walk;assert.ok(walk.worker,'real worker path selected');
  // Tile transport uses the exact mesh grid including its border padding.
  t.walkTileData=(level,i,j)=>{const m=t.manifest,size=m.size/2**level,x0=m.origin[0]+i*size-m.village[0],z0=m.village[1]-m.origin[1]+j*size,seg=level>=7?128:64,n=seg+3,positions=new Float32Array(n*n*3);
   for(let b=0;b<=seg;b++)for(let a=0;a<=seg;a++){const k=((b+1)*n+a+1)*3;positions[k]=x0+a*size/seg;positions[k+1]=30;positions[k+2]=z0+b*size/seg;}
   return {level,i,j,size,x0,z0,positions};};
  const keys=new Set(Object.keys(raw[area].cache.terrain));
  for(const key of keys){const [l,xy]=key.split('/'),[i,j]=xy.split('_').map(Number);if(+l<6)continue;walk.tileReady(+l,i,j);walk.coverageSelected?.(+l,i,j);walk.tileSelected(+l,i,j);}
  const end=Date.now()+120000;while(walk.pending&&Date.now()<end){walk.update();await pause(1);}
  assert.equal(walk.pending,0,'real worker drains all terrain updates');
  // Bridge pieces read the modern deck (Roads.deckHeight) on the page, and every new deck build re-reads them.
  {const bridge=new Set(walk.bridgeJobs);for(const owners of walk.topOwners)assert.ok(owners.every(o=>bridge.has(o))||!owners.some(o=>bridge.has(o)),'no slab corner is shared by a bridge piece and a street piece');}
  if(walk.bridgeJobs.length){const deckRefs=()=>walk.bridgeJobs.flatMap(id=>walk.jobs[id].refs.map(r=>walk.caches[2].ground[r]));
   assert.ok(deckRefs().every(y=>y===32),'bridge pieces stand on Roads.deckHeight, not a bank plane');
   walk.network.deckHeight=()=>33.5;walk.network.bridgeRevision=7;const until=Date.now()+20000;while((walk.pending||!deckRefs().every(y=>y===33.5))&&Date.now()<until){walk.update();await pause(1);}
   assert.ok(deckRefs().every(y=>y===33.5),'a deck rebuild re-reads the bridge pieces');walk.network.deckHeight=()=>32;walk.network.bridgeRevision=8;console.log('PASS bridge pieces follow the modern deck',area,walk.bridgeJobs.length);}assert.equal(walk.audit.disabled,false);upAndBudget(walk,low);const sweep=groundSweep(walk,t);assert.equal(sweep.buried,0,'worker slab envelope');assert.ok(sweep.probes>10000);console.log('PASS real worker execution',area,low,sweep.probes,'ground probes');
 } finally {walk?.dispose();globalThis.Worker=previous;}
}
// This oracle works on submitted triangle positions, not the builder's stored corner heights.
function groundSweep(walk,t){let probes=0,buried=0,max=0;
 for(const mesh of walk.group.children){const g=mesh.geometry,p=g.attributes.position,uv=g.attributes.uv,ids=g.index;
  for(let i=0;i<(ids?.count??p.count);i+=3){const indices=[0,1,2].map(k=>ids?ids.getX(i+k):i+k);if(indices[0]===indices[1]||uv.getY(indices[0])<.5)continue;
   const c=indices.map(k=>[p.getX(k),p.getZ(k)]),ys=indices.map(k=>p.getY(k)),bx=c[1][0]-c[0][0],bz=c[1][1]-c[0][1],cx=c[2][0]-c[0][0],cz=c[2][1]-c[0][1],det=bx*cz-bz*cx;if(Math.abs(det)<1e-9)continue;
   // Barycentric points include the whole interior, all edges, and the middle.
   const steps=Math.max(4,Math.ceil(Math.max(Math.hypot(bx,bz),Math.hypot(cx,cz))/.2));
   for(let u=0;u<=steps;u++)for(let v=0;v<=steps-u;v++){const a=u/steps,b=v/steps,x=c[0][0]+a*bx+b*cx,z=c[0][1]+a*bz+b*cz,y=ys[0]*(1-a-b)+ys[1]*a+ys[2]*b,delta=t.height(x,z)-y;probes++;if(delta>.001){buried++;max=Math.max(max,delta);}}
  }
 }return {probes,buried,max};}
function runtimeGrass(m,blocked){const terrain={clear:[],seaLevel:0,surfaceAt:()=>({level:8,canopy:0,ground:30,brook:99,kind:0,halfWidth:0,roadDist:99}),coverAt:()=>3,heightAt:()=>30,meshHeightAt:()=>30,sidewalks:{vegetationAt:()=>blocked},hasFinest:()=>true};
 const grass=Object.create(m.Grass.prototype);Object.assign(grass,{terrain,clock:{value:1},geometry:new m.THREE.PlaneGeometry(1,1),material:new m.THREE.MeshBasicMaterial(),nearMaterial:new m.THREE.MeshBasicMaterial(),group:new m.THREE.Group()});const patch=grass.patch(0,0,true);grass.populate(patch,Infinity);const count=patch.count;patch.mesh?.geometry.dispose();grass.geometry.dispose();grass.material.dispose();grass.nearMaterial.dispose();return count;}
assert.ok(runtimeGrass(M,false)>100,'grass control produces real roots');assert.equal(runtimeGrass(M,true),0,'no runtime grass root on a slab');
{const t=terrain('mabou'),w=new M.Sidewalks(raw.mabou.cache,raw.mabou.manifest.village,t,{roads:[],bridgeWalks:new Map()},false,false);assert.equal(w.group.children.length,0,'1884 has no meshes');assert.equal(w.plan.pieces.length,0);assert.equal(w.vegetationAt(0,0),false);w.dispose();}
// Construction never writes the roads' bridge map: the layer keeps its bridge walks until main.ts accepts it. The compiled
// and uncompiled paths stage the same walks, one for each bridge the plan's pieces stand on.
for(const area of areas)for(const low of [false,true]){const d=raw[area],staged=[];
 for(const cache of [d.cache,{...d.cache,compiled:undefined}]){const net={roads:d.cache.roads.map(r=>({id:r[0],pts:[[0,0],[1,1]]})),bridgeWalks:new Map(),deckHeight:()=>32};
  const w=new M.Sidewalks(cache,d.manifest.village,terrain(area),net,low);assert.equal(net.bridgeWalks.size,0,`${area} construction leaves Roads.bridgeWalks alone`);
  assert.deepEqual([...w.bridgeReservations.keys()].sort((x,y)=>x-y),[...new Set(w.plan.pieces.filter(p=>p.a.road.bridge).map(p=>p.a.road.id))].sort((x,y)=>x-y),`${area} one walk per bridge`);
  staged.push([...w.bridgeReservations].sort((x,y)=>x[0]-y[0]));w.dispose();}
 assert.deepEqual(staged[0],staged[1],`${area} compiled and uncompiled bridge walks agree`);}
M.validateWalks();assert.throws(()=>M.validateWalks([{...M.WALK_RUNS[0],confidence:'low'}]));
const summary=[];
for(const area of areas)for(const low of [false,true]){const {walk,t}=make(M,area,low,true);ready(walk,area);upAndBudget(walk,low);const sweep=groundSweep(walk,t);assert.ok(sweep.probes>10000,'non-vacuous actual slab sweep');assert.equal(sweep.buried,0,`${area} ${low} no ground above slab: ${JSON.stringify(sweep)}`);
 let geometryReads=0;for(const p of walk.plan.pieces){const value=p.a;Object.defineProperty(p,'a',{get(){geometryReads++;return value;}});}
 const sample=walk.points[0];for(let i=0;i<20000;i++)assert.equal(walk.vegetationAt(...sample),true,'raster covers the actual slab');assert.equal(geometryReads,0,'vegetation uses only the raster');
 const reads=walk.audit.heightReads;t.dataRevision++;for(let i=0;i<100;i++)walk.update();assert.equal(walk.audit.heightReads,reads,'no per-frame height resampling');
 sharedLambert(walk);
 const joints=walk.jobs.flatMap(job=>job.ranges.filter(r=>r.blends));assert.equal(joints.length>0,!low,'only desktop has joint faces');
 for(const range of joints)for(const w of range.blends){assert.ok(w.every(v=>v>=-1e-10));assert.ok(Math.abs(w.reduce((a,b)=>a+b,0)-1)<1e-10);assert.ok(Math.min(w[1],w[3])<1e-10,'joint stays on one parent triangle plane');}
 summary.push({area,low,draws:walk.audit.draws,triangles:walk.audit.triangles,jointTriangles:joints.reduce((n,r)=>n+r.count/3,0),startupMs:walk.audit.startupMs,...sweep});walk.dispose();}
function sharedLambert(walk){const control=new M.THREE.MeshLambertMaterial();for(const m of walk.materials){assert.equal(m.customProgramCacheKey(),control.customProgramCacheKey(),'reuse the existing Lambert program');assert.equal(m.defines?.USE_UV,undefined,'no private joint shader define');}control.dispose();}
function noFrameMaskAllocation(m){
 const {walk}=make(m,'pointtupper'),Original=globalThis.Uint8Array;let allocations=0;
 globalThis.Uint8Array=new Proxy(Original,{construct(target,args){allocations++;return Reflect.construct(target,args);}});
 try{for(let repeat=0;repeat<2;repeat++)for(const key of Object.keys(raw.pointtupper.cache.terrain)){const [l,xy]=key.split('/'),[i,j]=xy.split('_').map(Number);const t=raw.pointtupper.cache.terrain[key],hasMask=t.pixels.length||t.members.some(([ids,fs])=>ids.length||fs.length);const mask=walk.terrainMask(+l,i,j);if(hasMask)assert.equal(mask?.length,257*257);}}
 finally{globalThis.Uint8Array=Original;walk.dispose();}
 assert.equal(allocations,0,'terrain mask lookup must allocate no raster in the frame');
}
noFrameMaskAllocation(M);
{const {walk}=make(M,'pointtupper');for(const [key,t]of Object.entries(raw.pointtupper.cache.terrain)){const [l,xy]=key.split('/'),[i,j]=xy.split('_').map(Number);if(!t.pixels.length&&!t.members.some(([ids,fs])=>ids.length||fs.length))assert.equal(walk.terrainMask(+l,i,j),null,'height-only dependencies never become vegetation masks');}walk.dispose();}
// Check the real clipped joint faces, including the whole parent diagonal and run ends.
for(const up of [false,true]){const vertices=M.slabJointTriangles(.2,3.2,up);assert.ok(vertices.length>12);for(const w of vertices){const along=.2+3*(w[1]+w[2]);assert.ok(Math.abs(along/1.5-Math.round(along/1.5))*1.5<=.01200001,'24 mm joints at 1.5 m spacing');}}
// Visual tree clearing cannot change the brush classification used by driving.
{const tile={x0:0,z0:0,size:256,level:8,ground:new Float32Array(257*257).fill(30),canopy:new Float32Array(257*257),contactCanopy:new Float32Array(257*257).fill(7),road:null,brook:null};const t=Object.create(M.Terrain.prototype);Object.assign(t,{find:()=>tile,sites:[],cartRoads:false,waterLevelAt:()=>null,withDeck:(_x,_z,h)=>h,roadCuts:{land:(_x,_z,h)=>h}});assert.equal(t.surfaceAt(20,20).canopy,7,'drawing clearance keeps contact canopy');}
await workerExecution('mabou',false);await workerExecution('porthood',true);await workerExecution('porthood',true,await module({},true));
// Actual Props drawing moves, while the rail collision policy retains source positions.
{const d=raw.porthood,t=terrain('porthood'),original=new M.Props(d.props,d.manifest.village,t),moved=new M.Props(d.props,d.manifest.village,t,undefined,d.cache.plans[0].poleMoves);assert.deepEqual(moved.railObstacles,original.railObstacles,'cosmetic poles do not alter road collision openings');assert.notDeepEqual(moved.poles,original.poles,'poles actually move');
 const warn=console.warn;let warned=0;console.warn=()=>{warned++;};
 try{const stale=new M.Props(d.props,d.manifest.village,t,undefined,d.cache.plans[0].poleMoves.map(m=>({...m,from:[m.from[0]+.5,m.from[1]]})));assert.deepEqual(stale.poles,original.poles,'a move whose source pole changed is skipped');assert.equal(warned,1,'stale pole moves warn once');}finally{console.warn=warn;}
 console.log('PASS pole moves apply only to their source poles; stale moves skipped with one warning');}
// Exercise the real frame callback's budget handling; a bad future data budget hides this feature once.
{let warnings=0;const old=console.warn;console.warn=()=>warnings++;const {walk}=make(M,'mabou');walk.audit.triangles=999999;assert.doesNotThrow(()=>{walk.update();walk.update();});console.warn=old;assert.equal(warnings,1,'budget logs once');assert.equal(walk.group.visible,false,'budget overflow skips layer');walk.dispose();}
// A missing raster guard must fail in the real populate method, not a text search.
if(mutations){const source=read('web/src/grass.ts');assert.ok(source.includes('if (this.terrain.sidewalks?.vegetationAt(x,z))'));const bad=await module({'web/src/grass.ts':source.replace('if (this.terrain.sidewalks?.vegetationAt(x,z))','if (false && this.terrain.sidewalks?.vegetationAt(x,z))')});assert.ok(runtimeGrass(bad,true)>100,'grass guard mutant reproduces the old fault');console.log('REJECTED disabled grass guard: actual roots on slab');
 const src=read('web/src/sidewalks.ts');const bad2=await module({'web/src/sidewalks.ts':src.replace("console.warn('Sidewalk geometry budget exceeded; skipping sidewalks');","throw Error('Sidewalk geometry budget exceeded');")});const test=make(bad2,'mabou').walk;test.audit.triangles=999999;assert.throws(()=>test.update(),/geometry budget/);test.dispose();console.log('REJECTED runtime budget throw');}
python(mutations?['--mutations']:[]);
// Optional review receipt: branch-only history is absent after a squash landing.
// The normal mutation gate above is self-contained and exercises current runtime/oracle faults.
if(process.argv.includes('--review-replays')) {
 const lazy=await module({'web/src/sidewalks.ts':execFileSync('git',['show','a32cfa3:web/src/sidewalks.ts'],{cwd:root,encoding:'utf8'})});assert.throws(()=>noFrameMaskAllocation(lazy),/allocate no raster in the frame/);console.log('REJECTED pre-fix frame-time terrain mask allocation');
 const shader=await module({'web/src/sidewalks.ts':execFileSync('git',['show','49853ba:web/src/sidewalks.ts'],{cwd:root,encoding:'utf8'})});const oldJoints=new shader.Sidewalks(raw.mabou.cache,raw.mabou.manifest.village,terrain('mabou'),{roads:[],bridgeWalks:new Map()},false,true,true);assert.throws(()=>sharedLambert(oldJoints),/existing Lambert program/);assert.equal(oldJoints.jobs.flatMap(j=>j.ranges.filter(r=>r.blends)).length,0,'pre-fix compiler does not build joint faces');oldJoints.dispose();console.log('REJECTED pre-fix private slab-joint shader program');
 const layout=execFileSync('git',['show','2cd5725:web/src/sidewalk-layout.ts'],{cwd:root,encoding:'utf8'});
 const oldRuntime=execFileSync('git',['show','2cd5725:web/src/sidewalks.ts'],{cwd:root,encoding:'utf8'});
 const old=await module({'web/src/sidewalk-layout.ts':layout.replace('  validateWalks(runs);','  globalThis.__walkPlans=(globalThis.__walkPlans??0)+1; validateWalks(runs);'),'web/src/sidewalks.ts':oldRuntime});
 const input=JSON.parse(execFileSync(process.execPath,['tools/sidewalks-inputs.mjs'],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024}));
 const oldPlans={};
 for(const area of areas) {
  const d=input.areas[area],p=old.planWalks(area,d.roads,d.obstacles,false);
  const section=s=>({...s,road:s.road.id});oldPlans[area]={...p,pieces:p.pieces.map(p=>({...p,run:p.run.id,a:section(p.a),b:section(p.b)}))};
 }
 python(['--legacy'],JSON.stringify(oldPlans));
 const run={...old.WALK_RUNS[0],id:'fixture',road:'Test',side:'north-east',start:[624000,5103000],end:[624050,5103000]},road={id:1,name:'Test',kind:2,halfWidth:3,bridge:false,pts:[run.start,run.end]},obstacle={id:'building-0',polygon:[[624010,5103004.23],[624030,5103004.23],[624030,5103010],[624010,5103010]]};
 const oldNarrow=old.planWalks('mabou',[road],[obstacle],false,[run]);assert.ok(oldNarrow.lengths.fixture<49,'pre-fix building gap loses a usable one-metre path');console.log('REJECTED pre-fix building gap:',oldNarrow.lengths.fixture,'of 50 m retained');
 globalThis.__walkPlans=0;
 const area='mabou',d=raw[area],t=terrain(area,true),net={roads:[],bridgeWalks:new Map(),deckHeight:()=>32};let reads=0;
 t.meshHeightAt=(x,z)=>{reads++;return t.height(x,z);};
 const w=new old.Sidewalks(area,d.roads,old.sidewalkObstacles(d.buildings,d.props),d.manifest.village,t,net,false,true);w.update(1000);
 assert.equal(globalThis.__walkPlans,1,'pre-fix constructor really runs the planner');console.log('REJECTED pre-fix startup planner: real planWalks call');
 const sunk=groundSweep(w,t);assert.ok(sunk.buried>0,'pre-fix slab sweep reproduces buried ground');console.log('REJECTED pre-fix flush envelope:',JSON.stringify(sunk));
 const before=reads;t.dataRevision++;w.update(2000);assert.ok(reads>before,'pre-fix resamples for unrelated terrain revision');console.log('REJECTED pre-fix frame resampling:',reads-before,'height reads');
 let touches=0;const first=w.plan.pieces[0],point=[(first.a.inner[0]+first.a.outer[0])/2-d.manifest.village[0],d.manifest.village[1]-(first.a.inner[1]+first.a.outer[1])/2];
 for(const p of w.plan.pieces){const a=p.a;Object.defineProperty(p,'a',{get(){touches++;return a;}});}for(let i=0;i<100;i++)w.vegetationAt(...point);assert.ok(touches>0);console.log('REJECTED pre-fix vegetation scan:',touches,'geometry reads');w.dispose();
 const budget=await module({'web/src/sidewalk-layout.ts':layout.replace('desktop: 10000','desktop: 1'),'web/src/sidewalks.ts':oldRuntime});
 const bad=new budget.Sidewalks(area,d.roads,budget.sidewalkObstacles(d.buildings,d.props),d.manifest.village,t,net);assert.throws(()=>bad.update(1000),/geometry budget/);bad.dispose();console.log('REJECTED pre-fix frame-loop budget throw');
}

console.log('PASS actual geometry, exact ground envelope, constant-time raster, load-event cache, runtime grass, cosmetic poles and safe budget',JSON.stringify(summary));
{
 // Main's Mabou main street drew its own north sidewalk ribbon in the band the sidewalk layer covers; with the layer live
 // the street halves keep their lamps and festoons and omit only that ribbon (one sidewalk, not two).
 const out=await build({stdin:{contents:"export {buildUnit} from './web/src/mabou-main.ts';export {MabouMainSite} from './web/src/mabou-main-site.ts';",resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',nodePaths:[resolve(root,'web/node_modules')]});
 const MM=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
 const manifest=JSON.parse(readFileSync(resolve(root,'data/baked/terrain/manifest.json'),'utf8')),roads=JSON.parse(readFileSync(resolve(root,'data/baked/terrain/roads.json'),'utf8')).roads;
 const vertices=(unit,layer)=>{const site=new MM.MabouMainSite(manifest.village);site.sidewalkLayer=layer;let n=0;for(const g of MM.buildUnit(unit,site,()=>0,false,roads).values()){n+=g.attributes.position.count;g.dispose();}return n;};
 for(const unit of ['streetWest','streetEast']){const own=vertices(unit,false),yielded=vertices(unit,true);assert.ok(yielded>0&&yielded<own,`${unit}: the ribbon goes, lamps and festoons stay (${own} -> ${yielded} vertices)`);}
 console.log('PASS Mabou main street omits its north sidewalk ribbon only while the sidewalk layer draws it');
}
