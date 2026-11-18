#!/usr/bin/env node
import { checkStations } from './radio-expectations.mjs';
import{assertCartRoad,assertWheelProgress,assertLooseBridge,assertFoundationCorner,LOOSE_BRIDGE_SURFACES}from'./era-observations.mjs';
// The actual page, scene, selected terrain meshes and fixed-step vehicle. No FPS claims.
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
try{
 await send('Runtime.enable');await send('Page.enable');
 await load('era=1884&vehicle=car&hud=1&title=1');
 assert.equal(await read("document.querySelector('#title h1').textContent"),'Mabou, 1884');
 assert.match(await read("document.querySelector('#title').textContent"),/A work of fiction, based on an 1884 survey sheet/);
 assert.equal(await read("document.querySelector('#modeChoice')===null"),true);
 await shot('title-card');
 await read("document.querySelector('#titleCredits').click()");assert.match(await read("document.querySelector('#titleLegal').textContent"),/1884 places: Geological Survey of Canada/);assert.match(await read("document.querySelector('#titleLegal').textContent"),/^Something wrong, or you want a place removed\? Write to justdrive@fakkeldy\.ca\./);
 await read("document.querySelector('#titleStart').click()");
 for(let n=0;n<120&&!await read('!!mmm.radio');n++)await new Promise(r=>setTimeout(r,100));
 const state=await read(`({era:mmm.era.id,mode:mmm.gameMode,trades:mmm.history.trades.length,places:mmm.places.places.length,props:mmm.props,buildings:mmm.buildings,yard:mmm.yard,animals:mmm.animals,roadScene:mmm.roadScene,rail:mmm.roads.roads.some(r=>r.kind===5),radio:!!mmm.radio,mp:!!mmm.mp,mpSwitch:!!document.querySelector('.mpControl')})`);
 assert.deepEqual(state,{era:'1884',mode:'explore',trades:48,places:48,props:null,buildings:null,yard:null,animals:null,roadScene:null,rail:false,radio:true,mp:false,mpSwitch:false});
 assert.equal(await read("getComputedStyle(document.querySelector('#shiftHud')).display"),'none');
 const data=await read('eraQA.data()');records.sites=data.trades;records.farms=data.farms;records.farmCounts=data.farmCounts;records.life=data.life;
 await read('eraQA.hideUI(true)');
 // Centre-road view, also reused verbatim on today's page.
 const village={x:-35,z:100,eye:2.5,tx:10,tz:-40,lift:1.7};
 const villageView=async()=>{await read(`eraQA.look(${village.x},${village.z},${village.eye},${village.tx},${village.tz},${village.lift})`);await read('eraQA.settleView()');await read(`eraQA.look(${village.x},${village.z},${village.eye},${village.tx},${village.tz},${village.lift})`);};
 await villageView();await shot('village-main-road');records.budgets.eraVillage=await read('eraQA.budget()');
 records.steady=await read(`(()=>{const h=mmm.history,t=mmm.terrain,c=mmm.camera,before={...h.audit},revision=t.contactRevision;for(let i=0;i<120;i++){t.update(c);mmm.roads.update(c.position);h.update(c.position,1/60);}return{heightQueries:h.audit.heightQueries-before.heightQueries,modelVisits:h.audit.modelVisits-before.modelVisits,fits:h.audit.fits-before.fits,revisionChange:t.contactRevision-revision};})()`);
 assert.deepEqual(records.steady,{heightQueries:0,modelVisits:0,fits:0,revisionChange:0},'still-camera runtime contact cache');
 const chosen={forge:'F16-PHM-054',mill:'F16-PHM-127',school:'F16-PHM-053',church:'F16-PHM-024',stables:'F16-PHM-050','saw-mill':'F14-CMB-155','weaving-mills':'F16-PHM-042','shingle-mill':'F16-PHM-125',quarry:'F16-PHM-005'};
 for(const [name,id]of Object.entries(chosen)){await read(`eraQA.siteView(${JSON.stringify(id)},${name==='church'?30:27},${name==='church'?0:12})`);await shot(name);if(name==='mill'){
   const progress=await read(`(()=>{const m=mmm.history.models.find(m=>m.site.id==='F16-PHM-127'),before=m.wheel.rotation.x;mmm.history.update(mmm.camera.position,.5);return m.wheel.rotation.x-before;})()`);
   assertWheelProgress(0,progress);assert.throws(()=>assertWheelProgress(0,0));
 }}
 if(process.env.ERA_ART_ONLY==='1'){
  const fenceFarm=await read(`mmm.history.life.items.find(i=>i.kind==='rail'&&i.owner.site.kind==='farm')?.owner.site.id`);
  await read(`(async()=>{const s=mmm.history.farms.find(s=>s.id===${JSON.stringify(fenceFarm)}),rails=mmm.history.life.items.filter(i=>i.kind==='rail'&&i.owner.site.id===s.id),fx=rails.reduce((a,i)=>a+i.x,0)/rails.length,fz=rails.reduce((a,i)=>a+i.z,0)/rails.length,dx=fx-s.x,dz=fz-s.z,n=Math.hypot(dx,dz),frame=()=>eraQA.look(fx+dx/n*18,fz+dz/n*18,3.5,(fx+s.x)/2,(fz+s.z)/2,3);frame();await eraQA.settleView();frame();})()`);await shot('farmstead-fences');
  assert.deepEqual(errors,[]);records.errors=errors;writeFileSync(`${out}/art-results.json`,JSON.stringify(records,null,2));console.log('PASS refreshed era material and art captures');
 }else{
 records.boardCaps=await read(`mmm.history.boards.list.map(b=>({id:b.owner.site.id,distance:Math.hypot(b.approachX-b.x,b.approachZ-b.z),pixels:b.letterHeight/Math.hypot(b.approachX-b.x,b.approachZ-b.z)*900/(2*Math.tan(51*Math.PI/360))}))`);
 for(const b of records.boardCaps)assert(b.pixels>=12,'all trade boards readable at their road approach '+JSON.stringify(b));
 records.boards=[];
 for(const id of [chosen.forge,chosen.mill,chosen['weaving-mills']]){const board=await read(`eraQA.boardView(${JSON.stringify(id)})`);assert(board.capPixels>=12,'readable board '+JSON.stringify(board));records.boards.push({id,...board});await shot(id===chosen.forge?'readable-board':id===chosen.mill?'mill-road-board':'weaving-road-board');}
 await read('eraQA.siteView("F16-PHM-127")');
 records.forest=await read(`(()=>{const t=mmm.terrain,p={x:8479,z:1551},probe={height:0,source:0,drawn:false};t.meshContactAt(p.x,p.z,probe);const tile=t.drawnTile(p.x,p.z),s=t.surfaceAt(p.x,p.z);return {point:p,tileLevel:tile?.level,hasFinest:t.hasFinest(p.x,p.z),treeSource:!!mmm.trees?.have.has(Math.floor((p.x+t.manifest.village[0]-t.manifest.origin[0])/256)+'_'+Math.floor((p.z+t.manifest.origin[1]-t.manifest.village[1])/256)),contact:probe,surface:s};})()`);
 await read('eraQA.boardView("F16-PHM-054")');await read(`(()=>{const c=mmm.camera,b=mmm.history.boards.list.find(b=>b.owner.site.id==='F16-PHM-054');c.lookAt(b.x,mmm.terrain.heightAt(b.x,b.z)+.2,b.z);c.updateMatrixWorld();})()`);await shot('mud-road-level');
 const farm=data.farms.filter(f=>f.zone==='roadside').sort((a,b)=>Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z))[0];
 await read(`eraQA.siteView(${JSON.stringify(farm.id)},39,22)`);await shot('farmstead-group');
 const fenceFarm=await read(`mmm.history.life.items.find(i=>i.kind==='rail'&&i.owner.site.kind==='farm')?.owner.site.id`);
 if(fenceFarm){await read(`(async()=>{const s=mmm.history.farms.find(s=>s.id===${JSON.stringify(fenceFarm)}),rails=mmm.history.life.items.filter(i=>i.kind==='rail'&&i.owner.site.id===s.id),fx=rails.reduce((a,i)=>a+i.x,0)/rails.length,fz=rails.reduce((a,i)=>a+i.z,0)/rails.length,x=(s.x+fx)/2,z=(s.z+fz)/2,c=Math.cos(s.yaw),a=Math.sin(s.yaw);eraQA.look(x+a*38+c*24,z+c*38-a*24,9,x,z,2);await eraQA.settleView();eraQA.look(x+a*38+c*24,z+c*38-a*24,9,x,z,2);})()`);await shot('farmstead-fences');}else throw Error('no farm fence');
 const bridge=data.bridges.find(r=>r.id===30)??data.bridges.find(r=>r.kind===1);
 await read(`(async()=>{const r=mmm.roads.roads.find(r=>r.id===${bridge.id}),p=r.pts[Math.floor(r.pts.length/2)];eraQA.look(p[0]+35,p[1]+16,7,p[0],p[1],3);await eraQA.settleView();eraQA.look(p[0]+35,p[1]+16,7,p[0],p[1],3);})()`);await shot('timber-bridge-side');
 await read(`(async()=>{const r=mmm.roads.roads.find(r=>r.id===${bridge.id}),a=r.pts[0],b=r.pts.at(-1),dx=b[0]-a[0],dz=b[1]-a[1],d=Math.hypot(dx,dz);eraQA.look(a[0]+dx/d*2,a[1]+dz/d*2,2.1,b[0],b[1],1.3);await eraQA.settleView();eraQA.look(a[0]+dx/d*2,a[1]+dz/d*2,2.1,b[0],b[1],1.3);})()`);await shot('timber-bridge-deck');
 const wideView=async()=>{await read('mmm.camera.position.set(800,430,650);mmm.camera.fov=51;mmm.camera.updateProjectionMatrix();mmm.camera.lookAt(-600,20,-1000);mmm.camera.updateMatrixWorld()');};
 await wideView();await shot('valley-wide');records.budgets.eraWide=await read('eraQA.budget()');
 // Density evidence: a view of the village and two occupied back-country cells.
 await read('eraQA.look(450,250,650,250,-200,0,60)');await shot('density-village-above');
 const density=await read(`(async()=>{const d=await import('/src/eras/mabou-1884-density.ts'),groups={};for(const f of mmm.history.farms)if(f.zone!=='village'){const key=d.densityCellAt(mmm.terrain.manifest.village[0]+f.x,mmm.terrain.manifest.village[1]-f.z);(groups[key]??=[]).push(f);}return Object.entries(groups).filter(([,f])=>f.length>=3&&Math.hypot(f[0].x,f[0].z)>3200).sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0])).slice(0,2).map(([cell,farms])=>({cell,farms}));})()`);
 records.densityCells=[];
 for(const group of density){
  const x=group.farms.reduce((n,f)=>n+f.x,0)/group.farms.length,z=group.farms.reduce((n,f)=>n+f.z,0)/group.farms.length;
  await read(`eraQA.look(${x+100},${z+260},750,${x},${z},0,65)`);await shot('density-backcountry-'+group.cell);records.densityCells.push({cell:group.cell,built:group.farms.length});
 }
 assert.equal(records.densityCells.length,2,'two populated back-country cells');

 // Pass-2 evidence: an edge cell and the nearest farm to a timber approach.
 const edgeFarm=await read(`(async()=>{const d=await import('/src/eras/mabou-1884-density.ts');return mmm.history.farms.find(f=>d.densityCellAt(mmm.terrain.manifest.village[0]+f.x,mmm.terrain.manifest.village[1]-f.z)==='E16-N11');})()`);
 assert(edgeFarm,'edge cell E16-N11 retains its count');
 await read(`eraQA.look(${edgeFarm.x-100},${edgeFarm.z+80},70,${edgeFarm.x+35},${edgeFarm.z},2,60)`);await shot('density-edge-wall');records.edgeFarm={id:edgeFarm.id,bounds:await read('mmm.edge.bounds')};
 const nearApproach=await read(`(()=>{let best;for(const [i,a]of mmm.terrain.bridgeApproaches.sites.entries())if(i%3!==0)for(const f of mmm.history.farms){const b=a.box,dist=Math.hypot(Math.max(b[0]-f.x,0,f.x-b[2]),Math.max(b[1]-f.z,0,f.z-b[3]));if(!best||dist<best.distance)best={index:i,box:b,farm:f,distance:dist};}return best;})()`);
 assert(nearApproach,'a bridge approach and nearest farm exist');
 const ax=(nearApproach.box[0]+nearApproach.box[2])/2,az=(nearApproach.box[1]+nearApproach.box[3])/2,cx=(ax+nearApproach.farm.x)/2,cz=(az+nearApproach.farm.z)/2;
 await read(`eraQA.look(${cx+85},${cz+90},55,${cx},${cz},2,62)`);await shot('density-bridge-approach');records.nearApproach=nearApproach;

 // Every retained bridge: actually cross on the production vehicle, centreline steering, with the current deck plane.
 for(const bridge of data.bridges){
  await read(`(async()=>{const r=mmm.roads.roads.find(r=>r.id===${bridge.id}),a=r.pts[0],b=r.pts.at(-1);eraQA.look((a[0]+b[0])/2+12,(a[1]+b[1])/2+12,22,(a[0]+b[0])/2,(a[1]+b[1])/2,1);await eraQA.settleView();})()`);
  const result=await read(`(()=>{
   const road=mmm.roads.roads.find(r=>r.id===${bridge.id}),pts=road.pts,cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum.at(-1)+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));const len=cum.at(-1),v=mmm.vehicle;
   const at=s=>{let i=0;while(i<pts.length-2&&cum[i+1]<s)i++;const a=pts[i],b=pts[i+1],d=cum[i+1]-cum[i],t=(s-cum[i])/d;return {x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,h:Math.atan2(b[0]-a[0],a[1]-b[1])};};
   const start=at(0);v.restart(start.x,start.z,start.h);
   v.assist=0;v.strongHelp=false;const initial={y:v.y,ground:mmm.terrain.heightAt(v.x,v.z),deck:mmm.roads.deckHeight(v.x,v.z),pitch:v.pitch,roll:v.roll};let progress=0,steps=0,maxGap=0,deckSamples=0,wrongSurface=0;
   for(;steps<120*(len/2+20)&&progress<len+5;steps++){
    let best=Infinity;for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],dx=b[0]-a[0],dz=b[1]-a[1],l=cum[i]-cum[i-1],t=Math.max(0,Math.min(i===pts.length-1?1+8/l:1,((v.x-a[0])*dx+(v.z-a[1])*dz)/(l*l))),x=a[0]+t*dx,z=a[1]+t*dz,d=Math.hypot(x-v.x,z-v.z);if(d<best){best=d;progress=cum[i-1]+t*l;}}
    const goal=at(Math.min(len+7,progress+6)),heading=Math.atan2(goal.x-v.x,v.z-goal.z),error=Math.atan2(Math.sin(heading-v.heading),Math.cos(heading-v.heading));
    mmm.driveVehicle(1/120,{throttle:Math.abs(v.speed)<4?1:Math.abs(v.speed)>5?-.1:0,steer:Math.max(-1,Math.min(1,error*2)),handbrake:false,touch:false});
    const deck=mmm.roads.deckHeight(v.x,v.z);if(deck!==null){deckSamples++;if(!${JSON.stringify(LOOSE_BRIDGE_SURFACES)}.includes(v.surfaceName))wrongSurface++;maxGap=Math.max(maxGap,Math.abs(v.y-deck));}
   }
   return {id:road.id,initial,contact:mmm.terrain.surfaceAt(v.x,v.z),length:len,progress,steps,x:v.x,z:v.z,surface:v.surfaceName,deckSamples,wrongSurface,maxGap,ground:mmm.terrain.heightAt(v.x,v.z),deck:mmm.roads.deckHeight(v.x,v.z),y:v.y,deckState:(()=>{const d=mmm.roads.decks.get(road.id);return {y0:d?.y0,y1:d?.y1,level:d?.level};})(),success:progress>=len+5};
  })()`);
  assert.equal(result.success,true,'cross bridge '+JSON.stringify(result));assert(result.deckSamples>0);assert.equal(result.wrongSurface,0);assert(result.maxGap<1.0,'deck contact '+JSON.stringify(result));records.bridges.push(result);writeFileSync(`${out}/bridge-progress.json`,JSON.stringify(records.bridges,null,2));console.log('BRIDGE',JSON.stringify(result));
 }
 await load('era=1884&hud=1&touch=1',390,844);
 assert.equal(await read('mmm.gameMode'), 'explore');assert.equal(await read('mmm.low'),true);await shot('phone');
 await load('hud=1&title=1');
 assert.equal(await read('mmm.era.id'),'today');assert.equal(await read('mmm.gameMode'),'mail');assert.equal(await read('!!mmm.props&&!!mmm.buildings&&!!mmm.yard&&!!mmm.animals'),true);assert.equal(await read('mmm.shift.constructor.name'),'Shift');
 assert.notEqual(await read("getComputedStyle(document.querySelector('#shiftHud')).display"),'none');
 await read("document.querySelector('#titleStart').click();eraQA.hideUI(true)");
 await villageView();await shot('today-village-main-road');records.budgets.todayVillage=await read('eraQA.budget()');
 await wideView();await shot('today-valley-wide');records.budgets.todayWide=await read('eraQA.budget()');
 // Ground-contact vertices meet drawn land; the floor may step below it at both ends of the requested hill range.
 records.hills=[];
 for(const exag of [1,2.5]){
  await load('era=1884&hud=0&exag='+exag);
  await read('eraQA.siteView("F16-PHM-054")');await read('eraQA.settleView()');
  const contact=await read(`(()=>{const model=mmm.history.models.find(m=>m.site.id==='F16-PHM-054'),s=model.site,p=model.foundation.geometry.attributes.position;
   const result=[];for(const x of [-s.width/2,s.width/2])for(const z of [-s.length/2,s.length/2]){
    const vertices=[];for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i)-x)<.001&&Math.abs(p.getZ(i)-z)<.001)vertices.push(p.getY(i)+model.node.position.y);
    const wx=s.x+x*Math.cos(s.yaw)+z*Math.sin(s.yaw),wz=s.z-x*Math.sin(s.yaw)+z*Math.cos(s.yaw),ground=mmm.terrain.meshHeightAt(wx,wz,true);
    result.push({vertices,base:model.node.position.y,ground});
   }return result;})()`);
  for(const c of contact)assertFoundationCorner(c.vertices,c.base,c.ground,'drawn foundation at hill '+exag);
  records.hills.push({exag,contact});await shot('hill-'+exag);
 }
 // Any entry offered by the garage uses its normal rig and dynamics in the era.
 const garage=await read(`(async()=>{const {GARAGE}=await import('/src/garage.ts');return GARAGE.map(g=>g.id);})()`);
 records.vehicles=[];
 for(const id of garage){
  await load('era=1884&hud=1&vehicle='+encodeURIComponent(id));
  const drive=await read(`(()=>{const v=mmm.vehicle,x=v.x,z=v.z;for(let i=0;i<360;i++)mmm.driveVehicle(1/120,{throttle:1,steer:0,handbrake:false,touch:false});return {moved:Math.hypot(v.x-x,v.z-z),surface:v.surfaceName,surfaceKind:mmm.terrain.surfaceAt(v.x,v.z)?.kind,speed:v.speed};})()`);
  assert(drive.moved>3,'garage entry drives '+id);assertCartRoad(drive);assert.throws(()=>assertCartRoad({surfaceKind:0,surface:'grass'}));
  const collision=await read(`(()=>{const v=mmm.vehicle,model=mmm.history.models.filter(m=>m.node.visible&&m.site.kind!=='farm').sort((a,b)=>Math.hypot(a.site.x-v.x,a.site.z-v.z)-Math.hypot(b.site.x-v.x,b.site.z-v.z))[0],s=model.site;
   v.restart(s.x,s.z,Math.PI-s.yaw);mmm.driveVehicle(1/120,{throttle:0,steer:0,handbrake:true,touch:false});
   const dx=v.x-s.x,dz=v.z-s.z,across=dx*Math.cos(s.yaw)-dz*Math.sin(s.yaw),along=dx*Math.sin(s.yaw)+dz*Math.cos(s.yaw);
   return {id:s.id,across,along,halfWidth:s.width/2,half:s.length/2,radius:v.spec.envelope.radius};})()`);
  assert(Math.abs(collision.across)>=collision.halfWidth+collision.radius-.1||Math.abs(collision.along)>=collision.half,'period wall excludes '+id+' '+JSON.stringify(collision));
  records.vehicles.push({id,...drive,collision});
 }
 assert.throws(()=>assertLooseBridge('grass'),/loose surface/);
 await load('era=1884&vehicle=bike&hud=1&title=1&q=low',390,844);
 for(let n=0;n<120&&!await read('!!mmm.radio');n++)await pause(100);
 assert.equal(await read('mmm.vehicleId'),'bike');checkStations(await read('mmm.radio.stations'));
 await load('era=1884&hud=1&title=1&q=low',390,844);
 assert.equal(await read('mmm.vehicleId'),'horse','1884 defaults to horse');
 assert.equal(await read('!!mmm.radio'),false);assert.equal(await read("!!document.getElementById('radio')"),false);
 assert.equal(await read("performance.getEntriesByType('resource').some(e=>new URL(e.name).pathname.startsWith('/audio/radio'))"),false,'horse does not load radio');
 assert.equal(await read("/radio|station|horn/i.test(document.querySelector('#title dl').textContent)"),false);
 console.log('PASS 1884 car/bike radio and default horse without a radio list or horn');
 assert.deepEqual(errors,[],'no page/console errors');records.errors=errors;
 writeFileSync(`${out}/browser-results.json`,JSON.stringify(records,null,2));console.log('BUDGETS',JSON.stringify(records.budgets));console.log('PASS era title, no modern objects/HUD/rail; shared radio, 48 places, all bridges crossed, phone and today regression');
 }
}finally{
 // This base's yard-shots cleanup removes a profile before a loaded browser has finished writing it.
 // Close only our browser and let its helpers exit before handing control back to that cleanup trap.
 ws.send(JSON.stringify({id:++id,method:'Browser.close'}));await pause(3000);ws.close();
}
