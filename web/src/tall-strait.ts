import { inBox, pointSegment, type LightClass, type Mast, type PowerLine, type TallFile, type TowerKind } from './tall-rules';
import { MISCLASSIFIED_POWER_MASTS, MISCLASSIFIED_WATER_TOWERS, RESTORED_LINES, STRAIT_LINES, STRAIT_MASTS } from './tall-strait-data';

const STRAIT_BOUNDS: readonly [number, number, number, number] = [616076, 5045988, 654988, 5078756];
const KINDS: readonly TowerKind[] = ['standard', 'double', 'crossing'];
const LIGHTS: readonly (LightClass | undefined)[] = [undefined, 'A0', 'A1', 'A2', 'W'];

function boxesOverlap(a: readonly number[], b: readonly number[]): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/**
 * Merges the verified Strait of Canso crossings, restored overhead power lines and sourced communication masts
 * into an area's TallFile inside the existing tall.json load path (no extra network requests).
 * Areas outside the Strait/West Bay/south Judique box are returned unchanged.
 */
export function mergeStraitTall(data: TallFile): TallFile {
  if (!boxesOverlap(data.mid, STRAIT_BOUNDS)) return data;

  const extraLines: PowerLine[] = [];
  const straitSegments: [number, number, number, number][] = [];

  const sameBox = (a: readonly number[], b: readonly number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1);
  for (const raw of [...STRAIT_LINES, ...RESTORED_LINES]) {
    // A restored legacy piece is drawn only in the area it was baked for (pieces from neighbouring areas overlap).
    if (raw.m && !sameBox(raw.m, data.mid)) continue;
    // Every verified OSM/Strait span that reaches this mid box replaces baked towers, also a span that crosses the box
    // edge and is not drawn here. Restored legacy pieces never replace a kept baked line.
    if (!raw.m) for (let i = 1; i < raw.t.length; i++) {
      const a = raw.t[i - 1], b = raw.t[i];
      const box = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
      if (boxesOverlap(box, [data.mid[0] - 150, data.mid[1] - 150, data.mid[2] + 150, data.mid[3] + 150])) straitSegments.push([a[0], a[1], b[0], b[1]]);
    }
    // Split into maximal consecutive tower runs that fall inside this area's mid box.
    let runStart = -1;
    const flush = (end: number) => {
      if (runStart < 0 || end - runStart < 2) { runStart = -1; return; }
      const towers: Mast[] = [];
      const pts: [number, number][] = [];
      const spans: PowerLine['spans'] = [];
      let station = 0;
      for (let i = runStart; i < end; i++) {
        const [e, n, ground, height, kindCode, lightCode, osmId] = raw.t[i];
        if (i > runStart) {
          const prev = raw.t[i - 1];
          station += Math.hypot(e - prev[0], n - prev[1]);
          const sp = raw.s[i - 1];
          const g = sp.slice(1);
          spans.push({ sag: sp[0], ground: g, clearance: g });
        }
        towers.push({
          e, n, ground, height, station: Math.round(station * 100) / 100,
          kind: KINDS[kindCode],
          ...(lightCode ? { light: LIGHTS[lightCode] } : {}),
          ...(osmId ? { source: `osm:n${osmId}` } : { source: raw.src }),
        });
        pts.push([e, n]);
      }
      extraLines.push({ pts, towers, spans, circuits: raw.c, ref: raw.ref, source: raw.src });
      runStart = -1;
    };

    for (let i = 0; i < raw.t.length; i++) {
      const inside = inBox({ e: raw.t[i][0], n: raw.t[i][1], ground: raw.t[i][2] }, data.mid);
      if (inside) { if (runStart < 0) runStart = i; }
      else flush(i);
    }
    flush(raw.t.length);
  }

  // Keep the parts of baked lines that no verified OSM/Strait route replaces. A covered tower stays when it is the
  // neighbour of an uncovered one, so a kept part still meets the new route. A part that never strays more than
  // 120 m from the new routes is the same route drawn from another source (NSTDB vs OSM offsets), so it is dropped.
  const offset = (t: Mast) => Math.min(Infinity, ...straitSegments.map(s => pointSegment(t.e, t.n, [s[0], s[1]], [s[2], s[3]])));
  const keptLines: PowerLine[] = [];
  for (const line of data.lines) {
    if (!line.towers.length) continue;
    const dist = line.towers.map(offset);
    const cov = dist.map(d => d <= 55);
    if (!cov.some(Boolean)) { keptLines.push(line); continue; }
    const keep = cov.map((c, i) => !c || cov[i - 1] === false || cov[i + 1] === false);
    for (let i = 0; i < keep.length;) {
      if (!keep[i]) { i++; continue; }
      let j = i;
      while (j + 1 < keep.length && keep[j + 1]) j++;
      if (j > i && Math.max(...dist.slice(i, j + 1)) > 120) {
        const towers = line.towers.slice(i, j + 1);
        keptLines.push({ ...line, towers, pts: towers.map(t => [t.e, t.n]), spans: line.spans.slice(i, j) });
      }
      i = j + 1;
    }
  }

  // Communication masts: add verified Strait/West Bay/south Judique masts, drop the 4 misclassified L8004 power towers,
  // and deduplicate legacy NSTDB masts within 35 m of an upgraded sourced mast.
  const extraMasts: Mast[] = [];
  for (const [e, n, ground, height, lightCode, source] of STRAIT_MASTS) {
    if (!inBox({ e, n, ground }, data.mid)) continue;
    extraMasts.push({ e, n, ground, height, light: LIGHTS[lightCode], source });
  }

  const keptMasts = data.towers.filter(m => {
    if (MISCLASSIFIED_POWER_MASTS.some(([e, n]) => Math.hypot(m.e - e, m.n - n) <= 20)) return false;
    if (MISCLASSIFIED_WATER_TOWERS.some(([e, n]) => Math.hypot(m.e - e, m.n - n) <= 20)) return false;
    if (extraMasts.some(s => Math.hypot(m.e - s.e, m.n - s.n) <= 35)) return false;
    return true;
  });

  return {
    ...data,
    towers: [...keptMasts, ...extraMasts],
    lines: [...keptLines, ...extraLines],
  };
}
