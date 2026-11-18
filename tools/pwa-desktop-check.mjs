import { cdp, cdpFetch } from './cdp.mjs';
// Real desktop pointer layout (not a wide touch viewport), using the same built host and browser job.
import assert from 'node:assert/strict';
import {downloadBudget,downloadState,downloaded} from './pwa-test-download.mjs';
import {writeFileSync as write, readFileSync as read} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
const out=resolve(process.argv[2]??'data/work/pwa'),port=process.env.CDP_PORT??9429;
write(out+'/desktop-root',out+'/site');
const server=spawn(process.execPath,['tools/pwa-server.mjs',out+'/desktop-root',String(process.env.WEB_PORT??5230)],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ws,tab;try{
 for(let i=0;i<50;i++){try{if((await fetch(`http://127.0.0.1:${process.env.WEB_PORT??5230}/version.json`)).ok)break;}catch{}await sleep(100);}
 tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();const transport=await cdp(tab.webSocketDebuggerUrl);ws=transport.ws;
 const send=async(method,params={})=>{const response=await transport.send(method,params);if(response.error)throw Error(JSON.stringify(response.error));return response.result;};
 const value=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const until=async (expr,ms=150000)=>{for(let i=0;i<Math.ceil(ms/250);i++){const result=await value(expr);if(result)return result;await sleep(250);}throw Error('desktop timeout '+expr);};
 const shot=async name=>write(out+'/'+name+'.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await send('Page.enable');await send('Emulation.setTouchEmulationEnabled',{enabled:false});await send('Emulation.setDeviceMetricsOverride',{width:1400,height:950,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:`http://127.0.0.1:${process.env.WEB_PORT??5230}/?title=1&q=low`});
 await until(`!!document.getElementById('titleStart')&&!document.getElementById('boot')&&!document.getElementById('offlineStart')?.disabled`);
 assert.equal(await value(`matchMedia('(pointer: coarse)').matches`),false,'desktop pointer is fine');assert.equal(await value(`document.body.classList.contains('tcOn')`),false,'desktop uses desktop layout');
 await value(`document.getElementById('titleStart').click();document.getElementById('gear').click();document.getElementById('offlinePlay').scrollIntoView({block:'end'})`);await sleep(600);await shot('desktop-download-before');
 await value(`document.getElementById('offlineStart').click()`);await until(`!document.getElementById('offlineStop').hidden`);await sleep(300);await shot('desktop-download-during');
 const transferVersion=JSON.parse(read(out+'/site/version.json')),transferIndex=JSON.parse(read(out+'/site'+transferVersion.index));
 downloaded(await until(downloadState,downloadBudget(transferIndex)));await shot('desktop-download-after');
 assert.ok(await value(`(()=>{const p=document.getElementById('settings').getBoundingClientRect(),g=document.getElementById('offlinePlay').getBoundingClientRect();return g.left>=p.left&&g.right<=p.right&&p.right<=innerWidth&&g.width<=300})()`),'offline group fits the existing desktop panel');
 console.log('PASS desktop pointer layout, size, progress, complete download, narrow settings; three pictures');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});await send('Emulation.setSafeAreaInsetsOverride',{insets:{top:47,bottom:34,left:0,right:0}});
 await send('Page.navigate',{url:`http://127.0.0.1:${process.env.WEB_PORT??5230}/?touch=1&title=1&q=low`});await until(`!!document.getElementById('titleStart')&&!document.getElementById('boot')`);await value(`document.getElementById('titleStart').click();Object.defineProperty(navigator,'standalone',{value:true,configurable:true})`);await sleep(1000);
 assert.equal(await value(`getComputedStyle(document.getElementById('phoneHud')).paddingTop`),'53px','real env safe-area inset applied');
 const bounds=await value(`['gear','tcGo','tcBrake','tcSteer','mailButton','cameraButton'].map(id=>{const b=document.getElementById(id).getBoundingClientRect();return {top:b.top,bottom:b.bottom,left:b.left,right:b.right}})`);
 assert.ok(bounds.every(b=>b.top>=47&&b.bottom<=810&&b.left>=0&&b.right<=390),'all controls clear native simulated safe areas');await shot('phone-standalone-safe');console.log('PASS phone standalone simulation with native CDP safe-area env values; all control bounds clear 47/34px');

 await send('Storage.clearDataForOrigin',{origin:`http://127.0.0.1:${process.env.WEB_PORT??5230}`,storageTypes:'cache_storage,service_workers'});
}finally{if(tab)await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});ws?.close();await new Promise(r=>{server.once('exit',r);server.kill();});}
