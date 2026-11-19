#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync,realpathSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {preprocess} from './coast-programs.mjs';
import {farPack} from './far-pack.mjs';
import {landState} from './far-delta-check.mjs';
import {writeFileSync} from 'node:fs';
const require=createRequire(new URL('../web/package.json',import.meta.url)),{buildSync,transformSync}=require('esbuild'),THREE=require('three');
const root=resolve(import.meta.dirname,'..');
const read=p=>JSON.parse(readFileSync(p,'utf8')),source=p=>readFileSync(root+'/'+p,'utf8');
const compile=s=>{const m={exports:{}};new Function('module','exports',transformSync(s,{loader:'ts',format:'cjs'}).code)(m,m.exports);return m.exports;};
const mathsSource=source('web/src/far-rules.ts'),rules=compile(mathsSource),measurements=read(root+'/pipeline/far-views-points.json');
const allAreas=['mabou','judique','porthood','pointtupper','westbay','cansocauseway'];
const areaDir=a=>bake+'/'+(a==='mabou'?'terrain':'areas/'+a);
const part=process.argv.find(a=>a.startsWith('--part='))?.slice(7)??'all',mutations=process.argv.includes('--mutations');
const bake=['all','budgets'].includes(part)?farPack(root):null;
let killed=0;
function reject(label,f){assert.throws(f,undefined,label);console.log('KILLED',label);killed++;}
function dataValid(d){
 assert.equal(d.crs,'EPSG:2961');assert.ok(d.points.length>=39);assert.match(d.method,/positions from satellite images, towers assumed/);
 const ids=new Set();
 for(const p of d.points){
  assert.ok(!ids.has(p.id));ids.add(p.id);assert.equal(p.source,'Sentinel-2 L2A');assert.equal(p.dateKind,'acquired');assert.match(p.date,/^202[56]-\d\d-\d\d$/);assert.equal(p.confidence,'medium');assert.equal(p.uncertainty,30);
  assert.match(p.evidence,/gravel pad.*access road/);assert.ok(p.hub>p.diameter/2+5);
  const scene=d.scenes[p.scene];assert.ok(scene);const b=p.window??scene.window;
  assert.equal(p.e,b[0]+(p.pixel[0]+.5)*scene.resolution,'Sentinel-derived easting');assert.equal(p.n,b[3]-(p.pixel[1]+.5)*scene.resolution,'Sentinel-derived northing');
  assert.match(scene.datetime,/^202[56]-/);assert.ok(Object.values(scene.assets).every(u=>u.startsWith('https://sentinel-cogs.s3.us-west-2.amazonaws.com/')));
 }
 assert.equal(d.points.filter(p=>p.farm==='c01').length,16,'sixteen independently read pads');
}
function glslDrop(r,distance){
 const expression=r.CURVE_GLSL.match(/return ([^;]+);/)[1].replaceAll('dot(delta,delta)','distance*distance').replaceAll('max(','Math.max(');
 const smoothstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
 return new Function('distance','d','smoothstep','step','return '+expression)(distance,distance,smoothstep,(a,x)=>x>=a?1:0);
}
function curves(r){
 assert.ok(Math.abs(r.curvatureDrop(10000)-6.827813530058)<1e-9);assert.ok(Math.abs(r.curvatureDrop(30000)-61.450321770523)<1e-9);assert.ok(Math.abs(r.curvatureDrop(60000)-245.80128708209)<1e-8);
 for(const d of [0,1,1500,2999,3000])assert.equal(r.renderDrop(d),0,'near coordinates exact');
 assert.ok(r.renderDrop(3001)>0&&r.renderDrop(4999)<r.renderDrop(5000));
 assert.ok(Math.abs(r.renderDrop(60000)-(r.curvatureDrop(60000)-r.curvatureDrop(3000)))<1e-8);
 for(const d of [3000,3500,4000,5000,30000])assert.ok(Math.abs(glslDrop(r,d)-r.renderDrop(d))<1e-7,'GLSL blend at '+d);
 for(const h of [2,700,2000,10000,100000])assert.ok(r.curvatureDrop(r.seaRadius(h))-r.curvatureDrop(3000)>h,'sea extends below the horizon');
 assert.deepEqual(r.worldRoot([591500,5070564,657036,5136100],[624271,5103301]),[-32771,-32799,32765,32737]);
}
function visibility(r,fixture){
 assert.equal(fixture.rows.length,10);assert.equal(fixture.k,r.REFRACTION_K);
 for(const row of fixture.rows){
  assert.equal(r.sightline(row.observer[2],row.point[2],row.distance,row.profile),row.visible,row.view+' / '+row.target);
  assert.ok(Math.abs(r.curvatureDrop(row.distance)-row.drop)<.002,'sightline uses same curvature');
  assert.equal(r.sightline(row.observer[2],row.renderedTarget,row.distance,row.renderedProfile),row.renderedVisible,'rendered curve agrees');
  assert.equal(row.renderedVisible,row.visible,'rendered and physical target visibility match');
 }
 assert.equal(fixture.rows.find(x=>x.view==='Mabou highlands'&&x.target==='PEI east end').visible,true);
 assert.equal(fixture.rows.find(x=>x.view==='Mabou harbour mouth'&&x.target==='PEI east end').visible,false);
 assert.equal(r.sightline(2,300,30000,[[1000,100]]),false,'a real near hill blocks a tall distant target');
 assert.equal(r.sightline(300,60,60000,[[10000,0],[20000,0],[30000,0],[40000,0],[50000,0]]),true,'elevated observer sees over curved sea');
}
function credits(text){
 for(const line of [
  '<p>Source: Natural Resources Canada, Canadian Wind Turbine Database. Contains information licensed under the Open Government Licence – Canada.</p>',
  '<p>Contains modified Copernicus Sentinel data 2026.</p>',
  '<p>Far land and turbine ground heights: Natural Resources Canada, Medium Resolution Digital Elevation Model (MRDEM-30 DTM). Contains information licensed under the Open Government Licence – Canada.</p>',
 ])assert.equal(text.split(line).length,2,'required credit exactly once: '+line);
}
function buildModule(path,change){
 const result=buildSync({stdin:{contents:change??source(path),resolveDir:root+'/web/src',loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,external:['three']});
 const m={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,m,m.exports);return m.exports;
}
const bytesFor=g=>Object.values(g.attributes).reduce((s,a)=>s+a.array.byteLength,0)+(g.index?.array.byteLength??0);
function validateBudget(meta,bytes,low,triangleLimit=low?75000:180000){
 const l=meta.levels[low?'low':'desktop'];assert.equal(l.bytes,bytes.length);assert.equal(l.bytes,l.vertices*12+l.indices*4);assert.equal(l.indices,l.triangles*3);assert.ok(l.triangles<=triangleLimit,'far land triangle budget');assert.ok(l.bytes<=(low?1600000:3400000),'far land byte budget');
 assert.equal(createHash('sha256').update(bytes).digest('hex'),l.sha256);
 const p=new Float32Array(bytes.buffer,bytes.byteOffset,l.vertices*3),indices=new Uint32Array(bytes.buffer,bytes.byteOffset+l.vertices*12,l.indices);
 for(let i=0;i<p.length;i+=3){assert.ok(Number.isFinite(p[i])&&Number.isFinite(p[i+1])&&Number.isFinite(p[i+2]));const e=p[i]+meta.origin[0],n=meta.origin[1]-p[i+2];assert.ok(e<=meta.root[0]+.1||e>=meta.root[2]-.1||n<=meta.root[1]+.1||n>=meta.root[3]-.1,'no far land inside root');}
 for(const i of indices)assert.ok(i<l.vertices);
}
function seaPins(vert,frag,query,transformVertex,transformFragment){
 const rows=[];for(const [name,body,flags]of [
  ['FAR_SEA_VERT',transformVertex(vert),[]],['FAR_SEA_VERT',transformVertex(vert),['LOW']],['FAR_SEA_VERT',transformVertex(vert),['SEA_WATER']],
  ['FAR_SEA_FRAG',transformFragment(frag),['LOW']],['FAR_SEA_FRAG',transformFragment(frag),['SEA_WATER']],['FAR_SEA_QUERY_FRAG',transformFragment(query),[]],
 ])rows.push({name,flags,sha256:createHash('sha256').update(preprocess(body,flags).replace(/\s+/g,' ').trim()).digest('hex')});
 const path=root+'/tools/baseline/far-sea-programs.json';if(process.argv.includes('--update-sea-pins'))writeFileSync(path,JSON.stringify({version:1,programs:rows},null,2)+'\n');
 assert.deepEqual(read(path),{version:1,programs:rows},'complete generated sea colour/query programs stay pinned');
 return rows;
}
// Data-free: the far sea rewrite must still apply to the live sea shaders, whatever land is installed.
function seaRewrites(edit=v=>v){
 const {farSeaVertex,farSeaFragment}=buildModule('web/src/far-land.ts'),shaders=buildModule('web/src/shaders.ts'),{SEA_FRAG,SEA_QUERY_FRAG}=shaders,SEA_VERT=edit(shaders.SEA_VERT);
 seaPins(SEA_VERT,SEA_FRAG,SEA_QUERY_FRAG,farSeaVertex,farSeaFragment);
 assert.match(farSeaVertex(SEA_VERT),/if \(seaPatch > 0.5\)/);assert.match(farSeaFragment(SEA_FRAG),/flatRange > 3064.0 : flatRange < 3002.0/);assert.doesNotMatch(farSeaVertex(SEA_VERT),/gl_Position.z = seaPatch < 0.5/,'near clip coordinates stay original');assert.match(farSeaVertex(SEA_VERT),/if \(seaPatch > 0.5\) gl_Position.z = min/,'only far patch clamps at far plane');assert.match(preprocess(farSeaFragment(SEA_FRAG),['LOW']),/gl_FragCoord.w\*min\(radial,3000.0\)\/3000.0/,'LOW near depth ends at the local disc, not infinity');
 console.log('PASS far sea rewrite applies to the live sea shaders; generated programs match their pins');
}
async function budgets(){
 const {FarTurbines,farmPhase}=buildModule('web/src/far-turbines.ts'),{FarLand,seaGeometry,farSeaVertex,farSeaFragment}=buildModule('web/src/far-land.ts');const {SEA_FRAG,SEA_VERT,SEA_QUERY_FRAG}=buildModule('web/src/shaders.ts');
 const {TallLandmarks}=buildModule('web/src/tall.ts');
 const summary=[];
 for(const area of allAreas){
  const dir=areaDir(area),t=read(dir+'/tall.json'),m=read(dir+'/far-land.json');
  for(const p of [...t.turbines,...t.far]){assert.ok(['NRCan','Sentinel-2 L2A'].includes(p.source));assert.match(p.date,/^202[56]-\d\d-\d\d$/);assert.ok(['medium','high'].includes(p.confidence));assert.equal(p.dateKind,p.source==='NRCan'?'retrieved':'acquired');assert.ok(Number.isFinite(p.ground));assert.ok(p.hub>p.diameter/2+5);assert.ok(p.farm);}
  for(const low of [false,true]){
   const l=m.levels[low?'low':'desktop'],bytes=readFileSync(dir+'/'+l.file);validateBudget(m,bytes,low);
   const turbines=new FarTurbines(t.far,m.origin,low,{},true);assert.equal(turbines.group.children.length,2,'one far body draw plus one night light draw');
   const body=turbines.group.children[0],beacons=turbines.group.children[1];assert.ok(body.isInstancedMesh&&beacons.isInstancedMesh);assert.equal(body.count,t.far.length);assert.equal(body.geometry.getAttribute('position').count/3,low?27:38);assert.equal(beacons.geometry.getAttribute('position').count/3,2);
   assert.equal(body.material.depthTest,true);assert.equal(body.material.depthWrite,true);assert.match(body.material.vertexShader,/w.y -= farDrop/);assert.match(body.material.vertexShader,/cos\(angle\)/);assert.match(beacons.material.fragmentShader,/if \(vFlash < 0.5\) discard/);
   const phases=body.geometry.getAttribute('farmPhase');t.far.forEach((p,i)=>assert.ok(Math.abs(phases.getX(i)-farmPhase(p.farm))<1e-7,'farm-synchronised phase'));
   const oldFetch=globalThis.fetch;globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
   let land;try{land=await FarLand.load(m,'http://fixture',low?'low':'desktop',{});}finally{globalThis.fetch=oldFetch;}
   assert.equal(land.group.children.length,1);assert.equal(land.land.material.depthTest,true);assert.equal(land.land.material.depthWrite,true);assert.match(land.land.material.vertexShader,/w.y -= farDrop/);
   const seaTriangles=land.seaGeometry.index.count/3;assert.equal(seaTriangles,low?7170:26626);
   const original=new THREE.PlaneGeometry(600000,600000).rotateX(-Math.PI/2);assert.deepEqual(Array.from(land.seaGeometry.attributes.position.array.slice(0,12)),Array.from(original.attributes.position.array),'exact original plane vertices');assert.deepEqual(Array.from(land.seaGeometry.index.array.slice(0,6)),Array.from(original.index.array),'exact original plane indices');original.dispose();
   const local={};for(const dark of [false,true]){
    const near=new TallLandmarks(t,{manifest:{village:m.origin},seaLevel:0,exag:1,heightAt:()=>null},low,{},dark,false);
    const visible=near.group.children.filter(c=>c.visible);local[dark?'night':'day']={draws:visible.length,triangles:visible.filter(c=>c.isMesh).reduce((n,c)=>n+(c.geometry.index?.count??c.geometry.attributes.position.count)/3*(c.isInstancedMesh?c.count:1),0),lineSegments:visible.filter(c=>c.isLineSegments).reduce((n,c)=>n+c.geometry.attributes.position.count/2,0),bufferBytes:near.group.children.reduce((n,c)=>n+bytesFor(c.geometry)+(c.instanceMatrix?.array.byteLength??0),0)};
    for(const c of near.group.children){c.geometry.dispose();c.material.dispose();}
   }
   summary.push({area,detail:low?'LOW':'desktop',nearLandmarksAtVillage:local,landTriangles:l.triangles,landBytes:l.bytes,seaTriangles,seaBytes:bytesFor(land.seaGeometry),turbines:t.far.length,turbineTriangles:t.far.length*((low?27:38)+2),turbineBytes:turbines.group.children.reduce((s,c)=>s+bytesFor(c.geometry)+c.instanceMatrix.array.byteLength,0),draws:{land:1,seaIncludingNear:1,additionalSeaDraws:0,turbinesDay:1,turbinesNight:2}});
   land.seaGeometry.dispose();for(const g of [...land.group.children,...turbines.group.children]){g.geometry.dispose();g.material.dispose();}
  }
  // The phone's Coarse far views (Settings > Advanced): the third level, a coarser sea, and every turbine in one draw.
  if(m.levels.coarse){
   const l=m.levels.coarse,bytes=readFileSync(dir+'/'+l.file);
   assert.equal(l.file,'far-land-coarse.bin');assert.equal(l.cell,1920);assert.equal(l.bytes,bytes.length);assert.equal(l.bytes,l.vertices*12+l.indices*4);assert.equal(l.indices,l.triangles*3);
   assert.equal(createHash('sha256').update(bytes).digest('hex'),l.sha256,'coarse level hash');assert.ok(l.triangles<=12000,'coarse far land triangle budget');assert.ok(l.bytes<=260000,'coarse far land byte budget');
   const oldFetch=globalThis.fetch;globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
   let land;try{land=await FarLand.load(m,'http://fixture','coarse',{});}finally{globalThis.fetch=oldFetch;}
   assert.equal(land.level,'coarse');const seaTriangles=land.seaGeometry.index.count/3;assert.equal(seaTriangles,3074,'coarse sea');
   const all=[...t.turbines,...t.far];
   for(const dark of [false,true]){const turbines=new FarTurbines(all,m.origin,true,{},dark,true);assert.equal(turbines.group.children.length,dark?2:1,'coarse: one turbine draw, a second only at night');assert.equal(turbines.count,all.filter(p=>p.ground!==null).length);for(const g of turbines.group.children){g.geometry.dispose();g.material.dispose();}}
   summary.push({area,detail:'LOW coarse',landTriangles:l.triangles,landBytes:l.bytes,seaTriangles,turbines:all.length,draws:{land:1,turbinesDay:1,turbinesNight:2,nearLandmarks:0}});
   land.seaGeometry.dispose();land.land.geometry.dispose();land.land.material.dispose();
  }
 }
 console.log(JSON.stringify(summary));return summary;
}
if(['all','data'].includes(part)){
 dataValid(measurements);console.log('PASS sourced turbine measurements');
 if(mutations)for(const [label,change] of [['source',d=>d.points[0].source='EA'],['date',d=>d.points[0].date='unknown'],['confidence',d=>delete d.points[0].confidence],['pad centre',d=>d.points[0].e+=10]]){const d=structuredClone(measurements);change(d);reject(label,()=>dataValid(d));}
}
if(['all','curvature'].includes(part)){
 curves(rules);console.log('PASS curvature sink 10/30/60 km = 6.827814 / 61.450322 / 245.801287 m; exact zero <=3 km');
 if(mutations)for(const [label,a,b] of [['refraction','REFRACTION_K = 0.13','REFRACTION_K = 0'],['linear drop','distance * distance * CURVATURE','distance * CURVATURE'],['near bend','CURVE_START = 3_000','CURVE_START = 0']]){assert.ok(mathsSource.includes(a));reject(label,()=>curves(compile(mathsSource.replace(a,b))));}
 if(mutations){for(const [label,value] of [['GLSL blend removed','1.0'],['GLSL hard step','step(3000.0,d)']])reject(label,()=>curves({...rules,CURVE_GLSL:rules.CURVE_GLSL.replace('smoothstep(3000.0,5000.0,d)',value)}));}
 const shaders=buildModule('web/src/shaders.ts');for(const name of ['TERRAIN_VERT','MIRROR_TERRAIN_VERT'])assert.match(shaders[name],/float drop = farDrop\(w.xz - cameraPosition.xz\) \* farCurveOn/);
}
if(['all','visibility'].includes(part)){
 const fixture=read(root+'/tools/far-views-visibility.json');visibility(rules,fixture);console.log('PASS five-view PEI/Cape George geometry table');
 if(mutations){const d=structuredClone(fixture);d.rows[0].visible=!d.rows[0].visible;reject('visibility table',()=>visibility(rules,d));reject('ignore hills',()=>visibility({...rules,sightline:()=>true},fixture));reject('hide all targets',()=>visibility({...rules,sightline:()=>false},fixture));}
}
if(['all','budgets'].includes(part)){
 // Before install (tools/far-delta-check.mjs: no far file and no far key in any area) nothing far is drawn, so there
 // is no pack to budget. Any partial install still throws; set FAR_VIEWS_BAKE to measure a pack before install.
 seaRewrites();
 if(mutations)reject('live sea vertex shader edited',()=>seaRewrites(v=>v.replace('  gl_Position = projectionMatrix * viewMatrix * w;','  gl_Position = projectionMatrix * (viewMatrix * w);')));
 if(!bake&&!process.env.FAR_VIEWS_BAKE&&existsSync(root+'/data/baked/terrain/manifest.json')&&landState(root+'/data/baked')==='before'){
  console.log('PASS far budgets: before land, no far pack installed and nothing far drawn; pack budgets NOT MEASURED (set FAR_VIEWS_BAKE=<pack> to measure one)');
  if(mutations)console.log('NOT RUN pack budget mutants (before land, no pack); sea pin and rewrite checks above did run');
 }
 else{
 if(!bake){console.error('CANNOT RUN far budgets: no promoted v2 pack or rehearsal pack; set FAR_VIEWS_BAKE');process.exit(2);}
 await budgets();console.log('PASS all-area indexed meshes, bounds, budgets and real two-draw turbine renderer');
 if(mutations){const m=read(areaDir('mabou')+'/far-land.json'),l=m.levels.desktop,b=readFileSync(areaDir('mabou')+'/'+l.file);assert.throws(()=>validateBudget(m,b,false,l.triangles-1),/far land triangle budget/);console.log('KILLED triangle budget (only limit changed; metadata, bytes and hash valid)');killed++;const corrupt=Buffer.from(b);corrupt[5]^=255;reject('mesh bytes',()=>validateBudget(m,corrupt,false));}
 }
}
if(['all','credits'].includes(part)){
 const text=source('web/src/credits.ts');credits(text);assert.match(source('web/src/title.ts'),/\$\{FAR_CREDITS\}/);assert.match(source('tools/about-pages.mjs'),/\$\{FAR_CREDITS\}/);console.log('PASS NRCan, MRDEM OGL-Canada and Copernicus credits');
 if(mutations)for(const s of ['Canadian Wind Turbine Database','Contains modified Copernicus Sentinel data 2026','Medium Resolution Digital Elevation Model (MRDEM-30 DTM)'])reject('missing credit '+s,()=>credits(text.replace(s,'')));
}
if(mutations)console.log('PASS mutants killed',killed);
