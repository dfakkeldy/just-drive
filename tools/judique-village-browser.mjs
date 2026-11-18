// RUN=judique-village-browser.mjs VIEWS="mabou|x=1 desktop|area=judique&at=617128,5081470,350 low|area=judique&q=low&at=617128,5081470,350" tools/yard-shots.sh 1600 900
// The heart of Judique (judique-village.ts): every place builds near the start on Highway 19, within its triangle and
// draw ceilings for desktop and LOW, the replaced baked boxes are gone, and the solids block the real vehicle.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {open,sleep} from './cdp.mjs';
// Measured on apple-check-host (17 Nov 2026): desktop 16,230 triangles in 18 meshes, LOW 8,794 in 18. About 20 % headroom;
// raise only with new pictures and a reason.
const CEILING={desktop:{triangles:19500,meshes:18},low:{triangles:10600,meshes:18}};
const PLACES=['church','music','hall','mansard','store','garage'];
const [out,...urls]=process.argv.slice(2);
for(const url of urls){
 const page=await open(url);
 try {
  await page.send('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});
  await page.navigate(url);
  const params=new URL(url).searchParams,name=params.get('name');
  if(params.get('area')==='judique'){
   for(let i=0;i<180&&!await page.read('mmm.village?.done');i++)await sleep(500);
   assert.ok(await page.read('mmm.village?.done'),'every Judique place built');
   const state=await page.read(`(()=>{const v=mmm.village,places={};let meshes=0,triangles=0;const maps=new Set();
    for(const g of v.group.children.filter(c=>!c.isMesh)){let m=0,t=0;g.traverse(o=>{if(o.isMesh){m++;t+=o.geometry.attributes.position.count/3;maps.add(o.material.map?.uuid??'paint');}});places[g.name]={meshes:m,triangles:t};meshes+=m;triangles+=t;}
    return {places,meshes,triangles,maps:maps.size,solids:v.site.solids.length,counted:v.triangles};})()`);
   console.log(name,'measured',JSON.stringify(state));
   const level=params.get('q')==='low'?'low':'desktop',c=CEILING[level];
   assert.deepEqual(Object.keys(state.places).sort(),PLACES.map(p=>`judique-${p}`).sort());
   for(const [place,s] of Object.entries(state.places))assert.ok(s.meshes>=1&&s.meshes<=5,`${place}: one mesh per pattern`);
   assert.ok(state.triangles<=c.triangles,`${level} triangles ${state.triangles} > ${c.triangles}`);
   assert.ok(state.meshes<=c.meshes,`${level} meshes ${state.meshes}`);
   assert.equal(state.counted,state.triangles);assert.equal(await page.read(`mmm.village.group.children.filter(c=>c.isMesh).length`),0,'the shader keepers go once every place is built');assert.ok(state.maps<=5,'paint and four patterns');
   if(level==='low'){const desktop=JSON.parse(readFileSync(`${out}/desktop.json`,'utf8'));
    for(const p of Object.keys(state.places))assert.ok(state.places[p].triangles<desktop.places[p].triangles,`${p}: LOW is simpler`);}
   // The car is set just inside the end of every fifth solid (strips of one building share their ends), as a car arrives.
   // The replaced baked boxes are not drawn: a fake list with one box on each spot and one 7 m away keeps only the far ones.
   const kept=await page.read(`(()=>{const spots=[[617126.6,5081683.9],[617075,5081537],[617029.3,5081588.6],[617145.3,5081641.7],[617107.2,5081472.6],[617181.4,5081286]];
    const list=spots.flatMap(([x,y],i)=>[{id:i*2,x,y},{id:i*2+1,x:x+7,y}]);return mmm.village.site.buildings(list).map(b=>b.id%2);})()`);
   assert.deepEqual(kept,[1,1,1,1,1,1]);
   const contacts=await page.read(`(()=>{const s=mmm.village.site,v=mmm.vehicle,saved={x:v.x,z:v.z,heading:v.heading,vx:v.vx,vz:v.vz,speed:v.speed};let tested=0;
    try{for(const solid of s.solids.filter((_,i)=>i%5===0)){const x=solid.x+Math.sin(solid.heading)*solid.half*.85,z=solid.z-Math.cos(solid.heading)*solid.half*.85;Object.assign(v,{x,z,vx:0,vz:0,speed:0});mmm.village.resolveSolids(v);if(Math.hypot(v.x-x,v.z-z)<.1)throw Error('a Judique solid did not block the vehicle');tested++;}}
    finally{Object.assign(v,saved);}return tested;})()`);
   assert.ok(contacts>=6);
   console.log(name,JSON.stringify({...state,contacts}));
   if(level==='desktop')(await import('node:fs')).writeFileSync(`${out}/desktop.json`,JSON.stringify(state));
  } else {
   assert.equal(await page.read('mmm.village'),null);
   assert.equal(await page.read(`performance.getEntriesByType('resource').filter(e=>/\\/src\\/judique-village\\.ts/.test(e.name)).length`),0,'Mabou never loads the Judique builder');
   console.log('PASS Mabou has no Judique village instance or builder load');
  }
  const file=`${out}/${name}.png`;await page.shot(file);
  assert.deepEqual(page.errors,[]);
 } finally {await page.close();}
}
console.log('PASS judique-village-browser');
