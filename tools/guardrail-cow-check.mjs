import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname} from 'node:path';
import {Group,Box3} from '../web/node_modules/three/build/three.module.js';
import {cowBody,cowRailGap,cowRest,COW_REST} from '../web/src/cow-rest.ts';
import {Animals,createRoadCow} from '../web/src/animals.ts';
import {Guardrails} from '../web/src/guardrails.ts';
import {Roads} from '../web/src/roads.ts';
import {RAIL,planRails,roadLength,railPoint,railStation} from '../web/src/guardrail-rules.ts';
import {railLand} from './guardrail-land.mjs';
import {AREAS} from '../web/src/area.ts';
const roadData={id:1,name:'Cow placement fixture',kind:3,halfWidth:3,bridge:false,pts:[[0,0],[100,0]]};
const proof=process.argv.includes('--assert')?process.argv[process.argv.indexOf('--assert')+1]:null;
function planned(g,spans,roadHeight){
 g.terrain.dataRevision=0;
 if(roadHeight)g.terrain.heightAt=roadHeight;
 for(const c of g.chunks){c.revision=0;c.spans=spans.filter(s=>s.road===c.road&&s.a.along>=c.start-1e-6&&s.a.along<c.end-1e-6);}
}
const height=(x,z)=>20-Math.max(0,z-4)*.8;
const terrain={cartRoads:false,seaLevel:0,low:false,exag:1,dataRevision:0,heightAt:height,surfaceAt:(x,z)=>({ground:height(x,z),level:8,canopy:0})};
function network(items,t){return new Roads({roads:items.map(r=>({...r,pts:r.pts.map(([x,z])=>[x,-z])}))},[0,0],t);}
const roads=network([roadData],terrain),road=roads.roads[0];assert.ok(roads.guardrails instanceof Guardrails);
planned(roads.guardrails,planRails(road,height,()=>false,0,100));
const animals=Object.create(Animals.prototype);animals.roads=roads;animals.terrain=terrain;animals.group=new Group();animals.openField=()=>true;
const resident={kind:'cow',spot:{road,x:50,z:0,heading:Math.PI/2},along:50,home:{x:50,z:4.2},place:{x:50,z:4.2},herd:[],side:1};
assert.ok(animals.buildPasture(resident),'real placement hook builds pasture');
let body=cowBody(resident.home.x,resident.home.z,resident.homeHeading,height);
assert.ok(body);assert.ok(roads.guardrails.cowClearance(body)>=.2-1e-6,'production cow home leaves the whole body clear of rails');
if(!proof||proof==='fixture')assert.ok(Math.abs(resident.home.z-(-4.2))<1e-8&&Math.abs(resident.home.x-50)<1e-8,'exact field rest offset -4.2m');
assert.equal(resident.herd.length,4,'herd unchanged');
if(proof==='fixture')process.exit(0);
if(proof==='margin'){
 assert.ok(bodyRoadGap(body,road)>=.5-1e-6,'flat cow body outside halfWidth + 0.5m');process.exit(0);
}
const old=cowBody(50,4.2,Math.PI/2,height);assert.ok(roads.guardrails.cowClearance(old)<0,'fixture detects original overlap');
// A local obstruction must search along the same road, nearest quarter metre first.
const rest=cowRest(road,50,1,()=>20,b=>Math.abs(b.x-50)>=3.25);assert.ok(rest);assert.equal(rest.along,53.25,'nearest along-road fallback');
assert.equal(cowRest(road,50,1,()=>null,()=>true),null,'unknown land defers placement');
function pastureFixture(r,height,surface){
 const t={...terrain,heightAt:height,surfaceAt:surface??((x,z)=>({ground:height(x,z),level:8,canopy:0}))};
 const rs=network([r],t);planned(rs.guardrails,[]);
 const a=Object.create(Animals.prototype);a.roads=rs;a.terrain=t;a.group=new Group();a.openField=()=>true;
 const p=railPoint(rs.roads[0],10),cow={kind:'cow',spot:{road:rs.roads[0],...p},along:10,home:{x:p.x,z:p.z},place:{x:p.x,z:p.z},herd:[],side:1};
 return {a,cow,t,rs};
}
if(!proof||proof==='side'){
 const curved={...road,pts:[[0,0],[10,0],[13,1],[16,4],[16,20],[0,20]]},h=(x,z)=>20-z*.1;
 // The nearby meadow is beyond the old imaginary rail line. A far patch tempts the old whole-road fallback.
 const grazing=(x,z)=>z>=6||x>=11.5&&z<=-3.6||Math.abs(z)<.01||Math.abs(x-10)<.01&&Math.abs(z+11)<.01;
 const f=pastureFixture(curved,h,(x,z)=>({ground:h(x,z),level:8,canopy:grazing(x,z)?0:4}));
 const built=f.a.buildPasture(f.cow),own=((f.cow.home.x-f.cow.spot.x)*Math.cos(f.cow.spot.heading)+(f.cow.home.z-f.cow.spot.z)*Math.sin(f.cow.spot.heading))*f.cow.side;
 assert.ok(built,'curved home really builds');
 assert.ok(own>0,'accepted cow home is on cow.side after a curved fallback');
 assert.notEqual(f.cow.homeHeading,f.cow.spot.heading,'rest uses the curved segment, not the straight approach');
 // Even a stale/faulty placement provider cannot put the cow across its original herd.
 const stale=pastureFixture(road,height);stale.rs.guardrails.cowRest=()=>({x:10,z:5,heading:Math.PI/2,along:10});
 assert.ok(!stale.a.buildPasture(stale.cow),'reject a final home on the opposite herd side');
 if(proof==='side')process.exit(0);
}
if(!proof||proof==='far-side'){
 // Negative control: missing local land must not trigger a distant fallback across the original herd.
 const curved={...road,pts:[[0,0],[20,0],[20,20],[0,20]]},h=(x,z)=>20-z*.1;
 const loaded=(x,z)=>z>=6||Math.abs(x-10)<.01&&[0,-11,11].some(v=>Math.abs(z-v)<.01);
 const f=pastureFixture(curved,(x,z)=>loaded(x,z)?h(x,z):null,(x,z)=>loaded(x,z)?{ground:h(x,z),level:8,canopy:0}:null);
 const built=f.a.buildPasture(f.cow),own=((f.cow.home.x-f.cow.spot.x)*Math.cos(f.cow.spot.heading)+(f.cow.home.z-f.cow.spot.z)*Math.sin(f.cow.spot.heading))*f.cow.side;
 assert.ok(!built||own>0,'accepted cow home is on cow.side after a distant fallback');
 assert.ok(!built,'missing local land defers the cow instead of relocating it');
 if(proof==='far-side')process.exit(0);
}
if(!proof||proof==='uphill'){
 const h=(x,z)=>20-z*.12-1.5*Math.exp(-(((-z-5)/3)**2)),f=pastureFixture(road,h);
 assert.ok(f.a.buildPasture(f.cow),'grazable uphill home exists beyond local ditch');
 assert.ok(h(f.cow.home.x,f.cow.home.z)>=h(f.cow.spot.x,f.cow.spot.z),'cow home is uphill, not in the roadside ditch');
 assert.ok(h(f.cow.home.x,f.cow.home.z+f.cow.side)>=h(f.cow.home.x,f.cow.home.z-f.cow.side),'uphill probe at the final home');
 if(proof==='uphill')process.exit(0);
}
if(!proof||proof==='centre'){
 const canopy=pastureFixture(road,()=>20,(x,z)=>({ground:20,level:8,canopy:Math.abs(z)<=3.2?4:0}));
 assert.ok(canopy.a.buildPasture(canopy.cow),'road under canopy does not block a grazing home');
 const h=(x,z)=>.25+Math.max(0,-z-3)*.2,coast=pastureFixture(road,h);
 assert.ok(coast.a.buildPasture(coast.cow),'road within 0.5m of sea level does not block higher grazing land');
 if(proof==='centre')process.exit(0);
}
if(!proof||proof==='other-roads'){
 for(const kind of [4,5,8,9,10,11,12]){
  const crossing={...road,id:100+kind,kind,halfWidth:.6,pts:[[50,-15],[50,15]]},rs=network([road,crossing],terrain),g=rs.guardrails;planned(g,[]);
  const home=g.cowRest(rs.roads[0],50,-1,()=>20);
  assert.ok(home,`kind ${kind}: a nearby field home remains available`);
  assert.ok(bodyRoadGap(home,rs.roads[1])>=.5-1e-6,`whole cow clears kind ${kind} crossing road by 0.5m`);
 }
 // Wide road across a 64m cell boundary; include widths, visit each segment once, and omit the own road.
 const rs=network([road,{...road,id:99,kind:12,halfWidth:65,pts:[[0,70],[130,70]]}],terrain),seen=[];
 rs.forEachNearbySegment(63,4.2,3,(r,i)=>seen.push([r.id,i]),rs.roads[0]);
 assert.deepEqual(seen,[[99,0]],'all-kind segment cells include wide adjacent roads once and exclude the own road');
 const g=rs.guardrails,visited=[],query=rs.forEachNearbySegment.bind(rs);
 rs.forEachNearbySegment=(x,z,reach,visit,exclude)=>query(x,z,reach,(r,i)=>{visited.push(r.id);visit(r,i);},exclude);
 g.cowRoadClearance(cowBody(50,4.2,Math.PI/2,()=>20),rs.roads[0]);
 assert.ok(visited.includes(99),'cross-road cost test really visits the wide neighbour');
 assert.ok(!visited.includes(rs.roads[0].id),'own road is not measured again in the cross-road query');
 if(proof==='other-roads')process.exit(0);
}
if(!proof||proof==='gate'){
 const f=pastureFixture(road,()=>20),g=f.rs.guardrails;
 for(const c of g.chunks)c.revision=-1;
 assert.equal(g.cowRest(f.rs.roads[0],50,-1,()=>20),null,'unplanned local rail chunks wait');
 planned(g,[]);
 assert.ok(g.cowRest(f.rs.roads[0],50,-1,()=>20),'wait gate retries after planning without a terrain revision');
 if(proof==='gate')process.exit(0);
}
if(!proof||proof==='cache'){
 const f=pastureFixture(road,()=>20),g=f.rs.guardrails;let reads=0;
 const missing=(x,z)=>{reads++;return Math.abs(z)<.01?20:null;};
 assert.equal(g.cowRest(f.rs.roads[0],50,-1,missing),null);const first=reads;assert.ok(first>1,'completed failed search measured candidates');
 assert.equal(g.cowRest(f.rs.roads[0],50,-1,missing),null);assert.equal(reads,first,'failed search is cached for the terrain revision');
 g.terrain.dataRevision=1;for(const c of g.chunks)c.revision=1;
 assert.equal(g.cowRest(f.rs.roads[0],50,-1,missing),null);assert.ok(reads>first,'new terrain revision retries the search');
 g.setObstacles([]);for(const c of g.chunks)c.revision=1;
 assert.ok(g.cowRest(f.rs.roads[0],50,-1,()=>20),'obstacle replanning also invalidates failed searches');
 if(proof==='cache')process.exit(0);
}
// Enclose the real cow through the permitted ground tilt, head tracking and hoof adjustment range.
const rig=createRoadCow();assert.equal(rig.shoulder,COW_REST.shoulder,'support probes match actual cow rig');const legY=rig.legs.map(l=>l.position.y);
if(!proof)for(const pitch of [-.55,0,.55])for(const roll of [-.55,0,.55])for(const leg of [-.4,0,.4])for(let yaw=-1.2;yaw<=1.201;yaw+=.15){
 rig.root.rotation.set(pitch,0,roll,'YXZ');rig.head.rotation.y=yaw;rig.legs.forEach((l,i)=>l.position.y=legY[i]+leg);rig.root.updateMatrixWorld(true);
 const b=new Box3().setFromObject(rig.root,true),vertical=COW_REST.height*Math.cos(roll)+COW_REST.width*Math.abs(Math.sin(roll));
 const w=COW_REST.width*Math.cos(roll)+COW_REST.height*Math.abs(Math.sin(roll))+COW_REST.padding,l=COW_REST.length*Math.cos(pitch)+vertical*Math.abs(Math.sin(pitch))+COW_REST.padding;
 assert.ok(Math.max(Math.abs(b.min.x),Math.abs(b.max.x))<=w,'envelope contains tilted/tracking whole cow width');assert.ok(Math.max(Math.abs(b.min.z),Math.abs(b.max.z))<=l,'envelope contains whole cow length');
}
console.log('PASS production home, old-home control, nearest fallback and real cow envelope');
const report=[];
// Six-area baseline on current baked land (2,085 omissions; Mabou rose from 14 Nov's 577 to 608 after the Nov Mabou road/rail updates; the other five areas are unchanged). Allow five per area, fifteen total.
const omissionBaseline={mabou:608,judique:311,porthood:45,pointtupper:33,westbay:607,cansocauseway:481};
// Independent polygon/segment oracle, measured against the actual road polyline.
function bodyRoadGap(body,road){
 const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([w,l])=>({x:body.x+w*body.halfWidth*Math.cos(body.heading)+l*body.halfLength*Math.sin(body.heading),z:body.z+w*body.halfWidth*Math.sin(body.heading)-l*body.halfLength*Math.cos(body.heading)}));
 const distance=(p,a,b)=>{const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);};
 const orient=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
 const inside=p=>Math.abs((p.x-body.x)*Math.cos(body.heading)+(p.z-body.z)*Math.sin(body.heading))<=body.halfWidth&&Math.abs((p.x-body.x)*Math.sin(body.heading)-(p.z-body.z)*Math.cos(body.heading))<=body.halfLength;
 let min=Infinity;
 for(let i=1;i<road.pts.length;i++){
  const a={x:road.pts[i-1][0],z:road.pts[i-1][1]},b={x:road.pts[i][0],z:road.pts[i][1]};
  if(inside(a)||inside(b))return -road.halfWidth;
  for(let k=0;k<4;k++){
   const c=corners[k],d=corners[(k+1)%4];
   const box=Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))<=Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))&&Math.max(Math.min(a.z,b.z),Math.min(c.z,d.z))<=Math.min(Math.max(a.z,b.z),Math.max(c.z,d.z));
   if(box&&orient(a,b,c)*orient(a,b,d)<=0&&orient(c,d,a)*orient(c,d,b)<=0)return -road.halfWidth;
   min=Math.min(min,distance(c,a,b),distance(a,c,d),distance(b,c,d));
  }
 }
 return min-road.halfWidth;
}
// Independent SAT oracle: any part of the tilted cow envelope in the strip counts.
// Use the actual planned span, not a nominal rail on every road/side.
function inRoadRailStrip(body,span){
 const corners=[];
 for(const [w,l] of [[-1,-1],[1,-1],[1,1],[-1,1]])corners.push({
  x:body.x+w*body.halfWidth*Math.cos(body.heading)+l*body.halfLength*Math.sin(body.heading),
  z:body.z+w*body.halfWidth*Math.sin(body.heading)-l*body.halfLength*Math.cos(body.heading)});
 const edgeA=railPoint(span.road,span.a.along,span.side*span.road.halfWidth),edgeB=railPoint(span.road,span.b.along,span.side*span.road.halfWidth);
 const strip=[edgeA,edgeB,span.b,span.a];
 for(const poly of [corners,strip])for(let i=0;i<poly.length;i++){
  const a=poly[i],b=poly[(i+1)%poly.length],nx=b.z-a.z,nz=a.x-b.x;
  const project=p=>p.x*nx+p.z*nz,one=corners.map(project),two=strip.map(project);
  if(Math.max(...one)<Math.min(...two)-1e-7||Math.max(...two)<Math.min(...one)-1e-7)return false;
 }
 return true;
}
const fixtureSpan={road,side:1,a:railPoint(road,45,4.2),b:railPoint(road,55,4.2)};
assert.ok(inRoadRailStrip(cowBody(50,3.1,Math.PI/2,()=>20),fixtureSpan),'strip oracle catches a body straddling the road edge');
assert.ok(!inRoadRailStrip(cowBody(50,-3.1,Math.PI/2,()=>20),fixtureSpan),'opposite side is clear');
assert.ok(!inRoadRailStrip(cowBody(50,6,Math.PI/2,()=>20),fixtureSpan),'beyond the rail is clear');
for(const area of AREAS){
 const land=railLand(area.base),spans=[];
 for(const r of land.roads.roads)for(let start=0;start<roadLength(r);start+=RAIL.chunk)spans.push(...planRails(r,land.ground,land.access,start,Math.min(start+RAIL.chunk,roadLength(r)),land.context));
 const g=land.roads.guardrails;let minimum=Infinity,placed=0;
 const plainGround=(x,z)=>{const h=land.ground(x,z);return h===null?null:h*1.5;};
 planned(g,spans,plainGround);let omitted=0,minimumRoad=Infinity;
 const ground=(x,z)=>{const s=land.sample(x,z);return s&&s.height>.5&&s.canopy<1.5?s.height*1.5:null;};
 // Animals are enabled only in the areas that actually select pasture residents.
 if(area.animals){
  const spot=land.roads.nearest(619093-land.village[0],land.village[1]-5109326,250,r=>r.name==='Mabou Mines Road');
  assert.ok(spot,`${area.id}: mapped pasture cow`);
  const terrain={cartRoads:false,seaLevel:0,low:false,heightAt:plainGround,surfaceAt:(x,z)=>{
   const s=land.sample(x,z);if(!s)return null;const hit=land.roads.nearest(x,z,100);
   return {ground:s.height*1.5,level:s.level,canopy:s.canopy,roadDist:hit?.dist??Infinity,halfWidth:hit?.road.halfWidth??0};
  }};
  const pasture=Object.create(Animals.prototype);pasture.roads=land.roads;pasture.terrain=terrain;pasture.group=new Group();
  const cow={kind:'cow',spot,along:railStation(spot.road,spot.seg,spot.t),home:{x:spot.x,z:spot.z},place:{x:spot.x,z:spot.z},herd:[],side:1};
  assert.ok(pasture.buildPasture(cow),`${area.id}: production pasture builds on real land`);
  const body=cowBody(cow.home.x,cow.home.z,cow.homeHeading,ground);assert.ok(body);
  assert.ok(((cow.home.x-spot.x)*Math.cos(spot.heading)+(cow.home.z-spot.z)*Math.sin(spot.heading))*cow.side>0,'pasture cow own home on cow.side');
  const centre=railPoint(spot.road,cow.along),h=ground(cow.home.x,cow.home.z);
  if(!proof||proof==='uphill')assert.ok(h>=plainGround(centre.x,centre.z),'pasture cow home is uphill of the road');
  assert.ok(bodyRoadGap(body,spot.road)>=.5-1e-6,'whole pasture cow body outside halfWidth + 0.5m');
  for(const span of spans){
   assert.ok(cowRailGap(body,span.a,span.b)>=COW_REST.clearance-1e-6,`${area.id}: pasture cow rail clearance`);
   assert.ok(!inRoadRailStrip(body,span),`${area.id}: pasture cow body in road-to-rail strip at road ${span.road.id}/${span.a.along}`);
  }
  assert.equal(cow.herd.length,4,'four-cattle herd retained');
  assert.ok(cow.herd.every(g=>((g.home.x-spot.x)*Math.cos(spot.heading)+(g.home.z-spot.z)*Math.sin(spot.heading))*cow.side>0),'resting cow and four grazers share the field side');
  console.log('PASS production pasture outside every real road-to-rail strip',JSON.stringify({area:area.id,home:cow.home,side:cow.side,herd:cow.herd.length,spans:spans.length}));
 }
 // Every real-plan sample: select its uphill field side; omit land that cannot be grazed.
 for(const s of spans){
  const along=(s.a.along+s.b.along)/2,p=railPoint(s.road,along),l=railPoint(s.road,along,-s.road.halfWidth-8),r=railPoint(s.road,along,s.road.halfWidth+8),lh=land.ground(l.x,l.z),rh=land.ground(r.x,r.z);
  if(lh===null||rh===null){omitted++;continue;}
  const side=lh<rh?1:-1,home=g.cowRest(s.road,along,side,ground);
  if(!home){omitted++;continue;}
  assert.ok(((home.x-p.x)*Math.cos(p.heading)+(home.z-p.z)*Math.sin(p.heading))*side>0,`${area.id}: sample home on its herd side`);
  assert.ok(ground(home.x,home.z)>=plainGround(railPoint(s.road,home.along).x,railPoint(s.road,home.along).z),`${area.id}: sample home uphill`);
  const roadGap=bodyRoadGap(home,s.road);assert.ok(roadGap>=.5-1e-6,`${area.id}: whole sample cow body outside halfWidth + 0.5m, gap ${roadGap}`);minimumRoad=Math.min(minimumRoad,roadGap);
  const neighbours=new Set();land.roads.forEachNearbySegment(home.x,home.z,Math.hypot(home.halfWidth,home.halfLength)+.5,r=>neighbours.add(r),s.road);
  for(const r of neighbours)assert.ok(bodyRoadGap(home,r)>=.5-1e-6,`${area.id}: whole sample cow body clears other kind ${r.kind} road`);
  let gap=Infinity;
  for(const t of spans){if(Math.abs(t.a.x-home.x)>10&&Math.abs(t.b.x-home.x)>10)continue;gap=Math.min(gap,cowRailGap(home,t.a,t.b));}
  assert.ok(gap>=.2-1e-6,`${area.id}: body intersects span at ${s.road.id}/${along}, gap ${gap}`);minimum=Math.min(minimum,gap);placed++;
  for(const t of spans)assert.ok(!inRoadRailStrip(home,t),`${area.id}: sample body outside road-to-rail strips`);
 }
 assert.ok(placed>0,`${area.id}: non-vacuous grazing homes`);
 const omittedLimit=omissionBaseline[area.id]+5;
 assert.ok(omitted<=omittedLimit,`${area.id}: omitted homes ${omitted} exceed frozen baseline + 5 (${omittedLimit})`);
 report.push({area:area.id,sites:placed,omitted,omittedLimit,minimumBodyToRail:minimum,minimumBodyToRoad:minimumRoad});console.log('PASS cow clearance',JSON.stringify(report.at(-1)));
}
assert.ok(report.reduce((n,r)=>n+r.omitted,0)<=2085+15,'total omitted homes exceed frozen baseline + 15');
const out=process.env.COW_RAIL_REPORT??'data/work/threads/guardrails-r2/cow-clearance.json';mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2));
if(process.argv.includes('--mutations')){const r=spawnSync(process.execPath,['tools/guardrail-fix-mutations.mjs','--r2'],{stdio:'inherit'});assert.equal(r.status,0);}
