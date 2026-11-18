// Real same-origin tabs: version pinning, startup race, observer completion, confirmation and network fault TTFB.
import assert from 'node:assert/strict';
import {downloadBudget,downloadState,downloaded} from './pwa-test-download.mjs';
import {readFileSync as read,writeFileSync as write,mkdirSync,symlinkSync,readdirSync,appendFileSync,existsSync,rmSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
const out=resolve(process.argv[2]??'data/work/pwa'),port=process.env.CDP_PORT??9429,origin=`http://127.0.0.1:${process.env.WEB_PORT??5230}`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function cdp(url) {
 const ws=new WebSocket(url),pending=new Map(),events=[];let id=0;
 const ready=new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 ws.onmessage=e=>{const d=JSON.parse(e.data);if(d.id){const p=pending.get(d.id);if(p){clearTimeout(p.timer);pending.delete(d.id);d.error?p.reject(Error(JSON.stringify(d.error))):p.resolve(d.result);}}else events.push({...d,received:Date.now()});};
 return {events,close:()=>ws.close(),send:async(method,params={})=>{await ready;return new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP timeout '+method));},30000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});}};
}
const browser=cdp((await(await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl),tabs=[],contexts=[];
const rootFile=out+'/migration-root',faultFile=out+'/migration-fault.json';write(rootFile,out+'/site');write(faultFile,'{}');
let server=spawn(process.execPath,['tools/pwa-server.mjs',rootFile,String(process.env.WEB_PORT??5230),faultFile],{stdio:'ignore'});
async function stopServer(){if(!server)return;const child=server;server=undefined;await new Promise(r=>{child.once('exit',r);child.kill();});}
async function startServer(){server=spawn(process.execPath,['tools/pwa-server.mjs',rootFile,String(process.env.WEB_PORT??5230),faultFile],{stdio:'ignore'});for(let i=0;i<50;i++){try{if((await fetch(origin+'/version.json')).ok)return;}catch{}await sleep(100);}throw Error('server restart failed');}
async function context(){const c=(await browser.send('Target.createBrowserContext')).browserContextId;contexts.push(c);return c;}
async function tab(ctx,source) {
 const {targetId}=await browser.send('Target.createTarget',{url:'about:blank',browserContextId:ctx});
 const list=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json(),t=cdp(list.find(t=>t.id===targetId).webSocketDebuggerUrl);t.id=targetId;tabs.push(t);
 await t.send('Page.enable');await t.send('Runtime.enable');await t.send('Network.enable');await t.send('Page.bringToFront');
 if(source)await t.send('Page.addScriptToEvaluateOnNewDocument',{source});return t;
}
async function value(t,expression){await t.send('Page.bringToFront');const r=await t.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true}).catch(e=>{throw Error(e.message+' in '+expression.slice(0,150))});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result?.value;}
async function until(t,expression,label,ms=60000){const end=Date.now()+ms;while(Date.now()<end){try{const v=await value(t,expression);if(v)return v;}catch{}await sleep(200);}throw Error('timeout '+label+' '+await value(t,`JSON.stringify({boot:document.getElementById('boot')?.textContent,status:document.getElementById('offlineStatus')?.textContent,notice:document.getElementById('offlineUpdate')?.textContent})`));}
async function load(t){await t.send('Page.bringToFront');await t.send('Page.navigate',{url:origin+'/?title=1&q=low'});await until(t,`!!document.getElementById('titleStart')&&!document.getElementById('boot')&&!document.getElementById('offlineStart')?.disabled`,'game and controls');}
const key=t=>value(t,`document.querySelector('meta[name="mmm-page"]').content`);
const message=(t,type,extra={})=>value(t,`new Promise(resolve=>{setTimeout(()=>resolve({error:'message timeout'}),8000);const c=new MessageChannel();c.port1.onmessage=e=>{c.port1.close();resolve(e.data)};navigator.serviceWorker.controller.postMessage({type:${JSON.stringify(type)},pageKey:document.querySelector('meta[name="mmm-page"]').content,...${JSON.stringify(extra)}},[c.port2]);})`);
const shot=async(t,name)=>write(out+'/'+name+'.png',Buffer.from((await t.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
const ok=(condition,text)=>{assert.ok(condition,text);console.log('PASS '+text);};
async function close(t){if(t.closed)return;t.closed=true;await browser.send('Target.closeTarget',{targetId:t.id});t.close();}
function linkTree(src,dest,changes) {
 mkdirSync(dest,{recursive:true});
 for(const e of readdirSync(src,{withFileTypes:true})) {
  const input=src+'/'+e.name,output=dest+'/'+e.name;
  if(changes.has(input)) {execFileSync('cp',['-c',input,output]);appendFileSync(output,' ');}
  else if(e.isDirectory()&&[...changes].some(p=>p.startsWith(input+'/')))linkTree(input,output,changes);
  else symlinkSync(input,output);
 }
}
const aRoot=out+'/site',vA=JSON.parse(read(aRoot+'/version.json')),iA=JSON.parse(read(aRoot+vA.index));
const bRoot=out+'/migration-b';if(existsSync(bRoot))rmSync(bRoot,{recursive:true});
function buildB(marker,unseen) {
 if(!existsSync(bRoot)) {
  mkdirSync(bRoot+'/offline',{recursive:true});symlinkSync(aRoot+'/offline/icons',bRoot+'/offline/icons');symlinkSync(aRoot+'/audio',bRoot+'/audio');if(existsSync(aRoot+'/areas'))symlinkSync(aRoot+'/areas',bRoot+'/areas');
  linkTree(aRoot+'/terrain',bRoot+'/terrain',new Set([aRoot+'/terrain/manifest.json',aRoot+unseen]));
 }
 write(bRoot+'/app.js',read(aRoot+'/app.js','utf8')+`\nglobalThis.__pwaBuild=${JSON.stringify(marker)};\n`);write(bRoot+'/index.html',read(aRoot+'/index.html'));write(bRoot+'/_headers',read(aRoot+'/_headers'));execFileSync(process.execPath,['tools/build-pwa.mjs',bRoot]);return JSON.parse(read(bRoot+'/version.json'));
}
try {
 for(let i=0;i<40;i++){try{if((await fetch(origin+'/version.json')).ok)break;}catch{}await sleep(100);}
 for(const [path,cache,type] of [
  ['/','no-store','text/html'],['/index.html','no-store','text/html'],['/sw.js','no-store','text/javascript'],['/version.json','no-store','application/json'],['/manifest.webmanifest','no-cache','application/manifest+json'],
  [iA.shell.find(f=>f.url.endsWith('.js')).url,'public, max-age=31536000, immutable','text/javascript'],[vA.index,'public, max-age=31536000, immutable','application/json'],['/offline/start.'+vA.pageKey+'.json','public, max-age=31536000, immutable','application/json'],['/terrain/manifest.json','no-cache','application/json']
 ]) {const r=await fetch(origin+path,{method:'HEAD'});assert.equal(r.status,200,path);assert.equal(r.headers.get('cache-control'),cache,path);assert.ok(r.headers.get('content-type').startsWith(type),path);}
 ok(true,'HTTP responses apply the built cache and content-type headers');
 const ctx=await context(),a=await tab(ctx);await load(a);await value(a,`document.getElementById('offlineStart').click()`);await until(a,`navigator.serviceWorker.controller && document.getElementById('offlineProgress').value>0`,'explicit opt-in');await value(a,`document.getElementById('offlineStop').click()`);await until(a,`document.getElementById('offlineStop').hidden`,'stop initial fill');await value(a,`document.getElementById('titleStart').click()`);
 const original=await value(a,`fetch('/terrain/manifest.json').then(r=>r.text())`);
 const cached=await value(a,`(async()=>{const c=await caches.open('mmm-offline-data-${vA.dataRevision}');return(await c.keys()).map(r=>new URL(r.url).pathname)})()`);
 const candidates=iA.files.filter(f=>f.url.startsWith('/terrain/')&&f.url.endsWith('.png')&&!cached.includes(f.url));const unseen=(candidates.filter(f=>f.url.includes('/8/')).at(-1)||candidates.at(-1)).url;
 const vB=buildB('B',unseen);write(rootFile,bRoot);const b=await tab(ctx);await load(b);await until(b,`window.__pwaBuild==='B'`,'build B');
 ok(await value(a,`fetch('/terrain/manifest.json').then(r=>r.text())`)===original,'tab A keeps its manifest after tab B updates');
 ok(await value(a,`caches.keys().then(a=>a.includes('mmm-offline-data-${vA.dataRevision}'))`),'A store remains while A is live');
 assert.equal(read(bRoot+unseen).length,read(aRoot+unseen).length+1,'changed frontier file uses an isolated clone');
 await value(a,`caches.open('mmm-offline-data-${vA.dataRevision}').then(c=>c.delete(${JSON.stringify(unseen)}))`);
 const result=await value(a,`fetch(${JSON.stringify(unseen)}).then(()=>({wrong:true}),e=>({error:e.message}))`);
 console.log('frontier result',unseen,result);
 ok(result.error==='A new version of the game is ready. Start again to get it.','unsaved changed land fails with the exact plain notice');
 ok(await value(a,`document.getElementById('offlineReload')?.textContent==='Start again'`),'reload button is visible; no automatic reload');await shot(a,'migration-old-page-notice');
 await close(a);await message(b,'status');await until(b,`caches.keys().then(a=>!a.includes('mmm-offline-data-${vA.dataRevision}'))`,'old store collected',8000);ok(true,'old store is removed after its last tab closes');
 // HTML and data arrive as A; prepare is delayed until another tab has selected B.
 write(rootFile,aRoot);
 const delayed=await tab(ctx,`const post=ServiceWorker.prototype.postMessage;window.__releasePrepare=()=>window.__savedPrepare&&post.apply(window.__savedPrepare[0],window.__savedPrepare[1]);ServiceWorker.prototype.postMessage=function(...args){if(args[0]?.type==='prepare'){window.__savedPrepare=[this,args];return;}return post.apply(this,args);};`);
 console.log('startup: loading A with prepare held');
 await delayed.send('Page.navigate',{url:origin+'/?title=1&q=low'});await until(delayed,`!!window.__savedPrepare&&!!document.getElementById('titleStart')`,'A startup before prepare');
 console.log('startup: token',await key(delayed),'expected',vA.pageKey);
 const startupManifest=await value(delayed,`fetch('/terrain/manifest.json').then(r=>r.text())`);
 console.log('startup: selecting B in other tab');
 write(rootFile,bRoot);const other=await tab(ctx);await load(other);await value(delayed,'window.__releasePrepare()');
 console.log('startup: prepare released');
 const startupStatus=await message(delayed,'status');console.log('startup status',startupStatus);ok(startupStatus.revision===vA.revision,'deploy between HTML and prepare cannot retag the page');ok(await value(delayed,`fetch('/terrain/manifest.json').then(r=>r.text())`)===startupManifest,'startup page still reads A after B');await close(delayed);await close(other);
 // Observer controls in two real tabs. Make the transfer long enough to observe it.
 await message(b,'remove',{confirmed:true});await b.send('Page.bringToFront');await value(b,`document.getElementById('titleStart').click();document.getElementById('gear').click()`);
 const observer=await tab(ctx);await load(observer);await value(observer,`document.getElementById('titleStart').click();document.getElementById('gear').click()`);
 const slowSong=JSON.parse(read(bRoot+'/version.json')),list=JSON.parse(read(bRoot+slowSong.index));const song=list.files.find(f=>f.url.endsWith('.mp3')).url;write(faultFile,JSON.stringify({path:song,delay:1800}));
 await value(b,`document.getElementById('offlineStart').click()`);await until(b,`!document.getElementById('offlineStop').hidden`,'owner running');
 await value(observer,`document.getElementById('gear').click();document.getElementById('gear').click()`);await until(observer,`!document.getElementById('offlineStop').hidden`,'observer sees running');ok(await value(observer,`document.getElementById('offlineStatus').textContent.includes('Another window is downloading.')`),'observer identifies the other window');await shot(observer,'migration-observer-running');
 downloaded(await until(b,downloadState,'download finishes',downloadBudget(list)));write(faultFile,'{}');
 await value(observer,`document.getElementById('gear').click();document.getElementById('gear').click()`);await until(observer,`/Done:/.test(document.getElementById('offlineStatus').textContent)&&document.getElementById('offlineStop').hidden`,'observer refreshes completion');ok(true,'second real tab refreshes running to Done on reopening settings');await shot(observer,'migration-observer-done');
 // A complete B must outlive an incomplete online C, even after B's last tab closes.
 const cRoot=out+'/migration-c';if(existsSync(cRoot))rmSync(cRoot,{recursive:true});mkdirSync(cRoot+'/offline',{recursive:true});
 symlinkSync(bRoot+'/offline/icons',cRoot+'/offline/icons');symlinkSync(bRoot+'/audio',cRoot+'/audio');if(existsSync(bRoot+'/areas'))symlinkSync(bRoot+'/areas',cRoot+'/areas');
 linkTree(bRoot+'/terrain',cRoot+'/terrain',new Set([bRoot+'/terrain/manifest.json',bRoot+unseen]));
 write(cRoot+'/app.js',read(bRoot+'/app.js','utf8')+'\nglobalThis.__pwaBuild="C";');write(cRoot+'/index.html',read(bRoot+'/index.html'));write(cRoot+'/_headers',read(bRoot+'/_headers'));execFileSync(process.execPath,['tools/build-pwa.mjs',cRoot]);
 write(rootFile,cRoot);await load(observer);await until(observer,`window.__pwaBuild==='C'`,'new online C');await close(b);await message(observer,'status');
 ok(await value(observer,`caches.keys().then(a=>a.includes('mmm-offline-data-${vB.dataRevision}'))`),'complete B survives after its last page closes under online C');
 await stopServer();await observer.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});console.log('Network.emulateNetworkConditions offline=true; navigator.onLine=',await value(observer,'navigator.onLine'));
 await load(observer);ok(await key(observer)===vB.pageKey,'offline start selects complete B instead of incomplete C');
 ok(await value(observer,`fetch(${JSON.stringify(unseen)}).then(r=>r.arrayBuffer()).then(b=>b.byteLength)` )===read(bRoot+unseen).length,'complete B supplies land not fetched during that new session');
 await observer.send('ServiceWorker.enable');await observer.send('ServiceWorker.stopAllWorkers');await load(observer);ok(await key(observer)===vB.pageKey,'complete B choice survives a real worker stop and restart');await shot(observer,'complete-offline-B');
 await observer.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});write(rootFile,bRoot);await startServer();
 // Removal while offline: first tap and Cancel preserve bytes; confirmation works and is keyboard reachable.
 await observer.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await observer.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});await observer.send('Page.navigate',{url:origin+'/?touch=1&title=1&q=low'});await until(observer,`!!document.getElementById('titleStart')&&!document.getElementById('boot')&&!document.getElementById('offlineStart')?.disabled`,'phone settings');await value(observer,`document.getElementById('titleStart').click();document.getElementById('gear').click()`);
 await stopServer();
 await observer.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 console.log('removal offline:',await value(observer,'navigator.onLine'),'server stopped');
 const before=await message(observer,'status');await value(observer,`document.getElementById('offlineRemove').click();document.getElementById('offlineConfirm').scrollIntoView({block:'center'})`);
 ok((await message(observer,'status')).bytes===before.bytes,'first removal tap preserves the offline download');
 const buttons=await value(observer,`['offlineConfirmRemove','offlineCancelRemove'].map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {id,w:r.width,h:r.height,tab:e.tabIndex}})`);ok(buttons.every(b=>b.w>=44&&b.h>=44&&b.tab>=0),'Remove and Cancel are keyboard reachable and at least 44px');await shot(observer,'migration-remove-confirm');
 await value(observer,`document.getElementById('offlineCancelRemove').click()`);ok((await message(observer,'status')).bytes===before.bytes,'Cancel keeps every saved byte');
 await value(observer,`document.getElementById('offlineRemove').click();document.getElementById('offlineConfirmRemove').focus()`);console.log('confirmation focus',await value(observer,'document.activeElement.id'));await observer.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await observer.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await until(observer,`/Download removed/.test(document.getElementById('offlineStatus').textContent)`,'keyboard-confirmed removal');ok((await message(observer,'status')).bytes===0,'confirmed removal deletes the download');
 await observer.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await close(observer);await close(b);await startServer();
 // Real time to Document response, not frame timing. Each B has a new inventory/script address.
 const timed=await tab(await context());write(rootFile,aRoot);await load(timed);await value(timed,`document.getElementById('offlineStart').click()`);await until(timed,`navigator.serviceWorker.controller && document.getElementById('offlineProgress').value>0`,'timing opt-in');await value(timed,`document.getElementById('offlineStop').click()`);await until(timed,`document.getElementById('offlineStop').hidden`,'timing stop');const timings={};
 for(const [n,kind] of ['stalled version','slow version','failing version','stalled inventory','stalled shell'].entries()) {
  write(faultFile,'{}');write(rootFile,aRoot);await load(timed);
  const next=buildB('timing-'+n,unseen),idx=JSON.parse(read(bRoot+next.index));
  const path=kind.includes('version')?'/version.json':kind==='stalled inventory'?next.index:idx.shell.find(f=>f.url.endsWith('.js')).url;
  write(rootFile,bRoot);write(faultFile,JSON.stringify({path,...(kind==='failing version'?{status:503}:kind==='slow version'?{delay:1800}:{hang:true})}));
  timed.events.length=0;const start=Date.now();await timed.send('Page.navigate',{url:origin+'/?title=1&q=low'});
  let response;for(let j=0;j<100;j++){response=timed.events.find(e=>e.method==='Network.responseReceived'&&e.params.type==='Document'&&e.params.response.url.startsWith(origin+'/'));if(response)break;await sleep(30);}
  assert.ok(response,'Document response');const elapsed=response.received-start;timings[kind]=elapsed;ok(elapsed<1500,kind+' saved response '+elapsed+' ms');ok(response.params.response.headers['Cache-Control']==='no-store'||response.params.response.headers['cache-control']==='no-store','navigation keeps no-store headers');
  write(faultFile,'{}');
  if(kind!=='failing version')await until(timed,`(async()=>{const r=await(await caches.open('mmm-offline-meta-v1')).match('/__mmm_offline_ready');return r&&(await r.json()).version.revision==='${next.revision}'})()`,'background prepares complete update',15000);
 }
 write(out+'/browser-start-timings.json',JSON.stringify(timings,null,2)+'\n');console.log('browser saved navigation timings:',JSON.stringify(timings));
 console.log('PASS real tabs, startup race, observer, removal answers, and bounded faulted starts');
} finally {
 write(faultFile,'{}');for(const t of tabs)t.close();for(const browserContextId of contexts)await browser.send('Target.disposeBrowserContext',{browserContextId}).catch(()=>{});browser.close();await stopServer();
}
