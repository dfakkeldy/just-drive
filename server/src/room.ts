import { readChat, CHAT_COOLDOWN } from '../../web/src/mp/social';
// What a room decides, without any Cloudflare type in it: so the same rules run in the Worker and in a node check.
import { BODY, CLOSE, ROOM_CAP, parseRideChange, checkState, encodeSnapshot, type PeerInfo, type ServerText } from '../../web/src/mp/wire';

/** What the room remembers about one connection. It is small: it rides on the socket through a sleep. */
export interface Seat extends PeerInfo { last: Uint8Array | null; races?: boolean; lastChat?: number }

// Fallback call signs are invented by the room from the game's own words.
const SIGNS = ['Loose Gravel', 'Flag Up', 'Flag Down', 'Late Flyer', 'Washboard', 'Muddy Culvert', 'Sleepy Cat', 'Stuck Window',
  'Double Mail', 'Cold Coffee', 'Soft Shoulder', 'Frost Heave', 'Spare Tire', 'Crusher Dust', 'Pothole', 'Side Mirror',
  'Dog Biscuit', 'Low Fuel', 'Wrong Lane', 'Parcel Day', 'Rail Trail', 'Guard Rail', 'Fog Bank', 'Dust Cloud'];
export const HUES = 8;

export function takeSeat(taken: Seat[], random: () => number = Math.random): Seat | null {
  if (taken.length >= ROOM_CAP) return null;
  const ids = new Set(taken.map((s) => s.id)), names = new Set(taken.map((s) => s.name));
  // A number drawn at random, never the lowest free one: a seat that was just left may still have its "leave" on the
  // way to the others, and a newcomer with the same number would be removed by it.
  let id = 0;
  while (id === 0 || ids.has(id)) id = 1 + Math.floor(random() * 65535) % 65535;
  let name = '';
  for (let tries = 0; tries < 200 && (!name || names.has(name)); tries++) {
    name = `${SIGNS[Math.floor(random() * SIGNS.length) % SIGNS.length]} ${2 + Math.floor(random() * 98)}`;
  }
  // The colour least used in the room, so two cars side by side seldom match.
  const used = new Array<number>(HUES).fill(0);
  for (const s of taken) used[s.hue % HUES]++;
  const hue = used.indexOf(Math.min(...used));
  return { id, name, hue, last: null };
}

export const text = (m: ServerText) => JSON.stringify(m);
export const hello = (seat: Seat, room: string, others: Seat[]): string => text({
  t: 'hello', v: 1, id: seat.id, name: seat.name, hue: seat.hue, ride: seat.ride, room, cap: ROOM_CAP, rides: true, chat: true, heartbeat: true,
  peers: others.map(({ id, name, hue, ride }) => ({ id, name, hue, ride })),
});
/** Where everybody was last heard: a newcomer sees parked cars at once. */
export const lastKnown = (others: Seat[]): ArrayBuffer | null => {
  const entries = others.filter((s) => s.last).map((s) => ({ id: s.id, body: s.last! }));
  return entries.length ? encodeSnapshot(entries) : null;
};

/** How often one connection may speak. A game sends 5 a second; a script that floods is dropped, then shown the door. */
export class Meter {
  private tokens = 12; private stamp = -1;
  strikes = 0;
  /** lastT: the stamp of the seat's last accepted report. A room that slept reads it back from the seat. */
  constructor(private lastT = -1) {}
  allow(now: number): boolean {
    if (this.stamp >= 0) this.tokens = Math.min(12, this.tokens + (now - this.stamp) * 0.008);
    this.stamp = now;
    if (this.tokens < 1) { this.strikes++; return false; }
    this.tokens -= 1;
    return true;
  }
  /** A sender's clock only grows. An older stamp is a replay or a broken game. */
  inOrder(t: number): boolean { if (t < this.lastT) { this.strikes++; return false; } this.lastT = t; return true; }
}
export const STRIKES_OUT = 40;

export type Verdict =
  | { relay: ArrayBuffer; body: Uint8Array }
  | { relay: string; ride: NonNullable<PeerInfo['ride']> }
  | { relay: string; chat: true }
  | { drop: true; close?: number };

/** One incoming message from one seat. Only ride metadata and fixed phrase IDs are accepted text ("ping" is answered before the room wakes). */
export function judge(seat: Seat, meter: Meter, message: ArrayBuffer | string, now: number, bounds: number): Verdict {
  const out = (code: number): Verdict => (meter.strikes > STRIKES_OUT ? { drop: true, close: code } : { drop: true });
  if (!meter.allow(now)) return out(CLOSE.rate);
  if (typeof message === 'string') {
    const phrase = readChat(message);
    if (phrase !== null) {
      if (seat.lastChat !== undefined && now - seat.lastChat < CHAT_COOLDOWN) return { drop: true };
      seat.lastChat = now;
      return { relay: text({ t: 'chat', id: seat.id, phrase }), chat: true };
    }
    const ride = parseRideChange(message);
    if (!ride) { meter.strikes += 4; return out(CLOSE.bad); }
    return { relay: text({ t: 'ride', id: seat.id, ride }), ride };
  }
  const body = checkState(message, bounds);
  if (!body) { meter.strikes += 4; return out(CLOSE.bad); }
  if (!meter.inOrder(new DataView(message).getUint32(2 + 4, true))) return out(CLOSE.bad);
  const copy = new Uint8Array(BODY);
  copy.set(body);
  return { relay: encodeSnapshot([{ id: seat.id, body: copy }]), body: copy };
}
