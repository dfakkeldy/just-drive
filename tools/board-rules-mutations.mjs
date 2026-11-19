// Runs board-rules-check.mjs; with --mutations, each mutant below must fail it.
// The bundle is built as the published script is (VITE_MP=1), so the end card has its board block.
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(`${tmpdir()}/mmm-board-`);
// [name, anchor, replacement, file under web/src]
const mutants=[
 ['another day taken','if (!postDay(date, now)) return no(\'day\');','','board-rules'],
 ['no grace after midnight','|| date === atlanticDate(new Date(now - GRACE_MS))','','board-rules'],
 ['grace for a whole day','export const GRACE_MS = 60 * 60e3;','export const GRACE_MS = 24 * 3600e3;','board-rules'],
 ['another area taken','if (!dailyArea(area)) return no(\'area\');','','board-rules'],
 ['body area trusted','|| body.area !== area ||','||','board-rules'],
 ['seed not checked','if (body.seed !== plan.seed) return no(\'seed\');','','board-rules'],
 ['short card taken','if (squares.length !== CARD_SIZE) return no(\'card\');','','board-rules'],
 ['claim stored','handle: readHandle(body.handle) ?? inventedName(random), points: result.total,','handle: readHandle(body.handle) ?? inventedName(random), points: claim.points,','board-rules'],
 ['higher claim taken','if (claim.points > result.total || claim.step > result.step','if (claim.step > result.step','board-rules'],
 ['higher step taken','|| claim.step > result.step ||','||','board-rules'],
 ['extra squares taken','|| (claim.squares & ~result.filled) !== 0','','board-rules'],
 ['faster Fired taken','|| result.firedAt !== null && claim.time < result.firedAt - .05','','board-rules'],
 ['no ceiling','return points + bingoBonus(LINES.length, true);','return Infinity;','board-rules'],
 ['ceiling ignores the run length','const facts = Math.min(MAX_EVENTS, Math.floor((Math.max(0, seconds) + SLACK) * BURST));','const facts = MAX_EVENTS;','board-rules'],
 ['no burst limit','    if (i >= BURST && time - events[i - BURST][1] < 1) return no(\'events\');\n','','board-rules'],
 ['events out of order','time < last ||','','board-rules'],
 ['events after the end','|| time > played + SLACK) return no(\'events\');',') return no(\'events\');','board-rules'],
 ['any kind sent','if (!SENT_KINDS.includes(kind) ||','if (','board-rules'],
 ['run longer than the limit','if (played < 0 || played > plan.limit) return no(\'events\');','','board-rules'],
 ['no event cap','if (body.events.length > MAX_EVENTS) return no(\'events\');','','board-rules'],
 ['card not paid on the server','    if (heard.lines) book.award(\'bingo:line\', heard.lines * LINE_BONUS);\n','','board-rules'],
 ['full card not paid on the server','    if (heard.full) book.award(\'bingo:card\', CARD_BONUS);\n','','board-rules'],
 ['every fact scores on the server',"    const e = asEvent(w), time = e.time;\n    book.add(e);","    const e = asEvent(w), time = e.time;\n    book.add(e); book.add({ ...e, kind: 'box:rock' });",'board-rules'],
 ['firedAt late','if (book.fired) firedAt ??= time;\n    const heard','firedAt ??= book.fired ? time + 1 : null;\n    const heard','board-rules'],
 ['handle not filtered','handle: readHandle(body.handle) ?? inventedName(random)','handle: body.handle || inventedName(random)','board-rules'],
 ['device not checked','|| typeof body.device !== \'string\' || !DEVICE.test(body.device)) return no(\'shape\');',') return no(\'shape\');','board-rules'],
 ['vehicle from the post','vehicle: plan.vehicle, device: body.device,','vehicle: String((body as Record<string, unknown>).vehicle ?? plan.vehicle), device: body.device,','board-rules'],
 ['a row with the address','vehicle: plan.vehicle, device: body.device,','vehicle: plan.vehicle, device: body.device, address: \'\',','board-rules'],
 ['second post taken','if (seen !== null) {','if (false) {','board-rules'],
 ['answered again for any result','return had.device === row.device && had.points === row.points && had.step === row.step && had.time === row.time && had.squares === row.squares','return true','board-rules'],
 ['another kept result said gone',"if (!had) return { error: 'posted', gone: true };","if (!had || had.points !== row.points) return { error: 'posted', gone: true };",'board-rules'],
 ['a fallen row not said gone',"if (!had) return { error: 'posted', gone: true };","if (!had) return { error: 'posted' };",'board-rules'],
 ['gone ignored on the device',"if (known === 'posted' && entry.tried && (body as { gone?: unknown }).gone === true) {","if (known === 'posted' && entry.tried) {",'board'],
 ['a closed day said plainly',"entry.refused = known === 'day' && entry.tried ? CLOSED : REFUSALS[known].text;","entry.refused = REFUSALS[known].text;",'board'],
 ['no hashing stays stuck',"    catch { this.away(); return; }","    catch { return; }",'board'],
 ['IPv4 as IPv6 its own key','  if (v4) return v4[1];\n','','board-rules'],
 ['an inherited refusal name',"Object.hasOwn(REFUSALS, error)","error in REFUSALS",'board'],
 ['drift sent without its size',"export const wireEvent = (e: ScoreEvent): WireEvent => e.kind === 'drift' && e.drift","export const wireEvent = (e: ScoreEvent): WireEvent => false && e.drift",'board-rules'],
 ['drift size on any kind',"|| e.length === 7 && e[0] === 'drift' &&","|| e.length === 7 &&",'board-rules'],
 ['negative drift size',"e.slice(2, 5).every(v => finite(v) && v >= 0)","e.slice(2, 5).every(v => finite(v))",'board-rules'],
 ['drift surface lost',"surface: loose ? LOOSE[0] : 'paved',","surface: 'paved',",'board-rules'],
 ['drift clean lost',"    clean: clean === 1, x0: 0,","    clean: false, x0: 0,",'board-rules'],
 ['ceiling without drift size',"const BIGGEST: Readonly<Record<string, number>> = { drift: DRIFT_MARKS.most * DRIFT_MARKS.clean };","const BIGGEST: Readonly<Record<string, number>> = {};",'board-rules'],
 ['answered again for another device','return had.device === row.device && had.points','return had.points','board-rules'],
 ['an area every object has',"export const dailyArea = (area: string): boolean => Object.hasOwn(DAILY_STARTS, area);","export const dailyArea = (area: string): boolean => area in DAILY_STARTS;",'daily-rules'],
 ['every IPv6 address its own key',"  if (!address.includes(':')) return address;\n","  return address;\n",'board-rules'],
 ['IPv6 key by its /48','return `${groups.slice(0, 4).map(','return `${groups.slice(0, 3).map(','board-rules'],
 ['no daily cap','    if (this.full) return { error: \'full\' };\n','','board-rules'],
 ['top 200 kept','export const BOARD_KEEP = 100;','export const BOARD_KEEP = 200;','board-rules'],
 ['nothing dropped','const dropped = this.rows.splice(BOARD_KEEP), i','const dropped: Row[] = [], i','board-rules'],
 ['device in the view','rows: this.rows.map(({ device: _device, ...row }) => row) };','rows: this.rows.map(row => ({ ...row })) };','board-rules'],
 ['newest wins a tie',': a.id - b.id;',': b.id - a.id;','board-rules'],
 ['points before squares','export const rowOrder = (a: Row, b: Row): number =>','export const rowOrder = (a: Row, b: Row): number => a.step === b.step && a.step < LADDER.length && a.points !== b.points ? b.points - a.points :','board-rules'],
 ['kept 90 days','export const BOARD_DAYS = 60;','export const BOARD_DAYS = 90;','board-rules'],
 ['tomorrow readable','&& date <= atlanticDate(new Date(now)) &&','&&','board-rules'],
 ['old boards readable','&& expiresAt(date) > now;','&& true;','board-rules'],
 ['no rate limit','    if (m.tokens < 1) return false;\n','','board-rules'],
 ['rate shared by everyone','let m = this.seen.get(key);','let m = this.seen.get(\'all\'); key = \'all\';','board-rules'],
 ['memory unbounded','      if (this.seen.size >= this.most) this.forget(now);\n','','board-rules'],
 ['short device id','for (let i = 0; i < bytes.length; i += 3) {','for (let i = 0; i < 3; i += 3) {','board-rules'],
 ['animals sent','export const sendsEvent = (e: ScoreEvent): boolean => PENALTIES[e.kind] !== undefined || scores(e);','export const sendsEvent = (e: ScoreEvent): boolean => true;','board-rules'],
 ['penalties not sent','PENALTIES[e.kind] !== undefined || scores(e);','scores(e);','board-rules'],
 ['board reads a device','rows.push({ id: r.id as number, handle: r.handle.slice(0, 32),','rows.push({ device: String(r.device), id: r.id as number, handle: r.handle.slice(0, 32),','board-rules'],
 ['posted automatically','    this.paint();\n  }\n  private paint','    this.paint();\n    void this.send();\n  }\n  private paint','board'],
 ['offline still sends','    if (typeof navigator !== \'undefined\' && navigator.onLine === false) return null;\n','','board'],
 ['away hides the button','private away(): void { this.say(AWAY); this.post.textContent = \'Try later\'; this.post.disabled = false; }','private away(): void { this.say(AWAY); this.post.hidden = true; }','board'],
 ['away stays disabled','private away(): void { this.say(AWAY); this.post.textContent = \'Try later\'; this.post.disabled = false; }','private away(): void { this.say(AWAY); this.post.textContent = \'Try later\'; }','board'],
 ['refusal not final',"    entry.refused = known === 'day' && entry.tried ? CLOSED : REFUSALS[known].text; saveEntry(entry.post.area, entry);\n",'','board'],
 ['rude name sent','const typed = this.name.value.trim(), handle = typed ? readHandle(typed) : boardName();','const typed = this.name.value.trim(), handle = typed || boardName();','board'],
 ['row not marked','if (r.id === mine) { li.className = \'you\'; you = li; }','','board'],
 ['no yesterday tab',"        tab(`Yesterday · ${shortDate(yesterday)}`, this.date === yesterday, () => this.show(this.area, yesterday), 'boardYesterday')]));","        ]));",'board'],
 ['one id for every board','encode(`mmm-board|${secret}|${area}|${date}`)','encode(`mmm-board|${secret}`)','board'],
 ['the secret sent','body: JSON.stringify({ ...entry.post, handle, device })','body: JSON.stringify({ ...entry.post, handle, device: deviceSecret() })','board'],
 ['a lost answer is final',"if (known === 'posted' && entry.tried && (body as { gone?: unknown }).gone === true) {","if (false) {",'board'],
 ['a try never marked','      if (!known && !entry.tried) { entry.tried = true; saveEntry(entry.post.area, entry); }\n','','board'],
 ['blocked storage loses the run','const kept = () => blocked ? held :','const kept = () => false ? held :','board'],
 ['cleared storage keeps the page’s run','const kept = () => blocked ? held :','const kept = () => true ? held :','board'],
 ['new device each post','  if (good(saved)) return saved;\n','','board'],
 ['no board on mmm',"const HOSTS = ['mmm.fakkeldy.ca', 'localhost', '127.0.0.1'];","const HOSTS = ['localhost', '127.0.0.1'];",'board'],
 ['board on any host',"return HOSTS.includes(location.hostname) ? '' : null;","return '';",'board'],
 ['no rank on the share line',"    this.share = rankLine => {\n      this.text = resultText(result, this.plan.date, this.areaName, '', rankLine);","    this.share = rankLine => {\n      this.text = resultText(result, this.plan.date, this.areaName, '', '');",'daily'],
 ['no rank on the picture',"canvas = drawShare(result, this.plan.date, this.areaName, this.squares, rankLine);","canvas = drawShare(result, this.plan.date, this.areaName, this.squares, '');",'daily'],
 ['events not logged','      if (sendsEvent(e)) { if (this.log.length < MAX_EVENTS) this.log.push(wireEvent(e)); else this.overflow = true; }\n','','daily'],
 ['log one past the cap','if (this.log.length < MAX_EVENTS) this.log.push','if (this.log.length <= MAX_EVENTS) this.log.push','daily'],
 ['an overflowed run posted','      ...this.overflow ? {','      ...false ? {','daily'],
 ['log kept across tries',"this.card = new BingoCard(this.squares); this.log = []; this.overflow = false; this.paint();","this.card = new BingoCard(this.squares); this.overflow = false; this.paint();",'daily'],
 ['practice replaces the posted run','if (base !== null && !practice) saveEntry(','if (base !== null) saveEntry(','daily'],
 ['claimed time from the end','claim: { points: result.total, step: result.step, time: result.firedAt ?? Math.round(end.played * 10) / 10,','claim: { points: result.total, step: result.step, time: Math.round(end.played * 10) / 10,','daily'],
 ['rank before the bingo','${rank ? `, ${rank}` : \'\'}${name ? ` (${name})` : \'\'}`','${name ? ` (${name})` : \'\'}${rank ? ` ${rank}` : \'\'}`','daily-rules'],
];
try {
 for(const mutant of [null,...(process.argv.includes('--mutations')?mutants:[])]) {
  const file=mutant?.[3],source=file&&resolve(root,`web/src/${file}.ts`),original=file&&readFileSync(source,'utf8');
  if(mutant)assert.ok(original.split(mutant[1]).length===2,mutant[0]+': anchor must match once');
  await build({entryPoints:[resolve(root,'tools/board-rules-check.mjs')],bundle:true,platform:'node',format:'esm',outfile:`${dir}/check.mjs`,logLevel:'silent',
   define:{'import.meta.env':'{"VITE_MP":"1","DEV":false}'},
   plugins:mutant?[{name:'mutate',setup(b){b.onLoad({filter:new RegExp(`/${file}\\.ts$`)},()=>({contents:original.replace(mutant[1],()=>mutant[2]),loader:'ts',resolveDir:dirname(source)}));}}]:[]});
  const r=spawnSync(process.execPath,[`${dir}/check.mjs`],{cwd:resolve(root,'web'),encoding:'utf8',timeout:180000});
  if(!mutant){assert.equal(r.status,0,r.stdout+r.stderr);console.log(r.stdout.trim());}
  else {assert.notEqual(r.status,0,mutant[0]+' survived');assert.match(r.stderr,/AssertionError/,mutant[0]+': '+r.stderr.slice(0,400));console.log('REJECTED',mutant[0]);}
 }
 if(process.argv.includes('--mutations'))console.log(`board rules: ${mutants.length} mutants rejected`);
}finally{rmSync(dir,{recursive:true,force:true});}
