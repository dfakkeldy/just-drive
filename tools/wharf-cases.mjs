import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {Terrain} from '../web/src/terrain.ts';
import {WHARF_SOURCES} from '../web/src/wharf-source.ts';
import {PT_FEATURES} from '../web/src/pt-infrastructure-source.ts';
import {planWharf,buildingBlocker} from '../web/src/wharf-plan.ts';
import {PublicWharves} from '../web/src/wharves.ts';
import {decodeDensityPng} from './era-density-ground.mjs';
import './wharf-check.mjs';
const root=process.env.WHARF_ROOT;
globalThis.__wharfPng=(base,path)=>{
 const p=decodeDensityPng(readFileSync(base+'/'+path)),rgba=new Uint8ClampedArray(p.width*p.height*4);
 for(let i=0;i<p.width*p.height;i++){rgba.set(p.data.subarray(i*p.channels,i*p.channels+3),i*4);rgba[i*4+3]=255;}
 return rgba;
};
THREE.TextureLoader.prototype.load=()=>new THREE.Texture();
// Independent angle-sum polygon oracle; no production containment helper.
function contains(outline,e,n){
 let angle=0;
 for(let i=1;i<outline.length;i++){
  const [a,b]=outline[i-1],[c,d]=outline[i];
  angle+=Math.atan2((a-e)*(d-n)-(b-n)*(c-e),(a-e)*(c-e)+(b-n)*(d-n));
 }
 return Math.abs(angle)>Math.PI;
}
// Independent distance to a building footprint: 0 inside (angle-sum oracle), else distance to the nearest side.
function clearance(f,e,n){
 const ring=[...f,f[0]];if(contains(ring,e,n))return 0;let best=Infinity;
 for(let i=1;i<ring.length;i++){const [a,b]=ring[i-1],[c,d]=ring[i],dx=c-a,dy=d-b,t=Math.max(0,Math.min(1,((e-a)*dx+(n-b)*dy)/(dx*dx+dy*dy||1)));best=Math.min(best,Math.hypot(a+dx*t-e,b+dy*t-n));}
 return best;
}
const totals=[];let otherQuarter=0,lodSwitch=0,quarterOnly=0,pierCases=0;
for(const area of [...new Set(WHARF_SOURCES.map(s=>s.area))]){
 const base=root+'/data/baked/'+(area==='mabou'?'terrain':'areas/'+area),manifest=JSON.parse(readFileSync(base+'/manifest.json'));
 const footprints=JSON.parse(readFileSync(base+'/buildings.json')).buildings.map(b=>b.footprint);
 for(const hill of [1,1.5,2.5]){
  const terrain=new Terrain(manifest,base,{},hill,-.2,[]),keys=new Set();
  const sources=WHARF_SOURCES.filter(s=>s.area===area);
  for(const s of sources)for(let i=1;i<s.outline.length;i++){
   const [a,b]=s.outline[i-1],[c,d]=s.outline[i],steps=Math.ceil(Math.hypot(c-a,d-b)/8);
   for(let j=0;j<=steps;j++)for(const de of [-4,4])for(const dn of [-4,4]){
    const e=a+(c-a)*j/steps+de,n=b+(d-b)*j/steps+dn;
    for(const l of Object.keys(manifest.levels).map(Number).sort((a,b)=>b-a)){
     const size=manifest.size/2**l,key=Math.floor((e-manifest.origin[0])/size)+'_'+Math.floor((manifest.origin[1]-n)/size);
     if(manifest.levels[l].includes(key)){keys.add(l+'/'+key);break;}
    }
   }
  }
  for(const key of keys){const [l,i,j]=key.split(/[\/_]/).map(Number);await terrain.loadNow(l,i,j);const tile=terrain.tile(l,i,j);tile.mesh.visible=true;tile.mesh.material.uniforms.hideQuad.value.set(0,0,0,0);}
  terrain.group.updateMatrixWorld(true);
  const ground=(e,n)=>terrain.meshHeightAt(e-manifest.village[0],manifest.village[1]-n,true);
  const ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0));
  for(const source of sources){
   const placements=planWharf(source,ground,-.2,buildingBlocker(source.outline,footprints));
   const sheds=footprints.filter(f=>f.some(([e,n])=>source.outline.some(([a,c])=>Math.hypot(e-a,n-c)<400)));
   assert.ok(placements.length>0,source.id+' must have supported dressing at every hill');
   for(const p of placements){
    assert.ok(contains(source.outline,p.e,p.n),source.id+' off source polygon');
    assert.ok(p.height>.099,source.id+' water');
    ray.ray.origin.set(p.e-manifest.village[0],1000,manifest.village[1]-p.n);
    const hit=ray.intersectObject(terrain.group,true)[0];assert.ok(hit,'actual land mesh');
    assert.ok(Math.abs(hit.point.y-p.height)<.002,source.id+' floats or sinks '+JSON.stringify({p,ray:hit.point.y,tile:hit.object.name}));
    assert.ok(p.lift===0 || p.kind==='trap'&&p.lift===.72,'only stacked traps have lift');
    assert.ok(sheds.every(f=>clearance(f,p.e,p.n)>=.59),source.id+' '+p.kind+' inside or against a building');
   }
   if(hill===1.5)totals.push({area,id:source.id,parts:placements.length,kinds:[...new Set(placements.map(p=>p.kind))]});
  }
  const kit=new PublicWharves(area,terrain,manifest.village,-.2,footprints),s=sources[0],p=s.outline[0],camera=new THREE.Vector3(p[0]-manifest.village[0],10,manifest.village[1]-p[1]);
  kit.update(camera);
  const indices=new Map(),matrix=new THREE.Matrix4(),point=new THREE.Vector3();
  for(const p of kit.placements){
   assert.ok(footprints.every(f=>Math.hypot(f[0][0]-p.e,f[0][1]-p.n)>400||clearance(f,p.e,p.n)>=.59),'kit part inside or against a building');
   const mesh=kit.batches.get(p.kind),i=indices.get(p.kind)??0;indices.set(p.kind,i+1);mesh.getMatrixAt(i,matrix);
   point.set(0,0,0).applyMatrix4(matrix);
   assert.ok(Math.abs(point.x+manifest.village[0]-p.e)<.003&&Math.abs(manifest.village[1]-point.z-p.n)<.003,'instance coordinates preserve east/north');
   assert.ok(Math.abs(point.y-p.height-p.lift)<.00001,'instance lift');
   if(p.kind==='edge'){
    mesh.geometry.computeBoundingBox();point.set(0,mesh.geometry.boundingBox.max.y,0).applyMatrix4(matrix);assert.ok(point.y-ground(p.e,p.n)>.12,'curb top is exposed');
    const positions=mesh.geometry.getAttribute('position');
    for(let v=0;v<positions.count;v++)if(Math.abs(positions.getY(v)-.2)<.00001){
     point.fromBufferAttribute(positions,v).applyMatrix4(matrix);const e=point.x+manifest.village[0],n=manifest.village[1]-point.z,g=ground(e,n);
     assert.ok(contains(WHARF_SOURCES.find(s=>s.id===p.source).outline,e,n),'curb corner inside source');
     assert.ok(g!==null&&point.y-g>.035&&point.y-g<.4,'curb corners follow drawn slope');
    }
   }
   if(['pole','trap','buoy'].includes(p.kind)){
    mesh.geometry.computeBoundingBox();const positions=mesh.geometry.getAttribute('position'),bottom=mesh.geometry.boundingBox.min.y;
    for(let v=0;v<positions.count;v++)if(Math.abs(positions.getY(v)-bottom)<.00001){
     point.fromBufferAttribute(positions,v).applyMatrix4(matrix);
     const e=point.x+manifest.village[0],n=manifest.village[1]-point.z;
     assert.ok(contains(WHARF_SOURCES.find(s=>s.id===p.source).outline,e,n),'working gear footprint in source');
     assert.ok(Math.abs(point.y-p.lift-ground(e,n))<.065,'working gear feet touch ground');
    }
   }
   if(p.kind==='ladder'||p.kind==='tyre'){
    point.set(0,0,-1).applyMatrix4(matrix);
    const e=point.x+manifest.village[0],n=manifest.village[1]-point.z;
    assert.ok(!contains(WHARF_SOURCES.find(s=>s.id===p.source).outline,e,n),'hardware outside source edge');
    assert.ok(ground(e,n)<.101,'hardware hangs over water, not dirt');
    mesh.geometry.computeBoundingBox();
    assert.ok(Math.abs(mesh.geometry.boundingBox.max.y-.2)<=.101,'hardware top meets curb');
    const edge=kit.placements.find(q=>q.kind==='edge'&&q.source===p.source&&Math.hypot(q.e-p.e,q.n-p.n)<.001);
    assert.ok(edge,'mount has a curb');
    const positions=mesh.geometry.getAttribute('position');let attached=false;
    const edgeMatrix=new THREE.Matrix4();kit.batches.get('edge').getMatrixAt(kit.placements.filter(q=>q.kind==='edge').indexOf(edge),edgeMatrix);edgeMatrix.invert();
    for(let v=0;v<positions.count;v++){
      point.fromBufferAttribute(positions,v).applyMatrix4(matrix).applyMatrix4(edgeMatrix);
      if(Math.abs(point.x)<=.5+.05/edge.length&&Math.abs(point.z)<=.17&&point.y>=-.17&&point.y<=.25)attached=true;
    }
    assert.ok(attached,'mounting bracket intersects the real curb face');
   }
  }
  // Refresh: no re-plan without a drawn change; kept while its land is not drawn (camera turned away); a quarter
  // switch under a wharf re-plans it, and restoring it gives the same parts.
  const planned=kit.plans,count=kit.placements.length;
  assert.ok(planned>0&&count>0);
  kit.update(camera);assert.equal(kit.plans,planned,'no re-plan without a drawn change');
  const drawn=[...keys].map(k=>{const [l,i,j]=k.split(/[\/_]/).map(Number);return terrain.tile(l,i,j);}).filter(t=>t?.mesh?.visible);
  for(const t of drawn)t.mesh.visible=false;
  kit.update(camera);assert.equal(kit.placements.length,count,'parts kept while their land is not drawn');assert.equal(kit.plans,planned);
  for(const t of drawn)t.mesh.visible=true;
  kit.update(camera);assert.equal(kit.plans,planned,'turning back to the same drawn land does not re-plan');
  const [pe,pn]=s.outline[0],px=pe-manifest.village[0],pz=manifest.village[1]-pn;
  const under=drawn.find(t=>px>=t.x0&&px<t.x0+t.size&&pz>=t.z0&&pz<t.z0+t.size);assert.ok(under,'a drawn tile under the first wharf');
  // Another quarter of the same tile, clear of every wharf box: no re-plan.
  const boxes=sources.map(w=>{const xs=w.outline.map(p=>p[0]-manifest.village[0]),zs=w.outline.map(p=>manifest.village[1]-p[1]);return [Math.min(...xs)-3,Math.min(...zs)-3,Math.max(...xs)+3,Math.max(...zs)+3];});
  const mid=under.size/2,free=[0,1,2,3].find(q=>{const qx=under.x0+(q&1)*mid,qz=under.z0+(q>>1)*mid;return boxes.every(b=>qx>b[2]||qx+mid<b[0]||qz>b[3]||qz+mid<b[1]);});
  if(free!==undefined){
   const v=under.mesh.material.uniforms.hideQuad.value;v.setComponent(free,1);kit.update(camera);assert.equal(kit.plans,planned,'a quarter change away from the wharves does not re-plan');v.setComponent(free,0);kit.update(camera);assert.equal(kit.plans,planned);
   otherQuarter++;
  }
  // Only the hidden mask changes: the first wharf's quarter of a drawn tile hides, then shows again. While other
  // land under that wharf stays drawn, each step re-plans it; if none does, its parts are kept as they were.
  {
   const q=(px>=under.x0+under.size/2?1:0)+(pz>=under.z0+under.size/2?2:0),v=under.mesh.material.uniforms.hideQuad.value,before=kit.plans;
   v.setComponent(q,1);kit.update(camera);
   const stillDrawn=terrain.drawnOver(...boxes[0])!=='',hidden=kit.plans;
   if(stillDrawn){assert.ok(hidden>before,'hiding the quarter under a wharf re-plans it');quarterOnly++;}
   else assert.equal(hidden,before,'nothing drawn under the wharf: parts kept');
   v.setComponent(q,0);kit.update(camera);
   if(stillDrawn)assert.ok(kit.plans>hidden,'showing the quarter again re-plans it');
   assert.equal(kit.placements.length,count,'same parts after the quarter returns');
  }
  // A real LOD switch: the coarser parent draws the land instead of this tile, then this tile again.
  if(under.level>0){
   await terrain.loadNow(under.level-1,under.i>>1,under.j>>1);const parent=terrain.tile(under.level-1,under.i>>1,under.j>>1);
   parent.mesh.material.uniforms.hideQuad.value.set(0,0,0,0);parent.mesh.visible=true;under.mesh.visible=false;
   kit.update(camera);assert.ok(kit.plans>planned,'an LOD switch under a wharf re-plans it');
   parent.mesh.visible=false;under.mesh.visible=true;
   kit.update(camera);assert.equal(kit.placements.length,count,'restored land gives the same parts');
   lodSwitch++;
  }
  assert.equal(kit.batches.size,7);assert.ok([...kit.batches.values()].every(m=>m.isInstancedMesh));
  assert.equal(new Set([...kit.batches.values()].map(m=>m.material)).size,1,'one material');
  for(const mesh of kit.batches.values())if(mesh.count){assert.ok(mesh.boundingSphere);assert.ok(mesh.count<=mesh.instanceMatrix.count);}
  // Point Tupper's OSM pier decks (pt-infrastructure, 2 m wide, not on LOW) run along the Port Hawkesbury wharf:
  // no kit part may stand within 1.5 m of a pier's centre line (closest today: about 15 m).
  if(area==='pointtupper'){
   const piers=PT_FEATURES.filter(f=>f.kind==='pier').map(f=>f.outline);
   const lineGap=(e,n)=>Math.min(...piers.flatMap(l=>l.slice(1).map(([c,d],i)=>{const [a,b]=l[i],dx=c-a,dy=d-b,t=Math.max(0,Math.min(1,((e-a)*dx+(n-b)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(a+dx*t-e,b+dy*t-n);})));
   assert.ok(sources.some(w=>w.outline.some(([e,n])=>lineGap(e,n)<2)),'a pier runs along a mapped wharf');
   assert.ok(kit.placements.length>0);
   for(const p of kit.placements)assert.ok(lineGap(p.e,p.n)>=1.5,p.source+' '+p.kind+' on a pier deck');
   pierCases++;
  }
  camera.x+=100000;kit.update(camera);assert.ok([...kit.batches.values()].every(m=>!m.visible&&m.count===0),'distance removal');
  for(const tile of terrain.group.children){tile.geometry?.dispose();tile.material?.dispose();}
 }
}
assert.ok(otherQuarter>0&&lodSwitch>0&&quarterOnly>0&&pierCases>0,'the away-quarter, quarter-only and LOD-switch cases ran');
console.log(JSON.stringify(totals,null,2));
console.log('PASS all source polygons, three hills, independent production terrain rays, seven instance batches and distance removal');
