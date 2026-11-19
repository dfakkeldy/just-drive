import {withoutFarBend} from './far-shader-compat.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {glslRule} from './paved-glsl.mjs';
import {build} from '../web/node_modules/esbuild/lib/main.js';
const root=process.env.MMM_ROOT??process.cwd(),mutation=process.argv.includes('--mutation')?process.argv[process.argv.indexOf('--mutation')+1]:null;
const changes={
 C1:['paved-shader.ts','  canopy *= 1.0-hardPaved;\n','','tall canopy'],
 C2:['paved-shader.ts','  canopy *= 1.0-hardPaved;','  canopy *= 1.0-0.5*hardPaved;','tall canopy'],
 G2:['paved.ts',"index.source!=='nstdb-designated-open-v1'",'!index.source','source guard'],
 SHOULDER:['paved-shader.ts','    shoulder *= 1.0-hardPaved;','','paved junction shoulder'],
 SOURCE:['paved.ts',"  if(index.area!==area||index.source!=='nstdb-designated-open-v1')throw Error('Paved source/area mismatch');",'','source guard'],
 NOISE:['paved-shader.ts','*4.0*v*(1.0-v)','+0.3','unknown cells must stay bare'],
 EDGE:['paved-shader.ts','smoothstep(0.25,0.75,v+.3*(vnoise(p*.6)-.5)*4.0*v*(1.0-v))','step(.5,v)','polygon edge blend'],
 GRAVEL:['paved.ts','this.pixels[k]=v===1?255:0;this.pixels[k+1]=v===2?255:0;','this.pixels[k]=v>0?255:0;this.pixels[k+1]=0;','gravel channel'],
 STALLSIDE:['paved.ts','dz:-(n1-n0)/len','dz:(n1-n0)/len','stall row world direction'],
 STALLNEAR:['paved.ts','.sort((a,b)=>a.d-b.d)','.sort((a,b)=>b.d-a.d)','nearest stall rows'],
 VERGE:['paved-shader.ts','  fade *= 1.0-0.7*smoothstep(0.0,0.5,max(lotNear.r,lotNear.g))*pavedCarFade(base.xz);\n','','mown verge'],
 CREDIT:['title.ts',"${paved ? PAVED_CREDIT : ''}",'','credit missing when on'],
 TREE:['paved-weight.ts','if(data[r*128+c])return true;','if(false)return true;','tree root cut'],
 M1:['paved.ts','e.data![r*SIDE+c]','e.data![(SIDE-1-r)*SIDE+c]','atlas orientation'],
 M2:['paved-weight.ts','f={x:fract(qx),y:fract(qz)}','f={x:1-fract(qx),y:fract(qz)}','east edge'],
 M3:['paved-shader.ts','hardPaved=cls==4.0?0.0:pavedWeight(p)','hardPaved=pavedWeight(p)','water guard'],
 W1:['paved-shader.ts',"  return replace(out,'    albedo *=","  out=replace(out,'    albedo = mix(albedo, surface, onRoad * roadPaint);','    albedo = vec3(.1);');\n  return replace(out,'    albedo *=",'native lane paint'],
 W2:['paved.ts','Math.min(30000,1000*2**(e.attempts-1))','1000*2**(e.attempts-1)','retry cap'],
 W3:['paved-shader.ts','dx=p.x-pavedCar.x, dz=p.y-pavedCar.y','dx=p.x+pavedCar.x, dz=p.y+pavedCar.y','ground car fade'],
 W4:['paved-weight.ts','*(1-smooth(380,480,Math.hypot(x-carX,z-carZ)))','','CPU car fade'],
 W5:['paved-shader.ts',"  return replace(out,'    albedo *=","  out=replace(out,'    albedo = mix(albedo, surface, onRoad * roadPaint);','    albedo = mix(albedo,vec3(.1),onRoad);');\n  return replace(out,'    albedo *=",'native lane paint'],
 W6:['paved-shader.ts',"  return replace(out,'    albedo *=","  out=replace(out,'    albedo = mix(albedo, surface, onRoad * roadPaint);','    albedo = mix(albedo,vec3(.1),pavedCarFade(p));');\n  return replace(out,'    albedo *=",'native lane paint'],
 M5:['paved.ts','this.index.origin[1]-this.vy+z','this.index.origin[1]-this.vy-z','tile name'],
 OPTIN:['main.ts','','','default-on gate'],
 NOOFF:['main.ts','','','default-on gate'],
 NODATA:['main.ts','','','default-on gate'],
};
const bundle=await build({stdin:{contents:"export {Paved,classTile,loadPaved} from './web/src/paved';export {pavedGroundShader,PAVED_SAMPLE,pavedGrassShader} from './web/src/paved-shader';export {pavedWeight,pavedTreeCell} from './web/src/paved-weight';export {createTitle} from './web/src/title';export {TERRAIN_FRAG} from './web/src/shaders';",resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',plugins:[{name:'actual-paved-source',setup(b){
 b.onResolve({filter:/^three$/},()=>({path:pathToFileURL(root+'/web/node_modules/three/build/three.module.js').href,external:true}));
 b.onLoad({filter:/\/(?:paved(?:-shader|-weight)?|title)\.ts$/},a=>{let s=readFileSync(a.path,'utf8');if(mutation&&a.path.endsWith('/'+changes[mutation][0])){const [,from,to]=changes[mutation];assert.equal(s.split(from).length,2);s=s.replace(from,to);}return {contents:s,loader:'ts'};});
}}]});
const {Paved,classTile,loadPaved,pavedGroundShader,pavedGrassShader,PAVED_SAMPLE,pavedWeight,pavedTreeCell,createTitle,TERRAIN_FRAG}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
let main=readFileSync(root+'/web/src/main.ts','utf8');
if(mutation==='OPTIN')main=main.replace("params.get('paved') !== '0' && (!!manifest.paved || params.get('paved') === '1')","params.get('paved') === '1'");
if(mutation==='NOOFF')main=main.replace("params.get('paved') !== '0' && (","(");
if(mutation==='NODATA')main=main.replace("(!!manifest.paved || params.get('paved') === '1')","true");
if(['OPTIN','NOOFF','NODATA'].includes(mutation))assert.notEqual(main,readFileSync(root+'/web/src/main.ts','utf8'),'gate mutant applies');
const criterion=main.match(/\/\/ Open designated pavement[^\n]*\n[^\n]*\nif \(([^\n]*)\) \{\n  terrain\.paved = /)[1];
const enabled=new Function('ERA','AREA','params','manifest','return '+criterion);
// Default on where the area's bake lists the layer; paved=0 is the way out; no data means no request unless forced.
for(const area of ['pointtupper','mabou','westbay','judique','porthood','cansocauseway'])for(const modern of [true,false])for(const installed of [true,false])for(const flag of [null,'0','1','true']){
 const p=new URLSearchParams();if(flag!==null)p.set('paved',flag);
 const manifest=installed?{paved:{file:'paved/index.json',tiles:1,source:'nstdb-designated-open-v1'}}:{};
 assert.equal(!!enabled({modern},{id:area},p,manifest),modern&&flag!=='0'&&(installed||flag==='1'),'default-on gate');
}
const element=()=>({innerHTML:'',setAttribute(){},appendChild(){},focus(){},addEventListener(){},querySelector(){return element();},classList:{add(){}}});
let titleRoot;globalThis.document={head:element(),body:{appendChild(root){titleRoot=root;}},createElement:element};
for(const on of [false,true]){
 createTitle(false,()=>{},'explore','Mabou',undefined,false,true,undefined,on);
 const credit=titleRoot.innerHTML.match(/<p id="nsPavedCredit">(.*?)<\/p>/)?.[1] ?? '';
 assert.equal(!!credit,on,'credit missing when on');
 if(on){assert.ok(credit.includes('Contains information licensed under the Open Government Licence – Nova Scotia'));assert.ok(credit.includes('https://support.novascotia.ca/services/open-data-portal-licence'),'credit link');}
 assert.ok(!titleRoot.innerHTML.includes('nsLidarCredit'));
}
delete globalThis.document;
const edgeBody=PAVED_SAMPLE.match(/float edge=([^;]+);/)[1].replaceAll('vnoise(p*.6)','noise');
const edgeRule=new Function('v','noise','smoothstep','step','return '+edgeBody);
const ss=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
assert.equal(edgeRule(0,1,ss,(a,b)=>b<a?0:1),0,'unknown cells must stay bare at every noise value');
assert.equal(edgeRule(1,0,ss,(a,b)=>b<a?0:1),1,'paved cell interiors must stay covered');
// The laid edge spans the middle half of a 2 m cell (about 1 m) at neutral noise: crisp enough to read as a lot.
for(const v of [.1,.25,.4,.5,.6,.75,.9])assert.ok(Math.abs(edgeRule(v,.5,ss,(a,b)=>b<a?0:1)-ss(.25,.75,v))<1e-9,'polygon edge blend must span 1 m');
const roots=new Uint8Array(16384);roots[10*128+10]=1;
assert.ok(pavedTreeCell(roots,21,21),'tree root cut');assert.ok(pavedTreeCell(roots,23,21),'tree root cut margin');assert.ok(!pavedTreeCell(roots,27,21));assert.ok(!pavedTreeCell(null,21,21));
assert.ok(readFileSync(root+'/web/src/trees.ts','utf8').includes('if (pavedTreeCell(pavedMask,x-x0,z-z0)) continue;'),'production tree planting cut');
// The shared committed pin (tools/baseline/programs.json) includes the reviewed bridge cuts (#156), so it replaces
// main's merge-base pin, which that PR fails on purpose. It hashes the non-coast program variants with comments
// stripped: an unreviewed change to those fails before any mutant. COAST_SHORE code is not hashed here (see
// coast-source-check). The patch below must leave the native lane block byte-identical.
const {checkShaderBaseline}=await import(pathToFileURL(root+'/tools/coast-programs.mjs').href);
checkShaderBaseline(readFileSync(root+'/web/src/shaders.ts','utf8'),{report:()=>{}});
// Main's off-mode comparison against the merge base, with this PR's marked modern road blocks removed from both
// sides (the merge base has none), as the era and quarry checks do.
const base=execFileSync('git',['merge-base','HEAD','origin/main'],{cwd:root,encoding:'utf8'}).trim();
const source=execFileSync('git',['show',base+':web/src/shaders.ts'],{cwd:root,encoding:'utf8'});
const shaderTools=await import(pathToFileURL(root+'/tools/coast-programs.mjs').href);
const unmarked=text=>text.replace(/\/\* MODERN_ROAD_(?:CUT|PAINT)_BEGIN \*\/[\s\S]*?\/\* MODERN_ROAD_(?:CUT|PAINT)_END \*\//g,'').replaceAll(' * roadPaint','');
const currentShader=readFileSync(root+'/web/src/shaders.ts','utf8');
for(const {name,flags}of shaderTools.coastPrograms().filter(p=>!p.flags.includes('GROUND_CLASSES')&&!p.flags.includes('AIRPORT')&&!p.flags.includes('ROAD_PAVEMENT'))){
 assert.equal(shaderTools.normalized(shaderTools.preprocess(unmarked(shaderTools.program(shaderTools.withoutFarBend(shaderTools.reviewedMirrorCrown(currentShader)),name)),flags)),
              shaderTools.normalized(shaderTools.preprocess(unmarked(shaderTools.program(shaderTools.withoutFarBend(shaderTools.reviewedMirrorCrown(source)),name)),flags)),
              'off compiled shader equals merge base except the pinned distant bend and the marked bridge blocks: '+name+' '+flags);
}
const on=pavedGroundShader(TERRAIN_FRAG);assert.ok(on.indexOf('float hardPaved=')>on.indexOf('groundColor(p'));
assert.ok(on.indexOf('float hardPaved=')<on.indexOf('// ---- roads: painted'));assert.ok(on.includes('ring *= 1.0-hardPaved;'));
const canopyOp=on.match(/canopy \*= [^;]*hardPaved;/)?.[0]??'';
const canopyRun=new Function('canopy','let hardPaved=1;'+canopyOp+';return canopy;');
for(const height of [4,12,20,25])assert.equal(canopyRun(height),0,'tall canopy must clear completely');
const roadBlock=s=>s.slice(s.indexOf('// ---- roads: painted'),s.indexOf('// ---- brooks:'))
 .replace(/    \/\/ PAVED_APRON:[^\n]*\n    if\(hardPaved>0.0&&rkind>2.5&&rkind<4.5\)surface=mix\(surface,pavedLotAsphalt\(p\),hardPaved\);\n/,'')
 .replace(/    \/\/ LOT_GRAVEL:[^\n]*\n    if\(lotGravel>0.0&&rkind>2.5&&rkind<4.5\)surface=mix\(surface,pavedLotGravel\(p\),min\(lotGravel\/max\(1.0-hardPaved,0.001\),1.0\)\);\n/,'')
 .replace('    shoulder *= 1.0-hardPaved;\n','').replace(/\n\s*\n/g,'\n');
assert.equal(roadBlock(on),roadBlock(TERRAIN_FRAG),'native lane paint remains byte-identical; no lane conversion');
// Execute the production shoulder operations in their actual order, not a string pin.
const shoulderOps=on.slice(on.indexOf('// ---- roads: painted'),on.indexOf('// ---- brooks:')).split('\n').filter(line=>/^\s*shoulder \*= .*hardPaved;/.test(line)||/^\s*albedo = mix\(albedo, gravel, shoulder/.test(line)).join('\n');
const paint=new Function('hardPaved', 'let shoulder=1,albedo=0,gravel=1,rkind=3,roadPaint=1;const mix=(a,b,t)=>a*(1-t)+b*t,step=(a,b)=>b<a?0:1;'+shoulderOps+'\n;return albedo;');
assert.equal(paint(1),0,'paved junction shoulder must not paint gravel');assert.ok(paint(0)>.8);
assert.ok(PAVED_SAMPLE.includes('smoothstep(380.0,480.0'));
const grass=pavedGrassShader('void main() {\n  vec2 toCar = x;\n}');
assert.ok(grass.includes('fade *= 1.0-step(0.01,max(lotHere.r,lotHere.g));'),'grass stays off asphalt and gravel lots');
assert.ok(grass.includes('fade *= 1.0-0.7*smoothstep(0.0,0.5,max(lotNear.r,lotNear.g))'),'mown verge');
assert.ok(!grass.includes('fwidth'),'the grass vertex program has no derivatives');
// Execute the actual emitted terrain guard expression with the independent CPU sampler.
const guard=on.match(/float hardPaved=([^;]+);/)[1],actualGuard=new Function('cls','pavedWeight','p','return '+guard);
const stripe=new Uint8Array(16);for(let y=0;y<4;y++)stripe[y*4+1]=1;
const sample=(x,z,cls=3,carX=0,carZ=0)=>pavedWeight(stripe,4,4,x,z,cls,carX,carZ,.5);
assert.ok(Math.abs(sample(2.3,3)-.896)<1e-6,'east edge: left half-cell blend');assert.ok(Math.abs(sample(3.7,3)-.896)<1e-6,'east edge: right half-cell blend');
assert.equal(sample(1,3),0);assert.equal(sample(5,3),0);assert.equal(sample(-.01,3),0);assert.equal(sample(8,3),0);
assert.equal(sample(3,3,4),0);assert.equal(actualGuard(4,()=>sample(3,3),[3,3]),0,'water guard must exclude mapped water');
assert.equal(sample(3,3,3,-500,0),0,'CPU car fade');assert.ok(sample(3,3,3,-420,0)>0&&sample(3,3,3,-420,0)<1);
// These compile the actual emitted shader rule bodies, not the independent CPU port.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const car={x:1200,y:1900};let rail=0,coverage=1;
const environment={sqrt:Math.sqrt,min:Math.min,max:Math.max,smoothstep:smooth,step:(a,x)=>x<a?0:1,vec2:(x,y)=>({x,y}),pavedCar:car,pavedCoverage:()=>coverage,pavedRailAt:()=>rail};
const fade=glslRule(PAVED_SAMPLE,'pavedCarFade',environment);environment.pavedCarFade=fade;
const actualWeight=glslRule(PAVED_SAMPLE,'pavedWeight',environment);
const here={x:1200,y:1900};assert.equal(actualWeight(here),1,'ground car fade uses displacement, not sum');
assert.equal(actualWeight({x:1700,y:1900}),0,'ground car fade distance');assert.ok(actualWeight({x:1630,y:1900})>0&&actualWeight({x:1630,y:1900})<1);
assert.throws(()=>classTile(new Uint8Array(16384).fill(72).buffer));assert.throws(()=>classTile(new Uint8Array(16384).fill(3).buffer));assert.throws(()=>classTile(new Uint8Array(16385).buffer));
assert.equal(classTile(new Uint8Array(16384).fill(2).buffer)[0],2,'gravel class accepted');
const index={version:1,area:'pointtupper',epsg:2961,origin:[591500,5103332],tileMetres:256,resolution:2,side:128,classes:{0:'unknown',1:'hard paved'},tiles:['149_203.r8'],railTiles:['149_203.r8']};
// Stall rows: map front line -> world origin and direction; the nearest rows (by middle) go to the shader.
{
 // Ten rows within reach, 20 m apart going south: the eight nearest the car reach the shader, nearest first.
 const ten=Array.from({length:10},(_,k)=>[1000,2000-20*k,1011,2000-20*k,5.5,2.75]);
 const many=new Paved({...index,origin:[0,0],tiles:[],stalls:ten.reverse()},'test',[900,2100]);
 try{many.update(105,100);assert.deepEqual(many.uniforms.pavedStallA.value.map(v=>v.y),[100,120,140,160,180,200,220,240],'nearest stall rows');assert.equal(many.uniforms.pavedStallCount.value,8,'nearest stall rows');}
 finally{many.texture.dispose();}
 const rows=[[1000,2000,1027.5,2000,5.5,2.75],[1000,1800,1000,1822,5.5,2.75],[5000,5000,5011,5000,5.5,2.75]];
 const stalls=new Paved({...index,origin:[0,0],tiles:[],stalls:rows},'test',[900,2100]);
 try{
  stalls.update(127,95);
  assert.equal(stalls.uniforms.pavedStallCount.value,2,'nearest stall rows');
  const [a0,a1]=stalls.uniforms.pavedStallA.value,[b0]=stalls.uniforms.pavedStallB.value;
  assert.deepEqual([a0.x,a0.y,a0.z,a0.w].map(v=>v+0),[100,100,1,0],'stall row world direction');assert.deepEqual([b0.x,b0.y,b0.z],[27.5,5.5,2.75]);
  assert.deepEqual([a1.x,a1.y,a1.z,a1.w].map(v=>v+0),[100,300,0,-1],'stall row world direction');
  // The shader's left side (a.w,-a.z) of an eastward front is map north (world -z); of a northward front, map west.
  assert.deepEqual([a0.w,-a0.z].map(v=>v+0),[0,-1],'stall row world direction');assert.deepEqual([a1.w,-a1.z].map(v=>v+0),[-1,0],'stall row world direction');
  stalls.update(127+9*256,95);assert.equal(stalls.uniforms.pavedStallCount.value,0,'nearest stall rows');
 }finally{stalls.texture.dispose();}
 assert.throws(()=>new Paved({...index,stalls:[[0,0,1,1,0,2]]},'test',[0,0]),/Invalid paved index/);
}
const guardFetch=globalThis.fetch;
try{
 for(const invalid of [{...index},{...index,source:'wrong-source'},{...index,source:'nstdb-designated-open-v1',area:'mabou'}]){
  globalThis.fetch=async()=>new Response(JSON.stringify(invalid));
  await assert.rejects(loadPaved('guard',[0,0],'pointtupper'),/source\/area mismatch/,'runtime source guard');
 }
 globalThis.fetch=async()=>new Response(JSON.stringify({...index,source:'nstdb-designated-open-v1'}));
 const good=await loadPaved('guard',[0,0],'pointtupper');good.texture.dispose();
}finally{globalThis.fetch=guardFetch;}
const oldFetch=globalThis.fetch,oldWarn=console.warn,requests=[];let failing=false,time=0;
const payload=new Uint8Array(16384);for(const [row,col] of [[7,3],[94,120]])payload[row*128+col]=1;payload[125*128+2]=2;
globalThis.fetch=async url=>{requests.push(url);if(failing){failing=false;throw Error('controlled retry');}return new Response(payload);};
const layer=new Paved(index,'test',[628151.016,5052750.5],()=>time);
const flush=async()=>{for(let i=0;i<30;i++)await new Promise(resolve=>setImmediate(resolve));};
try{
 // Tile 149_203 is E629644..629900, N5051108..5051364; car at its centre.
 layer.update(629772-628151.016,5052750.5-5051236);await flush();
 assert.equal(requests.length,1,'tile name/world row sign');assert.ok(requests[0].endsWith('/149_203.r8'),'tile name');
 const a=layer.texture.image.data;assert.equal(layer.railTexture,undefined,'removed lane guard has no obsolete texture');
 const red=(r,c)=>a[((256+r)*640+256+c)*2],green=(r,c)=>a[((256+r)*640+256+c)*2+1];
 assert.equal(layer.texture.format,1030,'atlas orientation: RG');assert.equal(a.length,640*640*2,'atlas orientation: two bytes a texel');
 for(const [r,c] of [[7,3],[94,120]])assert.equal(red(r,c),255,'atlas orientation');
 assert.equal(green(125,2),255,'gravel channel');assert.equal(red(125,2),0,'gravel channel');assert.equal(green(7,3),0,'gravel channel');
 assert.equal(a[(256*640+256)*2],0,'atlas orientation empty corner');assert.equal(red(120,94),0,'atlas orientation transpose');
 assert.equal(a.reduce((n,v)=>n+v,0),765,'atlas orientation count');assert.equal(layer.texture.minFilter,1006);
 const reads=requests.length;for(let i=0;i<10000;i++)layer.update(1621, 1515);assert.equal(requests.length,reads);
 layer.update(30000,30000);assert.equal(layer.entries.size,0);assert.ok(layer.texture.image.data.every(v=>v===0));
 failing=true;console.warn=()=>{};layer.update(629772-628151.016,5052750.5-5051236);await flush();const before=requests.length;
 layer.update(1621,1515);await flush();assert.equal(requests.length,before,'retry must back off');
 time=1001;layer.update(1621,1515);await flush();assert.equal(requests.length,before+1,'retry resumes in same tile');assert.equal(layer.pending,0);assert.equal(layer.entries.values().next().value.failed,false);
}finally{globalThis.fetch=oldFetch;console.warn=oldWarn;layer.texture.dispose();}
// Keep failing through enough attempts to prove the cap, not just the first retry.
let retryTime=0,retryReads=0;globalThis.fetch=async()=>{retryReads++;throw Error('controlled repeated failure');};console.warn=()=>{};
const retryLayer=new Paved(index,'test',[628151.016,5052750.5],()=>retryTime);
try{
 retryLayer.update(1621,1515);await flush();
 for(const expected of [1000,2000,4000,8000,16000,30000,30000,30000]){
  const entry=retryLayer.entries.values().next().value;assert.equal(entry.retryAt-retryTime,expected,'retry cap and schedule');
  const reads=retryReads;retryTime=entry.retryAt-1;retryLayer.update(1621,1515);await flush();assert.equal(retryReads,reads,'retry must wait for deadline');
  retryTime++;retryLayer.update(1621,1515);await flush();assert.equal(retryReads,reads+1);
 }
}finally{globalThis.fetch=oldFetch;console.warn=oldWarn;retryLayer.texture.dispose();}
// Keep the original four-fetch/stale-arrival/eviction regression as well.
const delayed=[];let inflight=0,maxInflight=0;
globalThis.fetch=url=>new Promise(resolve=>{inflight++;maxInflight=Math.max(maxInflight,inflight);delayed.push({done:false,release(){this.done=true;inflight--;resolve(new Response(new Uint8Array(16384).fill(1)));}});});
const names=[];for(let j=3;j<=9;j++)for(let i=3;i<=9;i++)names.push(`${i}_${j}.r8`);
const moving=new Paved({...index,origin:[0,0],tiles:names},'test',[0,0]);
try{
 moving.update(5*256,5*256);assert.equal(delayed.length,4);moving.update(7*256,7*256);assert.equal(delayed.length,4);
 for(let guard=0;moving.pending>0&&guard<20;guard++){for(const r of delayed)if(!r.done)r.release();await flush();}
 assert.equal(moving.pending,0);assert.ok(maxInflight<=4);assert.equal(moving.entries.size,25);assert.ok(moving.texture.image.data.every((v,i)=>v===(i%2?0:255)));
 moving.update(100*256,100*256);assert.equal(moving.entries.size,0);assert.ok(moving.texture.image.data.every(v=>v===0));
}finally{globalThis.fetch=oldFetch;moving.texture.dispose();}
console.log('PASS paved web: default-on gate with paved=0 way out, committed shader pin, actual water guard, asymmetric RG atlas/world orientation with a gravel channel, 1 m laid edges, stall rows, mown verge, car fade and retry');
if(process.argv.includes('--mutations')){
 const results={};for(const [name,[,,,diagnostic]] of Object.entries(changes)){
  const r=spawnSync(process.execPath,['tools/run-node-check.mjs','tools/paved-web-check.mjs','--mutation',name],{cwd:root,encoding:'utf8'});
  assert.equal(r.status,1,name+' must fail assertions');assert.ok((r.stderr+r.stdout).includes(diagnostic),name+' expected diagnostic');results[name]={exit:r.status,diagnostic};console.log('KILLED',name,'exit',r.status,diagnostic);
 }
 const out=process.env.PAVED_EVIDENCE;if(out)writeFileSync(out+'/web-mutations.json',JSON.stringify(results,null,2)+'\n');
}
