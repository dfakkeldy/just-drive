// Runs daily-rules-check.mjs; with --mutations, each mutant below must fail it.
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(`${tmpdir()}/mmm-daily-`);
// [name, anchor, replacement, file under web/src]
const mutants=[
 ['seed ignores the area','for (const ch of `${date}|${area}`)','for (const ch of `${date}`)','daily-rules'],
 ['seed ignores the date','for (const ch of `${date}|${area}`)','for (const ch of `${area}`)','daily-rules'],
 ['seed from the clock','const seed = dailySeed(date, area),','const seed = dailySeed(date, area) ^ (Math.random() * 1e9 | 1),','daily-rules'],
 ['day ignores the scene',"(scene === 'painter' ? 1 : scene === 'fish' ? 2 : 0)",'0','daily-rules'],
 ['scene start anywhere',"const start = scene !== 'none' ?","const start = false ?",'daily-rules'],
 ['ten-minute run','export const DAILY_LIMIT = 300;','export const DAILY_LIMIT = 600;','daily-rules'],
 ['the horse in the garage',"Object.freeze([['car', .6], ['truck', .25], ['sxs', .15]])","Object.freeze([['car', .6], ['truck', .25], ['horse', .15]])",'daily-rules'],
 ['painter without the painter',"painter: has.painter && plan.scene === 'painter'",'painter: true','daily-rules'],
 ['painter on any scene day',"painter: has.painter && plan.scene === 'painter'","painter: has.painter && plan.scene !== 'none'",'daily-rules'],
 ['scene square optional',"- (s.needs === 'painter' || s.needs === 'fish' ? 1 : 0)",'','daily-rules'],
 ['scene square always first','.sort((a, b) => draw(seed, a.i, 43) - draw(seed, b.i, 43))','','daily-rules'],
 ['bus on the card',"  { kind: 'relief', needs: 'relief',","  { kind: 'schoolBus', needs: 'boxes', counts: [1], label: () => 'Pass the bus' },\n  { kind: 'relief', needs: 'relief',",'daily-rules'],
 ['protected places count','if (!scores(e)) return none;','','daily-rules'],
 ['a square overfills','if (s.kind !== e.kind || this.counts[i] >= s.need) return;','if (s.kind !== e.kind) return;','daily-rules'],
 ['lines pay again','const lines = this.lines - beforeLines,','const lines = this.lines,','daily-rules'],
 ['no diagonals','[0, 4, 8], [2, 4, 6]','[0, 4, 8]','daily-rules'],
 ['no full card bonus','const lines = this.lines - beforeLines, full = this.full;','const lines = this.lines - beforeLines, full = false;','daily-rules'],
 ['small full card','export const CARD_BONUS = 3000;','export const CARD_BONUS = 1200;','daily-rules'],
 ['UTC date',"timeZone: 'America/Halifax'","timeZone: 'UTC'",'daily-rules'],
 ['no AST fallback','new Date(+now - 4 * 3600e3)','new Date(+now)','daily-rules'],
 ['practice replaces the first','if (prev && prev.date === date) return { record: { ...prev, tries: prev.tries + 1 }, practice: true };','','daily-rules'],
 ['streak never breaks','prev && prev.date === dayBefore(date) ? prev.streak + 1 : 1','prev ? prev.streak + 1 : 1','daily-rules'],
 ['shared key',"DAILY_KEY = 'mmm.daily.v1'","DAILY_KEY = 'mmm.fired.best.v1'",'daily-rules'],
 ['other areas dropped','storage().setItem(DAILY_KEY, JSON.stringify({ ...all, [area]: next.record }));','storage().setItem(DAILY_KEY, JSON.stringify({ [area]: next.record }));','daily-rules'],
 ['held record ignored','const stored = readDaily(area, storage), prev = held &&','const stored = readDaily(area, storage), prev = false &&','daily-rules'],
 ['slower Fired wins','return a.firedAt < b.firedAt;','return a.firedAt > b.firedAt;','daily-rules'],
 ['handle always added',"${name ? ` (${name})` : ''}","${` (${name || 'player'})`}",'daily-rules'],
 ['page address in the text',"export const DAILY_ADDRESS = 'https://mmm.fakkeldy.ca/?daily=1';","export const DAILY_ADDRESS = 'http://localhost:5173/?daily=1';",'daily-rules'],
 ['squares reversed',"filled.slice(i, i + 3).map(f => f ? FILLED_SQUARE : EMPTY_SQUARE)","filled.slice(i, i + 3).map(f => f ? EMPTY_SQUARE : FILLED_SQUARE)",'daily-rules'],
 ['award is multiplied','this.total += points; this.tally(kind, points);\n','this.total += points * this.multiplier; this.tally(kind, points);\n','score-rules'],
 ['no time limit','    if (this.limit > 0 && !this.shift.ended && this.now >= this.limit) this.shift.end();\n','','fired'],
 ['daily also saves the Get Fired best','this.limit || Infinity) }); return; }','this.limit || Infinity) }); }','fired'],
 ['no time on the HUD',"const left = this.limit > 0 ?","const left = false ?",'fired'],
 ['bonus never climbs','    this.stepped(stepUp);\n','','fired'],
 ['card kept on retry','    fired.onNewRun = () => this.sync();\n','','daily'],
 ['lines unpaid',"      if (heard.lines) this.fired.award(","      if (false) this.fired.award(",'daily'],
 ['full card unpaid',"      if (heard.full) this.fired.award(","      if (false) this.fired.award(",'daily'],
 ['practice not marked',"practice ? 'Practice' : stepName(result.step)","stepName(result.step)",'daily'],
 ['share shows the last try','this.text = resultText(first,','this.text = resultText(result,','daily'],
 ['copy copies nothing','await navigator.clipboard.writeText(text); return true;',"await navigator.clipboard.writeText(''); return true;",'daily'],
 ['fixed day in mail play','if (fired && Number.isSafeInteger(fixedDay)','if (Number.isSafeInteger(fixedDay)','shift'],
 ['fixed day ignored','this.career = { ...freshCareer(), day: fixedDay };','','shift'],
 ['award never climbs','    this.step = Math.max(this.step, stepFor(this.total));\n    return this.step > was ? this.step : 0;','    return 0;','score-rules'],
];
try {
 for(const mutant of [null,...(process.argv.includes('--mutations')?mutants:[])]) {
  const file=mutant?.[3],source=file&&resolve(root,`web/src/${file}.ts`),original=file&&readFileSync(source,'utf8');
  if(mutant)assert.ok(original.split(mutant[1]).length===2,mutant[0]+': anchor must match once');
  await build({entryPoints:[resolve(root,'tools/daily-rules-check.mjs')],bundle:true,platform:'node',format:'esm',outfile:`${dir}/check.mjs`,logLevel:'silent',
   plugins:mutant?[{name:'mutate',setup(b){b.onLoad({filter:new RegExp(`/${file}\\.ts$`)},()=>({contents:original.replace(mutant[1],()=>mutant[2]),loader:'ts',resolveDir:dirname(source)}));}}]:[]});
  const r=spawnSync(process.execPath,[`${dir}/check.mjs`],{cwd:resolve(root,'web'),encoding:'utf8',timeout:120000});
  if(!mutant){assert.equal(r.status,0,r.stdout+r.stderr);console.log(r.stdout.trim());}
  else {assert.notEqual(r.status,0,mutant[0]+' survived');assert.match(r.stderr,/AssertionError/,mutant[0]+': '+r.stderr.slice(0,400));console.log('REJECTED',mutant[0]);}
 }
 if(process.argv.includes('--mutations'))console.log(`daily rules: ${mutants.length} mutants rejected`);
}finally{rmSync(dir,{recursive:true,force:true});}
