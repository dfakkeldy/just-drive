// Runs ride-along-rules-check.mjs; with --mutations, each mutant below must fail it. As tools/boss-rules-mutations.mjs.
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(`${tmpdir()}/mmm-ride-along-`);
// [name, anchor, replacement, file under web/src]
const mutants=[
 ['built in Get Fired','return mailPlay && modern && !just','return modern && !just','ride-along-rules'],
 ['built in Just Drive','return mailPlay && modern && !just &&','return mailPlay && modern &&','ride-along-rules'],
 ['built in another era','return mailPlay && modern && !just','return mailPlay && !just','ride-along-rules'],
 ['no ?boss=0','&& params.get(\'boss\') !== \'0\' &&','&&','ride-along-rules'],
 ['no ?rideAlong=0',' && params.get(\'rideAlong\') !== \'0\';',';','ride-along-rules'],
 ['runs in multiplayer','=> !multiplayer;','=> true;','ride-along-rules'],
 ['day 1 is a ride-along','&& day > 1 &&','&&','ride-along-rules'],
 ['every other day','export const RIDE_SHARE = .25;','export const RIDE_SHARE = .5;','ride-along-rules'],
 ['a different seed','const SALT = 83;','const SALT = 77;','ride-along-rules'],
 ['force does nothing','params.get(\'rideAlong\') === \'1\' || ','','ride-along-rules'],
 ['stop order is the input order','order: [...stops].sort((a, b) => draw(day, a, SALT + 1) - draw(day, b, SALT + 1))','order: [...stops]','ride-along-rules'],
 ['always parked','crawl: draw(day, 0, SALT + 2) < .5','crawl: false','ride-along-rules'],
 ['always one way','reverse: draw(day, 0, SALT + 3) < .5','reverse: false','ride-along-rules'],
 ['crawls fast','export const CRAWL_SPEED = 4.5;','export const CRAWL_SPEED = 9;','ride-along-rules'],
 ['no wait at the ends','export const CRAWL_WAIT = 12;','export const CRAWL_WAIT = 0;','ride-along-rules'],
 ['comes back on the wrong side','return { along: start + dir * s * CRAWL_SPEED, side: dir * edge, turn: base };','return { along: start + dir * s * CRAWL_SPEED, side: edge, turn: base };','ride-along-rules'],
 ['turns on the spot','side: dir * edge * Math.cos(Math.PI * f)','side: dir * edge','ride-along-rules'],
 ['sees further','export const WATCH_STEP = 3;','export const WATCH_STEP = 5;','ride-along-rules'],
 ['sees through walls','return sees(boss, target, WATCH_STEP, blocked);','return sees(boss, target, WATCH_STEP);','ride-along-rules'],
 ['sees the late call','Object.freeze([\'lawnDamage\',','Object.freeze([\'late\', \'lawnDamage\',','ride-along-rules'],
 ['misses lawn damage','Object.freeze([\'lawnDamage\', ','Object.freeze([','ride-along-rules'],
 ['an old fall counts','return !preExisting && SEEABLE','return SEEABLE','ride-along-rules'],
 ['a little over is speeding','export const WELL_OVER = 25 / 3.6;','export const WELL_OVER = 5 / 3.6;','ride-along-rules'],
 ['speeding from afar','export const PASS_RANGE = 50;','export const PASS_RANGE = 500;','ride-along-rules'],
 ['speeding unseen','if (this.state !== \'post\' || !i.seen || ','if (this.state !== \'post\' || ','ride-along-rules'],
 ['speeding while it follows','if (this.state !== \'post\' || !i.seen','if (!i.seen','ride-along-rules'],
 ['speeding counts twice a pass','    this.armed = false;\n    return true;','    return true;','ride-along-rules'],
 ['never re-arms','if (d > REARM) this.armed = true;','','ride-along-rules'],
 ['speeding with its car gone','|| !i.onRoad || kind === null','|| kind === null','ride-along-rules'],
 ['label in mph','km/h where the limit is ${kmh(roadTop(kind))}','km/h where the limit is ${Math.round(roadTop(kind) * 2.237)}','ride-along-rules'],
 ['full jump at 17:59','Math.max(0, Math.min(CLOCK_COST, shiftLength - CLOCK_ROOM - elapsed))','Math.max(0, CLOCK_COST)','ride-along-rules'],
 ['costs an hour','export const CLOCK_COST = 20 * 60;','export const CLOCK_COST = 60 * 60;','ride-along-rules'],
 ['seen while not watching','if (!this.watching) return false;\n','','ride-along-rules'],
 ['not on file','this.seen.push(o); this.pending.push(o);','this.pending.push(o);','ride-along-rules'],
 ['no flash','this.state = \'following\'; this.signal = true;','this.state = \'following\';','ride-along-rules'],
 ['stopping far away counts','(this.stopped >= STOP_HOLD && centre <= STUCK_NEAR)','(this.stopped >= STOP_HOLD)','ride-along-rules'],
 ['stopping is fine','(this.stopped >= STOP_HOLD && centre <= STUCK_NEAR) || ','','ride-along-rules'],
 ['beside is fine','(speed < SLOW && centre <= BESIDE) || ','','ride-along-rules'],
 ['never stuck','|| this.slow >= STUCK)','|| false)','ride-along-rules'],
 ['follows for ever','this.unseen >= LOSE || ','','ride-along-rules'],
 ['gives up at a glance','this.unseen = i.seen ? 0 : this.unseen + dt;','this.unseen += dt;','ride-along-rules'],
 ['pull-overs not counted','this.pulledOver++; this.leave();','this.leave();','ride-along-rules'],
 ['write-up forgets','const written = this.pending; this.pending = [];','const written: Offence[] = []; this.pending = [];','ride-along-rules'],
 ['give-up keeps it pending','this.gaveUp++; this.pending = [];','this.gaveUp++;','ride-along-rules'],
 ['never back at its post','if (this.state === \'away\') { this.state = \'post\'; this.armed = false; }','','ride-along-rules'],
 ['record survives the day','this.state = today ? \'post\' : \'off\'; this.seen.length = 0;','this.state = today ? \'post\' : \'off\';','ride-along-rules'],
 ['one seen is nothing','return base === \'clear\' ? \'warning\' : base;','return base;','ride-along-rules'],
 ['one seen softens a suspension','return base === \'clear\' ? \'warning\' : base;','return \'warning\';','ride-along-rules'],
 ['two seen is a warning','if (seen.length >= 2 || ','if (','ride-along-rules'],
 ['seen lawn is a warning',' || seen.some(s => s.kind === \'lawnDamage\')','','ride-along-rules'],
 ['same window line','WINDOW[Math.max(0, n - 1) % WINDOW.length]','WINDOW[0]','ride-along-rules'],
 ['card says nothing seen','written.length ? `Seen by the Boss: ${written.map(o => o.label).join(\'; \')}.` : \'Seen by the Boss.\'','\'Seen by the Boss.\'','ride-along-rules'],
 ['clean day has no line','if (!seen.length) return [CLEAN_LINE];','if (!seen.length) return [];','ride-along-rules'],
 ['police words','\'The Boss walks up slowly, clipboard first, and writes for a while. "Carry on."\'','\'The Boss walks up like a police officer.\'','ride-along-rules'],
 ['follows for ever when it cannot reach','|| (this.followed += dt) >= FOLLOW_MAX','','ride-along-rules'],
 ['one act counted twice','    if (last && last.kind === o.kind && o.at - last.at <= ONE_ACT) return true;\n','','ride-along-rules'],
 ['every repeat is one act','last.kind === o.kind && o.at - last.at <= ONE_ACT','last.kind === o.kind','ride-along-rules'],
 ['a broken fence goes unseen',"'lawnDamage', 'propertyDamage', ","'lawnDamage', ",'ride-along-rules'],
 ['photo dismisses a seen complaint','if (c.seen || c.kind === \'late\'','if (c.kind === \'late\'','complaints'],
];
try {
 for(const mutant of [null,...(process.argv.includes('--mutations')?mutants:[])]) {
  const file=mutant?.[3],source=file&&resolve(root,`web/src/${file}.ts`),original=file&&readFileSync(source,'utf8');
  if(mutant)assert.ok(original.split(mutant[1]).length===2,mutant[0]+': anchor must match once');
  await build({entryPoints:[resolve(root,'tools/ride-along-rules-check.mjs')],bundle:true,platform:'node',format:'esm',outfile:`${dir}/check.mjs`,logLevel:'silent',
   plugins:mutant?[{name:'mutate',setup(b){b.onLoad({filter:new RegExp(`/${file}\\.ts$`)},()=>({contents:original.replace(mutant[1],()=>mutant[2]),loader:'ts',resolveDir:dirname(source)}));}}]:[]});
  const r=spawnSync(process.execPath,[`${dir}/check.mjs`],{cwd:resolve(root,'web'),encoding:'utf8',timeout:120000});
  if(!mutant){assert.equal(r.status,0,r.stdout+r.stderr);console.log(r.stdout.trim());}
  else {assert.notEqual(r.status,0,mutant[0]+' survived');assert.match(r.stderr,/AssertionError/,mutant[0]+': '+r.stderr.slice(0,400));console.log('REJECTED',mutant[0]);}
 }
 if(process.argv.includes('--mutations'))console.log(`ride-along rules: ${mutants.length} mutants rejected`);
}finally{rmSync(dir,{recursive:true,force:true});}
