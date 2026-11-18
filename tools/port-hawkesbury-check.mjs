// Bundle with esbuild (tools/check-port-hawkesbury.sh), then run from the repository root.
// Port Hawkesbury (the project brief): the site's rules against the baked land, no data change.
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {PortHawkesburySite,PH_PLACES,PH_ITEMS,PH_SIGNS,PH_LOTS,PH_PADS,PH_GROUPS,GARAGE_APRON,PLACE_VEHICLES,PAVED_ORIGIN,PAVED_TILE,PAVED_RES,PAVED_SIDE,aimDrops,layoutLot,lotSolids,parkedPose,lotToMap,lotBox,pavedKeys,pavedTest,toMap,toLocal,inLot,outline,inRing,segDist,STALL_W,STALL_D} from '../web/src/port-hawkesbury-site.ts';
import {CORNER_SLACK} from '../web/src/site-solids.ts';
import {pushOut,PARKED_SIZE} from '../web/src/parked.ts';
import {groupPoints} from '../web/src/port-hawkesbury.ts';
const read=file=>JSON.parse(readFileSync(file));
const AREA='data/baked/areas/pointtupper/';
const manifest=read(AREA+'manifest.json'),site=new PortHawkesburySite(manifest.village);
const baked=read(AREA+'buildings.json').buildings,roads=read(AREA+'roads.json').roads;
const V=manifest.village,toMapW=(x,z)=>[x+V[0],V[1]-z];

// 1. Exactly the surveyed boxes (with their wings) are replaced, by position, whatever their IDs.
const gone=baked.filter(b=>!site.buildings(baked).includes(b)).map(b=>b.id).sort((a,b)=>a-b);
assert.deepEqual(gone,[36,103,398,1133,1991,3073,3074]);
const renumbered=baked.map(b=>({...b,id:b.id+9000,...(b.buildingId===undefined?{}:{buildingId:b.buildingId+9000})}));
assert.deepEqual(site.buildings(renumbered).map(b=>[b.x,b.y]),site.buildings(baked).map(b=>[b.x,b.y]));
// Each model covers the baked box it replaces, and the garage, store and dealers keep the baked footprints.
for(const [name,p] of Object.entries(PH_PLACES))for(const spot of p.replaces){
 const b=baked.find(b=>Math.hypot((b.site??b).x-spot[0],(b.site??b).y-spot[1])<=6);
 assert.ok(b,`${name}: a baked box still stands on its spot`);
 for(const w of baked.filter(x=>(x.buildingId??x.id)===(b.buildingId??b.id))){
  const [x,z]=toLocal(p,w.x,w.y);
  assert.ok(p.rects.some(r=>x>=r[0]-1&&x<=r[1]+1&&z>=r[2]-1&&z<=r[3]+1)||name==='gasBar',`${name}: model covers baked ${w.id}`);
 }
}
for(const [name,id] of [['hardware',36],['garage',1133]]){
 const b=baked.find(b=>b.id===id),r=PH_PLACES[name].rects[0];
 for(const [e,n] of b.footprint){const [x,z]=toLocal(PH_PLACES[name],e,n);assert.ok(Math.abs(Math.abs(x)-Math.max(-r[0],r[1]))<0.6&&Math.abs(Math.abs(z)-Math.max(-r[2],r[3]))<0.6,`${name}: corner ${e},${n} on the baked footprint`);}
}

// 2. Nothing solid stands on a road: every solid's corners keep clear of every mapped carriageway.
const near=roads.filter(r=>r.pts.some(([e,n])=>e>627900&&e<630400&&n>5051900&&n<5053300));
const roadGap=(e,n)=>Math.min(...near.flatMap(r=>r.pts.slice(1).map((q,i)=>segDist([e,n],r.pts[i],q)-r.halfWidth)));
let worst=Infinity;
const corners=s=>{const ux=Math.sin(s.heading),uz=-Math.cos(s.heading),vx=Math.cos(s.heading),vz=Math.sin(s.heading);
 return [[0,0],[-1,-1],[1,-1],[1,1],[-1,1]].map(([i,j])=>toMapW(s.x+ux*s.half*i+vx*s.halfWidth*j,s.z+uz*s.half*i+vz*s.halfWidth*j));};
