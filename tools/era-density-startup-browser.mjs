// Cold, cache-disabled startup receipts. Run through yard-shots.sh on an otherwise idle browser slot.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const [out,first]=process.argv.slice(2),port=process.env.CDP_PORT;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
let id=0;const pending=new Map();ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id){pending.get(d.id)?.(d);pending.delete(d.id);}};
const send=(method,params={})=>new Promise(r=>{pending.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
const read=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.error||r.result?.exceptionDetails)throw Error(JSON.stringify(r));return r.result.result.value;};
const rows=[];
try{
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`performance.setResourceTimingBufferSize(10000);window.densityBoot={readyMs:null,ground:[]};const originalFetch=window.fetch;window.fetch=function(...args){const ground=/history-ground/.test(new Error().stack),url=String(args[0]);if(ground)densityBoot.ground.push(url);return originalFetch.apply(this,args);};new MutationObserver(()=>{if(densityBoot.readyMs===null&&document.documentElement?.dataset.mmmReady==='true')densityBoot.readyMs=performance.now();}).observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['data-mmm-ready']});`});
 for(const quality of ['high','low']){
  await send('Network.clearBrowserCache');await send('Emulation.setDeviceMetricsOverride',{width:quality==='low'?390:1600,height:quality==='low'?844:900,deviceScaleFactor:1,mobile:false});
  const url=new URL(`/?era=1884&q=${quality}&res=1&exag=1.5&name=density-startup&title=1`,first).href;
  const start=Date.now();await send('Page.navigate',{url});
  while(Date.now()-start<240000){await pause(100);if(await read("!!window.mmm&&document.documentElement.dataset.mmmReady==='true'"))break;}
  assert(await read("!!window.mmm&&document.documentElement.dataset.mmmReady==='true'"),'startup settled');
  const row=await read(`(()=>{const resources=performance.getEntriesByType('resource'),wanted=new Set(densityBoot.ground),ground=resources.filter(r=>r.name.includes('/terrain/')&&r.name.endsWith('.png'));return {readyMs:densityBoot.readyMs,groundRequests:ground.length,groundDecodedBytes:ground.reduce((n,r)=>n+r.decodedBodySize,0),groundTransferBytes:ground.reduce((n,r)=>n+r.transferSize,0),groundLevels:Object.fromEntries([...new Set(ground.map(r=>r.name.match(/terrain\\/(\\d+)\\//)?.[1]??'other'))].map(level=>[level,ground.filter(r=>r.name.includes('/terrain/'+level+'/')).length])),allDecodedBytes:resources.reduce((n,r)=>n+r.decodedBodySize,0),low:mmm.low,houses:mmm.history.farms.length};})()`);
  assert(Number.isFinite(row.readyMs)&&row.readyMs>0);assert.equal(row.low,quality==='low');rows.push({quality,...row});console.log('STARTUP',JSON.stringify(rows.at(-1)));
 }
 writeFileSync(`${out}/startup-${process.env.DENSITY_STARTUP_TAG??'current'}.json`,JSON.stringify({cacheDisabled:true,rows},null,2));
}finally{ws.send(JSON.stringify({id:++id,method:'Browser.close'}));await pause(1500);ws.close();}
