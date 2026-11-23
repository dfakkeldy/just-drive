// Six-area census using production Roads, Terrain and Vehicle with the live baked inputs read-only.
import {fixture,rig,line,dispose,areas} from './bridges-fixture.mjs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {writeFileSync,mkdirSync} from 'node:fs';
const out=process.env.OUT??'data/work/threads/bridges';mkdirSync(out,{recursive:true});
const rows=[],launches=[];
for(const area of areas){
  const f=await fixture(area,Number(process.env.EXAG??1));
  for(const r of f.roads.roads.filter(r=>r.bridge)){
    const path=line(r),points=[];for(let s=-80;s<=path.len+160;s+=4){const p=path.at(s);points.push([p.x,p.z]);}
    await f.load(points);
    const a=path.at(-3),b=path.at(path.len+3),s0=f.terrain.surfaceAt(a.x,a.z),s1=f.terrain.surfaceAt(b.x,b.z);
    const samples=[];for(let s=0;s<=path.len;s+=Math.min(1,path.len/20)){const p=path.at(s);samples.push({s,...p,land:f.terrain.heightAt(p.x,p.z),deck:f.roads.deckHeight(p.x,p.z)});}
    const usable=samples.filter(p=>p.deck!==null),dip=Math.max(0,...usable.map(p=>p.deck-p.land));
    const deck=f.roads.modern.spans.find(s=>s.members.has(r.id));
    const row={area,id:r.id,name:r.name??'(unnamed)',kind:r.kind,length:path.len,abutments:[s0?.ground,s1?.ground],level:[s0?.level,s1?.level],deck:deck?[f.roads.modern.ownHeight(deck,path.at(0).x,path.at(0).z),f.roads.modern.ownHeight(deck,path.at(path.len).x,path.at(path.len).z)]:null,landRange:[Math.min(...samples.map(p=>p.land)),Math.max(...samples.map(p=>p.land))],dip,ends:[path.at(0),path.at(path.len)],samples};rows.push(row);
    for(const direction of [1,-1]){
      const start=path.at(direction===1?-35:path.len+35),v=new f.Vehicle(rig(THREE),f.terrain,f.roads,-1000);v.assist=0;v.place(start.x,start.z,start.heading+(direction<0?Math.PI:0));
      v.vx=Math.sin(v.heading)*20;v.vz=-Math.cos(v.heading)*20;v.speed=20;
      let air=v.y,peak=0,maxVy=0,where=null,impulse=null;
      for(let i=0;i<1200;i++){
        const hit=f.roads.nearest(v.x,v.z,50,q=>q.id===r.id),heading=hit?hit.heading+(direction<0?Math.PI:0):v.heading;
        const err=Math.atan2(Math.sin(heading-v.heading),Math.cos(heading-v.heading));
        const previous=v.prevGround,px=v.x,pz=v.z;
        v.update(1/120,{throttle:Math.max(-1,Math.min(1,(20-v.speed)*.3)),steer:Math.max(-.5,Math.min(.5,err*2)),handbrake:false});
        if(v.vy>maxVy){maxVy=v.vy;impulse={x:px,z:pz,e:px+f.manifest.village[0],n:f.manifest.village[1]-pz,step:v.prevGround-previous,ground:v.prevGround,vy:v.vy};}
        if(!v.airborne)air=v.y;
        else if(v.y-air>peak){peak=v.y-air;where={x:v.x,z:v.z,e:v.x+f.manifest.village[0],n:f.manifest.village[1]-v.z};}
      }
      if(peak>2)launches.push({area,id:r.id,name:r.name,direction,peak,maxVy,where,impulse});
    }
  }
  console.log(area,rows.filter(r=>r.area===area).length,'bridges',launches.filter(r=>r.area===area).length,'launch traces >2 m');dispose(f);
}
writeFileSync(out+'/inventory.json',JSON.stringify(rows,null,2)+'\n');
writeFileSync(out+'/launches-before.json',JSON.stringify(launches.sort((a,b)=>b.peak-a.peak),null,2)+'\n');
console.log('Worst bridges:',areas.map(area=>{const r=rows.filter(r=>r.area===area).sort((a,b)=>b.dip-a.dip)[0];return{area,id:r.id,name:r.name,length:r.length,dip:r.dip,deck:r.deck,abutments:r.abutments};}));
console.log('Worst launches:',launches.slice(0,12));
