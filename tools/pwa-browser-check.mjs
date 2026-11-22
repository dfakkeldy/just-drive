import { ALL_STATIONS, checkStations, JUST_START_DIAL, SAVED_DIAL, PUBLIC_STATIONS, musicCreditText } from './radio-expectations.mjs';
// Against a built site only. Browser starts with tools/browser.sh; own server and contexts always close.
// CDP_PORT=9429 node tools/pwa-browser-check.mjs data/work/pwa
import assert from 'node:assert/strict';
import {downloadBudget,downloadState,downloaded} from './pwa-test-download.mjs';
import { readFileSync as read, writeFileSync as write, mkdirSync, symlinkSync, existsSync, copyFileSync, unlinkSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
const out=resolve(process.argv[2]??'data/work/pwa'),port=process.env.CDP_PORT??9429,origin=`http://127.0.0.1:${process.env.WEB_PORT??5230}`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let server;
function serve(root) { write(out+'/server-root',root);server=spawn(process.execPath,['tools/pwa-server.mjs',out+'/server-root',String(process.env.WEB_PORT??5230)],{stdio:['ignore','pipe','pipe']}); }
async function stopServer(){if(server){const s=server;server=undefined;await new Promise(r=>{s.once('exit',r);s.kill();});}}
async function startServer(root){serve(root);for(let i=0;i<40;i++){try{if((await fetch(origin+'/version.json')).ok)return;}catch{}await sleep(100);}throw Error('server not up');}
function cdp(url,onEvent=()=>{}){const ws=new WebSocket(url),pending=new Map(),events=[];let id=0;const ready=new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});ws.onmessage=e=>{const d=JSON.parse(e.data);if(d.id){const p=pending.get(d.id);if(p){clearTimeout(p.timer);pending.delete(d.id);d.error?p.reject(Error(JSON.stringify(d.error))):p.resolve(d.result);}}else {events.push(d);onEvent(d);}};return {events,close:()=>ws.close(),send:async(method,params={})=>{await ready;return new Promise((resolve,reject)=>{const i=++id;const timer=setTimeout(()=>{pending.delete(i);reject(Error('CDP timeout '+method));},45000);pending.set(i,{resolve,reject,timer});ws.send(JSON.stringify({id:i,method,params}));});}};}
const browser=cdp((await(await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl);
const contexts=[],tabs=[];let active;
async function tab(fresh=true,documentHTML=null){let browserContextId;if(fresh){({browserContextId}=await browser.send('Target.createBrowserContext'));contexts.push(browserContextId);}const {targetId}=await browser.send('Target.createTarget',{url:'about:blank',...(browserContextId?{browserContextId}:{})});const list=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();const t=cdp(list.find(t=>t.id===targetId).webSocketDebuggerUrl,d=>{if(d.method==='Fetch.requestPaused')void t.send('Fetch.fulfillRequest',{requestId:d.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'}],body:Buffer.from(documentHTML).toString('base64')}).catch(error=>console.error(error));});t.id=targetId;tabs.push(t);active=t;await t.send('Page.enable');await t.send('Page.bringToFront');await t.send('Runtime.enable');await t.send('Network.enable');if(documentHTML)await t.send('Fetch.enable',{patterns:[{resourceType:'Document'}]});await t.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__ports=[];window.MessageChannel=new Proxy(MessageChannel,{construct(target,args){const c=Reflect.construct(target,args);c.port1.addEventListener('message',e=>window.__ports.push(e.data));c.port1.start();return c;}});window.__pwaAudio=[]; window.Audio=new Proxy(Audio,{construct(target,args){const a=Reflect.construct(target,args);window.__pwaAudio.push(a);return a;}});window.__metres=0;window.__lastDrive=0;const raf=requestAnimationFrame;window.requestAnimationFrame=function(callback){return raf.call(window,function(now){const speed=parseFloat(document.getElementById('hud')?.textContent||'0');if(Number.isFinite(speed)&&window.__lastDrive)window.__metres+=Math.max(0,speed-.5)/3.6*Math.min(.1,(now-window.__lastDrive)/1000);window.__lastDrive=now;callback(now);});};`});return t;}
async function value(expression,t=active){await t.send('Page.bringToFront');const r=await t.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result?.value;}
async function until(expression,message,ms=90000){const end=Date.now()+ms;while(Date.now()<end){try{const v=await value(expression);if(v)return v;}catch{}await sleep(300);}throw Error('Timeout: '+message+'; '+await value(`JSON.stringify({title:document.title,boot:document.getElementById('boot')?.textContent,status:document.getElementById('offlineStatus')?.textContent,ports:window.__ports?.slice(-5)})`));}
async function navigate(query=''){await active.send('Page.navigate',{url:origin+'/'+query});await until(`!document.getElementById('boot') && (!!document.getElementById('titleStart') || document.documentElement.dataset.mmmReady==='true')`,'game settles');await until(`!!document.getElementById('offlineStart')&&!document.getElementById('offlineStart').disabled`,'offline controls ready',30000);}
async function navigateLatest(query,expected){
 await navigate(query);
 if(await value(`document.querySelector('meta[name="mmm-page"]').content`)!==expected.pageKey){
  await until(`!!document.getElementById('offlineReload')`,'background build is ready');await click('offlineReload');
  await until(`document.querySelector('meta[name="mmm-page"]')?.content===${JSON.stringify(expected.pageKey)}&&!document.getElementById('boot')`,'user restart takes the prepared build');
 }
}
async function shot(name){const r=await active.send('Page.captureScreenshot',{format:'png'});write(out+'/'+name+'.png',Buffer.from(r.data,'base64'));}
const good=(ok,label)=>{assert.ok(ok,label);console.log('PASS '+label);};
async function click(id){await value(`document.getElementById('${id}').click()`);}
async function startShift(){if(await value(`!!document.getElementById('titleStart')&&!document.getElementById('title')?.hidden`))await click('titleStart');await until(`document.getElementById('hud')?.style.visibility!=='hidden'`,'shift started');}
async function drive300(label){await until(`window.__metres>=310`,label+' drives 300m',100000);good(await value(`window.__metres>=310`),label+' at least 300m from rendered speed integrated per game frame');console.log('distance',await value('window.__metres'));}
async function offline(on){await active.send('Network.emulateNetworkConditions',{offline:on,latency:0,downloadThroughput:on?0:-1,uploadThroughput:on?0:-1});console.log('Network.emulateNetworkConditions offline='+on,'navigator.onLine='+await value('navigator.onLine'));}
const query='?demo=95&road=Rankinville%20Road&f=.3&title=1&q=low&touch=1';
try {
  await startServer(out+'/site');
  // Serve the real branded HTML at its canonical address; assets still come from the built site.
  // No whole-land download is needed to prove both areas' published radio catalogues and dials.
  for(const [area,era,vehicle] of [['mabou','today','car'],['westbay','today','car'],['mabou','1884','car'],['mabou','1884','bike'],['mabou','1884','horse']]) {
    await tab(true,read(out+'/site/just/'+area+'/index.html','utf8'));
    await active.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('mmm.radio',${JSON.stringify(SAVED_DIAL)});localStorage.setItem('mmm.radio.vol','.37');localStorage.setItem('mmm.radio.just','retired-dial');Object.defineProperty(navigator,'standalone',{value:true,configurable:true});`});
    await active.send('Page.navigate',{url:`http://justdrive.localhost:${process.env.WEB_PORT??5230}/${area}?title=1&q=low&reception=0&era=${era}&vehicle=${vehicle}`});
    if(vehicle==='horse'){
      await until(`!document.getElementById('boot')&&!!document.getElementById('titleStart')`,'1884 horse title');
      good(await value(`(()=>{const l=[...document.querySelectorAll('#title dl')],t=l.map(e=>e.textContent).join(' ');return !document.getElementById('radio')&&l.length>0&&/\\S/.test(t)&&!/radio|station|horn/i.test(t);})()`),'published 1884 horse has no radio or horn controls');
      await click('titleStart');
      good(await value(`!document.getElementById('radio')&&performance.getEntriesByType('resource').every(e=>!new URL(e.name).pathname.startsWith('/audio/radio'))`),'published 1884 horse never loads a radio list');
      await browser.send('Target.closeTarget',{targetId:active.id});continue;
    }
    await until(`!document.getElementById('boot')&&!!document.getElementById('radio')&&!!document.getElementById('titleStart')`,'Just Drive radio '+area+' '+era);
    const list=await value(`fetch('/audio/radio-just.json').then(r=>r.json())`);
    checkStations(list.stations,PUBLIC_STATIONS);
    const mail=await value(`fetch('/audio/radio.json').then(r=>r.json())`);
    assert.deepEqual(list.stations,mail.stations,'built brand catalogues match');
    await value(`dispatchEvent(new Event('appinstalled'));dispatchEvent(new Event('pageshow'))`);
    good(await value(`navigator.serviceWorker.getRegistrations().then(async r=>r.length===0&&(await caches.keys()).length===0)`),'Just Drive first visit/Home Screen events do not register or cache anything');
    good(await value(`document.querySelector('#radio b').textContent.includes(${JSON.stringify(JUST_START_DIAL)})`),'unknown saved Just Drive dial uses its start');
    good(await value(`document.getElementById('titleMusic').textContent===${JSON.stringify(musicCreditText(PUBLIC_STATIONS))}`),'published Just Drive '+era+' credits every music tool');
    await click('titleStart');
    for(const expected of [...ALL_STATIONS.slice(PUBLIC_STATIONS.findIndex(s=>s.dial===JUST_START_DIAL)),...ALL_STATIONS.slice(0,PUBLIC_STATIONS.findIndex(s=>s.dial===JUST_START_DIAL))]) {
      await until(`document.querySelector('#radio b')?.textContent.includes(${JSON.stringify(expected)})`,'published dial '+expected);
      await click('radio');
    }
    good(await value(`document.getElementById('radio').classList.contains('off')`),'Just Drive '+area+' '+era+' '+vehicle+' cycles every catalogue station then off');
    good(await value(`localStorage.getItem('mmm.radio')===${JSON.stringify(SAVED_DIAL)}&&localStorage.getItem('mmm.radio.vol')==='.37'&&localStorage.getItem('mmm.radio.just')==='off'`),'built Just Drive saves only its own station key');
    const v=JSON.parse(read(out+'/site/version-just.json')),index=JSON.parse(read(out+'/site'+v.index));
    good(list.stations.flatMap(s=>s.tracks).every(t=>index.files.some(f=>f.url==='/audio/'+t.file)),'every shared song is in the Just Drive offline inventory');
    if(area==='mabou'&&era==='today'){
      await click('offlineStart');
      await until(`navigator.serviceWorker.controller&&window.__ports.some(p=>p.primed)`,'Just Drive Download choice starts saving');
      await click('offlineStop');await until(`document.getElementById('offlineStop').hidden`,'Just Drive download stops');
      good(await value(`caches.keys().then(keys=>keys.some(k=>k.startsWith('mmm-offline-data-')))`),'Just Drive only saves after explicit Download choice');
    }
    await browser.send('Target.closeTarget',{targetId:active.id});
  }
  await tab(false);
  await active.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await active.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await navigate(query);
  const manifest=await active.send('Page.getAppManifest');good(!manifest.errors?.length&&!!manifest.data,'manifest parses');
  const m=JSON.parse(manifest.data);good(m.name==='Mabou Mail Madness'&&m.orientation==='any'&&m.display==='standalone'&&m.icons.some(i=>i.sizes==='192x192')&&m.icons.some(i=>i.sizes==='512x512')&&m.icons.some(i=>i.purpose==='maskable'),'manifest fields and icons');
  await sleep(1500);const install=await active.send('Page.getInstallabilityErrors');good(install.installabilityErrors.length===0,'Page.getInstallabilityErrors is empty');
  good(await value(`!!document.getElementById('titleStart')&&!document.getElementById('title').hidden`),'title card appears online');
  await click('offlineStart');await until(`navigator.serviceWorker.controller && window.__ports.some(p=>p.primed)`,'explicit opt-in saves this page first');await click('offlineStop');await until(`document.getElementById('offlineStop').hidden`,'visited-only download stopped');
  await startShift();await sleep(2000);console.log('initial data keys',await value(`(async()=>{const n=(await caches.keys()).find(n=>n.startsWith('mmm-offline-data-'));return n?(await(await caches.open(n)).keys()).length:-1;})()`));
  // Simulate the iPhone notch and home indicator with the layout's established test variables.
  await active.send('Emulation.setEmulatedMedia',{features:[{name:'display-mode',value:'standalone'}]});
  console.log('standalone media native emulation:',await value(`matchMedia('(display-mode: standalone)').matches`));
  await value(`Object.defineProperty(navigator,'standalone',{value:true,configurable:true});for(const [k,v] of Object.entries({'--test-safe-top':'47px','--test-safe-bottom':'34px','--test-safe-left':'0px','--test-safe-right':'0px'}))document.documentElement.style.setProperty(k,v)`);
  const safe=await value(`['gear','tcGo','tcBrake','tcSteer','mailButton','cameraButton'].map(id=>{const b=document.getElementById(id).getBoundingClientRect();return {id,top:b.top,bottom:b.bottom,left:b.left,right:b.right}})`);
  good(safe.every(b=>b.top>=47&&b.bottom<=810&&b.left>=0&&b.right<=390),'standalone simulation: controls clear 47px notch and 34px home indicator');
  await shot('phone-standalone-safe');
  await drive300('online priming route');
  await until(`window.__pwaAudio.some(a=>a.src.startsWith('blob:')&&a.readyState>=3&&a.currentTime>0)`,'radio song online');
  await stopServer();await offline(true);
  await navigate(query);good(await value(`!document.getElementById('title').hidden`),'offline start shows title');await startShift();await drive300('offline visited route');
  const times=await value(`window.__pwaAudio.map(a=>({src:a.src.slice(0,5),ready:a.readyState,time:a.currentTime,paused:a.paused}))`);await sleep(1800);
  const advanced=await value(`window.__pwaAudio.some((a,i)=>a.src.startsWith('blob:')&&a.readyState>=3&&!a.paused&&a.currentTime>${JSON.stringify(times)}[i].time+.2)`);
  // On a failure, name the state of every radio element before and after the wait (the label stays the same on a pass).
  const after=advanced?null:await value(`window.__pwaAudio.map(a=>({src:a.src.slice(0,5),ready:a.readyState,time:a.currentTime,paused:a.paused,network:a.networkState,error:a.error?.code??null}))`);
  good(advanced,'offline game radio readyState and currentTime advance'+(advanced?'':' '+JSON.stringify({before:times,after})));
  // A real HTMLMediaElement on the URL exercises Chromium's byte-range media path, as Safari does.
  const cachedSong=await value(`(async()=>{const n=(await caches.keys()).find(n=>n.startsWith('mmm-offline-data-'));return (await(await caches.open(n)).keys()).map(r=>new URL(r.url).pathname).find(p=>p.endsWith('.mp3'));})()`);
  good(!!cachedSong,'song fetched during play saved whole');
  const ranged=await value(`(async()=>{const r=await fetch(${JSON.stringify(cachedSong)},{headers:{Range:'bytes=0-1023'}});return {status:r.status,length:(await r.arrayBuffer()).byteLength,range:r.headers.get('Content-Range')};})()`);good(ranged.status===206&&ranged.length===1024&&ranged.range.startsWith('bytes 0-1023/'),'offline byte range served from full saved MP3');
  await value(`window.__rangeAudio=new Audio(${JSON.stringify(cachedSong)});document.body.appendChild(window.__rangeAudio);window.__rangeAudio.volume=0;window.__rangeAudio.play()`);
  await until(`window.__rangeAudio.readyState>=3&&window.__rangeAudio.currentTime>.5`,'range media plays offline');const t0=await value('window.__rangeAudio.currentTime');await sleep(1400);good(await value(`window.__rangeAudio.currentTime>${t0}+.5`),'direct range MP3 media time advances offline');await shot('offline-driving');
  await value('window.__rangeAudio.pause()');await offline(false);await startServer(out+'/site');
  // Keep only one full download in this job as ready area packs grow. This tab's proofs are complete.
  await active.send('Storage.clearDataForOrigin',{origin,storageTypes:'cache_storage,service_workers'});
  await browser.send('Target.closeTarget',{targetId:active.id});
  // Full download from a fresh, independent browser storage profile.
  await tab();await active.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await active.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await navigate('?title=1&touch=1&q=low');await startShift();await click('gear');await value(`document.getElementById('offlinePlay').scrollIntoView({block:'end'})`);await shot('phone-download-before');
  const sizeText=await value(`document.getElementById('offlineSize').textContent`);good(/Full download: [\d.]+ MB/.test(sizeText),'size shown before download');
  await value(`window.__storageMethods={persist:navigator.storage.persist.bind(navigator.storage),estimate:navigator.storage.estimate.bind(navigator.storage)};navigator.storage.persist=async()=>false;navigator.storage.estimate=async()=>({quota:100,usage:99})`);
  await click('offlineStart');await until(`/Not enough room/.test(document.getElementById('offlineStatus').textContent)`,'no room message');
  good(await value(`/did not agree/.test(document.getElementById('offlineStorage').textContent)&&document.getElementById('offlineStop').hidden`),'refused storage and no room are plain, and do not start download');
  await value(`Object.assign(navigator.storage,window.__storageMethods)`);
  await click('offlineStart');await until(`!document.getElementById('offlineStop').hidden&&document.getElementById('offlineProgress').value>10000000`,'download progresses');await shot('phone-download-during');
  await click('offlineStop');await until(`document.getElementById('offlineStop').hidden&&!document.getElementById('offlineStart').hidden`,'download stops');
  const stopped=await value(`document.getElementById('offlineProgress').value`);good(stopped>0,'stopped download keeps progress');
  await active.send('Emulation.setTouchEmulationEnabled',{enabled:false});await active.send('Emulation.setDeviceMetricsOverride',{width:1400,height:950,deviceScaleFactor:1,mobile:false});
  // Desktop layout needs a desktop visit; same saved progress, no phone query.
  await navigate('?title=1&q=low');await startShift();await click('gear');await value(`document.getElementById('offlinePlay').scrollIntoView({block:'end'})`);await shot('desktop-download-before');good(await value(`document.getElementById('offlineProgress').value`)>=stopped,'resume keeps saved progress across a new start');
  await click('offlineStart');await until(`!document.getElementById('offlineStop').hidden`,'resumed');await shot('desktop-download-during');
  const transferVersion=JSON.parse(read(out+'/site/version.json')),transferIndex=JSON.parse(read(out+'/site'+transferVersion.index));
  downloaded(await until(downloadState,'whole download done',downloadBudget(transferIndex)));await shot('desktop-download-after');
  good(await value(`document.getElementById('offlineProgress').value===document.getElementById('offlineProgress').max`),'all download bytes saved');
  await active.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await navigate('?touch=1&title=1&q=low');await startShift();await click('gear');await value(`document.getElementById('offlinePlay').scrollIntoView({block:'end'})`);await shot('phone-download-after');
  const estimateBefore=await value('navigator.storage.estimate()');console.log('storage before remove',estimateBefore);
  await stopServer();await offline(true);
  await navigate('?era=1884&vehicle=bike&title=1&q=low&touch=1');
  good(await value(`document.querySelector('#title h1').textContent==='Mabou, 1884'&&/radio|station/i.test([...document.querySelectorAll('#title dl')].map(e=>e.textContent).join(' '))`),'1884 bike title starts from the saved app with the server stopped');
  await until(`!!document.getElementById('radio')`,'1884 shared radio offline');await startShift();good(await value(`getComputedStyle(document.getElementById('shiftHud')).display==='none'&&!!document.getElementById('radio')`),'offline era offers radio without the mail HUD');await shot('offline-era-bike');
  await navigate('?demo=95&at=625613.24,5108489.99,-41.75265721465165&q=low&title=1&touch=1');await startShift();await drive300('offline never-visited far start');await shot('offline-far-driving');
  await offline(false);await startServer(out+'/site');
  await click('gear');console.log('remove button',await value(`({disabled:document.getElementById('offlineRemove').disabled,hidden:document.getElementById('offlineRemove').hidden})`));await click('offlineRemove');good(await value(`!document.getElementById('offlineConfirm').hidden`),'removal asks for confirmation');await click('offlineCancelRemove');good(await value(`document.getElementById('offlineConfirm').hidden`),'Cancel keeps the download');await click('offlineRemove');await click('offlineConfirmRemove');await until(`/Download removed/.test(document.getElementById('offlineStatus').textContent)`,'remove download');await sleep(1800);
  await until(`navigator.storage.estimate().then(e=>e.usage<${estimateBefore.usage}-100000000)`,'removed data releases storage',30000);
  const estimateAfter=await value('navigator.storage.estimate()');console.log('storage after remove',estimateAfter);good(estimateAfter.usage<estimateBefore.usage-100000000,'remove frees more than 100MB of browser storage');
  // Versioned update and fail-closed shell: B is built with a changed script and same-address changed JSON.
  const aRoot=out+'/site',bRoot=out+'/site-b';if(existsSync(bRoot))rmSync(bRoot,{recursive:true});mkdirSync(bRoot+'/offline',{recursive:true});
  for(const d of ['terrain','audio',...(existsSync(aRoot+'/areas')?['areas']:[]),...(existsSync(aRoot+'/chunks')?['chunks']:[])]){if(!existsSync(bRoot+'/'+d))symlinkSync(aRoot+'/'+d,bRoot+'/'+d);}
  if(!existsSync(bRoot+'/offline/icons'))symlinkSync(aRoot+'/offline/icons',bRoot+'/offline/icons');
  write(bRoot+'/app.js',read(aRoot+'/app.js','utf8')+'\nglobalThis.__pwaBuild="B";\n');write(bRoot+'/index.html',read(aRoot+'/index.html'));write(bRoot+'/_headers',read(aRoot+'/_headers'));
  execFileSync(process.execPath,['tools/build-pwa.mjs',bRoot]);
  await navigate('?title=1&q=low');const aId=await value(`document.querySelector('meta[name="mmm-build"]').content`);
  write(out+'/server-root',bRoot);await stopServer();await offline(true);await navigate('?title=1&q=low');good(await value(`document.querySelector('meta[name="mmm-build"]').content`)===aId,'offline still runs matching saved A shell');
  await offline(false);await startServer(bRoot);await navigateLatest('?title=1&q=low',JSON.parse(read(bRoot+'/version.json')));good(await value('window.__pwaBuild')==='B','next online start runs changed build B');
  good(await value(`document.querySelector('meta[name="mmm-build"]').content`)!==aId,'page and script both from B');
  // Rebuild B with a changed data file without touching any hard-linked terrain input.
  const oldV=JSON.parse(read(bRoot+'/version.json')),oldI=JSON.parse(read(bRoot+oldV.index));
  const oldFile=oldI.files.find(f=>f.url==='/audio/radio.json');
  const originalJSON=await value(`fetch('/audio/radio.json').then(r=>r.text())`);
  // Detach only the audio directory symlink; link MP3s to the originals and author our own JSON.
  unlinkSync(bRoot+'/audio');mkdirSync(bRoot+'/audio');for(const f of oldI.files.filter(f=>f.url.startsWith('/audio/')&&f.url.endsWith('.mp3')))symlinkSync(aRoot+f.url,bRoot+f.url);
  copyFileSync(aRoot+'/audio/radio-just.json',bRoot+'/audio/radio-just.json');write(bRoot+'/audio/radio.json',originalJSON+'\n ');execFileSync(process.execPath,['tools/build-pwa.mjs',bRoot]);
  await navigateLatest('?title=1&q=low',JSON.parse(read(bRoot+'/version.json')));good(await value(`fetch('/audio/radio.json').then(r=>r.text())`)===originalJSON+'\n ','same URL fetched anew after data version changes');
  console.log('old data stores are retained only for live or reserved clients; explicit two-tab close/collection is checked separately');
  // Publish an incomplete shell version: old complete B must still boot, with matching page/script.
  const bad=JSON.parse(read(bRoot+'/version.json')),badIndex=JSON.parse(read(bRoot+bad.index)),badApp=badIndex.shell.find(f=>f.url.endsWith('.js')).url;
  const saved=read(bRoot+badApp);write(bRoot+badApp,'broken');
  // Make revision new by changing the page source and regenerate inventory, then remove its script.
  write(bRoot+'/app.js',read(aRoot+'/app.js','utf8')+'\nglobalThis.__pwaBuild="C";\n');execFileSync(process.execPath,['tools/build-pwa.mjs',bRoot]);const cv=JSON.parse(read(bRoot+'/version.json'));const ci=JSON.parse(read(bRoot+cv.index));unlinkSync(bRoot+ci.shell.find(f=>f.url.endsWith('.js')).url);
  await navigate('?title=1&q=low');good(await value('window.__pwaBuild')==='B','incomplete deployment keeps complete B instead of half C');
  // Server kill switch bypasses the game-owned storage and unregisters on the next start.
  write(bRoot+ci.shell.find(f=>f.url.endsWith('.js')).url,read(bRoot+'/app.js'));
  write(bRoot+'/version.json',JSON.stringify({disabled:true}));await active.send('Page.navigate',{url:origin+'/?q=low'});await until(`navigator.serviceWorker.getRegistrations().then(a=>a.length===0)`,'kill unregisters');
  good(!(await value('caches.keys()')).some(n=>n.startsWith('mmm-offline-')),'kill removes all game-owned saved files');
  await until(`document.documentElement.dataset.mmmReady==='true'&&!document.getElementById('boot')`,'game starts online after kill');
  for(const completed of tabs) {await browser.send('Target.closeTarget',{targetId:completed.id}).catch(()=>{});}
  // Unsupported/blocked storage keep the same online game, without download failures escaping into boot.
  await tab();await active.send('Page.addScriptToEvaluateOnNewDocument',{source:`delete Navigator.prototype.serviceWorker;`});await active.send('Page.navigate',{url:origin+'/?title=1&q=low'});await until(`!!document.getElementById('titleStart')&&!document.getElementById('boot')`,'unsupported game');await startShift();good(await value(`!document.getElementById('offlinePlay')`),'no support: ordinary game, no offline panel');await browser.send('Target.closeTarget',{targetId:active.id});
  await tab();await active.send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(window,'caches',{value:{open:async()=>{throw Error('blocked')}}});`});await active.send('Page.navigate',{url:origin+'/?title=1&q=low'});await until(`!!document.getElementById('titleStart')&&!document.getElementById('boot')`,'blocked-storage game');await startShift();await click('offlineStart');await until(`/not available/.test(document.getElementById('offlineStatus').textContent)`,'blocked saving click');good(await value(`/not available/.test(document.getElementById('offlineStatus').textContent)`),'blocked/private storage: online game still starts');

  console.log('PASS all public built-site browser contracts');
} finally {
  await stopServer();for(const t of tabs)t.close();for(const browserContextId of contexts)await browser.send('Target.disposeBrowserContext',{browserContextId}).catch(()=>{});browser.close();
}
