// Test-only observations. Insertions add probe calls without changing a game expression.
export function resolveMainResponse(status,cached,body,etag){
 if(status===304){
  if(!cached)throw Error('304 without an observed original main source');
  if(etag&&cached.etag&&etag!==cached.etag)throw Error('304 changed the observed main ETag');
  return cached;
 }
 if(status!==200)throw Error(`main source HTTP ${status}`);
 if(body.includes('globalThis.__walkProbe.mark("bodyStart")')){
  if(!cached)throw Error('cached instrumented source without its original');
  return cached;
 }
 if(cached&&cached.source!==body)throw Error('main source changed during a timing case');
 return {source:body,etag};
}
export function instrumentMain(source){
 const insertions=[],markers=[];
 const add=(pattern,name,required=false,after=false)=>{
  const match=source.match(pattern);
  if(!match){if(required)throw Error(`readiness probe missing ${name}`);return;}
  const call=`\nglobalThis.__walkProbe.mark(${JSON.stringify(name)});\n`;
  source=source.replace(pattern,after?match[0]+call:call+match[0]);insertions.push(call);markers.push(name);
 };
 add(/\bconst params\s*=/,'bodyStart',true);
 add(/\bconst manifest\s*=/,'manifestStart',true);
 add(/\bconst getJson\s*=/,'manifestReady',true);
 add(/\bconst buildingList(?:\s*:[^\n=]+)?\s*=/,'buildingsStart');
 add(/\bconst porchBox\s*=/,'buildingsReady');
 add(/\bconst roadData\s*=/.test(source)?/\bconst roadData\s*=/:/\bconst roads\s*=/,'roadsStart',true);
 add(/scene\.add\(roads\.group\);/,'roadsReady',true,true);
 add(/\bconst sidewalkDataReady\s*=/,'sidewalkRequest');
 add(/\bconst sidewalkData\s*=\s*await sidewalkDataReady;/,'sidewalkAwaitStart');
 add(/\bconst sidewalkData\s*=\s*await sidewalkDataReady;/,'sidewalkAwaitEnd',false,true);
 add(/\bconst props\s*=/,'propsStart',true);
 const ctor=/\bconst sidewalks\s*=[^;]+;/;
 add(ctor,'sidewalkConstructorStart');add(ctor,'sidewalkConstructorEnd',false,true);
 add(/\bconst yardDogSite\s*=/.test(source)?/\bconst yardDogSite\s*=/:/\bconst garageEntry\s*=/,'propsAndWalkReady',true);
 if(!/\bconst loaded\s*=\s*terrain\.pending\s*===\s*0\s*;/.test(source))throw Error('readiness probe missing loaded predicate');
 const quiet=/quiet\s*=\s*waiting\s*\?\s*0\s*:\s*quiet\s*\+\s*1\s*;/,match=source.match(quiet);
 if(!match)throw Error('readiness probe missing actual waiting/quiet update');
 const hook=`\nglobalThis.__walkProbe.observeReady(loaded, waiting, quiet, terrain.pending, globalThis.mmm?.sidewalks?.pending ?? 0, mode === 'fly' && pendingShot !== null && terrain.heightAt(camera.position.x,camera.position.z) === null, mode === 'drive' && demo > 0 && (drove < demo || Math.abs(vehicle.speed) > .15), relief.busy, !!porch?.waiting, porchDog?.state === 'loading', terrain.failed);\n`;
 source=source.replace(quiet,match[0]+hook);insertions.push(hook);
 return {source,markers,strip:modified=>insertions.reduce((s,text)=>s.replace(text,''),modified)};
}

