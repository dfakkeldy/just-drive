// Today's board: one SQLite Durable Object per area and Atlantic day (the only kind the Workers Free plan allows).
// Two routes on the same Worker: POST /board/v1/<area>/<date> posts a result, GET reads the board.
//
// The door (boardDoor) judges a post with the game's own rules (web/src/board-rules.ts): today's seed and card, the
// event list scored again, the ceiling for the run's length. Only a result it accepts reaches the board. The board
// keeps one post per device id, its top BOARD_KEEP rows, and deletes itself BOARD_DAYS days on (an alarm).
// A row holds the handle, points, discipline step, time, bingo squares, vehicle and the device's random id. No
// network address is stored or forwarded: the rate limit reads it at the door and keeps it in this isolate's memory.
//
// Verify locally with tools/check-board.sh. The Mabou main thread owns Worker deployment.
/// <reference path="./rules-globals.d.ts" />
import { DurableObject } from 'cloudflare:workers';
import {
  BOARD_PATH, BOARD_VERSION, BoardBook, MAX_BODY, Meters, POST_RATE, READ_RATE, REFUSALS, addressKey, expiresAt, judgePost, readableDay, type Refusal, type Row,
} from '../../web/src/board-rules';
import { dailyArea } from '../../web/src/daily-rules';

export interface BoardEnv {
  BOARDS: DurableObjectNamespace<Board>;
  /** "off" closes the board at once, without a new build: `wrangler deploy --var BOARD:off`. The game says to try later. */
  BOARD?: string;
  /** LOCAL CHECKS ONLY (tools/check-board.sh): delete a board this many ms after its first post. Never set in deploy/. */
  BOARD_TEST_EXPIRY_MS?: string;
}

// In memory only, per isolate: forgotten when the Worker sleeps or another copy of it answers.
const postMeter = new Meters(POST_RATE.burst, POST_RATE.everyMs), readMeter = new Meters(READ_RATE.burst, READ_RATE.everyMs);

const json = (value: unknown, status: number, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

/** The request body, or null when it is longer than MAX_BODY (read no further than that). */
async function capped(request: Request): Promise<string | null> {
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY) return null;
  if (!request.body) return '';
  const reader = request.body.getReader(), parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); return null; }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return new TextDecoder().decode(all);
}

/** The Worker's board routes. `allowed` is the room server's own origin rule (Env.ORIGINS). */
export async function boardDoor(request: Request, env: BoardEnv, allowed: (origin: string | null) => boolean): Promise<Response> {
  const url = new URL(request.url), m = BOARD_PATH.exec(url.pathname);
  if (!m) return new Response('Not found', { status: 404 });
  const origin = request.headers.get('Origin');
  // Same-origin pages need none of this; a local test page on another port does.
  const cors: Record<string, string> = origin && allowed(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
  const refuse = (error: Refusal, gone?: true): Response => json({ error, text: REFUSALS[error].text, ...gone ? { gone } : {} }, REFUSALS[error].status, cors);
  if (request.method === 'OPTIONS') {
    if (!cors['Access-Control-Allow-Origin']) return new Response('Forbidden', { status: 403 });
    return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } });
  }
  if (env.BOARD === 'off') return refuse('off');
  if (Number(m[1]) !== BOARD_VERSION) return json({ error: 'version', text: 'This game is older or newer than the board. Reload the page.' }, 400, cors);
  const area = m[2], date = m[3], now = Date.now();
  if (!dailyArea(area)) return refuse('area');
  // Read here for the rate limit only; never stored, never sent on to the board.
  const address = addressKey(request.headers.get('CF-Connecting-IP') ?? 'local');
  const board = (): DurableObjectStub<Board> => env.BOARDS.get(env.BOARDS.idFromName(`${area}/${date}`));
  if (request.method === 'GET') {
    if (!readMeter.allow(address, now)) return refuse('rate');
    if (!readableDay(date, now)) return json({ error: 'gone', text: 'No board for that day.' }, 404, cors);
    const view = await board().read(area, date);
    return new Response(view, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors } });
  }
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST, OPTIONS' } });
  // Only the game's own page posts.
  if (!origin || !allowed(origin)) return new Response('Forbidden', { status: 403 });
  if (!postMeter.allow(address, now)) return refuse('rate');
  const text = await capped(request);
  if (text === null) return refuse('big');
  let body: unknown;
  try { body = JSON.parse(text); } catch { return refuse('shape'); }
  const verdict = judgePost(body, area, date, now);
  if (!verdict.ok) return refuse(verdict.error);
  const expiry = Number(env.BOARD_TEST_EXPIRY_MS) > 0 ? now + Number(env.BOARD_TEST_EXPIRY_MS) : expiresAt(date);
  const out = await board().post(area, date, verdict.row, expiry);
  return 'error' in out && out.error ? refuse(out.error, out.gone) : json(out, 200, cors);
}

