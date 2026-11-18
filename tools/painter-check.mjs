import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { painterDay, painterPose, painterDust, painterHint, PAINTER, PAINTER_TEXT } from '../web/src/painter-rules.ts';
import { Vehicle } from '../web/src/vehicle.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import { TRUCK_SPEC } from '../web/src/truck.ts';
import { SXS_SPEC } from '../web/src/sxs.ts';
import { fishDay, SceneRoad } from '../web/src/road-scene-rules.ts';
import { painterArt } from '../web/src/painter-art.ts';
import { PainterScene } from '../web/src/painter-scene.ts';
import { RoadScene } from '../web/src/road-scene.ts';
import { Complaints } from '../web/src/complaints.ts';
import { roads, village, propsData } from './shift-fixture.mjs';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
let count=0;
for(let day=1;day<=3650;day++) {
 assert.equal(painterDay(day),day%3===1);
 if(painterDay(day)){count++;assert.equal(fishDay(day),false);}
 for(const force of ['fish','0'])assert.equal(painterDay(day,force),false);
 assert.equal(painterDay(day,null,'1884'),false);
}
assert.ok(count/3650>.32&&count/3650<.34);
const hit=roads.nearest(618982.72-village[0],village[1]-5109266.90,20,r=>r.name==='Mabou Mines Road');
assert.ok(hit.road.washboard&&hit.road.kind===3,'washboard: the hint braking proof below assumes it');
let along=0;for(let i=0;i<hit.seg;i++)along+=Math.hypot(hit.road.pts[i+1][0]-hit.road.pts[i][0],hit.road.pts[i+1][1]-hit.road.pts[i][1]);
along+=hit.t*Math.hypot(hit.road.pts[hit.seg+1][0]-hit.road.pts[hit.seg][0],hit.road.pts[hit.seg+1][1]-hit.road.pts[hit.seg][1]);
const road=new SceneRoad(hit.road.pts,along),p={x:0,z:0,heading:0},centre={...p};painterPose(road,p);road.at(PAINTER.along,0,centre);
const nearest=roads.nearest(p.x,p.z,30);
assert.equal(nearest.road.name,'Mabou Mines Road');assert.ok(nearest.dist-PAINTER.radius>nearest.road.halfWidth+1);
assert.ok((p.x-centre.x)*Math.cos(centre.heading)+(p.z-centre.z)*Math.sin(centre.heading)<-6,'field side, opposite positive rail side');
assert.ok(Math.sin(p.heading-centre.heading)>.6,'faces positive seaward side');
// The baked land cover (class 4 is water), read from its PNG with no resampling.
const manifest=JSON.parse(readFileSync('../data/baked/terrain/manifest.json')),cv=manifest.cover,png=readFileSync('../data/baked/terrain/'+cv.file);
let width,height,channels;const chunks=[];
for(let o=8;o<png.length;){const n=png.readUInt32BE(o),type=png.toString('ascii',o+4,o+8),q=png.subarray(o+8,o+8+n);o+=n+12;
 if(type==='IHDR'){width=q.readUInt32BE(0);height=q.readUInt32BE(4);assert.equal(q[8],8);channels=q[9]===2?3:q[9]===6?4:0;assert.ok(channels);}if(type==='IDAT')chunks.push(q);}
const raw=inflateSync(Buffer.concat(chunks)),stride=width*channels,px=new Uint8Array(stride*height);
for(let y=0;y<height;y++)for(let x=0;x<stride;x++){const k=y*stride+x,a=x>=channels?px[k-channels]:0,b=y?px[k-stride]:0,c=y&&x>=channels?px[k-stride-channels]:0,f=raw[y*(stride+1)],t=a+b-c;
 const pa=Math.abs(t-a),pb=Math.abs(t-b),pc=Math.abs(t-c);px[k]=(raw[y*(stride+1)+1+x]+[0,a,b,(a+b)>>1,pa<=pb&&pa<=pc?a:pb<=pc?b:c][f])&255;}
