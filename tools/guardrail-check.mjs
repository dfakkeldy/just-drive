import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {planRails,railRuns,RAIL} from '../web/src/guardrail-rules.ts';
import {Guardrails} from '../web/src/guardrails.ts';
import {Roads} from '../web/src/roads.ts';
import {surveyedRailDamage,damageShape,DENT} from '../web/src/guardrail-damage.ts';
import {LOOK,RAIL_POST,RAIL_BLOCK} from '../web/src/guardrail-look.ts';
import {readFileSync} from 'node:fs';
import {CAR_SPEC} from '../web/src/vehicle-spec.ts';
const settle=(g,c)=>{for(let i=0;i<2000;i++){g.update(c);if(!g.audit.pending)return;}assert.fail('rail queue did not drain');};
const road={id:1,name:'Synthetic cliff',kind:3,halfWidth:3,bridge:false,pts:[[0,0],[100,0]]};
const cliff=(x,z)=>20-Math.max(0,z-4)*.8;
const spans=planRails(road,cliff,()=>false);
assert.ok(spans.length*RAIL.pitch>95,'cliff gets nearly its full outer rail');assert.ok(spans.every(s=>s.side===1),'uphill side has no rail');
assert.equal(planRails(road,()=>20,()=>false).length,0,'flat ground');
assert.equal(planRails({...road,bridge:true},cliff,()=>false).length,0,'bridge');
assert.equal(planRails({...road,kind:4},cliff,()=>false).length,0,'track is an access, not a rail road');
assert.equal(planRails(road,()=>null,()=>false).length,0,'unknown land is not a cliff');
const driveway=planRails(road,cliff,(_,p)=>p.x>=44&&p.x<=56);
assert.ok(driveway.length>20);assert.ok(driveway.every(s=>s.b.x<44||s.a.x>56),'driveway hard gap stays open');
assert.deepEqual(railRuns([true,true,true,false,false,true,true,true,true]),[[0,8]],'join four metre shallow gap');
assert.deepEqual(railRuns([true,true,true,true,true,true,true,true,true,null,true,true,true,true,true,true,true,true,true]),[[0,8],[10,18]],'never join a hard gap');
assert.deepEqual(railRuns([true,true,true,true,true,true]),[],'drop ten metre run');
assert.deepEqual(railRuns([true,true,true,false,false,false,false,false,false,false,true,true,true]),[],'long gap is too long');
const whole=planRails({...road,pts:[[0,0],[400,0]]},cliff,()=>false);
const pieces=[0,RAIL.chunk,RAIL.chunk*2,RAIL.chunk*3].flatMap(start=>planRails({...road,pts:[[0,0],[400,0]]},cliff,()=>false,start,Math.min(start+RAIL.chunk,400)));
assert.deepEqual(pieces.map(s=>s.a.along),whole.map(s=>s.a.along),'chunk halo agrees with complete pass');
// Production adapter: no own fetch, one merged mesh/chunk, loaded ground gate and LOW visibility.
const terrain={dataRevision:1,cartRoads:false,low:false,exag:2,seaLevel:0,surfaceAt:(x,z)=>({ground:cliff(x,z)*2,level:8}),heightAt:(x,z)=>cliff(x,z)*2};
const rails=new Guardrails({roads:[road],nearest:()=>null},terrain),cam=new THREE.Vector3(40,50,0);settle(rails,cam);
assert.equal(rails.group.children.length,1,'merged draw');const mesh=rails.group.children[0];assert.ok(mesh.geometry.attributes.position.count>100,'real W beam geometry');
// Timber is marked in the rail attribute (z: 1 post, 2 blockout); a post's corners are stored together.
const timbers=(geometry,kind)=>{const p=geometry.attributes.position,part=geometry.attributes.rail,out=[];let points=[];
 const flush=()=>{if(points.length)out.push(points);points=[];};
 for(let i=0;i<p.count;i++){if(part.getZ(i)===kind)points.push([p.getX(i),p.getY(i),p.getZ(i)]);else flush();}flush();return out;};
