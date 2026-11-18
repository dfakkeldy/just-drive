#!/usr/bin/env node
import { readBaseline } from './baseline-source.mjs';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const dir=mkdtempSync(join(tmpdir(),'mmm-preview-cost-')), baseline=process.argv.includes('--baseline');
const mutations=[
 ['full-route-per-tick','const candidates = this.props!.mailCandidates(previewBounds(start, v.heading));','const candidates = undefined;'],
 ['unchanged-preview-recomputed','if (cached && cached.height', 'if (false && cached && cached.height'],
 ['scene-invalidation-removed','this.previewRevision, this.terrain.dataRevision','0, this.terrain.dataRevision'],
];
async function run(mutation) {
 const file=join(dir,(mutation?.[0]??'current')+'.mjs');
 await build({entryPoints:['tools/mail-preview-cost-cases.mjs'],bundle:true,platform:'node',format:'esm',outfile:file,logLevel:'silent',nodePaths:[process.cwd()+'/web/node_modules'],plugins:[{name:'counter',setup(b){
  b.onLoad({filter:/web\/src\/(mail|props|mail-flight)\.ts$/},a=>{
   const name=a.path.split('/').pop();let s=readFileSync(a.path,'utf8');
   if(baseline)s=readBaseline('mail-preview-cost',`web/src/${name}`);
   if(mutation&&name==='mail.ts'){assert.equal(s.split(mutation[1]).length,2,mutation[0]+' anchor');s=s.replace(mutation[1],mutation[2]);}
   const count=(s,from,to)=>{assert.ok(s.includes(from),'missing cost counter '+name+' '+from);return s.replace(from,to);};
   if(name==='mail-flight.ts')s=count(s,'    const contact = advanceMail(', '    globalThis.__previewCost.ticks++;\n    const contact = advanceMail(');
   if(name==='mail.ts'){
    const start=s.indexOf('  private nextDue('),end=s.indexOf('  private prepareThrow(',start);
    const block=s.slice(start,end).replace(/const p = this\.props\.(mail|sites)\[i\]/g,match=>'globalThis.__previewCost.selection++; '+match);
    s=s.slice(0,start)+block+s.slice(end);
    if(!baseline)s=count(s,'      this.cueIndex = cached.cue;', '      globalThis.__previewCost.hits++; this.cueIndex = cached.cue;');
   }
   if(name==='props.ts') {
    for(const [method,next,key] of [['  mailHit(','\n  /**','boxes'],...(!baseline?[['  mailCandidates(','\n  /**','filter']]:[])]) {
     const start=s.indexOf(method),end=s.indexOf(next,start);assert.ok(start>=0&&end>start,'counter scope '+method);
     const block=s.slice(start,end).replace(/const p = this\.(mail|sites)\[i\]/g,match=>`globalThis.__previewCost.${key}++; `+match);
     s=s.slice(0,start)+block+s.slice(end);
    }
   }
   return {contents:s,loader:'ts'};
  });
 }}]});
 const r=spawnSync(process.execPath,[file],{encoding:'utf8',maxBuffer:1024*1024});assert.equal(r.status,0,r.stderr);
 const report=JSON.parse(r.stdout.trim().split('\n').at(-1)); if(!baseline)report.source='working-tree'; return report;
}
function verify(actual,old) {
 assert.equal(actual.dataHash,old.dataHash,'benchmark inputs changed: explicitly regenerate the 5d678ed baseline');
 assert.equal(actual.digest,old.stage2Digest,'Stage 2 opening preview decisions/flights changed, including invalidation cases');
 assert.ok(actual.profiles.moving.boxes.mean<old.profiles.moving.boxes.mean*.1,'moving collision tests must fall by at least 90%');
 assert.equal(actual.profiles['unchanged-warm'].ticks.max,0,'unchanged inputs reuse exact predictions');
 assert.ok(actual.profiles['same-frame-repeat'].hits.mean>.8,'same-frame throw preparation reuses nontrivial previews');
 assert.equal(actual.profiles['same-frame-repeat'].ticks.mean,actual.profiles.moving.ticks.mean,'the second same-frame preparation adds no physics ticks');
 assert.equal(actual.profiles['same-frame-repeat'].boxes.mean,actual.profiles.moving.boxes.mean,'the second same-frame preparation adds no collision scans');
}
try {
 if(process.argv.includes('--record-stage2')){console.log(JSON.stringify(await run(),null,2));}
 else if(baseline){console.log(JSON.stringify(await run(),null,2));}
 else {
  const old=JSON.parse(readFileSync('tools/baseline/mail-preview-cost.json','utf8')),current=await run();verify(current,old);
  console.log(JSON.stringify({before:old,after:current}));
  if(process.argv.includes('--mutations'))for(const m of mutations){const bad=await run(m);assert.throws(()=>verify(bad,old),{name:'AssertionError'},m[0]+' must fail');console.log('KILLED '+m[0]+' (assertion failure)');}
 }
} finally {rmSync(dir,{recursive:true,force:true});}
