#!/usr/bin/env node
// Far views land state: accepts exactly BEFORE (no far pack) or AFTER (the committed pack in
// tools/far-views-delta.json, manifests carrying its far keys) in every area, never a mix.
// node tools/far-delta-check.mjs [--baked DIR] [--expect before|after] [--delta FOLDER] [--mutations]
// FAR_EXPECT=before|after does what --expect does.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=resolve(fileURLToPath(new URL('..',import.meta.url)));
export const LIST=JSON.parse(readFileSync(join(ROOT,'tools/far-views-delta.json'),'utf8'));
const GUYSBOROUGH_RECEIPT=join(ROOT,'tools/guysborough-turbines-delta/hashes.json');
export const GUYSBOROUGH=existsSync(GUYSBOROUGH_RECEIPT)?JSON.parse(readFileSync(GUYSBOROUGH_RECEIPT,'utf8')):null;
const TROY_RECEIPT=join(ROOT,'tools/troy-westbay-delta/hashes.json');
export const TROY=existsSync(TROY_RECEIPT)?JSON.parse(readFileSync(TROY_RECEIPT,'utf8')):null;
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const json=path=>JSON.parse(readFileSync(path,'utf8'));

/** Build an alternate LIST with Guysborough turbines tall.json hashes and manifest.tall counts applied ('before' or 'after'). */
export function withGuysboroughDelta(base=LIST,delta=GUYSBOROUGH,side='after'){
 if(!delta)return null;
 const byPack=Object.fromEntries(delta.files.map(f=>[f.pack,f]));
 const packs={};
 for(const [pack,entry] of Object.entries(base.packs)){
  const g=byPack[pack];if(!g)return null;
  if(side==='before'){
   if(!g.before||!g.beforeManifestTall)return null;
   packs[pack]={files:{...entry.files,'tall.json':{sha256:g.before,bytes:g.beforeBytes??g.bytes}},manifest:{...entry.manifest,tall:g.beforeManifestTall}};
  }else{
   packs[pack]={files:{...entry.files,'tall.json':{sha256:g.sha256,bytes:g.bytes}},manifest:{...entry.manifest,tall:g.afterManifestTall}};
  }
 }
 return {...base,packs};
}

/** Build an alternate LIST with the Troy-to-West Bay cansocauseway tall.json mid-box update applied. */
export function withTroyWestbayDelta(base,delta=TROY){
 if(!base||!delta)return null;
 const pack=delta.pack??'areas/cansocauseway';
 const entry=base.packs[pack];if(!entry)return null;
 const tall=delta.files?.find(f=>f.file===pack+'/tall.json');
 if(!tall?.sha256)return null;
 return {...base,packs:{...base.packs,[pack]:{...entry,files:{...entry.files,'tall.json':{sha256:tall.sha256,bytes:tall.bytes}}}}};
}

function landStateFor(baked,list){
 const states=new Set();
 for(const [pack,{files,manifest:patch}] of Object.entries(list.packs)){
  const dir=join(baked,pack),manifest=json(join(dir,'manifest.json'));
  const far=Object.keys(files).filter(n=>n!=='tall.json');
  const present=far.filter(n=>existsSync(join(dir,n)));
  if(!present.length&&!('farLand' in manifest)){
   // The game's tallKey gate (main.ts) reads tall.far: a far count without the pack would be a half install.
   assert.ok(!('far' in (manifest.tall??{})),pack+': manifest tall key has a far count without the far pack');
   // Before: the live tall.json is the old file (no version field), which the game ignores; a v2 file here is a half install.
   if(existsSync(join(dir,'tall.json')))assert.notEqual(json(join(dir,'tall.json')).version,2,pack+': v2 tall.json without the far pack');
   states.add('before');continue;
  }
  assert.equal(present.length,far.length,pack+': far pack incomplete ('+present.join(', ')+')');
  for(const [name,want] of Object.entries(files)){
   const path=join(dir,name);
   assert.ok(existsSync(path),pack+': missing '+name);
   assert.equal(sha(path),want.sha256,pack+'/'+name+': sha256 differs from tools/far-views-delta.json');
  }
  assert.deepEqual(manifest.farLand,patch.farLand,pack+': manifest farLand key');
  assert.deepEqual(manifest.tall,patch.tall,pack+': manifest tall key');
  states.add('after');
 }
 assert.equal(states.size,1,'mixed land: some areas before, some after');
 return [...states][0];
}

