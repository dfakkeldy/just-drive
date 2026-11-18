// Observation-only paired phase diagnostic. This is never a settle or frame gate.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {cdp,cdpFetch,sleep} from './cdp.mjs';
import {instrumentMain,installDetailedProbe,resolveMainResponse} from './sidewalks-probe.mjs';

export function installWorkerTiming(){
 const handler=self.onmessage,post=self.postMessage;let sequence=0,lastReads=0,lastCompleted=0;
 self.onmessage=function(event){
  const started=performance.now(),outputs={};let reads=lastReads,completed=lastCompleted;
  self.postMessage=function(data,...args){outputs[data.type]=(outputs[data.type]??0)+(data.count??1);if(data.type==='done'){reads=data.reads;completed=data.completed;}return post.call(this,data,...args);};
  try{return handler.call(this,event);}finally{
   self.postMessage=post;
   post.call(self,{type:'walk-diagnostic',sequence:++sequence,kind:event.data.type,level:event.data.tile?.level,
    started:performance.timeOrigin+started,ms:performance.now()-started,outputs,reads:reads-lastReads,completed:completed-lastCompleted});
   lastReads=reads;lastCompleted=completed;
  }
 };
}
export const workerSuffix=`;(${installWorkerTiming.toString()})();`;
export function instrumentDiagnosticMain(source){
 const observed=instrumentMain(source),token='function updateWorld(';assert.equal(observed.source.split(token).length,2);
 const extra='\nfunction updateWorld(segment,dt,realDt=dt,now=0){const p=globalThis.__walkProbe,t=performance.now();try{return __diagnosticUpdateWorld(segment,dt,realDt,now);}finally{const ms=performance.now()-t,r=p.world[segment]??={calls:0,total:0,max:0};r.calls++;r.total+=ms;r.max=Math.max(r.max,ms);}}\n';
 const changed=observed.source.replace(token,'function __diagnosticUpdateWorld(')+extra;
 return {source:changed,strip:s=>observed.strip(s.replace(extra,'').replace('function __diagnosticUpdateWorld(',token))};
}
export function timedDiagnosticMethod(original,record){
 return function(a,b,c,d,e,f){const start=performance.now();try{return original.apply(this,arguments);}finally{
  const at=performance.now(),ms=at-start;record.calls++;record.total+=ms;record.max=Math.max(record.max,ms);record.firstAt??=start;record.lastAt=at;
 }};
}
export function installDiagnosticProbe(suffix,timed){
 const p=globalThis.__walkProbe;p.world={};p.methods={};p.worker={sent:[],completed:[],levels:{},transitions:{},outstanding:0,maxOutstanding:0};p.frames=[];
 const NativeBlob=globalThis.Blob,NativeWorker=globalThis.Worker,createURL=URL.createObjectURL.bind(URL),urls=new Set();
 globalThis.Blob=class extends NativeBlob{constructor(parts,options){const walk=typeof parts?.[0]==='string'&&parts[0].includes('sidewalkHeightWorker');super(walk?[...parts,suffix]:parts,options);this.walkDiagnostic=walk;}};
 URL.createObjectURL=blob=>{const url=createURL(blob);if(blob.walkDiagnostic)urls.add(url);return url;};
 globalThis.Worker=class extends NativeWorker{constructor(url,...args){super(url,...args);if(!urls.has(String(url)))return;
  let coverage;const levels=new Map(),sent=[];const post=this.postMessage;
  this.postMessage=function(data,...rest){
   const record={at:performance.now(),kind:data.type,level:data.tile?.level,members:data.members?.reduce((n,ids)=>n+ids.length,0)??0,
    bytes:(data.tile?.positions.byteLength??0)+(data.tile?.ground?.byteLength??0),cells:(data.cells?.length??0)/2};
   if(data.type==='init'){coverage=data.coverage;record.jobs=data.jobs.length;record.surfaces=data.jobs.reduce((n,j)=>n+j.surfaces.length,0);}
   if(data.type==='coverage'){
    const ids=new Set();for(let i=0;i<data.cells.length;i+=2){const cell=data.cells[i],level=data.cells[i+1],prior=levels.get(cell)??-2,key=prior+'>'+level;
     p.worker.transitions[key]=(p.worker.transitions[key]??0)+1;levels.set(cell,level);for(const id of coverage.cells[cell])ids.add(id);
    }record.affectedJobs=ids.size;
   }
   sent.push(record);p.worker.sent.push(record);p.worker.outstanding++;p.worker.maxOutstanding=Math.max(p.worker.maxOutstanding,p.worker.outstanding);return post.call(this,data,...rest);
  };
  this.addEventListener('message',({data})=>{if(data.type!=='walk-diagnostic')return;const record=sent[data.sequence-1];p.worker.outstanding--;
   p.worker.completed.push({...data,received:performance.now(),queueMs:data.started-(performance.timeOrigin+record.at)});
  });
 }};
 let exposed;
 Object.defineProperty(globalThis,'mmm',{configurable:true,get:()=>exposed,set(value){exposed=value;p.exposedAt=performance.now();let walk;
  Object.defineProperty(value,'sidewalks',{configurable:true,get:()=>walk,set(w){walk=w;if(!w)return;p.attachWalk(w);
   for(const name of ['update','tileReady','tileSelected','coverageSelected','selectSome','receiveHeights','apply','clearCanopy','terrainMask']){
    const original=w[name];if(typeof original!=='function')continue;const r=p.methods[name]={calls:0,total:0,max:0};
    w[name]=timed(original,r);
   }
   // Deliberately no clock, allocation or geometry inspection in a per-blade query.
   const vegetation=w.vegetationAt;p.vegetation={calls:0,blocked:0};w.vegetationAt=function(a,b,c){p.vegetation.calls++;const value=vegetation.call(this,a,b,c);if(value)p.vegetation.blocked++;return value;};
  }});
 }});
 const raf=requestAnimationFrame.bind(globalThis);
 requestAnimationFrame=callback=>raf(t=>{const game=callback.name==='frame'&&exposed?.renderer;if(game)p.attachWorld(exposed);callback(t);if(game){
  const w=exposed.sidewalks,state=w?{worker:w.workerPending,incoming:w.incoming.length-w.incomingAt,selection:w.selections.length-w.selectionAt,dirty:w.dirtyWrite-w.dirtyAt,tasks:w.tasks.length-w.taskAt}:null;
  p.frames.push({at:performance.now(),mask:p.lastNonQuietMask??0,queues:state});if(!p.readyAt&&document.documentElement.dataset.mmmReady==='true')p.readyAt=performance.now();
 }});
}

