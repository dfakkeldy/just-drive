import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const run=spawnSync('tools/check-stunt-lod.sh',[],{encoding:'utf8',maxBuffer:2**20,
  env:{...process.env,STUNT_LOD_MODE:'identity',STUNT_LOD_MUTANT:'ordinary-ground-plus-10cm'}});
assert.equal(run.signal,null,'mutant must finish');
assert.equal(run.status,1,'ordinary-ground mutant must fail');
assert.match(run.stderr,/AssertionError/,'must fail a behavior assertion');
assert.match(run.stderr,/MAIN_PATH_REGRESSION: no-park/,'the independent main row must catch the fault');
writeFileSync(process.env.OUT+'/main-path-mutant.json',JSON.stringify({status:run.status,stderr:run.stderr},null,2)+'\n');
console.log('PASS rejected a 10 cm change to ordinary ground through the production Terrain loader');
