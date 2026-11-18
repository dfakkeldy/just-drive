// Runs score-rules-check.mjs (which imports score-shift-check.mjs); with --mutations, each mutant below must fail it.
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(`${tmpdir()}/mmm-score-`);
// [name, anchor, replacement, file under web/src]
const mutants=[
 ['no novelty','before === 0 ? NEW_KIND : REPEAT ** before','1','score-rules'],
 ['repeats never fade','REPEAT ** before','1','score-rules'],
 ['repeats keep a floor','REPEAT ** before','Math.max(.05, REPEAT ** before)','score-rules'],
 ['repeats grow the combo','this.chainKinds.add(e.kind); this.chain = this.chainKinds.size;','this.chain++;','score-rules'],
 ['repeats keep the combo open','this.chain = this.chainKinds.size; this.lastTime = e.time; }','this.chain = this.chainKinds.size; } this.lastTime = e.time;','score-rules'],
 ['stale kinds build combos','before < COMBO_FRESH && ','','score-rules'],
 ['ruts cheaper than a tenth knock','  rut: 10,','  rut: 4,','score-rules'],
 ['combo never ends','if (e.time - this.lastTime > COMBO_WINDOW) this.endChain();','','score-rules'],
 ['no combo','const combo = comboFactor(this.chain);','const combo = 1;','score-rules'],
 ['flat ladder','1 + STEP_BONUS * step','1','score-rules'],
 ['ladder steps down','this.step = Math.max(this.step, stepFor(this.total));','this.step = stepFor(this.total);','score-rules'],
 ['scores at protected places','!PROTECTED.includes(e.place) && ','','score-rules'],
 ['animals score','!(e.subject !== undefined && NEVER.includes(e.subject)) && ','','score-rules'],
 ['bus is a bonus','schoolBus: -300','schoolBus: 300','score-rules'],
 ['bus keeps the combo','this.tally(e.kind, penalty); this.endChain();','this.tally(e.kind, penalty);','score-rules'],
 ['bus is multiplied','this.total += penalty;','this.total += penalty * this.multiplier;','score-rules'],
 ['equal gaps',"{ name: 'Fired', at: 10000,","{ name: 'Fired', at: 6900,",'score-rules'],
 ['top includes penalties','.filter(([, t]) => t.points > 0)','','score-rules'],
 ['shared best key',"BEST_KEY = 'mmm.fired.best.v1'","BEST_KEY = 'mmm.shift.v1'",'score-rules'],
 ['worse run saved','if (!better(run, best)) return best!;','','score-rules'],
 ['quit sweep scores',"    if (this.ended) return;\n    if (this.fired) {","    if (this.ended) return;\n    if (this.fired) for (const i of missedCustomers(this.career.day, this.remaining)) this.add('missing', i, 0, 0, this.elapsed);\n    if (this.fired) {",'shift'],
 ['one kind is a combo','b.bestChain.kinds > 1 ?','b.bestChain.kinds > 0 ?','fired'],
 ['mail sweep dropped','    const at = this.elapsed + .001;\n    if (this.props) {','    const at = this.elapsed + .001;\n    if (false) {','shift'],
 ['held best ignored','held && better(held, stored) ? held : stored','stored','score-rules'],
 ['time left ignored','run.timeLeft > best.timeLeft','false','score-rules'],
 ['cemetery ignored',"if (cemetery?.(x, z)) return 'cemetery';",'','score-rules'],
 ['church too small','+ margin };','};','score-rules'],
 ['stream forgets','for (const listener of this.listeners) listener(event);','','score-events'],
 ['stream unbounded','if (this.recent.length > KEEP) this.recent.shift();','','score-events'],
 ['clear drops listeners','this.reported = 0; this.runs++; }','this.reported = 0; this.runs++; this.listeners.clear(); }','score-events'],
 ['fired not a mode',"|| value === 'fired'",'','mode'],
 ['just offers fired',"if (site?.brand === 'just') return 'explore';",'','mode'],
 ['complaints unheard','this.all.push(c); this.onAdd?.(c);','this.all.push(c);','complaints'],
 ['no box grades','if (damage === 3 || damage > was || damage === 0 && fresh) this.onBump?.(i, damage, speed);','','props'],
 ['every touch rocks','damage === 0 && fresh','damage === 0','props'],
 ['no ruts',"if (this.ruts.count - this.rutMark >= 8) { this.rutMark = this.ruts.count; this.reportScore('rut', vehicle.x, vehicle.z, this.speed); }",'','shift'],
 ['no place',"const place = this.placeAt(x, z);","const place = 'route';",'shift'],
 ['fired saves career','if (!this.fired) { this.career = freshCareer();','{ this.career = freshCareer();','shift'],
 ['landing ignored',"place === 'route' && also ? this.placeAt(also.x, also.z) : place",'place','shift'],
 ['pre-existing box scores','if (!c.preExisting) this.reportScore','this.reportScore','shift'],
 ['fired shows the report','    if (this.fired) {\n','    if (false) {\n','shift'],
 ['stream survives a new day','this.score.clear(); this.rutMark','this.rutMark','shift'],
 ['grades survive a new day',' m.damage = 0;',' m.damage = m.damage;','props'],
 ['ends inside the event','if (this.book.fired) this.pendingEnd = true;','if (this.book.fired) this.shift.end();','fired'],
 ['never ends at Fired','if (this.pendingEnd && !this.shift.ended) { this.pendingEnd = false; this.shift.end(); }','','fired'],
 ['shift never ticks the run','    this.onUpdate?.(dt);\n','','shift'],
 ['run not hooked','    shift.onUpdate = dt => this.update(dt);\n','','fired'],
 ['no steward','this.note.hidden = false; this.noteTime = NOTE_SECONDS;','','fired'],
 ['no best save','this.best = saveBest(run, undefined, this.best);','this.best = run;','fired'],
 ['retry keeps the book','if (this.shift.score.runs !== this.run)','if (false)','fired'],
 ['clear keeps the run','this.reported = 0; this.runs++;','this.reported = 0;','score-events'],
 ['two offences','const top = topOffences(b);','const top = topOffences(b, 2);','fired'],
];
try {
 for(const mutant of [null,...(process.argv.includes('--mutations')?mutants:[])]) {
  const file=mutant?.[3],source=file&&resolve(root,`web/src/${file}.ts`),original=file&&readFileSync(source,'utf8');
  if(mutant)assert.ok(original.split(mutant[1]).length===2,mutant[0]+': anchor must match once');
  await build({entryPoints:[resolve(root,'tools/score-rules-check.mjs')],bundle:true,platform:'node',format:'esm',outfile:`${dir}/check.mjs`,logLevel:'silent',
   plugins:mutant?[{name:'mutate',setup(b){b.onLoad({filter:new RegExp(`/${file}\\.ts$`)},()=>({contents:original.replace(mutant[1],()=>mutant[2]),loader:'ts',resolveDir:dirname(source)}));}}]:[]});
  const r=spawnSync(process.execPath,[`${dir}/check.mjs`],{cwd:resolve(root,'web'),encoding:'utf8',timeout:120000});
  if(!mutant){assert.equal(r.status,0,r.stdout+r.stderr);console.log(r.stdout.trim());}
  else {assert.notEqual(r.status,0,mutant[0]+' survived');assert.match(r.stderr,/AssertionError/,mutant[0]+': '+r.stderr.slice(0,400));console.log('REJECTED',mutant[0]);}
 }
 if(process.argv.includes('--mutations'))console.log(`score rules: ${mutants.length} mutants rejected`);
}finally{rmSync(dir,{recursive:true,force:true});}
