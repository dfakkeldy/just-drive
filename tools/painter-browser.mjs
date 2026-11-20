import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {cdp,cdpFetch,sleep} from './cdp.mjs';
const [out,first]=process.argv.slice(2),port=process.env.CDP_PORT;
const tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
const c=await cdp(tab.webSocketDebuggerUrl,{deadline:180000});
const read=async expression=>{const r=await c.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r));return r.result.result.value;};
const result=[];
try {
 await c.send('Page.enable');
 for(const [device,w,h] of [['desktop',1400,950],['phone',390,844]])for(const view of ['seat','chase']) {
  await c.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:device==='phone'});
  await c.send('Page.navigate',{url:new URL(`/?day=1&at=618982.72,5109266.90,350&view=${view}&q=${device==='phone'?'low':'high'}&touch=${device==='phone'?1:0}&res=1&hud=1&exag=1.5`,first).href});
  let settled=false;for(let i=0;i<360;i++){await sleep(500);if(await read("document.title==='settled' && !!window.mmm?.roadScene")){settled=true;break;}}
  assert.ok(settled,'settled');
  await read("document.getElementById('titleStart')?.click();document.activeElement?.blur()");await sleep(1500);
  // Use the real road and production seat/chase camera. Give the narrow phone view more approach distance.
  const placement=await read(`(()=>{const s=mmm.roadScene,p={x:0,z:0,heading:0};s.road.at(${device==='phone'?(view==='chase'?-10:12):25},-1.5,p);mmm.vehicle.restart(p.x,p.z,p.heading);return p;})()`);
  await sleep(3500);
  await read('window.savedRAF=requestAnimationFrame;window.requestAnimationFrame=f=>0');await sleep(100);
  const counts=await read(`(()=>{const {renderer:r,scene,camera,roadScene:s,terrain:t}=mmm;s.setPaused(false);s.update(camera);const p=s.painter ?? {pose:{x:0,z:0,heading:0},group:{visible:false,children:[],position:{y:0}}};
   const measure=()=>{r.info.reset();r.render(scene,camera);return {calls:r.info.render.calls,triangles:r.info.render.triangles,programs:r.info.programs.length};};
   const on=measure();p.group.visible=false;const off=measure();p.group.visible=true;measure();
   const mesh=p.group.children[0];
   if(mesh && !mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
   const bounds=mesh?.geometry.boundingBox;
   const v=new camera.position.constructor(p.pose.x,p.group.position.y+1,p.pose.z).project(camera);
   return {enabled:p.enabled,fish:s.rules.enabled,visible:p.group.visible,meshes:p.group.children.length,on,off,clip:v.toArray(),pose:p.pose,height:p.group.position.y,bounds:bounds?{min:bounds.min.toArray(),max:bounds.max.toArray()}:null};})()`);
  if (!process.env.PAINTER_MAIN) { assert.equal(counts.enabled,true);assert.equal(counts.fish,false);assert.equal(counts.visible,true);assert.equal(counts.meshes,1);
  assert.ok(Math.abs(counts.clip[0])<1&&Math.abs(counts.clip[1])<1&&counts.clip[2]<1,'painter in camera');
  assert.equal(counts.on.calls-counts.off.calls,1,'painter is drawn once');
  assert.equal(counts.on.triangles-counts.off.triangles,384,'complete painter kit is drawn');
  assert.equal(counts.on.programs-counts.off.programs,0,'no program creation on repeat render');
  }
  const file=`${out}/painter-${device}-${view}.png`;writeFileSync(file,Buffer.from((await c.send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
  // A second photo hides only DOM overlays so the phone HUD cannot cover the artist.
  await read("document.body.insertAdjacentHTML('beforeend', '<style>body > :not(canvas):not(script):not(style){visibility:hidden!important}</style>')");
  writeFileSync(`${out}/painter-${device}-${view}-clean.png`,Buffer.from((await c.send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
  result.push({device,view,placement,...counts});console.log('PASS painter visible',device,view,JSON.stringify(counts));
 }
 // #1147: the slow-down hint in the real HUD. A fresh page each time: after a pedal the start hold is gone.
 if(!process.env.PAINTER_MAIN)for(const [device,w,h,scene] of [['desktop',1400,950,''],['phone',390,844,''],['phone',844,390,''],['desktop',1400,950,'&scene=0']]){
  await c.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:device==='phone'});
  await c.send('Page.navigate',{url:new URL(`/?day=1${scene}&at=618982.72,5109266.90,350&view=seat&q=${device==='phone'?'low':'high'}&touch=${device==='phone'?1:0}&res=1&hud=1&exag=1.5`,first).href});
  let settled=false;for(let i=0;i<360;i++){await sleep(500);if(await read("document.title==='settled' && !!window.mmm?.roadScene")){settled=true;break;}}
  assert.ok(settled,'settled');
  await read("document.getElementById('titleStart')?.click();document.activeElement?.blur()");await sleep(1500);
  // A tap of the pedal releases the daily start hold, as a player's first press does.
  for(const type of ['keyDown','keyUp']){await c.send('Input.dispatchKeyEvent',{type,code:'KeyW',key:'w',windowsVirtualKeyCode:87});await sleep(150);}
  // Roll towards the painter at 6 m/s (under the 8 m/s dust speed) from 60 m, and read the line the player reads.
  await read(`(()=>{const s=mmm.roadScene,v=mmm.vehicle,p={x:0,z:0,heading:0};s.road.at(-22,0,p);v.restart(p.x,p.z,p.heading);v.vx=Math.sin(p.heading)*6;v.vz=-Math.cos(p.heading)*6;})()`);
  await sleep(1000);
  const seen=await read(`(()=>{const e=document.getElementById('stopHint'),b=e.getBoundingClientRect(),v=mmm.vehicle,p=mmm.roadScene.painter.pose;
   const controls=['tcSteer','tcBrake','tcGo','tcReset','tcView','tcHorn','tcTrack','tcPull','cameraButton','mailButton','placesButton','bikeJump','gear','miniMap'].map(id=>document.getElementById(id)).filter(c=>c&&!c.hidden&&c.getClientRects().length&&getComputedStyle(c).visibility!=='hidden');
   const overlaps=controls.filter(c=>{const q=c.getBoundingClientRect();return q.width&&q.height&&q.left<b.right&&q.right>b.left&&q.top<b.bottom&&q.bottom>b.top;}).map(c=>c.id);
   return {enabled:mmm.roadScene.painter.enabled,text:e.textContent,rect:e.getClientRects().length?[b.left,b.top,b.right,b.bottom]:null,overlaps,controls:controls.map(c=>c.id),speed:v.speed,distance:Math.hypot(v.x-p.x,v.z-p.z),dust:mmm.shift.complaints.all.filter(c=>c.kind==='sceneDust').length};})()`);
  result.push({device:device+scene,w,h,hint:seen});console.log('hint',device+scene,w+'x'+h,JSON.stringify(seen));
  assert.ok(seen.speed>1&&seen.speed<8,'rolling towards the painter under the dust speed');assert.ok(seen.distance>13&&seen.distance<60,'before the dust range');assert.equal(seen.dust,0);
  if(scene){assert.equal(seen.enabled,false);assert.doesNotMatch(seen.text,/painter|dust/i,'no painter hint with scene=0');continue;}
  assert.equal(seen.enabled,true);assert.match(seen.text,/^SLOW DOWN past the painter/,'the HUD shows the painter hint on approach');
  assert.ok(seen.rect&&seen.rect[2]>seen.rect[0]&&seen.rect[3]>seen.rect[1]&&seen.rect[0]>=0&&seen.rect[2]<=w&&seen.rect[1]>=0&&seen.rect[3]<=h,'hint on screen');
  assert.deepEqual(seen.overlaps,[],'the hint covers no control');if(device==='phone')assert.ok(['tcSteer','tcBrake','tcGo'].every(id=>seen.controls.includes(id)),'touch controls measured');
  await c.send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(`${out}/painter-hint-${device}-${w}x${h}.png`,Buffer.from(r.result.data,'base64')));
  if(device==='desktop'){
   // painter-check brakes on a steady 6% descent; the real approach over the whole hint distance must be no steeper.
   const grade=await read(`(async()=>{const {PAINTER}=await import('/src/painter-rules.ts');const {along,hint}=PAINTER,s=mmm.roadScene,t=mmm.terrain,p={x:0,z:0,heading:0},at=a=>{s.road.at(a,0,p);return t.heightAt(p.x,p.z);},h=at(along),steep=[];
     for(let a=along-hint;a<along+hint;a+=20)steep.push(Math.abs(at(a+20)-at(a))/20);
     return {heights:[at(along-hint),h,at(along+hint)],fromBelow:(at(along-hint)-h)/hint,fromAbove:(at(along+hint)-h)/hint,steepest20m:Math.max(...steep)};})()`);
   result.push({grade});console.log('road grade towards the painter over the hint distance',JSON.stringify(grade));
   assert.ok(grade.heights.every(Number.isFinite)&&Number.isFinite(grade.steepest20m),'land loaded for the grade');
   assert.ok(Math.max(grade.fromAbove,grade.fromBelow)<=.06,'the approach is no steeper than the 6% descent painter-check brakes on');}
 }
 writeFileSync(`${out}/${process.env.PAINTER_MAIN ? 'main' : 'painter'}-counts.json`,JSON.stringify(result,null,2));
}finally{c.close();await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);}
