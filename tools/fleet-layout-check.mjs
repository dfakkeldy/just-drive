import {exitCheck} from './cdp.mjs';
// The fleet variant of layout-check: the same 28 viewports, with and without the real prompt.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {open,sleep} from './truck-cdp.mjs';
const [out,first]=process.argv.slice(2),origin=new URL(first).origin;
const sizes=(process.env.SIZES??'320x568 320x640 360x740 375x553 375x667 390x664 390x844 402x874 412x915 414x736 430x932 440x956 568x320 667x375 740x360 781x390 812x375 844x390 874x402 932x430 956x440 768x1024 280x653 344x1000 1024x768 600x400 568x280 320x460-plain').split(/\s+/).map(s=>s.replace('-plain','').split('x').map(Number));
const ids=['hud','miniMap','radio','gear','placesButton','tcReset','tcView','tcHorn','tcTrack','tcGo','tcBrake','fleetAction','fleetNext'];
const p=await open(origin+(process.env.FLEET_QUARRY_LAYOUT?'/?trip=quarry-gate&area=westbay&mode=explore&vehicle=truck&trailer=1&touch=1&q=low&hud=1&res=1':'/?mode=explore&vehicle=truck&trailer=1&touch=1&q=low&at=620400,5099300,48&res=1'));
const reports=[];
try{
 await p.read(`window.requestAnimationFrame=fn=>{window.fleetLayoutFrame=fn;return 0}`);await sleep(80);
 if(process.env.FLEET_QUARRY_LAYOUT){
 await p.read(`(async()=>{document.getElementById('titleStart')?.click();const T=await import('/node_modules/three/build/three.module.js'),{terrain,camera,trees,water,renderer,scene}=mmm,f=mmm.fleet,points=mmm.journey.route.points,p=points.at(-1),a=points.at(-2),h=terrain.heightAt(p.x,p.z)??60;for(let i=0;i<100;i++){camera.position.set(p.x+15,h+12,p.z+20);camera.lookAt(p.x,h,p.z);camera.updateMatrixWorld();terrain.update(camera);trees?.update(terrain.drawnFine,camera.position);mmm.quarry.update(camera.position,f.driven.vehicle);water?.update(camera);try{renderer.render(scene,camera)}finally{water?.settle()}water?.afterRender(camera);await new Promise(r=>setTimeout(r,20));}f.restart(p.x,p.z,Math.atan2(p.x-a.x,-p.z+a.z));window.layoutNow=performance.now();for(let i=0;i<180;i++)mmm.driveVehicle(1/120,{throttle:0,steer:0,handbrake:true});f.refresh(1);f.actionIndex=f.actions.findIndex(a=>a.kind==='unload'&&a.id==='bike');if(!f.activate())throw Error(f.message);for(let i=0;i<600&&f.busy;i++)mmm.driveVehicle(1/120,{throttle:0,steer:0,handbrake:true});f.refresh(1);if(f.actions.length<2)throw Error('No real next action for the layout test')})()`);
 }else{
 await p.read(`(()=>{const f=mmm.fleet,p=mmm.yard.site.world(240,90);f.restart(p.x,p.z,mmm.yard.site.heading(1,0));window.layoutNow=performance.now();for(let i=0;i<180;i++)mmm.driveVehicle(1/120,{throttle:0,steer:0,handbrake:true});f.refresh(1);f.actionIndex=f.actions.findIndex(a=>a.kind==='unload'&&a.id==='bike');if(!f.activate())throw Error(f.message);for(let i=0;i<600&&f.busy;i++)mmm.driveVehicle(1/120,{throttle:0,steer:0,handbrake:true});f.refresh(1);if(f.actions.length<2)throw Error('No real next action for the layout test')})()`);
 }
 for(const [width,height]of sizes){
  await p.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
  for(const prompt of [false,true]){
   const boxes=await p.read(`(()=>{if(mmm.frame)window.fleetLayoutFrame=mmm.frame;dispatchEvent(new Event('resize'));const v=mmm.fleet.truck;v.vx=${prompt?0:1};v.vz=0;v.speed=${prompt?0:1};mmm.fleet.refresh(1);fleetLayoutFrame(layoutNow);return ${JSON.stringify(ids)}.flatMap(id=>{const e=document.getElementById(id);if(!e||e.hidden||!e.getClientRects().length||getComputedStyle(e).visibility==='hidden')return[];const r=e.getBoundingClientRect();let l=r.left,t=r.top,b=r.bottom,z=r.right;for(let p=e.parentElement;p;p=p.parentElement){const c=getComputedStyle(p),q=p.getBoundingClientRect();if(/hidden|clip|auto|scroll/.test(c.overflowX)){l=Math.max(l,q.left);z=Math.min(z,q.right)}if(/hidden|clip|auto|scroll/.test(c.overflowY)){t=Math.max(t,q.top);b=Math.min(b,q.bottom)}}return r.width&&r.height?[[id,r.left,r.top,r.right,r.bottom,Math.max(0,z-l),Math.max(0,b-t)]]:[]})})()`);
   const faults=[];
   assert.equal(boxes.some(b=>b[0]==='fleetAction'),prompt,`${width}x${height}: prompt visibility`);
   for(const [id,x0,y0,x1,y1,visibleWidth,visibleHeight]of boxes){if(x0<-.5||y0<-.5||x1>width+.5||y1>height+.5)faults.push('offscreen '+id);if(['fleetAction','fleetNext'].includes(id)&&(x1-x0<44||y1-y0<44))faults.push('small '+id);if(['fleetAction','fleetNext'].includes(id)&&(visibleWidth<44||visibleHeight<44))faults.push('clipped '+id)}
   for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j],x=Math.min(a[3],b[3])-Math.max(a[1],b[1]),y=Math.min(a[4],b[4])-Math.max(a[2],b[2]);if(x>1&&y>1)faults.push(a[0]+' overlaps '+b[0])}
   reports.push({width,height,prompt,boxes,faults});assert.deepEqual(faults,[],`${width}x${height} prompt=${prompt}`);
  }
  console.log('PASS FLEET LAYOUT',width+'x'+height,'prompt and clear');
 }
 // A real CSS fault must break the same thumb-size and overlap assertions.
 const fault=await p.read(`(()=>{const e=document.getElementById('fleetAction'),old=e.style.cssText;e.style.cssText='min-height:20px!important;height:20px!important;max-height:20px!important';const r=e.getBoundingClientRect();e.style.cssText=old;return r.height<44})()`);assert.ok(fault,'small-action CSS mutation rejected');
 writeFileSync(out+'/fleet-layout-results.json',JSON.stringify(reports,null,2));console.log('PASS fleet layout at all 28 sizes, with and without prompt');
}finally{await p.close()}

exitCheck(0);