const posts=timbers(mesh.geometry,RAIL_POST).map(points=>{const xs=points.map(p=>p[0]),zs=points.map(p=>p[2]);assert.ok(Math.abs(Math.max(...xs)-Math.min(...xs)-.18)<1e-4,'square post x');assert.ok(Math.abs(Math.max(...zs)-Math.min(...zs)-.18)<1e-4,'square post z');return (Math.max(...xs)+Math.min(...xs))/2;});
assert.ok(posts.length>20);for(let i=1;i<posts.length;i++)assert.ok(Math.abs(posts[i]-posts[i-1]-3.8)<1e-4,'actual post spacing is 3.8 m, never 1.9');
const car={x:50,z:0,heading:Math.PI/2,vx:0,vz:12,speed:12,spec:CAR_SPEC};
for(let n=0;n<120;n++){car.z+=car.vz/120;rails.block(car);}
assert.ok(car.z<RAIL.shoulder+road.halfWidth,'cannot drive through');assert.ok(Math.abs(car.vz)<1e-12,'barrier removes impact velocity');
cam.z=400;terrain.low=true;settle(rails,cam);assert.equal(mesh.visible,false,'LOW culls beyond 180 m');
car.z=3.5;car.vz=12;rails.block(car);assert.ok(Math.abs(car.vz)<1e-12,'LOW invisible distance does not disable collision');
cam.z=0;settle(rails,cam);const originalMesh=rails.group.children[0];terrain.dataRevision++;settle(rails,cam);assert.equal(rails.group.children[0],originalMesh,'unchanged placement reuses buffers');
const shallow={...terrain,exag:20,surfaceAt:(x,z)=>({ground:z>300?-4:(20-Math.min(1.5,Math.max(0,z-4)*.3))*20,level:8})};
const noExaggerationRails=new Guardrails({roads:[road],nearest:()=>null},shallow);settle(noExaggerationRails,new THREE.Vector3(40,0,0));assert.equal(noExaggerationRails.group.children.length,0,'Hill height must not create a cliff');
const ramp={...terrain,surfaceAt:(x,z)=>({ground:Math.abs(x-50)<8?40:cliff(x,z)*2,level:8}),heightAt:(x,z)=>Math.abs(x-50)<8?40:cliff(x,z)*2};
const actual=new Roads({roads:[road,{...road,id:2,kind:4,name:null,pts:[[50,0],[50,-20]]},{...road,id:3,bridge:true,pts:[[80,0],[100,0]]}]},[0,0],ramp);settle(actual.guardrails,new THREE.Vector3(40,0,0));
const actualSpans=actual.guardrails.chunks.flatMap(c=>c.spans);assert.ok(actualSpans.length>0);assert.ok(actualSpans.every(s=>s.b.x<44||s.a.x>56),'mapped driveway opens actual production rail');assert.ok(actualSpans.every(s=>s.b.x<=74),'bridge approach stops rails');
const lowCliff=(x,z)=>1-Math.min(17,Math.max(0,z-4)*.8);
const coastal={...terrain,surfaceAt:(x,z)=>{const h=lowCliff(x,z);return {ground:h>0?h*2:h,level:8};},heightAt:(x,z)=>{const h=lowCliff(x,z);return h>0?h*2:h;}};
const coastRail=new Guardrails({roads:[road],nearest:()=>null},coastal);settle(coastRail,new THREE.Vector3(40,0,0));assert.equal(coastRail.group.children.length,1,'underwater survey heights are not exaggerated');
console.log('PASS cliff, flat, bridge, driveway, unknown ground, join/drop, chunk seams, surveyed height, merged draw, LOW and collision');

// ---- The look. A graded road with centimetre survey noise at its edge, a rough bank where the posts stand, then the cliff.
const grade=x=>20+x*.03,noise=x=>.04*Math.sin(x*1.9);
const rough=(x,z)=>z<=3.05?grade(x)+(z>=-3.05?noise(x):0):z<6?grade(x)-.34-.3*Math.sin(x*1.7):grade(x)-(z-4)*.8;
const land={dataRevision:1,cartRoads:false,low:false,exag:2,seaLevel:0,surfaceAt:(x,z)=>({ground:rough(x,z)*2,level:8}),heightAt:(x,z)=>rough(x,z)*2};
const build=(ground,roads={roads:[road],nearest:()=>null})=>{const g=new Guardrails(roads,ground);settle(g,new THREE.Vector3(40,50,0));assert.equal(g.group.children.length,1);return g;};
const look=build(land),geometry=look.group.children[0].geometry;
const beam=(geo,keep=()=>true)=>{const p=geo.attributes.position,n=geo.attributes.normal,r=geo.attributes.rail,out=[];
 for(let i=0;i<p.count;i++)if(r.getZ(i)<.97){const v={x:p.getX(i),y:p.getY(i),z:p.getZ(i),nx:n.getX(i),nz:n.getZ(i),v:r.getY(i),crush:r.getZ(i)};if(keep(v))out.push(v);}return out;};
