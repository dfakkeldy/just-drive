import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const[out,base]=process.argv.slice(2),joins=[];
const revision=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});assert.equal(revision.status,0);mkdirSync(out,{recursive:true});writeFileSync(out+'/runtime.json',JSON.stringify({head:revision.stdout.trim(),workingSourceChanges:spawnSync('git',['diff','--quiet','HEAD','--','web/src']).status!==0},null,2));
const run=(file,dir,env={})=>{mkdirSync(dir,{recursive:true});const r=spawnSync(process.execPath,[resolve(import.meta.dirname,file),dir,base],{env:{...process.env,...env},stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);};
for(const[source,baseline]of [['main-f965706',true],['head',false]]){
 await fetch(base+'/__far-views-source?mode='+(baseline?'main':'head'));
 const dir=out+'/'+source;run('far-views-join.mjs',dir,{FAR_MAIN_BASELINE:baseline?'1':'0'});joins.push(JSON.parse(readFileSync(dir+'/join/coverage.json')));
 for(const low of [false,true])run('far-views-browser.mjs',dir,{FAR_LOW:low?'1':'0',FAR_MODES:baseline?'before':'after',FAR_WIDTH:'1280',FAR_HEIGHT:'720'});
}
const paired=joins[1].map((head,i)=>{const main=joins[0][i];assert.deepEqual([head.name,head.low],[main.name,main.low]);assert.equal(head.cracks-main.cracks,0);return{name:head.name,low:head.low,mainCracks:main.cracks,headCracks:head.cracks,delta:head.cracks-main.cracks};});
writeFileSync(out+'/paired-joins.json',JSON.stringify(paired,null,2));
run('far-mini-seating.mjs',out+'/seating');run('far-mini-cost.mjs',out+'/cost');run('far-mini-load.mjs',out+'/programs');run('far-mini-programs.mjs',out+'/programs');
console.log('PASS paired mini joins, horizon views, optional-load and first-bus program counts');