/** Serialized into Page.addScriptToEvaluateOnNewDocument; no production module is edited. */
export function installDetailedProbe(){
 const p=globalThis.__walkProbe;
 p.stages={};p.pending={grass:0,trees:0};p.mesh={uploads:0};p.grassWork={calls:0,total:0,max:0};p.readyEvents=[];p.resources=[];
 const labels=['terrain','grass-cover','grass-build','grass-grow','trees','fly-land','demo-drive','relief','porch','porch-dog','sidewalk','terrain-failed'];p.waitLabels=labels;
 p.mark=name=>{p.stages[name]=performance.now();};
 const getter=(object,key,name)=>{
  if(!object)return;
  let prototype=object,descriptor;while(prototype&&!descriptor){descriptor=Object.getOwnPropertyDescriptor(prototype,key);prototype=Object.getPrototypeOf(prototype);}
  if(!descriptor?.get)throw Error(`probe requires real ${name} getter`);
  const original=descriptor.get;
  Object.defineProperty(object,key,{configurable:true,get(){
   const value=original.call(this);p.pending[name]=value;
   if(value){const at=performance.now();p[`last${name}Busy`]=at;
    if(name==='grass'){
     let kind=this.ready?'grass-grow':'grass-cover';
     if(this.ready){outer:for(const map of [this.patches,this.dense])for(const patch of map.values())if(patch.active&&patch.cursor<patch.side*patch.side){kind='grass-build';break outer;}}
     p.grassKind=kind;p.lastGrassClock=this.clock.value;
    }
   }return value;
  }});
 };
 p.attachWorld=m=>{
  if(p.worldAttached)return;p.worldAttached=true;
  getter(m.grass,'pending','grass');getter(m.trees,'pending','trees');
  if(m.grass){const original=m.grass.populate;
   m.grass.populate=function(patch,deadline){const start=performance.now();try{return original.call(this,patch,deadline);}finally{
    const end=performance.now(),ms=end-start,r=p.grassWork;r.calls++;r.total+=ms;r.max=Math.max(r.max,ms);r.firstAt??=start;r.lastAt=end;
    if(patch.cursor>=patch.side*patch.side){r.lastPatchBuiltAt=end;r.lastPatchBuiltClock=this.clock.value;}
   }};
  }
 };
 p.attachWalk=w=>{
  if(!w)return;
  for(const mesh of w.group.children){
   const geometry=mesh.geometry;
   for(const attr of [...Object.values(geometry.attributes),geometry.index])if(attr){const previous=attr.onUploadCallback;
    attr.onUploadCallback=function(){const at=performance.now();p.mesh.firstUploadAt??=at;p.mesh.lastUploadAt=at;p.mesh.uploads++;return previous.call(this);};
   }
   const previous=mesh.onAfterRender;
   mesh.onAfterRender=function(renderer,scene,camera,geometry,material,group){const at=performance.now();p.mesh.firstDrawAt??=at;p.mesh.lastDrawAt=at;if(geometry.index?.version>0)p.mesh.firstVisibleDrawAt??=at;return previous.call(this,renderer,scene,camera,geometry,material,group);};
  }
 };
 p.observeReady=(loaded,waiting,quiet,terrain,walk,fly,demo,relief,porch,dog,failed)=>{
  const at=performance.now();let mask=0;
  if(!loaded||terrain>0)mask|=1;
  if(loaded&&p.pending.grass>0)mask|=1<<labels.indexOf(p.grassKind);
  if(loaded&&p.pending.grass===0&&p.pending.trees>0)mask|=1<<4;
  if(fly)mask|=1<<5;if(demo)mask|=1<<6;if(relief)mask|=1<<7;if(porch)mask|=1<<8;if(dog)mask|=1<<9;if(walk>0)mask|=1<<10;if(failed>0)mask|=1<<11;
  if(mask){p.lastNonQuietMask=mask;p.lastNonQuietAt=at;}
  const state=mask||(quiet<=20?1<<12:0);
  if(state!==p.lastReadyState){p.readyEvents.push({at,mask,quiet,loaded,waiting,terrain,grass:p.pending.grass,trees:p.pending.trees,walk});p.lastReadyState=state;}
  if(!mask&&quiet===1)p.quietStartedAt=at;
 };
 if(typeof Response!=='undefined'){const original=Response.prototype.json;
  Response.prototype.json=function(){if(this.url!=='')return original.call(this);const start=performance.now();return original.call(this).then(value=>{if(value?.compiled&&value?.terrain){p.stages.sidewalkUnpackStart=start;p.stages.sidewalkUnpackEnd=performance.now();}return value;});};
 }
 if(typeof PerformanceObserver!=='undefined'){
  const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())if(/sidewalks-packed|manifest\.json|buildings\.json|props\.json|roads\.json|cover\./.test(e.name)){const u=new URL(e.name);p.resources.push({path:u.pathname,start:e.startTime,end:e.responseEnd,bytes:e.transferSize});}});observer.observe({type:'resource',buffered:true});
 }
}