const cover=(x,z)=>{const e=x+village[0],n=village[1]-z,u=(e-cv.xmin)/(cv.xmax-cv.xmin),v=(cv.ymax-n)/(cv.ymax-cv.ymin);return u<0||v<0||u>=1||v>=1?0:px[(Math.floor(v*height)*width+Math.floor(u*width))*channels+2];};
const firstWater=heading=>{for(let d=0;d<3000;d+=5)if(cover(p.x+d*Math.sin(heading),p.z-d*Math.cos(heading))===4)return d;return Infinity;};
let nearestWater=Infinity;for(let a=0;a<360;a+=5)nearestWater=Math.min(nearestWater,firstWater(a*Math.PI/180));
assert.ok(firstWater(p.heading)<=300&&firstWater(p.heading)<=nearestWater+50,`faces open water: ${firstWater(p.heading)} m ahead, nearest ${nearestWater} m`);
{let crosses=false;for(let d=1;d<30;d+=.5){const h=roads.nearest(p.x+d*Math.sin(p.heading),p.z-d*Math.cos(p.heading),5,r=>r.name==='Mabou Mines Road');if(h&&h.dist<=h.road.halfWidth)crosses=true;}assert.ok(crosses,'the road is in the view');}
assert.ok(Math.abs(Math.cos(p.heading-centre.heading))>.6,'not facing directly across lane');
for(const [speed,distance,dist,half,kind,want] of [[9,8,0,3,3,true],[-9,8,0,3,3,true],[8,8,0,3,3,false],[2,8,0,3,3,false],[9,13,0,3,3,false],[9,8,4,3,3,false],[9,8,0,3,2,false]])assert.equal(painterDust(speed,distance,dist,half,kind),want);
const shift={career:{day:1},complaints:new Complaints(),elapsed:2};
const terrain={heightAt:()=>0};const s=new PainterScene(road,hit.road,terrain,shift,new URLSearchParams());s.reset();
const camera=new THREE.PerspectiveCamera();camera.position.set(p.x,4,p.z);s.update(camera);
const v={...centre,speed:2};s.step(v,true);assert.equal(shift.complaints.all.length,0);
v.speed=10;s.step(v,false);assert.equal(shift.complaints.all.length,0);s.step(v,true);s.step(v,true);
assert.equal(shift.complaints.all.length,1);assert.equal(shift.complaints.all[0].line,'My painting now has a road in it.');
assert.equal(shift.complaints.all[0].kind,'sceneDust');
assert.equal(s.dusty,true,'the scene itself remembers the complaint');
s.reset();assert.equal(s.dusty,false,'a new day clears the complaint');s.update(camera);
shift.complaints=new Complaints();s.step(v,true);assert.equal(shift.complaints.all.length,1,'the next painter day can complain again');
// The drawn kit faces where the pose looks: local -Z in world space is the pose heading.
s.group.updateMatrixWorld();const look=new THREE.Vector3(0,0,-1).applyQuaternion(s.group.quaternion);
assert.ok(Math.abs(look.x-Math.sin(p.heading))<1e-9&&Math.abs(look.z+Math.cos(p.heading))<1e-9,'mesh faces the pose heading, towards the sea');
// The step test uses the scene's own road, with no lookup; it must agree with the baked road query near the painter.
const probe={x:0,z:0,heading:0};
for(let a=0;a<360;a+=15)for(const r of [2,6,10,12.9]){const x=p.x+r*Math.cos(a*Math.PI/180),z=p.z+r*Math.sin(a*Math.PI/180);
 road.at(road.alongAt(x,z),0,probe);const own=Math.hypot(x-probe.x,z-probe.z),baked=roads.nearest(x,z,20,r=>r.name==='Mabou Mines Road');
 if(baked)assert.ok(Math.abs(own-baked.dist)<1e-6,`road distance at ${a} deg ${r} m: ${own} vs ${baked.dist}`);else assert.ok(own>20-1e-6);}
assert.deepEqual(s.pose,p,'stationary');
console.log('PASS painter days, field placement, dust thresholds, play gate, one complaint per day, mesh facing and stationary art');

