// Prove that the permanent rule check rejects deliberately broken implementations.
import { validateMutations } from './mutation-source.mjs';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),source=resolve(root,'web/src/road-scene-rules.ts'), original=readFileSync(source,'utf8');
const mutants=[
 ['schedule','return day % 3 === 2;','return day % 3 === 1;'],
 ['truck mirror coverage','truckWidth: 1.45','truckWidth: 1.2'],
 ['car mirror coverage','carWidth: 1.06','carWidth: .9'],
 ['speed cap','speed: 6,','speed: 9,'],
 ['trigger','distance <= FISH.trigger','distance <= 1'],
 ['leave freezes','distance > FISH.leave','distance > 999999'],
 ['stop gap','-FISH.carHalf - FISH.truckHalf - FISH.gap','-FISH.carHalf - FISH.truckHalf + 1'],
 ['three honks','honks: 3,','honks: 1,'],
 ['horn cooldown','this.cooldown > 0','this.cooldown > 999'],
 ['horn range','distance > FISH.hornRange','distance > 9999'],
 ['moving car yields','&& carCanMove','&& true'],
 ['truck yields','if (truckCanMove) this.truckAlong','if (true) this.truckAlong'],
 ['unknown ending',"SCENE_TEXT.unresolved;","SCENE_TEXT.reportClear;"],
 ['new shift reset','this.seen = false; this.honks =','this.seen = true; this.honks ='],
 ['one excessive call','this.honks === FISH.excessHonks','this.honks >= FISH.excessHonks'],
];
validateMutations(root, mutants.map(([name,from,to])=>({name,edits:[{file:'web/src/road-scene-rules.ts',from,to}]})));
const dir=mkdtempSync(`${tmpdir()}/mmm-scene-mutations-`);
try {
 for(const [name,from,to] of mutants){
  assert.ok(original.includes(from),name+' mutation anchor');
  await build({entryPoints:[resolve(root,'tools/road-scene-check.mjs')],bundle:true,platform:'node',format:'esm',outfile:`${dir}/check.mjs`,logLevel:'silent',plugins:[{name:'break-one-rule',setup(b){b.onLoad({filter:/road-scene-rules\.ts$/},()=>({contents:original.replace(from,to),loader:'ts',resolveDir:dirname(source)}));}}]});
  const result=spawnSync(process.execPath,[`${dir}/check.mjs`],{cwd:resolve(root,'web'),encoding:'utf8'});
  assert.notEqual(result.status,0,'check must reject '+name);assert.match(result.stderr,/AssertionError/,name+' fails assertion, not setup');
  console.log('REJECTED deliberate break:',name);
 }
}finally{rmSync(dir,{recursive:true,force:true});}
console.log('PASS 15 deliberate rule breaks detected; source unchanged.');
