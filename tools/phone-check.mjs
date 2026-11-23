// Seeded thumb + exact keyboard oracle, on real Terrain samples and real Vehicle physics.
// tools/check-phone.sh [--explore] [--sweep]
import assert from 'node:assert/strict';
import { Worker, isMainThread } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { Vehicle } from '../web/src/vehicle.ts';
import { thumbSteer, THUMB_DEAD, THUMB_POWER } from '../web/src/driving-help.ts';
import { readFileSync } from 'node:fs';
import { Damage } from '../web/src/damage-rules.ts';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { makeGround, preload, manifest } from './phone-ground.mjs';
const {Vehicle:Baseline,Damage:BaselineDamage}=await import(process.env.PHONE_BASELINE);
// Independent deterministic suites share no mutable simulation state. Reuse this
// bundle in one worker so the added frame rates do not lengthen the normal check.
const keyboardJob=isMainThread?new Promise((resolve,reject)=>{
 const worker=new Worker(new URL(import.meta.url),{argv:process.argv.slice(2)});
 worker.on('error',reject);worker.on('exit',code=>code===0?resolve():reject(new Error(`Keyboard worker exited ${code}`)));
}):null;
// Report a worker failure after the existing phone suite has also finished.
keyboardJob?.catch(()=>{});
const {terrain,roads}=makeGround(),dt=1/60,range=Number(process.env.PHONE_RANGE??60);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const random=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
function line(pts){const cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum.at(-1)+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));return {pts,cum,length:cum.at(-1)};}
function at(path,s){s=clamp(s,0,path.length);let i=1;while(i<path.cum.length-1&&path.cum[i]<s)i++;const a=path.pts[i-1],b=path.pts[i],t=(s-path.cum[i-1])/(path.cum[i]-path.cum[i-1]||1);return {x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,heading:Math.atan2(b[0]-a[0],a[1]-b[1])};}
function nearest(path,x,z,progress=null){let best={dist:Infinity};for(let i=1;i<path.pts.length;i++){if(progress!==null&&(path.cum[i]<progress-20||path.cum[i-1]>progress+70))continue;const a=path.pts[i-1],b=path.pts[i],dx=b[0]-a[0],dz=b[1]-a[1],t=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1),0,1),px=a[0]+dx*t,pz=a[1]+dz*t,d=Math.hypot(x-px,z-pz);if(d<best.dist)best={x:px,z:pz,dist:d,s:path.cum[i-1]+(path.cum[i]-path.cum[i-1])*t,heading:Math.atan2(dx,-dz)};}return best;}
function segment(id,start,end){const r=roads.roads.find(r=>r.id===id),p=line(r.pts),pts=[];for(let s=start;s<end;s+=4){const q=at(p,s);pts.push([q.x,q.z]);}const q=at(p,end);pts.push([q.x,q.z]);return line(pts);}
const street=roads.roads.find(r=>r.id===24),hwy=line(roads.roads.find(r=>r.id===26).pts),join=nearest(hwy,...street.pts[0]);
assert.ok(join.dist<2,`street junction ${join.dist}`);
const approach=segment(26,join.s,join.s+650).pts.reverse();
const routes=[{name:'Highway 19',id:25,path:segment(25,4600,5600)},{name:'Gravel',id:20,path:segment(20,100,1100)},{name:'Mines',id:55,path:segment(55,1800,2800)},{name:'Village + junction',id:26,path:line([...approach,...street.pts.slice(1)])}];
for(const r of routes){await preload(terrain,r.path.pts,180);console.log('ROUTE',r.name,r.path.length.toFixed(2),JSON.stringify(r.path.pts[0]),'to',JSON.stringify(r.path.pts.at(-1)));}
function car(C=Vehicle,D=C===Baseline?BaselineDamage:Damage){const node=()=>new THREE.Object3D();const v=new C({root:node(),body:node(),steer:{fl:node(),fr:node()},wheels:{fl:node(),fr:node(),rl:node(),rr:node()}},terrain,roads,-.2);v.damage=new D();v.damageActive=true;return v;}
const skills={practised:{delay:.25,rate:120,noise:2,coarse:3,bias:1},first:{delay:.32,rate:85,noise:3,coarse:5,bias:2}};
const pad=(px,dead=0,power=1.5)=>Math.sign(px)*Math.pow(clamp((Math.abs(px)-dead)/(range-dead),0,1),power);
function run(route,skill,mode,config={}){
 Math.random=random(0x4d41494c);const rng=random(0x5448554d),v=car(mode.startsWith('today')?Baseline:Vehicle),p=at(route.path,0);
 v.strongHelp=mode.startsWith('strong');v.touchSpeedLimit=mode!=='strong-free';
 v.place(p.x+Math.cos(p.heading)*1.1,p.z+Math.sin(p.heading)*1.1,p.heading);
 const sk=skills[skill],delay=Array(Math.round(sk.delay/dt)).fill(0);let thumb=0,noise=0,previous=0,reversals=0,offTime=0,offDistance=0,distance=0,worst=0,ditches=0,inDitch=false,maxSpeed=0,progress=0,i=0;
 const hash=createHash('sha256');
 while(progress<route.path.length-5&&i<60*240){
  const hit=nearest(route.path,v.x,v.z,progress);progress=Math.max(progress,hit.s);
  // The game's ideal heading/side law, using a short preview so the route's final junction is intentional.
  const ahead=at(route.path,hit.s+Math.max(4,Math.abs(v.speed)*.35));
  const side=(v.x-hit.x)*Math.cos(hit.heading)+(v.z-hit.z)*Math.sin(hit.heading)-1.1;
  const ideal=clamp(wrap(ahead.heading-v.heading)*1.6-side*.12,-1,1);
  const target=Math.sign(ideal)*range*Math.pow(Math.abs(ideal),1/1.5);
  delay.push(target);const wanted=delay.shift();thumb+=clamp(wanted-thumb,-sk.rate*dt,sk.rate*dt);
  if(i%6===0)noise=(rng()*2-1)*sk.noise;
  const px=Math.round(thumb/sk.coarse)*sk.coarse+noise+sk.bias;
  const steer=mode.startsWith('today')?pad(px):config.dead!==undefined?pad(px,config.dead,config.power):thumbSteer(px,range);
  if(Math.abs(steer)>.025){const sign=Math.sign(steer);if(previous&&sign!==previous)reversals++;previous=sign;}
  const x=v.x,z=v.z;v.update(dt,{throttle:mode==='today-paced'?clamp(((route.name==='Highway 19'?80:route.name==='Mines'?36:58)/3.6-v.speed)*.8,-1,1):1,steer,handbrake:false,touch:mode!=='today'&&mode!=='today-paced'});
  const ds=Math.hypot(v.x-x,v.z-z),s=terrain.surfaceAt(v.x,v.z),road=roads.nearest(v.x,v.z,120);
  const off=s.kind===0||s.roadDist>s.halfWidth+.4;
  if(off){offTime+=dt;offDistance+=ds;}distance+=ds;worst=Math.max(worst,hit.dist);maxSpeed=Math.max(maxSpeed,v.speed*3.6);
  const depth=road?(terrain.heightAt(road.x,road.z)??v.y)-v.y:0,ditch=off&&depth>.65;
  if(ditch&&!inDitch)ditches++;inDitch=ditch;
  hash.update(new Uint8Array(new Float64Array([v.x,v.z,v.y,v.heading,v.vx,v.vz,v.speed]).buffer));i++;
  // A crash stops this trial; report incomplete progress instead of quietly resetting onto the road.
  if(hit.dist>100||i>1800&&v.speed<.05)break;
 }
 return {route:route.name,skill,mode,seconds:+(i*dt).toFixed(2),progress:+progress.toFixed(1),distance:+distance.toFixed(1),offTime:+offTime.toFixed(2),offDistance:+offDistance.toFixed(1),worst:+worst.toFixed(2),ditches,mean:+(distance/(i*dt)*3.6).toFixed(1),max:+maxSpeed.toFixed(1),reversals:+(reversals/(i*dt)).toFixed(2),bill:v.damage.total,hash:hash.digest('hex')};
}
// Exact baseline replay: compare binary Float64 paths AND damage events, never rounded output.
function keyboard(route,C,strong,frames=[1/60],D=C===Baseline?BaselineDamage:Damage,maxFrames=Infinity){
 Math.random=random(0x4b455953);const v=car(C,D),p=at(route.path,0);v.strongHelp=strong;v.desktopPull=true;
 v.place(p.x,p.z,p.heading);const hash=createHash('sha256'),events=[];let progress=0,pulse=0,seconds=0;
 const add=v.damage.add.bind(v.damage);v.damage.add=id=>{events.push([id,v.x,v.z,v.damage.roughTime]);add(id);};
 for(let i=0;seconds<250&&i<maxFrames;i++){
  const dt=frames[i%frames.length];seconds+=dt;
  const h=nearest(route.path,v.x,v.z,progress);progress=Math.max(progress,h.s);
  const look=Math.max(3,Math.abs(v.speed)*.8),q=at(route.path,h.s+look),dx=q.x+Math.cos(q.heading)*1.1-v.x,dz=q.z+Math.sin(q.heading)*1.1-v.z;
  const s=terrain.surfaceAt(v.x,v.z),mu=s.washboard?.6:s.kind<=2?1:.72,corner=s.washboard?1:1.7;
  const maxSteer=Math.min(.6,Math.atan(2.62*1.15*corner*mu*9.81/Math.max(v.speed*v.speed,4)));
  const ideal=clamp(Math.atan2(2*2.62*Math.sin(wrap(Math.atan2(dx,-dz)-v.heading)),Math.max(1,Math.hypot(dx,dz)))/maxSteer,-1,1);pulse+=ideal;
  const steer=Math.abs(pulse)>.5?Math.sign(pulse):0;pulse-=steer;
  const cruise=route.name==='Village + junction'?5:12;
  const throttle=v.speed<cruise-.5?1:v.speed>cruise+.5?-1:0;
  v.update(dt,{throttle,steer,handbrake:false,touch:false});
  hash.update(new Uint8Array(new Float64Array([v.x,v.z,v.y,v.heading,v.vx,v.vz,v.vy,v.speed,v.steerAngle,v.pitch,v.roll]).buffer));
  if(progress>route.path.length-5||h.dist>90)break;
 }
 return {hash:hash.digest('hex'),events,bill:v.damage.total,progress};
}
// A shared short trace must fail before its matching hashes can count as proof.
function compareKeyboard(actual,old,route,label){
 for(const [name,row]of [['baseline',old],['current',actual]])assert.ok(row.progress>route.path.length-5,`${label}: ${name} completes planned path (${row.progress.toFixed(1)} / ${route.path.length.toFixed(1)} m)`);
 assert.deepEqual(actual,old,`${label}: bit-identical keyboard path + damage`);
}
// The production assertions must reject every mutant; unexpected exceptions do not count.
function rejectsMutation(name,check,pattern){
 assert.throws(check,{name:'AssertionError',message:pattern},`${name}: mutation must fail the intended assertion`);
 console.log('MUTATION',name,'rejected by',pattern.source);
}
if(!isMainThread){
const unevenRng=random(0x4652414d);
const frameTimes=[['1/30',[1/30]],['1/60',[1/60]],['1/120',[1/120]],['uneven',Array.from({length:64},()=>1/(30+unevenRng()*90))]];
const keyboardPins=new Map();
for(const r of routes)for(const [name,frames]of frameTimes){
 const old=keyboard(r,Baseline,false,frames);keyboardPins.set(`${r.name}:${name}`,old);
 for(const strong of [false,true])compareKeyboard(keyboard(r,Vehicle,strong,frames),old,r,`${r.name} ${name} strong=${strong}`);
 console.log('KEYBOARD',r.name,name,old.hash,'progress',old.progress.toFixed(1),'bill',old.bill,'events',JSON.stringify(old.events));
}

const firstRoute=routes[0],firstPin=keyboardPins.get(`${firstRoute.name}:1/60`);
for(const name of ['damage','defects','frame']){
 const mutant=await import(`${process.env.PHONE_CHECK_DIR}/${name}.mjs`);
 if(name==='frame'){
  compareKeyboard(keyboard(firstRoute,mutant.Vehicle,false,[1/60],mutant.Damage),firstPin,firstRoute,'frame mutation at 1/60');
  console.log('MUTATION frame: 1/60 alone passes');
  for(const rate of ['1/30','1/120'])rejectsMutation(`frame ${rate}`,()=>compareKeyboard(keyboard(firstRoute,mutant.Vehicle,false,frameTimes.find(([name])=>name===rate)[1],mutant.Damage),keyboardPins.get(`${firstRoute.name}:${rate}`),firstRoute,`frame ${rate}`),/bit-identical keyboard/);
 }else{
  const actual=keyboard(firstRoute,mutant.Vehicle,false,[1/60],mutant.Damage);
  if(process.argv.includes('--prove-legacy')){
   const legacy=await import(`${process.env.PHONE_CHECK_DIR}/legacy-${name}.mjs`);
   assert.deepEqual(actual,keyboard(firstRoute,legacy.Vehicle,false,[1/60],legacy.Damage),`${name}: legacy shared oracle still passes`);
   console.log(`LEGACY ${name}: changed path still passes shared-dependency comparison`);
  }
  rejectsMutation(name,()=>compareKeyboard(actual,firstPin,firstRoute,name),/bit-identical keyboard/);
 }
}
const shortOld=keyboard(firstRoute,Baseline,false,[1/60],BaselineDamage,10),shortNow=keyboard(firstRoute,Vehicle,false,[1/60],Damage,10);
assert.deepEqual(shortNow,shortOld,'legacy comparison accepts a matching short replay');
console.log('LEGACY short replay: matching hashes pass');
rejectsMutation('short replay',()=>compareKeyboard(shortNow,shortOld,firstRoute,'short replay'),/baseline completes planned path/);

}else{
const results=[];
for(const r of routes)for(const skill of Object.keys(skills))for(const mode of ['today','today-paced','light','strong-free','strong']){const row=run(r,skill,mode);results.push(row);console.log('RESULT',JSON.stringify(row));}
if(process.argv.includes('--sweep'))for(const dead of [2,4,6])for(const power of [1.5,1.8,2.1]){let off=0,missing=0;for(const r of routes.slice(0,2))for(const skill of Object.keys(skills)){const row=run(r,skill,'light',{dead,power});off+=row.offDistance;missing+=Math.max(0,995-row.progress);}console.log('PAD',JSON.stringify({dead,power,off:+off.toFixed(1),missing:+missing.toFixed(1),score:+(off+missing).toFixed(1)}));}
if(!process.argv.includes('--explore'))for(const r of routes.slice(0,2))for(const skill of Object.keys(skills)){
 const rows=results.filter(x=>x.route===r.name&&x.skill===skill),today=rows.find(x=>x.mode==='today'),strong=rows.find(x=>x.mode==='strong');
 assert.ok(strong.progress>990,`${r.name} ${skill}: completes`);assert.ok(strong.offDistance<today.offDistance*.3,`${r.name} ${skill}: off-road distance cut by >70%`);
}

// An ideal driver knows the intended route, brakes for its junction and then stops.
// Pure pursuit asks for an actual wheel angle, normalized by the same grip limit as Vehicle.
function idealRun(path,start,end,offset=1.1,stop=null){
 Math.random=random(0x49444541);const v=car(),p=at(path,start);v.strongHelp=true;
 v.place(p.x+Math.cos(p.heading)*offset,p.z+Math.sin(p.heading)*offset,p.heading);
 let progress=start,maxFight=0,turnFight=0,strongFight=0,allTurnFight=0,maxError=0,n=0;
 for(;n<15000;n++){
  const h=nearest(path,v.x,v.z,progress);progress=Math.max(progress,h.s);
  const look=Math.max(3,Math.abs(v.speed)*.8),q=at(path,Math.min(end,h.s+look));
  const tx=q.x+Math.cos(q.heading)*offset,tz=q.z+Math.sin(q.heading)*offset;
  const dx=tx-v.x,dz=tz-v.z,dist=Math.hypot(dx,dz),alpha=wrap(Math.atan2(dx,-dz)-v.heading);
  const s=terrain.surfaceAt(v.x,v.z),mu=s.washboard?.6:s.kind<=2?1:.72,corner=s.washboard?1:1.7;
  const maxSteer=Math.min(.6,Math.atan(2.62*1.15*corner*mu*9.81/Math.max(v.speed*v.speed,4)));
  const steer=clamp(Math.atan2(2*2.62*Math.sin(alpha),Math.max(1,dist))/maxSteer,-1,1);
  const remain=Math.max(0,end-h.s);
  // A driver who plans to turn has to lift GO. The heading helper must yield here.
  const nearTurn=Math.abs(h.s-650)<45;
  const target=Math.min(14,nearTurn?5:14,Math.sqrt(remain*2.5));
  const throttle=clamp((target-v.speed)*1.2,-1,1);
  v.update(dt,{throttle,steer,handbrake:remain<.3&&v.speed<.2,touch:true});
  const totalYaw=v.helpYaw+v.lightHelpYaw,fight=steer*totalYaw<0?Math.abs(totalYaw):0;maxFight=Math.max(maxFight,fight);
  const extraFight=steer*v.helpYaw<0?Math.abs(v.helpYaw):0;strongFight=Math.max(strongFight,extraFight);
  if(nearTurn){turnFight=Math.max(turnFight,extraFight);allTurnFight=Math.max(allTurnFight,fight);}
  maxError=Math.max(maxError,h.dist);
  if(remain<.5&&Math.abs(v.speed)<.12)break;
 }
 const distance=stop?Math.hypot(v.x-stop.x,v.z-stop.z):Math.hypot(v.x-at(path,end).x,v.z-at(path,end).z);
 return {progress,seconds:n*dt,x:v.x,z:v.z,distance,maxFight,strongFight,turnFight,allTurnFight,maxError,speed:v.speed};
}
const turn=idealRun(routes[3].path,0,routes[3].path.length-3);
console.log('JUNCTION',JSON.stringify(turn));assert.ok(turn.progress>1020&&turn.maxError<4,'ideal driver completes the real junction');assert.equal(turn.turnFight,0,'junction has no strong steering fight');
const props=JSON.parse(readFileSync('../data/baked/terrain/props.json'));
// Pick the first surveyed mailbox along this test highway with a safe edge-side approach.
let chosen=null;
for(const b of props.mailboxes){const x=b.x-manifest.village[0],z=manifest.village[1]-b.y,h=nearest(routes[0].path,x,z);const side=(x-h.x)*Math.cos(h.heading)+(z-h.z)*Math.sin(h.heading);if(h.dist<6&&side>1.5&&side<6&&h.s>50&&h.s<850){chosen={x,z,s:h.s,side};break;}}
assert.ok(chosen,'real right-side mailbox found');
const stop=idealRun(routes[0].path,Math.max(0,chosen.s-140),chosen.s,chosen.side-1.5,chosen);
console.log('MAILBOX',JSON.stringify({chosen,...stop}));assert.ok(stop.distance<2&&Math.abs(stop.speed)<.15,'stops within 2 m of surveyed mailbox');

// Heading only: start parallel at three cross-road positions, leave the thumb centred.
// Off-road, deliberate steer, stopped/reverse, braking and junctions give zero strong yaw.
const r=routes[0],pos=at(r.path,300);
for(const [offset,steer,throttle,speed]of [[0,0,1,15],[2,0,1,15],[-2,0,1,15],[9,0,1,15],[0,.6,1,15],[0,0,-1,15],[0,0,1,3],[0,0,1,-5]]){
 const v=car();v.strongHelp=true;v.place(pos.x+Math.cos(pos.heading)*offset,pos.z+Math.sin(pos.heading)*offset,pos.heading+.1);v.vx=Math.sin(v.heading)*speed;v.vz=-Math.cos(v.heading)*speed;
 v.update(dt,{steer,throttle,touch:true,handbrake:false});
 if(Math.abs(offset)>4||steer>.55||throttle<0||speed<5)assert.equal(Math.abs(v.helpYaw),0,'strong help gives way');
}
for(const px of [-THUMB_DEAD,0,THUMB_DEAD])assert.equal(Math.abs(thumbSteer(px,60)),0);
for(const px of [-60,60])assert.equal(thumbSteer(px,60),Math.sign(px));
console.log('PASS: route turn, right-side mailbox, yielding and production pad. (The keyboard parity runs beside this and prints its own lines; the exit code waits for it.)');

// Surface speed survey: flat sampled contact fixture isolates rolling resistance,
// engine/traction and defects. Real-route peaks above are the hill/bend counterpart.
// km/h. A limited surface must hold its limit (the whole limiter removed must fail here) and must not be throttled
// far below it; a works-yard surface must be untouched to the last digit.
const LIMITS={paved:100,street:90,gravel:75,washboard:50,track:50,trail:55,grass:50,brush:50};
for(const [name,kind,washboard,canopy]of [['paved',1,false,0],['street',2,false,0],['gravel',3,false,0],['washboard',3,true,0],['track',4,false,0],['trail',5,false,0],['grass',0,false,0],['brush',0,false,3],['yard gravel',8,false,0],['concrete',9,false,0],['packed sand',10,false,0]]){
 const flat={heightAt:()=>100,withContactHeight:(_,read)=>read(),surfaceAt:()=>({ground:100,canopy,kind,washboard,roadDist:kind?0:99,halfWidth:3,level:8})};
 const net={roads:[],nearest:()=>null,deckHeight:()=>null};
 const node=()=>new THREE.Object3D(),model={root:node(),body:node(),steer:{fl:node(),fr:node()},wheels:{fl:node(),fr:node(),rl:node(),rr:node()}};
 const speeds=[];
 for(const strong of [false,true]){
  Math.random=random(0x53504545);const v=new Vehicle(model,flat,net,0);v.strongHelp=strong;v.place(0,0,0);
  let peak=0,last=0;for(let i=0;i<60*180;i++){v.update(dt,{throttle:1,steer:0,handbrake:false,touch:true});peak=Math.max(peak,v.speed*3.6);if(i>=60*150)last+=Math.abs(v.speed)*3.6/(60*30);}
  speeds.push({at180:+(v.speed*3.6).toFixed(2),peak:+peak.toFixed(2),last30mean:+last.toFixed(2)});
 }
 console.log('SURFACE',name,JSON.stringify({held:speeds[0],strong:speeds[1]}));
 const limit=LIMITS[name];
 if(limit){
  assert.ok(speeds[1].peak<=limit+1,`${name}: Strong holds ${limit} km/h under a held GO (peak ${speeds[1].peak})`);
  if(speeds[0].last30mean>limit+5)assert.ok(speeds[1].last30mean>=limit-4,`${name}: Strong is not throttled far below its limit (${speeds[1].last30mean})`);
  // The unlimited car is slow on washboard (it skips and surges), so the bound above never applies there.
  // Keep the roughness floor: the cap is 50, but the tyres still skip and surge.
  if(name==='washboard')assert.ok(speeds[1].last30mean>=32,`washboard: Strong is not throttled below 32 km/h (${speeds[1].last30mean})`);
 }else if(kind>=8)assert.deepEqual(speeds[1],speeds[0],`${name}: the works yard is not limited`);
}

// The limit must never be a hard stop. Two cases a steady-speed survey cannot see: the surface changes under a fast
// car (highway to grass with GO held), and the help is switched on at speed. In both the car may slow only as if
// the driver had lifted, plus the limiter's light brake.
{
 const {LIMIT_BRAKE}=await import('../web/src/vehicle.ts');
 const node=()=>new THREE.Object3D(),model=()=>({root:node(),body:node(),steer:{fl:node(),fr:node()},wheels:{fl:node(),fr:node(),rl:node(),rr:node()}});
 const net={roads:[],nearest:()=>null,deckHeight:()=>null};
 const world=state=>({heightAt:()=>100,withContactHeight:(_,read)=>read(),surfaceAt:()=>({ground:100,canopy:0,kind:state.kind,washboard:false,roadDist:state.kind?0:99,halfWidth:3,level:8})});
 const fresh=(state,speed,strong,x=0,z=0)=>{Math.random=random(0x534f4654);const v=new Vehicle(model(),world(state),net,0);v.strongHelp=strong;v.place(x,z,0);v.vz=-speed;v.speed=speed;return v;};
 // What lifting off costs at this speed at this very spot (potholes drag too): one step of the same car with no pedal.
 const lifted=(kind,speed,x,z)=>{const v=fresh({kind},speed,true,x,z);v.update(dt,{throttle:0,steer:0,handbrake:false,touch:true});return (speed-v.speed)/dt;};
 for(const [name,from,to,speed,target]of [['highway to grass',1,0,100/3.6,50],['highway to a village street',1,2,100/3.6,90],['highway to gravel',1,3,100/3.6,75],['help switched on at 150 km/h',1,1,150/3.6,100]]){
  const state={kind:from},v=fresh(state,speed,name.startsWith('help')?false:true);
  for(let i=0;i<30;i++)v.update(dt,{throttle:1,steer:0,handbrake:false,touch:true});
  state.kind=to;v.strongHelp=true;
  let worst=0,seconds=0;
  for(let i=0;i<60*30;i++){
   const before=v.speed,free=lifted(to,before,v.x,v.z),wasAirborne=v.airborne;
   v.update(dt,{throttle:1,steer:0,handbrake:false,touch:true});
   // A pothole can throw the car; the step that lands it is compared with a fresh car that was never in the air, so skip it.
   if(wasAirborne){if(v.speed*3.6>target+1)seconds+=dt;continue;}
   const slowing=(before-v.speed)/dt;worst=Math.max(worst,slowing-free);
   assert.ok(slowing<=free+LIMIT_BRAKE+0.05,`${name}: slowing ${slowing.toFixed(2)} m/s2 at ${(before*3.6).toFixed(0)} km/h is more than a lift (${free.toFixed(2)}) plus the light brake`);
   if(v.speed*3.6>target+1)seconds+=dt;
  }
  assert.ok(v.speed*3.6<=target+1,`${name}: the car does come down to ${target} km/h (${(v.speed*3.6).toFixed(1)})`);
  console.log('TRANSITION',name,JSON.stringify({worstBeyondLift:+worst.toFixed(3),secondsToLimit:+seconds.toFixed(2),final:+(v.speed*3.6).toFixed(1)}));
 }
 console.log('PASS: limits hold, the yard is free, and the limiter never brakes harder than a lift plus '+LIMIT_BRAKE+' m/s2.');
}

// Every place where the car can leave one drivable line for another is a junction, the rail trail included:
// it crosses the highway on the level. Strong must be silent there.
{
 const {DrivingHelp}=await import('../web/src/driving-help.ts'),help=new DrivingHelp(roads),open=[];
 for(const a of roads.roads.filter(r=>!r.bridge))for(const b of roads.roads.filter(r=>r.kind===5&&!r.bridge&&r!==a)){
  if(a.kind===5&&a.id>=b.id)continue;
  for(let i=1;i<a.pts.length;i++){const [ax,az]=a.pts[i-1],[bx,bz]=a.pts[i];
   for(let j=1;j<b.pts.length;j++){const [cx,cz]=b.pts[j-1],[dx,dz]=b.pts[j];
    if(Math.max(ax,bx)<Math.min(cx,dx)||Math.max(cx,dx)<Math.min(ax,bx)||Math.max(az,bz)<Math.min(cz,dz)||Math.max(cz,dz)<Math.min(az,bz))continue;
    const ux=bx-ax,uz=bz-az,vx=dx-cx,vz=dz-cz,k=ux*vz-uz*vx;if(Math.abs(k)<1e-8)continue;
    const t=((cx-ax)*vz-(cz-az)*vx)/k,u=((cx-ax)*uz-(cz-az)*ux)/k;if(t<0||t>1||u<0||u>1)continue;
    const x=ax+t*ux,z=az+t*uz;if(help.clear(x,z)>0)open.push({road:a.id,trail:b.id,x,z});
   }}
 }
 assert.deepEqual(open,[],'every level crossing with the rail trail suppresses Strong');
 // The crossing a reviewer drove: Highway 19 and the trail, turning right onto the trail at 12 m/s.
 const x=-365.19765,z=306.13943;await preload(terrain,[[x,z]],60);
 Math.random=random(0x54524149);const v=car();v.strongHelp=true;v.place(x,z,1.52635);v.vx=Math.sin(v.heading)*12;v.vz=-Math.cos(v.heading)*12;v.speed=12;
 v.update(dt,{throttle:1,steer:.2,handbrake:false,touch:true});
 assert.equal(Math.abs(v.helpYaw),0,`Strong does not oppose a turn onto the rail trail (${v.helpYaw})`);
 console.log('PASS: rail-trail crossings are junctions.');
}

function recover(strong,C=Vehicle){
 Math.random=random(0x5245434f);const v=car(C),p=at(routes[0].path,300);v.strongHelp=strong;
 v.place(p.x,p.z,p.heading+.2);v.vx=Math.sin(v.heading)*15;v.vz=-Math.cos(v.heading)*15;
 for(let i=0;i<15;i++)v.update(dt,{throttle:1,steer:.08,handbrake:false,touch:true});
 const h=roads.nearest(v.x,v.z,20);return Math.abs(wrap(h.heading-v.heading));
}
const recovery={light:recover(false),strong:recover(true)};
console.log('RECOVERY',JSON.stringify(recovery));
function assertRecovery(row){assert.ok(row.strong<row.light*.55,'Strong must remove >45% extra heading error in 0.25 s under a resting thumb');}
assertRecovery(recovery);
const {Vehicle:GainMutant}=await import(`${process.env.PHONE_CHECK_DIR}/gain.mjs`);
rejectsMutation('PHONE_MUTATE_GAIN',()=>assertRecovery({light:recover(false,GainMutant),strong:recover(true,GainMutant)}),/Strong must remove >45%/);

// Parallel assistance cannot know which side of the road is the centre. Equal
// heading errors at -2/0/+2 m must get equal correction and equal lateral travel.
{
 const flat={heightAt:()=>100,withContactHeight:(_,read)=>read(),surfaceAt:x=>({ground:100,canopy:0,kind:0,washboard:false,roadDist:Math.abs(x),halfWidth:3.6,level:8})};
 const {Roads}=await import('../web/src/roads.ts');
 const net=new Roads({roads:[{id:1,name:null,kind:1,halfWidth:3.6,bridge:false,pts:[[0,10000],[0,-10000]]}]},[0,0],flat),traces=[];
 // A smooth deck isolates the heading helper from spatially different potholes.
 net.deckHeight=()=>100;
 for(const offset of [-2,0,2]){
  Math.random=random(1);const node=()=>new THREE.Object3D();
  const v=new Vehicle({root:node(),body:node(),steer:{fl:node(),fr:node()},wheels:{fl:node(),fr:node(),rl:node(),rr:node()}},flat,net,0);v.strongHelp=true;v.touchSpeedLimit=false;
  v.place(offset,0,.12);v.vx=Math.sin(v.heading)*15;v.vz=-Math.cos(v.heading)*15;
  for(let i=0;i<60;i++)v.update(dt,{throttle:1,steer:0,touch:true,handbrake:false});
  traces.push({offset,sideways:v.x-offset,heading:v.heading});
 }
 for(const t of traces){assert.ok(Math.abs(t.sideways-traces[1].sideways)<1e-12,'no centre seeking');assert.equal(t.heading,traces[1].heading,'same heading correction in either lane');}
 console.log('PARALLEL',JSON.stringify(traces));
}

// Quantify washboard response at matched 12 m/s, independently of the speed
// limiter. Real Mines geometry/height/defects + autopilot's same steering law.
function wander(strong){
 Math.random=random(0x57414e44);const v=car(),path=routes[2].path,p=at(path,100);v.strongHelp=strong;v.touchSpeedLimit=false;
 v.place(p.x,p.z,p.heading);let progress=100,sum=0,worst=0,off=0;
 for(let i=0;i<1200;i++){
  const h=nearest(path,v.x,v.z,progress);progress=Math.max(progress,h.s);
  const side=(v.x-h.x)*Math.cos(h.heading)+(v.z-h.z)*Math.sin(h.heading);
  const ask=clamp(wrap(h.heading-v.heading)*1.6-side*.12,-1,1);
  const forward=v.vx*Math.sin(v.heading)-v.vz*Math.cos(v.heading);
  v.vx+=Math.sin(v.heading)*(12-forward);v.vz-=Math.cos(v.heading)*(12-forward);
  v.update(dt,{throttle:1,steer:ask,touch:true,handbrake:false});
  const e=wrap(h.heading-v.heading);sum+=e*e;worst=Math.max(worst,Math.abs(side));if(terrain.surfaceAt(v.x,v.z).roadDist>2.6+.4)off+=dt;
 }
 return {rms:Math.sqrt(sum/1200),worstSide:worst,offTime:off};
}
console.log('WANDER',JSON.stringify({light:wander(false),strong:wander(true)}));

// Junction guard also covers two roads that cross inside their polylines.
{
 const {Roads}=await import('../web/src/roads.ts'),{DrivingHelp}=await import('../web/src/driving-help.ts');
 const net=new Roads({roads:[{id:1,name:null,kind:2,halfWidth:3,bridge:false,pts:[[-100,0],[100,0]]},{id:2,name:null,kind:2,halfWidth:3,bridge:false,pts:[[0,100],[0,-100]]}]},[0,0],{heightAt:()=>0});
 const help=new DrivingHelp(net);assert.equal(help.clear(0,0),0);assert.equal(help.clear(21,0),0);assert.equal(help.clear(42,0),1);
 console.log('PASS: internal-polyline crossing yields before either road ends.');
}

await keyboardJob;
}
