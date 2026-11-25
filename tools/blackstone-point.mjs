// Where a share of Blackstone Road lies, worked out without web/src/start-key.ts. Used by the redirect check and the
// browser row, so both judge the start link against the same independent point.
import assert from 'node:assert/strict';

/** Metres from a point to the nearest part of a road line (segments, not only vertices). */
export function distanceToLine(px, pz, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
    best = Math.min(best, Math.hypot(px - ax - t * dx, pz - az - t * dz));
  }
  return best;
}

export const lineLength = pts => pts.reduce((sum, p, i) => i ? sum + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0, 0);

/**
 * Where a share of the longest public Blackstone Road piece lies, worked out here and not by web/src/start-key.ts.
 * The near end is the end that joins another public road (within 15 m); the data must have exactly one such end,
 * so the check fails loudly if a bake ever makes that ambiguous.
 */
export function independentPoint(roads, share) {
  const pieces = roads.filter(r => r.name === 'Blackstone Road' && r.kind >= 1 && r.kind <= 3 && !r.bridge && r.pts.length >= 2);
  assert.ok(pieces.length > 0, 'the roads hold a public Blackstone Road piece');
  const piece = pieces.reduce((best, r) => lineLength(r.pts) > lineLength(best.pts) ? r : best);
  const others = roads.filter(r => r !== piece && r.kind >= 1 && r.kind <= 3);
  const joins = end => others.some(r => distanceToLine(end[0], end[1], r.pts) <= 15);
  const first = piece.pts[0], last = piece.pts[piece.pts.length - 1];
  assert.notEqual(joins(first), joins(last), 'exactly one end of Blackstone Road joins another public road');
  const line = joins(first) ? piece.pts : [...piece.pts].reverse();
  let left = share * lineLength(line);
  for (let i = 1; i < line.length; i++) {
    const step = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    if (left <= step && step > 0) { const t = left / step; return { x: line[i - 1][0] + t * (line[i][0] - line[i - 1][0]), z: line[i - 1][1] + t * (line[i][1] - line[i - 1][1]) }; }
    left -= step;
  }
  throw new Error('share lies beyond the road');
}

