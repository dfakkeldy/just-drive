// Radio reception by place: where each station comes in, and how a weak one sounds. Rules only: no page, no sound.
// The car radio (radio.ts) asks these rules every frame. The Just Listen page does not: it hears every station.
// Every transmitter here is invented. A place is in map metres (east, north), the grid that every area's land shares,
// so one table serves all the areas and a drive from one to the next needs nothing more.
// A station with no transmitter in the table comes in everywhere, also in a hollow (the talk station is one).

/** An invented transmitter: full signal out to `clear` metres, none past `edge`. */
export interface Transmitter { e: number; n: number; clear: number; edge: number }
/** Low land that the hills shut in: no transmitter reaches inside `deep` metres of it, and all are whole again past `rim`. */
export interface Hollow { e: number; n: number; deep: number; rim: number }
export interface ReceptionMap { transmitters: Readonly<Record<string, Transmitter>>; hollows: readonly Hollow[] }

const WIDE = { e: 618500, n: 5088500 };    // inland, between Port Hood and Judique
const SHORE = { e: 615500, n: 5088800 };   // on the shore between the same two
const TOWN = { e: 627000, n: 5054000 };    // above the town at the strait
const CANAL = { e: 623671, n: 5056096 };   // at the canal's span, where the barrier holds the cars (canal.ts)

/**
 * The game's reception. Around Mabou one station comes in; at Port Hood and Judique, two; near the strait, the town's.
 * In the Glencoe hollow only the station with no transmitter (the talk station) is left.
 * The canal has a small station of its own: whole round the Causeway, and gone at the centre of the next village.
 * tools/radio-reception-check.mjs holds these words as tests, and proves that every dial here is in the catalogue.
 */
export const RECEPTION: ReceptionMap = {
  transmitters: {
    '103.5': { ...WIDE, clear: 27000, edge: 35000 },
    '107.3': { ...SHORE, clear: 8500, edge: 11500 },
    '88.3': { ...TOWN, clear: 20000, edge: 27000 },
    '92.5': { ...TOWN, clear: 20000, edge: 27000 },
    '99.1': { ...TOWN, clear: 20000, edge: 27000 },
    '96.1': { ...TOWN, clear: 12000, edge: 17000 },
    '96.7': { ...TOWN, clear: 20000, edge: 27000 },
    '90.3': { ...CANAL, clear: 3000, edge: 5000 },
  },
  hollows: [{ e: 630300, n: 5090900, deep: 4500, rim: 7500 }],
};

/** 0 at `from` and before, 1 at `to` and after, and smooth between. */
function ramp(from: number, to: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/**
 * How much of a station reaches a place, from 0 (none) to 1 (all of it). With no map, a dial that has no transmitter,
 * or a place that is not known yet, the answer is 1: a radio is never taken away by a missing number.
 */
export function signalAt(map: ReceptionMap | null, dial: string, e: number, n: number): number {
  if (!map || !Object.hasOwn(map.transmitters, dial) || !Number.isFinite(e) || !Number.isFinite(n)) return 1;
  const tx = map.transmitters[dial];
  let signal = 1 - ramp(tx.clear, tx.edge, Math.hypot(e - tx.e, n - tx.n));
  for (const h of map.hollows) signal *= ramp(h.deep, h.rim, Math.hypot(e - h.e, n - h.n));
  return Number.isFinite(signal) ? signal : 1;
}

export const LOST = 0.05;    // at and under this, no music is left
export const CLEAR = 0.6;    // from here up, the music is at its full level
const QUIET = 0.95;          // from here up, there is no static at all
const SLACK = 0.03;          // a readout that has changed needs this much more before it changes back

/** The dial stops at a station only where some of its music is left. */
export function comesIn(signal: number): boolean { return signal > LOST; }

export type Band = 'clear' | 'weak' | 'lost';

/**
 * The readout's word for a signal. `was` is the word shown now: it holds a little past its limit, so a car that
 * stands on a limit does not make the readout flicker. Leave it out for a station that was just tuned.
 */
export function bandOf(signal: number, was?: Band): Band {
  if (signal <= (was === 'lost' ? LOST + SLACK : LOST)) return 'lost';
  return signal >= (was === 'clear' ? CLEAR - SLACK : CLEAR) ? 'clear' : 'weak';
}

/**
 * How a signal sounds, as two levels from 0 to 1. A weak station on this band keeps its music under a rising static
 * and then drops out quickly, so the music stays whole down to CLEAR while the static has already begun at QUIET.
 * `band` is the readout's word now: while it says that the station is lost, no music is left, so the two never disagree.
 */
export function mix(signal: number, band?: Band): { music: number; hiss: number } {
  const s = Number.isFinite(signal) ? Math.min(1, Math.max(0, signal)) : 1;
  return { music: band === 'lost' ? 0 : Math.min(1, Math.max(0, (s - LOST) / (CLEAR - LOST))), hiss: Math.min(1, Math.max(0, (QUIET - s) / (QUIET - 0.2))) };
}

const FLUTTER = 0.35;        // the most that a weak signal dips as the car moves

/**
 * A weak signal comes and goes as the car moves through it. The dip depends on the place alone, so a parked car hears
 * a steady signal and the same road always sounds the same. A full signal and a lost one are not changed.
 */
export function flutter(signal: number, e: number, n: number): number {
  if (!(signal > 0 && signal < 1) || !Number.isFinite(e) || !Number.isFinite(n)) return signal;
  const wave = 0.5 + 0.5 * Math.sin(e / 9 + n / 14) * Math.sin(e / 23 - n / 17);
  return signal * (1 - FLUTTER * 4 * signal * (1 - signal) * wave);
}

/**
 * The next station round the dial from `station` (-1 is off), passing over each one that does not come in. After a
 * full turn, where the dial comes back to the starting station `first`, the radio is off. From off, the dial goes to
 * `first`, or to the next one after it that comes in; if none does, to `first` all the same.
 */
export function nextOnDial(count: number, station: number, first: number, comes: (station: number) => boolean): number {
  if (station < 0) {
    for (let k = 0; k < count; k++) if (comes((first + k) % count)) return (first + k) % count;
    return first;
  }
  for (let i = (station + 1) % count; i !== first; i = (i + 1) % count) if (comes(i)) return i;
  return -1;
}
