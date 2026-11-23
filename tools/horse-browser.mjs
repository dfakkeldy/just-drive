import {horsePass2Browser} from './horse-pass2-browser.mjs';
// RUN=horse-browser.mjs OUT=<horse picture folder> WEB_PORT=5314 CDP_PORT=9514 tools/yard-shots.sh 1600 900
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const [checkOut, first] = process.argv.slice(2), out = process.env.HORSE_PICTURES ?? checkOut, port = process.env.CDP_PORT;
mkdirSync(out,{recursive:true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {method:'PUT'})).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r,j) => {ws.onopen=r;ws.onerror=j;});
let id = 0; const waiting = new Map(), errors = [];
ws.onmessage = m => {const d=JSON.parse(m.data);if(d.id){waiting.get(d.id)?.(d);waiting.delete(d.id);}if(d.method==='Runtime.exceptionThrown')errors.push(d.params.exceptionDetails.exception?.description??d.params.exceptionDetails.text);if(d.method==='Runtime.consoleAPICalled'&&d.params.type==='error')errors.push(JSON.stringify(d.params.args));};
const send = (method,params={}) => new Promise(r => {const n=++id;waiting.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
const read = async expression => {const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.error||r.result?.exceptionDetails)throw Error(JSON.stringify(r));return r.result?.result?.value;};
const page = async (query,w=1600,h=900) => {
  await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});
  const url=new URL('/?hud=0&res=1&hour=12.5&exag=1.5&at=618990.1,5109215.9,350&scene=0&era=1884',first);
  new URLSearchParams(query).forEach((value,key)=>url.searchParams.set(key,value));
  if(url.searchParams.get('touch')==='1')url.searchParams.set('hud','1');
  await send('Page.navigate',{url:url.href});
  const start=Date.now();while(Date.now()-start<180000){await sleep(400);if(await read("document.documentElement.dataset.mmmReady==='true' && !!window.mmm"))break;}
  assert.equal(await read("document.documentElement.dataset.mmmReady==='true'"),true,'settled '+query);
  await read('window.horseRAF=window.requestAnimationFrame;window.requestAnimationFrame=f=>{window.horseFrame=f;return 0;}');await sleep(80);
  await read(`(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {autopilot}=await import('/src/vehicle.ts');
    const {vehicle:v,terrain:t,camera:c,renderer:r}=mmm,scene=v.car.root.parent;
    if(${!!process.env.HORSE_COARSE_ONLY}){t.maxLevel=6;for(const [key,tile]of t.tiles)if(tile.level>6){t.group.remove(tile.mesh);tile.mesh?.geometry.dispose();tile.mesh?.material.dispose();t.tiles.delete(key);}t.dataRevision++;t.contactRevision++;}
    const home={x:v.x,z:v.z,heading:v.heading};
    const settleView=async()=>{let quiet=0;for(let i=0;i<600;i++){
      // A camera jump can leave a partly built grass patch across a fine-tile boundary.
      // Request the full grass footprint, including the points behind the lens.
      const m=t.manifest,size=m.size/256;
      if(mmm.grass&&t.maxLevel>6)for(let dx=-64;dx<=64;dx+=32)for(let dz=-64;dz<=64;dz+=32){const tile=t.tile(8,Math.floor((c.position.x+dx+m.village[0]-m.origin[0])/size),Math.floor((c.position.z+dz-m.village[1]+m.origin[1])/size));if(tile&&!tile.ready)t.request(tile,0);}

      t.update(c);mmm.trees?.update(t.drawnFine,c.position);mmm.grass?.update(.1,c,v.x,v.z,v.heading,v.spec);mmm.roads.update(c.position);mmm.history?.update(c.position);mmm.coast?.update(c.position);mmm.animals?.update(0,v,c);mmm.roadScene?.update(c);mmm.props?.update(c,0);mmm.water?.update(c);
      try{r.render(scene,c);}finally{mmm.water?.settle();}mmm.water?.afterRender(c);
      quiet=t.pending===0&&!(mmm.trees?.pending??0)&&!(mmm.grass?.pending??0)?quiet+1:0;
      if(quiet>=5){t.withGroundContact(v,()=>v.update(0,{throttle:0,steer:0,handbrake:true}));r.render(scene,c);return;}
      await new Promise(r=>setTimeout(r,100));
    }throw Error('ground did not settle '+JSON.stringify({terrain:t.pending,trees:mmm.trees?.pending,grass:mmm.grass?.pending}));};
    const view=(side=5,back=3,height=2.4)=>{const rx=Math.cos(v.heading),rz=Math.sin(v.heading),fx=Math.sin(v.heading),fz=-Math.cos(v.heading);
      c.fov=52;c.updateProjectionMatrix();c.position.set(v.x+rx*side-fx*back,v.y+height,v.z+rz*side-fz*back);c.lookAt(v.x,v.y+1.42,v.z);c.updateMatrixWorld();};
    const tick=(seconds,speed,steer=0,followRoad=false)=>{let maxAir=0;for(let i=0;i<seconds*120;i++){
      const input=followRoad?{...autopilot(v,mmm.roads,speed),throttle:Math.max(-1,Math.min(1,(speed-v.speed)*2))}:{throttle:Math.max(-1,Math.min(1,(speed-v.speed)*2)),steer,handbrake:false};
      mmm.driveVehicle(1/120,input);maxAir=Math.max(maxAir,v.airborne?1:0);
    }return {speed:v.speed,surface:v.surfaceName,maxAir,x:v.x,z:v.z};};
    const feet=()=>{scene.updateMatrixWorld(true);t.group.updateMatrixWorld(true);const ray=new THREE.Raycaster(),land=new Set([...t.tiles.values()].map(q=>q.mesh)),meshes=[...land].filter(m=>m?.visible);mmm.roads.group.traverse(o=>{if(o.isMesh)meshes.push(o);});const result=[];
      // A visible parent retains triangles hidden by the LOD quadrant mask. Raycast the selected land mesh.
      const hitAt=(x,z)=>{const selected=t.selectedContactTile(x,z)??t.find(x,z);ray.set(new THREE.Vector3(x,1000,z),new THREE.Vector3(0,-1,0));return ray.intersectObjects(meshes,false).find(h=>!land.has(h.object)||h.object===selected?.mesh);};
      v.car.root.traverse(hoof=>{if(!hoof.name.startsWith('Hoof '))return;let min=Infinity,max=-Infinity,maxContact=-Infinity,n=0;const corners=[];
        const p=hoof.geometry.attributes.position;
        for(let i=0;i<p.count;i++)if(p.getY(i)<0){const q=new THREE.Vector3(p.getX(i),p.getY(i),p.getZ(i)).applyMatrix4(hoof.matrixWorld);
          const hit=hitAt(q.x,q.z);if(hit){
            const d=q.y-hit.point.y,support=v.groundAt(q.x,q.z);let contact=d,seam=false;
            // Timber planks deliberately have 18 mm gaps. A sole can span a gap at its edge.
            // Accept a ray within 20 mm INSIDE this same sole only when it hits the timber top.
            // A raised/tilted sole still fails the unchanged 4 cm bound against its support plane.
            if(d>.04&&support!==null&&Math.abs(q.y-support)<=.04){
              const inward=new THREE.Vector3(0,0,-Math.sign(p.getZ(i))).transformDirection(hoof.matrixWorld).multiplyScalar(.02),near=q.clone().add(inward);
              const next=hitAt(near.x,near.z);
              if(next?.object.name.startsWith('timber-bridge-')&&Math.abs(near.y-next.point.y)<=.04){contact=near.y-next.point.y;seam=true;}
            }
            min=Math.min(min,d);max=Math.max(max,d);maxContact=Math.max(maxContact,contact);n++;corners.push({x:q.x,y:q.y,z:q.z,gap:d,contact,seam,hit:hit.object.name,hitY:hit.point.y,support});
          }}
        const normal=new THREE.Vector3(0,1,0).applyQuaternion(hoof.getWorldQuaternion(new THREE.Quaternion()));result.push({name:hoof.name,planted:hoof.userData.planted,min,max,maxContact,n,normal:{x:normal.x,y:normal.y,z:normal.z},corners});});return result;};
    const placeOnBridge=(x,z,heading)=>{const support=Math.max(mmm.roads.deckHeight(x,z)??-Infinity,t.bridgeApproaches?.apronHeight(x,z)??-Infinity);if(!Number.isFinite(support))throw Error('known horse bridge pose needs its current deck or abutment');v.restart(x,z,heading);v.place(x,z,heading,support);};
    window.horseQA={home,view,tick,feet,settleView,placeOnBridge};
  })()`);
};
const shot = async name => {await read('horseQA.settleView()');const p=`${out}/${name}.png`;writeFileSync(p,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));console.log('PICTURE '+p);};
const contacts = async label => {const feet=await read('horseQA.feet()');writeFileSync(out+'/contacts-'+label.replaceAll(' ','-')+'.json',JSON.stringify(feet,null,2));assert.equal(feet.length,4);for(const f of feet.filter(f=>f.planted)){assert.ok(f.n>=4,'ray hits land '+label);assert.ok(f.min>=-.035 && f.maxContact<=.04,`${label} ${f.name} sole gap ${f.min}..${f.max}`);}console.log('CONTACT '+label,JSON.stringify(feet));};
try {
  await Promise.all([send('Runtime.enable'),send('Page.enable')]);
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.horseAudio=[];const Audio=window.AudioContext;window.AudioContext=class extends Audio{constructor(...args){super(...args);horseAudio.push(this);this.tones=0;this.buffers=0;this.noiseBuffers=0;}createBuffer(...args){this.noiseBuffers++;return super.createBuffer(...args);}createOscillator(){this.tones++;return super.createOscillator();}createBufferSource(){this.buffers++;return super.createBufferSource();}};`});
  if(process.env.HORSE_COARSE_ONLY){
    await page('q=high&vehicle=horse');
    await read(`(async()=>{const v=mmm.vehicle,t=mmm.terrain,c=mmm.camera,r=mmm.roads.roads.find(r=>r.id===97),p=r.pts,mid=[(p[0][0]+p.at(-1)[0])/2,(p[0][1]+p.at(-1)[1])/2];c.position.set(mid[0]+12,(t.meshHeightAt(mid[0]+12,mid[1]+12,true)??t.heightAt(mid[0]+12,mid[1]+12))+22,mid[1]+12);c.lookAt(mid[0],(t.heightAt(mid[0],mid[1])??0)+1,mid[1]);c.updateMatrixWorld();await horseQA.settleView();horseQA.placeOnBridge(p[0][0],p[0][1],Math.atan2(p.at(-1)[0]-p[0][0],p[0][1]-p.at(-1)[1]));v.vx=Math.sin(v.heading)*4;v.vz=-Math.cos(v.heading)*4;v.speed=4;})()`);
    const trace=await read(`(()=>{const v=mmm.vehicle,r=mmm.roads.roads.find(r=>r.id===97),p=r.pts,a=p[0],b=p.at(-1),length=Math.hypot(b[0]-a[0],b[1]-a[1]);const supportingLevels=new Set();let max=0,core=0,where=null,progress=0;for(let i=0;i<2400&&progress<length+5;i++){progress=((v.x-a[0])*(b[0]-a[0])+(v.z-a[1])*(b[1]-a[1]))/length;const goal=Math.min(length+7,progress+6),gx=a[0]+(b[0]-a[0])*goal/length,gz=a[1]+(b[1]-a[1])*goal/length,h=Math.atan2(gx-v.x,v.z-gz),err=Math.atan2(Math.sin(h-v.heading),Math.cos(h-v.heading));mmm.driveVehicle(1/120,{throttle:Math.abs(v.speed)<4?1:Math.abs(v.speed)>5?-.1:0,steer:Math.max(-1,Math.min(1,err*2)),handbrake:false});for(const p of v.groundContacts)supportingLevels.add((mmm.terrain.selectedContactTile(p.x,p.z)??mmm.terrain.drawnTile(p.x,p.z))?.level);const deck=mmm.roads.deckHeight(v.x,v.z);if(deck!==null){const gap=Math.abs(v.y-deck);if(gap>max){max=gap;where={progress,y:v.y,deck,contacts:v.groundContacts.map(p=>({x:p.x,z:p.z,h:p.height}))};}if(progress>2&&progress<length-2)core=Math.max(core,gap);}}const tileLevels=[...supportingLevels];return{kind:mmm.vehicleId,wheelbase:v.spec.wheelbase,length,max,core,where,progress,completed:progress>=length+5,tileLevels};})()`);writeFileSync(out+'/coarse-trace-horse.json',JSON.stringify(trace,null,2));console.log('COARSE TRACE',trace);assert.ok(trace.completed,'horse progresses past far bank');assert.deepEqual(trace.tileLevels,[6],'real supporting land is level 6');assert.ok(trace.max<1,'whole crossing including the coarse-bank approaches stays on its support');
    await read(`(()=>{const v=mmm.vehicle,r=mmm.roads.roads.find(r=>r.id===97),p=r.pts;horseQA.placeOnBridge((p[0][0]+p.at(-1)[0])/2,(p[0][1]+p.at(-1)[1])/2,Math.atan2(p.at(-1)[0]-p[0][0],p[0][1]-p.at(-1)[1]));})()`);
    const drive=await read('horseQA.tick(.1,4,0,true)');console.log('COARSE DRIVE',drive);await shot('coarse-deck');await contacts('coarse timber deck');
    const floating=await read('(()=>{const root=mmm.vehicle.car.root,y=root.position.y;try{root.position.y+=.1;return horseQA.feet().filter(f=>f.planted).map(f=>f.maxContact);}finally{root.position.y=y;root.updateMatrixWorld(true);}})()');assert(floating.some(gap=>gap>.04),'contact oracle rejects a horse raised 10 cm');writeFileSync(out+'/contact-oracle-negative.json',JSON.stringify({raisedBy:.1,plantedGaps:floating},null,2));
    const evidence=await read('({tileLevels:[...new Set(mmm.vehicle.groundContacts.map(p=>(mmm.terrain.selectedContactTile(p.x,p.z)??mmm.terrain.drawnTile(p.x,p.z))?.level))],bodyGap:mmm.vehicle.y-mmm.roads.deckHeight(mmm.vehicle.x,mmm.vehicle.z),feet:horseQA.feet()})');writeFileSync(out+'/coarse-deck.json',JSON.stringify(evidence,null,2));assert.deepEqual(evidence.tileLevels,[6],'exercise real level-6 supporting land');
    assert.ok(Math.abs(await read('mmm.vehicle.y-mmm.roads.deckHeight(mmm.vehicle.x,mmm.vehicle.z)'))<.05,'coarse bank never raises horse off the timber plane');
  }else if(process.env.HORSE_PASS2){await horsePass2Browser({read,page,shot,send,sleep,out});}else{
  await page('q=low');
  assert.equal(await read('mmm.vehicleId'),'horse','1884 default is horse');
  console.log('RENDERER',await read('(()=>{const gl=mmm.renderer.getContext(),ext=gl.getExtension("WEBGL_debug_renderer_info");return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);})()'));
  // Pose beside the nearest trade. Use its actual yaw and dimensions, with no changed terrain.
  const trade=await read(`(()=>{const v=mmm.vehicle;return mmm.history.models.filter(m=>m.site.kind!=='farm').sort((a,b)=>Math.hypot(a.site.x-v.x,a.site.z-v.z)-Math.hypot(b.site.x-v.x,b.site.z-v.z))[0].site;})()`);
  await read(`(()=>{const s=${JSON.stringify(trade)},v=mmm.vehicle;v.restart(s.x+Math.sin(s.yaw)*(s.length/2+8)+Math.cos(s.yaw)*5,s.z+Math.cos(s.yaw)*(s.length/2+8)-Math.sin(s.yaw)*5,Math.PI/2-s.yaw);horseQA.view(6.7,0,2.7);})()`);await shot('standing-side');await contacts('standing');
  for(const offset of [-.1,.1]){
    const shifted=await read(`(()=>{const root=mmm.vehicle.car.root,y=root.position.y;try{root.position.y+=${offset};return horseQA.feet().filter(f=>f.planted);}finally{root.position.y=y;root.updateMatrixWorld(true);}})()`);
    assert(shifted.some(f=>offset<0?f.min<-.035:f.maxContact>.04),'ray oracle rejects a horse shifted '+offset+' m');
  }
  const home=await read('({x:mmm.vehicle.x,z:mmm.vehicle.z,heading:mmm.vehicle.heading})');
  // Five equally spaced poses from the production rig's stride clock; each panel retains the same ground/camera.
  for(const [name,speed]of [['walk',1.7],['trot',3.8],['canter',6.5],['gallop',10]]){
    const files=[],poses=[];
    for(let i=0;i<5;i++){
      await read(`(()=>{const v=mmm.vehicle;v.restart(${home.x},${home.z},${home.heading});v.car.phase=${i/5};v.speed=${speed};v.update(0,{throttle:0,steer:0,handbrake:false});horseQA.view(6.7,0,2.7);})()`);
      await read('horseQA.settleView()');
      const pose=await read('({phase:mmm.vehicle.car.phase,feet:horseQA.feet()})');poses.push(pose);
      const file=`${out}/.${name}-${i}.png`;files.push(file);
      writeFileSync(file,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
    }
    execFileSync('python3',['-c',`from PIL import Image, ImageDraw, ImageFont
import sys
out,name,*files=sys.argv[1:]
canvas=Image.new('RGB',(1600,900),'#e8e2d6');d=ImageDraw.Draw(canvas)
def choose_font(size):
 for path in ['/System/Library/Fonts/Helvetica.ttc','DejaVuSans.ttf']:
  try:return ImageFont.truetype(path,size)
  except OSError:pass
 return ImageFont.load_default()
font=choose_font(22)
big=choose_font(38)
d.text((35,26),name.upper()+' — ONE STRIDE / MABOU, 1884',fill='#302d26',font=big)
for i,f in enumerate(files):
 im=Image.open(f).crop((475,45,1125,895)).resize((320,418))
 canvas.paste(im,(i*320,175))
 d.text((i*320+15,640),str(i*20)+'% of stride',fill='#302d26',font=font)
d.text((35,835),'Production rig • five equal phase steps • Hill height 1.5 • no terrain or hoof overrides',fill='#4e493f',font=font)
canvas.save(out+'/'+name+'-stride.png')`,out,name,...files]);
    files.forEach(f=>rmSync(f));console.log('STRIDE',name,JSON.stringify(poses));
  }
  await read(`(()=>{const v=mmm.vehicle;v.car.phase=.90;v.speed=10;v.update(0,{throttle:0,steer:0,handbrake:false});horseQA.view(4.7,.4,2.2);})()`);await shot('gallop-suspension');
  assert.equal(await read('horseQA.feet().every(f=>!f.planted&&f.min>.03)'),true,'all four drawn hoof soles airborne');
  // Real forward travel on a cart road, retaining default inputs, contacts and collision resolution.
  await read('mmm.vehicle.respawn();horseQA.view()');await read('horseQA.settleView()');
  console.log('CART ROAD',await read('horseQA.tick(4,3.8,0,true)'));await contacts('cart-road');
  await read('mmm.vehicle.car.driverEye.getWorldPosition(mmm.camera.position);mmm.camera.rotation.set(mmm.vehicle.pitch*.8,-mmm.vehicle.heading,0);mmm.camera.fov=68;mmm.camera.updateProjectionMatrix();mmm.camera.updateMatrixWorld()');await shot('riders-eye');
  const bridge=await read('mmm.roads.roads.find(r=>r.bridge&&r.id===28)');
  const bp=bridge.pts[Math.floor(bridge.pts.length/2)],ba=bridge.pts[0],bb=bridge.pts.at(-1),bh=Math.atan2(bb[0]-ba[0],ba[1]-bb[1]);
  await read(`mmm.vehicle.restart(${bp[0]},${bp[1]},${bh});horseQA.view(8,6,3.2)`);await read('horseQA.settleView()');await read(`horseQA.placeOnBridge(${bp[0]},${bp[1]},${bh})`);console.log('BRIDGE',await read('horseQA.tick(.6,2,0,true)'));await read('horseQA.view(8,6,3.2)');await shot('timber-bridge');await contacts('timber-bridge');
  // History collision is in the shared fixed-step path. Deliberately enter a live trade solid.
  const collision=await read(`(()=>{const m=mmm.history.models.find(m=>m.site.id===${JSON.stringify(trade.id)}),s=m.site,v=mmm.vehicle;v.restart(s.x,s.z,0);const before={x:v.x,z:v.z};mmm.history.update(m.node.position);mmm.history.resolve(v);return{distance:Math.hypot(v.x-before.x,v.z-before.z),active:m.solidsPublished};})()`);
  assert.equal(collision.active,true);assert.ok(collision.distance>.4,'horse is pushed out of era building');console.log('BUILDING',collision);
  // Real open-grass corridor from the baked-land handling test. Farm 768 lies ahead of it in this era.
  await read('mmm.vehicle.restart(-5200,-5870,Math.PI/12);horseQA.view(6,8,4.4)');await read('horseQA.settleView()');
  const field=await read('horseQA.tick(8,9)');assert.equal(field.surface,'grass');assert.ok(field.speed>=8,'actual field gallop');assert.equal(field.maxAir,0);console.log('FIELD',field);
  await read('horseQA.view(6,8,4.4)');await shot('field-farmstead');await contacts('field gallop');
  // All areas load the same unconditional garage entry. Selection/default semantics also have CPU cases.
  await page('title=1&hud=1&q=low');
  assert.deepEqual(await read('[...document.querySelectorAll("#vehicleChoice button")].map(b=>b.dataset.vehicle)'),['horse','car','sxs','bike','drone']);
  assert.equal(await read('document.querySelector("#vehicleChoice [data-vehicle=horse]").getAttribute("aria-pressed")'),'true');
  assert.doesNotMatch(await read('document.querySelector("#title dl").textContent'),/radio|wiper|plate|repair|trailer/i);
  await shot('vehicle-choice');
  const selected=async kind=>{await read(`setTimeout(()=>document.querySelector('#vehicleChoice [data-vehicle=${kind}]').click(),0)`);let ready=false;for(let i=0;i<180;i++){await sleep(300);try{if(await read(`document.documentElement.dataset.mmmReady==='true'&&mmm.vehicleId==='${kind}'`)){ready=true;break;}}catch{}}assert(ready,'real UI selection '+kind);assert.equal(await read('localStorage.getItem("mmm.vehicle")'),kind);};
  await selected('car');await selected('horse');
  await page('vehicle=bike&q=low');assert.equal(await read('mmm.vehicleId'),'bike');
  await page('vehicle=horse&touch=1&q=low',390,844);await read('horseQA.view(-4,6,3)');await shot('phone');
  assert.equal(await read('document.getElementById("tcHorn").textContent'),'WHINNY');
  assert.equal(await read('getComputedStyle(document.getElementById("tcGo")).display!=="none"'),true);
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  const go=await read('(()=>{const r=document.getElementById("tcGo").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()');
  const before=await read('({x:mmm.vehicle.x,z:mmm.vehicle.z})');await read('window.requestAnimationFrame=window.horseRAF;requestAnimationFrame(window.horseFrame)');
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,...go}]});await sleep(2500);await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'h',code:'KeyH'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'h',code:'KeyH'});
  await read('(async()=>{await Promise.all(horseAudio.map(a=>a.resume()));})()');await sleep(700);
  const audio=await read('horseAudio.map(a=>({state:a.state,tones:a.tones,buffers:a.buffers}))');console.log('AUDIO',audio);
  assert.ok(audio.some(a=>a.state==='running'&&a.tones>=2&&a.buffers>0),'live hoof beats and whinny synthesize audio');
  const after=await read('({x:mmm.vehicle.x,z:mmm.vehicle.z,speed:mmm.vehicle.speed,damage:mmm.shift.damage.items,radio:!!mmm.radio})');assert.ok(Math.hypot(after.x-before.x,after.z-before.z)>1,'phone GO moves horse');assert.deepEqual(after.damage,[]);assert.equal(after.radio,false);console.log('PHONE',before,after);
  await send('Emulation.setTouchEmulationEnabled',{enabled:false});
  // Horse is the 1884 ride only; today's game asked for a horse (and a saved horse) gives the car.
  await page('era=today&vehicle=horse&q=low');assert.equal(await read('mmm.vehicleId'),'car','today gives the car for vehicle=horse');
  if(process.env.HORSE_TODAY==='1'){
  await page('era=today&vehicle=horse&trailer=1&q=low&road=Highway%2019&f=.5');await read('mmm.vehicle.speed=10;mmm.vehicle.car.phase=.4;mmm.vehicle.update(0,{throttle:0,steer:0,handbrake:false});horseQA.view(6,3,2.8)');await shot('today-highway');await contacts('today');
  assert.equal(await read('!!mmm.radio'),false);
  assert.equal(await read('!!mmm.towing'),false,'horse never hitches a requested trailer');
  assert.deepEqual(await read('mmm.shift.damage.items'),[]);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'h',code:'KeyH'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'h',code:'KeyH'});
  assert.ok(await read('horseAudio.some(a=>a.tones>=2)'), 'H synthesizes whinny in today too');
  const reset=await read('(()=>{const v=mmm.vehicle;v.respawn();return {speed:v.speed,x:v.x,z:v.z,vy:v.vy};})()');assert.equal(reset.vy,0);assert.equal(reset.speed,0);
  }
  await page('era=today&q=low');assert.equal(await read('mmm.vehicleId'),'car');console.log('DEFAULT CAR',await read('horseQA.tick(3,8)'));
  }
  assert.deepEqual(errors,[],'no console errors or exceptions');console.log('PASS horse browser');
}finally{await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);ws.close();}
