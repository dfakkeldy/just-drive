// Runs tag-rules-check.mjs; with --mutations, each mutant below must fail it with an assertion.
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(`${tmpdir()}/mmm-tag-`);
const T='web/src/mp/tag-rules',W='web/src/mp/game-wire',G='server/src/game',F='web/src/mp/game-field';
// [name, anchor, replacement, file]
const mutants=[
 ['wide pickup','pickupM: 4,','pickupM: 8,',T],
 ['pickup only where a report lands','segmentDistance(this.s.parcel.x, this.s.parcel.z, prev.x, prev.z, r.x, r.z)','Math.hypot(this.s.parcel.x - r.x, this.s.parcel.z - r.z)',T],
 ['wide steal','stealM: 3,','stealM: 5,',T],
 ['no closing speed','    if (closing < TAG.closingMps) return changed;\n','',T],
 ['no immunity','this.s.immuneUntil = now + TAG.immuneMs;','this.s.immuneUntil = now;',T],
 ['one-second immunity','immuneMs: 3000,','immuneMs: 1000,',T],
 ['pickup shields','this.s.holder = id; this.s.immuneUntil = 0;','this.s.holder = id; this.s.immuneUntil = now + TAG.immuneMs;',T],
 ['never drops','idleMs: 10000,','idleMs: 1e9,',T],
 ['drops at 5 s','idleMs: 10000,','idleMs: 5000,',T],
 ['idle holder scores','const end = Math.min(now, from || Infinity),','const end = now,',T],
 ['parked is fine','return r.parked || Math.hypot(r.vx, r.vz) < TAG.parkedMps ||','return',T],
 ['off road is fine','|| roadDistance(this.s.field, r) > TAG.offRoadM\n','\n',T],
 ['silence is fine','return now - h.at > TAG.silentMs ? h.at : 0;','return 0;',T],
 ['scores at a cemetery',' || this.quiet(r);\n',';\n',T],
 ['steals at a cemetery','if (!h || this.quiet(h)) return changed;','if (!h) return changed;',T],
 ['drop anywhere','if (Math.hypot(p.x - this.s.centre.x, p.z - this.s.centre.z) <= this.s.radius && roadDistance','if (true || roadDistance',T],
 ['reset keeps the parcel','      if (jumped) { this.drop(prev ?? r, now); return true; }\n','',T],
 ['only flagged jumps','> TAG.jumpM + TAG.jumpMps * Math.max(0, now - prev.at) / 1000','> 1e9',T],
 ['ten points a second','score: Math.floor(p.ms / 1000)','score: Math.floor(p.ms / 100)',T],
 ['first road point','if (w < worst - 1e-6 ||','if (best === null ||',T],
 ['start at a quiet place','const open = roadPoints(field).filter(p => !isQuiet(field.quiet, p) &&','const open = roadPoints(field).filter(p =>',T],
 ['area past the field','Math.hypot(p.x - h.x, p.z - h.z) + radius <= TAG.fieldReachM','Math.hypot(p.x - h.x, p.z - h.z) <= TAG.startReachM',T],
 ['fixed area','150 + 50 * Math.sqrt','150 + 0 * Math.sqrt',T],
 ['anyone joins','if (Math.hypot(r.x - this.s.centre.x, r.z - this.s.centre.z) > this.s.radius || this.s.players.length >= 24) return changed;','if (this.s.players.length >= 24) return changed;',T],
 ['dropper picks it straight back up','      if (id === this.s.dropper && now - (this.s.droppedAt ?? 0) < TAG.immuneMs) return changed;\n','',T],
 ['leaver keeps it','    if (id === this.s.holder) { this.drop(this.seen.get(id) ?? this.s.parcel, now); changed = true; }\n','',T],
 ['guest starts','if (!c || id !== s.host) return false;','if (!c) return false;',G],
 ['race ignored','if (this.busy() || raceBusy) return false;','if (this.busy()) return false;',G],
 ['countdown counts','if (this.state.phase !== PHASE.play || !this.round) return changed;','if (!this.round) return changed;',G],
 ['never ends',"if (now >= s.until) { s.phase = PHASE.over;","if (false) { s.phase = PHASE.over;",G],
 ['table forever','if (s.phase === PHASE.over && now >= s.until) { this.free(); changed = true; }','',G],
 ['no version check','v.getUint8(1) !== GAME_WIRE','false',W],
 ['field outside bounds','Math.abs(x as number) <= bounds && Math.abs(z as number) <= bounds','true',W],
 ['field far from host','> FIELD.reach + 50) return null;','> 1e9) return null;',W],
 ['extra text accepted','Object.keys(m).length === 4)','Object.keys(m).length >= 4)',W],
 ['railways in the field','    if (road.railway || road.tags?.railway) continue;\n','',F],
 ['field too big for one text','vertices: 400,','vertices: 520,',W],
 ['field keeps the first tolerance','    if (lines.length === Math.min(runs.length, FIELD.lines)) break;\n','    break;\n',F],
];
try {
 for(const mutant of [null,...(process.argv.includes('--mutations')?mutants:[])]) {
  const file=mutant?.[3],source=file&&resolve(root,`${file}.ts`),original=file&&readFileSync(source,'utf8');
  if(mutant)assert.ok(original.split(mutant[1]).length===2,mutant[0]+': anchor must match once');
  await build({entryPoints:[resolve(root,'tools/tag-rules-check.mjs')],bundle:true,platform:'node',format:'esm',outfile:`${dir}/check.mjs`,logLevel:'silent',
   plugins:mutant?[{name:'mutate',setup(b){b.onLoad({filter:new RegExp(`/${file.split('/').pop()}\\.ts$`)},a=>a.path===source?({contents:original.replace(mutant[1],()=>mutant[2]),loader:'ts',resolveDir:dirname(source)}):undefined);}}]:[]});
  const r=spawnSync(process.execPath,[`${dir}/check.mjs`],{cwd:resolve(root,'web'),encoding:'utf8',timeout:120000});
  if(!mutant){assert.equal(r.status,0,r.stdout+r.stderr);console.log(r.stdout.trim());}
  else {assert.notEqual(r.status,0,mutant[0]+' survived');assert.match(r.stderr,/AssertionError/,mutant[0]+': '+r.stderr.slice(0,400));console.log('REJECTED',mutant[0]);}
 }
 if(process.argv.includes('--mutations'))console.log(`tag rules: ${mutants.length} mutants rejected`);
}finally{rmSync(dir,{recursive:true,force:true});}
