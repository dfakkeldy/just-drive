import { readHandle } from '../../web/src/mp/social';
import { Race } from './race';
import { RoomGame } from './game';
import { CONTROL_MAX } from '../../web/src/mp/game-wire';
import { RACE_LIMIT } from '../../web/src/mp/race-wire';
import { readSite } from '../../web/src/site';
import { historyArea } from '../../web/src/eras/history-areas';
// The multiplayer server for Mabou Mail Madness: a door (the Worker's fetch) and rooms (one Durable Object each).
// It relays car positions between the players of a room. It retains the current race and room game until the room empties
// (a game keeps its players' last places only while it runs), keeps no log of positions,
// and never reads or forwards a network address.
//
// Verify locally with tools/check-mp.sh. The Mabou main thread owns Worker deployment.
import { DurableObject } from 'cloudflare:workers';
import { CLOSE, HEARTBEAT, PEER_TIMEOUT_MS, PING, PONG, VERSION } from '../../web/src/mp/wire';
import { Meter, STRIKES_OUT, hello, judge, lastKnown, takeSeat, text, type Seat } from './room';
import { Board, boardDoor, type BoardEnv } from './board';

// A query key that changes what the game starts with; the site key and link-tracking tags do not.
const gameQuery = (params: URLSearchParams): boolean =>
  [...params.keys()].some(key => key !== 'site' && key !== 'fbclid' && key !== 'gclid' && !key.startsWith('utm_'));
export { Board };

export interface Env extends BoardEnv {
  ROOMS: DurableObjectNamespace<Room>;
  ASSETS?: Fetcher;
  /** Pages that may join a room or post to Today's board, comma separated: "https://mmm.fakkeldy.ca". "http://localhost:*" allows any local port. */
  ORIGINS: string;
  /**
   * Half the side, in metres, of the square around an area's origin in which a car may be. Every area the game has
   * fits in it, so a new area needs no change here: an area is only a word in the room's name.
   */
  BOUNDS: string;
  /** "off" closes every room at once, without a new build: `wrangler deploy --var MP:off` (and without it to open). */
  MP?: string;
  /** Local checks only (wrangler dev --var GAME_ROUND_S:20): a shorter room-game round. Never set for the live site. */
  GAME_ROUND_S?: string;
}

const OPEN = 1;   // WebSocket.readyState of a live socket
const PATH = /^\/mp\/v(\d+)\/([a-z0-9-]{1,24})\/([a-z0-9]{1,12})$/;

