#!/usr/bin/env node
import { cdp, cdpFetch } from './cdp.mjs';
// RUN=phone-help-browser.mjs VIEWS="help|x=1" tools/yard-shots.sh 900 900
// Real CDP touch events on production controls; no pointer-event substitutes.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const [out,first]=process.argv.slice(2),base=new URL(first).origin,port=process.env.CDP_PORT;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
const errors=[];
const { ws, send } = await cdp(tab.webSocketDebuggerUrl, { onEvent: m => {if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);} });
const read=async expression=>{const m=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!m.error&&!m.result.exceptionDetails,JSON.stringify(m));return m.result.result.value;};
const touch=async(type,touchPoints)=>{const m=await send('Input.dispatchTouchEvent',{type,touchPoints});assert.ok(!m.error,JSON.stringify(m));};
async function load(query){await send('Page.navigate',{url:`${base}/?x=1&q=low&hud=1&radio=0${query}`});let ready=false;for(let i=0;i<160;i++){await sleep(250);if(await read(`document.title.startsWith('settled')`)){ready=true;break;}}assert.ok(ready,'terrain settled');}
const shot=async name=>writeFileSync(`${out}/${name}.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
try{
 await send('Runtime.enable');await send('Page.enable');
 await send('Emulation.setTouchEmulationEnabled',{enabled:false});
 await load('');assert.equal(await read(`document.getElementById('drivingHelp')===null`),true,'no desktop switch');
 await read(`localStorage.setItem('mmm.help','light')`);await load('');assert.equal(await read(`document.getElementById('drivingHelp')===null && !mmm.vehicle.strongHelp`),true,'saved phone help does not change desktop');
 await read(`localStorage.removeItem('mmm.help')`);
 for(const [width,height]of [[390,844],[844,390]]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await load('&touch=1');
  assert.equal(await read(`mmm.vehicle.strongHelp`),true,'Strong default / saved Strong');
  await read(`document.getElementById('settings').classList.add('open');document.querySelector('[data-help=light]').click()`);
  assert.equal(await read(`!mmm.vehicle.strongHelp && localStorage.getItem('mmm.help')==='light'`),true,'Light changes immediately and saves');
  await load('&touch=1');assert.equal(await read(`!mmm.vehicle.strongHelp && document.querySelector('[data-help=light]').getAttribute('aria-pressed')==='true'`),true,'Light survives a visit');
  await read(`document.querySelector('[data-help=strong]').click()`);
  assert.equal(await read(`mmm.vehicle.strongHelp && localStorage.getItem('mmm.help')==='strong'`),true,'Strong changes immediately');
  // A controlled fixed-step probe uses the production car in exactly the same pose.
  const probe=await read(`(async()=>{
    const {DrivingHelp}=await import('/src/driving-help.ts'),v=mmm.vehicle,roads=v.roads,help=new DrivingHelp(roads);
    const hit=roads.nearest(v.x,v.z,1000,r=>r.kind<=3);if(!hit)return null;
    let p=null;
    for(const road of roads.roads){if(road.kind>3)continue;for(let i=1;i<road.pts.length-1;i++){
      const [x,z]=road.pts[i],s=mmm.terrain.surfaceAt(x,z);
      if(s&&s.kind>0&&s.kind<=3&&!s.washboard&&help.clear(x,z)>.99&&Math.hypot(x-v.x,z-v.z)<500){p={x,z,heading:Math.atan2(road.pts[i+1][0]-x,z-road.pts[i+1][1])};break;}
    }if(p)break;}
    if(!p)return null;
    const trial=key=>{document.querySelector('[data-help='+key+']').click();v.place(p.x,p.z,p.heading+.12);v.steerAngle=0;v.acc=0;v.speed=15;v.vx=Math.sin(v.heading)*15;v.vz=-Math.cos(v.heading)*15;v.update(1/60,{throttle:1,steer:.08,handbrake:false,touch:true});return v.helpYaw;};
    const light=trial('light'),strong=trial('strong');v.place(hit.x,hit.z,hit.heading);return {light,strong};
  })()`);
  assert.ok(probe&&probe.light===0&&Math.abs(probe.strong)>.1,`switch changes actual yaw immediately ${JSON.stringify(probe)}`);
  // Capture the actual drive input arriving at Vehicle, so a 1 px pad move must
  // really produce zero; a pure thumbSteer unit test alone cannot prove wiring.
  await read(`(async()=>{const {Vehicle}=await import('/src/vehicle.ts');window.helpOriginal=Vehicle.prototype.update;Vehicle.prototype.update=function(dt,input,after){window.helpInput={...input};return helpOriginal.call(this,dt,input,after);};document.getElementById('settings').classList.remove('open');})()`);
  const point=await read(`(()=>{const r=document.getElementById('tcTrack').getBoundingClientRect();return {id:1,x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await touch('touchStart',[point]);await touch('touchMove',[{...point,x:point.x+1}]);await sleep(150);
  assert.equal(await read('helpInput.steer'),0,'real 1px touch move is exactly zero');
  await touch('touchMove',[{...point,x:point.x+18}]);await sleep(150);assert.ok(await read('helpInput.steer')>.05,'outside dead zone really steers');
  await touch('touchMove',[{...point,x:point.x-1}]);await sleep(150);assert.equal(Math.abs(await read('helpInput.steer')),0,'return through centre is exactly zero');
  await touch('touchEnd',[]);await sleep(100);assert.equal(Math.abs(await read('helpInput.steer')),0,'release centres input');
  await read(`(async()=>{const {Vehicle}=await import('/src/vehicle.ts');Vehicle.prototype.update=helpOriginal;document.getElementById('settings').classList.add('open');document.getElementById('drivingHelp').scrollIntoView({block:'center'});})()`);await sleep(150);
  const boxes=await read(`[...document.querySelectorAll('[data-help]')].map(b=>{const r=b.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b};})`);
  assert.ok(boxes.every(b=>b.top>=0&&b.bottom<=height&&b.left>=0&&b.right<=width&&b.hit),'switch is on-screen and pressable');
  await shot(`settings-${width}x${height}`);console.log(`PASS ${width}x${height}: default, persistence, immediate yaw ${JSON.stringify(probe)}, real touch dead zone, settings picture`);
 }
 assert.deepEqual(errors,[],'no browser exceptions');
}finally{await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);ws.close();}
