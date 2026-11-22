// Bundle with esbuild (tools/check-judique-village.sh), then run from the repository root.
// The heart of Judique (the project brief): the site's rules against the baked land, no data change.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JudiqueVillageSite, CORNER_SLACK, VILLAGE_PLACES, VILLAGE_ITEMS, CHURCH_WALL, toMap} from '../web/src/judique-village-site.ts';
import {ROAD_EDGES, HEDGE_THICK, drawnSolids, edgeKind, fenceSegments, fenceSolids, nearestPoint, distance} from '../web/src/cemetery-rules.ts';
import {pushOut} from '../web/src/parked.ts';
const read=file=>JSON.parse(readFileSync(file));
const manifest=read('data/baked/areas/judique/manifest.json'),site=new JudiqueVillageSite(manifest.village);
const baked=read('data/baked/areas/judique/buildings.json').buildings,roads=read('data/baked/areas/judique/roads.json').roads;

// 1. Exactly the six surveyed boxes (ten records with their wings) are replaced, by position, whatever their IDs.
const gone=baked.filter(b=>!site.buildings(baked).includes(b)).map(b=>b.id).sort((a,b)=>a-b);
assert.deepEqual(gone,[4,8,10,42,65,958,1115,1116,1118,1119]);
const renumbered=baked.map(b=>({...b,id:b.id+5000,...(b.buildingId===undefined?{}:{buildingId:b.buildingId+5000})}));
assert.deepEqual(site.buildings(renumbered).map(b=>[b.x,b.y]),site.buildings(baked).map(b=>[b.x,b.y]));
for(const [name,p] of Object.entries(VILLAGE_PLACES)){
 const near=baked.filter(b=>Math.hypot(b.x-p.replaces[0],b.y-p.replaces[1])<=6);
 assert.ok(near.length>=1,`${name}: a baked box still stands on its spot`);
 // The model's own footprint covers the baked box's centre.
 const local=[(near[0].x-p.e),(near[0].y-p.n)],a=p.az*Math.PI/180,x=local[0]*Math.sin(a)+local[1]*Math.cos(a),z=local[0]*Math.cos(a)-local[1]*Math.sin(a);
 assert.ok(p.rects.some(r=>x>=r[0]-1&&x<=r[1]+1&&z>=r[2]-1&&z<=r[3]+1),`${name}: model covers the baked box`);
}

// 2. Nothing solid stands on a road: every solid's corners keep clear of every mapped carriageway near the village.
const near=roads.filter(r=>r.pts.some(([e,n])=>Math.abs(e-617110)<500&&Math.abs(n-5081560)<500));
const roadGap=(e,n)=>Math.min(...near.flatMap(r=>r.pts.slice(1).map((q,i)=>distance([e,n],nearestPoint([e,n],r.pts[i],q))-r.halfWidth)));
let worst=Infinity;
for(const s of site.solids){
 const ux=Math.sin(s.heading),uz=-Math.cos(s.heading),vx=Math.cos(s.heading),vz=Math.sin(s.heading);
 for(const [i,j] of [[0,0],[-1,-1],[1,-1],[1,1],[-1,1]]){
  const x=s.x+ux*s.half*i+vx*s.halfWidth*j,z=s.z+uz*s.half*i+vz*s.halfWidth*j,gap=roadGap(x+manifest.village[0],manifest.village[1]-z);
  worst=Math.min(worst,gap);assert.ok(gap>=0.8,`solid ${JSON.stringify(s)} is ${gap.toFixed(2)} m from a carriageway`);
 }
}
for(const [name,p] of Object.entries(VILLAGE_ITEMS)){
 const pts=Array.isArray(p[0])?p:[p];
 for(const [e,n] of pts)assert.ok(roadGap(e,n)>=0.8,`${name} stands on a road`);
}
for(const run of CHURCH_WALL)for(const [e,n] of run)assert.ok(roadGap(e,n)>=2.5,'the church wall is off the shoulder');
// The stair gap lines up with the tower door (the church frame's z = 0 line, 31 m out).
const [ge,gn]=toMap(VILLAGE_PLACES.church,30.7,0);
assert.ok(CHURCH_WALL[0].at(-1)[1]<gn-1.2&&CHURCH_WALL[1][0][1]>gn+1.2&&Math.abs(CHURCH_WALL[0].at(-1)[0]-ge)<0.6,'stair gap opposite the door');