for(const s of site.solids)for(const [e,n] of corners(s)){const g=roadGap(e,n);worst=Math.min(worst,g);assert.ok(g>=0.8,`solid at ${e.toFixed(1)},${n.toFixed(1)} is ${g.toFixed(2)} m from a carriageway`);}
for(const [name,p] of Object.entries(PH_ITEMS))for(const [e,n] of Array.isArray(p[0])?p:[p])assert.ok(roadGap(e,n)>=1.5,`${name} stands on a road`);
// Pads and the garage apron: every metre of their edges off the carriageways; the apron quads are convex.
const edgeSamples=q=>q.flatMap((a,i)=>{const b=q[(i+1)%q.length],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])));return Array.from({length:n},(_,k)=>[a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n]);});
const padQuads=[...PH_PADS.map(([place,x0,x1,z0,z1])=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1]].map(([x,z])=>toMap(PH_PLACES[place],x,z))),...GARAGE_APRON];
for(const q of padQuads)for(const [e,n] of edgeSamples(q))assert.ok(roadGap(e,n)>=0.5,`a pad edge at ${e.toFixed(1)},${n.toFixed(1)} on a road (${roadGap(e,n).toFixed(2)})`);
for(const q of GARAGE_APRON){const cr=q.map((a,i)=>{const b=q[(i+1)%4],c=q[(i+2)%4];return (b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);}).filter(v=>Math.abs(v)>1e-6);assert.ok(cr.every(v=>v>0)||cr.every(v=>v<0),'an apron quad is convex');}
// Nothing of the models stands in a building the site keeps (the lidar house 2383 beside the second dealer, for one).
const kept=site.buildings(baked).map(outline);
const keptHit=(p,m=0)=>kept.some(r=>inRing(p,r)||(m>0&&r.some((q,i)=>segDist(p,q,r[(i+1)%r.length])<m)));
for(const [name,p] of Object.entries(PH_PLACES))for(const r of p.rects){
 for(let x=r[0];x<=r[1]+1e-9;x+=Math.max(0.5,(r[1]-r[0])/40))for(let z=r[2];z<=r[3]+1e-9;z+=Math.max(0.5,(r[3]-r[2])/40))assert.ok(!keptHit(toMap(p,x,z)),`${name}: model inside a kept building at ${x.toFixed(1)},${z.toFixed(1)}`);
 for(const ring of kept)for(const [e,n] of ring){const [x,z]=toLocal(p,e,n);assert.ok(!(x>r[0]+0.05&&x<r[1]-0.05&&z>r[2]+0.05&&z<r[3]-0.05),`${name}: a kept building's corner inside the model`);}
}
for(const q of padQuads)for(const pt of [...edgeSamples(q),[q.reduce((s,p)=>s+p[0],0)/4,q.reduce((s,p)=>s+p[1],0)/4]])assert.ok(!keptHit(pt),`a pad lies on a kept building at ${pt}`);
for(const [name,sign] of Object.entries(PH_SIGNS)){
 assert.ok(!keptHit(sign.at,1.5)&&roadGap(...sign.at)>=1.5,`${name}: on a building or road`);
 // The sign's solid is the drawn body: same place, the drawn frame's azimuth, its half sizes.
 const w=site.world(...sign.at),hit=site.solids.filter(s=>Math.abs(s.heading-sign.az*Math.PI/180)<1e-9&&Math.hypot(s.x-w.x,s.z-w.z)<sign.halfWidth+0.01);
 assert.ok(hit.length>=1&&hit.every(s=>Math.abs(s.half-sign.half)<1e-9),`${name}: its solid follows the drawn frame`);
}
// Place vehicles: off the roads and every building and model, and none overlapping another.
// A rectangle in map metres: centre, half length along compass azimuth h (radians), half width across it.
const box=(e,n,half,hw,h)=>{const ue=Math.sin(h),un=Math.cos(h),ve=Math.cos(h),vn=-Math.sin(h);return [[1,1],[1,-1],[-1,-1],[-1,1]].map(([i,j])=>[e+ue*half*i+ve*hw*j,n+un*half*i+vn*hw*j]);};
const overlap=(a,b)=>{for(const poly of [a,b])for(let i=0;i<4;i++){const p=poly[i],q=poly[(i+1)%4],nx=q[1]-p[1],nz=p[0]-q[0];const pa=a.map(c=>c[0]*nx+c[1]*nz),pb=b.map(c=>c[0]*nx+c[1]*nz);if(Math.max(...pa)<=Math.min(...pb)+1e-6||Math.max(...pb)<=Math.min(...pa)+1e-6)return false;}return true;};
const placeCars=PLACE_VEHICLES.map(([place,x,z,az,type])=>{const p=PH_PLACES[place],[e,n]=toMap(p,x,z),[l,w]=PARKED_SIZE[type];return box(e,n,l/2,w/2,(p.az+az)*Math.PI/180);});
placeCars.forEach((c,i)=>{for(const pt of c){assert.ok(roadGap(...pt)>=0.5&&!keptHit(pt)&&!modelRects().some(r=>inRing(pt,r)),`place vehicle ${i} on a road or building`);}
 placeCars.slice(i+1).forEach((d,j)=>assert.ok(!overlap(c,d),`place vehicles ${i} and ${i+j+1} overlap`));});
