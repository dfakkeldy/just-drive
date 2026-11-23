// R3 five-bridge constant-speed drives; Point Tupper106 gentle approach profile.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {fixture,rig,dispose,root} from './bridges-fixture.mjs';
const rows=[];
async function verify(area,id,scale,replacements={}){
 const gentle=area==='pointtupper'&&id===106;
 const f=await fixture(area,scale,replacements),M=f.roads.modern,r=M.spans.find(r=>r.road.id===id);assert.ok(r,`${area}/${id}: reviewed span exists`);const lo=-110,hi=r.length+110,path=[];
 for(let s=lo;s<=hi;s+=2)path.push({s,...M.at(r,s)});await f.load(path.filter((_,i)=>i%5===0).map(p=>[p.x,p.z]));for(const p of path.filter((_,i)=>i%20===0))f.roads.update(new THREE.Vector3(p.x,20,p.z));
 let maxGrade=0,trough=0,maxCurve=0;
 for(const end of[false,true]){const a=(end?r.length:-r.startLength)+.005,b=(end?r.length+r.endLength:0)-.005,pa=M.at(r,a),pb=M.at(r,b),ha=M.ownHeight(r,pa.x,pa.z),hb=M.ownHeight(r,pb.x,pb.z);let prev=null,grade=null;
  for(let s=a;s<=b;s+=.5){const p=M.at(r,s),h=M.ownHeight(r,p.x,p.z);assert.ok(h!==null,'approach skin present');trough=Math.max(trough,Math.min(ha,hb)-h);if(prev!==null){const g=(h-prev)/.5;maxGrade=Math.max(maxGrade,Math.abs(g));if(grade!==null)maxCurve=Math.max(maxCurve,Math.abs(g-grade)/.5);grade=g;}prev=h;}
 }
 if(gentle)assert.ok(trough<.025,'no trough beneath approach endpoints: '+trough);assert.ok(maxGrade<=(gentle?.081:.251),'approach profile grade at most'+(gentle?'8':'25')+'%: '+maxGrade);
 for(const kind of['car','bike'])for(const dir of[1,-1]){const start=dir>0?path[0]:path.at(-1),next=dir>0?path[1]:path.at(-2),heading=Math.atan2(next.x-start.x,start.z-next.z),v=kind==='bike'?new f.BikeRide(f.createBike(),f.terrain,f.roads,-1000):new f.Vehicle(rig(THREE),f.terrain,f.roads,-1000);v.assist=0;v.place(start.x,start.z,heading,f.terrain.heightAt(start.x,start.z));v.vx=Math.sin(heading)*25;v.vz=-Math.cos(heading)*25;v.speed=25;let maxAir=0,air=0,closest=Infinity,steps=0,deckSamples=0,worstDeckGap=0;const lookahead=kind==='bike'?8:4,steerLimit=kind==='bike'?1:.5,steerGain=kind==='bike'?4:2;const random=Math.random;Math.random=()=>.5;
  const maxSteps=Math.ceil((hi-lo)/25*120)+240;
  try{for(let i=0;i<maxSteps;i++){let best=0,distance=Infinity;for(let j=0;j<path.length;j++){const d=Math.hypot(path[j].x-v.x,path[j].z-v.z);if(d<distance){distance=d;best=j;}}
   const goal=path[Math.max(0,Math.min(path.length-1,best+dir*lookahead))],h=Math.atan2(goal.x-v.x,v.z-goal.z),error=Math.atan2(Math.sin(h-v.heading),Math.cos(h-v.heading));f.terrain.withGroundContact(v,()=>v.update(1/120,{throttle:0,steer:Math.max(-steerLimit,Math.min(steerLimit,error*steerGain)),handbrake:false}));steps++;
   // Constant horizontal cruise leaves all production vertical/contact dynamics intact.
   v.vx=Math.sin(v.heading)*25;v.vz=-Math.cos(v.heading)*25;v.speed=25;
   if(v.airborne)air++;else air=0;maxAir=Math.max(maxAir,air);if(path[best].s>=2&&path[best].s<=r.length-2){const skin=M.ownHeight(r,v.x,v.z);if(skin!==null){deckSamples++;worstDeckGap=Math.max(worstDeckGap,Math.abs(v.y-skin));}}const middle=M.at(r,r.length/2);closest=Math.min(closest,Math.hypot(v.x-middle.x,v.z-middle.z));if(dir>0?best>=path.length-3:best<=2)break;
  }}finally{Math.random=random;}
  assert.ok(closest<3&&steps<maxSteps,`${area}/${id} ${kind} dir${dir}: real drive completes reviewed span; closest=${closest} steps=${steps}/${maxSteps}`);assert.ok(maxAir/120<=.15,kind+' approach airborne at25m/s: '+maxAir/120);assert.ok(deckSamples>=Math.max(1,(r.length-4)/25*120*.5),'real drive samples the deck throughout its central span');assert.ok(worstDeckGap<.35,'real drive stays on the deck, not the land underneath: '+worstDeckGap);
  const row={area,id,scale,kind,dir,speed:25,closest,steps,deckSamples,worstDeckGap,maxAirSeconds:maxAir/120,maxGrade,trough,maxCurve,start:r.startLength,end:r.endLength};rows.push(row);console.log('PASS S1 '+JSON.stringify(row));
 }
 dispose(f);
}
const reviewed=[['mabou',28],['westbay',81],['judique',36],['cansocauseway',54],['pointtupper',106]];
for(const scale of[1,1.5])for(const[area,id]of reviewed)await verify(area,id,scale);
if(process.argv.includes('--mutations')){const file='web/src/modern-bridges.ts',s=readFileSync(root+file,'utf8'),anchor='if(smooth){const c=this.curveData';assert.equal(s.split(anchor).length,2);await assert.rejects(()=>verify('pointtupper',106,1.5,{[file]:s.replace(anchor,'if(false&&smooth){const c=this.curveData')}),/approach profile grade|no trough|airborne at25m/);console.log('KILLED smooth vertical curve removed');
 const dip='h=c?this.curveValue(c,t):this.top(r,s,x,z)';assert.equal(s.split(dip).length,2);await assert.rejects(()=>verify('pointtupper',106,1.5,{[file]:s.replace(dip,'h=c?this.curveValue(c,t)-.8*Math.sin(Math.PI*t):this.top(r,s,x,z)')}),/no trough beneath approach endpoints/);console.log('KILLED artificial approach trough');}
if(process.env.OUT)writeFileSync(process.env.OUT+'/r3-curves.json',JSON.stringify(rows,null,2)+'\n');
