import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname} from 'node:path';
import {farPack} from './far-pack.mjs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../web/package.json',import.meta.url)),{buildSync,transformSync}=require('esbuild'),T=require('three'),root=new URL('../',import.meta.url).pathname;
const source=p=>readFileSync(root+p,'utf8');
function moduleAt(path,change){const m={exports:{}};const text=buildSync({stdin:{contents:change??source(path),resolveDir:dirname(root+path),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,external:['three']}).outputFiles[0].text;new Function('require','module','exports',text)(require,m,m.exports);return m.exports;}
function materials(mod){
 const originalVertexPars=T.ShaderChunk.logdepthbuf_pars_vertex,originalFragmentPars=T.ShaderChunk.logdepthbuf_pars_fragment;
 const scene=new T.Scene(),old=new T.MeshLambertMaterial();let called=0;old.onBeforeCompile=shader=>{called++;shader.vertexShader+='\n// existing modifier';};const oldKey=old.customProgramCacheKey();scene.add(new T.Mesh(new T.BoxGeometry(),old));const on={value:0};mod.curveSceneMaterials(scene,{farCurveOn:on});
 const camera=new T.PerspectiveCamera(60,16/9,.3,400000);camera.position.set(11,200,19);camera.rotation.set(-.1,.3,0);camera.updateMatrixWorld();
 scene.onBeforeRender({},scene,camera);const shader={vertexShader:T.ShaderLib.lambert.vertexShader,uniforms:{}};old.onBeforeCompile(shader,{});assert.equal(called,1);assert.match(shader.vertexShader,/existing modifier/);assert.match(shader.vertexShader,/if \(farObjectDrop > 0.0\) gl_Position -=/);assert.equal(shader.uniforms.farCurveOn,on);assert.ok(old.customProgramCacheKey().startsWith(oldKey));
 const version=old.version,key=old.customProgramCacheKey(),program=shader.vertexShader;on.value=1;assert.equal(old.version,version,'activation does not mark existing material dirty');assert.equal(old.customProgramCacheKey(),key,'activation keeps program key');const activated={vertexShader:T.ShaderLib.lambert.vertexShader,uniforms:{}};old.onBeforeCompile(activated,{});assert.equal(activated.vertexShader,program,'activation reuses the same existing-scene program');
 for(const d of [0,2999,3000,3500,10000,20000]){const p=new T.Vector4(camera.position.x+d,21,camera.position.z,1),clip=p.clone().applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix),world=clip.clone().applyMatrix4(shader.uniforms.farClipToWorld.value);world.multiplyScalar(1/world.w);assert.ok(Math.abs(world.x-p.x)<1e-5);assert.ok(Math.abs(world.z-p.z)<1e-5);}
 // Includes later MP ghost/tree/vehicle subtrees, without rescanning each frame.
 const group=new T.Group();scene.add(group);for(const Mat of [T.MeshBasicMaterial,T.MeshLambertMaterial,T.MeshStandardMaterial]){const m=new Mat();group.add(new T.Mesh(new T.BoxGeometry(),m));const s={vertexShader:T.ShaderLib.basic.vertexShader,uniforms:{}};m.onBeforeCompile(s,{});assert.equal(s.uniforms.farCurveOn,on);}
 const history=moduleAt('web/src/eras/history-art.ts').createHistoryMaterial(),building=new (moduleAt('web/src/buildings.ts').Buildings)([],[0,0],1,-.2);
 const mixed=new T.Scene();mixed.add(new T.Mesh(new T.BufferGeometry(),history),building.mesh);mod.curveSceneMaterials(mixed,{farCurveOn:{value:0}});
 for(const material of [history,building.mesh.material]){const shader={vertexShader:T.ShaderLib.lambert.vertexShader,fragmentShader:T.ShaderLib.lambert.fragmentShader,uniforms:{}};material.onBeforeCompile(shader,{});assert.match(shader.vertexShader,/farObjectDrop/);if(material===history){assert.match(shader.vertexShader,/vPeriodStyle=periodStyle/);assert.match(shader.fragmentShader,/shingle/);assert.ok(material.customProgramCacheKey().startsWith('1884-wood-and-stone-v2'));}}
 const busScene=new T.Scene(),busGroup=new T.Group(),busFlag={value:0};busScene.add(busGroup);mod.curveSceneMaterials(busScene,{farCurveOn:busFlag});
 const art=moduleAt('web/src/school-bus-art.ts').schoolBusArt(),busMaterials=new Set();art.root.traverse(o=>{if(o.isMesh)busMaterials.add(o.material);});const beforeAdd=new Map([...busMaterials].map(m=>[m,m.version]));busGroup.add(art.root);
 assert.equal(busMaterials.size,4);assert.equal(new Set([...busMaterials].map(m=>m.type)).size,2,'bus uses Lambert and Basic families');
 for(const m of busMaterials){assert.equal(m.version,beforeAdd.get(m)+1,'hook new bus material before first use');const shader={vertexShader:T.ShaderLib.basic.vertexShader,uniforms:{}};m.onBeforeCompile(shader,{});assert.equal(shader.uniforms.farCurveOn,busFlag,'late bus add is watched');}
 const already='#include <logdepthbuf_vertex>\nfloat farDrop(vec2 p){return 0.0;}';assert.equal(mod.bendMaterialVertex(already),already);assert.equal(mod.bendMaterialVertex('void main() {}'),'void main() {}');
 const ownedScene=new T.Scene(),seaMaterial=new T.ShaderMaterial({vertexShader:T.ShaderLib.basic.vertexShader}),ownMaterial=new T.ShaderMaterial({vertexShader:already});
 const seaMesh=new T.Mesh(new T.BufferGeometry(),seaMaterial);seaMesh.name='near-sea';ownedScene.add(seaMesh,new T.Mesh(new T.BufferGeometry(),ownMaterial));
 const owned=[seaMaterial,ownMaterial].map(m=>({m,version:m.version,key:m.customProgramCacheKey(),compile:m.onBeforeCompile}));mod.curveSceneMaterials(ownedScene,{farCurveOn:on});
 for(const{m,version,key}of owned){assert.equal(m.version,version+1,'depth interpolation installed at boot');assert.ok(m.customProgramCacheKey().startsWith(key));const shader={vertexShader:T.ShaderLib.basic.vertexShader,fragmentShader:T.ShaderLib.basic.fragmentShader,uniforms:{}};m.onBeforeCompile(shader,{});assert.doesNotMatch(shader.vertexShader,/farObjectDrop/,'owned curve is not injected twice');assert.match(shader.vertexShader,/centroid varying float vFarFragDepth/);assert.match(shader.fragmentShader,/centroid varying float vFarFragDepth/);assert.match(shader.fragmentShader,/if \(length\(vFarDepthXZ\) > 3000.0\)/,'near depth retains original interpolation');}
 assert.equal(T.ShaderChunk.logdepthbuf_pars_vertex,originalVertexPars,'shared vertex chunk is untouched');assert.equal(T.ShaderChunk.logdepthbuf_pars_fragment,originalFragmentPars,'shared fragment chunk is untouched');
}
function visibility(mod){
 let active=null,ends=0;const queries=[],gl={ANY_SAMPLES_PASSED:1,QUERY_RESULT_AVAILABLE:2,QUERY_RESULT:3,createQuery:()=>{const q={available:false,result:false};queries.push(q);return q;},isContextLost:()=>false,beginQuery:(_,q)=>{assert.equal(active,null,'occlusion target is available');active=q;},endQuery:()=>{assert.ok(active);active=null;ends++;},getQueryParameter:(q,p)=>p===2?q.available:q.result};
 const renderer={getContext:()=>gl,domElement:{addEventListener(){}}},mesh=new T.Mesh(),v=new mod.FarVisibility(renderer,[mesh]),camera=new T.PerspectiveCamera();v.update(camera,1);mesh.onBeforeRender({},null,camera);mesh.onAfterRender({},null,camera);queries[0].available=true;v.update(camera,1.01);v.update(camera,1.02);assert.equal(mesh.visible,false,'fully occluded draw skipped');v.update(camera,1.20);assert.equal(mesh.visible,false,'hidden until retry');v.update(camera,1.22);assert.equal(mesh.visible,true,'moving occluder is retried within 0.2 seconds');
 // A draw failure must release the shared ANY_SAMPLES_PASSED target for water.
 mesh.onBeforeRender({},null,camera);try{throw Error('draw failed');}catch{}finally{v.settle();}assert.equal(active,null,'failed draw releases its query');const ended=ends;v.settle();assert.equal(ends,ended,'cleanup is idempotent');gl.beginQuery(gl.ANY_SAMPLES_PASSED,{});gl.endQuery(gl.ANY_SAMPLES_PASSED);
 // A pending result from a previous viewpoint must not hide the new view.
 queries[0].available=false;camera.position.x+=10;v.update(camera,1.23);assert.equal(mesh.visible,true,'camera motion discards stale occlusion');queries[0].available=true;v.update(camera,1.24);assert.equal(mesh.visible,true);
 mesh.onBeforeRender({},null,camera);mesh.onAfterRender({},null,camera);assert.equal(active,null,'normal draw still releases its query');
 // Replay and endings pass wall time, driving passes drive time. A wall-time deadline must not hold an occluded mesh after the clock goes back.
 queries[0].result=false;v.update(camera,1000);assert.equal(mesh.visible,true,'wall-time probe');mesh.onBeforeRender({},null,camera);mesh.onAfterRender({},null,camera);
 v.update(camera,10);assert.equal(mesh.visible,false,'occluded after the clock goes back');v.update(camera,10.22);assert.equal(mesh.visible,true,'wall-time deadline still retried within 0.2 seconds');
}
materials(moduleAt('web/src/far-materials.ts'));visibility(moduleAt('web/src/far-visibility.ts'));
{
 const dir=realpathSync(mkdtempSync(tmpdir()+'/far-pack-'));
 try{const baked=dir+'/data/baked',work=dir+'/data/work/bakes/far-views';mkdirSync(baked+'/terrain',{recursive:true});assert.equal(farPack(dir),null);mkdirSync(work+'/terrain',{recursive:true});writeFileSync(work+'/terrain/far-land.json','{}');assert.equal(farPack(dir),work);writeFileSync(baked+'/terrain/far-land.json','{}');writeFileSync(baked+'/terrain/tall.json','{"version":1}');assert.equal(farPack(dir),work);writeFileSync(baked+'/terrain/tall.json','{"version":2}');assert.equal(farPack(dir),baked);assert.equal(farPack(dir,work),work);}finally{rmSync(dir,{recursive:true});}
}
{
 const node=()=>({children:[],hidden:false,dataset:{},style:{},classList:{contains:()=>false},setAttribute(){},addEventListener(){},append(...children){this.children.push(...children);},appendChild(child){this.children.push(child);},focus(){},querySelector(key){this.parts??=new Map();if(!this.parts.has(key))this.parts.set(key,node());return this.parts.get(key);}});
 globalThis.HTMLElement=class{};globalThis.document={createElement:node,head:node(),body:node(),activeElement:null,getElementById:()=>null,addEventListener(){}};globalThis.addEventListener=()=>{};
 let pauses=0;const {PlacesUI}=moduleAt('web/src/places-ui.ts'),ui=new PlacesUI([],[0,0],{},{canOpen:()=>true,pause(){pauses++;}});ui.open();assert.deepEqual({busy:ui.busy,pauses},{busy:false,pauses:0},'empty Places never opens or pauses');
 ui.update({x:0,z:0},true);assert.equal(document.body.children[0].hidden,true,'no empty Places button');const place={id:'wind',e:10,n:20,name:'Wind turbine above Mabou',kind:'view',note:'High ground.',radius:5};ui.addPlaces([place]);ui.addPlaces([place]);assert.equal(ui.places.length,1,'late place added once');assert.equal(ui.marks.length,1);ui.update({x:0,z:0},true);assert.equal(document.body.children[0].hidden,false,'late loaded place available');
 delete globalThis.document;delete globalThis.addEventListener;delete globalThis.HTMLElement;
}

