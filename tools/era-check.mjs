import assert from 'node:assert/strict';
import {HISTORY_AREA_IDS} from '../web/src/eras/history-areas.ts';
import {readFileSync,writeFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {readEra,TODAY,ERAS,areaInEra,eraRoadField,eraRoadHalf} from '../web/src/era.ts';
import {readArea} from '../web/src/area.ts';
import {HistorySiting,historyPlaces,TRADE_WORDS,siteCorners,farmBarn} from '../web/src/eras/history-sites.ts';
import {historyLayout} from '../web/src/eras/history-layout.ts';
import {getDensityAuditData} from './era-density-data.mjs';
import {privateDensityAudit} from './era-density-private.mjs';
import {HistoryBridgeApproaches} from '../web/src/eras/history-approaches.ts';
import {RESIDENCES_1884,VILLAGE_RESIDENCES_1884,densityCellId,densityCellAt,inVillage1884} from '../web/src/eras/mabou-1884-density.ts';
import {historyGround} from '../web/src/eras/history-ground.ts';
import {MABOU_1884_TRADES} from '../web/src/eras/mabou-1884-trades.ts';
import {makeGround,preload} from './phone-ground.mjs';
import {periodBuilding} from '../web/src/eras/history-art.ts';
import {periodBridgePlane,timberBridge} from '../web/src/eras/timber-bridge.ts';
import {Vehicle} from '../web/src/vehicle.ts';
import {Roads} from '../web/src/roads.ts';
import * as THREE from '../web/node_modules/three/build/three.module.js';
const root=process.env.MMM_ROOT??process.cwd(),base=root+'/data/baked/terrain';
const json=file=>JSON.parse(readFileSync(base+'/'+file,'utf8'));
const manifest=json('manifest.json'),origin=manifest.village;
const originalWarn=console.warn,warnings=[];console.warn=s=>warnings.push(s);
assert.equal(readEra(new URLSearchParams()),TODAY);
assert.equal(readEra(new URLSearchParams('era=today')),TODAY);
assert.equal(readEra(new URLSearchParams('era=no-such-era')),TODAY);
const era=readEra(new URLSearchParams('era=1884'));assert.equal(era.id,'1884');
for(const area of ['porthood','pointtupper','unknown'])assert.equal(readEra(new URLSearchParams('era=1884&area='+area)),TODAY);
assert.equal(warnings.length,4);console.warn=originalWarn;
// Judique has its own 1884 copy; the raw table entry keeps Mabou's title (time travel reads it).
const judique=readEra(new URLSearchParams('era=1884&area=judique'));assert.equal(judique.id,'1884');assert.equal(judique.title,'Judique, 1884');assert.equal(judique.area,'judique');
assert.equal(era.title,'Mabou, 1884');assert.equal(era.area,'mabou');assert.equal(ERAS[1].title,'Mabou, 1884');assert.equal(readEra(new URLSearchParams('era=1884&area=judique')),judique);
assert.deepEqual({...judique,title:null,area:null},{...ERAS[1],title:null,area:null},'Judique plays the same 1884 rules');
const area=readArea(new URLSearchParams());assert.equal(areaInEra(area,TODAY),area);
for(const k of ['mail','worksYard','colliery','animals','roadScene','fishing','landmarks'])assert.equal(areaInEra(area,era)[k],false,k);
// The page promises "It shows no person's land": in 1884 no area keeps the Red Roof by the Brook house, the modern church or any other area-only modern site.
const ERA_OFF=['mail','worksYard','colliery','animals','roadScene','fishing','landmarks','home','church','quarry'];
for(const id of HISTORY_AREA_IDS){const today=readArea(new URLSearchParams('area='+id)),old=readEra(new URLSearchParams('era=1884&area='+id));assert.equal(old.id,'1884');
 for(const k of ERA_OFF)assert.equal(areaInEra(today,old)[k],false,id+' 1884 '+k);}
assert.equal(readArea(new URLSearchParams('area=judique')).home,true,'today\'s Judique has the author\'s house (so the 1884 test has teeth)');
assert.equal(areaInEra(readArea(new URLSearchParams('area=judique')),TODAY).home,true);
console.log('PASS era defaults, unknown/unsupported warnings, Judique and Mabou titles, and Mabou feature flags');
const pixels=new Uint8ClampedArray([128,70,1,0,130,60,2,0,125,80,3|32,0,128,30,5|16,1,127,30,4,0]);
eraRoadField(pixels,.05);assert.deepEqual([...pixels],[128,42,3,0,130,42,3,0,125,42,3|32,0,0,0,0,0,127,30,4,0]);
console.log('PASS decoded road field: narrow gravel, washboard preserved, tracks unchanged, rail removed');
// Decode the existing cover PNG, without resampling or copying source data.
const png=readFileSync(base+'/'+manifest.cover.file);let off=8,width,height,channels,chunks=[];
while(off<png.length){const n=png.readUInt32BE(off),type=png.toString('ascii',off+4,off+8),chunk=png.subarray(off+8,off+8+n);if(type==='IHDR'){width=chunk.readUInt32BE(0);height=chunk.readUInt32BE(4);assert.equal(chunk[8],8);channels=chunk[9]===2?3:chunk[9]===6?4:0;assert(channels);}if(type==='IDAT')chunks.push(chunk);off+=n+12;}
const raw=inflateSync(Buffer.concat(chunks)),stride=width*channels,decoded=new Uint8Array(stride*height);
const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
for(let y=0;y<height;y++)for(let x=0;x<stride;x++){const k=y*stride+x,a=x>=channels?decoded[k-channels]:0,b=y?decoded[k-stride]:0,c=y&&x>=channels?decoded[k-stride-channels]:0,f=raw[y*(stride+1)];assert(f<=4);decoded[k]=(raw[y*(stride+1)+x+1]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][f])&255;}
const cover=(x,z)=>{const c=manifest.cover,u=(x+origin[0]-c.xmin)/(c.xmax-c.xmin),v=(c.ymax-origin[1]+z)/(c.ymax-c.ymin);if(u<0||v<0||u>=1||v>=1)return 0;const cls=decoded[(Math.floor(v*height)*width+Math.floor(u*width))*channels+2];return cls;};
const dry=(x,z)=>cover(x,z)!==4&&cover(x,z)!==0;
const roads=json('roads.json').roads.filter(r=>r.kind!==5).map(r=>({...r,halfWidth:eraRoadHalf(r.kind,r.halfWidth),pts:r.pts.map(p=>[p[0]-origin[0],origin[1]-p[1]])}));
const {terrain}=makeGround();const ground=await historyGround(manifest,base,roads.filter(r=>r.bridge).flatMap(r=>r.pts.map(([x,z])=>[x+origin[0],origin[1]-z])));
const approach=new HistoryBridgeApproaches({roads},terrain,ground);
const siting=new HistorySiting(roads,json('streams.json'),origin,dry,ground,cover,approach.sites),{trades:sites,farms}=historyLayout(origin);
assert.equal(sites.length,48);assert.deepEqual(sites,historyLayout(origin).trades);
const words=new Set(['FORGE','SCHOOL','POST OFFICE','TELEGRAPH AND POST OFFICE','CHURCH','SHOP','SAW MILL','SHINGLE MILL','WEAVING MILLS','CHEESE FACTORY','LOBSTER FACTORY','TANNERY','STAGE STABLES','PLASTER QUARRY','MILL']);
assert.deepEqual(new Set(Object.values(TRADE_WORDS)),words);
assert.equal(MABOU_1884_TRADES.length,48);
for(const s of sites){assert(siting.safe(s,sites.filter(p=>p!==s)),s.id+' dry footprint clear of roads/water/other sites');assert(words.has(s.word));assert.match(s.word,/^[A-Z ]+$/);console.log(`SITE ${s.id} ${s.method} ${s.moved.toFixed(2)} m ${s.word}`);}
const places=historyPlaces(sites,origin);assert.equal(places.length,48);for(const p of places){assert(words.has(p.name));assert.deepEqual(p.sources,[MABOU_1884_TRADES.find(t=>t.id===p.id).source]);assert.equal(p.note,`The 1884 survey sheet prints "${MABOU_1884_TRADES.find(t=>t.id===p.id).word}" near here. This building and its exact place are invention.`);}
const audit=getDensityAuditData().audit,deficits=getDensityAuditData().header.deficits;
assert.deepEqual(audit.deficits,deficits);assert.equal(farms.length,302-deficits.reduce((n,d)=>n+d.counted-d.built,0));
assert.equal(farms.filter(f=>f.zone==='village').length,VILLAGE_RESIDENCES_1884);
const map=s=>[origin[0]+s.x,origin[1]-s.z],physical={};
for(const f of farms)if(f.zone!=='village'){const id=densityCellAt(...map(f));physical[id]=(physical[id]??0)+1;}
for(let row=0;row<17;row++)for(let col=0;col<17;col++){
 const id=densityCellId(col,row),counted=RESIDENCES_1884[row][col],deficit=deficits.find(d=>d.cell===id),expected=deficit?.built??counted;
 if(deficit){assert.equal(deficit.counted,counted);assert(deficit.built<counted&&deficit.reason);}
 assert.equal(physical[id]??0,expected,id+' count with explicit in-cell deficit only');assert.equal(audit.cells[id].built,expected);assert.equal(audit.cells[id].counted,counted);
}
for(const f of farms){
 const others=[...sites,...farms.filter(p=>p!==f)],barn=farmBarn(f);
 assert(siting.safe(f,others),f.id+' dry and off roads/approaches');if(barn)assert(siting.safe(barn,others),f.id+' barn dry and off roads/approaches');
 assert.equal(inVillage1884(...map(f)),f.zone==='village');
 for(const p of farms)if(p!==f)assert(Math.hypot(p.x-f.x,p.z-f.z)>=(p.zone==='village'&&f.zone==='village'?18:60),'farm spacing');
}
privateDensityAudit(root+'/data/work/history-1884/density/mabou-1884-dwellings.json',farms,origin);
assert.deepEqual(farms,historyLayout(origin).farms);assert(farms.every(f=>f.word===''));
console.log('DENSITY',JSON.stringify(audit));
const farmCounts=Object.fromEntries(['village','roadside','remote'].map(zone=>[zone,{drawn:farms.filter(f=>f.zone===zone).length}]));
if(process.env.DENSITY_OUT)writeFileSync(process.env.DENSITY_OUT,JSON.stringify({farms,audit,counts:farmCounts,origin},null,2));
const moved=sites.map(s=>s.moved).sort((a,b)=>a-b),counts=key=>Object.fromEntries([...new Set(sites.map(s=>s[key]))].map(v=>[v,sites.filter(s=>s[key]===v).length]));
console.log('FARM_COUNTS',JSON.stringify(farmCounts));
console.log('SITING',JSON.stringify({methods:counts('method'),median:(moved[23]+moved[24])/2,max:moved.at(-1),farms:Object.fromEntries(['village','roadside','remote'].map(z=>[z,farms.filter(f=>f.zone===z).length]))}));
console.log('PASS 48 sited trades, whole footprints dry/off-road; allowed sign/place wording and exact sources; deterministic cell density and village allocation');
// Production terrain loader and vehicle: no pavement on former pavement OR bridge, no rail in runtime Roads.
terrain.cartRoads=true;
const network=new Roads(json('roads.json'),origin,terrain);assert(!network.roads.some(r=>r.kind===5));
const bridge=network.roads.find(r=>r.bridge&&r.kind===1),plain=network.roads.find(r=>r.name==='Highway 19'&&!r.bridge);
assert(bridge&&plain);
for(const road of [plain,bridge]){
 const i=Math.floor(road.pts.length/2),p=road.pts[i],q=road.pts[Math.min(i+1,road.pts.length-1)];
 await preload(terrain,road.pts,70);
 const node=()=>new THREE.Object3D();const v=new Vehicle({root:node(),body:node(),steer:{fl:node(),fr:node()},wheels:{fl:node(),fr:node(),rl:node(),rr:node()}},terrain,network,-.2);v.restart(...p,Math.atan2(q[0]-p[0],p[1]-q[1]));
 terrain.withGroundContact(v,()=>v.update(1/60,{throttle:1,steer:0,handbrake:false,touch:true}));
 assert.notEqual(v.surfaceName,'pavement');assert.equal(terrain.surfaceAt(...p).kind,3);console.log('PASS actual vehicle surface',road.bridge?'timber bridge':'former highway',v.surfaceName);
}
await preload(terrain,sites.flatMap(s=>siteCorners(s)),60);
for(const s of sites)for(const [x,z]of siteCorners(s)){const g=terrain.heightAt(x,z);assert(g>-.2,s.id+' ground above sea '+g);}
for(const s of sites.filter(s=>s.method==='water')){const h=siteCorners(s).map(([x,z])=>terrain.heightAt(x,z));console.log('MILL_GRADE',s.id,Math.max(...h)-Math.min(...h),s.water);}
const jointRoads=[{id:1,kind:4,bridge:true,halfWidth:1.5,pts:[[0,0],[0,10]]},{id:2,kind:4,bridge:true,halfWidth:1.5,pts:[[0,10],[0,20]]}];
const banks={surfaceAt:(_x,z)=>({ground:z<0?10:z>20?20:0,level:8})};
const left=periodBridgePlane(jointRoads[0],jointRoads,banks),right=periodBridgePlane(jointRoads[1],jointRoads,banks);
assert.equal(left.y1,right.y0);assert.equal(left.y0,10.05);assert.equal(right.y1,20.05);
console.log('PASS adjoining timber records share an exact joint and keep the two outer bank heights');
const sloping={id:3,kind:3,bridge:true,halfWidth:2.1,pts:[[0,0],[0,20]]};
const timberGeo=timberBridge(sloping,{heightAt:()=>0,meshHeightAt:()=>0,seaLevel:-.2},[0,20],20,10,14);
const timberMesh=new THREE.Mesh(timberGeo,new THREE.MeshBasicMaterial({side:THREE.DoubleSide})),ray=new THREE.Raycaster();timberMesh.updateMatrixWorld();
const spacing=20/Math.ceil(20/.55);
for(let i=0;i<Math.ceil(20/.55);i++)for(const offset of [-.15,0,.15]){const z=(i+.5)*spacing+offset;ray.set(new THREE.Vector3(0,30,z),new THREE.Vector3(0,-1,0));const hit=ray.intersectObject(timberMesh)[0];assert(hit&&Math.abs(hit.point.y-(10+.2*z))<.00001,'plank top matches physical bridge plane');}
timberGeo.dispose();timberMesh.material.dispose();console.log('PASS rays on every sloping timber plank agree with the physical deck plane');

console.log('PASS actual ground at all trade footprints is above sea level');

// Read the actual triangles at accessory tops on a known sloping ground plane, independent of the mesher's layout.
const floor=(x,z)=>x*.1+z*.05;
for(const [kind,width,length,x,z,top] of [['forge',7,10,2.6,6,.95],['factory',9,19,5.5,-8.5,.9],['tannery',7,10,0,-7,1.2],['stables',9,19,-3.5,11.5,1.6],['quarry',11,12,1.3,3.6,1.225]]){
 const site={kind,width,length},geo=periodBuilding(site,false,floor),mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));mesh.updateMatrixWorld();
 ray.set(new THREE.Vector3(x,40,z),new THREE.Vector3(0,-1,0));const hit=ray.intersectObject(mesh)[0];
 assert(hit&&Math.abs(hit.point.y-(floor(x,z)+top))<.00001,'ground-fitted '+kind+' accessory '+JSON.stringify(hit?.point));geo.dispose();mesh.material.dispose();
}
console.log('PASS rendered anvil, factory crates, tannery vats, hitching posts and quarry cart follow sloping triangle heights');
