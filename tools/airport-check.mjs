import assert from 'node:assert/strict';
import { AirportSite, runwayFrame } from '../web/src/airport-site.ts';
import { AIRPORT } from '../web/src/airport-source.ts';
const check = data => {
  const f=runwayFrame(data.runway), expected=[[626370.897,5057168.646],[627880.627,5057192.745]];
  for(let i=0;i<2;i++)assert.ok(Math.hypot(data.runway.ends[i][0]-expected[i][0],data.runway.ends[i][1]-expected[i][1])<3,'source endpoint');
  assert.ok(Math.abs(f.heading-89.0855)<.2,'grid heading');
  assert.equal(data.runway.width,45.72);
  assert.ok(Math.abs(f.length-1509.922)<1,'mapped length, not tagged length');
  const site=new AirportSite([628151.016,5052750.5],data);
  assert.equal(site.airportMarkings,true,'airport tiles compile the AIRPORT markings');
  // The literal site box must hold every painted source point, or a moved point would be cut off silently.
  for(const pt of [...data.runway.ends,...data.apron.points,...data.taxiways.flatMap(t=>t.points)]){
    const x=pt[0]-628151.016,z=5052750.5-pt[1];
    assert.ok(x>=site.box[0]&&x<=site.box[2]&&z>=site.box[1]&&z<=site.box[3],'source point inside site box');
  }
  for(let i=1;i<100;i++){
    const e=data.runway.ends[0][0]+f.ux*f.length*i/100,n=data.runway.ends[0][1]+f.un*f.length*i/100;
    const x=e-628151.016,z=5052750.5-n;
    assert.equal(site.surface(x,z)?.kind,13,'paved runway');
    assert.equal(site.height(x,z,104.25),104.25,'no ground displacement');
  }
};
check(AIRPORT);
if(process.argv.includes('--mutations'))for(const name of ['end','heading','width','outside']){
 const d=structuredClone(AIRPORT); if(name==='end')d.runway.ends[0][0]+=10;
 if(name==='heading')d.runway.ends[1][1]+=100;
 if(name==='width')d.runway.width=42.672;
 if(name==='outside')d.apron.points[0][1]+=400;
 assert.throws(()=>check(d),undefined,`survived ${name}`);console.log(`killed ${name}`);
}
console.log('airport source and surface PASS');
// Compare every candidate against the shipped land, never an aerial image.
const {readFileSync,existsSync}=await import('node:fs');
const {png}=await import('./quarry-height-read.mjs');
const root=process.env.MMM_ROOT,base=`${root}/data/baked/areas/pointtupper`,manifest=JSON.parse(readFileSync(`${base}/manifest.json`));
const cache=new Map();
function ground(e,n){
 for(let l=8;l>=5;l--){const size=65536/2**l,i=Math.floor((e-591500)/size),j=Math.floor((5103332-n)/size),path=`${base}/${l}/${i}_${j}.png`;
  if(!existsSync(path))continue;
  if(!cache.has(path))cache.set(path,png(readFileSync(path)));
  const {pixels:p}=cache.get(path),x=Math.round((e-591500-i*size)/size*256),y=Math.round((5103332-n-j*size)/size*256),k=(y*257+x)*4;
  return {height:(p[k]*256+p[k+1])*.01-100,canopy:p[k+2]*.2,level:l};
 }
 throw Error('missing baked land');
}
const [a,b]=AIRPORT.runway.ends,samples=[];
for(let i=0;i<=40;i++){
 const p=[a[0]+(b[0]-a[0])*i/40,a[1]+(b[1]-a[1])*i/40];
 assert.ok(p[0]>manifest.mid[0]&&p[0]<manifest.mid[2]&&p[1]>manifest.mid[1]&&p[1]<manifest.mid[3],'middle bounds');
 const g=ground(...p);assert.ok(g.height>95&&g.height<120,'baked airport elevation');assert.ok(g.canopy<1.5,'clear runway land');samples.push(g);
}
for(const f of [AIRPORT.apron,...AIRPORT.taxiways])for(const p of f.points){const g=ground(...p);assert.ok(g.canopy<1.5,`bare pavement OSM ${f.osm}`);}
const buildings=JSON.parse(readFileSync(`${base}/buildings.json`)).buildings;
// Match by position, not record number: a rebake of the area (big buildings, the project brief) may renumber records.
const keptBuildings=[];
for(const f of AIRPORT.hangars){const p=f.points.slice(0,-1),e=p.reduce((s,p)=>s+p[0],0)/p.length,n=p.reduce((s,p)=>s+p[1],0)/p.length;
 const b=buildings.filter(b=>Math.hypot(b.x-e,b.y-n)<15).sort((a,c)=>Math.hypot(a.x-e,a.y-n)-Math.hypot(c.x-e,c.y-n))[0];
 assert.ok(b,`keep the baked hangar at OSM ${f.osm}`);assert.ok(b.eave>2&&b.ridge>b.eave,'measured heights');keptBuildings.push(b.id);}
