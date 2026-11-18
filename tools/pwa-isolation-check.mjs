import { cdp, cdpFetch } from './cdp.mjs';
// Run via yard-shots: dev must have neither public installation metadata nor offline behavior.
import assert from 'node:assert/strict';
const port=process.env.CDP_PORT??9429;
const [out,url]=process.argv.slice(2);
const tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
const { ws, send } = await cdp(tab.webSocketDebuggerUrl);
const value=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result?.result?.value;
try{await send('Page.enable');await send('Page.navigate',{url});let settled=false;for(let i=0;i<120;i++){await new Promise(r=>setTimeout(r,500));if(await value(`document.title==='settled'`)){settled=true;break;}}
assert.ok(settled,'dev settles');assert.equal(await value(`!!document.querySelector('link[rel="manifest"]')`),false);assert.equal(await value(`!!document.getElementById('offlinePlay')`),false);assert.equal(await value(`navigator.serviceWorker.getRegistrations().then(r=>r.length)`),0);console.log('PASS dev has no manifest, worker registration, or offline UI');
}finally{await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);ws.close();}
