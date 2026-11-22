// RUN=church-browser-check.mjs VIEWS="mabou|x=1 judique|area=judique&at=630770.2,5080667.56,83.8&vehicle=truck&trailer=1" tools/yard-shots.sh 1600 900
// Add vehicle=truck&trailer=1 on Judique views to exercise the real coupled rig too.
// The church builds only within 250 m of the camera; Judique's normal start is 13.7 km away, so the Judique
// view must start at CHURCH_START (church-site.ts; heading 1.4629 rad = 83.8 degrees) with at=east,north,heading.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {open,sleep} from './truck-cdp.mjs';
const [out,...urls]=process.argv.slice(2);
for(const url of urls){
 const page=await open(url);
 try {
  await page.send('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});
  await page.navigate(url);
  assert.deepEqual(await page.read('[innerWidth,innerHeight]'),[1600,900]);
  const name=new URL(url).searchParams.get('name');
  if(new URL(url).searchParams.get('area')==='judique'){
   for(let i=0;i<120&&!await page.read('mmm.church?.triangles>0');i++)await sleep(500);
   const state=await page.read(`(()=>{const c=mmm.church,o=c.site.origin;let meshes=0,triangles=0;c.group.traverse(m=>{if(m.isMesh){meshes++;triangles+=m.geometry.attributes.position.count/3;}});return {meshes,triangles,base:c.group.position.y,ground:mmm.terrain.heightAt(o.x,o.z),scale:c.group.scale.toArray(),yaw:c.group.rotation.y,solids:c.site.solids.length};})()`);
   assert.equal(state.meshes,3);assert.ok(state.triangles>3000);assert.ok(Math.abs(state.base-state.ground)<.001);assert.deepEqual(state.scale,[1,1,1]);assert.equal(state.solids,9);   // metres since the scan; nave, tower, vestry, steps, ramp, landing, monument, wayside cross, boulder
   // The replacement box cannot remain in the generated building list.
   assert.equal(await page.read('mmm.church.site.buildings([{id:9009,x:630844.2,y:5080637.2},{id:9,x:630864.2,y:5080637.2}]).length'),1);
   const contacts=await page.read(`(()=>{const c=mmm.church,v=mmm.vehicle,saved={x:v.x,z:v.z,heading:v.heading,vx:v.vx,vz:v.vz,speed:v.speed};let tested=0;try{for(const solid of c.site.solids.slice(0,3)){Object.assign(v,{x:solid.x,z:solid.z,vx:0,vz:0,speed:0});c.resolveSolids(v);if(Math.hypot(v.x-solid.x,v.z-solid.z)<.3)throw Error('church did not block real vehicle');tested++;}}finally{Object.assign(v,saved);}return tested;})()`);
   assert.equal(contacts,3);
   // The rig reverses onto the church's southern long side. (Before 21 Nov 2026 a power bake put a church
   // service-drop pole on the northern side; the church now has no power.) A refused or moved placement fails here.
   // Step the actual classes directly: a fixed screenshot tab can be hidden and pause driveVehicle.
   // Prescribe reverse velocity each step to test contact independently of the exaggerated hillside grade.
   const towing=new URL(url).searchParams.has('trailer') ? await page.read(`(()=>{const c=mmm.church,t=mmm.towing,v=mmm.vehicle;if(!t?.attached)throw Error('test needs attached trailer');if(!c.site.solids.every(s=>t.world.solids.includes(s)))throw Error('church solids not wired to towing');const saved={x:v.x,z:v.z,heading:v.heading};const s=c.site.solids[0],heading=s.heading-Math.PI/2,fx=Math.sin(heading),fz=-Math.cos(heading);let impacts=0;const notify=v.onSolidImpact;try{
    const pose={x:s.x+fx*10,z:s.z+fz*10,heading};if(t.validPair(pose))throw Error('trailer-only church placement accepted');
    const px=s.x+fx*(s.halfWidth+16),pz=s.z+fz*(s.halfWidth+16);if(!v.place(px,pz,heading)||Math.hypot(v.x-px,v.z-pz)>1e-6||Math.abs(((v.heading-heading)%(2*Math.PI)+3*Math.PI)%(2*Math.PI)-Math.PI)>1e-6)throw Error('church test pose refused or moved '+JSON.stringify({asked:[px,pz,heading],at:[v.x,v.z,v.heading]}));v.onSolidImpact=()=>impacts++;
    for(let i=0;i<1200;i++){v.vx=-fx*2;v.vz=-fz*2;v.speed=-2;mmm.terrain.withGroundContact(v,()=>v.update(1/120,{throttle:-1,steer:0,handbrake:false},()=>{c.resolveSolids(v);t.step();}));if(!t.pairClear())throw Error('church intersects coupled pair');}
    if(!impacts)throw Error('trailer did not reach church '+JSON.stringify({truck:[v.x,v.y,v.z],trailer:[t.probe.x,t.probe.z],speed:v.speed,solid:s}));if(Math.hypot(v.x-s.x,v.z-s.z)<Math.hypot(t.probe.x-s.x,t.probe.z-s.z)+4)throw Error('truck reached church before trailer');
    return {wired:true,placementRefused:true,steps:1200,impacts,clear:t.pairClear()};
   }finally{v.onSolidImpact=notify;v.place(saved.x,saved.z,saved.heading);}})()`) : null;
   console.log(name,JSON.stringify({...state,realVehicleContacts:contacts,towing}));
  } else {
   assert.equal(await page.read('mmm.church'),null);
   assert.equal(await page.read(`performance.getEntriesByType('resource').filter(e=>/\\/src\\/church\\.ts/.test(e.name)).length`),0,'Mabou never loads the church builder');
   console.log('PASS Mabou has no church instance, builder load, model or textures');
  }
  const file=`${out}/${name}.png`;await page.shot(file);
  const png=readFileSync(file);assert.equal(png.readUInt32BE(16),1600);assert.equal(png.readUInt32BE(20),900);
  assert.deepEqual(page.errors,[]);
 } finally {await page.close();}
}
