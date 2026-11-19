// Get Fired: the HUD, the steward's lines and the end card. The points themselves are score-rules.ts.
import type { Endings } from './ending';
import type { ScoreEvent } from './score-events';
import { CLOCK_FACTOR, END_TIME, START_TIME } from './shift-rules';
import { LADDER, ScoreBook, offenceLabel, progress, readBest, saveBest, stepName, timeLeftText, topOffences, type BestRun } from './score-rules';
import { setHud } from './hud-text';
import type { Shift } from './shift';

const CSS = `
#firedHud{position:fixed;z-index:3;bottom:calc(40px + env(safe-area-inset-bottom,0px));right:calc(110px + env(safe-area-inset-right,0px));box-sizing:border-box;
 width:260px;padding:8px 10px;background:var(--panel);border-left:3px solid var(--maple);font:13px/1.5 var(--mono);
 font-variant-numeric:tabular-nums;pointer-events:none;white-space:pre}
#firedHud[hidden],#firedNote[hidden],#firedLine[hidden]{display:none}
#firedLadder{display:grid;grid-template-columns:repeat(${LADDER.length},1fr);gap:3px;margin:5px 0 3px}
#firedLadder i{display:block;height:7px;background:#ffffff26;border-radius:2px;overflow:hidden}
#firedLadder i b{display:block;height:100%;background:var(--maple)}
#firedNote{position:fixed;z-index:6;left:50%;top:calc(22% + env(safe-area-inset-top,0px));transform:translateX(-50%);
 box-sizing:border-box;width:max-content;max-width:min(520px,calc(100% - 24px));padding:10px 14px;background:rgba(12,20,28,.94);
 border:1px solid #69747c;border-top:3px solid var(--maple);border-radius:8px;font:14px/1.45 system-ui,sans-serif;text-align:center;pointer-events:none}
#firedNote b{display:block;font-size:17px;letter-spacing:.02em}
body.tcOn #firedHud,body.indoorOn #firedHud,body.indoorOn #firedNote{display:none}
#firedLine{display:none}
body.tcOn #firedLine{display:block;font-size:10px;line-height:18px;padding:2px 5px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
 background:linear-gradient(90deg,#d0632e99 var(--fill,0%),var(--panel) var(--fill,0%))}
body.tcOn #firedNote{font-size:12px;top:calc(30% + env(safe-area-inset-top,0px))}
body.tcOn #firedNote b{font-size:14px}
`;
const NOTE_SECONDS = 5, LAST_SECONDS = 3;
const fmt = (n: number): string => Math.round(n).toLocaleString('en-CA');
const minutes = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** How a run ended, for Today's run (daily.ts), which writes its own end card instead of the Get Fired one. */
export interface FiredEnd { book: ScoreBook; firedAt: number | null; played: number; /** The Party Line's end card line, if any. */ calls?: string | null }
export interface FiredOptions {
  /** Real seconds of play before the run ends by itself (Today's run); 0 for none: the shift clock's 18:00 ends it. */
  limit?: number;
  /** Writes the end card; the Get Fired best run is then left alone. */
  onEnd?: (end: FiredEnd) => void;
}