/** 'before' or 'after' for one baked folder; throws on any mixed or unknown state. */
export function landState(baked,list=LIST,alts=list===LIST?(()=>{const gBefore=withGuysboroughDelta(list,GUYSBOROUGH,'before'),gAfter=withGuysboroughDelta(list,GUYSBOROUGH,'after');return [gBefore,gAfter,withTroyWestbayDelta(gAfter,TROY)].filter(Boolean);})():[]){
 try{return landStateFor(baked,list);}
 catch(firstError){
  for(const alt of alts){try{return landStateFor(baked,alt);}catch{}}
  throw firstError;
 }
}

/** The delta folder holds every listed file at the committed hash, and its manifests carry the far keys. */
export function checkDelta(folder){
 const list=json(join(folder,'hashes.json'));
 for(const [pack,{files,manifest:patch}] of Object.entries(LIST.packs)){
  for(const [name,want] of Object.entries(files)){
   assert.equal(sha(join(folder,pack,name)),want.sha256,'delta '+pack+'/'+name);
   assert.ok(list.files.some(f=>f.file===pack+'/'+name&&f.sha256===want.sha256),'hashes.json lists '+pack+'/'+name);
  }
  const m=json(join(folder,pack,'manifest.json'));
  assert.deepEqual([m.farLand,m.tall],[patch.farLand,patch.tall],'delta manifest keys '+pack);
 }
 for(const f of list.files)assert.equal(sha(join(folder,f.file)),f.sha256,'hashes.json '+f.file);
}

