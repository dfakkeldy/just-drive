#!/usr/bin/env node
// Real-page ride, ramp, input and phone checks. Run with check-bike.sh or yard-shots.sh.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const [out,first]=process.argv.slice(2), base=new URL(first).origin, port=process.env.CDP_PORT??'9442';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[],owned=[];const family=process.env.BIKE_FAMILY??'all';
function check(ok,name){results.push({name,pass:!!ok});console.log((ok?'PASS ':'FAIL ')+name);assert.ok(ok,name);}
async function page(query,width=1600,height=1000){
 const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();const ws=new WebSocket(tab.webSocketDebuggerUrl);owned.push({id:tab.id,ws});await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let seq=0;const waiting=new Map(),errors=[];
 ws.onmessage=({data})=>{const d=JSON.parse(data);if(d.id){waiting.get(d.id)?.(d);waiting.delete(d.id)}if(d.method==='Runtime.exceptionThrown')errors.push(d.params.exceptionDetails.exception?.description??d.params.exceptionDetails.text)};
 const send=(method,params={})=>new Promise((r,j)=>{const id=++seq;const timer=setTimeout(()=>j(Error('CDP timeout '+method)),60000);waiting.set(id,d=>{clearTimeout(timer);d.error?j(Error(JSON.stringify(d.error))):r(d)});ws.send(JSON.stringify({id,method,params}))});
 const read=async expression=>{await send('Page.bringToFront');const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value};
 const settle=async()=>{for(let i=0;i<180;i++){await sleep(400);if(await read('document.title')==='settled')return;}throw Error('Not settled '+query+' '+errors.join('\n'))};
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<1000});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`try{if(!sessionStorage.bikeCheck){localStorage.clear();sessionStorage.bikeCheck='1'}}catch{};window.bikeRawFrame=requestAnimationFrame.bind(window);window.bikeFreeze=false;window.requestAnimationFrame=cb=>bikeRawFrame(function tick(t){if(bikeFreeze)bikeRawFrame(tick);else cb(t)});`});
 await send('Page.navigate',{url:base+'/?'+query});await settle();
 if(process.env.BIKE_EXPECT_MUTATION){let seen=false;for(let i=0;i<4;i++){if(JSON.stringify(await read('globalThis.__mmmMutationSources'))===JSON.stringify([process.env.BIKE_EXPECT_MUTATION])){seen=true;break;}await sleep(500);await send('Page.reload',{ignoreCache:true});await settle();}if(!seen)throw Error('The intended source mutation was not loaded');}

 const key=(code,down=true)=>send('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',code,key:code.startsWith('Key')?code.slice(3).toLowerCase():code,windowsVirtualKeyCode:code==='Space'?32:code.startsWith('Key')?code.charCodeAt(3):0});
 const tap=async c=>{await key(c);await key(c,false)};
 const start=()=>read(`new Promise(resolve=>{document.getElementById('titleStart')?.click();bikeRawFrame(()=>bikeRawFrame(()=>resolve(true)))})`);
 const shot=async name=>{if(process.env.SHOTS==='1'){await sleep(120);const r=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${name}.png`,Buffer.from(r.result.data,'base64'));}};
 return {read,send,settle,key,tap,start,shot,errors,close:async()=>{await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);ws.close();owned.splice(owned.findIndex(x=>x.id===tab.id),1)}};
}
// A ride choice must load a new page. Without one the old page stays unsettled, so name the lost reload instead of timing out.
async function reloadAfter(p,click,name){await p.read(`window.bikeOldPage=true;${click}`);let fresh=false;for(let i=0;i<75&&!fresh;i++){await sleep(200);try{fresh=await p.read('!window.bikeOldPage')}catch{}}if(!fresh)check(false,name);await p.settle();}
const isBike=`Object.getPrototypeOf(mmm.vehicle).constructor.name==='BikeRide'&&mmm.vehicle.car.root.getObjectByName('Batched trail bike')?.isSkinnedMesh&&!mmm.vehicle.car.root.getObjectByName('Static car material batch')`;
const boxes=`ids=>ids.flatMap(id=>{const e=document.getElementById(id);if(!e||e.hidden||getComputedStyle(e).display==='none'||getComputedStyle(e).visibility==='hidden')return[];const r=e.getBoundingClientRect();return r.width&&r.height?[[id,r.left,r.top,r.right,r.bottom]]:[]})`;
const sizes='320x568 320x640 360x740 375x553 375x667 390x664 390x844 402x874 412x915 414x736 430x932 440x956 568x320 667x375 740x360 781x390 812x375 844x390 874x402 932x430 956x440 768x1024 280x653 344x1000 1024x768 600x400 568x280 320x460'.split(' ').map(x=>x.split('x').map(Number));
async function ramp(p){
 await p.read(`(async()=>{const {SLIP_RAMP:r}=await import('/src/yard-site.ts');window.bikeRamp=r;const site=mmm.yard.site,a=site.world(r.u+34,r.v);mmm.vehicle.restart(a.x,a.z,site.heading(-1,0));})()`);await p.settle();
 await p.read('mmm.freeCamera()');
 const result=await p.read(`(()=>{const v=mmm.vehicle,site=mmm.yard.site,r=bikeRamp,start=site.world(r.u+34,r.v);v.restart(start.x,start.z,site.heading(-1,0));const marks=[];let deck=false,air=false,max=0,take=null;for(let i=0;i<120*16;i++){mmm.driveVehicle(1/120,{throttle:v.airborne?0:1,steer:0,handbrake:false});const loc=site.local(v.x,v.z),along=r.u-loc.u;deck ||= site.deckHeight(v.x,v.z)!==null&&v.y>(site.rampBase??0)+.3;if(v.airborne&&!air){take={speed:v.speed*3.6,along,y:v.y};air=true;}max=Math.max(max,v.y-(site.rampBase??v.y));if(i%12===0)marks.push({x:v.x,z:v.z,y:v.y,air:v.airborne,along,pitch:v.pitch});if(v.lastJump||v.crashTime)break;}return{deck,air,max,take,last:v.lastJump,crashes:v.crashes,marks}})()`);
 return result;
}
async function picture(p,name,{front=0,side=0,up=1.4,distance=5,fov=48,aim=1.05}={}){
 const geometry=await p.read(`(async()=>{window.bikeFreeze=true;const m=mmm,v=m.vehicle,c=m.camera,fx=Math.sin(v.heading),fz=-Math.cos(v.heading),rx=Math.cos(v.heading),rz=Math.sin(v.heading);c.position.set(v.x+fx*${front}*${distance}+rx*${side}*${distance},v.y+${up},v.z+fz*${front}*${distance}+rz*${side}*${distance});c.lookAt(v.x,v.y+${aim},v.z);c.fov=${fov};c.updateProjectionMatrix();c.updateMatrixWorld();for(let i=0;i<65;i++){m.terrain.update(c);m.trees?.update(m.terrain.drawnFine,c.position);m.grass?.update(0,c,v.x,v.z,v.heading);m.water?.update(c);try{m.renderer.render(v.car.root.parent,c)}finally{m.water?.settle()}m.water?.afterRender(c);if(i<64)await new Promise(r=>setTimeout(r,35));}const model=v.car,mesh=model.bikeMesh,g=mesh.geometry,idx=g.getAttribute('skinIndex'),point=c.position.clone(),rear=mesh.skeleton.bones.indexOf(model.wheels.rl),front=mesh.skeleton.bones.indexOf(model.wheels.fl);mesh.skeleton.update();let rearTrue=Infinity,rearMesh=Infinity,frontTrue=Infinity,frontMesh=Infinity;for(let i=0;i<idx.count;i++)if(idx.getX(i)===rear||idx.getX(i)===front){mesh.getVertexPosition(i,point);point.applyMatrix4(mesh.matrixWorld);const t=m.terrain.heightAt(point.x,point.z),g=m.terrain.meshHeightAt(point.x,point.z);if(idx.getX(i)===rear){if(t!==null)rearTrue=Math.min(rearTrue,point.y-t);if(g!==null)rearMesh=Math.min(rearMesh,point.y-g);}else{if(t!==null)frontTrue=Math.min(frontTrue,point.y-t);if(g!==null)frontMesh=Math.min(frontMesh,point.y-g);}}return{rearTrue,rearMesh,frontTrue,frontMesh,surface:v.surfaceName,kind:m.terrain.surfaceAt(v.x,v.z)?.kind,speed:v.speed,pitch:v.pitch,roll:v.roll,air:v.airborne,ground:m.terrain.heightAt(v.x,v.z),mesh:m.terrain.meshHeightAt(v.x,v.z),y:v.y};})()`);console.log('PICTURE',name,JSON.stringify(geometry));writeFileSync(out+'/'+name+'.json',JSON.stringify(geometry,null,2));await p.shot(name);
}
try{
 if(family==='all'||family==='ride'){
  const p=await page('mode=explore&vehicle=bike&title=1');
  check(await p.read(isBike),'explore bike shows bike and rider instead of car');
  check(await p.read(`document.querySelectorAll('#vehicleChoice button').length===3&&document.querySelector('#vehicleChoice [data-vehicle="bike"]')?.getAttribute('aria-pressed')==='true'&&/(?:Shift|⇧) [+] throttle/.test(document.querySelector('#title dl').textContent)`),'title ride choice and bike keys');
  check(await p.read(`(()=>{const card=document.getElementById('titleCard'),rect=s=>card.querySelector(s)?.getBoundingClientRect(),choice=rect('#vehicleChoice'),tag=rect('.tag'),caution=rect('#exploreCaution'),keys=rect('dl'),mp=rect('.mpControl'),start=rect('#titleStart'),clear=(a,b)=>a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1;return !!mp&&[choice,tag,caution,keys,mp,start].every(r=>r.width>0&&r.height>0)&&[tag,caution,keys,mp,start].every(r=>clear(choice,r))&&[choice,tag,caution,keys,mp].every(r=>clear(r,start))&&clear(keys,mp)&&tag.bottom<=choice.top+1&&choice.bottom<=keys.top+1&&keys.bottom<=start.top+1&&start.bottom<=caution.top+1&&caution.bottom<=mp.top+1})()`),'explore title keeps bike choice, multiplayer and Start visible without overlap, in order');
  await p.shot('10-explore-bike-title');await p.start();await p.settle();
  const before=await p.read('({x:mmm.vehicle.x,z:mmm.vehicle.z})');await p.key('KeyW');for(let i=0;i<80;i++){if(await p.read(`Math.hypot(mmm.vehicle.x-(${before.x}),mmm.vehicle.z-(${before.z}))>2&&mmm.vehicle.speed>1`))break;await sleep(100);}await p.key('KeyW',false);
  check(await p.read(`Math.hypot(mmm.vehicle.x-(${before.x}),mmm.vehicle.z-(${before.z}))>2&&mmm.vehicle.speed>1`),'W drives the bike');
  await p.key('ShiftLeft');await p.key('KeyW');for(let i=0;i<80;i++){if(await p.read('mmm.vehicle.wheelie>.2'))break;await sleep(100);}await p.key('KeyW',false);await p.key('ShiftLeft',false);check(await p.read('mmm.vehicle.wheelie>.1'),'desktop Shift plus W lifts the front wheel');
  // The last wheelie must settle first, and every sample counts: a stuck pull can lift and loop out to 0 before a final read.
  // A fresh Shift press must then lift, so a ride too slow to pull cannot pass.
  if(await p.read('!!mmm.bigMap')){for(let i=0;i<60&&await p.read('mmm.vehicle.wheelie>.02');i++)await sleep(100);const crashes=await p.read('mmm.vehicle.crashes');
   await p.key('ShiftLeft');await p.tap('KeyM');await sleep(300);const open=await p.read(`!document.getElementById('bigMap').hidden`);await p.tap('Escape');await sleep(300);
   await p.key('KeyW');let stuck=await p.read('mmm.vehicle.wheelie');for(let i=0;i<25;i++){await sleep(100);stuck=Math.max(stuck,await p.read('mmm.vehicle.wheelie'));}const fast=await p.read('mmm.vehicle.speed>3');
   await p.key('ShiftLeft',false);await sleep(100);await p.key('ShiftLeft');let fresh=false;for(let i=0;i<40&&!fresh;i++){await sleep(100);fresh=await p.read('mmm.vehicle.wheelie>.1');}await p.key('KeyW',false);await p.key('ShiftLeft',false);
   console.log('MAP PULL',JSON.stringify({open,stuck,fast,fresh}));check(open&&stuck<.02&&fast&&fresh&&await p.read(`mmm.vehicle.crashes===${crashes}`),'a Shift held through the map needs a fresh press to pull');}
  await p.read('mmm.freeCamera()');await p.read(`mmm.vehicle.place(mmm.vehicle.x,mmm.vehicle.z,mmm.vehicle.heading)`);const pose=await p.read('({x:mmm.vehicle.x,z:mmm.vehicle.z,heading:mmm.vehicle.heading})');
  check(await p.read(`(()=>{document.getElementById('gear').click();const b=document.querySelector('#settingsVehicleChoice [data-vehicle="car"]');b?.scrollIntoView({block:'nearest'});const r=b?.getBoundingClientRect();return document.getElementById('settings').classList.contains('open')&&!!r&&r.width>0&&r.height>=44&&r.top>=0&&r.bottom<=innerHeight})()`),'settings exposes the ride choice');
  await reloadAfter(p,`document.querySelector('#settingsVehicleChoice [data-vehicle="car"]').click()`,'settings switch saves reloads and keeps pose');
  check(await p.read(`localStorage.getItem('mmm.vehicle')==='car'&&new URLSearchParams(location.search).get('vehicle')==='car'&&mmm.vehicleId==='car'&&Math.hypot(mmm.vehicle.x-(${pose.x}),mmm.vehicle.z-(${pose.z}))<.01&&Math.abs(mmm.vehicle.heading-(${pose.heading}))<.001&&mmm.vehicle.speed===0`),'settings switch saves reloads and keeps pose');
  await reloadAfter(p,`document.querySelector('#vehicleChoice [data-vehicle="bike"]').click()`,'title switch saves reloads and keeps pose');
  check(await p.read(`localStorage.getItem('mmm.vehicle')==='bike'&&mmm.vehicleId==='bike'&&Math.hypot(mmm.vehicle.x-(${pose.x}),mmm.vehicle.z-(${pose.z}))<.01`),'title switch saves reloads and keeps pose');
  check(p.errors.length===0,'ride switch has no runtime errors');await p.close();
  const m=await page('mode=mail&title=1');await m.read(`localStorage.setItem('mmm.vehicle','bike')`);await m.send('Page.reload');await m.settle();
  check(await m.read(`mmm.vehicleId==='car'&&Object.getPrototypeOf(mmm.vehicle).constructor.name==='Vehicle'&&mmm.shift.stops>0&&document.querySelector('#title h1').textContent==='Mabou Mail Madness'&&!document.getElementById('vehicleChoice')&&!document.getElementById('settingsVehicleChoice')&&!document.getElementById('tcPull')`),'saved bike leaves ordinary mail on the original car and game');
  check(m.errors.length===0,'mail garage default has no runtime errors');await m.close();
  const saved=await page('mode=explore&title=1');await saved.read(`localStorage.setItem('mmm.vehicle','bike')`);await saved.send('Page.reload');await saved.settle();check(await saved.read(isBike)&&await saved.read(`mmm.vehicleId==='bike'&&!new URLSearchParams(location.search).has('vehicle')&&localStorage.getItem('mmm.vehicle')==='bike'`)&&saved.errors.length===0,'a plain explore visit restores the saved bike with no vehicle in the address');await saved.close();
  const explicit=await page('mode=mail&vehicle=bike&title=1');check(await explicit.read(isBike)&&explicit.errors.length===0,'explicit mail vehicle override uses the bike garage entry');await explicit.close();
 }
 if(family==='all'||family==='ramp'){
  const p=await page('mode=explore&vehicle=bike&at=620535,5099431,227&q=low');
  const result=await ramp(p);console.log('SLIPWAY',JSON.stringify({...result,marks:undefined}));writeFileSync(`${out}/bike-slipway.json`,JSON.stringify(result,null,2));
  check(result.deck&&result.air&&result.max>1.8,'bike climbs the real slipway and launches');
  check(result.take?.speed>=69&&result.take.speed<=76,'bike reaches the faster take-off speed from the 34 m slipway run-up');
  check(result.last?.clean&&result.last.distance>7&&result.crashes===0,'bike lands the slipway jump cleanly');
  const j=await p.read(`mmm.vehicle.lastJump`);check(j&&['airTime','peakHeight','distance','pitchRotations'].every(k=>Number.isFinite(j[k]))&&j.airTime>0&&j.peakHeight>0&&typeof j.clean==='boolean','jump telemetry is exposed in dev');
  const longJump=await p.read(`(()=>{const v=mmm.vehicle;v.place(69,1,Math.PI/2);v.lastJump=null;v.y+=50;v.vx=Math.sin(v.heading)*15;v.vz=-Math.cos(v.heading)*15;v.speed=15;for(let i=0;i<120*6&&!v.lastJump;i++){const throttle=v.airborne?Math.max(-1,Math.min(1,(v.pitchRate*3-(Math.PI*2+.15-v.pitch)*8)/7.2)):0;mmm.driveVehicle(1/120,{throttle,steer:0,handbrake:false});}return v.lastJump})()`);await p.tap('KeyF');await sleep(150);console.log('LONG JUMP',JSON.stringify(longJump),await p.read('document.getElementById("hud").textContent'));check(longJump?.airTime>1&&await p.read(`document.getElementById('hud').textContent.includes('Air ${longJump?.airTime.toFixed(1)} s · ${longJump?.distance.toFixed(0)} m · 1 backflip · clean')`),'HUD shows long jump summary');
  check(p.errors.length===0,'slipway has no runtime errors');await p.close();
 }
 if(family==='all'||family==='places'){
  const p=await page('mode=explore&vehicle=bike&road=Rankinville%20Road&f=0.5');
  await p.tap('KeyL');check(await p.read(`mmm.places.busy&&document.querySelectorAll('#placesList button').length===mmm.places.places.length`),'bike opens places list');
  await p.read(`document.querySelector('[data-place="rail-trail"]').click()`);await p.settle();
  check(await p.read(`!mmm.places.busy&&mmm.vehicle.speed===0&&Math.hypot(mmm.vehicle.vx,mmm.vehicle.vz)===0&&mmm.places.roads.nearest(mmm.vehicle.x,mmm.vehicle.z,1,r=>r.kind<=3)?.dist<.01&&document.getElementById('placeArrival').textContent.includes('Mabou Rivers Trail')`),'bike place jump rests on road and shows arrival');
  await p.tap('KeyH');check(await p.read(`mmm.animals.flash>0`),'bike horn reaches animals');
  await p.tap('KeyV');await sleep(100);check(await p.read(`mmm.camera.fov===74&&mmm.camera.position.y>mmm.terrain.heightAt(mmm.camera.position.x,mmm.camera.position.z)`),'bike eye camera stays above land');
  await p.key('KeyW');for(let i=0;i<80;i++){if(await p.read('mmm.vehicle.speed>3'))break;await sleep(100);}await p.key('KeyW',false);await p.tap('KeyR');check(await p.read(`mmm.vehicle.speed===0&&mmm.vehicle.y>=mmm.terrain.heightAt(mmm.vehicle.x,mmm.vehicle.z)-.01`),'R resets bike to road at rest');
  check(p.errors.length===0,'places animals horn and camera have no runtime errors');await p.close();
 }
 if(family==='all'||family==='phone'){
  for(const [w,h]of (process.env.BIKE_SIZES?process.env.BIKE_SIZES.split(' ').map(x=>x.split('x').map(Number)):sizes)){
   const p=await page('mode=explore&vehicle=bike&touch=1&title=1',w,h);await p.start();await sleep(100);await p.read('mmm.vehicle.lastJump={airTime:1.8,peakHeight:3,distance:21,pitchRotations:1,clean:true}');
   for(const safe of (w===320&&h===460?[false]:[false,true])){
    await p.read(`document.documentElement.style.setProperty('--test-safe-top','${safe?(w>h?0:47):0}px');document.documentElement.style.setProperty('--test-safe-bottom','${safe?(w>h?21:34):0}px');document.documentElement.style.setProperty('--test-safe-left','${safe&&w>h?44:0}px');document.documentElement.style.setProperty('--test-safe-right','${safe&&w>h?44:0}px')`);
    await sleep(40);const b=await p.read(`(${boxes})(['hud','bikeJump','gear','placesButton','miniMap','radio','placeArrival','tcTrack','tcBrake','tcGo','tcPull','tcReset','tcView','tcHorn'])`);const faults=[];
    for(let i=0;i<b.length;i++){const[a,x,y,r,bt]=b[i];if(x<-.1||y<-.1||r>w+.5||bt>h+.5)faults.push(a+' offscreen');for(let j=i+1;j<b.length;j++){const[c,xx,yy,rr,bb]=b[j];if(Math.min(r,rr)-Math.max(x,xx)>1&&Math.min(bt,bb)-Math.max(y,yy)>1)faults.push(a+' overlaps '+c)}}
    const status=await p.read(`(()=>{const jump=document.getElementById('bikeJump'),s=document.getElementById('phoneStatus'),hud=document.getElementById('hud');return {jump:!!jump&&!jump.hidden&&getComputedStyle(jump).display!=='none',clips:s.scrollHeight>s.clientHeight+1,squeezed:hud.getBoundingClientRect().height<14};})()`);
    if(status.jump){if(status.clips)faults.push('#phoneStatus clips');if(status.squeezed)faults.push('#hud squeezed');}
    check(faults.length===0,`phone ${w}x${h} safe ${safe} clear controls ${faults.join(',')}`);
    check(b.some(x=>x[0]==='tcPull'&&x[3]-x[1]>=56&&x[4]-x[2]>=56)&&!await p.read(`!!document.getElementById('drivingHelp')`),`phone ${w}x${h} PULL target and no car steering help`);
   }
   await p.read('mmm.vehicle.lastJump=null');await p.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
   const points=await p.read(`['tcGo','tcPull'].map((id,i)=>{const r=document.getElementById(id).getBoundingClientRect();return{id:i+1,x:r.x+r.width/2,y:r.y+r.height/2}})`);
   await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points});for(let i=0;i<80;i++){if(await p.read('mmm.vehicle.wheelie>.2'))break;await sleep(100);}if(w===844&&h===390)await p.shot('11-bike-phone-landscape');if(w===390&&h===844)await p.shot('12-bike-phone-portrait');await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   check(await p.read('mmm.vehicle.wheelie>.1'),'phone GO plus PULL raises front wheel');
   check(p.errors.length===0,`phone ${w}x${h} no runtime errors`);await p.close();
  }
 }
 if(family==='all'||family==='parameters'){
  for(const [query,expression]of [
   ['at=624340,5103300,90','Math.hypot(mmm.vehicle.x-69,mmm.vehicle.z-1)<.01'],
   ['road=Rankinville%20Road&f=0.5',`mmm.vehicle.roads.nearest(mmm.vehicle.x,mmm.vehicle.z,1)?.road.name==='Rankinville Road'`],
   ['cam=622951.3,5104332.1,2.2,292,-3,51&camground=1','Math.abs(mmm.camera.position.x+1319.7)<.01&&Math.abs(mmm.camera.position.z+1031.1)<.01'],
   ['shot=1','Math.abs(mmm.camera.position.x+1319.7)<.01'],
   ['demo=2','Math.abs(mmm.vehicle.speed)<.15&&Math.hypot(mmm.vehicle.x-mmm.shift.run.start.x,mmm.vehicle.z-mmm.shift.run.start.z)>1'],
   ['mp=1&room=bike&mpserver=ws://127.0.0.1:5242','!!mmm.mp?.current'],
  ]){const p=await page('mode=explore&vehicle=bike&'+query);if(query.startsWith('mp=')){await p.start();for(let i=0;i<80;i++){if(await p.read('!!mmm.mp?.current'))break;await sleep(100);}}check(await p.read(expression),'bike parameter '+query);check(p.errors.length===0,'no runtime errors '+query);await p.close();}
 }
 if(family==='all'||family==='area'){
  const p=await page('area=judique&mode=explore&vehicle=bike&title=1');
  check(await p.read(`mmm.area.id==='judique'&&mmm.yard===null&&mmm.animals===null&&${isBike}&&document.querySelector('#title h1').textContent==='Driving Judique'&&document.querySelectorAll('#vehicleChoice button').length===3`),'Judique bike has no yard or animals and keeps its garage choice');
  await p.start();const before=await p.read('({x:mmm.vehicle.x,z:mmm.vehicle.z})');await p.key('KeyW');for(let i=0;i<80;i++){if(await p.read(`Math.hypot(mmm.vehicle.x-(${before.x}),mmm.vehicle.z-(${before.z}))>2`))break;await sleep(100);}await p.key('KeyW',false);
  check(await p.read(`Math.hypot(mmm.vehicle.x-(${before.x}),mmm.vehicle.z-(${before.z}))>2&&mmm.vehicle.roadName!==null`),'bike drives on Judique land');
  await p.tap('KeyH');await p.tap('KeyR');await p.tap('KeyV');await p.tap('KeyF');check(p.errors.length===0,'Judique bike reset horn eye and fly have no runtime errors');await p.close();
 }
 if(family==='pictures'||family==='all'&&process.env.SHOTS==='1'){
  const p=await page('mode=explore&vehicle=bike&road=Smithville%20Road&f=0.5&hud=0');
  await picture(p,'01-bike-three-quarter-front',{front:1,side:-1,distance:3.2,up:1.8,fov:40});
  await picture(p,'02-bike-side',{side:-1,distance:4.6,up:1.35,fov:36});
  await p.read(`bikeFreeze=false`);await p.key('KeyW');for(let i=0;i<160;i++){if(await p.read('mmm.vehicle.speed>16'))break;await sleep(100);}await p.read('bikeFreeze=true');await p.key('KeyW',false);const comparison=await p.read('({x:mmm.vehicle.x,z:mmm.vehicle.z,heading:mmm.vehicle.heading})');await p.shot('03-bike-gravel-chase');
  await p.send('Page.navigate',{url:base+'/?mode=explore&vehicle=bike&road=Highway%2019&f=0.5&hud=0'});await p.settle();await p.read('mmm.freeCamera()');await p.read(`(()=>{const v=mmm.vehicle;v.restart(v.x,v.z,v.heading);v.vx=Math.sin(v.heading)*17;v.vz=-Math.cos(v.heading)*17;for(let i=0;i<80;i++)mmm.driveVehicle(1/120,{throttle:.3,steer:1,handbrake:false});})()`);await picture(p,'04-bike-hard-lean',{front:.3,side:1,distance:5,up:1.4});
  await p.read(`(()=>{const v=mmm.vehicle;v.place(v.x,v.z,v.heading);for(let i=0;i<210;i++)v.update(1/120,{throttle:1,steer:0,pull:true,handbrake:false});})()`);await picture(p,'05-bike-wheelie',{front:.3,side:-1,distance:5,up:1.5});
  await p.read(`(()=>{const v=mmm.vehicle;v.place(v.x,v.z,v.heading);v.y+=18;v.airborne=true;v.vy=2;v.vx=Math.sin(v.heading)*15;v.vz=-Math.cos(v.heading)*15;for(let i=0;i<180&&v.pitch<Math.PI*.95;i++)v.update(1/120,{throttle:-1,steer:0,handbrake:false});})()`);await picture(p,'07-bike-backflip',{side:-1,distance:5,up:.6,aim:-.4});
  await p.read(`mmm.vehicle.place(mmm.vehicle.x,mmm.vehicle.z,mmm.vehicle.heading);mmm.vehicle.onSolidImpact(20);for(let i=0;i<4;i++)mmm.vehicle.update(.1,{throttle:0,steer:0,handbrake:false})`);await picture(p,'08-bike-crash-tumble',{side:-1,distance:5,up:1.5});
  await p.send('Page.navigate',{url:base+'/?mode=explore&vehicle=bike&road=Smithville%20Road&f=0.5&view=seat&hud=0'});await p.settle();await p.shot('09-bike-rider-eye');await p.close();
  const r=await page('mode=explore&vehicle=bike&at=620535,5099431,227&hud=0');await ramp(r);
  await r.read(`(()=>{const v=mmm.vehicle,s=mmm.yard.site,r=bikeRamp,a=s.world(r.u+34,r.v);v.restart(a.x,a.z,s.heading(-1,0));for(let i=0;i<120*15;i++){mmm.driveVehicle(1/120,{throttle:1,steer:0,handbrake:false});if(v.airborne&&v.jump.airTime>.12)break;}})()`);await picture(r,'06-bike-slipway-air',{side:1,distance:8,up:2,fov:45});await r.close();
  const c=await page(`mode=explore&vehicle=car&at=${comparison.x+624271},${5103301-comparison.z},${comparison.heading*180/Math.PI}&hud=0`);await c.shot('13-car-gravel-chase');await c.close();
  const t=await page('mode=explore&vehicle=bike&road=Mabou%20Rivers%20Trail&f=0.5&hud=0');await picture(t,'14-bike-rail-trail',{front:.6,side:-1,distance:4,up:1.8});await t.close();
 }
 writeFileSync(`${out}/bike-browser-${family}.json`,JSON.stringify(results,null,2));
}finally{for(const t of owned){try{await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`);t.ws.close()}catch{}}}
