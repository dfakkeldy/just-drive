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
async function compareFrames(){
 if(process.env.ERA_SKIP_TIMING==='1'){records.frameTime={measured:false,reason:'dedicated four-case comparison follows the checks'};return;}
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

}

try{
 await send('Runtime.enable');await send('Page.enable');
 await compareFrames();
 await load('era=1884&vehicle=bike&title=1&hud=1');
 assert.equal(await read('mmm.era.id'),'1884');assert.equal(await read('!!mmm.mp'),false);
 // Since #107 every ride but the horse has the radio in 1884; the horse stays silent (#103).
 assert(/radio|station/i.test(await read("document.querySelector('#title dl').textContent")),'bike title has the radio in 1884');
 assert(/horn|honk/i.test(await read("document.querySelector('#title dl').textContent")));
 await shot('bike-title-card');
 await load('era=1884&vehicle=horse&title=1&hud=1');
 assert.equal(await read("mmm.era.id+'/'+document.querySelector('#titleStart').textContent"),'1884/Start riding');
 assert(!/radio|station/i.test(await read("document.querySelector('#title dl').textContent")),'horse title has no radio');
 await load('era=1884&vehicle=bike&title=1&hud=1');await read("document.querySelector('#titleStart').click();eraQA.hideUI(true)");
 const data=await read('eraQA.data()');records.sites=data.trades;records.farms=data.farms;records.farmCounts=data.farmCounts;records.life=data.life;
 await read('eraQA.siteView("F16-PHM-127",27,10)');await shot('mill-readable-board');
 const gable=await read(`(()=>{const b=mmm.history.boards.list.find(b=>b.owner.site.id==='F16-PHM-127');return{word:b.owner.site.word,gable:!!b.gableMesh,side:b.mesh.material.side};})()`);assert(gable.gable&&gable.word==='MILL');records.millBoard=gable;
 const slopeId=await read(`(()=>{const m=mmm.history.models.filter(m=>m.site.kind==='farm'&&m.ready&&Math.max(...m.samples.slice(0,10))-Math.min(...m.samples.slice(0,10))>1.2&&Math.max(...m.samples.slice(0,10))-Math.min(...m.samples.slice(0,10))<2.6).sort((a,b)=>(Math.max(...b.samples.slice(0,10))-Math.min(...b.samples.slice(0,10)))-(Math.max(...a.samples.slice(0,10))-Math.min(...a.samples.slice(0,10))))[0];if(!m)throw Error('no loaded sloped farm');return m.site.id;})()`);
 await read(`eraQA.siteView(${JSON.stringify(slopeId)},32,14)`);await shot('sloped-foundation');
 records.foundation=await read(`(()=>{const m=mmm.history.models.find(m=>m.site.id===${JSON.stringify(slopeId)});let lo=Infinity,hi=-Infinity;for(let i=0;i<10;i++){lo=Math.min(lo,m.samples[i]);hi=Math.max(hi,m.samples[i]);}return{base:m.node.position.y,low:lo,high:hi,exposed:m.node.position.y-lo};})()`);assert(records.foundation.exposed<=1.2+.001);records.foundation.site=slopeId;records.foundation.deferred=await read(`mmm.history.models.filter(m=>m.ready&&m.foundationNeedsResiting).map(m=>m.site.id)`);
 await read('eraQA.boardView("F16-PHM-053")');
 await read(`(()=>{const b=mmm.history.boards.list.find(b=>b.owner.site.id==='F16-PHM-053'),h=mmm.roads.nearest(b.approachX,b.approachZ,100,r=>r.kind>=1&&r.kind<=3),v=mmm.vehicle;let heading=h.heading;if(Math.sin(heading)*(b.x-h.x)-Math.cos(heading)*(b.z-h.z)<0)heading+=Math.PI;v.restart(h.x,h.z,heading);for(let i=0;i<120;i++)mmm.driveVehicle(1/120,{throttle:0,steer:0,handbrake:true,touch:false});eraQA.look(v.x-Math.sin(heading)*7,v.z+Math.cos(heading)*7,3.2,b.x,b.z,2);})()`);await shot('bike-cart-road-trade');
 const bikeRoad=await read('({surface:mmm.vehicle.surfaceName,surfaceKind:mmm.terrain.surfaceAt(mmm.vehicle.x,mmm.vehicle.z).kind})');assertCartRoad(bikeRoad);records.bikeRoad=bikeRoad;
 await read(`(()=>{const b=mmm.history.boards.list.find(b=>b.owner.site.id==='F16-PHM-054'),h=mmm.roads.nearest(b.approachX,b.approachZ,20),a=Math.sin(h.heading),z=-Math.cos(h.heading);eraQA.look(h.x+a*6,h.z+z*6,1.05,h.x+a*20,h.z+z*20,.05,62);})()`);await shot('mud-close-up');
 await load('era=1884&vehicle=car&hud=1');await read("document.querySelector('#titleStart')?.click();eraQA.hideUI(true)");
 await read('eraQA.look(-35,100,2.5,10,-40,1.7)');await shot('village-road');records.budgets.eraVillage=await read('eraQA.budget()');
 // Real settled-camera rotation/pan: warm all angles, then count a second identical pass.
 const pan=await read(`(async()=>{const h=mmm.history,t=mmm.terrain,c=mmm.camera,home=c.position.clone();for(let pass=0;pass<2;pass++)for(let i=0;i<24;i++){c.position.x=home.x+Math.sin(i*.6)*2;c.position.z=home.z+Math.cos(i*.6)*2;c.lookAt(c.position.x+Math.sin(i*.31)*50,c.position.y-1,c.position.z-Math.cos(i*.31)*50);c.updateMatrixWorld();await eraQA.settleView();}const before={fits:h.audit.fits,boards:h.boards.audit.fits,life:h.life.audit.fits},q=h.contacts.audit.heightQueries;for(let i=0;i<24;i++){c.position.x=home.x+Math.sin(i*.6)*2;c.position.z=home.z+Math.cos(i*.6)*2;c.lookAt(c.position.x+Math.sin(i*.31)*50,c.position.y-1,c.position.z-Math.cos(i*.31)*50);c.updateMatrixWorld();await eraQA.settleView();}return{fits:h.audit.fits-before.fits,boardFits:h.boards.audit.fits-before.boards,lifeFits:h.life.audit.fits-before.life,heightQueries:h.contacts.audit.heightQueries-q};})()`);records.pan=pan;assert.deepEqual(pan,{fits:0,boardFits:0,lifeFits:0,heightQueries:0},'real loaded-land pan/turn counters');
 await read('mmm.camera.position.set(800,430,650);mmm.camera.fov=51;mmm.camera.updateProjectionMatrix();mmm.camera.lookAt(-600,20,-1000);mmm.camera.updateMatrixWorld()');await shot('valley');records.budgets.eraWide=await read('eraQA.budget()');
 const bridge=data.bridges.find(r=>r.id===30)??data.bridges[0];
 await read(`(async()=>{const r=mmm.roads.roads.find(r=>r.id===${bridge.id}),a=r.pts[0],b=r.pts[1],dx=b[0]-a[0],dz=b[1]-a[1],d=Math.hypot(dx,dz),frame=()=>eraQA.look(a[0]-dx/d*8,a[1]-dz/d*8,1.8,a[0]+dx/d*15,a[1]+dz/d*15,1);frame();await eraQA.settleView();frame();})()`);await shot('timber-bridge-approach');
 // Every retained bridge: actually cross on the production vehicle, centreline steering, with the current deck plane.
 for(const bridge of data.bridges){
  await read(`(async()=>{const r=mmm.roads.roads.find(r=>r.id===${bridge.id}),a=r.pts[0],b=r.pts.at(-1);eraQA.look((a[0]+b[0])/2+12,(a[1]+b[1])/2+12,22,(a[0]+b[0])/2,(a[1]+b[1])/2,1);await eraQA.settleView();})()`);
  const result=await read(`(()=>{
   const road=mmm.roads.roads.find(r=>r.id===${bridge.id}),pts=road.pts,cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum.at(-1)+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));const len=cum.at(-1),v=mmm.vehicle;
   const at=s=>{let i=0;while(i<pts.length-2&&cum[i+1]<s)i++;const a=pts[i],b=pts[i+1],d=cum[i+1]-cum[i],t=(s-cum[i])/d;return {x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,h:Math.atan2(b[0]-a[0],a[1]-b[1])};};
   const start=at(0),startDeck=mmm.roads.deckHeight(start.x,start.z);if(startDeck===null)throw Error('bridge traversal requires its current deck plane');v.restart(start.x,start.z,start.h);v.place(start.x,start.z,start.h,startDeck);
   v.assist=0;v.strongHelp=false;const initial={y:v.y,ground:mmm.terrain.heightAt(v.x,v.z),deck:mmm.roads.deckHeight(v.x,v.z),pitch:v.pitch,roll:v.roll};let progress=0,steps=0,maxGap=0,deckSamples=0,wrongSurface=0;
   for(;steps<120*(len/2+20)&&progress<len+5;steps++){
    let best=Infinity;for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],dx=b[0]-a[0],dz=b[1]-a[1],l=cum[i]-cum[i-1],t=Math.max(0,Math.min(i===pts.length-1?1+8/l:1,((v.x-a[0])*dx+(v.z-a[1])*dz)/(l*l))),x=a[0]+t*dx,z=a[1]+t*dz,d=Math.hypot(x-v.x,z-v.z);if(d<best){best=d;progress=cum[i-1]+t*l;}}
    const goal=at(Math.min(len+7,progress+6)),heading=Math.atan2(goal.x-v.x,v.z-goal.z),error=Math.atan2(Math.sin(heading-v.heading),Math.cos(heading-v.heading));
    mmm.driveVehicle(1/120,{throttle:Math.abs(v.speed)<4?1:Math.abs(v.speed)>5?-.1:0,steer:Math.max(-1,Math.min(1,error*2)),handbrake:false,touch:false});
    const deck=mmm.roads.deckHeight(v.x,v.z);if(deck!==null){deckSamples++;if(!${JSON.stringify(LOOSE_BRIDGE_SURFACES)}.includes(v.surfaceName))wrongSurface++;maxGap=Math.max(maxGap,Math.abs(v.y-deck));}
   }
   return {id:road.id,initial,contact:mmm.terrain.surfaceAt(v.x,v.z),length:len,progress,steps,x:v.x,z:v.z,surface:v.surfaceName,deckSamples,wrongSurface,maxGap,ground:mmm.terrain.heightAt(v.x,v.z),deck:mmm.roads.deckHeight(v.x,v.z),y:v.y,deckState:(()=>{const d=mmm.roads.eraDecks.get(road.id);return {y0:d?.y0,y1:d?.y1,level:d?.level};})(),success:progress>=len+5};
  })()`);
  assert.equal(result.success,true,'cross bridge '+JSON.stringify(result));assert(result.deckSamples>0);assert.equal(result.wrongSurface,0);assert(result.maxGap<1.0,'deck contact '+JSON.stringify(result));records.bridges.push(result);writeFileSync(`${out}/bridge-progress.json`,JSON.stringify(records.bridges,null,2));console.log('BRIDGE',JSON.stringify(result));
 }

 assert.throws(()=>assertLooseBridge('grass'),/loose surface/);
 await load('era=1884&vehicle=bike&touch=1&hud=1&title=1',390,844);await read("document.querySelector('#titleStart')?.click();if(typeof window.eraFrame==='function')window.eraFrame(performance.now())");
 // Since #107 the 1884 bike has the radio (the chip itself appears only when the build carries audio/radio.json).
 assert(/radio|station/i.test(await read("document.querySelector('#title dl').textContent")),'phone bike title has the radio in 1884');await shot('phone');
 await load('vehicle=car&hud=1');assert.equal(await read('mmm.gameMode'),'mail');assert(await read('!!mmm.props&&!!mmm.buildings&&!!mmm.yard'));await read("document.querySelector('#titleStart')?.click();eraQA.hideUI(true)");
 await read('eraQA.look(-35,100,2.5,10,-40,1.7)');await read('eraQA.settleView()');records.budgets.todayVillage=await read('eraQA.budget()');
 await read('mmm.camera.position.set(800,430,650);mmm.camera.fov=51;mmm.camera.updateProjectionMatrix();mmm.camera.lookAt(-600,20,-1000);mmm.camera.updateMatrixWorld()');await read('eraQA.settleView()');records.budgets.todayWide=await read('eraQA.budget()');

 if(!records.frameTime?.measured)await compareFrames();
 assert.deepEqual(errors,[]);records.errors=errors;writeFileSync(`${out}/browser-results.json`,JSON.stringify(records,null,2));console.log('PASS third-pass page, camera counters, bike title/surface, foundation cap, every bridge loose surface and today regression');
}finally{ws.send(JSON.stringify({id:++id,method:'Browser.close'}));await pause(3000);ws.close();}
