// Real production scene and physics, frozen only while the camera/tiles settle for each capture.
import assert from 'node:assert/strict';
import { open } from './truck-cdp.mjs';
const [out,first]=process.argv.slice(2),origin=new URL(first).origin;
const p=await open(`${origin}/?vehicle=sxs&cam=620525.19624,5099315.85697,3.2,-34.25384,-5,55&camground=1&exag=1.5&hud=0&scene=0`);
try {
 await p.read(`(async()=>{
 const THREE=await import('/node_modules/three/build/three.module.js'),{SLIP_RAMP:r}=await import('/src/yard-site.ts');
 window.requestAnimationFrame=()=>0;
 const {vehicle:v,yard,terrain,camera,renderer,trees,water}=mmm,scene=yard.group.parent;
 window.photo={THREE,v,yard,terrain,camera,renderer,trees,water,scene,r};
 photo.step=(input)=>mmm.driveVehicle(1/120,input);
 photo.view=async(position,target)=>{camera.position.copy(position);camera.lookAt(target);camera.updateMatrixWorld();for(let i=0;i<100;i++){terrain.update(camera);trees?.update(terrain.drawnFine,camera.position);yard.update(0,v,camera.position);water?.update(camera);try{renderer.render(scene,camera);}finally{water?.settle();}water?.afterRender(camera);await new Promise(r=>setTimeout(r,20));}};
 photo.at=(distance)=>{const pts=v.roads.roads.find(r=>r.id===80).pts;let a=pts[0],b=pts[1],s=distance;for(let i=1;i<pts.length;i++){b=pts[i];const d=Math.hypot(b[0]-a[0],b[1]-a[1]);if(s<=d)return {x:a[0]+(b[0]-a[0])*s/d,z:a[1]+(b[1]-a[1])*s/d,heading:Math.atan2(b[0]-a[0],a[1]-b[1])};s-=d;a=b;}throw Error('road end');};
 photo.angle=async(front)=>{const fx=Math.sin(v.heading),fz=-Math.cos(v.heading),rx=Math.cos(v.heading),rz=Math.sin(v.heading),sgn=front?1:-1;await photo.view(new THREE.Vector3(v.x+sgn*fx*5.1-rx*2.5,v.y+2.05,v.z+sgn*fz*5.1-rz*2.5),new THREE.Vector3(v.x,v.y+.8,v.z));};
 const hit=photo.at(110),height=terrain.heightAt(hit.x,hit.z)??0;
 await photo.view(new THREE.Vector3(hit.x+6,height+6,hit.z+6),new THREE.Vector3(hit.x,height,hit.z));v.place(hit.x,hit.z,hit.heading);v.assist=0;for(let i=0;i<240;i++)photo.step({throttle:0,steer:0,handbrake:false});
})()`);
 await p.read('photo.angle(true)');await p.shot(`${out}/sxs-game-front.png`);
 await p.read('photo.angle(false)');await p.shot(`${out}/sxs-game-rear.png`);
 const slide=await p.read(`(async()=>{const {v,THREE}=photo,q=photo.at(110);v.place(q.x,q.z,q.heading);v.vx=Math.sin(v.heading)*15;v.vz=-Math.cos(v.heading)*15;v.speed=15;for(let i=0;i<48;i++)photo.step({throttle:1,steer:i<45?.85:-.18,handbrake:i<30});const side=Math.abs(v.vx*Math.cos(v.heading)+v.vz*Math.sin(v.heading));const fx=Math.sin(v.heading),fz=-Math.cos(v.heading);await photo.view(new THREE.Vector3(v.x-fx*6.8,v.y+2.6,v.z-fz*6.8),new THREE.Vector3(v.x+fx*2,v.y+.7,v.z+fz*2));return{side,surface:v.surfaceName,speed:v.speed};})()`);
 assert.ok(slide.side>.25&&slide.surface==='gravel'&&slide.speed>12,JSON.stringify(slide));await p.shot(`${out}/sxs-gravel-slide.png`);console.log('SLIDE PICTURE',slide);
 const air=await p.read(`(async()=>{const {v,yard,r,THREE}=photo,s=yard.site,start=s.world(r.u+47,r.v);await photo.view(new THREE.Vector3(start.x+8,(s.rampBase??v.y)+6,start.z+8),new THREE.Vector3(start.x,(s.rampBase??v.y)+1,start.z));v.place(start.x,start.z,s.heading(-1,0));v.steerAngle=0;let found=false;for(let i=0;i<120*7;i++){photo.step({throttle:1,steer:0,handbrake:false});const a=r.u-s.local(v.x,v.z).u;if(v.airborne&&a>r.lead+r.length+5&&v.y>(s.rampBase??0)+1){found=true;break;}}const fx=Math.sin(v.heading),fz=-Math.cos(v.heading),rx=Math.cos(v.heading),rz=Math.sin(v.heading);await photo.view(new THREE.Vector3(v.x+rx*7,v.y+1.9,v.z+rz*7),new THREE.Vector3(v.x,v.y+.6,v.z));return {found,air:v.airborne,speed:v.speed};})()`);
 assert.ok(air.found&&air.air);await p.shot(`${out}/sxs-ramp-air.png`);console.log('AIR PICTURE',air);
 // Driver picture is captured on the gravel in the game, at the actual rig eye.
 await p.read(`(async()=>{const {v,THREE}=photo,q=photo.at(110);await photo.view(new THREE.Vector3(q.x+8,(photo.terrain.heightAt(q.x,q.z)??0)+5,q.z+8),new THREE.Vector3(q.x,v.y,q.z));v.place(q.x,q.z,q.heading);for(let i=0;i<240;i++)photo.step({throttle:0,steer:0,handbrake:false});v.car.root.updateMatrixWorld(true);const eye=v.car.driverEye.getWorldPosition(new THREE.Vector3()),target=eye.clone().add(new THREE.Vector3(Math.sin(v.heading)*4,-.1,-Math.cos(v.heading)*4));photo.camera.fov=68;photo.camera.updateProjectionMatrix();await photo.view(eye,target);})()`);await p.shot(`${out}/sxs-seat.png`);
}finally{await p.close();}
