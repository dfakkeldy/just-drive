import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cdp,cdpFetch,sleep} from './cdp.mjs';
import {measureOwnReady,backgroundProcesses,assertMeasuredLayer} from './sidewalks-settle.mjs';
import {timingStats} from './sidewalks-timing.mjs';
export function instrumentColdWorld(source){
 const token='function updateWorld(';assert.equal(source.split(token).length,2);
 return source.replace(token,'function __coldOriginalUpdateWorld(')+`\nfunction updateWorld(segment,dt,realDt=dt,now=0){const p=globalThis.__coldProbe,start=performance.now();try{return __coldOriginalUpdateWorld(segment,dt,realDt,now);}finally{const ms=performance.now()-start;if(p?.frame){p.frame.world+=ms;p.frame.segments[segment]=(p.frame.segments[segment]??0)+ms;}}}\n`;
}
export function installColdProbe(){
 globalThis.__coldProbe={frames:[],frame:null};const p=globalThis.__coldProbe,raf=requestAnimationFrame.bind(globalThis);
 requestAnimationFrame=callback=>raf(t=>{
  const m=globalThis.mmm,game=callback.name==='frame'&&m?.renderer;
  if(game){if(m.sidewalks&&!p.wrapped){const original=m.sidewalks.update;m.sidewalks.update=function(){const start=performance.now();try{return original.call(this);}finally{if(p.frame)p.frame.sidewalk+=performance.now()-start;}};p.wrapped=true;}p.frame={index:p.frames.length,at:performance.now(),world:0,sidewalk:0,segments:{}};}
  const start=performance.now();callback(t);
  if(game){p.frame.whole=performance.now()-start;p.frames.push(p.frame);p.frame=null;if(!p.readyAt&&document.documentElement.dataset.mmmReady==='true')p.readyAt=performance.now();}
 });
}
export function summarizeCold(frames,readyAt){
 const included=frames.filter(f=>f.at<=readyAt+5000);assert.ok(included.length>20);const peak=key=>included.reduce((a,b)=>b[key]>a[key]?b:a);
 return {frames:included.length,worldMax:peak('world').world,worldPeak:peak('world'),wholeMax:peak('whole').whole,wholePeak:peak('whole'),sidewalkMax:peak('sidewalk').sidewalk,sidewalkPeak:peak('sidewalk')};
}
async function sample(){
 const [out,origin]=process.argv.slice(2),side=process.env.SIDEWALK_COLD_SIDE??'current',url=(side==='main'?process.env.BASE_URL:origin)+'/?test=1&mode=explore&at=624450,5103340,55&area=mabou&q=high&radio=0&still=1&hud=0&shadows=1';
 let tab,c,loader,failure;const report={side,startedAt:new Date().toISOString(),processes:backgroundProcesses(),method:'fresh-profile first load; identical updateWorld wrapper; per-frame sum until own ready+5s; no query clocks'};
 try{
  tab=await(await cdpFetch(`http://127.0.0.1:${process.env.CDP_PORT}/json/new?about:blank`,{method:'PUT'})).json();
  c=await cdp(tab.webSocketDebuggerUrl,{onEvent:m=>{
   if(m.method==='Page.frameNavigated'&&!m.params.frame.parentId)loader=m.params.frame.loaderId;
   if(m.method==='Fetch.requestPaused')void(async()=>{const e=m.params;assert.equal(e.responseStatusCode,200);const r=await c.send('Fetch.getResponseBody',{requestId:e.requestId}),text=r.result.base64Encoded?Buffer.from(r.result.body,'base64').toString():r.result.body,source=instrumentColdWorld(text),headers=(e.responseHeaders??[]).filter(h=>!['content-length','content-encoding','content-type'].includes(h.name.toLowerCase()));headers.push({name:'Content-Type',value:'application/javascript'});await c.send('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:200,responseHeaders:headers,body:Buffer.from(source).toString('base64')});})().catch(error=>{failure=error;process.exitCode=1;});
  }});
  await c.send('Page.enable');await c.send('Page.addScriptToEvaluateOnNewDocument',{source:`(${installColdProbe.toString()})()`});await c.send('Fetch.enable',{patterns:[{urlPattern:'*/src/main.ts*',requestStage:'Response'}]});
  report.observedReady=await measureOwnReady(c,url,{loader:()=>loader});if(failure)throw failure;await sleep(5000);
  const result=await c.send('Runtime.evaluate',{expression:'({frames:__coldProbe.frames,readyAt:__coldProbe.readyAt})',returnByValue:true});report.raw=result.result.result.value;assert.ok(report.raw.readyAt);report.summary=summarizeCold(report.raw.frames,report.raw.readyAt);
  // Read only after the ready+5s sample: skipping an optional asset cannot pass the gate.
  const state=await c.send('Runtime.evaluate',{expression:'globalThis.mmm?.sidewalks?.audit??null',returnByValue:true});report.layer=state.result.result.value;assertMeasuredLayer(report.layer,side==='current');console.log('COLD',JSON.stringify({...report,raw:undefined}));
 }finally{writeFileSync(`${out}/cold.json`,JSON.stringify(report,null,2)+'\n');c?.close();if(tab)await cdpFetch(`http://127.0.0.1:${process.env.CDP_PORT}/json/close/${tab.id}`).catch(()=>{});}
}
function aggregate(){
 const root=process.argv[3],samples=[];for(let i=0;i<3;i++)for(const side of ['main','current'])samples.push(JSON.parse(readFileSync(`${root}/${i}-${side}/cold.json`,'utf8')));
 const main=timingStats(samples.filter(s=>s.side==='main').map(s=>s.summary.worldMax)),current=timingStats(samples.filter(s=>s.side==='current').map(s=>s.summary.worldMax)),delta=current.median-main.median;
 const report={main,current,delta,mainVariation:[main.min-main.median,main.max-main.median],pass:delta<=1||(current.median>=main.min&&current.median<=main.max),samples:samples.map(s=>({side:s.side,startedAt:s.startedAt,...s.summary}))};writeFileSync(`${root}/summary.json`,JSON.stringify(report,null,2)+'\n');console.log('COLD SUMMARY',JSON.stringify(report));assert.ok(report.pass,'cold world CPU delta exceeds1ms and main spread');
}
if(process.argv[1]===fileURLToPath(import.meta.url)){if(process.argv[2]==='--aggregate')aggregate();else await sample();}