function farLoadFunction(text){const ts=require('typescript'),ast=ts.createSourceFile('main.ts',text,ts.ScriptTarget.Latest,true),node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='loadFarViews');assert.ok(node);return node.getText(ast);}
const main=source('web/src/main.ts'),places=source('web/src/places.ts');
assert.equal(main.split('curveSceneMaterials(scene,shared);').length,2,'one boot install only');assert.ok(main.indexOf('curveSceneMaterials(scene,shared);')<main.lastIndexOf('requestAnimationFrame(frame);'),'hook installed before first frame');const farLoad=farLoadFunction(main);assert.doesNotMatch(farLoad,/curveSceneMaterials/,'no mid-drive reinstall');assert.ok(main.indexOf('const seaColour = sea.material;')<main.indexOf('new WaterReflections'),'capture colour before swap owner');assert.match(main,/if\(farKey\)curveSceneMaterials\(scene,shared\);/,'no hook cost without far land');
assert.match(main,/if\(started&&!farLoading&&\(farKey\|\|tallKey\)\).*setTimeout/,'deferred after Start');assert.ok(main.indexOf('renderer.render(scene, camera)',main.indexOf('function frame'))<main.indexOf('if(started&&!farLoading'),'first frame before optional request');assert.doesNotMatch(main,/const farLand = .*await/);assert.match(main,/if\(near\?\.turbineCount&&!history\)placesUI\?\.addPlaces/);assert.doesNotMatch(places,/Wind turbine, South Cape Mabou/);assert.match(main,/roads.guardrails\?\.setObstacles\(props.railObstacles\)/);
async function loadCase(fail={},text=main){
 const code=transformSync(farLoadFunction(text),{loader:'ts',define:{'import.meta.env.DEV':'false'}}).code;
 const scene=new T.Scene(),models=[new T.MeshLambertMaterial(),new T.MeshStandardMaterial(),new T.MeshBasicMaterial()];for(const m of models)scene.add(new T.Mesh(new T.BoxGeometry(),m));
 const sea=new T.Mesh(new T.PlaneGeometry(),new T.ShaderMaterial({vertexShader:'vertex before',fragmentShader:'colour before'})),query=new T.ShaderMaterial({vertexShader:'query vertex before',fragmentShader:'query before',depthTest:true,depthWrite:false,colorWrite:false}),seaColour=sea.material;scene.add(sea);const initialGeometry=sea.geometry,root=[0,0,100,100],shared={farCurveOn:{value:0}};
 const curve=moduleAt('web/src/far-materials.ts').curveSceneMaterials;curve(scene,shared);
 const versions=models.map(m=>m.version),keys=models.map(m=>m.customProgramCacheKey()),seaVersion=seaColour.version,queryVersion=query.version,places=[],calls={};
 const plan=fail.coarse?{level:'coarse',coarse:true}:fail.low?{level:'low',coarse:false}:{level:'desktop',coarse:false};
 const state={scene,sea,seaColour,shared,farUse:plan,coarseTurbines:(d,village)=>{calls.merged=village;return [...d.turbines,...d.far];},terrain:{seaLevel:0,exag:1.5,heightAt:()=>null},farKey:{file:'land'},tallKey:{file:'tall'},ERA:{modern:true},manifest:{village:[50,50]},sameRoot:r=>JSON.stringify(r)===JSON.stringify(root),base:'fixture',LOW:false,sun:{el:1},history:null,AREA:{id:'mabou'},placesUI:{addPlaces:p=>places.push(...p)},tallPlaces:()=>[{}],renderer:{},farLand:null,tall:null,farTurbines:null,farVisibility:null,console:{warn(){}},curveSceneMaterials:curve,
  SEA_VERT:'vertex',SEA_FRAG:'fragment',farSeaVertex:s=>{if(fail.rewrite)throw Error('rewrite');return s+' curved';},farSeaFragment:s=>s+' curved',
  getJson:async name=>{if(fail[name])throw Error(name);return name==='land'?{root,origin:[50,50]}:{version:2,root,turbines:[{}],far:[{}]};},
  FarLand:{load:async(_data,_base,level)=>{calls.level=level;if(fail.binary)throw Error('binary');const land=new T.Mesh();const group=new T.Group();group.add(land);return{land,group,seaGeometry:new T.BufferGeometry()};}},
  TallLandmarks:class{constructor(d,_t,_low,_s,_dark,showFar,coarse){calls.nearCoarse=coarse;calls.showFar=showFar;if(fail.near)throw Error('near');this.group=new T.Group();this.turbineCount=d.turbines.length;this.solids=d.turbines.map(()=>({}));}},
  FarTurbines:class{constructor(points,_o,_low,_s,_dark,coarse){calls.points=points.length;calls.farCoarse=coarse;if(fail.distant)throw Error('distant');this.group=new T.Group();this.group.add(new T.Mesh());this.count=1;}},FarVisibility:class{},
  waterReflections:{transformSea(vertex,fragment){if(fail.query)throw Error('query');query.vertexShader=vertex('vertex');query.fragmentShader=fragment('query fragment');query.needsUpdate=true;}},
 };
 if(fail.low||fail.coarse){state.LOW=true;state.waterReflections=null;}
 if(fail.queryActive&&!fail.low)sea.material=query;
 const load=new Function('state',`with(state){${code};return loadFarViews;}`)(state);await load();
 const landOK=!(fail.land||fail.binary||fail.rewrite||fail.query),nearOK=!(fail.tall||fail.near);
 // The plan picks the level; coarse sends near and far turbines to one far draw and keeps the near solids only.
 if(!fail.land)assert.equal(calls.level,plan.level,'far land level follows the plan');
 if(!fail.tall){assert.equal(calls.nearCoarse,plan.coarse,'near landmarks draw nothing in coarse');assert.equal(calls.showFar,false,'near landmarks never draw far turbines');}
 if(state.farTurbines){assert.equal(calls.points,plan.coarse?2:1,'coarse: near and far turbines in the one far draw');assert.equal(calls.farCoarse,plan.coarse);assert.equal(!!calls.merged,plan.coarse);}
 assert.equal(!!state.farLand,landOK,'independent land success');// Coarse draws its near turbines only in the far draw: without that draw, no near solids or Places either.
 const nearShown=nearOK&&(!plan.coarse||(landOK&&!fail.distant));
 assert.equal(!!state.tall,nearShown,'independent near success');assert.equal(state.tall?.solids.length??0,nearShown?1:0,'draws and solids consistent');assert.equal(places.length,nearShown?1:0,'only drawn turbine place');assert.equal(!!state.farTurbines,landOK&&nearOK&&!fail.distant,'outside-root turbines require real land');assert.equal(shared.farCurveOn.value,landOK?1:0);
 models.forEach((m,i)=>{assert.equal(m.version,versions[i],'far load recompiles no existing model');assert.equal(m.customProgramCacheKey(),keys[i],'existing model cache key stable');});
 if(landOK){assert.equal(seaColour.vertexShader,'vertex curved','stable colour vertex target');assert.equal(seaColour.fragmentShader,'fragment curved','stable colour fragment target');if(!state.LOW){assert.equal(query.fragmentShader,'query fragment curved','query keeps the query fragment');assert.equal(query.depthWrite,false,'query depth flags stay unchanged');assert.equal(query.colorWrite,false,'query stays colourless');}}
 const changed=(seaColour.version-seaVersion)+(query.version-queryVersion);assert.equal(changed,landOK?(state.LOW?1:2):0,'only sea colour/query programs change');if(!landOK)assert.equal(sea.geometry,initialGeometry);
}
for(const fail of [{},{low:true},{coarse:true},{coarse:true,tall:true},{coarse:true,binary:true},{coarse:true,land:true},{coarse:true,distant:true},{queryActive:true},{queryActive:true,tall:true},{queryActive:true,binary:true},{tall:true},{land:true},{binary:true},{near:true},{distant:true},{rewrite:true},{query:true}])await loadCase(fail);
console.log('PASS actual far-load fixture: zero existing-model program changes, at most two sea programs; independent optional failures');
if(process.argv.includes('--mutations')){
 for(const[label,path,a,b,test]of [
  ['uncovered log-depth interpolation','web/src/far-materials.ts',"shader.vertexShader=centroidDepthVertex(shader.vertexShader);shader.uniforms.farClipToWorld=clip;","",materials],
  ['late object bend omitted','web/src/far-materials.ts','for(const child of children)watch(child);','',materials],
  ['centroid changes near depth','web/src/far-materials.ts','if (length(vFarDepthXZ) > ${CURVE_START.toFixed(1)})','if (true)',materials],
  ['own curve wrapped again','web/src/far-materials.ts',"const ownsCurve=object.name==='near-sea'||(raw.isShaderMaterial&&raw.vertexShader.includes('float farDrop('));",'const ownsCurve=false;',materials],
  ['occlusion never skips','web/src/far-visibility.ts','r.mesh.visible=r.visible||seconds>=r.retry;','r.mesh.visible=true;',visibility],
  ['slow occlusion retry','web/src/far-visibility.ts','const RETRY=.2;','const RETRY=.5;',visibility],
  ['stale wall-clock retry kept','web/src/far-visibility.ts','if(r.retry>seconds+RETRY)r.retry=seconds+RETRY;','',visibility],
  ['failed draw query left active','web/src/far-visibility.ts','for(const r of this.records)if(r.active){','for(const r of this.records)if(false){',visibility],
  ['stale occlusion accepted','web/src/far-visibility.ts','if(r.version===this.pose)','if(true)',visibility],
 ]){const text=source(path);assert.equal(text.split(a).length,2);assert.throws(()=>test(moduleAt(path,text.replace(a,b))),{name:'AssertionError'});console.log('KILLED',label);}
}
if(process.argv.includes('--mutations')){const orphan=main.replace('if(farUse!.coarse&&!farTurbines)near=null;','');assert.notEqual(orphan,main);await assert.rejects(()=>loadCase({coarse:true,distant:true},orphan),{name:'AssertionError'});console.log('KILLED coarse near solids without the far draw');}
if(process.argv.includes('--mutations')){const changed=main.replace('shared.farCurveOn.value=1;','shared.farCurveOn.value=1;curveSceneMaterials(scene,shared);');await assert.rejects(()=>loadCase({},changed),{name:'AssertionError'});console.log('KILLED mid-drive material reinstall');}
if(process.argv.includes('--mutations')){const wrongTarget=main.replaceAll('seaColour.','sea.material.');await assert.rejects(()=>loadCase({queryActive:true},wrongTarget),{name:'AssertionError'});console.log('KILLED query-active colour rewrite on mesh material');}

