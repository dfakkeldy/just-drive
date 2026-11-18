// Bundle with esbuild (tools/check-mabou-main.sh), then run from the repository root.
// Mabou main street (the project brief): the site's rules against the baked land, no data change.
// MABOU_MAIN_REPORT=1 prints every clearance (for placing things), then runs the asserts.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MabouMainSite, MAIN_PLACES, MAIN_ITEMS, STREET_LAMPS, FESTOONS, GAS_ISLANDS, GAS_ISLAND_Z, SIDEWALK, aimDrops, toMap} from '../web/src/mabou-main-site.ts';
import {CORNER_SLACK} from '../web/src/site-solids.ts';
import {pushOut} from '../web/src/parked.ts';
const read=file=>JSON.parse(readFileSync(file));
const report=process.env.MABOU_MAIN_REPORT==='1';
let failed=0;
const check=(ok,msg)=>{if(ok)return;if(!report)assert.fail(msg);failed++;console.log('FAIL',msg);};
// MMM_BAKED=<folder> reads a rehearsed land (for example the land builder's delta over the live land).
const baked=process.env.MMM_BAKED??'data/baked';
const manifest=read(`${baked}/terrain/manifest.json`),site=new MabouMainSite(manifest.village);
const bakedList=read(`${baked}/terrain/buildings.json`).buildings,roads=read(`${baked}/terrain/roads.json`).roads,props=read(`${baked}/terrain/props.json`);
const nearestPoint=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l)):0;return [a[0]+t*dx,a[1]+t*dy];};
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const inside=(p,fp)=>{let c=false;for(let i=0,j=fp.length-1;i<fp.length;j=i++){const a=fp[i],b=fp[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;};
const edgeGap=(p,fp)=>inside(p,fp)?-Math.min(...fp.map((q,i)=>distance(p,nearestPoint(p,fp[(i+fp.length-1)%fp.length],q)))):Math.min(...fp.map((q,i)=>distance(p,nearestPoint(p,fp[(i+fp.length-1)%fp.length],q))));

// 1. Exactly the nine surveyed boxes (with the grocery's and the hall's wings: thirteen records on the Mabou village delta land) leave the drawing, by position, whatever
// their ids; they all stay in the building list (mail properties).
const groups=site.replaced(bakedList),gone=bakedList.filter(b=>!site.drawn(bakedList).includes(b)).map(b=>b.id).sort((a,b)=>a-b);
if(report)console.log('replaced',gone);
assert.deepEqual(gone,[3,51,71,130,140,150,169,198,973,1722,1723].filter(id=>bakedList.some(b=>b.id===id)).concat(bakedList.filter(b=>b.buildingId===3&&b.id!==3).map(b=>b.id)).sort((a,b)=>a-b));
assert.equal(groups.size,9);
const renumbered=bakedList.map(b=>({...b,id:b.id+5000,...(b.buildingId===undefined?{}:{buildingId:b.buildingId+5000})}));
assert.deepEqual(site.drawn(renumbered).map(b=>[b.x,b.y]),site.drawn(bakedList).map(b=>[b.x,b.y]));
for(const [name,p] of Object.entries(MAIN_PLACES)){
 if(!p.replaces)continue;
 const near=bakedList.filter(b=>{const c=b.site??b;return Math.hypot(c.x-p.replaces[0],c.y-p.replaces[1])<=6;});
 assert.equal(near.length,1,`${name}: one baked record carries the site`);
 const c=near[0],dx=c.x-p.e,dn=c.y-p.n,a=p.az*Math.PI/180,x=dx*Math.sin(a)+dn*Math.cos(a),z=dx*Math.cos(a)-dn*Math.sin(a);
 check(p.rects.some(r=>x>=r[0]-1&&x<=r[1]+1&&z>=r[2]-1&&z<=r[3]+1),`${name}: model covers the baked box`);
}

// 2. Nothing solid stands on a road; nothing stands in a building that is still drawn, on a pole or on a mailbox.
const near=roads.filter(r=>r.pts.some(([e,n])=>e>624000&&e<625050&&n>5102950&&n<5103700));
const roadGap=(e,n,skip)=>Math.min(...near.filter(r=>r.id!==skip).flatMap(r=>r.pts.slice(1).map((q,i)=>distance([e,n],nearestPoint([e,n],r.pts[i],q))-r.halfWidth)));
const kept=site.drawn(bakedList).filter(b=>Math.abs(b.x-624530)<520&&Math.abs(b.y-5103340)<360);
const fixed=[...props.poles,...props.communityBoxes,...props.mailboxes].filter(q=>Math.abs(q.x-624530)<520&&Math.abs(q.y-5103340)<360);
const corners=s=>{const ux=Math.sin(s.heading),uz=-Math.cos(s.heading),vx=Math.cos(s.heading),vz=Math.sin(s.heading);
 return [[0,0],[-1,-1],[1,-1],[1,1],[-1,1]].map(([i,j])=>[s.x+ux*s.half*i+vx*s.halfWidth*j+manifest.village[0],manifest.village[1]-(s.z+uz*s.half*i+vz*s.halfWidth*j)]);};
let worst=Infinity;
for(const s of site.solids)for(const [e,n] of corners(s)){
 const gap=roadGap(e,n);worst=Math.min(worst,gap);
 check(gap>=0.8,`solid at ${e.toFixed(1)},${n.toFixed(1)} is ${gap.toFixed(2)} m from a carriageway`);
 for(const b of kept)check(!inside([e,n],b.footprint),`solid at ${e.toFixed(1)},${n.toFixed(1)} is inside building ${b.id}`);
}
// A pole or mailbox centre keeps 0.4 m from every solid (in the solid's own axes, world x east, z south).
for(const s of site.solids)for(const q of fixed){
 const dx=q.x-manifest.village[0]-s.x,dz=manifest.village[1]-q.y-s.z;
 const along=dx*Math.sin(s.heading)-dz*Math.cos(s.heading),across=dx*Math.cos(s.heading)+dz*Math.sin(s.heading);
 check(Math.abs(along)>s.half+0.4||Math.abs(across)>s.halfWidth+0.4,`a pole or mailbox at ${q.x.toFixed(1)},${q.y.toFixed(1)} is inside a solid`);
}
if(report)console.log('worst solid road gap',worst.toFixed(2));
for(const [name,v] of Object.entries(MAIN_ITEMS)){
 const pts=Array.isArray(v[0])?v:[v];
 for(const [e,n] of pts){
  const gap=roadGap(e,n);if(report)console.log('item',name,gap.toFixed(2));
  check(gap>=0.8,`${name} stands on a road`);
 }
}
for(const [e,n,h] of STREET_LAMPS){
 const gap=roadGap(e,n),side=near.filter(r=>![25,26,28].includes(r.id)),sideGap=Math.min(...side.flatMap(r=>r.pts.slice(1).map((q,i)=>distance([e,n],nearestPoint([e,n],r.pts[i],q))-r.halfWidth)));
 const bgap=Math.min(...kept.map(b=>edgeGap([e,n],b.footprint)),...Object.values(MAIN_PLACES).flatMap(p=>p.rects.map(r=>{const c=[[r[0],r[2]],[r[1],r[2]],[r[1],r[3]],[r[0],r[3]]].map(([x,z])=>toMap(p,x,z));return edgeGap([e,n],c);})));
 if(report)console.log('lamp',e,n,h,'road',gap.toFixed(2),'side road',sideGap.toFixed(2),'building',bgap.toFixed(2));
 check(gap>=1.6&&gap<=3.2,`lamp ${e},${n} stands ${gap.toFixed(2)} m from the carriageway`);
 check(sideGap>=2.5,`lamp ${e},${n} is in a side road's mouth`);
 check(bgap>=0.8,`lamp ${e},${n} is ${bgap.toFixed(2)} m from a building`);
}
for(const [a,b] of FESTOONS){
 const ga=roadGap(...a),gb=roadGap(...b);if(report)console.log('festoon',ga.toFixed(2),gb.toFixed(2),distance(a,b).toFixed(1));
 check(ga>=1.6&&gb>=1.6&&distance(a,b)<16,'festoon posts beside the road, the span across it');
}
// Every model rectangle keeps off the roads and out of the buildings that are still drawn.
for(const [name,p] of Object.entries(MAIN_PLACES))for(const r of p.rects){
 const c=[[r[0],r[2]],[r[1],r[2]],[r[1],r[3]],[r[0],r[3]]].map(([x,z])=>toMap(p,x,z));
 const g=Math.min(...c.map(q=>roadGap(...q)));if(report)console.log('rect',name,r.join(' '),'road',g.toFixed(2));
 check(g>=1.0,`${name} rect ${r} reaches the road`);
}
// The pumps: two islands in a row parallel to the front, no canopy (nothing over them), off the road.
assert.equal(GAS_ISLANDS.length,2);
for(const x of GAS_ISLANDS){const [e,n]=toMap(MAIN_PLACES.gas,x,GAS_ISLAND_Z);check(roadGap(e,n)>=3,'island off the road');}

// 3. The grocery's east wall: the open south 7.06 m between the main block's south-east corner and the east wing
// carries nothing deeper than 3 cm, so the moved mailbox bank (624896.85, 5103595.12, 70°) stands flush.
{const g=MAIN_PLACES.grocery,se=toMap(g,15.67,9.955),wing=toMap(g,15.67,2.89);
 check(distance(se,[624897.0,5103592.95])<0.05&&distance(wing,[624894.58,5103599.58])<0.08,'grocery east wall on the baked footprint');
 const bank=[624896.85,5103595.12],dx=bank[0]-g.e,dn=bank[1]-g.n,a=g.az*Math.PI/180,x=dx*Math.sin(a)+dn*Math.cos(a),z=dx*Math.cos(a)-dn*Math.sin(a);
 check(x-0.55>15.67&&x-0.55<15.67+0.1&&z>2.89+1.9&&z<9.955-1.6,`bank pad back at x ${(x-0.55).toFixed(2)}, centre z ${z.toFixed(2)}`);
 for(const s of site.solids)for(const [e,n] of corners(s))check(distance([e,n],bank)>1.2||Math.abs((e-g.e)*Math.sin(a)+(n-g.n)*Math.cos(a))<=15.7,'no solid on the bank');}
// The post office mailbox site stays clear of the memorial lawn things.
{const cb=props.communityBoxes.find(c=>Math.abs(c.x-624464)<3&&Math.abs(c.y-5103378)<3);
 check(cb,'the post office mailbox site is baked');
 for(const k of ['memorial','memorialFlag','memorialPanel'])check(distance(MAIN_ITEMS[k],[cb.x,cb.y])>3,`${k} clear of the mailbox site`);
 for(const q of MAIN_ITEMS.memorialPath)check(distance(q,[cb.x,cb.y])>2.2,'memorial path clear of the mailbox site');}

// 4. Service drops of the replaced buildings end on the models: each end lies on a model wall (within 0.3 m of a
// rectangle edge) and every other drop is untouched.
{const drops=props.serviceDrops,aimed=aimDrops(drops);
 const gone=new Set(bakedList.filter(b=>groups.has(b.buildingId??b.id)).map(b=>b.id));
 for(let i=0;i<drops.length;i++){
  // A drop is re-aimed exactly when its building leaves the drawing (found by position in aimDrops, by id here).
  if(!gone.has(drops[i].building)){assert.equal(aimed[i],drops[i]);continue;}
  assert.notEqual(aimed[i],drops[i],`drop of ${drops[i].building} is re-aimed`);
  const d=aimed[i],edge=Math.min(...Object.values(MAIN_PLACES).flatMap(p=>p.rects.map(r=>{const c=[[r[0],r[2]],[r[1],r[2]],[r[1],r[3]],[r[0],r[3]]].map(([x,z])=>toMap(p,x,z));return Math.abs(edgeGap([d.x,d.y],c));})));
  if(report)console.log('drop',drops[i].building,'edge',edge.toFixed(2),'length',distance([d.x,d.y],[props.poles.find(p=>p.road===d.road&&p.n===d.n)?.x??d.x,props.poles.find(p=>p.road===d.road&&p.n===d.n)?.y??d.y]).toFixed(1));
  check(edge<0.3,`drop of ${drops[i].building} ends on a model wall`);assert.equal(d.ground,null);
 }}

// 5. The solids push a car out anywhere inside them, and leave one 3 m beside them alone.
for(const s of site.solids){
 check(s.half>=s.halfWidth,'half is the long side');
 check(Math.hypot(s.half,s.halfWidth)-s.half<=CORNER_SLACK+1e-9,'no corner reaches past the early-out of pushOut');
 const ux=Math.sin(s.heading),uz=-Math.cos(s.heading),vx=Math.cos(s.heading),vz=Math.sin(s.heading);
 for(const i of [-0.9,0,0.9])for(const j of [-0.9,0,0.9]){
  const x=s.x+ux*s.half*i+vx*s.halfWidth*j,z=s.z+uz*s.half*i+vz*s.halfWidth*j,car={x,z,vx:0,vz:0,speed:0,heading:0};
  pushOut(car,[s]);check(Math.hypot(car.x-x,car.z-z)>0.01,`a car inside a solid at (${i},${j}) is pushed out`);
 }
 const d=s.halfWidth+3,far={x:s.x+vx*d,z:s.z+vz*d,vx:0,vz:0,speed:0,heading:0};
 pushOut(far,[s]);check(Math.hypot(far.x-s.x-vx*d,far.z-s.z-vz*d)<1e-9,'a car beside the solid is left alone');
}
// The sidewalk runs between the carriageway edge and the lamps.
check(SIDEWALK.inner>=3.6&&SIDEWALK.outer<5.9-0.25&&SIDEWALK.outer-SIDEWALK.inner>=1.4);
console.log(`PASS mabou-main: ${groups.size} places replaced in the drawing (${gone.length} records), ${site.solids.length} solids (worst road gap ${worst.toFixed(2)} m), ${STREET_LAMPS.length} lamps, ${FESTOONS.length} festoons`);
