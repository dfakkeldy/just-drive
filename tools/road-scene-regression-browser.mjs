#!/usr/bin/env node
import { cdp, cdpFetch } from './cdp.mjs';
// Real Vehicle fixed steps, real terrain, real H key / phone HORN. No FPS measurements.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const [out,first]=process.argv.slice(2), port=process.env.CDP_PORT;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
const errors=[];
const { ws, send } = await cdp(tab.webSocketDebuggerUrl, { deadline: 180000, onEvent: d => {if(d.method==='Runtime.exceptionThrown')errors.push(d.params.exceptionDetails.exception?.description??d.params.exceptionDetails.text);} });
const read=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.error||r.result?.exceptionDetails)throw Error(JSON.stringify(r));return r.result?.result?.value;};
const shot=async name=>{const p=`${out}/${name}.png`;writeFileSync(p,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));console.log(p);};
const page=async(query,w=1400,h=950)=>{
 await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});
 const q=new URLSearchParams(query);if(!q.has('day'))q.set('day','8');if(!q.has('exag'))q.set('exag','1.5');
 await send('Page.navigate',{url:new URL(`/?hud=1&res=1&at=618990.1,5109215.9,350&${q}`,first).href});
 const start=Date.now();while(Date.now()-start<180000){await sleep(400);if(await read("document.title==='settled' && !!window.mmm?.roadScene"))break;}
 assert.equal(await read("document.title==='settled'"),true,'settled page '+query);
 if(await read("!!document.getElementById('titleStart')"))await read("document.getElementById('titleStart').click();document.activeElement?.blur()");
 await sleep(1200);await read('window.sceneRAF=window.requestAnimationFrame;window.requestAnimationFrame=f=>{window.sceneFrame=f;return 0;}');await sleep(80);
 await read(`(async()=>{
  const {FISH,touchesPlayer}=await import('/src/road-scene-rules.ts');
  const {vehicle:v,roadScene:s,camera:c,renderer:r,terrain:t}=mmm;
  const rectOverlap=(a,b)=>{
   for(const angle of [a.heading,b.heading])for(const across of [false,true]){
    const x=across?Math.cos(angle):Math.sin(angle),z=across?Math.sin(angle):-Math.cos(angle);
    const radius=r=>r.half*Math.abs(Math.sin(r.heading)*x-Math.cos(r.heading)*z)+r.halfWidth*Math.abs(Math.cos(r.heading)*x+Math.sin(r.heading)*z);
    if(Math.abs((a.x-b.x)*x+(a.z-b.z)*z)>=radius(a)+radius(b)-.01)return false;
   }return true;
  };
  const pose={x:0,z:0,heading:0},target={x:0,z:0,heading:0};
  const state=()=>({enabled:s.rules.enabled,seen:s.rules.seen,honks:s.rules.honks,along:s.rules.truckAlong,speed:s.rules.speed,carSide:s.rules.carSide,waiting:s.rules.waiting,arrived:s.rules.arrived,report:s.reportLine(),x:v.x,z:v.z});
  const place=(along,side=0,downhill=false)=>{s.road.at(along,side,pose);v.restart(pose.x,pose.z,pose.heading+(downhill?Math.PI:0));v.assist=0;v.damageActive=true;};
  const tick=(seconds,drive=false,side=2.7,direction=1)=>{
   let overlap=0,vehicleOverlap=0,minGap=999,maxShift=0,maxSpeed=0,maxPathError=0;
   for(let i=0;i<seconds*120;i++){
    const x=v.x,z=v.z;
    let input={throttle:0,steer:0,handbrake:true};
    if(drive){
     // Target the real curved shoulder 7 m ahead of the car's current projected point.
     let best=Infinity,bestAlong=0;
     for(let u=-150;u<=125;u+=.5){s.road.at(u,side,pose);const d=(pose.x-v.x)**2+(pose.z-v.z)**2;if(d<best){best=d;bestAlong=u;}}
     maxPathError=Math.max(maxPathError,Math.sqrt(best));
     s.road.at(bestAlong+7*direction,side,target);
     const wanted=Math.atan2(target.x-v.x,-(target.z-v.z));
     const err=Math.atan2(Math.sin(wanted-v.heading),Math.cos(wanted-v.heading));
     input={throttle:v.speed<4?1:0,steer:Math.max(-1,Math.min(1,err*2.5)),handbrake:false};
    }
    mmm.driveVehicle(1/120,input);
    for(const solid of s.solids)if(touchesPlayer(solid,v,-.02))overlap++;
    const [car,truck]=s.solids;
    if(car&&truck){if(rectOverlap(car,truck))vehicleOverlap++;} 
    if(car&&truck)minGap=Math.min(minGap,Math.hypot(car.x-truck.x,car.z-truck.z)-car.half-truck.half);
    if(!drive)maxShift=Math.max(maxShift,Math.hypot(v.x-x,v.z-z));
    maxSpeed=Math.max(maxSpeed,s.rules.speed);
   }
   s.update(c);return {...state(),overlap,vehicleOverlap,minGap,maxShift,maxSpeed,maxPathError};
  };
  const view=(along,side,height,lookAlong=0,lookSide=0,lookHeight=1.4)=>{
   s.road.at(along,side,pose);c.position.set(pose.x,(t.heightAt(pose.x,pose.z)??0)+height,pose.z);
   s.road.at(lookAlong,lookSide,target);c.lookAt(target.x,(t.heightAt(target.x,target.z)??0)+lookHeight,target.z);c.updateMatrixWorld();s.update(c);mmm.shift.refreshUI(v);r.render(v.car.root.parent,c);
  };
  window.qa={state,place,tick,view,FISH,touchesPlayer};
 })()`);
};
const keyHorn=async()=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key:'h',code:'KeyH'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'h',code:'KeyH'});};
const horn=async phone=>{
 if(phone){const p=await read(`(()=>{const r=document.getElementById('tcHorn').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:p.x,y:p.y}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 else await keyHorn();
 await read('qa.tick(.7)');
};
const failures=[];
const check=async(name,run)=>{try{await run();console.log('PASS regression:',name);}catch(error){failures.push(name);console.error('FAIL regression:',name,error.message);}};
const overlap=()=>read('({hits:[mmm.roadScene.visitorCar,mmm.roadScene.truck].map(s=>qa.touchesPlayer(s,mmm.vehicle)),x:mmm.vehicle.x,z:mmm.vehicle.z})');
const arm=async()=>{await keyHorn();await sleep(100);return read(`(()=>{const s=mmm.roadScene;s.setPaused(false);s.horn();window.hornDisconnects=0;window.testGain=s.hornGain;const d=testGain.disconnect.bind(testGain);testGain.disconnect=()=>{hornDisconnects++;d();};return s.sound.state;})()`);};
const audio=()=>read('({state:mmm.roadScene.sound.state,disconnected:hornDisconnects,retained:mmm.roadScene.hornGain===testGain})');
try{
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
 for(const condition of ['stopped','moving'])for(const input of ['key','touch'])await check('reset-'+input+'-'+condition,async()=>{
  // Seed a valid already-driven shoulder pose; only the reset action is under test, not this setup teleport.
  await page('scene=fish&q=low&touch=1',390,844);await read(`qa.place(24,2.7);qa.tick(${condition==='moving'?8:70});const placementGuard=mmm.vehicle.placementGuard;try{mmm.vehicle.placementGuard=null;qa.place(${condition==='moving'?'mmm.roadScene.rules.truckAlong':'-3.26'},2.7);}finally{mmm.vehicle.placementGuard=placementGuard;}`);const beforeReset=await overlap();assert.ok(beforeReset.hits.every(v=>!v),'valid shoulder setup before reset');
  if(input==='key'){await send('Input.dispatchKeyEvent',{type:'keyDown',key:'r',code:'KeyR'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'r',code:'KeyR'});}
  else{const p=await read("(()=>{const r=document.getElementById('tcReset').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,...p}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  const placed=await overlap(),steps=await read('qa.tick(.2)');console.log('reset result',input,condition,placed,steps);assert.ok(placed.hits.every(v=>!v),'no overlap immediately after reset');assert.equal(steps.overlap,0);assert.ok(steps.maxShift<.1,'no sideways throw after reset');
 });
 await check('scene-day-shift-start',async()=>{
  await page('day=1');await read("mmm.shift.route.runs[1].start={...mmm.roadScene.centre};mmm.shift.remaining.fill(0);mmm.shift.end();document.getElementById('nextDay').click()");
  assert.equal(await read('mmm.shift.career.day'),2);assert.equal(await read('mmm.roadScene.rules.enabled'),true);const placed=await overlap(),steps=await read('qa.tick(.2)');console.log('shift start',placed,steps.maxShift);assert.ok(placed.hits.every(v=>!v),'scene-day start avoids scene solids');assert.ok(steps.maxShift<.1);
 });
 await check('settings-start-over-placement',async()=>{
  await page('scene=fish');await read("mmm.shift.route.runs[0].start={...mmm.roadScene.centre};document.getElementById('startOver').click()");const placed=await overlap(),steps=await read('qa.tick(.2)');assert.ok(placed.hits.every(v=>!v),'start-over avoids scene solids');assert.ok(steps.maxShift<.1);
 });
 for(const transition of ['reset','report','title','hidden','start-over'])await check('audio-'+transition,async()=>{
  await page('scene=fish&title=1');assert.equal(await arm(),'running');
  let hiddenTarget;
  if(transition==='reset')await read('mmm.roadScene.reset()');
  if(transition==='report')await read('mmm.shift.end();window.sceneFrame(performance.now()+20)');
  if(transition==='title')await read("[...document.querySelectorAll('#settings button')].find(b=>b.textContent==='Controls, credits and data').click();window.sceneFrame(performance.now()+20)");
  if(transition==='start-over')await read("document.getElementById('startOver').click()");
  if(transition==='hidden'){
   hiddenTarget=(await send('Target.createTarget',{url:'about:blank'})).result.targetId;await send('Target.activateTarget',{targetId:hiddenTarget});await sleep(100);
   if(!await read('document.hidden')){console.log('Using visibility event emulation: headless tabs stay visible');await read("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))");}
   await read('window.sceneFrame(performance.now()+20)');
  }
  const result=await audio();console.log('audio transition',transition,result);
  if(hiddenTarget){await send('Target.closeTarget',{targetId:hiddenTarget});await send('Target.activateTarget',{targetId:tab.id});}
  assert.ok(result.disconnected>=1,'active horn disconnected on '+transition);assert.equal(result.retained,false,'active gain cleared on '+transition);
 });
 if(process.env.REGRESSION_OLD!=='1')await check('placement-audit',async()=>{
  await page('scene=fish');const result=await read(`(()=>{const {vehicle:v,roadScene:s,interiors:i,relief:r}=mmm;qa.place(24,2.7);qa.tick(70);const before={x:v.x,z:v.z,heading:v.heading};i.register({id:'scene-audit',name:'Test',position:{x:v.x,z:v.z},radius:12,prompt:'Test',create:()=>({result:null,readout:'Test',update(){},render(){},leave(){this.result={delivered:false,note:'Test'};},dispose(){}})});i.enter('scene-audit');i.update(.5,{},v,true);i.leave();i.update(.5,{},v,true);const indoor={x:v.x,z:v.z,heading:v.heading};r.level=.95;r.request();r.update(.1,0,v,true);r.update(20,0,v,true);return {before,indoor,relief:{x:v.x,z:v.z,heading:v.heading},inside:i.busy,breaks:r.breaks};})()`);assert.deepEqual(result.before,result.indoor);assert.deepEqual(result.before,result.relief);assert.equal(result.inside,false);assert.equal(result.breaks,1);console.log('interior / relief audit',result);
 });
 assert.deepEqual(errors,[],'no browser exceptions');assert.deepEqual(failures,[],'all placement/audio regressions');console.log('PASS all placement and audio lifecycle regressions');
}finally{await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);ws.close();}