function localMirror(src){
 const start=src.indexOf('    const curve = this.seaQueryMaterial.uniforms.farCurveOn'),end=src.indexOf('    this.uniforms.reflectionOn.value =',start);assert.ok(start>0&&end>start);
 const draw=new Function('mirror','camera','oldClip','oldAutoClear','oldTarget','alpha','oldTone','oldShadow','oldNeeds','oldEnabled',src.slice(start,end));
 for(const initial of [1,0,undefined])for(const fail of [false,true]){
  const curve=initial===undefined?undefined:{value:initial};let draws=0;const assertFlat=()=>{if(curve)assert.equal(curve.value,0,'local reflected scenery stays flat');};
  const state={seaQueryMaterial:{uniforms:{farCurveOn:curve}},renderer:{shadowMap:{},setRenderTarget(){},setClearColor(){},clear(){},render(){assertFlat();draws++;if(fail)throw Error('mirror draw failed');}},terrain:{withReflection(m,p,draw){assertFlat();draw();}},target:{texture:{}},scene:{},projection:new T.Matrix4(),uniforms:{tReflection:{value:null}},hidden:[],nearTrees:{visible:true},clear:{}};
  const run=()=>draw.call(state,{}, {position:{},projectionMatrix:new T.Matrix4()},[],true,null,1,0,true,true,true);
  if(fail)assert.throws(run,/mirror draw failed/);else run();assert.equal(draws,1);assert.equal(curve?.value,initial,'main scene curvature restored even after failed mirror');
 }
}
const waterSource=source('web/src/water.ts');localMirror(waterSource);console.log('PASS actual local-mirror block: flat reflections, curvature restored on success/failure');
if(process.argv.includes('--mutations'))for(const[label,text]of [['curved local mirror',waterSource.replace('if (curve) curve.value = 0;','')],['mirror curve not restored',waterSource.replace('if (curve) curve.value = previousCurve;','')]]){assert.throws(()=>localMirror(text),{name:'AssertionError'});console.log('KILLED',label);}
console.log('PASS deferred boot, actual material hooks/late additions, clip reconstruction, conservative occlusion and neutral conditional Places');

