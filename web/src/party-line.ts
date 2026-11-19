// The Party Line's call-ins in Get Fired: callers phone 94.9 about the player's own run, a few seconds after it
// happens. party-line-rules.ts chooses; this fetches the recorded calls (audio/calls.json and its files) and plays them
// on the car radio, into a pause of the station. Only in Get Fired, only on the calls' dial, and only when the build
// carries recorded calls: with no list there are no call-ins and nothing else changes.
// The player's name is never in a recording: the radio line and the end card show it as text.
import { CallBoard, endLine, inGap, radioLine, readCalls, type Calls, type Pick } from './party-line-rules';
import type { Radio } from './radio';
import type { ScoreEvent } from './score-events';

/** Calls kept in memory at once (each is a few dozen kilobytes). */
const KEPT = 8;

/** Fetches audio/calls.json. With no list, or none usable, the answer is null. */
export async function fetchCalls(base: string): Promise<Calls | null> {
  try {
    const answer = await fetch(`${base}/calls.json`);
    return answer.ok ? readCalls(await answer.json()) : null;
  } catch {
    return null;
  }
}

export class PartyLine {
  readonly board: CallBoard;
  private readonly files = new Map<string, Promise<string>>();
  private readonly ready = new Map<string, string>();   // file name to its address in memory, once it has arrived
  private readonly station: string;
  constructor(private readonly radio: Radio, readonly list: Calls, private readonly base: string, readonly handle: string,
    private readonly clock: () => number = () => performance.now() / 1000) {
    this.board = new CallBoard(list);
    this.station = radio.stationNamed(list.dial) ?? list.dial;
    radio.onEnd = () => this.next(true);
  }

  /** Each scored event of the run (FiredRun), with the ladder step it reached. */
  hear(e: ScoreEvent, stepUp: number): void {
    const pick = this.board.hear(e, stepUp, this.clock());
    // Off the calls' dial the call cannot play, so its files are not fetched.
    if (pick && this.radio.tunedDial === this.list.dial) for (const file of this.filesOf(pick)) void this.fetch(file);
  }

  /** A new run. */
  reset(): void { this.board.reset(); }

  /** Each frame: a waiting call starts when the station is in a pause. */
  update(): void {
    const pending = this.board.pending;
    if (!pending) return;
    // Tuned in after the offence: its files are fetched now. One try per file: a file that failed is not asked for again.
    if (this.radio.tunedDial === this.list.dial) for (const file of this.filesOf(pending)) if (!this.files.has(file)) void this.fetch(file);
    const call = this.next(false);
    if (call && !this.radio.callIn(call)) call.done();
  }

  /** A call plays, or waits with the radio on its dial: the end card keeps the radio up for it. */
  get wantsAir(): boolean {
    return !!this.board.onAir || (this.radio.tunedDial === this.list.dial && this.board.waiting(this.clock()) !== null);
  }

  /** The end card's line: the calls that played (a call still to come is not claimed), or null when none did. */
  endLine(): string | null { return endLine(this.board.played.length, this.station, this.handle, this.board.lastName()); }

  /** The call to play now, or null. `ended`: the radio asks at the end of a piece, which is a gap too. */
  private next(ended: boolean): { urls: string[]; line: string; done: () => void } | null {
    const now = this.clock(), at = ended ? null : this.radio.position();
    const tuned = (ended ? this.radio.tunedDial : at?.dial) === this.list.dial;
    const gap = ended || (!!at && inGap(at.at, this.list.gaps[at.file]));
    const pick = this.board.ready(now, tuned, gap, (p) => this.filesOf(p).every((f) => this.ready.has(f)));
    if (!pick) return null;
    return { urls: this.filesOf(pick).map((f) => this.ready.get(f)!), line: radioLine(this.handle), done: () => this.board.done(this.clock()) };
  }

  private filesOf(p: Pick): string[] { return p.nickname ? [p.call.file, p.nickname.file] : [p.call.file]; }

  private fetch(file: string): Promise<string> {
    let got = this.files.get(file);
    if (!got) {
      got = fetch(`${this.base}/${file}`).then((r) => { if (!r.ok) throw new Error(`${file}: ${r.status}`); return r.arrayBuffer(); })
        .then((bytes) => {
          const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
          // Let go while it was on its way: keep nothing.
          if (this.files.get(file) === mine) this.ready.set(file, url); else URL.revokeObjectURL(url);
          return url;
        });
      const mine = got;
      got.catch(() => {});   // a failed file stays failed (until it is let go): its call never loads, and goes stale
      this.files.set(file, got);
      // Let the oldest go, but never one that waits or plays.
      const keep = new Set([this.board.pending, this.board.onAir].flatMap((p) => (p ? this.filesOf(p) : [])));
      for (const name of this.files.keys()) {
        if (this.files.size <= KEPT) break;
        if (name === file || keep.has(name)) continue;
        const url = this.ready.get(name);
        this.files.delete(name); this.ready.delete(name);
        if (url) URL.revokeObjectURL(url);
      }
    }
    return got;
  }
}
