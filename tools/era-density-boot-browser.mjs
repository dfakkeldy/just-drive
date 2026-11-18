#!/usr/bin/env node
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
 await load('hud=0&title=1&name=density-today');
 const today=await read(`(async()=>{const m=await import('/src/eras/history-layout.ts');return m.historyLayoutState();})()`);
 assert.deepEqual(today,{decodes:0,hasLayout:false},'actual today startup must leave layout unparsed');
 await load('era=1884&hud=0&title=1&name=density-era');await read("document.querySelector('#titleStart')?.click();eraQA.hideUI(true)");
 const era=await read(`(async()=>{const m=await import('/src/eras/history-layout.ts');m.historyLayout(mmm.terrain.manifest.village);return m.historyLayoutState();})()`);
 assert.deepEqual(era,{decodes:1,hasLayout:true},'actual era startup parses once even when layout is requested again');
 const road=await read(`(()=>{const r=mmm.roads.nearest(-35,100,150,r=>r.kind>=1&&r.kind<=3&&!r.bridge);if(!r)throw Error('main road camera');let dx=Math.sin(r.heading),dz=-Math.cos(r.heading);if(dx*(10-r.x)+dz*(-40-r.z)<0){dx=-dx;dz=-dz;}return{x:r.x,z:r.z,tx:r.x+dx*160,tz:r.z+dz*160};})()`);
 const street=async()=>{await read(`eraQA.look(${road.x},${road.z},1.9,${road.tx},${road.tz},1.7,62)`);};await street();await read('eraQA.settleView()');await street();
 const distance=await read('mmm.roads.nearest(mmm.camera.position.x,mmm.camera.position.z,5,r=>r.kind>=1&&r.kind<=3).dist');assert(distance<.01,'camera stands on the road centreline');await shot('village-road-centre');
 const triple=await read(`(()=>{const choices=mmm.history.boards.list.map(b=>{const t=b.owner.site,f=mmm.history.farms.reduce((best,s)=>!best||Math.hypot(s.x-t.x,s.z-t.z)<Math.hypot(best.x-t.x,best.z-t.z)?s:best,null);return{trade:t,board:{x:b.x,z:b.z,id:t.id},house:f,score:Math.max(Math.hypot(f.x-t.x,f.z-t.z),Math.hypot(b.x-t.x,b.z-t.z),Math.hypot(f.x-b.x,f.z-b.z))};});return choices.sort((a,b)=>a.score-b.score)[0];})()`);
 assert(triple&&triple.score<150,'trade, actual board and nearest house fit one view');const cx=(triple.trade.x+triple.board.x+triple.house.x)/3,cz=(triple.trade.z+triple.board.z+triple.house.z)/3;
 const group=async()=>{await read(`(()=>{const h=mmm.history,c=mmm.camera,t=h.models.find(m=>m.site.id===${JSON.stringify(triple.trade.id)}),f=h.models.find(m=>m.site.id===${JSON.stringify(triple.house.id)}),b=h.boards.list.find(b=>b.owner.site.id===${JSON.stringify(triple.trade.id)}),top=Math.max(t.node.position.y+8,f.node.position.y+8,b.node.position.y+4),dx=Math.sin(b.yaw),dz=Math.cos(b.yaw);c.position.set(${cx}+dx*65+Math.cos(b.yaw)*10,top+16,${cz}+dz*65-Math.sin(b.yaw)*10);c.fov=55;c.updateProjectionMatrix();c.lookAt(${cx},(t.node.position.y+f.node.position.y+b.node.position.y)/3+3,${cz});c.updateMatrixWorld();})()`);};await group();await read('eraQA.settleView()');await group();await shot('trade-board-nearest-house');

 assert.deepEqual(errors,[]);writeFileSync(`${out}/boot-and-pictures.json`,JSON.stringify({today,era,roadCamera:{...road,distance},triple,pictures:records.pictures,errors},null,2));console.log('PASS actual today allocation, once-only era decoder, on-road village camera and trade-board-house picture');
}finally{ws.send(JSON.stringify({id:++id,method:'Browser.close'}));await pause(1500);ws.close();}
