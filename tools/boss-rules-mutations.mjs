// Runs boss-rules-check.mjs; with --mutations, each mutant below must fail it. As tools/score-rules-mutations.mjs.
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(`${tmpdir()}/mmm-boss-`);
// [name, anchor, replacement, file under web/src]
const mutants=[
 ['built in mail play',"return firedMode && !daily && modern","return !daily && modern",'boss-rules'],
 ['no way to turn it off',"&& params.get('boss') !== '0';",';','boss-rules'],
 ['comes at the start','!multiplayer && step >= 1;','!multiplayer && step >= 0;','boss-rules'],
 ['runs in multiplayer','return !multiplayer && step >= 1;','return step >= 1;','boss-rules'],
 ['sees behind','  if (d > SIGHT_NEAR && offNose(boss, target) > SIGHT_HALF_ANGLE) return false;\n',' \n','boss-rules'],
 ['sees forever','  if (d > sightRange(step)) return false;\n',' \n','boss-rules'],
 ['sees through walls','  return !blocked?.(boss, target);','  return true;','boss-rules'],
 ['no all-round ring','if (d > SIGHT_NEAR && ','if (','boss-rules'],
 ['sight never grows','SIGHT_BASE + SIGHT_PER_STEP * Math.max(0, step - 1)','SIGHT_BASE','boss-rules'],
 ['daily has a Boss','firedMode && !daily && modern','firedMode && modern','boss-rules'],
 ['inside wall hides','        if (inside(box, a) || inside(box, b)) continue;\n','','boss-rules'],
 ['hills never hide','> ga + eye + (gb - ga) * t + .3) return true;','> 1e9) return true;','boss-rules'],
 ['close anywhere','&& offNose(boss, player) <= FOLLOW_CONE','','boss-rules'],
 ['flat clock cost','(15 + 5 * Math.max(1, step)) * 60','20 * 60','boss-rules'],
 ['faster than the player','return Math.min(want, playerTop * TOP_SHARE);','return want;','boss-rules'],
 ['same speed every step','14 + 2 * Math.max(1, step)','18','boss-rules'],
 ['arrives no sooner','Math.max(300, 550 - 40 * s)','550','boss-rules'],
 ['follow overruns','return Math.max(0, Math.min(limit, ','return Math.max(0, Math.min(1e9, ','boss-rules'],
 ['hold never resets','this.hold = close ? this.hold + dt : 0;','this.hold += dt;','boss-rules'],
 ['flashes at once','if (this.hold >= HOLD)','if (this.hold >= 0)','boss-rules'],
 ['stopping far away counts','(this.stopped >= STOP_HOLD && centre <= STUCK_NEAR)','(this.stopped >= STOP_HOLD)','boss-rules'],
 ['on its way for ever',"if (this.state === 'onItsWay' && (this.onWay += dt) >= ON_WAY_MAX)","if (false)",'boss-rules'],
 ['new lead keeps the old time','this.lead = { x: at.x, z: at.z }; this.onWay = 0;','this.lead = { x: at.x, z: at.z };','boss-rules'],
 ['card says the full cost','const minutes = Math.round(jumped / 60)','const minutes = Math.round(clockCost(step) / 60)','boss-rules'],
 ['no beat before the card','export const STOP_HOLD = 1.5;','export const STOP_HOLD = .3;','boss-rules'],
 ['stopping is fine','(this.stopped >= STOP_HOLD && centre <= STUCK_NEAR) || ','','boss-rules'],
 ['beside is fine','(speed < SLOW && centre <= BESIDE) || ','','boss-rules'],
 ['never stuck','|| this.slow >= STUCK)','|| false)','boss-rules'],
 ['flash forever','if (this.apart >= SIGNAL_DROP) { this.signal = false; this.hold = 0; }','','boss-rules'],
 ['gives up early','if (this.unseen < loseTime(step)) return null;','if (this.unseen < 5) return null;','boss-rules'],
 ['never gives up','if (this.unseen < loseTime(step)) return null;','return null;','boss-rules'],
 ['escapes not counted','this.state = \'lost\'; this.escaped++;','this.state = \'lost\';','boss-rules'],
 ['pull-overs not counted','this.state = \'pulledOver\'; this.pulledOver++;','this.state = \'pulledOver\';','boss-rules'],
 ['shake never harder','LOSE_BASE + LOSE_PER_STEP * Math.max(0, step - 1)','LOSE_BASE','boss-rules'],
 ['glimpse no reset',"this.state = 'following'; this.unseen = 0;","this.state = 'following';",'boss-rules'],
 ['follows where it first saw you',"if (this.lastSeen) { this.lastSeen.x = i.player.x; this.lastSeen.z = i.player.z; }","if (this.lastSeen) { }",'boss-rules'],
 ['no cooldown','this.cooldown = COOLDOWN;','this.cooldown = 0;','boss-rules'],
 ['complaint in cooldown','if (this.cooldown > 0 || this.state === \'pulledOver\') return;','if (this.state === \'pulledOver\') return;','boss-rules'],
 ['sight in cooldown','if (i.seen && this.cooldown <= 0) {','if (i.seen) {','boss-rules'],
 ['straight to the player',"this.state === 'onItsWay' ? this.lead : null","this.state === 'onItsWay' ? this.lastSeen : null",'boss-rules'],
 ['lead never reached','<= LEAD_REACHED) {','<= 0) {','boss-rules'],
 ['lost never patrols',"if (this.lostShow <= 0) { this.state = 'patrol'; this.lostShow = 0; }",'','boss-rules'],
 ['turns back','if (Math.cos(wrap(h - heading)) < -.3) continue;','','boss-rules'],
 ['turns round near','return Math.hypot(goal.x - boss.x, goal.z - boss.z) > 40 && ','return ','boss-rules'],
 ['police words',"'The Boss taps on the glass and holds up a complaint form. Then another one.'","'The Boss taps on the glass like a police officer.'",'boss-rules'],
 ['same line each time','WINDOW[i % WINDOW.length]','WINDOW[0]','boss-rules'],
 ['touch limit drift','kind === 3 ? 75','kind === 3 ? 90','boss-rules'],
 ['witness ignored',' * (e.witnessed ? WITNESSED : 1)','','score-rules'],
 ['witnessed triple','export const WITNESSED = 2;','export const WITNESSED = 3;','score-rules'],
 ['pull-over costs points','breakCombo(): void { this.endChain(); }','breakCombo(): void { this.total = 0; this.endChain(); }','score-rules'],
 ['pull-over keeps the combo','breakCombo(): void { this.endChain(); }','breakCombo(): void { }','score-rules'],
 ['no lost bonus','  lostBoss: 150,\n','','score-rules'],
];
try {
 for(const mutant of [null,...(process.argv.includes('--mutations')?mutants:[])]) {
  const file=mutant?.[3],source=file&&resolve(root,`web/src/${file}.ts`),original=file&&readFileSync(source,'utf8');
  if(mutant)assert.ok(original.split(mutant[1]).length===2,mutant[0]+': anchor must match once');
  await build({entryPoints:[resolve(root,'tools/boss-rules-check.mjs')],bundle:true,platform:'node',format:'esm',outfile:`${dir}/check.mjs`,logLevel:'silent',
   plugins:mutant?[{name:'mutate',setup(b){b.onLoad({filter:new RegExp(`/${file}\\.ts$`)},()=>({contents:original.replace(mutant[1],()=>mutant[2]),loader:'ts',resolveDir:dirname(source)}));}}]:[]});
  const r=spawnSync(process.execPath,[`${dir}/check.mjs`],{cwd:resolve(root,'web'),encoding:'utf8',timeout:120000});
  if(!mutant){assert.equal(r.status,0,r.stdout+r.stderr);console.log(r.stdout.trim());}
  else {assert.notEqual(r.status,0,mutant[0]+' survived');assert.match(r.stderr,/AssertionError/,mutant[0]+': '+r.stderr.slice(0,400));console.log('REJECTED',mutant[0]);}
 }
 if(process.argv.includes('--mutations'))console.log(`boss rules: ${mutants.length} mutants rejected`);
}finally{rmSync(dir,{recursive:true,force:true});}
