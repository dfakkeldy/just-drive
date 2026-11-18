// Paired count comparison only; NEVER reads or writes absolute MacBook budget pins.
import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
import {measure} from './frame-budget-check.mjs';import {scenes,modes} from './frame-budget-policy.mjs';import {countMetrics,countDelta,checkCountDelta,checkUnchangedCounts,checkProvenCountDelta} from './sidewalks-counts-policy.mjs';
// The baseline is the same tree with ?sidewalks=0 (no companion, no slab, no clearing, no pole moves: main's page), so the
// row stays meaningful after a squash merge; BASE_URL (a separate main checkout) remains for a cross-tree comparison.
const [out,origin]=process.argv.slice(2),base=process.env.BASE_URL||origin,baseQuery=process.env.BASE_URL?{}:{sidewalks:'0'},zero=process.env.SIDEWALK_COUNT_EXPECT_ZERO==='1',diagnostic=process.env.SIDEWALK_COUNTS_DIAGNOSTIC==='1';
const programs=async page=>page.read(`(()=>{
 const r=mmm.renderer,b=__budget,direct=r.renderBufferDirect.bind(r);b.programObjects=new Map();
 r.renderBufferDirect=(...args)=>{const result=direct(...args),m=args[3],o=args[4],p=r.properties.get(m).currentProgram;
  if(p){const key=p.cacheKey+'|'+o.uuid;b.programObjects.set(key,{key:p.cacheKey,name:o.name,parent:o.parent?.name,type:o.type,count:o.count,instanceColor:!!o.instanceColor,material:m.type,side:m.side});}return result;};
 Object.defineProperty(b,'mutation',{get(){return {programs:r.info.programs.map(p=>({id:p.id,key:p.cacheKey})),objects:[...b.programObjects.values()],materials:[...b.materials].map(m=>({type:m.type,name:m.name,side:m.side,colors:m.vertexColors,programs:[...(r.properties.get(m).programs?.values()??[])].map(p=>p.id)}))}}});return true;
})()`);
// A separate base checkout without far views (SIDEWALK_COUNT_BASE_FAR=0, set by sidewalks-counts.sh) never shows them.
const baseFar=!process.env.BASE_URL||process.env.SIDEWALK_COUNT_BASE_FAR!=='0';
const proven=process.env.SIDEWALK_COUNT_EXPECT_PROVEN==='1'&&!zero?JSON.parse(readFileSync(new URL('./baseline/sidewalks-count-deltas.json',import.meta.url),'utf8')):null;
// pointtupper-start (main's Port Hawkesbury scene) has explore modes only; SIDEWALK_COUNT_VIEWS measures a subset.
const all=['new-player-start','village-start','harbour-water','mines-lookoff-south','highway19-far-land','pointtupper-start'];
const wanted=process.env.SIDEWALK_COUNT_VIEWS?process.env.SIDEWALK_COUNT_VIEWS.split(','):all;assert.ok(wanted.every(v=>all.includes(v)),'known count view');
const report={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),base:process.env.SIDEWALK_MEASURE_BASE_REF??'same tree, ?sidewalks=0',host:process.env.HOSTNAME??'remote count host',method:diagnostic?'one paired shader-inventory diagnostic; radio and songs off on both sides':'five fresh paired loads per view/mode, same hardware, radio and songs off on BOTH sides; deltas only; no MacBook pin update',rows:[]};
const save=()=>writeFileSync(`${out}/paired-counts.json`,JSON.stringify(report,null,2)+'\n');let failed=false;
try{
 for(const scene of scenes.filter(s=>diagnostic?s.id==='highway19-far-land':wanted.includes(s.id)))for(const mode of modes.filter(m=>(!scene.exploreOnly||m.explore)&&(!diagnostic||m.id==='desktop-mail'))){
  const row={view:scene.id,mode:mode.id,low:mode.phone,pairs:[]};report.rows.push(row);
  for(let n=0;n<(diagnostic?1:5);n++){
   const main=await measure(scene,mode,diagnostic?programs:undefined,{origin:base,query:baseQuery,radioOff:true,programInventory:true,farWait:baseFar}),current=await measure(scene,mode,diagnostic?programs:undefined,{origin,radioOff:true,programInventory:true});
   const delta=countDelta(main.counts,current.counts);row.pairs.push({main,current,delta});save();console.log('PAIRED COUNT',JSON.stringify({view:scene.id,mode:mode.id,run:n+1,main:main.counts,current:current.counts,delta}));
   try{if(proven)checkProvenCountDelta(delta,proven[scene.id+'/'+mode.id]);if(zero)checkUnchangedCounts(delta,main.programKeys,current.programKeys);checkCountDelta(delta,mode.phone,current.groups,{view:scene.id,mode:mode.id,addedPrograms:current.programKeys.filter(k=>!main.programKeys.includes(k)),removedPrograms:main.programKeys.filter(k=>!current.programKeys.includes(k))});}catch(error){row.failure=error.message;failed=true;console.error('FAIL COUNT DELTA',scene.id,mode.id,error.message);}
  }
  for(const side of ['main','current'])for(const metric of countMetrics){const values=row.pairs.map(p=>p[side].counts[metric]);assert.ok(values.every(v=>v===values[0]),`${scene.id}/${mode.id}: ${side} ${metric} not exact over five loads`);}
  row.main=row.pairs[0].main.counts;row.current=row.pairs[0].current.counts;row.delta=row.pairs[0].delta;row.pass=!row.failure;save();
 }
 const expectedRows=scenes.filter(s=>wanted.includes(s.id)).reduce((n,s)=>n+modes.filter(m=>!s.exploreOnly||m.explore).length,0);
 assert.equal(report.rows.length,diagnostic?1:expectedRows);assert.ok(!failed,'one or more same-host count deltas exceed approved limits');console.log(diagnostic?'PASS paired shader-inventory diagnostic':`PASS paired radio-off counts, ${expectedRows} views/modes, five repeats each`);
}finally{save();}
