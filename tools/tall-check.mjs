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
  assert.equal(r.mastLightClass(28),'A0','<=45 m steady red top');
  assert.equal(r.mastLightClass(45),'A0','45 m boundary');
  assert.equal(r.mastLightClass(46),'A1','>45 m flashing red top + steady mid');
  assert.equal(r.mastLightClass(105),'A1','105 m boundary');
  assert.equal(r.mastLightClass(125),'A2','>105 m four-level red');
  assert.equal(r.obstructionLights('A0').length,1);assert.equal(r.obstructionLights('A0')[0].kind,'red-steady');
  assert.equal(r.obstructionLights('A1').length,2);assert.equal(r.obstructionLights('A1')[0].kind,'red-flash');
  assert.equal(r.obstructionLights('A2').length,4);assert.equal(r.obstructionLights('A2')[2].kind,'red-flash');
  assert.equal(r.obstructionLights('W').length,3);assert.ok(r.obstructionLights('W').every(l=>l.kind==='white-strobe'),'Auld Cove white strobes');
  assert.equal(r.towerWidthScale(32,'standard'),32);assert.equal(r.towerWidthScale(48,'double'),36);assert.equal(r.towerWidthScale(158,'crossing'),44);
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
// Verify merged Strait of Canso crossings, restored omitted lines, road/building clearance and mast/crossing night lights.
const straitCode=buildSync({entryPoints:[root+'web/src/tall-strait.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const straitMod={exports:{}};new Function('require','module','exports',straitCode)(require,straitMod,straitMod.exports);
function checkStrait(merge){
  const mabou=read(tallBase('mabou')+'/tall.json');
  assert.equal(merge(mabou),mabou,'Mabou outside Strait bounds is unchanged');
  const porthood=read(tallBase('porthood')+'/tall.json');
  assert.equal(merge(porthood),porthood,'Port Hood outside Strait bounds is unchanged');
  for(const area of ['pointtupper','cansocauseway','westbay','judique']){
    const sourceDir=root+'data/baked/'+tallPath(area);
    const d=read(tallBase(area)+'/tall.json'),m=tallManifest(area),merged=merge(d);
    (function checkKeys(o){if(!o||typeof o!=='object')return;for(const [k,v] of Object.entries(o)){assert.ok(!/manufacturer|model|owner|project/i.test(k),'no identity fields in merged: '+k);checkKeys(v);}})(merged);
    const roads=read(sourceDir+'/roads.json').roads,buildings=read(sourceDir+'/buildings.json').buildings;
    for(const [kind,list] of [['mast',merged.towers],['line',merged.lines.flatMap(l=>l.towers)]])for(const p of list){
      const extra=kind==='line'&&p.kind==='crossing'?rules.towerWidthScale(p.height,p.kind)*.13:2;
      const road=roads.find(r=>r.pts.slice(1).some((b,i)=>rules.pointSegment(p.e,p.n,r.pts[i],b)<=r.halfWidth+extra));
      const bldg=buildings.find(b=>rules.inFootprint(p.e,p.n,b.footprint));
      assert.ok(!road&&!bldg,`${area} merged ${kind} (${p.e},${p.n}) clear of roads and buildings`);
    }
    for(const l of merged.lines){
      assert.equal(l.spans.length,l.towers.length-1,area+' merged span count');
      for(let k=0;k<l.spans.length;k++){
        const a=l.towers[k],b=l.towers[k+1],sp=l.spans[k];
        const fracA=a.kind==='crossing'||l.circuits===2?.82:1,fracB=b.kind==='crossing'||l.circuits===2?.82:1;
        sp.ground.forEach((g,j)=>{
          const t=j/(sp.ground.length-1);
          const y=rules.wireHeight(a.ground+a.height*fracA,b.ground+b.height*fracB,sp.sag,t);
          assert.ok(y-g>=5.99,`${area} ${l.ref??'legacy'} span ${k} clearance ${y-g}`);
          for(const exag of [1,1.5,3])assert.ok(rules.wireWorldHeight(a.ground+a.height*fracA,b.ground+b.height*fracB,sp.sag,t,g,exag,0)-(g>0?g*exag:g)>=5.99,`${area} ${l.ref??'legacy'} span ${k} exag ${exag}`);
        });
      }
    }
    if(area==='pointtupper'||area==='cansocauseway'){
      const l8004=merged.lines.filter(l=>l.source==='osm:w77466754');
      const l7005=merged.lines.filter(l=>l.source==='osm:w185892575');
      const causewayDouble=merged.lines.find(l=>l.source==='osm:w185892766');
      const causeway138=merged.lines.find(l=>l.source==='osm:w271063033');
      assert.ok(l8004.length&&l7005.length&&causewayDouble&&causeway138,area+' has all Strait and causeway crossings');
      assert.equal(causewayDouble.circuits,2,area+' L7004;L7003 double circuit');
      const maxSpanOf=list=>Math.max(...list.flatMap(l=>l.towers.slice(1).map((t,i)=>Math.hypot(t.e-l.towers[i].e,t.n-l.towers[i].n))));
      const maxL8004=maxSpanOf(l8004),maxL7005=maxSpanOf(l7005);
      assert.ok(maxL8004>1440&&maxL8004<1470,area+' L8004 1454 m Strait water span');
      assert.ok(maxL7005>1435&&maxL7005<1460,area+' L7005 1446 m Strait water span');
      const crossingTowers=[...l8004,...l7005].flatMap(l=>l.towers).filter(t=>t.kind==='crossing');
      assert.equal(crossingTowers.length,4,area+' four 158 m Auld Cove suspension towers');
      assert.ok(crossingTowers.every(t=>t.height===158&&t.light==='W'),area+' 158 m towers with white strobes');
      // All four misclassified NSTDB UTTO60 power towers removed from masts
      for(const [e,n] of [[620697.61,5056148.44],[620875.71,5056289.64],[621754.11,5056765.24],[623034.11,5057460.24]]){
        assert.ok(!merged.towers.some(t=>Math.hypot(t.e-e,t.n-n)<20),`${area} misclassified UTTO60 power tower (${e},${n}) removed from masts`);
      }
      // Night renderer: white strobes + red beacons at night, zero beacons in daylight, low & coarse smoke check
      const terrain={manifest:m,seaLevel:0,exag:1.5,heightAt:()=>null};
      for(const low of [false,true]){
        const dayT=new mod.exports.TallLandmarks(d,terrain,low,{},false);
        assert.equal(dayT.group.children.filter(c=>c.material?.defines?.BEACON).length,0,area+' no beacons in daylight');
        for(const mesh of dayT.group.children){mesh.geometry?.dispose();mesh.material?.dispose();}
      }
      const coarseT=new mod.exports.TallLandmarks(d,terrain,true,{},false,false,true);
      assert.equal(coarseT.group.children.length,0,area+' coarse draws nothing');
      const nightT=new mod.exports.TallLandmarks(d,terrain,false,{},true);
      const beaconMeshes=nightT.group.children.filter(c=>c.material?.defines?.BEACON);
      assert.equal(beaconMeshes.length,2,area+' turbine beacon mesh + mast/crossing beacon mesh');
      const mastLights=nightT.group.getObjectByName('tall-beacons');
      assert.ok(mastLights?.isInstancedMesh,area+' mast/crossing night beacons');
      const col=mastLights.geometry.getAttribute('beaconColor');
      let white=0,red=0;
      for(let i=0;i<mastLights.count;i++){if(col.getX(i)>0.9&&col.getY(i)>0.9&&col.getZ(i)>0.9)white++;else if(col.getX(i)>0.75&&col.getY(i)<0.05&&col.getZ(i)<0.05)red++;}
      assert.equal(white,12,area+' 4 crossing towers x 3 white strobes');
      assert.ok(red>=10,area+' linear-space red communication mast beacons');
      for(const mesh of nightT.group.children){mesh.geometry?.dispose();mesh.material?.dispose();}
    }
    if(area==='pointtupper'){
      for(const key of ['UTTR50:sha256:efbf9c0bab840efb','UTTR50:sha256:a2985e44d3528a98','UTTR50:sha256:10ea29cc1fdd9147','UTTR50:sha256:9a7bbb629102d4d5','UTTR50:sha256:a66018f870e70e61']){
        assert.ok(merged.lines.some(l=>l.source===key),'restored omitted NSTDB line '+key);
      }
    }
    // Omitted legacy lines that no OSM route replaces come back in the area they were baked for, and only there.
    const restoredHere={pointtupper:['13608c0e','ef3022bd'],cansocauseway:['5a4c3b03'],westbay:['e1de57ef','5a4c3b03'],judique:[]}[area];
    for(const ref of restoredHere)assert.ok(merged.lines.some(l=>l.ref===ref&&l.source.startsWith('UTTR50:')),area+' restored omitted line '+ref);
    if(area==='westbay'){const wider={...d,mid:[d.mid[0]-50,d.mid[1]-50,d.mid[2]+50,d.mid[3]+50]};assert.ok(!merge(wider).lines.some(l=>l.ref==='e1de57ef'),'a restored piece is drawn only for the area box it was baked for');}
    if(area==='westbay')assert.ok(merged.lines.filter(l=>l.ref==='e1de57ef'||l.ref==='5a4c3b03').reduce((s,l)=>s+l.towers.length,0)>=60,'West Bay L6537 corridor back (two NSTDB lines, 60+ supports)');
    // A baked line half covered by a new route keeps its other part: the line into the Point Tupper station.
    if(area==='pointtupper')assert.ok(merged.lines.some(l=>!l.source&&l.towers.some(t=>Math.hypot(t.e-629961,t.n-5052405)<30)),'pointtupper keeps the uncovered part of a half-replaced baked line');
    if(area==='westbay'){
      for(const src of ['osm:w77466754','osm:w269128918','osm:w269811580','osm:w271063034']){
        assert.ok(merged.lines.some(l=>l.source===src),'westbay OSM transmission line '+src);
      }
    }
    if(area==='judique'){
      assert.ok(merged.towers.some(t=>t.height===122&&t.light==='A2'),'judique upgraded 122 m A2 mast');
      assert.ok(merged.towers.some(t=>t.height===100&&t.light==='A1'),'judique upgraded 100 m A1 mast');
    }
  }
}
checkStrait(straitMod.exports.mergeStraitTall);
console.log('PASS Strait crossings, causeway lines, restored omitted lines, mast lights and white strobes');
assert.match(main,/ERA.modern && tallKey/,'modern construction gate');
// One tall contact row serves the registry and solo driving (siteContacts in main.ts).
assert.match(main,/\['tall', tallKey \? \{[^\n]*resolve: body => tall\?\.resolveSolids\(body\)/,'real vehicle collision hook');
assert.match(main,/siteContacts\.filter\(\(\[name\]\) => name === 'tall'\)\]\) if \(row\) soloContacts\.add\(row\);/,'solo driving meets the towers too');
assert.match(main,/if \(fleet \|\| quarry\) fleetContacts\.resolve\(vehicle\);\n\s*else soloContacts\.resolve\(vehicle\);/,'solo driving resolves the car against the site rows');
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
    ['mast A0 threshold broken','if (height <= 45) return \'A0\';','if (height <= 90) return \'A0\';'],
    ['white strobes replaced with red','{ frac: 1, kind: \'white-strobe\' }','{ frac: 1, kind: \'red-flash\' }'],
    ['crossing tower width uncapped','if (kind === \'crossing\') return 44;','if (kind === \'crossing\') return height;'],
  ];
  for(const [label,a,b]of mutations){assert.equal(source.split(a).length,2,label+' unique');assert.throws(()=>maths(compile(source.replace(a,b))),{name:'AssertionError'},label+' rejected');console.log('KILLED '+label);}
  assert.throws(()=>checkStrait(x=>x),{name:'AssertionError'},'Strait merge omitted rejected');console.log('KILLED Strait merge omitted');
  const straitSource=readFileSync(root+'web/src/tall-strait.ts','utf8');
  for(const [label,a,b] of [
    ['half-replaced baked line dropped whole','if (j > i && Math.max(...dist.slice(i, j + 1)) > 120) {','if (false) {'],
    ['restored piece drawn in every area','if (raw.m && !sameBox(raw.m, data.mid)) continue;',''],
    ['restored lines left out','[...STRAIT_LINES, ...RESTORED_LINES]','[...STRAIT_LINES]'],
  ]){
    assert.equal(straitSource.split(a).length,2,label+' unique');
    const code=buildSync({stdin:{contents:straitSource.replace(a,b),resolveDir:root+'web/src',loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
    const mm={exports:{}};new Function('require','module','exports',code)(require,mm,mm.exports);
    assert.throws(()=>checkStrait(mm.exports.mergeStraitTall),{name:'AssertionError'},label+' rejected');console.log('KILLED '+label);
  }
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
