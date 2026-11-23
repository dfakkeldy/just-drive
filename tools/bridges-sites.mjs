// Bounded real-land scouting beyond bridges: every culvert, quarry road edges and the mine approach.
import {fixture,rig,line,dispose,areas,root} from './bridges-fixture.mjs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {readFileSync,writeFileSync} from 'node:fs';
const results=[];
process.on('uncaughtException',e=>{console.error(e.message);process.exit(1);});
for(const area of areas){
 const f=await fixture(area,1),base=root+'data/baked/'+(area==='mabou'?'terrain':'areas/'+area),streams=JSON.parse(readFileSync(base+'/streams.json'));
 await f.load(f.roads.roads.filter(r=>r.bridge).flatMap(r=>r.pts));
 const candidates=[];
 for(const [i,c] of streams.culverts.entries()){
  const x=(c.a[0]+c.b[0])/2-f.manifest.village[0],z=f.manifest.village[1]-(c.a[1]+c.b[1])/2,hit=f.roads.nearest(x,z,30,r=>!r.bridge);
  if(hit)candidates.push({type:'culvert',index:i,id:hit.road.id,name:hit.road.name,x:hit.x,z:hit.z,heading:hit.heading});
 }
 if(area==='westbay'){
  f.terrain.sites.push(new f.QuarrySite(f.manifest.village));
  for(const r of f.roads.roads)for(let i=0;i<r.pts.length-1;i+=12){const[x,z]=r.pts[i],e=x+f.manifest.village[0],n=f.manifest.village[1]-z;if(e>630200&&e<633200&&n>5061600&&n<5066500){const b=r.pts[i+1];candidates.push({type:'quarry-road-edge',id:r.id,name:r.name,x,z,heading:Math.atan2(b[0]-x,z-b[1]),side:r.halfWidth+1});}}
 }
 if(area==='mabou'){
  const m=f.manifest,edge=120,bounds=[m.mid[0]-m.village[0]+edge,m.village[1]-m.mid[3]+edge,m.mid[2]-m.village[0]-edge,m.village[1]-m.mid[1]-edge];
  const p=f.mineRoadEnd(f.roads,bounds);if(p)candidates.push({type:'mine-approach',...p});
 }
 for(const c of candidates){
  const points=[];for(let d=-230;d<=230;d+=10)points.push([c.x+Math.sin(c.heading)*d+Math.cos(c.heading)*(c.side??0),c.z-Math.cos(c.heading)*d+Math.sin(c.heading)*(c.side??0)]);
  await f.load(points);
  for(const dir of[1,-1]){
   const h=c.heading+(dir===1?0:Math.PI),start={x:c.x-Math.sin(h)*30+Math.cos(c.heading)*(c.side??0),z:c.z+Math.cos(h)*30+Math.sin(c.heading)*(c.side??0)};
   const v=new f.Vehicle(rig(THREE),f.terrain,f.roads,-1000);v.assist=0;v.place(start.x,start.z,h);v.vx=Math.sin(h)*20;v.vz=-Math.cos(h)*20;v.speed=20;
   let peak=0,contact=v.y,maxVy=0,impulse=null,recovered=false;v.respawn=()=>{recovered=true;};
   for(let i=0;i<1000;i++){
    if(i%60===0)await f.load([[v.x,v.z]]);
    const g=v.prevGround,x=v.x,z=v.z;v.update(1/120,{throttle:0,steer:0,handbrake:false});
    if(recovered)break; // A water recovery ends a local trace; never measure a respawn as flight.
    if(v.vy>maxVy){maxVy=v.vy;impulse={e:x+f.manifest.village[0],n:f.manifest.village[1]-z,step:v.prevGround-g,vy:v.vy};}
    if(!v.airborne)contact=v.y;else peak=Math.max(peak,v.y-contact);
   }
   results.push({area,...c,dir,peak,maxVy,impulse,recovered});
  }
 }
 console.log(area,candidates.length,'sites',results.filter(r=>r.area===area&&r.peak>2).length,'launches >2m');writeFileSync('data/work/threads/bridges/sites-before.json',JSON.stringify(results,null,2)+'\n');dispose(f);
}
results.sort((a,b)=>b.peak-a.peak);writeFileSync('data/work/threads/bridges/sites-before.json',JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results.filter(r=>r.peak>5).slice(0,15),null,2));
