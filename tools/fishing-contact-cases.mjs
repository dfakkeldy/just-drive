import assert from 'node:assert/strict';import * as THREE from '../web/node_modules/three/build/three.module.js';
import {Terrain} from '../web/src/terrain.ts';import {FishingSite} from '../web/src/fishing-site.ts';
import {Vehicle} from '../web/src/vehicle.ts';import {Roads} from '../web/src/roads.ts';
import {readFileSync,writeFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {join} from 'node:path';
const root=process.env.FISHING_CONTACT_ROOT,base=join(root,'data/baked/terrain'),out=process.env.MMM_CHECK_OUT??join(root,'data/work/fishing');
const mode=process.env.FISHING_CONTACT_MODE??'all',label=process.env.FISHING_CONTACT_LABEL??'pass3';
const pixels=new Map();
globalThis.__fishingReadPng=(base,path)=>{if(!pixels.has(path))pixels.set(path,execFileSync('python3',['-c','from PIL import Image;import sys;sys.stdout.buffer.write(Image.open(sys.argv[1]).convert("RGBA").tobytes())',join(base,path)],{maxBuffer:1024*1024}));return new Uint8ClampedArray(pixels.get(path));};
THREE.TextureLoader.prototype.load=()=>new THREE.Texture();
const manifest=JSON.parse(readFileSync(join(base,'manifest.json'))),data=JSON.parse(readFileSync(join(base,'roads.json'))),rows=[],failures=[];
const poses=[];
for(const u of [-4,12])for(const v of [-20,-12,-4,4,8,9.5,12,20])poses.push([u,v,Math.PI]);
for(const v of [-26,-18,10,24,66,74])for(const u of [-4,0,7,13])poses.push([u,v,Math.PI]);
for(const v of [10,64])for(const h of [0,Math.PI/2])poses.push([1,v,h]);
const car=()=>{const n=()=>new THREE.Object3D();return{root:n(),body:n(),steer:{fl:n(),fr:n()},wheels:{fl:n(),fr:n(),rl:n(),rr:n()}};};
for(const low of [false,true])for(const hill of [1,1.5,2,2.5]){
 const s=new FishingSite(manifest.village,hill,-.2),t=new Terrain(manifest,base,{},hill,-.2,s.clear);t.low=low;t.sites.push(s);
 const tiles=[],maxLevel=Math.max(...Object.keys(manifest.levels).map(Number));
 for(const level of (mode==='surface'?[7]:Array.from({length:maxLevel+1},(_,n)=>n))){
  const size=manifest.size/2**level,i=Math.floor((s.x+manifest.village[0]-manifest.origin[0])/size),j=Math.floor((s.z-manifest.village[1]+manifest.origin[1])/size),tile=t.tile(level,i,j);
  if(tile){await t.loadNow(level,i,j);tiles.push(tile);}
 }
 s.top=s.level;s.toe=s.entrance(-2);
 const roads=new Roads(data,manifest.village,t),c=new Vehicle(car(),t,roads,-.2);
 const tick=input=>t.withGroundContact(c,()=>c.update(1/120,input));
 const place=(u,v,h=Math.PI)=>{c.place(s.x+u,s.z+v,h);c.speed=0;c.assist=0;c.steerAngle=0;c.jolt=0;};
 const select=tile=>{for(const a of tiles)a.mesh.visible=a===tile;tile.mesh.material.uniforms.hideQuad.value.set(0,0,0,0);t.group.updateMatrixWorld(true);};
 select(tiles.at(-1));
 const row={mode:low?'phone':'desktop',hill,surfaces:[],rays:[]};
 if(mode!=='rays'){
  for(const [name,u,v]of[['cap',7,46],['beside',0,46],['approach',0,-4]]){
   place(u,v);for(let n=0;n<60;n++)tick({throttle:0,steer:0,handbrake:true});
   c.heading=Math.PI;c.vx=-2;c.vz=8;c.speed=8;c.jolt=0;c.steerAngle=0;
   const height=c.groundContacts.map(p=>p.height),sr=Math.atan2((height[1]+height[3]-height[0]-height[2])/2,1.57),sf=Math.atan2((height[0]+height[1]-height[2]-height[3])/2,2.62);
   tick({throttle:0,steer:0,handbrake:false});
   const forward=c.vx*Math.sin(c.heading)-c.vz*Math.cos(c.heading),side=c.vx*Math.cos(c.heading)+c.vz*Math.sin(c.heading);
   const surface=t.withGroundContact(c,()=>t.surfaceAt(c.x,c.z));
   row.surfaces.push({name,kind:surface.kind,deck:surface.deck===true,surface:c.surfaceName,mu:(Math.abs(2-9.81*Math.sin(sr)/120*.35)-Math.abs(side))/(1.7*9.81/120),rolling:((8-forward)*120-9.81*Math.sin(sf)-.064)/9.81,rough:c.shake/Math.min(Math.abs(forward),20),shake:c.shake});
  }
  const advance=touch=>{place(7,46);c.strongHelp=true;c.assist=.65;c.touchSpeedLimit=true;c.vx=0;c.vz=12;c.speed=12;tick({throttle:1,steer:0,handbrake:false,touch});return {speed:c.speed,strong:c.helpYaw,light:c.lightHelpYaw};};
  row.keyboard=advance(false);row.touch=advance(true);
  // Prepared helper headings prove that a road below/near a cap cannot steer the car on that cap.
  place(7,46);c.strongHelp=true;c.assist=.65;c.speed=12;c.vz=12;c.roadHeading=c.heading+.2;c.touchRoad=c.heading+.2;c.junctionClear=1;
  t.withGroundContact(c,()=>c.step(1/120,{throttle:1,steer:0,handbrake:false,touch:true}));
  row.preparedHelp={strong:c.helpYaw,light:c.lightHelpYaw};if(c.helpYaw!==0||c.lightHelpYaw!==0)failures.push(`helper on cap ${low}/${hill}`);
  // Cross the contact-region boundary from rest on road 922: averaged canopy must not become a ramp.
  place(-8,-50);for(let n=0;n<1200;n++)tick({throttle:0,steer:0,handbrake:true});let air=0,maxStep=0,lastY=c.y,worst=null;
  for(let n=0;n<2400&&c.z<s.z-20;n++){
   tick({throttle:Math.max(-1,Math.min(1,(4-c.speed)*1.8)),steer:0,handbrake:false});
   air+=Number(c.airborne);const step=Math.abs(c.y-lastY);if(step>maxStep){maxStep=step;worst={u:c.x-s.x,v:c.z-s.z,y:c.y,vy:c.vy,air:c.airborne};}lastY=c.y;
  }
  row.transition={air,maxStep,worst};if(air||maxStep>.035)failures.push(`contact boundary ${low}/${hill}: ${JSON.stringify(row.transition)}`);
  const cap=row.surfaces[0];
  if(!(cap.kind===9&&cap.deck&&cap.surface==='concrete'&&Math.abs(cap.mu-1)<1e-7&&Math.abs(cap.rolling-.013)<1e-7&&cap.rough===0&&cap.shake===0))failures.push(`surface ${low}/${hill}: ${JSON.stringify(cap)}`);
  if(Math.abs(row.touch.speed-row.keyboard.speed)>1e-10||row.touch.strong!==0||row.touch.light!==0)failures.push(`touch cap ${low}/${hill}: ${JSON.stringify(row.touch)} vs ${JSON.stringify(row.keyboard)}`);
  const under=t.withGroundContact({y:s.level-.3},()=>t.surfaceAt(s.x+7,s.z+46));if(under.kind===9||under.deck)failures.push(`under deck classified as concrete ${low}/${hill}`);
  const beside=row.surfaces[1],approach=row.surfaces[2];
  if(beside.kind===9||beside.deck||beside.surface!=='grass'||Math.abs(beside.mu-.5)>1e-7||Math.abs(beside.rolling-.09)>1e-7||beside.rough!==.04||beside.shake<=0)failures.push(`beside cap ${low}/${hill}`);
  if(approach.kind!==4||approach.deck||approach.surface!=='dirt track'||Math.abs(approach.mu-.62)>1e-7||Math.abs(approach.rough-.03)>1e-7)failures.push(`approach changed ${low}/${hill}`);
 }
 if(mode!=='surface'){
  const ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0));
  for(const tile of tiles){
   select(tile);let min=Infinity,max=-Infinity,count=0,worst=null;
   for(const [u,v,h]of poses){
    place(u,v,h);for(let n=0;n<40;n++)tick({throttle:0,steer:0,handbrake:true});
    for(const p of c.groundContacts){
     const u=p.x-s.x,v=p.z-s.z;if(u>=2&&u<=12&&v>=10&&v<=64)continue;
     ray.ray.origin.set(p.x,1000,p.z);const hit=ray.intersectObject(tile.mesh,false)[0];if(!hit){failures.push(`missing ray ${tile.level}/${u}/${v}`);continue;}
     const gap=p.height-hit.point.y;count++;min=Math.min(min,gap);if(gap>max){max=gap;worst={u,v,physical:p.height,drawn:hit.point.y};}
    }
   }
   row.rays.push({level:tile.level,min,max,count,worst});
   if(min<-.051||max>.051)failures.push(`ray gap ${low}/${hill}/LOD${tile.level}: ${min}..${max}`);
  }
 }
 rows.push(row);console.log(JSON.stringify(row));
}
writeFileSync(join(out,`contact-${label}-${mode}.json`),JSON.stringify({rows,failures},null,2));
assert.equal(failures.length,0,failures.join('\n'));console.log('PASS real concrete controller and wheel rays against selected production meshes, all hills and both detail modes.');
