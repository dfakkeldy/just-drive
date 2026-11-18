import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {preparePlan,verifyPlan,applyPlan,hash,PACKS,ASSETS,checkRoot} from './far-promote.mjs';
import {overlayManifest,manifestBytes,mergeFarManifest} from './far-manifest.mjs';
assert.match(readFileSync(new URL('./far-views-serve.mjs',import.meta.url),'utf8'),/await overlayManifest\(data,bake,match\[1\],before\)/,'server uses the tested live overlay');
const dir=realpathSync(mkdtempSync(tmpdir()+'/far-promotion-')),data=dir+'/data',pack=dir+'/pack';
const json=(p,value)=>writeFileSync(p,JSON.stringify(value)+'\n');
try{
 for(const area of PACKS){const live=data+'/baked/'+area,work=pack+'/'+area;mkdirSync(live,{recursive:true});mkdirSync(work,{recursive:true});
  const manifest={crs:'EPSG:2961',origin:[0,100],size:100,village:[50,50],roadGround:{version:1}};
  const point={e:50,n:50,hub:100,diameter:100,ground:20,source:'NRCan',id:'one'};
  json(live+'/manifest.json',manifest);json(live+'/roads.json',{roads:[]});json(live+'/buildings.json',{buildings:[]});
  json(live+'/tall.json',{turbines:[point,{...point,e:90}],far:[],towers:[{e:2,n:2}],lines:[{pts:[[1,1],[2,2]]}]});
  json(work+'/tall.json',{version:2,crs:'EPSG:2961',root:[0,0,100,100],turbines:[point],far:[],towers:[],lines:[]});
  json(work+'/far-land.json',{crs:'EPSG:2961',root:[0,0,100,100],origin:[50,50],levels:{desktop:{file:'far-land-desktop.bin',sha256:hash(Buffer.from('desktop')),bytes:7},low:{file:'far-land-low.bin',sha256:hash(Buffer.from('low')),bytes:3}}});
  writeFileSync(work+'/far-land-desktop.bin','desktop');writeFileSync(work+'/far-land-low.bin','low');
  json(work+'/manifest-patch.json',{tall:{file:'tall.json',turbines:1,far:0,towers:0,lines:0},farLand:{file:'far-land.json'}});
 }
 const target=data+'/baked/terrain/manifest.json',old=readFileSync(target),current=JSON.parse(old),patch=JSON.parse(readFileSync(pack+'/terrain/manifest-patch.json'));
 // A leftover stale snapshot cannot revert a new live key.
 json(pack+'/terrain/manifest.json',{...current,roadGround:{version:0}});
 json(target,{...current,roadGround:{version:2},futureKey:{kept:true}});
 const over=JSON.parse(await overlayManifest(data,pack,'terrain'));assert.equal(over.roadGround.version,2);assert.equal(over.futureKey.kept,true);
 const before=JSON.parse(await overlayManifest(data,pack,'terrain',true));assert.equal(before.futureKey.kept,true);assert.equal(before.farLand,undefined);
 const metadata=pack+'/terrain/far-land.json',metaBefore=readFileSync(metadata),badMeta=JSON.parse(metaBefore);badMeta.levels.low.sha256='0'.repeat(64);json(metadata,badMeta);assert.throws(()=>preparePlan(data,pack),/level binary SHA256 mismatch/);writeFileSync(metadata,metaBefore);
 const plan=preparePlan(data,pack);assert.equal(plan.screening.terrain.removedCounts.line,1);assert.equal(plan.screening.terrain.removedCounts.mast,1);assert.equal(plan.screening.terrain.removedCounts.wind,1);verifyPlan(plan);
 const saved=readFileSync(target);writeFileSync(target,JSON.stringify(JSON.parse(saved),null,2)+'\n');assert.throws(()=>verifyPlan(plan),/live manifest changed/);writeFileSync(target,saved);
 const roads=data+'/baked/areas/judique/roads.json',oldRoads=readFileSync(roads);json(roads,{roads:[{id:1,kind:4,halfWidth:2,pts:[[0,50],[100,50]]}]});
 assert.throws(()=>verifyPlan(plan),/screening input changed/);assert.throws(()=>preparePlan(data,pack),/new turbine conflict/);writeFileSync(roads,oldRoads);
 const fields=plan.manifests[0].expected;
 for(const key of ['crs','origin','size','village'])assert.throws(()=>checkRoot({...fields,[key]:null},fields),/root identity changed/);
 assert.throws(()=>applyPlan(plan),/live asset changed/);assert.equal(hash(readFileSync(target)),hash(saved),'failed preflight writes no manifests');
 for(const a of plan.assets)writeFileSync(a.target,readFileSync(a.source));verifyPlan(plan,true);
 const beforeManifests=new Map(plan.manifests.map(m=>[m.target,readFileSync(m.target)])),rename=fs.renameSync;
 fs.renameSync=(from,to)=>{rename(from,to);if(to===plan.manifests[0].target)fs.appendFileSync(plan.manifests[1].target,' ');};syncBuiltinESMExports();
 try{assert.throws(()=>applyPlan(plan),error=>{assert.deepEqual(error.writtenManifests,[plan.manifests[0].target],'partial apply reports exactly the committed manifest');assert.match(error.message,/live manifest changed during apply/);return true;});}
 finally{fs.renameSync=rename;syncBuiltinESMExports();for(const [path,bytes]of beforeManifests)writeFileSync(path,bytes);}
 assert.equal(applyPlan(plan).length,6);
 for(const m of plan.manifests)assert.equal(hash(readFileSync(m.target)),m.after,'exact approved merged bytes');
 assert.equal(JSON.parse(readFileSync(target)).futureKey.kept,true);
 // The far browser rows serve a promoted snapshot (bake = data/baked, no manifest-patch.json): its manifests must load.
 for(const area of PACKS){const after=JSON.parse(await overlayManifest(data,data+'/baked',area)),promoted=JSON.parse(readFileSync(data+'/baked/'+area+'/manifest.json'));
  assert.deepEqual(after,promoted,'promoted overlay serves the live manifest: '+area);assert.equal(after.farLand.file,'far-land.json');
  const plain=JSON.parse(await overlayManifest(data,data+'/baked',area,true));assert.equal(plain.farLand,undefined);assert.equal(plain.tall,undefined);}
 if(process.argv.includes('--mutations')){
  const manifestSource=readFileSync(new URL('./far-manifest.mjs',import.meta.url),'utf8');
  const bad=await import('data:text/javascript;base64,'+Buffer.from(manifestSource.replace('return {...live,...patch};','return {...patch};')).toString('base64'));
  assert.throws(()=>assert.equal(bad.mergeFarManifest({futureKey:1},patch).futureKey,1),{name:'AssertionError'});console.log('KILLED live overlay key dropped');
  let source=readFileSync(new URL('./far-promote.mjs',import.meta.url),'utf8').replace("from './far-manifest.mjs'","from '"+new URL('./far-manifest.mjs',import.meta.url).href+"'");
  const anchor="assert.equal(digest(m.target),m.before,'live manifest changed: '+m.target);";assert.equal(source.split(anchor).length,2);
  const noHash=await import('data:text/javascript;base64,'+Buffer.from(source.replace(anchor,'')).toString('base64'));
  // Restore pre-apply state, changing only whitespace in one manifest.
  for(const m of plan.manifests){const value=JSON.parse(readFileSync(m.target));delete value.tall;delete value.farLand;writeFileSync(m.target,manifestBytes(value));m.before=hash(readFileSync(m.target));}
  writeFileSync(target,JSON.stringify(JSON.parse(readFileSync(target)),null,2)+'\n');
  assert.throws(()=>verifyPlan(plan,true),/live manifest changed/);assert.doesNotThrow(()=>noHash.verifyPlan(plan,true));console.log('KILLED before-hash guard removed (semantic bytes unchanged)');
  const checksum="assert.equal(hash(bytes),level.sha256,'level binary SHA256 mismatch: '+name);";assert.equal(source.split(checksum).length,2);
  const noChecksum=await import('data:text/javascript;base64,'+Buffer.from(source.replace(checksum,'')).toString('base64'));
  assert.doesNotThrow(()=>noChecksum.checkLevelFiles(badMeta,pack+'/terrain'));console.log('KILLED declared level checksum ignored');

 }
 console.log('PASS live overlay, exact-byte patch merges, both inventory disclosures, root/hash stops and current road re-screening; synthetic fixtures only');
}finally{rmSync(dir,{recursive:true});}
