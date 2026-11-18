// Final-review witnesses: a real streamed seam, both mailbox terminals, and a crashed real BikeRide.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {open,sleep} from './cdp.mjs';
const root=resolve(import.meta.dirname,'..');
const [out,first]=process.argv.slice(2),origin=new URL(first).origin;mkdirSync(out,{recursive:true});
const roads=area=>JSON.parse(readFileSync(resolve(root,`data/baked/${area==='mabou'?'terrain':`areas/${area}`}/roads.json`))).roads;
const station=(r,along)=>{for(let i=1;i<r.pts.length;i++){const a=r.pts[i-1],b=r.pts[i],dx=b[0]-a[0],dn=b[1]-a[1],len=Math.hypot(dx,dn);if(along<=len||i===r.pts.length-1)return {e:a[0]+dx*Math.min(1,along/len),n:a[1]+dn*Math.min(1,along/len),h:Math.atan2(dx,dn)};along-=len;}};
const deg=r=>r*180/Math.PI;
async function settle(page){for(let i=0;i<720;i++){if(await page.read('(()=>{const m=mmm,g=m.roads.guardrails;g.update(m.camera.position);return m.terrain.pending===0&&!g.audit.pending})()'))return;await sleep(250);}assert.fail('land and complete rail run settle');}
async function releasePark(page){
 await page.read(`(()=>{document.getElementById('titleStart')?.click();dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',bubbles:true}));return true})()`);
 const before=await page.read('({x:mmm.vehicle.x,z:mmm.vehicle.z})');
 try{
  for(let i=0;i<30;i++){
   await sleep(50);
   if(await page.read(`Math.hypot(mmm.vehicle.x-(${before.x}),mmm.vehicle.z-(${before.z}))>.01`))return;
  }
  assert.fail('real pedal releases the daily-start parked/refit path');
 }finally{await page.read(`(()=>{dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW',bubbles:true}));return true})()`);}
}
const evidence=[];
const road=roads('westbay').find(r=>r.id===133);
for(const [name,along,offset,turn]of [['westbay-seam',17010,.5,18],['westbay-mailbox-opening',7881.2,-1,90]]){
 if(process.env.RAIL_R3_ONLY&&process.env.RAIL_R3_ONLY!==name)continue;
 const p=station(road,along),car=station(road,along-45),query=new URLSearchParams({mode:'explore',area:'westbay',at:`${car.e},${car.n},${deg(car.h)}`,cam:`${p.e+Math.cos(p.h)*offset},${p.n-Math.sin(p.h)*offset},1.7,${deg(p.h)+turn},-8,58`,camground:'1',exag:'1.5',hour:'12',hud:'0',radio:'0'});
 const page=await open(`${origin}/?${query}`);try{
  await settle(page);await sleep(1000);
  const state=await page.read(`(()=>{const m=mmm,g=m.roads.guardrails,spans=g.chunks.flatMap(c=>c.spans).filter(s=>s.road.id===133),ends=[];
    for(const c of g.chunks)if(c.mesh)for(const s of c.spans)if(s.road.id===133)for(const p of [s.a.along===s.runStart?s.a:null,s.b.along===s.runEnd?s.b:null]){
      if(!p||Math.abs(p.along-7881.2)>8)continue;const pos=c.mesh.geometry.attributes.position,rail=c.mesh.geometry.attributes.rail;let bottom=Infinity;
      for(let i=0;i<pos.count;i++)if(rail.getZ(i)<.97&&Math.hypot(pos.getX(i)-p.x,pos.getZ(i)-p.z)<.001)bottom=Math.min(bottom,pos.getY(i));
      ends.push({along:p.along,side:s.side,error:bottom-m.terrain.meshHeightAt(p.x,p.z,true)});
    }
    return {seam:spans.filter(s=>s.side===1&&s.a.along>16998&&s.b.along<17028).map(s=>({a:s.a.along,b:s.b.along,start:s.runStart,end:s.runEnd})),ends};})()`);
  console.log('STATE',name,JSON.stringify(state));
  if(name==='westbay-seam'){
   assert.ok(state.seam.length===13,'reviewed missing seam has all spans');
   for(let i=1;i<state.seam.length;i++)assert.ok(Math.abs(state.seam[i].a-state.seam[i-1].b)<1e-6,'seam contiguous');
   assert.ok(state.seam.every(s=>Math.abs(s.start-17003.1)<1e-6&&Math.abs(s.end-17229.2)<1e-6),'no false terminal at seam');
  }else {assert.equal(state.ends.length,2,'both West Bay mailbox opening ends');assert.ok(state.ends.every(e=>e.error>=0&&e.error<.04),'both opening ends turn down to drawn soil');}
  const file=resolve(out,`${name}.png`);await page.shot(file);evidence.push({name,file,state});console.log('PICTURE',file,JSON.stringify(state));
 }finally{await page.close();}
}
const mines=roads('mabou').find(r=>r.id===55),p=station(mines,5484.51),query=new URLSearchParams({mode:'explore',area:'mabou',vehicle:'bike',at:`${p.e},${p.n},${deg(p.h)}`,hud:'0',radio:'0',exag:'1.5',hour:'12'});
const page=process.env.RAIL_R3_ONLY&&process.env.RAIL_R3_ONLY!=='bike-crash-rail'?null:await open(`${origin}/?${query}`);if(page)try{
 await settle(page);await releasePark(page);
 // Hold the game loop after its pending frame, then render the exact measured
 // crash instant. This prevents parked/AI updates from changing a photo pose.
 await page.read(`new Promise(resolve=>{const raw=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raw(function hold(t){raw(hold)});raw(()=>raw(()=>resolve(true)));})`);
 const state=await page.read(`(()=>{const m=mmm;
   // Invoke through the dev proxy once, then run on the real target. Proxy pose
   // writes would otherwise arm main's safe-placement refit and reset the tumble.
   m.vehicle.railWitness=function(){const v=this,g=m.roads.guardrails;
   const s=g.chunks.flatMap(c=>c.spans).filter(s=>s.road.id===55&&s.side===-1).sort((a,b)=>Math.abs(a.a.along-5484.51)-Math.abs(b.a.along-5484.51))[0];if(!s)throw Error('Mines rail span');
   const x=(s.a.x+s.b.x)/2,z=(s.a.z+s.b.z)/2,dx=s.b.x-s.a.x,dz=s.b.z-s.a.z,len=Math.hypot(dx,dz),fx=dx/len,fz=dz/len,nx=-fz*s.side,nz=fx*s.side,h=Math.atan2(fx,-fz),a=Math.PI/4;
   const far=Math.max(...v.spec.envelope.circles.map(Math.abs)),gap=.15+v.spec.envelope.radius+far*Math.sin(a)+.03,heading=h+s.side*a;
   const placed=v.place(x-nx*gap,z-nz*gap,heading);if(!placed)throw Error('bike pose refused');
   v.speed=25;v.vx=25*Math.sin(heading);v.vz=-25*Math.cos(heading);
   const update=Object.getPrototypeOf(v).update;let beyond=-Infinity;
   for(let i=0;i<36;i++){update.call(v,1/120,{throttle:1,steer:0,handbrake:false});beyond=Math.max(beyond,(v.x-x)*nx+(v.z-z)*nz);}
   v.update=()=>{};
   m.vehicle.car.root.parent.onBeforeRender=(_r,_s,c)=>{const py=m.terrain.heightAt(v.x,v.z);c.fov=55;c.updateProjectionMatrix();c.position.set(v.x-nx*5-fx*3,py+2.2,v.z-nz*5-fz*3);c.lookAt(v.x,py+.4,v.z);c.updateMatrixWorld();};
   let footCorners=0,maxFootGap=-Infinity;
   for(const c of g.chunks)if(c.mesh?.visible){const pos=c.mesh.geometry.attributes.position,rail=c.mesh.geometry.attributes.rail;
    for(let i=0;i<pos.count;i++){if(rail.getZ(i)!==1)continue;const start=i;while(i+1<pos.count&&rail.getZ(i+1)===1)i++;let foot=Infinity;
     for(let j=start;j<=i;j++)foot=Math.min(foot,pos.getY(j));
     for(let j=start;j<=i;j++)if(Math.abs(pos.getY(j)-foot)<1e-5){const ground=m.terrain.meshHeightAt(pos.getX(j),pos.getZ(j),true);if(ground!==null){maxFootGap=Math.max(maxFootGap,pos.getY(j)-ground);footCorners++;}}
    }
   }
   return {modelBikeRotation:v.car.bikeMesh.rotation.toArray(),modelRiderRotation:v.car.riderMesh.rotation.toArray(),ride:Object.getPrototypeOf(v).constructor.name,footCorners,maxFootGap,placed,crashes:v.crashes,crashTime:v.crashTime,centreBeyondRail:beyond,speed:Math.hypot(v.vx,v.vz),road:s.road.id,along:s.a.along,surface:m.terrain.surfaceAt(v.x,v.z)?.kind,washboard:m.terrain.surfaceAt(v.x,v.z)?.washboard};};
   const result=m.vehicle.railWitness();delete m.vehicle.railWitness;return result;})()`);
 assert.equal(state.ride,'BikeRide','actual production BikeRide crash branch');
 assert.ok(state.footCorners>20&&state.maxFootGap<.01,'actual steep-bank post feet meet drawn soil');
 assert.ok(state.crashes>0&&state.crashTime>0&&state.centreBeyondRail<0,'real crash tumble remains on road side');
 await page.read('mmm.renderer.render(mmm.scene,mmm.camera)');
 assert.ok(state.modelBikeRotation.some(v=>typeof v==="number"&&Math.abs(v)>.1),'production model carries its real tumble pose');
 const file=resolve(out,'bike-crash-rail.png');await page.shot(file);evidence.push({name:'bike-crash-rail',file,state});console.log('PICTURE',file,JSON.stringify(state));
}finally{await page.close();}
writeFileSync(resolve(out,'r3-evidence.json'),JSON.stringify(evidence,null,2));
// Same 120 Hz production controls on real Mines land, with the real washboard.
// The dev proxy invokes this helper once; internal writes stay on the actual ride.
if(!process.env.RAIL_R3_ONLY||process.env.RAIL_R3_ONLY==='drive-table'){
 const at=station(mines,5800),drive=[];
 for(const kind of ['car','bike']){
  const query=new URLSearchParams({mode:'explore',area:'mabou',vehicle:kind,at:`${at.e},${at.n},${deg(at.h)}`,hud:'0',radio:'0',exag:'1.5',hour:'12'}),page=await open(`${origin}/?${query}`);
  try{
   await settle(page);await releasePark(page);
   const rows=await page.read(`(()=>{const m=mmm;m.vehicle.railDriveWitness=function(){const v=this,g=m.roads.guardrails;
    const s=g.chunks.flatMap(c=>c.spans).filter(s=>s.road.id===55&&s.side===-1).sort((a,b)=>Math.abs(a.a.along-5800)-Math.abs(b.a.along-5800))[0];if(!s||Math.abs(s.a.along-5800)>15)throw Error('Mines drive rail');
    const x=(s.a.x+s.b.x)/2,z=(s.a.z+s.b.z)/2,dx=s.b.x-s.a.x,dz=s.b.z-s.a.z,len=Math.hypot(dx,dz),fx=dx/len,fz=dz/len,nx=-fz*s.side,nz=fx*s.side,h=Math.atan2(fx,-fz),rows=[];
    const update=Object.getPrototypeOf(v).update,originalBlock=g.block;
    const solids=g.chunks.flatMap(c=>c.spans.map((p,i)=>({...c.solids[i],ax:Math.sin(c.solids[i].heading),az:-Math.cos(c.solids[i].heading),side:p.side})));
    const bodyClearance=()=>{
     let minimum=Infinity;
     for(let i=0;i<v.spec.envelope.circles.length;i++){
      const off=v.spec.envelope.circles[i],side=v.spec.envelope.circleSides?.[i]??0;
      const px=v.x+Math.sin(v.heading)*off+Math.cos(v.heading)*side,pz=v.z-Math.cos(v.heading)*off+Math.sin(v.heading)*side;
      let nearest=Infinity,margin=Infinity;
      for(const q of solids){const dx=px-q.x,dz=pz-q.z,a=dx*q.ax+dz*q.az,b=dx*-q.az+dz*q.ax;
       const distance=Math.hypot(Math.max(0,Math.abs(a)-q.half),Math.max(0,Math.abs(b)-q.halfWidth));
       if(distance<nearest){nearest=distance;margin=Math.abs(a)<=q.half?-b*q.side-q.halfWidth-v.spec.envelope.radius:distance-v.spec.envelope.radius;}
      }
      minimum=Math.min(minimum,margin);
     }
     return minimum;
    };
    for(const initial of [6,25])for(const angle of [3,12,45,90]){
     const a=angle*Math.PI/180,far=Math.max(...v.spec.envelope.circles.map(Math.abs)),gap=.15+v.spec.envelope.radius+far*Math.sin(a)+.03,heading=h+s.side*a;
     if(!v.place(x-nx*gap,z-nz*gap,heading))throw Error('real drive pose refused');
     v.assist=0;v.speed=initial;v.vx=initial*Math.sin(heading);v.vz=-initial*Math.cos(heading);
     let maxRailYaw=0,maxHeadingStep=0,previous=v.heading,maxShake=0,crashed=false,minBodyClearance=Infinity;
     g.block=function(body,dt){const before=body.heading;originalBlock.call(this,body,dt);maxRailYaw=Math.max(maxRailYaw,Math.abs(Math.atan2(Math.sin(body.heading-before),Math.cos(body.heading-before))));};
     try{for(let i=0;i<120;i++){update.call(v,1/120,{throttle:1,steer:0,handbrake:false});maxHeadingStep=Math.max(maxHeadingStep,Math.abs(Math.atan2(Math.sin(v.heading-previous),Math.cos(v.heading-previous))));previous=v.heading;maxShake=Math.max(maxShake,v.shake??0);crashed ||= !!v.crashTime;if(${JSON.stringify(kind)}==='car')minBodyClearance=Math.min(minBodyClearance,bodyClearance());}}
     finally{g.block=originalBlock;}
     rows.push({kind:${JSON.stringify(kind)},initial,angle,speed:Math.hypot(v.vx,v.vz),tangent:v.vx*fx+v.vz*fz,maxRailYaw: maxRailYaw*180/Math.PI,maxHeadingStep:maxHeadingStep*180/Math.PI,maxShake,crashed,minBodyClearance:${JSON.stringify(kind)}==='car'?minBodyClearance:null,washboard:m.terrain.surfaceAt(v.x,v.z)?.washboard,along:s.a.along});
    }
    v.update=()=>{};return rows;
   };const rows=m.vehicle.railDriveWitness();delete m.vehicle.railDriveWitness;return rows;})()`);
   assert.ok(rows.every(r=>r.maxRailYaw<=.250001),'real Mines contact yaw <=0.25deg per step');
   if(kind==='car'){
    assert.ok(rows.every(r=>r.minBodyClearance>=-1e-6),'real Mines: no car body circle crosses any rail solid: '+JSON.stringify(rows.map(r=>[r.initial,r.angle,r.minBodyClearance])));
    assert.ok(rows.filter(r=>r.initial===25&&r.angle<45).every(r=>r.washboard&&r.maxShake>.2),'real Mines washboard stays rough during rail grazes');
    for(const angle of [12,45])assert.ok(rows.find(r=>r.initial===25&&r.angle===angle).speed>=rows.find(r=>r.initial===6&&r.angle===angle).speed,'real Mines car speed monotonic');
   }
   assert.ok(rows.filter(r=>r.angle===90).every(r=>r.speed<2),'real Mines head-on stops');
   drive.push(...rows);console.log('REAL MINES DRIVE',kind,JSON.stringify(rows));
  }finally{await page.close();}
 }
 writeFileSync(resolve(out,'mines-drive-table.json'),JSON.stringify(drive,null,2));
}
