import { readBaseline } from './baseline-source.mjs';
// Actual public game and same-source no-offline bundle, fresh contexts, real delayed HTTP routes.
import assert from 'node:assert/strict';
import {downloadBudget,downloadState,downloaded} from './pwa-test-download.mjs';
import {readFileSync as read,writeFileSync as write,mkdirSync,symlinkSync,existsSync,rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {build} from '../web/node_modules/esbuild/lib/main.js';
const out=resolve(process.argv[2]||'data/work/pwa'),origin=`http://127.0.0.1:${process.env.WEB_PORT??5230}`,port=process.env.CDP_PORT||9429,baseline=process.argv.includes('--baseline');
const delay=ms=>new Promise(r=>setTimeout(r,ms)),rootFile=out+'/opt-in-root',faultFile=out+'/opt-in-fault.json',trace=out+'/opt-in-http.jsonl';
const roots={};
for(const [name,enabled] of [['normal',false],['public',true]]){
 const root=roots[name]=out+'/opt-in-'+name;mkdirSync(root,{recursive:true});
 for(const path of ['terrain','audio','areas','chunks','offline','manifest.webmanifest','_headers','sw.js','version.json'])if(existsSync(out+'/site/'+path)&&!existsSync(root+'/'+path))symlinkSync(out+'/site/'+path,root+'/'+path);
 // Ordinary shell, including its real build metadata. This app.js is one esbuild file: no script integrity, no chunk preloads.
 write(root+'/index.html',read(out+'/site/index.html','utf8').replace(/(<script[^>]*?) integrity="[^"]+"/,'$1').replace(/<link rel="modulepreload"[^>]*>\n?/g,''));
 await build({entryPoints:['web/src/main.ts'],bundle:true,format:'esm',target:'es2022',minify:true,outfile:root+'/app.js',define:{__PUBLIC_APP__:JSON.stringify(enabled),'import.meta.env.BASE_URL':JSON.stringify('./'),'import.meta.env.DEV':'false','import.meta.env.VITE_MP':JSON.stringify('1')},plugins:baseline&&enabled?[{name:'review-baseline',setup(b){b.onLoad({filter:/web\/src\/(main|offline-play|offline-version|streams)\.ts$/},args=>({contents:readBaseline('pwa-opt-in',args.path.slice(args.path.indexOf('web/src/'))),loader:'ts'}));}}]:[]});
}
// Use the actual Vite public app for the fixed case; no-offline oracle differs only by compiled-out feature.
if(!baseline){write(roots.public+'/app.js',read(out+'/site/app.js'));write(roots.public+'/index.html',read(out+'/site/index.html'));}
write(rootFile,roots.normal);write(faultFile,JSON.stringify({paths:['/sw.js','/version.json'],delay:2500}));write(trace,'');
const server=spawn(process.execPath,['tools/pwa-server.mjs',rootFile,String(process.env.WEB_PORT??5230),faultFile,trace],{stdio:'ignore'});
function cdp(url){const ws=new WebSocket(url),pending=new Map(),events=[];let id=0;const ready=new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});ws.onmessage=e=>{const d=JSON.parse(e.data),p=pending.get(d.id);if(p){clearTimeout(p.timer);pending.delete(d.id);d.error?p.reject(Error(JSON.stringify(d.error))):p.resolve(d.result);}else if(!d.id)events.push(d);};return{events,close:()=>ws.close(),send:async(method,params={})=>{await ready;return new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error(method+' timed out'));},30000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});}};}
const browser=cdp((await(await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl),contexts=[],tabs=[];
async function value(t,expression){await t.send('Page.bringToFront');const r=await t.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function until(t,expr,ms=120000){const end=Date.now()+ms;while(Date.now()<end){const result=await value(t,expr);if(result)return result;await delay(100);}throw Error('timeout '+expr);}
async function run(name){
 write(rootFile,roots[name]);write(trace,'');const {browserContextId}=await browser.send('Target.createBrowserContext');contexts.push(browserContextId);
 const {targetId}=await browser.send('Target.createTarget',{url:'about:blank',browserContextId});const list=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json(),t=cdp(list.find(t=>t.id===targetId).webSocketDebuggerUrl);tabs.push(t);
 await t.send('Page.enable');await t.send('Network.enable');await t.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__offlineAccess=[];window.__cacheKeys=caches.keys.bind(caches);for(const n of ['open','match','keys']){const f=caches[n].bind(caches);caches[n]=(...a)=>{window.__offlineAccess.push(n);return f(...a)}}`});
 await t.send('Page.navigate',{url:origin+'/?title=1&q=low'});await until(t,`!!document.getElementById('titleStart')&&!document.getElementById('boot')`);await delay(600);
 const info=await value(t,`(async()=>{const entries=performance.getEntriesByType('resource');const app=entries.find(e=>e.name.endsWith('/app.js')),land=entries.find(e=>e.name.includes('/terrain/manifest.json'));return {registrations:(await navigator.serviceWorker.getRegistrations()).length,caches:await window.__cacheKeys(),access:window.__offlineAccess,firstLand:land.startTime-app.responseEnd,gameRequests:entries.filter(e=>/\\/(terrain|audio|areas)\\//.test(e.name)).slice(0,6).map(e=>new URL(e.name).pathname)}})()`);
 const requests=read(trace,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l).path);
 if(baseline&&name==='public')write(out+'/opt-in-pass3-browser-baseline.json',JSON.stringify({info,requests},null,2));
 console.log(name,'fresh load',JSON.stringify(info),JSON.stringify(requests));
 const violations=[];
 for(const [ok,label]of[
  [info.registrations===0,'zero registrations'],[info.caches.length===0,'zero stores'],[info.access.length===0,'zero storage accesses'],
  [!requests.some(p=>p==='/sw.js'||p==='/version.json'||/^\/offline\/(start|files|page|app)\./.test(p)),'zero offline network requests']
 ]){console.log(ok?'PASS':'FAIL',name,label);if(!ok)violations.push(label);}
 console.log(name,'first land after script response',info.firstLand,'ms',JSON.stringify(requests));
 const pageRequests=t.events.filter(e=>e.method==='Network.requestWillBeSent'&&e.params.request.url.startsWith(origin+'/')).map(e=>new URL(e.params.request.url).pathname);
 // The order check reads the order the page asked for the files (CDP), not Resource Timing. startTime has a 100 µs clock:
 // two fetches started together often share it, and the browser then lists them in either order.
 const gameRequests=pageRequests.filter(p=>/\/(terrain|audio|areas)\//.test(p)).slice(0,6);
 console.log(name,'game request order',JSON.stringify(gameRequests));
 return {t,info,requests:pageRequests,gameRequests,browserContextId,violations};
}
try{
 for(let i=0;i<50;i++){try{if((await fetch(origin+'/_headers')).status===404)break;}catch{}await delay(100);}
 const normal=await run('normal');await browser.send('Target.disposeBrowserContext',{browserContextId:normal.browserContextId});normal.t.close();const publicPage=await run('public');const timing=publicPage.info.firstLand<normal.info.firstLand+250 && publicPage.info.firstLand<500;
 console.log(timing?'PASS':'FAIL','first-land timing has no offline setup delay');
 assert.deepEqual(publicPage.gameRequests,normal.gameRequests,'game first-request order matches no-offline build');
 assert.ok(timing,'offline feature adds no 2.5 second startup wait');
 assert.deepEqual(normal.violations,[],'no-offline oracle stays ordinary');assert.deepEqual(publicPage.violations,[],'ordinary public visitor stays ordinary');
 // Restore real public paths before registration: hashed startup metadata describes this exact Vite app.
 write(rootFile,out+'/site');write(trace,'');await value(publicPage.t,`document.getElementById('offlineStart').click()`);
 await until(publicPage.t,`navigator.serviceWorker.controller && document.getElementById('offlineProgress').value>0`);
 const after=read(trace,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l).path);
 assert.ok(after.includes('/sw.js')&&after.some(p=>/^\/offline\/files\./.test(p)),'Download tap registers and fetches inventory');
 const version=JSON.parse(read(out+'/site/version.json')),inventory=JSON.parse(read(out+'/site'+version.index));
 downloaded(await until(publicPage.t,downloadState,downloadBudget(inventory)));
 write(out+'/opt-in-pass3-browser.json',JSON.stringify({normal:normal.info,public:publicPage.info,ordinaryRequests:publicPage.requests,clickStarts:true},null,2));
 console.log('PASS fresh public visit, no-click storage/network isolation, delayed routes, no-offline order/timing oracle, click registers and completes');
}finally{for(const c of contexts)await browser.send('Target.disposeBrowserContext',{browserContextId:c}).catch(()=>{});tabs.forEach(t=>t.close());browser.close();await new Promise(r=>{server.once('exit',r);server.kill();});}
