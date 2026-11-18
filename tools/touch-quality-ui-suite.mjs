// One yard-shots browser job; each child owns and closes its tabs. No performance measurements.
// The default runs quality and Explore. The seven other UI jobs and each of the
// eight layout-* variants have separate check-all rows and 1800 s budgets.
// QUALITY_JOBS still selects the original jobs by name, in the requested order.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const [out,first]=process.argv.slice(2);
const jobs=[
  ['quality','touch-quality-browser.mjs',{TOUCH_MUTATIONS:'1'}],
  ['quality-explore','touch-quality-browser.mjs',{TOUCH_MUTATIONS:'0',TOUCH_MODE:'explore',TOUCH_CASES:'default,switch,health,reload-loading,lock,background-discard,stale,clean-healthy-leave,deaths,unfinished,context,slow,blocked,blocked-read,blocked-write,blocked-access,health-write-retry,late-recovery-faults,start-write-failure,counter-resume-write-failure,single-start-readback,refused-start-readback-cleanup,notice-single-failure'}],
  ...['0','1'].flatMap(mp=>['1','2'].flatMap(dpr=>['low','high'].map(detail=>
    [`layout-mp${mp}-dpr${dpr}-${detail}`,'layout-check.mjs',{MP_LAYOUT:mp,DPR:dpr,DETAIL:detail}]))),
  ['detail','detail-check.mjs',{}],
  ['picture','picture-check.mjs',{}],
  ['ui','ui-check.mjs',{}],
  ['touch-path','touch-path-check.mjs',{}],
  ['phone-help','phone-help-browser.mjs',{}],
  ['desktop-layout','desktop-layout-check.mjs',{}],
  ['settings-pictures','touch-quality-browser.mjs',{TOUCH_SHOTS:'1'}],
];
let bad=0;
const selected=process.env.QUALITY_JOBS?process.env.QUALITY_JOBS.split(',').map(name=>{const job=jobs.find(j=>j[0]===name);if(!job)throw new Error('Unknown check '+name);return job;}):jobs.filter(([name])=>name==='quality'||name==='quality-explore');
for(const [name,script,env] of selected) {
  const started=performance.now();
  console.log(`Checking UI job ${name} ${JSON.stringify(env)}`);
  const folder=['touch-path','phone-help','desktop-layout'].includes(name)?`${out}/${name}`:out;
  mkdirSync(folder,{recursive:true});
  const log=createWriteStream(`${out}/${name}.log`);
  const child=spawn(process.execPath,[fileURLToPath(new URL(script,import.meta.url)),folder,first],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  child.stdout.pipe(process.stdout,{end:false});child.stderr.pipe(process.stderr,{end:false});
  const code=await new Promise(r=>child.on('close',(code,signal)=>r(signal?128:code)));
  await new Promise(r=>log.end(r));
  console.log(`UI job ${name} | exit ${code} | ${((performance.now()-started)/1000).toFixed(2)} s`);
  if(code)bad++;
}
process.exitCode=bad?1:0;
