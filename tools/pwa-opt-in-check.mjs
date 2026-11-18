import { readBaseline } from './baseline-source.mjs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {harness,source as workerSource} from './pwa-harness.mjs';
import {transformSync} from '../web/node_modules/esbuild/lib/main.js';
const baseline=process.argv.includes('--baseline'),load=p=>baseline?readBaseline('pwa-opt-in',p):readFileSync(p,'utf8');
const code=load('web/src/offline-play.ts'),main=load('web/src/main.ts');
async function testCase(code,main,installed) {
 const work=[],events={},controls={};
 class Element {style={};hidden=false;disabled=false;setAttribute(){}focus(){}addEventListener(n,f){this[n]=f;}querySelector(sel){return controls[sel.slice(1)]??=(new Element());}querySelectorAll(){return [];}}
 const panel=new Element(),module={exports:{}};let sw;
 class Channel {constructor(){this.port1={close(){}};this.port2={other:this.port1};}}
 const controller={postMessage(data,ports){work.push(data.type);queueMicrotask(()=>ports[0].other.onmessage?.({data:data.type==='prepare'?{bound:true}:{bytes:0,total:100,files:1,count:0,done:false,running:data.type==='start'}}));}};
 sw={controller:null,addEventListener:(n,f)=>events[n]=f,removeEventListener(){},getRegistration:async()=>{work.push('getRegistration');return undefined;},register:async()=>{work.push('register');sw.controller=controller;events.controllerchange?.();return {update:async()=>{work.push('update');}};}};
 const c=vm.createContext({module,exports:module.exports,Response,MessageChannel:Channel,setTimeout,clearTimeout,isSecureContext:true,
  fetch:async()=>{work.push('fetch');return new Response('{}');},
  caches:{keys:async()=>{work.push('storage keys');return [];},match:async()=>{work.push('storage match');},open:async()=>{work.push('storage');return {put:async()=>{}};},delete:async()=>{}},addEventListener:(n,f)=>events[n]=f,matchMedia:()=>({matches:installed}),navigator:{standalone:installed,serviceWorker:sw,storage:{persist:async()=>true,estimate:async()=>({quota:100000000,usage:0})}},
  document:{querySelector:()=>({content:'100'}),getElementById:id=>id==='gear'?panel:null,createElement:()=>new Element()}});
 vm.runInContext(transformSync(code,{loader:'ts',format:'cjs',target:'es2022'}).code,c);
 await module.exports.offlinePlay({insertBefore(){}},null,'build');await Promise.resolve();
 await panel.click?.();
 events.appinstalled?.();events.pageshow?.();await Promise.resolve();
 assert.deepEqual(work,[],'fresh visitor/Home Screen install must do zero offline work');
 assert.doesNotMatch(main,/await\s+offlinePlay\s*\(/,'startup must not await offline setup');
 assert.ok(main.indexOf('offlinePlay(document')>main.indexOf('await loadAreaManifest'),'first land fetch precedes the optional UI mount');
 await controls.offlineStart.click();await Promise.resolve();assert.ok(work.includes('register')&&work.includes('storage')&&work.includes('start'),'one Download click registers and starts the download');
}
async function test(code,main){for(const installed of [false,true])await testCase(code,main,installed);}
try{await test(code,main);console.log('PASS no-click zero work, no startup await, first fetch before UI; click starts download');}catch(e){console.log('FAIL',e.message);process.exitCode=1;}
if(!process.exitCode&&process.argv.includes('--mutations'))for(const [name,mutate,changeMain]of[
 ['install-triggered registration',s=>s.replace('  const total=',"  addEventListener('appinstalled',()=>void navigator.serviceWorker.register('/sw.js'));\n  const total=")],
 ['automatic registration',s=>s.replace('  const total=',"  void navigator.serviceWorker.register('/sw.js');\n  const total=")],
 ['automatic storage probe',s=>s.replace('  const total=',"  void caches.open('accidental');\n  const total=")],
 ['automatic storage read',s=>s.replace('  const total=',"  void caches.keys();\n  const total=")],
 ['automatic version fetch',s=>s.replace('  const total=',"  void fetch('/version.json');\n  const total=")],
 ['startup await',s=>s,s=>s.replace('if (__PUBLIC_APP__) offlinePlay(', 'if (__PUBLIC_APP__) await offlinePlay(')]
]){let caught=false;try{await test(mutate(code),changeMain?changeMain(main):main);}catch{caught=true;}assert.ok(caught,'escaped '+name);console.log('caught mutation:',name);}

async function lateOptIn(code) {
 const h=await harness(code),a=h.build('A');h.live.set('old',true);h.pageKeys.set('old',a.pageKey);h.routes.delete('/offline/start.'+a.pageKey+'.json');await h.message('prepare','old');
 assert.ok(h.messages.some(m=>m.id==='old'&&m.type==='version-unavailable'),'late opt-in after missing startup metadata offers reload');
}
try{await lateOptIn(baseline?readBaseline('pwa-opt-in','web/pwa/sw.js'):workerSource);console.log('PASS late opt-in after old startup metadata is gone offers reload');}catch(e){console.log('FAIL',e.message);process.exitCode=1;}
if(!process.exitCode&&process.argv.includes('--mutations')) {
 const from="if(!s) {hold(event,notify(id,'version-unavailable'));throw Error(UPDATE_TEXT);}";assert.ok(workerSource.includes(from));let caught=false;
 try{await lateOptIn(workerSource.replace(from,'if(!s) throw Error(UPDATE_TEXT);'));}catch{caught=true;}assert.ok(caught,'escaped missing-startup reload notice');console.log('caught mutation: missing-startup reload notice');
}
