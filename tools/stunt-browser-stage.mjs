// The real game render/physics hooks shared by contact tests and photography.
export const stuntStage=tyreContacts=>`(async()=>{
 const THREE=await import('/node_modules/three/build/three.module.js');
 const {vehicle:v,stuntPark:park,terrain,camera,renderer,trees,water,yard,sunShadows}=mmm,scene=park.group.parent;
 window.nativeRAF=requestAnimationFrame;window.requestAnimationFrame=callback=>{window.stoppedFrame=callback;return 0;};
 const tyreContacts=${tyreContacts.toString()};
 window.st={THREE,v,park,terrain,camera,renderer,trees,water,yard,scene,tyreContacts};
 st.frameSnapshot=()=>({vehicle:[v.x,v.y,v.z],camera:camera.position.toArray(),pending:terrain.pending,groundLevel:terrain.surfaceAt(v.x,v.z)?.level,drawnLevel:terrain.drawnLevelAt(v.x,v.z),lastLine:park.lastLine,hudLine:park.hudLine,pieces:park.pieces.map(p=>({id:p.placement.piece.id,ready:p.ready,visible:p.group.visible,near:p.near(v.x,v.z,80),corners:p.supportCorners.map(q=>terrain.drawnLevelAt(q.x,q.z))}))});
 st.step=(throttle=0,steer=0,brake=false)=>mmm.driveVehicle(1/120,{throttle,steer,handbrake:brake});
 st.jumpTo=(x,z,heading,label='park')=>{mmm.places.jumpTo(x,z,heading);if(Math.hypot(v.x-x,v.z-z)>.01)throw Error('game refused park start: '+JSON.stringify({label,requested:{x,z,heading},actual:{x:v.x,z:v.z},reason:mmm.fleet?.message??mmm.towing?.reason}));v.assist=0;v.damageActive=false;v.steerAngle=0;park.reset();};
 st.place=(piece,u= -15,vv=0,heading=piece.placement.heading)=>{const a=piece.world(u,vv);st.jumpTo(a.x,a.z,heading,piece.placement.piece.id);};
 st.shown=o=>{for(let n=o;n;n=n.parent)if(!n.visible)return false;return true;};
 st.view=async(eye,target,frames=65)=>{
   camera.position.copy(eye);camera.lookAt(target);camera.updateMatrixWorld();
   for(let i=0;i<frames;i++){terrain.update(camera);trees?.update(terrain.drawnFine,camera.position);yard?.update(0,v,camera.position);park.update(0,v,camera.position);sunShadows?.update(1/60,target,eye.distanceTo(target));water?.update(camera);try{renderer.render(scene,camera);}finally{water?.settle();}water?.afterRender(camera);await new Promise(r=>setTimeout(r,20));}
 };
 st.focus=async(piece,u=0,vv=0)=>{const a=piece.world(u,vv),h=terrain.meshHeightAt(a.x,a.z)??v.y;const eye=new THREE.Vector3(a.x+16,h+13,a.z+18),target=new THREE.Vector3(a.x,h+1,a.z);await st.view(eye,target);for(let i=0;i<24&&!piece.ready;i++)await st.view(eye,target,10);};
 st.visibleHit=hit=>{
   const o=hit.object,hide=o.material?.uniforms?.hideQuad?.value;if(!hide)return true;
   if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();const b=o.geometry.boundingBox,q=(hit.point.x>=(b.min.x+b.max.x)/2?1:0)|(hit.point.z>=(b.min.z+b.max.z)/2?2:0);return hide.getComponent(q)<.5;
 };
 st.raycast=(ray,meshes)=>ray.intersectObjects(meshes,false).find(st.visibleHit);
 st.feet=piece=>{
   const ground=[];terrain.group.traverse(n=>{if(n.isMesh&&st.shown(n))ground.push(n);});
   const mesh=piece.group.children.find(n=>n.isMesh&&n.name.endsWith(' structure')),pos=mesh.geometry.getAttribute('position');
   return piece.solids.filter(s=>s.underDeck&&s.half===.11).map(s=>{
     const u=piece.u(s.x,s.z),vv=piece.v(s.x,s.z);let bottom=Infinity,at=null;
     for(let i=0;i<pos.count;i++)if(Math.abs(pos.getX(i)-u)<.12&&Math.abs(pos.getZ(i)-vv)<.12&&pos.getY(i)>=s.bottom-.01&&pos.getY(i)<=s.top+.3&&pos.getY(i)<bottom){bottom=pos.getY(i);at=piece.world(pos.getX(i),pos.getZ(i));}
     const hit=at?st.raycast(new THREE.Raycaster(new THREE.Vector3(at.x,bottom+.1,at.z),new THREE.Vector3(0,-1,0),0,3),ground):null;
     return{bottom,ground:hit?.point.y??null,gap:hit?bottom-hit.point.y:null,ray:!!hit};
   });
 };
 st.pitFeet=()=>{const p=park.dressing.find(p=>p.placement.piece.id==='pit-area'),mesh=p.group.children.find(o=>o.isMesh&&o.name.endsWith(' dressing')),pos=mesh.geometry.getAttribute('position'),ground=[];terrain.group.traverse(o=>{if(o.isMesh&&st.shown(o))ground.push(o);});p.group.updateMatrixWorld(true);const rows=[];
   for(const centreU of [-1.65,1.65])for(const centreV of [-.9,.9])for(const du of [-.24,.24])for(const dv of [-.24,.24]){const u=centreU+du,w=centreV+dv;let y=Infinity;for(let i=0;i<pos.count;i++)if(Math.abs(pos.getX(i)-u)<.0001&&Math.abs(pos.getZ(i)-w)<.0001)y=Math.min(y,pos.getY(i));const point=new THREE.Vector3(u,y,w).applyMatrix4(mesh.matrixWorld),hit=Number.isFinite(y)?st.raycast(new THREE.Raycaster(new THREE.Vector3(point.x,point.y+.1,point.z),new THREE.Vector3(0,-1,0),0,3),ground):null;rows.push({u,v:w,ray:!!hit,gap:hit?point.y-hit.point.y:null});}return rows;
 };
 st.contacts=()=>{
   v.car.root.updateMatrixWorld(true);park.group.updateMatrixWorld(true);
   const wheels=[...Object.entries(v.car.wheels),...(v.car.extraWheels??[]).map((w,i)=>['dual'+i,w])].filter(([,wheel])=>st.shown(wheel)).map(([name,wheel])=>({name,wheel,radius:v.spec.wheelRadius}));
   return st.tyreContacts(THREE,wheels,[terrain.group,park.group,yard?.group].filter(Boolean));
 };
 st.traverse=(piece,across=false,kph=8)=>{const b=piece.placement.piece.footprint,start=across?b[1]-4:b[0]-7,farToe=(across?b[3]:b[2])+v.spec.halfLength+1,timeLimit=Math.max(35,(farToe-start)/(kph/3.6)*2+12),contacts=park.contacts;
   v.pitch=v.roll=0;st.place(piece,across?0:start,across?start:0,piece.placement.heading+(across?Math.PI/2:0));const incoming=piece.placement.piece.runup===0?45:kph;v.vx=Math.sin(v.heading)*incoming/3.6;v.vz=-Math.cos(v.heading)*incoming/3.6;v.speed=incoming/3.6;let steps=0;
   for(;steps<timeLimit*120;steps++){const along=across?piece.v(v.x,v.z):piece.u(v.x,v.z);if(along>=farToe&&!v.airborne)break;st.step(piece.placement.piece.runup===0&&along<(across?b[1]:b[0])+1?1:Math.max(-1,Math.min(1,(kph/3.6-v.speed)*2)));}
   const along=across?piece.v(v.x,v.z):piece.u(v.x,v.z);return{completed:along>=farToe&&!v.airborne,end:{along,x:v.x,z:v.z,u:piece.u(v.x,v.z),v:piece.v(v.x,v.z)},farToe,timeLimit,incomingKph:incoming,targetKph:kph,seconds:steps/120,solidImpacts:park.contacts-contacts};
 };
 st.stopOn=piece=>{
   const id=piece.placement.piece.id,deck=['footbridge','tabletop'].includes(id)||id.startsWith('drop-')?piece.decks[1]:piece.decks.find(d=>d.source.box[2]-d.source.box[0]>3),b=deck?.source.box??piece.placement.piece.footprint;
   const target=piece.placement.piece.id==='tunnel'?0:piece.placement.piece.id==='berm'?0:Math.min(b[2]-v.spec.wheelbase/2-1,Math.max(5,(b[0]+b[2])/2));
   st.place(piece,piece.placement.piece.footprint[0]-7);
   if(piece.placement.piece.runup===0){v.vx=Math.sin(v.heading)*45/3.6;v.vz=-Math.cos(v.heading)*45/3.6;v.speed=45/3.6;for(let n=0;n<1200&&piece.u(v.x,v.z)<piece.placement.piece.footprint[0]+1;n++)st.step(1);}
   let i=0;
   for(;i<3600&&piece.u(v.x,v.z)<target;i++)st.step(Math.max(-1,Math.min(1,(2.2-v.speed)*2)));
   for(let n=0;n<360;n++)st.step(v.speed>.02?-1:0,0,true);
   return{u:piece.u(v.x,v.z),v:piece.v(v.x,v.z),speed:v.speed,steps:i,contacts:st.contacts()};
 };
 st.plan=async ids=>{if(water)throw Error('plan view requires LOW mode');const ref=park.pieces[0],points=[];
   for(const piece of ids?park.pieces:[...park.pieces,...park.dressing]){if(ids&&!ids.includes(piece.placement.piece.id))continue;const b=piece.placement.piece.visualFootprint??piece.placement.piece.footprint;for(const u of [b[0],b[2]])for(const w of [b[1],b[3]]){const p=piece.world(u,w);points.push([ref.u(p.x,p.z),ref.v(p.x,p.z)]);}}
   const u0=Math.min(...points.map(p=>p[0])),u1=Math.max(...points.map(p=>p[0])),v0=Math.min(...points.map(p=>p[1])),v1=Math.max(...points.map(p=>p[1])),centre=ref.world((u0+u1)/2,(v0+v1)/2),aspect=renderer.domElement.clientWidth/renderer.domElement.clientHeight,width=Math.max(u1-u0+28,(v1-v0+28)*aspect),height=width/aspect,ground=terrain.meshHeightAt(centre.x,centre.z)??v.y,top=new THREE.OrthographicCamera(-width/2,width/2,height/2,-height/2,.1,5000);
   top.position.set(centre.x,ground+60,centre.z);top.up.set(-ref.cos,0,-ref.sin);top.lookAt(centre.x,ground,centre.z);top.updateMatrixWorld();
   for(let n=0;n<100;n++){terrain.update(top);trees?.update(terrain.drawnFine,top.position);yard?.update(0,v,top.position);park.update(0,v,top.position);water?.update(top);try{renderer.render(scene,top);}finally{water?.settle();}water?.afterRender(top);await new Promise(r=>setTimeout(r,20));}
   return{heightAboveCentre:60,projection:'orthographic',pieces:ids??'all'};
 };
 st.follow=(target,kph)=>{const dx=target.x-v.x,dz=target.z-v.z,err=Math.atan2(Math.sin(Math.atan2(dx,-dz)-v.heading),Math.cos(Math.atan2(dx,-dz)-v.heading)),mu=v.surfaceName==='gravel'?.72:v.surfaceName==='grass'?.5:v.surfaceName==='brush'?.42:1,lock=Math.min(v.spec.maxSteer,Math.atan(v.spec.wheelbase*v.spec.gripLock*v.spec.cornering*mu*9.81/Math.max(v.speed*v.speed,4))),steer=Math.atan2(2*v.spec.wheelbase*Math.sin(err),Math.max(1,Math.hypot(dx,dz)))/lock;st.step(Math.max(-1,Math.min(1,(kph/3.6-v.speed)*2)),Math.max(-1,Math.min(1,steer)));};
 st.hardLine=(entryKph=70,nextKph=65)=>{const gap=park.pieces.find(p=>p.placement.piece.id==='gap-tanks'),drop=park.pieces.find(p=>p.placement.piece.id==='drop-1.6'),finish=drop.placement.piece.footprint[2]+v.spec.halfLength+7;
   st.place(gap,-7);v.vx=Math.sin(v.heading)*entryKph/3.6;v.vz=-Math.cos(v.heading)*entryKph/3.6;v.speed=entryKph/3.6;
   let landedGap=false,seenAir=false,i=0;const contacts=park.contacts;
   for(;i<120*100&&!(drop.u(v.x,v.z)>=finish&&!v.airborne);i++){const gu=gap.u(v.x,v.z),du=drop.u(v.x,v.z);if(v.airborne&&gu>15)seenAir=true;if(seenAir&&!v.airborne&&gu>30)landedGap=true;const kph=landedGap?nextKph:entryKph;st.follow(drop.world(du+Math.max(5,Math.abs(v.speed)*.5),0),kph);}
   return{completed:drop.u(v.x,v.z)>=finish&&!v.airborne,seconds:i/120,contacts:park.contacts-contacts,along:drop.u(v.x,v.z),finish,speed:v.speed,events:park.events};
 };
 st.underBridge=()=>{const piece=park.pieces.find(p=>p.placement.piece.id==='footbridge'),span=piece.decks[1],u=(span.source.box[0]+span.source.box[2])/2,start=-10,vehicleExtent=Math.max(...v.spec.envelope.circles.map(Math.abs))+v.spec.envelope.radius;
   // End one metre beyond the bridge's actual outer face with the complete envelope clear.
   // Continuing another ten metres would drive into the independent drop beside the bridge.
   const crossingEdge=Math.max(span.source.box[3],...piece.solids.filter(s=>Math.abs(piece.u(s.x,s.z)-u)<=s.half).map(s=>piece.v(s.x,s.z)+s.halfWidth)),farToe=crossingEdge+vehicleExtent+1,contacts=park.contacts;v.pitch=v.roll=0;st.place(piece,u,start,piece.placement.heading+Math.PI/2);let i=0;for(;i<120*40&&piece.v(v.x,v.z)<farToe;i++)st.step(Math.max(-1,Math.min(1,(2.2-v.speed)*2)));const end={along:piece.v(v.x,v.z),u:piece.u(v.x,v.z),v:piece.v(v.x,v.z)},passImpacts=park.contacts-contacts;
   st.place(piece,u,start,piece.placement.heading+Math.PI/2);for(let n=0;n<3600&&piece.v(v.x,v.z)<0;n++)st.step(Math.max(-1,Math.min(1,(2.2-v.speed)*2)));for(let n=0;n<360;n++)st.step(v.speed>.02?-1:0,0,true);return{completed:end.along>=farToe,end,farToe,crossingEdge,vehicleExtent,timeLimit:40,seconds:i/120,solidImpacts:park.contacts-contacts,passImpacts,below:(span.height(u,0)??0)-v.y,contacts:st.contacts()};};
 st.crown=async()=>{const piece=park.pieces.find(p=>p.placement.piece.id==='tunnel');await st.focus(piece);const run=st.traverse(piece,true,7.92),contacts=park.contacts;v.pitch=v.roll=0;st.place(piece,0,-42,piece.placement.heading+Math.PI/2);for(let i=0;i<120*70&&piece.v(v.x,v.z)<0;i++)st.step(Math.max(-1,Math.min(1,(2.2-v.speed)*2)));for(let i=0;i<360;i++)st.step(v.speed>.02?-1:0,0,true);const c=piece.world(0,0);await st.view(new THREE.Vector3(c.x+20,v.y+9,c.z+20),new THREE.Vector3(v.x,v.y,v.z));return{...run,solidImpacts:run.solidImpacts+park.contacts-contacts,photo:{u:piece.u(v.x,v.z),v:piece.v(v.x,v.z)},lift:v.y-piece.seat(0,0),contacts:st.contacts()};};
 st.drive=(piece,kph=45)=>{if(!piece.ready)throw Error('piece not ready: '+piece.placement.piece.id);const b=piece.placement.piece.footprint;st.place(piece,b[0]-7);for(let n=0;n<480;n++)st.step(0,0,true);v.vx=Math.sin(v.heading)*kph/3.6;v.vz=-Math.cos(v.heading)*kph/3.6;v.speed=kph/3.6;let air=0,max=0,first=null,last=null;
   for(let i=0;i<3600;i++){st.step(Math.max(-1,Math.min(1,(kph/3.6-v.speed)*2)));const u=piece.u(v.x,v.z);if(v.airborne&&u>b[0]){air++;first??=u;last=u;max=Math.max(max,v.y-piece.seat(u,0));}if(u>Math.max(b[2]+12,(piece.placement.piece.route?.landing[1]??b[2])+5))break;}
   return{u:piece.u(v.x,v.z),v:piece.v(v.x,v.z),air:air/120,distance:first===null?0:last-first,max,events:park.events};
 };
})()`;