// The wiring in RoadScene: a real fast pass on the real road, through RoadScene.step and RoadScene.update.
globalThis.addEventListener??=()=>{};
const world=(query='',day=1,loaded=true)=>{const sh={career:{day},run:{stops:[]},roadside:[],ended:false,complaints:new Complaints(),elapsed:3};
 const rs=new RoadScene(roads,{manifest:{village},heightAt:()=>0},sh,new URLSearchParams(query));
 const cam=new THREE.PerspectiveCamera();cam.position.set(rs.painter.pose.x,4,rs.painter.pose.z);if(loaded)rs.update(cam);return {sh,rs};};
const pass=(rs,sh,side=0,speed=12)=>{const car={x:0,z:0,heading:0,vx:0,vz:0,speed};
 for(let a=PAINTER.along-20;a<=PAINTER.along+20;a+=.1){rs.road.at(a,side,car);rs.step(1/120,car,true);}return sh.complaints.all.filter(c=>c.kind==='sceneDust').length;};
{const {sh,rs}=world();assert.equal(rs.painter.enabled,true);assert.equal(rs.rules.enabled,false,'no fish scene on a painter day');assert.equal(rs.painter.group.visible,true);
 assert.equal(pass(rs,sh),1,'a fast pass through RoadScene adds one dust complaint');}
{const {sh,rs}=world();sh.ended=true;assert.equal(pass(rs,sh),0,'no complaint after the shift ends');}
{const {sh,rs}=world();rs.setPaused(true);assert.equal(pass(rs,sh),0,'no complaint while paused');}
{const {sh,rs}=world();const car={x:0,z:0,heading:0,vx:0,vz:0,speed:5};
 for(let a=PAINTER.along-20;a<=PAINTER.along+20;a+=.1){rs.road.at(a,0,car);rs.step(1/120,car,true);}assert.equal(sh.complaints.all.length,0,'a slow pass is fine');}
{const {sh,rs}=world();assert.equal(pass(rs,sh,0,-12),1,'a fast pass in reverse also counts');}
// A short stretch that ends 5 m before abreast of the painter, still inside its 13 m range, counts too.
{const {sh,rs}=world(),car={x:0,z:0,heading:0,vx:0,vz:0,speed:12};let near=false;
 for(let a=PAINTER.along-11;a<=PAINTER.along-5;a+=.1){rs.road.at(a,0,car);near||=Math.hypot(car.x-rs.painter.pose.x,car.z-rs.painter.pose.z)<PAINTER.range;rs.step(1/120,car,true);}
 assert.ok(near);assert.equal(sh.complaints.all.length,1,'the road under the car is measured, not the road beside the painter');}
{const {sh,rs}=world();assert.equal(pass(rs,sh,2),1,'a fast pass inside the half width counts');}
{const {sh,rs}=world();assert.ok(Math.abs(PAINTER.side)-4.5>PAINTER.radius);assert.equal(pass(rs,sh,-4.5),0,'a fast pass through the field, off the road, does not');}
{const {sh,rs}=world('',1,false);assert.equal(rs.painter.group.visible,false);assert.equal(pass(rs,sh),0,'a painter not yet drawn cannot complain');}
{const {rs}=world();const cam=new THREE.PerspectiveCamera();cam.position.set(rs.painter.pose.x+PAINTER.draw-5,4,rs.painter.pose.z);rs.update(cam);assert.equal(rs.painter.group.visible,true,'drawn inside the draw distance');
 cam.position.set(rs.painter.pose.x+PAINTER.draw+5,4,rs.painter.pose.z);rs.update(cam);assert.equal(rs.painter.group.visible,false,'culled beyond the draw distance');}
for(const query of ['scene=fish','scene=0'])for(const day of [1,4,7]){const {sh,rs}=world(query,day);assert.equal(rs.painter.enabled,false,query+' day '+day);assert.equal(rs.painter.group.visible,false);assert.equal(pass(rs,sh),0);}
// One session through fish, painter, fish days: the fish art comes back after a painter day.
{const sh={career:{day:5},run:{stops:[]},roadside:[],ended:false,complaints:new Complaints(),elapsed:3};
 const rs=new RoadScene(roads,{manifest:{village},heightAt:()=>0},sh,new URLSearchParams()),cam=new THREE.PerspectiveCamera();cam.position.set(rs.centre.x,20,rs.centre.z);
 const car={x:rs.centre.x+20,z:rs.centre.z,heading:0,vx:0,vz:0,speed:0};
 const day=d=>{sh.career.day=d;rs.reset();rs.step(1/120,car,true);rs.update(cam);return {fish:rs.rules.enabled,fishShown:rs.group.visible,painter:rs.painter.group.visible,solids:rs.solids.length};};
 assert.deepEqual(day(5),{fish:true,fishShown:true,painter:false,solids:2});
 assert.deepEqual(day(7),{fish:false,fishShown:false,painter:true,solids:0});
 assert.deepEqual(day(8),{fish:true,fishShown:true,painter:false,solids:2});}
