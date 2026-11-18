import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
const source=readFileSync(new URL('./sidewalks-fix-browser.sh',import.meta.url),'utf8');
const setup=source.match(/^OUT="\$\{OUT:-[^]*?(?=^FIXTURES=)/m)?.[0];assert.ok(setup,'actual output setup');
const root=mkdtempSync(join(tmpdir(),'mmm-sidewalk-output-'));
function run(code,phase,output,scratch){
 const text=execFileSync('bash',['-c','set -euo pipefail; ROOT="$1"; SIDEWALK_RUNTIME_PHASE="$2"; OUT="$3"; MMM_CHECK_OUT="$4"; '+code.trimEnd()+'\nprintf "RESULT=%s\n" "$OUT"','_',root,phase,output,scratch],{encoding:'utf8'});
 return text.match(/^RESULT=(.*)$/m)[1];
}
try{
 const scratch=join(root,'row-scratch'),explicit=join(root,'named-output');
 const kept=run(setup,'proof',scratch,scratch);assert.notEqual(kept,scratch,'proof survives success scratch deletion');assert.ok(existsSync(kept));assert.ok(kept.startsWith(join(root,'data/work/checks/checks-sidewalks-proof-')));
 assert.equal(run(setup,'proof',explicit,scratch),explicit,'explicit user output remains selected');assert.equal(run(setup,'frames',scratch,scratch),scratch,'timing scratch path unchanged');
 const old='OUT="${OUT:-$ROOT/data/work/threads/sidewalks/fix-pass1}";mkdir -p "$OUT"';
 assert.throws(()=>assert.notEqual(run(old,'proof',scratch,scratch),scratch),{code:'ERR_ASSERTION'});
 const counts=readFileSync(new URL('./sidewalks-counts.sh',import.meta.url),'utf8'),countSetup=counts.match(/^OUT="\$\{OUT:-[^]*?(?=^cd "\$ROOT\/web")/m)?.[0];assert.ok(countSetup);
 const countOutput=run(countSetup,'counts',scratch,scratch);assert.notEqual(countOutput,scratch);assert.ok(existsSync(countOutput));assert.equal(run(countSetup,'counts',explicit,scratch),explicit);
 console.log('PASS real proof/count output setup preserves named evidence; old scratch-deletion mutant FAILS; explicit/timing output unchanged');
}finally{rmSync(root,{recursive:true,force:true});}
