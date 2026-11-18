// Real page mutations plus subprocess checks against the same CLI engine and policy used by check-budget.sh.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,copyFileSync,constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {scenes,modes,metrics,coverage,compare,serialize} from './frame-budget-policy.mjs';
export async function mutations({origin,baselinePath,measure}) {
  assert.ok(readFileSync(new URL('./frame-budget-policy.mjs',import.meta.url),'utf8').includes("  {id:'new-player-start',chase:true},\n"),'missing mutation anchor new-player-start in tools/frame-budget-policy.mjs');
  const shipped=JSON.parse(readFileSync(baselinePath,'utf8'));
  assert.equal(coverage(shipped),false);
  console.log('SUBSET live-mutations: village-start/phone-mail; full manifest validated');
  const scene=scenes.find(s=>s.id==='village-start'),mode=modes.find(m=>m.id==='phone-mail'),key=`${scene.id}/${mode.id}`;
  const ordinary=await measure(scene,mode);
  assert.ok(Number.isSafeInteger(ordinary.counts.calls)&&ordinary.counts.calls>0,'the mutation baseline must draw the real scene');
  assert.equal(compare(key,ordinary.counts,shipped[key],s=>console.log(s)),false,'the ordinary scene must fit the shipped ceilings');
  console.log('MUTATION ordinary '+JSON.stringify({counts:ordinary.counts,ceiling:shipped[key]}));
  const extra=await measure(scene,mode,page=>page.read(`(() => {
    let source; mmm.vehicle.car.root.traverse(o=>{if(!source&&o.type==='Mesh'&&!Array.isArray(o.material)&&o.material.visible&&o.geometry.attributes.position.count>0)source=o});
    if(!source)throw Error('No ordinary mesh to clone');
    const perMeshCalls=source.material.transparent&&source.material.side===2&&!source.material.forceSinglePass?2:1;
    const meshes=Math.max(1,Math.floor((${shipped[key].calls}-${ordinary.counts.calls})/perMeshCalls)+1);
    for(let i=0;i<meshes;i++){
      const mesh=source.clone(false);mesh.name='Frame budget extra mesh';mesh.castShadow=false;mesh.frustumCulled=false;
      mesh.position.copy(mmm.camera.position);mesh.position.z-=10;__budget.scene.add(mesh);
    }
    __budget.mutation={side:source.material.side,transparent:source.material.transparent,forceSinglePass:source.material.forceSinglePass,
      meshes,perMeshCalls,expectedCalls:meshes*perMeshCalls};
  })()`));
  const messages=[];assert.equal(compare(key,extra.counts,shipped[key],s=>{messages.push(s);console.log(s)}),true);
  assert.equal(extra.counts.calls-ordinary.counts.calls,extra.mutation.expectedCalls);
  assert.ok(messages.some(s=>s.includes(' calls=')&&s.includes('tools/check-budget.sh --raise --scene village-start --mode phone-mail')&&s.includes('pull request must say what the player gets')));
  console.log('MUTATION extra-mesh '+JSON.stringify({delta:extra.counts.calls-ordinary.counts.calls,...extra.mutation}));
  const removed=await measure(scene,mode,page=>page.read('void mmm.trees.group.parent.remove(mmm.trees.group)'));
  const saving=[];assert.equal(compare(key,removed.counts,shipped[key],s=>{saving.push(s);console.log(s)}),false);
  assert.equal(saving.length,1,'all savings combine into one row line');assert.ok(saving[0].startsWith(`SAVING ${key}:`));
  const nineteen=[];assert.equal(compare(key,{...shipped[key],calls:Math.ceil(shipped[key].calls*.81)},shipped[key],s=>nineteen.push(s)),false);
  assert.equal(nineteen.length,1);console.log('MUTATION 19-percent-saving '+nineteen[0]);
  const scratch=mkdtempSync(join(tmpdir(),'mmm-budget-policy-'));
  // Exercise CLI boundaries at the live counts, even when the scene has made valid savings.
  const baseline={...shipped,[key]:Object.fromEntries(metrics.map(k=>[k,ordinary.counts[k]]))};
  const cliBaselinePath=join(scratch,'live-ceilings.json');
  const core=fileURLToPath(new URL('./frame-budget-check.mjs',import.meta.url));
  function child(args,file=cliBaselinePath) {
    const result=spawnSync(process.execPath,[core,scratch,origin+'/?test=1'],{encoding:'utf8',env:{...process.env,FRAME_BUDGET_ARGS:JSON.stringify(args),FRAME_BUDGET_BASELINE:file},maxBuffer:8*1024*1024});
    if(result.error)throw result.error;return {...result,text:result.stdout+result.stderr};
  }
  try {
    writeFileSync(cliBaselinePath,serialize(baseline));
    // Delete an actual manifest declaration from a clone (copy-on-write where the disk has it), not a synthetic comparison implementation.
    const variant=join(scratch,'frame-budget-policy.mjs');
    copyFileSync(fileURLToPath(new URL('./frame-budget-policy.mjs',import.meta.url)),variant,constants.COPYFILE_FICLONE);
    writeFileSync(variant,readFileSync(variant,'utf8').replace("  {id:'new-player-start',chase:true},\n",''));
    const deletedCore=join(scratch,'frame-budget-check.mjs');
    copyFileSync(core,deletedCore,constants.COPYFILE_FICLONE);
    // The copied check imports its sibling modules by relative path. Copy each one it names, except the policy,
    // which is the mutated variant above.
    const siblings=[...readFileSync(core,'utf8').matchAll(/from '\.\/([^'/]+\.mjs)'/g)].map(m=>m[1]).filter(name=>name!=='frame-budget-policy.mjs');
    for(const name of siblings)copyFileSync(fileURLToPath(new URL('./'+name,import.meta.url)),join(scratch,name),constants.COPYFILE_FICLONE);
    const deleted=spawnSync(process.execPath,[deletedCore,scratch,origin+'/?test=1'],{encoding:'utf8',env:{...process.env,FRAME_BUDGET_ARGS:'[]',FRAME_BUDGET_BASELINE:cliBaselinePath}});
    assert.equal(deleted.status,1);assert.match(deleted.stderr,/unexpected baseline row new-player-start/);
    console.log('MUTATION deleted-script-scene exit=1 '+deleted.stderr.trim());
    const missing={...baseline};delete missing[key];const file=join(scratch,'ceilings.json');writeFileSync(file,serialize(missing));
    const noRow=child(['--phone'],file);assert.equal(noRow.status,1);assert.match(noRow.text,/missing baseline row village-start\/phone-mail/);
    console.log('MUTATION deleted-baseline-row exit=1 '+noRow.text.trim());
    const unselected={...baseline};delete unselected[`${scene.id}/desktop-mail`];writeFileSync(file,serialize(unselected));
    const unselectedRow=child(['--phone'],file);assert.equal(unselectedRow.status,1);assert.match(unselectedRow.text,/missing baseline row village-start\/desktop-mail/);
    console.log('MUTATION unselected-desktop-row --phone exit=1 '+unselectedRow.text.trim());

    const unknown={...baseline,'unknown/desktop-mail':baseline[key]};writeFileSync(file,serialize(unknown));
    const unknownRow=child(['--phone'],file);assert.equal(unknownRow.status,1);assert.match(unknownRow.text,/unexpected baseline row unknown/);
    console.log('MUTATION unknown-subset-baseline-row exit=1 '+unknownRow.text.trim());
    const unknownScene=child(['--phone','--scene','unknown']);assert.equal(unknownScene.status,1);assert.match(unknownScene.text,/Unknown scene unknown/);
    console.log('MUTATION unknown-subset-scene exit=1 Unknown scene unknown');
    const lowered=structuredClone(baseline);lowered[key].calls--;writeFileSync(file,serialize(lowered));
    const refused=child(['--update','--scene',scene.id,'--mode',mode.id],file);
    assert.equal(refused.status,1,refused.text);assert.equal(JSON.parse(readFileSync(file,'utf8'))[key].calls,lowered[key].calls);
    assert.match(refused.text,/FAIL village-start\/phone-mail: calls=/);assert.doesNotMatch(refused.text,/^RAISED /m);
    console.log('MUTATION --update cannot raise exit=1 '+refused.text.split('\n').find(s=>s.startsWith(`FAIL ${key}: calls=`)));
    const raised=child(['--raise','--scene',scene.id,'--mode',mode.id],file);
    assert.equal(raised.status,0,raised.text);assert.equal(JSON.parse(readFileSync(file,'utf8'))[key].calls,baseline[key].calls);
    const expected=`RAISED ${key} calls ${lowered[key].calls} -> ${baseline[key].calls}`;assert.ok(raised.text.includes(expected),raised.text);
    console.log('MUTATION --raise exit=0 '+expected);
    // Every untouched row remains byte-equivalent under the canonical one-line format.
    const final=JSON.parse(readFileSync(file,'utf8'));for(const k of Object.keys(baseline))assert.deepEqual(final[k],baseline[k]);
  } finally {rmSync(scratch,{recursive:true});}
  console.log('PASS frame-budget live and CLI policy mutations');return 0;
}
