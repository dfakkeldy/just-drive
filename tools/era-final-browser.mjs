#!/usr/bin/env node
import{assertCartRoad,assertWheelProgress,assertLooseBridge,LOOSE_BRIDGE_SURFACES}from'./era-observations.mjs';
// The actual page, scene, selected terrain meshes and fixed-step vehicle. No FPS claims.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const [out,first]=process.argv.slice(2),port=process.env.CDP_PORT;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
let id=0;const waiting=new Map(),errors=[],warnings=[];
ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id){waiting.get(d.id)?.(d);waiting.delete(d.id);}if(d.method==='Runtime.consoleAPICalled'&&d.params.type==='warning')warnings.push(d.params.args.map(a=>a.value??a.description).join(' '));if(d.method==='Runtime.exceptionThrown')errors.push(d.params.exceptionDetails.exception?.description??d.params.exceptionDetails.text);if(d.method==='Runtime.consoleAPICalled'&&d.params.type==='error')errors.push(d.params.args.map(a=>a.value??a.description).join(' '));};
const send=(method,params={})=>new Promise(r=>{const n=++id;waiting.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
const read=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.error||r.result?.exceptionDetails)throw Error(JSON.stringify(r));return r.result?.result?.value;};
const records={pictures:[],bridges:[],budgets:{}};
const shot=async name=>{await read('eraQA.settleView()');const path=`${out}/${name}.png`;writeFileSync(path,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));records.pictures.push(path);console.log('PICTURE',path);};
const load=async(query,w=1600,h=900,path='/')=>{
 await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});
 const q=new URLSearchParams(query);
 const address=new URL(path+'?'+q,first);if(q.get('site')==='just')address.hostname='localhost';
 await send('Page.navigate',{url:address.href});await send('Page.bringToFront');
 const start=Date.now();while(Date.now()-start<240000){await pause(500);if(await read("document.documentElement.dataset.mmmReady==='true'&&!!window.mmm"))break;}
 assert.equal(await read("document.documentElement.dataset.mmmReady==='true'&&!!window.mmm"),true,'settled '+query);
 await read('window.savedRAF=window.requestAnimationFrame;window.requestAnimationFrame=f=>{window.eraFrame=f;return 0;}');await pause(100);
 await read(`(async()=>{
  const {camera:c,terrain:t,renderer:r,scene,history}=mmm;
  const settleView=async()=>{let quiet=0;for(let i=0;i<2400;i++){
   c.updateMatrixWorld();t.update(c);mmm.trees?.update(t.drawnFine,c.position);mmm.grass?.update(.1,c,mmm.vehicle.x,mmm.vehicle.z,mmm.vehicle.heading,mmm.vehicle.spec);mmm.coast?.update(c.position);mmm.roads.update(c.position);history?.update(c.position);mmm.props?.update(c,0);mmm.landmarks?.update(c);mmm.yard?.update(0,mmm.vehicle,c.position);mmm.buildings?.mesh.updateMatrixWorld();mmm.water?.update(c);
   try{r.render(scene,c);}finally{mmm.water?.settle();}mmm.water?.afterRender(c);
   quiet=t.pending===0&&!(mmm.trees?.pending??0)&&!(mmm.grass?.pending??0)?quiet+1:0;
   if(quiet>=8)return;await new Promise(r=>setTimeout(r,100));
  }throw Error('era view did not settle '+JSON.stringify({terrain:t.pending,trees:mmm.trees?.pending,grass:mmm.grass?.pending}));};
  const look=(x,z,eye,tx,tz,lift=1.5,fov=51)=>{c.position.set(x,(t.meshHeightAt(x,z,true)??t.heightAt(x,z)??0)+eye,z);c.fov=fov;c.updateProjectionMatrix();c.lookAt(tx,(t.meshHeightAt(tx,tz,true)??t.heightAt(tx,tz)??0)+lift,tz);c.updateMatrixWorld();};
  const siteView=async(id,back=27,side=12)=>{const m=history.models.find(m=>m.site.id===id),s=m.site,a=Math.sin(s.yaw),b=Math.cos(s.yaw),frame=()=>{look(s.x+a*back+b*side,s.z+b*back-a*side,8,s.x,s.z);c.position.y=Math.max(c.position.y,m.node.position.y+7);c.lookAt(s.x,m.node.position.y+(s.kind==='church'?7:s.kind==='mill'?5.8:2.7),s.z);c.updateMatrixWorld();};frame();await settleView();frame();};
  const hideUI=hide=>{if(hide){window.hiddenEraUI=[...document.body.children].filter(e=>e instanceof HTMLElement&&e.id!=='c'&&e.tagName!=='SCRIPT'&&e.tagName!=='STYLE').map(e=>[e,e.style.visibility]);for(const[e]of hiddenEraUI)e.style.visibility='hidden';}else for(const[e,v]of window.hiddenEraUI??[])e.style.visibility=v;};
  const budget=()=>{r.info.reset();r.render(scene,c);return {calls:r.info.render.calls,triangles:r.info.render.triangles};};
  const data=()=>({life:history?.life.counts,trades:history?.trades,farms:history?.farms,farmCounts:history?.farmCounts,origin:t.manifest.village,bridges:mmm.roads.roads.filter(r=>r.bridge),low:mmm.low});
  const boardView=async(id)=>{const b=history.boards.list.find(b=>b.owner.site.id===id);if(!b)throw Error('board '+id);look(b.approachX,b.approachZ,1.8,b.x,b.z);await settleView();c.position.y=(t.meshHeightAt(b.approachX,b.approachZ,true)??t.heightAt(b.approachX,b.approachZ))+1.8;c.lookAt(b.x,b.node.position.y+1.45+b.height/2,b.z);c.updateMatrixWorld();return{distance:Math.hypot(c.position.x-b.x,c.position.z-b.z),capPixels:b.letterHeight/Math.hypot(c.position.x-b.x,c.position.z-b.z)*r.domElement.height/(2*Math.tan(c.fov*Math.PI/360))};};
  window.eraQA={settleView,look,siteView,boardView,hideUI,budget,data};
 })()`);
};
async function compareFrames(){
 if(process.env.ERA_SKIP_TIMING==='1'){records.frameTime={measured:false,reason:'dedicated four-case comparison follows the checks'};return;}
 const {execFileSync}=await import('node:child_process');
 const otherJobs=()=>{let lines='';try{lines=execFileSync('pgrep',['-fl','remote-debugging-port'],{encoding:'utf8'});}catch{}return lines.split('\n').filter(l=>{const m=l.match(/^\d+ \/Applications\/.* --headless(?:=new)? --remote-debugging-port=(\d+)\b/);return m&&m[1]!==port;});};
 records.frameTime={measured:false,reason:'other browser jobs active'};
 if(!otherJobs().length){
  const busy=[],watch=setInterval(()=>{if(otherJobs().length)busy.push(Date.now());},1000),rows=[];
  try{for(const era of ['1884','today']){
   await load((era==='1884'?'era=1884&':'')+'vehicle=car&mode=explore&hud=0&title=0&q=high&res=1&exag=1.5&cam=624236,5103201,12,18,-3,51&camground=1');
   await read('eraQA.settleView()');await read("document.querySelector('#titleStart')?.click();window.requestAnimationFrame=window.savedRAF;if(typeof window.eraFrame==='function')requestAnimationFrame(window.eraFrame)");await pause(5000);console.log('FRAME TIME starting',era,'20 seconds');
   const row=await read(`new Promise(resolve=>{const r=mmm.renderer,t0=performance.now(),draw0=r.info.render.frame,times=[];let last=t0;const tick=t=>{times.push(t-last);last=t;if(t-t0<20000)requestAnimationFrame(tick);else{times.shift();times.sort((a,b)=>a-b);const gl=r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');resolve({frames:times.length,meanMs:times.reduce((a,b)=>a+b,0)/times.length,medianMs:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],p99Ms:times[Math.floor(times.length*.99)],drawn:r.info.render.frame-draw0,pixels:[r.domElement.width,r.domElement.height],device:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown',contextLost:gl.isContextLost()});}};requestAnimationFrame(tick);})`);assert(row.frames>20&&row.drawn>=row.frames&&!row.contextLost);rows.push({era,...row});
  }if(!busy.length&&!otherJobs().length)records.frameTime={measured:true,secondsEach:20,rows};else records.frameTime={measured:false,reason:'another browser job appeared during the comparison; discarded'};}finally{clearInterval(watch);}
 }

}

