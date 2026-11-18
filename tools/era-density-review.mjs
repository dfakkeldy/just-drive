import {makeGround} from './phone-ground.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {densityFarms,gentleFarmGround,playableFootprint} from './era-density-placement.ts';
import {HistorySiting,siteCorners,farmBarn} from '../web/src/eras/history-sites.ts';
import {HistoryBridgeApproaches} from '../web/src/eras/history-approaches.ts';
import {Roads} from '../web/src/roads.ts';
import {historyGround} from '../web/src/eras/history-ground.ts';
import {historyLayout} from '../web/src/eras/history-layout.ts';
import {getDensityAuditData} from './era-density-data.mjs';
import {auditMarkRecords,privateDensityAudit} from './era-density-private.mjs';
const origin=[624271,5103301],root=process.env.MMM_ROOT??process.cwd();
const site={id:'synthetic',kind:'farm',word:'',source:'',x:0,z:0,yaw:0,width:7,length:9,method:'farm',moved:0};
const env={origin,safe:()=>true,ground:()=>10,cover:()=>2,road:()=>null};
const cases=[];const test=(name,fn)=>cases.push([name,fn]);
test('no-runtime-placement-reads',async()=>{
 let reads=0;const saved=globalThis.fetch;globalThis.fetch=async()=>{reads++;throw Error('unexpected placement read');};
 try{await historyGround(JSON.parse(readFileSync(root+'/data/baked/terrain/manifest.json')),root+'/data/baked/terrain');historyLayout(origin);assert.equal(reads,0);}finally{globalThis.fetch=saved;}
 const scene=readFileSync(root+'/web/src/eras/history-scene.ts','utf8');assert(!scene.includes('new HistorySiting')&&!scene.includes('densityFarms'),'runtime must decode committed layout only');
});
test('bridge-only-ground-budget',async()=>{
 makeGround();const original=globalThis.fetch,requests=[];globalThis.fetch=async path=>{requests.push(String(path));return original(path);};
 const manifest=JSON.parse(readFileSync(root+'/data/baked/terrain/manifest.json')),raw=JSON.parse(readFileSync(root+'/data/baked/terrain/roads.json'));
 try{
  const start=performance.now(),ground=await historyGround(manifest,root+'/data/baked/terrain',raw.roads.filter(r=>r.bridge&&r.kind!==5).flatMap(r=>r.pts)),elapsedMs=performance.now()-start;
  assert(requests.every(p=>p.includes('/6/')),'bridge reader must never load the wide coarse grid');
  const network=new Roads(raw,origin,{cartRoads:true}),approaches=new HistoryBridgeApproaches(network,{seaLevel:-.2,exag:1.5},ground);assert.equal(approaches.audit.missing,0,'all bridge banks and approach tails have narrow samples');
  const receipt={elapsedMs,requests:requests.length,bytes:requests.reduce((n,p)=>n+statSync(p).size,0),wideRequests:0,wideBytes:0};
  if(process.env.DENSITY_STARTUP_NODE_OUT)writeFileSync(process.env.DENSITY_STARTUP_NODE_OUT,JSON.stringify(receipt,null,2));console.log('BRIDGE STARTUP',JSON.stringify(receipt));
 }finally{globalThis.fetch=original;}
});
test('narrow-fine-bank',()=>{assert.equal(gentleFarmGround(site,x=>x>=.75&&x<=1.75?2:0),false);assert.equal(gentleFarmGround(site,(x,z)=>10+.03*x+.02*z),true);});
test('wall-house-and-barn',()=>{
 assert.equal(playableFootprint({...site,x:632433.84-origin[0]},origin),false);
 const s={...site,x:632324-origin[0],barn:{x:12,z:-14}};assert(playableFootprint(s,origin));assert(!playableFootprint(farmBarn(s),origin),'barn footprint must also stay inside wall');
 const r=densityFarms([],[],env);for(const s of r.farms){assert(playableFootprint(s,origin));if(s.barn)assert(playableFootprint(farmBarn(s),origin));}
});
test('timber-approaches-all-kinds',()=>{
 const terrain={seaLevel:-.2,exag:1.5,cartRoads:true},roads=new Roads({roads:[{id:1,kind:3,halfWidth:2.1,bridge:true,pts:[[624271,5103301],[624271,5103291]]}]},origin,terrain),approach=new HistoryBridgeApproaches(roads,terrain,()=>10);
 const siting=new HistorySiting(roads.roads,null,origin,()=>true,()=>10,()=>2,approach.sites);
 assert(!siting.safe({...site,z:-35}));assert(!siting.safe({...site,kind:'shop',z:-35}));assert(siting.safe({...site,z:-80}));
});
test('deficits-never-move',()=>{
 const safe=s=>!(s.x+origin[0]>=617076&&s.x+origin[0]<618076&&origin[1]-s.z>=5095140&&origin[1]-s.z<5096140),r=densityFarms([],[],{...env,safe});
 assert.equal(r.farms.length,300);assert.equal(r.audit.cells['E00-N00'].built,0,'empty neighbour must remain empty');assert.equal(r.audit.cells['E01-N00'].built,0);
 assert.deepEqual(r.audit.deficits,[{cell:'E01-N00',counted:2,built:0,reason:'no buildable fine-ground footprint inside playable bounds and clear of approaches'}]);
 assert(!('overflow'in r.audit),'there is no cross-cell overflow channel');
});
test('private-input-not-vacuous',()=>{
 const marks=Array.from({length:345},(_,i)=>({e:100000+i*100,n:100000})),inset=Array.from({length:67},()=>({e:null,n:null,source_panel:'village-inset'}));
 for(const bad of [{marks:[]},{bad:true},{marks:[{},...marks.slice(1),...inset]},{marks:[...marks.slice(1),...inset]}])assert.throws(()=>auditMarkRecords(bad,[site],origin,()=>{}));
 const valid={marks:[...marks,...inset]};assert.equal(auditMarkRecords(valid,[site],origin,()=>{}).marks,345);
 marks[0]={e:origin[0]+100,n:origin[1]};assert.throws(()=>auditMarkRecords({marks:[...marks,...inset]},[{...site,barn:{x:100,z:0}}],origin,()=>{}),'barn centre must be tested');
 const lines=[];const absent=privateDensityAudit(root+'/data/work/history-1884/density/__optional_inventory_absent__.json',[site],origin,s=>lines.push(s));assert(absent.skipped);assert.match(lines[0],/^SKIP private mark separation:/);
});
test('street-frontage-and-lane-count',()=>{
 const raw=JSON.parse(readFileSync(root+'/data/baked/terrain/roads.json')),roads=new Roads(raw,origin,{cartRoads:true}),{farms}=historyLayout(origin),village=farms.filter(s=>s.zone==='village');
 assert.equal(village.length,35);assert(village.filter(s=>roads.nearest(s.x,s.z,25,r=>r.kind>=1&&r.kind<=3)).length>=30,'village homes must front main/connecting roads');
 assert(village.filter(s=>village.some(p=>p!==s&&Math.hypot(p.x-s.x,p.z-s.z)>=15&&Math.hypot(p.x-s.x,p.z-s.z)<=30)).length>=30,'village should read as a close street group');
 const far=farms.filter(s=>s.zone!=='village'&&!roads.nearest(s.x,s.z,60,r=>r.kind>=1&&r.kind<=4)).length;
 assert.equal(getDensityAuditData().header.ruralBeyond60m,far);assert.equal(getDensityAuditData().audit.ruralBeyond60m,far);
});
for(const [name,fn]of cases){await fn();console.log('PASS density regression',name);}