function tallContacts(text){
 const {AreaContacts}=moduleAt('web/src/world-contacts.ts'),{TallLandmarks}=moduleAt('web/src/tall.ts'),{CAR_SPEC}=moduleAt('web/src/vehicle-spec.ts');
 const state={tallKey:{file:'tall.json'},tall:null,fleetContacts:new AreaContacts()},row=text.match(/^  \['tall', ([^\n]+)\],$/m)?.[1]??'null';
 // main.ts writes each site's contact row once (siteContacts) and adds every row to the registry.
 assert.match(text,/^for \(const \[, row\] of siteContacts\) if \(row\) fleetContacts\.add\(row\);$/m,'every site row joins the registry');
 new Function('state',`with(state){const row=${row};if(row)fleetContacts.add(row);}`)(state);
 const contacts=state.fleetContacts,revision=contacts.revision,body={x:0,z:0,y:0,heading:0,vx:0,vz:0,speed:0,spec:CAR_SPEC,car:{root:{position:{x:0,z:0}}}};
 assert.equal(contacts.allows(body),true,'unloaded optional pack has no invisible solid');
 state.tall={solids:[{x:0,z:0,half:2.3,halfWidth:2.3,heading:0}],resolveSolids:TallLandmarks.prototype.resolveSolids};
 assert.ok(contacts.revision>revision,'late tower data invalidates fleet placement decisions');assert.equal(contacts.allows(body),false,'fleet preflight rejects the real tower resolver');contacts.resolve(body);assert.ok(Math.hypot(body.x,body.z)>0,'fixed-step registry pushes the body out');body.x=body.z=100;assert.equal(contacts.allows(body),true,'clear pose remains available');
}
tallContacts(main);console.log('PASS late tall provider: fleet revision, preflight and actual tower resolver');
if(process.argv.includes('--mutations')){const mutant=main.replace('resolve: body => tall?.resolveSolids(body)','resolve: () => {}');assert.throws(()=>tallContacts(mutant),{name:'AssertionError'});console.log('KILLED fleet tower resolver omitted');}

function renderCleanup(text){const blocks=[...text.matchAll(/try \{ drawWorld\(\); \} finally \{[^}]+\}/g)];assert.equal(blocks.length,3,'drive, ending and replay render guards');for(const[body]of blocks){let far=0,sea=0;const state={drawWorld(){throw Error('render failed');},scene:{},camera:{},farVisibility:{settle(){far++;}},waterReflections:{settle(){sea++;}}};assert.throws(()=>new Function('state',`with(state){${body}}`)(state),/render failed/);assert.deepEqual({far,sea},{far:1,sea:1},'both render paths release far and water queries on failure');}}
renderCleanup(main);if(process.argv.includes('--mutations')){assert.throws(()=>renderCleanup(main.replaceAll('farVisibility?.settle();','')),{name:'AssertionError'});console.log('KILLED missing far-query finally wiring');}
