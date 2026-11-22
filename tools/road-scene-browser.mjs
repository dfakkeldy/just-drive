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
const shot=async name=>{if(!['visitor-camera','pasture-side','shoulder-player','phone-shoulder'].includes(name))return;await read('qa.settleView()');const p=`${out}/${name}.png`;writeFileSync(p,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));console.log(p);};
const page=async(query,w=1400,h=950)=>{
 await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});
 const q=new URLSearchParams(query);if(!q.has('day'))q.set('day','8');if(!q.has('exag'))q.set('exag','1.5');
 await send('Page.navigate',{url:new URL(`/?hud=1&res=1&at=618990.1,5109215.9,350&${q}`,first).href});
 const start=Date.now();while(Date.now()-start<180000){await sleep(400);if(await read("document.title==='settled' && !!window.mmm?.roadScene"))break;}
 assert.equal(await read("document.title==='settled'"),true,'settled page '+query);
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
   let overlap=0,vehicleOverlap=0,minGap=999,maxShift=0,maxSpeed=0,maxPathError=0,cowClearance=Infinity;
   const bounds={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};
   if(s.art){const pos=s.art.cows.geometry.attributes.position;for(let i=0;i<s.art.cowOffsets[1];i++){const x=pos.getX(i)+s.centre.x,z=pos.getZ(i)+s.centre.z;bounds.minX=Math.min(bounds.minX,x);bounds.maxX=Math.max(bounds.maxX,x);bounds.minZ=Math.min(bounds.minZ,z);bounds.maxZ=Math.max(bounds.maxZ,z);}}
   for(let i=0;i<seconds*120;i++){
    const x=v.x,z=v.z;
    let input={throttle:0,steer:0,handbrake:true};
    if(drive){
     // Target the real curved shoulder 7 m ahead of the car's current projected point.
     let best=Infinity,bestAlong=0;
     for(let u=-45;u<=55;u+=.5){s.road.at(u,side,pose);const d=(pose.x-v.x)**2+(pose.z-v.z)**2;if(d<best){best=d;bestAlong=u;}}
     maxPathError=Math.max(maxPathError,Math.sqrt(best));
     s.road.at(bestAlong+7*direction,side,target);
     const wanted=Math.atan2(target.x-v.x,-(target.z-v.z));
     const err=Math.atan2(Math.sin(wanted-v.heading),Math.cos(wanted-v.heading));
     input={throttle:v.speed<4?1:0,steer:Math.max(-1,Math.min(1,err*2.5)),handbrake:false};
    }
    mmm.driveVehicle(1/120,input);
    for(const solid of s.solids)if(touchesPlayer(solid,v,-.02))overlap++;
    if(s.art)for(const off of [-1.35,0,1.35]){const x=v.x+Math.sin(v.heading)*off,z=v.z-Math.cos(v.heading)*off;const gap=Math.hypot(x-Math.max(bounds.minX,Math.min(bounds.maxX,x)),z-Math.max(bounds.minZ,Math.min(bounds.maxZ,z)))-1.25;cowClearance=Math.min(cowClearance,gap);}
    const [car,truck]=s.solids;
    if(car&&truck){if(rectOverlap(car,truck))vehicleOverlap++;} 
    if(car&&truck)minGap=Math.min(minGap,Math.hypot(car.x-truck.x,car.z-truck.z)-car.half-truck.half);
    if(!drive)maxShift=Math.max(maxShift,Math.hypot(v.x-x,v.z-z));
    maxSpeed=Math.max(maxSpeed,s.rules.speed);
   }
   s.update(c);return {...state(),overlap,vehicleOverlap,minGap,maxShift,maxSpeed,maxPathError,cowClearance};
  };
  const view=(along,side,height,lookAlong=0,lookSide=0,lookHeight=1.4)=>{
   s.road.at(along,side,pose);c.position.set(pose.x,(t.heightAt(pose.x,pose.z)??0)+height,pose.z);
   s.road.at(lookAlong,lookSide,target);c.lookAt(target.x,(t.heightAt(target.x,target.z)??0)+lookHeight,target.z);c.updateMatrixWorld();for(let i=0;i<3;i++){t.update(c);mmm.trees?.update(t.drawnFine,c.position);s.update(c);}mmm.shift.refreshUI(v);r.render(v.car.root.parent,c);
  };
  const settleView=async()=>{let quiet=0;for(let i=0;i<180;i++){t.update(c);mmm.trees?.update(t.drawnFine,c.position);mmm.grass?.update(.1,c,v.x,v.z,v.heading,v.spec);s.update(c);mmm.water?.update(c);try{r.render(v.car.root.parent,c);}finally{mmm.water?.settle();}mmm.water?.afterRender(c);quiet=t.pending===0&&!(mmm.trees?.pending??0)&&!(mmm.grass?.pending??0)?quiet+1:0;if(quiet>=5)return;await new Promise(r=>setTimeout(r,100));}throw Error('photo ground did not settle '+JSON.stringify({terrain:t.pending,trees:mmm.trees?.pending,grass:mmm.grass?.pending}));};
  window.qa={state,place,tick,view,settleView,FISH,touchesPlayer};
 })()`);
};
const keyHorn=async()=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key:'h',code:'KeyH'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'h',code:'KeyH'});};
const horn=async phone=>{
 if(phone){const p=await read(`(()=>{const r=document.getElementById('tcHorn').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:p.x,y:p.y}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 else await keyHorn();
 await read('qa.tick(.7)');
};
try{
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
 for(const phone of [false,true]){
  await send('Emulation.setTouchEmulationEnabled',{enabled:phone,maxTouchPoints:5});
  await page(`scene=fish&${phone?'q=low&touch=1':'q=high'}`,phone?390:1400,phone?844:950);
  console.log('site',await read(`({centre:mmm.roadScene.centre,grade:(()=>{const p={x:0,z:0,heading:0},s=mmm.roadScene;s.road.at(-10,0,p);const a=mmm.terrain.heightAt(p.x,p.z);s.road.at(10,0,p);return (mmm.terrain.heightAt(p.x,p.z)-a)/20/1.5;})()})`));
  // Drive from outside the 85 m trigger into it with the real controller (fixed steps, flag set by qa.place).
  // This runs first, on a fresh page, so no earlier frame has set the game's frame-local play flags.
  await read('qa.place(94,2.7,true)');
  const approach=await read(`(()=>{for(let i=0;i<4*120;i++)mmm.driveVehicle(1/120,{throttle:1,steer:0,handbrake:false});return qa.state();})()`);
  assert.equal(approach.seen,true,'drive into trigger');
  // The game's own frame loop drives into the trigger again: real W key, real frame(), which sets
  // vehicle.damageActive itself (qa.place's direct write is overwritten on the first frame).
  await read('mmm.roadScene.reset();qa.place(94,2.7,true)');
  const before=await read('qa.state()');assert.equal(before.seen,false,'outside the trigger before the frame-loop drive');
  await send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyW',key:'w',windowsVirtualKeyCode:87});
  const looped=await read(`(()=>{let t=performance.now(),damage=false,frames=0;for(;frames<6*60&&!mmm.roadScene.rules.seen;frames++){window.sceneFrame(t+=1000/60);damage||=mmm.vehicle.damageActive;}return {...qa.state(),damage,frames};})()`);
  await send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyW',key:'w',windowsVirtualKeyCode:87});
  assert.equal(looped.damage,true,'the frame loop itself marked play as live');
  assert.equal(looped.seen,true,'frame-loop drive into trigger');console.log('PASS frame-loop drive '+phone,JSON.stringify(looped));
  await read('qa.place(24,2.7,true);qa.view(35,0,2.3,0,0,1.3)');await shot(phone?'phone-approach':'approach-downhill');
  // Keep the player still beside the road while the truck reaches the car.
  const stopped=await read('qa.tick(70)');assert.equal(stopped.waiting,true);assert.equal(stopped.overlap,0);assert.equal(stopped.vehicleOverlap,0,'truck and visitor OBBs never overlap');assert.ok(stopped.minGap>=1.9);console.log('PASS stopped '+phone,stopped);
  if(!phone){
   await read('qa.view(-16,-28,11,0,-8,2)');await shot('truck-stopped');await shot('pasture-side');
   await read('qa.view(1,8,3,-7,0,1.7)');await shot('truck-close');
   await read('qa.view(-7,6,2.4,0,0,1)');await shot('visitor-car-close');
   await read('mmm.camera.fov=54;mmm.camera.updateProjectionMatrix();qa.view(8,2,1.75,5,6.8,.9);mmm.camera.lookAt(mmm.camera.position.x-20,mmm.camera.position.y-.15,mmm.camera.position.z-3);mmm.camera.updateMatrixWorld()');await read('qa.settleView()');
   const legacyInFrame=await read("(()=>{const p=mmm.animals.residents.find(a=>a.kind==='cow').rig.root.position.clone();p.y+=.8;p.project(mmm.camera);return Math.abs(p.x)<=1&&Math.abs(p.y)<=1&&p.z>=-1&&p.z<=1;})()");assert.equal(legacyInFrame,false,'guard-rail cow outside sea photo');
   await read('window.photoHidden=[...document.body.children].filter(e=>e instanceof HTMLElement&&e.tagName!=="CANVAS").map(e=>[e,e.style.visibility]);for(const[e]of photoHidden)e.style.visibility="hidden"');await shot('visitor-camera');
   await read('for(const[e,visibility]of photoHidden)e.style.visibility=visibility;mmm.camera.fov=58;mmm.camera.updateProjectionMatrix()');

  }
  const cows=await read(`(()=>{const s=mmm.roadScene,a=s.art,eye=a.visitor.position,cow=s.pasture[0],dx=cow.x-eye.x,dz=cow.z-eye.z,d=Math.hypot(dx,dz),old=mmm.animals.residents.find(a=>a.kind==='cow');return {visible:a.cows.visible,sea:cow,ground:mmm.terrain.heightAt(cow.x,cow.z),feet:s.seaFeet.map(f=>{let y=0,n=0;const p=a.cows.geometry.attributes.position;for(let i=0;i<a.cowOffsets[1];i++)if(Math.abs(s.seaBaseY[i]+.007)<1e-5&&Math.hypot(p.getX(i)+s.centre.x-f.x,p.getZ(i)+s.centre.z-f.z)<.19){y+=p.getY(i);n++;}return {...f,renderedY:n?y/n:null,samples:n};}),viewDot:(dx*-Math.sin(a.visitor.rotation.y)+dz*-Math.cos(a.visitor.rotation.y))/d,legacyDistance:Math.hypot(cow.x-old.home.x,cow.z-old.home.z),legacyHome:old.home,n:s.solids.length};})()`);
  assert.equal(cows.visible,true);assert.equal(cows.n,2);assert.ok(cows.viewDot>.99,'lens follows sea-side cow');assert.ok(cows.legacyDistance>75,'separated from guard-rail cow');for(const f of cows.feet){assert.ok(Number.isFinite(f.height),'ground exists under every hoof');assert.ok(Math.abs(f.height-f.placedY)<.05,'hoof contact within 5 cm');assert.ok(f.samples>=6&&Math.abs(f.height-f.renderedY)<.05,'rendered hoof contact within 5 cm');}console.log('PASS sea-side cow ground, lens and legacy separation',JSON.stringify(cows));
  const access=await read('(()=>{const s=mmm.roadScene,run=mmm.shift.route.forDay(8);return {count:run.stops.length,blocked:run.stops.filter(stop=>s.solids.some(solid=>qa.touchesPlayer(solid,stop.hit))).map(stop=>stop.index)};})()');assert.deepEqual(access,{count:51,blocked:[]});console.log('PASS all Mines run stop approaches',access);

  const budget=await read(`(()=>{const {roadScene:s,renderer:r,vehicle:v,camera:c}=mmm;qa.view(-10,18,15,-3,0,1);const scene=v.car.root.parent;const result={};for(const on of [false,true]){s.group.visible=on;r.info.reset();r.render(scene,c);result[on?'with':'without']={calls:r.info.render.calls,triangles:r.info.render.triangles};}result.extra={calls:result.with.calls-result.without.calls,triangles:result.with.triangles-result.without.triangles};s.group.visible=true;return result;})()`);
  assert.ok(budget.extra.calls<=5&&budget.extra.triangles<=4500&&budget.extra.calls>0);console.log('BUDGET '+(phone?'phone':'desktop'),JSON.stringify(budget));
  await read('qa.view(500,0,5,510,0,1)');assert.equal(await read('mmm.roadScene.group.visible'),false,'culled far away');
  // The player occupies the truck's path. It must brake without moving the player.
  await read('mmm.roadScene.reset();qa.place(-37,0)');
  const playerStop=await read('qa.tick(40)');assert.equal(playerStop.overlap,0,'truck never overlaps player');assert.ok(playerStop.along<-43,'truck brakes behind player');assert.ok(playerStop.maxShift<.12,'truck does not push player');console.log('PASS truck player gate',playerStop);
  // Let it reach the visitor again; then actually drive the shoulder past BOTH solids.
  await read('qa.place(24,2.7);qa.tick(65);qa.place(-28,2.7)');
  const beside=await read('qa.tick(9.2,true)');assert.ok(beside.cowClearance>=.8,'uphill cow passage margin');
  await read('qa.view(9,-12,6,5,4.5,.9)');await shot(phone?'phone-shoulder':'shoulder-player');
  const pass=await read('qa.tick(7.8,true)');assert.equal(pass.overlap,0,'driven shoulder clear');
  const progress=await read(`(()=>{const v=mmm.vehicle,c=mmm.roadScene.centre;return (v.x-c.x)*Math.sin(c.heading)-(v.z-c.z)*Math.cos(c.heading);})()`);
  console.log('shoulder trace '+phone,pass,progress);assert.ok(progress>12&&pass.maxPathError<.8&&pass.cowClearance>=.8,'player drives beyond scene on open shoulder');console.log('PASS shoulder '+phone);
  await read('qa.place(30,2.7,true)');const down=await read('qa.tick(15,true,2.7,-1)');
  assert.equal(down.overlap,0);assert.ok(down.cowClearance>=.8,'downhill cow passage margin');const downAlong=await read('(()=>{const v=mmm.vehicle,c=mmm.roadScene.centre;return (v.x-c.x)*Math.sin(c.heading)-(v.z-c.z)*Math.cos(c.heading);})()');assert.ok(downAlong<-15,'shoulder works downhill too');console.log('PASS downhill shoulder '+phone,downAlong);console.log('PASS driven cow clearance '+phone,{up:Math.min(beside.cowClearance,pass.cowClearance),down:down.cowClearance});
  // Leave and return: no unseen ending, no respawn.
  await read('qa.place(230,2.7)');const leaveBefore=await read('qa.state()');await read('qa.tick(30)');assert.deepEqual((await read('qa.state()')).along,leaveBefore.along);await read('qa.place(20,2.7);qa.tick(1)');assert.equal((await read('qa.state()')).waiting,true);
  await read('mmm.shift.end()');assert.match(await read("document.getElementById('shiftReport').textContent"),/Nobody knows how it ended/);if(!phone)await shot('report-unresolved');
  await read("document.getElementById('nextDay').click()");assert.equal((await read('qa.state()')).seen,false);assert.equal((await read('qa.state()')).along,-110);assert.equal((await read('qa.state()')).honks,0);
  // Clear early through the actual keyboard or touch button. Stay on the reserved west side.
  await read('qa.place(20,2.7);qa.tick(1)');
  await horn(phone);await horn(phone);assert.equal((await read('qa.state()')).carSide,0);await horn(phone);
  assert.equal((await read('qa.state()')).honks,3,'real horn input');
  const cleared=await read('qa.tick(10)');assert.equal(cleared.carSide,-4.8);assert.equal(cleared.overlap,0);
  await read('for(let i=0;i<1200 && mmm.roadScene.rules.truckAlong<10;i++)qa.tick(.1);qa.view(-14,-10,5,9,0,1.5)');await shot(phone?'phone-cleared':'cleared-climbing');
  const arrived=await read('qa.tick(50)');assert.equal(arrived.arrived,true);assert.equal(arrived.overlap,0);assert.equal(arrived.vehicleOverlap,0,'truck passes cleared car without overlap');console.log('PASS horn and hill '+phone,arrived);
  await read('mmm.shift.end()');assert.match(await read("document.getElementById('shiftReport').textContent"),/you cleared the road/);if(!phone)await shot('report-cleared');
 }
 if(process.env.SCENE_PICTURES_ONLY!=='1'){
 // Real bumper impact, complaint deduplication and nine actual horn presses.
 await send('Emulation.setTouchEmulationEnabled',{enabled:false});await page('scene=fish&q=high');
 await read('qa.place(16,0,true);mmm.vehicle.vx=Math.sin(mmm.vehicle.heading)*10;mmm.vehicle.vz=-Math.cos(mmm.vehicle.heading)*10;for(let i=0;i<3*120;i++)mmm.driveVehicle(1/120,{throttle:1,steer:0,handbrake:false})');
 assert.equal(await read("mmm.shift.complaints.all.filter(c=>c.kind==='sceneHit').length"),1);assert.equal(await read("mmm.shift.damage.items.some(i=>i.id==='bumper')"),true,'real collision bills bumper clips');
 await read('qa.place(20,2.7);qa.tick(1)');for(let i=0;i<12;i++)await horn(false);
 assert.equal(await read("mmm.shift.complaints.all.filter(c=>c.kind==='sceneHorn').length"),1,'one excessive-horn complaint');console.log('PASS actual car impact, bumper damage, complaint caps and excessive real H input');
 // A visitor trying to reverse to the shoulder waits for the player's car.
 await read('mmm.roadScene.reset();qa.place(0,-2.3);qa.tick(1)');for(let i=0;i<3;i++)await horn(false);
 const blockedCar=await read('qa.tick(9)');assert.equal(blockedCar.overlap,0);assert.ok(blockedCar.carSide>-.5,'visitor waits for player');assert.ok(blockedCar.maxShift<.12,'visitor cannot shove player');
 await read('qa.place(20,2.7);qa.tick(10)');assert.equal((await read('qa.state()')).carSide,-4.8);console.log('PASS visitor reverse yields to player then resumes');
 // The one nearby route mailbox remains reachable from beyond the obstruction.
 await read('mmm.roadScene.reset();qa.place(24,2.7);qa.tick(70);qa.place(45,-1.5,true);for(let i=0;i<75;i++){qa.tick(.1,true,-1.5,-1);const v=mmm.vehicle,c=mmm.roadScene.centre;if((v.x-c.x)*Math.sin(c.heading)-(v.z-c.z)*Math.cos(c.heading)<24)break;}');
 const mailbox=await read('(()=>{const v=mmm.vehicle,stop=mmm.shift.route.members.get(298).hit;return {distance:Math.hypot(v.x-stop.x,v.z-stop.z),overlap:mmm.roadScene.solids.some(s=>qa.touchesPlayer(s,v,-.02))};})()');assert.ok(mailbox.distance<4);assert.equal(mailbox.overlap,false);console.log('PASS nearby mailbox approach',mailbox);
 // Deliberately bypass the truck's player gate, observe the permanent assertion fail, then restore it.
 await read('mmm.roadScene.reset();qa.place(-37,0);window.savedSceneStep=mmm.roadScene.rules.step;mmm.roadScene.rules.step=function(dt,d,car,truck){return savedSceneStep.call(this,dt,d,car,true);}');
 const broken=await read('qa.tick(40)');assert.throws(()=>assert.equal(broken.overlap,0,'truck never overlaps player'),/truck never overlaps player/);console.log('REJECTED deliberate browser break: truck player gate',broken.overlap);
 await read('mmm.roadScene.rules.step=savedSceneStep;mmm.roadScene.reset();qa.place(-37,0)');assert.equal((await read('qa.tick(40)')).overlap,0,'restored truck gate passes');
 // Deliberately close the reserved shoulder and verify the actual driving assertion rejects it.
 await read('mmm.roadScene.reset();qa.place(24,2.7);qa.tick(70);mmm.roadScene.truck.halfWidth=3.8;qa.place(-28,2.7)');const closed=await read('qa.tick(17,true)');const closedAlong=await read('(()=>{const v=mmm.vehicle,c=mmm.roadScene.centre;return (v.x-c.x)*Math.sin(c.heading)-(v.z-c.z)*Math.cos(c.heading);})()');assert.throws(()=>assert.ok(closedAlong>12&&closed.maxPathError<.8,'player drives beyond scene on open shoulder'),/open shoulder/);await read('mmm.roadScene.truck.halfWidth=qa.FISH.truckWidth;mmm.roadScene.reset()');console.log('REJECTED deliberate browser break: shoulder closed',closedAlong,closed.maxPathError);
 // Actual touch GO input through the live main loop also starts the encounter.
 await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});await page('scene=fish&q=low&touch=1',390,844);
 const before=await read('({x:mmm.vehicle.x,z:mmm.vehicle.z})');
 const go=await read("(()=>{const r=document.getElementById('tcGo').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
 await read('window.requestAnimationFrame=window.sceneRAF;requestAnimationFrame(window.sceneFrame)');
 await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:go.x,y:go.y}]});await sleep(2300);await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 const after=await read('({x:mmm.vehicle.x,z:mmm.vehicle.z,seen:mmm.roadScene.rules.seen})');assert.ok(Math.hypot(after.x-before.x,after.z-before.z)>3);assert.equal(after.seen,true);console.log('PASS live phone GO starts scene');
 await read('window.requestAnimationFrame=f=>{window.sceneFrame=f;return 0;}');await sleep(80);
 const tones=await read('(()=>{const s=mmm.roadScene,a=s.sound;let n=0;const create=a.createOscillator.bind(a);a.createOscillator=()=>{n++;return create();};qa.place(24,2.7);qa.tick(70);return {state:a.state,n,horned:s.rules.horned};})()');assert.deepEqual(tones,{state:'running',n:2,horned:true});console.log('PASS actual synthesized truck horn',tones);
 // Actual main frame, direct fixed-step hook and both input routes respect each real card type.
 for(const kind of ['offer','ending']){
  const beforeCard=await read(`(()=>{const s=mmm.roadScene;s.setPaused(false);s.reset();qa.place(20,2.7);qa.tick(1);s.rules.truckAlong=-qa.FISH.carHalf-qa.FISH.truckHalf-qa.FISH.gap-.04;s.rules.speed=1;s.place();s.update(mmm.camera);s.horn();window.cardSilenced=0;const g=s.hornGain,disconnect=g.disconnect.bind(g);g.disconnect=()=>{cardSilenced++;disconnect();};window.cardTones=0;const a=s.sound,create=a.createOscillator.bind(a);a.createOscillator=()=>{cardTones++;return create();};if('${kind}'==='offer')mmm.endings.offer('The road','Scene pause check',['The road waits.'],[{label:'Close',action:()=>mmm.endings.close()}]);else mmm.endings.begin({key:'scene-pause-check',title:'Scene pause check',lines:['The road waits.']});return {rules:JSON.stringify(s.rules),x:mmm.vehicle.x,z:mmm.vehicle.z,visitor:s.art.visitor.position.toArray()};})()`);
  await keyHorn();await read("document.getElementById('tcHorn').click();mmm.driveVehicle(.1,{throttle:1,steer:1,handbrake:false});window.sceneFrame(performance.now()+100);mmm.roadScene.step(1,mmm.vehicle,true);mmm.roadScene.update(mmm.camera);mmm.roadScene.horn()");
  const afterCard=await read('({rules:JSON.stringify(mmm.roadScene.rules),x:mmm.vehicle.x,z:mmm.vehicle.z,visitor:mmm.roadScene.art.visitor.position.toArray()})');assert.deepEqual(afterCard,beforeCard,kind+' pauses scene, car and visitor');assert.equal(await read('cardTones'),0,kind+' no horn under card');assert.ok(await read('cardSilenced')>0,kind+' cuts active horn');
  await read('mmm.endings.close();mmm.driveVehicle(.1,{throttle:0,steer:0,handbrake:true})');assert.notEqual(await read('JSON.stringify(mmm.roadScene.rules)'),beforeCard.rules,'card close resumes');console.log('PASS real '+kind+' card pauses scene and silences horn');
 }
 // The road-edge path also works at the two ends of the hill-height setting.
 for(const exag of [1,3]){
  await page('scene=fish&q=low&touch=1&exag='+exag,390,844);await read('qa.place(24,2.7);qa.tick(70);qa.place(-28,2.7)');const pass=await read('qa.tick(17,true)');assert.equal(pass.overlap,0);assert.ok(pass.cowClearance>=.8,'cow clearance at hill height '+exag);const along=await read('(()=>{const v=mmm.vehicle,c=mmm.roadScene.centre;return (v.x-c.x)*Math.sin(c.heading)-(v.z-c.z)*Math.cos(c.heading);})()');assert.ok(along>12,'shoulder at exag '+exag);console.log('PASS shoulder hill height '+exag,along);
 }
 // The sea-side cow stands on the DRAWN ground at every hill height: rays down onto the visible land meshes
 // under every vertex of her four soles. (A check against heightAt() passed while a hoof hung 10 cm in the air.)
 for(const exag of [1,1.5,2.5]){
  await page('scene=fish&q=low&touch=1&exag='+exag,390,844);
  await read('(async()=>{const s=mmm.roadScene,t=mmm.terrain,c=mmm.camera,p=s.pasture[0];c.position.set(p.x+3,t.heightAt(p.x,p.z)+.65,p.z+3);c.lookAt(p.x,t.heightAt(p.x,p.z)+.55,p.z);c.updateMatrixWorld();for(let i=0;i<30;i++){t.update(c);s.update(c);mmm.renderer.render(mmm.vehicle.car.root.parent,c);await new Promise(r=>setTimeout(r,100));}})()');
  const soles=await read('(async()=>{const THREE=await import("/node_modules/three/build/three.module.js"),s=mmm.roadScene,t=mmm.terrain,p=s.art.cows.geometry.attributes.position,ray=new THREE.Raycaster();t.group.updateMatrixWorld(true);const meshes=[...t.tiles.values()].filter(x=>x.mesh?.visible).map(x=>x.mesh);return s.seaFeet.map(f=>{let min=Infinity,max=-Infinity,n=0;for(let i=0;i<s.art.cowOffsets[1];i++)if(Math.abs(s.seaBaseY[i]+.007)<1e-5&&Math.hypot(p.getX(i)+s.centre.x-f.x,p.getZ(i)+s.centre.z-f.z)<.19){const x=p.getX(i)+s.centre.x,z=p.getZ(i)+s.centre.z;ray.set(new THREE.Vector3(x,1000,z),new THREE.Vector3(0,-1,0));const hit=ray.intersectObjects(meshes,false)[0];if(hit){const d=p.getY(i)-hit.point.y;min=Math.min(min,d);max=Math.max(max,d);n++;}}return {n,min,max};});})()');
  for(const f of soles){assert.ok(f.n>=12,'sole vertices found');assert.ok(f.max<=.04,`hill height ${exag}: no sole of the sea-side cow floats over the drawn ground (${f.max.toFixed(3)} m)`);assert.ok(f.min>=-.2,`hill height ${exag}: no sole is buried (${f.min.toFixed(3)} m)`);}
  console.log('PASS sea-side cow on the drawn ground, hill height '+exag,JSON.stringify(soles.map(f=>[+f.min.toFixed(3),+f.max.toFixed(3)])));
 }
 for(const day of [2,5,8,11]){await page('day='+day);await read('qa.place(10);qa.tick(1)');assert.equal((await read('qa.state()')).seen,true);if(day===2)assert.equal(await read("mmm.shift.run.stops.some(s=>s.hit.road.name==='Mabou Mines Road')"),false);console.log('PASS scheduled encounter day '+day);}
 // #113 replaced the cow's local decorative rail with the continuous rule-placed
 // rails. Keep the home, real ground contact, herd and road-block/return behavior.
 await page('scene=0&day=1');
 await read(`(async()=>{
  const {cowBody}=await import('/src/cow-rest.ts');
  const {animals:a,vehicle:v,camera:c,terrain:t,roads:{guardrails:g}}=mmm,cow=a.residents.find(r=>r.kind==='cow');
  v.restart(cow.spot.x+50,cow.spot.z,cow.spot.heading);
  c.position.set(cow.home.x+8,t.heightAt(cow.home.x,cow.home.z)+5,cow.home.z+8);c.lookAt(cow.home.x,t.heightAt(cow.home.x,cow.home.z),cow.home.z);c.updateMatrixWorld();
  let quiet=0;
  for(let i=0;i<720;i++){
   t.update(c);g.update(c.position);
   quiet=t.pending===0&&g.audit.pending===0?quiet+1:0;
   if(quiet>=5)break;
   await new Promise(r=>setTimeout(r,100));
  }
  if(quiet<5)throw Error('cow home land and rule-placed rails did not settle');
  cow.buildAfter=0;a.update(0,v,c);
  window.legacyCow=()=>{
   const rig=cow.rig,p=rig.root.position;rig.root.updateMatrixWorld(true);
   let railDistance=Infinity,railSpans=0;
   if(g.group.visible)for(const chunk of g.chunks)if(chunk.mesh?.visible)for(const s of chunk.spans){
    if(s.road!==cow.spot.road)continue;
    const dx=s.b.x-s.a.x,dz=s.b.z-s.a.z,u=Math.max(0,Math.min(1,((cow.spot.x-s.a.x)*dx+(cow.spot.z-s.a.z)*dz)/(dx*dx+dz*dz)));
    const distance=Math.hypot(cow.spot.x-s.a.x-u*dx,cow.spot.z-s.a.z-u*dz);
    if(distance<5){railDistance=Math.min(railDistance,distance);railSpans++;}
   }
   const rx=Math.cos(cow.spot.heading),rz=Math.sin(cow.spot.heading);
   const body=cowBody(cow.home.x,cow.home.z,cow.homeHeading,(x,z)=>t.heightAt(x,z));
   return {state:cow.state,home:{...cow.home},homeDistance:Math.hypot(p.x-cow.home.x,p.z-cow.home.z),distance:Math.hypot(p.x-cow.spot.x,p.z-cow.spot.z),decor:!!cow.decor,herd:cow.herd.length,
    railSpans,railDistance,fieldSide:((cow.home.x-cow.spot.x)*rx+(cow.home.z-cow.spot.z)*rz)*cow.side,
    herdSameSide:cow.herd.every(h=>((h.home.x-cow.spot.x)*rx+(h.home.z-cow.spot.z)*rz)*cow.side>0),
    bodyGap:body?g.cowClearance(body):null,
    feet:rig.legs.map((leg,i)=>{const sole=rig.hoofSoles?.[i]?.clone()??p.clone().set(0,-rig.shoulder*.635,0);leg.localToWorld(sole);return {y:sole.y,ground:t.meshHeightAt(sole.x,sole.z,true)};})};
  };
 })()`);
 const supportedCow=s=>{
  assert.equal(s.decor,false,'no duplicate decorative rail after #113');assert.equal(s.herd,4,'original herd');
  assert.ok(s.railSpans>0&&s.railDistance<5,'drawn rule-placed rail beside the cow spot');
  assert.ok(s.fieldSide>0&&s.herdSameSide,'cow home rests on the uphill herd field side');
  assert.ok(s.bodyGap!==null&&s.bodyGap>=.2-1e-6,'whole cow home clear of the rail');
  assert.equal(s.feet.length,4);for(const f of s.feet)assert.ok(f.ground!==null&&Math.abs(f.y-f.ground)<.05,'cow hoof meets drawn ground within 5 cm');
 };
 const home=await read('legacyCow()');assert.equal(home.state,'home');assert.ok(home.homeDistance<.2);supportedCow(home);
 const noRail=await read('(()=>{const g=mmm.roads.guardrails;g.group.visible=false;try{return legacyCow();}finally{g.group.visible=true;}})()');
 assert.throws(()=>supportedCow(noRail),/drawn rule-placed rail/,'missing rail must fail');
 const floating=await read('(()=>{const root=mmm.animals.residents.find(r=>r.kind==="cow").rig.root;root.position.y+=1;try{return legacyCow();}finally{root.position.y-=1;root.updateMatrixWorld(true);}})()');
 assert.throws(()=>supportedCow(floating),/hoof meets drawn ground/,'floating cow must fail');
 const legacy=await read(`(()=>{const {animals:a,vehicle:v,camera:c}=mmm,cow=a.residents.find(r=>r.kind==='cow');v.restart(cow.spot.x,cow.spot.z,cow.spot.heading);for(let i=0;i<16*120;i++)a.update(1/120,v,c);return legacyCow();})()`);
 assert.equal(legacy.state,'guard');assert.ok(legacy.distance<.2);supportedCow(legacy);
 const returned=await read(`(()=>{const {animals:a,vehicle:v,camera:c}=mmm,cow=a.residents.find(r=>r.kind==='cow');v.restart(cow.spot.x+60,cow.spot.z,cow.spot.heading);for(let i=0;i<35*120;i++)a.update(1/120,v,c);return legacyCow();})()`);
 assert.equal(returned.state,'home');assert.ok(returned.homeDistance<.2);assert.deepEqual(returned.home,home.home);supportedCow(returned);
 console.log('PASS existing guard-rail cow: grounded home, road block and return; missing rail/floating cow rejected',JSON.stringify({home,legacy,returned}));
 // Day selection and forced absence; zero models/solids/report on a no-scene day.
 for(const query of ['day=1','day=16','day=8&scene=0']){
  await page(query);await read('qa.place(10);qa.tick(1)');
  assert.deepEqual(await read('({enabled:mmm.roadScene.rules.enabled,n:mmm.roadScene.solids.length,models:mmm.roadScene.group.children.length,line:mmm.roadScene.reportLine()})'),{enabled:false,n:0,models:0,line:''});
 }
 }
 assert.deepEqual(errors,[],'no browser exceptions');console.log(process.env.SCENE_PICTURES_ONLY==='1'?'PASS scene capture checks':'PASS all road scene browser checks');
}finally{await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);ws.close();}
