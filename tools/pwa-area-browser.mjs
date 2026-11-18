// Two actual ready areas remain online-only; a full Mabou download does not fetch either one.
import assert from 'node:assert/strict';
import {readFileSync as read,writeFileSync as write} from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {downloadBudget,downloadState,downloaded} from './pwa-test-download.mjs';
const out=resolve(process.argv[2]||'data/work/pwa'),origin=`http://127.0.0.1:${process.env.WEB_PORT??5230}`,port=process.env.CDP_PORT||9429;
const rootFile=out+'/area-root',trace=out+'/area-http.jsonl';write(rootFile,out+'/site');write(trace,'');
let server=spawn(process.execPath,['tools/pwa-server.mjs',rootFile,String(process.env.WEB_PORT??5230),'',trace],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function cdp(url){const ws=new WebSocket(url),pending=new Map();let id=0;const ready=new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});ws.onmessage=e=>{const d=JSON.parse(e.data),p=pending.get(d.id);if(p){clearTimeout(p.timer);pending.delete(d.id);d.error?p.reject(Error(JSON.stringify(d.error))):p.resolve(d.result);}};return{close:()=>ws.close(),send:async(method,params={})=>{await ready;return new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error(method+' timed out'));},30000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});}};}
const browser=cdp((await(await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl),tabs=[];let context;
async function value(t,expression){await t.send('Page.bringToFront');const r=await t.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function until(t,expr,ms=90000){const end=Date.now()+ms;while(Date.now()<end){try{const r=await value(t,expr);if(r)return r;}catch{}await sleep(150);}throw Error('area timeout '+expr+' '+await value(t,`document.getElementById('boot')?.textContent||document.getElementById('offlineStatus')?.textContent||document.body.textContent.slice(0,200)`));}
async function tab(query,offline=false){const {targetId}=await browser.send('Target.createTarget',{url:'about:blank',browserContextId:context});const list=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json(),t=cdp(list.find(t=>t.id===targetId).webSocketDebuggerUrl);tabs.push(t);t.id=targetId;await t.send('Page.enable');await t.send('Network.enable');await t.send('Page.bringToFront');if(offline)await t.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await t.send('Page.navigate',{url:origin+'/'+query});return t;}
async function stopServer(){if(server){const s=server;server=undefined;await new Promise(r=>{s.once('exit',r);s.kill();});}}
try{
 for(let i=0;i<50;i++){try{if((await fetch(origin+'/version.json')).ok)break;}catch{}await sleep(100);}
 const v=JSON.parse(read(out+'/site/version.json')),index=JSON.parse(read(out+'/site'+v.index));assert.equal(index.offlineArea,'mabou');assert.ok(index.files.every(f=>!f.url.startsWith('/areas/')));
 for(const area of ['porthood','pointtupper'])assert.equal((await fetch(origin+'/areas/'+area+'/manifest.json')).status,200,'ready area exists in the same built folder');
 ({browserContextId:context}=await browser.send('Target.createBrowserContext'));write(trace,'');const a=await tab('?area=mabou&title=1&q=low');await until(a,`!!document.getElementById('titleStart')&&!document.getElementById('boot')`);
 assert.equal(await value(a,`document.getElementById('offlineSize').textContent`),'Full download: '+(index.totalBytes/1048576).toFixed(1)+' MB','preview is exactly the Mabou/shared inventory size');
 await value(a,`document.getElementById('offlineStart').click()`);downloaded(await until(a,downloadState,downloadBudget(index)));
 const initial=read(trace,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l).path);assert.ok(initial.every(p=>!p.startsWith('/areas/')),'download never opens another area');
 await browser.send('Target.closeTarget',{targetId:a.id});a.close();const others=[];
 for(const area of ['porthood','pointtupper']){const t=await tab('?area='+area+'&mode=explore&title=1&q=low');await until(t,`!document.getElementById('boot')&&document.getElementById('offlinePlay')?.textContent.includes('This area needs a connection.')`);assert.equal(await value(t,`!!document.getElementById('offlineStart')`),false,'no unsupported-area download button');others.push(area);console.log('PASS',area,'plays online and states the offline limit');await browser.send('Target.closeTarget',{targetId:t.id});t.close();}
 await stopServer();
 const offlineTabs=[];for(const area of others){const t=await tab('?area='+area+'&title=1',true);offlineTabs.push(t);await until(t,`document.getElementById('offlineAreaConnection')?.textContent==='This area needs a connection.'`);assert.equal(await value(t,`!!document.querySelector('a[href*="area=mabou"]')`),true);console.log('PASS connection-only area offline; navigator.onLine=',await value(t,'navigator.onLine'));}
 const t=offlineTabs[0];await t.send('Page.bringToFront');write(out+'/area-needs-connection.png',Buffer.from((await t.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await t.send('Page.navigate',{url:origin+'/?area=mabou&title=1&q=low'});await until(t,`!!document.getElementById('titleStart')&&!document.getElementById('boot')`);
 const stored=await value(t,`(async()=>{const out=[];for(const n of await caches.keys())if(n.startsWith('mmm-offline-data-'))out.push(...(await(await caches.open(n)).keys()).map(r=>new URL(r.url).pathname));return out;})()`);assert.ok(stored.every(p=>!p.startsWith('/areas/')));assert.ok(stored.length>=index.files.length);console.log('PASS offline Mabou still starts, only Mabou/shared files saved, two other areas never downloaded');
 write(out+'/mabou-after-area-offline.png',Buffer.from((await t.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
}finally{if(context)await browser.send('Target.disposeBrowserContext',{browserContextId:context}).catch(()=>{});tabs.forEach(t=>t.close());browser.close();await stopServer();}
