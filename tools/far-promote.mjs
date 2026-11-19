#!/usr/bin/env node
// Prepare/verify are read-only on live data. Apply merges manifests only, after
// the owner copies the exact approved assets. Never copies a folder/snapshot.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync} from 'node:fs';
import {resolve,dirname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mergeFarManifest,manifestBytes} from './far-manifest.mjs';
export const PACKS=['terrain','areas/judique','areas/porthood','areas/pointtupper','areas/westbay','areas/cansocauseway'];
export const ASSETS=['tall.json','far-land.json','far-land-desktop.bin','far-land-low.bin'];
/** The phone's Coarse far views level (tools/far-pack.mjs --coarse) ships when the pack's far-land.json names it. */
export const COARSE_ASSET='far-land-coarse.bin';
export const packAssets=far=>far?.levels?.coarse?[...ASSETS,COARSE_ASSET]:ASSETS;
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=path=>existsSync(path)?hash(readFileSync(path)):null;
const read=path=>JSON.parse(readFileSync(path));
export function packRootFields(far,tall){
 assert.equal(tall.version,2,'version 2 tall required');assert.deepEqual(far.root,tall.root,'land/tall roots match');assert.equal(far.crs,tall.crs);const [x,y,x1,y1]=far.root;
 assert.equal(x1-x,y1-y,'square terrain root');return {crs:far.crs,origin:[x,y1],size:x1-x,village:far.origin};
}
export function checkLevelFiles(meta,folder){
 const names=Object.keys(meta.levels).sort();
 assert.ok(['desktop,low','coarse,desktop,low'].includes(names.join(',')),'two far terrain levels, or three with coarse');
 for(const name of names){const level=meta.levels[name];assert.equal(level.file,'far-land-'+name+'.bin');const bytes=readFileSync(resolve(folder,level.file));assert.equal(hash(bytes),level.sha256,'level binary SHA256 mismatch: '+name);assert.equal(bytes.length,level.bytes,'level binary size mismatch: '+name);}
}
export function checkRoot(live,expected){for(const key of ['crs','origin','size','village'])assert.deepEqual(live[key],expected[key],'root identity changed: '+key);}
export function preparePlan(dataRoot,packRoot){
 const live=resolve(dataRoot,'baked'),pack=resolve(packRoot),plan={version:2,live,pack,assets:[],manifests:[],inputs:[],screening:null,offlineMabouRawAdded:0};
 const screen=[];
 for(const area of PACKS){
  const base=resolve(live,area),source=resolve(pack,area),manifest=resolve(base,'manifest.json'),patchPath=resolve(source,'manifest-patch.json');
  const before=readFileSync(manifest),current=JSON.parse(before),patch=read(patchPath),far=read(source+'/far-land.json'),expected=packRootFields(far,read(source+'/tall.json'));checkRoot(current,expected);checkLevelFiles(far,source);
  const tall=read(source+'/tall.json');for(const key of ['turbines','far','towers','lines'])assert.equal(patch.tall[key],tall[key].length,'patch count mismatch: '+key);
  const after=manifestBytes(mergeFarManifest(current,patch));
  plan.manifests.push({area,target:manifest,before:hash(before),after:hash(after),patch:patchPath,patchHash:digest(patchPath),expected});
  for(const name of packAssets(far)){const from=resolve(source,name),target=resolve(base,name),bytes=readFileSync(from);plan.assets.push({source:from,target,sha256:hash(bytes),before:digest(target),bytes:bytes.length});if(area==='terrain')plan.offlineMabouRawAdded+=bytes.length-(existsSync(target)?readFileSync(target).length:0);}
  for(const name of ['roads.json','buildings.json']){const path=resolve(base,name);plan.inputs.push({path,sha256:digest(path)});}
  screen.push({area,base,candidate:resolve(source,'tall.json')});
 }
 // Rerun actual producer clearance against every current road/building set.
 // Global point omission means even one area's conflict requires a fresh bake.
 plan.screening=JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./far-screen.py',import.meta.url))],{input:JSON.stringify(screen),encoding:'utf8'}));
 for(const [area,r]of Object.entries(plan.screening)){assert.equal(r.windConflicts.length,0,'new turbine conflict: rerun step 34 first ('+area+')');assert.equal(r.structureConflicts.towers+r.structureConflicts.lines,0,'new structure conflict: rerun step 34 first ('+area+')');}
 verifyPlan(plan,false);return plan;
}
function verifyInputsAndAssets(plan,assetsReady){
 for(const input of plan.inputs)assert.equal(digest(input.path),input.sha256,'screening input changed; prepare again and rerun safety screen: '+input.path);
 for(const a of plan.assets){assert.equal(digest(a.source),a.sha256,'candidate asset changed: '+a.source);assert.equal(digest(a.target),assetsReady?a.sha256:a.before,'live asset changed: '+a.target);}
}
export function verifyPlan(plan,assetsReady=false){
 assert.equal(plan.version,2);verifyInputsAndAssets(plan,assetsReady);
 for(const m of plan.manifests){assert.equal(digest(m.target),m.before,'live manifest changed: '+m.target);assert.equal(digest(m.patch),m.patchHash,'patch changed: '+m.patch);const live=read(m.target);checkRoot(live,m.expected);assert.equal(hash(manifestBytes(mergeFarManifest(live,read(m.patch)))),m.after,'merged bytes changed');}
 return true;
}
export function applyPlan(plan){
 const written=[];
 try{
  verifyPlan(plan,true); // All targets must already contain the approved assets.
  for(const m of plan.manifests){
   verifyInputsAndAssets(plan,true);assert.equal(digest(m.patch),m.patchHash,'patch changed during apply');
   assert.equal(digest(m.target),m.before,'live manifest changed during apply');
   const live=read(m.target);checkRoot(live,m.expected);const bytes=manifestBytes(mergeFarManifest(live,read(m.patch)));assert.equal(hash(bytes),m.after);
   const tmp=m.target+'.far-merge.tmp';writeFileSync(tmp,bytes,{flag:'wx'});renameSync(tmp,m.target);written.push(m.target);
  }
  return written;
 }catch(error){
  error.writtenManifests=written;
  console.error('Manifest apply stopped; written manifests: '+JSON.stringify(written));
  throw error;
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=Object.fromEntries(process.argv.slice(3).reduce((out,v,i,a)=>i%2?out:[...out,[v,a[i+1]]],[])),mode=process.argv[2];
 if(mode==='prepare'){
  const data=resolve(args['--data-root']),pack=resolve(args['--pack-root']),out=resolve(args['--out']);
  assert.ok(out.startsWith(resolve(data,'work')+sep)&&!out.startsWith(pack+sep),'review plan belongs outside the asset tree');
  const plan=preparePlan(data,pack),bytes=Buffer.from(JSON.stringify(plan,null,2)+'\n');mkdirSync(dirname(out),{recursive:true});writeFileSync(out,bytes);
  console.log('Plan SHA256',hash(bytes));for(const m of plan.manifests)console.log(m.area,'before',m.before,'after',m.after);
  console.log('Offline Mabou raw growth',plan.offlineMabouRawAdded,'bytes; both terrain detail levels are cached');
 }else if(mode==='verify'||mode==='apply'){
  const bytes=readFileSync(resolve(args['--plan']));assert.equal(hash(bytes),args['--plan-sha256'],'plan changed');const plan=JSON.parse(bytes);
  if(mode==='apply')applyPlan(plan);else verifyPlan(plan,false);
  console.log(mode==='apply'?'Applied manifest patches only':'Verified hashes; no writes');
 }else throw Error('Use prepare --data-root D --pack-root P --out review.json, or verify/apply --plan review.json --plan-sha256 SHA');
}
