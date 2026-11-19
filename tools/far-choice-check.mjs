#!/usr/bin/env node
// "Far views on phone" (Settings > Advanced): setting x detail -> what loads, on the actual sources.
//  1. far-choice.ts rules: ?far= wins, then the saved choice, then Off; desktop ignores the choice.
//  2. main.ts's own declarations (farKey/tallKey gates, the setting's visibility), evaluated for every
//     detail x choice x installed/not installed, then FarLand.load's actual fetch for the planned level.
//  3. Coarse draws: TallLandmarks draws nothing and keeps its turbine solids; FarTurbines draws every turbine in one
//     instanced draw (two at night); the coarse sea has fewer triangles; a pack without a coarse level falls back to LOW.
//  4. tools/far-pack.mjs: the coarse level is deterministic, uses the 1920 m cell and refuses to write outside data/work/bakes.
// node tools/far-choice-check.mjs [--mutations]
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {coarseMesh,levelBytes,addCoarseLevel,COARSE} from './far-pack.mjs';
const require=createRequire(new URL('../web/package.json',import.meta.url)),{buildSync,transformSync}=require('esbuild'),T=require('three'),root=new URL('../',import.meta.url).pathname;
const source=p=>readFileSync(root+p,'utf8');
// Each mutant changes the module's entry file (stdin); its imports are the real sources.
function moduleAt(path,overrides={}){
 const contents=overrides[path]??source(path);
 const text=buildSync({stdin:{contents,loader:'ts',resolveDir:dirname(root+path),sourcefile:path},bundle:true,platform:'node',format:'cjs',write:false,external:['three'],logLevel:'silent'}).outputFiles[0].text;
 const m={exports:{}};new Function('require','module','exports',text)(require,m,m.exports);return m.exports;
}
const CHOICES=['off','coarse','full'];

function rules(choice){
 const {farPhoneChoice,farPlan,parseFarPhone}=choice;
 const q=s=>new URLSearchParams(s);
 assert.deepEqual(farPhoneChoice(q(''),null),{choice:'off',fromUrl:false},'default Off');
 assert.deepEqual(farPhoneChoice(q(''),'junk'),{choice:'off',fromUrl:false},'unknown saved value is Off');
 for(const c of CHOICES){
  assert.deepEqual(farPhoneChoice(q(''),c),{choice:c,fromUrl:false},'saved '+c);
  for(const saved of [null,...CHOICES])assert.deepEqual(farPhoneChoice(q('far='+c),saved),{choice:c,fromUrl:true},'?far= wins over saved '+saved);
 }
 assert.deepEqual(farPhoneChoice(q('far=FULL'),'coarse'),{choice:'coarse',fromUrl:false},'an unknown ?far= falls back to the saved choice');
 assert.equal(parseFarPhone(undefined),null);
 for(const c of CHOICES){
  assert.deepEqual(farPlan(false,c),{level:'desktop',coarse:false},'desktop ignores the phone choice ('+c+')');
 }
 assert.equal(farPlan(true,'off'),null,'LOW Off loads nothing');
 assert.deepEqual(farPlan(true,'full'),{level:'low',coarse:false},'LOW Full is the LOW far scene');
 assert.deepEqual(farPlan(true,'coarse'),{level:'coarse',coarse:true},'LOW Coarse');
}

