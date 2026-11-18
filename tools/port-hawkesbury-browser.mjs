// RUN=port-hawkesbury-browser.mjs VIEWS="mabou|x=1 desktop|area=pointtupper&at=628293.9,5052678.8,219 low|area=pointtupper&q=low&at=628293.9,5052678.8,219" tools/yard-shots.sh 1600 900
// Port Hawkesbury (port-hawkesbury.ts): every group builds when the car comes near, within its triangle and mesh ceilings
// for desktop and LOW (LOW simpler per group), the replaced baked boxes are gone, the solids block the real vehicle, the
// lot paint lies on the ground. Seat and chase pictures from the road at each site. A view named *-before is the same
// drive with ?hawkesbury=0 (pictures only). Mabou never loads the builder. PH_PICTURES=<folder> keeps the pictures.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {open,sleep} from './cdp.mjs';
// Measured on apple-check-host (17 Nov 2026): all five groups about 47,000 triangles in 19 meshes on desktop, 35,000 on LOW (the
// parked vehicles, instanced on desktop and baked on LOW, are counted apart). About 20 % headroom; raise only with new pictures and a reason.
const CEILING={desktop:{triangles:56000,meshes:24},low:{triangles:42000,meshes:24}};
// Poses on the road: a map point (snapped to the nearest carriageway) and the azimuth the car faces.
const POSES=[
 {group:'reeves',at:[628293.9,5052678.8],look:219},
 {group:'plaza',at:[628489.9,5052584.7],look:332},
 {group:'eastNorth',at:[629880,5052955],look:62},
 {group:'eastSouth',at:[630040,5052880],look:228},
 {group:'garage',at:[628160,5052134],look:67},
 {group:'garage',name:'garage-west',at:[628200.6,5052172.5],look:128},
];
const GROUPS=['reeves','plaza','eastNorth','eastSouth','garage'];
const [out,...urls]=process.argv.slice(2),keep=process.env.PH_PICTURES;
if(keep)mkdirSync(keep,{recursive:true});
const shot=async(page,file)=>{await page.shot(`${out}/${file}`);if(keep)writeFileSync(`${keep}/${file}`,readFileSync(`${out}/${file}`));};
for(const url of urls){
 const page=await open(url);
 try {
  await page.send('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});
  await page.navigate(url);
  const params=new URL(url).searchParams,name=params.get('name');
  if(params.get('area')!=='pointtupper'){
   assert.equal(await page.read('mmm.hawkesbury'),null);
   assert.equal(await page.read(`performance.getEntriesByType('resource').filter(e=>/\\/src\\/port-hawkesbury\\.ts/.test(e.name)).length`),0,'Mabou never loads the Port Hawkesbury builder');
   console.log('PASS Mabou has no Port Hawkesbury instance or builder load');
   assert.deepEqual(page.errors,[]);continue;
  }
  const before=params.get('hawkesbury')==='0',level=params.get('q')==='low'?'low':'desktop';
  if(before)assert.equal(await page.read('mmm.hawkesbury'),null,'?hawkesbury=0 builds nothing');
  // Hold the car still wherever it is put.
  await page.read(`(()=>{const v=mmm.vehicle;v.update=()=>{};return true})()`);
  const measured={};
  for(const pose of POSES){
   const where=await page.read(`(()=>{const V=mmm.terrain.manifest.village,x=${pose.at[0]}-V[0],z=V[1]-${pose.at[1]},hit=mmm.roads.nearest(x,z,40);
    const p=hit?{x:hit.x,z:hit.z}:{x,z},v=mmm.vehicle;Object.assign(v,{x:p.x,z:p.z,heading:${pose.look}*Math.PI/180,vx:0,vz:0,speed:0});
    return {x:p.x,z:p.z,snapped:!!hit};})()`);
   if(!before){
    let ok=false;for(let i=0;i<240&&!ok;i++){await sleep(500);ok=await page.read(`mmm.hawkesbury.built.has(${JSON.stringify(pose.group)})`);}
    assert.ok(ok,`${level}: ${pose.group} built near ${JSON.stringify(where)}`);
   }
   // Let the finest land and the trees settle round the new place.
   for(let i=0;i<120;i++){await sleep(500);if(await page.read(`document.title.startsWith('settled')`))break;}
   await sleep(2500);
   for(const view of ['chase','seat']){
    const now=await page.read(`(()=>{const v=document.title;return v})()`);void now;
    await shot(page,`${name}-${pose.name??pose.group}-${view}.png`);
    await page.read(`(()=>{dispatchEvent(new KeyboardEvent('keydown',{code:'KeyV',key:'v'}));dispatchEvent(new KeyboardEvent('keyup',{code:'KeyV',key:'v'}));return true})()`);
    await sleep(1200);
   }
  }
  if(!before){
   const state=await page.read(`(()=>{const h=mmm.hawkesbury,groups={};let meshes=0,triangles=0,cars=0;
    for(const [n,b] of h.built){const m=b.meshes,t=b.triangles,c=b.cars.length;groups[n]={meshes:m,triangles:t,cars:c,solids:b.solids.length,lines:Object.values(b.layouts).reduce((s,l)=>s+l.lines.length,0)};meshes+=m;triangles+=t;cars+=c;}
    // What is drawn: the clusters' shared meshes (a pattern, the paint, LOW's baked vehicles; desktop's instanced types).
    const drawn=[];h.group.traverse(o=>{if(o.isMesh&&o.visible&&o.parent.visible)drawn.push({name:o.name,instanced:!!o.isInstancedMesh,count:o.isInstancedMesh?o.count:1,map:!!o.material.map,triangles:o.geometry.attributes.position?.count/3||0});});
    return {groups,meshes,triangles,cars,counted:h.triangles,keepers:h.group.children.filter(c=>c.isMesh&&c.name.startsWith('ph-keeper')).length,solids:h.site.solids.length,drawn};})()`);
   console.log(name,'measured',JSON.stringify(state));
   const c=CEILING[level];
   assert.deepEqual(Object.keys(state.groups).sort(),[...GROUPS].sort());
   for(const [g,s] of Object.entries(state.groups))assert.ok(s.meshes>=1&&s.meshes<=5,`${g}: one mesh per pattern (${s.meshes})`);
   assert.ok(state.triangles<=c.triangles,`${level} triangles ${state.triangles} > ${c.triangles}`);
   assert.ok(state.meshes<=c.meshes,`${level} meshes ${state.meshes}`);
   assert.equal(state.counted,state.triangles);assert.equal(state.keepers,0,'the shader keepers go once their materials are in use');
   // Built groups share their cluster's meshes: two clusters, each at most one mesh per pattern, the paint and the vehicles.
   const plain=state.drawn.filter(d=>!d.instanced);
   assert.ok(plain.length<=(level==='low'?6:12),`${level}: ${plain.length} shared meshes drawn ${JSON.stringify(plain.map(d=>d.name))}`);
   assert.ok(plain.every(d=>d.triangles>0),'no empty mesh is drawn');
   if(level==='low'){assert.ok(state.drawn.every(d=>!d.instanced&&!d.map),'LOW draws no textures and no instanced vehicles');
    assert.ok(state.drawn.some(d=>d.name.endsWith('-vehicles')&&d.triangles>0),'LOW draws its baked vehicles');}
   else assert.ok(state.drawn.some(d=>d.instanced&&d.count>0),'desktop draws its instanced vehicles');
   assert.ok(Object.values(state.groups).reduce((n,g)=>n+g.solids,0)>=40,'lot poles and corrals are solid');
   if(level==='low'){const desktop=JSON.parse(readFileSync(`${out}/desktop.json`,'utf8'));
    for(const g of GROUPS){assert.ok(state.groups[g].triangles<desktop.groups[g].triangles,`${g}: LOW is simpler`);assert.ok(state.groups[g].cars<=desktop.groups[g].cars,`${g}: LOW parks fewer`);}}
   else writeFileSync(`${out}/desktop.json`,JSON.stringify(state));
   for(const g of ['reeves','plaza','eastNorth','eastSouth'])assert.ok(state.groups[g].lines>50,`${g}: its lot is painted`);
   // The replaced baked boxes are not drawn: one fake box on each spot and one 8 m away keeps only the far ones.
   const kept=await page.read(`(()=>{const spots=[[628241.01,5052612.96],[628494.0,5052628.32],[629993.67,5052957.48],[630095.25,5052850.71],[628217.94,5052158.02]];
    const list=spots.flatMap(([x,y],i)=>[{id:i*2,x,y},{id:i*2+1,x:x+8,y}]);return mmm.hawkesbury.site.buildings(list).map(b=>b.id%2);})()`);
   assert.deepEqual(kept,[1,1,1,1,1]);
   // The car is set just inside the end of every fourth solid, as a car arrives; every parked vehicle blocks it too.
   const contacts=await page.read(`(()=>{const h=mmm.hawkesbury,s=h.site,v=mmm.vehicle,saved={x:v.x,z:v.z,heading:v.heading,vx:v.vx,vz:v.vz,speed:v.speed};let tested=0;
    // Only solids with room round them: a car dropped on a pole between two parked cars is pushed both ways and may not
    // move at all, which says nothing about the wiring.
    // (The site's own solids are strips of one wall each and push the same way; they are all kept.)
    const lotted=[...h.built.values()].flatMap(b=>[...b.solids,...b.parkedSolids]);
    const alone=t=>lotted.every(o=>o===t||Math.hypot(o.x-t.x,o.z-t.z)>o.half+t.half+4.5);
    const all=[...s.solids.filter((_,i)=>i%4===0),...[...h.built.values()].flatMap(b=>[...b.solids.filter((_,i)=>i%3===0),...b.parkedSolids.filter((_,i)=>i%25===0)]).filter(alone)];
    try{for(const solid of all){const x=solid.x+Math.sin(solid.heading)*solid.half*.8,z=solid.z-Math.cos(solid.heading)*solid.half*.8;Object.assign(v,{x,z,vx:0,vz:0,speed:0});h.resolveSolids(v);if(Math.hypot(v.x-x,v.z-z)<.1)throw Error('a Port Hawkesbury solid did not block the vehicle at '+x+','+z);tested++;}}
    finally{Object.assign(v,saved);}return tested;})()`);
   assert.ok(contacts>=15,`contacts ${contacts}`);
   console.log(name,JSON.stringify({...state,contacts}));
  }
  assert.deepEqual(page.errors,[]);
 } finally {await page.close();}
}
console.log('PASS port-hawkesbury-browser');
