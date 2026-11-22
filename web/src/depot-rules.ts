/**
 * Pure rules for the Port Hood Mail Depot: the invented Boss character options, the shift-start mail loading mini-game,
 * and the interrogation room after a suspension or a bad Boss verdict. No DOM, no three.js.
 */
import { complaintLine, type ComplaintKind } from './complaints';
import type { Verdict } from './ride-along-rules';
import { dayType, draw } from './shift-rules';

/** Three invented, stylized looks for the Boss (faceless geometric figures, resembling no real person). */
export type BossLookId = 'windbreaker' | 'overcoat' | 'vest';
export interface BossLookSpec {
  readonly id: BossLookId;
  readonly label: string;
  readonly summary: string;
}
export const BOSS_LOOKS: readonly BossLookSpec[] = Object.freeze([
  {
    id: 'windbreaker',
    label: 'Option A: Oxblood windbreaker & visor cap',
    summary: 'Oxblood dispatch jacket echoing the Boss car, amber lanyard badge, billed cap and wooden clipboard.',
  },
  {
    id: 'overcoat',
    label: 'Option B: Charcoal wool overcoat & flat cap',
    summary: 'Heavy slate wool coat, oxblood tie, tweed flat cap and thick red ring-binder.',
  },
  {
    id: 'vest',
    label: 'Option C: Olive depot vest & rolled sleeves',
    summary: 'Pale-blue work shirt with rolled sleeves, olive quilted supervisor vest, pocket pens and yellow legal pad.',
  },
]);
/** Chosen default after side-by-side renders: strong oxblood-and-amber echo of the Boss car, distinct silhouette on phone and desktop. */
export const DEFAULT_BOSS_LOOK: BossLookId = 'windbreaker';

export function readBossLook(params: URLSearchParams): BossLookId {
  const raw = params.get('bossLook')?.toLowerCase();
  if (raw === 'a' || raw === 'windbreaker') return 'windbreaker';
  if (raw === 'b' || raw === 'overcoat') return 'overcoat';
  if (raw === 'c' || raw === 'vest') return 'vest';
  return DEFAULT_BOSS_LOOK;
}

/** Port Hood Mail Depot exterior: modern Port Hood only, unless ?depot=0. */
export function depotEnabled(areaDepot: boolean, modern: boolean, params: URLSearchParams): boolean {
  return areaDepot && modern && params.get('depot') !== '0';
}

/** Shift-start loading bay in mail play (never Get Fired, Today's run, Just Drive, Explore, bare or ?boss=0/?depot=0). */
export function loadingEnabled(gameMode: string, modern: boolean, route: boolean, just: boolean, bare: boolean, params: URLSearchParams): boolean {
  return gameMode === 'mail' && modern && route && !just && !bare && params.get('boss') !== '0' && params.get('depot') !== '0';
}

/** Auto-open the loading bay on a real player shift start, or when ?depot=1 asks for it.
 * Explicit test visits and ?title=1 harness runs stay on the road unless ?depot=1 is given. */
export function autoLoadingOnStart(enabled: boolean, plainVisit: boolean, params: URLSearchParams): boolean {
  return enabled && (params.get('depot') === '1' || (plainVisit && !params.has('title')));
}

/** The interrogation room is triggered by any suspension or any non-clear verdict with offences seen by the Boss. */
export function needsInterrogation(outcome: Verdict, bossSeenCount: number): boolean {
  return outcome === 'suspension' || (bossSeenCount > 0 && outcome !== 'clear');
}

// ---- Loading scene rules ------------------------------------------------------------------

export type BundleKind = 'letters' | 'flyers' | 'parcel' | 'registered' | 'oversize';
export interface MailBundle {
  readonly index: number;
  readonly kind: BundleKind;
  readonly label: string;
  readonly weight: number;
  readonly colour: number;
}
export type StackGrade = 'neat' | 'crammed';
export interface LoadedBundle {
  readonly bundle: MailBundle;
  readonly grade: StackGrade;
  readonly lane: number;
}

const BUNDLE_META: Record<BundleKind, { label: string; weight: number; colour: number }> = {
  letters: { label: 'Letter tray', weight: 1, colour: 0xe9e2cf },
  flyers: { label: 'Flyer stack', weight: 1.2, colour: 0xd9c26b },
  parcel: { label: 'Brown parcel', weight: 1.4, colour: 0xa67a50 },
  registered: { label: 'Signature pouch', weight: 0.9, colour: 0xc26546 },
  oversize: { label: 'Oversize box', weight: 1.7, colour: 0x8e6b4a },
};