function modelRects(){return Object.values(PH_PLACES).flatMap(p=>p.rects.map(r=>[[r[0],r[2]],[r[1],r[2]],[r[1],r[3]],[r[0],r[3]]].map(([x,z])=>toMap(p,x,z))));}
// The service drops of replaced buildings end on a model wall, below its top.
const props=read(AREA+'props.json').serviceDrops,aimed=aimDrops(props);
for(const [i,d] of aimed.entries()){
 if(d===props[i])continue;
 const [place]=Object.entries(PH_PLACES).find(([,p])=>p.rects.some(r=>{const [x,z]=toLocal(p,d.x,d.y);return x>=r[0]-0.3&&x<=r[1]+0.3&&z>=r[2]-0.3&&z<=r[3]+0.3;}))??[];
 assert.ok(place,`drop to ${props[i].building} ends on a model`);
 assert.ok(d.height<=(props[i].building===36?3.8:4.0)-0.3&&d.ground===null,`drop to ${props[i].building} below the wall top`);
}
assert.deepEqual(aimed.filter((d,i)=>d!==props[i]).map(d=>d.building).sort(),props.filter(d=>[36,398,103,3073,3074,1991,1133].includes(d.building)).map(d=>d.building).sort(),'every drop to a replaced box is re-aimed');
// The paved constants are the index's.
const index=read(AREA+'paved/index.json');
assert.deepEqual([index.origin,index.tileMetres,index.resolution,index.side],[PAVED_ORIGIN,PAVED_TILE,PAVED_RES,PAVED_SIDE]);

// 3. The solids push a car out anywhere inside them, and leave one 3 m beside them alone.
for(const s of site.solids){
 assert.ok(s.half>=s.halfWidth&&Math.hypot(s.half,s.halfWidth)-s.half<=CORNER_SLACK+1e-9,'solid is cut into long strips');
 const ux=Math.sin(s.heading),uz=-Math.cos(s.heading),vx=Math.cos(s.heading),vz=Math.sin(s.heading);
 for(const i of [-0.9,0,0.9])for(const j of [-0.9,0,0.9]){
  const x=s.x+ux*s.half*i+vx*s.halfWidth*j,z=s.z+uz*s.half*i+vz*s.halfWidth*j,car={x,z,vx:0,vz:0,speed:0,heading:0};
  pushOut(car,[s]);assert.ok(Math.hypot(car.x-x,car.z-z)>0.01,'a car inside a solid is pushed out');
 }
 const d=s.halfWidth+3,far={x:s.x+vx*d,z:s.z+vz*d,vx:0,vz:0,speed:0,heading:0};
 pushOut(far,[s]);assert.ok(Math.hypot(far.x-s.x-vx*d,far.z-s.z-vz*d)<1e-9,'a car beside the solid is left alone');
}

