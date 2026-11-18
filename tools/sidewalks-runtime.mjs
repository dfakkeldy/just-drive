#!/usr/bin/env node
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cdp,cdpFetch,sleep} from './cdp.mjs';
import {replaySchedule,compareReplay,assertReplayTargets} from './sidewalks-timing.mjs';
import {instrumentMain,installDetailedProbe,resolveMainResponse} from './sidewalks-probe.mjs';
import {backgroundProcesses} from './sidewalks-settle.mjs';
const [out,origin]=process.argv.slice(2),port=process.env.CDP_PORT,base=process.env.BASE_URL,before=process.env.BEFORE_URL;
const phase=process.env.SIDEWALK_RUNTIME_PHASE??'loads',reviewedBaseline=process.env.SIDEWALK_REVIEWED_BASELINE==='1';
assert.ok(['loads','proof','frames'].includes(phase),'explicit diagnostic timing, clocked frames or live-proof row');
const areas=['mabou','porthood','pointtupper'],poses={mabou:'624450,5103340,55',porthood:'613770,5096500,0',pointtupper:'628180,5052820,130'};
const runNames=JSON.parse(readFileSync(new URL('../web/src/sidewalks-data.json',import.meta.url),'utf8')).runs.map(r=>r.id);
const startupBaseline=JSON.parse(readFileSync(new URL('./baseline/sidewalks-startup.json',import.meta.url),'utf8'));
const selectedAreas=process.env.SIDEWALK_MEASURE_AREA?[process.env.SIDEWALK_MEASURE_AREA]:areas;
const selectedQualities=process.env.SIDEWALK_MEASURE_QUALITY?[process.env.SIDEWALK_MEASURE_QUALITY==='low']:[false,true];
assert.ok(selectedAreas.every(a=>areas.includes(a)),'known measurement area');
assert.ok(!process.env.SIDEWALK_MEASURE_QUALITY||['low','high'].includes(process.env.SIDEWALK_MEASURE_QUALITY),'known measurement quality');
const preload=`(()=>{
 localStorage.clear();window.__walkProbe={frames:[],methods:{},current:0};(${installDetailedProbe.toString()})();let exposed;
 const countsOnly=new URLSearchParams(location.search).get('walkProbe')==='counts';__walkProbe.queryTiming=countsOnly?'counts-only diagnostic':'every-call clocks';
 Object.defineProperty(window,'mmm',{configurable:true,get:()=>exposed,set(v){exposed=v;__walkProbe.exposedAt=performance.now();let walk;
  Object.defineProperty(v,'sidewalks',{configurable:true,get:()=>walk,set(w){walk=w;if(!w)return;__walkProbe.attachWalk(w);for(const name of ['update','vegetationAt','terrainMask','clearCanopy','tileReady','tileSelected']){
   if(typeof w[name]!=='function')continue;const original=w[name],timing=__walkProbe.methods[name]={calls:0,total:0,max:0};
   // Fixed arity: a profiling array for every blade/tree query would create the hitch being measured.
   if(name==='vegetationAt'&&countsOnly){w[name]=function(a,b,c){timing.calls++;if(timing.calls===1)timing.firstAt=performance.now();const value=original.call(this,a,b,c);if(value)timing.blocked=(timing.blocked??0)+1;return value;};}
   else w[name]=function(a,b,c,d,e,f){const start=performance.now();let value;try{return value=original.call(this,a,b,c,d,e,f);}finally{const end=performance.now(),ms=end-start;__walkProbe.current+=ms;timing.calls++;timing.total+=ms;timing.max=Math.max(timing.max,ms);timing.firstAt??=start;timing.lastAt=end;if(name==='vegetationAt'&&value)timing.blocked=(timing.blocked??0)+1;}};
  }}});
 }});
 const raf=requestAnimationFrame.bind(window);requestAnimationFrame=callback=>raf(t=>{const game=callback.name==='frame'&&exposed?.renderer;if(game){__walkProbe.current=0;__walkProbe.attachWorld(exposed);__walkProbe.stages.firstFrame??=performance.now();}const start=performance.now();callback(t);if(game){__walkProbe.frames.push({at:t,cost:__walkProbe.current,wall:performance.now()-start});if(exposed?.terrain?.pending)__walkProbe.lastTerrainBusy=t;if(exposed?.sidewalks?.pending)__walkProbe.lastSidewalkBusy=t;if(!__walkProbe.readyAt&&document.documentElement.dataset.mmmReady==='true')__walkProbe.readyAt=performance.now();}});
})()`;
let tab,c;const sourceHash=createHash('sha256').update(['main.ts','sidewalks.ts','sidewalks-cache.ts','sidewalks-worker.ts','sidewalks-heights.ts','terrain.ts','props.ts'].map(p=>readFileSync(new URL('../web/src/'+p,import.meta.url))).reduce((a,b)=>Buffer.concat([a,b]),Buffer.alloc(0))).digest('hex');
const report={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),base:process.env.SIDEWALK_MEASURE_BASE_REF??null,replay:process.env.SIDEWALK_MEASURE_REPLAY??null,sourceHash,probeHash:createHash('sha256').update(installDetailedProbe.toString()+instrumentMain.toString()+preload).digest('hex'),measurementDirty:execFileSync('git',['status','--short','--','tools/sidewalks*'],{encoding:'utf8'}).trim(),method:'adjacent main/main, main/a32 and main/current pairs; alternating block order; 7 desktop/3 LOW rounds; PH desktop adds a counts-only diagnostic pair',profiler:'fixed-arity; primary query clocks retained; pending getters observed once; actual upload callbacks',intercepts:[],loads:[],sweeps:[],contacts:[],grass:[],pictures:[]};
const save=()=>writeFileSync(`${out}/runtime-${process.env.SIDEWALK_SMOKE?"smoke":phase}.json`,JSON.stringify(report,null,2)+'\n');
async function evaluate(expression){const r=await c.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.result.exceptionDetails,JSON.stringify(r.result.exceptionDetails));return r.result.result.value;}
let interceptError;const mainSources=new Map();
async function interceptMain(event){
 const started=Date.now();
 let body;if(event.responseStatusCode===200){const response=await c.send('Fetch.getResponseBody',{requestId:event.requestId});body=response.result.base64Encoded?Buffer.from(response.result.body,'base64').toString():response.result.body;}
 const etag=event.responseHeaders?.find(h=>h.name.toLowerCase()==='etag')?.value,cached=resolveMainResponse(event.responseStatusCode,mainSources.get(event.request.url),body,etag);mainSources.set(event.request.url,cached);
 const source=cached.source,changed=instrumentMain(source);assert.equal(changed.strip(changed.source),source,'probe only adds observations');
 const record={url:event.request.url,sourceHash:createHash('sha256').update(source).digest('hex'),markers:changed.markers};report.intercepts.push(record);
 const headers=(event.responseHeaders??[]).filter(h=>!['content-length','content-encoding'].includes(h.name.toLowerCase()));if(!headers.some(h=>h.name.toLowerCase()==='content-type'))headers.push({name:'Content-Type',value:'application/javascript; charset=utf-8'});
 await c.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:200,responseHeaders:headers,body:Buffer.from(changed.source).toString('base64')});
 record.elapsedMs=Date.now()-started;
}
async function navigate(url){const start=Date.now();await c.send('Page.navigate',{url});let state;while(Date.now()-start<240000){if(interceptError)throw interceptError;await sleep(100);state=await evaluate('({title:document.title,ready:document.documentElement?.dataset.mmmReady,error:document.getElementById("gameError")?.hidden===false})');if(state.error)throw Error('page error '+url);if(state.title==='settled'||state.ready==='true')return (await evaluate('__walkProbe.readyAt'))??(Date.now()-start);}throw Error('settle timeout '+url+JSON.stringify(state));}
try {
 for(const u of [origin,base,before]) {for(let i=0;i<100;i++){try{if((await fetch(u)).ok)break;}catch{}await sleep(100);}}
 tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();c=await cdp(tab.webSocketDebuggerUrl,{onEvent:message=>{if(message.method==='Fetch.requestPaused')void interceptMain(message.params).catch(error=>{interceptError=error;process.exitCode=1;void c.send('Fetch.failRequest',{requestId:message.params.requestId,errorReason:'Failed'});});}});await c.send('Page.enable');await c.send('Page.addScriptToEvaluateOnNewDocument',{source:preload});await c.send('Fetch.enable',{patterns:[{urlPattern:'*/src/main.ts*',requestStage:'Response'}]});
 const smoke=!!process.env.SIDEWALK_SMOKE;
 if(phase!=='proof')for(const area of (smoke?['mabou']:selectedAreas))for(const low of (smoke?[false]:selectedQualities)){
  const diagnostic=phase==='loads'&&area==='porthood'&&!low,urls={main:base,a32:before,fixed:origin,'fixed-counts':origin};
  const warmups=(phase==='frames'?['fixed']:diagnostic?['main','a32','fixed','fixed-counts']:['main','a32','fixed']).map(variant=>({variant,label:`warm-${variant}`,round:-1,warmup:true}));
  const measured=phase==='frames'?Array.from({length:3},(_,round)=>({variant:'fixed',label:'fixed',round})):replaySchedule(low?3:7,diagnostic);
  let roundMetadata;
  for(const entry of (smoke?[{variant:'fixed',label:'fixed',round:0}]:[...warmups,...measured])){
   const {label,variant}=entry,url=urls[variant];
   if(entry.round>=0&&roundMetadata?.round!==entry.round){
    const startedAt=Date.now(),notBefore=Date.parse(process.env.SIDEWALK_VALID_AFTER??'1970-01-01T00:00:00Z');assert.ok(Number.isFinite(notBefore)&&startedAt>=notBefore,'round must begin after the approved quiet cutoff');
    roundMetadata={area,low,round:entry.round,startedAt:new Date(startedAt).toISOString(),local:new Date(startedAt).toString(),processes:backgroundProcesses()};(report.rounds??=[]).push(roundMetadata);save();console.log('ROUND',JSON.stringify(roundMetadata));
   }
   const navigationStartedAt=new Date().toISOString();
   const ms=await navigate(`${url}/?test=1&mode=explore&at=${poses[area]}&area=${area}&q=${low?'low':'high'}&radio=0&still=1&hud=0&shadows=1${variant==='fixed-counts'?'&walkProbe=counts':''}`);
   const result=await evaluate(`(()=>{const p=__walkProbe,stats=key=>{const xs=p.frames.map(f=>f[key]).sort((a,b)=>a-b),n=xs.length;return {samples:n,median:xs[Math.floor(n/2)]??0,p95:xs[Math.ceil(n*.95)-1]??0,worst:xs[n-1]??0};};return {audit:mmm.sidewalks?.audit??null,methods:p.methods,maxFrame:stats('cost').worst,frameStats:{sidewalk:stats('cost'),game:stats('wall')},milestones:{exposed:p.exposedAt,lastTerrainBusy:p.lastTerrainBusy??0,lastSidewalkBusy:p.lastSidewalkBusy??0,ready:p.readyAt},detail:{stages:p.stages,readyEvents:p.readyEvents,lastBlockers:p.waitLabels.filter((_,i)=>(p.lastNonQuietMask??0)&(1<<i)),lastBlockerAt:p.lastNonQuietAt,quietStartedAt:p.quietStartedAt,mesh:p.mesh,grassWork:p.grassWork,lastGrassClock:p.lastGrassClock,lastGrassBusy:p.lastgrassBusy,lastTreesBusy:p.lasttreesBusy,resources:p.resources,queryTiming:p.queryTiming},frames:p.frames.length,tiles:mmm.terrain.dataRevision,draws:mmm.renderer.info.render};})()`);
   report.loads.push({area,low,...entry,roundMetadata:entry.round>=0?roundMetadata:null,navigationStartedAt,ms,...result});save();console.log('LOAD',JSON.stringify(report.loads.at(-1)));
  }
 }
 if(!smoke && phase==='loads')checkLoads();
 if(!smoke && phase==='frames')checkFrameCosts();
 if(!smoke && phase==='proof')await proof();
}finally{save();c?.close();if(tab)await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});}

