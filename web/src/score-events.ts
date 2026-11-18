/**
 * The shared score stream. Game code reports plain facts here and never decides points; score-rules.ts turns the
 * facts into points. New kinds (a drift, airtime, a near miss, a broken prop) are new `kind` strings and new rows in
 * the rules' tables: the stream itself does not change. In normal mail play the stream records and nobody listens.
 */
export interface ScoreEvent {
  /** What happened: a complaint kind ('lawnMail', 'boxDown'...), a mailbox grade ('box:rock'...'box:down'), 'rut', 'schoolBus'. */
  readonly kind: string;
  /** Where: 'route' for ordinary ground, or a protected place: 'cemetery', 'church', 'busStop'. */
  readonly place: string;
  /** Speed of the player's vehicle when it happened, m/s (0 when it is not known). */
  readonly speed: number;
  /** Play seconds since the run began; paused time does not count. */
  readonly time: number;
  /** Who or what was involved, when that matters: an 'animal' or a 'person' never scores. */
  readonly subject?: string;
}
export type ScoreListener = (event: ScoreEvent) => void;

/** The last events, for a check or a dev console; the stream never grows without bound. */
export const KEEP = 64;

export class ScoreStream {
  readonly recent: ScoreEvent[] = [];
  reported = 0;
  /** Counts clear() calls: a listener knows a new run began even when the last run reported nothing. */
  runs = 0;
  private readonly listeners = new Set<ScoreListener>();
  listen(listener: ScoreListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  report(event: ScoreEvent): void {
    this.reported++;
    this.recent.push(event);
    if (this.recent.length > KEEP) this.recent.shift();
    for (const listener of this.listeners) listener(event);
  }
  /** A new run. Listeners stay. */
  clear(): void { this.recent.length = 0; this.reported = 0; this.runs++; }
}