// main.ts: the declarations from `const farPack =` through the tallKey line, and the setting's line.
function mainParts(text){
 const start=text.indexOf('const farPack = '),end=text.indexOf('\n',text.indexOf('const tallKey = ',start));
 assert.ok(start>0&&end>start,'main.ts far declarations');
 const decl=transformSync(text.slice(start,end)+'\nreturn {farPack,farPhone,farUse,farKey,tallKey};',{loader:'ts'}).code.replace(/;\s*$/,'');
 const setting=text.split('\n').find(l=>l.includes('farPhoneSetting(advancedSection('));assert.ok(setting,'main.ts setting line');
 const hook=text.split('\n').find(l=>/curveSceneMaterials\(scene,shared\);$/.test(l));assert.ok(hook,'main.ts curve hook line');
 const deferred=text.split('\n').find(l=>l.includes('if(started&&!farLoading&&'));assert.ok(deferred,'main.ts deferred far load line');
 return {decl,setting:transformSync(setting,{loader:'ts'}).code,hook,deferred};
}
const FAR_MANIFEST={farLand:{file:'far-land.json'},tall:{file:'tall.json',turbines:2,far:162,towers:3,lines:1}};
async function wiring(text,choice,farLand){
 const parts=mainParts(text);
 // Before install the live manifest has the old tall key (no far count) and no farLand key.
 for(const installed of [false,true])for(const LOW of [false,true])for(const saved of [null,...CHOICES])for(const url of ['',...CHOICES.map(c=>'far='+c)]){
  const manifest=installed?FAR_MANIFEST:{tall:{file:'tall.json',turbines:2,towers:3,lines:1}};
  const params=new URLSearchParams(url),state={params,readFarPhone:()=>saved,LOW,manifest,farPhoneChoice:choice.farPhoneChoice,farPlan:choice.farPlan};
  const got=new Function('state',`with(state){${parts.decl}}`)(state);
  const wanted=url?url.slice(4):saved??'off',plan=!LOW?'desktop':wanted==='off'?null:wanted==='full'?'low':'coarse';
  const label=`${installed?'installed':'not installed'} ${LOW?'LOW':'desktop'} saved=${saved} url=${url||'-'}`;
  assert.equal(got.farUse?.level??null,plan,label+': plan');
  const loads=!!(installed&&plan);
  assert.equal(!!got.farKey,loads,label+': far land key');assert.equal(!!got.tallKey,loads,label+': tall key');
  // The curve hook and the deferred request read exactly these two keys.
  const hookOn=new Function('state',`let on=false;with(state){${parts.hook.replace('curveSceneMaterials(scene,shared);','on=true;')}}return on;`)({farKey:got.farKey});
  assert.equal(hookOn,loads,label+': material hooks only when far views load');
  let requested=false;new Function('state',`with(state){${parts.deferred}}`)({started:true,farLoading:false,farKey:got.farKey,tallKey:got.tallKey,setTimeout:()=>{requested=true;}});
  assert.equal(requested,loads,label+': far request only when far views load');
  let shown=null;new Function('state',`with(state){${parts.setting}}`)({bare:false,LOW,farPack:got.farPack,farPhone:got.farPhone,touchDevice:true,document:{getElementById:()=>null},advancedSection:()=>'section',farPhoneSetting:(_s,c,fromUrl)=>{shown={c,fromUrl};}});
  assert.equal(!!shown,LOW&&installed,label+': the setting shows on LOW only, once the pack is installed');
  if(shown)assert.deepEqual(shown,{c:wanted,fromUrl:!!url},label+': the setting shows the choice in force');
  if(loads){
   // The planned level's actual fetch (FarLand.load), from a pack with and without the coarse level.
   for(const withCoarse of [true,false]){
    const file=await loadedFile(farLand,got.farUse.level,withCoarse);
    assert.equal(file,{desktop:'far-land-desktop.bin',low:'far-land-low.bin',coarse:withCoarse?'far-land-coarse.bin':'far-land-low.bin'}[got.farUse.level],label+': fetched level');
   }
  }
 }
}
function tinyLevel(name){
 const vertices=new Float32Array([0,1,0,10,1,0,0,1,-10]),indices=new Uint32Array([0,1,2]),bytes=Buffer.concat([Buffer.from(vertices.buffer),Buffer.from(indices.buffer)]);
 return {meta:{file:'far-land-'+name+'.bin',cell:1,vertices:3,indices:3,triangles:1,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},bytes};
}
async function loadedFile(mod,level,withCoarse){
 const names=['desktop','low',...(withCoarse?['coarse']:[])],levels={},files={};
 for(const n of names){const l=tinyLevel(n);levels[n]=l.meta;files['base/'+l.meta.file]=l.bytes;}
 const data={crs:'EPSG:2961',root:[0,0,100,100],origin:[50,50],anchor:[50,50],radius:90000,levels};
 const asked=[],fetchWas=globalThis.fetch;
 globalThis.fetch=async url=>{asked.push(url);const b=files[url];return {ok:!!b,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.length)};};
 try{let land;try{land=await mod.FarLand.load(data,'base',level,{});}catch(e){assert.fail(`FarLand.load(${level}${withCoarse?'':', no coarse level'}) failed: ${e.message}`);}assert.equal(land.level,asked[0].slice(5,-4).replace('far-land-',''));return asked[0].slice(5);}finally{globalThis.fetch=fetchWas;}
}
function draws(group){let n=0;group.traverse(o=>{if(o.isMesh||o.isLine)n++;});return n;}
function coarseDraws(mods){
 const {TallLandmarks}=mods.tall,{FarTurbines,coarseTurbines}=mods.turbines,{seaGeometry}=mods.land;
 const turbine=(e,n,ground)=>({e,n,ground,hub:80,diameter:90});
 const data={version:2,crs:'EPSG:2961',root:[0,0,1000,1000],mid:[0,0,0,0],anchor:[500,500],turbines:[turbine(100,100,20),turbine(200,200,30)],far:[turbine(-5000,0,10),turbine(-6000,0,12),turbine(0,-9000,null)],
  towers:[{e:300,n:300,ground:5,height:60}],lines:[{pts:[[0,0],[10,10]],towers:[{e:0,n:0,ground:1,height:20},{e:10,n:10,ground:1,height:20}],spans:[{sag:1,ground:[1,1],clearance:[5,5]}]}]};
 const terrain={manifest:{village:[500,500]},seaLevel:0,exag:1.5,heightAt:x=>x===-400?33:null};
 const shared={};
 for(const dark of [false,true]){
  const full=new TallLandmarks(data,terrain,true,shared,dark,false,false),coarse=new TallLandmarks(data,terrain,true,shared,dark,false,true);
  assert.ok(draws(full.group)>=5,'full LOW near landmarks draw turbines, masts and wires');
  assert.equal(draws(coarse.group),0,'coarse near landmarks draw nothing');
  assert.equal(coarse.solids.length,data.turbines.length,'coarse keeps the near turbines\' solids, and only theirs');
  coarse.solids.forEach((solid,i)=>assert.equal(solid.half,Math.max(data.turbines[i].hub,data.turbines[i].diameter)*.023,'coarse solid as wide as the far shaft (scaled by the larger of hub and diameter)'));
  assert.equal(coarse.turbineCount,full.turbineCount,'Places still offered for the turbines');
  const points=coarseTurbines(data,terrain.manifest.village,(x,z)=>terrain.heightAt(x,z),terrain.seaLevel,terrain.exag);
  assert.equal(points.length,data.turbines.length+data.far.length,'coarse: near and far turbines in the far list');
  assert.equal(points[0].ground,22,'a near turbine on loaded near land: its drawn height, unstretched for the far shader');
  assert.equal(points[1].ground,30,'a near turbine without loaded land keeps its baked ground');
  const far=new FarTurbines(points,terrain.manifest.village,true,shared,dark,true);
  assert.equal(far.count,4,'unknown ground is never drawn');
  assert.equal(draws(far.group),dark?2:1,'coarse turbines: one draw by day, a second only for night beacons');
  // Near turbines follow the drawn near land as its tiles stream in (twice a second), far ones never move.
  let land=40;const seat={count:2,heightAt:(x,z)=>x===-400?land:null,seaLevel:0,exag:1.5};
  const seated=new FarTurbines(points,terrain.manifest.village,true,shared,dark,true,seat),y=i=>{const m=new T.Matrix4();seated.group.children[0].getMatrixAt(i,m);return m.elements[13];};
  const far0=y(2);seated.update(0,390,844);assert.ok(Math.abs(y(0)-40/1.5)<1e-4,'near turbine re-seated on loaded land');
  land=70;seated.update(.3,390,844);assert.ok(Math.abs(y(0)-40/1.5)<1e-4,'no re-seat within half a second');
  seated.update(.6,390,844);assert.ok(Math.abs(y(0)-70/1.5)<1e-4,'re-seated after half a second');assert.equal(y(1),30,'unloaded near land keeps the baked ground');assert.equal(y(2),far0,'far turbines never re-seated');
  for(const mesh of seated.group.children){const m=new T.Matrix4();mesh.getMatrixAt(0,m);assert.ok(Math.abs(m.elements[13]-70/1.5)<1e-4,'every draw of the turbine moves together');}
  const fullFar=new FarTurbines(data.far,terrain.manifest.village,true,shared,dark,false);
  const tris=g=>g.children[0].geometry.getAttribute('position').count/3;
  assert.ok(tris(far.group)<tris(fullFar.group),'coarse turbine template is lighter');
 }
 const t=g=>g.index.count/3;
 assert.ok(t(seaGeometry(true,true))<t(seaGeometry(true,false))/2,'coarse sea has under half the LOW sea triangles');
 assert.equal(t(seaGeometry(true)),t(seaGeometry(true,false)),'Full keeps the LOW sea');
}
function pack(){
 // A 20 km synthetic island ring around a small root: the coarse level is deterministic and uses its 1920 m cell.
 const meta={root:[-3840,-3840,3840,3840],anchor:[0,0],origin:[0,0],radius:20000};
 const height=(e,n)=>{const r=Math.hypot(e,n);return r<12000?Math.max(-.5,200-r/50):-.5;};
 const a=coarseMesh(meta,height),b=coarseMesh(meta,height);
 assert.deepEqual(levelBytes(a),levelBytes(b),'coarse level is deterministic');
 assert.ok(a.indices.length>0&&a.indices.length%3===0);
 for(let i=0;i<a.vertices.length;i+=3){const e=a.vertices[i],n=-a.vertices[i+2];assert.ok(!(Math.abs(e)<3840-1e-3&&Math.abs(n)<3840-1e-3),'nothing inside the near root');}
 // The coast follows the surface's own zero line: the island (land where r < 10 km) minus the near root square.
 const area=m=>{let sum=0;const v=m.vertices,ix=m.indices;for(let t=0;t<ix.length;t+=3){const p=ix[t]*3,q=ix[t+1]*3,r=ix[t+2]*3;sum+=Math.abs((v[q]-v[p])*(v[r+2]-v[p+2])-(v[r]-v[p])*(v[q+2]-v[p+2]))/2;}return sum;};
 const island=Math.PI*10000**2-7680**2;assert.ok(Math.abs(area(a)/island-1)<.02,'coarse coast within 2% of the true land area: '+(area(a)/island).toFixed(4));
 const fine=coarseMesh(meta,height,{...COARSE,cell:960,block:1920,tolerance:0});
 assert.ok(a.indices.length<fine.indices.length,'1920 m cells are coarser than 960 m');
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'far-choice-')));
 try{
  const data=dir+'/data';mkdirSync(data+'/baked/terrain',{recursive:true});writeFileSync(data+'/baked/terrain/far-land.json','{}');
  assert.throws(()=>addCoarseLevel(data+'/baked/terrain',data),/only into a task folder under data\/work\/bakes/,'never writes data/baked');
  assert.throws(()=>addCoarseLevel(data+'/work/bakes',data),/only into a task folder/,'not the bakes folder itself');
 }finally{rmSync(dir,{recursive:true});}
}
async function all(over={},packSource){
 const choice=moduleAt('web/src/far-choice.ts',over),mods={land:moduleAt('web/src/far-land.ts',over),tall:moduleAt('web/src/tall.ts',over),turbines:moduleAt('web/src/far-turbines.ts',over)};
 rules(choice);await wiring(over['web/src/main.ts']??source('web/src/main.ts'),choice,mods.land);coarseDraws(mods);
 if(!packSource)pack();
}
await all();
console.log('PASS far views on phone: setting x detail -> what loads (main.ts gates, setting visibility, fetched level), coarse draws, coarse level bake');
if(process.argv.includes('--mutations')){
 let killed=0;
 const mutants=[
  ['default choice Coarse','web/src/far-choice.ts',"parseFarPhone(saved) ?? 'off'","parseFarPhone(saved) ?? 'coarse'"],
  ['address ignored','web/src/far-choice.ts',"const typed = parseFarPhone(query.get('far'));","const typed = null as FarPhone | null;"],
  ['desktop follows the phone choice','web/src/far-choice.ts',"if (!low) return { level: 'desktop', coarse: false };","if (!low && choice !== 'off') return { level: 'desktop', coarse: false };"],
  ['Full and Coarse swapped','web/src/far-choice.ts',"choice === 'full' ? { level: 'low', coarse: false } : { level: 'coarse', coarse: true }","choice === 'coarse' ? { level: 'low', coarse: false } : { level: 'coarse', coarse: true }"],
  ['phone Off still loads far land','web/src/main.ts','const farKey = farUse ? farPack : undefined;','const farKey = farPack;'],
  ['phone Off still loads the tall pack','web/src/main.ts','const tallKey = farUse ? ','const tallKey = true ? '],
  ['setting shown on desktop','web/src/main.ts','if (!bare && LOW && farPack) farPhoneSetting(','if (!bare && farPack) farPhoneSetting('],
  ['setting shown before install','web/src/main.ts','if (!bare && LOW && farPack) farPhoneSetting(','if (!bare && LOW) farPhoneSetting('],
  ['coarse level ignored','web/src/far-land.ts',"const name: FarLevelName = want === 'coarse' && !data.levels?.coarse ? 'low' : want","const name: FarLevelName = want === 'coarse' ? 'low' : want"],
  ['no fallback without a coarse level','web/src/far-land.ts',"const name: FarLevelName = want === 'coarse' && !data.levels?.coarse ? 'low' : want","const name: FarLevelName = want"],
  ['coarse sea not coarse','web/src/far-land.ts','const rings=coarse?24:low?48:96','const rings=low?48:96'],
  ['coarse near landmarks still draw','web/src/tall.ts','    if (coarse) {\n','    if (false) {\n'],
  ['coarse drops near solids','web/src/tall.ts',"for (const p of turbines) { const radius = Math.max(p.hub, p.diameter) * .023;","for (const p of turbines.slice(1)) { const radius = Math.max(p.hub, p.diameter) * .023;"],
  ['coarse solids narrower than the drawn shaft','web/src/tall.ts',"const radius = Math.max(p.hub, p.diameter) * .023;","const radius = p.hub * .023;"],
  ['coarse near turbines left out','web/src/far-turbines.ts','  return [...near, ...data.far];','  return [...data.far];'],
  ['coarse near turbines stretched twice','web/src/far-turbines.ts','seaLevel + (h - seaLevel) / exag','h'],
  ['coarse near turbines never re-seated','web/src/far-turbines.ts','    if(!this.near||seconds<this.nextSeat)return;','    return;'],
  ['coarse re-seat every frame','web/src/far-turbines.ts','this.nextSeat=seconds+.5;','this.nextSeat=seconds;'],
 ];
 for(const [label,path,a,b] of mutants){
  const text=source(path);assert.equal(text.split(a).length,2,'mutant anchor: '+label);
  await assert.rejects(()=>all({[path]:text.replace(a,b)},true),{name:'AssertionError'},'survived: '+label);console.log('KILLED',label);killed++;
 }
 // The pack guard, the cell and determinism live in tools/far-pack.mjs: mutate a copy beside it.
 for(const [label,a,b] of [
  ['coarse level written into data/baked',"if(!dir.startsWith(work))throw","if(false)throw"],
  ['coarse cell 960',"cell:1920,block:1920","cell:960,block:1920"],
  ['coast interpolated from the sea corner',"const [e,n]=at(lo);return [e,n,0];","const t=dry[2]/(dry[2]-wet[2]);const [e,n]=at(t);return [e,n,0];"],
 ]){
  const text=source('tools/far-pack.mjs');assert.equal(text.split(a).length,2,'mutant anchor: '+label);
  const copy=root+'tools/.far-pack-mutant.mjs';writeFileSync(copy,text.replace(a,b));
  try{const m=await import(copy+'?'+killed);
   assert.throws(()=>{
    const meta={root:[-3840,-3840,3840,3840],anchor:[0,0],origin:[0,0],radius:20000},height=(e,n)=>{const r=Math.hypot(e,n);return r<12000?Math.max(-.5,200-r/50):-.5;};
    assert.equal(m.COARSE.cell,1920,'coarse cell');
    const area=x=>{let sum=0;const v=x.vertices,ix=x.indices;for(let t=0;t<ix.length;t+=3){const p=ix[t]*3,q=ix[t+1]*3,r=ix[t+2]*3;sum+=Math.abs((v[q]-v[p])*(v[r+2]-v[p+2])-(v[r]-v[p])*(v[q+2]-v[p+2]))/2;}return sum;};
    assert.ok(Math.abs(area(m.coarseMesh(meta,height))/(Math.PI*10000**2-7680**2)-1)<.02,'coast on the zero line');
    assert.deepEqual(levelBytes(m.coarseMesh(meta,height)),levelBytes(coarseMesh(meta,height)),'same coarse level');
    const dir=realpathSync(mkdtempSync(join(tmpdir(),'far-choice-')));
    try{const data=dir+'/data';mkdirSync(data+'/baked/terrain',{recursive:true});writeFileSync(data+'/baked/terrain/far-land.json','{}');
     let refused=false;try{m.addCoarseLevel(data+'/baked/terrain',data);}catch(e){refused=/only into a task folder/.test(e.message);}
     assert.ok(refused,'refuses data/baked');}finally{rmSync(dir,{recursive:true});}
   },{name:'AssertionError'});
  }finally{rmSync(copy);}
  console.log('KILLED',label);killed++;
 }
 console.log(`PASS mutations: ${killed} killed`);
}
