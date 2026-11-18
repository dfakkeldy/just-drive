#!/usr/bin/env node
// Node-first contracts for the tall bake and the exact shared animation/wire mathematics.
import assert from 'node:assert/strict';
import {mergeFarManifest} from './far-manifest.mjs';
import { readFileSync, existsSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../web/package.json', import.meta.url));
const { transformSync, buildSync } = require('esbuild');
const source = readFileSync(root+'web/src/tall-rules.ts','utf8');
const renderer = readFileSync(root+'web/src/tall.ts','utf8');
const main = readFileSync(root+'web/src/main.ts','utf8');
function compile(s) { const module={exports:{}}; new Function('module','exports',transformSync(s,{loader:'ts',format:'cjs'}).code)(module,module.exports);return module.exports; }
const rules=compile(source);
function maths(r) {
  assert.equal(r.FAR_TURBINES,false,'mainland experiment defaults off');
  assert.ok(Math.abs(r.WIND_HEADING*180/Math.PI-247.5)<1e-8,'WSW normal');
  assert.ok(Math.abs(r.rotorRate(82)*60/(2*Math.PI)-16.303)<.01,'82 m rotor 16 rpm');
  assert.ok(Math.abs(r.rotorRate(21.5)*60/(2*Math.PI)-62.181)<.01,'small rotor about 60 rpm');
  assert.equal(r.rotorRate(40),2*r.rotorRate(80),'inverse diameter');
  assert.notEqual(r.rotorPhase(622481.64,5064994.9),r.rotorPhase(625021.44,5112048.4),'distinct seeded phases');
  const a=r.rotorAngle(82,625021.44,5112048.4,123.4);
  assert.equal(a,r.rotorAngle(82,625021.44,5112048.4,123.4),'deterministic angle');
  assert.ok(Math.abs(r.rotorAngle(82,625021.44,5112048.4,124.4)-a)>1,'moves in one second');
  assert.equal(r.wireHeight(30,40,8,.5),27,'parabolic sag');
  assert.equal(r.wireWorldHeight(30,40,8,.5,10,3,0),47,'clearance follows exaggerated land');
  assert.equal(r.wireHeight(30,40,8,0),30);assert.equal(r.wireHeight(30,40,8,1),40);
  assert.equal(r.inBox({e:1,n:1},[0,0,2,2]),true);assert.equal(r.inBox({e:3,n:1},[0,0,2,2]),false);
  assert.equal(r.pointSegment(5,3,[0,0],[10,0]),3);
  assert.equal(r.inFootprint(1,1,[[0,0],[2,0],[2,2],[0,2]]),true);
  assert.equal(r.inFootprint(3,1,[[0,0],[2,0],[2,2],[0,2]]),false);
}
maths(rules);
const read = p=>JSON.parse(readFileSync(p,'utf8'));
const work=process.env.FAR_VIEWS_BAKE??realpathSync(root+'data/baked')+'/../work/bakes/far-views';
const tallPath=area=>(area==='mabou'?'terrain':'areas/'+area);
const tallBase=area=>{const shipped=root+'data/baked/'+tallPath(area);if(!process.env.FAR_VIEWS_BAKE&&existsSync(shipped+'/tall.json')&&read(shipped+'/tall.json').version===2)return shipped;return existsSync(work+'/'+tallPath(area)+'/tall.json')?work+'/'+tallPath(area):shipped;};
const tallManifest=area=>{const live=read(root+'data/baked/'+tallPath(area)+'/manifest.json');return tallBase(area)===root+'data/baked/'+tallPath(area)?live:mergeFarManifest(live,read(tallBase(area)+'/manifest-patch.json'));};
function validate(d,manifest) {
  const positive = x=>assert.ok(Number.isFinite(x)&&x>0,'positive dimension');
  const positions = p=>{assert.ok(Number.isFinite(p.e)&&Number.isFinite(p.n),'finite position');assert.ok(p.ground===null||Number.isFinite(p.ground),'finite ground or explicit null');};
  function keys(o){if(!o||typeof o!=='object')return;for(const [k,v]of Object.entries(o)){assert.ok(!/manufacturer|model|owner|project/i.test(k),'no identity fields: '+k);keys(v);}} keys(d);
  assert.equal(d.crs,'EPSG:2961');
  const [e,n]=manifest.origin;assert.deepEqual(d.root,[e,n-manifest.size,e+manifest.size,n]);assert.deepEqual(d.mid,manifest.mid);
  for(const p of d.turbines){positions(p);assert.ok(rules.inBox(p,d.root),'turbine root bounds');}
  for(const p of d.far){positions(p);assert.ok(!rules.inBox(p,d.root),'far outside root');assert.ok(d.version===2?Math.hypot(Math.max(d.root[0]-p.e,0,p.e-d.root[2]),Math.max(d.root[1]-p.n,0,p.n-d.root[3]))<=80000.02:Math.hypot(p.e-d.anchor[0],p.n-d.anchor[1])<=75000.02,'far source coverage');}
  for(const p of [...d.turbines,...d.far]){positive(p.hub);positive(p.diameter);assert.ok(p.hub>p.diameter/2+5,'blade ground clearance');}
  for(const p of d.towers){positions(p);assert.ok(rules.inBox(p,d.mid),'mast mid bounds');assert.ok(p.height>=30&&p.height<=90,'mast invented height class');assert.notEqual(p.ground,null);}
  for(const l of d.lines){
    assert.equal(l.spans.length,l.towers.length-1,'span count');
    for(const p of l.pts)assert.ok(rules.inBox({e:p[0],n:p[1]},d.mid),'polyline mid bounds');
    for(let i=0;i<l.towers.length;i++){
      const p=l.towers[i];positions(p);assert.ok(rules.inBox(p,d.mid),'line tower mid bounds');assert.ok(p.height>=25&&p.height<=35,'power tower height');assert.notEqual(p.ground,null);
      assert.ok(l.pts.slice(1).some((q,j)=>rules.pointSegment(p.e,p.n,l.pts[j],q)<.03),'support on source polyline');
      if(!i)continue;
      const a=l.towers[i-1],len=p.station-a.station;
      assert.ok(len>0&&len<=350.03,'maximum support spacing');
      assert.ok(len>=249.97||p.reason==='bend'||p.reason==='end'||a.reason==='bend'||a.reason==='end','short span only at bend or end');
      const span=l.spans[i-1];assert.equal(span.clearance.length,span.ground.length,'three-conductor ground coverage');assert.ok(span.sag>=0&&span.sag<=8,'bounded sag');assert.ok(span.ground.length>=3,'ground samples');
      span.ground.forEach((g,j)=>{
        assert.ok(Number.isFinite(g),'finite sampled ground');
        const y=rules.wireHeight(a.ground+a.height,p.ground+p.height,span.sag,j/(span.ground.length-1));
        assert.ok(y-g>=5.99,'wire sampled ground clearance');
        for(const exag of [1,1.5,3])assert.ok(rules.wireWorldHeight(a.ground+a.height,p.ground+p.height,span.sag,j/(span.ground.length-1),g,exag,0)-(span.clearance[j]>0?span.clearance[j]*exag:span.clearance[j])>=5.99,'wire clearance with ground exaggeration');
      });
    }
    // Every source bend over 8 degrees has a support.
    for(let i=1;i+1<l.pts.length;i++){
      const [a,b,c]=l.pts.slice(i-1,i+2),u=[b[0]-a[0],b[1]-a[1]],v=[c[0]-b[0],c[1]-b[1]];
      const angle=Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v)))))*180/Math.PI;
      if(angle>8.01)assert.ok(l.towers.some(t=>Math.hypot(t.e-b[0],t.n-b[1])<.03),'sharp bend support');
    }
  }
  assert.deepEqual(manifest.tall,{file:'tall.json',turbines:d.turbines.length,...(d.version===2?{far:d.far.length}:{}),towers:d.towers.length,lines:d.lines.length},'manifest counts');
}
// Before the far pack is installed the live tall.json is the old file (no version field). The game draws only
// version 2 (main.ts below), so the old file's conflicts are listed but cannot reach a player; every version 2 conflict fails.
assert.ok(main.includes('if(data.version!==2||!sameRoot(data.root))return null;'),'the game must ignore a tall.json that is not version 2');
assert.ok(main.includes('(t && Number.isInteger(t.far) ? t : undefined)'),'only the far pack manifest key (with a far count) fetches tall.json or opens Places');
const counts=[],conflicts=[],undrawn=[];
for(const area of ['mabou','judique','porthood','pointtupper','westbay','cansocauseway']){
  const sourceDir=root+'data/baked/'+tallPath(area),dir=tallBase(area);
  assert.ok(existsSync(dir+'/tall.json'),area+' baked file');
  const d=read(dir+'/tall.json'),m=tallManifest(area);validate(d,m);
  const roads=read(sourceDir+'/roads.json').roads,buildings=read(sourceDir+'/buildings.json').buildings;
  for(const [kind,list]of [['turbine',d.turbines],['mast',d.towers],['line',d.lines.flatMap(l=>l.towers)]])for(const p of list){
    const road=roads.find(r=>r.pts.slice(1).some((b,i)=>rules.pointSegment(p.e,p.n,r.pts[i],b)<=r.halfWidth+2+(kind==='turbine'?p.hub*.023:0)));
    const building=buildings.find(b=>rules.inFootprint(p.e,p.n,b.footprint)||(kind==='turbine'&&b.footprint.some((a,i)=>rules.pointSegment(p.e,p.n,a,b.footprint[(i+1)%b.footprint.length])<=p.hub*.023+2)));
    if(road||building)(d.version===2?conflicts:undrawn).push({area,kind,e:p.e,n:p.n,...(road?{road:road.id}:{}),...(building?{building:building.id}:{})});
  }
  counts.push({area,turbines:d.turbines.length,far:d.far.length,towers:d.towers.length,lines:d.lines.length,lineTowers:d.lines.reduce((s,l)=>s+l.towers.length,0)});
  const backup=root+'data/work/map-data/tall/manifest-backups/'+area+'.json';
  if(existsSync(backup)&&d.version!==2) {const before=read(backup);assert.deepEqual({...before,tall:m.tall},m,'only tall manifest key changed: '+area);}
}
console.table(counts);
// Real mapped conflicts must be reported, never hidden by sliding a base away from its source line.
if(conflicts.length){console.log('SOURCE/PLACEMENT CONFLICTS (unchanged positions): '+JSON.stringify(conflicts));}
if(undrawn.length){console.log(`NOT DRAWN: ${undrawn.length} conflicts in a tall.json that is not version 2 (before land; the game draws only version 2): `+JSON.stringify(undrawn));}
console.log('PASS tall data, rotation, spans, sag and identity rules');
if(conflicts.length) { console.error(`FAIL tower placement: ${conflicts.length} road/building conflicts; see source positions above`); process.exitCode=1; }

