// Node-only geometric and driving contracts, through production Roads and Vehicle.
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {fixture,rig,root} from './bridges-fixture.mjs';
import {readFileSync} from 'node:fs';
import {transformSync} from '../web/node_modules/esbuild/lib/main.js';
async function contracts(replacements={}){
 const mod=await fixture('mabou',1,replacements);
 // Two adjoining records cross ONE channel. The middle endpoint is not a bank.
 const height=(x,z)=>z>0||z< -40?10+x*.005:Math.max(0,10-Math.min(-z,40+z)*2);
 const terrain={cartRoads:false,dataRevision:1,seaLevel:-.2,heightAt:height,withContactHeight:(_,f)=>f(),surfaceAt:(x,z)=>({ground:height(x,z),level:8,canopy:0,roadDist:0,halfWidth:3.6,kind:1,bridge:true,washboard:false})};
 const road=(id,from,to)=>({id,name:'Fixture bridge',kind:1,halfWidth:3.6,bridge:true,pts:[[0,from],[0,to]]});
 const roads=new mod.Roads({roads:[road(1,0,20),road(2,20,40)]},[0,0],terrain);
 {// A built-deck read (the sidewalk layer's) never builds a span, even an unbuilt one. It marks the span followed, and
  // update() keeps a followed span built and current whatever the camera distance (a far crossing still gets its deck,
  // and later bank land or a walk widening still reaches it), with the start-burst hold of every other span.
  const lt={...terrain},lazy=new mod.Roads({roads:[road(1,0,20),road(2,20,40)]},[0,0],lt),M=lazy.modern,builds=M.audit.builds,revision=lazy.bridgeRevision,away=new THREE.Vector3(5000,20,5000);
  assert.equal(lazy.builtDeckHeight(0,-20),null,'a built-deck read of an unbuilt span is null');
  assert.equal(M.audit.builds,builds,'a built-deck read builds nothing');assert.equal(lazy.bridgeRevision,revision,'and moves no revision');
  assert.ok(M.spans.every(r=>!r.geometry),'no span was built by the read');
  lazy.update(away);
  assert.ok(M.spans.some(r=>r.geometry),'update() builds the span a built-deck read asked for, 5 km away');
  const built=lazy.builtDeckHeight(0,-20);assert.ok(built!==null&&Math.abs(built-lazy.deckHeight(0,-20))<1e-9,'then the built-deck read gives the deck');
  const span=M.spans.find(r=>r.geometry),first=M.audit.builds;
  lt.dataRevision++;lazy.update(away);assert.equal(M.audit.builds,first+1,'a followed span 5 km away refreshes on new bank land after its first build');
  span.forceBuild=true;span.revision=-1;lazy.update(away);assert.equal(M.audit.builds,first+2,'a followed span 5 km away refreshes on a forced build (walk widening)');
  lt.burst=true;lt.holdBackground=true;lazy.update(away);lt.dataRevision++;lazy.update(away);
  assert.equal(M.audit.builds,first+2,'a followed span with a deck keeps it while the land bursts, like any other span');
  console.log('PASS built-deck reads never build; update() keeps the spans they follow current, with the burst hold');}
 const middle=roads.deckHeight(0,-20);
 assert.ok(middle>9.9,`joined span must use external abutments, not channel: ${middle}`);
 {// A deck built near the camera before its first read: that successful read follows it, and only it (another span in
  // the same 64 m cell is not under the point). Far away, new bank land lifts the deck and a walk widens it, and the far
  // source checks leave the tiles' last use alone (touch=false) while a span within DRAW still marks its tiles.
  let bump=0;const touches=[],ft={...terrain,dataRevision:1,heightAt:(x,z)=>height(x,z)+(z>0||z< -40?bump:0),
   surfaceAt:(x,z)=>({...terrain.surfaceAt(x,z),ground:ft.heightAt(x,z)}),meshContactSource:(x,z,land,touch)=>{touches.push(touch);return ft.dataRevision;}};
  const near=new mod.Roads({roads:[road(1,0,20),road(2,20,40),{...road(3,0,40),pts:[[40,0],[40,40]]}]},[0,0],ft),N=near.modern;
  near.update(new THREE.Vector3(0,20,-20));
  const own=N.spans.find(r=>r.road.id===1),other=N.spans.find(r=>r.road.id===3);
  assert.ok(own.geometry&&other.geometry&&!own.followed&&!other.followed,'both decks built near the camera, before any read');
  assert.ok(touches.length&&touches.every(t=>t!==false),'a span within DRAW still marks its tiles as used');
  const before=near.builtDeckHeight(0,-20);assert.ok(before!==null,'the first read hits the built deck');
  assert.ok(own.followed,'the first successful read follows its deck');assert.ok(!other.followed,'a span in the same cell but not under the read is not followed');
  assert.equal(near.builtDeckHeight(5.5,-20),null,'no deck 5.5 m from the centre line before the walk');
  const away=new THREE.Vector3(5000,20,5000),b0=N.audit.builds;touches.length=0;
  bump=1;ft.dataRevision++;near.update(away);
  assert.equal(N.audit.builds,b0+1,'only the followed deck rebuilds 5 km away');
  assert.ok(Math.abs(near.builtDeckHeight(0,-20)-(before+1))<.01,'new bank land 1 m higher lifts the far followed deck 1 m');
  assert.ok(touches.length&&touches.every(t=>t===false),'a far followed span does not mark its tiles as used');
  near.bridgeWalks.set(1,{side:1,width:2});near.update(away);
  assert.ok(Math.abs(own.width-5.9)<1e-9,'a 2 m walk widens the deck to 3.6 + 2 + 0.3 m');
  assert.ok(near.builtDeckHeight(5.5,-20)!==null,'the far followed deck is rebuilt at its new width');
  console.log('PASS a successful read follows only its deck; far bank land and a walk widening reach it without touching tiles');}
 const support=[];
 for(let s=-24;s<=64;s+=.1){const d=roads.deckHeight(0,-s);support.push(d??height(0,-s));}
 for(let i=1;i<support.length;i++)assert.ok(Math.abs(support[i]-support[i-1])<.04,'smooth approaches without support steps or dips');
 const first=roads.deckHeight(0,-19.999),second=roads.deckHeight(0,-20.001);
 assert.ok(Math.abs(first-second)<.001,'joined records share one plane');
 roads.update(new THREE.Vector3(0,20,-20));roads.group.updateMatrixWorld(true);
 assert.equal(roads.group.children.length,1,'modern bridges merge into one area draw');
 for(const r of roads.modern.spans){const n=r.geometry.getAttribute('normal');for(let i=0;i<r.triangles.length/3;i++)assert.ok(n.getY(i)>.99,'flat deck top normals point up for lighting and shadow bias');}
 const ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0));
 for(const s of[-12,-4,0,3,10,19.9,20.1,30,40,44,52])for(const x of[-2.5,.7,2.5]){
  const d=roads.deckHeight(x,-s);assert.notEqual(d,null,'top covers the wheel corridor');
  ray.ray.origin.set(x,50,-s);const hit=ray.intersectObjects(roads.group.children,true)[0];
  assert.ok(hit,'deck top is visible at contact');assert.ok(Math.abs(hit.point.y-d)<.012,`drawn deck is wheel support at ${x},${s}: ${hit.point.y}/${d}`);
 }
 const v=new mod.Vehicle(rig(THREE),terrain,roads,-.2);v.assist=0;v.place(0,25,0);v.vz=-20;v.speed=20;
 let maxRise=0;for(let i=0;i<800;i++){v.update(1/120,{throttle:.2,steer:0,handbrake:false});maxRise=Math.max(maxRise,v.y-10);}
 assert.ok(maxRise<.3,`real Vehicle crosses joined bridge without launch: ${maxRise}`);
 assert.ok(v.z< -45,'real Vehicle completes the bridge crossing');
 // A genuine airborne velocity is not a ground correction and must retain gravity alone.
 v.y=40;v.vy=12;v.airborne=true;v.update(1/120,{throttle:0,steer:0,handbrake:false});
 assert.ok(Math.abs(v.vy-(12-9.81/120))<1e-9,'airborne velocity is not globally capped');
 const curved=new mod.Roads({roads:[road(3,0,40),{id:4,name:'Bending approach',kind:1,halfWidth:3.6,bridge:false,pts:[[-16,-12],[-8,-4],[0,0]]}]},[0,0],{...terrain,heightAt:()=>10,surfaceAt:()=>({ground:10,level:8,kind:9})});
 assert.notEqual(curved.deckHeight(-7.16,3.58),null,'apron follows the bending bank road');
 assert.equal(curved.deckHeight(0,14),null,'apron does not continue straight into the gully beside that road');
 const builds=roads.modern.audit.builds;
 for(const grid of[roads.modern.cells,...roads.modern.spans.map(r=>r.cells)]){const get=grid.get.bind(grid);grid.get=k=>{assert.equal(typeof k,'number','wheel queries use numeric keys');return get(k);};}
 for(let i=0;i<100;i++)assert.notEqual(roads.deckHeight(.4,-20),null);
 assert.equal(roads.modern.audit.builds,builds,'cached wheel reads allocate no new geometry');
 // Real Mabou spans, no land needed. at() takes the segment the old linear scan took: the first i with
 // s<=cum[i+1], clamped to the last segment, segment 0 for NaN. At an exact joint the direction shows the tie.
 const real=mod.roads.modern;let atInputs=0;
 for(const r of real.spans){const last=r.pts.length-2;
  for(const s of[0,r.length,NaN,...r.cum,...r.cum.map(c=>c+1e-9),...r.cum.map(c=>c-1e-9)]){
   if(s<0&&r.start||s>r.length&&r.end)continue;
   let i=0;while(i<last&&s>r.cum[i+1])i++;
   const a=r.pts[i],b=r.pts[i+1],n=r.cum[i+1]-r.cum[i]||1,p=real.at(r,s);
   assert.ok(Object.is(p.nx,-(b[1]-a[1])/n)&&Object.is(p.nz,(b[0]-a[0])/n)&&Object.is(p.x,a[0]+(b[0]-a[0])*((s-r.cum[i])/n)),`at() segment rule: span ${r.road.id} s=${s}`);atInputs++;
  }}
 // update() builds a span only when its deck line is within 1500 m of the camera (main: pts[0] within 1500 m).
 // At the Mabou start pose some spans lie inside the old 1500 m box but farther than 1500 m from their deck line.
 const village=mod.manifest.village,cam=new THREE.Vector3(624450-village[0],20,village[1]-5103340),eager=[];
 real.ensure=r=>{eager.push(real.spans.indexOf(r));};try{real.update(cam);}finally{delete real.ensure;}
 const line=r=>Math.min(...r.pts.slice(1).map((b,j)=>{const a=r.pts[j],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((cam.x-a[0])*dx+(cam.z-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(cam.x-a[0]-dx*t,cam.z-a[1]-dz*t);}));
 const index=real.spans.map((_,i)=>i),near=index.filter(i=>line(real.spans[i])<1500);
 const box=index.filter(i=>{const r=real.spans[i];return cam.x>r.x0-1500&&cam.x<r.x1+1500&&cam.z>r.z0-1500&&cam.z<r.z1+1500;});
 assert.deepEqual(eager,near,'update() builds only the spans whose deck line is within 1500 m');
 assert.ok(near.length>0&&box.length>near.length,`the start pose has near spans and far spans in the box: ${near}/${box}`);
 // A land burst (Terrain.burst: a start or a jump, until the land in view is in) while the game waits for the driver
 // (Terrain.holdBackground: main holds it until the first pedal). update() gives a span with no deck its first build at
 // once, keeps a built deck, and builds it again in the first update after the burst or once the driver drives. The
 // hold also ends when the camera moves more than 30 m across the map; a step over 150 m starts a new hold there.
 // A deck query and a forced build (a new width) still build at once.
 const land={...terrain,dataRevision:1,burst:true,holdBackground:true},held=new mod.Roads({roads:[road(7,0,20),road(8,20,40)]},[0,0],land),deck=held.modern,camera=new THREE.Vector3(0,20,-20);
 const step=(cam=camera)=>{land.dataRevision++;held.update(cam);return deck.audit.builds;};
 held.update(camera);assert.equal(deck.audit.builds,1,'a span with no deck builds at once during a burst');
 for(let i=0;i<3;i++)step();
 assert.equal(deck.audit.builds,1,'update() keeps a built deck while the land bursts and the game waits for the driver');
 camera.y+=64;assert.equal(step(),1,'the parked camera rising with the car keeps the hold');
 land.burst=false;held.update(camera);assert.equal(deck.audit.builds,2,'the first update after the burst builds the deck again');
 held.update(camera);assert.equal(deck.audit.builds,2,'settled land builds nothing more');
 land.burst=true;land.holdBackground=false;assert.equal(step(),3,'once the driver drives, update() builds at once during a burst');
 land.holdBackground=true;assert.equal(step(),3,'a new wait for the driver holds again');
 const moved=camera.clone().add(new THREE.Vector3(31,0,0));
 assert.equal(step(moved),4,'the hold ends when the camera moves more than 30 m across the map');
 assert.equal(step(moved),5,'an ended hold stays ended');
 // A jump is one step of more than 150 m from the last camera position, not a distance from where the hold began.
 // So 20 m steps in a straight line, 200 m in all, keep an ended hold ended, and so does one step of 149 m.
 const walk=moved.clone();
 for(let i=1;i<=10;i++){walk.z-=20;assert.equal(step(walk),5+i,`steps of 20 m keep an ended hold ended (${20*i} m)`);}
 walk.x+=149;assert.equal(step(walk),16,'one step shorter than 150 m keeps an ended hold ended');
 const far=walk.clone().add(new THREE.Vector3(-31,0,-200));
 assert.equal(step(far),16,'a jump of more than 150 m starts a new hold where the camera lands');
 // The jump moved the hold's anchor to where the camera landed: 29 m from there still holds, 31 m from there builds.
 const landed=far.clone();
 assert.equal(step(landed.clone().add(new THREE.Vector3(29,0,0))),16,'a jump re-anchors the hold: 29 m from where it landed keeps the hold');
 const off=landed.clone().add(new THREE.Vector3(31,0,0));
 assert.equal(step(off),17,'a jump re-anchors the hold: 31 m from where it landed ends it');
 // From an ended hold, one step of 149 m is not a jump and one of 151 m is: HOLD_JUMP is 150 m from the last camera
 // position, counted on both axes (each axis of this diagonal step is under 150 m).
 const short=off.clone().add(new THREE.Vector3(0,0,149));
 assert.equal(step(short),18,'one step of 149 m keeps an ended hold ended');
 const diagonal=short.clone().add(new THREE.Vector3(106.8,0,106.8));
 assert.ok(Math.abs(diagonal.distanceTo(short)-151.04)<.01);
 assert.equal(step(diagonal),18,'one diagonal step of 151 m starts a new hold');
 land.dataRevision++;assert.notEqual(held.deckHeight(0,-20),null);assert.equal(deck.audit.builds,19,'a deck query still builds at once during a burst');
 const span=deck.spans[0];span.forceBuild=true;span.revision=-1;held.update(diagonal);assert.equal(deck.audit.builds,20,'a forced build does not wait for the burst');
 // Node tools and stubs that never set holdBackground see no hold.
 const bareLand={...terrain,dataRevision:1,burst:true},bare=new mod.Roads({roads:[road(9,0,20)]},[0,0],bareLand);
 bare.update(camera);bareLand.dataRevision++;bare.update(camera);
 assert.equal(bare.modern.audit.builds,2,'a terrain without holdBackground never holds');
 // Unpaved bridge approaches (rail trail, gravel, washboard, track) carry per-vertex approach attributes and shade
 // with terrain noise and lighting; decks, rails and paved approaches stay untouched (approach.x === 0).
 {
  const uniforms={
   sunDir:{value:new THREE.Vector3(0.4,0.7,0.5).normalize()},sunColor:{value:new THREE.Color(4,3.6,3.3)},
   skyColor:{value:new THREE.Color(0.3,0.44,0.72)},fogColor:{value:new THREE.Color(0.62,0.66,0.72)},
   fogDensity:{value:0.00018},seaLevel:{value:-0.2},winterCover:{value:0},rainWet:{value:0},
  };
  const flat={...terrain,heightAt:()=>10,surfaceAt:()=>({ground:10,level:8,canopy:0,roadDist:0,halfWidth:2.6,kind:3,bridge:true,washboard:false}),uniforms};
  const cases=[
   {id:101,kind:1,hw:3.6,wash:false,code:0,x:0},
   {id:102,kind:3,hw:2.6,wash:false,code:3,x:100},
   {id:103,kind:3,hw:2.6,wash:true,code:6,x:200},
   {id:104,kind:4,hw:1.5,wash:false,code:4,x:300},
   {id:105,kind:5,hw:1.6,wash:false,code:5,x:400},
  ];
  const net=new mod.Roads({roads:cases.map(c=>({id:c.id,name:'Approach '+c.id,kind:c.kind,halfWidth:c.hw,bridge:true,washboard:c.wash,pts:[[c.x,0],[c.x,20]]}))},[0,0],flat);
  for(const c of cases)net.update(new THREE.Vector3(c.x,20,-10));
  const M=net.modern;
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};
  M.material.onBeforeCompile(shader,{});
  assert.ok(M.material.customProgramCacheKey().includes('approach'),'approach shader sets a distinct program cache key');
  assert.equal(shader.uniforms.uBridgeSkyColor,uniforms.skyColor,'approach shader binds terrain skyColor uniform directly');
  assert.equal(shader.uniforms.uBridgeSunColor,uniforms.sunColor,'approach shader binds terrain sunColor uniform directly');
  assert.match(shader.vertexShader,/attribute vec4 approach;/,'vertex shader declares approach attribute');
  assert.match(shader.fragmentShader,/bridgeNoise\(bp \* 3\.1\)[\s\S]*bDust[\s\S]*bGravel[\s\S]*uBridgeSkyColor/,'fragment shader paints gravel/dust with terrain lighting');
  assert.match(shader.fragmentShader,/vec3 bDirBefore = reflectedLight\.directDiffuse;[\s\S]*vec3 bDirDiffuse = reflectedLight\.directDiffuse - bDirBefore;/,'directional light separated from local lights before PI scaling');
  assert.match(shader.fragmentShader,/outgoingLight = bDirect \+ bIndirect \+ totalEmissiveRadiance;[\s\S]*outgoingLight = mix\(outgoingLight, bHaze,/,'computed terrain lighting and haze applied to outgoingLight');
  // Evaluate the patched bDirect formula on shadowed headlights, sunlit day, and mixed dusk to ensure only
  // directional sun light is scaled by PI while spot/point lights keep 1x contribution.
  const bDirectExpr=shader.fragmentShader.match(/vec3 bDirect = ([^;]+);/)?.[1];
  assert.ok(bDirectExpr,'fragment shader computes bDirect');
  const evalDirect=new Function('reflectedLight','bDirDiffuse','PI','return '+bDirectExpr);
  assert.ok(Math.abs(evalDirect({directDiffuse:0.5},0,Math.PI)-0.5)<1e-9,'sun-shadowed headlights keep 1x contribution (not scaled by PI)');
  assert.ok(Math.abs(evalDirect({directDiffuse:1.0},1.0,Math.PI)-Math.PI)<1e-9,'sunlit directional light scales by PI to match terrain');
  assert.ok(Math.abs(evalDirect({directDiffuse:0.7},0.2,Math.PI)-(0.5+0.2*Math.PI))<1e-9,'mixed headlights + directional sun scales only the sun by PI');
  // Every literal smoothstep(a, b, x) in our added shader text must have ascending edges (valid GLSL ES 3.00).
  for(const [,lo,hi] of shader.fragmentShader.matchAll(/smoothstep\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,/g)){
   assert.ok(Number(lo)<Number(hi),`smoothstep edges must ascend: smoothstep(${lo}, ${hi}, ...)`);
  }
  for(const c of cases){
   const sp=M.spans.find(r=>r.road.id===c.id),attr=sp.geometry.getAttribute('approach');
   assert.ok(attr&&attr.itemSize===4,'span geometry carries vec4 approach attribute');
   const surfaceVerts=sp.triangleDeck.length*3;
   let minU=Infinity,maxU=-Infinity,approachVerts=0;
   for(let v=0;v<attr.count;v++){
    const code=attr.getX(v),u=attr.getY(v),half=attr.getZ(v);
    if(v>=surfaceVerts){assert.equal(code,0,`non-surface vertex ${v} on span ${c.id} keeps plain shading`);continue;}
    const part=sp.triangleDeck[Math.floor(v/3)];
    if(part===1||c.code===0){assert.equal(code,0,`deck or paved vertex ${v} on span ${c.id} keeps plain shading`);}
    else{
     approachVerts++;
     assert.equal(code,c.code,`approach vertex ${v} on span ${c.id} carries code ${c.code}`);
     assert.ok(Math.abs(half-c.hw)<1e-6,`approach vertex carries joining halfWidth ${c.hw}`);
     minU=Math.min(minU,u);maxU=Math.max(maxU,u);
    }
   }
   if(c.code>0){assert.ok(approachVerts>0&&minU<-c.hw+0.01&&maxU>c.hw-0.01,`unpaved span ${c.id} spans signed lateral offsets across centreline`);}
  }
  // Merged mesh carries approach attribute and preserves exact vertex alignment across setHidden(true/false).
  const mergedBefore=Float32Array.from(M.mesh.geometry.getAttribute('approach').array);
  const hiddenSpan=M.spans.find(r=>r.road.id===105);
  M.setHidden(105,true);
  const hiddenApproach=M.mesh.geometry.getAttribute('approach').array;
  const expectedChunks=[];
  for(const sp of M.spans){
   const a=sp.geometry.getAttribute('approach').array;
   if(sp!==hiddenSpan)expectedChunks.push(a);
   else for(let i=0;i<sp.approachRanges.length;i+=2)expectedChunks.push(a.subarray(sp.approachRanges[i]*4,sp.approachRanges[i+1]*4));
  }
  const expectedHidden=new Float32Array(expectedChunks.reduce((n,a)=>n+a.length,0));
  let offset=0;for(const ch of expectedChunks){expectedHidden.set(ch,offset);offset+=ch.length;}
  assert.deepEqual(hiddenApproach,expectedHidden,'hidden merged mesh keeps exact per-vertex approach tuples in order');
  M.setHidden(105,false);
  assert.deepEqual(M.mesh.geometry.getAttribute('approach').array,mergedBefore,'restored mesh matches original approach attribute');
  // Real baked Mabou Mines Road (span 57) washboard phase: check true barycentric interpolation across actual
  // triangles at exact offsets along both toes against an independent TERRAIN_FRAG road-field oracle (never calling
  // terrain.roadAlongAxis as the oracle). Planar cells must match to <1e-3 at interpolated points between vertices,
  // and twisted bilinear cells must not distort the approach's smooth linear phase across the road.
  const mines=mod.roads.modern.spans.find(r=>r.road.id===57);
  assert.ok(mines,'Mabou Mines Road span 57 exists');
  await mod.preload(mod.terrain,mines.pts.map(p=>[p[0],p[1]]),80,8);
  mod.roads.modern.ensure(mines);
  const mPos=mines.geometry.getAttribute('position'),mApp=mines.geometry.getAttribute('approach');
  const ridge=phase=>1-0.3*(1-(0.5-0.5*Math.cos(phase*10.134)));
  const independentTerrainCell=(x,z)=>{
   const t=mod.terrain.find(x,z,false);assert.ok(t?.road,'baked tile has road field');
   const mpp=t.size/256,fa=(x-t.x0)/mpp,fb=(z-t.z0)/mpp,a=Math.min(255,Math.floor(fa)),b=Math.min(255,Math.floor(fb));
   const wx=fa-a,wz=fb-b,zero=mod.terrain.zero,r=t.road;
   const sd=(ix,iz)=>(r[(iz*257+ix)*4]-zero)*0.1;
   const sa=sd(a,b),sb=sd(a+1,b),sc=sd(a,b+1),sd1=sd(a+1,b+1);
   const gx=((sb-sa)*(1-wz)+(sd1-sc)*wz)/mpp,gz=((sc-sa)*(1-wx)+(sd1-sb)*wx)/mpp;
   const ax=-gz+1e-5,az=gx+1e-5,an=Math.hypot(ax,az);
   return {ridge:ridge((x*ax+z*az)/an),planar:Math.abs(sa-sb-sc+sd1)<=1e-4,ax:ax/an,az:az/an};
  };
  const interpWashboardW=(x,z)=>{
   for(let i=0;i<mines.triangleDeck.length;i++){
    const v0=i*3,v1=v0+1,v2=v0+2;
    if(mApp.getX(v0)!==6)continue;
    const x0=mPos.getX(v0),z0=mPos.getZ(v0),x1=mPos.getX(v1),z1=mPos.getZ(v1),x2=mPos.getX(v2),z2=mPos.getZ(v2);
    const det=(z1-z2)*(x0-x2)+(x2-x1)*(z0-z2);
    if(Math.abs(det)<1e-9)continue;
    const l0=((z1-z2)*(x-x2)+(x2-x1)*(z-z2))/det,l1=((z2-z0)*(x-x2)+(x0-x2)*(z-z2))/det,l2=1-l0-l1;
    if(l0>=-1e-4&&l1>=-1e-4&&l2>=-1e-4)return l0*mApp.getW(v0)+l1*mApp.getW(v1)+l2*mApp.getW(v2);
   }
   return null;
  };
  for(const [label,sToe,inward] of[['start',-mines.startLength,1e-3],['end',mines.length+mines.endLength,-1e-3]]){
   const toe=mod.roads.modern.at(mines,sToe),center=independentTerrainCell(toe.x,toe.z);
   assert.ok(center.planar,`span 57 ${label} toe centreline sits on a planar road-field cell`);
   let exactMatches=0,offCenterExact=0,prevW=null;
   for(const uOff of[-2.0,-1.75,-1.56,-1.25,-1.0,-0.75,-0.5,-0.25,0,0.25,0.5,0.75,1.0,1.25,1.56,1.75,2.0]){
    const px=toe.x+toe.nx*uOff+toe.nz*inward,pz=toe.z+toe.nz*uOff-toe.nx*inward;
    const w=interpWashboardW(px,pz);
    assert.ok(w!==null,`found washboard surface triangle at span 57 ${label} toe u=${uOff}`);
    if(prevW!==null)assert.ok(Math.abs(w-prevW)<0.08,`span 57 ${label} toe phase stays smooth across u=${uOff} (delta ${Math.abs(w-prevW).toFixed(4)})`);
    prevW=w;
    const got=ridge(w),cell=independentTerrainCell(px,pz);
    const sameAxis=cell.planar&&Math.abs(Math.abs(cell.ax*center.ax+cell.az*center.az)-1)<1e-6;
    if(sameAxis){
     assert.ok(Math.abs(got-cell.ridge)<1e-3,`span 57 ${label} u=${uOff} interpolated washboard ridge matches independent road field (${got.toFixed(4)} vs ${cell.ridge.toFixed(4)})`);
     exactMatches++;
     if(Math.abs(uOff)>=1.5)offCenterExact++;
    }
   }
   assert.ok(exactMatches>=6&&offCenterExact>=1,`span 57 ${label} toe verified interpolated washboard at centreline and off-centre wheel path (${exactMatches} exact, ${offCenterExact} off-centre)`);
  }
  // Twisted bilinear cells (sa-sb-sc+sd!=0) must be rejected by roadAlongAxis, and toeFrame must search outward
  // to recover the adjacent planar road-field axis when a washboard toe centreline lands on a twisted cell.
  {
   const toe=mod.roads.modern.at(mines,-mines.startLength),tx=toe.nz,tz=-toe.nx;
   const twX=toe.x+toe.nx*-1.56,twZ=toe.z+toe.nz*-1.56;
   assert.equal(independentTerrainCell(twX,twZ).planar,false,'span 57 start toe u=-1.56 sits on a twisted road-field cell');
   assert.equal(mod.terrain.roadAlongAxis(twX,twZ,tx,tz),null,'roadAlongAxis rejects twisted bilinear road-field cell');
   const [vx,vy]=mod.terrain.manifest.village;
   const toEN=(x,z)=>[x+vx,vy-z];
   const shiftedNet=new mod.Roads({roads:[{
    id:57001,name:'Twisted Toe',kind:3,halfWidth:mines.road.halfWidth,washboard:true,bridge:true,
    pts:[toEN(twX+tx*16,twZ+tz*16),toEN(twX+tx*28,twZ+tz*28)],
   }]},mod.terrain.manifest.village,mod.terrain);
   const shifted=shiftedNet.modern,sp=shifted.spans[0];
   assert.ok(sp,'synthetic twisted-centreline washboard span exists');
   sp.startLength=16;sp.endLength=8;
   shifted.ensure(sp);
   const sPos=sp.geometry.getAttribute('position'),sApp=sp.geometry.getAttribute('approach');
   const interpShifted=(x,z)=>{
    for(let i=0;i<sp.triangleDeck.length;i++){
     const v0=i*3,v1=v0+1,v2=v0+2;
     if(sApp.getX(v0)!==6)continue;
     const x0=sPos.getX(v0),z0=sPos.getZ(v0),x1=sPos.getX(v1),z1=sPos.getZ(v1),x2=sPos.getX(v2),z2=sPos.getZ(v2);
     const det=(z1-z2)*(x0-x2)+(x2-x1)*(z0-z2);
     if(Math.abs(det)<1e-9)continue;
     const l0=((z1-z2)*(x-x2)+(x2-x1)*(z-z2))/det,l1=((z2-z0)*(x-x2)+(x0-x2)*(z-z2))/det,l2=1-l0-l1;
     if(l0>=-1e-4&&l1>=-1e-4&&l2>=-1e-4)return l0*sApp.getW(v0)+l1*sApp.getW(v1)+l2*sApp.getW(v2);
    }
    return null;
   };
   const sToePt=shifted.at(sp,-sp.startLength);
   // At u=+0.5 m from the shifted twisted centreline (original u=-1.06 m), cell (50,83) is planar and recovered by outward search.
   const px=sToePt.x+sToePt.nx*0.5+sToePt.nz*1e-3,pz=sToePt.z+sToePt.nz*0.5-sToePt.nx*1e-3;
   const cell=independentTerrainCell(px,pz),w=interpShifted(px,pz);
   assert.ok(cell.planar&&w!==null,'shifted washboard toe recovers adjacent planar cell at u=+0.5');
   assert.ok(Math.abs(ridge(w)-cell.ridge)<1e-3,`outward planar search matches adjacent planar road field (${ridge(w).toFixed(4)} vs ${cell.ridge.toFixed(4)})`);
  }
  console.log('PASS unpaved approaches carry terrain-matched gravel/dust/washboard shading; decks and paved approaches stay untouched');
 }
 return{middle,maxRise,draws:roads.group.children.length,atInputs,eager:eager.length,farInBox:box.length-near.length,burstBuilds:deck.audit.builds};
}
// The grade solver's shortcuts (a repeat visit skipped, the shared lattice memo, squared length tests, the isSpan
// box) give the same bits as the plain solver: the same source with each shortcut taken out. Real Point Tupper
// spans at the default scale 1.5: -100084 runs all 600 passes in each of its 3 builds (2 approach retries),
// -100080 falls back to the relaxed curve. Then the length tests alone, on seeded lengths within a few ulps of
// their limits, against plain Math.hypot.
async function shortcuts(replacements={}){
 const file='web/src/modern-bridges.ts',s=readFileSync(root+file,'utf8'),fast=replacements[file]??s;let plain=s;
 for(const [from,to] of[
  ['=>{const q=a*a+b*b;return q>hi||!(q<lo)&&Math.hypot(a,b)>limit;};','=>Math.hypot(a,b)>limit;'],
  ['=>{const q=a*a+b*b;return q<lo||!(q>hi)&&Math.hypot(a,b)<=limit;};','=>Math.hypot(a,b)<=limit;'],
  ['if(d>=1&&d<1e150){','if(false){'],
  ['if(n===0&&mid===longest||stepLonger(','if(stepLonger('],
  ['if(x>g[k+6]+e||x<g[k+5]-e||z>g[k+8]+e||z<g[k+7]-e)continue;',''],
  ['if(state===0||memoX[slot]!==x||','if(true||memoX[slot]!==x||'],
  ['if(last!==0&&changed[n0]<last&&changed[n1]<last&&changed[n2]<last){','if(false){'],
 ]){assert.equal(plain.split(from).length,2,'one plain solver anchor: '+from);plain=plain.replace(from,to);}
 const worlds=[];
 for(const source of[fast,plain]){
  const f=await fixture('pointtupper',1.5,{...replacements,[file]:source}),m=f.roads.modern,spans=[-100084,-100080,240].map(id=>m.spans.find(r=>r.road.id===id));
  assert.ok(spans.every(Boolean),'Point Tupper spans -100084, -100080 and 240 exist');
  await f.preload(f.terrain,spans.flatMap(r=>r.pts.map(p=>[p[0],p[1]])),120,8);for(const r of spans)m.ensure(r);worlds.push({m,spans});
 }
 const bits=r=>Buffer.concat([r.triangles,r.triangleDeck,...['position','normal','color'].map(n=>r.geometry.getAttribute(n).array),new Float64Array([r.startLength,r.endLength,r.y0,r.y1])].map(a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength)));
 worlds[0].spans.forEach((r,i)=>assert.ok(bits(r).equals(bits(worlds[1].spans[i])),`solver shortcuts keep span ${r.road.id} bit for bit`));
 let seed=1306;const rnd=()=>(seed=seed*16807%2147483647)/2147483647;let points=0;
 for(const r of worlds[0].m.spans){const reach=r.width+.0001;
  for(let j=1;j<r.pts.length;j++){const a=r.pts[j-1],b=r.pts[j],dx=b[0]-a[0],dz=b[1]-a[1],n=Math.hypot(dx,dz)||1;
   // Every span's segments (isSpan reads them all; the nearly axis-aligned ones decide whether a box too small is caught),
   // random feet along each, then feet aimed at its ends and joints at exactly the reach, which catch it without the seed.
   const aimed=[];for(const t of[0,1e-8,1-1e-8,1])for(const side of[-1,1])for(const f of[1-1e-9,1+1e-9])aimed.push([t,reach*f*side]);
   for(let k=0;k<300+aimed.length;k++){const [t,off]=k<300?[-.05+1.1*rnd(),reach*(1+(rnd()-.5)*(k%2?1e-6:.4))*(rnd()<.5?-1:1)]:aimed[k-300],x=a[0]+dx*t-dz/n*off,z=a[1]+dz*t+dx/n*off;points++;
    for(const kind of[-1,1,5])assert.equal(worlds[0].m.isSpan(x,z,kind),worlds[1].m.isSpan(x,z,kind),`isSpan box keeps the plain answer at ${x},${z}`);}
  }}
 const from=fast.indexOf('/** Math.hypot(a,b)>limit'),to=fast.indexOf('/** True when (x,z) is within');assert.ok(from>0&&to>from,'length test slice');
 const lib=new Function(transformSync(fast.slice(from,to),{loader:'ts'}).code+'\nreturn{longer,noLonger,stepLonger,stepLength,STEP,STEP_LO,STEP_HI,STEEP,STEEP_LO,STEEP_HI};')();
 let lengths=0;
 for(const [limit,lo,hi] of[[lib.STEP,lib.STEP_LO,lib.STEP_HI],[lib.STEEP,lib.STEEP_LO,lib.STEEP_HI]])for(let i=0;i<60000;i++){
  const angle=rnd()*7,length=i%3?limit*(1+(rnd()-.5)*2e-13):limit*Math.sqrt(1+(i%2?1e-9:-1e-9))*(1+(rnd()-.5)*1e-15),a=length*Math.cos(angle),b=length*Math.sin(angle);lengths++;
  assert.equal(lib.longer(a,b,limit,lo,hi),Math.hypot(a,b)>limit,`longer(${a},${b},${limit})`);assert.equal(lib.noLonger(a,b,limit,lo,hi),Math.hypot(a,b)<=limit,`noLonger(${a},${b},${limit})`);
 }
 const norm=(l,xx,xz,zz,gx,gz,det)=>{const d=1+l*(xx+zz)+l*l*det;return Math.hypot(((1+l*zz)*gx-l*xz*gz)/d,((1+l*xx)*gz-l*xz*gx)/d);};
 let solves=0;
 for(let i=0;i<4000;i++){
  const scale=Math.exp((rnd()-.5)*20),c=[0,1,2].map(()=>[(rnd()-.5)*scale,(rnd()-.5)*scale]),free=[0,1,2].filter(()=>rnd()<.8);let gx=0,gz=0,xx=0,xz=0,zz=0;
  for(const [x,z] of c){const y=(rnd()-.5)*3*scale;gx+=x*y;gz+=z*y;}for(const k of free){xx+=c[k][0]*c[k][0];xz+=c[k][0]*c[k][1];zz+=c[k][1]*c[k][1];}
  const det=free.length===1?0:Math.max(0,xx*zz-xz*xz),args=[xx,xz,zz,gx,gz,det];let lo=0,hi=1/Math.max(xx,zz,1e-12);
  for(let n=0;n<32&&norm(hi,...args)>.245;n++)hi*=2;
  if(norm(hi,...args)>.246)hi=-1;else for(let n=0;n<26;n++){const mid=(lo+hi)/2;
   for(const [limit,a,b] of[[lib.STEP,lib.STEP_LO,lib.STEP_HI],[lib.STEEP,lib.STEEP_LO,lib.STEEP_HI]])assert.equal(lib.stepLonger(mid,xx+zz,...args,limit,a,b),norm(mid,...args)>limit,`stepLonger(${mid},${args},${limit})`);
   if(norm(mid,...args)>.245)lo=mid;else hi=mid;}
  assert.ok(Object.is(lib.stepLength(xx+zz,...args),hi),`stepLength(${args})`);solves++;
 }
 return{spans:worlds[0].spans.map(r=>r.road.id),isSpanPoints:points,lengths,solves};
}
// The grade solver stops after a pass that moves no height, but a pass that lifted a corner runs once more. A lift in
// the first pass can raise a corner after the visit of a neighbour that shares it, and so make that neighbour steep.
// Real Point Tupper span 240 (Reeves Street) at the default scale 1.5 on level-7 land: the first pass lifts two
// corners by 7-9 cm after such a visit. A stop there leaves a triangle at slope .308, reads it as a steep toe and
// grows both approaches to 96 m over 11 builds. One more pass solves it in one build with 16 m approaches.
async function liftedPass(replacements={}){
 const f=await fixture('pointtupper',1.5,replacements),m=f.roads.modern,r=m.spans.find(s=>s.road.id===240),proto=Object.getPrototypeOf(m);
 assert.ok(r,'Point Tupper span 240 exists');
 let builds=0;m.build=function(){builds++;return proto.build.apply(this,arguments);};
 await f.preload(f.terrain,r.pts.map(p=>[p[0],p[1]]),120,7);m.ensure(r);
 assert.equal(r.level,7,'span 240 is built on level-7 land');
 const t=r.triangles;let steepest=0;
 for(let k=0;k<t.length;k+=9){const dx=t[k+3]-t[k],dy=t[k+4]-t[k+1],dz=t[k+5]-t[k+2],ex=t[k+6]-t[k],ey=t[k+7]-t[k+1],ez=t[k+8]-t[k+2],det=dx*ez-dz*ex;
  if(Math.abs(det)>=1e-8)steepest=Math.max(steepest,Math.hypot((dy*ez-ey*dz)/det,(dx*ey-ex*dy)/det));}
 assert.ok(steepest<=.246,`a pass that lifted runs once more: every span 240 triangle within the solver limit .246: ${steepest}`);
 assert.equal(builds,1,`a pass that lifted runs once more: span 240 builds once (approaches ${r.startLength}/${r.endLength})`);
 return{builds,steepest,approaches:[r.startLength,r.endLength]};
}
console.log('PASS',await contracts());
console.log('PASS solver shortcuts',await shortcuts());
console.log('PASS lifted pass',await liftedPass());
if(process.argv.includes('--mutations')){
 const file='web/src/modern-bridges.ts',s=readFileSync(root+file,'utf8'),anchor="if(along>=0&&along<=r.length){const t=along/r.length,smooth=r.road.kind<=3&&r.length>=20&&Math.abs(r.y1-r.y0)/r.length<.06;return r.y0+(r.y1-r.y0)*(smooth?t*t*(3-2*t):t);}";
 assert.equal(s.split(anchor).length,2,'one deck plane mutation');
 await assert.rejects(()=>contracts({[file]:s.replace(anchor,'if(along>=0&&along<=r.length)return this.land(x,z)??0;')}),/external abutments/,'terrain-draped deck must fail production support assertion');
 console.log('KILLED deck height taken from channel terrain');
 for(const [name,from,to,error] of[
  ['at() segment tie rule','if(s>cum[mid+1])lo=mid+1','if(s>=cum[mid+1])lo=mid+1',/at\(\) segment rule/],
  ['far spans in the box build eagerly','&&nearLine(r.pts,cam.x,cam.z,DRAW);',';',/deck line is within 1500 m/],
  ['update() builds a built deck again during a burst','if(hold&&r.geometry&&!r.forceBuild)continue;','',/keeps (a built deck|it) while the land bursts/],
  ['update() holds a missing deck during a burst','if(hold&&r.geometry&&','if(hold&&',/no deck builds at once/],
  ['update() still holds after the burst','if(this.terrain.burst!==true||','if(',/builds the deck again/],
  ['update() holds after the driver drives','||this.terrain.holdBackground!==true)',')',/once the driver drives/],
  ['a terrain without holdBackground holds','||this.terrain.holdBackground!==true)','||this.terrain.holdBackground===false)',/without holdBackground never holds/],
  ['the hold has no camera bound','else if(Math.hypot(cam.x-this.holdAt!.x,cam.z-this.holdAt!.z)>HOLD_REACH)this.holdEnded=true;','',/moves more than 30 m/],
  ['the camera bound counts height','Math.hypot(cam.x-this.holdAt!.x,cam.z-this.holdAt!.z)>HOLD_REACH','cam.distanceTo(this.holdAt!)>HOLD_REACH',/rising with the car/],
  ['a jump does not start a new hold','const jump=!this.holdAt||!this.holdLast||cam.distanceTo(this.holdLast)>HOLD_JUMP;','const jump=!this.holdAt;',/jump of more than 150 m/],
  ['a jump is measured from where the hold began','cam.distanceTo(this.holdLast)>HOLD_JUMP','cam.distanceTo(this.holdAt)>HOLD_JUMP',/steps of 20 m keep an ended hold ended/],
  ['the last camera position moves only on a jump','this.holdLast=(this.holdLast??new THREE.Vector3()).copy(cam);\n    if(jump){','if(jump){this.holdLast=(this.holdLast??new THREE.Vector3()).copy(cam);',/steps of 20 m keep an ended hold ended/],
  ['a jump is a step of more than 40 m','HOLD_REACH = 30, HOLD_JUMP = 150;','HOLD_REACH = 30, HOLD_JUMP = 40;',/one step shorter than 150 m/],
  ['a jump keeps the old anchor','if(jump){this.holdAt=(this.holdAt??new THREE.Vector3()).copy(cam);','if(jump){if(!this.holdAt)this.holdAt=new THREE.Vector3().copy(cam);',/29 m from where it landed keeps the hold/],
  ['a jump is a step of more than 160 m','HOLD_REACH = 30, HOLD_JUMP = 150;','HOLD_REACH = 30, HOLD_JUMP = 160;',/diagonal step of 151 m starts a new hold/],
  ['a jump is a step of more than 200 m','HOLD_REACH = 30, HOLD_JUMP = 150;','HOLD_REACH = 30, HOLD_JUMP = 200;',/diagonal step of 151 m starts a new hold/],
  ['a jump counts one axis only','cam.distanceTo(this.holdLast)>HOLD_JUMP','Math.abs(cam.z-this.holdLast.z)>HOLD_JUMP',/diagonal step of 151 m starts a new hold/],
  ['a forced build waits for the burst','&&!r.forceBuild)continue;',')continue;',/forced build/],
  ['a deck query waits for the burst','if(build)this.ensure(r);','if(build&&!this.terrain.burst)this.ensure(r);',/query still builds/],
  ['a built-deck read builds','this.query(x,z,false,false,undefined,false,0,false);if(this.sampling','this.query(x,z,false,false,undefined,false,0,true);if(this.sampling',/unbuilt span is null|builds nothing/],
  ['update() ignores followed spans','if(near||r.followed)this.ensure','if(near)this.ensure',/5 km away/],
  ['a followed span refreshes only until its first build','if(near||r.followed)this.ensure','if(near||r.followed&&!r.geometry)this.ensure',/after its first build/],
  ['a far followed span marks its tiles','this.ensure(r,near);','this.ensure(r);',/does not mark its tiles/],
  ['a span within DRAW leaves its tiles unmarked','this.ensure(r,near);','this.ensure(r,false);',/within DRAW still marks/],
  ['a hit follows every span in its cell','(h===null?!r.geometry:this.ownHeight(r,x,z)!==null)','(true)',/not under the read is not followed/],
  ['a hit follows no span','(h===null?!r.geometry:this.ownHeight(r,x,z)!==null)','(h===null&&!r.geometry)',/first successful read follows/],
  ['a followed span skips the burst hold','const r=this.spans[i];if(hold&&','const r=this.spans[i];if(r.followed){this.ensure(r);continue;}if(hold&&',/keeps it while the land bursts, like any other/],
  ['unpaved approach shader disabled','applyApproachShader(this.material,(terrain as {uniforms?:Record<string,THREE.IUniform>}).uniforms);','',/approach shader/],
  ['unpaved approach code zeroed','const code=deck||kind<=2?0:kind===3?(washboard?6:3):kind===5?5:4;','const code=0;',/carries code/],
  ['paved approaches shaded as gravel','const code=deck||kind<=2?0:kind===3?(washboard?6:3):kind===5?5:4;','const code=deck?0:kind===3?(washboard?6:3):kind===5?5:4;',/deck or paved vertex/],
  ['unpaved lighting discarded','outgoingLight = bDirect + bIndirect + totalEmissiveRadiance;','// discarded',/computed terrain lighting/],
  ['all direct lights scaled by PI','vec3 bDirect = (reflectedLight.directDiffuse - bDirDiffuse) + bDirDiffuse * PI;','vec3 bDirect = reflectedLight.directDiffuse * PI;',/sun-shadowed headlights keep 1x/],
  ['washboard toe phase zeroed','const startFrame=toeFrame(-r.startLength),endFrame=toeFrame(r.length+r.endLength);','const startFrame=null,endFrame=null;',/interpolated washboard/],
  ['washboard drops cross-road toe tilt','w=(sv-sToe)+frame.base+uv*frame.cross*blend;','w=(sv-sToe)+frame.base;',/interpolated washboard/],
  ['washboard toeFrame skips outward planar search','for(let d=0;d<=hw&&!axis;d+=0.5){','for(let d=0;d<=0&&!axis;d+=0.5){',/outward planar search matches adjacent planar road field/],
  ['hidden approach attribute slice dropped','if(a)data.set((a.array as Float32Array).subarray(r.approachRanges[i]*4,r.approachRanges[i+1]*4),at);','',/exact per-vertex approach tuples/],
 ]){
  assert.equal(s.split(from).length,2,'one mutation anchor: '+name);
  await assert.rejects(()=>contracts({[file]:s.replace(from,to)}),error,name+' must fail');
  console.log('KILLED '+name);
 }
 {
  const tFile='web/src/terrain.ts',ts=readFileSync(root+tFile,'utf8');
  for(const [name,from,to,error] of[
   ['terrain roadAlongAxis returns null','return [ux, uz];','return null;',/interpolated washboard/],
   ['terrain roadAlongAxis skips twist rejection','if (Math.abs(sa - sb - sc + sd) > 1e-4) return null;','',/rejects twisted bilinear road-field cell/],
  ]){
   assert.equal(ts.split(from).length,2,'one terrain washboard axis anchor: '+name);
   await assert.rejects(()=>contracts({[tFile]:ts.replace(from,to)}),error,name+' must fail');
   console.log('KILLED '+name);
  }
 }
 for(const [name,from,to,error] of[
  ['solver skips a visit when only one corner moved','changed[n1]<last&&changed[n2]<last','changed[n1]<last',/bit for bit/],
  ['solver lattice memo ignores the point',"if(state===0||memoX[slot]!==x||memoZ[slot]!==z||","if(state===0||",/bit for bit/],
  ['isSpan box 2 cm too small','const e=reach+g[k+9];','const e=reach-.02;',/isSpan box keeps the plain answer/],
  ['length test without its rounding band','STEP_LO=STEP*STEP*(1-1e-9),STEP_HI=STEP*STEP*(1+1e-9)','STEP_LO=STEP*STEP,STEP_HI=STEP*STEP',/longer|Longer/],
 ]){
  assert.equal(s.split(from).length,2,'one mutation anchor: '+name);
  await assert.rejects(()=>shortcuts({[file]:s.replace(from,to)}),error,name+' must fail');
  console.log('KILLED '+name);
 }
 for(const [name,from,to,error] of[
  ['solver stops after a lifting pass that moved nothing','if(!moved&&!lifted)break;','if(!moved&&!(lifted&&flags.some(f=>(f&1)!==0)))break;',/a pass that lifted runs once more/],
 ]){
  assert.equal(s.split(from).length,2,'one mutation anchor: '+name);
  await assert.rejects(()=>liftedPass({[file]:s.replace(from,to)}),error,name+' must fail');
  console.log('KILLED '+name);
 }
}