const LOADING_SALT = 149;

/** Deterministic daily load for the sorting bay: short and brisk (5 to 8 bundles). */
export function dayBundles(day: number, double: boolean, stops = 0): MailBundle[] {
  const kind = dayType(day);
  const count = double ? 8 : kind === 'flyers' ? 7 : kind === 'light' ? 5 : stops > 45 ? 7 : 6;
  const pool: BundleKind[] = kind === 'flyers'
    ? ['flyers', 'letters', 'flyers', 'parcel', 'flyers', 'registered', 'oversize', 'flyers']
    : double
      ? ['letters', 'parcel', 'flyers', 'oversize', 'letters', 'parcel', 'registered', 'oversize']
      : ['letters', 'parcel', 'flyers', 'registered', 'parcel', 'oversize', 'letters', 'flyers'];
  const out: MailBundle[] = [];
  for (let i = 0; i < count; i++) {
    const pick = pool[(i + Math.floor(draw(day, i, LOADING_SALT) * pool.length)) % pool.length];
    const meta = BUNDLE_META[pick];
    out.push({ index: i, kind: pick, label: meta.label, weight: meta.weight, colour: meta.colour });
  }
  return out;
}

export const SWEET_SPOT = 0.36;
export const FLIGHT_SECONDS = 0.38;
export const CLOSING_SECONDS = 0.95;

const BOSS_NEAT = [
  'Adequate. Keep moving.',
  'Square enough. Next bundle.',
  'That fits. Do not get used to praise.',
  'Good. Clock is still running.',
];
const BOSS_CRAMMED = [
  'That will ride. Barely.',
  'Do not bend the flyers. Too late.',
  'If it rattles, it stays in the back.',
  'You are packing a car, not a baler.',
];

export type LoadingPhase = 'loading' | 'closing' | 'done';

/** Pure simulation of loading the car at the Port Hood depot bay. */
export class LoadingRun {
  readonly bundles: readonly MailBundle[];
  readonly loaded: LoadedBundle[] = [];
  phase: LoadingPhase = 'loading';
  skipped = false;
  elapsed = 0;
  /** Sliding aim needle in [-1, 1]; centre (|needle| <= SWEET_SPOT) stacks neat. */
  needle = 0;
  /** Active bundle in flight, or null while resting on the bench. */
  flight: { bundle: MailBundle; t: number; lane: number; grade: StackGrade } | null = null;
  hatchClose = 0;
  /** Short rear suspension dip on landing, 0..1. */
  bounce = 0;
  bossLine: string;
  private needlePhase = 0;
  private closeTimer = 0;

  constructor(readonly day: number, readonly double = false, stops = 0) {
    this.bundles = dayBundles(Math.max(1, day), double, stops);
    this.bossLine = double
      ? 'Double mail today. Two days in one boot. Load up.'
      : dayType(Math.max(1, day)) === 'flyers'
        ? 'Flyer day. Every box wants them. Load up.'
        : 'Day’s mail is on the bench. Load the boot and get out there.';
  }

  get total(): number { return this.bundles.length; }
  get count(): number { return this.loaded.length; }
  get neatCount(): number { return this.loaded.filter(b => b.grade === 'neat').length; }
  get current(): MailBundle | null {
    const next = this.loaded.length + (this.flight ? 1 : 0);
    return next < this.bundles.length ? this.bundles[next] : null;
  }
  get inSweetSpot(): boolean { return Math.abs(this.needle) <= SWEET_SPOT; }

  /** Launch the next bundle from the sorting bench into the open car hatch. */
  toss(): boolean {
    if (this.phase !== 'loading') return false;
    if (this.flight) {
      // Rapid-fire tap: finish landing the current bundle right away and launch the next.
      this.landFlight();
      if (this.phase !== 'loading') return false;
    }
    const bundle = this.bundles[this.loaded.length];
    if (!bundle) return false;
    const lane = Math.max(-1, Math.min(1, this.needle));
    const grade: StackGrade = Math.abs(lane) <= SWEET_SPOT ? 'neat' : 'crammed';
    this.flight = { bundle, t: 0, lane, grade };
    return true;
  }

  /** Skip the bay immediately with no penalty. */
  skip(): void {
    if (this.phase === 'done') return;
    this.skipped = true;
    this.flight = null;
    this.phase = 'done';
    this.hatchClose = 1;
    this.bossLine = 'Already packed, then. Stay off the lawns.';
  }