// Exercise the real instanced renderer in Node, including both quality modes and fallback/loaded seating.
const input=process.env.TALL_RENDERER_BASE_REF ? {stdin:{contents:execFileSync('git',['show',process.env.TALL_RENDERER_BASE_REF+':web/src/tall.ts'],{encoding:'utf8'}),resolveDir:root+'web/src',loader:'ts'}} : {entryPoints:[root+'web/src/tall.ts']};
const code=buildSync({...input,bundle:true,platform:'node',format:'cjs',write:false,external:['three']}).outputFiles[0].text;
const mod={exports:{}};new Function('require','module','exports',code)(require,mod,mod.exports);
const THREE=require('three');
function drawing(){
  const d=read(tallBase('mabou')+'/tall.json'),m=tallManifest('mabou');
  for(const low of [false,true]){
    let loaded=false;
    const terrain={manifest:m,seaLevel:0,exag:1.5,heightAt:(x,z)=>loaded?123+x*.1+z*.2:null};
    const t=new mod.exports.TallLandmarks(d,terrain,low,{},true);
    t.update(new THREE.PerspectiveCamera(),2);
    const blades=t.group.getObjectByName('tall-rotors');assert.ok(blades?.isInstancedMesh,'instanced rotor draw');
    assert.equal(blades.count,d.turbines.length,'far not built');
    assert.ok(blades.geometry.getAttribute('motion').isInstancedBufferAttribute,'phase/rate live GPU attribute');
    assert.match(blades.material.vertexShader,/motion.x \+ motion.y \* tallTime/,'real shader rotates blades');
    assert.match(blades.material.fragmentShader,/applyFog\(colour,vWorld,cameraPosition\)/,'same land fog');
    const matrix=new THREE.Matrix4();blades.getMatrixAt(0,matrix);const before=matrix.elements[13];
    loaded=true;t.update(new THREE.PerspectiveCamera(),3);blades.getMatrixAt(0,matrix);
    const y=123+(d.turbines[0].e-m.village[0])*.1+(m.village[1]-d.turbines[0].n)*.2+d.turbines[0].hub;
    assert.ok(Math.abs(matrix.elements[13]-y)<.001,'rotor and nacelle use the tower ground sample on slopes');assert.notEqual(before,matrix.elements[13]);
    const hubMatrix=new THREE.Matrix4();t.group.children[1].getMatrixAt(0,hubMatrix);assert.equal(matrix.elements[13],hubMatrix.elements[13],'rotor stays attached to nacelle on loaded sloping land');
    const triangles=t.group.children.reduce((sum,m)=>sum+(m.isInstancedMesh?m.count:1)*(m.geometry.index?.count??m.geometry.getAttribute('position').count)/3,0);
    if(low)assert.ok(triangles<1000,'phone Mabou tall triangle ceiling (including dark beacons)');
    assert.equal(t.time.value,3);assert.equal(blades.frustumCulled,false,'no roadside cull');
    assert.equal(t.solids.length,d.turbines.length+d.towers.length+d.lines.reduce((n,l)=>n+l.towers.length,0),'solid bases including every turbine');
    for(const p of d.turbines){const solid=t.solids.find(s=>Math.hypot(s.x-(p.e-m.village[0]),s.z-(m.village[1]-p.n))<.01);assert.ok(solid,'each turbine has a solid');assert.equal(solid.half,p.hub*.023);}
    const base=t.solids[0],car={x:base.x,z:base.z,heading:0,vx:1,vz:0,speed:1};
    t.resolveSolids(car);assert.ok(Math.hypot(car.x-base.x,car.z-base.z)>.5,'real base collision pushes car out');
    for(const mesh of t.group.children){if(mesh.geometry)mesh.geometry.dispose();if(mesh.material)mesh.material.dispose();}
  }
}
drawing();
assert.match(main,/ERA.modern && tallKey/,'modern construction gate');
assert.match(main,/tall\?\.resolveSolids\(vehicle\)/,'real vehicle collision hook');
assert.match(renderer,/const steps=\(span.ground.length-1\)\*\(low\?1:2\)/,'cheap wire segments');
assert.match(renderer,/\!this.low\|\|Math.hypot\(camera.position.x-w.x,camera.position.z-w.z\)<1800\+w.radius/,'low wire distance');
console.log('PASS real renderer high/low, instancing, loaded/baked heights, fog, solids and modern integration');
if(process.argv.includes('--mutations')){
  const mutations=[
    ['far enabled','FAR_TURBINES = false','FAR_TURBINES = true'],
    ['fixed rotation rate','TIP_SPEED / (diameter / 2)','TIP_SPEED / 41'],
    ['phase shared','(h >>> 0) / 4294967296 * Math.PI * 2','0'],
    ['rotation stopped','rotorRate(diameter) * seconds','rotorRate(diameter) * 0'],
    ['sag omitted','- 4 * sag * t * (1 - t)','- 0 * sag * t * (1 - t)'],
    ['bounds ignored','p.e <= b[2]','p.e <= b[2] + 100'],
    ['footprints ignored','return hit;','return false;'],
    ['ground stretch omitted','+ stretched - ground','+ 0'],
  ];
  for(const [label,a,b]of mutations){assert.equal(source.split(a).length,2,label+' unique');assert.throws(()=>maths(compile(source.replace(a,b))),{name:'AssertionError'},label+' rejected');console.log('KILLED '+label);}
  const d=read(tallBase('mabou')+'/tall.json'),m=tallManifest('mabou');
  for(const [label,change]of [
    ['identity leak',x=>x.turbines[0].manufacturer='forbidden'],
    ['blade underground',x=>x.turbines[0].hub=1],
    ['wire underground',x=>x.lines[0].spans[0].ground[1]+=100],
    ['outside conductor underground',x=>x.lines[0].spans[0].clearance[1]+=100],
    ['counts wrong',x=>x.towers.pop()],
    ['support gap',x=>x.lines[0].towers[1].station=900],
  ]){const x=structuredClone(d);change(x);assert.throws(()=>validate(x,m),{name:'AssertionError'},label+' rejected');console.log('KILLED '+label);}
}
// Optional machine-readable receipt. No generated output or report is committed.
if(process.env.TALL_RECEIPT){mkdirSync(process.env.TALL_RECEIPT,{recursive:true});writeFileSync(process.env.TALL_RECEIPT+'/node.json',JSON.stringify({counts,conflicts},null,2));}
