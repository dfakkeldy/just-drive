// Runs tools/party-line-check.mjs on the real sources, and with --mutations once per mutant below: each mutant breaks one
// Party Line rule on purpose and must make the check fail. Sources are changed only inside the bundle, never on disk.
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..'), dir = mkdtempSync(`${tmpdir()}/mmm-party-line-`);
const R = 'party-line-rules';
const mutants = [
  ['rocked box calls', "boxDown: 'box', 'box:dent': 'box'", "boxDown: 'box', 'box:rock': 'box', 'box:dent': 'box'"],
  ['school bus calls', "missing: 'missing', late: 'late', flag: 'flag',", "missing: 'missing', late: 'late', flag: 'flag', schoolBus: 'late',"],
  ['hit calls', "sceneHorn: 'horn', sceneDust: 'dust',", "sceneHorn: 'horn', sceneDust: 'dust', sceneHit: 'horn',"],
  ['protected places call', 'const counted = about !== undefined && scores(e);', 'const counted = about !== undefined;'],
  ['horn is general', "horn: 'painter', dust: 'painter'", "horn: 'general', dust: 'painter'"],
  ['too late is fine', 'export const WITHIN = 6;', 'export const WITHIN = 30;'],
  ['steps wait short', 'export const STEP_WITHIN = 12;', 'export const STEP_WITHIN = 6;'],
  ['back to back', 'export const APART = 20;', 'export const APART = 0;'],
  ['steps wait like offences', '(p.step ? STEP_APART : APART)', 'APART'],
  ['no lead in a pause', 'if (at <= b - LEAD) return true;', 'if (at <= b) return true;'],
  ['pause from before', 'if (a > at) return false;', 'if (a > at + 1) return true;'],
  ['long files read', 'n > 0 && n <= LONGEST', 'n > 0'],
  ['name call without names', '&& (!c.name || nicknames.some(n => n.caller === c.caller)))', ')'],
  ['bad nickname kind', 'NICK_KINDS.includes(n.kind)', 'true'],
  ['gaps unsorted', ".map(([a, b]) => [a, b] as const).sort((a, b) => a[0] - b[0]);", ".map(([a, b]) => [a, b] as const);"],
  ['bad gap kept', '0 <= g[0] && g[0] < g[1]', 'true'],
  ['calls repeat', 'c.about === about && !this.used.has(c.file)', 'c.about === about'],
  ['dropped is used', "if (!this.fresh(p, now)) { this.pending = null; return null; }", "if (!this.fresh(p, now)) { this.pending = null; this.used.add(p.call.file); return null; }"],
  ['stale plays', "if (!this.fresh(p, now)) { this.pending = null; return null; }", ''],
  ['untuned plays', 'if (this.onAir || !tuned || !gap', 'if (this.onAir || !gap'],
  ['no pause needed', 'if (this.onAir || !tuned || !gap', 'if (this.onAir || !tuned'],
  ['over a call', 'if (this.onAir || !tuned', 'if (!tuned'],
  ['unfetched plays', ' || !loaded(p)) return null;', ') return null;'],
  ['offence beats step', 'if (waiting?.step) return null;', ''],
  ['older offence kept', 'if (p) this.pending = p;\n    return p;', 'if (p && !waiting) this.pending = p;\n    return p;'],
  ['repeat fetches anew', "if (waiting && waiting.about === about) { this.pending = { ...waiting, at: now }; return null; }", ''],
  ['repeat keeps old time', '{ ...waiting, at: now }', '{ ...waiting }'],
  ['no step calls', "if (stepUp > 0) {", "if (false) {"],
  ['tie to first', "(n === most && n > 0 && kind === this.lastKind)", 'false'],
  ['name from any caller', 'n.caller === caller && n.kind === want', 'n.kind === want'],
  ['no general name', "kind === 'general' ? ['general'] : [kind, 'general']", '[kind]'],
  ['names repeat first', 'all.find(n => !this.namesUsed.has(n.file)) ?? all[0]', 'all[0]'],
  ['name call without name', '(!c.name || this.nicknameFor(c.caller))', 'true'],
  ['random past the end', 'open[Math.min(open.length - 1, Math.floor(Math.max(0, this.random()) * open.length))]', 'open[Math.floor(this.random() * open.length)]'],
  ['done keeps air', 'this.onAir = null; this.lastEnd = now;', 'this.lastEnd = now;'],
  ['reset keeps used', 'this.used.clear(); this.namesUsed.clear();', 'this.namesUsed.clear();'],
  ['handle unfiltered', 'return readHandle(stored) ?? invented;', "return typeof stored === 'string' && stored ? stored : invented;"],
  ['end line always', 'if (calls <= 0) return null;', ''],
  ['glue skips the pause', 'const gap = ended || (!!at && inGap(at.at, this.list.gaps[at.file]));', 'const gap = true;', 'party-line'],
  ['glue any dial', 'const tuned = (ended ? this.radio.tunedDial : at?.dial) === this.list.dial;', 'const tuned = true;', 'party-line'],
  ['glue leaves refused on air', 'if (call && !this.radio.callIn(call)) call.done();', 'if (call) this.radio.callIn(call);', 'party-line'],
  ['glue no nickname', 'p.nickname ? [p.call.file, p.nickname.file] : [p.call.file]', '[p.call.file]', 'party-line'],
  ['glue fetches late', 'for (const file of this.filesOf(pick)) void this.fetch(file);', '{}', 'party-line'],
  ['glue fetches off the dial', 'if (pick && this.radio.tunedDial === this.list.dial) for', 'if (pick) for', 'party-line'],
  ['glue claims a waiting call', 'endLine(this.board.played.length,', 'endLine(this.board.played.length + (this.board.pending ? 1 : 0),', 'party-line'],
  ['glue waits for air off the dial', '(this.radio.tunedDial === this.list.dial && this.board.waiting(this.clock()) !== null)', '(this.board.waiting(this.clock()) !== null)', 'party-line'],
  ['glue no fetch on tuning in', 'if (this.radio.tunedDial === this.list.dial) for (const file of this.filesOf(pending))', 'if (false) for (const file of this.filesOf(pending))', 'party-line'],
  ['glue retries every frame', 'if (!this.files.has(file)) void this.fetch(file);', 'if (!this.ready.has(file)) { this.files.delete(file); void this.fetch(file); }', 'party-line'],
  ['glue keeps a let-go file', 'if (this.files.get(file) === mine) this.ready.set(file, url); else URL.revokeObjectURL(url);', 'this.ready.set(file, url);', 'party-line'],
  ['player cut ends on the new dial', '    this.cutEnd(false);\n    this.station = station;', '    this.station = station;\n    this.cutEnd(false);', 'radio-player'],
  ['player rejoins the clock after a call', 'if (this.behind || this.plain', 'if (this.plain', 'radio-player'],
  ['player resumes from the top', 'this.seek = { ticket: this.ticket, at: cut.at };', 'this.seek = { ticket: this.ticket, at: 0 };', 'radio-player'],
  ['player never back on the clock', '    this.behind = false;\n    const live = this.live();', '    const live = this.live();', 'radio-player'],
  ['player hold leaves the call', 'if (held) { this.cutEnd(false); this.audio.pause(); }', 'if (held) { this.audio.pause(); }', 'radio-player'],
  ['player bad call file stops the radio', 'if (this.cut) this.cutEnd(true); else if', 'if (this.cut) this.cutEnd(false); else if', 'radio-player'],
  ['player skips the nickname', 'if (this.audio.src === this.cut.now) this.cutNext();', 'if (this.audio.src === this.cut.now) this.cutEnd(true);', 'radio-player'],
  ['player calls while held', 'this.station < 0 || this.held || !this.on || !this.mine()) return false;', 'this.station < 0 || !this.on || !this.mine()) return false;', 'radio-player'],
  ['player end call goes back', 'if (cut.ended) { this.advance(); return; }', '', 'radio-player'],
  ['glue lets go a waiting file', 'if (name === file || keep.has(name)) continue;', 'if (name === file) continue;', 'party-line'],
];
try {
  for (const mutant of [null, ...(process.argv.includes('--mutations') ? mutants : [])]) {
    const file = mutant?.[3] ?? R, source = resolve(root, `web/src/${file}.ts`), original = readFileSync(source, 'utf8');
    if (mutant) assert.equal(original.split(mutant[1]).length, 2, mutant[0] + ': anchor must match once');
    await build({ entryPoints: [resolve(root, 'tools/party-line-check.mjs')], bundle: true, platform: 'node', format: 'esm', outfile: `${dir}/check.mjs`, logLevel: 'silent',
      plugins: mutant ? [{ name: 'mutate', setup(b) { b.onLoad({ filter: new RegExp(`/${file}\\.ts$`) }, () => ({ contents: original.replace(mutant[1], () => mutant[2]), loader: 'ts', resolveDir: dirname(source) })); } }] : [] });
    const r = spawnSync(process.execPath, [`${dir}/check.mjs`], { cwd: root, encoding: 'utf8' });
    if (!mutant) { assert.equal(r.status, 0, r.stdout + r.stderr); console.log(r.stdout.trim()); }
    else { assert.notEqual(r.status, 0, mutant[0] + ' survived'); assert.match(r.stderr, /AssertionError/, mutant[0] + ': failed for another reason\n' + r.stderr); console.log('REJECTED', mutant[0]); }
  }
  if (process.argv.includes('--mutations')) console.log(`PASS ${mutants.length} mutants rejected`);
} finally { rmSync(dir, { recursive: true, force: true }); }
