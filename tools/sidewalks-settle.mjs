// Probe-free page readiness against a plain start-up budget per area and quality.
// No script injection, response rewriting, game hooks, or main/main noise spread.
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
export const POSES=Object.freeze({
 mabou:'624450,5103340,55',
 porthood:'613770,5096500,0',
 pointtupper:'628180,5052820,130',
 cansocauseway:'623863,5056467,0',
 judique:'617135,5081421,-8',
 westbay:'642341,5063326,132',
});
export const SIDEWALK_AREAS=new Set(['mabou','porthood','pointtupper']);
export const DEFAULT_AREAS=['mabou','porthood','pointtupper','cansocauseway','judique','westbay'];
// Written probe-free data-mmm-ready ceilings (ms) on Apple silicon hardware Metal at load1 < 20.
// Measured baselines (M1 Pro, 21 Nov 2026): mabou 2404/5370, porthood 1727/3505, pointtupper 1952/4855,
// cansocauseway 1728/3924, judique 2003/4208, westbay 2705/5576 (LOW/HIGH medians), with ~35-45% headroom.
// Raise a ceiling only with a PR that says what the player gets for the slower start.
export const STARTUP_BUDGET_MS=Object.freeze({
 mabou:Object.freeze({low:3500,high:7000}),
 porthood:Object.freeze({low:2500,high:5000}),
 pointtupper:Object.freeze({low:3000,high:6500}),
 cansocauseway:Object.freeze({low:2600,high:5500}),
 judique:Object.freeze({low:2800,high:5600}),
 westbay:Object.freeze({low:3800,high:7500}),
});
export function budgetFor(area,quality){
 const row=STARTUP_BUDGET_MS[area];assert.ok(row,`no start-up budget for area ${area}`);
 const limit=row[quality];assert.ok(Number.isFinite(limit)&&limit>0,`no start-up budget for ${area} ${quality}`);
 return limit;
}
export function evaluateBudget(area,quality,samples){
 const ceilingMs=budgetFor(area,quality),stats=timingStats(samples);
 return {area,quality,ceilingMs,...stats,marginMs:ceilingMs-stats.median,pass:stats.median<=ceilingMs};
}
export function assertWithinBudget(area,quality,samples){
 const result=evaluateBudget(area,quality,samples);
 assert.ok(result.pass,`${area} ${quality} start-up median ${result.median.toFixed(1)} ms exceeds budget ${result.ceilingMs} ms (raise only with a PR that says what the player gets)`);
 return result;
}
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

export function parseSelection(raw,fallback,label){
 if(raw===undefined||raw==='')return fallback;
 const list=raw.split(',').map(v=>v.trim()).filter(Boolean);
 assert.ok(list.length>0,`empty ${label} selection`);
 return list;
}
export function parseRuns(raw,fallback=5){
 if(raw===undefined||raw==='')return fallback;
 const runs=Number(raw);
 assert.ok(Number.isInteger(runs)&&runs>0,`invalid STARTUP_BUDGET_RUNS: ${raw}`);
 return runs;
}

async function run(){
 const [out,origin]=process.argv.slice(2),port=process.env.CDP_PORT;
 const rawArea=process.env.SIDEWALK_MEASURE_AREA,rawQuality=process.env.SIDEWALK_MEASURE_QUALITY;
 const areas=parseSelection(rawArea,DEFAULT_AREAS,'SIDEWALK_MEASURE_AREA');
 const qualities=parseSelection(rawQuality,['high','low'],'SIDEWALK_MEASURE_QUALITY');
 if(!rawArea||rawArea.includes(',')||!rawQuality||rawQuality.includes(',')){
  for(const area of areas)for(const quality of qualities){
   const child=`${out}/${area}-${quality}`;mkdirSync(child,{recursive:true});
   execFileSync(process.execPath,[fileURLToPath(import.meta.url),child,origin],{env:{...process.env,SIDEWALK_MEASURE_AREA:area,SIDEWALK_MEASURE_QUALITY:quality},stdio:'inherit'});
  }
  return;
 }
 const area=areas[0],quality=qualities[0],low=quality==='low';
 assert.ok(POSES[area],`unknown timing pose for area ${area}`);
 assert.ok(quality==='low'||quality==='high',`unknown quality ${quality}`);
 const runs=parseRuns(process.env.STARTUP_BUDGET_RUNS),ceilingMs=budgetFor(area,quality),requireLayer=SIDEWALK_AREAS.has(area);
 const report={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),area,quality,low,ceilingMs,runs,method:'probe-free existing data-mmm-ready, CDP read only, fixed 250 ms polling, new loader identity checked, plain start-up budget',injectedScripts:0,responseInterceptors:0,pollMs:250,rounds:[],loads:[]};
 const save=()=>writeFileSync(`${out}/probe-free.json`,JSON.stringify(report,null,2)+'\n');let tab,c,currentLoader;
 const load=async(label,round,warmup,metadata)=>{
  const url=origin+`/?test=1&mode=explore&at=${POSES[area]}&area=${area}&q=${quality}&radio=0&still=1&hud=0&shadows=1`;
  const navigationStartedAt=new Date().toISOString(),r=await measureOwnReady(c,url,{loader:()=>currentLoader});
  // Outside the measured interval: an optional asset/worker failure must never create a fast false PASS.
  const state=await c.send('Runtime.evaluate',{expression:'globalThis.mmm?.sidewalks?.audit??null',returnByValue:true}),layer=state.result.result.value;
  report.loads.push({label,round,warmup,roundMetadata:metadata,navigationStartedAt,...r,layer});save();assertMeasuredLayer(layer,requireLayer);console.log('SETTLE',JSON.stringify(report.loads.at(-1)));
 };
 try{
  tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  c=await cdp(tab.webSocketDebuggerUrl,{onEvent:m=>{if(m.method==='Page.frameNavigated'&&!m.params.frame.parentId)currentLoader=m.params.frame.loaderId;}});await c.send('Page.enable');
  await load('warm-current',-1,true,null);
  for(let round=0;round<runs;round++){
   const time=Date.now(),cutoff=Date.parse(process.env.SIDEWALK_VALID_AFTER??'1970-01-01T00:00:00Z');assert.ok(time>=cutoff,'approved quiet cutoff');
   const metadata={round,startedAt:new Date(time).toISOString(),local:new Date(time).toString(),processes:backgroundProcesses()};report.rounds.push(metadata);save();console.log('ROUND',JSON.stringify(metadata));
   await load('current',round,false,metadata);
  }
  const samples=report.loads.filter(v=>!v.warmup).map(v=>v.ms);
  report.result=evaluateBudget(area,quality,samples);save();
  assertWithinBudget(area,quality,samples);
  console.log('PASS probe-free start-up budget',JSON.stringify(report.result));
 }finally{save();c?.close();if(tab)await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await run();
