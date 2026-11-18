// The real public app and unchanged service worker, with the owned server stopped.
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {cdp,cdpFetch} from './cdp.mjs';
const out=resolve(process.argv[2]),pictures=process.env.HORSE_PICTURES??out;
mkdirSync(pictures,{recursive:true});
const origin=`http://127.0.0.1:${process.env.WEB_PORT}`,port=process.env.CDP_PORT;
writeFileSync(out+'/horse-server-root',out+'/site');
let server=spawn(process.execPath,['tools/pwa-server.mjs',out+'/horse-server-root',process.env.WEB_PORT],{stdio:'ignore'}),tab,transport;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const stop=async()=>{if(!server)return;const p=server;server=null;if(p.exitCode!==null||p.signalCode!==null)return;await new Promise(r=>{p.once('exit',r);p.kill();});};
try{
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/version.json')).ok)break;}catch{}await pause(100);}
 tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();transport=await cdp(tab.webSocketDebuggerUrl);
 const send=async(method,params={})=>{const r=await transport.send(method,params);if(r.error)throw Error(JSON.stringify(r.error));return r.result;};
 const value=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const until=async(expr,label,ms=120000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await value(expr))return;await pause(250);}throw Error('Timeout '+label+': '+await value('document.body.innerText.slice(-1500)'));};
 await send('Page.enable');await send('Network.enable');
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.horsePosition=null;
const cp=CanvasRenderingContext2D.prototype,scale=cp.scale,translate=cp.translate;
cp.scale=function(x,y){if(this.canvas.id==='miniMapCanvas'&&x>0&&x<1&&x===y)this.horseWorldTranslate=true;return scale.call(this,x,y);};
cp.translate=function(x,y){if(this.horseWorldTranslate){window.horsePosition={x:-x,z:-y};this.horseWorldTranslate=false;}return translate.call(this,x,y);};
window.horseMessages=[];window.MessageChannel=new Proxy(MessageChannel,{construct(t,args){const c=Reflect.construct(t,args);c.port1.addEventListener('message',e=>horseMessages.push(e.data));c.port1.start();return c;}});`});
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
 const query='/?era=1884&title=1&q=low&touch=1';
 const navigate=async()=>{await send('Page.navigate',{url:origin+query});await pause(300);await until('!!document.getElementById("titleStart")&&!document.getElementById("boot")','horse page');};
 await navigate();await until('!!document.getElementById("offlineStart")&&!document.getElementById("offlineStart").disabled','offline control');
 await value('document.getElementById("offlineStart").click()');
 await until('!!navigator.serviceWorker.controller&&horseMessages.some(m=>m.primed)','saved shell');
 await value('document.getElementById("offlineStop").click()');await until('document.getElementById("offlineStop").hidden','stop full download');
 // A controlled online reload caches exactly the land used by this start, without a full area download.
 await navigate();await value('document.getElementById("titleStart").click()');await until('document.documentElement.dataset.mmmReady==="true"','loaded land');await pause(2500);
 await stop();await assert.rejects(fetch(origin+'/version.json'),'owned HTTP server is really stopped');
 await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 await navigate();
 assert.equal(await value('document.querySelector("#title h1").textContent'),'Mabou, 1884');
 assert.equal(await value('document.querySelector("#vehicleChoice [data-vehicle=horse]").getAttribute("aria-pressed")'),'true','offline era has the default horse');
 assert.match(await value('document.querySelector("#title dl").textContent'),/Whinny/i);
 assert.doesNotMatch(await value('document.querySelector("#title dl").textContent'),/radio|wiper|plate|repair|trailer/i);
 await value('document.getElementById("titleStart").click()');await until('document.documentElement.dataset.mmmReady==="true"','offline ready');
 const go=await value('(()=>{const b=document.getElementById("tcGo").getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2};})()');
 await until('!!window.horsePosition','world position from minimap');const beforePosition=await value('window.horsePosition');
 await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,...go}]});await pause(2500);await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 const hud=await value('document.getElementById("hud").textContent');const afterPosition=await value('window.horsePosition'),displacement=Math.hypot(afterPosition.x-beforePosition.x,afterPosition.z-beforePosition.z);assert(displacement>1,'horse world displacement offline under real pedal input: '+displacement);writeFileSync(pictures+'/offline-displacement.json',JSON.stringify({beforePosition,afterPosition,displacement},null,2));console.log('OFFLINE_DISPLACEMENT',JSON.stringify({beforePosition,afterPosition,displacement}));
 assert.equal(await value('!!document.getElementById("radio")'),false);
 const r=await send('Page.captureScreenshot',{format:'png'});writeFileSync(pictures+'/offline-horse.png',Buffer.from(r.data,'base64'));
 console.log('PASS saved ?era=1884 selects and rides horse with HTTP server stopped and network offline:',hud);
 await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 await send('Storage.clearDataForOrigin',{origin,storageTypes:'cache_storage,service_workers'});
}finally{await stop();if(tab)await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});transport?.ws.close();}
