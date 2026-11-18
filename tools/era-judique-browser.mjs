#!/usr/bin/env node
import { checkStations } from './radio-expectations.mjs';
import{assertCartRoad,assertWheelProgress,assertLooseBridge,assertFoundationCorner,LOOSE_BRIDGE_SURFACES}from'./era-observations.mjs';
// Judique 1884 in the actual page: scene, terrain meshes and fixed-step vehicle. No FPS claims. Setup shared in form with era-browser.mjs.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const [defaultOut,first]=process.argv.slice(2),out=process.env.DENSITY_EVIDENCE??defaultOut,port=process.env.CDP_PORT;
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
   c.updateMatrixWorld();t.update(c);mmm.trees?.update(t.drawnFine,c.position);mmm.grass?.update(.1,c,mmm.vehicle.x,mmm.vehicle.z,mmm.vehicle.heading,mmm.vehicle.spec);mmm.coast?.update(c.position);mmm.roads.update(c.position);mmm.edge?.update(c.position);history?.update(c.position);mmm.props?.update(c,0);mmm.landmarks?.update(c);mmm.yard?.update(0,mmm.vehicle,c.position);mmm.buildings?.mesh.updateMatrixWorld();mmm.water?.update(c);
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
// The Judique identity, used on Judique and (as a negative control) on Mabou 1884, where it must fail.
const judiqueTitle=async()=>{
 assert.equal(await read("document.querySelector('#title h1').textContent"),'Judique, 1884');
 await read("document.querySelector('#titleCredits').click()");
 const legal=await read("document.querySelector('#titleLegal').textContent");
 assert.match(legal,/Cape Breton sheet 19 \(Hugh Fletcher, 1884\)/);assert.match(legal,/A\.F\. Church and Co\./);assert.doesNotMatch(legal,/sheets 14 and 16/);
};
// A rented runner gets no audio files; the car has a radio exactly when the radio list is served.
let hasAudio=false;
const startPlay=async()=>{hasAudio=await read("fetch('/audio/radio.json').then(r=>r.ok&&(r.headers.get('content-type')??'').includes('json')).catch(()=>false)");await read("document.querySelector('#titleStart').click()");for(let n=0;n<(hasAudio?120:10)&&!await read('!!mmm.radio');n++)await pause(100);};
const judiqueState=async()=>assert.deepEqual(await read("({era:mmm.era.id,title:mmm.era.title,area:mmm.area.id,historyArea:mmm.history?.area,trades:mmm.history?.trades.length,labels:mmm.history?.trades.filter(t=>t.id.startsWith('F19-JUD-')).length})"),
 {era:'1884',title:'Judique, 1884',area:'judique',historyArea:'judique',trades:37,labels:37});
