// Ambient highway traffic on the real bridges of all six areas (Node, no browser; the production module on baked land).
// Every lane point, both directions, within 20 m of a bridge span: a car stands on its own highway's deck, and on the
// land (with bridge approaches) everywhere else, never on another road's deck overhead. Prints a census of each kind
// (own: a mapped bridge piece; recovered: a span carrying the highway where the map has no bridge piece).
// --mutations: "topmost deck everywhere" (the #155 rule) and "land only" must fail where real land has such a point.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {fixture,areas,dispose,root} from './bridges-fixture.mjs';

const SOURCE='web/src/ambient-traffic.ts',original=readFileSync(root+SOURCE,'utf8'),LANE=1.65,PAD=20;
// The bridge triangle grid key (modern-bridges.ts, TRI_CELL 2 m).
const key=(x,z)=>{const cx=Math.floor(x/2),cz=Math.floor(z/2),a=cx>=0?2*cx:-2*cx-1,b=cz>=0?2*cz:-2*cz-1;return(a+b)*(a+b+1)/2+b;};
function deckPart(span,x,z){
  const t=span.triangles;if(!t)return null;
  for(const k of span.cells.get(key(x,z))??[]){
    if(span.triangleDeck[k/9]!==1)continue;
    const ax=t[k],az=t[k+2],bx=t[k+3]-ax,bz=t[k+5]-az,cx=t[k+6]-ax,cz=t[k+8]-az,det=bx*cz-bz*cx;if(Math.abs(det)<1e-10)continue;
    const dx=x-ax,dz=z-az,u=(dx*cz-dz*cx)/det,v=(bx*dz-bz*dx)/det;
    if(u>=-1e-6&&v>=-1e-6&&u+v<=1.000001)return t[k+1]+u*(t[k+4]-t[k+1])+v*(t[k+7]-t[k+1]);
  }
  return null;
}
async function area(name,source=original){
  const f=await fixture(name,1,source===original?{}:{[SOURCE]:source}),m=f.roads.modern;
  const traffic=new f.AmbientTraffic(f.roads,f.terrain,false),car=traffic.cars[0],count={own:0,recovered:0,overpass:0,land:0,spans:0};
  const chains=f.highwayChains(f.roads.roads),failures=[];
  if(!m||!traffic.paths.length){dispose(f);return{name,count,failures};}
  // A span is a chain's own when it carries one of the chain's road ids; "recovered" when no piece there is a mapped bridge.
  const owns=(chain,span)=>[...chain.pieces].some(r=>span.members.has(r.id)||span.road.sourceRoad===r.id);
  const samples=[];
  for(let i=0;i<traffic.paths.length;i++){
    const path=traffic.paths[i],forward=i%2===0?path:traffic.paths[i-1];
    const chain=chains.find(c=>c.pts.length===forward.points.length&&c.pts[0]===forward.points[0]&&c.pts.at(-1)===forward.points.at(-1));assert.ok(chain,'each forward path is a highway chain');
    const length=path.cumulative.at(-1),p={x:0,z:0,heading:0};
    for(let along=0;along<=length;along+=1){path.at(along,LANE,p);
      const near=m.spans.filter(r=>p.x>=r.x0-PAD&&p.x<=r.x1+PAD&&p.z>=r.z0-PAD&&p.z<=r.z1+PAD);
      if(near.length)samples.push({path,along,chain,x:p.x,z:p.z,near});}
  }
  const used=new Set(samples.flatMap(s=>s.near));count.spans=used.size;
  for(const span of used){
    const mine=samples.filter(s=>s.near.includes(span));
    await f.load([...span.pts,...mine.filter((_,i)=>i%8===0).map(s=>[s.x,s.z])]);
    f.roads.update(new THREE.Vector3(span.pts[0][0],10,span.pts[0][1]));
  }
  for(const span of used){m.ensure(span);assert.ok(span.triangles,`${name}: span ${span.road.id} (${span.road.name}) built for the traffic samples`);}
  for(const s of samples){
    car.path=s.path;car.along=s.along;car.side=LANE;s.path.at(s.along,LANE,car.solid);car.active=true;traffic.place(car);
    const land=f.terrain.heightAt(car.solid.x,car.solid.z);
    if(land===null){failures.push(`${name}: land not loaded at ${car.solid.x.toFixed(1)},${car.solid.z.toFixed(1)}`);continue;}
    let own=null,foreign=null,ownSpan=null,foreignSpan=null;
    for(const span of s.near){const y=deckPart(span,car.solid.x,car.solid.z);if(y===null)continue;
      if(owns(s.chain,span)){if(own===null||y>own){own=y;ownSpan=span;}}else if(foreign===null||y>foreign){foreign=y;foreignSpan=span;}}
    let want=land,kind='land',span=ownSpan??foreignSpan;
    if(own!==null){want=Math.max(land,own);kind=[...s.chain.pieces].some(r=>r.bridge&&ownSpan.members.has(r.id))?'own':'recovered';}
    else if(foreign!==null&&foreign-land>1)kind='overpass';
    count[kind]++;
    if(!car.mesh.visible||Math.abs(car.y-want)>.05)failures.push(`${name}: ${kind} point${span?` on span ${span.road.id} (${span.road.name})`:''} ${s.along.toFixed(0)} m along ${s.chain.pieces.values().next().value.name}: car at ${car.y.toFixed(2)}, want ${want.toFixed(2)} (land ${land.toFixed(2)}, own ${own?.toFixed(2)}, foreign ${foreign?.toFixed(2)})`);
  }
  dispose(f);
  return{name,count,failures};
}
async function all(source){const out=[];for(const name of areas)out.push(await area(name,source));return out;}