/** One run of Get Fired on top of a Shift. Reads the score stream; never touches career pay or the saved shift. */
export class FiredRun {
  book = new ScoreBook();
  /** The newest run saved as best, or the stored best when this run did not beat it. */
  best: BestRun | null = readBest();
  ended = false;
  /** Play seconds when the ladder reached Fired. */
  firedAt: number | null = null;
  private readonly limit: number;
  /** Called when a new run begins (a retry, start over or a new day), before it hears anything: Today's run clears its card. */
  onNewRun: (() => void) | null = null;
  /** The Party Line's call-ins (party-line.ts), when the radio carries them: they hear each event and add a line to the end card. */
  calls: { hear(e: ScoreEvent, stepUp: number): void; reset(): void; endLine(): string | null } | null = null;
  private run: number;
  private pendingEnd = false;
  private noteTime = 0;
  private paintTime = 0;
  private readonly bars: HTMLElement[] = [];
  private last: { text: string; time: number } | null = null;
  /** The desktop panel and the phone status line: Today's run adds its bingo card to both. */
  readonly hud = document.createElement('div');
  private readonly text = document.createElement('div');
  private readonly ladder = document.createElement('div');
  private readonly status = document.createElement('div');
  readonly line = document.createElement('div');
  private readonly lineText = document.createElement('span');
  private readonly note = document.createElement('div');
  constructor(private readonly shift: Shift, private readonly endings: Endings, phone: boolean, private readonly again: () => void,
    private readonly options: FiredOptions = {}) {
    this.limit = options.limit ?? 0;
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
    this.hud.id = 'firedHud'; this.hud.setAttribute('aria-label', 'Get Fired score');
    this.ladder.id = 'firedLadder';
    for (let i = 0; i < LADDER.length; i++) this.bars.push(this.ladder.appendChild(document.createElement('i')).appendChild(document.createElement('b')));
    this.hud.append(this.text, this.ladder, this.status);
    this.note.id = 'firedNote'; this.note.hidden = true; this.note.setAttribute('role', 'status');
    this.line.id = 'firedLine'; this.line.appendChild(this.lineText);
    document.body.append(this.hud, this.note);
    if (phone) (document.getElementById('phoneStatus') ?? document.body).appendChild(this.line);
    this.run = shift.score.runs;
    shift.score.listen(e => this.hear(e));
    shift.onFiredEnd = () => this.finish();
    shift.onUpdate = dt => this.update(dt);
    this.paint();
  }
  /** Shift.start() clears the stream for each new day: a new run, whether or not the last one scored. */
  private sync(): void { if (this.shift.score.runs !== this.run) { this.run = this.shift.score.runs; this.reset(); } }
  /** Play seconds of this run. */
  get now(): number { return this.shift.elapsed / CLOCK_FACTOR; }
  private reset(): void {
    this.book = new ScoreBook(); this.ended = this.pendingEnd = false; this.firedAt = null; this.last = null; this.noteTime = this.paintTime = 0; this.note.hidden = true;
    this.onNewRun?.();
    this.calls?.reset();
  }
  private hear(e: ScoreEvent): void {
    this.sync();
    if (this.ended) return;
    const r = this.book.add(e);
    this.calls?.hear(e, r.stepUp);
    if (r.points) this.last = { text: `${r.points > 0 ? '+' : '−'}${fmt(Math.abs(r.points))} ${offenceLabel(e.kind)}${e.drift?.clean ? ' · clean' : ''}${r.firstOfKind ? ' · new' : ''}`, time: this.now };
    this.paintTime = 0;
    this.stepped(r.stepUp);
  }
  private stepped(stepUp: number): void {
    if (stepUp) {
      const rung = LADDER[stepUp - 1];
      this.note.replaceChildren(Object.assign(document.createElement('b'), { textContent: rung.name }), rung.steward);
      this.note.hidden = false; this.noteTime = NOTE_SECONDS;
    }
    // The shift ends from the frame, never from inside the physics step that knocked the last box.
    if (this.book.fired) { this.pendingEnd = true; this.firedAt ??= this.now; }
  }
  /** A flat bonus (a bingo line or card): shown like an offence, and it climbs the ladder like one. */
  award(kind: string, points: number, text: string): void {
    this.sync();
    if (this.ended || !(points > 0)) return;
    const stepUp = this.book.award(kind, points);
    // A step reached by a bonus is a step too: the Party Line may take a call about it (the bonus itself is no offence).
    if (stepUp) this.calls?.hear({ kind, place: 'route', speed: 0, time: this.now }, stepUp);
    this.last = { text: `+${fmt(points)} ${text}`, time: this.now }; this.paintTime = 0;
    this.stepped(stepUp);
  }
  /** Shows a short line in the steward's place (a bingo square) unless the steward is speaking. */
  notice(title: string, text: string): void {
    if (this.ended || !this.note.hidden && this.noteTime > NOTE_SECONDS - 2) return;
    this.note.replaceChildren(Object.assign(document.createElement('b'), { textContent: title }), text);
    this.note.hidden = false; this.noteTime = 3;
  }
  /** Each shift step (Shift.onUpdate), so it pauses with the world; the note fades on that time. */
  update(realDt: number): void {
    this.sync();
    if (this.pendingEnd && !this.shift.ended) { this.pendingEnd = false; this.shift.end(); }
    if (this.limit > 0 && !this.shift.ended && this.now >= this.limit) this.shift.end();
    if (this.noteTime > 0) { this.noteTime -= realDt; if (this.noteTime <= 0) this.note.hidden = true; }
    // Five times a second, like the shift panel: the HUD costs no layout on most frames.
    this.paintTime -= realDt;
    if (this.paintTime <= 0) { this.paintTime = .2; this.paint(); }
  }
  private paint(): void {
    const b = this.book, now = this.now, p = progress(b.total, b.step), combo = b.comboAt(now);
    const comboText = combo > 1 ? `combo ×${combo.toFixed(2).replace(/0$/, '')} ${b.comboLeft(now).toFixed(1)} s` : 'no combo';
    // A run with a time limit (Today's run) shows the clock on a line of its own: the panel is narrow.
    const left = this.limit > 0 ? minutes(Math.max(0, Math.ceil(this.limit - now))) : '';
    setHud(this.text, `${left ? `Today’s run · ${left} left\n` : ''}${fmt(b.total)} pts · ${comboText}\n${stepName(b.step)} · ladder ×${b.multiplier.toFixed(2).replace(/0$/, '')}`);
    const live = this.last && now - this.last.time < LAST_SECONDS ? this.last.text : '';
    setHud(this.status, b.fired ? 'Fired.' : `${fmt(p.need)} to ${p.next}${live ? `\n${live}` : ''}`);
    this.bars.forEach((bar, i) => {
      const width = i < b.step ? '100%' : i === b.step ? `${Math.round(p.fraction * 100)}%` : '0%';
      if (bar.style.width !== width) bar.style.width = width;
    });
    setHud(this.lineText, `${left ? `${left} · ` : ''}${fmt(b.total)} pts${combo > 1 ? ` ×${combo.toFixed(2).replace(/0$/, '')}` : ''} · ${stepName(b.step)} ${b.step}/${LADDER.length}${live ? ` · ${live}` : ''}`);
    const fill = `${Math.round((b.step + p.fraction) / LADDER.length * 100)}%`;
    if (this.line.style.getPropertyValue('--fill') !== fill) this.line.style.setProperty('--fill', fill);
  }
  /** Shift.end() calls this: by Fired, by 18:00 or by the end-shift button. */
  private finish(): void {
    if (this.ended) return;
    this.ended = true; this.pendingEnd = false; this.note.hidden = true;
    const callLine = this.calls?.endLine() ?? null;
    if (this.options.onEnd) { this.options.onEnd({ book: this.book, firedAt: this.firedAt, calls: callLine, played: Math.min(this.now, this.limit || Infinity) }); return; }
    const b = this.book, timeLeft = Math.max(0, END_TIME - START_TIME - this.shift.elapsed);
    const run: BestRun = { step: b.step, total: b.total, timeLeft, chain: b.bestChain.points };
    const before = this.best;
    this.best = saveBest(run, undefined, this.best);
    const isBest = this.best === run;
    const top = topOffences(b);
    const lines = [
      `${fmt(b.total)} points · ${timeLeft > 0 ? timeLeftText(timeLeft) : 'the clock reached 18:00'}.`,
      b.step > 0 ? LADDER[b.step - 1].steward : 'Not one call on file. The union is worried about you.',
      ...(top.length ? top.map((o, i) => `${i + 1}. ${o.label} ×${o.count}: ${fmt(o.points)}`) : ['No offences on file.']),
      b.bestChain.kinds > 1 ? `Best combo: ${b.bestChain.kinds} kinds of offence, ${fmt(b.bestChain.points)} points.` : 'No combo: never two kinds of offence at once.',
      ...(callLine ? [callLine] : []),
      isBest ? (before ? 'Your best run yet.' : 'Your first run on file.')
        : `Your best run: ${stepName(this.best!.step)} · ${fmt(this.best!.total)} points · ${timeLeftText(this.best!.timeLeft)}.`,
    ];
    this.endings.offer('Get Fired', stepName(b.step), lines, [
      { label: 'Try again', action: () => { this.endings.close(); this.shift.retry(); this.again(); } },
    ]);
  }
}
