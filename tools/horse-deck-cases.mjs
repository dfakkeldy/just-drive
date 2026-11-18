import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {Vehicle} from '../web/src/vehicle.ts';
import {HORSE_SPEC} from '../web/src/horse.ts';
import {gaitAt} from '../web/src/horse-motion.ts';
const node=()=>new THREE.Group();
export async function horseDeckCases({terrain,roads,road,hill,at,path,pathCum,before,len}){
 const v=new Vehicle({root:node(),body:node(),driverEye:node(),brakeLights:[],steer:{fl:node(),fr:node()},wheels:{fl:node(),fr:node(),rl:node(),rr:node()}},terrain,roads,-.2,HORSE_SPEC);v.assist=0;
 let resets=0,crossings=0;
 for(const s of [-8,-3,0,.5,len-.5,len,len+3,len+8])for(const side of [-road.halfWidth-2,-road.halfWidth-.8,0,road.halfWidth+.8,road.halfWidth+2]){
  const p=at(s,side);v.restart(p.x,p.z,p.h);terrain.withGroundContact(v,()=>v.update(1/120,{throttle:0,steer:0,handbrake:true}));assert(Math.abs(v.vy)<.65,'horse reset '+road.id+' '+hill);assert(Math.abs(v.speed)<.1,'horse reset stays at rest');resets++;
 }
 for(const s of [-3,0,len/2,len,len+3])for(const side of [-road.halfWidth-2,0,road.halfWidth+2]){
  const p=at(s,side);v.bounds=[p.x-40,p.z-40,p.x+700,p.z+700];v.trail=[{x:p.x,z:p.z,heading:p.h}];v.x=p.x-45;v.z=p.z-45;v.respawn();terrain.withGroundContact(v,()=>v.update(1/120,{throttle:0,steer:0,handbrake:true}));assert(Math.abs(v.vy)<.65,'horse edge respawn '+road.id+' '+hill);v.bounds=null;
 }
 for(const cruise of [1.7,3.8,6.5,9])for(const direction of [1,-1])for(const run of ['inbound','deck']){
  const begin=run==='deck'?(direction===1?0:len):(direction===1?-(before?8:3):len+8),p=at(begin);v.restart(p.x,p.z,p.h+(direction<0?Math.PI:0));v.vx=Math.sin(v.heading)*cruise;v.vz=-Math.cos(v.heading)*cruise;v.speed=cruise;
  let progress=begin,done=false,coreSamples=0,gaitSamples=0;const expected=cruise<2.5?'walk':cruise<5?'trot':cruise<8?'canter':'gallop';
  for(let step=0;step<120*(len+80);step++){
   let best=Infinity;
   for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],dx=b[0]-a[0],dz=b[1]-a[1],d=pathCum[i]-pathCum[i-1],t=Math.max(i===1?-12/d:0,Math.min(i===path.length-1?1+12/d:1,((v.x-a[0])*dx+(v.z-a[1])*dz)/(d*d))),x=a[0]+t*dx,z=a[1]+t*dz,dist=Math.hypot(x-v.x,z-v.z);if(dist<best){best=dist;progress=pathCum[i-1]+t*d-before;}}
   const goal=at(progress+direction*5),heading=Math.atan2(goal.x-v.x,v.z-goal.z),err=Math.atan2(Math.sin(heading-v.heading),Math.cos(heading-v.heading));
   terrain.withGroundContact(v,()=>v.update(1/120,{throttle:Math.max(-1,Math.min(1,(cruise-Math.abs(v.speed))*3)),steer:Math.max(-1,Math.min(1,err*2)),handbrake:false}));
   if(progress>2&&progress<len-2){assert.equal(v.airborne,false,'horse grounded across deck');if(gaitAt(v.speed)===expected)gaitSamples++;coreSamples++;}
   if(direction===1&&progress>=len+3||direction===-1&&progress<=-3){done=true;break;}
  }
  assert(done,`inbound horse crossing completed ${road.id} hill ${hill} direction ${direction} cruise ${cruise} progress ${progress} pose ${JSON.stringify({x:v.x,z:v.z,y:v.y,speed:v.speed,surface:v.surfaceName,deck:roads.deckHeight(v.x,v.z),ground:terrain.heightAt(v.x,v.z),heading:v.heading,aprons:terrain.bridgeApproaches.aprons.map(a=>({ready:a.ready,height:a.height(v.x,v.z),box:a.site.box,known:a.refs.filter(p=>p.known).length,total:a.refs.length}))})}`);assert(coreSamples>0);if(run==='deck')assert(gaitSamples>0,`requested gait ${expected} exercised on deck ${road.id} hill ${hill} direction ${direction}`);crossings++;
 }
 console.log('PASS HORSE_INBOUND_AND_DECK',JSON.stringify({road:road.id,hill,resets,crossings}));
}
