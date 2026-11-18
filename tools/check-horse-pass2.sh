#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
node --input-type=module <<'JS'
import {build} from './web/node_modules/esbuild/lib/main.js';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import{tmpdir}from'node:os';
const root=process.cwd(),dir=mkdtempSync(tmpdir()+'/mmm-horse-pass2-'),base=process.env.HORSE_PASS2_BASE;
try{
 await build({entryPoints:['tools/horse-pass2-check.mjs'],bundle:true,platform:'node',format:'esm',outfile:dir+'/check.mjs',logLevel:'silent',plugins:[{name:'node-deps',setup(b){b.onResolve({filter:/(typescript\/lib\/typescript|esbuild\/lib\/main)\.js$/},a=>({path:resolve(a.resolveDir,a.path),external:true}));b.onLoad({filter:/world-update-fixture\.mjs$/},a=>({contents:readFileSync(a.path,'utf8').replaceAll('import.meta.url',JSON.stringify(pathToFileURL(a.path).href)),loader:'js'}));}},...(base?[{name:'review-base',setup(b){b.onLoad({filter:/\/web\/src\/.*\.ts$/},a=>({contents:execFileSync('git',['show',base+':'+a.path.slice(root.length+1)],{encoding:'utf8'}),loader:'ts',resolveDir:a.path.slice(0,a.path.lastIndexOf('/'))}));}}]:[])]});
 const result=spawnSync(process.execPath,[dir+'/check.mjs'],{stdio:'inherit',env:{...process.env,MMM_ROOT:root}});process.exitCode=result.status??1;
}finally{rmSync(dir,{recursive:true,force:true});}
JS
