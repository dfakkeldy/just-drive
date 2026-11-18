// Real Mail/Props and Mabou mailbox positions; flat stand-in ground, no renderer or browser.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { Mail } from '../web/src/mail.ts';
import { Props } from '../web/src/props.ts';
import { MAIL_CYCLE } from '../web/src/mail-flight.ts';
const raw=readFileSync('data/baked/terrain/props.json','utf8');
const village=JSON.parse(readFileSync('data/baked/terrain/manifest.json','utf8')).village;
const data=JSON.parse(raw), ground={heightAt:()=>0,surfaceAt:()=>null,dataRevision:0,contactRevision:0,sites:[]};
const props=new Props(data,village,ground), mail=new Mail(ground,props,[],village,true);
const eye=new THREE.Object3D(), vehicle={x:0,z:0,heading:0,vx:0,vz:0,speed:0,car:{driverEye:eye}};
let due=0; mail.service={condition:i=>i===due?'ready':'none',deliver:()=>true,ground(){}};
const digest=createHash('sha256'), profiles={};
const empty=()=>({ticks:0,boxes:0,selection:0,filter:0,hits:0});
function pose(box,ahead,heading,offset,speed){
 const rx=Math.cos(heading),rz=Math.sin(heading),fx=Math.sin(heading),fz=-Math.cos(heading);
 Object.assign(vehicle,{x:box.x-rx*offset-fx*ahead,z:box.z-rz*offset-fz*ahead,heading,vx:fx*speed,vz:fz*speed,speed});
 eye.position.set(vehicle.x+rx*.43+fx*.08,1.36,vehicle.z+rz*.43+fz*.08);eye.updateMatrixWorld();
}
function preview(kind){
 const p=mail.prepareThrow(vehicle,kind);
 digest.update(Buffer.from(new Float64Array([p.x,p.y,p.z,p.vx,p.vy,p.vz,mail.cue?1:0,mail.cueIndex]).buffer));
}
for(const profile of ['moving','unchanged-warm','same-frame-repeat']) {
 const samples=[];
 for(let stop=0;stop<16;stop++) {
  due=Math.floor(stop*props.mail.length/16);const target=props.mail[due];
  mail.reset();mail.thrown=stop%MAIL_CYCLE.length;const kind=MAIL_CYCLE[mail.thrown];
  const heading=[0,.4,Math.PI/2,2][stop%4],speed=[20,40,60][stop%3]/3.6;
  pose(target,7.3,heading,4,speed);globalThis.__previewCost=empty();preview(kind);
  for(let frame=0;frame<16;frame++) {
   pose(target,profile==='unchanged-warm'?7.3:9-frame*speed/60,heading,4,speed);
   globalThis.__previewCost=empty();preview(kind);if(profile==='same-frame-repeat')preview(kind);
   samples.push(globalThis.__previewCost);
  }
 }
 profiles[profile]={frames:samples.length};
 for(const key of Object.keys(empty())) profiles[profile][key]={mean:samples.reduce((s,x)=>s+x[key],0)/samples.length,max:Math.max(...samples.map(x=>x[key]))};
}
// Exact-cache invalidation witnesses: a remote box moves into the path, falls, then ground changes.
const saved=props.mail.map(p=>[p.x,p.z,p.motion.down,p.heading]);
props.mail.forEach((p,i)=>{p.x=10000+i*10;p.z=10000;p.motion.down=false;});
props.mail[1].x=4;props.mail[1].z=0;props.mail[1].heading=270;props.mail[0].heading=270;due=1;mail.reset();mail.thrown=0;pose(props.mail[1],7.3,0,4,40/3.6);
for(const i of [0,1]){props.data.mailboxes[i].style=0;props.data.mailboxes[i].tilt=0;}
globalThis.__previewCost=empty();preview(0);preview(0);
props.mail[0].x=4;props.mail[0].z=0;preview(0);
props.mail[0].motion.down=true;preview(0);
ground.heightAt=x=>.25*x;ground.dataRevision++;preview(0);
due=-1;preview(0);due=1;preview(0);
props.mail.forEach((p,i)=>{[p.x,p.z,p.motion.down,p.heading]=saved[i];});
console.log(JSON.stringify({source:'5d678ed05e27a6d38669f36243840a3b139f62da',dataHash:createHash('sha256').update(JSON.stringify([data.mailboxes.map(p=>[p.x,p.y,p.heading,p.style,p.tilt,p.group,p.parcelBox]),data.communityBoxes.map(p=>[p.x,p.y,p.heading,p.modules]),village])).digest('hex'),mailboxes:props.mail.length,sites:props.sites.length,digest:digest.digest('hex'),profiles}));