console.log('PASS RoadScene wiring: one complaint on a fast real-road pass (also reverse, also within the half width); none slow, off road, unloaded, paused, after the shift or on forced scene days; fish art returns after a painter day');

// The slow-down hint (#1147). It goes where the fish scene's goes: RoadScene.hint, read by the HUD five times a second.
for(const [distance,closing,speed,dusty,want] of [[PAINTER.hint-1,2,5,false,PAINTER_TEXT.approach],[PAINTER.hint+1,30,30,false,''],[50,.5,5,false,''],[50,-9,9,false,''],
 [12.9,-9,9,false,PAINTER_TEXT.approach],[12.9,0,2,false,PAINTER_TEXT.approach],[12.9,0,-2,false,PAINTER_TEXT.approach],[12.9,0,.5,false,''],[50,0,0,false,''],
 [2*PAINTER.range-1,-9,9,true,PAINTER_TEXT.dusty],[2*PAINTER.range+1,-9,9,true,''],[5,0,0,true,'']])
 assert.equal(painterHint(distance,closing,speed,dusty),want,`hint at ${distance} m closing ${closing} speed ${speed}${dusty?' after dust':''}`);
for(const line of Object.values(PAINTER_TEXT))assert.ok(line.length<=60&&!/\d/.test(line),'short, and no number in the hint: '+line);
assert.ok(PAINTER_TEXT.approach.startsWith('SLOW DOWN'),'the instruction leads, for the one-line landscape phone hint');
// A pass at a fixed speed through RoadScene, either way along the road; the HUD samples the hint every 0.2 s.
const hintPass=(rs,sh,speed,from,to)=>{const dir=Math.sign(to-from),car={x:0,z:0,heading:0,vx:0,vz:0,speed};let t=0,first=null,firstSample=null,complaint=null,gap=false,last='',shown=new Set();
 for(let a=from;dir*(to-a)>=0;a+=dir*Math.abs(speed)/120,t+=1/120){
  rs.road.at(a,0,car);if(dir*Math.sign(speed)<0)car.heading+=Math.PI;
  const before=sh.complaints.all.length;rs.step(1/120,car,true);const hint=rs.hint,d=Math.hypot(car.x-rs.painter.pose.x,car.z-rs.painter.pose.z);
  if(hint&&first===null)first={t,d};if(hint)shown.add(hint);if(first!==null&&complaint===null&&!hint)gap=true;
  if(hint&&firstSample===null&&Math.round(t*120)%24===0)firstSample=t;
  if(sh.complaints.all.length>before&&complaint===null)complaint={t,d,hint};last=hint;}
 return {first,firstSample,complaint,gap,last,shown};};
{// Braking proof with the real garage vehicles (car, Heavy pickup, side-by-side) on washboard, flat and at the default
 // hill height's 6% downhill (painter-browser measures the real grade): at top speed, up to 0.2 s for the HUD to redraw,
 // one second to read the hint, then the brake. Each must be under the dust speed before the dust range. Seeded
 // washboard shake keeps the run deterministic.
 const node=()=>new THREE.Object3D();let worst=0,fastest=0;const report=[];
 for(const [name,spec] of [['car',CAR_SPEC],['pickup',TRUCK_SPEC],['side-by-side',SXS_SPEC]]){let specWorst=0,specTop=0;
  for(const grade of [0,.06])for(let seed=1;seed<=4;seed++){
  const car={root:node(),body:node(),steer:{fl:node(),fr:node()},wheels:{fl:node(),fr:node(),rl:node(),rr:node()}};
  const ground={withContactHeight:(b,r)=>r(),heightAt:(x,z)=>z*grade,surfaceAt:(x,z)=>({ground:z*grade,canopy:0,roadDist:0,halfWidth:hit.road.halfWidth,kind:3,level:8,washboard:true})};
  const v=new Vehicle(car,ground,{nearest:()=>({x:0,z:0,heading:0,dist:0,road:{kind:3,halfWidth:hit.road.halfWidth,name:'Road'}}),deckHeight:()=>null},-1e4,spec);
  let r=seed;v.random=()=>(r=r*16807%2147483647)/2147483647;v.assist=0;v.place(0,0,0);
  const input={throttle:1,steer:0,handbrake:false},keep=()=>{input.steer=Math.max(-1,Math.min(1,-3*Math.atan2(Math.sin(v.heading),Math.cos(v.heading))-.05*v.x));};
  for(let i=0;i<120*60;i++){keep();v.update(1/120,input);}
  const x0=v.x,z0=v.z;specTop=Math.max(specTop,v.speed);
  for(let i=0;i<120*1.2;i++){keep();v.update(1/120,input);}
  input.throttle=-1;for(let i=0;v.speed>PAINTER.speed;i++){assert.ok(i<120*30,'brakes');keep();v.update(1/120,input);}
  specWorst=Math.max(specWorst,Math.hypot(v.x-x0,v.z-z0));}
  report.push(`${name} ${specTop.toFixed(1)} m/s, ${specWorst.toFixed(1)} m`);worst=Math.max(worst,specWorst);fastest=Math.max(fastest,specTop);}
 console.log(`braking proof (top speed; HUD redraw, 1 s to read, brake under ${PAINTER.speed} m/s): ${report.join('; ')}; hint at ${PAINTER.hint} m, dust inside ${PAINTER.range} m`);
 assert.ok(fastest>20,`the fastest reaches washboard top speed downhill (${fastest.toFixed(1)} m/s)`);
 assert.ok(PAINTER.range+worst<PAINTER.hint,`hint distance ${PAINTER.hint} m covers ${worst.toFixed(1)} m to read and brake plus the ${PAINTER.range} m dust range`);
 // The pass itself, at that top speed and at 12 m/s, from both directions and in reverse.
 for(const [speed,from,to] of [[fastest,PAINTER.along-PAINTER.hint-30,PAINTER.along+20],[fastest,PAINTER.along+PAINTER.hint+30,PAINTER.along-20],[12,PAINTER.along-PAINTER.hint-30,PAINTER.along+20],[-12,PAINTER.along+PAINTER.hint+30,PAINTER.along-20]]){
  const {sh,rs}=world(),r=hintPass(rs,sh,speed,from,to),label=`${speed.toFixed(1)} m/s from ${from}`;
  assert.ok(r.complaint,label+': the fast pass still complains');assert.ok(r.first,label+': a hint');
  assert.equal(r.complaint.hint,PAINTER_TEXT.dusty,label+': after the complaint the hint says so');
  assert.ok(r.first.d>PAINTER.hint-1&&r.first.d<PAINTER.hint,label+`: hint from ${r.first.d.toFixed(1)} m`);
  assert.ok(r.firstSample!==null&&r.firstSample<r.complaint.t-1,label+': the HUD shows it more than a second before the complaint');
  assert.ok(r.complaint.d<PAINTER.range&&r.first.d-r.complaint.d>PAINTER.hint-PAINTER.range-1,label+': hint well before any complaint can count');
  assert.equal(r.gap,false,label+': the hint stays up until the complaint');}}
{const {sh,rs}=world(),r=hintPass(rs,sh,5,PAINTER.along-PAINTER.hint-30,PAINTER.along+PAINTER.hint+30);
 assert.equal(sh.complaints.all.length,0);assert.deepEqual([...r.shown],[PAINTER_TEXT.approach],'a slow pass sees only the slow-down line');
 assert.equal(r.last,'','the hint clears once the car has gone past');}
{const {rs}=world(),car={x:0,z:0,heading:0,vx:0,vz:0,speed:0};rs.road.at(PAINTER.along-40,0,car);rs.step(1/120,car,true);
 assert.equal(rs.hint,'','parked 40 m short: no hint until moving towards the painter');
 rs.road.at(PAINTER.along,0,car);rs.step(1/120,car,true);assert.equal(rs.hint,'','parked beside the painter: no hint');
 car.speed=2;rs.step(1/120,car,true);assert.equal(rs.hint,PAINTER_TEXT.approach,'rolling beside the painter: the hint');}