// 3. The solids push a car out anywhere inside them (pushOut skips a solid beyond its long side, so half must be the
// long side), and leave one 3 m beside them alone.
for(const s of site.solids){
 assert.ok(s.half>=s.halfWidth,'half is the long side');
 assert.ok(Math.hypot(s.half,s.halfWidth)-s.half<=CORNER_SLACK+1e-9,'no corner reaches past the early-out of pushOut');
 const ux=Math.sin(s.heading),uz=-Math.cos(s.heading),vx=Math.cos(s.heading),vz=Math.sin(s.heading);
 for(const i of [-0.9,-0.45,0,0.45,0.9])for(const j of [-0.9,0,0.9]){
  const x=s.x+ux*s.half*i+vx*s.halfWidth*j,z=s.z+uz*s.half*i+vz*s.halfWidth*j,car={x,z,vx:0,vz:0,speed:0,heading:0};
  pushOut(car,[s]);assert.ok(Math.hypot(car.x-x,car.z-z)>0.01,`a car inside a solid at (${i},${j}) is pushed out`);
 }
 const d=s.halfWidth+3,far={x:s.x+vx*d,z:s.z+vz*d,vx:0,vz:0,speed:0,heading:0};
 pushOut(far,[s]);assert.ok(Math.hypot(far.x-s.x-vx*d,far.z-s.z-vz*d)<1e-9,'a car beside the solid is left alone');
}

// 4. Cemetery road edges: the church cemetery is open to the road, the one opposite has a hedge; nothing else changes.
const cem=read('data/baked/areas/judique/cemeteries.json').cemeteries;
for(const e of ROAD_EDGES){
 const on=cem.some(c=>c.wall.some(line=>line.some((p,i)=>i>0&&distance(e.a,nearestPoint(e.a,line[i-1],p))<0.05&&distance(e.b,nearestPoint(e.b,line[i-1],p))<0.05)));
 assert.ok(on,`road edge ${e.kind} lies on a baked wall line`);
 const hw=roads.find(r=>r.id===39);
 // A lane entry (church-check.mjs proves its lane crosses it) is not on the highway.
 if(!e.lane)for(const p of [e.a,e.b])assert.ok(hw.pts.slice(1).some((q,i)=>distance(p,nearestPoint(p,hw.pts[i],q))<20),'edge faces Highway 19');
}
const counts={};
for(const c of cem)for(const [a,b] of fenceSegments(c)){const k=`${c.id}:${edgeKind('judique',a,b)}`;counts[k]=(counts[k]??0)+1;}
assert.deepEqual(Object.keys(counts).filter(k=>!k.endsWith(':wall')).sort(),['cemetery-14a82b80c872:open','cemetery-3d9dfda0d9e5:hedge','cemetery-e26f6ceae9b8:open']);
// The church cemetery opens only where the mown lane enters: two 2.7 m wall pieces.
assert.ok(counts['cemetery-14a82b80c872:open']>=25&&counts['cemetery-3d9dfda0d9e5:hedge']>=30&&counts['cemetery-e26f6ceae9b8:open']===2);
for(const area of ['mabou','porthood','westbay'])for(const c of cem)for(const [a,b] of fenceSegments(c))assert.equal(edgeKind(area,a,b),'wall');
// The renderer's solids (drawnSolids): none along the open edge, hedge-thick along the hedge, the rest unchanged.
for(const c of cem){
 const solids=drawnSolids(c,[0,0],'judique'),all=fenceSolids(c,[0,0]);
 for(const s of solids){
  const m=[s.x,-s.z],e=ROAD_EDGES.find(e=>distance(m,nearestPoint(m,e.a,e.b))<0.3);
  assert.notEqual(e?.kind,'open','a solid remains on the open edge');
  assert.equal(s.halfWidth,e?.kind==='hedge'?HEDGE_THICK/2:0.15);
 }
 assert.equal(all.length-solids.length,counts[`${c.id}:open`]??0);
 assert.deepEqual(drawnSolids(c,[0,0],'mabou'),all,'other areas keep the baked solids');
}
console.log(`PASS judique-village: 10 baked records replaced, ${site.solids.length} solids at least ${worst.toFixed(2)} m off every carriageway, ${counts['cemetery-14a82b80c872:open']} open and ${counts['cemetery-3d9dfda0d9e5:hedge']} hedge cemetery segments`);
