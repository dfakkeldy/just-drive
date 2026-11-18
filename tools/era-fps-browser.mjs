#!/usr/bin/env node
import{assertCartRoad,assertWheelProgress,assertLooseBridge,LOOSE_BRIDGE_SURFACES}from'./era-observations.mjs';
// The actual page, scene, selected terrain meshes and fixed-step vehicle. No FPS claims.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const [out,first]=process.argv.slice(2),port=process.env.CDP_PORT;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
let id=0;const waiting=new Map(),errors=[];
ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id){waiting.get(d.id)?.(d);waiting.delete(d.id);}if(d.method==='Runtime.exceptionThrown')errors.push(d.params.exceptionDetails.exception?.description??d.params.exceptionDetails.text);if(d.method==='Runtime.consoleAPICalled'&&d.params.type==='error')errors.push(d.params.args.map(a=>a.value??a.description).join(' '));};
const send=(method,params={})=>new Promise(r=>{const n=++id;waiting.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
const read=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.error||r.result?.exceptionDetails)throw Error(JSON.stringify(r));return r.result?.result?.value;};
const records={pictures:[],bridges:[],budgets:{}};
const shot=async name=>{await read('eraQA.settleView()');const path=`${out}/${name}.png`;writeFileSync(path,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));records.pictures.push(path);console.log('PICTURE',path);};
const load=async(query,w=1600,h=900)=>{
 await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});
 const q=new URLSearchParams(query);if(!q.has('res'))q.set('res','1');if(!q.has('exag'))q.set('exag','1.5');
 await send('Page.navigate',{url:new URL('/?'+q,first).href});await send('Page.bringToFront');
 const start=Date.now();while(Date.now()-start<240000){await pause(500);if(await read("document.title==='settled'&&!!window.mmm"))break;}
 assert.equal(await read("document.title==='settled'&&!!window.mmm"),true,'settled '+query);
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
try{await send('Runtime.enable');await send('Page.enable');
 const {execFileSync}=await import('node:child_process');
 const otherJobs=()=>{let lines='';try{lines=execFileSync('pgrep',['-fl','remote-debugging-port'],{encoding:'utf8'});}catch{}return lines.split('\n').filter(l=>{const m=l.match(/^\d+ \/Applications\/.* --headless(?:=new)? --remote-debugging-port=(\d+)\b/);return m&&m[1]!==port;});};
 records.frameTime={measured:false,reason:'other browser jobs active'};
 if(!otherJobs().length){
  const busy=[],watch=setInterval(()=>{if(otherJobs().length)busy.push(Date.now());},1000),rows=[];
  try{for(const era of ['1884','today']){
   await load((era==='1884'?'era=1884&':'')+'vehicle=car&hud=0&title=0&q=high&cam=624236,5103201,12,18,-3,51&camground=1');
   await read("document.querySelector('#titleStart')?.click();window.requestAnimationFrame=window.savedRAF;if(typeof window.eraFrame==='function')requestAnimationFrame(window.eraFrame)");await pause(5000);console.log('FRAME TIME starting',era,'20 seconds');
   const row=await read(`new Promise(resolve=>{const r=mmm.renderer,t0=performance.now(),draw0=r.info.render.frame,times=[];let last=t0;const tick=t=>{times.push(t-last);last=t;if(t-t0<20000)requestAnimationFrame(tick);else{times.shift();times.sort((a,b)=>a-b);const gl=r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');resolve({frames:times.length,meanMs:times.reduce((a,b)=>a+b,0)/times.length,medianMs:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],p99Ms:times[Math.floor(times.length*.99)],drawn:r.info.render.frame-draw0,pixels:[r.domElement.width,r.domElement.height],device:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown',contextLost:gl.isContextLost()});}};requestAnimationFrame(tick);})`);assert(row.frames>20&&row.drawn>=row.frames&&!row.contextLost);rows.push({era,...row});
  }if(!busy.length&&!otherJobs().length)records.frameTime={measured:true,secondsEach:20,rows};else records.frameTime={measured:false,reason:'another browser job appeared during the comparison; discarded'};}finally{clearInterval(watch);}
 }

 writeFileSync(`${out}/frame-time.json`,JSON.stringify(records.frameTime,null,2));console.log('FRAME COMPARISON',JSON.stringify(records.frameTime));
}finally{ws.send(JSON.stringify({id:++id,method:'Browser.close'}));await pause(3000);ws.close();}