try{
 await send('Runtime.enable');await send('Page.enable');
 for(const trailer of ['1','empty']){
  warnings.length=0;await load('era=1884&vehicle=truck&trailer='+trailer);
  assert.equal(await read('!!mmm.towing'),false);
  assert.equal(await read("(async()=>mmm.vehicle.spec===(await import('/src/truck.ts')).TRUCK_SPEC)()"),true,'the truck stays selected');
  assert.equal(await read("!!document.querySelector('#trailerHelp')"),false);
  assert.equal(await read("/trailer/i.test(document.querySelector('#title')?.textContent??'')"),false);
  assert.equal(await read("[...document.querySelectorAll('option')].some(e=>/trailer/i.test(e.textContent))"),false);
  assert.equal(warnings.filter(s=>s==='Trailers are not available in 1884; driving without a trailer.').length,1);
  console.log('PASS era truck trailer='+trailer+' has no towing, controls, title row or garage option; one reason');
 }
 await load('era=1884&vehicle=truck&exag=1.5&res=1');
 await read('eraQA.hideUI(true)');
 const barn=await read(`(async()=>{
  const h=mmm.history,t=mmm.terrain,c=mmm.camera;
  const candidates=h.models.filter(m=>m.barn&&Math.hypot(m.site.x,m.site.z)<1800).map(m=>{const s=m.site,b=s.barn,co=Math.cos(s.yaw),si=Math.sin(s.yaw),x=s.x+b.x*co+b.z*si,z=s.z-b.x*si+b.z*co;const near=t.heightAt(x+si*5.7,z+co*5.7),back=t.heightAt(x-si*5.7,z-co*5.7);return{m,x,z,rise:near-back};}).filter(v=>v.rise>.35&&v.rise<2.2).sort((a,b)=>Math.abs(a.rise-1)-Math.abs(b.rise-1));
  if(!candidates.length)throw Error('no uphill barn');const {m,x,z}=candidates[0],s=m.site,co=Math.cos(s.yaw),si=Math.sin(s.yaw);
  const frame=()=>{const side=Math.sign(s.barn.x)*12,ex=x+si*15+co*side,ez=z+co*15-si*side;eraQA.look(ex,ez,3.5,x+si*3,z+co*3,1.5);};frame();await eraQA.settleView();frame();await eraQA.settleView();
  const a=m.barn.geometry.attributes.position;let minZ=Infinity,maxZ=-Infinity;for(let i=0;i<a.count;i++){minZ=Math.min(minZ,a.getZ(i));maxZ=Math.max(maxZ,a.getZ(i));}
  const p=await import('/src/eras/history-art.ts'),b=await import('/src/eras/history-sites.ts'),profile=p.periodProfile(b.farmBarn(s),true);let threshold=Infinity;
  for(let i=0;i<a.count;i++)if(Math.abs(Math.abs(a.getX(i))-1.1)<.001&&Math.abs(a.getZ(i)-(profile.length/2+.055))<.001)threshold=Math.min(threshold,a.getY(i)+m.barn.position.y+m.node.position.y);
  const doorX=x+si*(profile.length/2+.05),doorZ=z+co*(profile.length/2+.05),ground=t.meshHeightAt(doorX,doorZ,true),rear=t.meshHeightAt(x-si*profile.length/2,z-co*profile.length/2,true);
  return{id:s.id,threshold,ground,clearance:threshold-ground,rise:ground-rear,x,z};
 })()`);
 assert(barn.clearance>=-.015&&barn.clearance<=.35,JSON.stringify(barn));await shot('barn-on-slope');records.barn=barn;
 await compareFrames();
 await load('vehicle=truck&trailer=1&res=1');assert.equal(await read('!!mmm.towing'),true);assert.equal(await read("!!document.querySelector('#trailerHelp')"),true);console.log('PASS today truck retains towing and its control');
 await load('site=just&era=1884&area=judique&vehicle=bike&title=1&q=low',390,844,'/mabou');
 for(let n=0;n<120&&!await read('!!mmm.radio');n++)await new Promise(r=>setTimeout(r,100));
 assert.deepEqual(await read("({era:mmm.era.id,area:mmm.area.id,trades:mmm.history.trades.length,radio:!!mmm.radio,mp:!!mmm.mp,title:document.querySelector('#title h1').textContent})"),{era:'1884',area:'mabou',trades:48,radio:true,mp:false,title:'Mabou, 1884'});
 assert.equal(await read("/radio|station/i.test(document.querySelector('#title dl').textContent)"),true);
 warnings.length=0;await load('site=just&era=1884&vehicle=car&title=1&q=low&radio=0',390,844,'/porthood');
 assert.deepEqual(await read("({era:mmm.era.id,area:mmm.area.id,history:!!mmm.history,mode:mmm.gameMode})"),{era:'today',area:'porthood',history:false,mode:'explore'});
 assert.equal(warnings.filter(s=>s==='Era 1884 is not available in porthood; loading today.').length,1);
 console.log('PASS era on Just Drive uses the resolved path, offers radio, omits MP, and falls back on unsupported land');
 assert.deepEqual(errors,[]);records.errors=errors;writeFileSync(`${out}/browser-results.json`,JSON.stringify(records,null,2));console.log('PASS final era browser',JSON.stringify(barn));
}finally{try{const closed=await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`,{signal:AbortSignal.timeout(60000)});assert.ok(closed.ok||closed.status===404,'owned era tab closes')}finally{ws.close()}}
