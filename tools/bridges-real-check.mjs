// Real Terrain loader + baked road/stream fields + production Vehicle. No renderer or live writes.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {fixture,rig,line,dispose,areas,root} from './bridges-fixture.mjs';
const cases=JSON.parse(readFileSync(root+'tools/fixtures/bridge-launches.json'));
const source=readFileSync(root+'web/src/vehicle.ts','utf8');
const protrusions=[];
async function drive(f,c){
 let start,path,direction=c.direction??c.dir;
 if(c.type==='bridge'){const r=f.roads.roads.find(r=>r.id===c.id);assert.ok(r,'fixture bridge retained');path=line(r);start=path.at(direction===1?-35:path.len+35);start.heading+=direction<0?Math.PI:0;}
 else{const heading=c.heading+(direction<0?Math.PI:0);start={x:c.x-Math.sin(heading)*30+Math.cos(c.heading)*(c.side??0),z:c.z+Math.cos(heading)*30+Math.sin(c.heading)*(c.side??0),heading};}
 await f.load([[start.x,start.z]]);
 const v=new f.Vehicle(rig(THREE),f.terrain,f.roads,-1000);v.assist=0;v.place(start.x,start.z,start.heading);v.vx=Math.sin(v.heading)*20;v.vz=-Math.cos(v.heading)*20;v.speed=20;
 let support=v.y,peak=0,maxVy=0,recovered=false;v.respawn=()=>{recovered=true;};
 // Observe the actual same-position data rebase; it is not a launch and moves the reference with the land.
 const correct=v.correctGround;v.correctGround=function(){const y=this.y;correct.call(this);support+=this.y-y;};
 const random=Math.random;Math.random=()=>.5;
 try{for(let i=0;i<(path?1200:1000);i++){
   if(i%60===0)await f.load([[v.x,v.z]]);
   let steer=0;
   if(path){const hit=f.roads.nearest(v.x,v.z,50,r=>r.id===c.id),h=hit?hit.heading+(direction<0?Math.PI:0):v.heading,err=Math.atan2(Math.sin(h-v.heading),Math.cos(h-v.heading));steer=Math.max(-.5,Math.min(.5,err*2));}
   v.update(1/120,{throttle:path?Math.max(-1,Math.min(1,(20-v.speed)*.3)):0,steer,handbrake:false});
   if(recovered)break;maxVy=Math.max(maxVy,v.vy);
   assert.ok(v.vy<=Math.sqrt(2*9.81*3)+1e-8,`${c.area}/${c.type}/${c.id}: real correction speed ${v.vy}`);
   if(!v.airborne)support=v.y;else peak=Math.max(peak,v.y-support);
 } }finally{Math.random=random;}
 assert.ok(peak<=3.02,`${c.area}/${c.type}/${c.id}: real launch ${peak}m after data rebasing`);
 return{peak,maxVy,recovered};
}
function checkCulvertPin(f,c,culverts){
 const pipe=culverts[c.index];assert.ok(pipe,'culvert fixture has a mapped pipe');
 const x=(pipe.a[0]+pipe.b[0])/2-f.manifest.village[0],z=f.manifest.village[1]-(pipe.a[1]+pipe.b[1])/2,hit=f.roads.nearest(x,z,30,r=>r.id===c.id);
 assert.ok(hit&&Math.hypot(hit.x-c.x,hit.z-c.z)<.01,`${c.area} culvert fixture ${c.index} matches its physical pipe and road`);
}
async function verify(area,replacements={},onlyCase){
 const f=await fixture(area,1,replacements),checks=f.roads.modern.spans;
 const culverts=JSON.parse(readFileSync(root+'data/baked/'+(area==='mabou'?'terrain':'areas/'+area)+'/streams.json')).culverts;
 for(const c of cases)if(c.area===area&&c.type==='culvert')checkCulvertPin(f,c,culverts);
 if(area==='westbay')f.terrain.sites.push(new f.QuarrySite(f.manifest.village));
 const points=checks.flatMap(r=>r.pts);await f.load(points);
 let profiles=0,rays=0,maxPeak=0,maxVy=0;
 // Each actual merged deck is built and tested through its spatial query, including every inferred crossing.
 for(const r of checks){const path=line({pts:r.pts});
  for(let s=0;s<=path.len;s+=Math.max(1,path.len/12)){const p=path.at(s),h=f.roads.deckHeight(p.x,p.z);assert.notEqual(h,null,`${area} span ${r.road.id} has support`);assert.ok(Number.isFinite(h));const contact=f.terrain.withContactHeight({y:h},()=>f.terrain.heightAt(p.x,p.z,h));assert.ok(Math.abs(contact-h)<.00001,'DTM cannot override the exact route deck contact');
    const land=f.terrain.landHeightAt(p.x,p.z),drawn=f.terrain.meshHeightAt(p.x,p.z);assert.ok(land<=h+.025,`${area}/${r.road.id}: retained DTM road cannot cover the deck`);if(Math.max(land,drawn??land)>h+.025)protrusions.push({area,id:r.road.id,s,x:p.x,z:p.z,deck:h,land,drawn});
  }
  f.roads.update(new THREE.Vector3(r.pts[0][0],20,r.pts[0][1]));profiles++;
 }
 f.roads.group.updateMatrixWorld(true);const ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0));
 for(const r of checks){const t=r.triangles;assert.ok(t);
  // Sample the apron at each end and the span itself, from independent triangle centroids.
  for(const k of[0,Math.floor(t.length/18)*9,t.length-9]){const x=(t[k]+t[k+3]+t[k+6])/3,z=(t[k+2]+t[k+5]+t[k+8])/3,d=f.roads.deckHeight(x,z);assert.notEqual(d,null,'smooth approach support');ray.ray.origin.set(x,d+20,z);const hits=ray.intersectObjects(f.roads.group.children,true);assert.ok(hits.some(hit=>Math.abs(hit.point.y-d)<.013),`${area}/${r.road.id}: drawn top equals wheel surface`);rays++;}
 }
 const selected=onlyCase?[onlyCase]:process.argv.includes('--profiles')?[]:cases.filter(c=>c.area===area);
 for(const c of selected){const r=await drive(f,c);maxPeak=Math.max(maxPeak,r.peak);maxVy=Math.max(maxVy,r.maxVy);}
 assert.equal(f.roads.group.children.length,1,'all modern decks use one merged area draw');
 console.log(`PASS ${area}: ${profiles} profiles, ${rays} top/approach rays, ${selected.length} reproduced traces; peak=${maxPeak.toFixed(6)}m vy=${maxVy.toFixed(6)}m/s`);
 dispose(f);return{profiles,rays,traces:selected.length,maxPeak,maxVy};
}
if(!process.argv.includes('--mutation-only'))for(const area of areas)await verify(area);
// Main's sidewalk layer reserves a 1 m walk on the Mabou Highway 19 bridge (Roads.bridgeWalks, road 28). The modern
// deck must widen past it, as the old deck's parapet did, or the slab stands outside the rail over the river.
if(!process.argv.includes('--mutation-only')){
 const f=await fixture('mabou',1),road=f.roads.roads.find(r=>r.id===28);assert.ok(road?.bridge&&road.name==='Highway 19','Mabou Highway 19 bridge is road 28');
 const span=f.roads.modern.spans.find(s=>s.members.has(28)),path=line(road),mid=path.at(path.len/2),cam=new THREE.Vector3(mid.x,0,mid.z);
 const edge=road.halfWidth+.9,at=u=>f.roads.deckHeight(mid.x+Math.cos(mid.heading)*u,mid.z+Math.sin(mid.heading)*u);
 await f.load([[mid.x,mid.z]]);f.roads.update(cam);const narrow=span.width,centre=at(0);
 assert.ok(centre!==null&&at(edge)===null&&at(-edge)===null,'without a walk the deck ends inside the walk');
 f.roads.bridgeWalks.set(28,{side:1,width:1});f.roads.update(cam);
 assert.ok(Math.abs(span.width-(road.halfWidth+1.3))<1e-9,`walk widens the span: ${narrow} -> ${span.width}`);
 for(const u of[edge,-edge]){const y=at(u);assert.ok(y!==null&&Math.abs(y-at(0))<.05,`deck under the walk at ${u} m`);}
 const wide=span.width;f.roads.bridgeWalks.clear();f.roads.update(cam);assert.equal(span.width,wide,'a built deck never narrows again');
 console.log(`PASS Mabou Highway 19 walk: span ${narrow.toFixed(2)} -> ${span.width.toFixed(2)} m half width`);dispose(f);
}
if(process.env.OUT)writeFileSync(process.env.OUT+'/protrusions.json',JSON.stringify(protrusions,null,2)+'\n');
console.log('Terrain protrusion probes:',protrusions.length);
if(process.argv.includes('--mutations')){
 const anchor='THREE.MathUtils.clamp(groundVel, -30, MAX_GROUND_RISE_SPEED)';assert.equal(source.split(anchor).length,2);
 const c=cases.find(c=>c.area==='judique'&&c.type==='culvert'&&c.index===21&&c.dir===1);assert.ok(c);
 await assert.rejects(()=>verify('judique',{'web/src/vehicle.ts':source.replace(anchor,'THREE.MathUtils.clamp(groundVel, -30, 30)')},c),/real correction speed/,'the real Judique Highway19 culvert21 launch must kill the removed cap');
 console.log('KILLED cap removed on real Judique Highway19 culvert 21');
 const f=await fixture('mabou',1),culverts=JSON.parse(readFileSync(root+'data/baked/terrain/streams.json')).culverts,mabou=cases.find(c=>c.area==='mabou'&&c.type==='culvert'&&c.id===60);
 assert.throws(()=>checkCulvertPin(f,{...mabou,index:mabou.index-1},culverts),/matches its physical pipe and road/,'old culvert array index must fail');dispose(f);console.log('KILLED stale Mabou culvert index after land copy');

}
