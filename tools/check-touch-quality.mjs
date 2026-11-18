// Bundles into a small temporary directory. Mutations never change source served to another browser.
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const checkStarted = performance.now();
const dir = mkdtempSync(join(tmpdir(),'mmm-touch-quality-'));
const mutations = [
 ['touch-default-high', "touch && (saved !== 'high' || !writable)", 'false'],
 ['ignore-saved-high', "saved === 'high' && writable", 'true && writable'],
 ['guard-forced', 'touch && !forced', 'touch'],
 ['ignore-visible-try', "if (s.mark === 'try') return fallback('device');", ''],
 ['late-death-limit', 's.deaths >= 2', 's.deaths >= 3'],
 ['late-unfinished-limit', 's.unfinished >= 3', 's.unfinished >= 4'],
 ['clear-deaths-on-health', "s.mark = 'ok'; s.unfinished = 0;", "s.mark = 'ok'; s.unfinished = 0; s.deaths = 0;"],
 ['forget-healthy-session', "s.mark = 'ok';", 's.mark = null;'],
 ['ignore-clean-leave', "s.unfinished = 0; s.deaths = 0;", 's.unfinished = 0;'],
 ['early-health', 's.good >= 20 - 1e-6', 's.good >= 18 - 1e-6'],
 ['late-health', 's.good >= 20 - 1e-6', 's.good >= 22 - 1e-6'],
 ['health-with-deaths-disabled',"s.mark === 'try' && s.good","s.mark === 'try' && s.deaths === 0 && s.good"],
 ['health-at-19', 'rate >= 20 - 1e-6', 'rate >= 19 - 1e-6'],
 ['keep-good-across-below-health', 's.good + s.time : 0', 's.good + s.time : s.good'],
 ['four-second-window', 's.time < 2 - 1e-6', 's.time < 4 - 1e-6'],
 ['early-slow', 's.slow >= 12 - 1e-6', 's.slow >= 10 - 1e-6'],
 ['late-slow', 's.slow >= 12 - 1e-6', 's.slow >= 14 - 1e-6'],
 ['fail-at-15', 'rate < 15 - 1e-6', 'rate <= 15 + 1e-6'],
 ['ignore-loading', '!event.settled ||', 'false ||'],
 ['ignore-hidden', '!event.visible ||', 'false ||'],
 ['accumulate-slow', 's.slow + s.time : 0', 's.slow + s.time : s.slow'],
 ['count-resume-gap', "if (s.skipNext) return { state: { ...pause(s), skipNext: false }, action: 'none' };", ''],
 ['ignore-context-loss', "case 'lost': case 'crawl': return fallback('device');", "case 'lost': return {state:s,action:'none'}; case 'crawl': return fallback('device');"],
];
async function run(name, from, to) {
  await build({entryPoints:['tools/touch-quality-policy-check.mjs'],bundle:true,platform:'node',format:'esm',
    outfile:join(dir,`${name}.mjs`),logLevel:'silent', plugins:from ? [{name:'mutation',setup(b) {
      b.onLoad({filter:/touch-quality-policy\.ts$/}, a => {
        const source = readFileSync(a.path,'utf8'); assert.ok(source.includes(from),`missing mutation ${name}`);
        return {contents:source.replace(from,to),loader:'ts'};
      });
    }}] : []});
  const r = spawnSync(process.execPath,[join(dir,`${name}.mjs`)],{encoding:'utf8'});
  assert.equal(r.signal,null,`crash ${name}`);
  if (!from) { process.stdout.write(r.stdout + r.stderr); assert.equal(r.status,0); }
  else { assert.notEqual(r.status,0,`SURVIVED ${name}`); console.log(`KILLED ${name}`); }
}
try { await run('baseline'); for (const m of mutations) await run(...m); }
finally { rmSync(dir,{recursive:true,force:true}); }

// Actual adapter/storage contract plus the main-versus-branch desktop comparison.
for (const mutation of [null,'read-back-removed','retry-removed','no-forced-recovery','desktop-touch-rule','refused-cleanup-removed','notice-order-swapped']) {
  const result=spawnSync(process.execPath,['tools/touch-quality-storage-check.mjs'],{encoding:'utf8',env:{...process.env,...(mutation?{TQ_STORAGE_MUTATION:mutation}:{})}});
  if(!mutation){process.stdout.write(result.stdout+result.stderr);assert.equal(result.status,0);}
  else {assert.notEqual(result.status,0,`SURVIVED adapter ${mutation}`);assert.ok(result.stdout.includes('PASS adapter')||result.stderr.includes('FAIL adapter'));console.log(`KILLED adapter ${mutation}`);}
}

// Enforce the source boundary itself, then exercise every reachable one-operation fault.
const { boundary }=await import('./touch-quality-module.mjs');
boundary();
const direct=readFileSync('web/src/detail.ts','utf8')+"\nlocalStorage.getItem('mmm.detail');\n";
assert.throws(()=>boundary({'detail.ts':direct}),/bypasses quality-store/);
console.log('KILLED direct-localStorage-bypass');
const sweep=spawnSync(process.execPath,['tools/touch-quality-sweep.mjs'],{encoding:'utf8',env:process.env});
process.stdout.write(sweep.stdout+sweep.stderr);assert.equal(sweep.status,0);

for(const mutation of ['quorum-removed','single-mutation-attempt','newer-intent-ignored']){
 const bad=spawnSync(process.execPath,['tools/touch-quality-sweep.mjs'],{encoding:'utf8',env:{...process.env,TQ_SWEEP_MUTATION:mutation}});
 assert.notEqual(bad.status,0,'SURVIVED '+mutation);console.log('KILLED sweep '+mutation);
}

const witnesses=spawnSync(process.execPath,['tools/touch-quality-baseline-witnesses.mjs'],{encoding:'utf8'});
process.stdout.write(witnesses.stdout+witnesses.stderr);assert.equal(witnesses.status,0);
console.log('CHECK_RUNTIME_SECONDS '+((performance.now()-checkStarted)/1000).toFixed(2));