const results=await all();
const total={own:0,recovered:0,overpass:0,land:0,spans:0};
for(const r of results){console.log(`${r.name}: ${JSON.stringify(r.count)}${r.failures.length?' FAIL '+r.failures.length:''}`);for(const k in total)total[k]+=r.count[k];for(const f of r.failures.slice(0,5))console.log('  '+f);}
const failures=results.flatMap(r=>r.failures);
assert.equal(failures.length,0,`${failures.length} traffic points off their support`);
assert.ok(total.own>500,'real own-deck traffic points were checked: '+total.own);
console.log('PASS bridges-traffic '+JSON.stringify(total));
const census={total,areas:Object.fromEntries(results.map(r=>[r.name,r.count])),mutants:[]};
const keep=()=>{if(!process.env.MMM_CHECK_OUT)return;const dir=process.env.MMM_CHECK_OUT+'/evidence/bridges-traffic';mkdirSync(dir,{recursive:true});writeFileSync(dir+'/census.json',JSON.stringify(census,null,1)+'\n');};
keep();

if(process.argv.includes('--mutations')){
  const mutants=[
    ['land only (falls through its own deck)','const top = this.roads.deckHeight(x, z);','const top = null;',true],
    ['topmost deck everywhere (the #155 rule)','if (y === null || !deck) return y;','if (y === null) return y;',total.overpass>0],
    ['recovered spans ignored','let carried = false; for (const id of run.roads) if (ids.has(id)) { carried = true; break; }','const carried = false;',total.recovered>0],
  ];
  let survived=0;
  for(const [label,from,to,required] of mutants){
    assert.equal(original.split(from).length,2,`mutant "${label}": anchor not found once`);
    if(!required){console.log(`NOTE mutant "${label}" not run: no such real point (ambient-traffic-mutations covers it)`);census.mutants.push({label,run:false});keep();continue;}
    const bad=(await all(original.replace(from,to))).flatMap(r=>r.failures);
    if(bad.length)console.log(`killed "${label}": ${bad.length} points, e.g. ${bad[0]}`);else{console.log(`FAIL mutant "${label}" survived`);survived++;}
    census.mutants.push({label,run:true,killedBy:bad.length,example:bad[0]??null});keep();
  }
  assert.equal(survived,0,'surviving mutants');
  console.log('PASS bridges-traffic mutations');
}