const unique=points=>[...new Map(points.map(p=>[p.x.toFixed(3),p])).values()].sort((a,b)=>a.x-b.x);
// Away from the turned-down ends, and from the ends of the fixture road where the height filter has one side only.
const inner=p=>p.x>16&&p.x<84,topEdge=unique(beam(geometry,p=>Math.abs(p.v-.156)<1e-6&&inner(p)));
assert.ok(topEdge.length>30);assert.ok(LOOK.top>=.68&&LOOK.top<=.74,'the top of the beam is about 0.7 m up');
for(const p of topEdge)assert.ok(Math.abs(p.y-grade(p.x)*2-LOOK.top)<.02,`beam top keeps its height above the road edge (${(p.y-grade(p.x)*2).toFixed(3)} m at x=${p.x.toFixed(1)})`);
let wave=0,bank=0;const second=(a,b,c)=>Math.abs(b-(a+c)/2);
for(let i=1;i<topEdge.length-1;i++){wave=Math.max(wave,second(topEdge[i-1].y,topEdge[i].y,topEdge[i+1].y));bank=Math.max(bank,second(...[-1,0,1].map(k=>land.heightAt(topEdge[i+k].x,4.2))));}
assert.ok(bank>.5,'the fixture bank really is rough where the posts stand');assert.ok(wave<.01,`the beam does not wave with the ground at each post (${wave.toFixed(4)} m)`);
// The W: two crowns toward the traffic, on whichever side of the road the rail stands.
const crowns=(geo,line,toRoad)=>{const x=unique(beam(geo,p=>Math.abs(p.v-.156)<1e-6&&inner(p)))[12].x,section=beam(geo,p=>Math.abs(p.x-x)<1e-6);
 const at=v=>{const p=section.find(p=>Math.abs(p.v-v)<1e-6);assert.ok(p,'full section');return {out:(line-p.z)*toRoad,face:p.nz*toRoad};};
 assert.ok(at(.108).out>.06&&at(-.108).out>.06&&at(.066).out>.06&&at(.03).out<.02&&at(-.03).out<.02&&Math.abs(at(.156).out)<.005,'two crowns stand toward the road; the valley and both edges lie back');
 assert.ok(at(.066).face<-.5&&at(-.066).face<-.5,'the crowns face the road');};
crowns(geometry,4.2,1);
const mirrored=build({...land,surfaceAt:(x,z)=>land.surfaceAt(x,-z),heightAt:(x,z)=>land.heightAt(x,-z)});
assert.ok(mirrored.chunks.flatMap(c=>c.spans).every(s=>s.side===-1));crowns(mirrored.group.children[0].geometry,-4.2,-1);
const winding=geo=>{const p=geo.attributes.position,n=geo.attributes.normal,ix=geo.index;let bad=0;
 for(let t=0;t<ix.count;t+=3){const [a,b,c]=[ix.getX(t),ix.getX(t+1),ix.getX(t+2)],e=[p.getX(b)-p.getX(a),p.getY(b)-p.getY(a),p.getZ(b)-p.getZ(a)],f=[p.getX(c)-p.getX(a),p.getY(c)-p.getY(a),p.getZ(c)-p.getZ(a)];
  const g=[e[1]*f[2]-e[2]*f[1],e[2]*f[0]-e[0]*f[2],e[0]*f[1]-e[1]*f[0]];
  if(g[0]*(n.getX(a)+n.getX(b)+n.getX(c))+g[1]*(n.getY(a)+n.getY(b)+n.getY(c))+g[2]*(n.getZ(a)+n.getZ(b)+n.getZ(c))<=0)bad++;}return bad;};
