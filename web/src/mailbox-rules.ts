/** Dimensions shared by the instance builder and the opening hit test. Metres. */
export function mailboxShape(style: number) {
  if (style === 6) return { width: .29, height: .27, depth: .50 };
  if (style === 7) return { width: .36, height: .36, depth: .64 };
  return { width: style === 0 ? .25 : style === 4 ? .31 : .20,
    height: style === 0 ? .28 : style === 4 ? .32 : .22, depth: style === 4 ? .60 : .48 };
}

interface Point { x: number; y: number; z: number }
/** Local +z is the road-facing door. Only a crossing from outside enters its opening. */
export function entersMailbox(a: Point, b: Point, style: number): boolean {
  const { width, height, depth } = mailboxShape(style), face = depth / 2 + .02;
  if (a.z <= face || b.z > face) return false;
  const t = (face - a.z) / (b.z - a.z);
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t - (1.05 + height / 2);
  const halfWidth = width * .435, halfHeight = height * .435;
  if (Math.abs(x) > halfWidth || Math.abs(y) > halfHeight) return false;
  // The upper half of an arched door is an ellipse; wooden boxes are rectangular.
  return style === 5 || style === 6 || y <= 0 || (x / halfWidth) ** 2 + (y / halfHeight) ** 2 <= 1;
}

export type MailboxDamage = 0 | 1 | 2 | 3;
/** A nudge below 2 km/h only rocks. 2/8/20 km/h leave a lean/dent/fall. */
export function mailboxDamage(speed: number): MailboxDamage {
  return speed >= 20 / 3.6 ? 3 : speed >= 8 / 3.6 ? 2 : speed >= 2 / 3.6 ? 1 : 0;
}
