// Full-width DTM/drawn clearance, real shader cut-field coverage, and canal driving.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {fixture,areas,dispose,root,line,rig,atlasRaster} from './bridges-fixture.mjs';
const predicates=new WeakMap();
function fieldAt(f,t,x,z){const r=atlasRaster(t,f.terrain.roadCuts.raster(t));if(!r)return null;let contains=predicates.get(f);if(!contains){const expression=f.TERRAIN_FRAG.match(/if\((u>=.*?1\.0)\)lowest/)[1];contains=Function('u','v','return '+expression);predicates.set(f,contains);}return f.cutRasterHeight(r,x,z,contains);}

function rawMesh(t,x,z){const p=t.mesh.geometry.getAttribute('position'),n=Math.round(Math.sqrt(p.count)),seg=n-3,fx=(x-t.x0)*seg/t.size,fz=(z-t.z0)*seg/t.size,a=Math.min(Math.floor(fx),seg-1),b=Math.min(Math.floor(fz),seg-1),u=fx-a,v=fz-b,i=(b+1)*n+a+1;return u+v<=1?p.getY(i)+(p.getY(i+1)-p.getY(i))*u+(p.getY(i+n)-p.getY(i))*v:p.getY(i+n+1)+(p.getY(i+n)-p.getY(i+n+1))*(1-u)+(p.getY(i+1)-p.getY(i+n+1))*(1-v);}
async function clearance(area,replacements={},scale=1){
 const f=await fixture(area,scale,replacements),M=f.roads.modern;await f.load(M.spans.flatMap(r=>r.pts));for(const r of M.spans)f.roads.update(new THREE.Vector3(r.pts[0][0],10,r.pts[0][1]));
 let probes=0,worst=-Infinity,clips=0,edgeGap=0,maxCut=0;
 for(const r of M.spans){assert.ok(r.triangles,'every span has a built contact grid');for(let s=-r.startLength+.002;s<=r.length+r.endLength-.002;s+=.5){const p=M.at(r,s),width=M.widthAt(r,s)-.002,cols=Math.ceil(2*width/.5);for(let j=0;j<=cols;j++){
  const u=-width+2*width*j/cols,x=p.x+p.nx*u,z=p.z+p.nz*u,h=M.ownHeight(r,x,z);if(h===null)continue;
  const survey=f.terrain.constructionHeightAt(x,z),land=f.terrain.landHeightAt(x,z),drawn=f.terrain.meshHeightAt(x,z);maxCut=Math.max(maxCut,survey-land);const approach=M.query(x,z,false,false,undefined,false,1,false);if(approach===null)assert.ok(f.terrain.heightAt(x,z)<=survey+.0001,'unreferenced structural-span queries never take a deck');else assert.ok(f.terrain.heightAt(x,z)>=approach-.05,'unreferenced approach queries stand on the road');if(s>=0&&s<=r.length)assert.ok(Math.abs(land-survey)<.0001,`${area}/${r.road.id} s=${s} u=${u}: land below a structural span is unchanged ${land}/${survey}`);probes++;worst=Math.max(worst,land-h,(drawn??land)-h);assert.ok(land-h<=.05,`${area}/${r.road.id}: land through full-width driving skin ${land-h} s=${s} u=${u}`);assert.ok(drawn===null||drawn-h<=.05,`${area}/${r.road.id}: drawn land through full-width skin ${drawn-h}`);
  if(drawn===null){clips++;const t=f.terrain.find(x,z),cut=fieldAt(f,t,x,z);assert.ok(cut!==null||rawMesh(t,x,z)<=h+.05,`${area}/${r.road.id}: exact cut index covers protruding land s=${s} u=${u}`);assert.ok(rawMesh(t,x,z)<=h+.05||cut!==null&&rawMesh(t,x,z)>cut-.035,`${area}/${r.road.id}: GPU height predicate must discard protruding raw land`);}

  if(j===Math.floor(cols/2)&&(s< -r.startLength+.5||s>r.length+r.endLength-.5))edgeGap=Math.max(edgeGap,h-land);
 }} }
 console.log(`PASS scale${scale} ${area}: ${probes} full-width probes, ${clips} drawn cuts, worst land over ${(worst*100).toFixed(3)}cm; outer centre clearance ${(edgeGap*100).toFixed(2)}cm`);dispose(f);return{area,probes,clips,worst,edgeGap,maxCut};
}
async function canal(replacements={}){
 const f=await fixture('cansocauseway',1,replacements),M=f.roads.modern,road=f.roads.roads.find(r=>r.id===35),path=line(road);const points=[];for(let s=-80;s<=path.len+80;s+=8){const p=path.at(s);points.push([p.x,p.z]);}await f.load(points);f.roads.update(new THREE.Vector3(road.pts[0][0],10,road.pts[0][1]));
 const highway=M.spans.find(r=>r.members.has(35)),rail=highway.parallel.find(r=>r.road.name==='Railroad');assert.ok(rail&&rail.narrowRail,'adjacent same-level railway gets a track-sized deck');
 let overlap=0;for(let s=0;s<path.len;s+=.5){const p=path.at(s);for(let u=-highway.width+.01;u<=highway.width-.01;u+=.25){const x=p.x+Math.cos(p.heading)*u,z=p.z+Math.sin(p.heading)*u;if(M.ownHeight(rail,x,z)!==null)overlap++;}}
 assert.equal(overlap,0,'canal road and railway driving surfaces do not overlap');
 for(const direction of[1,-1]){const start=path.at(direction>0?-35:path.len+35),heading=start.heading+(direction<0?Math.PI:0),side=2.5;const v=new f.Vehicle(rig(THREE),f.terrain,f.roads,-1000);v.assist=0;v.place(start.x+Math.cos(start.heading)*side,start.z+Math.sin(start.heading)*side,heading);v.vx=Math.sin(heading)*20;v.vz=-Math.cos(heading)*20;v.speed=20;let peak=0,support=v.y,closest=1e9;
 const random=Math.random;Math.random=()=>.5;try{for(let i=0;i<1300;i++){const g=f.roads.nearest(v.x,v.z,30,r=>r.id===35),h=g?g.heading+(direction<0?Math.PI:0):v.heading,err=Math.atan2(Math.sin(h-v.heading),Math.cos(h-v.heading));v.update(1/120,{throttle:Math.max(-1,Math.min(1,(20-v.speed)*.3)),steer:Math.max(-.5,Math.min(.5,err*2)),handbrake:false});if(!v.airborne)support=v.y;else peak=Math.max(peak,v.y-support);const centre=path.at(path.len/2);closest=Math.min(closest,Math.hypot(v.x-centre.x,v.z-centre.z));}}finally{Math.random=random;}
 assert.ok(closest<5,'drive completes the canal span at lane offset');assert.ok(peak<.35,`canal 2.5m lane offset must not hop onto railway: ${peak}`);console.log(`PASS canal lane 2.5m at20m/s dir${direction}: peak ${peak.toFixed(5)}m`);
 }
 dispose(f);
}
for(const scale of process.env.BRIDGE_EXAG?[Number(process.env.BRIDGE_EXAG)]:[1,1.5]){const rows=[];for(const area of areas.filter(a=>!process.env.BRIDGE_AREA||a===process.env.BRIDGE_AREA))rows.push(await clearance(area,{},scale));if(process.env.OUT)writeFileSync(process.env.OUT+(scale===1?'/full-width-clearance.json':`/full-width-clearance-${scale}.json`),JSON.stringify(rows,null,2)+'\n');}await canal();
if(process.argv.includes('--mutations')){
 const file='web/src/modern-bridges.ts',source=readFileSync(root+file,'utf8'),anchor='if(t.width>width){t.width=width;t.narrowRail=rail;t.forceBuild=true;t.revision=-1;this.runList=null;this.invalidateNeighbors(t,fromBaked);}';assert.equal(source.split(anchor).length,2);
 await assert.rejects(()=>canal({[file]:source.replace(anchor,'')}),/track-sized deck|surfaces do not overlap|must not hop/,'old overlapping canal decks must fail');console.log('KILLED canal width ownership removed');
 const terrain='web/src/terrain.ts',text=readFileSync(root+terrain,'utf8'),cut='return cut!==null&&height>cut-.035?null:height;';assert.equal(text.split(cut).length,2);
 await assert.rejects(()=>clearance('judique',{[terrain]:text.replace(cut,'return height;')}),/drawn land through full-width skin/,'coarse land must not poke through');console.log('KILLED coarse terrain road-skin cut removed');
}
