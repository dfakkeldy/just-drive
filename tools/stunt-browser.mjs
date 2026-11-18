#!/usr/bin/env node
// WEB_PORT=5278 CDP_PORT=9478 RUN=stunt-browser.mjs VIEWS='park|park=test' tools/yard-shots.sh 1400 950
// Final piece views and board close-ups come from stunt-board-shots.mjs.
// Contact acceptance reads VISIBLE triangles and each tyre's own tread vertices after driving and stopping.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {open,sleep} from './truck-cdp.mjs';
import {tyreContacts} from './tyre-contacts.mjs';
import {stuntStage} from './stunt-browser-stage.mjs';
import {traversalGood} from './stunt-pass-check.mjs';
import {keepStuntPicture} from './stunt-picture-files.mjs';
const [out,first]=process.argv.slice(2),origin=new URL(first).origin;
const suffix=process.env.STUNT_SHOT_SUFFIX??'',quality=process.env.STUNT_LOW?'low':'desktop';
const reportFile=`${out}/${process.env.STUNT_REPORT_NAME??(process.env.STUNT_CONTACTS_ONLY?(process.env.STUNT_LOW?'stunt-contacts-low':'stunt-contacts'):process.env.STUNT_FEATURES_ONLY?'stunt-features':'stunt-browser')}${suffix}.json`;
const stats={};const lineRuns={};const shoulderDiagnostics=[];
const p=await open(`${origin}/?park=test&mode=explore&exag=1.5&scene=0&hud=1&radio=0`),reports=[],failures=[];
const check=(ok,label,data)=>{console.log(ok?'PASS':'FAIL',label,ok?'':JSON.stringify(data,(k,v)=>k==='samples'?v?.slice(0,1):v));if(!ok)failures.push({label,data});};
async function setup(){await p.send('Page.bringToFront');assert.equal(await p.read('document.hidden'),false,'one visible owned test tab');await p.read(stuntStage(tyreContacts));}
const contactsGood=(r,expected=4)=>r.contacts.length===expected&&r.contacts.every(w=>w.ray&&w.count>0&&w.misses===0&&Number.isFinite(w.penetration)&&w.penetration<=.04&&Number.isFinite(w.float)&&w.float<=.04&&w.shoulders.length===2&&w.shoulders.every(Number.isFinite));
async function pitFeet(label){await p.read("st.focus(st.park.dressing.find(p=>p.placement.piece.id==='pit-area'))");const feet=await p.read('st.pitFeet()'),good=rows=>rows.length===16&&rows.every(r=>r.ray&&Number.isFinite(r.gap)&&Math.abs(r.gap)<.03);check(good(feet),label+': every stand sole meets visible land',feet);const shifted=await p.read("(()=>{const p=st.park.dressing.find(p=>p.placement.piece.id==='pit-area');p.group.position.y+=.12;try{return st.pitFeet();}finally{p.group.position.y-=.12;p.group.updateMatrixWorld(true);}})()");check(!good(shifted),label+': a raised stand fails the ground-ray check',shifted);lineRuns[label]=feet;}
try{
 for(const vehicle of (process.env.STUNT_FEATURES_ONLY?[]:(process.env.STUNT_VEHICLES??'car,truck,sxs').split(',')))for(const exag of (process.env.STUNT_EXAG??'1.5,1,2,2.5').split(',').map(Number)){
   await p.navigate(`${origin}/?park=test&mode=explore&vehicle=${vehicle}&q=${process.env.STUNT_LOW?'low':'full'}&exag=${exag}&scene=0&hud=1&radio=0`);await setup();
   const count=await p.read('st.park.pieces.length');
   for(let i=0;i<count;i++){
     const info=await p.read(`(()=>{const p=st.park.pieces[${i}];return{id:p.placement.piece.id,decks:p.placement.piece.decks.length};})()`);
     if(process.env.STUNT_ONLY&&!process.env.STUNT_ONLY.split(',').includes(info.id))continue;
     await p.read(`st.focus(st.park.pieces[${i}])`);
     const ready=await p.read(`st.park.pieces[${i}].ready`);check(ready,`${vehicle} Hill ${exag} ${info.id} seats on land`);

     if((info.decks||['whoops','rollers'].includes(info.id))&&!(vehicle==='truck'&&info.id==='footbridge')){
       const speed=['whoops','rollers'].includes(info.id)?45:info.id.startsWith('gap-')?(vehicle==='truck'?75:70):info.id==='slip-small'?100:info.id==='slip-medium'?(vehicle==='truck'?55:50):info.id==='slip-large'?55:info.id.startsWith('drop-')?70:8;
       const pass=await p.read(`st.traverse(st.park.pieces[${i}],false,${speed})`);check(traversalGood(pass),`${vehicle} Hill ${exag} ${info.id}: complete motion past the far end, zero impacts`,pass);
       const result=await p.read(`st.stopOn(st.park.pieces[${i}])`);
       check(ready&&result.steps<3600&&Math.abs(result.speed)<.05&&contactsGood(result,vehicle==='truck'?6:4)&&(!info.decks||info.id==='tunnel'||result.contacts.every(w=>w.inYard)),`${vehicle} Hill ${exag} ${info.id}: drive up, stop, tread rays`,result);
       reports.push({quality,vehicle,exag,piece:info.id,pass,result});
       if(vehicle==='truck'&&info.id==='tabletop'){
         const descent=await p.read(`(()=>{const piece=st.park.pieces[${i}];st.place(piece,-7);let steps=0;for(;steps<7200&&piece.u(st.v.x,st.v.z)<17;steps++)st.step(Math.max(-1,Math.min(1,(2.2-st.v.speed)*2)));for(let n=0;n<600;n++)st.step(st.v.speed>.02?-1:0,0,true);return{u:piece.u(st.v.x,st.v.z),steps,speed:st.v.speed,contacts:st.contacts()};})()`);
         check(descent.u>=17&&descent.steps<7200&&Math.abs(descent.speed)<.05&&contactsGood(descent,6),`${vehicle} Hill ${exag}: driven stop on tabletop descent`,descent);
         reports.push({quality,vehicle,exag,piece:'tabletop-descent',result:descent});
         if(process.env.STUNT_CAPTURE){
           await p.read(`(async()=>{const piece=st.park.pieces[${i}],u=piece.u(st.v.x,st.v.z),eye=piece.world(u-10,-7.5);st.camera.fov=45;st.camera.updateProjectionMatrix();await st.view(new st.THREE.Vector3(eye.x,st.v.y+3,eye.z),new st.THREE.Vector3(st.v.x,st.v.y+.7,st.v.z));})()`);
           await p.shot(out+'/tabletop-descent.png');
           keepStuntPicture(out+'/tabletop-descent.png',{vehicle,exag,quality,piece:'tabletop-descent',result:descent});
         }
       }
       const feet=await p.read(`st.feet(st.park.pieces[${i}])`);
       check(feet.every(f=>f.ray&&Number.isFinite(f.gap)&&Math.abs(f.gap)<.03),`${vehicle} Hill ${exag} ${info.id}: visible support feet meet drawn land`,feet);
       if(exag===1.5&&vehicle==='truck'&&info.id==='tabletop'){
         const noDuals=await p.read('(()=>{const c=st.v.car,extra=c.extraWheels;c.extraWheels=[];try{return{contacts:st.contacts()};}finally{c.extraWheels=extra;}})()');check(!contactsGood(noDuals,6),'missing dual tyres fail six-contact predicate',noDuals);
       }
       if(exag===1.5&&vehicle==='car'&&info.id==='tabletop'){
         const mutant=await p.read('(()=>{st.v.car.root.position.y+=.2;const r={contacts:st.contacts()};st.v.car.root.position.y-=.2;return r;})()');check(!contactsGood(mutant),'floating tyre mutation fails',mutant);
         const hidden=await p.read('(()=>{st.park.group.visible=false;const r={contacts:st.contacts()};st.park.group.visible=true;return r;})()');check(!contactsGood(hidden),'hidden deck mutation fails',hidden);
         const absentRay=await p.read('(()=>{const old=st.THREE.Raycaster.prototype.intersectObjects;try{st.THREE.Raycaster.prototype.intersectObjects=()=>[];return{contacts:st.contacts()};}finally{st.THREE.Raycaster.prototype.intersectObjects=old;}})()');check(!contactsGood(absentRay),'missing ground rays fail finite-contact predicate',absentRay);
         const hiddenTyre=await p.read('(()=>{const w=st.v.car.wheels.rl;w.visible=false;try{return{contacts:st.contacts()};}finally{w.visible=true;}})()');check(!contactsGood(hiddenTyre),'hidden tyre fails visible-tread predicate',hiddenTyre);
       }
       if(exag===1.5&&vehicle==='car'&&info.id==='slip-small'){
         const short=await p.read(`(()=>{const piece=st.park.pieces[${i}],mesh=piece.group.children.find(n=>n.name.endsWith(' structure')),pos=mesh.geometry.getAttribute('position'),colour=mesh.geometry.getAttribute('color'),saved=pos.array.slice(),feet=piece.solids.filter(s=>s.underDeck&&s.half===.11);try{for(let j=0;j<pos.count;j++){for(const s of feet)if(Math.abs(pos.getX(j)-piece.u(s.x,s.z))<.12&&Math.abs(pos.getZ(j)-piece.v(s.x,s.z))<.12&&Math.abs(pos.getY(j)-s.bottom)<.001){pos.setY(j,pos.getY(j)+.12);break;}}return st.feet(piece);}finally{pos.array.set(saved);pos.needsUpdate=true;}})()`);
         check(!short.every(f=>f.ray&&Number.isFinite(f.gap)&&Math.abs(f.gap)<.03),'shortened support mutation fails drawn-ground predicate',short);
       }
     }
     if(info.id==='tunnel'){
       const crossing=await p.read('st.crown()');
       check(traversalGood(crossing)&&crossing.lift>4&&Math.abs(crossing.photo.v)<1&&contactsGood(crossing,vehicle==='truck'?6:4),`${vehicle} Hill ${exag} tunnel: complete upper crossing, zero impacts, crown tread rays`,crossing);
       reports.push({quality,vehicle,exag,piece:'tunnel-crown',result:crossing});
     }
     if(info.id==='footbridge'){
       const under=await p.read('st.underBridge()');
       check(traversalGood(under)&&under.below>3&&contactsGood(under,vehicle==='truck'?6:4),`${vehicle} Hill ${exag} footbridge: complete lower crossing, zero impacts, tread rays`,under);
       reports.push({quality,vehicle,exag,piece:'footbridge-under',result:under});
     }

   }
   if(exag===1.5&&vehicle==='truck'&&!process.env.STUNT_LOW){
     const index=await p.read("st.park.pieces.findIndex(p=>p.placement.piece.id==='tabletop')");await p.read(`st.focus(st.park.pieces[${index}],20)`);await p.read(`st.stopOn(st.park.pieces[${index}])`);await p.read(`st.focus(st.park.pieces[${index}],20)`);await p.shot(`${out}/truck-tabletop${suffix}.png`);
   }
   const programs=await p.read(`(()=>{const r=mmm.renderer,gl=r.getContext();return r.info.programs.map(p=>({runnable:!p.diagnostics||p.diagnostics.runnable,park:(gl.getShaderSource(p.fragmentShader)??'').includes('#define STUNT_PARK')}));})()`);check(programs.length>0&&programs.every(p=>p.runnable)&&programs.some(p=>p.park),`${vehicle} Hill ${exag}: named park shaders compile in the actual game`,programs);
 }
 if(!process.env.STUNT_CONTACTS_ONLY){
 await p.navigate(`${origin}/?park=test&mode=explore&exag=1.5&scene=0&hud=1&radio=0`);await setup();
 await p.read(`(async()=>{for(const piece of st.park.pieces)await st.focus(piece);})()`);
 // Pictures settle terrain, trees and the mirror after each camera jump.
 await p.read(`(async()=>{st.camera.fov=140;st.camera.updateProjectionMatrix();const b=st.park.box,x=(b[0]+b[2])/2,z=(b[1]+b[3])/2,y=st.terrain.meshHeightAt(x,z)??80;await st.view(new st.THREE.Vector3(x,y+60,z+10),new st.THREE.Vector3(x,y,z),120);})()`);await p.shot(`${out}/park-overview${suffix}.png`);
 await p.read('st.camera.fov=55;st.camera.updateProjectionMatrix()');
 stats.desktop=await p.read('({triangles:st.park.triangles,drawCalls:st.park.drawCalls,ready:st.park.pieces.filter(p=>p.ready).length})');
 check(stats.desktop.ready===14,'desktop has built every piece before line tests',stats.desktop);
 lineRuns.easy=await p.read(`(()=>{const first=st.park.pieces[0];st.place(first,-7);st.v.vx=Math.sin(st.v.heading)*12.5;st.v.vz=-Math.cos(st.v.heading)*12.5;st.v.speed=12.5;const impacts=st.park.contacts;let min=Infinity,max=0,across=0,i=0;for(;i<7200&&first.u(st.v.x,st.v.z)<220;i++){st.step(Math.max(-1,Math.min(1,(12.5-st.v.speed)*2)));min=Math.min(min,st.v.speed*3.6);max=Math.max(max,st.v.speed*3.6);across=Math.max(across,Math.abs(first.v(st.v.x,st.v.z)));}return{reached:first.u(st.v.x,st.v.z)>=220,min,max,across,seconds:i/120,solidImpacts:st.park.contacts-impacts,events:st.park.events};})()`);
 check(lineRuns.easy.reached&&lineRuns.easy.solidImpacts===0&&lineRuns.easy.min>=40&&lineRuns.easy.max<=50&&lineRuns.easy.across<2,'easy line: production car, 45 km/h target with landing losses',lineRuns.easy);
 lineRuns.hard=await p.read('st.hardLine()');
 check(lineRuns.hard.completed&&lineRuns.hard.contacts===0&&['gap-tanks','drop-1.6'].every(id=>lineRuns.hard.events.some(e=>e.piece===id&&e.obstacleCleared&&Object.values(e.landing).every(Boolean))),'complete hard line: tank gap and 1.6 m drop, without a placement between pieces',lineRuns.hard);
 const cleanHud=await p.read(`(()=>{if(typeof window.stoppedFrame!=='function')throw Error('actual frame callback missing');const before=st.frameSnapshot();window.stoppedFrame(performance.now());const h=document.getElementById('hud'),c=getComputedStyle(h);return{text:h.textContent,visible:c.display!=='none'&&c.visibility!=='hidden'&&h.getBoundingClientRect().height>0,before,after:st.frameSnapshot()};})()`);lineRuns.cleanHud=cleanHud;check(cleanHud.visible&&cleanHud.text.includes('CLEAN'),'clean verdict reaches the visible real HUD',cleanHud);
 check(Math.hypot(cleanHud.after.camera[0]-cleanHud.after.vehicle[0],cleanHud.after.camera[2]-cleanHud.after.vehicle[2])<100,'Places jump keeps the production chase camera near the rig on a real frame',cleanHud);
 lineRuns.readyHudFrames=await p.read(`(async()=>{const frames=[];for(let i=0;i<3;i++){await new Promise(r=>setTimeout(r,20));window.stoppedFrame(performance.now());frames.push({text:document.getElementById('hud').textContent,state:st.frameSnapshot()});}return frames;})()`);check(lineRuns.readyHudFrames.every(r=>r.text.includes('CLEAN')&&!r.text.includes('loading ground')&&r.state.drawnLevel===8),'ready park real frames keep the verdict without a loading flash',lineRuns.readyHudFrames);
 const failedHud=await p.read(`(()=>{const piece=st.park.pieces.find(p=>p.placement.piece.id==='gap-tanks');st.place(piece,-7);st.v.vx=Math.sin(st.v.heading)*100/3.6;st.v.vz=-Math.cos(st.v.heading)*100/3.6;st.v.speed=100/3.6;for(let i=0;i<6000&&!st.park.lastLine;i++)st.step(Math.max(-1,Math.min(1,(100/3.6-st.v.speed)*2)));window.stoppedFrame(performance.now());const h=document.getElementById('hud'),c=getComputedStyle(h);return{line:st.park.lastLine,text:h.textContent,visible:c.display!=='none'&&c.visibility!=='hidden'&&h.getBoundingClientRect().height>0};})()`);check(failedHud.visible&&failedHud.line.includes('FAILED')&&failedHud.text.includes('FAILED'),'failed jump reaches the visible real HUD',failedHud);

 for(const [id,kph]of [['gap-tanks',70],['drop-1.6',70]]){
   await p.read(`st.focus(st.park.pieces.find(p=>p.placement.piece.id==='${id}'))`);
   lineRuns[id]=await p.read(`st.drive(st.park.pieces.find(p=>p.placement.piece.id==='${id}'),${kph})`);
   check(lineRuns[id].events.some(e=>e.piece===id&&e.obstacleCleared&&Object.values(e.landing).every(Boolean)),`hard line ${id}: measured production flight and landing`,lineRuns[id]);
 }
 await p.read("st.focus(st.park.pieces.find(p=>p.placement.piece.id==='footbridge'))");const bridge=await p.read('st.underBridge()');
 check(traversalGood(bridge)&&bridge.below>3&&contactsGood(bridge),'bridge: drive underneath the same span tested above',bridge);

 for(const [file,id]of [['line-easy','tabletop'],['line-hard','gap-tanks'],['tunnel-through','tunnel']]){
   await p.read(`st.focus(st.park.pieces.find(p=>p.placement.piece.id==='${id}'))`);if(file==='line-easy'||file==='line-hard')await p.read(`(async()=>{const piece=st.park.pieces.find(p=>p.placement.piece.id==='${file==='line-easy'?'slip-small':'gap-tanks'}'),eye=piece.world(-25,-16),target=piece.world(${file==='line-easy'?110:85},0);await st.view(new st.THREE.Vector3(eye.x,piece.seat(0,0)+36,eye.z),new st.THREE.Vector3(target.x,piece.seat(0,0),target.z));})()`);if(file==='tunnel-through')await p.read(`(async()=>{const piece=st.park.pieces.find(p=>p.placement.piece.id==='tunnel');st.stopOn(piece);const a=piece.world(-22,1.5);await st.view(new st.THREE.Vector3(a.x,st.v.y+2.2,a.z),new st.THREE.Vector3(st.v.x,st.v.y+.8,st.v.z));})()`);await p.shot(`${out}/${file}${suffix}.png`);
 }
 lineRuns.tabletopCar=await p.read(`(()=>{const piece=st.park.pieces.find(p=>p.placement.piece.id==='tabletop');st.place(piece,-7);let air=false,steps=0;for(;steps<4800&&piece.u(st.v.x,st.v.z)<30;steps++){st.step(Math.max(-1,Math.min(1,(8/3.6-st.v.speed)*2)));air||=st.v.airborne;}return{u:piece.u(st.v.x,st.v.z),air,steps,events:st.park.events};})()`);check(lineRuns.tabletopCar.u>=30&&!lineRuns.tabletopCar.air&&!lineRuns.tabletopCar.events.some(e=>e.piece==='tabletop'),'car rolls the complete practice tabletop at 8 km/h without a jump claim',lineRuns.tabletopCar);
 const cross=await p.read('st.crown()');await p.shot(`${out}/tunnel-over${suffix}.png`);check(traversalGood(cross)&&cross.lift>4&&Math.abs(cross.photo.v)<1&&contactsGood(cross),'tunnel over: drive onto crown and stop',cross);

 await p.read(`(async()=>{const p=st.park.pieces.find(p=>p.placement.piece.id==='gap-tanks');await st.focus(p,25);st.place(p,-7);st.v.vx=Math.sin(st.v.heading)*23;st.v.vz=-Math.cos(st.v.heading)*23;st.v.speed=23;for(let i=0;i<2500;i++){st.step(st.v.speed<23?1:0);if(st.v.airborne&&p.u(st.v.x,st.v.z)>24)break;}const a=p.world(22,18);await st.view(new st.THREE.Vector3(a.x,st.v.y+1,a.z),new st.THREE.Vector3(st.v.x,st.v.y,st.v.z));})()`);await p.shot(`${out}/car-air-tanks${suffix}.png`);
 await p.navigate(`${origin}/?park=test&mode=explore&vehicle=truck&exag=1.5&scene=0&hud=1&radio=0`);await setup();await p.read(`(async()=>{for(const piece of st.park.pieces)await st.focus(piece);})()`);
 await p.read("st.focus(st.park.pieces.find(p=>p.placement.piece.id==='gap-tanks'))");lineRuns.hardTruck=await p.read(`st.hardLine(74,60)`);check(lineRuns.hardTruck.completed&&lineRuns.hardTruck.contacts===0&&['gap-tanks','drop-1.6'].every(id=>lineRuns.hardTruck.events.some(e=>e.piece===id&&e.obstacleCleared&&Object.values(e.landing).every(Boolean))),'pickup completes the printed rolling handoff and the next drop',lineRuns.hardTruck);
 await p.read(`st.stopOn(st.park.pieces.find(p=>p.placement.piece.id==='tabletop'))`);await p.read(`st.focus(st.park.pieces.find(p=>p.placement.piece.id==='tabletop'),20)`);await p.shot(`${out}/truck-tabletop${suffix}.png`);
 lineRuns.tabletopTruck=await p.read(`(()=>{const piece=st.park.pieces.find(p=>p.placement.piece.id==='tabletop');st.place(piece,-7);let air=false,steps=0;for(;steps<4800&&piece.u(st.v.x,st.v.z)<30;steps++){st.step(Math.max(-1,Math.min(1,(8/3.6-st.v.speed)*2)));air||=st.v.airborne;}return{u:piece.u(st.v.x,st.v.z),air,steps,events:st.park.events};})()`);check(lineRuns.tabletopTruck.u>=30&&!lineRuns.tabletopTruck.air&&!lineRuns.tabletopTruck.events.some(e=>e.piece==='tabletop'),'truck rolls the complete practice tabletop at 8 km/h without a jump claim',lineRuns.tabletopTruck);
 const truckCrown=await p.read('st.crown()');check(traversalGood(truckCrown)&&truckCrown.lift>4&&Math.abs(truckCrown.photo.v)<1&&contactsGood(truckCrown,6),'truck drives over the culvert crown with all six tyres on drawn cover',truckCrown);await p.shot(`${out}/truck-tunnel-over${suffix}.png`);
 await p.read("st.focus(st.park.pieces.find(p=>p.placement.piece.id==='footbridge'))");const truckUnder=await p.read('st.underBridge()');check(traversalGood(truckUnder)&&truckUnder.below>3&&contactsGood(truckUnder,6),'truck drives under the footbridge span',truckUnder);
 await pitFeet('pit-desktop');
 await p.navigate(`${origin}/?park=test&mode=explore&vehicle=car&q=low&exag=1.5&scene=0&hud=1&radio=0`);await setup();
 await p.read(`(async()=>{for(const piece of st.park.pieces)await st.focus(piece);})()`);
 stats.low=await p.read('({triangles:st.park.triangles,drawCalls:st.park.drawCalls,ready:st.park.pieces.filter(p=>p.ready).length})');
 check(stats.low.ready===14&&stats.low.triangles<=30000&&stats.desktop.triangles<=90000&&stats.low.triangles<stats.desktop.triangles,'LOW builds every piece with fewer triangles',stats);
 for(const [name,ids]of [['park-overview',null],['line-easy',['slip-small','tabletop','tunnel','whoops']],['line-hard',['gap-tanks','tanks','drop-1.6']]]){await p.read(`st.plan(${JSON.stringify(ids)})`);await p.shot(`${out}/${name}${name==='park-overview'?'':'-low'}${suffix}.png`);}
 await pitFeet('pit-low');
 await p.send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true});await p.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
 await p.navigate(`${origin}/?park=test&mode=explore&vehicle=car&touch=1&q=low&exag=1.5&scene=0&radio=0`);
 const touch=await p.read(`(()=>{const p=mmm.stuntPark.pieces[0],a=p.world(-15,0);mmm.places.jumpTo(a.x,a.z,p.placement.heading);const b=document.getElementById('tcGo').getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2,start:[a.x,a.z]};})()`);
 await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touch.x,y:touch.y,id:1}]});for(let i=0;i<70;i++){await sleep(500);if(await p.read('mmm.stuntPark.pieces[0].u(mmm.vehicle.x,mmm.vehicle.z)>220'))break;}await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 const phone=await p.read('({x:mmm.vehicle.x,z:mmm.vehicle.z,speed:mmm.vehicle.speed,along:mmm.stuntPark.pieces[0].u(mmm.vehicle.x,mmm.vehicle.z)})');check(phone.along>220,'actual phone GO travels the complete easy line',phone);await setup();await p.read(`(async()=>{const piece=st.park.pieces.find(p=>p.placement.piece.id==='tabletop');await st.focus(piece);st.stopOn(piece);window.stoppedFrame?.(performance.now());const eye=piece.world(-6,-13);await st.view(new st.THREE.Vector3(eye.x,st.v.y+8,eye.z),new st.THREE.Vector3(st.v.x,st.v.y+.5,st.v.z));})()`);await p.shot(`${out}/park-phone${suffix}.png`);
 await p.navigate(`${origin}/?exag=1.5&scene=0&hud=1&radio=0`);check(await p.read('!(\'stuntPark\' in mmm)&&!(\'sunShadows\' in mmm)&&!mmm.terrain.sites.some(s=>s.constructor.name===\'StuntPark\')'),'no parameter: no park constructed, registered or exposed');
 }
 check(await p.read('mmm.renderer.info.programs.every(p=>!p.diagnostics||p.diagnostics.runnable)'),'all real game shader programs compile');
 writeFileSync(reportFile,JSON.stringify({reports,failures,stats,lineRuns,shoulderDiagnostics},null,2)+'\n');assert.equal(failures.length,0,failures.map(f=>f.label).join('; '));
}finally{writeFileSync(reportFile,JSON.stringify({reports,failures,stats,lineRuns,shoulderDiagnostics},null,2)+'\n');await p.close();await sleep(2500);}