assert.equal(winding(geometry),0,'every face winds the way its normals point');assert.equal(winding(mirrored.group.children[0].geometry),0,'and on the other side of the road');
// Timber: posts stand in the ground and end just above the beam; blockouts sit between post and beam.
const timberPosts=timbers(geometry,RAIL_POST).map(points=>({x:(Math.max(...points.map(p=>p[0]))+Math.min(...points.map(p=>p[0])))/2,z:(Math.max(...points.map(p=>p[2]))+Math.min(...points.map(p=>p[2])))/2,top:Math.max(...points.map(p=>p[1])),foot:Math.min(...points.map(p=>p[1]))})).filter(inner);
assert.ok(timberPosts.length>12);
for(const p of timberPosts)assert.ok(p.foot<=land.heightAt(p.x,p.z)-.07,'notch leg reaches soil instead of floating');
assert.equal(beam(geometry,p=>Math.abs(p.nx)>.99).length,8,'two run ends have a simple closing plate');
for(const p of timberPosts){assert.ok(Math.abs(p.top-grade(p.x)*2-LOOK.top-LOOK.postProud)<.02,'post top follows the beam');assert.ok(p.foot<land.heightAt(p.x,p.z)-.07,'post meets soil even over a notch');assert.ok(p.z>4.2,'post stands behind the beam');}
const blocks=timbers(geometry,RAIL_BLOCK);assert.equal(blocks.length,timbers(geometry,RAIL_POST).length,'one blockout a post');
// Cost. The rail it replaces drew 50 triangles for every 3.8 m post bay, in LOW too.
const metres=look.chunks.flatMap(c=>c.spans).length*RAIL.pitch,full=geometry.index.count/3;
const cheap=build({...land,low:true}).group.children[0].geometry,lowCount=cheap.index.count/3;
assert.ok(full/metres<=50/3.8,`full detail costs no more triangles than before (${(full/metres).toFixed(2)} a metre)`);
assert.ok(lowCount/metres<=7.2,`LOW stays cheap (${(lowCount/metres).toFixed(2)} triangles a metre)`);assert.equal(timbers(cheap,RAIL_BLOCK).length,0,'LOW has no blockouts');
for(const points of timbers(cheap,RAIL_POST)){const xs=points.map(p=>p[0]);assert.ok(Math.abs(Math.max(...xs)-Math.min(...xs)-.18)<1e-4,'LOW keeps square posts');}
assert.ok(unique(beam(cheap,p=>Math.abs(p.v-.156)<1e-6&&inner(p))).every(p=>Math.abs(p.y-grade(p.x)*2-LOOK.top)<.02),'LOW keeps the same height');
console.log(`PASS look: beam top ${LOOK.top} m above the road edge within 2 cm over a bank that kinks ${bank.toFixed(2)} m, W toward the road on both sides, timber, ${(full/metres).toFixed(2)} and ${(lowCount/metres).toFixed(2)} (LOW) triangles a metre`);

// ---- Damage: one local dent at the surveyed tear point, and nothing else.
const damage={road,start:0,end:36,tear:20},zero={bend:0,sag:0,roll:0,crush:0,lip:0};
const shapes=Array.from({length:361},(_,i)=>({s:i/10,...damageShape(i/10,damage)}));
assert.ok(damageShape(20,damage).bend>.25&&damageShape(20,damage).crush>.5,'the rail is pushed back and crushed at the surveyed tear');
assert.ok(DENT.reach*2<=10,'a dent of a few metres');
for(const p of shapes)if(Math.abs(p.s-20)>=DENT.reach)assert.deepEqual({bend:p.bend,sag:p.sag,roll:p.roll,crush:p.crush,lip:p.lip},zero,'the rest of the surveyed stretch is straight');
for(let i=1;i<shapes.length;i++)assert.ok(shapes[i].s<=20?shapes[i].bend>=shapes[i-1].bend:shapes[i].bend<=shapes[i-1].bend,'one bow, not a wave');
assert.ok(Math.max(...shapes.map(p=>p.sag))<=.15&&Math.min(...shapes.map(p=>p.lip))>=-.08,'the dent hangs and folds a little; it does not snake');
assert.deepEqual(damageShape(50,damage),zero,'other rails remain straight');assert.deepEqual(damageShape(20,null),zero);
const fakeRoads={nearest:()=>({road,seg:0,t:.5})};assert.ok(surveyedRailDamage(fakeRoads,[0,0]));
// The same dent in the production mesh: the three surveyed points land at 30, 66 and 50 m along the fixture road.
const village=[618976,5109275],marks=new Map([['0,0',.30],['12,35',.66],['6,25',.50]]);
const surveyed={roads:[road],nearest:(x,z,_reach,ok)=>{const t=marks.get(`${Math.round(x)},${Math.round(z)}`);return t===undefined||ok&&!ok(road)?null:{road,seg:0,t};}};
const dented=build({...land,manifest:{village}},surveyed),dentGeometry=dented.group.children[0].geometry;
const moved=unique(beam(dentGeometry,p=>Math.abs(p.v-.156)<1e-6)).filter(p=>Math.abs(p.z-4.2)>.01);
assert.ok(moved.length>8,'the dent is cut into several pieces');assert.ok(moved.every(p=>Math.abs(p.x-50)<DENT.reach),'only the metres around the tear point move');
assert.ok(Math.max(...moved.map(p=>p.z-4.2))>.25,'pushed back from the road');assert.ok(moved.every(p=>p.z>4.2),'never toward the road');
const untouched=p=>Math.abs(p.x-50)>DENT.reach+RAIL.pitch,same=(a,b)=>a.length===b.length&&a.every((p,i)=>Math.abs(p.x-b[i].x)<1e-6&&Math.abs(p.y-b[i].y)<1e-6&&Math.abs(p.z-b[i].z)<1e-6);
assert.ok(same(beam(dentGeometry,untouched),beam(geometry,untouched)),'every other metre of the run is the straight rail');
assert.ok(beam(dentGeometry,p=>p.crush>.5).length>0&&beam(geometry,p=>p.crush>0).length===0,'scored zinc only in the dent');
assert.equal(winding(dentGeometry),0);
assert.deepEqual(dented.chunks.flatMap(c=>c.solids),look.chunks.flatMap(c=>c.solids),'damage is art: collision is unchanged');
const animalSource=readFileSync(new URL('../web/src/animals.ts',import.meta.url),'utf8');assert.match(animalSource,/export function createHighlandBull/,'one replaceable bull factory');assert.match(animalSource,/HIGHLAND_BULL_ENABLED = true/,'approved placement enabled');console.log('PASS one local dent at the surveyed tear, straight rails elsewhere, unchanged collision and exported bull factory');