  update(dt: number): void {
    const step = Math.max(0, Math.min(dt, 0.1));
    this.elapsed += step;
    this.bounce = Math.max(0, this.bounce - step * 3.8);
    if (this.phase === 'done') return;
    if (this.phase === 'loading') {
      // Gentle continuous sweep pace so phone tapping feels snappy and fair.
      const pace = 1.85 + Math.min(0.65, this.loaded.length * 0.08);
      this.needlePhase += step * pace;
      this.needle = Math.sin(this.needlePhase);
      if (this.flight) {
        this.flight.t += step / FLIGHT_SECONDS;
        if (this.flight.t >= 1) this.landFlight();
      }
      return;
    }
    this.closeTimer += step;
    this.hatchClose = Math.min(1, this.closeTimer / 0.45);
    if (this.closeTimer >= CLOSING_SECONDS) this.phase = 'done';
  }

  private landFlight(): void {
    if (!this.flight) return;
    const { bundle, lane, grade } = this.flight;
    this.flight = null;
    this.loaded.push({ bundle, lane, grade });
    this.bounce = Math.min(1, 0.45 + bundle.weight * 0.35);
    const pool = grade === 'neat' ? BOSS_NEAT : BOSS_CRAMMED;
    this.bossLine = pool[(this.loaded.length + this.day) % pool.length];
    if (this.loaded.length >= this.bundles.length) {
      this.phase = 'closing';
      this.closeTimer = 0;
      this.bossLine = this.neatCount >= Math.ceil(this.bundles.length * 0.6)
        ? 'Hatch shut. Clean load. Stay off the lawns.'
        : 'Hatch shut. If the boot springs open on Highway 19, that is on you.';
    }
  }
}

// ---- Interrogation room rules -------------------------------------------------------------

export type InterrogationReason = 'suspension' | 'bossVerdict' | 'visit';
export interface InterrogationComplaint {
  readonly kind: ComplaintKind | 'speeding' | 'schoolBus';
  readonly customer: string;
  readonly line: string;
  readonly seen?: boolean;
}
/** Merge direct Boss road sightings (e.g. speeding, passing a school bus) that have no customer call into the hearing list. */
export function mergeSeenOffences(
  complaints: readonly InterrogationComplaint[],
  seenNotes: readonly { kind: string; label: string }[] = [],
): InterrogationComplaint[] {
  const out: InterrogationComplaint[] = [...complaints];
  for (const s of seenNotes) {
    if (s.kind !== 'speeding' && s.kind !== 'schoolBus') continue;
    out.push({
      kind: s.kind,
      customer: 'The Boss · observed on the route',
      line: s.kind === 'speeding'
        ? `Clocked ${s.label} right past my windshield. Route rules still apply.`
        : `Observed on the route: ${s.label}. Flashing reds are not a suggestion.`,
      seen: true,
    });
  }
  return out;
}
export interface ReplyChoice {
  readonly label: string;
  readonly bossAnswer: string;
}

const REPLY_SETS: readonly (readonly ReplyChoice[])[] = Object.freeze([
  [
    { label: 'It was already like that.', bossAnswer: 'It was not already like that. Moving on.' },
    { label: 'The road was narrow.', bossAnswer: 'The road has been that width since 1968. Noted.' },
    { label: 'I’d like the shop steward.', bossAnswer: 'The steward is on lunch. Put your initials here.' },
  ],
  [
    { label: 'There was a cow.', bossAnswer: 'A cow did not throw a circular into the culvert. Next page.' },
    { label: 'The sun was in my eyes.', bossAnswer: 'It was cloudy. I checked the log.' },
    { label: 'No comment.', bossAnswer: '“No comment.” Writes nicely in pen. Next.' },
  ],
  [
    { label: 'I took a photograph.', bossAnswer: 'I have a photograph too. Mine is in focus.' },
    { label: 'That box leans on its own.', bossAnswer: 'It leaned straight onto the gravel after you passed. Noted.' },
    { label: 'I was making time.', bossAnswer: 'You made a complaint file instead. Nearly done.' },
  ],
]);

/** Sample real complaints (from complaints.ts) when visiting the office directly from Port Hood or via URL preview. */
export function sampleComplaints(day: number): InterrogationComplaint[] {
  const d = Math.max(1, day);
  return [
    { kind: 'lawnDamage', customer: 'a customer on Highway 19 who would like it noted', line: complaintLine('lawnDamage', d, 11), seen: true },
    { kind: 'ditchMail', customer: 'the customer with the leaning mailbox', line: complaintLine('ditchMail', d, 27) },
    { kind: 'boxDown', customer: 'the customer behind the hedge', line: complaintLine('boxDown', d, 43) },
  ];
}

