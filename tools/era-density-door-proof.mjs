// Exercise the fixed doorway fixture with the exact formerly unconditional clamp restored in memory.
import assert from 'node:assert/strict';import {build} from '../web/node_modules/esbuild/lib/main.js';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
const root=process.cwd(),scratch=mkdtempSync(join(tmpdir(),'mmm-density-door-'));
try{
 const file=join(scratch,'mutant.mjs');let changed=false;
 await build({entryPoints:['tools/era-final-check.mjs'],bundle:true,platform:'node',format:'esm',outfile:file,plugins:[{name:'old-clamp',setup(b){b.onLoad({filter:/web\/src\/eras\/history-art\.ts$/},a=>{const text=readFileSync(a.path,'utf8'),from='const entry=barn?entrance:Math.min(entrance,Math.max(0,h-doorH-.15));';assert(text.includes(from),'door clamp fault anchor');changed=true;return {contents:text.replace(from,'const entry=Math.min(entrance,Math.max(0,h-doorH-.15));'),loader:'ts',resolveDir:a.path.slice(0,a.path.lastIndexOf('/'))};});}}]});
 assert(changed);const r=spawnSync(process.execPath,[file],{cwd:root,env:{...process.env,ERA_REVIEW_CASE:'barn-entrance'},encoding:'utf8'});
 assert.notEqual(r.status,0,'fixed barn-door fixture must reject the old unconditional height clamp');assert.match(r.stderr,/uphill barn entrance cannot be buried/);console.log('PASS fixed uphill barn rejects the old unconditional entrance clamp');
}finally{rmSync(scratch,{recursive:true,force:true});}
