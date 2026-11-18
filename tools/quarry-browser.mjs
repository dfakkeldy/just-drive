#!/usr/bin/env node
// Real game on the caller's ports. OUT contains requested pictures only; QUARRY_REPORT selects a JSON receipt.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {open,sleep} from './cdp.mjs';
import {tyreContacts} from './tyre-contacts.mjs';
import {quarryLoop} from './quarry-loop.mjs';
const LOOP_SPEED=Number(process.env.QUARRY_LOOP_SPEED??5.5);assert.ok(LOOP_SPEED>=1&&LOOP_SPEED<=8);
const[out,first]=process.argv.slice(2),origin=new URL(first).origin,results=[],failures=[];
const compact=data=>JSON.parse(JSON.stringify(data,(key,value)=>key==='samples'?undefined:value));
const check=(ok,label,data)=>{data=compact(data);console.log(ok?'PASS':'FAIL',label,ok?'':JSON.stringify(data));results.push({label,ok,data});if(!ok)failures.push(label);};
const reject=(label,test,value)=>{assert.ok(!test(value),'mutation escaped '+label);console.log('REJECTED',label);};
const p=await open(process.env.QUARRY_UI_ONLY?`${origin}/?area=westbay&mode=explore&vehicle=truck&trailer=1&hud=1&title=1&radio=0&res=1`:process.env.QUARRY_LOOP_ONLY?`${origin}/?area=westbay&mode=explore&vehicle=car&cam=631530,5063953,20,0,-25,60&camground=1&hud=0&radio=0&exag=1.5&res=1`:`${origin}/?area=westbay&mode=explore&vehicle=truck&trailer=1&trip=quarry-gate&cam=631980,5061900,32,340,-20,65&camground=1&exag=1.5&hud=1&radio=0&res=1&shadows=1`);
const originalShot=p.shot.bind(p);p.shot=file=>originalShot(/(?:gate-approach|wall-from-water)\.png$/.test(file)?file:file.replace(/(?:-v1)?\.png$/,'-v2.png'));
// Trip boot normalises the address. Wait for the requested view and ready state, allowing its explicit preset keys.
p.navigate=async url=>{
  const q=[...new URL(url).searchParams.entries()].filter(([k])=>!['at','road','f','dir','demo','shot'].includes(k));
  await p.send('Page.navigate',{url});let ready=false;
  for(let i=0;i<1200;i++){await sleep(250);if(await p.read(`document.title==='settled'&&document.readyState==='complete'&&${JSON.stringify(q)}.every(([k,v])=>new URLSearchParams(location.search).get(k)===v)`)){ready=true;break;}}
  assert.ok(ready,'requested quarry page settles '+url);
};
async function setup(){await p.read(`(async()=>{
 const THREE=await import('/node_modules/three/build/three.module.js'),trip={...await import('/src/quarry-trip.ts'),...await import('/src/quarry-route.ts')},site=await import('/src/quarry-site.ts'),{touchesPlayer}=await import('/src/road-scene-rules.ts');
 window.requestAnimationFrame=f=>{window.quarryFrame=f;return 0;};
 const {terrain:t,camera:c,renderer:r,quarry:k,vehicle:v,towing:tow,trees,water,roads}=mmm;let scene=v.car.root;while(scene.parent)scene=scene.parent;
 window.qp={THREE,t,c,r,k,v,tow,scene,trip,site,roads,trees,water,touchesPlayer};
 qp.flushFrames=async(n=22)=>{for(let i=0;i<n;i++){await new Promise(r=>setTimeout(r,65));window.quarryFrame?.(performance.now());}};
 qp.draw=()=>{t.uniforms.time.value=120;k.update(c.position,v);water?.update(c);try{r.render(scene,c);}finally{water?.settle();}water?.afterRender(c);};
 qp.view=async(e,n,eye=35,heading=0,pitch=-25)=>{
  const x=e-t.manifest.village[0],z=t.manifest.village[1]-n;
  c.position.set(x,(t.heightAt(x,z)??50)+eye,z);c.rotation.order='YXZ';c.rotation.set(pitch*Math.PI/180,-heading*Math.PI/180,0);c.updateMatrixWorld();
  for(let i=0;i<220;i++){t.update(c);trees?.update(t.drawnFine,c.position);roads.update(c.position);k.update(c.position,v);qp.draw();await new Promise(r=>setTimeout(r,20));if(t.pending===0&&!(trees?.pending??0)&&i>18)break;}
  // A camera jump must refit against the newly drawn land, then update trees AND the actual mirror.
  c.position.y=(t.heightAt(x,z)??50)+eye;c.updateMatrixWorld();for(let i=0;i<6;i++){t.update(c);trees?.update(t.drawnFine,c.position);k.update(c.position,v);qp.draw();await new Promise(r=>setTimeout(r,20));}
 };
 qp.down=(x,z)=>{
   const meshes=[];t.group.updateMatrixWorld(true);for(const mesh of t.group.children)if(mesh.visible&&mesh.isMesh)meshes.push(mesh);
   const ray=new THREE.Raycaster(new THREE.Vector3(x,3000,z),new THREE.Vector3(0,-1,0));
   return ray.intersectObjects(meshes,false).find(hit=>{const hide=hit.object.material.uniforms.hideQuad.value,u=hit.uv;return hide.getComponent((u.x>=.5?1:0)+(u.y>=.5?2:0))<.5;})?.point.y??null;
 };
 qp.feet=()=>{k.fixtures.updateWorldMatrix(true,true);const mesh=k.fixtures.children[0],pos=mesh.geometry.attributes.position,p=new THREE.Vector3(),rows=[];for(const f of k.feet)for(const i of f.vertices){p.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);const y=qp.down(p.x,p.z);rows.push({kind:f.kind,gap:y===null?null:p.y-y,x:p.x,z:p.z});}return{count:rows.length,rows};};
 qp.signFaces=()=>{k.fixtures.updateWorldMatrix(true,true);const mesh=k.fixtures.children[1],objects=k.fixtures.children,out=[];for(const b of k.boards){const x=b.e-t.manifest.village[0],z=t.manifest.village[1]-b.n,y=t.meshHeightAt(x,z,true);if(y===null)continue;const normal=new THREE.Vector3(Math.sin(b.yaw),0,Math.cos(b.yaw)),at=new THREE.Vector3(x,y+(b.lift??2.4),z),ray=new THREE.Raycaster(at.clone().addScaledVector(normal,5),normal.clone().negate());const hit=ray.intersectObjects(objects,false)[0];out.push(hit?.object===mesh);}return{count:out.length,all:out.every(Boolean)};};
 qp.blocks=()=>{const mesh=k.rocks.mesh,pos=mesh.geometry.attributes.position,matrix=new THREE.Matrix4(),v=new THREE.Vector3();mesh.updateWorldMatrix(true,false);let low=Infinity,high=-Infinity,missing=0,vertices=0;for(let b=0;b<mesh.count;b++){mesh.getMatrixAt(b,matrix);for(let i=0;i<pos.count;i++)if(pos.getY(i)===0){v.fromBufferAttribute(pos,i).applyMatrix4(matrix).applyMatrix4(mesh.matrixWorld);const h=qp.down(v.x,v.z);if(h===null)missing++;else{low=Math.min(low,v.y-h+k.rocks.blocks[b].burial);high=Math.max(high,v.y-h);vertices++;}}}return{count:mesh.count,low,high,missing,vertices};};
 qp.step=(throttle=0,steer=0,handbrake=false)=>mmm.driveVehicle(1/120,{throttle,steer,handbrake});
 qp.makeLoop=${quarryLoop.toString()};
 qp.probeTyres=${tyreContacts.toString()};
 qp.contacts=()=>{v.car.root.updateMatrixWorld(true);tow?.trailer.root.updateMatrixWorld(true);const wheels=[...Object.entries(v.car.wheels).map(([name,wheel])=>({name,wheel,radius:v.spec.wheelRadius})),...(v.car.extraWheels??[]).map((wheel,i)=>({name:'dual'+i,wheel,radius:v.spec.wheelRadius})),...(tow?.trailer.wheels??[]).map((wheel,i)=>({name:'trailer'+i,wheel,radius:.34}))];return qp.probeTyres(THREE,wheels,[t.group]);};
 qp.park=()=>{v.assist=0;for(let i=0;i<360;i++)qp.step(0,0,true);tow?.update();return qp.contacts();};
 qp.chase=async()=>{mmm.chase(1);c.updateMatrixWorld();for(let i=0;i<90;i++){t.update(c);trees?.update(t.drawnFine,c.position);k.update(c.position,v);qp.draw();await new Promise(r=>setTimeout(r,20));} };
 qp.portal=()=>{const gate=site.GATE,x=gate.e-t.manifest.village[0],z=t.manifest.village[1]-gate.n,ground=qp.down(x,z),pos=k.fixtures.children[0]?.geometry.attributes.position,cg=Math.cos(gate.heading),sg=Math.sin(gate.heading);let beam=Infinity,vertices=0,highest=-Infinity;
   if(pos){const point=new THREE.Vector3();k.fixtures.updateWorldMatrix(true,true);for(const i of k.portalBeamVertices){point.fromBufferAttribute(pos,i).applyMatrix4(k.fixtures.children[0].matrixWorld);beam=Math.min(beam,point.y);vertices++;}}
   for(let u=-2.5;u<=2.5;u+=.25){const y=qp.down(x+cg*u,z+sg*u);if(y!==null)highest=Math.max(highest,y);}
   const posts=k.feet.filter(f=>f.kind==='portal'),centres=posts.map(p=>(p.x-x)*cg+(p.z-z)*sg).sort((a,b)=>a-b);
   return{vertices,beam,clearance:beam-highest,opening:centres.length===2?centres[1]-centres[0]-.5:0};};
 qp.portalLetters=()=>{const b=k.boards.find(b=>b.portal),g=k.atlas.canvas.getContext('2d'),cell=k.signCells[k.boards.indexOf(b)],w=Math.round((cell[2]-cell[0])*k.atlas.canvas.width),h=Math.round((cell[3]-cell[1])*k.atlas.canvas.height),px=g.getImageData(0,0,w,h).data;let left=w,right=0,count=0;
  for(let y=12;y<h-12;y++)for(let x=12;x<w-12;x++){const i=(y*w+x)*4;if(px[i]>232&&px[i+1]>230&&px[i+2]>222&&px[i+3]>200){left=Math.min(left,x);right=Math.max(right,x);count++;}}
  const pos=k.fixtures.children[0].geometry.attributes.position,cg=Math.cos(site.GATE.heading),sg=Math.sin(site.GATE.heading),gx=site.GATE.e-t.manifest.village[0],gz=t.manifest.village[1]-site.GATE.n;
  const posts=k.feet.filter(f=>f.kind==='portal').map(f=>f.vertices.map(i=>(pos.getX(i)-gx)*cg+(pos.getZ(i)-gz)*sg)).sort((a,b)=>Math.min(...a)-Math.min(...b));
  const innerLeft=Math.max(...posts[0]),innerRight=Math.min(...posts[1]),textLeft=(left/w-.5)*b.width,textRight=(right/w-.5)*b.width;
  return{count,innerLeft,innerRight,textLeft,textRight,fits:count>100&&textLeft>innerLeft+.1&&textRight<innerRight-.1};};
 qp.cost=()=>{const reset=r.info.autoReset,visible=k.group.visible,wet=k.water.group.visible;
  r.info.autoReset=false;r.info.reset();qp.draw();const full={calls:r.info.render.calls,triangles:r.info.render.triangles};
  k.group.visible=false;k.water.group.visible=false;r.info.reset();qp.draw();const base={calls:r.info.render.calls,triangles:r.info.render.triangles};
  k.group.visible=visible;k.water.group.visible=wet;r.info.autoReset=reset;qp.draw();return{calls:full.calls-base.calls,triangles:full.triangles-base.triangles};};
 qp.model=()=>{let triangles=0,calls=0;for(const group of[k.group,k.water.group])group.traverse(o=>{if(o.isMesh){const n=o.isInstancedMesh?o.count:1;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3*n;calls++;}});return{triangles,calls,rocks:k.rocks.mesh.count,lakeTriangles:k.water.meshes.map(m=>m.geometry.attributes.position.count/3)};};
})()`);await sleep(80);}
const seated=a=>a.length>=10&&a.every(c=>c.ray&&c.penetration<.04&&c.float<.04);
const grounded=a=>a.count>8&&a.rows.every(f=>f.gap!==null&&f.gap<=.03&&f.gap> -1.3);
const rockGrounded=a=>a.count>0&&a.missing===0&&a.vertices>0&&a.low>-1.07&&a.high<.035;
async function runUI(){
 await p.read("document.getElementById('titleStart')?.click()");await sleep(100);await setup();
 const far=await p.read('({children:qp.k.fixtures.children.length,visible:qp.k.fixtures.visible})');check(far.children===0&&!far.visible,'Distant quarry does not construct/rebuild fixture geometry',far);
 const click=async id=>{await p.read(`mmm.places.update(qp.v,true);document.getElementById('placesButton').click()`);const b=await p.read(`(()=>{const r=document.querySelector('[data-place="${id}"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await p.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...b});await p.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...b});};
 await click('marble-shore');
 const end=await p.read(`({e:qp.v.x+qp.t.manifest.village[0],n:qp.t.manifest.village[1]-qp.v.z,attached:qp.tow.attached,clear:qp.tow.pairClear(),road:qp.roads.nearest(qp.v.x,qp.v.z,20)?.dist})`);check(Math.hypot(end.e-654898.3,end.n-5077551.38)<85&&end.attached&&end.clear&&end.road<2,'Far shore-road place accepts a clear loaded rig within its visit radius',end);
 const menuTrip=async blocked=>{
  await p.read(`document.getElementById('titleStart')?.click();mmm.places.update(qp.v,true);window.__quarryUIVisit='old';const a=qp.site.APRON;sessionStorage.setItem(qp.trip.tripStorageKey('quarry-gate'),JSON.stringify({x:a.e-qp.t.manifest.village[0],z:qp.t.manifest.village[1]-a.n,heading:0}));${blocked?"const remove=Storage.prototype.removeItem;Storage.prototype.removeItem=function(key){if(key!=='mmm.trip.quarry-gate')return remove.call(this,key)};":''}`);
  await click('near-sugar-camp');let ready=false;
  for(let i=0;i<1200;i++){await sleep(250);try{if(await p.read(`window.__quarryUIVisit!=='old'&&document.title==='settled'&&document.readyState==='complete'&&!!window.mmm?.journey`)){ready=true;break;}}catch{/* navigation replaces the execution context */}}
  assert.ok(ready,'menu trip settles');await setup();return p.read(`({distance:Math.hypot(qp.v.x-mmm.journey.route.near.x,qp.v.z-mmm.journey.route.near.z),attached:qp.tow.attached,loaded:qp.tow.loaded,title:!!document.getElementById('titleStart'),vehicle:mmm.vehicleId})`);
 };
 const starts=r=>r.distance<.1&&r.attached&&r.loaded&&r.title&&r.vehicle==='truck';
 const first=await menuTrip(false);check(starts(first),'Start near the gate menu action resets saved progress and selects the rig',first);
 const blocked=await menuTrip(true);reject('prevent explicit preset progress reset',starts,blocked);
 const restored=await menuTrip(false);check(starts(restored),'Normal preset action restores the correct start after the mutation',restored);
}
async function runLoop(){
 if(!process.env.QUARRY_LOOP_ONLY)await p.navigate(`${origin}/?area=westbay&mode=explore&vehicle=car&cam=631530,5063953,20,0,-25,60&camground=1&hud=0&radio=0&exag=1.5&res=1`);await setup();
 // Drive the complete mapped Lake Loop on the west-wall benches; it is not an invented perimeter road.
 const loop=await p.read(`(()=>{qp.loop=qp.makeLoop(qp.roads.roads);qp.loopAt=0;qp.loopTravel=0;qp.loopHits=0;qp.v.onSolidImpact=()=>qp.loopHits++;return{length:qp.loop.length,gaps:qp.loop.gaps,first:qp.loop.points[0]};})()`);
 await p.read(`(async()=>{const q=qp.loop.points[0],next=qp.loop.points[1];await qp.view(q.x+qp.t.manifest.village[0],qp.t.manifest.village[1]-q.z,20,0,-25);qp.v.place(q.x,q.z,Math.atan2(next.x-q.x,q.z-next.z));qp.v.assist=0;})()`);
 let loopState={at:0};
 for(let chunk=0;chunk<130&&loopState.at<loop.length-8;chunk++){
  loopState=await p.read(`(async()=>{const path=qp.loop,input={throttle:0,steer:0,handbrake:false};for(let i=0;i<2400&&qp.loopAt<path.length-8;i++){let nearest=Infinity,at=qp.loopAt;for(let j=1;j<path.points.length;j++){if(path.cumulative[j]<qp.loopAt-12||path.cumulative[j-1]>qp.loopAt+65)continue;const a=path.points[j-1],b=path.points[j],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((qp.v.x-a.x)*dx+(qp.v.z-a.z)*dz)/(dx*dx+dz*dz||1))),d=(qp.v.x-a.x-dx*t)**2+(qp.v.z-a.z-dz*t)**2;if(d<nearest){nearest=d;at=path.cumulative[j-1]+(path.cumulative[j]-path.cumulative[j-1])*t;}}qp.loopAt=Math.max(qp.loopAt,at);const goal=qp.trip.poseAlong(path,qp.loopAt+6),want=Math.atan2(goal.x-qp.v.x,qp.v.z-goal.z),angle=Math.atan2(Math.sin(want-qp.v.heading),Math.cos(want-qp.v.heading));input.steer=Math.max(-1,Math.min(1,angle*2.0));input.throttle=Math.max(-1,Math.min(1,(${LOOP_SPEED}-qp.v.speed)*.8));const x=qp.v.x,z=qp.v.z;mmm.driveVehicle(1/120,input);qp.loopTravel+=Math.hypot(qp.v.x-x,qp.v.z-z);}mmm.chase(1);qp.c.updateMatrixWorld();for(let i=0;i<12;i++){qp.t.update(qp.c);qp.trees?.update(qp.t.drawnFine,qp.c.position);qp.k.update(qp.c.position);qp.draw();await new Promise(r=>setTimeout(r,10));}return{at:qp.loopAt,travel:qp.loopTravel,hits:qp.loopHits,e:qp.v.x+qp.t.manifest.village[0],n:qp.t.manifest.village[1]-qp.v.z,speed:qp.v.speed,stuck:qp.v.stuck,surface:qp.t.surfaceAt(qp.v.x,qp.v.z)};})()`);
  if(chunk===3){await p.read('qp.chase()');await p.shot(`${out}/haul-road-chase.png`);}
 }
 check(loopState.at>loop.length-10&&loopState.travel>1250&&loopState.hits===0,'Car drives the full 1.307 km Lake Loop on mapped bench roads',loopState);
 const carPlacement=await p.read(`(()=>{const old={x:qp.v.x,z:qp.v.z,heading:qp.v.heading};let accepted=0;for(const s of qp.k.solids){qp.v.place(s.x,s.z,0);if(Math.hypot(qp.v.x-s.x,qp.v.z-s.z)<.1)accepted++;}qp.v.place(old.x,old.z,old.heading);return{count:qp.k.solids.length,accepted};})()`);check(carPlacement.count>40&&carPlacement.accepted===0,'Car placement rejects every quarry fixture and large block',carPlacement);
}
try{
 if(process.env.QUARRY_LETTER_ONLY){await p.navigate(`${origin}/?area=westbay&mode=explore&vehicle=truck&trailer=1&cam=631980,5061900,32,340,-20,65&camground=1&exag=1&hud=0&radio=0&res=1`);await setup();await p.read('qp.view(632004,5061889,2.2,350,4)');const label=await p.read('qp.portalLetters()');check(label.fits,'Actual portal lettering stays inside both timber posts',label);
  const widened=await p.read(`(()=>{const g=qp.k.atlas.canvas.getContext('2d');qp.oldLetterPixels=g.getImageData(0,0,2040,200);g.fillStyle='#f0eee5';g.fillRect(14,70,30,60);return qp.portalLetters();})()`);reject('actual lettering painted behind the left post',a=>a.fits,widened);await p.read('qp.k.atlas.canvas.getContext("2d").putImageData(qp.oldLetterPixels,0,0);qp.k.atlas.texture.needsUpdate=true;qp.draw()');await p.shot(`${out}/gate.png`);
  await p.navigate(`${origin}/?area=westbay&mode=explore&cam=632050.47,5061797.58,2.2,333.24,4,60&camground=1&exag=1.5&hud=0&radio=0&res=1&shadows=1`);await setup();const approach=await p.read('qp.portalLetters()');check(approach.fits,'Approach keeps the complete park name visible between posts',approach);await p.shot(`${out}/gate-approach.png`);
 }else if(process.env.QUARRY_UI_ONLY){await runUI();}else if(process.env.QUARRY_LOOP_ONLY){await runLoop();}else{
 for(const hill of(process.env.QUARRY_HILLS??'1,1.5,2,2.5').split(',').map(Number)){
  await p.navigate(`${origin}/?area=westbay&trip=quarry-gate&cam=631980,5061900,32,340,-20,65&camground=1&exag=${hill}&hud=1&radio=0&res=1&shadows=1`);await setup();
  await p.read(`document.getElementById('titleStart')?.click()`);
  await p.read('qp.view(632004,5061889,2.2,350,4)');
  const portal=await p.read('qp.portal()');check(portal.vertices>0&&portal.opening>=5&&portal.clearance>=4.5,`Hill ${hill}: actual portal vertices leave five metres wide and 4.5 metres above the drawn lane`,portal);
  if(hill===1){const lowered=await p.read(`(()=>{const pos=qp.k.fixtures.children[0].geometry.attributes.position;for(const i of qp.k.portalBeamVertices)pos.setY(i,pos.getY(i)-4);pos.needsUpdate=true;return qp.portal();})()`);reject('lower actual portal beam below the vehicle opening',a=>a.vertices>0&&a.opening>=5&&a.clearance>=4.5,lowered);await p.read(`(()=>{const pos=qp.k.fixtures.children[0].geometry.attributes.position;for(const i of qp.k.portalBeamVertices)pos.setY(i,pos.getY(i)+4);pos.needsUpdate=true;})()`);}
  const signs=await p.read('qp.signFaces()');check(signs.count>0&&signs.all,`Hill ${hill}: sign text plates stand in front of the actual timber backing`,signs);
  const gate=await p.read('qp.feet()');check(grounded(gate),`Hill ${hill}: gate, hut, boards and marker feet on drawn land`,gate);
  if(hill===1){const hidden=await p.read('qp.k.fixtures.children[1].position.y=10;qp.signFaces()');reject('hide actual text plate behind or above its backing',a=>a.count>0&&a.all,hidden);await p.read('qp.k.fixtures.children[1].position.y=0');await p.read("document.getElementById('hud').hidden=true");const floated=await p.read('qp.k.fixtures.position.y=2;qp.feet()');reject('move actual gate fixture mesh above land',grounded,floated);await p.read('qp.k.fixtures.position.y=0;qp.draw()');await p.shot(`${out}/gate.png`);}
  const apron=await p.read(`(async()=>{const p=qp.trip.poseAlong(mmm.journey.route,mmm.journey.route.length-14);qp.v.place(p.x,p.z,p.heading);await qp.view(631942,5062045,14,310,-20);qp.park();qp.c.position.set(qp.v.x+18,qp.v.y+12,qp.v.z+24);qp.c.lookAt(qp.v.x,qp.v.y+1,qp.v.z);qp.c.updateMatrixWorld();for(let i=0;i<8;i++){qp.t.update(qp.c);qp.trees?.update(qp.t.drawnFine,qp.c.position);qp.draw();await new Promise(r=>setTimeout(r,20));}return{contacts:qp.contacts(),pose:{x:qp.v.x,y:qp.v.y,z:qp.v.z},attached:qp.tow.attached};})()`);
  check(apron.attached&&seated(apron.contacts)&&Math.abs(apron.pose.x+642342-631920)<25&&Math.abs(5063327-apron.pose.z-5062068)<35,`Hill ${hill}: parked rig tread vertices on drawn apron`,apron);
  if(hill===1){const lifted=await p.read('qp.v.car.root.position.y+=1;qp.tow.trailer.root.position.y+=1;qp.contacts()');reject('raise actual rig tread vertices above land',seated,lifted);await p.read('qp.v.car.root.position.y-=1;qp.tow.trailer.root.position.y-=1');await p.shot(`${out}/apron-rig.png`);}
  for(const[e,n,name]of[[631708,5064500,'west'],[632208,5064505,'east']]){
    await p.read(`qp.view(${e},${n},22,${name==='west'?100:280},-25)`);const feet=await p.read('qp.feet()');check(grounded(feet)&&feet.rows.some(f=>f.kind==='rail'),`Hill ${hill}: ${name} rail on drawn land`,feet);
  }
  await p.read('qp.view(631825,5064430,12,295,-12)');const rocks=await p.read('qp.blocks()');check(rockGrounded(rocks),`Hill ${hill}: actual rock foot vertices on drawn land`,rocks);
  if(hill===1){const lifted=await p.read('qp.k.rocks.mesh.position.y+=2;qp.blocks()');reject('raise actual rock vertices above land',rockGrounded,lifted);await p.read('qp.k.rocks.mesh.position.y-=2');await p.shot(`${out}/west-wall-close.png`);}
 }
 if(!process.env.QUARRY_GROUND_ONLY){
 // Drive the actual loaded rig along the mapped last 600 m, through the gate and around the apron.
 await p.navigate(`${origin}/?trip=quarry-gate&cam=631980,5061900,40,340,-25,65&camground=1&exag=1.5&hud=1&radio=0&res=1`);await setup();await p.read("document.getElementById('titleStart')?.click()");
 await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'f',code:'KeyF',windowsVirtualKeyCode:70});await p.send('Input.dispatchKeyEvent',{type:'keyUp',key:'f',code:'KeyF',windowsVirtualKeyCode:70});
 const drive=await p.read(`(async()=>{
  await qp.view(632090,5061770,45,330,-28);const route=mmm.journey.route,start=qp.trip.routeProgress(route,route.near.x,route.near.z);qp.v.place(route.near.x,route.near.z,route.near.heading);qp.v.assist=0;
  let hits=0,travel=0,touches=0,portalCrossings=0,portalRigGap=Infinity;const solids=qp.k.solids,iterate=Array.prototype[Symbol.iterator];solids[Symbol.iterator]=function*(){for(const body of qp.tow.bodies())for(let j=0;j<solids.length;j++)if(qp.touchesPlayer(solids[j],body,-1e-6,body.spec))touches++;yield*iterate.call(solids);};qp.v.onSolidImpact=()=>hits++;const input={throttle:0,steer:0,handbrake:false};let at=start;
  for(let i=0;i<120*350&&at<route.length-8;i++){
    at=qp.trip.routeProgress(route,qp.v.x,qp.v.z);const goal=qp.trip.poseAlong(route,Math.min(route.length,at+9)),want=Math.atan2(goal.x-qp.v.x,qp.v.z-goal.z),angle=Math.atan2(Math.sin(want-qp.v.heading),Math.cos(want-qp.v.heading));
    input.steer=Math.max(-1,Math.min(1,angle*2.2));input.throttle=Math.max(-1,Math.min(1,(3.8-qp.v.speed)*.7));const x=qp.v.x,z=qp.v.z;mmm.driveVehicle(1/120,input);travel+=Math.hypot(qp.v.x-x,qp.v.z-z);
    const gate=qp.site.GATE,gx=gate.e-qp.t.manifest.village[0],gz=qp.t.manifest.village[1]-gate.n;
    if(Math.abs((qp.v.x-gx)*Math.sin(gate.heading)-(qp.v.z-gz)*Math.cos(gate.heading))<10){
      const top=Math.max(new qp.THREE.Box3().setFromObject(qp.v.car.root).max.y,new qp.THREE.Box3().setFromObject(qp.tow.trailer.root).max.y);portalRigGap=Math.min(portalRigGap,qp.portal().beam-top);portalCrossings++;
    }
    if(i%360===0){mmm.chase(1);qp.c.updateMatrixWorld();qp.t.update(qp.c);qp.trees?.update(qp.t.drawnFine,qp.c.position);qp.k.update(qp.c.position);qp.draw();await new Promise(r=>setTimeout(r,5));}
  }
  const a=qp.site.APRON;let turnTravel=0,turnAngle=0,oldHeading=qp.v.heading,inside=0,total=0,paintOutside=0;
  for(let i=0;i<120*150&&turnAngle<Math.PI*2-.02;i++){
    input.steer=.55;input.throttle=Math.max(-1,Math.min(1,(2.2-qp.v.speed)*.9));const x=qp.v.x,z=qp.v.z;mmm.driveVehicle(1/120,input);turnTravel+=Math.hypot(qp.v.x-x,qp.v.z-z);turnAngle+=Math.atan2(Math.sin(qp.v.heading-oldHeading),Math.cos(qp.v.heading-oldHeading));oldHeading=qp.v.heading;
    if(qp.site.onApron(qp.v.x+qp.t.manifest.village[0],qp.t.manifest.village[1]-qp.v.z))inside++;total++;
    for(const body of qp.tow.bodies())for(const a of [-body.spec.halfLength,body.spec.halfLength])for(const w of [-body.spec.halfWidth,body.spec.halfWidth]){
      const x=body.x+Math.sin(body.heading)*a+Math.cos(body.heading)*w,z=body.z-Math.cos(body.heading)*a+Math.sin(body.heading)*w,surface=qp.k.site.surface(x,z);
      if(!surface||surface.coverage<.25)paintOutside++;
    }
  }
  for(let i=0;i<300;i++)qp.step(0,0,true);qp.tow.update();await qp.flushFrames();delete solids[Symbol.iterator];return{travel,at,length:route.length,hits,touches,portalCrossings,portalRigGap,turnTravel,turnAngle,inside,total,paintOutside,attached:qp.tow.attached,arrived:mmm.journey.arrived,contacts:qp.contacts(),pose:{x:qp.v.x,z:qp.v.z}};
 })()`);
 check(drive.travel>570&&drive.at>drive.length-12&&drive.hits===0&&drive.touches===0&&drive.turnAngle>6.2&&drive.inside===drive.total&&drive.paintOutside===0&&drive.attached&&drive.arrived&&drive.portalCrossings>0&&drive.portalRigGap>.3,'Loaded rig drives Long Stretch Road, open gate and apron turn without contact',drive);
 // Route HUD and minimap use the same path. Moving 150 m along it must reduce distance by that amount.
 const navigation=await p.read(`(async()=>{const j=mmm.journey,r=j.route;j.restart();qp.v.place(r.near.x,r.near.z,r.near.heading);await qp.flushFrames();const before=j.remaining;const p=qp.trip.poseAlong(r,qp.trip.routeProgress(r,r.near.x,r.near.z)+150);qp.v.place(p.x,p.z,p.heading);await qp.flushFrames();return{before,after:j.remaining,route:mmm.miniMap.route.length,destination:mmm.miniMap.destination,text:j.hud.textContent,places:[...document.querySelectorAll('#placesList button strong')].map(p=>p.textContent)};})()`);
 check(navigation.before-navigation.after>140&&navigation.route>100&&!!navigation.destination,'Minimap route and destination; distance falls as rig moves',navigation);reject('frozen route distance',r=>r.before-r.after>140,{...navigation,after:navigation.before});
 const observeRecovery=async()=>p.read(`(()=>{const v=qp.v,tow=qp.tow,j=mmm.journey,road=qp.roads.nearest(v.x,v.z,50);return{x:v.x,z:v.z,heading:v.heading,road:road?.dist??999,attached:tow.attached,angle:tow.angle,clear:tow.pairClear(),behind:(tow.x-v.x)*(-Math.sin(v.heading))+(tow.z-v.z)*Math.cos(v.heading),routeOffset:Math.hypot(v.x-qp.trip.poseAlong(j.route,qp.trip.routeProgress(j.route,v.x,v.z)).x,v.z-qp.trip.poseAlong(j.route,qp.trip.routeProgress(j.route,v.x,v.z)).z),route:j.route.points.length,remaining:j.remaining,text:j.hud.textContent,saved:sessionStorage.getItem(j.key),hidden:j.hud.hidden};})()`);
 const resetBefore=await p.read(`(()=>{const goal=qp.trip.poseAlong(mmm.journey.route,mmm.journey.route.length-900);qp.v.restart(goal.x+Math.cos(goal.heading)*18,goal.z+Math.sin(goal.heading)*18,goal.heading);qp.tow.update();return{x:qp.v.x,z:qp.v.z,route:mmm.journey.route.points.length,remaining:mmm.journey.remaining};})()`);
 const pressR=async()=>{await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'r',code:'KeyR',windowsVirtualKeyCode:82});await p.send('Input.dispatchKeyEvent',{type:'keyUp',key:'r',code:'KeyR',windowsVirtualKeyCode:82});await p.read('qp.flushFrames()');};
 const assertRecovery=(before,after)=>Math.hypot(after.x-before.x,after.z-before.z)>5&&after.road<2&&after.routeOffset<2&&after.attached&&Math.abs(after.angle)<.025&&after.clear&&after.behind>5&&after.route===before.route&&after.remaining>750&&after.remaining<1050&&!!after.saved&&Math.hypot(JSON.parse(after.saved).x-after.x,JSON.parse(after.saved).z-after.z)<1&&after.hidden===false&&after.text.length>0;
 await p.read("window.blockQuarryR=e=>{if(e.code==='KeyR')e.stopImmediatePropagation();};addEventListener('keydown',blockQuarryR,true)");await pressR();
 reject('disable the actual R key handler',r=>assertRecovery(resetBefore,r),await observeRecovery());
 await p.read("removeEventListener('keydown',blockQuarryR,true)");await pressR();const reset=await observeRecovery();
 check(assertRecovery(resetBefore,reset),'R visibly recovers rig to route road, straight trailer, clear bodies, surviving distance and HUD',reset);
 const placement=await p.read(`(()=>{const records=[];for(const s of qp.k.solids){const old={x:qp.v.x,z:qp.v.z};qp.v.place(s.x,s.z,0);records.push(Math.hypot(qp.v.x-s.x,qp.v.z-s.z)>.2);qp.v.place(old.x,old.z,qp.v.heading);}return{count:records.length,all:records.every(Boolean)};})()`);check(placement.count>40&&placement.all,'All quarry solids reject normal placement with attached trailer',placement);
 check(['Sugar Camp Off-Road Park','West Wall Lookoff','East Top Lookoff','West Bay village','Shore road toward Marble Mountain','Dundee','Haul to Sugar Camp','Start near the gate'].every(n=>navigation.places.includes(n)),'West Bay places and both trip choices',navigation.places);
 await p.read(`mmm.miniMap.folded=false;mmm.miniMap.show(true);document.getElementById('miniMap').classList.remove('folded');mmm.miniMap.update(1,qp.v.x,qp.v.z,qp.v.heading,[],[]);mmm.chase(1);qp.draw()`);await p.shot(`${out}/trip-minimap.png`);
 const routePixels=await p.read(`(()=>{const map=mmm.miniMap,count=()=>{const a=map.ctx.getImageData(0,0,map.canvas.width,map.canvas.height).data;let n=0;for(let i=0;i<a.length;i+=4)if(a[i]===112&&a[i+1]===228&&a[i+2]===204)n++;return n;};const before=count(),saved=map.route;map.route=[];map.update(1,qp.v.x,qp.v.z,qp.v.heading,[],[]);const removed=count();map.route=saved;map.update(1,qp.v.x,qp.v.z,qp.v.heading,[],[]);return{before,removed};})()`);
 check(routePixels.before>10&&routePixels.removed===0,'Actual minimap pixels show route; removing live route removes those pixels',routePixels);
 // Actual water recovery from each lake at its elevated level, with the car, through normal fixed-step physics.
 await p.navigate(`${origin}/?area=westbay&mode=explore&vehicle=car&cam=631850,5064440,22,300,-20,60&camground=1&hud=0&radio=0`);await setup();
 for(const[e,n,level]of[[631900,5064500,27],[630700,5063000,15.4]]){
  const lake=await p.read(`(async()=>{await qp.view(${e},${n},28,0,-35);let e=${e};while(qp.site.lakeAt(e,${n}))e-=2;const x=e-8-qp.t.manifest.village[0],z=qp.t.manifest.village[1]-${n};qp.v.place(x,z,Math.PI/2);qp.v.assist=0;let sunk=0,wet=false;for(let i=0;i<120*20;i++){qp.step(1,0,false);sunk=Math.max(sunk,qp.v.sunk);wet=wet||!!qp.t.surfaceAt(qp.v.x,qp.v.z)?.water;if(sunk>1&&qp.v.sunk===0)break;}return{distance:Math.hypot(qp.v.x-x,qp.v.z-z),sunk,water:wet};})()`);
  check(lake.water&&lake.sunk>1&&lake.distance>20,`Vehicle is lost and recovered from the ${level} m lake`,lake);
 }
 await runLoop();
 // Requested fixed views. Each navigation settles terrain, trees and water through the real render loop.
 const views={
  'sc-air-north-v1':'631900,5063300,450,350,-32,60','sc-east-bank-v1':'632150,5064500,12,270,-8,60','sc-west-wall-v1':'631900,5064350,25,300,-6,55','sc-lake-south-v1':'631750,5064000,30,10,-10,60',
  'lookoff-west':'631714,5064500,1.8,95,-18,66','lake-shore':'631810,5064460,2.8,70,-8,60','south-pit':'630720,5063470,55,190,-25,65',
  'gate-approach':'632050.47,5061797.58,2.2,333.24,4,60','wall-from-water':'631870,5064500,2.8,270,12,60',
 };
 for(const[name,cam]of Object.entries(views)){await p.navigate(`${origin}/?area=westbay&mode=explore&cam=${cam}&camground=1&exag=1.5&hud=0&radio=0&res=1&shadows=1`);await setup();await p.shot(`${out}/${name}.png`);}
const reflection=await p.read(`(async()=>{const water=qp.water;if(!water)return null;const box=[...document.querySelectorAll('#settings label')].find(e=>e.textContent.includes('Water reflections'))?.querySelector('input');if(!box)throw Error('water setting absent');box.checked=false;box.dispatchEvent(new Event('change'));for(let i=0;i<4;i++)qp.draw();const off=water.uniforms.reflectionOn.value;box.checked=true;box.dispatchEvent(new Event('change'));for(let i=0;i<4;i++)qp.draw();return{off,on:water.uniforms.reflectionOn.value,pits:qp.k.water.meshes.map(m=>m.material.uniforms.reflectionOn.value)};})()`);check(reflection?.off===0&&reflection.pits.every(v=>v===0),'Both pit lakes retain sky-only reflections when the shared mirror setting changes',reflection);
 await p.navigate(`${origin}/?trip=quarry&hud=1&radio=0&exag=1.5&res=1&title=1`);await setup();await p.read("document.getElementById('titleStart')?.click()");await p.read('qp.chase()');await p.shot(`${out}/trip-start.png`);
 const start=await p.read('({address:location.search,vehicle:mmm.vehicleId,loaded:qp.tow.loaded,area:mmm.area.id,mode:mmm.gameMode,e:qp.v.x+qp.t.manifest.village[0],n:qp.t.manifest.village[1]-qp.v.z,heading:qp.v.heading,notice:document.getElementById("quarryNotice")?.textContent})');check(start.vehicle==='truck'&&start.loaded&&start.area==='westbay'&&start.mode==='explore'&&start.notice.includes('made up'),'Long trip rig, lane pose and title card',start);
 check(new URLSearchParams(start.address).get('area')==='westbay'&&new URLSearchParams(start.address).get('vehicle')==='truck','Preset address keeps its explicit area and rig for reloads and other controls',start.address);
 const beforeReload=await p.read(`(async()=>{const route=mmm.journey.route,p=qp.trip.poseAlong(route,90);qp.v.place(p.x,p.z,p.heading);await qp.flushFrames(25);return{x:qp.v.x,z:qp.v.z,heading:qp.v.heading,url:location.href,key:mmm.journey.key,saved:sessionStorage.getItem(mmm.journey.key),moved:Math.hypot(qp.v.x-route.start.x,qp.v.z-route.start.z)};})()`);
 check(beforeReload.moved>60&&!!beforeReload.saved&&Math.hypot(JSON.parse(beforeReload.saved).x-beforeReload.x,JSON.parse(beforeReload.saved).z-beforeReload.z)<1,'Real game frame saves progress after rig leaves the trip start',beforeReload);
 const resumed=r=>Math.hypot(r.x-beforeReload.x,r.z-beforeReload.z)<1&&r.title&&r.trip&&r.loaded;
 await p.read(`sessionStorage.removeItem(${JSON.stringify(beforeReload.key)})`);await p.navigate(beforeReload.url);await setup();
 let reloaded=await p.read('({x:qp.v.x,z:qp.v.z,title:!!document.getElementById("titleStart"),trip:!!mmm.journey,loaded:qp.tow.loaded})');reject('lose the actual saved trip pose before reload',resumed,reloaded);
 await p.read(`sessionStorage.setItem(${JSON.stringify(beforeReload.key)},${JSON.stringify(beforeReload.saved)})`);await p.navigate(beforeReload.url);await setup();reloaded=await p.read('({x:qp.v.x,z:qp.v.z,title:!!document.getElementById("titleStart"),trip:!!mmm.journey,loaded:qp.tow.loaded})');check(resumed(reloaded),'Reload preserves moved trip pose, loaded rig and title card',reloaded);
 await p.send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true});
 await p.navigate(`${origin}/?trip=quarry-gate&touch=1&q=low&hud=1&radio=0&res=1`);await setup();await p.read("document.getElementById('titleStart')?.click()");await p.read('(async()=>{await qp.chase();await qp.flushFrames()})()');await p.shot(`${out}/quarry-phone.png`);
 const phone=await p.read(`(()=>{const h=document.getElementById('tripHud').getBoundingClientRect(),ids=['hud','miniMap','tcTrack','tcGo','tcBrake','gear','placesButton'],overlap=ids.filter(id=>{const e=document.getElementById(id);if(!e||e.hidden)return false;const b=e.getBoundingClientRect();return h.left<b.right&&h.right>b.left&&h.top<b.bottom&&h.bottom>b.top;});return{low:mmm.low,width:innerWidth,height:innerHeight,hidden:document.getElementById('tripHud').hidden,box:{x:h.x,y:h.y,right:h.right,bottom:h.bottom},overlap,model:qp.model()};})()`);
 check(phone.low&&!phone.hidden&&phone.box.x>=0&&phone.box.bottom<=390&&phone.overlap.length===0,'844×390 LOW trip HUD layout',phone);reject('phone HUD overlaps controls',r=>r.overlap.length===0,{...phone,overlap:['tcGo']});
 await p.navigate(`${origin}/?area=westbay&mode=explore&cam=631900,5063300,450,350,-32,60&camground=1&exag=1.5&touch=1&q=low&hud=0&radio=0&res=1`);await setup();await p.shot(`${out}/quarry-low-air.png`);results.push({label:'LOW quarry model counts',data:await p.read('({...qp.model(),submitted:qp.cost()})')});
 await p.navigate(`${origin}/?area=westbay&mode=explore&cam=631900,5063300,450,350,-32,60&camground=1&exag=1.5&hud=0&radio=0&res=1&shadows=1`);await setup();results.push({label:'Desktop quarry model counts',data:await p.read('({...qp.model(),submitted:qp.cost()})')});
 await p.navigate(`${origin}/?area=mabou&mode=mail&shot=2&q=low&hud=0&radio=0`);
 const eager=await p.read(`performance.getEntriesByType('resource').map(r=>new URL(r.name).pathname).filter(path=>path.includes('/src/quarry')&&!path.endsWith('/quarry-trip.ts'))`);
 check(eager.length===0,'Real Mabou mail boot fetches/evaluates no quarry implementation module',eager);
 }
 }
}finally{await p.close();if(process.env.QUARRY_REPORT)writeFileSync(process.env.QUARRY_REPORT,JSON.stringify({results,failures},null,2)+'\n');}
assert.equal(failures.length,0,failures.join('\n'));
console.log('PASS quarry real-game assertions, drawn-land and tread probes, pictures and mutation controls');
