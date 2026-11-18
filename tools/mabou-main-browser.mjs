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
   console.log(name,JSON.stringify({...state,contacts}));
   if(level==='desktop')writeFileSync(`${out}/desktop.json`,JSON.stringify(state));
   if(evidence)writeFileSync(join(evidence,`${name}.json`),JSON.stringify({...state,contacts},null,1));
  }
  const file=`${evidence??out}/${name}.png`;await page.shot(file);
  assert.deepEqual(page.errors,[]);
 } finally {await page.close();}
}
console.log('PASS mabou-main-browser');
