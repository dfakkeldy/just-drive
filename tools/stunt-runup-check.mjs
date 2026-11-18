// A cleared approach changes surface/vegetation, never terrain height or coarse channels.
import assert from 'node:assert/strict';
import {StuntPark} from '../web/src/stunt-kit.ts';
import {testParkLayout,testParkDressing,testParkRunups,testParkStarts} from '../web/src/stunt-test-park.ts';
import {YardSite} from '../web/src/yard-site.ts';
const yard=new YardSite([0,0],'invented'),dressing=testParkDressing(yard),lanes=testParkRunups(dressing);
const make=()=>({sites:[],clear:[],exag:2.5,addTreeClear(b){this.clear.push(b);},protectedRoadAt:()=>false,surveyHeightAt:async(x,z)=>3+Math.sin(x/40)+z*.014});
const a=make(),b=make(),bare=new StuntPark(a,testParkLayout(yard),false,[],dressing),park=new StuntPark(b,testParkLayout(yard),false,[],dressing,lanes);
await bare.prepare();await park.prepare();let heights=0,coverage=0;
const hardStart=testParkStarts(park)[1],old=yard.world(615,345),oldHeading=yard.heading(0,-1);
const oldStart={x:old.x-40*Math.sin(oldHeading)-2*Math.cos(oldHeading),z:old.z+40*Math.cos(oldHeading)-2*Math.sin(oldHeading)};
assert.ok(Math.hypot(hardStart.x-oldStart.x,hardStart.z-oldStart.z)<1e-8,'relocation keeps the proved safe start coordinates');

const world=(p,u,v)=>({x:p.x+u*Math.sin(p.heading)+v*Math.cos(p.heading),z:p.z-u*Math.cos(p.heading)+v*Math.sin(p.heading)});
for(const p of lanes){
 assert.ok(p.halfWidth*2>=2.55+4,'lane has rig width plus two metres each side');
 for(let u=p.from-20;u<=p.to+20;u+=3)for(let v=-p.halfWidth-20;v<=p.halfWidth+20;v+=2){
  const q=world(p,u,v),raw=20+Math.sin(q.x/13)+q.z*.023;
  for(let level=0;level<=8;level++){assert.equal(park.height(q.x,q.z,raw,level),bare.height(q.x,q.z,raw,level),'run-up heights are byte-identical to the same kit without lanes');heights++;}
 }
 for(const u of[p.from+2,-15,0,p.to-2])for(const v of[-p.halfWidth+1,0,p.halfWidth-1]){
  const q=world(p,u,v);assert.equal(park.surface(q.x,q.z,0,8)?.kind,8,'driveable packed gravel is continuous');
  const pixels=new Uint8Array(4);park.visualStyle(q.x,q.z,pixels,0,8);assert.deepEqual([...pixels],[0,255,0,255],'packed gravel is visible');
  assert.equal(park.clearCanopy(q.x,q.z,8),true,'brush is excluded');
  for(let angle=0;angle<2*Math.PI;angle+=Math.PI/8){
   // Largest supported crown: 51 m tall, radius cap .19*h+.6, scale<=1.1.
   const radius=(.19*51+.6)*1.1,x=q.x+Math.cos(angle)*radius,z=q.z+Math.sin(angle)*radius;
   assert.ok(b.clear.some(r=>x>=r[0]&&x<=r[2]&&z>=r[1]&&z<=r[3]),'a tree crown cannot reach the lane from a retained root');coverage++;
  }
  for(let level=0;level<8;level++){
   const old=new Uint8Array([17,27,37,47]);park.visualStyle(q.x,q.z,old,0,level);assert.deepEqual([...old],[17,27,37,47]);
   assert.equal(park.surface(q.x,q.z,0,level),null);assert.equal(park.clearCanopy(q.x,q.z,level),false);
  }
 }
}
// A missing lane surface and missing vegetation clearance must each fail the contract.
const start=world(lanes[0],lanes[0].from+2,0);
assert.notEqual(bare.surface(start.x,start.z,0,8)?.kind,8,'ordinary native ground is the negative surface control');
assert.equal(a.clear.some(r=>start.x>=r[0]&&start.x<=r[2]&&start.z>=r[1]&&start.z<=r[3]),false,'uncleared start is the negative vegetation control');
console.log('PASS run-up surface, crown exclusion, exact height parity and coarse channels',{lanes:lanes.length,heights,coverage});
