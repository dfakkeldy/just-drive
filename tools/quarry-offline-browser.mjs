// West Bay remains online-only. Its installed worker must handle an offline navigation cleanly.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {cdp,cdpFetch,sleep} from './cdp.mjs';
const out=resolve(process.argv[2]),origin=`http://127.0.0.1:${process.env.WEB_PORT}`,port=process.env.CDP_PORT;
writeFileSync(out+'/quarry-offline-root',out+'/site');
let server=spawn(process.execPath,['tools/pwa-server.mjs',out+'/quarry-offline-root',process.env.WEB_PORT],{stdio:'ignore'});
async function stopServer(){if(!server)return;const owned=server;server=undefined;await new Promise(r=>{owned.once('exit',r);owned.kill();});}
let c,tab;const workerErrors=[],offlineRequests=[];let offline=false;
try{
 for(let i=0;i<80;i++){try{if((await fetch(origin+'/version.json')).ok)break;}catch{}await sleep(100);}
 tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();c=await cdp(tab.webSocketDebuggerUrl,{onEvent:m=>{if(m.method==='ServiceWorker.workerErrorReported')workerErrors.push(m.params.errorMessage);if(offline&&m.method==='Network.requestWillBeSent')offlineRequests.push(m.params.request.url);}});
 const read=async expression=>(await c.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.result.value;
 const until=async expression=>{for(let i=0;i<200;i++){if(await read(expression))return;await sleep(200);}throw Error('offline timeout: '+expression);};
 await c.send('ServiceWorker.enable');await c.send('Page.enable');await c.send('Network.enable');await c.send('Page.navigate',{url:origin+'/offline-probe'});
 await until('location.pathname==="/offline-probe"&&document.readyState==="complete"');
 await read("(async()=>{await navigator.serviceWorker.register('/sw.js',{scope:'/'});await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));})()");
 assert.equal(await read('!!navigator.serviceWorker.controller'),true);
 await stopServer();offline=true;await c.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 await c.send('Page.navigate',{url:origin+'/?area=westbay&trip=quarry&title=1&q=low'});
 await until("document.getElementById('offlineAreaConnection')?.textContent==='This area needs a connection.'");
 assert.equal(await read("!![...document.querySelectorAll('a')].find(a=>a.textContent==='Play Mabou offline'&&a.href.includes('area=mabou'))"),true);
 await sleep(1000);assert.deepEqual(c.errors,[],'no unhandled page rejection');assert.deepEqual(workerErrors,[],'no unhandled worker rejection');assert.ok(offlineRequests.every(u=>!u.includes('quarry-feature')),'offline area response never boots the missing park');
 writeFileSync(out+'/pass4-westbay-offline.png',Buffer.from((await c.send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
 writeFileSync(out+'/pass4-westbay-offline.json',JSON.stringify({controlled:true,offline:true,screen:true,unhandled:c.errors,workerErrors,offlineRequests,exit:0},null,2));console.log('PASS installed worker: offline West Bay connection screen and Mabou link; no unhandled rejection');
 await c.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await c.send('Storage.clearDataForOrigin',{origin,storageTypes:'cache_storage,service_workers'});
}finally{if(tab)await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});c?.close();await stopServer();}
