import { draw } from './shift-rules';
export type ComplaintKind = 'lawnDamage' | 'boxDown' | 'lawnMail' | 'ditchMail' | 'missing' | 'stuffed' | 'flag' | 'late' | 'indoors' | 'relief' | 'sceneHit' | 'sceneHorn' | 'sceneDust' | 'sceneAnimal';
export interface Complaint {
  kind: ComplaintKind; customer: string; target: number; at: number; x: number; z: number;
  road: number; preExisting?: boolean; line: string;
}
export interface PhotoFact {
  id: string; kind: string; x: number; z: number; radius: number; road?: number; target?: number; blocking?: boolean;
}
export interface Photo { at: number; facts: PhotoFact[]; caption: string }
const LINES: Record<ComplaintKind, readonly string[]> = {
  sceneDust: Array(4).fill('My painting now has a road in it.'),
  sceneAnimal: ['I watched from the porch. The animal had better road sense than the mail car.',
    'Something wild crossed in front of the mail car. Only one of them slowed down.',
    'The animal was here first. The mail car could have waited.',
    'It cleared the ditch in one jump. I would rather it had not needed to.'],
  sceneHit: Array(4).fill('I stopped for the cows. The mail car stopped against my car.'),
  sceneHorn: Array(4).fill('I have the photograph. I also have nine recordings of the horn.'),
  indoors: ['The parcel came to the door. It appears to have stopped there.', 'We moved the crew. The delivery has not caught up.', 'A signature was required. Daylight was apparently preferred.', 'The carrier returned with our parcel. A round trip was not requested.'],
  relief: ['I looked out the window at the wrong moment. So did the carrier.', 'There is a mail car at the end of my lane, and the carrier is beside it. I will say no more.', 'I pay for home delivery. That is not what was delivered.', 'My hedge is not a public convenience.'],
  lawnDamage: ['There are two new lanes in my lawn. Neither was requested.', 'The grass is now a through road, apparently.', 'I mow that lawn. The carrier has helpfully ploughed it.', 'The tyre tracks do not match the landscaping plan.'],
  boxDown: ['My mailbox now receives mail at ground level.', 'The post was upright when I last approved it.', 'The mailbox is lying down on the job.', 'I would prefer the mailbox attached to the post.'],
  lawnMail: ['The lawn received my mail. I did not.', 'The grass does not read circulars.', 'My letter was delivered to the mowing area.', 'The envelope is taking root.'],
  ditchMail: ['The ditch has received another statement.', 'My mail is travelling by drainage.', 'I checked the mailbox. Then I checked the culvert.', 'The wet envelope was not an improvement.'],
  missing: ['No mail. This has been carefully noted.', 'I was expecting something. That should be sufficient.', 'The mailbox was available all day.', 'Service appears to have passed without stopping.'],
  stuffed: ['I never get my flyers. The old ones are beside the point.', 'Two months of flyers is no excuse for missing this week.', 'The box is full because nobody brings me flyers.', 'Cleaning the box is surely included in delivery.'],
  flag: ['Flag up: now everybody knows I have mail. Somebody will steal it.', 'Flag down: how am I supposed to know I have mail?', 'The raised flag advertises my private correspondence.', 'With the flag down, I am expected to guess.'],
  late: ['The mail used to come before noon. Now it is the middle of the afternoon.', 'Before the routes were merged, lunch followed the mail.', 'The old route arrived before noon. I still keep the old clock.', 'Two routes became one. Apparently my morning became afternoon.'],
};
export function complaintLine(kind: ComplaintKind, day: number, target: number): string {
  if (kind === 'flag') return LINES.flag[(day % 2 ? 0 : 1) + (draw(1, target, 9) < .5 ? 0 : 2)];
  const text = LINES[kind][(Math.floor(draw(1, target, 10) * 4) + day - 1) % 4];
  return kind === 'late' ? `${text} Year ${12 + Math.floor((day - 1) / 365)} of this complaint.` : text;
}
export function dismissed(c: Complaint, photos: readonly Photo[]): boolean {
  if (c.kind === 'late' || c.kind === 'flag' || c.kind === 'indoors' || c.kind === 'relief') return false;
  for (const p of photos) {
    if (p.at >= c.at) continue;
    for (const f of p.facts) {
      if (c.kind === 'stuffed' && f.kind === 'stuffed' && f.target === c.target) return true;
      if (c.kind === 'boxDown' && c.preExisting && f.kind === 'preExisting' && f.target === c.target) return true;
      if (c.kind === 'lawnDamage' && (f.kind === 'animal' || f.kind === 'obstacle' || f.kind === 'vehicle') && f.blocking &&
        f.road === c.road && (f.x - c.x) ** 2 + (f.z - c.z) ** 2 <= (80 + f.radius) ** 2) return true;
    }
  }
  return false;
}
export class Complaints {
  readonly all: Complaint[] = [];
  private readonly keys = new Set<string>();
  private readonly groundProperties = new Set<number>();
  get groundOverflow(): number { return Math.max(0, this.groundProperties.size - 5); }
  /** Hears each complaint once, as it is accepted (Get Fired scores it). */
  constructor(private readonly onAdd?: (c: Complaint) => void) {}
  add(c: Complaint): void {
    if (c.kind === 'lawnMail' || c.kind === 'ditchMail') {
      if (this.groundProperties.has(c.target)) return;
      this.groundProperties.add(c.target);
      if (this.groundProperties.size > 5) return;
    }
    const key = `${c.kind}:${c.target}`;
    if (this.keys.has(key)) return;
    this.keys.add(key); this.all.push(c); this.onAdd?.(c);
  }
}
