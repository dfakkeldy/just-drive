// Shared with damage-browser.mjs. DAMAGE_TIMING_ONLY=1 runs just these regressions.
import assert from 'node:assert/strict';
export async function damageTiming({page,read,send}) {
 let failed=0;
 const check=async(name,fn)=>{try{await fn();console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+': '+e.message);}};
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 await page('x=1');
 await send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyW',key:'w'});await sleep(100);
 await send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyW',key:'w'});
 await read(`void Object.defineProperty(mmm.terrain,'pending',{get:()=>1,configurable:true})`);await sleep(100);
 await check('solid impact while a distant land request is pending',async()=>{
  const result=await read(`(()=>{const v=mmm.vehicle;v.damage.reset();v.onSolidImpact(15);return {pending:mmm.terrain.pending,active:v.damageActive,bill:v.damage.total};})()`);
  console.log(JSON.stringify(result));assert.equal(result.pending,1);assert.equal(result.bill,77);
 });
 await check('parked car impact while a land request is pending',async()=>{
  const result=await read(`(async()=>{const {ParkedVehicles,pushOut}=await import('/src/parked.ts');const v=mmm.vehicle;v.damage.reset();v.heading=0;v.vx=0;v.vz=-15;v.speed=15;const p=new ParkedVehicles([{x:v.x,z:v.z-2,heading:Math.PI/2,type:0,colour:0xaaaaaa}],()=>v.y);pushOut(v,p.solids);return {bill:v.damage.total,speed:v.speed};})()`);
  console.log(JSON.stringify(result));assert.equal(result.bill,77);assert.ok(result.speed<15);
 });
 await read(`delete mmm.terrain.pending`);
 for(const query of ['demo=1','shot=1','interior=mine','title=1','x=1&report=1']) {
  await page(query+'&damage=alignment');
  await check('seeded alignment has no pull: '+query,async()=>{
   const angle=await read(`(()=>{const v=mmm.vehicle;v.place(v.x,v.z,v.heading);v.assist=0;v.steerAngle=0;v.vx=Math.sin(v.heading)*18;v.vz=-Math.cos(v.heading)*18;v.update(.05,{throttle:0,steer:0,handbrake:false});return {angle:v.steerAngle,active:v.damageActive};})()`);
   console.log(JSON.stringify(angle));assert.equal(angle.active,false);assert.equal(angle.angle,0);
  });
 }
 if(failed)throw Error(`${failed} browser damage timing case(s) failed`);
}