// A parked player at a mailbox near the painter keeps that box's own HUD line (stop, flyers, box down): the roadside
// hint wins the line in shift.ts, so the painter must say nothing to a stopped car, before or after the dust.
{const boxes=propsData.mailboxes.map(b=>({x:b.x-village[0],z:village[1]-b.y})).filter(b=>Math.hypot(b.x-p.x,b.z-p.z)<40);
 assert.ok(boxes.length>=1,'a mailbox stands near the painter');
 for(const b of boxes)for(const dusty of [false,true]){const {sh,rs}=world();if(dusty)assert.equal(pass(rs,sh),1);
  const car={x:0,z:0,heading:0,vx:0,vz:0,speed:0};rs.road.at(rs.road.alongAt(b.x,b.z),0,car);for(let i=0;i<30;i++)rs.step(1/120,car,true);
  assert.equal(rs.hint,'',`stopped at the mailbox ${Math.hypot(b.x-p.x,b.z-p.z).toFixed(1)} m from the painter${dusty?' after the dust':''}: no painter hint`);}}
{const {sh,rs}=world('',1,false),r=hintPass(rs,sh,12,PAINTER.along-PAINTER.hint-30,PAINTER.along+20);assert.equal(r.first,null,'no hint for a painter not yet drawn');}
{const {sh,rs}=world(),car={x:0,z:0,heading:0,vx:0,vz:0,speed:12};rs.road.at(PAINTER.along-30,0,car);rs.step(1/120,car,true);assert.equal(rs.hint,PAINTER_TEXT.approach);
 rs.setPaused(true);rs.road.at(PAINTER.along,0,car);rs.step(1/120,car,true);assert.equal(sh.complaints.all.length,0);assert.equal(rs.hint,PAINTER_TEXT.approach,'paused: the line holds, like the fish hint');
 rs.setPaused(false);sh.career.day=2;rs.reset();assert.equal(rs.painter.hint,'','a new (fish) day clears the painter hint');}
