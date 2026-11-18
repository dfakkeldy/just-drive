import { readBaseline } from './baseline-source.mjs';
// A complete download is a durable offline choice, separate from an online shell.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {harness,source} from './pwa-harness.mjs';
const baseline=process.argv.includes('--baseline');
const code=baseline?readBaseline('pwa-opt-in','web/pwa/sw.js'):source;
const data=b=>'mmm-offline-data-'+b.v.dataRevision;
async function saved(code) {const h=await harness(code),a=h.build('A');await h.nav('a');await h.message('start','a');await h.flush();assert.equal((await h.message('status','a')).at(-1).done,true);return {h,a};}
async function offlineA(h,a) {
 await h.flush();for(const id of [...h.live.keys()])h.close(id);await h.api.collect();await h.flush();h.network(false);
 const page=await h.nav('return');assert.ok(h.bins.has(data(a)),'only complete A data must survive collection');assert.ok(page.body.includes(a.appUrl),'offline start selects complete A shell');
 assert.equal(await(await h.get('/terrain/unseen.bin','return')).text(),'land A unseen','offline A has its unvisited land');
}
async function half(h) {
 const response=h.routes.get('/terrain/unseen.bin');let entered=false;
 h.routes.set('/terrain/unseen.bin',({signal})=>new Promise((resolve,reject)=>{entered=true;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});}));
 const pending=h.message('start','b');const bucket='mmm-offline-data-'+(await h.api.stored()).version.dataRevision;while(!entered || !(h.bins.get(bucket)?.size>0))await new Promise(r=>setTimeout(r,1));
 await h.message('stop','b');await pending;h.routes.set('/terrain/unseen.bin',response);await h.flush();assert.equal((await h.message('status','b')).at(-1).done,false);
}
const cases={
 async 'A then B'(code) {const {h,a}=await saved(code);h.build('B','land B');await h.nav('b');await offlineA(h,a);},
 async 'A skips B for C'(code) {const {h,a}=await saved(code);h.build('B','land B');h.build('C','land C');await h.nav('c');await offlineA(h,a);},
 async 'half B then C'(code) {const {h,a}=await saved(code);const b=h.build('B','land B');await h.nav('b');await half(h);h.build('C','land C');await h.nav('c');await offlineA(h,a);},
 async 'quota during B fill'(code) {const {h,a}=await saved(code);h.build('B','land B');await h.nav('b');h.fault({op:'put',bucket:'data-',name:'QuotaExceededError',once:true});assert.match((await h.message('start','b')).at(-1).error,/Not enough room/);await offlineA(h,a);},
 async 'first completion quota is retryable'(code) {const h=await harness(code);h.build('A');await h.nav('a');h.fault({op:'put',bucket:'meta-',key:'/__mmm_offline_complete/',name:'QuotaExceededError'});const p=(await h.message('start','a')).at(-1);assert.equal(p.done,false);assert.match(p.error,/Not enough room/);assert.equal(p.bytes,p.total);h.fault(undefined);assert.equal((await h.message('status','a')).at(-1).done,true);},
 async 'quota on completion commit'(code) {
  const {h,a}=await saved(code);const b=h.build('B','land B');await h.nav('b');h.fault({op:'put',bucket:'meta-',key:'/__mmm_offline_complete/',name:'QuotaExceededError'});
  const result=(await h.message('start','b')).at(-1);assert.equal(result.done,false,'full bytes without a committed choice are not Done');assert.match(result.error,/Not enough room/);assert.equal(result.bytes,result.total,'resume knows bytes are already saved');
  await offlineA(h,a);h.fault(undefined);h.network(true);await h.nav('b-again');assert.equal((await h.message('status','b-again')).at(-1).done,true,'retry commits the full build after room is available');h.network(false);assert.ok((await h.nav('new-complete')).body.includes(b.appUrl));
 },
 async 'prepared update avoids repeated shell setup'(code) {const {h}=await saved(code),b=h.build('B','land B');await h.api.latest();vm.runInContext('saveShell=async()=>{throw Error("prepared shell must not be rewritten")}',h.context);assert.ok((await h.nav('b')).body.includes(b.appUrl),'prepared online update is selected without shell setup again');},
 async 'two tabs'(code) {const {h,a}=await saved(code);h.build('B','land B');await h.nav('b');assert.equal(await(await h.get('/terrain/unseen.bin','a')).text(),'land A unseen');assert.equal(await(await h.get('/terrain/tile.bin','b')).text(),'land B');h.close('a');await h.message('status','b');await offlineA(h,a);},
 async 'restart during interrupted fill'(code) {
  const {h,a}=await saved(code),b=h.build('B','land B');await h.nav('b');let entered=false;
  h.routes.set('/terrain/unseen.bin',({signal})=>new Promise((resolve,reject)=>{entered=true;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});}));
  const pending=h.message('start','b');while(!entered || !(h.bins.get(data(b))?.size>0))await new Promise(r=>setTimeout(r,1));
  // Capture only durable stores at the crash point, then start a fresh worker VM with no job or RAM identities.
  const bins=new Map([...h.bins].map(([name,bin])=>[name,new Map([...bin].map(([key,r])=>[key,r.clone()]))]));
  await h.message('stop','b');await pending;
  const fresh=await harness(code,{bins,routes:new Map(h.routes),live:new Map(h.live)});fresh.build('C','land C');await fresh.nav('c');await offlineA(fresh,a);
  assert.ok(fresh.bins.has(data(b)),'durable in-flight recovery record survives a true worker restart');
 },
 async 'month offline and skipped publishes'(code) {
  const {h,a}=await saved(code);vm.runInContext('Date = class extends Date {static now(){return super.now()+31*86400000;}}',h.context);
  h.network(false);assert.ok((await h.nav('month')).body.includes(a.appUrl));h.network(true);
  for(const label of ['B','C','D'])h.build(label,'land '+label);
  const e=h.build('E','land E');await h.nav('e');await offlineA(h,a);
  h.network(true);await h.nav('e2');assert.equal((await h.message('start','e2')).at(-1).done,true);await h.flush();
  h.network(false);assert.ok((await h.nav('latest-complete')).body.includes(e.appUrl),'E becomes offline choice only after full completion');
  assert.equal(await(await h.get('/terrain/unseen.bin','latest-complete')).text(),'land E unseen');
 },
 async 'collection after newer complete'(code) {const {h,a}=await saved(code),b=h.build('B','land B');await h.nav('b');await h.message('start','b');await h.flush();assert.ok(h.bins.has(data(a)),'live A remains while B is complete');h.close('a');await h.message('status','b');await h.flush();assert.ok(!h.bins.has(data(a)),'obsolete A is collected after its last page closes');assert.ok(h.bins.has(data(b)),'newest complete B remains');},
 async 'saved fallback remains removable'(code) {const {h}=await saved(code);h.build('B','land B');await h.nav('b');h.restart();const p=(await h.message('status','b')).at(-1);assert.equal(p.bytes,0);assert.equal(p.removable,true,'complete A can be removed even when current B has zero bytes');},
 async 'explicit removal clears the fallback'(code) {const {h,a}=await saved(code);h.build('B','land B');await h.nav('b');await h.message('remove','b',{confirmed:true});assert.equal(h.bins.get(data(a))?.size||0,0,'confirmed removal clears complete A too');},
 async 'overlapping workers cannot downgrade'(code) {const {h,a}=await saved(code);const newer=await harness(code,{bins:h.bins,routes:h.routes,live:h.live}),b=newer.build('B','land B');await newer.nav('b');await newer.message('start','b');await h.message('start','a');h.close('a');newer.restart();newer.network(false);assert.ok((await newer.nav('return')).body.includes(b.appUrl),'old worker cannot replace the durable newer completion');},
 async 'late older page cannot become newest'(code) {const h=await harness(code),a=h.build('A');h.live.set('a',true);h.pageKeys.set('a',a.pageKey);const b=h.build('B');await h.nav('b');await h.message('start','b');await h.message('start','a');h.build('C','land C');await h.nav('c');h.restart();h.network(false);assert.ok((await h.nav('return')).body.includes(b.appUrl),'build age must outrank the time an old tab reports');},
 async 'newer app prepared during a fill'(code) {
  const {h}=await saved(code),b=h.build('B','land B');await h.nav('b');let release;
  const response=h.routes.get('/terrain/unseen.bin').clone();h.routes.set('/terrain/unseen.bin',()=>new Promise(r=>release=()=>r(response)));
  const pending=h.message('start','b');while(!release)await new Promise(r=>setTimeout(r,1));const c=h.build('C','land B');await h.nav('c');release();await pending;await h.flush();
  h.network(false);assert.ok((await h.nav('return')).body.includes(c.appUrl),'newer prepared app sharing the finished fill becomes the complete offline choice');
 },
 async 'old prepared shell cannot override complete'(code) {const {h,a}=await saved(code),b=h.build('B');await h.nav('b');await h.message('start','b');const meta=await h.caches.open('mmm-offline-meta-v1');await meta.put('/__mmm_offline_ready',await meta.match('/__mmm_version/'+a.v.revision));h.restart();h.network(false);assert.ok((await h.nav('return')).body.includes(b.appUrl),'prepared slot cannot override newest complete build');},
 async 'older completion cannot downgrade'(code) {const {h,a}=await saved(code),b=h.build('B','land B');await h.nav('b');await h.message('start','b');await h.message('start','a');h.network(false);assert.ok((await h.nav('return')).body.includes(b.appUrl),'late old completion must not replace B');}
};
let failures=0;
for(const [name,test] of Object.entries(cases))try{await test(code);console.log('PASS',name);}catch(e){failures++;console.log('FAIL',name,e.message);}
if(!failures&&process.argv.includes('--mutations'))for(const [name,from,to,target]of[
 ['drop complete retention','saved?.version.revision,filling?.version.revision','undefined,filling?.version.revision','A then B'],
 ['drop interrupted fill retention','saved?.version.revision,filling?.version.revision','saved?.version.revision,undefined','restart during interrupted fill'],
 ['select incomplete offline','old=await offlineComplete() || selectedBefore','old=selectedBefore','A skips B for C'],
 ['promote shell only','if(!await isComplete(s))return false;','if(false)return false;','A then B'],
 ['forget complete on restart','async function offlineComplete() {','async function offlineComplete() {if(!complete)return undefined;','restart during interrupted fill'],
 ['announce uncommitted full bytes','done=false;error=e.name', 'done=true;error=e.name','quota on completion commit'],
 ['repeat prepared shell setup',"if(ready?.version.revision===v.revision) return {state:ready,verified:true};",'','prepared update avoids repeated shell setup'],
 ['ignore app-only completion','if(complete && ready && newestFirst(ready,complete)<0','if(false && complete && ready && newestFirst(ready,complete)<0','newer app prepared during a fill'],
 ['prepared overrides complete','if(!complete && old && ready','if(old && ready','old prepared shell cannot override complete'],
 ['forget build age','s.index.builtAt || s.order','s.order','late older page cannot become newest'],
 ['allow completion downgrade','b.order-a.order','a.order-b.order','older completion cannot downgrade']
]){assert.ok(code.includes(from),name+' applies');let caught=false;try{await cases[target](code.replaceAll(from,to));}catch{caught=true;}assert.ok(caught,'escaped mutation '+name);console.log('caught mutation:',name);}
if(failures)process.exitCode=1;
