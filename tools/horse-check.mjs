import assert from 'node:assert/strict';
import { gaitAt, hoofCycle, horseSpeedLimit, GAITS } from '../web/src/horse-motion.ts';
import { HORSE_SPEC, createHorse } from '../web/src/horse.ts';
import { GARAGE, readVehicle, periodRides } from '../web/src/garage.ts';
import { Vehicle } from '../web/src/vehicle.ts';
import { Damage } from '../web/src/damage-rules.ts';
for (const [speed,gait] of [[0,'stand'],[6/3.6,'walk'],[14/3.6,'trot'],[24/3.6,'canter'],[45/3.6,'gallop'],[-1,'walk']]) assert.equal(gaitAt(speed),gait,'gait selection at '+speed);
for (const gait of ['walk','trot','canter','gallop']) {
  const positions=new Set();
  for(let i=0;i<4;i++) for(let t=0;t<1;t+=.025){
    const a=hoofCycle(gait,t,i),b=hoofCycle(gait,t+1,i);
    assert.ok(Math.abs(a.z-b.z)<1e-10 && Math.abs(a.lift-b.lift)<1e-10,'cycle repeats');
    assert.ok(a.lift>=0 && a.lift<.5);positions.add(a.z.toFixed(3));
  }
  assert.ok(positions.size>15,'legs really move');
  for(let i=0;i<4;i++){const phase=GAITS[gait].beats[i];assert.ok(hoofCycle(gait,phase+.3,i).z-hoofCycle(gait,phase+.1,i).z>.1,'planted hoof travels back through the stance');}
  assert.equal(new Set(GAITS[gait].beats).size,{walk:4,trot:2,canter:3,gallop:4}[gait]);
}
assert.equal(GAITS.canter.beats[1],GAITS.canter.beats[2],'canter middle beat is a diagonal');
// Gait structure must include genuine flight, diagonal trot and the three canter beats.
for(const gait of ['trot','canter','gallop'])assert(Array.from({length:1000},(_,i)=>i/1000).some(t=>[0,1,2,3].every(l=>!hoofCycle(gait,t,l).planted)),gait+' has suspension');
for(let t=0;t<1;t+=.01){assert.deepEqual(hoofCycle('trot',t,0),hoofCycle('trot',t,3));assert.deepEqual(hoofCycle('trot',t,1),hoofCycle('trot',t,2));}
for(const [q,saved,id]of [['era=1884',null,'horse'],['',null,'car'],['era=1884','bike','bike'],['era=1884&vehicle=car','horse','car'],['era=1884&vehicle=sxs','bike','sxs'],['era=1884&area=westbay',null,'car']])assert.equal(readVehicle(new URLSearchParams(q),true,()=>({getItem:()=>saved})).id,id);
for(const id of ['car','truck','bike','sxs','horse']){
 assert.equal(readVehicle(new URLSearchParams('era=1884&vehicle='+id),true,()=>({getItem:()=>null})).id,id);
 assert.equal(readVehicle(new URLSearchParams('era=1884'),true,()=>({getItem:()=>id})).id,id);
}
// The horse is the 1884 ride only: outside the era an address or a saved choice of 'horse' gives the car.
for(const area of ['mabou','judique','porthood','pointtupper','westbay','cansocauseway'])assert.equal(readVehicle(new URLSearchParams('area='+area+'&vehicle=horse')).id,'car','no horse outside 1884: '+area);
for(const q of ['','mode=explore','era=today'])assert.equal(readVehicle(new URLSearchParams(q),true,()=>({getItem:()=>'horse'})).id,'car','a horse saved in 1884 does not follow into today: '+q);
assert.equal(readVehicle(new URLSearchParams('era=1884&area=typo'),true,()=>({getItem:()=>null})).id,'horse','unknown area falls back to Mabou, as the game does, so 1884 keeps its horse');
assert.equal(periodRides(new URLSearchParams('era=1884&area=typo')),true);assert.equal(periodRides(new URLSearchParams('era=1884&area=westbay')),false);
assert.equal(horseSpeedLimit('pavement',0),12.5);
assert.ok(horseSpeedLimit('grass',0)>8 && horseSpeedLimit('grass',0)<12.5,'grass surface limit');
assert.ok(horseSpeedLimit('brush',0)<horseSpeedLimit('grass',0));
assert.ok(horseSpeedLimit('pavement',.25)<8);
assert.ok(horseSpeedLimit('pavement',-.3)<7);
assert.ok(HORSE_SPEC.maxSteer>.7 && HORSE_SPEC.reverseSpeed<=1.5);
assert.ok(HORSE_SPEC.chase.lookHeight>1.5);
assert.equal(readVehicle(new URLSearchParams('era=1884&vehicle=horse')).spec,HORSE_SPEC);assert.equal(readVehicle(new URLSearchParams('vehicle=horse')).id,'car');
assert.equal(GARAGE[0].id,'car');
const rig=createHorse();let triangles=0;
rig.root.traverse(o=>{if(o.isMesh) triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;});
assert.ok(triangles<5000);console.log('horse triangles',triangles);
// Real mesh joint positions: front knees stay forward, hocks backward; flight lifts every hoof.
const events=[];rig.onFootfall=i=>events.push(i);let flight=false,frontFold=0;
for(let n=0;n<240;n++){
 rig.body.position.y=0;rig.body.rotation.set(0,0,0);rig.animate(1/120,10,()=>0);rig.root.updateMatrixWorld(true);
 const hooves=[];rig.root.traverse(o=>{if(o.name.startsWith('Hoof '))hooves.push(o);});
 flight ||= hooves.every(h=>!h.userData.planted&&h.position.y>.06);
 // A planted footfall is emitted by the SAME wrap test that advances the posed stride.
 if(events.length){for(const leg of events.splice(0))assert(hooves[leg].userData.planted,'audio starts on visual contact');}
 for(let i=0;i<4;i++){
  const leg=rig.root.getObjectByName('Upper leg '+i),lower=rig.root.getObjectByName('Lower leg '+i);assert(leg&&lower);
  const knee=leg.localToWorld(new (leg.position.constructor)(0,.5,0));
  const hip=leg.localToWorld(new (leg.position.constructor)(0,-.5,0));
  const foot=lower.localToWorld(new (leg.position.constructor)(0,.5,0));
  const dz=knee.z-(hip.z+foot.z)/2;
  assert(i<2?dz<0:dz>0,'knee/hock bends on anatomical side');if(i<2)frontFold=Math.max(frontFold,Math.abs(dz));
 }
}
assert(flight,'actual rig has all four hooves off the floor');assert(frontFold>.2,'front knees visibly fold');
rig.phase=0;rig.body.position.y=0;rig.animate(0,3.8,()=>0);const seated=rig.root.getObjectByName('Rider').position.y;
rig.phase=.5;rig.body.position.y=0;rig.animate(0,3.8,()=>0);assert(rig.root.getObjectByName('Rider').position.y>seated+.15,'rider posts once per trot stride');
assert.equal(HORSE_SPEC.hitch,undefined);
// A coarse bank triangle can lie above a narrow rendered timber deck. The deck
// remains the mount's support, rather than raising its root to that unrelated bank.
const deckHorse=new Vehicle(createHorse(),{heightAt:()=>12,meshHeightAt:()=>14,surfaceAt:()=>({deck:false})},{deckHeight:()=>10},-.2,HORSE_SPEC);
assert.equal(deckHorse.groundAt(0,0),14,'a horse below the deck stays on land');
deckHorse.y=10;
assert.equal(deckHorse.groundAt(0,0),10,'timber deck remains authoritative under coarse land');
// The horse cannot create motor repair items, even if a caller enables damage.
const v=new Vehicle(rig,{}, {},-.2,HORSE_SPEC);v.damage=new Damage();v.damageActive=true;v.onSolidImpact(30);
assert.deepEqual(v.damage.items,[],'no motor damage on horse impact');
console.log('PASS horse gaits, phases, surface/grade caps, spec, garage, mesh budget and no motor damage');
// A horse crosses lawns without motor-vehicle tyre strips or their repair/complaint side effects.
const { Ruts } = await import('../web/src/ruts.ts');
const ruts=new Ruts({},[],[0,0],true,()=>assert.fail('horse caused tyre damage'));
ruts.update(v,1);assert.equal(ruts.count,0);assert.equal(ruts.lawns,0);
// Production controller on the real hill-side grass patch used in the browser pictures.
const {makeGround,preload}=await import('./phone-ground.mjs');
const {terrain,roads}=makeGround();
const home={x:-5298.63,z:-5911.77};await preload(terrain,[[home.x,home.z]],180);
const horse=new Vehicle(createHorse(),terrain,roads,-.2,HORSE_SPEC);horse.assist=0;horse.damage=new Damage();horse.damageActive=true;
horse.place(home.x,home.z,0);
const dx=terrain.heightAt(home.x+2,home.z)-terrain.heightAt(home.x-2,home.z),dz=terrain.heightAt(home.x,home.z+2)-terrain.heightAt(home.x,home.z-2);
horse.place(home.x,home.z,Math.atan2(dz,dx));
let peak=0,grassSteps=0;
for(let i=0;i<120*8;i++){
 terrain.withGroundContact(horse,()=>horse.update(1/120,{throttle:1,steer:0,handbrake:false}));
 assert.equal(horse.airborne,false);assert.ok(horse.speed<=12.5);peak=Math.max(peak,horse.speed);
 if(horse.surfaceName==='grass')grassSteps++;
}
assert.ok(peak>6 && grassSteps>120,'horse can canter across real grass');assert.deepEqual(horse.damage.items,[]);
horse.respawn();assert.equal(horse.speed,0,'horse reset clears speed immediately');terrain.withGroundContact(horse,()=>horse.update(1/120,{throttle:0,steer:0,handbrake:true}));assert.ok(Math.abs(horse.speed)<.1);
console.log('PASS real grass handling, grounded controller, no ruts/repairs, reset', {peak,grassSteps});
