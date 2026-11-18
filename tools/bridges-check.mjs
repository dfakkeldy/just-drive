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
 return{middle,maxRise,draws:roads.group.children.length};
}
console.log('PASS',await contracts());
if(process.argv.includes('--mutations')){
 const file='web/src/modern-bridges.ts',s=readFileSync(root+file,'utf8'),anchor="if(along>=0&&along<=r.length){const t=along/r.length,smooth=r.road.kind<=3&&r.length>=20&&Math.abs(r.y1-r.y0)/r.length<.06;return r.y0+(r.y1-r.y0)*(smooth?t*t*(3-2*t):t);}";
 assert.equal(s.split(anchor).length,2,'one deck plane mutation');
 await assert.rejects(()=>contracts({[file]:s.replace(anchor,'if(along>=0&&along<=r.length)return this.land(x,z)??0;')}),/external abutments/,'terrain-draped deck must fail production support assertion');
 console.log('KILLED deck height taken from channel terrain');
}