try{
 await send('Runtime.enable');await send('Page.enable');
 // Title card and credits: Judique's own words and sources.
 await load('era=1884&area=judique&vehicle=car&hud=1&title=1');
 // document.title is the harness's 'settled' signal here; site-http checks the served <title>Judique, 1884</title>.
 assert.match(await read("document.querySelector('#title').textContent"),/A work of fiction, based on an 1884 survey sheet\. Places are approximate\. It shows no person's land\./);
 await shot('judique-title-card');
 await judiqueTitle();
 await startPlay();await judiqueState();
 const state=await read(`({era:mmm.era.id,area:mmm.area.id,historyArea:mmm.history.area,mode:mmm.gameMode,trades:mmm.history.trades.length,places:mmm.places.places.filter(p=>p.id.startsWith('F19-JUD-')).length,props:mmm.props,buildings:mmm.buildings,yard:mmm.yard,animals:mmm.animals,roadScene:mmm.roadScene,rail:mmm.roads.roads.some(r=>r.kind===5),radio:!!mmm.radio,mp:!!mmm.mp,home:mmm.area.home,church:mmm.area.church})`);
 assert.deepEqual(state,{era:'1884',area:'judique',historyArea:'judique',mode:'explore',trades:37,places:37,props:null,buildings:null,yard:null,animals:null,roadScene:null,rail:false,radio:hasAudio,mp:false,home:false,church:false});
 assert.equal(await read("mmm.places.places.some(p=>p.id==='home'||p.id==='church')"),false,'today\'s Judique places are not in 1884 (today has both: checked below)');
 const data=await read('eraQA.data()');records.sites=data.trades;records.farms=data.farms;records.farmCounts=data.farmCounts;records.life=data.life;
 assert(data.farms.length>0,'invented farmsteads are drawn');
 await read('eraQA.hideUI(true)');
 records.steady=await read(`(()=>{const h=mmm.history,t=mmm.terrain,c=mmm.camera,before={...h.audit},revision=t.contactRevision;for(let i=0;i<120;i++){t.update(c);mmm.roads.update(c.position);h.update(c.position,1/60);}return{heightQueries:h.audit.heightQueries-before.heightQueries,modelVisits:h.audit.modelVisits-before.modelVisits,fits:h.audit.fits-before.fits,revisionChange:t.contactRevision-revision};})()`);
 assert.deepEqual(records.steady,{heightQueries:0,modelVisits:0,fits:0,revisionChange:0},'still-camera runtime contact cache');
 // Village road (the village origin is beside the church and Highway 19), then one site of each printed kind.
 const village={x:0,z:60,eye:2.5,tx:0,tz:-200,lift:1.7};
 const villageView=async()=>{await read(`eraQA.look(${village.x},${village.z},${village.eye},${village.tx},${village.tz},${village.lift})`);await read('eraQA.settleView()');await read(`eraQA.look(${village.x},${village.z},${village.eye},${village.tx},${village.tz},${village.lift})`);};
 await villageView();await shot('judique-village-road');records.budgets.eraVillage=await read('eraQA.budget()');
 const kinds=['church','school','forge','mill','shop','post-office','stables'];records.kinds={};
 for(const kind of kinds){const site=data.trades.find(s=>s.kind===kind);assert(site,'a sited '+kind);records.kinds[kind]=site.id;await read(`eraQA.siteView(${JSON.stringify(site.id)},${kind==='church'?30:27},${kind==='church'?0:12})`);await shot('judique-'+kind);}
 const water=data.trades.find(s=>s.method==='water');
 if(water){const progress=await read(`(()=>{const m=mmm.history.models.find(m=>m.site.id===${JSON.stringify(water.id)}),before=m.wheel.rotation.x;mmm.history.update(mmm.camera.position,.5);return m.wheel.rotation.x-before;})()`);assertWheelProgress(0,progress);records.waterMill=water.id;}
 records.boardCaps=await read(`mmm.history.boards.list.map(b=>({id:b.owner.site.id,distance:Math.hypot(b.approachX-b.x,b.approachZ-b.z),pixels:b.letterHeight/Math.hypot(b.approachX-b.x,b.approachZ-b.z)*900/(2*Math.tan(51*Math.PI/360))}))`);
 assert.equal(records.boardCaps.length,37);for(const b of records.boardCaps)assert(b.pixels>=12,'all trade boards readable at their road approach '+JSON.stringify(b));
 const board=await read(`eraQA.boardView(${JSON.stringify(records.kinds.forge)})`);assert(board.capPixels>=12);await shot('judique-readable-board');
 const farm=data.farms.filter(f=>f.zone==='roadside').sort((a,b)=>Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z))[0];
 if(farm){await read(`eraQA.siteView(${JSON.stringify(farm.id)},39,22)`);await shot('judique-farmstead');}
 const wideView=async()=>{await read('mmm.camera.position.set(700,380,900);mmm.camera.fov=51;mmm.camera.updateProjectionMatrix();mmm.camera.lookAt(-500,20,-700);mmm.camera.updateMatrixWorld()');};
 await wideView();await shot('judique-wide');records.budgets.eraWide=await read('eraQA.budget()');
 assert(data.bridges.length>0,'Judique has bridges to cross');
 const first=data.bridges[0];
 await read(`(async()=>{const r=mmm.roads.roads.find(r=>r.id===${first.id}),p=r.pts[Math.floor(r.pts.length/2)];eraQA.look(p[0]+35,p[1]+16,7,p[0],p[1],3);await eraQA.settleView();eraQA.look(p[0]+35,p[1]+16,7,p[0],p[1],3);})()`);await shot('judique-timber-bridge');
 // Every Judique bridge inside the play wall: cross on the production vehicle with the current deck plane.
 // Exactly one bridge is outside the wall: Rear Intervale Road at the north edge, where the car cannot be placed.
 // Any other bridge that is not fully inside the wall (20 m margin) fails the row.
 const wall=await read('mmm.vehicle.bounds');assert(Array.isArray(wall),'play wall bounds');
 const crossable=[];records.edgeBridges=[];
 for(const bridge of data.bridges){const inset=Math.min(...bridge.pts.map(([x,z])=>Math.min(x-wall[0],z-wall[1],wall[2]-x,wall[3]-z)));if(inset>=20)crossable.push(bridge);else records.edgeBridges.push({id:bridge.id,name:bridge.name,insetM:Math.round(inset)});}
 assert.deepEqual(records.edgeBridges.map(b=>({id:b.id,name:b.name})),[{id:94,name:'Rear Intervale Road'}],'the only bridge not crossed is Rear Intervale Road '+JSON.stringify(records.edgeBridges));
 assert(records.edgeBridges[0].insetM<0,'Rear Intervale Road is outside the wall '+JSON.stringify(records.edgeBridges));
 console.log('EDGE BRIDGES',JSON.stringify(records.edgeBridges));
 for(const bridge of crossable){
  await read(`(async()=>{const r=mmm.roads.roads.find(r=>r.id===${bridge.id}),a=r.pts[0],b=r.pts.at(-1);eraQA.look((a[0]+b[0])/2+12,(a[1]+b[1])/2+12,22,(a[0]+b[0])/2,(a[1]+b[1])/2,1);await eraQA.settleView();})()`);
  const result=await read(`(()=>{
   const road=mmm.roads.roads.find(r=>r.id===${bridge.id}),pts=road.pts,cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum.at(-1)+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));const len=cum.at(-1),v=mmm.vehicle;
   const at=s=>{let i=0;while(i<pts.length-2&&cum[i+1]<s)i++;const a=pts[i],b=pts[i+1],d=cum[i+1]-cum[i],t=(s-cum[i])/d;return {x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,h:Math.atan2(b[0]-a[0],a[1]-b[1])};};
   const start=at(0);v.restart(start.x,start.z,start.h);v.assist=0;v.strongHelp=false;let progress=0,steps=0,maxGap=0,deckSamples=0,wrongSurface=0;
   for(;steps<120*(len/2+20)&&progress<len+5;steps++){
    let best=Infinity;for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],dx=b[0]-a[0],dz=b[1]-a[1],l=cum[i]-cum[i-1],t=Math.max(0,Math.min(i===pts.length-1?1+8/l:1,((v.x-a[0])*dx+(v.z-a[1])*dz)/(l*l))),x=a[0]+t*dx,z=a[1]+t*dz,d=Math.hypot(x-v.x,z-v.z);if(d<best){best=d;progress=cum[i-1]+t*l;}}
    const goal=at(Math.min(len+7,progress+6)),heading=Math.atan2(goal.x-v.x,v.z-goal.z),error=Math.atan2(Math.sin(heading-v.heading),Math.cos(heading-v.heading));
    mmm.driveVehicle(1/120,{throttle:Math.abs(v.speed)<4?1:Math.abs(v.speed)>5?-.1:0,steer:Math.max(-1,Math.min(1,error*2)),handbrake:false,touch:false});
    const deck=mmm.roads.deckHeight(v.x,v.z);if(deck!==null){deckSamples++;if(!${JSON.stringify(LOOSE_BRIDGE_SURFACES)}.includes(v.surfaceName))wrongSurface++;maxGap=Math.max(maxGap,Math.abs(v.y-deck));}
   }
   return {id:road.id,length:len,progress,steps,surface:v.surfaceName,deckSamples,wrongSurface,maxGap,success:progress>=len+3};
  })()`);
  assert.equal(result.success,true,'cross bridge '+JSON.stringify(result));assert(result.deckSamples>0);assert.equal(result.wrongSurface,0);assert(result.maxGap<1.0,'deck contact '+JSON.stringify(result));records.bridges.push(result);console.log('PASS Judique bridge',result.id,JSON.stringify(result));
 }
 // Every garage entry drives on the cart road and is held out of a period wall.
 const garage=await read(`(async()=>{const {GARAGE}=await import('/src/garage.ts');return GARAGE.map(g=>g.id);})()`);records.vehicles=[];
 for(const id of garage){
  await load('era=1884&area=judique&hud=1&vehicle='+encodeURIComponent(id));
  const drive=await read(`(()=>{const v=mmm.vehicle,x=v.x,z=v.z;for(let i=0;i<360;i++)mmm.driveVehicle(1/120,{throttle:1,steer:0,handbrake:false,touch:false});return {moved:Math.hypot(v.x-x,v.z-z),surface:v.surfaceName,surfaceKind:mmm.terrain.surfaceAt(v.x,v.z)?.kind,speed:v.speed};})()`);
  assert(drive.moved>3,'garage entry drives '+id);assertCartRoad(drive);records.vehicles.push({id,...drive});
 }
 // Default ride is the horse; it loads no radio.
 await load('era=1884&area=judique&hud=1&title=1&q=low',390,844);
 assert.equal(await read('mmm.vehicleId'),'horse','Judique 1884 defaults to the horse');assert.equal(await read('!!mmm.radio'),false);
 assert.equal(await read("performance.getEntriesByType('resource').some(e=>new URL(e.name).pathname.startsWith('/audio/radio'))"),false,'horse does not load radio');
 await read("document.querySelector('#titleStart').click()");await shot('judique-phone-horse');
 // Today's Judique keeps its modern scenery and never decodes a layout.
 await load('area=judique&hud=1&title=1');
 assert.equal(await read('mmm.era.id'),'today');assert.equal(await read('!!mmm.history'),false);
 assert.deepEqual(await read("({home:mmm.area.home,church:mmm.area.church,places:['home','church'].map(id=>mmm.places.places.some(p=>p.id===id))})"),{home:true,church:true,places:[true,true]},'today\'s Judique has the house and church that 1884 leaves out');assert.equal(await read('!!mmm.buildings&&!!mmm.props'),true);
 assert.equal(await read("document.querySelector('#title h1').textContent.includes('1884')"),false);
 assert.equal(await read(`(async()=>{const m=await import('/src/eras/history-layout.ts');return m.historyLayoutState('judique').hasLayout||m.historyLayoutState('mabou').hasLayout;})()`),false,'today decodes no 1884 layout');
 await read("document.querySelector('#titleStart').click();eraQA.hideUI(true)");
 await villageView();await shot('today-judique-village-road');records.budgets.todayVillage=await read('eraQA.budget()');
 await wideView();await shot('today-judique-wide');records.budgets.todayWide=await read('eraQA.budget()');
 // Negative control: the same Judique assertions reject Mabou 1884 (its title, credits, area and 48 trades).
 await load('era=1884&area=mabou&vehicle=car&hud=1&title=1');
 await assert.rejects(judiqueTitle(),/Judique, 1884|sheet 19|sheets 14 and 16/,'Judique title assertions must reject Mabou 1884');
 await startPlay();
 await assert.rejects(judiqueState(),/Expected values to be strictly deep-equal/,'Judique state assertions must reject Mabou 1884');
 assert.equal(await read('mmm.history.area'),'mabou');records.negativeControl='Mabou 1884 rejected by the Judique title and state assertions';
 console.log('PASS negative control: Judique assertions reject Mabou 1884');
 assert.deepEqual(errors,[],'no page/console errors');records.errors=errors;
 writeFileSync(`${out}/judique-browser-results.json`,JSON.stringify(records,null,2));console.log('BUDGETS',JSON.stringify(records.budgets));
 console.log('PASS Judique 1884: title and credits, no modern objects, 37 places, all bridges crossed, cart roads, horse default, today regression');
}finally{
 ws.send(JSON.stringify({id:++id,method:'Browser.close'}));await pause(3000);ws.close();
}