/** Synthetic two-area land (no real data): the same rules accept before and after and reject each mutant. */
function mutations(){
 const tmp=mkdtempSync(join(tmpdir(),'far-delta-')),packs=['terrain','areas/a'],list={packs:{}};
 const before=join(tmp,'before'),after=join(tmp,'after');
 const write=(dir,pack,name,text)=>{mkdirSync(join(dir,pack),{recursive:true});writeFileSync(join(dir,pack,name),text);return join(dir,pack,name);};
 const unpack=(dir,pack)=>{
  for(const n of Object.keys(list.packs[pack].files))if(n!=='tall.json')rmSync(join(dir,pack,n));
  const p=join(dir,pack,'manifest.json'),m=json(p);delete m.farLand;writeFileSync(p,JSON.stringify(m));
 };
 try{
  for(const pack of packs){
   const files={},patch={tall:{file:'tall.json',turbines:1,far:2,towers:0,lines:0},farLand:{file:'far-land.json'}};
   write(before,pack,'manifest.json',JSON.stringify({origin:[0,0],tall:{file:'tall.json',turbines:0,towers:1,lines:1}}));
   write(before,pack,'tall.json',JSON.stringify({version:1}));
   write(after,pack,'manifest.json',JSON.stringify({origin:[0,0],...patch}));
   for(const [name,text] of [['tall.json',JSON.stringify({version:2,pack})],['far-land.json','{}'],['far-land-desktop.bin','d'+pack],['far-land-low.bin','l'+pack]])
    files[name]={sha256:sha(write(after,pack,name,text))};
   list.packs[pack]={files,manifest:patch};
  }
  assert.equal(landState(before,list),'before');assert.equal(landState(after,list),'after');
  const [first,second]=packs;
  const fails=(label,edit)=>{
   const dir=join(tmp,label);cpSync(after,dir,{recursive:true});edit(dir);
   assert.throws(()=>landState(dir,list),undefined,'mutant accepted: '+label);
  };
  fails('one-file-changed',d=>writeFileSync(join(d,first,'far-land-low.bin'),'x'));
  fails('one-file-missing',d=>rmSync(join(d,second,'far-land-desktop.bin')));
  fails('manifest-key-missing',d=>{const p=join(d,second,'manifest.json'),m=json(p);delete m.farLand;writeFileSync(p,JSON.stringify(m));});
  fails('tall-count-changed',d=>{const p=join(d,first,'manifest.json'),m=json(p);m.tall={...m.tall,far:m.tall.far+1};writeFileSync(p,JSON.stringify(m));});
  fails('mixed-areas',d=>{unpack(d,second);writeFileSync(join(d,second,'tall.json'),JSON.stringify({version:1}));});
  fails('v2-tall-without-pack',d=>{for(const pack of packs)unpack(d,pack);});
  fails('far-count-without-pack',d=>{for(const pack of packs){unpack(d,pack);writeFileSync(join(d,pack,'tall.json'),JSON.stringify({version:1}));}});
  // Alternate Guysborough revisions (before and after): uniform alt accepted, mixed revisions rejected.
  const beforeAlt=join(tmp,'before-alt'),afterAlt=join(tmp,'after-alt'),altFiles=[];
  cpSync(after,beforeAlt,{recursive:true});cpSync(after,afterAlt,{recursive:true});
  for(const pack of packs){
   const bText=JSON.stringify({version:2,pack,status:'built'}),bp=write(beforeAlt,pack,'tall.json',bText);
   const bmp=join(beforeAlt,pack,'manifest.json'),bm=json(bmp);bm.tall={...bm.tall,far:bm.tall.far+1};writeFileSync(bmp,JSON.stringify(bm));
   const aText=JSON.stringify({version:2,pack,status:'operating'}),ap=write(afterAlt,pack,'tall.json',aText);
   const amp=join(afterAlt,pack,'manifest.json'),am=json(amp);am.tall={...am.tall,far:am.tall.far+2};writeFileSync(amp,JSON.stringify(am));
   altFiles.push({pack,before:sha(bp),beforeBytes:bText.length,beforeManifestTall:bm.tall,sha256:sha(ap),bytes:aText.length,afterManifestTall:am.tall});
  }
  const alts=[withGuysboroughDelta(list,{files:altFiles},'before'),withGuysboroughDelta(list,{files:altFiles},'after')];
  assert.equal(landState(beforeAlt,list,alts),'after');
  assert.equal(landState(afterAlt,list,alts),'after');
  const mixedAlt=join(tmp,'mixed-alt');cpSync(beforeAlt,mixedAlt,{recursive:true});
  cpSync(join(afterAlt,second,'tall.json'),join(mixedAlt,second,'tall.json'));
  cpSync(join(afterAlt,second,'manifest.json'),join(mixedAlt,second,'manifest.json'));
  assert.throws(()=>landState(mixedAlt,list,alts),undefined,'mutant accepted: mixed-alt-revisions');
  const troyAlt=join(tmp,'troy-alt');cpSync(afterAlt,troyAlt,{recursive:true});
  const tText=JSON.stringify({version:2,pack:second,mid:[616076,5054180,628364,5072612]});
  const tp=write(troyAlt,second,'tall.json',tText);
  const troyList=withTroyWestbayDelta(alts[1],{pack:second,files:[{file:second+'/tall.json',sha256:sha(tp),bytes:tText.length}]});
  assert.equal(landState(troyAlt,list,[...alts,troyList]),'after');
  writeFileSync(tp,JSON.stringify({version:2,pack:second,mid:[0,0,1,1]}));
  assert.throws(()=>landState(troyAlt,list,[...alts,troyList]),undefined,'mutant accepted: tampered-troy-tall');
  console.log('PASS before, after and alt-after accepted; 9 mutants rejected (changed file, missing file, missing key, changed count, mixed areas, v2 tall without pack, far count without pack, mixed revisions, tampered troy tall)');
 }finally{rmSync(tmp,{recursive:true,force:true});}
}

if(import.meta.url===`file://${process.argv[1]}`){
 const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
 if(process.argv.includes('--mutations'))mutations();
 const baked=resolve(arg('--baked')??join(ROOT,'data/baked')),expect=arg('--expect')??process.env.FAR_EXPECT??null,delta=arg('--delta');
 const state=landState(baked);
 if(expect)assert.equal(state,expect,'expected '+expect+' land');
 console.log('PASS far land state: '+state+(expect?' (expected)':'')+' in '+Object.keys(LIST.packs).length+' areas');
 if(delta){checkDelta(resolve(delta));console.log('PASS delta folder matches tools/far-views-delta.json');}
}
