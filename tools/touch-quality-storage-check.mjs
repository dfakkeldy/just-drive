import assert from 'node:assert/strict';
import { transform } from '../web/node_modules/esbuild/lib/main.js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { FailureStore, Element, environment } from './touch-quality-storage-fixture.mjs';
import { modules } from './touch-quality-module.mjs';
const ref=process.env.TQ_BASE_REF,mutation=process.env.TQ_STORAGE_MUTATION;
const changes={
 'read-back-removed':['quality-store.ts', 'if (this.read(key) === intent.value)', 'if (true)'],
 'retry-removed':['quality-store.ts','if (visible && this.pending && this.clock() >= this.retryAt) this.retry();',''],
 'no-forced-recovery':['touch-quality.ts', "next.searchParams.set('q', 'low');", ''],
 'desktop-touch-rule':['detail.ts','if (touch) {','if (true) {'],
 'refused-cleanup-removed':['touch-quality.ts', 'writeVerified(DETAIL_TRYING, null);', ''],
};
const api=await modules(ref,mutation?(name,source)=>{
 if(mutation==='notice-order-swapped')return name==='touch-quality.ts'?source.replace("if (!writeVerified(NOTICE, 'shown:' + notice)) return;",'').replace("panel.classList.add('open');","panel.classList.add('open'); writeVerified(NOTICE, 'shown:' + notice);"):source;
 const [file,from,to]=changes[mutation];return name===file?source.replace(from,to):source;
}:undefined);
const adapter=api,detail=api,main=await modules(process.env.TQ_MAIN_REF??'origin/main',undefined,['detail']);
const cases={};
const add=(name,fn)=>cases[name]=fn;
const page=(store,href)=>{const env=environment(store,href);return {...env,q:adapter.startTouchQuality(true,new URL(globalThis.location.href).searchParams.get('q'),env.clock)};};
const health=p=>{p.q.frame(0,false,false);for(let n=0;n<1200;n++){p.advance(1000/60);p.q.frame(1/60,true,true);}};
const lowNext=(store,href)=>{const p=page(store,href);assert.equal(p.q.low,true,'the next page is phone detail');assert.equal(p.nav.length,0,'no further recovery reload');return p;};
add('clean-leave-write-retry',()=>{
 const store=new FailureStore(),p=page(store);let fail=true;store.arm(c=>c.key==='mmm.detail.trying'&&c.value==='left-try'&&fail?'throw':false);
 p.hide();p.leave();assert.equal(store.data.get('mmm.detail.trying'),'try');
 fail=false;p.freeze();assert.equal(store.data.get('mmm.detail.trying'),'left-try','freeze is a third leave attempt');
 assert.equal(p.q.persistence?.pending,false);const next=page(store);assert.equal(next.q.low,false);assert.equal(next.q.session.unfinished,1);assert.equal(store.data.get('mmm.detail.recovered'),undefined);
});
add('health-write-frame-retry',()=>{
 const store=new FailureStore(),p=page(store);let fail=true;store.arm(c=>c.key==='mmm.detail.trying'&&c.value==='ok'&&fail?'throw':false);
 health(p);assert.equal(p.q.session.mark,'ok');assert.equal(store.data.get('mmm.detail.trying'),'try');
 fail=false;const count=store.writes.length;p.advance(1999);p.q.frame(.1,true,true);assert.equal(store.writes.length,count,'no retry before two seconds');
 p.advance(1);p.q.frame(.1,true,true);assert.equal(store.data.get('mmm.detail.trying'),'ok','pending healthy record heals');assert.equal(p.q.persistence?.pending,false);
});
add('silent-write-drop-read-back',()=>{
 const store=new FailureStore();environment(store);store.data.set('mmm.detail.trying','try');store.arm(c=>c.key==='mmm.detail.trying'?'drop':false);
 assert.equal(detail.writeQuality({mark:'left-try',unfinished:0,deaths:0}),false,'a silently ignored write is not success');
});
add('recovery-never-restarts-full',()=>{
 for(const failure of ['always','once','detail-only','drop-detail']){
  const store=new FailureStore(),p=page(store);health(p);p.hide();assert.equal(store.data.get('mmm.detail.trying'),'left-ok');
  let failed=false;store.arm(c=>failure==='always'?'throw':failure==='once'&&!failed?(failed=true,'throw'):failure==='detail-only'&&c.key==='mmm.detail'?'throw':failure==='drop-detail'&&c.key==='mmm.detail'?'drop':false);
  const canvas=new EventTarget();p.q.watch(canvas);canvas.dispatchEvent(new Event('webglcontextlost'));
  assert.equal(p.nav.length,1);const address=p.nav[0];if(failure!=='once'){assert.equal(new URL(address).searchParams.get('q'),'low',failure+' carries phone detail');assert.equal(new URL(address).searchParams.get('detailRecovery'),'device');}
  // Storage may recover before the next page. The failed downgrade still cannot return to full.
  if(failure==='once')store.arm(()=>false);
  let next=lowNext(store,address);assert.equal(next.q.low,true);
  const panel=new Element();next.q.notice(panel);if(failure==='always')assert.equal(panel.children.length,0,'unconfirmed consumption loses the notice safely');else assert.equal(panel.children[0].textContent,'Full detail was too much for this device. Phone detail is back on.');
  if(failure!=='always')assert.equal(new URL(globalThis.location.href).searchParams.get('detailRecovery'),null,'address notice consumed once');
  for(let cycle=0;cycle<3;cycle++)lowNext(store,globalThis.location.href);
 }
});
add('recovery-transient-failure-after-clean-health',()=>{
 const store=new FailureStore(),p=page(store);health(p);p.hide();assert.equal(store.data.get('mmm.detail.trying'),'left-ok');
 store.arm(c=>c.n===1?'throw':false);const canvas=new EventTarget();p.q.watch(canvas);canvas.dispatchEvent(new Event('webglcontextlost'));
 assert.equal(p.nav.length,1);store.arm(()=>false);
 let href=p.nav[0];for(let cycle=0;cycle<3;cycle++){const next=lowNext(store,href);assert.equal(next.q.low,true);href=globalThis.location.href;}
});
add('start-mark-confirmed-before-other-writes',()=>{
 const store=new FailureStore();store.data.set('mmm.detail.unfinished','2');store.arm(c=>c.key==='mmm.detail.trying'?'drop':false);
 const p=page(store);assert.equal(p.q.low,true);assert.equal(p.q.writable,false);assert.equal(p.q.state,null);
 const mark=store.writes.findIndex(c=>c.key==='mmm.detail.trying');assert.ok(mark>=0);
 assert.ok(store.writes.slice(mark).every(c=>c.key==='mmm.detail.trying'),'only the marker is touched after refusing');assert.equal(store.writes.at(-1).value,null,'refusal queues cleanup');const after=store.writes.length;
 p.show();p.leave();p.freeze();p.advance(10000);p.q.frame(.2,true,true);assert.equal(store.writes.length,after);
});
add('every-owned-key-latest-intent',()=>{
 for(const key of ['mmm.detail','mmm.detail.trying','mmm.detail.unfinished','mmm.detail.deaths','mmm.detail.recovered','mmm.detail.probe','mmm.phone.picture','mmm.picture']){
  for(const signal of ['hide','leave','freeze','show','pageshow','resume']){
   const store=new FailureStore();store.data.clear();store.data.set(key,'old');const env=environment(store);const ledger=api.qualityStore(env.clock);
   store.arm(c=>c.key===key?'drop':false);
   assert.equal(detail.writeVerified(key,'new'),false);assert.equal(detail.writeVerified(key,null),false);assert.equal(ledger.snapshot.wanted[key],null);assert.equal(ledger.pending,true);
   store.arm(()=>false);
   if(signal==='pageshow')env.win.dispatchEvent(new Event(signal));else if(signal==='resume')env.doc.dispatchEvent(new Event(signal));else env[signal]();
   assert.equal(store.data.has(key),false,key+' '+signal+' retries the newer removal');assert.equal(ledger.pending,false);
  }
 }
});
add('refused-readback-queued-cleanup',()=>{
 const store=new FailureStore();const original=store.setItem.bind(store);let fail=false;
 store.setItem=(key,value)=>{original(key,value);if(key==='mmm.detail.trying'&&value==='try')fail=true;};
 store.readFail=key=>fail&&key==='mmm.detail.trying';store.arm(c=>fail&&c.key==='mmm.detail.trying'&&c.value===null?'drop':false);
 const p=page(store);assert.equal(p.q.low,true);assert.equal(p.q.writable,false);assert.equal(store.data.get('mmm.detail.trying'),'try');assert.equal(p.q.persistence.intents.wanted['mmm.detail.trying'],null);assert.equal(p.q.persistence.pending,true);
 fail=false;store.setItem=original;p.hide();p.leave();assert.equal(store.data.has('mmm.detail.trying'),false);assert.equal(p.q.persistence.pending,false);assert.equal(page(store).q.low,false);assert.equal(store.data.has('mmm.detail.recovered'),false);
});
add('notice-pending-consumption',()=>{
 const store=new FailureStore(),p=page(store);const canvas=new EventTarget();p.q.watch(canvas);canvas.dispatchEvent(new Event('webglcontextlost'));
 const phone=page(store);let fail=true;store.arm(c=>c.key==='mmm.detail.recovered'&&String(c.value).startsWith('shown:')&&fail?'drop':false);
 const a=new Element();phone.q.notice(a);assert.equal(a.children.length,0,'do not display an unconfirmed consumption');assert.equal(phone.q.persistence.pending,true);
 fail=false;phone.advance(1999);phone.q.frame(.1,true,true);assert.equal(store.data.get('mmm.detail.recovered'),'device');phone.advance(1);phone.q.frame(.1,true,true);assert.equal(store.data.get('mmm.detail.recovered'),'shown:device');
 const next=page(store),b=new Element();next.q.notice(b);assert.equal(b.children.length,0,'a consumed notice cannot repeat');
});
add('retry-throttle-and-confirmed-values',()=>{
 const store=new FailureStore(),p=page(store);let fail=true;store.arm(c=>c.key==='mmm.detail.trying'&&c.value==='ok'&&fail?'throw':false);
 health(p);assert.equal(p.q.persistence.wanted.mark,'ok');assert.equal(p.q.persistence.confirmed.mark,'try');
 const count=store.writes.length;p.advance(1000);p.q.frame(.2,true,true);assert.equal(store.writes.length,count);
 p.doc.hidden=true;p.advance(3000);p.q.frame(.2,false,false);assert.equal(store.writes.length,count,'no frame retry while hidden');
 fail=false;p.doc.hidden=false;p.q.frame(.2,true,true);assert.equal(p.q.persistence.confirmed.mark,'ok');assert.equal(p.q.persistence.pending,false);
});
add('unconfirmed-counters-never-advertise-health',()=>{
 const store=new FailureStore();store.data.set('mmm.detail.trying','ok');store.arm(c=>c.key==='mmm.detail.deaths'&&c.value==='1'?'throw':false);
 const p=page(store);health(p);assert.equal(p.q.session.mark,'ok');assert.equal(store.data.get('mmm.detail.trying'),'try','do not publish health with an unconfirmed death count');
 store.arm(()=>false);p.advance(2000);p.q.frame(.1,true,true);assert.equal(store.data.get('mmm.detail.trying'),'ok');assert.equal(store.data.get('mmm.detail.deaths'),'1');
});
add('failed-counter-on-resume-retains-visible-evidence',()=>{
 const store=new FailureStore();store.data.set('mmm.detail.trying','ok');store.arm(c=>c.key==='mmm.detail.deaths'&&c.value==='1'?'throw':false);
 const p=page(store);health(p);p.hide();assert.equal(store.data.get('mmm.detail.trying'),'left-ok');p.show();
 assert.equal(store.data.get('mmm.detail.trying'),'try','failed health confirmation must not leave a clean-leave signature');assert.equal(p.q.persistence.pending,true);
 assert.equal(page(store).q.low,true,'a later visible death cannot be read as a clean session');
});
add('recovery-clear-must-be-confirmed',()=>{
 for(const key of ['mmm.detail.trying','mmm.detail.deaths']){
  const store=new FailureStore();store.data.set('mmm.detail.deaths','1');const p=page(store);health(p);p.hide();store.arm(c=>c.key===key&&c.value===null?'drop':false);
  const canvas=new EventTarget();p.q.watch(canvas);canvas.dispatchEvent(new Event('webglcontextlost'));assert.equal(new URL(p.nav[0]).searchParams.get('q'),'low');
  assert.equal(lowNext(store,p.nav[0]).q.low,true);
 }
});
add('late-read-failure-still-writes-leave',()=>{
 const store=new FailureStore(),p=page(store);store.readFail=()=>true;p.hide();p.leave();p.freeze();assert.equal(store.data.get('mmm.detail.trying'),'left-try');store.readFail=()=>false;assert.equal(page(store).q.low,false);
});
add('all-clean-leave-chances-fail-limit',()=>{
 const store=new FailureStore(),p=page(store);store.arm(c=>c.key==='mmm.detail.trying'&&c.value==='left-try'?'throw':false);
 p.hide();p.leave();p.freeze();assert.equal(store.data.get('mmm.detail.trying'),'try');store.arm(()=>false);const next=page(store);assert.equal(next.q.low,true);assert.equal(store.data.get('mmm.detail.recovered'),'device');
});
add('nth-write-key-value-faults',()=>{
 for(let nth=1;nth<=5;nth++){
  const store=new FailureStore(),p=page(store);store.arm(c=>c.n===nth?'throw':false);for(let cycle=0;cycle<6;cycle++){p.hide();p.show();}p.hide();p.leave();p.freeze();assert.ok(store.writes.some(c=>c.n===nth),'Nth fault was reached');
  store.arm(()=>false);p.freeze();assert.equal(store.data.get('mmm.detail.trying'),'left-try');assert.equal(p.q.persistence.pending,false);
 }
});
add('ending-dialog-crawl-injection',()=>{
 const source=ref?execFileSync('git',['show',`${ref}:web/src/main.ts`],{encoding:'utf8'}):readFileSync('web/src/main.ts','utf8');
 const at=source.indexOf('function frame(now: number)'),stop=source.indexOf('\n  syncRoadScenePause(',at);   // the frame-level call; the pause branch has its own, deeper
 assert.ok(at>=0&&stop>at,'frame prefix before road-scene pause');
 // The frame body may sit inside the page-state try block; close whatever the slice left open.
 const body=source.slice(at,stop),helper=source.match(/^function live\(\): boolean \{[^\n]+\}/m)?.[0]??'';
 const prefix=helper+'\n'+body+(/\n  try \{\n/.test(body)?'\n  } finally {}\n}':'\n}');
 return transform(prefix,{loader:'ts',target:'es2022'}).then(compiled=>{
  const store=new FailureStore(),p=page(store);health(p);let draws=0;
  // The pause gate stays open here: an ending frame is never a paused frame.
  const pause={blocked:false,time:0,previous:undefined,frame(now){const dt=this.previous===undefined?0:(now-this.previous)/1000;this.previous=now;this.time=now;return {paused:false,dt};}};
  const context={pause,gamepad:{poll(){}},multiplayer:null,last:0,fps:60,started:true,mode:'drive',mailMode:true,demo:0,waitingToDrive:false,placesUI:null,bigMap:null,shift:{ended:false},endings:{busy:true},document:globalThis.document,vehicle:{vx:0,vz:0,speed:0},camReady:true,quiet:50,terrain:{pending:0},grass:null,trees:null,interiors:{busy:false},page:{stopped:false,ready(){},fail(error){throw error;}},quality:p.q,drawEnding(){draws++;},requestAnimationFrame(){}};
  const frame=new Function('context',`with(context){${compiled.code};return frame;}`)(context);
  for(let n=1;n<=100;n++){p.advance(200);frame(n*200);}
  assert.equal(draws,100);assert.equal(store.data.get('mmm.detail'),'low','ending frames must reach the monitor');assert.equal(p.nav.length,1);
 });
});
add('desktop-main-comparison',()=>{
 for(const mode of ['working','read','write','both'])for(const low of [false,true])for(const search of ['', '?q=high&demo=8']){
  const control=implementation=>{
   const store=new FailureStore();store.data.clear();if(low)store.data.set('mmm.detail','low');
   environment(store,'https://example.test/'+search);if(mode==='read'||mode==='both')store.readFail=()=>true;if(mode==='write'||mode==='both')store.arm(()=> 'throw');
   const panel=new Element();let navigated=null;
   implementation.detailSetting({getExtension:()=>null,getParameter:()=> 'GPU'},panel,null,low,s=>{navigated=s;});
   const box=panel.children[0].children[0].children[0];box.checked=!low;box.listeners.change();
   return {navigated,checked:box.checked,disabled:!!box.disabled,saved:store.data.get('mmm.detail')??null};
  };
  const before=control(main),after=control(detail);assert.deepEqual(after,before,mode+' low='+low+' '+search);
  if(!low&&!search)console.log('DESKTOP',mode,JSON.stringify({main:before,branch:after}));
 }
});
let failures=0;
for(const [name,test]of Object.entries(cases)){
 if(process.env.TQ_STORAGE_CASE&&process.env.TQ_STORAGE_CASE!==name)continue;
 try{await test();console.log('PASS adapter',name);}catch(error){failures++;console.error('FAIL adapter',name,error.stack.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled source>'));}
}
if(failures)process.exitCode=1;
