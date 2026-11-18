#!/usr/bin/env node
import {assert,writeFileSync,out,base,port,sleep,tab,ws,errors,send,read,shot,key,load} from './fishing-browser.mjs';
const stats=[];
const buttonsFit=async(w,h)=>{
  const buttons=await read(`(()=>[...document.querySelectorAll('#endingChoices button')].map(b=>{const r=b.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,top:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b}}))()`);
  assert.ok(buttons.length>0);for(const b of buttons)assert.ok(b.h>=56&&b.x>=24&&b.y>=20&&b.x+b.w<=w-24+.1&&b.y+b.h<=h-20+.1&&b.top,`${w}x${h}: full safe button ${JSON.stringify(b)}`);
};
async function budgets(label,departing=false){
  await read(`if(!${departing})ft.endings.close();ft.view(45,100,52,14,35,0);ft.r.info.autoReset=false;ft.r.shadowMap.autoUpdate=false`);
  for(let i=0;i<8;i++){await read('ft.draw(true)');await sleep(80)}
  const on=await read('ft.draw(true)');await sleep(80);const off=await read('ft.draw(false)');await read('ft.f.group.visible=true;ft.r.info.autoReset=true');
  const row={mode:label,phase:departing?'departure':'quay',on,off,extraCalls:on.calls-off.calls,extraTriangles:on.triangles-off.triangles,geometry:await read('ft.f.triangles')};stats.push(row);console.log('BUDGET',JSON.stringify(row));
  assert.ok(row.extraCalls>0&&row.extraCalls<= (label==='phone'?4:8),'R13 draw budget');assert.ok(row.extraTriangles>0&&row.extraTriangles<=(label==='phone'?12500:25000),'R13 triangle budget');
  if(label==='desktop')assert.equal(await read('mmm.water.reflected.has(ft.f.group)'),true,'R13 existing mirror includes site');
}
async function wakeBreak(label){
  await read('ft.f.art.wakeMaterial.forceSinglePass=false');
  await assert.rejects(()=>budgets(label,true),/R13 draw budget/,'REJECTED R13 double-pass wake '+label);stats.pop();
  await read('ft.f.art.wakeMaterial.forceSinglePass=true');
}
async function budgetBreak(label){
  await read('window.extraFishingBatch=ft.f.art.fixed.clone();ft.f.group.add(window.extraFishingBatch);void 0');
  await assert.rejects(()=>budgets(label),/R13 draw budget/,'REJECTED R13 extra draw batch '+label);stats.pop();
  await read('ft.f.group.remove(window.extraFishingBatch);delete window.extraFishingBatch');
  // More triangles in the same four batches must fail independently of the draw-call limit.
  await read(`(async()=>{const THREE=await import('/node_modules/three/build/three.module.js');const m=ft.f.art.fixed;window.savedFishingGeometry=m.geometry;const g=m.geometry.clone(),n=g.getAttribute('position').count,indices=new Uint32Array(n*4);for(let i=0;i<indices.length;i++)indices[i]=i%n;g.setIndex(new THREE.BufferAttribute(indices,1));m.geometry=g})()`);
  await assert.rejects(()=>budgets(label),/R13 triangle budget/,'REJECTED R13 excess triangles '+label);stats.pop();
  await read('ft.f.art.fixed.geometry.dispose();ft.f.art.fixed.geometry=window.savedFishingGeometry;delete window.savedFishingGeometry');
}
try {
  await send('Runtime.enable');await send('Page.enable');
  await load('&fishingCheck=1');
  await read(`localStorage.removeItem('mmm.endings');ft.clean();ft.view(-3,-50,12,7,25,2)`);await shot('wharf-road');
  await read('ft.view(-1,-8,ft.s.entrance(-8)+1.5,14,6,ft.s.level)');await shot('gravel-approach');
  const route=await read('ft.route()');console.log('ROUTE',JSON.stringify({...route,trace:undefined}));writeFileSync(`${out}/road-drive.json`,JSON.stringify(route,null,2));
  assert.ok(route.offer && route.air===0 && Math.abs(route.y-(await read('ft.s.top')))<.01,'R9 real road 922 to deck, no launch, stopped offer');
  await read('ft.view(30,24,8,10,46,2.5);ft.clean(false)');await shot('offer-desktop');
  const before=await read('({x:ft.c.x,z:ft.c.z,time:ft.shift.elapsed})');await read('for(let i=0;i<120;i++)ft.frame()');
  assert.deepEqual(await read('({x:ft.c.x,z:ft.c.z,time:ft.shift.elapsed})'),before,'R10 offer pauses actual car and clock');
  // The pause assertion must notice if the modal no longer gates the real main frame.
  await read(`Object.defineProperty(ft.endings,'busy',{configurable:true,get:()=>false});ft.frame()`);
  assert.notDeepEqual(await read('({x:ft.c.x,z:ft.c.z,time:ft.shift.elapsed})'),before,'REJECTED R10 disabled busy pause');
  await read('delete ft.endings.busy');
  await key('Tab','Tab',9);assert.equal(await read('document.activeElement.textContent'),'Keep the route');await key('Space',' ',32);
  assert.equal(await read('ft.endings.busy'),false,'R11 keyboard decline');const elapsed=await read('ft.shift.elapsed');
  // Declining closes the ending through clearEndingInput -> pause.resume(), and the frame after a resume is zero-length by
  // design (PauseGate.resetDt; main.ts: 'the zero-length first frame after a pause'). The clock must move by the second frame.
  await read('ft.frame();ft.frame()');
  assert.ok(await read(`ft.shift.elapsed>${elapsed}`),'R10 clock resumes');
  await read('ft.place(7,46);ft.stop(480)');assert.equal(await read('ft.endings.busy'),false,'R2 decline has no second offer');
  await read(`ft.shift.end();document.getElementById('nextDay').click();ft.place(7,46);ft.stop(240)`);assert.equal(await read('ft.endings.busy'),true,'R2 actual new shift offers again');
  await read('ft.endings.close();ft.clean();ft.view(45,115,45,8,38,1)');await shot('wharf-above');
  await read('ft.view(48,97,7,11,34,2)');await shot('wharf-water');
  await read('ft.view(29,61,5.8,16,47,1.4)');await shot('boat-close');
  await read('ft.view(7,38,5.5,7,48.9,3.85)');await shot('board-skipper');
  const pass=await read('ft.pass()');assert.ok(pass.speed>4 && !pass.offer,'R6 actual fast pass has no offer');console.log('FAST PASS',pass);
  for(const [name,u,v,h] of [['end',7,15,Math.PI],['east',7,35,Math.PI/2],['west',7,35,-Math.PI/2]]){
    const g=await read(`ft.guard(${u},${v},${h})`);console.log('GUARD',name,g);assert.ok(g.minU>=4.29&&g.maxU<=9.71&&g.maxV<=61.71&&g.minY>=2.56,'R9 solid guard '+name);
  }
await read('window.savedSolids=ft.f.solids;ft.f.solids=[]');const broken=await read('ft.guard(7,35,Math.PI/2,300)');
  assert.throws(()=>assert.ok(broken.maxU<=9.71),'REJECTED R9 removed solid guard');await read('ft.f.solids=window.savedSolids');
  // Removing the exact deck must make the unmodified wheel-height assertion fail at its water-side edge.
  await read('window.savedDeck=ft.s.deckHeight;ft.s.deckHeight=()=>null;ft.place(10,52);ft.stop(2)');
  const under=await read('ft.c.y');assert.throws(()=>assert.ok(Math.abs(under-2.6)<.02),'REJECTED R9 removed runtime deck');await read('ft.s.deckHeight=window.savedDeck');
  await read('ft.place(28,83);ft.stop(360)');assert.ok(await read(`Math.hypot(ft.c.x-ft.s.x-28,ft.c.z-ft.s.z-83)>20 && ft.c.y>0`),'R9 sea automatically returns to road');
  await read('ft.place(28,83)');await key('KeyR','r',82);assert.ok(await read('ft.c.y>0'),'R9 R returns immediately');
  await budgets('desktop');await budgetBreak('desktop');
  await read('ft.fixture();ft.view(28,15,15,9,48,1.4)');await key('Enter','Enter',13);await read('ft.endingAt(4)');await budgets('desktop',true);await wakeBreak('desktop');
  // Far-away updates neither animate nor submit this site's meshes.
  const farProbe=`(()=>{ft.c.place(0,0,0);ft.camera.position.set(0,100,0);ft.camera.lookAt(0,0,-100);ft.camera.updateMatrixWorld();let draws=0;for(const a of ft.f.group.children)a.onBeforeRender=()=>draws++;const old=ft.f.updates;for(let i=0;i<30;i++)ft.f.update(.1,ft.camera.position);ft.r.render(ft.f.group.parent,ft.camera);return {visible:ft.f.group.visible,updates:ft.f.updates-old,draws}})()`;
  assert.deepEqual(await read(farProbe),{visible:false,updates:0,draws:0},'R13 nothing drawn/animated far away');
  await read('window.savedFarUpdate=ft.f.update;ft.f.update=function(dt,cam){window.savedFarUpdate.call(this,dt,cam);this.group.visible=true;this.pose(0);this.updates++};for(const a of ft.f.group.children)a.frustumCulled=false');
  const brokenFar=await read(farProbe);assert.throws(()=>assert.deepEqual(brokenFar,{visible:false,updates:0,draws:0}),'REJECTED R13 bypassed far cull');
  await read('ft.f.update=window.savedFarUpdate;for(const a of ft.f.group.children)a.frustumCulled=true');
  // Phone cards, actual touch blocking, Enter/Space/Tab and complete reset.
  await load('&fishingCheck=1&q=low&touch=1');await budgets('phone');await budgetBreak('phone');await read('ft.fixture();ft.view(30,24,8,10,46,2.5)');
  for(const [w,h] of [[390,844],[844,390],[320,568],[568,280]]){
    await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:true});
    await read(`for(const e of ['top','bottom'])document.documentElement.style.setProperty('--test-safe-'+e,'20px');for(const e of ['left','right'])document.documentElement.style.setProperty('--test-safe-'+e,'24px');document.getElementById('settings').classList.add('open')`);
    await buttonsFit(w,h);
    const frozen=await read('({x:ft.c.x,z:ft.c.z,time:ft.shift.elapsed})');await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:5,y:h-5,id:1}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await read('ft.frame()');
    assert.deepEqual(await read('({x:ft.c.x,z:ft.c.z,time:ft.shift.elapsed})'),frozen,'R11 touch cannot drive through offer');
    await read(`document.getElementById('settings').classList.remove('open');ft.clean()`);await shot(`offer-phone-${w}x${h}`);
  }
  await send('Emulation.clearDeviceMetricsOverride');await read(`for(const e of ['top','bottom','left','right'])document.documentElement.style.removeProperty('--test-safe-'+e);document.querySelector('#endingChoices button').focus();ft.shift.career={...ft.shift.career,day:6,pay:1234,warnings:2};localStorage.setItem('mmm.shift.v1',JSON.stringify(ft.shift.career));window.savedCareer=localStorage.getItem('mmm.shift.v1');ft.view(28,15,15,9,48,1.4)`);
  await key('Enter','Enter',13);
  assert.ok(await read(`ft.endings.finished && !ft.shift.ended && !ft.c.car.beacon.visible && !ft.c.car.signLight.visible && !ft.c.car.driverWindow.visible && ft.f.art.crew.count===2 && ft.f.art.lines.geometry===ft.f.art.wake`),'R12 accepted: empty parked car, window down, lights off, two aboard, cast off');
  assert.equal(await read('localStorage.getItem("mmm.shift.v1")===window.savedCareer'),true,'R12 no daily pay awarded');assert.deepEqual(await read('JSON.parse(localStorage.getItem("mmm.endings"))'),['deckhand']);
  await read('ft.endingAt(4)');await budgets('phone',true);await wakeBreak('phone');
  const boat=await read('ft.f.art.boat.position.toArray()');await read('ft.endingAt(4)');await shot('ending-start');
  assert.deepEqual(await read('[ft.c.x-ft.s.x,ft.c.z-ft.s.z,ft.c.speed]'),[7,43,0],'R12 car stays parked');
  assert.ok(await read(`ft.f.art.boat.position.z>47+2`),'R12 boat leaves berth');
  await read('ft.endingAt(105)');await shot('ending-middle');
  const duration=await read('ft.f.departureDuration()');await read(`ft.endingAt(${duration})`);await shot('ending-end');await shot('ending-card');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await read('ft.frame()');await shot('ending-phone');await send('Emulation.clearDeviceMetricsOverride');await read('ft.frame()');
  assert.ok(await read('ft.camera.position.y<8 && ft.f.art.boat.position.x < -1800 && Math.abs(ft.f.art.boat.position.y+.2)<.06'),'R12 low stern camera and boat beyond mouth at water level');
  for(const [w,h] of [[390,844],[844,390],[320,568],[568,280]]){await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:true});await read(`for(const e of ['top','bottom'])document.documentElement.style.setProperty('--test-safe-'+e,'20px');for(const e of ['left','right'])document.documentElement.style.setProperty('--test-safe-'+e,'24px')`);await buttonsFit(w,h);}
  await send('Emulation.clearDeviceMetricsOverride');await read(`for(const e of ['top','bottom','left','right'])document.documentElement.style.removeProperty('--test-safe-'+e)`);
  const clipped=()=>read(`(()=>{const m=ft.f.art.boat.material,p=m.clippingPlanes?.[0],program=ft.r.properties.get(m).currentProgram;return ft.r.localClippingEnabled && !!p && Math.abs(p.constant-.2)<.00001 && !!program?.getUniforms().map.clippingPlanes})()`);
  assert.ok(await clipped(),'R14 LOW waterline clip is active in the compiled boat shader');
  await read('window.savedPlanes=ft.f.art.boat.material.clippingPlanes;ft.f.art.boat.material.clippingPlanes=null;ft.f.art.boat.material.needsUpdate=true;ft.frame()');
  assert.equal(await clipped(),false,'REJECTED R14 disabled LOW sea clipping');
  await read('ft.f.art.boat.material.clippingPlanes=window.savedPlanes;ft.f.art.boat.material.needsUpdate=true;ft.frame()');assert.ok(await clipped(),'R14 restored LOW clip');
  await key('Space',' ',32);
  const restored=()=>read(`!ft.endings.busy && !ft.endings.root.contains(document.activeElement) && ft.shift.career.day===1 && ft.shift.career.pay===0 && ft.shift.career.warnings===0 && !ft.shift.ended && ft.c.car.beacon.visible && ft.c.car.signLight.visible && ft.c.car.driverWindow.visible && !document.body.classList.contains('hasEnding') && !document.getElementById('settings').inert && !ft.f.judge.offered && ft.f.art.lines.geometry===ft.f.art.mooring && ft.f.art.lines.visible && Math.abs(ft.f.art.boat.position.x-16.1)<.001`);
  assert.ok(await restored(),'R12 Start over restores all site and UI state');
  // A missing site reset must be detectable by the same complete-restart assertion.
  await read('ft.fixture()');await key('Enter','Enter',13);await read('window.savedReset=ft.f.reset;ft.f.reset=()=>{}');await key('Space',' ',32);
  assert.equal(await restored(),false,'REJECTED R12 disabled fishing reset');
  await read('ft.f.reset=window.savedReset;ft.shift.startOver()');assert.ok(await restored(),'R12 restored reset passes again');
  await read('ft.place(7,30);window.beforeInput={x:ft.c.x,z:ft.c.z};ft.now=Math.max(ft.now,performance.now())');await send('Input.dispatchKeyEvent',{type:'keyDown',code:'ArrowUp',key:'ArrowUp',windowsVirtualKeyCode:38});await read('for(let i=0;i<60;i++)ft.frame()');await send('Input.dispatchKeyEvent',{type:'keyUp',code:'ArrowUp',key:'ArrowUp',windowsVirtualKeyCode:38});const input=await read(`({speed:ft.c.speed,moved:Math.hypot(ft.c.x-window.beforeInput.x,ft.c.z-window.beforeInput.z),busy:ft.endings.busy,finished:ft.endings.finished,focus:document.activeElement?.id,hud:document.getElementById('hud').textContent})`);assert.ok(input.speed>1 && input.moved>.5,'R11 input works after restart '+JSON.stringify(input));
  await read(`localStorage.setItem('mmm.endings',JSON.stringify(['deckhand','float-driver']));[...document.querySelectorAll('#settings button')].find(b=>b.textContent==='Controls, credits and data').click()`);assert.equal(await read('document.getElementById("waysOut").textContent'),'Ways out found: 2');await read('ft.clean()');await shot('title-two-ways');
  // Exclusions are tested at the real main-caller gate, even with an otherwise valid stopped car.
  for(const [name,query,fly] of [['dev placement','',false],['demo','&fishingCheck=1&demo=1',false],['fly','&fishingCheck=1',true]]){
    await load(query);if(fly)await key('KeyF','f',70);await read('ft.place(7,46);ft.stop(480)');assert.equal(await read('ft.endings.busy'),false,'R3 '+name+' excluded');
  }
  await load('');await read('window.savedStep=ft.f.step;ft.f.step=function(dt,_eligible,p){window.savedStep.call(this,dt,true,p)};ft.place(7,46);ft.stop(240)');assert.equal(await read('ft.endings.busy'),true,'REJECTED R3 bypassed caller exclusion');await read('ft.f.step=window.savedStep;ft.endings.close()');
  assert.equal(errors.length,0,errors.join('\n'));writeFileSync(`${out}/render-counts.json`,JSON.stringify(stats,null,2));
  console.log('PASS fishing: real road/deck/guards/sea/R, stop/fast/repeat/new shift, pause, exclusions, departure/storage/reset/title, four phone sizes, keyboard/touch, far cull and budgets.');
  console.log('REJECTED browser mutations: missing guard, missing deck, disabled busy pause, disabled site reset, bypassed eligibility, extra batches and excess triangles in both modes, bypassed far cull, double-pass wake in both modes, LOW sea clip disabled. All restored.');
} finally {await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);ws.close();}
