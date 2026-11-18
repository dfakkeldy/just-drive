import { readBaseline } from './baseline-source.mjs';
// The current assertions must reject the previous delivered source, without another checkout.
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(`${tmpdir()}/mmm-scene-prior-`);
const sources=new Map(['road-scene.ts','road-scene-rules.ts','vehicle.ts'].map(name=>[resolve(root,'web/src',name),readBaseline('road-scene',`web/src/${name}`)]));
const rules=resolve(root,'web/src/road-scene-rules.ts');
if (!/\bHOOF_SET_IN\b/.test(sources.get(rules))) sources.set(rules,sources.get(rules)+'\nexport const HOOF_SET_IN = 0;\n');

try{
 for(const check of ['road-scene-placement-check','road-scene-sea-check']){
  await build({entryPoints:[resolve(root,'tools',check+'.mjs')],bundle:true,platform:'node',format:'esm',outfile:`${dir}/check.mjs`,logLevel:'silent',plugins:[{name:'prior-delivery',setup(b){b.onLoad({filter:/\.ts$/},args=>sources.has(args.path)?{contents:sources.get(args.path),loader:'ts',resolveDir:dirname(args.path)}:undefined);}}]});
  const result=spawnSync(process.execPath,[`${dir}/check.mjs`],{cwd:resolve(root,'web'),encoding:'utf8'});assert.notEqual(result.status,0,check+' must fail on prior delivery');assert.match(result.stderr,/AssertionError/);console.log('REJECTED prior source:',check,'exit',result.status);
 }
}finally{rmSync(dir,{recursive:true,force:true});}
console.log('PASS current placement and sea-cow assertions reject 2d9ab43.');