/** Pick up to 3 complaints to read out: Boss-seen first, then most serious avoidable complaints. */
export function selectComplaints(complaints: readonly InterrogationComplaint[], day: number): InterrogationComplaint[] {
  if (!complaints.length) return sampleComplaints(day);
  const weight = (c: InterrogationComplaint): number =>
    (c.seen ? 100 : 0) + (c.kind === 'lawnDamage' ? 50 : c.kind === 'propertyDamage' ? 40 : c.kind === 'boxDown' ? 30 : c.kind === 'ditchMail' || c.kind === 'lawnMail' ? 20 : 10);
  return [...complaints].sort((a, b) => weight(b) - weight(a)).slice(0, 3);
}

export type InterrogationPhase = 'intro' | 'complaint' | 'response' | 'closing' | 'done';

/** Pure state machine for the Boss's office interrogation room. Player answers never alter career, pay or verdict. */
export class InterrogationSession {
  readonly items: readonly InterrogationComplaint[];
  phase: InterrogationPhase = 'intro';
  index = 0;
  /** Counts how many replies the player gave (never changes the verdict). */
  answers = 0;
  skipped = false;
  bossSpeech: string;
  quoteCustomer = '';
  quoteLine = '';
  quoteSeen = false;

  constructor(readonly reason: InterrogationReason, readonly day: number, complaints: readonly InterrogationComplaint[] = []) {
    this.items = selectComplaints(complaints, day);
    this.bossSpeech = reason === 'suspension'
      ? 'Sit down. Close the door. We have calls from the route, and none of them are thank-you cards.'
      : reason === 'bossVerdict'
        ? 'Sit down. I was out on the route today. I did not enjoy the drive.'
        : 'Sit down. Since you stepped into the office, we may as well look at the file.';
  }

  get current(): InterrogationComplaint | null {
    return this.phase === 'complaint' || this.phase === 'response' ? this.items[this.index] ?? null : null;
  }

  get choices(): readonly ReplyChoice[] {
    if (this.phase !== 'complaint') return [];
    return REPLY_SETS[(this.index + this.day) % REPLY_SETS.length];
  }

  get verdictLine(): string {
    if (this.reason === 'suspension') return 'One-day suspension, without pay. Day after tomorrow is double mail. Same clock.';
    if (this.reason === 'bossVerdict') return 'Written warning. Goes in the file. It is a thick file.';
    return 'No formal action today. Stay off the lawns and you will not see this side of the desk.';
  }

  /** Step forward from intro, response or closing. */
  advance(): void {
    if (this.phase === 'done') return;
    if (this.phase === 'intro') {
      this.openComplaint(0);
      return;
    }
    if (this.phase === 'response') {
      if (this.index + 1 < this.items.length) this.openComplaint(this.index + 1);
      else this.enterClosing();
      return;
    }
    if (this.phase === 'closing') {
      this.phase = 'done';
    }
  }

  /** Answer the current complaint. Always produces a dry Boss brush-off and never changes the verdict. */
  choose(choiceIndex: number): boolean {
    if (this.phase !== 'complaint') return false;
    const list = this.choices;
    const pick = list[Math.max(0, Math.min(list.length - 1, choiceIndex))];
    if (!pick) return false;
    this.answers++;
    this.bossSpeech = pick.bossAnswer;
    this.phase = 'response';
    return true;
  }

  skip(): void {
    if (this.phase === 'done') return;
    this.skipped = true;
    this.phase = 'done';
  }

  private openComplaint(i: number): void {
    this.index = i;
    const item = this.items[i];
    this.phase = 'complaint';
    this.quoteCustomer = item.customer;
    this.quoteLine = item.line;
    this.quoteSeen = !!item.seen;
    this.bossSpeech = item.seen
      ? `Complaint ${i + 1} of ${this.items.length}. I watched this one from the shoulder.`
      : `Complaint ${i + 1} of ${this.items.length}. Read out from the sheet.`;
  }

  private enterClosing(): void {
    this.phase = 'closing';
    this.quoteCustomer = '';
    this.quoteLine = '';
    this.quoteSeen = false;
    this.bossSpeech = `${this.verdictLine} Close the door on your way out.`;
  }
}
