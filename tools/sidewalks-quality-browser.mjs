import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cdp,cdpFetch,sleep} from './cdp.mjs';
import {unpack} from './sidewalks-low-bake.mjs';
export function assertPayloadRequest(path,{area,low,era=false}){
 if(!/\/sidewalks-[^/]+\.(?:json|js)$/.test(path)||path==='/src/sidewalks-data.json')return false;
 assert.equal(era,false,'1884 must request no sidewalk payload');
 const base=area==='mabou'?'terrain':`areas/${area}`,match=path.match(/\/(terrain|areas\/[^/]+)\/sidewalks-(desktop|low)\.json$/);
 assert.ok(match,'unknown or inlined-module sidewalk payload request: '+path);assert.equal(match[1],base,'wrong area payload request');assert.equal(match[2],low?'low':'desktop','wrong quality payload request: '+path);return true;
}
export function assertPayloadComplete(requests,era=false){assert.equal(requests.length,era?0:1,'one selected payload request; a flat inlined build does not meet this rule');}
async function run(){
 let [out,first]=process.argv.slice(2);const origin=new URL(first).origin,port=process.env.CDP_PORT,root=resolve(import.meta.dirname,'..'),publicBuild=process.env.SIDEWALK_QUALITY_PUBLIC==='1';
 if(out===process.env.MMM_CHECK_OUT){out=mkdtempSync(resolve(root,'data/work/checks/checks-sidewalks-quality-'));console.log('Evidence kept at '+out);}mkdirSync(out,{recursive:true});
 const workRoot=process.env.SIDEWALK_ASSET_WORK_ROOT;
 const report={method:'every observed payload request must match the page quality and area; no requests in1884',publicBuild,workRoot:workRoot??null,loads:[],mutants:[]},save=()=>writeFileSync(out+'/quality-requests.json',JSON.stringify(report,null,2)+'\n');
 const poses={mabou:'624450,5103340,55',porthood:'613770,5096500,0',pointtupper:'628180,5052820,130'};
 async function page(area,low,era=false,mutant=false){
  const expected={area,low,era},requests=[],tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();let c,violation,loader,closed=false;
  try{
   c=await cdp(tab.webSocketDebuggerUrl,{onEvent:event=>{
    if(event.method==='Page.frameNavigated'&&!event.params.frame.parentId)loader=event.params.frame.loaderId;
    if(event.method==='Network.requestWillBeSent'){
     const path=new URL(event.params.request.url).pathname;
     try{if(assertPayloadRequest(path,expected))requests.push(path);}catch(e){violation=e;}
    }
    if(event.method==='Fetch.requestPaused')void(async()=>{
     const e=event.params,path=new URL(e.request.url).pathname;
     if(workRoot&&/\/(?:terrain|areas\/[^/]+)\/sidewalks-(?:low|desktop)\.json$/.test(path)){
      const file=resolve(workRoot,'data/baked','.'+path),bytes=readFileSync(file);assert.ok(file.startsWith(resolve(workRoot,'data/baked')+'/'));
      await c.send('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Cache-Control',value:'no-store'}],body:bytes.toString('base64')});return;
     }
     if(e.responseStatusCode!==200){await c.send('Fetch.continueRequest',{requestId:e.requestId});return;}
     const body=await c.send('Fetch.getResponseBody',{requestId:e.requestId}),original=body.result.base64Encoded?Buffer.from(body.result.body,'base64').toString():body.result.body;
     const changed=original.replace('loadSidewalkData(AREA.id, base, LOW)',`loadSidewalkData(AREA.id, base, ${low?'false':'true'})`);assert.notEqual(changed,original,'actual loader mutation anchor');
     await c.send('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:200,responseHeaders:(e.responseHeaders??[]).filter(h=>!['content-length','content-encoding'].includes(h.name.toLowerCase())),body:Buffer.from(changed).toString('base64')});
    })().catch(e=>{if(!closed)violation=e;});
   }});
   await c.send('Page.enable');await c.send('Network.enable');await c.send('Network.setCacheDisabled',{cacheDisabled:true});
   const patterns=[...(mutant?[{urlPattern:'*/src/main.ts*',requestStage:'Response'}]:[]),...(workRoot?[{urlPattern:'*/sidewalks-*.json*',requestStage:'Request'}]:[])];if(patterns.length)await c.send('Fetch.enable',{patterns});
   const nav=await c.send('Page.navigate',{url:`${origin}/?test=1&mode=explore&area=${area}&at=${poses[area]}&q=${low?'low':'high'}${era?'&era=1884':''}&radio=0&still=1&hud=0&shadows=1`});let ready=false;
   const deadline=Date.now()+120000;while(Date.now()<deadline){if(violation)throw violation;await sleep(100);if(loader!==nav.result.loaderId)continue;
    const r=await c.send('Runtime.evaluate',{expression:'document.documentElement?.dataset.mmmReady===\"true\"',returnByValue:true});if(r.result.result.value===true){ready=true;break;}}
   assert.ok(ready,'real page settles');await sleep(100);if(violation)throw violation;assertPayloadComplete(requests,era);
   if(!publicBuild){const r=await c.send('Runtime.evaluate',{expression:'mmm.sidewalks?.audit??null',returnByValue:true}),audit=r.result.result.value;
    if(era)assert.equal(audit,null);else{const full=unpack(readFileSync(resolve(root,`web/src/sidewalks-packed-${area}.json`))),compiled=full.compiled[low?1:0];const triangles=compiled.geometries.filter(Boolean).reduce((n,g)=>n+Buffer.from(g.positions,'base64').length/36,0);assert.equal(audit.triangles,triangles);assert.equal(audit.low,low);assert.equal(audit.disabled,false);}
   }
   report.loads.push({...expected,requests});save();console.log('PASS per-request quality',area,low,era,JSON.stringify(requests));
  }finally{closed=true;c?.close();await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});}
 }
 try{
  for(const area of Object.keys(poses))for(const low of [false,true])await page(area,low);
  for(const low of [false,true])await page('mabou',low,true);
  if(!publicBuild)for(const low of [false,true]){await assert.rejects(page('pointtupper',low,false,true),/wrong quality payload request/);report.mutants.push({low,rejected:true});save();console.log('REJECTED swapped quality request',low);}
  console.log('PASS all request paths,1884 absence and quality routing mutants');
 }finally{save();}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await run();
