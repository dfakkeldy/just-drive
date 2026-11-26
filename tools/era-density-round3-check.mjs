import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {verifyDensityInputs,densityFingerprint,DENSITY_REGENERATE,DENSITY_VALIDATE} from './era-density-inputs.mjs';
import {densityGround} from './era-density-ground.mjs';
import {densityFarms} from './era-density-placement.ts';
import {planHistoryBoards,boardFootprint} from '../web/src/eras/history-board-sites.ts';
import {footprintsOverlap,footprintRoadClear} from '../web/src/eras/history-footprints.ts';
import {Roads} from '../web/src/roads.ts';import {getDensityAuditData} from './era-density-data.mjs';
import {codeUnitCompare} from '../web/src/eras/history-precision.ts';
import {farmBarn} from '../web/src/eras/history-sites.ts';
const root=process.env.MMM_ROOT??process.cwd(),base=root+'/data/baked/terrain',origin=[624271,5103301],data=getDensityAuditData(),quiet=()=>{};
const digest=b=>createHash('sha256').update(b).digest('hex');
const fixtures={'manifest.json':Buffer.from(JSON.stringify({cover:{file:'cover.png'}})),'cover.png':Buffer.from('cover'),'roads.json':Buffer.from('roads'),'streams.json':Buffer.from('streams'),'buildings.json':Buffer.from('buildings'),'8/0_0.png':Buffer.from('ground'),'8/0_0.r.png':Buffer.from('road field')};
const entries=Object.entries(fixtures).map(([file,b])=>({file,...densityFingerprint(file,b)})),terrain=entries.filter(e=>e.file.includes('/')),fp={files:Object.fromEntries(entries.filter(e=>!e.file.includes('/')).map(({file,...e})=>[file,e])),terrain:{files:terrain,count:terrain.length,sha256:digest(Buffer.from(terrain.map(e=>e.file+'\0'+e.sha256+'\n').join('')))}};
for(const file of Object.keys(fixtures))assert.throws(()=>verifyDensityInputs(base,fp,f=>f===file?Buffer.from('changed'):fixtures[f]),e=>e.message.includes(file)&&e.message.includes(DENSITY_REGENERATE)&&e.message.includes(DENSITY_VALIDATE),'changed input must name the file and both recovery commands');
assert.throws(()=>verifyDensityInputs(base,{files:{},terrain:{files:[],count:0}},()=>Buffer.from('')),/Missing input fingerprint|Empty/);
// Step 29's manifest.props, the paved install's manifest.paved, step 30's manifest.buildingStyles and far-data's manifest.tall may change; any other manifest key, or the old whole-file record, must not.
const withManifest=m=>f=>f==='manifest.json'?Buffer.from(JSON.stringify(m)):fixtures[f];
verifyDensityInputs(base,fp,withManifest({props:{poles:2789,serviceDrops:282},cover:{file:'cover.png'}}));
verifyDensityInputs(base,fp,withManifest({paved:{index:'paved/index.json',tiles:298},props:{poles:2789},cover:{file:'cover.png'}}));
verifyDensityInputs(base,fp,withManifest({buildingStyles:{file:'building-styles.json',count:668},cover:{file:'cover.png'}}));
verifyDensityInputs(base,fp,withManifest({tall:{file:'tall.json',turbines:2,far:164,towers:3,lines:1},cover:{file:'cover.png'}}));
assert.throws(()=>verifyDensityInputs(base,fp,withManifest({cover:{file:'cover.png'},village:[1,2]})),/Land input changed: manifest\.json/,'a changed manifest key other than props, paved, buildingStyles or tall must fail');
assert.throws(()=>verifyDensityInputs(base,{...fp,files:{...fp.files,'manifest.json':{sha256:digest(fixtures['manifest.json']),bytes:fixtures['manifest.json'].length}}},f=>fixtures[f]),/Stale manifest\.json fingerprint/,'a whole-file manifest fingerprint must be regenerated');
console.log('PASS manifest fingerprint leaves out only step 29 props, the paved key, step 30 building styles and tall, in any key order');
const mismatch=mkdtempSync(join(tmpdir(),'density-input-mismatch-'));
try{
 const manifest=JSON.parse(readFileSync(base+'/manifest.json'));for(const file of ['manifest.json',manifest.cover.file,'streams.json','buildings.json'])symlinkSync(base+'/'+file,mismatch+'/'+file);
 for(const level of Object.keys(manifest.levels))symlinkSync(base+'/'+level,mismatch+'/'+level);
 writeFileSync(mismatch+'/roads.json','deliberately invalid changed JSON');
 const result=spawnSync('bash',[root+'/tools/check-era-density.sh','--fingerprints'],{cwd:root,encoding:'utf8',env:{...process.env,DENSITY_FINGERPRINT_BASE:mismatch}});
 assert.notEqual(result.status,0);assert(result.stderr.includes('roads.json')&&result.stderr.includes(DENSITY_REGENERATE)&&result.stderr.includes(DENSITY_VALIDATE),'actual registered gate must hash before parsing an invalid changed input');
}finally{rmSync(mismatch,{recursive:true,force:true});}
console.log('PASS each input fingerprint mismatch names the file and regenerate/validate commands');
const temp=mkdtempSync(join(tmpdir(),'density-resolution-'));try{
 const m=JSON.parse(readFileSync(base+'/manifest.json'));writeFileSync(temp+'/manifest.json',JSON.stringify({...m,levels:{0:['0_0']}}));symlinkSync(base+'/0',temp+'/0');symlinkSync(base+'/'+m.cover.file,temp+'/'+m.cover.file);
 assert.throws(()=>densityGround(temp).height(0,0,'synthetic-coarse-site'),/synthetic-coarse-site.*missing fine tile 6\//);
}finally{rmSync(temp,{recursive:true,force:true});}
console.log('PASS coarse fallback is rejected with site id and missing tile');
const env={origin,safe:()=>true,ground:()=>10,cover:()=>2,road:()=>null},first=densityFarms([],[],env).farms.find(s=>s.zone!=='village'),board={...first,width:8,length:.18},second=densityFarms([],[],{...env,boards:[board]});
assert(!second.farms.some(f=>footprintsOverlap(board,f,1)));console.log('PASS house allocation reserves an existing board');
const roads=new Roads({roads:[{id:1,kind:3,halfWidth:2.1,bridge:false,name:'fixture',pts:[[origin[0],origin[1]-100],[origin[0],origin[1]+100]]}]},origin,{cartRoads:true});
const trade={id:'fixture-trade',kind:'forge',word:'FORGE',source:'',method:'road',moved:0,x:30,z:0,yaw:-Math.PI/2,width:7,length:10},b=planHistoryBoards([trade],roads,()=>2)[0],house={...trade,id:'fixture-house',kind:'farm',word:'',x:b.x,z:b.z,width:7,length:9};
const planned=planHistoryBoards([trade,house],roads,()=>2)[0];assert(!footprintsOverlap(boardFootprint(planned),house,1));assert(footprintRoadClear(boardFootprint(planned),roads.roads,1));console.log('PASS board planning avoids a pre-existing house and road');
const barnOwner={...house,x:b.x+100,yaw:0,barn:{x:-100,z:0}},barn=farmBarn(barnOwner);assert(footprintsOverlap(boardFootprint(b),barn,1),'fixture barn must block the original board');const barnPlan=planHistoryBoards([trade,barnOwner],roads,()=>2)[0];assert(!footprintsOverlap(boardFootprint(barnPlan),barn,1));console.log('PASS board planning avoids a pre-existing barn');
const buildings=[{id:999,x:0,y:0,axisDeg:0}],plain=densityFarms(buildings,[],env),saved={};for(const key of ['sin','cos','atan2','hypot']){saved[key]=Math[key];Math[key]=(...a)=>saved[key](...a)+1e-12;}let noisy;try{noisy=densityFarms(buildings,[],env);}finally{for(const key in saved)Math[key]=saved[key];}assert.deepEqual(noisy,plain);assert.deepEqual(['ä','a','Z','Å'].sort(codeUnitCompare),['Z','a','Å','ä']);
assert.equal(data.header.nodeVersion,'26.13.1');assert(!readFileSync(root+'/tools/era-density-placement.ts','utf8').includes('.localeCompare('));console.log('PASS code-unit order, quantized noisy math and explicit Node regeneration version');