// 4. Lot paint: every line, hatch stroke, island and parked vehicle lies in its lot, on the paved layer, off every road and
// off every mapped building (the replaced ones and any big block of the land too) and every model.
const tiles=new Map();
for(const lot of Object.values(PH_LOTS))for(const k of pavedKeys(lotBox(lot)))tiles.set(k,existsSync(`${AREA}paved/${k}.r8`)?new Uint8Array(readFileSync(`${AREA}paved/${k}.r8`)):null);
const paved=pavedTest(tiles),shapes=baked.map(outline);
const inBuilding=(p,m)=>shapes.some(r=>inRing(p,r)||r.some((q,i)=>segDist(p,q,r[(i+1)%r.length])<m));
const models=Object.values(PH_PLACES).flatMap(p=>p.rects.map(r=>[[r[0],r[2]],[r[1],r[2]],[r[1],r[3]],[r[0],r[3]]].map(([x,z])=>toMap(p,x,z))));
const inModel=p=>models.some(r=>inRing(p,r));
const summary={};
for(const [ref,lot] of Object.entries(PH_LOTS)){
 const L=layoutLot(lot,site.clearance(lot,roads,baked,paved)),M=(w,u)=>lotToMap(lot,w,u);
 let onPaved=0,points=0;
 for(const [w0,u0,w1,u1] of [...L.lines,...L.hatch])for(const t of [0,0.5,1]){
  const p=M(w0+(w1-w0)*t,u0+(u1-u0)*t);points++;if(paved(p))onPaved++;
  assert.ok(inLot(p,lot.rings)||lot.rings.some(r=>r.some((q,i)=>segDist(p,q,r[(i+1)%r.length])<0.35)),`${ref}: paint outside the lot at ${p}`);
  assert.ok(roadGap(...p)>1.0,`${ref}: paint on a road at ${p} (${roadGap(...p).toFixed(2)})`);
  assert.ok(!inBuilding(p,0.25)&&!inModel(p),`${ref}: paint on a building at ${p}`);
 }
 assert.ok(onPaved/points>=0.97,`${ref}: ${onPaved}/${points} paint points on the paved layer`);
 for(const c of L.cells){
  for(const [w,u] of [[c.w0,c.u0],[c.w1,c.u0],[c.w1,c.u1],[c.w0,c.u1]]){const p=M(w+(w<(c.w0+c.w1)/2?0.3:-0.3),u+(u<(c.u0+c.u1)/2?0.3:-0.3));
   assert.ok(roadGap(...p)>1.0&&!inBuilding(p,0.5)&&!inModel(p),`${ref}: a ${c.kind} cell reaches a road or a building`);}
  if(c.parked){const [e,n]=M((c.w0+c.w1)/2,(c.u0+c.u1)/2),[len]=PARKED_SIZE[c.parked.type];assert.ok(len<=STALL_D+0.3&&roadGap(e,n)>2.0,`${ref}: a parked vehicle by a road at ${e},${n} (${roadGap(e,n).toFixed(2)})`);}
 }
 for(const [w,u] of L.poles){const p=M(w,u);assert.ok(roadGap(...p)>1.5&&!inBuilding(p,1),`${ref}: pole on a road or building`);}
 // No stall, island or line under a teardrop.
 for(const [tw,tu,tl] of L.teardrops){
  for(const c of L.cells)assert.ok(!(c.w1>tw-tl/2&&c.w0<tw+tl/2&&c.u1>tu-1.6&&c.u0<tu+1.6),`${ref}: a ${c.kind} under a teardrop`);
  for(const [w0,u0,w1,u1] of L.lines)for(const t of [0,0.5,1]){const w=w0+(w1-w0)*t,u=u0+(u1-u0)*t;assert.ok(!(w>tw-tl/2&&w<tw+tl/2&&u>tu-1.6&&u<tu+1.6),`${ref}: a line under a teardrop`);}
 }
 // Parked vehicles never overlap one another or a pole, and every pole and corral has a solid.
 const cars=L.cells.filter(c=>c.parked).map(c=>{const pose=parkedPose(lot,c),[l,wd]=PARKED_SIZE[c.parked.type];return box(...M(pose.w,pose.u),l/2,wd/2,pose.az*Math.PI/180);});
 const grid=new Map();cars.forEach((c,i)=>{const k=`${Math.floor(c[0][0]/10)}_${Math.floor(c[0][1]/10)}`;for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(const j of grid.get(`${Math.floor(c[0][0]/10)+a}_${Math.floor(c[0][1]/10)+b}`)??[])assert.ok(!overlap(c,cars[j]),`${ref}: parked vehicles ${i} and ${j} overlap`);(grid.get(k)??grid.set(k,[]).get(k)).push(i);});
 for(const [w,u] of L.poles){const p=M(w,u),pole=box(p[0],p[1],0.35,0.35,0);for(const c of cars)assert.ok(!overlap(pole,c),`${ref}: a pole stands in a parked vehicle`);}
 const ls=lotSolids(lot,L,(e,n)=>({x:e,z:-n}));
 assert.ok(ls.length>=L.poles.length+L.cells.filter(c=>['corral','shelter','arched'].includes(c.kind)).length,`${ref}: every pole and corral is solid`);
 for(let i=0;i<L.poles.length;i++)for(let j=i+1;j<L.poles.length;j++)assert.ok(Math.hypot(L.poles[i][0]-L.poles[j][0],L.poles[i][1]-L.poles[j][1])>=lot.spacing,`${ref}: poles closer than ${lot.spacing} m`);
 for(const [a,b] of L.curbs)assert.ok(roadGap((a[0]+b[0])/2,(a[1]+b[1])/2)>=2.5,`${ref}: a curb across a road`);
 const count=k=>L.cells.filter(c=>c.kind===k).length;
 summary[ref]={stalls:count('stall'),islands:count('island'),accessible:count('accessible'),poles:L.poles.length,cars:L.cells.filter(c=>c.parked).length,curbs:L.curbs.length,hatch:L.hatch.length,teardrops:L.teardrops.length};
 assert.ok(count('stall')>=100,`${ref}: ${count('stall')} stalls`);
 assert.ok(L.poles.length>=4,`${ref}: ${L.poles.length} poles`);
 if(lot.accessible)assert.equal(count('accessible'),4,`${ref}: four accessible stalls`);
 assert.equal(count('corral')+count('shelter')+count('arched'),(lot.corrals??[]).length+(lot.shelters??[]).length+(lot.arched??[]).length,`${ref}: every corral placed`);
 assert.equal(L.teardrops.length,(lot.teardrops??[]).length,`${ref}: every teardrop placed`);
}
// The hardware store has its fire lane along the front (its building stands in the land); stalls run along 25 degrees.
assert.ok(summary.P6.hatch>=60,'P6: the fire lane along the store front');
assert.equal(PH_LOTS.P6.az,25);assert.equal(STALL_W,2.7);

