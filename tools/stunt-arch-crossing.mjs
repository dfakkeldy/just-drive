// Production Places buttons, original game frames, real keys; never seed speed, pitch or pose.
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {open,sleep} from './cdp.mjs';
import {stuntStage} from './stunt-browser-stage.mjs';
import {tyreContacts} from './tyre-contacts.mjs';
import {archHeader} from './stunt-arch-header.mjs';
import {archClearance} from './stunt-arch-clearance.mjs';
const photoOnly=process.env.STUNT_ARCH_PHOTO_ONLY==='1';
const[outRoot,url]=process.argv.slice(2);mkdirSync(outRoot,{recursive:true});
const out=mkdtempSync(join(outRoot,'run-')),origin=new URL(url).origin,rows=[];
writeFileSync(join(outRoot,'latest-arch-run.txt'),out+'\n');console.log('ARCH_RUN',out);
const p=await open(`${origin}/?park=test&mode=explore&vehicle=truck&trailer=1&radio=0&scene=0&hud=1`);
async function navigateVisible(url){
 const pulse=setInterval(()=>{p.send('Page.bringToFront').catch(()=>{});},200);
 try{await p.send('Page.bringToFront');await p.navigate(url);}finally{clearInterval(pulse);}
}
const key=(code,down)=>p.send('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',code,key:code==='Space'?' ':code.slice(-1).toLowerCase(),windowsVirtualKeyCode:code==='Space'?32:code.charCodeAt(3)});
try{
 for(const low of photoOnly?[false]:[false,true])for(const hill of(process.env.STUNT_ARCH_HILLS??'1,1.5,2,2.5').split(',').map(Number)){
  await navigateVisible(`${origin}/?park=test&mode=explore&vehicle=truck&trailer=1&exag=${hill}&q=${low?'low':'full'}&radio=0&scene=0&hud=1`);
  await p.send('Page.bringToFront');await p.read(stuntStage(tyreContacts));
  for(const index of(process.env.STUNT_ARCH_INDICES??'0,1').split(',').map(Number)){
   await p.read(`(async()=>{const {testParkStarts}=await import('/src/stunt-test-park.ts');window.archStartSnapshot=testParkStarts(st.park)[${index}];})()`);
   const entryMutant=process.env.STUNT_ARCH_ORIGINAL_ENTRY&&index===1?await p.read(`(async()=>{const {PlacedDressing,startArch}=await import('/src/stunt-dressing.ts'),park=st.park,old=park.dressing[1],rise=old.placement.piece.archRise,at=old.world(5,0),parent=old.group.parent;parent.remove(old.group);old.group.traverse(o=>{if(o.isMesh)o.geometry.dispose();});Object.assign(old,new PlacedDressing({...old.placement,...at,piece:startArch('TEST PARK',5.8)}));parent.add(old.group);return{index:1,oldRise:rise,newRise:5.8,removedRise:rise-5.8,movedMetres:5,restoredYardV:345,fabric:true,startUnchanged:true};})()`):null;
   for(const u of[index===0?-15:-42,-10,10,30])await p.read(`st.focus(st.park.dressing[${index}],${u})`);
   await p.send('Page.bringToFront');
   await p.read(`(async()=>{
    const {testParkStarts}=await import('/src/stunt-test-park.ts'),{resolveHeightSolid}=await import('/src/stunt-solids.ts');
    const {THREE,park}=st,d=park.dressing[${index}],start=window.archStartSnapshot,steel=d.solids.filter(s=>s.half<.1&&s.halfWidth>.5&&s.top-s.bottom<1);
    if(!steel.length)throw Error('solid steel header missing');
    mmm.places.open();mmm.frame(performance.now());document.querySelector('button[data-place="'+start.id+'"]').click();
    if(Math.hypot(mmm.vehicle.x-start.x,mmm.vehicle.z-start.z)>.01||Math.abs(Math.atan2(Math.sin(mmm.vehicle.heading-start.heading),Math.cos(mmm.vehicle.heading-start.heading)))>.01)throw Error('Places start refused or turned');
    const header=(${archHeader.toString()})(THREE,d.group);if(!header.closed)throw Error('steel underside is not closed');const centre=d.world(0,0),clearance=(${archClearance.toString()})(THREE,d.group,st.terrain.meshHeightAt(centre.x,centre.z),header.lower);
    const towing=mmm.towing,groundOwner=towing.vehicle,originalTowGround=towing.ground,originalTruckGround=groundOwner.groundAt;
    const frame=mmm.frame,inverse=new THREE.Matrix4().copy(d.group.matrixWorld).invert(),originalResolve=park.resolveSolids;
    const state=window.crossing={start,photoOnly:${photoOnly},photoBraking:false,photoSeconds:0,phase:'settling',seconds:0,drivingSeconds:0,frames:0,hiddenFrames:0,done:false,ready:false,maxSettlePitch:0,maxMovingPitch:0,maxSpeed:0,driverPolicy:'real W/S/A/D; cautious8km/h hard-line target from rest; centre before the next toe; no speed cap',minMargin:null,marginWitness:null,side:null,truckRoof:null,trailerRoof:null,bodySamples:0,groundSources:[],groundSourceMinima:{truck:{loaded:8,drawn:8},trailer:{loaded:8,drawn:8}},groundSourceIssues:[],hitTrace:[],contactsBefore:park.contacts,advance:0,lastProgress:0,lastProgressAt:0,reason:null,source:'actual Places button, real keys and native game frames'};let previous=performance.now();
    // Inspect the exact cache state before each original ground query, without calling
    // find/use/meshHeightAt (which would alter terrain retention).
    function auditGround(actor,owner,original,x,z,args){let finest=null,drawn=null;
     for(const tile of st.terrain.tiles.values())if(tile.ready&&tile.mesh&&x>=tile.x0&&x<tile.x0+tile.size&&z>=tile.z0&&z<tile.z0+tile.size){
      if(!finest||tile.level>finest.level)finest=tile;
      const part=(x>=tile.x0+tile.size/2?1:0)|(z>=tile.z0+tile.size/2?2:0),hide=tile.mesh.material.uniforms.hideQuad?.value;
      if(tile.mesh.visible&&(!hide||hide.getComponent(part)<.5)&&(!drawn||tile.level>drawn.level))drawn=tile;
     }
     const height=original.apply(owner,args),sample={actor,x,z,loaded:finest?.level??-1,drawn:drawn?.level??null,height,frame:st.terrain.frame};
     const minima=state.groundSourceMinima[actor];minima.loaded=Math.min(minima.loaded,sample.loaded);if(sample.drawn!==null)minima.drawn=Math.min(minima.drawn,sample.drawn);
     state.groundSources.push(sample);if(state.groundSources.length>8)state.groundSources.shift();
     if((sample.loaded<8||sample.drawn!==null&&sample.drawn<8)&&state.groundSourceIssues.length<8)state.groundSourceIssues.push(sample);
     return height;
    }
    towing.ground=function(x,z,y=1e6){return auditGround('trailer',towing,originalTowGround,x,z,[x,z,y]);};
    groundOwner.groundAt=function(x,z,y){return auditGround('truck',groundOwner,originalTruckGround,x,z,[x,z,y]);};
    park.resolveSolids=body=>{
     const before=park.contacts,pose={x:body.x,z:body.z,y:body.y,heading:body.heading,pitch:body.pitch??0,roll:body.roll??0,vx:body.vx??0,vz:body.vz??0,speed:body.speed??0},spec=body.spec;
     for(const s of steel){
      const clone=()=>({x:body.x,z:body.z,y:body.y,heading:body.heading,pitch:body.pitch??0,roll:body.roll??0,vx:0,vz:0,speed:0,spec:body.spec});
      if(!resolveHeightSolid(clone(),{...s,bottom:-Infinity,top:Infinity}))continue;
      let lo=body.y-100,hi=body.y+100;for(let n=0;n<25;n++){const mid=(lo+hi)/2;if(resolveHeightSolid(clone(),{...s,bottom:mid,top:Infinity}))lo=mid;else hi=mid;}
      const margin=s.bottom-hi;if(state.minMargin===null||margin<state.minMargin){state.minMargin=margin;state.marginWitness={margin,groundSources:state.groundSources.slice(),bottom:s.bottom,protectedTop:hi,body:{x:body.x,y:body.y,z:body.z,pitch:body.pitch??0,roll:body.roll??0,height:body.spec.height},steel:{half:s.half,halfWidth:s.halfWidth,bottom:s.bottom,top:s.top}};}
     }
     originalResolve.call(park,body);
     if(park.contacts>before&&state.hitTrace.length<6){const possible=[],fences=[];
      for(const [kind,owners]of [['dressing',park.dressing],['piece',park.pieces]])for(let index=0;index<owners.length;index++){const owner=owners[index];if(!owner.ready||!owner.group.visible)continue;
       for(const solid of owner.solids){if(resolveHeightSolid({...pose,spec},solid))possible.push({kind,index,id:owner.placement.piece.id,solid:{x:solid.x,z:solid.z,half:solid.half,halfWidth:solid.halfWidth,bottom:solid.bottom,top:solid.top}});}
       if(kind==='piece'&&owner.near(pose.x,pose.z,spec.envelope.reach+30))for(const deck of owner.decks)if(deck.source.fence){const u=owner.u(pose.x,pose.z),v=owner.v(pose.x,pose.z),height=deck.height(u,v);if(height!==null)fences.push({index,id:owner.placement.piece.id,u,v,height,box:deck.source.box,fence:deck.source.fence,inset:deck.source.fenceInset});}
      }
      state.hitTrace.push({pose,spec:{halfLength:spec.halfLength,halfWidth:spec.halfWidth,height:spec.height},possible,fences,after:{x:body.x,y:body.y,z:body.z,heading:body.heading,pitch:body.pitch,roll:body.roll}});
     }
    };
    window.requestAnimationFrame=callback=>window.nativeRAF(now=>{
     if(state.done&&callback===frame)return;callback(now);if(callback!==frame)return;
     const dt=Math.max(0,Math.min(.1,(now-previous)/1000));previous=now;state.frames++;
     if(document.hidden){state.hiddenFrames++;return;}state.seconds+=dt;
     const v=mmm.vehicle,t=mmm.towing,pitch=Math.abs(t.pitch)*180/Math.PI;
     const roots=[{root:v.car.root,truck:true},{root:t.trailer.root,truck:false},...(mmm.fleet?.members??[]).filter(m=>m.state==='STRAPPED').map(m=>({root:m.shown.root,truck:false}))];
     const drawn=clearance.measure(roots),rear=drawn.rear;state.bodySamples+=drawn.samples;
     for(const name of['side','truckRoof','trailerRoof'])if(Number.isFinite(drawn[name]))state[name]=state[name]===null?drawn[name]:Math.min(state[name],drawn[name]);
     const at=new THREE.Vector3(v.x,0,v.z).applyMatrix4(inverse),aimU=${index}===1?(at.x<-4?0:at.x<6?8:at.x+6):Math.max(0,at.x+12),aim=d.world(aimU,0),desired=Math.atan2(aim.x-v.x,-(aim.z-v.z));state.steerError=Math.atan2(Math.sin(desired-v.heading),Math.cos(desired-v.heading));state.steerTarget=Math.atan2(2*v.spec.wheelbase*Math.sin(state.steerError),Math.max(4,Math.hypot(aim.x-v.x,aim.z-v.z)));
     state.last={rear,speed:v.speed,pitch:t.pitch*180/Math.PI,truckPitch:v.pitch*180/Math.PI,roll:t.roll*180/Math.PI,attached:t.attached,handbrake:mmm.fleet?.handbrake,surface:v.surfaceName,contacts:park.contacts-state.contactsBefore,along:at.x,lateral:at.z,heading:v.heading,steerAngle:v.steerAngle,level:st.terrain.surfaceAt(v.x,v.z)?.level??-1};
     if(state.phase==='settling'){if(state.seconds>=.5)state.maxSettlePitch=Math.max(state.maxSettlePitch,pitch);if(state.seconds>=1-1e-6)state.ready=true;}
     else{
      state.drivingSeconds+=dt;state.maxSpeed=Math.max(state.maxSpeed,Math.abs(v.speed));state.maxMovingPitch=Math.max(state.maxMovingPitch,pitch);
      if(rear>state.lastProgress+.02){state.lastProgress=rear;state.lastProgressAt=state.drivingSeconds;}
      if(state.photoOnly){
       if(at.x>=-12){state.done=true;state.reason='actual moving chase photograph before hard frame';}
       else if(state.drivingSeconds>=40){state.done=true;state.reason='photo stop time limit';}
      }
      else if(rear>1.5){state.done=true;state.reason='complete rig crossed';}
      else if(state.drivingSeconds>5&&state.drivingSeconds-state.lastProgressAt>3){state.done=true;state.reason=state.last.contacts?'solid contact':'no progress under ordinary pedals';}
      else if(state.drivingSeconds>=40){state.done=true;state.reason='unchanged forty-second motion limit';}
     }
     if(!document.getElementById('gameError')?.hidden){state.done=true;state.reason='game error';}
     if(state.done){park.resolveSolids=originalResolve;towing.ground=originalTowGround;groundOwner.groundAt=originalTruckGround;}
    });requestAnimationFrame(frame);
   })()`);
   let held='',steering='',r;const began=Date.now();
   while(Date.now()-began<1200000){
    await p.send('Page.bringToFront');r=await p.read('crossing');
    if(r.done)break;
    if(r.ready&&r.phase==='settling'){assert.ok(r.maxSettlePitch<15,'start must settle before crossing');await p.read("crossing.phase='driving';crossing.lastProgress=crossing.last.rear;crossing.lastProgressAt=0");}
    const target=index===1?2.2:5;
    const next=photoOnly&&r.photoBraking?'Space':r.phase==='settling'?'Space':(r.last?.speed??0)<target-.2?'KeyW':r.last.speed>target+.2?'KeyS':'';
    if(next!==held){if(held)await key(held,false);if(next)await key(next,true);held=next;}
    else if(held)await key(held,true);
    const turn=r.phase==='driving'?(r.steerTarget>.005&&r.last.steerAngle<r.steerTarget+.015?'KeyD':r.steerTarget<-.005&&r.last.steerAngle>r.steerTarget-.015?'KeyA':''):'';
    if(turn!==steering){if(steering)await key(steering,false);if(turn)await key(turn,true);steering=turn;}else if(steering)await key(steering,true);
    writeFileSync(out+'/crossing-progress.json',JSON.stringify({hill,low,index,wallMs:Date.now()-began,...r},null,2)+'\n');await sleep(100);
   }
   if(held)await key(held,false);if(steering)await key(steering,false);rows.push({hill,low,index,entryMutant,...r});writeFileSync(out+'/stunt-arch-crossings.json',JSON.stringify({rows},null,2)+'\n');
   if(photoOnly){
    assert.ok(r?.done&&r.reason==='actual moving chase photograph before hard frame'&&r.last.contacts===0&&r.last.along<0,'actual loaded rig must be photographed on approach before the frame');
    const pulse=setInterval(()=>{p.send('Page.bringToFront').catch(()=>{});},100);
    try{await p.send('Page.bringToFront');await key('Space',true);
     const pose=await p.read(`(()=>{window.archPhotoActive=true;window.archPhotoDraws=0;function draw(){if(!archPhotoActive)return;const {renderer,scene,camera,water}=st;water?.update(camera);try{renderer.render(scene,camera);}finally{water?.settle();}water?.afterRender(camera);archPhotoDraws++;window.nativeRAF(draw);}window.nativeRAF(draw);const v=mmm.vehicle,t=mmm.towing;return{vehicle:{x:v.x,y:v.y,z:v.z,heading:v.heading,pitch:v.pitch,roll:v.roll},trailer:{x:t.x,y:t.y,z:t.z,pitch:t.pitch,roll:t.roll},camera:{position:mmm.camera.position.toArray(),quaternion:mmm.camera.quaternion.toArray(),fov:mmm.camera.fov},rise:st.park.dressing[1].placement.piece.archRise,physics:'frozen actual moving approach frame',view:'original production chase'};})()`);
     for(let n=0;n<100;n++){if(await p.read('archPhotoDraws>=3'))break;await sleep(50);}assert.ok(await p.read('archPhotoDraws>=3&&!document.hidden'));
     writeFileSync(out+'/hard-arch-photo.json',JSON.stringify({hill,low,...pose},null,2)+'\n');await p.shot(out+'/hard-arch-hill1-chase.png');
    }finally{clearInterval(pulse);await p.read('window.archPhotoActive=false');await key('Space',false);}
   }else await p.shot(`${out}/crossing-${index}-${hill}-${low?'low':'full'}.png`);
   console.log('OBSERVE ordinary arch',JSON.stringify(rows.at(-1)));
   if(!photoOnly&&(index===1||r.reason==='complete rig crossed'||r.last?.contacts>0))assert.ok(r?.done&&r.reason==='complete rig crossed'&&r.last.attached&&r.last.contacts===0&&r.minMargin!==null&&r.minMargin>=.25&&r.side!==null&&r.side>=.6&&r.truckRoof!==null&&r.truckRoof>=.5&&r.trailerRoof!==null&&r.trailerRoof>=0,JSON.stringify(rows.at(-1)));
   await p.read('window.requestAnimationFrame=callback=>{window.stoppedFrame=callback;return 0;}');
  }
 }
}finally{writeFileSync(out+'/stunt-arch-crossings.json',JSON.stringify({rows},null,2)+'\n');await p.close();await sleep(2500);}