function checkLoads(){
 const rows=[];for(const area of selectedAreas)for(const low of selectedQualities){
  rows.push(compareReplay(report.loads.filter(r=>r.area===area&&r.low===low),{area,low,startupReference:startupBaseline.low[area],diagnostic:area==='porthood'&&!low}));
 }
 report.targets=rows;save();for(const r of rows)assertReplayTargets(r);
 console.log('PASS real-page load/frame targets',JSON.stringify(rows));
}
function checkFrameCosts(){
 const rows=[];
 for(const area of selectedAreas)for(const low of selectedQualities){
  const loads=report.loads.filter(r=>r.area===area&&r.low===low),measured=loads.filter(r=>!r.warmup),startup=measured.map(r=>r.audit.startupMs).sort((a,b)=>a-b);assert.equal(measured.length,3);
  assert.ok(loads.every(r=>r.audit&&!r.audit.disabled),'clocked pass must render the enabled layer');
  const row={area,low,draws:measured[0].audit.draws,triangles:measured[0].audit.triangles,frameWorst:Math.max(...loads.map(r=>r.maxFrame)),frameMeasuredWorst:Math.max(...measured.map(r=>r.maxFrame)),frameP95:Math.max(...measured.map(r=>r.frameStats.sidewalk.p95)),startupMedian:startup[1],startupMax:Math.max(...loads.map(r=>r.audit.startupMs)),startupMeasuredMax:startup[2],note:'2ms applies to measured reloads after accepted fresh-profile cold control; warm-up maximum remains reported; settle time is unused; whole-frame counts gated separately'};
  if(low){row.startupMedianDelta=row.startupMedian-startupBaseline.low[area].median;row.startupMaxDelta=row.startupMeasuredMax-startupBaseline.low[area].max;}
  rows.push(row);
 }
 report.frameTargets=rows;save();
 for(const r of rows){assert.ok(r.draws<=2);assert.ok(r.triangles<=(r.low?6000:14000));assert.ok(r.frameMeasuredWorst<=2,`${r.area}/${r.low}: measured clocked sidewalk frame ${r.frameMeasuredWorst} ms > 2`);assert.ok(r.startupMax<=20);if(r.low){assert.ok(r.startupMedianDelta<=1);assert.ok(r.startupMaxDelta<=1);}}
 console.log('PASS separate clocked frame and startup metrics',JSON.stringify(rows));
}
function cached(area,low=false){return JSON.parse(readFileSync(new URL(`../web/src/sidewalks-plan-${area}.json`,import.meta.url),'utf8')).plans[low?1:0];}
function pose(area,run,fraction=.4,low=false){const ps=cached(area,low).pieces.filter(p=>runNames[p[0]]===run),p=ps[Math.floor(ps.length*fraction)],dx=p[15]-p[4],dy=p[16]-p[5];return {e:p[4],n:p[5],heading:Math.atan2(dx,dy)*180/Math.PI,nx:p[6],ny:p[7],along:p[13],inner:Math.hypot(p[8]-p[4],p[9]-p[5])};}
async function shot(name){const image=await c.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${name}.png`,Buffer.from(image.result.data,'base64'));report.pictures.push(name);save();console.log('PICTURE',name);}
function triangleHeight(x,z,a,b,d){const bx=b[0]-a[0],bz=b[2]-a[2],cx=d[0]-a[0],cz=d[2]-a[2],px=x-a[0],pz=z-a[2],den=bx*cz-bz*cx;if(Math.abs(den)<1e-10)return null;const v=(px*cz-pz*cx)/den,w=(bx*pz-bz*px)/den;if(v<-.0001||w<-.0001||1-v-w<-.0001)return null;return a[1]*(1-v-w)+b[1]*v+d[1]*w;}
// Runs in the page. Only submitted slab triangles participate; the land oracle is the actual drawn mesh.
function sweepGround(targets,radius=55){
 const m=mmm,[ve,vn]=m.terrain.manifest.village,cam=m.camera.position,pointInside=(x,z,p)=>{let yes=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
 const expected=m.sidewalks.plan.pieces.map((p,id)=>({p,id,points:[p.a.inner,p.b.inner,p.b.outer,p.a.outer].map(v=>[v[0]-ve,vn-v[1]])})).filter(({p,points})=>targets.includes(p.run.id)&&Math.hypot((points[0][0]+points[2][0])/2-cam.x,(points[0][1]+points[2][1])/2-cam.z)<radius);
 const triangles=[],coverage=new Set();let probes=0,buried=0,max=0,missingLand=0;
 for(const mesh of m.sidewalks.group.children){const g=mesh.geometry,attr=g.attributes.position,uv=g.attributes.uv,index=g.index;
  for(let i=0;i<(index?.count??attr.count);i+=3){const ids=[0,1,2].map(j=>index?index.getX(i+j):i+j);if(ids[0]===ids[1]||uv.getY(ids[0])<.5)continue;const c=ids.map(k=>[attr.getX(k),attr.getY(k),attr.getZ(k)]),x=(c[0][0]+c[1][0]+c[2][0])/3,z=(c[0][2]+c[1][2]+c[2][2])/3;
   if(!expected.some(e=>pointInside(x,z,e.points)))continue;triangles.push(c);
   const steps=Math.max(4,Math.ceil(Math.max(Math.hypot(c[1][0]-c[0][0],c[1][2]-c[0][2]),Math.hypot(c[2][0]-c[0][0],c[2][2]-c[0][2]))/.25));
   for(let a=0;a<=steps;a++)for(let b=0;b<=steps-a;b++){const u=a/steps,v=b/steps,xx=c[0][0]*(1-u-v)+c[1][0]*u+c[2][0]*v,zz=c[0][2]*(1-u-v)+c[1][2]*u+c[2][2]*v,top=c[0][1]*(1-u-v)+c[1][1]*u+c[2][1]*v,land=m.terrain.meshHeightAt(xx,zz,true);if(land===null){missingLand++;continue;}probes++;if(land-top>.001){buried++;max=Math.max(max,land-top);}}
  }
 }
 for(const e of expected){const x=(e.points[0][0]+e.points[2][0])/2,z=(e.points[0][1]+e.points[2][1])/2;if(triangles.some(c=>triangleHeight(x,z,...c)!==null))coverage.add(e.id);}
 return {probes,buried,max,missingLand,coverage:[...coverage],expected:expected.map(e=>e.id),audit:m.sidewalks.audit,frameMax:Math.max(0,...__walkProbe.frames.map(f=>f.cost))};
}
function grassRoots(){
 const m=mmm;if(!m.grass)return {roots:0,onSlab:0};const [ve,vn]=m.terrain.manifest.village,polys=m.sidewalks.plan.pieces.map(p=>[p.a.inner,p.b.inner,p.b.outer,p.a.outer].map(q=>[q[0]-ve,vn-q[1]]));let roots=0,onSlab=0;
 const inside=(x,z,p)=>{let yes=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
 m.grass.group.traverse(o=>{const root=o.geometry?.attributes?.root;if(!root)return;for(let i=0;i<o.geometry.instanceCount;i++){roots++;if(polys.some(p=>inside(root.getX(i),root.getZ(i),p)))onSlab++;}});return {roots,onSlab};
}
async function proof(){
 // Live, ground-by-ground sweep of both flush routes, on desktop and LOW.
 for(const [area,targets] of [['mabou',['harbour-corner','harbour-west']],['porthood',['porthood-waterfront']]])for(const low of [false,true])for(const [label,url]of [...(reviewedBaseline?[['before',before]]:[]),['fixed',origin]]){
  const first=pose(area,targets[0],.1,low);await navigate(`${url}/?test=1&mode=explore&cam=${first.e},${first.n},80,0,-89,90&area=${area}&q=${low?'low':'high'}&radio=0&still=1&hud=0&shadows=0`);
  const all=cached(area,low).pieces,locations=[];for(const run of targets){const ps=all.map((p,id)=>({p,id})).filter(v=>runNames[v.p[0]]===run);let next=-1;for(const v of ps)if(v.p[13]>=next){locations.push(v.p);next=v.p[13]+45;}locations.push(ps.at(-1).p);}
  const result={area,low,label,probes:0,buried:0,max:0,expected:new Set(),coverage:new Set(),frameMax:0,grass:{roots:0,onSlab:0}};
  for(const p of locations){await evaluate(`(()=>{const m=mmm,x=${p[4]}-m.terrain.manifest.village[0],z=m.terrain.manifest.village[1]-${p[5]},h=m.terrain.heightAt(x,z)??30;m.vehicle.place(x,z,0);m.camera.position.set(x,h+80,z+1);})()`);await sleep(500);let end=Date.now()+120000;while(Date.now()<end){if(await evaluate('document.documentElement.dataset.mmmReady==="true" && mmm.terrain.pending===0 && (mmm.sidewalks?.pending??0)===0'))break;await sleep(100);}
   const r=await evaluate(`(()=>{const triangleHeight=${triangleHeight.toString()};return (${sweepGround.toString()})(${JSON.stringify(targets)});})()`);result.probes+=r.probes;result.buried+=r.buried;result.max=Math.max(result.max,r.max);result.frameMax=Math.max(result.frameMax,r.frameMax);r.expected.forEach(i=>result.expected.add(i));r.coverage.forEach(i=>result.coverage.add(i));
   if(!low){const grass=await evaluate(`(${grassRoots.toString()})()`);result.grass.roots+=grass.roots;result.grass.onSlab+=grass.onSlab;}
  }
  const serialized={...result,expected:result.expected.size,coverage:result.coverage.size};report.sweeps.push(serialized);save();console.log('SWEEP',JSON.stringify(serialized));assert.ok(result.probes>1000);if(label==='fixed')assert.equal(result.buried,0,'drawn ground never above slab');else assert.ok(result.buried>0,'old live sweep must reproduce ground through slabs');assert.equal(result.expected.size,result.coverage.size,'every expected flush section was rendered');if(label==='fixed')assert.equal(result.grass.onSlab,0,'actual grass roots stay off slabs');
 }
 // Matched chase pictures at the review spots. The reviewed image files remain the original evidence.
 for(const [name,area,run,fraction]of [['harbour-west-mid','mabou','harbour-west',.5],['waterfront','porthood','porthood-waterfront',.5]]){
  const p=pose(area,run,fraction);for(const [label,url]of [['before',reviewedBaseline?before:origin],['after',origin]]){await navigate(`${url}/?test=1&sidewalks=${label==='before'&&!reviewedBaseline?0:1}&mode=explore&at=${p.e},${p.n},${p.heading}&area=${area}&radio=0&still=1&hud=0&shadows=1`);await shot(`${name}-${label}`);}
 }
 // A live, low camera must populate real roots: the grass check must not be vacuous.
 for(const [area,run]of [['mabou','mabou-village'],['porthood','porthood-main'],['pointtupper','reeves-sw']]){
  const p=pose(area,run,.4);await navigate(`${origin}/?test=1&mode=explore&at=${p.e},${p.n},${p.heading}&area=${area}&q=high&grass=1&radio=0&still=1&hud=0&shadows=0`);await sleep(800);
  const grass=await evaluate(`(${grassRoots.toString()})()`);report.grass.push({area,...grass});save();assert.ok(grass.roots>100,'live grass control has roots');assert.equal(grass.onSlab,0,'no live root on a slab');console.log('GRASS',JSON.stringify({area,...grass}));
 }
 // Source-independent physics: execute the current main's driveVehicle with the layer on and off.
 for(const [area,run]of [['mabou','mabou-village'],['porthood','porthood-main'],['pointtupper','reeves-ne']])for(const vehicle of (area==='mabou'?['car','bike']:['car'])){
  const p=pose(area,run,.38),angle=p.heading*Math.PI/180,tx=Math.sin(angle),tn=Math.cos(angle),dot=tx*p.ny-tn*p.nx,turn=dot>0?-25:25,heading=p.heading+turn;
  const traces=[];for(const enabled of [false,true,true]){
   await navigate(`${origin}/?test=1&mode=explore&area=${area}&at=${p.e+p.nx},${p.n+p.ny},${heading}&vehicle=${vehicle}&sidewalks=${enabled?1:0}&radio=0&still=1&hud=0&shadows=0`);
   const trace=await drive(p,heading,false);traces.push(trace);
  }
  assert.deepEqual(traces[1].samples,traces[0].samples,`${area}/${vehicle} on/off curb drive`);assert.deepEqual(traces[2].samples,traces[0].samples,'repeat drive is stable');assert.ok(traces[1].maxLateral>p.inner+1.5,'drive crosses the complete sidewalk');
  const item={area,vehicle,samples:traces[0].samples.length,distance:traces[0].distance,maxLateral:traces[0].maxLateral,equal:true};report.contacts.push(item);save();console.log('CONTACT',JSON.stringify(item));
  if(area==='mabou'&&vehicle==='car'){await navigate(`${origin}/?test=1&mode=explore&area=${area}&at=${p.e+p.nx},${p.n+p.ny},${heading}&sidewalks=1&radio=0&still=1&hud=0&shadows=0`);const bad=await drive(p,heading,true);assert.notDeepEqual(bad.samples,traces[0].samples,'valid registered curb Site must fail the drive comparison');console.log('REJECTED live registered curb collision');}
 }
 await navigate(`${origin}/?test=1&era=1884&mode=explore&radio=0&still=1&hud=0`);assert.equal(await evaluate('mmm.sidewalks'),null,'1884 page constructs no walks');console.log('PASS real 1884 absence');
 await navigate(`${origin}/?test=1&mode=explore&at=${poses.mabou}&radio=0&still=1&hud=0`);await evaluate('mmm.sidewalks.audit.triangles=999999');await sleep(500);const budget=await evaluate('({disabled:mmm.sidewalks.audit.disabled,visible:mmm.sidewalks.group.visible,error:document.getElementById("gameError").hidden,frames:__walkProbe.frames.length})');assert.ok(budget.disabled&&!budget.visible&&budget.error&&budget.frames>20,'bad budget hides only the layer');console.log('PASS live frame-loop budget overflow');
}
async function drive(p,heading,mutant){
 return evaluate(`(()=>{const m=mmm,v=m.vehicle,[ve,vn]=m.terrain.manifest.village;
 const inside=(x,z,p)=>{let yes=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
 if(${mutant}){const shapes=m.sidewalks.plan.pieces.map(p=>[p.a.inner,p.b.inner,p.b.outer,p.a.outer].map(q=>[q[0]-ve,vn-q[1]]));const xs=shapes.flat().map(p=>p[0]),zs=shapes.flat().map(p=>p[1]);m.terrain.sites.push({box:[Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)],height:(_x,_z,g)=>g,surface:()=>null,deckHeight:(x,z,ground)=>shapes.some(p=>inside(x,z,p))?(ground(x,z)??0)+.15:null});}
 const start={x:${p.e+p.nx}-ve,z:vn-${p.n+p.ny}};v.place(start.x,start.z,${heading}*Math.PI/180);v.assist=0;
 const keys=['x','y','z','speed','heading','vx','vy','vz','pitch','roll','sunk','jolt','landingCompression','wheelie','frontHeight','rearHeight','crashes'];const samples=[];let maxLateral=0;
 for(let i=0;i<1200;i++){m.driveVehicle(1/120,{throttle:.8,steer:0,handbrake:false});if(i%6===0){samples.push(keys.map(k=>typeof v[k]==='number'?Number(v[k].toFixed(5)):null));maxLateral=Math.max(maxLateral,(v.x-(${p.e}-ve))*${p.nx}+(v.z-(vn-${p.n}))*${-p.ny});}}
 return {samples,distance:Math.hypot(v.x-start.x,v.z-start.z),maxLateral};})()`);
}
