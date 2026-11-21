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
 const middle=roads.deckHeight(0,-20);
 assert.ok(middle>9.9,`joined span must use external abutments, not channel: ${middle}`);
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
 v.y=40;v.vy=12;v.update(1/120,{throttle:0,steer:0,handbrake:false});
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
 return{middle,maxRise,draws:roads.group.children.length,atInputs,eager:eager.length,farInBox:box.length-near.length};
}
// The grade solver's shortcuts (a repeat visit skipped, the shared lattice memo, squared length tests, the isSpan
// box) give the same bits as the plain solver: the same source with each shortcut taken out. Real Point Tupper
// spans: -100084 runs all 600 passes on every build, 240 retries its approaches. Then the length tests alone, on
// seeded lengths within a few ulps of their limits, against plain Math.hypot.
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
  const f=await fixture('pointtupper',1,{...replacements,[file]:source}),m=f.roads.modern,spans=[-100084,240].map(id=>m.spans.find(r=>r.road.id===id));
  assert.ok(spans.every(Boolean),'Point Tupper spans -100084 and 240 exist');
  await f.preload(f.terrain,spans.flatMap(r=>r.pts.map(p=>[p[0],p[1]])),120,8);for(const r of spans)m.ensure(r);worlds.push({m,spans});
 }
 const bits=r=>Buffer.concat([r.triangles,r.triangleDeck,...['position','normal','color'].map(n=>r.geometry.getAttribute(n).array),new Float64Array([r.startLength,r.endLength,r.y0,r.y1])].map(a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength)));
 worlds[0].spans.forEach((r,i)=>assert.ok(bits(r).equals(bits(worlds[1].spans[i])),`solver shortcuts keep span ${r.road.id} bit for bit`));
 let seed=1306;const rnd=()=>(seed=seed*16807%2147483647)/2147483647;let points=0;
 for(const r of worlds[0].spans){const reach=r.width+.0001;
  for(let j=1;j<r.pts.length;j++){const a=r.pts[j-1],b=r.pts[j],dx=b[0]-a[0],dz=b[1]-a[1],n=Math.hypot(dx,dz)||1;
   for(let k=0;k<300;k++){const t=-.05+1.1*rnd(),off=reach*(1+(rnd()-.5)*(k%2?1e-6:.4))*(rnd()<.5?-1:1),x=a[0]+dx*t-dz/n*off,z=a[1]+dz*t+dx/n*off;points++;
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
console.log('PASS',await contracts());
console.log('PASS solver shortcuts',await shortcuts());
if(process.argv.includes('--mutations')){
 const file='web/src/modern-bridges.ts',s=readFileSync(root+file,'utf8'),anchor="if(along>=0&&along<=r.length){const t=along/r.length,smooth=r.road.kind<=3&&r.length>=20&&Math.abs(r.y1-r.y0)/r.length<.06;return r.y0+(r.y1-r.y0)*(smooth?t*t*(3-2*t):t);}";
 assert.equal(s.split(anchor).length,2,'one deck plane mutation');
 await assert.rejects(()=>contracts({[file]:s.replace(anchor,'if(along>=0&&along<=r.length)return this.land(x,z)??0;')}),/external abutments/,'terrain-draped deck must fail production support assertion');
 console.log('KILLED deck height taken from channel terrain');
 for(const [name,from,to,error] of[
  ['at() segment tie rule','if(s>cum[mid+1])lo=mid+1','if(s>=cum[mid+1])lo=mid+1',/at\(\) segment rule/],
  ['far spans in the box build eagerly','&&nearLine(r.pts,cam.x,cam.z,DRAW))this.ensure(r);',')this.ensure(r);',/deck line is within 1500 m/],
 ]){
  assert.equal(s.split(from).length,2,'one mutation anchor: '+name);
  await assert.rejects(()=>contracts({[file]:s.replace(from,to)}),error,name+' must fail');
  console.log('KILLED '+name);
 }
 for(const [name,from,to,error] of[
  ['solver skips a visit when only one corner moved','changed[n1]<last&&changed[n2]<last','changed[n1]<last',/span -100084 bit for bit/],
  ['solver lattice memo ignores the point',"if(state===0||memoX[slot]!==x||memoZ[slot]!==z||","if(state===0||",/span 240 bit for bit/],
  ['length test without its rounding band','STEP_LO=STEP*STEP*(1-1e-9),STEP_HI=STEP*STEP*(1+1e-9)','STEP_LO=STEP*STEP,STEP_HI=STEP*STEP',/longer|Longer/],
 ]){
  assert.equal(s.split(from).length,2,'one mutation anchor: '+name);
  await assert.rejects(()=>shortcuts({[file]:s.replace(from,to)}),error,name+' must fail');
  console.log('KILLED '+name);
 }
}