// 5. Every group's build probes cover its places, pads and lots (finest land present under all of them).
const fine=new Set(manifest.levels['8']),size=manifest.size/256;
for(const name of Object.keys(PH_GROUPS))for(const [e,n] of groupPoints(name)){
 const key=`${Math.floor((e-manifest.origin[0])/size)}_${Math.floor((manifest.origin[1]-n)/size)}`;
 assert.ok(fine.has(key),`${name}: finest land under ${e},${n}`);
}
// 6. The corner garage (brief section 1): its long west side faces Sydney Rd about 17 m off the carriageway edge, its
// south gable end faces Granville St.
const g=PH_PLACES.garage,westMid=toMap(g,0,-6.1),southMid=toMap(g,-9.7,0);
const named=(p,name)=>Math.min(...near.filter(r=>r.name===name).flatMap(r=>r.pts.slice(1).map((q,i)=>segDist(p,r.pts[i],q))));
const bearing=(p,name)=>{let best=null;for(const r of near.filter(r=>r.name===name))for(let i=1;i<r.pts.length;i++){const a=r.pts[i-1],b=r.pts[i],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy))),q=[a[0]+t*dx,a[1]+t*dy],d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(!best||d<best.d)best={d,az:Math.atan2(q[0]-p[0],q[1]-p[1])*180/Math.PI};}return best;};
const off=(a,b)=>Math.abs(((a-b)%360+540)%360-180);
const west=bearing(westMid,'Sydney Road'),south=bearing(southMid,'Granville Street');
assert.ok(west.d<25&&off(west.az,g.az-90)<25,`the west wall faces Sydney Rd (${west.az.toFixed(0)} vs ${g.az-90})`);
assert.ok(named(westMid,'Sydney Road')<named(westMid,'Granville Street'),'Sydney Rd is the west wall\'s road');
assert.ok(south.d<40&&off(south.az,g.az+180)<35,`the south gable faces Granville St (${south.az.toFixed(0)} vs ${g.az+180})`);
console.log(`PASS port-hawkesbury: 7 baked records replaced, ${site.solids.length} solids at least ${worst.toFixed(2)} m off every carriageway, lots ${JSON.stringify(summary)}`);