function originAllowed(origin: string | null, list: string): boolean {
  if (!origin) return false;
  return list.split(',').map((s) => s.trim()).some((rule) =>
    rule.endsWith(':*') ? origin.startsWith(rule.slice(0, -1)) && /^\d+$/.test(origin.slice(rule.length - 1)) : origin === rule);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const site = readSite(url.hostname, url.pathname, url.searchParams);
    // One address, two pages: each host's /about and /help are its own brand's (tools/about-pages.mjs). No file is
    // called /about or /help, so this runs without a run_worker_first entry, and before either can be taken for a place.
    if ((request.method === 'GET' || request.method === 'HEAD') && env.ASSETS && /^\/(about|help)\/?$/.test(url.pathname)) {
      const page = url.pathname.split('/')[1];
      if (url.pathname.endsWith('/')) { url.pathname = `/${page}`; return Response.redirect(url.href, 308); }
      url.pathname = `/${page}/${site.brand}/`;
      return env.ASSETS.fetch(new Request(url, request));
    }
    if ((request.method === 'GET' || request.method === 'HEAD') && env.ASSETS && site.brand === 'just'
      && (url.pathname === '/' || /^\/[^/]+\/?$/.test(url.pathname))) {
      // The bare root is the map of places (tools/just-home.mjs). A root with a game query is an old link: it keeps its
      // query and goes where the root used to start: a trip to its own area, anything else to /mabou. Tracking tags
      // that social sites add (utm_*, fbclid, gclid) are not a game query. The trip names are tripId's (web/src/quarry-trip.ts,
      // which needs the DOM, so the Worker cannot import it).
      const home = url.pathname === '/';
      if (home && gameQuery(url.searchParams)) {
        const trip = ['quarry', 'quarry-gate'].includes(url.searchParams.get('trip') ?? '') && (readSite(url.hostname, '/' + (url.searchParams.get('area') || 'westbay'), url.searchParams).area ?? 'westbay');
        url.pathname = '/' + (trip || 'mabou');
        return Response.redirect(url.href, 308);
      }
      if (site.area && !home && url.pathname.endsWith('/')) {
        url.pathname = url.pathname.slice(0, -1); return Response.redirect(url.href, 308);
      }
      // Only navigation addresses reach this branch. Existing files retain asset-first routing.
      url.pathname = home ? '/just/home/' : `/just/${site.era ? historyArea(site.area)?.address ?? 'unknown' : site.area ?? 'unknown'}/`;
      const asked = new Request(url, request);
      // "Not modified" has no meaning for a 404: the place list must come with its body each time.
      if (!site.area) for (const name of ['If-None-Match', 'If-Modified-Since']) asked.headers.delete(name);
      const page = await env.ASSETS.fetch(asked);
      const headers = new Headers(page.headers); headers.set('Cache-Control', 'no-store');
      let body: BodyInit | null = page.body;
      if ((home || !site.area) && url.hostname === 'localhost' && page.status === 200) {
        body = (await page.text()).replace(/(<a\b[^>]*href="\/[^"?]+)(")/g, '$1?site=just$2');
        headers.delete('Content-Length'); headers.delete('ETag');
      }
      return new Response(body, { status: home || site.area ? page.status : 404, headers });
    }
    // Today's board (server/src/board.ts): post a Today's run result, read a board.
    if (url.pathname.startsWith('/board/')) return boardDoor(request, env, (origin) => originAllowed(origin, env.ORIGINS));
    if (!url.pathname.startsWith('/mp/')) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    const m = PATH.exec(url.pathname);
    if (!m) return new Response('Not found', { status: 404 });
    if (env.MP === 'off') return new Response('Driving with others is closed.', { status: 503 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    if (Number(m[1]) !== VERSION) return new Response('This game is older or newer than the room. Reload the page.', { status: 400 });
    if (!originAllowed(request.headers.get('Origin'), env.ORIGINS)) return new Response('Forbidden', { status: 403 });
    const bounds = Number(env.BOUNDS);
    if (!(bounds > 0)) return new Response('Not found', { status: 404 });
    const name = `${m[2]}/${m[3]}`;
    // The room learns its own name and size from the door: an object cannot read the name it was found by.
    const headers = new Headers(request.headers);
    headers.set('x-room', name); headers.set('x-bounds', String(bounds));
    return env.ROOMS.get(env.ROOMS.idFromName(name)).fetch(new Request(request, { headers }));
  },
} satisfies ExportedHandler<Env>;

interface Attachment extends Seat { bounds: number; browserId: string | null; sessionKey: string | null; lastReal: number }

export class Room extends DurableObject<Env> {
  // Rate meters live in memory only. A room that slept has forgotten them; a flood keeps it awake, so that is safe.
  private meters = new Map<WebSocket, Meter>();
  private race = new Race();
  private game = new RoomGame();
  private readonly roundMs = Number(this.env.GAME_ROUND_S) >= 10 ? Number(this.env.GAME_ROUND_S) * 1000 : undefined;
  private alarmFor = 0;
  private raceBusy(now: number): boolean {
    const s = this.race.state;
    return !!s.startAt && now - s.startAt < RACE_LIMIT && s.racers.some(r => r.time === null && !r.out);
  }
  /**
   * Every game-capable player hears the new state, and the room keeps it: a quiet room may sleep at any moment, and
   * wakes with what it kept (about one write a second while a round is scored, as the race keeps each change).
   */
  private gameChanged(): void {
    const now = Date.now(), frame = this.game.frame(now), seats = this.seats();
    for (const { ws, seat } of seats) if (seat.games) { try { ws.send(frame); } catch { /* closing */ } }
    this.ctx.waitUntil(seats.length ? this.ctx.storage.put('game', this.game.state) : this.ctx.storage.delete('game'));
    // The end of a countdown, a round or a table wakes the room even when nobody drives.
    if (this.game.deadline() !== this.alarmFor) { this.alarmFor = this.game.deadline(); this.ctx.waitUntil(this.scheduleAlarm()); }
  }
  private saveRace(): void { this.ctx.waitUntil(this.seats().length ? this.ctx.storage.put('race', this.race.state) : this.ctx.storage.delete('race')); }
  private raceChanged(): void {
    this.saveRace();
    const message = this.race.message(Date.now());
    for (const {ws} of this.seats()) { try { ws.send(message); } catch { /* closing */ } }
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.race = new Race(await ctx.storage.get('race'));
      this.game = new RoomGame(await ctx.storage.get('game'), this.roundMs);
      this.alarmFor = this.game.deadline();
    });
    // A game says "ping" twice a minute to learn that its connection lives. The answer costs the room no waking.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  private seats(except?: WebSocket): { ws: WebSocket; seat: Attachment }[] {
    const out: { ws: WebSocket; seat: Attachment }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      // A socket that is closing may still be listed for a moment: it holds no seat any more.
      if (ws === except || ws.readyState !== OPEN) continue;
      const seat = ws.deserializeAttachment() as Attachment | null;
      if (seat) out.push({ ws, seat });
    }
    return out;
  }

  private toOthers(from: WebSocket, data: string | ArrayBuffer): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === from || ws.readyState !== OPEN || !ws.deserializeAttachment()) continue;
      try { ws.send(data); } catch { /* that socket is closing; its own close event follows */ }
    }
  }

  private async scheduleAlarm(): Promise<void> {
    const peers = this.seats();
    const game = this.game.deadline();
    if (peers.length) await this.ctx.storage.setAlarm(Math.min(...peers.map(p => (p.seat.lastReal ?? 0) + PEER_TIMEOUT_MS), game || Infinity));
    else await this.ctx.storage.deleteAlarm();
  }

  private expire(): void {
    for (const { ws, seat } of this.seats()) {
      if (Date.now() - (seat.lastReal ?? 0) < PEER_TIMEOUT_MS) continue;
      this.gone(ws);
      ws.close(CLOSE.inactive, 'inactive');
    }
  }

  async alarm(): Promise<void> {
    this.expire();
    if (this.game.tick(Date.now())) this.gameChanged();
    await this.scheduleAlarm();
  }

  async fetch(request: Request): Promise<Response> {
    this.expire();
    const params = new URL(request.url).searchParams;
    const identity = (key: string): string | null => {
      const value = params.get(key);
      return value && /^[a-zA-Z0-9-]{16,64}$/.test(value) ? value : null;
    };
    const browserId = identity('browser'), sessionKey = identity('session');
    if (browserId) for (const { ws, seat } of this.seats()) {
      if (seat.browserId !== browserId) continue;
      this.gone(ws);
      ws.close(CLOSE.replaced, 'replaced');
    }
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server);
    const others = this.seats(server);
    const seat = takeSeat(others.map((o) => o.seat));
    if (!seat) {
      server.send(text({ t: 'full' }));
      server.close(CLOSE.full, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }
    seat.name = readHandle(params.get('handle')) ?? seat.name;
    const mine: Attachment = { ...seat, bounds: Number(request.headers.get('x-bounds')) || 0, browserId, sessionKey, lastReal: Date.now() };
    server.serializeAttachment(mine);
    await this.scheduleAlarm();
    if (!others.length) {
      this.race = new Race(); this.game = new RoomGame(undefined, this.roundMs); this.alarmFor = 0;
      this.ctx.waitUntil(this.ctx.storage.delete('game'));   // a sleep before the first game-sync must not bring the old game back
    }
    this.raceChanged();
    server.send(this.race.message(Date.now()));
    server.send(hello(seat, request.headers.get('x-room') ?? '', others.map((o) => o.seat)));
    const known = lastKnown(others.map((o) => o.seat));
    if (known) server.send(known);
    this.toOthers(server, text({ t: 'join', id: seat.id, name: seat.name, hue: seat.hue, ride: seat.ride }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const seat = ws.deserializeAttachment() as Attachment | null;
    if (!seat) return;   // the "full" reply is on its way out
    if (Date.now() - (seat.lastReal ?? 0) >= PEER_TIMEOUT_MS) { this.gone(ws); ws.close(CLOSE.inactive, 'inactive'); return; }
    let meter = this.meters.get(ws);
    // After a sleep the meter is new, but the seat still holds the last report: its stamp keeps replays out.
    if (!meter) this.meters.set(ws, meter = new Meter(seat.last ? new DataView(seat.last.buffer, seat.last.byteOffset, seat.last.byteLength).getUint32(4, true) : -1));
    if (message === HEARTBEAT) {
      if (meter.allow(Date.now())) {
        seat.lastReal = Date.now(); ws.serializeAttachment(seat); ws.send(HEARTBEAT);
      } else if (meter.strikes > STRIKES_OUT) { this.gone(ws); ws.close(CLOSE.rate, 'refused'); }
      return;
    }
    if (typeof message === 'string' && message.length <= CONTROL_MAX) {
      let m: Record<string, unknown> | null = null;
      try { m = JSON.parse(message); } catch { /* normal judge handles invalid text */ }
      // Room games: only a game that read hello.games sends these. The room judges the game from position reports.
      if (m?.t === 'game-sync' || m?.t === 'game-control') {
        const now = Date.now();
        const strike = () => { meter.strikes += 4; if (meter.strikes > STRIKES_OUT) { this.gone(ws); ws.serializeAttachment(null); ws.close(CLOSE.bad, 'refused'); } };
        if (!meter.allow(now)) { if (meter.strikes > STRIKES_OUT) { this.gone(ws); ws.close(CLOSE.rate,'refused'); } return; }
        if (m.t === 'game-sync') {
          if (Object.keys(m).length !== 1) { strike(); return; }
          // The first sync joins: everyone hears of it (a first player becomes host). A repeat is answered to the sender only.
          if (!seat.games) { seat.games = true; ws.serializeAttachment(seat); this.game.join(seat.id); this.game.tick(now); this.gameChanged(); }
          else { if (this.game.tick(now)) this.gameChanged(); else ws.send(this.game.frame(now)); }
        } else if (!seat.games) strike();
        else if (this.game.command(seat.id, m, this.seats().filter(p => p.seat.games).map(p => p.seat), seat.bounds, now, this.raceBusy(now))) this.gameChanged();
        else ws.send(this.game.frame(now));   // refused: the host's page hears the unchanged state, and stops waiting
        return;
      }
      if (message.length <= 4096 && (m?.t === 'race-control' || m?.t === 'race-sync')) {
        if (!meter.allow(Date.now())) { if (meter.strikes > STRIKES_OUT) { this.gone(ws); ws.close(CLOSE.rate,'refused'); } return; }
        // A race does not start while a room game counts down or plays.
        if (m.t === 'race-control' && m.action === 'start' && this.game.busy()) return;
        if (m.t === 'race-sync' && typeof m.echo === 'number' && Number.isFinite(m.echo)) {
          if (!seat.races) { seat.races = true; ws.serializeAttachment(seat); this.race.join(seat.id); this.raceChanged(); }
          ws.send(JSON.stringify({t:'race-sync',echo:m.echo,now:Date.now()}));
        } else if (this.race.command(seat.id,m,this.seats().map(p=>p.seat).filter(p=>p.races),seat.bounds,Date.now())) this.raceChanged();
        return;
      }
    }
    const verdict = judge(seat, meter, message, Date.now(), seat.bounds);
    if ('drop' in verdict) {
      if (verdict.close) {
        // Shown the door: the others are told now, and the seat is taken away, so whatever this socket still has
        // on the way is ignored (it would otherwise meet a fresh meter).
        this.gone(ws);
        ws.serializeAttachment(null);
        ws.close(verdict.close, 'refused');
      }
      return;
    }
    if ('chat' in verdict) { ws.send(verdict.relay); }
    else if ('ride' in verdict) seat.ride = verdict.ride;
    else {
      seat.lastReal = Date.now(); seat.last = verdict.body; if (this.race.position(seat.id,verdict.body,Date.now())) this.raceChanged();
      if (seat.games && this.game.position(seat.id, verdict.body, Date.now())) this.gameChanged();
    }
    ws.serializeAttachment(seat);
    this.toOthers(ws, verdict.relay);
  }

  private gone(ws: WebSocket): void {
    this.meters.delete(ws);
    const seat = ws.deserializeAttachment() as Attachment | null;
    if (seat && !this.seats(ws).some((o) => o.seat.id === seat.id)) this.toOthers(ws, text({ t: 'leave', id: seat.id }));
    // The seat is given up now. A newcomer must never be told of this car, even if the socket lingers in the list.
    try { ws.serializeAttachment(null); } catch { /* already closed */ }
    if (seat) {
      this.race.leave(seat.id,this.seats(ws).filter(p=>p.seat.races).map(p=>p.seat.id)); this.raceChanged();
      if (this.game.leave(seat.id, this.seats(ws).filter(p => p.seat.games).map(p => p.seat.id), Date.now())) this.gameChanged();
    }
  }
  webSocketClose(ws: WebSocket): void {
    this.gone(ws);
    // Answer the close, so the other end's close completes at once. (Newer runtimes do this themselves; a second
    // close is then refused, which is fine.)
    try { ws.close(1000, 'bye'); } catch { /* already closed */ }
  }
  webSocketError(ws: WebSocket): void { this.gone(ws); }
}
