import type { Road } from '../roads';
import { FIELD, type Field } from './game-wire';
// The host's page describes where a room game may be played: the real roads around the host, as short lines of whole
// metres, and the real places where nothing scores. Pure, so the node checks build the same field as the game.

export interface QuietPlace { x: number; z: number; radius: number }

/** Douglas-Peucker on [x,z] points: the bends that matter, within `tol` metres. */
function simplify(pts: readonly [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!, [ax, az] = pts[a], [bx, bz] = pts[b], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / l; if (d > worst) { worst = d; at = i; } }
    if (worst > tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Roads (no railways) within `reach` of the host, and the quiet places near them, small enough for the room to accept. */
export function gameField(roads: readonly Road[], quiet: readonly QuietPlace[], at: { x: number; z: number }, reach = FIELD.reach - 20): Field {
  const runs: { pts: [number, number][]; d: number }[] = [];
  for (const road of roads) {
    if (road.railway || road.tags?.railway) continue;
    let run: [number, number][] = [];
    const end = () => { if (run.length >= 2) runs.push({ pts: run, d: Math.min(...run.map(p => Math.hypot(p[0] - at.x, p[1] - at.z))) }); run = []; };
    for (const p of road.pts) { if (Math.hypot(p[0] - at.x, p[1] - at.z) <= reach) run.push(p); else end(); }
    end();
  }
  runs.sort((a, b) => a.d - b.d);
  let lines: number[][] = [];
  for (const tol of [1.5, 3, 6, 12, 24]) {
    lines = []; let vertices = 0;
    for (const r of runs) {
      if (lines.length >= FIELD.lines) break;
      const line: number[] = [];
      for (const [x, z] of simplify(r.pts, tol)) {
        const px = Math.round(x), pz = Math.round(z);
        if (line.length && line[line.length - 2] === px && line[line.length - 1] === pz) continue;
        line.push(px, pz);
      }
      if (line.length < 4 || vertices + line.length / 2 > FIELD.vertices) continue;
      lines.push(line); vertices += line.length / 2;
    }
    if (lines.length === Math.min(runs.length, FIELD.lines)) break;
  }
  const near = quiet.map(q => ({ x: Math.round(q.x), z: Math.round(q.z), r: Math.min(FIELD.quietR, Math.ceil(q.radius)) }))
    .filter(q => Math.hypot(q.x - at.x, q.z - at.z) <= reach + q.r && q.r >= 1)
    .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z)).slice(0, FIELD.quiet);
  return { roads: lines, quiet: near };
}
