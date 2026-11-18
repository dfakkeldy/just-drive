import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
const [out, first] = process.argv.slice(2), port = process.env.CDP_PORT, LOW = process.env.DRIVER_LOW === '1';
// LOW builds every kind from the parked display models: each one must drive, keep its lane, stop and spawn hidden.
const KINDS = LOW ? ['truck', 'sxs', 'bike'] : ['truck'];
const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, {method:'PUT'})).json();
writeFileSync(`${out}/.keep`, 'Point Tupper AI evidence');
const c = await cdp(tab.webSocketDebuggerUrl, {deadline:180000});
const read = async expression => {
  const r = await c.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(r.error || r.result?.exceptionDetails) throw Error(JSON.stringify(r));
  return r.result.result.value;
};
try {
 await c.send('Page.enable');
 await c.send('Page.navigate',{url:new URL('/?area=pointtupper&aiDriverCheck=1&mp=0&radio=0&vehicle=car&x=1'+(LOW?'&q=low':''),first).href});
 let ready=false;
 for(let i=0;i<360;i++){await sleep(500);ready=await read("document.documentElement.dataset.mmmReady==='true' && !!window.mmm?.aiDriver");if(ready)break;}
 assert.ok(ready,'Point Tupper driver loads');
 await read("document.getElementById('titleStart')?.click()");await sleep(3000);
 // The real start (player and chase camera), for the hidden-spawn step: the ground around it is loaded.
 await read("window.__start={x:mmm.vehicle.x,z:mmm.vehicle.z,heading:mmm.vehicle.heading,position:mmm.camera.position.toArray(),quaternion:mmm.camera.quaternion.toArray()}");
 await read("window.savedRAF=requestAnimationFrame;requestAnimationFrame=f=>0");await sleep(100);
 await read(`(async()=>{const {PointTupperDriver}=await import('/src/point-tupper-driver.ts');const old=mmm.aiDriver;mmm.scene.remove(old.group);mmm.aiDriver=new PointTupperDriver(mmm.roads,mmm.terrain,old.contacts,'car',-.2,()=>.5,undefined,${LOW});mmm.scene.add(mmm.aiDriver.group);})()`);
 assert.equal(await read('mmm.aiDriver.low'),LOW,'LOW page builds the LOW AI');
 for(const kind of KINDS) {
 const built=await read(`(async()=>{const {GARAGE}=await import('/src/garage.ts');const a=mmm.aiDriver;if(a.entry.id!=='${kind}')a.mount(GARAGE.find(e=>e.id==='${kind}'));
   let draws=0;a.group.visible=true;a.group.updateMatrixWorld(true);a.group.traverseVisible(o=>{if(o.isMesh)draws++;});a.group.visible=false;return {id:a.entry.id,draws};})()`);
 assert.equal(built.id,kind);console.log('mounted',built);
 if(LOW) assert.equal(built.draws,{truck:7,sxs:5,bike:2}[kind],`${kind}: the LOW display rig`);
 for(let spot=0;spot<2;spot++) {
 await read(`(()=>{const a=mmm.aiDriver,path=a.paths.find(p=>p.cumulative.at(-1)>500),p={x:0,z:0,heading:0};path.at(60+${spot}*100,1.6,p);mmm.camera.position.set(p.x+8,(mmm.terrain.heightAt(p.x,p.z)??0)+6,p.z+12);mmm.camera.lookAt(p.x,(mmm.terrain.heightAt(p.x,p.z)??0)+1,p.z);mmm.camera.updateMatrixWorld();})()`);
 for(let warm=0;warm<20;warm++){await sleep(200);await read('mmm.terrain.update(mmm.camera);mmm.renderer.render(mmm.scene,mmm.camera)');}
 const result=await read(`(()=>{
 const {aiDriver:a,vehicle:p,roads,terrain:t,camera:c,renderer:r,scene}=mmm;
 const paths=a.paths;const path=paths.find(p=>p.cumulative.at(-1)>500);const pose={x:0,z:0,heading:0};
 path.at(60+${spot}*100,1.6,pose);p.place(pose.x+200,pose.z+200,pose.heading);
 a.vehicle.place(pose.x,pose.z,pose.heading);a.active=a.group.visible=true;
 const v=a.vehicle;const before={x:v.x,z:v.z};
 for(let i=0;i<600;i++)a.step(1/120,p);
 const moved=Math.hypot(v.x-before.x,v.z-before.z);
 const h=v.heading;c.position.set(v.x-12*Math.sin(h)+5*Math.cos(h),v.y+4,v.z+12*Math.cos(h)+5*Math.sin(h));
 c.lookAt(v.x,v.y+1,v.z);c.updateMatrixWorld();t.update(c);r.render(scene,c);
 const lane=roads.nearest(v.x,v.z,12,a.eligible);const right=lane?(v.x-lane.x)*Math.cos(lane.heading+(Math.cos(lane.heading-v.heading)<0?Math.PI:0))+(v.z-lane.z)*Math.sin(lane.heading+(Math.cos(lane.heading-v.heading)<0?Math.PI:0)):-1;
 return {id:a.entry.id,moved,speed:v.speed,x:v.x,z:v.z,y:v.y,right,half:lane?.road.halfWidth};})()`);
 console.log('measured',result);assert.equal(result.id,kind);assert.ok(result.moved>10,`${kind}: demo autopilot drives`);assert.ok(result.right>0&&result.right<result.half,`${kind}: keeps the right lane (${result.right?.toFixed(2)} m right of the centre line, half width ${result.half})`);assert.ok(result.speed>2,'moving before stop test');console.log('spot',spot,result);
 for(let settle=0;settle<12;settle++){await sleep(300);await read('mmm.terrain.update(mmm.camera);mmm.renderer.render(mmm.scene,mmm.camera)');}
 const image=await c.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/point-tupper-ai-chase-${LOW?'low-':''}${kind}-${spot+1}.png`,Buffer.from(image.result.data,'base64'));
 }
 const stopped=await read(`(()=>{const a=mmm.aiDriver,v=a.vehicle,p=mmm.vehicle;if(!p.place(v.x+Math.sin(v.heading)*12,v.z-Math.cos(v.heading)*12,v.heading))throw Error("player stop placement rejected");for(let i=0;i<600;i++)a.step(1/120,p);return Math.abs(v.speed);})()`);
 assert.ok(stopped<.5,`${kind}: stops for the player`);
 // Hidden spawn: from hidden, the real update finds a start 120-550 m away and out of the camera.
 await read(`(()=>{const s=__start,c=mmm.camera;mmm.vehicle.place(s.x,s.z,s.heading);c.position.fromArray(s.position);c.quaternion.fromArray(s.quaternion);c.updateMatrixWorld();})()`);
 for(let warm=0;warm<20;warm++){await sleep(200);await read('mmm.terrain.update(mmm.camera)');}
 const spawn=await read(`(()=>{const a=mmm.aiDriver,p=mmm.vehicle,c=mmm.camera;a.hide();c.updateMatrixWorld();
   let tries=0;for(;tries<20000&&!a.active;tries++)a.update(c,p,true,'car');   // one sampled start per frame in the game
   const f=new (c.projectionMatrix.constructor)().multiplyMatrices(c.projectionMatrix,c.matrixWorldInverse),v=a.vehicle;
   const n=new (c.position.constructor)(v.x,v.y+1,v.z).applyMatrix4(f);
   return {active:a.active,tries,paths:a.paths.length,id:a.entry.id,distance:Math.hypot(v.x-p.x,v.z-p.z),inView:Math.abs(n.x)<=1&&Math.abs(n.y)<=1&&n.z<=1};})()`);
 assert.ok(spawn.active&&spawn.distance>=119&&spawn.distance<=551&&!spawn.inView,`${kind}: hidden spawn ${JSON.stringify(spawn)}`);
 }
 await read('mmm.aiDriver.update(mmm.camera,mmm.vehicle,false)');assert.equal(await read('mmm.aiDriver.active'),false,'update(enabled=false) hides it (main.ts passes aiDriverOn(): false in a room or 1884)');
 console.log(`PASS Point Tupper AI driver${LOW?' (LOW display models)':''}: ${KINDS.join(', ')}: two chase pictures each, motion, right lane, stop, hidden spawn; disable`);
} finally {await c.send('Page.close');c.close?.();}
