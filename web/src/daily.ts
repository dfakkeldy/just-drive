// Today's run: the bingo card in the HUD, the bonus for its lines, and the end card with the share picture and text.
// The rules (seed, card, lines, result text, streak) are daily-rules.ts; the points and the ladder are Get Fired's.
import type { Endings } from './ending';
import type { FiredEnd, FiredRun } from './fired';
import type { Shift } from './shift';
import { LADDER, stepName } from './score-rules';
import {
  BingoCard, CARD_BONUS, DAILY_ADDRESS, GAME_NAME, LINE_BONUS, clockText, headline, packFilled, readDaily, resultText, saveDaily, shortDate,
  unpackFilled, type DailyPlan, type DailyRecord, type DailyResult, type Square, type Supply,
} from './daily-rules';
import { BOARD_VERSION, MAX_EVENTS, rankText, sendsEvent, wireEvent, type WireEvent } from './board-rules';
import { BoardPanel, boardBase, saveEntry, savedEntry, type Entry } from './board';

const CSS = `
#bingoGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;margin-top:6px;white-space:normal}
#bingoGrid span{display:flex;align-items:center;justify-content:center;min-height:30px;padding:2px 3px;box-sizing:border-box;border-radius:3px;
 background:#ffffff14;border:1px solid #ffffff26;font:10px/1.15 system-ui,sans-serif;text-align:center;color:#cbd2d8}
#bingoGrid span.on{background:#d0632e;border-color:#f0a070;color:#fff;font-weight:700}
#bingoMini{display:inline-grid;grid-template-columns:repeat(3,4px);gap:1px;vertical-align:-2px;margin-right:5px}
#bingoMini i{display:block;width:4px;height:4px;background:#ffffff40}
#bingoMini i.on{background:#ffb27a}
#dailyShare{margin:14px 0 0}
#dailyShare img{display:block;width:100%;height:auto;border-radius:6px;border:1px solid #69747c}
#dailyShareButtons{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-top:10px}
#dailyShareButtons button{min-height:48px;border:1px solid #9ba6ae;border-radius:7px;background:#31463a;color:#fff;font:700 15px system-ui,sans-serif;cursor:pointer}
#dailyShareButtons button:focus-visible{outline:3px solid #fff;outline-offset:2px}
#dailyShareStatus{min-height:1.4em;margin:6px 0 0;font-size:13px;color:#cbd2d8}
`;
const fmt = (n: number): string => Math.round(n).toLocaleString('en-CA');

