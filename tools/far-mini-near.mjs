import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {nearQuantisationAllowed} from './far-near-allowance.mjs';
const[out,base]=process.argv.slice(2),rows=[],waterOnly=process.env.FAR_MINI_WATER_ONLY==='1';
const repo=resolve(import.meta.dirname,'..'),git=spawnSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'});assert.equal(git.status,0);const dirty=spawnSync('git',['diff','--quiet','HEAD','--','web/src'],{cwd:repo}).status;assert.ok(dirty===0||dirty===1);const runtimeRevision=git.stdout.trim()+(dirty?' + working source changes':'');
function run(dir,env){mkdirSync(dir,{recursive:true});const r=spawnSync(process.execPath,[resolve(import.meta.dirname,'far-views-near.mjs'),dir,base],{env:{...process.env,...env},stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);return JSON.parse(readFileSync(dir+'/near/pixel-diffs.json'));}
for(const[source,baseline]of [['main-f965706',true],['head',false]]){
 await fetch(base+'/__far-views-source?mode='+(baseline?'main':'head'));
 const dir=out+'/'+source,env={FAR_MAIN_BASELINE:baseline?'1':'0',FAR_NEAR_QUALITIES:'desktop,LOW'};
 const water=run(dir+'/water',{...env,FAR_NEAR_WATER:'1',FAR_NEAR_AREAS:'mabou,cansocauseway'});assert.equal(water.length,8);
 const standard=waterOnly?[]:run(dir,{...env,FAR_NEAR_WATER:'0',FAR_NEAR_AREAS:'mabou,judique,porthood,pointtupper,westbay,cansocauseway'});assert.equal(standard.length,waterOnly?0:48);
 rows.push({source,cases:[...standard,...water]});
}
const paired=rows[1].cases.map((head,i)=>{const main=rows[0].cases[i];assert.deepEqual([head.area,head.view,head.detail,head.variant],[main.area,main.view,main.detail,main.variant]);assert.ok(nearQuantisationAllowed(head));assert.ok(nearQuantisationAllowed(main));return{area:head.area,view:head.view,detail:head.detail,variant:head.variant,mainRepeatChanges:main.changed,headCurveChanges:head.changed,mainAllowedSeaPixels:main.allowedSeaPixels,headAllowedSeaPixels:head.allowedSeaPixels,rawDelta:head.changed-main.changed,headExamples:head.examples};});
writeFileSync(out+'/paired-near.json',JSON.stringify({baseline:'f965706',runtime:runtimeRevision,scope:'main A/A repeat versus head original/curved A/B; same mini, serial run',rule:'Only fully covered sea: <=4 pixels per case, max channel delta1. Everything else exact. Temporal/displacement/seam checks have no allowance.',cases:paired},null,2));console.log('PASS paired mini near controls; raw sea quantisation counts saved for every case');
