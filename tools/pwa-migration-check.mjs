import { readBaseline } from './baseline-source.mjs';
// Each numbered case fails on 83b8339; --mutations breaks each corrected rule once.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {harness,source} from './pwa-harness.mjs';
const code=process.argv.includes('--baseline')?readBaseline('pwa-migration','web/pwa/sw.js'):source;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const bounded=(p,ms)=>Promise.race([p,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('navigation exceeded '+ms+' ms')),ms);p.finally(()=>clearTimeout(timer)).catch(()=>{});})]);
const cases={
 async pin(code) {
  const h=await harness(code),a=h.build('A');await h.api.latest();await h.nav('a');await h.get('/terrain/tile.bin','a');await h.flush();
  h.build('B','land B');await h.nav('b');await h.flush();
  assert.equal(await(await h.get('/terrain/tile.bin','a')).text(),'land A','old page keeps saved A bytes');
  assert.ok(h.bins.has('mmm-offline-data-'+a.v.dataRevision),'live A store is retained');
  const miss=await h.get('/terrain/unseen.bin','a');assert.equal(miss.status,409,'old unsaved land must fail clearly');assert.equal(miss.headers.get('X-MMM-Update'),'1');
  assert.ok(h.messages.some(m=>m.id==='a'&&m.type==='version-unavailable'),'player receives reload notice');
  h.restart();assert.equal(await(await h.get('/terrain/tile.bin','a')).text(),'land A','binding survives worker restart');
  h.close('a');await h.message('status','b');await h.flush();assert.ok(!h.bins.has('mmm-offline-data-'+a.v.dataRevision),'last A page gone: A store collected');
  const cold=await harness(code),ca=cold.build('A');await cold.api.latest();cold.live.set('startup',true);cold.pageKeys.set('startup',ca.pageKey);
  cold.build('B','land B');await cold.message('prepare','startup');const file=await cold.get('/terrain/tile.bin','startup');
  assert.ok(file.status===409 || await file.text()==='land A','deploy between HTML and prepare cannot return B');
 },
 async deadline(code,log=false) {
  const timings={};
  for(const kind of ['stalled version','slow version','failing version','stalled inventory','stalled shell']) {
   const h=await harness(code);h.build('A');await h.api.latest();await h.nav('a');await h.flush();const b=h.build('B');
   let release;const stalled=()=>new Promise(resolve=>{release=()=>resolve(new Response('failed',{status:503}));});
   if(kind==='stalled version')h.routes.set('/version.json',stalled);
   if(kind==='slow version')h.routes.set('/version.json',async()=>{await delay(1700);return new Response(JSON.stringify(b.v));});
   if(kind==='failing version')h.routes.set('/version.json',new Response('failed',{status:503}));
   if(kind==='stalled inventory')h.routes.set(b.v.index,stalled);
   if(kind==='stalled shell')h.routes.set(b.appUrl,stalled);
   const start=Date.now();let error;
   try {const result=await bounded(h.nav('returning'),1350);timings[kind]=Date.now()-start;assert.equal(result.response.status,200);assert.match(result.body,/globalThis|<script/);assert.ok(timings[kind]<1250,kind+' took '+timings[kind]);}
   catch(e){error=e;}finally{release?.();await h.flush();}
   if(error)throw error;
  }
  const h=await harness(code);const a=h.build('A');await h.api.latest();await h.nav('a');const b=h.build('B');
  const next=await h.nav('b');assert.match(next.body,new RegExp(b.appUrl.replaceAll('.','\\.')),'fast network gets newest whole shell');
  const cold=await harness(code);const c=cold.build('C');assert.match((await cold.nav('first')).body,new RegExp(c.appUrl.replaceAll('.','\\.')),'first working visit gets latest whole build');
  if(!process.argv.includes('--baseline')) {
   const ready=await harness(code);ready.build('A');await ready.api.latest();await ready.nav('a');const prepared=ready.build('B');await ready.api.latest();
   let release;ready.routes.set('/version.json',()=>new Promise(r=>{release=()=>r(new Response('failed',{status:503}));}));
   const chosen=await bounded(ready.nav('next'),1350);release();await ready.flush();assert.match(chosen.body,new RegExp(prepared.appUrl.replaceAll('.','\\.')),'prepared app-only build is used on next navigation even if the probe stalls');
   const delivered=await harness(code),first=delivered.build('A');delivered.live.set('first',true);delivered.pageKeys.set('first',first.pageKey);delivered.routes.set('/version.json',new Response('failed',{status:503}));await delivered.message('prepare','first');await delivered.flush();assert.equal((await delivered.api.stored()).version.revision,first.v.revision,'first delivered shell is saved without a second blocking version dependency');
  }

  if(log){console.log('saved navigation timings (ms):',JSON.stringify(timings));writeFileSync((process.env.MMM_CHECK_OUT??'data/work/pwa')+'/saved-start-timings.json',JSON.stringify(timings,null,2)+'\n');}
 },
 async storage(code) {
  for(const [op,bucket] of [['open','data-'],['match','data-'],['open','meta-'],['match','meta-'],['open','shell-'],['match','shell-']]) {
   const h=await harness(code);h.build('A');await h.api.latest();await h.nav('a');await h.flush();
   if(bucket==='meta-')h.restart();
   h.fault({op,bucket});
   const result=bucket==='data-'?await h.get('/terrain/tile.bin','a'):(await h.nav('healthy')).response;
   assert.equal(result.status,200,op+' '+bucket+' healthy network');
   h.network(false);let error;try{if(bucket==='data-')await h.get('/terrain/unseen.bin','a');else await h.nav('offline');}catch(e){error=e;}
   assert.ok(error && !/blocked|SecurityError/.test(error.message),'offline failure is network failure, not leaked storage exception');
  }
  const h=await harness(code);h.build('A');await h.api.latest();await h.nav('a');h.fault({op:'open',bucket:'data-'});h.routes.set('/terrain/tile.bin',new Response('wrong!'));
  assert.equal((await h.get('/terrain/tile.bin','a')).status,409,'storage fallback still rejects integrity mismatch');
 },
 async job(code) {
  for(const op of ['open','keys']) {
   const h=await harness(code);h.build('A');const s=await h.api.latest();await h.nav('a');await h.flush();
   h.fault({op,bucket:'data-',name:'QuotaExceededError',once:true});const replies=[];
   try{await h.api.download(s,{postMessage:r=>replies.push(r),close(){}});}catch{}
   const retried=[];await h.api.download(s,{postMessage:r=>retried.push(r),close(){}});
   assert.equal(retried.at(-1)?.done,true,'setup '+op+' failure releases job for retry');
   const stopped=await h.message('stop','a');assert.equal(stopped.at(-1)?.running,false,'Stop survives a rejected old job');
   const removed=await h.message('remove','a',{confirmed:true});assert.equal(removed.at(-1)?.bytes,0,'Remove survives a rejected old job');
  }
 }
};
let failures=0;
for(const [name,test] of Object.entries(cases)) {try{await test(code,true);console.log('PASS',name);}catch(e){failures++;console.log('FAIL',name,e.message);}}
if(process.argv.includes('--mutations')&&!failures) {
 const changes=[
  ['pin',"if(s && (!pageKey || pageKey===s.pageKey)) { if(!b.seen) bind(id,s,event); return s; }","if(s) return await stored();"],
  ['deadline','NAVIGATION_BUDGET_MS = 1000','NAVIGATION_BUDGET_MS = 60000'],
  ['storage','catch { /* Read failure: use a verified network copy. */ }','catch(e) { throw e; }'],
  ['job','finally {await releaseFill(s);if(job===current) job=undefined;}','finally {await releaseFill(s);if(!error && job===current) job=undefined;}']
 ];
 for(const [name,from,to] of changes){assert.ok(code.includes(from),'mutation applies '+name);let failed=false;try{await cases[name](code.replace(from,to));}catch{failed=true;}assert.ok(failed,'escaped mutation '+name);console.log('caught mutation:',name);}
}
if(failures)process.exitCode=1;
export {cases};