for(const [query,day] of [['',2],['',3],['',5],['',6],['scene=0',1],['scene=0',4],['scene=fish',1],['era=1884',1]]){const {sh,rs}=world(query,day),r=hintPass(rs,sh,12,PAINTER.along-PAINTER.hint-30,PAINTER.along+20);
 assert.ok(![...r.shown].some(h=>Object.values(PAINTER_TEXT).includes(h)),`no painter hint on ${query||'day'} ${day}`);assert.equal(rs.painter.hint,'');assert.equal(sh.complaints.all.filter(c=>c.kind==='sceneDust').length,0);}
// The fish hint is unchanged on a fish day.
{const sh={career:{day:2},run:{stops:[]},roadside:[],ended:false,complaints:new Complaints(),elapsed:3},rs=new RoadScene(roads,{manifest:{village},heightAt:()=>0},sh,new URLSearchParams());
 const car={x:0,z:0,heading:0,vx:0,vz:0,speed:0};rs.road.at(-30,0,car);rs.step(1/120,car,true);assert.equal(rs.hint,rs.rules.hint);assert.ok(rs.hint.startsWith('A fish truck'));}
console.log('PASS painter hint: from',PAINTER.hint,'m on approach, before any dust complaint (top speed, 12 m/s, both ways, reverse); braking proof for the car, pickup and side-by-side; clears after passing; silent to a parked car (mailbox beside the painter); none parked short, unloaded, on fish/plain days, scene=0/fish or 1884; fish hint unchanged');

const art=painterArt(),positions=art.geometry.getAttribute('position');
assert.ok(positions.count/3<=400,'384-triangle artist budget');
for(let i=0;i<positions.count;i++)assert.ok(Math.hypot(positions.getX(i),positions.getZ(i))<=PAINTER.radius,'entire kit inside placement footprint');
art.geometry.dispose();art.material.dispose();
