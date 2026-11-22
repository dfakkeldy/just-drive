import { inBox, pointSegment, type LightClass, type Mast, type PowerLine, type TallFile, type TowerKind } from './tall-rules';
import { MISCLASSIFIED_POWER_MASTS, STRAIT_LINES, STRAIT_MASTS } from './tall-strait-data';

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

  for (const raw of STRAIT_LINES) {
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
          straitSegments.push([prev[0], prev[1], e, n]);
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

  // Keep non-overlapping legacy lines (those not replaced by our verified OSM/restored routes).
  const keptLines = extraLines.length ? data.lines.filter(line => {
    if (!line.towers.length) return false;
    let covered = 0;
    for (const t of line.towers) {
      if (straitSegments.some(s => pointSegment(t.e, t.n, [s[0], s[1]], [s[2], s[3]]) <= 55)) covered++;
    }
    return covered / line.towers.length < 0.5;
  }) : data.lines;

  // Communication masts: add verified Strait/West Bay/south Judique masts, drop the 4 misclassified L8004 power towers,
  // and deduplicate legacy NSTDB masts within 35 m of an upgraded sourced mast.
  const extraMasts: Mast[] = [];
  for (const [e, n, ground, height, lightCode, source] of STRAIT_MASTS) {
    if (!inBox({ e, n, ground }, data.mid)) continue;
    extraMasts.push({ e, n, ground, height, light: LIGHTS[lightCode], source });
  }

  const keptMasts = data.towers.filter(m => {
    if (MISCLASSIFIED_POWER_MASTS.some(([e, n]) => Math.hypot(m.e - e, m.n - n) <= 20)) return false;
    if (extraMasts.some(s => Math.hypot(m.e - s.e, m.n - s.n) <= 35)) return false;
    return true;
  });

  return {
    ...data,
    towers: [...keptMasts, ...extraMasts],
    lines: [...keptLines, ...extraLines],
  };
}
