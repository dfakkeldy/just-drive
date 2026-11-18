// Runtime planner, shipped data, bridge overlap oracle and a production-source mutant.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {build} from '../web/node_modules/esbuild/lib/main.js';
const root=resolve(import.meta.dirname,'..'), scratch=mkdtempSync(join(tmpdir(),'mmm-culverts-'));
async function load(mutant=false){
 const file=join(scratch,mutant?'mutant.mjs':'check.mjs');
 await build({stdin:{contents:`export {streamCrossings,StreamCulverts} from './web/src/stream-culverts.ts'; export {Streams} from './web/src/streams.ts'; export {ArchCulvert} from './web/src/culvert.ts'; export {Vector3,Box3,Group} from './web/node_modules/three/build/three.module.js'; export {ModernBridges} from './web/src/modern-bridges.ts';`,resolveDir:root},bundle:true,platform:'node',format:'esm',outfile:file,plugins:mutant?[{name:'bridge-mutant',setup(b){b.onLoad({filter:/stream-culverts\.ts$/},({path})=>({contents:readFileSync(path,'utf8').replace('if (!road || road.bridge) continue;','if (!road) continue;').replace('if (bridges.some(', 'if (false && bridges.some('),loader:'ts'}));}}]:[]});
 return import(file);
}
function roadDistance(x,z,road){
 let best=Infinity;for(let k=1;k<road.pts.length;k++){const a=road.pts[k-1],b=road.pts[k],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));best=Math.min(best,Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz));}return best;
}
// Flagged bridge roads and the modern bridge spans (#156), which also cover crossings on unflagged map roads.
function bridgeOracle(c,roads,extra=0,spans=[]){
 for(const r of [...roads.filter(r=>r.bridge),...spans])for(let k=1;k<r.pts.length;k++){
  const [a,b]=[r.pts[k-1],r.pts[k]],dx=b[0]-a[0],dz=b[1]-a[1];
  const t=Math.min(1,Math.max(0,((c.x-a[0])*dx+(c.z-a[1])*dz)/(dx*dx+dz*dz||1)));
  assert.ok(Math.hypot(c.x-a[0]-t*dx,c.z-a[1]-t*dz)>r.halfWidth+3+extra,`culvert under bridge ${r.id}`);
 }
}
try {
 const {streamCrossings,Streams,StreamCulverts,ArchCulvert,Vector3,Box3,Group,ModernBridges}=await load();
 const road={id:1,halfWidth:3,bridge:false,kind:2,name:null,pts:[[-20,0],[20,0]]};
 const data={streams:[{id:1,name:'',half:.5,pts:[[0,-20],[0,0],[0,20]]}],culverts:[{stream:1,road:1,a:[0,-6],b:[0,6],dia:1,mapped:true}]};
 const streams=new Streams(data,[0,0]);
 assert.equal(streamCrossings(streams,[road]).length,1,'endpoint duplicate merged');
 assert.equal(streamCrossings(streams,[{...road,bridge:true}]).length,0,'bridge excluded');
 assert.equal(streamCrossings(streams,[road,{...road,id:2,bridge:true,pts:[[-20,2],[20,2]]}]).length,0,'unflagged overlap also excluded');
 assert.equal(streamCrossings(new Streams({streams:[],culverts:[]},[0,0]),[road]).length,0);
 let h=50;
 const visual=new StreamCulverts(streams,[road],()=>h,false);
 visual.update({x:0,z:0});
 assert.equal(visual.group.children.length,1);
 const model=visual.group.children[0];
 assert.ok(model.position.y+4.35*model.scale.y<h,'crown below land');
 h=47;visual.update({x:0,z:0});assert.ok(model.position.y+4.35*model.scale.y<h,'tracks replaced land');
 h=null;visual.update({x:360,z:0});assert.equal(model.visible,false,'retained arch hides when fine land unloads');h=47;
 const valley=new StreamCulverts(streams,[road],(x,z)=>Math.abs(z)>5?10:14,false); valley.update({x:0,z:0}); assert.ok(valley.group.children[0].position.y<=10,'invert seats at mouth bed, not road centre');
 const dipped=new StreamCulverts(streams,[road],(x,z)=>Math.abs(z)>5?10:10.5,false); dipped.update({x:0,z:0}); const arch=dipped.group.children[0]; assert.ok(arch.position.y+4.35*arch.scale.y<10.5,'low fill keeps crown below road');
 // A brook that drops across the road: both mouths stay open, each invert sits on its own bed, and the run reaches
 // both mouths. A level run seated on the lower bed buried the upstream mouth (up to 5 m at Mabou, survey 729dfaef).
 const bedAt=(x,z)=>Math.abs(z)>3.5?(z>0?10:12.5):16;
 const graded=new StreamCulverts(streams,[road],bedAt,false);graded.update({x:0,z:0});
 const run=graded.group.children[0],units=Math.ceil(graded.crossings[0].length/ArchCulvert.UNIT),ml=units*ArchCulvert.UNIT;run.updateMatrixWorld(true);
 const world=(x,y,z)=>run.localToWorld(new Vector3(x,y,z));
 for(const end of [-1,1]){
  const invert=world(0,0,end*ml/2),clear=world(0,4.1,end*ml/2),bed=bedAt(invert.x,invert.z);
  assert.ok(invert.y<=bed-.04&&invert.y>=bed-.06,`invert at ${end} sits on its own bed (${invert.y} vs ${bed})`);
  assert.ok(clear.y>bed+.1,`mouth ${end} open (${clear.y} vs ${bed})`);
  assert.ok(Math.abs(Math.abs(invert.z)-6)<.02&&Math.abs(invert.x)<.02,'run reaches the real mouth');
 }
 // Thin fill on a sloped bed: the low mouth stays on its bed (the run climbs less), it does not sink with the road.
 const thinAt=(x,z)=>Math.abs(z)>3.5?(z>0?10:11):11.2;
 const thin=new StreamCulverts(streams,[road],thinAt,false);thin.update({x:0,z:0});
 const tr=thin.group.children[0];tr.updateMatrixWorld(true);
 const ends=[-1,1].map(e=>{const p=tr.localToWorld(new Vector3(0,0,e*ml/2));return {inv:p.y,bed:thinAt(p.x,p.z),open:tr.localToWorld(new Vector3(0,4.1,e*ml/2)).y-thinAt(p.x,p.z)};}).sort((p,q)=>p.bed-q.bed);
 assert.ok(Math.abs(ends[0].bed-ends[0].inv-.05)<.005,`low mouth on its bed under thin fill (${JSON.stringify(ends)})`);
 assert.ok(ends[0].open>.1&&ends[1].inv<=ends[1].bed-.04,`thin fill: low mouth open, high invert not floating (${JSON.stringify(ends)})`);
 // Steep brook under thin fill: the drawn crown (measured, not recomputed) stays under the road at the 1 m road samples.
 const steepAt=(x,z)=>Math.abs(z)>3.5?(z>0?10:16):15.6;
 const steep=new StreamCulverts(streams,[road],steepAt,false);steep.update({x:0,z:0});
 const sr=steep.group.children[0];sr.updateMatrixWorld(true);assert.ok(sr.rotation.x**2>.09,'steep case is steep');
 for(let k=0;k<=400;k++){const p=sr.localToWorld(new Vector3(0,4.35,-ml/2+ml*k/400));if(Math.abs(p.z)<=3)assert.ok(p.y<=15.6-.12,`crown below road along the graded run (${p.y} at z ${p.z})`);}
 // Stream arches have no strip footings past their mouths; the yard arch keeps its footings unchanged.
 const extent=group=>{const b=new Box3();group.children[0].geometry.computeBoundingBox();b.copy(group.children[0].geometry.boundingBox);return b;};
 const stream=extent(new ArchCulvert(0,0,0,4,()=>0,false,true).group),yardArch=extent(new ArchCulvert(0,0,0,4,()=>0).group);
 assert.ok(stream.max.z<=2*ArchCulvert.UNIT+1e-6&&stream.min.z>=-2*ArchCulvert.UNIT-1e-6,'no stream footing past a mouth');
 assert.ok(stream.min.y<=ArchCulvert.STREAM_DEEP+1e-6,'stream legs reach down a falling bank');
 assert.ok(Math.abs(yardArch.max.z-(2*ArchCulvert.UNIT+.3))<1e-6&&Math.abs(yardArch.min.y+1.6)<1e-6,'yard arch unchanged');
 // Disposal: every geometry and material of a dropped arch is released, not only detached.
 {const keep=new StreamCulverts(streams,[road],()=>50,false);keep.update({x:0,z:0});let freed=0;
  keep.group.children[0].traverse(o=>{if(o.isMesh){for(const t of [o.geometry,o.material]){const f=t.dispose.bind(t);t.dispose=()=>{freed++;f();};}}});
  keep.update({x:1000,z:1000});assert.ok(freed>=2&&keep.group.children.length===0,`dropped arch disposed (${freed})`);}
 // One build a frame, nearest first: with two crossings in range the first frame builds only the nearer one.
 const two=new Streams({streams:[{id:1,name:'',half:.5,pts:[[0,-20],[0,0],[0,20]]},{id:2,name:'',half:.5,pts:[[100,-20],[100,0],[100,20]]}],
  culverts:[{stream:1,road:1,a:[0,-6],b:[0,6],dia:1,mapped:true},{stream:2,road:9,a:[100,-6],b:[100,6],dia:1,mapped:true}]},[0,0]);
 const roadB={...road,id:9,pts:[[80,0],[120,0]]};
 const pair=new StreamCulverts(two,[road,roadB],()=>50,false);assert.equal(pair.crossings.length,2);
 pair.update({x:90,z:0});assert.equal(pair.group.children.length,1,'one build per frame');
 assert.ok(Math.abs(pair.group.children[0].position.x-100)<.01,'nearest crossing builds first');
 pair.update({x:90,z:0});assert.equal(pair.group.children.length,2,'next frame builds the other');
 // Regrade only when land tiles change (terrain.dataRevision), not every frame.
 {let land=50,rev=1,reads=0;const gated=new StreamCulverts(streams,[road],()=>{reads++;return land;},false,()=>rev);
  gated.update({x:0,z:0});const g=gated.group.children[0],y0=g.position.y;assert.ok(reads>0);
  reads=0;land=40;gated.update({x:0,z:0});assert.equal(reads,0,'same land revision: no land reads');assert.equal(g.position.y,y0);
  rev=2;gated.update({x:0,z:0});assert.ok(reads>0&&g.position.y<y0-9,'new land revision regrades');}
 // A run that also passes under a second road keeps its fill and crown under that road too. The low mouth (z -10)
 // sits under a low lane (z -9..-5); the mapped road (z 0) is high, so only the lane limits the grade.
 const crownAlong=(o,len)=>{o.updateMatrixWorld(true);const ml2=Math.ceil(len/ArchCulvert.UNIT)*ArchCulvert.UNIT;return Array.from({length:401},(_,k)=>o.localToWorld(new Vector3(0,4.35,-ml2/2+ml2*k/400)));};
 {const long=new Streams({streams:[{id:1,name:'',half:.5,pts:[[0,-20],[0,0],[0,20]]}],culverts:[{stream:1,road:1,a:[0,-10],b:[0,10],dia:1,mapped:true}]},[0,0]);
  const lane={...road,id:2,pts:[[-20,-7],[20,-7]],halfWidth:1.5};
  const at=(x,z)=>z<-9.6?8:z>9.6?14:Math.abs(z)<=3.5?16:(z>=-9&&z<=-5)?9:12;
  const both=new StreamCulverts(long,[road,lane],at,false);both.update({x:0,z:0});
  assert.ok(both.crossings[0].cover.some(p=>p.z<-5),'cover samples under the second road');
  for(const p of crownAlong(both.group.children[0],20))if(p.z>=-9&&p.z<=-5)assert.ok(p.y<=9-.12,`crown below the second road (${p.y} at z ${p.z})`);}
 // A road crossing at an angle that falls along its own line: beside the axis the road is lower than on it, and the
 // samples beside the axis cap the crown there.
 {const skew={...road,pts:[[-20,-20],[20,20]]},band=(x,z)=>Math.abs(z-x)/Math.SQRT2<=3.5;
  const tilt=(x,z)=>band(x,z)?13+(x+z)/Math.SQRT2:8.5;
  const sk=new StreamCulverts(streams,[skew],tilt,false);const c0=sk.crossings[0],side=.5*4.822*c0.scale;
  assert.ok(c0.cover.some(p=>Math.abs(p.x)>.5),'samples beside the axis');
  sk.update({x:0,z:0});const crown=crownAlong(sk.group.children[0],c0.length);
  for(let d=0;d<=12;d++)for(const x of [-side,side]){const z=-6+d;if(!band(x,z))continue;
   const q=crown.reduce((m,p)=>Math.abs(p.z-z)<Math.abs(m.z-z)?p:m);assert.ok(q.y<=tilt(x,z)-.1,`crown under the road beside the axis (${q.y} vs ${tilt(x,z)} at ${x.toFixed(2)},${z})`);}}
 // Thin fill: beds at 10, road at 10.3. The run sinks to keep 0.55 m under the road, the arch is not flattened to
 // nothing or mirrored, and its crown stays under the road.
 {const thinFill=new StreamCulverts(streams,[road],(x,z)=>Math.abs(z)>5?10:10.3,false);thinFill.update({x:0,z:0});const t=thinFill.group.children[0];
  assert.ok(t.position.y<=10.3-.55+1e-9,`invert sinks under thin fill (${t.position.y})`);assert.ok(t.scale.y>0,'arch not flattened or mirrored');
  assert.ok(t.position.y+4.35*t.scale.y<10.3,'crown under the thin road');}
 // Mouth B (world z -10, the parser turns north into -z) is the low one and a thin lane lies by the high A mouth: the
 // fill limit must apply where the lane really is along the run, not mirrored toward the low end.
 {const long=new Streams({streams:[{id:1,name:'',half:.5,pts:[[0,-20],[0,0],[0,20]]}],culverts:[{stream:1,road:1,a:[0,-10],b:[0,10],dia:1,mapped:true}]},[0,0]);
  const lane={...road,id:2,pts:[[-20,7],[20,7]],halfWidth:1.5};
  const at=(x,z)=>z>9.6?14:z<-9.6?8:Math.abs(z)<=3.5?16:(z>=5&&z<=9)?13:12;
  const bLow=new StreamCulverts(long,[road,lane],at,false);bLow.update({x:0,z:0});
  for(const p of crownAlong(bLow.group.children[0],20))if(p.z>=5&&p.z<=9)assert.ok(p.y<=13-.12,`crown below the lane by the high A mouth (${p.y} at z ${p.z})`);}
 // And the other way round: A low, the lane by the high B mouth.
 {const long=new Streams({streams:[{id:1,name:'',half:.5,pts:[[0,-20],[0,0],[0,20]]}],culverts:[{stream:1,road:1,a:[0,-10],b:[0,10],dia:1,mapped:true}]},[0,0]);
  const lane={...road,id:2,pts:[[-20,-7],[20,-7]],halfWidth:1.5};
  const at=(x,z)=>z<-9.6?14:z>9.6?8:Math.abs(z)<=3.5?16:(z>=-9&&z<=-5)?13:12;
  const aLow=new StreamCulverts(long,[road,lane],at,false);aLow.update({x:0,z:0});
  for(const p of crownAlong(aLow.group.children[0],20))if(p.z>=-9&&p.z<=-5)assert.ok(p.y<=13-.12,`crown below the lane by the high B mouth (${p.y} at z ${p.z})`);}
 // A dropped and rebuilt arch is graded again although no land tile changed meanwhile.
 {const rebuilt=new StreamCulverts(streams,[road],()=>50,false,()=>7);rebuilt.update({x:0,z:0});const y=rebuilt.group.children[0].position.y;
  rebuilt.update({x:1000,z:0});assert.equal(rebuilt.group.children.length,0);rebuilt.update({x:0,z:0});
  assert.ok(Math.abs(rebuilt.group.children[0].position.y-y)<1e-9&&y>40,`rebuilt arch graded at the same revision (${rebuilt.group.children[0].position.y})`);}
 // Land missing under part of the road: the arch stays hidden rather than graded from part of its fill.
 {const partial=new StreamCulverts(streams,[road],(x,z)=>z>=0&&z<=3.5?null:50,false);partial.update({x:0,z:0});
  assert.equal(partial.group.children[0].visible,false,'hidden while a road sample has no fine land');}
 // A road beside a wide arch, outside the run's own line but inside the arch's width, still limits it.
 {const wide=new Streams({streams:[{id:1,name:'',half:.5,pts:[[0,-20],[0,0],[0,20]]}],culverts:[{stream:1,road:1,a:[0,-6],b:[0,6],dia:4.1,mapped:true}]},[0,0]);
  const alongside={...road,id:3,halfWidth:.1,pts:[[2.6,-20],[2.6,20]]};
  const c=streamCrossings(wide,[road,alongside])[0];assert.ok(c.cover.some(p=>p.x>2&&Math.abs(p.z)>4),'samples under a road beside the arch');}
 visual.update({x:1000,z:1000});assert.equal(visual.group.children.length,0,'distant resources removed');
 const rows=[],underSpans=[];
 for(const folder of ['terrain',...readdirSync(join(root,'data/baked/areas')).map(x=>'areas/'+x)]){
  const dir=join(root,'data/baked',folder),json=name=>JSON.parse(readFileSync(join(dir,name+'.json'),'utf8'));
  const village=json('manifest').village, s=new Streams(json('streams'),village);
  const roads=json('roads').roads.map(r=>({...r,pts:r.pts.map(([e,n])=>[e-village[0],village[1]-n])}));
  // The same spans the game builds from this roads file (Roads hands ModernBridges the village-frame roads).
  const spans=new ModernBridges(roads,{manifest:json('manifest')},new Group(),json('roads').bridgeSpans).runs;
  const crossings=streamCrossings(s,roads,spans),flaggedOnly=streamCrossings(s,roads);
  const raw=json('streams').culverts;
  assert.equal(s.pipes.length,raw.length,'all shipped mouth pairs parsed');
  for(const c of crossings){const pipe=raw.find(p=>Math.hypot((p.a[0]+p.b[0])/2-village[0]-c.x,village[1]-(p.a[1]+p.b[1])/2-c.z)<.01);assert.ok(pipe,'arch at real pipe midpoint');assert.ok(Math.abs(c.length-Math.hypot(pipe.a[0]-pipe.b[0],pipe.a[1]-pipe.b[1]))<.01);assert.ok(Math.abs(Math.sin(c.heading-Math.atan2(pipe.b[0]-pipe.a[0],pipe.b[1]-pipe.a[1])))<1e-6);}
  // Every pair either has one arch, overlaps a bridge, or no longer reaches the current road.
  for(const pipe of s.pipes){const x=(pipe.x+pipe.endX)/2,z=(pipe.z+pipe.endZ)/2; if(!crossings.some(c=>c.x===x&&c.z===z)){const road=roads.find(r=>r.id===pipe.road),len=Math.hypot(pipe.endX-pipe.x,pipe.endZ-pipe.z); const reachesRoad=road&&Array.from({length:Math.ceil(len)+1},(_,i)=>Math.min(1,i/len)).some(t=>roadDistance(pipe.x+(pipe.endX-pipe.x)*t,pipe.z+(pipe.endZ-pipe.z)*t,road)<=road.halfWidth+.5); if(!reachesRoad)continue; assert.throws(()=>bridgeOracle({x,z},roads,Math.hypot(Math.hypot(pipe.x-pipe.endX,pipe.z-pipe.endZ)/2+.3,6.1*Math.min(1,pipe.dia/4.1)),spans),/culvert under bridge/,'omitted pair must overlap a bridge');}}
  for(const c of crossings){assert.ok(c.cover.length,'road cover samples at each real pipe');bridgeOracle(c,roads,0,spans);assert.ok(roads.some(r=>r.id===c.road&&!r.bridge));}
  rows.push({area:folder,crossings:crossings.length,first:crossings[0]});
  underSpans.push({area:folder,count:flaggedOnly.length-crossings.length});
 }
 assert.ok(rows[0].crossings>0 && rows.some(r=>r.area==='areas/judique'&&r.crossings>0));
 console.log('left out under modern spans',JSON.stringify(underSpans),'now',JSON.stringify(rows.map(r=>({area:r.area,count:r.crossings}))));
 const evidence=JSON.parse(readFileSync(join(root,'assets/culverts/checks.json'),'utf8'));
 assert.deepEqual(evidence.placements,rows.map(r=>({area:r.area,count:r.crossings})),'saved evidence counts match shipped data');
 for(const area of ['mabou','judique'])for(const [view,w,h] of [['desktop',1280,720],['phone',390,844],['upstream-desktop',1280,720]]){
  const png=readFileSync(join(root,`assets/culverts/culvert-${area}-${view}.png`));
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a','real PNG evidence');
  assert.equal(png.readUInt32BE(16),w);assert.equal(png.readUInt32BE(20),h);
 }
 console.log(JSON.stringify(rows,null,2));
 if(process.argv.includes('--mutations')){
  const mutant=await load(true);
  assert.throws(()=>{for(const c of mutant.streamCrossings(streams,[{...road,bridge:true}]))bridgeOracle(c,[{...road,bridge:true}]);},/culvert under bridge/,'mutant must be killed by overlap oracle');
  console.log('PASS bridge exclusion source mutant killed');
  // Without the spans, an arch stands under a modern deck on an unflagged road.
  const span={pts:[[-20,0],[20,0]],halfWidth:3.45};
  assert.equal(streamCrossings(streams,[road],[span]).length,0,'a modern span over the crossing leaves no arch');
  assert.throws(()=>{for(const c of streamCrossings(streams,[road]))bridgeOracle(c,[road],0,[span]);},/culvert under bridge/,'span-blind planner must be killed by the oracle');
  console.log('PASS modern span exclusion: a span-blind planner is killed');
 }
 console.log('PASS real crossings, bridge exclusion, seating, disposal');
} finally {rmSync(scratch,{recursive:true,force:true});}
