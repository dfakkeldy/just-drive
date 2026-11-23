// Today's board in the game: "Post my result" on Today's run end card (never automatic), then the board with the
// player's row marked, a button for each area and for today and yesterday. Only DailyRun builds it, so mail play, Get Fired and
// Just Drive never show it. Offline, or with the server away, the run and its share card work as before and the
// button says to try later. The rules (what is sent, what the server takes) are board-rules.ts.
import { AREAS } from './area';
import { DAILY_STARTS, dayBefore, shortDate, clockText, unpackFilled, CARD_SIZE, type DailyPlan } from './daily-rules';
import { LADDER, stepName } from './score-rules';
import { inventedName, readHandle } from './mp/social';
import { REFUSALS, boardPath, newDevice, rankText, readBoard, type BoardView, type Post, type Refusal } from './board-rules';

/** Its own key: the device's random secret, the name for the board, and each area's first run of the day. */
export const BOARD_KEY = 'mmm.board.v1';
/** The addresses with a board server: the mail game's own. A dev build may name another (?boardserver=, a local test). */
const HOSTS = ['mmm.fakkeldy.ca', 'localhost', '127.0.0.1'];
export const VEHICLE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  car: 'Mail car',
  truck: 'Heavy pickup',
  sxs: 'Side by side: sport',
  'sxs-utility': 'Side by side: utility cab',
  'sxs-crew': 'Side by side: crew cab',
  'sxs-cabin': 'Side by side: full cabin',
});
const TIMEOUT_MS = 8000;
const AWAY = 'The board is away just now. Your run and its card are fine. Try later.';
const CLOSED = 'That run’s day has closed. An earlier try may have reached the board: look for your name.';

export interface Entry {
  date: string; post: Post; posted?: { id: number; rank: number | null; posts: number } | null;
  /** Why this run cannot go on the board (the server said no, or it made more offences than the board checks). */
  refused?: string;
  /** A try went out and no answer came back: it may have reached the board. */
  tried?: boolean;
}
interface Saved { secret?: string; name?: string; runs?: Record<string, Entry> }
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const store = (): Store => localStorage;

