#!/usr/bin/env node
import { cdp, cdpFetch } from './cdp.mjs';
// WEB_PORT=5216 CDP_PORT=9416 OUT=data/work/damage RUN=damage-browser.mjs VIEWS='damage|x=1' tools/yard-shots.sh 1280 900
import assert from 'node:assert/strict';
import { damageTiming } from './damage-timing-browser.mjs';
import { assertGlassDown, assertGlassUp, assertMailCar } from './mail-car-body.mjs';
import { writeFileSync } from 'node:fs';
const [out, first] = process.argv.slice(2), port=process.env.CDP_PORT;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
const errors=[];
const { ws, send } = await cdp(tab.webSocketDebuggerUrl, { deadline: 180000, onEvent: d => {if(d.method==='Runtime.exceptionThrown')errors.push(d.params.exceptionDetails.exception?.description??d.params.exceptionDetails.text);} });
const read=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.error||r.result?.exceptionDetails)throw Error(JSON.stringify(r));return r.result?.result?.value;};
const shot=async name=>{const p=`${out}/${name}.png`;writeFileSync(p,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));console.log(p);};
const page=async(query,w=1280,h=900)=>{
 await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:new URL(`/?hud=1&day=1&${query}`,first).href});
 const start=Date.now();while(Date.now()-start<180000){await sleep(500);if(await read("document.title==='settled' && !!window.mmm?.shift && !!window.mmm?.radio"))return;}
 throw Error('page failed to settle: '+query);
};
const steer=async()=>read(`(()=>{const v=mmm.vehicle;v.assist=0;v.steerAngle=0;v.airborne=false;v.vx=0;v.vz=-18;v.damageActive=true;v.update(.05,{throttle:0,steer:0,handbrake:false});return v.steerAngle;})()`);
try{
 await send('Runtime.enable');await send('Page.enable');
 if(process.env.DAMAGE_TIMING_ONLY==='1') await damageTiming({page,read,send});
 else {
 // The stuck window, on both bodies. The code car is the fallback now: one page keeps its window tested.
 await page('damage=window,alignment&car=code');await assertMailCar(read,'code','damage window, ?car=code');
 const codeGlass=await assertGlassDown(read,'code car');
 // The default page must have built the Blender car: a silent fallback to the code car fails here.
 await page('damage=window,alignment');await assertMailCar(read,'blender','damage window, default car');
 const windowState=(await assertGlassDown(read,'Blender car')).now;
 console.log('PASS stuck window on both bodies',JSON.stringify({code:codeGlass.now,blender:windowState}));
 const audio=await read(`(()=>{const r=mmm.radio; const a=[];for(const s of [0,10,25]){r.setWind(true,s);a.push(r.audio.volume);}r.setWind(false,25);a.push(r.audio.volume);return a;})()`);
 assert.ok(audio[0]>audio[1]&&audio[1]>audio[2]);assert.equal(audio[0],audio[3]);
 const slider=await read(`(()=>{const r=mmm.radio;r.setWind(true,25);const s=document.querySelector('#radioVolume input');s.value='0.5';s.dispatchEvent(new Event('input'));return [r.audio.volume,localStorage.getItem('mmm.radio.vol')];})()`);
 assert.ok(Math.abs(slider[0]-.175)<1e-6);assert.equal(slider[1],'0.5');
 assert.ok(await steer()<0,'desktop actual steering offset');
 console.log('PASS window geometry, speed gain, volume preference and desktop pull',windowState,audio);
 // The existing hint appears briefly, then the normal stop hint returns, even while parked.
 // The shift repaints its hint line every 0.2 s of game time (uiTimer), and update(0) paints only when that timer is
 // already due: wait for the game's own paint, as a player would see it, instead of reading at once.
 await read(`mmm.vehicle.place(mmm.vehicle.x,mmm.vehicle.z,mmm.vehicle.heading);mmm.shift.damage.hintTime=5;mmm.shift.update(0,mmm.vehicle)`);
 const hintSet=Date.now();
 const hintState=async()=>read(`JSON.stringify({text:document.getElementById('stopHint').textContent,hintTime:mmm.shift.damage.hintTime,elapsed:mmm.shift.elapsed,hidden:document.hidden,settingsOpen:document.getElementById('settings').classList.contains('open'),pauseScreen:document.getElementById('pauseScreen')?.hidden===false})`);
 let hint=await hintState();
 for(const end=Date.now()+2000;!/pulls left/.test(JSON.parse(hint).text)&&Date.now()<end;hint=await hintState())await sleep(100);
 assert.match(JSON.parse(hint).text,/pulls left/,'damage hint within 2 s '+hint);await shot('damage-hint');
 await sleep(5500-(Date.now()-hintSet));   // 5.5 s from setting the 5 s hint, as before the wait for its paint
 assert.doesNotMatch(await read("document.getElementById('stopHint').textContent"),/pulls left/);
 // Draw the same scene through a close camera and save the car canvas in the same task folder.
 const carImage=await read(`(()=>{const {vehicle:v,camera:c,renderer:r}=mmm;v.place(v.x,v.z,0);c.position.set(v.x+4,v.y+2.1,v.z-2.8);c.lookAt(v.x,v.y+1.05,v.z-.1);c.updateMatrixWorld();r.render(v.car.root.parent,c);return r.domElement.toDataURL('image/png').split(',')[1];})()`);
 writeFileSync(`${out}/window-stuck.png`,Buffer.from(carImage,'base64'));console.log(`${out}/window-stuck.png`);
 for(const mode of ['touch=1','q=low']){await page(`damage=alignment&${mode}`);assert.equal(await steer(),0,mode+' has no pull');console.log('PASS no pull: '+mode);}
 for(const [name,damage,total,w,h] of [['report-none','',0,1280,900],['report-careless','shock,bumper',70,1280,900],['report-over-allowance','shock,window,alignment,bumper',163,1280,900],['report-phone','shock,window,alignment,bumper',163,390,844]]){
  await page(`damage=${damage}${w<600?'&touch=1':''}`,w,h);
  const result=await read(`(()=>{const s=mmm.shift;s.end();return {bill:document.getElementById('reportRepairs').textContent,total:document.getElementById('repairTotal').textContent,stats:document.getElementById('reportStats').textContent,saved:JSON.parse(localStorage.getItem('mmm.shift.v1')),complaints:s.complaints.all.map(c=>({kind:c.kind,target:c.target})),verdict:document.getElementById('reportVerdict').textContent,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
  assert.equal(result.saved.pay,345-total);assert.match(result.total,new RegExp(`Repairs total: \\$${total}`));assert.equal(result.overflow,false);
  if(!damage)assert.equal(result.bill,'Repairs: none');else assert.match(result.bill,/Front shock/);
  if(total>135)assert.match(result.total,/Allowance left: −\$28/);
  assert.equal(result.complaints.length,3);assert.ok(result.complaints.every(c=>c.kind==='missing'));assert.equal(result.verdict,'One-day suspension. Without pay.');
  await shot(name);
  await read(`document.getElementById('nextDay').click()`);await sleep(200);
  assert.equal(await read('mmm.shift.damage.total'),0);await assertMailCar(read,'blender',name);await assertGlassUp(read,name+' after the repair');
  assert.equal(await read('mmm.shift.career.pay'),345-total);
  console.log('PASS bill, pay, unchanged verdict, repaired next day: '+name,JSON.stringify({...result,saved:{day:result.saved.day,pay:result.saved.pay}}));
 }
 // Sample the actual loaded Mines Road surface through the real fixed-step controller.
 await page('road=Mabou%20Mines%20Road&f=0.5');
 // The car is held on one spot of the washboard at a fixed speed: place it once, then put x, z, heading and speed back
 // on every step. Do not place() on every step. place() sets the car's height to the ground under its centre,
 // and update() rests it on the mean of its four wheel contacts. On the reshaped Mabou roads (#101) that mean is
 // more than 5 cm lower here, so a car that is placed on every step is airborne on every step, and air time is
 // never billed: this case then billed $0 at any speed, and failed on main from #101 on.
 const mines=await read(`(()=>{const v=mmm.vehicle,{x,z,heading}=v;const surface=mmm.terrain.surfaceAt(x,z);const bills=[],air=[],steps=8*120;
  for(const speed of [5,13]){v.damage.reset();v.place(x,z,heading);let hops=0;
   for(let i=0;i<steps;i++){v.x=x;v.z=z;v.heading=heading;v.vx=Math.sin(heading)*speed;v.vz=-Math.cos(heading)*speed;v.damageActive=true;v.update(1/120,{throttle:0,steer:0,handbrake:false});if(v.airborne)hops++;}
   bills.push(v.damage.total);air.push(hops);}
  v.damage.reset();v.place(x,z,heading);return {washboard:surface.washboard,bills,air,steps};})()`);
 assert.equal(mines.washboard,true,'Mabou Mines Road remains washboard');assert.equal(mines.bills[0],0,'slow on the washboard is free: '+JSON.stringify(mines));assert.ok(mines.bills[1]>0,'fast on the washboard costs: '+JSON.stringify(mines));
 assert.ok(mines.air.every(n=>n<mines.steps*.05),'the held car rests on the road (airborne on under 5% of the steps): '+JSON.stringify(mines));
 console.log('PASS actual Mines Road: slow free, fast costs',mines);
 // A real drive, as a witness that the game itself bills this road: from the same spot, about 13 m/s along the
 // road's heading for 7 s, with no reset at all. The car must be on its wheels nearly all the time, and it must cost.
 const drive=await read(`(()=>{const v=mmm.vehicle,{x,z,heading}=v,steps=7*120;v.damage.reset();v.place(x,z,heading);v.vx=Math.sin(heading)*13;v.vz=-Math.cos(heading)*13;
  let air=0,rough=0,slowest=99;
  for(let i=0;i<steps;i++){const speed=Math.hypot(v.vx,v.vz);slowest=Math.min(slowest,speed);v.damageActive=true;v.update(1/120,{throttle:speed<13?1:0,steer:0,handbrake:false});if(v.airborne)air++;if(mmm.terrain.surfaceAt(v.x,v.z)?.washboard)rough++;}
  const out={bill:v.damage.total,air,steps,onWashboard:rough,slowest:+slowest.toFixed(2),moved:+Math.hypot(v.x-x,v.z-z).toFixed(1)};v.damage.reset();v.place(x,z,heading);return out;})()`);
 assert.ok(drive.bill>0,'a real 7 s drive at about 13 m/s on the Mines Road costs: '+JSON.stringify(drive));
 assert.ok(drive.air<drive.steps*.05,'a real drive is on its wheels (airborne on under 5% of the steps): '+JSON.stringify(drive));
 console.log('PASS real drive on the Mines Road: on its wheels, and it costs',drive);
 // Forced damage is inspectable in non-driving scenes; none accumulates on its own.
 for(const query of ['title=1','shot=1','demo=1','interior=mine']){
  await page(query);await read(`(()=>{const v=mmm.vehicle;v.damage.hit('impact',20);v.damage.reset();v.y+=2;v.vy=-8;v.airborne=true;})()`);await sleep(1300);
  assert.equal(await read('mmm.shift.damage.total'),0,query+' immune');assert.equal(await read('mmm.vehicle.damageActive'),false);console.log('PASS immunity: '+query);
 }
 await damageTiming({page,read,send});
 }
 assert.deepEqual(errors,[],'no browser exceptions');
 console.log('PASS: all damage browser checks.');
}finally{await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);ws.close();}
