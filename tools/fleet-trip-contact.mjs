// Final trip rule. Natural-field/render mismatch is measured at each contact, never a location exception.
export function tripContacts(){
 const f=window.qf,T=f.THREE,point=new T.Vector3(),heightBody=f.contactHeight??={y:0};
 const stats=f.contactStats,reading={land:0,physics:0,mismatch:0},floatPoints=f.contactFloatPoints??=Array.from({length:4},()=>new T.Vector3());

 f.deck.update(f.f.members.some(m=>m.state==='MOVING'));f.f.draw(f.camera.position);
 const ground=(member,p)=>{
  const land=f.down(p.x,p.z);if(land===null)throw Error('Missing drawn contact '+member.id+' '+JSON.stringify({point:p.toArray(),state:member.state}));
  const physics=f.physicsHeight(p.x,p.z);if(physics===null)throw Error('Missing physics contact '+member.id);
  const mismatch=Math.abs(physics-land),lod=f.terrain.drawnTile(p.x,p.z)?.level??f.lastContactTile?.level;
  stats.maxAllMismatch=Math.max(stats.maxAllMismatch??0,mismatch);if(member===f.f.driven&&mismatch>(stats.maxMismatch??0)){stats.maxMismatch=mismatch;stats.mismatchAt={id:member.id,point:p.toArray(),physics,land,lod};}
  if(member===f.f.driven&&mismatch>.15){stats.landFindingSamples=(stats.landFindingSamples??0)+1;const key=Math.floor(p.x/5)+','+Math.floor(p.z/5),findings=stats.landFindings??={};if(!findings[key]||findings[key].mismatch<mismatch)findings[key]={mismatch,point:p.toArray(),physics,land,lod};}
  reading.land=land;reading.physics=physics;reading.mismatch=mismatch;return reading;
 };
 f.terrain.withGroundContact(heightBody,()=>{
 for(const member of f.contactMembers){
  f.contactMember=member;heightBody.y=member.vehicle?.y??member.rig.root.position.y;
  const rig=member.shown??member.rig,root=rig.root,old=f.visualCache.get(member);
  if(member.state!=='DRIVEN'&&old?.rig===rig&&old.revision===f.drawnStamp&&old.matrix.equals(root.matrixWorld))continue;
  root.updateMatrixWorld(true);rig.bikeMesh?.skeleton.update();
  for(const sample of f.geometry.get(rig)){
   let owner=sample.mesh;while(owner&&owner!==root)owner=owner.parent;if(owner!==root)throw Error('Body probe retained a detached mesh '+member.id);sample.mesh.getVertexPosition(sample.i,point).applyMatrix4(sample.mesh.matrixWorld);const g=ground(member,point),penetration=g.land-point.y,error=penetration-g.mismatch,key=member.id==='trailer'?'maxDeck':'maxBody';
   stats[key]=Math.max(stats[key]??0,penetration);if(error>(stats.maxBodyOwn??0)){stats.maxBodyOwn=error;stats.bodyAt={id:member.id,point:point.toArray(),...g};}
   if(member.state!=='DRIVEN'&&penetration>.04)f.fail('Non-driven body below drawn land',{surface:'exact',id:member.id,point:point.toArray(),error:penetration});
   if(error>.04)f.fail('Body below drawn land',{surface:'natural',id:member.id,point:point.toArray(),...g,penetration,error});
  }
  const wheels=f.wheels.get(rig),depth=member===f.depthMember?Math.max(...f.depths):Math.max(...wheels.map((_,i)=>f.wheelPothole(member,i,f.terrain,f.potholeDepth,f.potholeDensity)));
  for(let i=0;i<wheels.length;i++){
   const wheel=wheels[i],centre=wheel.getWorldPosition(new T.Vector3()),float=[Infinity,Infinity],ownFloat=[Infinity,Infinity],floatExact=[false,false],ownFloatExact=[false,false];let ownPen=0;
   for(const tread of f.tyres.get(rig)[i]){
    point.copy(tread).applyMatrix4(wheel.matrixWorld);if(point.y>centre.y+.001)continue;
    const g=ground(member,point),mayUseDeck=member.state==='STRAPPED'||member.state==='MOVING'||member===f.f.driven&&member.id!=='truck'&&f.f.gates===1;
    let built=mayUseDeck?f.deck.height(point.x,point.z,point.y):-Infinity;
    const bridge=f.roads.deckHeight(point.x,point.z);
    if(bridge!==null){const ray=f.bridgeRay??=new T.Raycaster();ray.ray.origin.set(point.x,point.y+.6,point.z);ray.ray.direction.set(0,-1,0);ray.near=0;ray.far=3;const hits=ray.intersectObject(f.roads.group,true);if(!hits.length)throw Error('Bridge physics has no drawn solid');built=Math.max(built,hits[0].point.y);}
    const exact=built>g.land+.00001,drawn=exact?built:g.land,mismatch=exact?0:g.mismatch,drop=exact?0:depth;
    // Sleeping rigs and the trailer are fitted to drawn support; driven controllers read the natural field.
    const physics=exact?built:member.state==='DRIVEN'&&member.id!=='trailer'?g.physics:g.land;
    const penetration=drawn-point.y,adjusted=penetration-mismatch-drop,own=physics-point.y-drop,side=tread.x<0?0:1;
    stats.samples++;if(drop>0){stats.insidePothole++;stats.maxDepth=Math.max(stats.maxDepth,drop);stats.maxAdjustedInside=Math.max(stats.maxAdjustedInside,penetration-drop);}else stats.maxOutside=Math.max(stats.maxOutside,penetration);
    if(penetration>stats.maxRaw){stats.maxRaw=penetration;stats.worst={id:member.id,wheel:i,point:point.toArray(),depth:drop,mismatch,physics,drawn,vehicle:{x:member.vehicle?.x,z:member.vehicle?.z,speed:member.vehicle?.speed}};}
    stats.maxAdjusted=Math.max(stats.maxAdjusted??0,adjusted);ownPen=Math.max(ownPen,own);
    if(point.y-drawn-mismatch<float[side]){floatPoints[side].copy(point);floatExact[side]=exact;}
    if(point.y-physics<ownFloat[side]){floatPoints[side+2].copy(point);ownFloatExact[side]=exact;}
    float[side]=Math.min(float[side],point.y-drawn-mismatch);ownFloat[side]=Math.min(ownFloat[side],point.y-physics);
    if(adjusted>.04)f.fail('Tyre below drawn land',{surface:exact?'exact':'natural',id:member.id,wheel:i,point:point.toArray(),penetration,mismatch,drop,adjusted});
    if(own>.04)f.fail('Vehicle own penetration',{surface:exact?'exact':'natural',id:member.id,wheel:i,point:point.toArray(),physics,drop,own});
   }
   stats.maxOwnError=Math.max(stats.maxOwnError??0,ownPen);const floating=Math.max(0,...float),ownFloating=Math.max(0,...ownFloat);
   stats.maxFloat=Math.max(stats.maxFloat,floating);stats.maxOwnError=Math.max(stats.maxOwnError??0,ownPen,ownFloating);
   if(floating>.04)f.fail('Tyre floats above drawn support',{surface:floatExact[float[0]>=float[1]?0:1]?'exact':'natural',id:member.id,wheel:i,floating,point:floatPoints[float[0]>=float[1]?0:1].toArray()});
   if(ownFloating>.04)f.fail('Vehicle own float',{surface:ownFloatExact[ownFloat[0]>=ownFloat[1]?0:1]?'exact':'natural',id:member.id,wheel:i,ownFloating,point:floatPoints[ownFloat[0]>=ownFloat[1]?2:3].toArray(),position:{x:member.vehicle?.x,z:member.vehicle?.z}});
  }
  f.visualCache.set(member,{rig,matrix:root.matrixWorld.clone(),revision:f.drawnStamp});
 }
 });
 if(f.f.gates===1){f.contactMember=f.contactMembers.find(m=>m.id==='trailer');for(const ramp of f.t.trailer.ramps){ramp.updateWorldMatrix(true,true);for(const x of[-.51,0,.51]){point.set(x,1.28,.05).applyMatrix4(ramp.matrixWorld);const land=f.down(point.x,point.z);if(land===null)throw Error('Missing drawn gate-foot support');const error=Math.abs(point.y-land);if(error>.04)f.fail('Ramp foot misses drawn support',{surface:'exact',id:'trailer',point:point.toArray(),error});}}}
 f.contactMember=null;
}