/** One board. Its rows live in SQLite; a copy in memory answers reads without touching storage. */
export class Board extends DurableObject<BoardEnv> {
  private book: BoardBook | null = null;
  private view: string | null = null;

  private load(): BoardBook {
    if (this.book) return this.book;
    let rows: Row[] = [], posts = 0;
    // A board nobody posted to has no tables: it is empty, and a read creates nothing.
    if (this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tally'").toArray().length) {
      rows = this.ctx.storage.sql.exec('SELECT id, handle, points, step, time, squares, vehicle, device FROM rows').toArray() as unknown as Row[];
      posts = Number(this.ctx.storage.sql.exec('SELECT posts FROM tally WHERE k = 0').toArray()[0]?.posts ?? 0);
    }
    return this.book = new BoardBook(rows, posts);
  }

  /** The board as JSON, for anyone. */
  read(area: string, date: string): string { return this.view ??= JSON.stringify(this.load().view(area, date)); }

  /** A result the door accepted. One post per device id; the board keeps its top rows and drops the rest. */
  async post(area: string, date: string, row: Omit<Row, 'id'>, expiry: number) {
    const book = this.load(), sql = this.ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS rows (id INTEGER PRIMARY KEY, handle TEXT NOT NULL, points INTEGER NOT NULL, step INTEGER NOT NULL,
      time REAL NOT NULL, squares INTEGER NOT NULL, vehicle TEXT NOT NULL, device TEXT NOT NULL)`);
    // Every device id that posted to this board and its row's id, also after the row fell off the top: so a device posts
    // once, and a post whose answer was lost can be answered again. Deleted with the board.
    sql.exec('CREATE TABLE IF NOT EXISTS posted (device TEXT PRIMARY KEY, id INTEGER NOT NULL) WITHOUT ROWID');
    sql.exec('CREATE TABLE IF NOT EXISTS tally (k INTEGER PRIMARY KEY, posts INTEGER NOT NULL)');
    const id = book.posts + 1, mine: Row = { ...row, id };
    const seen = sql.exec('SELECT id FROM posted WHERE device = ?', row.device).toArray()[0]?.id;
    const placed = book.add(mine, seen === undefined ? null : Number(seen));
    // `gone`: this device's row has fallen off the top, so a lost answer cannot be told from a second try.
    if ('error' in placed) return { error: placed.error, gone: placed.gone };
    if (placed.again) return { id: placed.id, rank: placed.rank, posts: book.posts, board: book.view(area, date) };
    const { rank, dropped } = placed;
    sql.exec('INSERT INTO posted (device, id) VALUES (?, ?)', row.device, id);
    sql.exec('INSERT INTO tally (k, posts) VALUES (0, ?) ON CONFLICT (k) DO UPDATE SET posts = excluded.posts', book.posts);
    if (rank !== null) sql.exec('INSERT INTO rows (id, handle, points, step, time, squares, vehicle, device) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, mine.handle, mine.points, mine.step, mine.time, mine.squares, mine.vehicle, mine.device);
    for (const d of dropped) if (d !== mine) sql.exec('DELETE FROM rows WHERE id = ?', d.id);
    this.view = null;
    if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(expiry);
    return { id, rank, posts: book.posts, board: book.view(area, date) };
  }

  /** BOARD_DAYS days on: the whole board goes, rows, device ids and count. */
  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
    this.book = null; this.view = null;
  }
}
