// The rejected-entry negative control keeps fabric and the original keys/guard/body bounds.
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const base=resolve(process.env.OUT??'data/work/stunt-arch-entry-mutant');mkdirSync(base,{recursive:true});const out=mkdtempSync(base+'/mutant-');
const result=spawnSync('tools/yard-shots.sh',['1400','950'],{encoding:'utf8',timeout:3600000,maxBuffer:2**22,
 env:{...process.env,OUT:out,RUN:'stunt-arch-crossing.mjs',VIEWS:'park|park=test',STUNT_ARCH_HILLS:'2.5',STUNT_ARCH_INDICES:'1',STUNT_ARCH_ORIGINAL_ENTRY:'1'}});
writeFileSync(out+'/child.stdout.log',result.stdout??'');writeFileSync(out+'/child.stderr.log',result.stderr??'');
const marker=out+'/latest-arch-run.txt',run=existsSync(marker)?readFileSync(marker,'utf8').trim():out,file=run+'/stunt-arch-crossings.json';if(!existsSync(file)){console.error('CANNOT RUN old-rise mutant: no measured ordinary receipt');process.exit(2);}
const report=JSON.parse(readFileSync(file,'utf8')),row=report.rows.find(r=>r.hill===2.5&&r.index===1),mutation=row?.entryMutant;
assert.ok(mutation&&mutation.movedMetres===5&&mutation.newRise===5.8&&mutation.fabric&&mutation.startUnchanged,'the old location and5.80m fabric frame must actually be restored');
assert.equal(result.status,1,'restoring the rejected entry must fail the unchanged ordinary crossing row');
assert.ok(row.last.attached&&row.last.contacts>0,'negative verdict includes actual coupled contacts');
assert.ok(row.hitTrace.some(h=>h.spec.halfLength===4.45&&h.possible.some(p=>p.kind==='dressing'&&p.index===1&&p.id==='start-arch')),'the trailer must hit the old steel arch volume');
assert.ok(/AssertionError/.test(result.stdout+result.stderr),'startup/runtime failure cannot kill this mutant');
console.log('PASS rejected-entry mutant: ordinary trailer contact rejects the old steel height',{mutation,contacts:row.last.contacts});
