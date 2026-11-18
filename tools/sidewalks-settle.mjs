// Probe-free page readiness. No script injection, response rewriting or game hooks.
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {cdp,cdpFetch,sleep} from './cdp.mjs';
import {timingStats} from './sidewalks-timing.mjs';
import {fileURLToPath} from 'node:url';
import {basename} from 'node:path';

export function backgroundProcesses(){
 const text=execFileSync('ps',['-axo','pid=,nice=,%cpu=,lstart=,comm='],{encoding:'utf8'}),rows=[];
 for(const line of text.split('\n')){const m=line.trim().match(/^(\d+)\s+(-?\d+)\s+([\d.]+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d+:\d+:\d+\s+\d{4})\s+(.+)$/);if(m)rows.push({pid:+m[1],nice:+m[2],cpu:+m[3],start:m[4],name:basename(m[5])});}
 return rows.sort((a,b)=>b.cpu-a.cpu).slice(0,12);
}

export const ownReadyExpression='document.documentElement?.dataset.mmmReady === "true"';
export function assertMeasuredLayer(audit,enabled){
 if(enabled)assert.ok(audit&&!audit.disabled&&audit.draws>0&&audit.triangles>0,'measured current page must contain the working sidewalk layer');
}
export async function measureOwnReady(c,url,{now=()=>performance.now(),pause=sleep,loader,pollMs=250,timeoutMs=240000}={}){
 const start=now(),navigation=await c.send('Page.navigate',{url});assert.ok(!navigation.result.errorText,navigation.result.errorText);
 const expected=navigation.result.loaderId;assert.ok(expected,'full navigation must identify its new document');
 let polls=0;
 while(now()-start<timeoutMs){
  await pause(pollMs);if(loader()!==expected)continue;
  const response=await c.send('Runtime.evaluate',{expression:ownReadyExpression,returnByValue:true});polls++;
  assert.ok(!response.result.exceptionDetails,'read-only readiness evaluation');
  if(response.result.result.value===true)return {ms:now()-start,polls,loaderId:expected};
 }throw Error('own ready timeout '+url);
}

async function run(){
 const [out,origin]=process.argv.slice(2),base=process.env.BASE_URL,port=process.env.CDP_PORT;
 if(!process.env.SIDEWALK_MEASURE_AREA||!process.env.SIDEWALK_MEASURE_QUALITY){
  const areas=process.env.SIDEWALK_MEASURE_AREA?[process.env.SIDEWALK_MEASURE_AREA]:['mabou','porthood','pointtupper'],qualities=process.env.SIDEWALK_MEASURE_QUALITY?[process.env.SIDEWALK_MEASURE_QUALITY]:['high','low'];
  for(const area of areas)for(const quality of qualities){const child=`${out}/${area}-${quality}`;mkdirSync(child,{recursive:true});execFileSync(process.execPath,[fileURLToPath(import.meta.url),child,origin],{env:{...process.env,SIDEWALK_MEASURE_AREA:area,SIDEWALK_MEASURE_QUALITY:quality},stdio:'inherit'});}return;
 }
 const area=process.env.SIDEWALK_MEASURE_AREA??'porthood',low=process.env.SIDEWALK_MEASURE_QUALITY==='low';
 const poses={mabou:'624450,5103340,55',porthood:'613770,5096500,0',pointtupper:'628180,5052820,130'};assert.ok(poses[area]);
 const report={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),base:process.env.SIDEWALK_MEASURE_BASE_REF,area,low,method:'probe-free existing data-mmm-ready, CDP read only, fixed 250 ms polling, new loader identity checked',injectedScripts:0,responseInterceptors:0,pollMs:250,pairs:7,rounds:[],loads:[]};
 const save=()=>writeFileSync(`${out}/probe-free.json`,JSON.stringify(report,null,2)+'\n');let tab,c,currentLoader;
 const at=(round,label)=>{const rows=report.loads.filter(v=>v.round===round&&v.label===label);assert.equal(rows.length,1);return rows[0];};
 const load=async(label,round,warmup,metadata)=>{
  const url=(label==='fixed'||label==='warm-fixed'?origin:base)+`/?test=1&mode=explore&at=${poses[area]}&area=${area}&q=${low?'low':'high'}&radio=0&still=1&hud=0&shadows=1`;
  const navigationStartedAt=new Date().toISOString(),r=await measureOwnReady(c,url,{loader:()=>currentLoader});
  // Outside the measured interval: an optional asset/worker failure must never create a fast false PASS.
  const state=await c.send('Runtime.evaluate',{expression:'globalThis.mmm?.sidewalks?.audit??null',returnByValue:true}),layer=state.result.result.value;
  report.loads.push({label,round,warmup,roundMetadata:metadata,navigationStartedAt,...r,layer});save();assertMeasuredLayer(layer,label==='fixed'||label==='warm-fixed');console.log('SETTLE',JSON.stringify(report.loads.at(-1)));
 };
 try{
  tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  c=await cdp(tab.webSocketDebuggerUrl,{onEvent:m=>{if(m.method==='Page.frameNavigated'&&!m.params.frame.parentId)currentLoader=m.params.frame.loaderId;}});await c.send('Page.enable');
  await load('warm-main',-1,true,null);await load('warm-fixed',-1,true,null);
  for(let round=0;round<7;round++){
   const time=Date.now(),cutoff=Date.parse(process.env.SIDEWALK_VALID_AFTER??'1970-01-01T00:00:00Z');assert.ok(time>=cutoff,'approved quiet cutoff');
   const metadata={round,startedAt:new Date(time).toISOString(),local:new Date(time).toString(),processes:backgroundProcesses()};report.rounds.push(metadata);save();console.log('ROUND',JSON.stringify(metadata));
   const blocks=[['noise-a','noise-b'],['base-fixed','fixed']];if(round%2)blocks.reverse();
   for(const block of blocks)for(const label of block)await load(label,round,false,metadata);
  }
  const deltas=(a,b)=>timingStats(Array.from({length:7},(_,i)=>at(i,a).ms-at(i,b).ms));
  const noise=deltas('noise-b','noise-a'),current=deltas('fixed','base-fixed');
  report.result={noise,currentVsMain:current,mainAbsolute:timingStats(report.loads.filter(v=>!v.warmup&&v.label!=='fixed').map(v=>v.ms)),currentAbsolute:timingStats(report.loads.filter(v=>v.label==='fixed').map(v=>v.ms)),settle:current.median<noise.min?'faster-than-noise':current.median<=noise.max?'within-noise':'outside-noise'};save();
  assert.notEqual(report.result.settle,'outside-noise','probe-free current median outside same-row main/main spread');console.log('PASS probe-free settle',JSON.stringify(report.result));
 }finally{save();c?.close();if(tab)await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await run();
