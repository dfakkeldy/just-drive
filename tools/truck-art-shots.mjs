#!/usr/bin/env node
// Eleven v2 art pictures. Photo placement starts in the right lane; production spawn/autopilot are never changed.
// RUN=truck-art-shots.mjs VIEWS='truck|vehicle=truck' tools/yard-shots.sh 1600 1000
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { open,sleep } from './truck-cdp.mjs';
const [out,first]=process.argv.slice(2),origin=new URL(first).origin;
await import('./truck-pictures.mjs');
const highway=`${origin}/?vehicle=truck&road=Highway%2019&f=.77&exag=1.5&hour=15&hud=1&scene=0`;
const p=await open(highway),report={};
// Evaluate the parent's exact setup, rather than maintaining a second ramp/contact implementation here.
const checkSource=readFileSync(new URL('./truck-browser.mjs',import.meta.url),'utf8');
const marker='async function setup(){await p.read(`',start=checkSource.indexOf(marker)+marker.length,end=checkSource.indexOf('`);await sleep(100);}',start);
assert.ok(start>=marker.length&&end>start&&checkSource.slice(start,end).includes('tt.stopOnRamp='),'parent ramp setup found');
const rampSetup=checkSource.slice(start,end);
async function lane(){return p.read(`(()=>{const {vehicle:v}=mmm,hit=v.roads.nearest(v.x,v.z,40,r=>r.kind<=3);if(!hit)throw Error('Photo road missing');const heading=v.heading,offset=Math.min(hit.road.halfWidth*.5,1.6);v.place(hit.x+Math.cos(heading)*offset,hit.z+Math.sin(heading)*offset,heading);window.photoStart={x:v.x,z:v.z};return {offset,halfWidth:hit.road.halfWidth,heading};})()`);}
async function freeze(){await p.read(`(async()=>{
 const THREE=await import('/node_modules/three/build/three.module.js');
 const {vehicle:v,terrain,camera,renderer,trees,water,yard}=mmm,scene=v.car.root.parent;
 window.requestAnimationFrame=()=>0;window.photo={THREE,v,terrain,camera,renderer,scene,yard};
 photo.view=async(eye,target,fov=53)=>{camera.position.copy(eye);camera.fov=fov;camera.updateProjectionMatrix();camera.lookAt(target);camera.updateMatrixWorld();
   for(let i=0;i<80;i++){terrain.update(camera);trees?.update(terrain.drawnFine,camera.position);yard.update(0,v,camera.position);water?.update(camera);try{renderer.render(scene,camera);}finally{water?.settle();}water?.afterRender(camera);await new Promise(r=>setTimeout(r,20));}
 };
 photo.lane=()=>{const hit=v.roads.nearest(v.x,v.z,40,r=>r.kind<=3);return {side:hit?(v.x-hit.x)*Math.cos(v.heading)+(v.z-hit.z)*Math.sin(v.heading):null,bodyHalfWidth:v.spec.halfWidth,speed:v.speed};};
})()`);await sleep(100);}
try{
 report.start=await lane();
 await p.send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyW',key:'w',windowsVirtualKeyCode:87});
 for(let i=0;i<40;i++){await sleep(250);if(await p.read('mmm.vehicle.speed>6&&Math.hypot(mmm.vehicle.x-photoStart.x,mmm.vehicle.z-photoStart.z)>4'))break;}
 await p.send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyW',key:'w',windowsVirtualKeyCode:87});
 await freeze();report.chase=await p.read('photo.lane()');assert.ok(report.chase.side>1.22,'chase picture truck stays right of the centre line');
 await p.shot(`${out}/truck-highway19-v2.png`);
 await p.read(`for(const e of document.body.children)if(e instanceof HTMLElement&&e.tagName!=='CANVAS')e.style.visibility='hidden';`);
 // Use the same real highway and afternoon game light, 7.2 metres from the root in each quarter view.
 for(const [name,direction]of [['front',1],['rear',-1]]){
  const capture=await p.read(`(async()=>{const {v,THREE}=photo,f=new THREE.Vector3(Math.sin(v.heading),0,-Math.cos(v.heading)),r=new THREE.Vector3(Math.cos(v.heading),0,Math.sin(v.heading)),eye=new THREE.Vector3(v.x,v.y+${name==='front'?2.2:1.75},v.z).addScaledVector(f,${direction}*6.3).addScaledVector(r,-3.1),target=new THREE.Vector3(v.x,v.y+1.05,v.z);await photo.view(eye,target,56);return {distance:eye.distanceTo(new THREE.Vector3(v.x,v.y,v.z)),sceneEnvironmentIsNull:photo.scene.environment===null,materials:(()=>{const a=[];v.car.root.traverse(n=>{if(n.isMesh&&!a.some(m=>m.name===n.material.name))a.push({name:n.material.name,reflection:!!n.material.envMap});});return a;})()};})()`);
  assert.ok(capture.distance>=6&&capture.distance<=8,'game quarter view distance');report[name]=capture;await p.shot(`${out}/truck-v2-game-${name}.png`);
 }
 await p.read(`(async()=>{const {v,camera,THREE}=photo;v.car.driverEye.getWorldPosition(camera.position);const eye=camera.position.clone(),forward=new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(v.pitch*.8,-v.heading,0));await photo.view(eye,eye.clone().add(forward),68);})()`);await p.shot(`${out}/truck-seat-v2.png`);
 await p.navigate(`${origin}/?vehicle=truck&cam=620525.19624,5099315.85697,3.2,-34.25384,-5,55&camground=1&exag=1.5&hour=15&hud=0&scene=0`);
 await p.read(rampSetup);await sleep(100);await freeze();
 report.ramp=await p.read(`(async()=>{const {v,THREE}=photo,{site,r}=tt,result=tt.stopOnRamp(),eye=site.world(r.u-3,r.v-11);await photo.view(new THREE.Vector3(eye.x,v.y+3.1,eye.z),new THREE.Vector3(v.x,v.y+1,v.z),53);return {...result,contacts:tt.contacts()};})()`);
 assert.ok(report.ramp.contacts.every(c=>c.inYard&&Math.abs(c.gap)<.04),'art picture has real tyres on the drawn ramp after driving up');await p.shot(`${out}/truck-yard-ramp-v2.png`);
 await p.send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true});await p.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
 await p.navigate(highway+'&touch=1');report.phoneStart=await lane();
 const pedal=await p.read(`(()=>{const r=document.getElementById('tcGo').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
 await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...pedal,id:1}]});
 for(let i=0;i<40;i++){await sleep(250);if(await p.read('mmm.vehicle.speed>5&&Math.hypot(mmm.vehicle.x-photoStart.x,mmm.vehicle.z-photoStart.z)>4'))break;}
 await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await freeze();report.phone=await p.read('photo.lane()');assert.ok(report.phone.side>1.22&&report.phone.speed>2,'phone art uses actual driving in the right lane');await p.shot(`${out}/truck-phone-v2.png`);
 writeFileSync(`${out}/truck-art-v2-lighting.json`,JSON.stringify(report,null,2)+'\n');
 console.log('PASS eleven truck v2 art views',JSON.stringify(report));
}finally{await p.close();}