/** One Today's run on top of a Get Fired run. Reads the same score stream, after FiredRun has scored each fact. */
export class DailyRun {
  card: BingoCard;
  /** This browser's record for the area: the first finished try of the day, the streak and the best. */
  record: DailyRecord | null;
  /** The last share text, for the Copy button and the checks. */
  text = '';
  /** The facts of this try that can change its score, as sent to Today's board (board-rules sendsEvent). */
  log: WireEvent[] = [];
  /** More facts than the board checks (MAX_EVENTS): this try cannot be posted. */
  private overflow = false;
  /** The board block on the last end card, for the checks. */
  board: BoardPanel | null = null;
  private run: number;
  private share: ((rank: string) => void) | null = null;
  private readonly cells: HTMLElement[] = [];
  private readonly minis: HTMLElement[] = [];
  constructor(readonly plan: DailyPlan, readonly squares: readonly Square[], private readonly areaName: string, private readonly shift: Shift,
    private readonly fired: FiredRun, private readonly endings: Endings, private readonly again: () => void,
    /** What the area supplied to the card (main.ts): sent with a posted result so the server draws the same card. */
    private readonly supply: Supply | null = null) {
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
    this.card = new BingoCard(squares);
    this.record = readDaily(plan.area);
    const grid = document.createElement('div'); grid.id = 'bingoGrid'; grid.setAttribute('aria-label', 'Complaint bingo');
    const mini = document.createElement('span'); mini.id = 'bingoMini'; mini.setAttribute('aria-hidden', 'true');
    for (const s of squares) {
      this.cells.push(grid.appendChild(Object.assign(document.createElement('span'), { textContent: s.label })));
      this.minis.push(mini.appendChild(document.createElement('i')));
    }
    fired.hud.appendChild(grid);
    fired.line.prepend(mini);
    this.run = shift.score.runs;
    // FiredRun notices a new run on its next step (it ticks with the shift); the card clears with it, not at the next fact.
    fired.onNewRun = () => this.sync();
    shift.score.listen(e => {
      this.sync();
      if (this.fired.ended) return;
      if (sendsEvent(e)) { if (this.log.length < MAX_EVENTS) this.log.push(wireEvent(e)); else this.overflow = true; }
      const heard = this.card.hear(e);
      if (!heard.filled.length) return;
      this.paint();
      const square = this.squares[heard.filled[0]];
      // Lines and the full card are tallied apart, so the end card and the checks can tell them apart.
      if (heard.lines) this.fired.award('bingo:line', heard.lines * LINE_BONUS, heard.lines > 1 ? `${heard.lines} bingo lines` : 'Bingo line');
      if (heard.full) this.fired.award('bingo:card', CARD_BONUS, 'Full card!');
      this.fired.notice(heard.full ? 'Full card!' : heard.lines ? 'Bingo!' : 'Bingo square', `${square.label} · ${this.card.done} of ${this.squares.length}${heard.bonus ? ` · +${fmt(heard.bonus)}` : ''}`);
    });
    this.paint();
  }
  private sync(): void {
    if (this.shift.score.runs === this.run) return;
    this.run = this.shift.score.runs; this.card = new BingoCard(this.squares); this.log = []; this.overflow = false; this.paint();
  }
  private paint(): void {
    this.card.filled.forEach((on, i) => { this.cells[i].classList.toggle('on', on); this.minis[i].classList.toggle('on', on); });
  }
  /** FiredRun calls this at the end of each try, instead of the Get Fired end card. */
  finish(end: FiredEnd): void {
    this.sync();
    const result: DailyResult = { step: end.book.step, total: Math.round(end.book.total), firedAt: end.firedAt === null ? null : Math.round(end.firedAt * 10) / 10,
      filled: packFilled(this.card.filled) };
    const { record, practice } = saveDaily(this.plan.area, this.plan.date, result, undefined, this.record);
    this.record = record;
    // A tab left open from an earlier day: a newer day is on file, so this try is practice and shares nothing.
    const stale = record.date !== this.plan.date;
    const first = record.first, squares = this.card.done, lines = this.card.lines;
    // Today's board: the first finished try is kept on this device until it is posted; a practice card may still post it.
    const base = stale || !this.supply ? null : boardBase();
    if (base !== null && !practice) saveEntry(this.plan.area, { date: this.plan.date, posted: null, post: { v: BOARD_VERSION, area: this.plan.area, date: this.plan.date,
      seed: this.plan.seed, supply: this.supply!, events: [...this.log], played: end.played,
      claim: { points: result.total, step: result.step, time: result.firedAt ?? Math.round(end.played * 10) / 10, squares: result.filled }, handle: '', device: '' },
      ...this.overflow ? { refused: `This run made more offences than the board checks (over ${MAX_EVENTS.toLocaleString('en-CA')}). It stays on your card and your share line.` } : {} });
    const entry: Entry | null = base !== null ? savedEntry(this.plan.area, this.plan.date) : null;
    const rank = entry?.posted ? rankText(entry.posted.rank, entry.posted.posts) : '';
    if (!stale) this.text = resultText(first, this.plan.date, this.areaName, '', rank);
    const bingo = `Bingo ${squares} of ${this.squares.length}${lines ? `, ${lines} ${lines === 1 ? 'line' : 'lines'}` : ''}${this.card.full ? ' and the full card' : ''}.`;
    const out = [
      practice ? `Practice: ${headline(result)}. ${bingo}` : `${headline(result)}. ${bingo}`,
      result.step > 0 ? LADDER[result.step - 1].steward : 'Not one call on file. The union is worried about you.',
      // The Party Line's line names the player on this screen only: never in the shared text or picture.
      ...(end.calls ? [end.calls] : []),
      stale ? `A newer day’s run is on file (${shortDate(record.date)}). Reload for that day’s card.`
        : practice ? `Today’s card keeps your first finished run: ${headline(first)}, bingo ${unpackFilled(first.filled).filter(Boolean).length} of ${this.squares.length}.`
        : `Your first finished run today: this is today’s card.${end.played < this.plan.limit && result.step < LADDER.length ? ` Ended at ${clockText(end.played)}.` : ''}`,
      `${record.streak === 1 ? 'Streak: 1 day' : `Streak: ${record.streak} days in a row`}. Best: ${headline(record.best)} (${shortDate(record.best.date)}).`,
    ];
    const share = stale ? undefined : this.shareCard(first, rank);
    // Never automatic: the board block offers "Post my result" and waits for the tap.
    this.board = share && base !== null ? new BoardPanel({ plan: this.plan, entry, base, first: !practice, onRank: (r, posts) => this.share?.(rankText(r, posts)) }) : null;
    if (share && this.board) share.appendChild(this.board.root);
    this.endings.offer(`Today’s run · ${shortDate(this.plan.date)}`, practice ? 'Practice' : stepName(result.step), out, [
      { label: 'Try again (practice)', action: () => { this.endings.close(); this.shift.retry(); this.again(); } },
    ], share);
  }
  private shareCard(result: DailyResult, rank: string): HTMLElement {
    const box = document.createElement('div'); box.id = 'dailyShare';
    let canvas = drawShare(result, this.plan.date, this.areaName, this.squares, rank);
    const img = Object.assign(document.createElement('img'), { alt: this.text.split('\n')[0] });
    try { img.src = canvas.toDataURL('image/png'); } catch { /* a canvas that cannot export: the text still shares */ }
    const buttons = document.createElement('div'); buttons.id = 'dailyShareButtons';
    const status = Object.assign(document.createElement('p'), { id: 'dailyShareStatus' }); status.setAttribute('role', 'status');
    const copy = Object.assign(document.createElement('button'), { type: 'button', id: 'dailyCopy', textContent: 'Copy' });
    copy.addEventListener('click', () => { void copyText(this.text).then(done => { status.textContent = done ? 'Copied. Paste it anywhere.' : 'This browser would not copy. Select the text below.'; if (!done) showText(); }); });
    buttons.appendChild(copy);
    const pre = Object.assign(document.createElement('pre'), { id: 'dailyText', textContent: this.text, hidden: true });
    pre.style.cssText = 'white-space:pre-wrap;user-select:text;-webkit-user-select:text;font:12px/1.4 ui-monospace,Menlo,monospace;margin:8px 0 0';
    const showText = () => { pre.hidden = false; };
    // The picture file is made now, not on the tap: Safari only shares straight from the tap, with nothing awaited first.
    let file: File | null = null;
    const makeFile = () => {
      if (typeof navigator.share !== 'function') return;
      try { canvas.toBlob(blob => { if (blob) file = new File([blob], 'mabou-mail-madness-today.png', { type: 'image/png' }); }, 'image/png'); } catch { /* text only */ }
    };
    makeFile();
    // Posted to the board: the text, the picture and its file gain the rank.
    this.share = rankLine => {
      this.text = resultText(result, this.plan.date, this.areaName, '', rankLine);
      pre.textContent = this.text; img.alt = this.text.split('\n')[0];
      canvas = drawShare(result, this.plan.date, this.areaName, this.squares, rankLine);
      try { img.src = canvas.toDataURL('image/png'); } catch { /* the text still shares */ }
      makeFile();
    };
    if (typeof navigator.share === 'function') {
      const share = Object.assign(document.createElement('button'), { type: 'button', id: 'dailyShareButton', textContent: 'Share' });
      share.addEventListener('click', () => { void shareResult(this.text, file).then(note => { status.textContent = note; }); });
      buttons.appendChild(share);
    }
    box.append(img, buttons, status, pre);
    return box;
  }
}

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* an older browser, or no permission: the old way */ }
  try {
    const area = Object.assign(document.createElement('textarea'), { value: text });
    area.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.appendChild(area); area.select();
    const done = document.execCommand('copy'); area.remove(); return done;
  } catch { return false; }
}
async function shareResult(text: string, file: File | null): Promise<string> {
  const data: ShareData = { title: GAME_NAME, text };
  try { if (file && navigator.canShare?.({ files: [file] })) data.files = [file]; } catch { /* text only */ }
  try { await navigator.share(data); return data.files ? 'Shared, with the picture.' : 'Shared.'; }
  catch (error) { return error instanceof DOMException && error.name === 'AbortError' ? '' : 'Sharing did not work here. Copy instead.'; }
}

