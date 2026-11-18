// Real-page round-2 regressions. Node tests supply the reviewed-head failures; this checks live UI wiring.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {open,sleep} from './truck-cdp.mjs';
import {exitCheck} from './cdp.mjs';
const [out,first]=process.argv.slice(2),origin=new URL(first).origin,results=[];
async function key(p,code){await p.send('Input.dispatchKeyEvent',{type:'keyDown',code,key:code==='KeyE'?'e':code==='KeyQ'?'q':'w'});await p.send('Input.dispatchKeyEvent',{type:'keyUp',code,key:code==='KeyE'?'e':code==='KeyQ'?'q':'w'});}
async function waitFor(p,condition,message,advance=false){const end=Date.now()+10000;do{if(await p.read((advance?'r2.tick(1);':'')+condition))return;await sleep(25)}while(Date.now()<end);assert.fail(message);}
async function touch(p,id,hold=false){const r=await p.read(`(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()`);assert.ok(r.w>=44&&r.h>=44,id+' is a thumb target');await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x,y:r.y,id:1}]});if(!hold){await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(40);}}
for(const phone of [false,true]){
 const flags=phone?'&touch=1&q=low':'&q=high';
 // Empty follows main, including geometry and stationary steering, in both detail modes.
 const empty=await open(origin+'/?mode=explore&vehicle=truck&trailer=empty&at=620400,5099300,48&hud=1&radio=0&mp=0'+flags);
 try{await empty.send('Emulation.setDeviceMetricsOverride',{width:phone?844:1400,height:phone?390:950,deviceScaleFactor:1,mobile:phone});
  const value=await empty.read(`(()=>{window.requestAnimationFrame=()=>0;let triangles=0;mmm.vehicle.car.root.traverseVisible(n=>{if(n.isMesh)triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3});mmm.vehicle.acc=0;mmm.vehicle.vx=mmm.vehicle.vz=mmm.vehicle.speed=mmm.vehicle.steerAngle=0;mmm.driveVehicle(1/60,{throttle:0,steer:1,handbrake:false});return{fleet:!!mmm.fleet,triangles,steer:mmm.vehicle.steerAngle,prompt:!!document.getElementById('fleetPrompt')}})()`);
  assert.equal(value.fleet,false);assert.equal(value.prompt,false);assert.equal(value.triangles,59566);assert.ok(value.steer>0,"stationary empty-trailer steering is not swallowed");results.push({phone,empty:value});
 }finally{await empty.close()}
 const p=await open(origin+'/?mode=explore&vehicle=truck&trailer=1&at=620400,5099300,48&exag=1&hud=1&radio=0&mp=0&res=1'+flags);
 try{
  await p.send('Emulation.setDeviceMetricsOverride',{width:phone?844:1400,height:phone?390:950,deviceScaleFactor:1,mobile:phone});
  if(phone)await p.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
  await p.read(`(()=>{window.requestAnimationFrame=fn=>{window.r2Frame=fn;return 0};window.r2={f:mmm.fleet,now:performance.now(),blockSelect:null,blockRefit:false,queries:0};const t=r2,f=t.f;if(!f||f.busy)throw Error('initial fleet spawn is not ready: '+f?.message);t.tick=(n=1)=>{for(let i=0;i<n;i++)window.r2Frame?.(t.now=Math.max(t.now+1000/60,performance.now()+1000/60))};t.step=()=>{mmm.driveVehicle(1/120,{throttle:0,steer:0,handbrake:true});f.refresh(1/120)};t.finish=()=>{for(let i=0;i<5000&&f.busy;i++)t.step();if(f.busy)throw Error('sequence stuck '+f.message)};t.want=(kind,id)=>{f.refreshChoices();const i=f.actions.findIndex(a=>a.kind===kind&&a.id===id);if(i<0)throw Error('missing '+kind+'/'+id+': '+f.message);f.actionIndex=i;t.tick()};t.use=(kind,id)=>{t.want(kind,id);if(!f.activate())throw Error(f.message);t.finish()};t.reset=()=>{const p=mmm.yard.site.world(240,90);f.restart(p.x,p.z,mmm.yard.site.heading(1,0));if(f.busy)throw Error('reset failed '+f.message);f.refreshChoices();t.tick()};t.poses=()=>{for(const m of f.members)m.rig.root.updateWorldMatrix(true,true);return JSON.stringify({driver:f.driven.id,gates:f.gates,angles:f.gateAngles,members:f.members.map(m=>({id:m.id,state:m.state,p:[m.vehicle.x,m.vehicle.y,m.vehicle.z,m.vehicle.heading,m.vehicle.pitch,m.vehicle.roll],matrix:m.rig.root.matrixWorld.elements})),ramps:f.tow.trailer.ramps.map(r=>r.rotation.x)})};f.contacts.add({resolve(){},allows(b){t.queries++;return !t.blockRefit&&(!t.blockSelect||Math.hypot(b.x-t.blockSelect.x,b.z-t.blockSelect.z)>2)}});t.tick();})()`);
  assert.match(await p.read('document.getElementById("hud").textContent'),/Handbrake on/);
  if(phone){
   await waitFor(p,`(()=>{const e=document.getElementById('tcGo'),r=e.getBoundingClientRect();return !e.hidden&&r.width>=44&&r.height>=44&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e})()`,'GO control is ready',true);
   await touch(p,'tcGo',true);
   try{await waitFor(p,`document.getElementById('tcGo').classList.contains('held')`,'GO pointer handler received the touch');await waitFor(p,'r2.f.handbrake===false','first GO releases the displayed initial brake',true)}
   finally{await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}
  }else{
   await p.send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyW',key:'w'});
   try{await waitFor(p,'r2.f.handbrake===false','first GO releases the displayed initial brake',true)}
   finally{await p.send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyW',key:'w'})}
  }
  assert.equal(await p.read('r2.f.handbrake'),false,'first GO releases the displayed initial brake');
  assert.doesNotMatch(await p.read('document.getElementById("hud").textContent'),/Handbrake on/);
  // Cache DRIVE, then introduce a solid, without giving the UI another frame first.
  await p.read(`r2.reset();r2.use('unload','bike');r2.want('drive','bike');r2.before=r2.poses();r2.attempts=r2.f.teleportAttempts;const b=r2.f.members.find(m=>m.id==='bike').vehicle;r2.blockSelect={x:b.x,z:b.z};r2.last=null;const a=r2.f.activate.bind(r2.f);r2.f.activate=()=>r2.last=a()`);
  if(phone)await touch(p,'fleetAction');else await key(p,'KeyE');
  assert.equal(await p.read('r2.last'),false);assert.equal(await p.read('r2.poses()'),await p.read('r2.before'));assert.equal(await p.read('r2.f.teleportAttempts'),await p.read('r2.attempts'));
  assert.match(await p.read('r2.f.message'),/block|reach/i);results.push({phone,selectionRefused:true});
  // A synthetic support rise exercises automatic settling, not the placement path.
  const refit=await p.read(`(()=>{const t=r2,f=t.f;t.blockSelect=null;f.contacts.invalidate();t.reset();t.use('unload','bike');t.ground=f.ground;t.before=t.poses();t.blockRefit=true;t.queries=0;f.promptTime=100;f.ground=(x,z)=>t.ground(x,z)+.15;f.gatesDirty=true;f.refresh(0,false);const bike=f.members.find(m=>m.id==='bike');f.ground=(x,z)=>t.ground(x,z)+.30;bike.dirty=true;f.refresh(0,false);const unchanged=t.poses()===t.before,queries=t.queries,needs=bike.needsSettling;f.promptTime=100;f.refresh(0,false);f.refresh(0,false);const sleeping=t.queries===queries;t.blockRefit=false;f.ground=t.ground;f.contacts.invalidate();f.refresh(0,false);return{unchanged,queries,needs,sleeping,recovered:!bike.needsSettling}})()`);
  assert.ok(refit.unchanged&&refit.queries>0&&refit.needs&&refit.sleeping&&refit.recovered,JSON.stringify(refit));results.push({phone,syntheticSupportRefit:refit});
  // The arrow and a normal shown-list frame both discard a now-distant bike.
  await p.read(`r2.reset();r2.use('unload','bike');r2.use('unload','sxs');r2.want('drive','sxs');r2.bike=r2.f.members.find(m=>m.id==='bike');r2.oldX=r2.bike.vehicle.x;r2.bike.vehicle.x+=100`);
  if(phone)await touch(p,'fleetNext');else await key(p,'KeyQ');
  assert.equal(await p.read(`r2.f.actions.some(a=>a.kind==='drive'&&a.id==='bike')`),false);
  await p.read(`r2.bike.vehicle.x=r2.oldX;r2.f.refreshChoices();r2.tick();r2.bike.vehicle.x+=100;r2.tick()`);
  assert.equal(await p.read(`r2.f.actions.some(a=>a.kind==='drive'&&a.id==='bike')`),false);
  assert.doesNotMatch(await p.read('document.getElementById("fleetAction").textContent'),/Dirt bike/);
  assert.deepEqual(p.errors,[]);results.push({phone,choicesFresh:true});console.log('PASS fleet round-2 real UI',phone?'phone':'desktop');
 }finally{await p.close()}
}
writeFileSync(out+'/fleet-round2-browser-results.json',JSON.stringify(results,null,2)+'\n');exitCheck(0);
