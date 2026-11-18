// Exhaust every reachable single-operation fault on each scenario's no-failure trace.
// Include the required ordinary-return tail in the fault sites; two extra lifecycle signals only observe convergence.
// Extra internal retry operations require the earlier fault, so cannot themselves be the first single fault.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { modules, boundary } from './touch-quality-module.mjs';
import { Element, environment } from './touch-quality-storage-fixture.mjs';
const D='mmm.detail',M=D+'.trying',U=D+'.unfinished',X=D+'.deaths',N=D+'.recovered',P='mmm.phone.picture';
export class OperationStore {
 constructor(initial={[D]:'high'},fault){this.data=new Map(Object.entries(initial));this.ops=[];this.previous=new Map();this.fault=fault;this.used=false;this.blocked=false;}
 op(type,key,value){
  const call={index:this.ops.length+1,type,key,value};this.ops.push(call);
  if(this.fault?.index===call.index){this.used=true;this.failedAt={action:this.action,events:this.events};const kind=this.fault.kind;if(kind==='throw')throw Error('one injected operation');if(type==='get')return {override:true,value:kind==='noop'?undefined:this.previous.get(key)??(this.data.get(key)===null?'high':null)};return {override:true};}
  if(this.permanentRule?.(call))return {override:true};
  if(this.blocked)throw Error('browser blocks storage');
 }
 getItem(key){const result=this.op('get',key);return result?.override?result.value:this.data.get(key)??null;}
 setItem(key,value){if(this.op('set',key,String(value))?.override)return;this.previous.set(key,this.data.get(key)??null);this.data.set(key,String(value));}
 removeItem(key){if(this.op('remove',key,null)?.override)return;this.previous.set(key,this.data.get(key)??null);this.data.delete(key);}
}
const record=store=>Object.fromEntries([...store.data].sort(([a],[b])=>a.localeCompare(b)));
export class World {
 constructor(api,initial,fault){this.api=api;this.store=new OperationStore(initial,fault);this.errors=[];this.checkpoints=[];this.events=0;this.action=0;this.fallback=false;this.evidence=false;this.serial=0;this.notices=new Map();this.decisionPages=new Set();}
 check(ok,message){if(!ok)this.errors.push(message);}
 step(name,fn,lifecycle=false){this.action++;if(lifecycle)this.events++;this.store.action=this.action;this.store.events=this.events;fn();this.checkpoints.push({name,events:this.events,state:record(this.store)});}
 notice(){const panel=new Element();this.p.q.notice(panel);for(const line of panel.children){const key=this.serial;this.notices.set(key,(this.notices.get(key)??0)+1);this.check(this.notices.get(key)<=1,'iv duplicate warning');if(line.textContent.includes('too much'))this.check(this.evidence,'iii false device warning');}}
 decision(){if(this.p.q.session.reason&&!this.decisionPages.has(this.p)){this.decisionPages.add(this.p);this.serial++;this.fallback=true;}this.check(this.p.nav.length<=1,'ii more than one reload for one decision');}
 load(href='https://example.test/',continuation=false){this.step('start',()=>{const env=environment(this.store,href);globalThis.devicePixelRatio=3;this.p={...env,q:this.api.startTouchQuality(true,new URL(href).searchParams.get('q'),env.clock)};this.check(!this.fallback||this.p.q.low,'i Full detail after fallback');if(continuation)this.decisionPages.add(this.p);else this.decision();this.notice();});this.navigate();}
 navigate(){if(this.p.nav.length){const old=this.p,href=old.nav[0];this.check(old.nav.length<=1,'ii repeated navigation');this.leave();this.load(href,true);this.check(this.p.nav.length===0,'ii recursive recovery reload');}}
 health(){this.step('health',()=>{this.p.q.frame(0,false);for(let n=0;n<400;n++){this.p.advance(50);this.p.q.frame(.05,true,true);}});this.decision();this.navigate();}
 crawl(){this.evidence=true;this.step('crawl',()=>{this.p.q.frame(0,false);for(let n=0;n<100;n++){this.p.advance(200);this.p.q.frame(.2,true,true);}});this.decision();this.navigate();}
 lost(){this.evidence=true;this.step('context loss',()=>{const canvas=new EventTarget();this.p.q.watch(canvas);canvas.dispatchEvent(new Event('webglcontextlost'));});this.decision();this.navigate();}
 death(){this.evidence=true;this.load();}
 hide(){this.step('hidden',()=>this.p.hide(),true);}show(){this.step('visible',()=>this.p.show(),true);}
 leave(){this.step('pagehide',()=>this.p.leave(),true);}freeze(){this.step('freeze',()=>this.p.freeze(),true);}
 resume(){this.step('resume',()=>this.p.doc.dispatchEvent(new Event('resume')),true);}
 pageshow(){this.step('pageshow',()=>this.p.win.dispatchEvent(new Event('pageshow')),true);}
 reload(){this.leave();this.load();}
 switchOn(){this.step('switch on',()=>{const panel=new Element();let query;this.api.detailSetting({getExtension:()=>null,getParameter:()=> 'GPU'},panel,null,this.p.q.low,s=>{query=s;},true,this.p.q.writable,()=>this.p.q.chosen());const box=panel.children[0].children[0].children[0];box.checked=true;box.listeners.change();this.check(query!==undefined,'switch unexpectedly refused a single transient fault');this.fallback=false;});this.reload();}
 picture(choice){this.step('Picture '+choice,()=>{const panel=new Element();this.api.pictureSetting({setPixelRatio(){}},panel,null,undefined,true,this.p.q.low);const row=panel.children[0].children[1];row.children.find(b=>b.dataset.picture===choice).listeners.click();});}
 finish(){this.leave();this.load();this.leave();this.load();this.hide();this.leave();this.decision();return this;}
}
export const scenarios=[];
const add=(name,run,initial)=>scenarios.push({name,run,initial});
add('fresh-touch-start',w=>w.load(),{});
add('switch-on-and-reload',w=>{w.load();w.switchOn();},{});
add('phone-Picture-choices',w=>{w.load();for(const c of ['sharp','fast','balanced'])w.picture(c);},{});
add('full-detail-Picture-choices',w=>{w.load();w.picture('fast');w.picture('sharp');});
add('existing-probe-cleanup',w=>w.load(),{[D]:'high',[D+'.probe']:'previous'});
add('start-health-clean-leave',w=>{w.load();w.health();w.hide();w.leave();});
for(const count of [1,2,3])add('unfinished-clean-leave-'+count,w=>{w.load();for(let n=0;n<count;n++)w.reload();});
add('death-at-try',w=>{w.load();w.death();});
for(const count of [1,2])add('death-at-ok-'+count,w=>{w.load();for(let n=0;n<count;n++){w.health();w.death();}});
for(const healthy of [false,true]){
 add('context-'+(healthy?'after':'before')+'-health',w=>{w.load();if(healthy)w.health();w.lost();});
 add('crawl-'+(healthy?'after':'before')+'-health',w=>{w.load();if(healthy)w.health();w.crawl();});
}
add('recovery-then-return',w=>{w.load();w.lost();w.reload();});
add('recovery-then-switch-on',w=>{w.load();w.lost();w.switchOn();});
add('blocked-at-start',w=>{w.store.blocked=true;w.load();w.check(w.p.q.low&&!w.p.q.writable,'blocked start must be phone/disabled');w.store.blocked=false;w.hide();w.leave();});
add('blocked-at-start-silent-existing-probe',w=>{
 w.store.permanentRule=c=>c.type!=='get';w.load();w.check(w.p.q.low&&!w.p.q.writable,'blocked probe must require an actual change');
 w.store.permanentRule=undefined;w.hide();w.leave();
},{[D+'.probe']:'1'});
for(const state of ['absent','try','ok','left-try','left-ok'])for(const pair of ['hide-show','freeze-resume','pagehide-pageshow'])add(state+'-'+pair,w=>{
 w.load();if(state.includes('ok'))w.health();if(state.startsWith('left-'))w.hide();
 if(pair==='hide-show'){w.hide();w.show();}else if(pair==='freeze-resume'){w.freeze();w.resume();w.pageshow();}else{w.leave();w.pageshow();}
},state==='absent'?{[D]:'low'}:undefined);
export function run(api,scenario,fault){const w=new World(api,scenario.initial,fault);scenario.run(w);w.finish();w.scenarioOps=w.store.ops.length;w.hide();w.leave();return w;}
export function violations(result,baseline){
 const errors=[...result.errors];
 if(baseline){
  const failed=result.store.failedAt;
  for(let i=0;i<result.checkpoints.length;i++){
   const a=result.checkpoints[i],b=baseline.checkpoints[i];
   if(!b||a.name!==b.name){errors.push('v changed scenario action trace');break;}
   if(failed&&a.events>=failed.events+2&&JSON.stringify(a.state)!==JSON.stringify(b.state))errors.push('v state differs after two lifecycle events at '+a.name);
  }
  if(JSON.stringify(record(result.store))!==JSON.stringify(record(baseline.store)))errors.push('v stored state did not converge after two lifecycle events');
 }
 return [...new Set(errors)];
}
export function acceptedLimits(api){
 const shared=new World(api);shared.load();shared.health();shared.load();shared.health();shared.load();
 assert.ok(shared.errors.includes('iii false device warning'));
 assert.equal(shared.store.data.get(D),'low');
 assert.ok(shared.errors.every(e=>e==='iii false device warning'));
 console.log('EXCEPTION two-visible-windows-sharing-mark: the second visible opening at ok counts as a second death, as accepted');
 const leave=new World(api);leave.load();let dropped=0;
 leave.store.permanentRule=c=>c.type==='set'&&c.key===M&&c.value==='left-try'?(dropped++,true):false;
 leave.hide();leave.leave();leave.freeze();assert.ok(dropped>=6,'all three chances failed, including bounded attempts');
 leave.store.permanentRule=undefined;leave.load();
 assert.ok(leave.errors.includes('iii false device warning'));assert.equal(leave.store.data.get(D),'low');
 assert.ok(leave.errors.every(e=>e==='iii false device warning'));
 console.log('EXCEPTION every-clean-leave-write-fails: '+dropped+' failed writes across hidden/pagehide/freeze, more than one failure');
}
if(process.argv[1]?.endsWith('touch-quality-sweep.mjs')){
 const start=performance.now(),ref=process.env.TQ_BASE_REF,mutation=process.env.TQ_SWEEP_MUTATION,api=await modules(ref,mutation?(name,source)=>{if(name!=='quality-store.ts')return source;const changes={'quorum-removed':['if (seen.includes(value))','if (true)'],'single-mutation-attempt':['n < 2; n++','n < 1; n++'],'newer-intent-ignored':['this.intents.set(key, intent);','if (this.intents.has(key)) return !this.intents.get(key).pending; this.intents.set(key, intent);']};return source.replace(...changes[mutation]);}:undefined);if(!ref)boundary();
 let count=0,failures=0;const first={},kinds={throw:0,noop:0,stale:0};
 for(const scenario of scenarios){
  const baseline=run(api,scenario);assert.deepEqual(baseline.errors,[],scenario.name+' baseline');
  for(const op of baseline.store.ops.slice(0,baseline.scenarioOps))for(const kind of op.type==='get'?['throw','noop','stale']:['throw','noop']){
   const result=run(api,scenario,{index:op.index,kind});assert.ok(result.store.used,scenario.name+' operation reached');count++;kinds[kind]++;
   const errors=violations(result,baseline);
   if(errors.length){failures++;for(const error of errors){const id=error.slice(0,error.indexOf(' '));if(!first[id]){first[id]={scenario:scenario.name,operation:op,kind,error,final:record(result.store),baseline:record(baseline.store)};console.error('FIRST FAIL',JSON.stringify(first[id]));}}}
  }
 }
 if(!ref)acceptedLimits(api);
 console.log(JSON.stringify({scenarios:scenarios.map(s=>s.name),cases:count,failureKinds:kinds,failures,seconds:Math.round((performance.now()-start)/10)/100}));
 if(failures)process.exitCode=1;
}