// Real terminal ground contact: rising berm and washed-out bank, on either side.
for(const delta of [.6,-1.8]) for(const drawnOffset of [0,.37]) {
 const bank={...land,heightAt:(x,z)=>z<6?grade(x)*2+delta:rough(x,z)*2};
 bank.meshHeightAt=(x,z)=>bank.heightAt(x,z)+drawnOffset;
 const g=build(bank),geo=g.group.children[0].geometry;
 const run=g.chunks.flatMap(c=>c.spans)[0];
 for(const x of [run.runStart,run.runEnd]) {
  const points=beam(geo,p=>Math.abs(p.x-x)<1e-4),ys=points.map(p=>p.y);
  const middle=(Math.min(...ys)+Math.max(...ys))/2;
  assert.ok(Math.abs(Math.min(...ys)-bank.meshHeightAt(x,4.2)-.02)<.002,'terminal bottom clears real soil by 2cm');
  assert.ok(Math.abs(middle-bank.meshHeightAt(x,4.2)-LOOK.endClear)<.002,'terminal middle meets actual rising or falling soil within 2cm');
 }
}
console.log('PASS grounded terminals on rising/falling banks');

// A steep visible bank disagrees with the encoded height field. Every foot corner
// must enter the drawn soil; a leg-length cap cannot leave timber suspended.
const steep={...land,meshHeightAt:(x,z)=>grade(x)*2-1.9-(z-4.2)*3};
const steepGeo=build(steep).group.children[0].geometry;
let footCorners=0;
for(const points of timbers(steepGeo,RAIL_POST)){
 const foot=Math.min(...points.map(p=>p[1]));
 for(const p of points)if(Math.abs(p[1]-foot)<1e-5){assert.ok(p[1]<steep.meshHeightAt(p[0],p[2])-.07,'post foot enters steep drawn bank');footCorners++;}
}
assert.ok(footCorners>80);console.log('PASS steep-bank post feet meet drawn ground at every corner');

// A finer drawn tile can change only the bank beneath a middle post. Beam/road
// heights and both terminals remain identical; that soil must still invalidate art.
let erosion=0;
const revised={...land,meshHeightAt:(x,z)=>land.heightAt(x,z)-(x>30&&x<60?2+erosion:0)};
const reloaded=build(revised),oldPostMesh=reloaded.group.children[0];
erosion=.75;revised.dataRevision++;settle(reloaded,new THREE.Vector3(40,50,0));
assert.notEqual(reloaded.group.children[0],oldPostMesh,'changed middle-post soil invalidates retained mesh');
for(const points of timbers(reloaded.group.children[0].geometry,RAIL_POST)){
 const foot=Math.min(...points.map(p=>p[1]));
 for(const p of points)if(Math.abs(p[1]-foot)<1e-5)assert.ok(p[1]<revised.meshHeightAt(p[0],p[2])-.07,'rebuilt foot follows changed bank');
}
console.log('PASS changed bank beneath middle posts rebuilds grounded feet');
