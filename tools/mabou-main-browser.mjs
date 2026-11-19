// RUN=mabou-main-browser.mjs VIEWS="judique|area=judique desktop|x=1&at=624420,5103352,238 low|x=1&q=low&at=624420,5103352,238" tools/yard-shots.sh 1600 900
// Mabou main street (mabou-main.ts): every unit builds as the car drives the street, within its triangle and draw
// ceilings for desktop and LOW, each cluster merges into one mesh per pattern, the replaced baked boxes are left out
// of the drawing but stay properties, the solids block the real vehicle, and other areas never load the builder.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {open,sleep} from './cdp.mjs';
// Measured on apple-check-host (17 Nov 2026): desktop 17,742 triangles in 9 meshes (west 13,223 in 4, east 4,519 in 5), LOW 9,084
// in 6 (west 6,297, east 2,787; phones keep only the siding and shingle patterns). About 15 % headroom; raise only with
// new pictures and a reason.
const CEILING={desktop:{triangles:20400,meshes:10},low:{triangles:10500,meshes:6}};
// The car goes to the west end of the street, then to the east end: each cluster must merge there.
const STOPS={west:[624420,5103352,238],east:[624860,5103568,250]};
const [out,...urls]=process.argv.slice(2);
// The camera drone keeps over the roofs that are drawn (drone.ts roofHeights for the surveyed boxes, MabouMain.roofAt
// for the hand-built street), not over the surveyed boxes the street replaces. A ray straight down through the drawn
// meshes is the truth: the lookup is never under it on any footprint, and a real flight held down over the hall (whose
// drawn roof is 3.6 m over its old box, and whose road wall stands 2.5 m nearer the road) stays over it; where the old
// hall box stood but nothing is drawn now, the drone goes down past the old roof. Pictures: drone-hall-<view>.png.
const DRONE_FOOT=0.106*1.4,EXAG=1.5,SEA=-0.2;
async function droneFloor(page,name){
 const key=async(code,down)=>page.send('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',code,key:code==='ShiftLeft'?'Shift':code.slice(3).toLowerCase(),windowsVirtualKeyCode:code==='ShiftLeft'?16:code.charCodeAt(3)});
 const hold=async(code,ms)=>{await key(code,true);await sleep(ms);await key(code,false);};
 // Ray straight down at (x, z) through every drawn street mesh: the highest surface, or null.
 await page.read(`window.qaHit=(x,z)=>{let top=null;mmm.mabouMain.group.traverse(o=>{if(!o.isMesh||!o.visible)return;const p=o.geometry.attributes.position;
  for(let i=0;i+2<p.count;i+=3){const ax=p.getX(i),az=p.getZ(i),bx=p.getX(i+1),bz=p.getZ(i+1),cx=p.getX(i+2),cz=p.getZ(i+2),d=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(d)<1e-9)continue;
   const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/d,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/d,w=1-u-v;if(u<0||v<0||w<0)continue;const y=u*p.getY(i)+v*p.getY(i+1)+w*p.getY(i+2);if(top===null||y>top)top=y;}});return top;};true`);
 // Every footprint: the centre and four points halfway to its corners.
 const probes=JSON.parse(await page.read(`(async()=>{const m=mmm.mabouMain,[VE,VN]=m.site.village,out=[],{MAIN_PLACES}=await import('/src/mabou-main-site.ts');
  for(const [name,p] of Object.entries(MAIN_PLACES))for(const r of p.rects)for(const [fx,fz] of [[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75]]){
   const lx=r[0]+(r[1]-r[0])*fx,lz=r[2]+(r[3]-r[2])*fz,a=p.az*Math.PI/180,e=p.e+lx*Math.sin(a)+lz*Math.cos(a),n=p.n+lx*Math.cos(a)-lz*Math.sin(a),x=e-VE,z=VN-n;
   let near=-Infinity;for(let dx=-1;dx<=1;dx+=.5)for(let dz=-1;dz<=1;dz+=.5)near=Math.max(near,qaHit(x+dx,z+dz)??-Infinity);
   out.push({name,x,z,hit:qaHit(x,z),near,roof:m.roofAt(x,z)});}
  return JSON.stringify(out);})()`));
 const under=probes.filter(q=>q.hit===null||q.roof===null||q.roof<q.hit-0.01);
 assert.deepEqual(under,[],'the drone lookup is never under a drawn main street roof');
 // The lookup counts a footprint a metre larger all round, so the highest drawn surface within a metre bounds it.
 const over=probes.filter(q=>q.roof-q.near>5.5);
 assert.deepEqual(over,[],'the drone lookup does not clear a roof that is not drawn (at most a ridge and chimney over the probe)');
 // The old hall box (EXAG 1.5, sea -0.2, as main.ts) and a point under it that no drawn roof covers now. Once
 // pipeline/mabou_main.py has replaced the hall with measured blocks, the old surveyed box is the main block's `site`.
 const old=JSON.parse(await page.read(`(async()=>{const list=(await (await fetch('/terrain/buildings.json')).json()).buildings,m=mmm.mabouMain,[VE,VN]=m.site.village;
  const hall=list.find(b=>{const o=b.site??b;return Math.hypot(o.x-624457.41,o.y-5103331.6)<6&&(b.buildingId??b.id)===b.id;});if(!hall)return 'null';const b=hall.site??hall;
  const top=(${SEA})+(b.ground-(${SEA}))*${EXAG}+Math.max(b.ridge,b.eave),a=b.axisDeg*Math.PI/180,ux=Math.sin(a),uz=-Math.cos(a);let free=null;
  for(let u=-b.length/2+1;u<b.length/2-1&&!free;u+=0.5)for(let v=-b.width/2+1;v<b.width/2-1&&!free;v+=0.5){const x=b.x-VE+u*ux-v*uz,z=VN-b.y+u*uz+v*ux,s=mmm.terrain.surfaceAt(x,z);
   if(!s||s.canopy>0||top-s.ground<4)continue;let near=false;for(let dx=-1;dx<=1&&!near;dx+=0.5)for(let dz=-1;dz<=1&&!near;dz+=0.5)near=m.roofAt(x+dx,z+dz)>-Infinity;
   if(!near)free={x,z,ground:s.ground};}
  return JSON.stringify({top,free});})()`));
 assert.ok(old&&old.free,'a point under the old hall box with no drawn roof');
 const hall=probes.find(q=>q.name==='hall');
 // Fly: F lifts the drone off the car; it is set 10 m over the hall's middle and held down onto the drawn roof.
 await hold('KeyF',60);
 for(let i=0;i<40&&!await page.read('mmm.drone.active');i++)await sleep(100);
 assert.ok(await page.read('mmm.drone.active'),'F launches the drone');
 const fly=async(q,y,ms)=>{await page.read(`Object.assign(mmm.drone.state,{x:${q.x},z:${q.z},y:${y},vx:0,vy:0,vz:0});mmm.drone.pitch=-0.75;true`);await hold('ShiftLeft',ms);await sleep(300);return page.read('mmm.drone.state.y');};
 const overHall=await fly(hall,hall.hit+10,5000)-DRONE_FOOT;
 await sleep(600);await page.shot(`${evidence??out}/drone-hall-${name}.png`);
 const overGone=await fly(old.free,old.top+3,5000)-DRONE_FOOT;
 await hold('KeyF',60);
 const result={hallRoof:+hall.hit.toFixed(2),hallOldTop:+old.top.toFixed(2),overHall:+overHall.toFixed(2),goneGround:+old.free.ground.toFixed(2),overGone:+overGone.toFixed(2),probes:probes.length};
 console.log(name,'drone',JSON.stringify(result));
 assert.ok(overHall<=hall.hit+4,`held down, the drone comes down to the hall roof's clearance: skids ${overHall.toFixed(2)}, roof ${hall.hit.toFixed(2)}`);
 assert.ok(overHall>=hall.hit+0.4,`held down over the hall, the drone stays over its drawn roof: skids ${overHall.toFixed(2)}, roof ${hall.hit.toFixed(2)}`);
 assert.ok(overGone<=old.top-1,`where the old hall box stood the drone goes below its old roof: skids ${overGone.toFixed(2)}, old top ${old.top.toFixed(2)}`);
 return result;
}
// Numbers and pictures go to $MMM_CHECK_OUT/evidence/mabou-main-browser/, which check-all keeps after a pass.
const evidence=process.env.MMM_CHECK_OUT?join(process.env.MMM_CHECK_OUT,'evidence','mabou-main-browser'):null;
if(evidence)mkdirSync(evidence,{recursive:true});
for(const url of urls){
 const page=await open(url);
 try {
  await page.send('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});
  await page.navigate(url);
  const params=new URL(url).searchParams,name=params.get('name');
  if(params.get('area')){
   assert.equal(await page.read('mmm.mabouMain'),null);
   assert.equal(await page.read(`performance.getEntriesByType('resource').filter(e=>/\\/src\\/mabou-main\\.ts/.test(e.name)).length`),0,'another area never loads the Mabou main street builder');
   console.log('PASS',params.get('area'),'has no Mabou main street');
  } else {
   for(let i=0;i<120&&!await page.read('!!mmm.mabouMain');i++)await sleep(500);
   for(const [stop,[e,n,h]] of Object.entries(STOPS)){
    await page.read(`(()=>{const [VE,VN]=mmm.mabouMain.site.village,v=mmm.vehicle;v.place(${e}-VE,VN-${n},${h}*Math.PI/180);return true;})()`);
    for(let i=0;i<240&&!await page.read(`mmm.mabouMain.state().${stop}.merged`);i++)await sleep(500);
    assert.ok(await page.read(`mmm.mabouMain.state().${stop}.merged`),`${stop} cluster built and merged`);
   }
   assert.ok(await page.read('mmm.mabouMain.done'),'every unit built');
   const state=await page.read(`(()=>{const m=mmm.mabouMain,clusters={};let meshes=0,triangles=0;const maps=new Set();
    for(const c of m.group.children.filter(c=>!c.isMesh)){let k=0,t=0;c.traverse(o=>{if(o.isMesh){k++;t+=o.geometry.attributes.position.count/3;maps.add(o.material.map?.uuid??'paint');}});clusters[c.name]={meshes:k,triangles:t};meshes+=k;triangles+=t;}
    return {clusters,meshes,triangles,maps:maps.size,keepers:m.group.children.filter(c=>c.isMesh).length,solids:m.site.solids.length,counted:m.triangles,waiting:m.waiting};})()`);
   console.log(name,'measured',JSON.stringify(state));
   const level=params.get('q')==='low'?'low':'desktop',c=CEILING[level];
   assert.deepEqual(Object.keys(state.clusters).sort(),['mabou-main-east','mabou-main-west']);
   for(const [k,s] of Object.entries(state.clusters))assert.ok(s.meshes>=1&&s.meshes<=6,`${k}: one mesh per pattern`);
   assert.ok(state.triangles<=c.triangles,`${level} triangles ${state.triangles} > ${c.triangles}`);
   assert.ok(state.meshes<=c.meshes,`${level} meshes ${state.meshes}`);
   assert.equal(state.counted,state.triangles);assert.equal(state.keepers,0,'the shader keepers go once real meshes use them');
   assert.ok(state.maps<=(level==='low'?3:6),'paint and five patterns (two on LOW)');assert.equal(state.waiting,false);
   if(level==='low'){const desktop=JSON.parse(readFileSync(`${out}/desktop.json`,'utf8'));
    for(const k of Object.keys(state.clusters))assert.ok(state.clusters[k].triangles<desktop.clusters[k].triangles,`${k}: LOW is simpler`);}
   // The replaced boxes leave the drawing (a fake list: one box on each spot, one 7 m away) but stay properties.
   const kept=await page.read(`(()=>{const spots=[[624878.67,5103595.55],[624450.16,5103392.66],[624457.41,5103331.6],[624797.1,5103548.86],[624348.5,5103315],[624288.81,5103268.17],[624403.5,5103344],[624433.71,5103377.14],[624929.72,5103605.14]];
    const list=spots.flatMap(([x,y],i)=>[{id:i*2,x,y},{id:i*2+1,x:x+7,y}]);return mmm.mabouMain.site.drawn(list).map(b=>b.id%2);})()`);
   assert.deepEqual(kept,[1,1,1,1,1,1,1,1,1]);
   // The car is set just inside the end of every fifth solid, as a car arrives: it must be pushed out.
   const contacts=await page.read(`(()=>{const s=mmm.mabouMain.site,v=mmm.vehicle,saved={x:v.x,z:v.z,heading:v.heading,vx:v.vx,vz:v.vz,speed:v.speed};let tested=0;
    try{for(const solid of s.solids.filter((_,i)=>i%5===0)){const x=solid.x+Math.sin(solid.heading)*solid.half*.85,z=solid.z-Math.cos(solid.heading)*solid.half*.85;Object.assign(v,{x,z,vx:0,vz:0,speed:0});mmm.mabouMain.resolveSolids(v);if(Math.hypot(v.x-x,v.z-z)<.1)throw Error('a Mabou main street solid did not block the vehicle');tested++;}}
    finally{Object.assign(v,saved);}return tested;})()`);
   assert.ok(contacts>=15);
   if(level==='desktop')Object.assign(state,{drone:await droneFloor(page,name)});
   console.log(name,JSON.stringify({...state,contacts}));
   if(level==='desktop')writeFileSync(`${out}/desktop.json`,JSON.stringify(state));
   if(evidence)writeFileSync(join(evidence,`${name}.json`),JSON.stringify({...state,contacts},null,1));
  }
  const file=`${evidence??out}/${name}.png`;await page.shot(file);
  assert.deepEqual(page.errors,[]);
 } finally {await page.close();}
}
console.log('PASS mabou-main-browser');
