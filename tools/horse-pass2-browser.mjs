import assert from 'node:assert/strict';
import {writeFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

/** Review evidence uses the production frame, input, Mail, RoadScene and rendered terrain. */
export async function horsePass2Browser({read,page,shot,send,sleep,out}) {
 const key=async(code,down=true)=>send('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',code,key:code.startsWith('Key')?code.slice(3).toLowerCase():code});
 const frames=async(n)=>read(`(()=>{window.qaNow??=performance.now();for(let i=0;i<${n};i++)horseFrame(window.qaNow+=1000/60);})()`);
 // The horse is the 1884 ride only (garage.ts periodRides). Today's game asked for a horse gives the car.
 // The mail, roadside-story and ramp evidence below needs today's modern features; it waits behind HORSE_TODAY=1
 // for a later today-era horse (which first needs camera-free hoof contact outside 1884).
 await page('vehicle=horse&mode=mail&era=today&q=low');assert.equal(await read('mmm.vehicleId'),'car','today gives the car for vehicle=horse');
 if(process.env.HORSE_TODAY==='1'){
 await page('vehicle=horse&mode=mail&era=today&title=1&hud=1&q=low&scene=fish');
 const title=await read('document.querySelector("#title dl").textContent');
 for(const word of ['Mail','photo','step off','End'])assert(title.toLowerCase().includes(word.toLowerCase()),'mail title '+word);
 assert.doesNotMatch(title,/Places|radio|wiper|plate|repair|trailer/i);
 await shot('mail-title');
 await read('document.getElementById("titleStart").click()');await frames(2);
 // Wake normal mail play through its real throttle input, then stop safely beside the visitor.
 await key('KeyW');await frames(2);await key('KeyW',false);await frames(2);
 await read(`(()=>{const s=mmm.roadScene,p={};s.road.at(-20,6,p);mmm.vehicle.restart(p.x,p.z,p.heading);horseQA.view(9,7,4);})()`);
 await read('horseQA.settleView()');await frames(3);
 assert.equal(await read('mmm.vehicle.damageActive'),false,'horse has no repair charges');
 assert.equal(await read('mmm.roadScene.rules.seen'),true,'horse starts the roadside story');
 for(let i=0;i<3;i++){await key('KeyH');await key('KeyH',false);await frames(50);}
 await frames(2400);
 const story=await read('({seen:mmm.roadScene.rules.seen,honks:mmm.roadScene.rules.honks,cleared:mmm.roadScene.rules.cleared,carSide:mmm.roadScene.rules.carSide,truckAlong:mmm.roadScene.rules.truckAlong,damage:mmm.shift.damage.total,report:mmm.roadScene.reportLine()})');
 assert(story.seen&&story.honks===3&&story.cleared,'three real whinnies clear the roadside story');assert(story.truckAlong>4,'truck advances after road clears');
 writeFileSync(out+'/roadside-receipt.json',JSON.stringify(story,null,2));console.log('PASS HORSE_STORY',JSON.stringify(story));
 await read(`(()=>{const s=mmm.roadScene,p={};s.road.at(-8,0,p);mmm.vehicle.restart(p.x,p.z,p.heading);horseQA.view(6,14,5);})()`);await shot('roadside-cleared');
 // Use a real ready mailbox. No targets, trajectories or service rules are changed.
 const delivery=await read(`(async()=>{const v=mmm.vehicle,m=mmm.shift.mail,p=mmm.props,THREE=await import('/node_modules/three/build/three.module.js');
 const targets=p.mail,index=targets.map((b,i)=>({i,b})).filter(({i})=>m.service.condition(i)==='ready'&&p.data.mailboxes[i].group===null).sort((a,b)=>Math.hypot(a.b.x-v.x,a.b.z-v.z)-Math.hypot(b.b.x-v.x,b.b.z-v.z))[0]?.i;if(index===undefined)throw Error('no ready mailbox');const box=targets[index];
 window.qaMailbox={index,x:box.x,z:box.z};v.restart(box.x-6,box.z+.34,0);horseQA.view(-6,6,3.5);await horseQA.settleView();
 const hand=new THREE.Vector3();v.car.mailOrigin.getWorldPosition(hand);return{box:{x:box.x,z:box.z},hand:{x:hand.x,y:hand.y,z:hand.z},body:{x:v.x,y:v.y,z:v.z},rendered:(()=>{const cell=p.cells.get(Math.floor(box.x/256)+','+Math.floor(box.z/256));return !!cell?.group?.visible&&cell.pending.some(i=>i.position===box&&i.level>=6);})()};})()`);
 assert(delivery.rendered,'target mailbox is actually drawn');assert(delivery.hand.y-delivery.body.y>1.8&&delivery.hand.y-delivery.body.y<2.6,'mail starts at rider hand height');
 let delivered=false;
 for(const distance of [5.6,6,5.2,6.4,4.8,6.8,7.2]){
  await read(`(()=>{const v=mmm.vehicle,b=qaMailbox,m=mmm.shift.mail;v.restart(b.x-${distance},b.z+.34,0);m.reset();horseQA.view(-6,5,3.6);})()`);
  await key('KeyM');await frames(1);await key('KeyM',false);await frames(12);await read('(()=>{const v=mmm.vehicle,c=mmm.camera;c.fov=58;c.updateProjectionMatrix();c.position.set(v.x+7,v.y+5,v.z+11);c.lookAt(v.x+2.8,v.y+1.1,v.z);c.updateMatrixWorld();})()');await shot('mail-throw');
  await frames(80);delivered=await read('mmm.shift.mail.delivered>0');if(delivered)break;
 }
 assert(delivered,'real rider mail reaches a real box');writeFileSync(out+'/mail-receipt.json',JSON.stringify({delivery,delivered,tally:await read('mmm.shift.mail.tally')},null,2));console.log('PASS HORSE_MAIL',JSON.stringify(delivery),await read('mmm.shift.mail.tally'));
 // No motor jump offer exists for a horse; show only the plain ramp hint.
 const ramp=await read(`(()=>{const p=mmm.yard.site.world(-67,-21);mmm.vehicle.restart(p.x,p.z,0);mmm.yardJob.step(0,true,0);return{hint:!document.getElementById('horseRampHint').hidden,offer:mmm.endings.busy||document.body.innerText.includes('Take the job')};})()`);
 assert(ramp.hint&&!ramp.offer,'horse sees a ramp explanation without a jump offer');
 } else {
  await page('vehicle=horse&title=1&hud=1&q=low');await read('document.getElementById("titleStart")?.click()');await frames(2);
 }
 // The horse owns its own context. Pause gates suspend that context, not a shared game context.
 // Audio state changes are asynchronous; a loaded machine can take longer than any fixed sleep. Poll, with a limit.
 const until=async(expr,ms=3000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await read(expr))return true;await sleep(50);}return !!(await read(expr));};
 await key('KeyH');await key('KeyH',false);await frames(2);
 assert(await until('horseAudio.filter(a=>a.noiseBuffers>0).some(a=>a.state==="running")'),'horse audio unlocked');
 await read('Object.defineProperty(document,"hidden",{configurable:true,value:true});document.dispatchEvent(new Event("visibilitychange"))');await frames(2);
 assert(await until('horseAudio.filter(a=>a.noiseBuffers>0).every(a=>a.state==="suspended")'),'hidden tab suspends horse audio');
 await read('delete document.hidden;document.dispatchEvent(new Event("visibilitychange"))');await frames(2);
 assert(await until('horseAudio.filter(a=>a.noiseBuffers>0).every(a=>a.state==="running")'),'return resumes horse audio');

 await page('vehicle=horse&q=low');
 await read(`(async()=>{const THREE=await import('/node_modules/three/build/three.module.js');window.qaTHREE=THREE;const v=mmm.vehicle;window.qaStart={x:v.x,z:v.z,heading:v.heading};window.qaMarks=new THREE.Group();mmm.scene.add(qaMarks);})()`);
 for(const [name,speed,hz]of [['walk',1.67,1],['gallop',10,2.1]]){
  await read(`(()=>{const v=mmm.vehicle,h=qaStart.heading;v.restart(qaStart.x,qaStart.z,h);v.vx=Math.sin(h)*${speed};v.vz=-Math.cos(h)*${speed};v.speed=${speed};v.car.phase=0;qaMarks.clear();for(let i=-3;i<13;i++){const mark=new qaTHREE.Mesh(new qaTHREE.BoxGeometry(1.8,.014,.045),new qaTHREE.MeshBasicMaterial({color:i%2?0xf2eedc:0xc74a2f}));mark.position.set(v.x+Math.sin(h)*i,0,v.z-Math.cos(h)*i);mark.position.y=(mmm.terrain.meshHeightAt(mark.position.x,mark.position.z,true)??v.y)+.025;mark.rotation.y=-h;qaMarks.add(mark);}horseQA.view(7.8,0,2.8);})()`);
  await read('horseQA.settleView()');const files=[],poses=[];
  for(let i=0;i<5;i++){
   if(i)await read(`horseQA.tick(${1/(hz*5)},${speed})`);
   await read('horseQA.view(7.8,0,2.8);mmm.renderer.render(mmm.scene,mmm.camera)');
   poses.push(await read('({phase:mmm.vehicle.car.phase,x:mmm.vehicle.x,z:mmm.vehicle.z,feet:horseQA.feet()})'));
   const file=`${out}/.${name}-ruler-${i}.png`;files.push(file);writeFileSync(file,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
  }
  execFileSync('python3',['-c',`from PIL import Image,ImageDraw,ImageFont
import sys,json
out,name,pose_json,*files=sys.argv[1:]
poses=json.loads(pose_json)
im=Image.new('RGB',(1600,900),'#e8e2d6');d=ImageDraw.Draw(im)
f=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',24);big=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',36)
d.text((30,32),name.upper()+' / FIVE MOMENTS DURING ONE MOVING STRIDE',font=big,fill='#302d26')
for i,p in enumerate(files):
 frame=Image.open(p).crop((430,80,1170,880)).resize((320,346));im.paste(frame,(i*320,190));d.text((i*320+14,570),str(round(poses[i]['phase']*100))+'% of stride',font=f,fill='#302d26')
d.text((30,730),'Fixed red / white ground ticks: 1 metre apart. Camera follows the body.',font=f,fill='#302d26')
d.text((30,782),'Production physics and hoof anchors. Hill height 1.5. No terrain or leg overrides.',font=f,fill='#302d26')
im.save(out+'/'+name+'-ruler-stride.png')`,out,name,JSON.stringify(poses),...files]);files.forEach(f=>rmSync(f));writeFileSync(out+'/'+name+'-ruler.json',JSON.stringify(poses,null,2));
 }
 for(const hill of [1,2.5]){
  await page('vehicle=horse&q=low&exag='+hill);
  await read(`(async()=>{const r=mmm.roads.roads.find(r=>r.id===97),a=r.pts.at(-1),b=r.pts.at(-2),h=Math.atan2(a[0]-b[0],b[1]-a[1]),v=mmm.vehicle;v.restart(a[0]+Math.sin(h)*2,a[1]-Math.cos(h)*2,h);horseQA.view(12,1,3);await horseQA.settleView();v.restart(v.x,v.z,v.heading);horseQA.tick(.15,0);(()=>{const c=mmm.camera,t=mmm.terrain,rx=Math.cos(h),rz=Math.sin(h),fx=Math.sin(h),fz=-Math.cos(h);let best=null;for(const side of [-20,20]){const x=v.x+rx*side-fx*2,z=v.z+rz*side-fz*2,ground=Math.max(t.meshHeightAt(x,z,true)??-Infinity,t.bridgeApproaches.apronHeight(x,z)??-Infinity),y=Math.max(v.y+4,ground+2.5);if(!best||y<best.y)best={x,y,z};}c.position.set(best.x,best.y,best.z);c.lookAt(v.x,v.y+1,v.z);c.updateMatrixWorld();})();mmm.renderer.render(mmm.scene,mmm.camera);})()`);
  await shot('bridge97-hill-'+hill);
  const evidence=await read('({land:[...mmm.terrain.tiles.values()].filter(t=>t.mesh?.visible&&t.level===6).map(t=>({level:t.level,vertices:t.mesh.geometry.attributes.position.count,triangles:t.mesh.geometry.index.count/3})),timber:mmm.terrain.bridgeApproaches.aprons.map(a=>a.audit),bodyGap:mmm.vehicle.y-mmm.terrain.bridgeApproaches.apronHeight(mmm.vehicle.x,mmm.vehicle.z),feet:horseQA.feet()})');writeFileSync(out+'/bridge97-hill-'+hill+'.json',JSON.stringify(evidence,null,2));assert(Math.abs(evidence.bodyGap)<.1,'body stands on the loaded abutment');for(const f of evidence.feet.filter(f=>f.planted))assert(f.min>=-.035&&f.max<=.04,'drawn hoof sole meets timber approach');
 }
 console.log('PASS HORSE_PASS2_BROWSER');
}