async function run(){
 const [out,origin]=process.argv.slice(2),base=process.env.BASE_URL,port=process.env.CDP_PORT;
 const areas=(process.env.SIDEWALK_DIAGNOSTIC_AREAS??'pointtupper').split(','),pairs=Number(process.env.SIDEWALK_DIAGNOSTIC_PAIRS??3);
 const poses={mabou:'624450,5103340,55',porthood:'613770,5096500,0',pointtupper:'628180,5052820,130'};assert.ok(areas.every(a=>poses[a]));
 const sources=new Map(),report={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),base:process.env.SIDEWALK_MEASURE_BASE_REF,
  productionHash:createHash('sha256').update(['main.ts','terrain.ts','sidewalks.ts','sidewalks-worker.ts','sidewalks-heights.ts'].map(n=>readFileSync(new URL('../web/src/'+n,import.meta.url))).join('')).digest('hex'),
  method:'DIAGNOSTIC ONLY; identical main phase hooks; no per-query clocks; worker callback batch clocks and queue counts; three paired loads plus main/main controls; does not replace failed probe-free gate',loads:[],errors:[]};
 const save=()=>writeFileSync(`${out}/diagnostic.json`,JSON.stringify(report,null,2)+'\n');let tab,c,error;
 try{
  tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  c=await cdp(tab.webSocketDebuggerUrl,{onEvent:event=>{if(event.method==='Runtime.exceptionThrown'){report.errors.push(event.params.exceptionDetails);save();}if(event.method==='Fetch.requestPaused')void(async()=>{
   const e=event.params;let body;if(e.responseStatusCode===200){const r=await c.send('Fetch.getResponseBody',{requestId:e.requestId});body=r.result.base64Encoded?Buffer.from(r.result.body,'base64').toString():r.result.body;}
   const etag=e.responseHeaders?.find(h=>h.name.toLowerCase()==='etag')?.value,original=resolveMainResponse(e.responseStatusCode,sources.get(e.request.url),body,etag);sources.set(e.request.url,original);
   const changed=instrumentDiagnosticMain(original.source);assert.equal(changed.strip(changed.source),original.source);
   const headers=(e.responseHeaders??[]).filter(h=>!['content-length','content-encoding'].includes(h.name.toLowerCase()));if(!headers.some(h=>h.name.toLowerCase()==='content-type'))headers.push({name:'Content-Type',value:'application/javascript'});
   await c.send('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:200,responseHeaders:headers,body:Buffer.from(changed.source).toString('base64')});
  })().catch(e=>{error=e;});}});
  await c.send('Page.enable');await c.send('Runtime.enable');await c.send('Page.addScriptToEvaluateOnNewDocument',{source:`globalThis.__walkProbe={};(${installDetailedProbe.toString()})();(${installDiagnosticProbe.toString()})(${JSON.stringify(workerSuffix)},(${timedDiagnosticMethod.toString()}));`});
  await c.send('Fetch.enable',{patterns:[{urlPattern:'*/src/main.ts*',requestStage:'Response'}]});
  for(const area of areas){const entries=[['main',-1],['current',-1]];
   for(let n=0;n<pairs;n++){const blocks=[['noise-a','noise-b'],['main','current']];if(n%2)blocks.reverse();for(const block of blocks)for(const label of block)entries.push([label,n]);}
   for(const [label,round]of entries){
    const url=(label==='current'?origin:base)+`/?test=1&mode=explore&area=${area}&at=${poses[area]}&q=low&radio=0&still=1&hud=0&shadows=1`,start=Date.now();await c.send('Page.navigate',{url});let ready=false;
    while(Date.now()-start<180000){if(error)throw error;await sleep(100);const r=await c.send('Runtime.evaluate',{expression:'document.documentElement?.dataset.mmmReady===\"true\" && !!globalThis.__walkProbe.readyAt',returnByValue:true});if(r.result.result.value===true){ready=true;break;}}
    if(!ready){const partial=await c.send('Runtime.evaluate',{expression:'({ownReady:document.documentElement.dataset.mmmReady,probe:globalThis.__walkProbe,audit:globalThis.mmm?.sidewalks?.audit,failed:globalThis.mmm?.terrain?.failed})',returnByValue:true});report.failure={area,label,round,partial:partial.result.result.value};save();}
    assert.ok(ready,'diagnostic own-ready timeout');const r=await c.send('Runtime.evaluate',{expression:'({probe:__walkProbe,audit:mmm.sidewalks?.audit??null,terrain:{ready:mmm.terrain.readyCount,revision:mmm.terrain.dataRevision}})',returnByValue:true});
    assert.ok(!r.result.exceptionDetails);report.loads.push({area,label,round,...r.result.result.value});save();console.log('DIAGNOSTIC',area,label,round,JSON.stringify({ready:r.result.result.value.probe.readyAt,audit:r.result.result.value.audit}));
   }
  }
  assert.ok(report.loads.filter(l=>l.label==='current').every(l=>l.audit&&!l.audit.disabled&&l.probe.worker.sent.some(m=>m.kind==='init')&&l.probe.worker.completed.length>0),'current must render real sidewalks and observe its real worker');console.log('PASS diagnostic collection; no performance verdict');
 }finally{save();c?.close();if(tab)await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await run();