/** The browser refused to save (a private window, blocked site data): this page keeps what it knows in `held`. */
let blocked = false;
function readSaved(storage: () => Store = store): Saved {
  try { const v = JSON.parse(storage().getItem(BOARD_KEY) ?? '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { blocked = true; return {}; }
}
function writeSaved(change: (s: Saved) => void, storage: () => Store = store): Saved {
  const s = readSaved(storage); change(s);
  try { storage().setItem(BOARD_KEY, JSON.stringify(s)); blocked = false; } catch { blocked = true; }
  return s;
}
/** What this page knows when the browser saves nothing: the run can still be posted from this card, once. Used only
 * while saving is blocked, so a player who clears the saved data starts clean. */
const held: { secret?: string; name?: string; runs: Record<string, Entry> } = { runs: {} };
const kept = () => blocked ? held : { runs: {} as Record<string, Entry> };
/** This device's random secret: made here, kept here, never sent. A browser that saves nothing makes one per page. */
export function deviceSecret(storage: () => Store = store): string {
  const saved = readSaved(storage).secret, good = (v?: string): v is string => !!v && /^[A-Za-z0-9_-]{22,64}$/.test(v);
  if (good(saved)) return saved;
  // Not saved: the page's own (saving was blocked until now), or a new one; saved if the browser lets it.
  const known = kept().secret, secret = good(known) ? known : newDevice(crypto.getRandomValues(new Uint8Array(16)));
  held.secret = secret; writeSaved(s => { s.secret = secret; }, storage);
  return secret;
}
/** The device id for one board: from the secret, the area and the day. The same device always sends the same id to a
 * board (so it posts once), and a different one to every other board (so its days cannot be linked). */
export async function boardDevice(secret: string, area: string, date: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mmm-board|${secret}|${area}|${date}`));
  return newDevice(new Uint8Array(hash).slice(0, 16));
}
/** The name for the board: the player's own (the room handle, if they set one), or an invented call sign kept for next time. */
function boardName(): string {
  const saved = readSaved().name ?? kept().name;
  if (saved && readHandle(saved)) return saved;
  try { const room = localStorage.getItem('mmm.mp.handle'); if (room && readHandle(room)) return room; } catch { /* blocked */ }
  const name = inventedName(); held.name = name; writeSaved(s => { s.name = name; });
  return name;
}
/** Today's first run in this area, kept until it is posted (a later practice card can still post it). */
export function savedEntry(area: string, date: string): Entry | null {
  const stored = readSaved().runs?.[area], mine = kept().runs[area];
  const e = stored?.date === date && stored.post ? stored : mine;
  return e && e.date === date && e.post ? e : null;
}
export function saveEntry(area: string, entry: Entry): void {
  deviceSecret();   // first: a run saved without its secret could be posted again under a new one
  held.runs[area] = entry; writeSaved(s => { s.runs = { ...(s.runs ?? {}), [area]: entry }; });
}

/** Where the board server is, or null where there is none (another host, a node check). */
export function boardBase(): string | null {
  if (typeof location === 'undefined') return null;
  // Written out in full, as main.ts does: the published build replaces exactly import.meta.env.VITE_MP.
  const dev = !!import.meta.env.DEV, asked = dev ? new URLSearchParams(location.search).get('boardserver') : null;
  if (asked && /^https?:\/\/[^/]+$/.test(asked)) return asked;
  // A build without the server parts (VITE_MP=0, the way back) has no board either.
  if (!dev && import.meta.env.VITE_MP !== '1') return null;
  return HOSTS.includes(location.hostname) ? '' : null;
}

const CSS = `
#dailyBoard{margin:16px 0 0;padding:12px 0 0;border-top:1px solid #69747c}
#dailyBoard h2{font:700 15px system-ui,sans-serif;letter-spacing:.04em;margin:0 0 8px;color:#eef2f6}
#dailyBoard label{display:block;font-size:13px;color:#cbd2d8}
#dailyBoard input{box-sizing:border-box;width:100%;min-height:44px;margin:4px 0 2px;padding:8px 10px;border:1px solid #9ba6ae;border-radius:7px;
 background:#0c141c;color:#fff;font:16px system-ui,sans-serif}
#dailyBoard small{display:block;font-size:12px;color:#9aa6b0}
#boardButtons{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-top:10px}
#boardButtons button,#boardTabs button{min-height:48px;border:1px solid #9ba6ae;border-radius:7px;background:#31463a;color:#fff;font:700 15px system-ui,sans-serif;cursor:pointer}
#boardButtons button:disabled{opacity:.6;cursor:default}
#boardButtons button:focus-visible,#boardTabs button:focus-visible,#dailyBoard input:focus-visible{outline:3px solid #fff;outline-offset:2px}
#boardStatus{min-height:1.4em;margin:8px 0 0;font-size:13px;color:#cbd2d8}
#boardTabs{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 6px}
#boardTabs [role="group"]{display:flex;flex-wrap:wrap;gap:6px}
#boardTabs button{min-height:40px;padding:4px 12px;font-size:13px;background:#253440}
#boardTabs button[aria-pressed="true"]{background:#ad4d23;border-color:#f0a070}
#boardRows{list-style:none;margin:0;padding:0;max-height:min(300px,45vh);overflow:auto;touch-action:pan-y;border:1px solid #3a4a57;border-radius:6px}
#boardRows li{display:grid;grid-template-columns:2.4em minmax(0,1fr) auto;gap:2px 8px;align-items:baseline;padding:6px 8px;border-bottom:1px solid #ffffff14;font-size:13px}
#boardRows li:last-child{border-bottom:0}
#boardRows li b{font-variant-numeric:tabular-nums;color:#e5a16c}
#boardRows li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#boardRows li em{font-style:normal;font-variant-numeric:tabular-nums;color:#eef2f6;text-align:right}
#boardRows li small{grid-column:2/4;font-size:11px;color:#9aa6b0}
#boardRows li.you{background:#d0632e33;box-shadow:inset 3px 0 #d0632e}
#boardRows li.you small::before{content:"You · ";color:#f0a070;font-weight:700}
#boardRows li.none{display:block;color:#9aa6b0}
`;
let styled = false;

/** The row's result as the board says it: 'Fired in 3:42', or the rung and points. */
export const rowResultText = (r: { step: number; points: number; time: number }): string =>
  r.step >= LADDER.length ? `Fired in ${clockText(r.time)}` : `${stepName(r.step)} · ${Math.round(r.points).toLocaleString('en-CA')} pts`;

export interface BoardOptions {
  plan: DailyPlan;
  /** Today's first run here, made by DailyRun, or null when the device has none to post (a stale tab). */
  entry: Entry | null;
  base: string;
  /** The first try's card (true), or a practice card offering the first run (false). */
  first: boolean;
  onRank: (rank: number | null, posts: number) => void;
  fetcher?: typeof fetch;
}

/** The board block under the share card. */
export class BoardPanel {
  readonly root = document.createElement('div');
  private readonly status = Object.assign(document.createElement('p'), { id: 'boardStatus' });
  private readonly buttons = document.createElement('div');
  private readonly post = Object.assign(document.createElement('button'), { type: 'button', id: 'boardPost' });
  private readonly see = Object.assign(document.createElement('button'), { type: 'button', id: 'boardSee', textContent: 'See the board' });
  private readonly form = document.createElement('div');
  private readonly name = Object.assign(document.createElement('input'), { id: 'boardName', type: 'text', maxLength: 14, autocomplete: 'off' });
  private readonly view = document.createElement('div');
  private readonly tabs = document.createElement('div');
  private readonly list = document.createElement('ol');
  private readonly boards = new Map<string, { board: BoardView; at: number }>();
  private area: string; private date: string;
  private entry: Entry | null;
  constructor(private readonly o: BoardOptions) {
    if (!styled) { document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS })); styled = true; }
    this.area = o.plan.area; this.date = o.plan.date; this.entry = o.entry;
    this.root.id = 'dailyBoard';
    this.status.setAttribute('role', 'status');
    const label = Object.assign(document.createElement('label'), { textContent: 'Name on the board' });
    label.htmlFor = 'boardName';
    this.name.value = boardName(); this.name.spellcheck = false; this.name.setAttribute('autocapitalize', 'words');
    this.form.append(label, this.name, Object.assign(document.createElement('small'), { textContent: 'An invented name, never a real person’s. Letters, numbers, spaces; 3 to 14.' }));
    this.buttons.id = 'boardButtons';
    this.post.textContent = o.first ? 'Post my result' : 'Post my first run';
    this.post.addEventListener('click', () => { void this.send(); });
    this.see.addEventListener('click', () => { void this.show(); });
    this.buttons.append(this.post, this.see);
    this.view.id = 'boardView'; this.view.hidden = true;
    this.tabs.id = 'boardTabs';
    this.list.id = 'boardRows';
    this.view.append(this.tabs, this.list);
    this.root.append(Object.assign(document.createElement('h2'), { textContent: 'Today’s board' }), this.form, this.buttons, this.status, this.view);
    this.paint();
  }
  private paint(): void {
    const posted = this.entry?.posted, open = !!this.entry && !posted && !this.entry.refused;
    this.form.hidden = !open; this.post.hidden = !open;
    if (posted) this.status.textContent = `Posted: ${rankText(posted.rank, posted.posts)}.`;
    else if (this.entry?.refused) this.status.textContent = this.entry.refused;
    else if (!this.entry) this.status.textContent = 'This run is not today’s first, so it stays off the board.';
  }
  private say(text: string): void { this.status.textContent = text; }
  private async call(path: string, init?: RequestInit): Promise<Response | null> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
    const stop = new AbortController(), timer = setTimeout(() => stop.abort(), TIMEOUT_MS);
    try { return await (this.o.fetcher ?? fetch)(`${this.o.base}${path}`, { ...init, signal: stop.signal }); }
    catch { return null; }
    finally { clearTimeout(timer); }
  }
  private away(): void { this.say(AWAY); this.post.textContent = 'Try later'; this.post.disabled = false; }
  /** "Post my result": the player's tap, never automatic. */
  async send(): Promise<void> {
    const entry = this.entry;
    if (!entry || entry.posted || entry.refused || this.post.disabled) return;
    const typed = this.name.value.trim(), handle = typed ? readHandle(typed) : boardName();
    if (!handle) { this.say('That name will not go on the board. Letters, numbers, spaces or dashes, 3 to 14, and nothing rude.'); return; }
    held.name = handle; writeSaved(s => { s.name = handle; });
    this.post.disabled = true; this.post.textContent = 'Posting…'; this.say('');
    // The id for this board alone, from the device's secret: the board can tell one device's second try, never its other days.
    let device: string;
    try { device = await boardDevice(deviceSecret(), entry.post.area, entry.post.date); }
    catch { this.away(); return; }   // no hashing here (a page not served over HTTPS): nothing is sent
    const r = await this.call(boardPath(entry.post.area, entry.post.date), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...entry.post, handle, device }) });
    const body: unknown = r ? await r.json().catch(() => null) : null;
    if (r?.ok && body && typeof body === 'object') {
      const b = body as { id?: unknown; rank?: unknown; posts?: unknown; board?: unknown }, board = readBoard(b.board);
      if (Number.isSafeInteger(b.id) && (b.rank === null || Number.isSafeInteger(b.rank)) && Number.isSafeInteger(b.posts) && board) {
        entry.posted = { id: b.id as number, rank: b.rank as number | null, posts: b.posts as number };
        saveEntry(entry.post.area, entry);
        this.boards.set(`${board.area}/${board.date}`, { board, at: Date.now() });
        this.post.disabled = false; this.paint();
        this.o.onRank(entry.posted.rank, entry.posted.posts);
        this.area = entry.post.area; this.date = entry.post.date;
        await this.show();
        return;
      }
    }
    const error = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
    const known = typeof error === 'string' && Object.hasOwn(REFUSALS, error) ? error as Refusal : null;
    // Away, busy or closed: the same run may try again later. Any other refusal is final for this run.
    if (!r || !known || known === 'rate' || known === 'off') {
      // No answer: the post may have reached the board on its way.
      if (!known && !entry.tried) { entry.tried = true; saveEntry(entry.post.area, entry); }
      this.away(); if (known) this.say(REFUSALS[known].text); return;
    }
    if (known === 'posted' && entry.tried && (body as { gone?: unknown }).gone === true) {
      // An earlier try reached the board and its answer was lost. The board answers a kept row again with its place
      // (above); this one has since fallen below the top, so it has no place to give.
      const again = await this.call(boardPath(entry.post.area, entry.post.date)), board = again?.ok ? readBoard(await again.json().catch(() => null)) : null;
      if (!board) { this.away(); return; }
      entry.posted = { id: 0, rank: null, posts: board.posts }; saveEntry(entry.post.area, entry);
      this.boards.set(`${board.area}/${board.date}`, { board, at: Date.now() });
      this.post.disabled = false; this.paint();
      this.o.onRank(null, board.posts);
      await this.show(entry.post.area, entry.post.date);
      return;
    }
    // The day closed while the answer to an earlier try was lost: it may be on the board, and the board can no longer say.
    entry.refused = known === 'day' && entry.tried ? CLOSED : REFUSALS[known].text; saveEntry(entry.post.area, entry);
    this.post.disabled = false; this.paint();
    if (known === 'posted' || entry.refused === CLOSED) await this.show(entry.post.area, entry.post.date);
  }
  /** Shows a board: today's for this area first; the buttons above it choose another area or yesterday. */
  async show(area = this.area, date = this.date): Promise<void> {
    this.area = area; this.date = date; this.view.hidden = false; this.see.hidden = true;
    this.tabsPaint();
    const key = `${area}/${date}`, cached = this.boards.get(key);
    let board = cached && Date.now() - cached.at < 60e3 ? cached.board : null;
    if (!board) {
      this.list.replaceChildren(Object.assign(document.createElement('li'), { className: 'none', textContent: 'Fetching the board…' }));
      const r = await this.call(boardPath(area, date));
      board = r?.ok ? readBoard(await r.json().catch(() => null)) : null;
      if (this.area !== area || this.date !== date) return;   // another tab was chosen meanwhile
      if (!board) { this.list.replaceChildren(Object.assign(document.createElement('li'), { className: 'none', textContent: AWAY })); return; }
      this.boards.set(key, { board, at: Date.now() });
    }
    this.rows(board);
  }
  private tabsPaint(): void {
    // Two groups of toggle buttons: one area at a time, and one day at a time.
    const tab = (text: string, on: boolean, go: () => void, id: string) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: text, id });
      b.setAttribute('aria-pressed', String(on));
      b.addEventListener('click', () => { void go(); });
      return b;
    };
    const group = (label: string, buttons: HTMLElement[]) => {
      const g = document.createElement('div'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', label); g.append(...buttons); return g;
    };
    const today = this.o.plan.date, yesterday = dayBefore(today);
    this.tabs.replaceChildren(
      group('Area', Object.keys(DAILY_STARTS).map(a => tab(AREAS.find(x => x.id === a)?.name ?? a, a === this.area, () => this.show(a, this.date), `boardArea-${a}`))),
      group('Day', [tab(`Today · ${shortDate(today)}`, this.date === today, () => this.show(this.area, today), 'boardToday'),
        tab(`Yesterday · ${shortDate(yesterday)}`, this.date === yesterday, () => this.show(this.area, yesterday), 'boardYesterday')]));
  }
  private rows(board: BoardView): void {
    const mine = this.entry?.posted && this.entry.post.area === board.area && this.entry.post.date === board.date ? this.entry.posted.id : null;
    if (!board.rows.length) {
      this.list.replaceChildren(Object.assign(document.createElement('li'), { className: 'none',
        textContent: board.date === this.o.plan.date ? 'Nobody has posted yet. The board is all yours.' : 'Nobody posted that day. A quiet one.' }));
      return;
    }
    let you: HTMLElement | null = null;
    this.list.replaceChildren(...board.rows.map((r, i) => {
      const li = document.createElement('li');
      if (r.id === mine) { li.className = 'you'; you = li; }
      const squares = unpackFilled(r.squares).filter(Boolean).length;
      li.append(Object.assign(document.createElement('b'), { textContent: String(i + 1) }), Object.assign(document.createElement('span'), { textContent: r.handle }),
        Object.assign(document.createElement('em'), { textContent: rowResultText(r) }),
        Object.assign(document.createElement('small'), { textContent: `Bingo ${squares} of ${CARD_SIZE} · ${VEHICLE_NAMES[r.vehicle] ?? r.vehicle}` }));
      return li;
    }));
    (you as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' });
  }
}
