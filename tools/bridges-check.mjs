// Node-only geometric and driving contracts, through production Roads and Vehicle.
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {fixture,rig,root} from './bridges-fixture.mjs';
import {readFileSync} from 'node:fs';
async function contracts(replacements={}){
 const mod=await fixture('mabou',1,replacements);
 // Two adjoining records cross ONE channel. The middle endpoint is not a bank.
 const height=(x,z)=>z>0||z< -40?10+x*.005:Math.max(0,10-Math.min(-z,40+z)*2);
 const terrain={cartRoads:false,dataRevision:1,seaLevel:-.2,heightAt:height,withContactHeight:(_,f)=>f(),surfaceAt:(x,z)=>({ground:height(x,z),level:8,canopy:0,roadDist:0,halfWidth:3.6,kind:1,bridge:true,washboard:false})};
 const road=(id,from,to)=>({id,name:'Fixture bridge',kind:1,halfWidth:3.6,bridge:true,pts:[[0,from],[0,to]]});
 const roads=new mod.Roads({roads:[road(1,0,20),road(2,20,40)]},[0,0],terrain);
 const middle=roads.deckHeight(0,-20);
 assert.ok(middle>9.9,`joined span must use external abutments, not channel: ${middle}`);
 const support=[];
 for(let s=-24;s<=64;s+=.1){const d=roads.deckHeight(0,-s);support.push(d??height(0,-s));}
 for(let i=1;i<support.length;i++)assert.ok(Math.abs(support[i]-support[i-1])<.04,'smooth approaches without support steps or dips');
 const first=roads.deckHeight(0,-19.999),second=roads.deckHeight(0,-20.001);
 assert.ok(Math.abs(first-second)<.001,'joined records share one plane');
 roads.update(new THREE.Vector3(0,20,-20));roads.group.updateMatrixWorld(true);
 assert.equal(roads.group.children.length,1,'modern bridges merge into one area draw');
 for(const r of roads.modern.spans){const n=r.geometry.getAttribute('normal');for(let i=0;i<r.triangles.length/3;i++)assert.ok(n.getY(i)>.99,'flat deck top normals point up for lighting and shadow bias');}
 const ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0));
 for(const s of[-12,-4,0,3,10,19.9,20.1,30,40,44,52])for(const x of[-2.5,.7,2.5]){
  const d=roads.deckHeight(x,-s);assert.notEqual(d,null,'top covers the wheel corridor');
  ray.ray.origin.set(x,50,-s);const hit=ray.intersectObjects(roads.group.children,true)[0];
  assert.ok(hit,'deck top is visible at contact');assert.ok(Math.abs(hit.point.y-d)<.012,`drawn deck is wheel support at ${x},${s}: ${hit.point.y}/${d}`);
 }
 const v=new mod.Vehicle(rig(THREE),terrain,roads,-.2);v.assist=0;v.place(0,25,0);v.vz=-20;v.speed=20;
 let maxRise=0;for(let i=0;i<800;i++){v.update(1/120,{throttle:.2,steer:0,handbrake:false});maxRise=Math.max(maxRise,v.y-10);}
 assert.ok(maxRise<.3,`real Vehicle crosses joined bridge without launch: ${maxRise}`);
 assert.ok(v.z< -45,'real Vehicle completes the bridge crossing');
 // A genuine airborne velocity is not a ground correction and must retain gravity alone.
 v.y=40;v.vy=12;v.update(1/120,{throttle:0,steer:0,handbrake:false});
 assert.ok(Math.abs(v.vy-(12-9.81/120))<1e-9,'airborne velocity is not globally capped');
 const curved=new mod.Roads({roads:[road(3,0,40),{id:4,name:'Bending approach',kind:1,halfWidth:3.6,bridge:false,pts:[[-16,-12],[-8,-4],[0,0]]}]},[0,0],{...terrain,heightAt:()=>10,surfaceAt:()=>({ground:10,level:8,kind:9})});
 assert.notEqual(curved.deckHeight(-7.16,3.58),null,'apron follows the bending bank road');
 assert.equal(curved.deckHeight(0,14),null,'apron does not continue straight into the gully beside that road');
 const builds=roads.modern.audit.builds;
 for(const grid of[roads.modern.cells,...roads.modern.spans.map(r=>r.cells)]){const get=grid.get.bind(grid);grid.get=k=>{assert.equal(typeof k,'number','wheel queries use numeric keys');return get(k);};}
 for(let i=0;i<100;i++)assert.notEqual(roads.deckHeight(.4,-20),null);
 assert.equal(roads.modern.audit.builds,builds,'cached wheel reads allocate no new geometry');
 // Real Mabou spans, no land needed. at() takes the segment the old linear scan took: the first i with
 // s<=cum[i+1], clamped to the last segment, segment 0 for NaN. At an exact joint the direction shows the tie.
 const real=mod.roads.modern;let atInputs=0;
 for(const r of real.spans){const last=r.pts.length-2;
  for(const s of[0,r.length,NaN,...r.cum,...r.cum.map(c=>c+1e-9),...r.cum.map(c=>c-1e-9)]){
   if(s<0&&r.start||s>r.length&&r.end)continue;
   let i=0;while(i<last&&s>r.cum[i+1])i++;
   const a=r.pts[i],b=r.pts[i+1],n=r.cum[i+1]-r.cum[i]||1,p=real.at(r,s);
   assert.ok(Object.is(p.nx,-(b[1]-a[1])/n)&&Object.is(p.nz,(b[0]-a[0])/n)&&Object.is(p.x,a[0]+(b[0]-a[0])*((s-r.cum[i])/n)),`at() segment rule: span ${r.road.id} s=${s}`);atInputs++;
  }}
 // update() builds a span only when its deck line is within 1500 m of the camera (main: pts[0] within 1500 m).
 // At the Mabou start pose some spans lie inside the old 1500 m box but farther than 1500 m from their deck line.
 const village=mod.manifest.village,cam=new THREE.Vector3(624450-village[0],20,village[1]-5103340),eager=[];
 real.ensure=r=>{eager.push(real.spans.indexOf(r));};try{real.update(cam);}finally{delete real.ensure;}
 const line=r=>Math.min(...r.pts.slice(1).map((b,j)=>{const a=r.pts[j],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((cam.x-a[0])*dx+(cam.z-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(cam.x-a[0]-dx*t,cam.z-a[1]-dz*t);}));
 const index=real.spans.map((_,i)=>i),near=index.filter(i=>line(real.spans[i])<1500);
 const box=index.filter(i=>{const r=real.spans[i];return cam.x>r.x0-1500&&cam.x<r.x1+1500&&cam.z>r.z0-1500&&cam.z<r.z1+1500;});
 assert.deepEqual(eager,near,'update() builds only the spans whose deck line is within 1500 m');
 assert.ok(near.length>0&&box.length>near.length,`the start pose has near spans and far spans in the box: ${near}/${box}`);
 return{middle,maxRise,draws:roads.group.children.length,atInputs,eager:eager.length,farInBox:box.length-near.length};
}
console.log('PASS',await contracts());
if(process.argv.includes('--mutations')){
 const file='web/src/modern-bridges.ts',s=readFileSync(root+file,'utf8'),anchor="if(along>=0&&along<=r.length){const t=along/r.length,smooth=r.road.kind<=3&&r.length>=20&&Math.abs(r.y1-r.y0)/r.length<.06;return r.y0+(r.y1-r.y0)*(smooth?t*t*(3-2*t):t);}";
 assert.equal(s.split(anchor).length,2,'one deck plane mutation');
 await assert.rejects(()=>contracts({[file]:s.replace(anchor,'if(along>=0&&along<=r.length)return this.land(x,z)??0;')}),/external abutments/,'terrain-draped deck must fail production support assertion');
 console.log('KILLED deck height taken from channel terrain');
 for(const [name,from,to,error] of[
  ['at() segment tie rule','if(s>cum[mid+1])lo=mid+1','if(s>=cum[mid+1])lo=mid+1',/at\(\) segment rule/],
  ['far spans in the box build eagerly','&&nearLine(r.pts,cam.x,cam.z,DRAW))this.ensure(r);',')this.ensure(r);',/deck line is within 1500 m/],
 ]){
  assert.equal(s.split(from).length,2,'one mutation anchor: '+name);
  await assert.rejects(()=>contracts({[file]:s.replace(from,to)}),error,name+' must fail');
  console.log('KILLED '+name);
 }
}
