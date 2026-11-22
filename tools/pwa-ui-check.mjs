import { readBaseline } from './baseline-source.mjs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {transformSync} from '../web/node_modules/esbuild/lib/main.js';
const baseline=process.argv.find(a=>a.startsWith('--baseline='))?.split('=')[1];
const source=process.argv.includes('--baseline')&&!baseline?readBaseline('pwa-migration','web/src/offline-play.ts'):baseline?execFileSync('git',['show',baseline+':web/src/offline-play.ts'],{encoding:'utf8'}):readFileSync(new URL('../web/src/offline-play.ts',import.meta.url),'utf8');
async function ui(source,area) {
 class Element {
  style={};listeners={};hidden=false;disabled=false;value=0;max=1;textContent='';
  setAttribute(){} addEventListener(n,f){this.listeners[n]=f;}focus(){focused=this;}click(){if(!this.disabled)return this.listeners.click?.();}
  querySelector(sel){return controls[sel.slice(1)];}querySelectorAll(){return Object.values(controls).filter(c=>c.button);}
 }
 let focused,group;
 const controls=Object.fromEntries(['Start','Stop','Remove','Status','Size','Storage','Progress','Confirm','ConfirmRemove','CancelRemove'].map(n=>['offline'+n,Object.assign(new Element(),{button:['Start','Stop','Remove','ConfirmRemove','CancelRemove'].includes(n)})]));
 const gear=new Element(),requests=[];
 class Channel {constructor(){this.port1={close(){}};this.port2={other:this.port1};}}
 const controller={postMessage(data,ports){const reply=p=>ports[0].other.onmessage?.({data:p});if(data.type==='prepare')queueMicrotask(()=>reply({}));else requests.push({...data,reply});}};
 const module={exports:{}};
 const context=vm.createContext({module,exports:module.exports,console,Response,isSecureContext:true,MessageChannel:Channel,setTimeout,clearTimeout,
  caches:{open:async()=>({put:async()=>{}}),delete:async()=>{}},navigator:{serviceWorker:{controller,getRegistration:async()=>({update:async()=>{}})}},
  document:{querySelector:()=>({content:"100"}),createElement:()=>group=new Element(),getElementById:id=>id==='gear'?gear:null}});
 vm.runInContext(transformSync(source,{loader:'ts',format:'cjs',target:'es2022'}).code,context);
 await module.exports.offlinePlay({insertBefore(){}},null,'',area);await Promise.resolve();
 return {controls,gear,requests,group,focused:()=>focused};
}
const done={bytes:100,total:100,count:1,files:1,done:true,running:false};
const tests={
 async track(source) {
  if(process.argv.includes('--baseline'))return;
  const u=await ui(source),c=u.controls;
  assert.match(u.group.innerHTML,/<progress id="offlineProgress"[^>]*\bhidden/);
  assert.match(u.group.innerHTML,/<div id="offlineStatus"[^>]*><\/div>/);
  const reply=u.requests.shift().reply;
  for(const [bytes,running,hidden] of [[0,false,true],[0,true,false],[20,false,false],[0,false,true]]) {
   reply({bytes,total:100,count:0,files:1,done:false,running});assert.equal(c.offlineProgress.hidden,hidden);
  }
 },
 async size(source) {const u=await ui(source),c=u.controls;u.requests.shift().reply({bytes:0,total:1048576,count:0,files:1,done:false,running:false,downloadBytes:2097152,shellBytes:1048576});assert.equal(c.offlineSize.textContent,'Full download: 2.0 MB');assert.equal(c.offlineProgress.max,2097152);assert.equal(c.offlineProgress.value,1048576);},
 async area(source) {const u=await ui(source,'judique');assert.match(u.group.innerHTML,/This area needs a connection/);assert.doesNotMatch(u.group.innerHTML,/offlineStart/);assert.equal(u.requests.length,0,'another area never prepares or starts a download');},
 async observer(source) {
  const u=await ui(source);u.requests.shift().reply({...done,bytes:10,done:false,running:true});
  if(!process.argv.includes('--baseline'))assert.match(u.controls.offlineStatus.textContent,/Another window is downloading/);
  u.gear.click();assert.equal(u.requests.length,1,'observer refreshes when settings reopen');u.requests.shift().reply(done);
  assert.equal(u.controls.offlineStop.hidden,true,'observer sees completion');assert.match(u.controls.offlineStatus.textContent,/Done:/);
 },
 async confirmation(source) {
  const u=await ui(source),c=u.controls;u.requests.shift().reply(done);
  c.offlineRemove.click();assert.equal(u.requests.length,0,'first tap cannot delete');assert.equal(c.offlineConfirm.hidden,false);assert.equal(u.focused(),c.offlineConfirmRemove,'confirmation is keyboard reachable');
  c.offlineCancelRemove.click();assert.equal(u.requests.length,0,'Cancel never sends removal');assert.equal(c.offlineConfirm.hidden,true);assert.equal(u.focused(),c.offlineRemove);
  c.offlineRemove.click();c.offlineConfirmRemove.click();const remove=u.requests.shift();assert.equal(remove.type,'remove');assert.equal(remove.confirmed,true);remove.reply({...done,bytes:0,count:0,done:false});assert.match(c.offlineStatus.textContent,/Download removed/);
 },
 async fallback(source) {const u=await ui(source),c=u.controls;u.requests.shift().reply({...done,bytes:0,done:false,removable:true});assert.equal(c.offlineRemove.hidden,false,'saved older copy is removable with zero current bytes');c.offlineRemove.click();c.offlineCancelRemove.click();assert.equal(c.offlineRemove.hidden,false,'Cancel retains the saved-copy control');},
 async replies(source) {
  const u=await ui(source),c=u.controls;u.requests.shift().reply(done);u.gear.click();const stale=u.requests.shift();
  c.offlineRemove.click();c.offlineConfirmRemove.click();u.requests.shift().reply({...done,bytes:0,count:0,done:false});stale.reply(done);
  assert.equal(c.offlineProgress.value,0);assert.match(c.offlineStatus.textContent,/Download removed/);
  await c.offlineStart.listeners.click();const start=u.requests.shift(),partial={...done,bytes:20,done:false,running:true};start.reply(partial);
  c.offlineStop.click();u.requests.shift().reply({...partial,running:false});start.reply({...partial,bytes:40});assert.equal(c.offlineStop.hidden,true);
  await c.offlineStart.listeners.click();u.requests.shift().reply({error:'Another window is downloading.'});assert.equal(c.offlineStart.disabled,false);await c.offlineStart.listeners.click();assert.equal(u.requests.shift().type,'start');
  assert.doesNotMatch(u.group.innerHTML+Object.values(c).map(e=>e.textContent).join(' '),/\b(cache|service worker|PWA)\b/i);
 }
};
let failures=0;
for(const [name,test] of Object.entries(tests)){try{await test(source);console.log('PASS',name);}catch(e){failures++;console.log('FAIL',name,e.message);}}
if(!failures && !process.argv.includes('--baseline')) {
 const changes=[
  ['track','bar.hidden=!(p.running || saved>0);',''],
  ['size','p.downloadBytes ?? p.total','p.total'],
  ['area',"if(area!=='mabou') {",'if(false) {'],
  ['observer','if(!ownDownload && navigator.serviceWorker.controller)', 'if(!working && navigator.serviceWorker.controller)'],
  ['confirmation',"remove.addEventListener('click',()=>{", "remove.addEventListener('click',()=>{talk('remove',show,true);"],
  ['fallback','p.removable ?? (p.bytes>0)','(p.bytes>0)'],
  ['replies','if(ticket===sequence) callback(p);','callback(p);']
 ];
 for(const [name,from,to] of changes){assert.ok(source.includes(from));let caught=false;try{await tests[name](source.replace(from,to));}catch{caught=true;}assert.ok(caught,'escaped mutation '+name);console.log('caught mutation:',name);}
}
if(failures)process.exitCode=1;
