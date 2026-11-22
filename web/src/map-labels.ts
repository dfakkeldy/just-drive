// Which place names the small map writes, and where. No canvas here, so a Node check can run it.
// Each name sits beside its own point (one of eight spots around it) or is left out: names never pile up.

export interface LabelBox { x0: number; y0: number; x1: number; y1: number }
export interface LabelCandidate {
  label: string;
  /** The place's point on the map, in CSS pixels. */
  px: number; py: number;
  /** 0 shows first. See `mapRank` in places.ts. */
  rank: number;
  /** Metres from the car. */
  distance: number;
  /** True when the car is inside the place's own arrival radius. */
  here?: boolean;
}
export interface PlacedLabel extends LabelBox { label: string; slot: number; px: number; py: number }
export interface LabelLayout {
  size: number;
  circle?: { cx: number; cy: number; r: number };
  cap: number;
  /** Text width in CSS pixels. */
  measure(text: string): number;
  /** Boxes no name may cover: the car arrow and the N mark. */
  keep: readonly LabelBox[];
  /** Last drawing's names and spots, so names do not jump between redraws. */
  previous?: ReadonlyMap<string, number>;
}

export const LABEL_HEIGHT = 12;
const GAP = 4;       // between a point and its name
const EDGE = 4;      // from the map's edge
const PAD = 2;       // between two names
const ANCHOR = 3;    // half the square kept clear around a named point

/** How many names a map may show: about four on the small map at 3.2 km, more on the enlarged one. */
export function labelCap(size: number, reach: number): number {
  return Math.max(3, Math.min(12, Math.round(size * size / 8000) + (reach < 1500 ? 1 : 0)));
}

/** Sixteen spots round a point, as the top-left corner of a w × h box: eight close by (east first), then the same
 *  eight a little further out, for a point under the car arrow or another name. */
function spot(slot: number, px: number, py: number, w: number, h: number): [number, number] {
  const gap = slot < 8 ? GAP : 3 * GAP;
  switch (slot % 8) {
    case 0: return [px + gap, py - h / 2];          // east
    case 1: return [px + gap, py - gap - h + 2];    // north-east
    case 2: return [px + gap, py + gap - 2];        // south-east
    case 3: return [px - gap - w, py - h / 2];      // west
    case 4: return [px - gap - w, py - gap - h + 2];
    case 5: return [px - gap - w, py + gap - 2];
    case 6: return [px - w / 2, py - gap - h];      // north
    default: return [px - w / 2, py + gap];         // south
  }
}
const SLOTS = 16;

const overlaps = (a: LabelBox, b: LabelBox, pad: number): boolean =>
  a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;

/** The order names are tried in: the place the car is in (the best-ranked, if it is in several; else the nearest
 *  place), then by rank, then by distance. */
export function labelOrder(candidates: readonly LabelCandidate[], previous?: ReadonlyMap<string, number>): LabelCandidate[] {
  let first: LabelCandidate | undefined;
  for (const c of candidates) if (c.here && (!first || c.rank < first.rank || c.rank === first.rank && c.distance < first.distance)) first = c;
  if (!first) for (const c of candidates) if (!first || c.distance < first.distance) first = c;
  // A name shown last time keeps its place against a slightly nearer one of the same rank.
  const score = (c: LabelCandidate) => c === first ? -Infinity : c.rank * 1e7 + c.distance * (previous?.has(c.label) ? 0.8 : 1);
  return [...candidates].sort((a, b) => score(a) - score(b));
}

export function placeLabels(candidates: readonly LabelCandidate[], layout: LabelLayout): PlacedLabel[] {
  const { size, cap, measure, keep, previous } = layout;
  const placed: PlacedLabel[] = [], names: LabelBox[] = [], taken: LabelBox[] = [...keep], seen = new Set<string>();
  // No name covers a named point, nor the dot of a place as important as its own; it may lie over a lesser dot.
  const dots = candidates.map(c => ({ label: c.label, rank: c.rank, x0: c.px - ANCHOR, y0: c.py - ANCHOR, x1: c.px + ANCHOR, y1: c.py + ANCHOR }));
  for (const c of labelOrder(candidates, previous)) {
    if (placed.length >= cap) break;
    if (seen.has(c.label)) continue;
    const w = measure(c.label), h = LABEL_HEIGHT;
    const anchor = { x0: c.px - ANCHOR, y0: c.py - ANCHOR, x1: c.px + ANCHOR, y1: c.py + ANCHOR };
    if (names.some(b => overlaps(anchor, b, 0))) continue;           // its point is under another name
    const last = previous?.get(c.label);
    for (let n = 0; n < SLOTS; n++) {
      const slot = last === undefined ? n : n === 0 ? last : n <= last ? n - 1 : n;   // last drawing's spot first
      let [x0, y0] = spot(slot, c.px, c.py, w, h);
      // A name above or below its point may slide sideways to stay on the map; it stays over (or within 4 px of) it.
      if (slot % 8 >= 6) x0 = Math.min(Math.max(x0, EDGE), size - EDGE - w);
      const box = { x0, y0, x1: x0 + w, y1: y0 + h };
      // Inside the map whole: a name too long for this map is left out, never squeezed or cut.
      if (box.x0 < EDGE || box.y0 < EDGE || box.x1 > size - EDGE || box.y1 > size - EDGE) continue;
      const circle = layout.circle;
      if (circle && [box.x0, box.x1].some(x => [box.y0, box.y1].some(y => Math.hypot(x - circle.cx, y - circle.cy) > circle.r))) continue;
      if (taken.some(b => overlaps(box, b, PAD)) || dots.some(d => d.rank <= c.rank && d.label !== c.label && overlaps(box, d, 0))) continue;
      placed.push({ ...box, label: c.label, slot, px: c.px, py: c.py });
      names.push(box); taken.push(box, anchor); seen.add(c.label);
      break;
    }
  }
  return placed;
}