const {potholeDensity}=await import('../web/src/defects.ts');assert.equal(potholeDensity(13,false),0);
console.log(JSON.stringify({runwayGround:samples.map(x=>+x.height.toFixed(2)),minimumLevel:Math.min(...samples.map(x=>x.level)),keptBuildings,canvecRejected:AIRPORT.comparison.canvec.featureId}));
console.log('airport baked alignment PASS');
const {Airport}=await import('../web/src/airport.ts');
let loaded=false;
const terrain={dataRevision:1,drawnRevision:'a',uniforms:{airportFrame:{value:{set(){}}},airportSize:{value:{set(){}}}},meshHeightAt:()=>loaded?104:null};
const model=new Airport(new AirportSite(manifest.village),terrain,true);
const site=model.site,near={x:(site.box[0]+site.box[2])/2,z:(site.box[1]+site.box[3])/2},far={x:site.box[2]+3100,z:near.z};
const batches=model.group.children.filter(x=>x.isInstancedMesh);assert.equal(batches.length,3);
const lit=()=>batches.reduce((s,b)=>s+b.count,0);
model.update(near);assert.equal(lit(),0,'no lights before land');
loaded=true;terrain.dataRevision++;model.update(near);assert.equal(lit(),68);
assert.ok(model.group.children.at(-1).visible,'sock grounded after land');
console.log('airport model placement PASS');
loaded=false;terrain.drawnRevision='b';model.update(near);assert.equal(lit(),0,'camera turns away without a data build');
loaded=true;terrain.drawnRevision='a';model.update(near);assert.equal(lit(),68,'camera turns back to cached land');
const {Matrix4}=await import('../web/node_modules/three/build/three.module.js');
terrain.meshHeightAt=()=>107;terrain.drawnRevision='c';model.update(near);const matrix=new Matrix4();batches[0].getMatrixAt(0,matrix);
assert.ok(Math.abs(matrix.elements[13]-107.38)<.001,'cached LOD height follows drawn land without a data build');
// Unchanged drawn land: no refit and no instance upload.
let reads=0;terrain.meshHeightAt=()=>(reads++,107);const versions=batches.map(b=>b.instanceMatrix.version);
model.update(near);assert.equal(reads,0,'unchanged land reads no heights');assert.deepEqual(batches.map(b=>b.instanceMatrix.version),versions,'unchanged land uploads nothing');
terrain.drawnRevision='d';model.update(far);assert.equal(model.group.visible,false,'hidden beyond 3 km');assert.equal(reads,0,'far camera reads no heights');
model.update(near);assert.ok(model.group.visible&&reads===69,'near again: one refit');
console.log('airport camera/LOD lifecycle PASS');
const {rawProgram}=await import('../web/src/eras/cart-programs.ts');
const shader=rawProgram(readFileSync(`${root}/web/src/shaders.ts`,'utf8'),'TERRAIN_FRAG');
assert.ok(shader.includes('float airportPaint'),'era literal builder resolves airport helper');
const {BikeRide}=await import('../web/src/bike-ride.ts');
const bikeSurface=BikeRide.prototype.surface.call({terrain:{cartRoads:false},roads:{deckHeight:()=>null}}, {kind:13,roadDist:0,halfWidth:2,canopy:0});
assert.equal(bikeSurface.rough,0,'bike runway has no gravel bumps');
assert.equal(bikeSurface.name,'pavement');
