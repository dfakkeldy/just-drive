// Production car and bike regressions for raised seams, side impacts and real crests.
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {fixture,rig,root} from './bridges-fixture.mjs';
import {readFileSync} from 'node:fs';
const before=process.argv.includes('--before');
async function run(replacements={}){
 const mod=await fixture('mabou',1,replacements),rows=[];
 for(const [name,height,collision,frame] of[
  ['0.41m step',(_x,z)=>z<0?.41:0,false,1/120],
  ['0.41m step, long frame',(_x,z)=>z<0?.41:0,false,.5],
  ['culvert lip',(_x,z)=>z<0&&z>-.4?.9:0,false,1/120],
  ['rail pushes wheels uphill',(x)=>x>.7?1.4:0,true,1/120],
  ['real crest',(_x,z)=>Math.min(12,Math.max(0,-z))*.2,false,1/120],
 ]){
  const terrain={heightAt:height,withContactHeight:(_,f)=>f(),surfaceAt:(x,z)=>({ground:height(x,z),canopy:0,roadDist:0,halfWidth:1000,kind:2,bridge:false,washboard:false,level:8})};
  const roads={nearest:()=>null,deckHeight:()=>null},v=new mod.Vehicle(rig(THREE),terrain,roads,-1000);v.assist=0;v.place(0,10,0);v.vz=name==='real crest'?-30:-20;v.speed=-v.vz;
  let peak=0,maxVy=0,maxStep=0,clearance=0,once=false,airborne=false;
  for(let i=0;i<Math.ceil(8/frame);i++){
   const previous=v.prevGround;
   v.update(frame,{throttle:0,steer:0,handbrake:false},()=>{
    if(collision&&!once&&v.z<0){
     const y=v.y,vy=v.vy;
     mod.pushOut(v,[{x:-.6,z:v.z,half:8,halfWidth:.5,heading:0}]);
     assert.equal(v.y,y,'pushOut position correction has no vertical component');assert.equal(v.vy,vy,'pushOut impulse has no vertical component');once=true;
    }
   });
   airborne ||= v.airborne;
   peak=Math.max(peak,v.y-(name==='real crest'?2.4:collision?1.4:name==='culvert lip'?.9:.41));clearance=Math.max(clearance,v.y-v.prevGround);maxVy=Math.max(maxVy,v.vy);maxStep=Math.max(maxStep,v.prevGround-previous);
  }
  rows.push({name,peak,maxVy,maxStep,clearance,airborne});
  if(!before){assert.equal(airborne,name==='real crest',`${name}: only the real crest can launch`);assert.ok(maxVy<=Math.sqrt(2*9.81*3)+1e-9,`${name}: correction speed ${maxVy}`);assert.ok(peak<=3.05,`${name}: launch ${peak}m`);}
 }
 if(!before)assert.ok(rows.at(-1).clearance>.05,'ordinary crest still gives a real jump');
 for(const crest of[false,true]){
  const height=(_x,z)=>crest?Math.min(12,Math.max(0,-z))*.2:z<0?.41:0;
  const terrain={heightAt:height,withContactHeight:(_,f)=>f(),surfaceAt:(x,z)=>({ground:height(x,z),canopy:0,roadDist:0,halfWidth:1000,kind:5,bridge:false,washboard:false,level:8})};
  const v=new mod.BikeRide({root:new THREE.Group(),pose(){},driverEye:new THREE.Object3D()},terrain,{nearest:()=>null,deckHeight:()=>null},-1000);
  v.place(0,10,0);v.vz=crest?-30:-20;v.speed=-v.vz;let peak=0,maxVy=0,clearance=0,airborne=false;
  for(let i=0;i<1200;i++){v.update(1/120,{throttle:0,steer:0,handbrake:false});airborne ||= v.airborne;peak=Math.max(peak,v.y-(crest?2.4:.41));maxVy=Math.max(maxVy,v.vy);clearance=Math.max(clearance,v.y-v.prevGround);}
  const name=crest?'bike real crest':'bike 0.41m step';rows.push({name,peak,maxVy,clearance,airborne});
  if(!before){assert.equal(airborne,crest,`${name}: only the real crest can launch`);assert.ok(maxVy<=Math.sqrt(2*9.81*3)+1e-9,`${name}: correction speed ${maxVy}`);assert.ok(peak<=3.05,`${name}: launch ${peak}m`);if(crest)assert.ok(clearance>.1,'bike crest jump remains');}
 }
 return rows;
}
const rows=await run();console.log(JSON.stringify(rows,null,2));
if(process.argv.includes('--mutations')){
 const file='web/src/ground-motion.ts',s=readFileSync(root+file,'utf8'),anchor='if (Math.abs(grade - earlierGrade) > .22) return null;';
 assert.equal(s.split(anchor).length,2,'one approach support check');
 await assert.rejects(()=>run({[file]:s.replace(anchor,'')}),/step: only the real crest can launch/,'the raised seam rejects a mismatched approach');
 console.log('KILLED approach continuity removed');
}
