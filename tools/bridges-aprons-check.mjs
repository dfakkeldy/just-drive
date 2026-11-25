import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {fixture,areas,dispose,root} from './bridges-fixture.mjs';
// Inspect the uncut geometry here: the new render mask must not hide a stale canopy regression.
function rawMesh(terrain,x,z){const t=terrain.find(x,z);if(!t?.mesh)return null;const p=t.mesh.geometry.getAttribute('position'),n=Math.round(Math.sqrt(p.count)),seg=n-3,fa=(x-t.x0)*seg/t.size,fb=(z-t.z0)*seg/t.size,a=Math.min(Math.floor(fa),seg-1),b=Math.min(Math.floor(fb),seg-1),u=fa-a,v=fb-b,i=(b+1)*n+a+1,h00=p.getY(i),h10=p.getY(i+1),h01=p.getY(i+n),h11=p.getY(i+n+1);return u+v<=1?h00+(h10-h00)*u+(h01-h00)*v:h11+(h01-h11)*(1-u)+(h10-h11)*(1-v);}
async function verify(replacements={},only,scale=1){
const rows=[];
for(const area of only?[only]:areas){
 const f=await fixture(area,scale,replacements),M=f.roads.modern,spans=M.spans;await f.load(spans.flatMap(r=>r.pts));
 // Use the deck footprint at the time of tile build. Bit 64 in the CPU field is a pavement or gravel flag.
 let masked=0;
 for(const t of f.terrain.tiles.values())if(t.road&&t.mesh){
  const image=t.mesh.material.uniforms.tRoad.value.image,side=image.width,step=t.size/(side-1);
  for(let k=2;k<t.road.length;k+=4){
   const raw=t.road[k],kind=raw&15,i=k>>2;
   if(kind&&M.maskPaint(t.x0+(i%side)*step,t.z0+Math.floor(i/side)*step,kind)){
    masked++;
    assert.equal(image.data[k],raw&240,'structural deck masks only the rendered bare-earth road');
   }else{
    const expected=(raw&207)===68?(raw&48)|3:raw;
    assert.equal(image.data[k],expected,'unmasked samples keep their road material');
   }
  }
 }
 assert.ok(masked>0,'real bridge road pixels were checked');
 for(const r of spans)f.roads.update(new THREE.Vector3(r.pts[0][0],20,r.pts[0][1]));
 for(const r of spans){if(!r.triangles)continue;
  let worst=0,at=0,step=0,stepAt=0;let prev=null;
  for(let s=-r.startLength;s<=r.length+r.endLength;s+=0.5){const p=M.at(r,s),h=f.roads.deckHeight(p.x,p.z);if(h==null){prev=null;continue;}
   if(prev!=null){const g=Math.abs(h-prev)/0.5;if(g>worst){worst=g;at=s;}}prev=h;}
  let triangleGrade=0;const a=r.triangles;for(let i=0;i<a.length;i+=9){const dx=a[i+3]-a[i],dz=a[i+5]-a[i+2],ex=a[i+6]-a[i],ez=a[i+8]-a[i+2],dy=a[i+4]-a[i+1],ey=a[i+7]-a[i+1],det=dx*ez-dz*ex;if(Math.abs(det)>1e-8)triangleGrade=Math.max(triangleGrade,Math.hypot((dy*ez-ey*dz)/det,(dx*ey-ex*dy)/det));}
  // compare to the approach road's own grade 16-24 m out (land)
  const lg=end=>{const a=M.at(r,end?r.length+16:-16),b=M.at(r,end?r.length+24:-24),la=f.terrain.landHeightAt(a.x,a.z),lb=f.terrain.landHeightAt(b.x,b.z);return Math.abs(la-lb)/8;};
  rows.push({area,id:r.road.id,name:r.road.name,inf:!!r.road.inferred,len:r.length,worst,triangleGrade,at,road:Math.max(lg(false),lg(true))});
 }
 for(const r of spans)for(const part of[0,2]){
  const road=(part===0?r.start?.road:r.end?.road)??r.road;M.applyDriving(r,part);
  assert.equal(M.driving.kind,road.kind,'every apron keeps its own mapped road kind');
  assert.equal(M.driving.washboard,!!(r.road.washboard||road.washboard),'every apron keeps its own washboard flag');
 }
 if(area==='mabou'){
  const r=spans.find(r=>r.road.id===57);assert.ok(r,'Mines bridge57 retained');
  for(const s of[-12,-4,r.length/2,r.length+4,r.length+12]){const p=M.at(r,s),h=f.roads.deckHeight(p.x,p.z),surface=f.terrain.surfaceAt(p.x,p.z,h);assert.equal(surface.kind,3,'Mabou Mines Road bridge57 kind');assert.equal(surface.washboard,true,'Mabou Mines Road washboard is never softened');assert.equal(f.BikeRide.prototype.surface.call({terrain:f.terrain,roads:f.roads,x:p.x,z:p.z,y:h},surface).name,'washboard','Mabou Mines Road bike remains on washboard');}
 }
 if(area==='mabou'){const r=spans.find(r=>r.road.id===954);for(let s=-12;s<=r.length+12;s+=2){const p=M.at(r,s),land=f.terrain.landHeightAt(p.x,p.z),drawn=rawMesh(f.terrain,p.x,p.z);assert.ok(drawn<=land+.5,'Mabou954 averaged canopy does not cover the bridge');}}
 // Hull clearing asks the deck site once per vertex position, as a grid (deckClearGrid). On every built tile, with the
 // decks built above, each grid answer must equal the per-point corridor test (deckClear) at that vertex.
 const site=f.terrain.sites.find(s=>s.deckClearGrid);let points=0,cleared=0;
 for(const t of f.terrain.tiles.values())if(t.mesh){
  // build()'s own grid: T sample intervals, seg mesh intervals, vertices at t.x0 + i * step * mpp.
  const T=t.mesh.material.uniforms.tNormal.value.image.width-1,seg=Math.round(Math.sqrt(t.mesh.geometry.getAttribute('position').count))-3,step=T/seg,mpp=t.size/T,pad=mpp*step*1.5;
  const xs=new Float64Array(seg+1),zs=new Float64Array(seg+1);for(let i=0;i<=seg;i++){const g=i*step;xs[i]=t.x0+g*mpp;zs[i]=t.z0+g*mpp;}
  const grid=site.deckClearGrid(xs,zs,pad);
  for(let b=0;b<=seg;b++)for(let a=0;a<=seg;a++){const want=site.deckClear(xs[a],zs[b],pad);points++;if(want)cleared++;
   if(!!grid?.[b*(seg+1)+a]!==want)assert.fail(`hull clearing grid matches the per-point corridor test (${t.level}/${t.i}_${t.j} vertex ${a},${b})`);}
 }
 assert.ok(cleared>0,'real hull clearing vertices were checked');console.log(area,'scale',scale,'hull clearing grid = per-point test at',points,'vertex positions,',cleared,'cleared');
 dispose(f);
}
rows.sort((a,b)=>b.worst-a.worst);
const n=t=>rows.filter(r=>r.worst>t).length;
console.log('scale',scale,'spans',rows.length,'max 0.5m-grade on deck+aprons: >15%',n(.15),'>25%',n(.25),'>50%',n(.5),'>100%',n(1));
for(const r of rows.slice(0,25))console.log(r.area,r.id,r.name,r.inf?'INF':'src','len',r.len.toFixed(0),'| worst grade',(100*r.worst).toFixed(0)+'%','at s=',r.at.toFixed(1),'| approach road grade',(100*r.road).toFixed(0)+'%');

if(process.env.OUT&&!Object.keys(replacements).length){const {writeFileSync}=await import('node:fs');writeFileSync(process.env.OUT+(scale===1?'/apron-grades.json':`/apron-grades-${scale}.json`),JSON.stringify(rows,null,2)+'\n');}

assert.equal(rows.filter(r=>r.worst>.25||r.triangleGrade>.25).length,0,'no bridge or apron exceeds 25% driving grade');
console.log('PASS exact contact triangle gradients <=25%; maximum',Math.max(...rows.map(r=>r.triangleGrade)));
return rows;
}
for(const scale of process.env.BRIDGE_EXAG?[Number(process.env.BRIDGE_EXAG)]:[1,1.5])await verify({},undefined,scale);
if(process.argv.includes('--mutations')){
 const file='web/src/modern-bridges.ts',source=readFileSync(root+file,'utf8');
 const relax='if(!relaxCurve&&(r.smoothStart||r.smoothEnd)&&invalid)return this.build(r,true);';assert.equal(source.split(relax).length,2);
 await assert.rejects(()=>verify({[file]:source.replace(relax,'')},'mabou',1),/no bridge or apron exceeds 25% driving grade/);console.log('KILLED fixed curve overrides bank/width grade constraint');
 const anchor='r.y0=Math.max(bank(0),bank(-3),bank(-6),bank(-8))+.04;r.y1=Math.max(bank(r.length),bank(r.length+3),bank(r.length+6),bank(r.length+8))+.04;';
 assert.equal(source.split(anchor).length,2);
 // The new Mabou land repairs the original extrapolation trigger too. Use a fixed outside-bank
 // recession so this regression remains sensitive when a map bake improves the approach road.
 const old="const fit=(end)=>{let sum=0,tilt=0;for(let d=8;d<=16;d+=2){const h=bank(end?r.length+d:-d);sum+=h;tilt+=(d-12)*h;}return sum/5-12*tilt/40;};r.y0=Math.max(bank(0),fit(false))+.04;r.y1=Math.max(bank(r.length),fit(true))+.04;";
 async function recession(replacements={}){
  const f=await fixture('mabou',1,replacements),height=(x,z)=>z>8?10-(z-8)*.4:10;
  const terrain={heightAt:height,surfaceAt:()=>({ground:10,level:8}),dataRevision:1,seaLevel:-100};
  const roads=new f.Roads({roads:[{id:1,name:'Bank recession',kind:2,halfWidth:3.6,bridge:true,pts:[[0,0],[0,40]]}]},[0,0],terrain);
  let prev=null,worst=0;for(let s=-16;s<=56;s+=.5){const h=roads.deckHeight(0,-s);if(h===null){prev=null;continue;}if(prev!==null)worst=Math.max(worst,Math.abs(h-prev)/.5);prev=h;}
  dispose(f);assert.ok(worst<=.251,'25% driving grade at a receding outside bank');
 }
 await recession();await assert.rejects(()=>recession({[file]:source.replace(anchor,old)}),/25% driving grade/,'outside slope extrapolation must fail');console.log('KILLED apron bank extrapolation');
 const wash='const wash=!!(r.road.washboard||road.washboard);';assert.equal(source.split(wash).length,2);
 await assert.rejects(()=>verify({[file]:source.replace(wash,'const wash=false;')},'mabou'),/Mabou Mines Road|every apron keeps its own washboard flag/,'softened Mines Road must fail');console.log('KILLED Mines Road washboard removed');
 const terrainFile='web/src/terrain.ts',terrain=readFileSync(root+terrainFile,'utf8');
 const mask='if (bridgePaint?.[k >> 2]) drawn = flags & 240;';assert.equal(terrain.split(mask).length,2);
 await assert.rejects(()=>verify({[terrainFile]:terrain.replace(mask,'if (bridgePaint?.[k >> 2]) drawn = flags;')},'mabou'),/rendered bare-earth road/,'road paint mask removed must fail');console.log('KILLED under-deck road paint mask removed');
 const canopy='if(c>0&&deckClear?.[k0])c=0;';assert.equal(terrain.split(canopy).length,2);
 await assert.rejects(()=>verify({[terrainFile]:terrain.replace(canopy,'')},'mabou'),/canopy does not cover/,'coarse canopy clearance removed must fail');console.log('KILLED coarse canopy clearance removed');
 const reachBox='const a0=first(xs,ax+Math.min(0,dx)-reach-slack),a1=first(xs,ax+Math.max(0,dx)+reach+slack)-1;';assert.equal(source.split(reachBox).length,2);
 await assert.rejects(()=>verify({[file]:source.replace(reachBox,'const a0=first(xs,ax+Math.min(0,dx)-reach/2-slack),a1=first(xs,ax+Math.max(0,dx)+reach/2+slack)-1;')},'mabou'),/hull clearing grid matches the per-point corridor test/,'grid that visits half the reach box must fail');console.log('KILLED hull clearing grid visits half the reach box');
 const kind="this.driving.kind=wash?road.kind:deck?(r.timber?(r.road.name==='Railroad'?road.kind:5):9):road.kind;";assert.equal(source.split(kind).length,2);
 await assert.rejects(()=>verify({[file]:source.replace(kind,"this.driving.kind=wash?road.kind:deck?(r.timber?(r.road.name==='Railroad'?road.kind:5):9):9;")},'mabou'),/every apron keeps its own mapped road kind/,'non-washboard aprons concrete must fail');console.log('KILLED non-washboard aprons concrete');

}