/** The share picture: 1200 by 630, drawn once at the end. Area, date, the rung, points or time, the card, the game's name and address. */
export function drawShare(result: DailyResult, date: string, areaName: string, squares: readonly Square[], rank = ''): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 630;
  const g = canvas.getContext('2d');
  if (!g) return canvas;
  const sans = 'system-ui,-apple-system,"Segoe UI",sans-serif';
  g.fillStyle = '#0c141c'; g.fillRect(0, 0, 1200, 630);
  g.fillStyle = '#d0632e'; g.fillRect(0, 0, 1200, 12);
  g.fillStyle = '#e5a16c'; g.font = `700 24px ui-monospace,Menlo,monospace`; g.fillText(`TODAY’S RUN · ${shortDate(date).toUpperCase()} · ${areaName.toUpperCase()}`, 60, 86);
  g.fillStyle = '#eef2f6'; g.font = `800 64px ${sans}`;
  g.fillText(result.step >= LADDER.length && result.firedAt !== null ? 'Fired' : stepName(result.step), 60, 180);
  g.font = `700 40px ${sans}`; g.fillStyle = '#eef2f6';
  g.fillText(result.firedAt !== null && result.step >= LADDER.length ? `in ${clockText(result.firedAt)}` : `${fmt(result.total)} points`, 60, 240);
  const filled = unpackFilled(result.filled), done = filled.filter(Boolean).length;
  g.font = `400 30px ${sans}`; g.fillStyle = '#cbd2d8';
  g.fillText(`Discipline step ${result.step} of ${LADDER.length}`, 60, 300);
  g.fillText(`Bingo ${done} of ${filled.length}${result.firedAt !== null && result.step >= LADDER.length ? ` · ${fmt(result.total)} points` : ''}`, 60, 345);
  // The ladder, as on the HUD.
  for (let i = 0; i < LADDER.length; i++) { g.fillStyle = i < result.step ? '#d0632e' : '#ffffff26'; g.fillRect(60 + i * 72, 380, 64, 14); }
  // Posted to Today's board: its rank, under the ladder.
  if (rank) { g.fillStyle = '#e5a16c'; g.font = `700 28px ${sans}`; g.fillText(rank, 60, 446, 580); }
  g.fillStyle = '#eef2f6'; g.font = `800 44px ${sans}`; g.fillText(GAME_NAME, 60, 520);
  g.fillStyle = '#b9c3cc'; g.font = `400 28px ${sans}`; g.fillText(DAILY_ADDRESS.replace(/^https:\/\//, ''), 60, 566);
  // The card: three by three, labels in the squares.
  const x0 = 680, y0 = 70, size = 150, gap = 10;
  squares.forEach((s, i) => {
    const x = x0 + (i % 3) * (size + gap), y = y0 + Math.floor(i / 3) * (size + gap);
    g.fillStyle = filled[i] ? '#d0632e' : '#1d2a35'; g.fillRect(x, y, size, size);
    g.strokeStyle = filled[i] ? '#f0a070' : '#3a4a57'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, size - 2, size - 2);
    g.fillStyle = filled[i] ? '#ffffff' : '#9aa6b0'; g.font = `${filled[i] ? 700 : 400} 21px ${sans}`; g.textAlign = 'center';
    const words = s.label.split(' '), rows: string[] = [];
    for (const w of words) { const last = rows.length - 1; if (last >= 0 && g.measureText(`${rows[last]} ${w}`).width <= size - 18) rows[last] += ` ${w}`; else rows.push(w); }
    rows.forEach((row, r) => g.fillText(row, x + size / 2, y + size / 2 + (r - (rows.length - 1) / 2) * 25 + 7));
    g.textAlign = 'left';
  });
  return canvas;
}
